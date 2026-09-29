import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { logSession } from '@/lib/session-log'
import { verifyPhoneOtpToken } from '@/lib/phone-otp-token'
import { normalizeE164 } from '@/lib/phone'
import { signUpWithConfirmation } from '@/lib/auth-signup'
import { CGU_VERSION } from '@/lib/legal'
import { nouvellePiece } from '@/lib/journal/piece'
import { signerPreuveInscription } from '@/lib/inscription/preuve.mjs'
import { refusInscription, nommerLeRefus, INSCRIPTION_INDISPONIBLE } from '@/lib/inscription/refus'
import { ecosystemeDeLaRequete, redirectionConfirmation } from '@/lib/inscription/ecosysteme'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/public/register-expert
 *
 * Inscription EXPERT (freelance / cdi) avec OTP téléphone OBLIGATOIRE.
 *
 * ═══ CE QUE CETTE ROUTE VÉRIFIE — ET CE QU'ELLE NE VÉRIFIE PLUS (§D.27) ═══════
 *   Elle vérifie ce que SEULE elle peut vérifier : le jeton OTP (le téléphone a
 *   reçu le code), la case des CGU, le mot de passe (GoTrue le hache : la base
 *   ne le voit jamais). Puis elle SIGNE ce qu'elle atteste.
 *   Toutes les AUTRES règles — formats, branche et spécialité obligatoires,
 *   taxonomie de l'écosystème, unicité du téléphone — vivent en base, dans
 *   `inscription_refus()` : la route lui pose la question avant de créer le
 *   compte (GoTrue avale l'erreur du trigger, on ne saurait pas quoi dire après),
 *   et `handle_new_user` la rejoue. Un appel direct au service
 *   d'authentification, sans preuve, est refusé EN BASE (IN007).
 *
 * ═══ LE COMPTE NAÎT COMPLET, EN UNE TRANSACTION ═══════════════════════════════
 *   Le trigger écrit le compte, le profil, le téléphone vérifié, le consentement
 *   aux CGU (version, date), `compte_cree` et `expert_inscrit` sous la pièce de
 *   ce geste. Plus rien à finaliser ici, donc plus rien à nettoyer.
 *
 *  P1 — signUp via client ANON serveur (seul chemin déclenchant le SMTP) →
 *       lib/auth-signup.signUpWithConfirmation.
 *  P4 — AUCUN appel IA ici.
 *  P7 — email_redirect_to strictement regexé (anti open-redirect).
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
  branch_id?: unknown
  speciality_id?: unknown
  speciality_other?: unknown
  role?: unknown
  phone?: unknown
  phone_otp_token?: unknown
  email_redirect_to?: unknown
  cgu_accepted?: unknown
}

