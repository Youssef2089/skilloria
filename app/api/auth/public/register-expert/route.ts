import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { logSession } from '@/lib/session-log'
import { verifyPhoneOtpToken } from '@/lib/phone-otp-token'
import { normalizeE164 } from '@/lib/phone'
import { signUpWithConfirmation, atomicCleanup, isUniqueViolation } from '@/lib/auth-signup'
import { CGU_VERSION } from '@/lib/legal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/public/register-expert
 *
 * Inscription EXPERT (freelance / cdi) avec OTP téléphone OBLIGATOIRE — remplace
 * le `supabase.auth.signUp` client historique (décision D3). Bâtie sur le
 * parcours org déjà en production, avec les mêmes pièges déjà évités :
 *
 *  P1 — signUp via client ANON serveur (seul chemin déclenchant le SMTP) →
 *       délégué à lib/auth-signup.signUpWithConfirmation.
 *  P3 — cleanup atomique (deleteUser ne cascade pas sur public.users) →
 *       lib/auth-signup.atomicCleanup, jamais de re-throw (Next renverrait un
 *       500 sans corps JSON). Classe d'erreur typée.
 *  P4 — AUCUN appel IA ici. La vérification d'expertise reste au PATCH
 *       visible=true (runExpertVerification), inchangée.
 *  P5 — l'écriture phone + phone_verified est BLOQUANTE : c'est la barrière
 *       anti-multicompte, un échec silencieux ruinerait le but.
 *  P7 — email_redirect_to strictement regexé (anti open-redirect), même règle
 *       que l'org.
 *  P8 — le trigger handle_new_user crée DÉJÀ public.profiles (visible=false)
 *       pour role in ('expert','cdi') : cette route N'INSÈRE PAS de profil, et
 *       le cleanup n'a que 2 étapes (public.users → auth.users).
 *
 * Unicité (D2) : pré-check `phone + phone_verified` AVANT signUp + interception
 * du 23505 (index unique partiel users_phone_verified_unique_idx) comme filet
 * de course → code 'phone_already_used'.
 *
 * Le téléphone est canonicalisé E.164 (D4) puis re-vérifié contre le jeton HMAC
 * (signé sur cette même forme par verify-phone-otp).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const ROLES = ['expert', 'cdi'] as const
type ExpertRole = (typeof ROLES)[number]

type Body = {
  firstname?: unknown
  lastname?: unknown
  email?: unknown
  password?: unknown
  specialty?: unknown
  role?: unknown
  domain_slug?: unknown
  phone?: unknown
  phone_otp_token?: unknown
  email_redirect_to?: unknown
  cgu_accepted?: unknown
}

type ValidatedInput = {
  first_name: string
  last_name: string
  email: string
  password: string
  specialty: string | null
  role: ExpertRole
  domain_slug: string
  phone: string
  phone_otp_token: string
  email_redirect_to: string | null
}

/** Erreur typée : porte le code + status pour une réponse JSON propre (jamais un re-throw). */
class RegisterExpertError extends Error {
  constructor(
    public code: string,
    public userMessage: string,
    public statusCode: number,
    public cause?: unknown,
  ) {
    super(userMessage)
    this.name = 'RegisterExpertError'
  }
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function validate(body: Body): { ok: true; input: ValidatedInput } | { ok: false; error: string } {
  const email = asString(body.email)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return { ok: false, error: 'invalid_email' }
  }
  const password = asString(body.password)
  if (!password || password.length < 8 || password.length > 200) {
    return { ok: false, error: 'invalid_password' }
  }
  const first_name = asString(body.firstname)
  if (!first_name || first_name.length > 100) {
    return { ok: false, error: 'invalid_first_name' }
  }
  const last_name = asString(body.lastname)
  if (!last_name || last_name.length > 100) {
    return { ok: false, error: 'invalid_last_name' }
  }
  const roleRaw = asString(body.role)
  if (!roleRaw || !(ROLES as readonly string[]).includes(roleRaw)) {
    return { ok: false, error: 'invalid_role' }
  }
  const domain_slug = asString(body.domain_slug)
  if (!domain_slug || !/^[a-z0-9-]{1,50}$/.test(domain_slug)) {
    return { ok: false, error: 'invalid_domain_slug' }
  }
  const specialty = asString(body.specialty)
  if (specialty && specialty.length > 200) {
    return { ok: false, error: 'invalid_specialty' }
  }
  // Téléphone : normalisation E.164 STRICTE (D4). La forme canonique est celle
  // sur laquelle le jeton HMAC a été signé et celle indexée par l'unique.
  const phone = normalizeE164(body.phone)
  if (!phone) {
    return { ok: false, error: 'invalid_phone' }
  }
  const phone_otp_token = asString(body.phone_otp_token)
  if (!phone_otp_token) {
    return { ok: false, error: 'phone_otp_required' }
  }
  // Acceptation des CGU — GARDE SERVEUR (preuve juridique, point C). La case
  // client seule ne suffit pas : on exige un booléen strictement `true`. La
  // valeur n'est qu'un feu vert — l'horodatage et la VERSION posés en base sont
  // décidés côté serveur (CGU_VERSION), jamais fournis par le client.
  if (body.cgu_accepted !== true) {
    return { ok: false, error: 'cgu_required' }
  }
  // email_redirect_to : anti open-redirect, MÊME regex que register-org (P7).
  const redirectRaw = asString(body.email_redirect_to)
  const email_redirect_to =
    redirectRaw && /^https?:\/\/[^\s/]{1,200}\/[a-z]{2}\/auth\/callback$/.test(redirectRaw)
      ? redirectRaw
      : null

  return {
    ok: true,
    input: {
      first_name,
      last_name,
      email: email.toLowerCase(),
      password,
      specialty,
      role: roleRaw as ExpertRole,
      domain_slug,
      phone,
      phone_otp_token,
      email_redirect_to,
    },
  }
}

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('missing_env')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const validation = validate(body)
  if (!validation.ok) {
    return json({ error: 'Invalid input', code: validation.error }, 400)
  }
  const input = validation.input

  // ── Vérif HMAC du jeton OTP (sur le téléphone CANONIQUE) ─────────────────
  let otpVerify: ReturnType<typeof verifyPhoneOtpToken>
  try {
    otpVerify = verifyPhoneOtpToken(input.phone_otp_token, input.phone)
  } catch (err) {
    console.error('[register-expert] verifyPhoneOtpToken threw', err)
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }
  if (!otpVerify.ok) {
    // Jeton expiré (TTL 15 min) pendant le remplissage → l'UI invite à re-vérifier.
    return json({ error: 'Phone OTP not verified', code: 'phone_otp_required' }, 400)
  }

  let supabaseAdmin: SupabaseClient
  try {
    supabaseAdmin = getSupabaseAdmin()
  } catch {
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }

  // ── Pré-check UNICITÉ TÉLÉPHONE (D2) : refus propre AVANT toute écriture ──
  const { data: phoneOwner } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('phone', input.phone)
    .eq('phone_verified', true)
    .maybeSingle()
  if (phoneOwner) {
    return json({ error: 'Phone already used', code: 'phone_already_used' }, 409)
  }

  // ── Création auth.users via helper partagé (P1) ──────────────────────────
  // Le trigger handle_new_user crée public.users + public.profiles (visible=false)
  // à partir de raw_user_meta_data.role ('expert'|'cdi').
  const signup = await signUpWithConfirmation({
    email: input.email,
    password: input.password,
    emailRedirectTo: input.email_redirect_to,
    metadata: {
      firstname: input.first_name,
      lastname: input.last_name,
      specialty: input.specialty ?? '',
      role: input.role, // 'expert' | 'cdi' — accepté tel quel par le trigger
      domain_slug: input.domain_slug,
    },
  })
  if (!signup.ok) {
    console.error('[register-expert] signUp failed', signup.message)
    if (signup.code === 'missing_env') {
      return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
    }
    if (signup.code === 'email_taken') {
      return json({ error: 'Email already used', code: 'email_taken' }, 409)
    }
    return json({ error: signup.message, code: 'create_user_failed' }, 500)
  }
  const user_id = signup.userId

  // ── À partir d'ici : tout échec déclenche un CLEANUP ATOMIQUE (P8 : 2 étapes,
  //    profiles part en CASCADE avec public.users). ──────────────────────────
  try {
    // Flag phone_verified=true sur public.users — BLOQUANT (P5). Le trigger a
    // créé la ligne sans téléphone ; on y pose le numéro canonique + le flag.
    // On y pose AUSSI la preuve d'acceptation des CGU (point C) : horodatage
    // serveur + version en vigueur (constante CGU_VERSION). Même UPDATE → la
    // preuve est écrite atomiquement avec la finalisation de l'inscription.
    const { error: phoneUpdErr } = await supabaseAdmin
      .from('users')
      .update({
        phone: input.phone,
        phone_verified: true,
        cgu_accepted_at: new Date().toISOString(),
        cgu_version: CGU_VERSION,
      })
      .eq('id', user_id)
    if (phoneUpdErr) {
      // 23505 sur l'index unique partiel = course perdue avec un autre inscrit.
      if (isUniqueViolation(phoneUpdErr)) {
        throw new RegisterExpertError('phone_already_used', 'Phone already used', 409, phoneUpdErr)
      }
      throw new RegisterExpertError('phone_update_failed', 'Could not set verified phone', 500, phoneUpdErr)
    }

    // ── Domaine cible (pour l'audit/session — le trigger a déjà rattaché) ──
    const { data: domainRow } = await supabaseAdmin
      .from('domains')
      .select('id')
      .eq('slug', input.domain_slug)
      .eq('active', true)
      .maybeSingle()

    await logAudit({
      supabaseAdmin,
      user_id,
      domain_id: (domainRow?.id as string | undefined) ?? null,
      action: 'expert_registered',
      entity_type: 'user',
      entity_id: user_id,
      detail: { role: input.role },
    })
    await logSession({ supabaseAdmin, user_id, request })

    return json({ user_id }, 200)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[register-expert] rollback déclenché: ${errMsg}`)

    // Cleanup 2 étapes (P8) : public.users (CASCADE profiles) → auth.users.
    await atomicCleanup(supabaseAdmin, { userId: user_id })

    if (err instanceof RegisterExpertError) {
      return json({ error: err.userMessage, code: err.code }, err.statusCode)
    }
    // Erreur inattendue : pas de re-throw (P3) — 500 générique avec corps JSON.
    return json({ error: 'Internal error', code: 'internal_error' }, 500)
  }
}