function texte(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
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

  // ── Ce que la route seule vérifie ─────────────────────────────────────────
  const role = texte(body.role)
  if (!(ROLES as readonly string[]).includes(role)) {
    return json({ error: 'Invalid input', code: 'invalid_role' }, 400)
  }
  const email = texte(body.email).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  // Le mot de passe : GoTrue le hache, la base ne le voit jamais — la règle reste ici.
  if (password.length < 8 || password.length > 200) {
    return json({ error: 'Invalid input', code: 'invalid_password' }, 400)
  }
  // Les CGU : un booléen strictement `true`. La version et la date sont posées par le
  // serveur (CGU_VERSION, signée) et par la base (la date de la transaction).
  if (body.cgu_accepted !== true) {
    return json({ error: 'Invalid input', code: 'cgu_required' }, 400)
  }
  // Le téléphone : canonique E.164, puis confronté au jeton HMAC de verify-phone-otp.
  const phone = normalizeE164(body.phone)
  if (!phone) {
    return json({ error: 'Invalid input', code: 'invalid_phone' }, 400)
  }
  const otpToken = texte(body.phone_otp_token)
  if (!otpToken) {
    return json({ error: 'Invalid input', code: 'phone_otp_required' }, 400)
  }
  let otpVerify: ReturnType<typeof verifyPhoneOtpToken>
  try {
    otpVerify = verifyPhoneOtpToken(otpToken, phone)
  } catch (err) {
    console.error('[register-expert] verifyPhoneOtpToken threw', err)
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }
  if (!otpVerify.ok) {
    // Jeton expiré (TTL 15 min) pendant le remplissage → l'UI invite à re-vérifier.
    return json({ error: 'Phone OTP not verified', code: 'phone_otp_required' }, 400)
  }
  const ecosysteme = ecosystemeDeLaRequete(request)
  if (!ecosysteme.ok) {
    return ecosysteme.raison === 'configuration'
      ? json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
      : json({ error: 'Unknown ecosystem', code: 'invalid_domain' }, 400)
  }
  const domainSlug = ecosysteme.slug
  const redirectRaw = texte(body.email_redirect_to)
  // Le lien de confirmation : l'adresse de l'écosystème résolu, au serveur (§E.83) — seule la langue vient du navigateur.
  const emailRedirectTo = redirectionConfirmation(redirectRaw, domainSlug)

  let supabaseAdmin: SupabaseClient
  try {
    supabaseAdmin = getSupabaseAdmin()
  } catch {
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }

  // La pièce du geste naît à son entrée (§D.26) : signée, elle porte `compte_cree` et
  // `expert_inscrit`, écrites par le trigger dans la transaction du compte.
  const piece = nouvellePiece()
  const meta: Record<string, string> = {
    firstname: texte(body.firstname),
    lastname: texte(body.lastname),
    specialty: texte(body.specialty),
    branch_id: texte(body.branch_id),
    speciality_id: texte(body.speciality_id),
    speciality_other: texte(body.speciality_other),
    role: role as ExpertRole,
    domain_slug: domainSlug,
    voie: 'inscription_expert',
    piece,
    cgu_version: CGU_VERSION,
    telephone: phone,
  }

  // ── La question à la base, AVANT de créer : une règle, une définition ─────
  const verdict = await refusInscription(supabaseAdmin, email, meta)
  if (!verdict.ok) {
    return json({ error: 'Registration refused', code: verdict.code }, verdict.statut)
  }

  let signees: Record<string, string>
  try {
    signees = signerPreuveInscription(email, meta)
  } catch (err) {
    console.error('[register-expert] preuve non signée', err instanceof Error ? err.message : String(err))
    return json({ error: 'Server misconfigured', code: INSCRIPTION_INDISPONIBLE }, 503)
  }

  const signup = await signUpWithConfirmation({
    email,
    password,
    emailRedirectTo,
    metadata: { ...meta, ...signees },
  })
  if (!signup.ok) {
    if (signup.code === 'missing_env') {
      return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
    }
    if (signup.code === 'email_taken') {
      return json({ error: 'Email already used', code: 'email_taken' }, 409)
    }
    // GoTrue ne dit pas pourquoi le trigger a refusé : on repose la question (une course
    // perdue se nomme alors), sinon « indisponible » — jamais un motif inventé (§E.22).
    console.error('[register-expert] signUp refusé', signup.message)
    const nomme = await nommerLeRefus(supabaseAdmin, email, meta)
    return json({ error: 'Registration refused', code: nomme.code }, nomme.statut)
  }
  const userId = signup.userId

  // L'écosystème de la trace d'audit : celui que la base a écrit sur le compte.
  const { data: compte, error: compteErr } = await supabaseAdmin
    .from('users')
    .select('domain_id')
    .eq('id', userId)
    .maybeSingle()
  if (compteErr || !compte) {
    // Le compte EXISTE (même transaction que sa ligne au grand livre) : on ne le dit pas raté.
    console.error('[register-expert] compte créé, trace d’audit non écrite', compteErr?.message ?? 'miroir illisible')
    return json({ user_id: userId }, 200)
  }
  await logAudit({
    piece,
    supabaseAdmin,
    user_id: userId,
    domain_id: compte.domain_id,
    action: 'expert_registered',
    entity_type: 'user',
    entity_id: userId,
    detail: { role },
  })
  await logSession({ supabaseAdmin, user_id: userId, request })

  return json({ user_id: userId }, 200)
}
