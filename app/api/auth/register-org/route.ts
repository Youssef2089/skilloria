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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type RegisterOrgBody = {
  country_code?: unknown
  company_name?: unknown
  siren?: unknown
  vat_number?: unknown
  email?: unknown
  password?: unknown
  first_name?: unknown
  last_name?: unknown
  phone?: unknown
  phone_otp_token?: unknown
  domain_slug?: unknown
  org_type?: unknown
  email_redirect_to?: unknown
  cgu_accepted?: unknown
}

type OrgType = 'client' | 'cabinet' | 'esn'

type ValidatedInput = {
  country_code: string
  company_name: string
  siren: string | null
  vat_number: string | null
  email: string
  password: string
  first_name: string
  last_name: string
  phone: string
  phone_otp_token: string
  domain_slug: string
  org_type: OrgType
  email_domain: string
  email_redirect_to: string | null
}

/**
 * Mapping `org_type` (code BDD anglais, valeur de `organizations.org_type`)
 * vers `user_metadata.role` que consomme le trigger `handle_new_user` pour
 * poser `users.user_type`.
 *
 * Le trigger n'accepte que 'entreprise' / 'cabinet' dans `raw_user_meta_data.role` :
 *   - 'entreprise' → users.user_type='client'
 *   - 'cabinet'    → users.user_type='cabinet'
 *
 * V1 — ESN traité comme cabinet côté users.user_type (à affiner en V2 si besoin).
 */
function metadataRoleFromOrgType(org_type: OrgType): 'entreprise' | 'cabinet' {
  if (org_type === 'client') return 'entreprise'
  return 'cabinet' // 'cabinet' OR 'esn'
}

/**
 * Erreur typée levée pendant les inserts métier post-createUser.
 * Permet de propager `code` + `statusCode` vers le client après
 * exécution du cleanup atomique.
 */
class RegisterOrgError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    public readonly statusCode: number,
    public readonly cause?: unknown,
  ) {
    super(userMessage)
    this.name = 'RegisterOrgError'
  }
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function validate(body: RegisterOrgBody): { ok: true; input: ValidatedInput } | { ok: false; error: string } {
  const country_code = asString(body.country_code)
  if (!country_code || !/^[A-Z]{2}$/.test(country_code)) {
    return { ok: false, error: 'invalid_country_code' }
  }
  const company_name = asString(body.company_name)
  if (!company_name || company_name.length < 2 || company_name.length > 200) {
    return { ok: false, error: 'invalid_company_name' }
  }
  const email = asString(body.email)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return { ok: false, error: 'invalid_email' }
  }
  const email_domain = email.split('@')[1].toLowerCase()
  const password = asString(body.password)
  if (!password || password.length < 8 || password.length > 200) {
    return { ok: false, error: 'invalid_password' }
  }
  const first_name = asString(body.first_name)
  if (!first_name || first_name.length > 100) {
    return { ok: false, error: 'invalid_first_name' }
  }
  const last_name = asString(body.last_name)
  if (!last_name || last_name.length > 100) {
    return { ok: false, error: 'invalid_last_name' }
  }
  const domain_slug = asString(body.domain_slug)
  if (!domain_slug || !/^[a-z0-9-]{1,50}$/.test(domain_slug)) {
    return { ok: false, error: 'invalid_domain_slug' }
  }
  const org_type_raw = asString(body.org_type)
  if (org_type_raw !== 'client' && org_type_raw !== 'cabinet' && org_type_raw !== 'esn') {
    return { ok: false, error: 'invalid_org_type' }
  }
  const siren = asString(body.siren)
  if (siren && !/^\d{9}$/.test(siren.replace(/\s/g, ''))) {
    return { ok: false, error: 'invalid_siren' }
  }
  const vat_number = asString(body.vat_number)
  if (vat_number && vat_number.length > 30) {
    return { ok: false, error: 'invalid_vat_number' }
  }
  // Normalisation E.164 STRICTE (lib/phone) : la forme canonique est celle sur
  // laquelle le jeton HMAC a été signé (verify-phone-otp), celle stockée sur
  // users.phone, et celle indexée par l'unique partiel. Sans ça, un format
  // divergent ferait échouer le match du jeton OU troerait l'unicité.
  const phone = normalizeE164(body.phone)
  if (!phone) {
    return { ok: false, error: 'invalid_phone' }
  }
  const phone_otp_token = asString(body.phone_otp_token)
  if (!phone_otp_token) {
    return { ok: false, error: 'phone_otp_required' }
  }
  // Acceptation des CGU — GARDE SERVEUR (preuve juridique, point C). Même règle
  // que register-expert : booléen strictement `true` exigé ; l'horodatage et la
  // VERSION posés en base (CGU_VERSION) sont décidés côté serveur.
  if (body.cgu_accepted !== true) {
    return { ok: false, error: 'cgu_required' }
  }
  // email_redirect_to optionnel : front passe l'URL absolue vers /auth/callback
  // après confirmation du mail Supabase. On valide strictement pour éviter
  // toute redirection arbitraire (open redirect via Supabase email).
  const email_redirect_to_raw = asString(body.email_redirect_to)
  const email_redirect_to =
    email_redirect_to_raw &&
    /^https?:\/\/[^\s/]{1,200}\/[a-z]{2}\/auth\/callback$/.test(email_redirect_to_raw)
      ? email_redirect_to_raw
      : null
  return {
    ok: true,
    input: {
      country_code,
      company_name,
      siren: siren ? siren.replace(/\s/g, '') : null,
      vat_number,
      email: email.toLowerCase(),
      password,
      first_name,
      last_name,
      phone,
      phone_otp_token,
      domain_slug,
      org_type: org_type_raw as OrgType,
      email_domain,
      email_redirect_to,
    },
  }
}

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('missing_env')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
// Le client ANON serveur (auth.signUp) vit désormais dans lib/auth-signup.ts
// (signUpWithConfirmation) — partagé avec register-expert.

export async function POST(request: NextRequest): Promise<Response> {
  let body: RegisterOrgBody
  try {
    body = (await request.json()) as RegisterOrgBody
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const validation = validate(body)
  if (!validation.ok) {
    return json({ error: 'Invalid input', code: validation.error }, 400)
  }
  const input = validation.input

  // ── Vérif HMAC du phone_otp_token (B3.2) ─────────────────────────────────
  // Vonage Verify v2 ne propose pas de "GET status" post-completion : on
  // s'appuie donc sur un token signé HMAC-SHA256 émis par
  // /api/auth/public/verify-phone-otp lors du verify SMS réussi.
  // Cf. lib/phone-otp-token.ts.
  let otpVerify: ReturnType<typeof verifyPhoneOtpToken>
  try {
    otpVerify = verifyPhoneOtpToken(input.phone_otp_token, input.phone)
  } catch (err) {
    console.error('[register-org] verifyPhoneOtpToken threw', err)
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }
  if (!otpVerify.ok) {
    return json(
      { error: 'Phone OTP not verified', code: 'phone_otp_required' },
      400,
    )
  }

  let supabaseAdmin: SupabaseClient
  try {
    supabaseAdmin = getSupabaseAdmin()
  } catch {
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }

  // ── Pré-check UNICITÉ TÉLÉPHONE (D2 : 1 numéro vérifié = 1 compte) ────────
  //  Refus PROPRE avant toute écriture. L'interception du 23505 plus bas reste
  //  le filet en cas de course. `input.phone` est déjà canonicalisé E.164.
  const { data: phoneOwner } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('phone', input.phone)
    .eq('phone_verified', true)
    .maybeSingle()
  if (phoneOwner) {
    return json({ error: 'Phone already used', code: 'phone_already_used' }, 409)
  }

  // ── Pré-checks BDD ───────────────────────────────────────────────────────
  const { data: blocked } = await supabaseAdmin
    .from('blocked_email_domains')
    .select('id')
    .ilike('email_domain', input.email_domain)
    .eq('active', true)
    .maybeSingle()
  if (blocked) {
    return json({ error: 'Email domain blocked', code: 'email_domain_blocked' }, 400)
  }

  // Domaines PUBLICS (gmail.com, outlook.com, …) : autorisés mais ne réservent
  // pas le domaine. L'org est créée avec email_domain=NULL pour ne pas bloquer
  // les futurs inscrits du même domaine (index unique partiel ignore NULL).
  // Liste gérée en back-office via public.public_email_domains.
  const { data: publicDomain } = await supabaseAdmin
    .from('public_email_domains')
    .select('id')
    .ilike('email_domain', input.email_domain)
    .eq('active', true)
    .maybeSingle()
  const isPublicDomain = !!publicDomain

  if (!isPublicDomain) {
    const { data: existingDomain } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .ilike('email_domain', input.email_domain)
      .maybeSingle()
    if (existingDomain) {
      return json({ error: 'Email domain already used', code: 'email_domain_taken' }, 409)
    }
  }

  if (input.siren) {
    const { data: existingSiren } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('siren', input.siren)
      .maybeSingle()
    if (existingSiren) {
      return json({ error: 'SIREN already used', code: 'siren_taken' }, 409)
    }
  }

  // ── Domaine cible (org sera rattachée à ce domaine) ─────────────────────
  const { data: domainRow, error: domainErr } = await supabaseAdmin
    .from('domains')
    .select('id, slug')
    .eq('slug', input.domain_slug)
    .eq('active', true)
    .maybeSingle()
  if (domainErr || !domainRow) {
    return json({ error: 'Domain not found', code: 'domain_not_found' }, 404)
  }

  // ── 1. Création auth.users (trigger handle_new_user crée public.users) ──
  // ⚠️ Le trigger lit raw_user_meta_data.role pour poser users.user_type.
  //    Il n'accepte que 'entreprise'/'cabinet' (mots français) — on mappe
  //    org_type ('client'|'cabinet'|'esn') -> role ('entreprise'|'cabinet').
  //
  // Création auth.users via helper partagé (P1 : signUp anon serveur = seul
  // chemin qui déclenche le SMTP de confirmation). Cf. lib/auth-signup.ts.
  const signup = await signUpWithConfirmation({
    email: input.email,
    password: input.password,
    emailRedirectTo: input.email_redirect_to,
    metadata: {
      firstname: input.first_name,
      lastname: input.last_name,
      role: metadataRoleFromOrgType(input.org_type),
      domain_slug: input.domain_slug,
    },
  })
  if (!signup.ok) {
    console.error('[register-org] signUp failed', signup.message)
    if (signup.code === 'missing_env') {
      return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
    }
    if (signup.code === 'email_taken') {
      return json({ error: 'Email already used', code: 'email_taken' }, 409)
    }
    return json({ error: signup.message, code: 'create_user_failed' }, 500)
  }
  const user_id = signup.userId

  // ── À partir d'ici, tout fail doit déclencher un CLEANUP ATOMIQUE ───────
  // 1. Le trigger `handle_new_user` a déjà créé `public.users` (et le cas
  //    échéant `public.profiles` pour freelance/cdi — pas pour client/cabinet).
  // 2. `auth.admin.deleteUser` ne supprime QUE `auth.users` ; les lignes
  //    `public.users` orphelines persistent et bloquent les futures
  //    inscriptions (UNIQUE constraint users_email_key).
  // 3. Le cleanup doit donc supprimer EN PREMIER l'organization (cascade ON
  //    DELETE → organization_members + organization_domains + verification_attempts),
  //    PUIS `public.users` (cascade → session_logs), PUIS `auth.users`.
  //
  // `organization_id` est hissé ici pour rester accessible depuis le catch
  // (sinon TS le considère hors scope si l'INSERT throw avant assignation).
  // ────────────────────────────────────────────────────────────────────────
  let organization_id: string | null = null
  try {
    // ── 1.b Flag phone_verified=true sur public.users ─────────────────────
    // Le trigger `handle_new_user` a créé public.users sans téléphone ; on
    // injecte le numéro vérifié OTP (canonique E.164) + le flag. BLOQUANT :
    // le téléphone vérifié est la barrière anti-multicompte, un échec silencieux
    // ruinerait le but. Un 23505 sur l'index unique partiel = course perdue avec
    // un autre inscrit → refus propre 'phone_already_used'.
    // On y pose AUSSI la preuve d'acceptation des CGU (point C) : horodatage
    // serveur + version en vigueur (CGU_VERSION), écrite atomiquement avec la
    // finalisation de l'inscription.
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
      if (isUniqueViolation(phoneUpdErr)) {
        throw new RegisterOrgError('phone_already_used', 'Phone already used', 409, phoneUpdErr)
      }
      throw new RegisterOrgError('phone_update_failed', 'Could not set verified phone', 500, phoneUpdErr)
    }

    // ── 2. Création organizations ─────────────────────────────────────────
    // Colonnes legacy `user_id` et `domain_id` droppées par B6_MIGRATION_2
    // (20260502_archi_orga_b6_migration_2_drop_legacy.sql). La liaison
    // user↔org passe par `organization_members`, org↔domain par
    // `organization_domains` (inserts plus bas).
    const { data: orgRow, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .insert({
        org_type: input.org_type,
        company_name: input.company_name,
        country: input.country_code,
        siren: input.siren,
        vat_number: input.vat_number,
        // Domaine public → NULL (cohabitation libre, index unique partiel
        // ignore NULL et B4 ne doit jamais auto-rattacher sur NULL).
        email_domain: isPublicDomain ? null : input.email_domain,
        verification_status: 'pending_provider_check',
      })
      .select('id')
      .single()
    if (orgErr || !orgRow) {
      throw new RegisterOrgError(
        'org_insert_failed',
        'Could not create organization',
        500,
        orgErr,
      )
    }
    organization_id = orgRow.id as string

    // ── 3. organization_members (admin du nouvel org) ─────────────────────
    const { error: memberErr } = await supabaseAdmin
      .from('organization_members')
      .insert({
        user_id,
        organization_id,
        role_in_org: 'admin',
        status: 'active',
        invited_by: null,
      })
    if (memberErr) {
      throw new RegisterOrgError(
        'member_insert_failed',
        'Could not link member',
        500,
        memberErr,
      )
    }

    // ── 4. organization_domains (1 seul domaine V1, package_id=null) ──────
    const { error: orgDomErr } = await supabaseAdmin
      .from('organization_domains')
      .insert({
        organization_id,
        domain_id: domainRow.id,
        active: true,
        // Aucun `package_id` ici : l'abonnement vit désormais sur
        // `organizations`, et la colonne a été SUPPRIMÉE de cette table.
        // Cette ligne n'est plus qu'une TRACE de l'écosystème d'inscription.
      })
    if (orgDomErr) {
      throw new RegisterOrgError(
        'org_domain_insert_failed',
        'Could not link domain',
        500,
        orgDomErr,
      )
    }

    // ── 5. Side effects best-effort ──────────────────────────────────────
    // La vérification entreprise (Sirene + IA) tourne à l'étape 2 dans
    // finalize-org-registration, qui reçoit SIREN + website + org_sub_type
    // via la modale post-login. Ici on laisse l'org en
    // verification_status='pending_provider_check' (posé à l'INSERT).
    await logAudit({
      supabaseAdmin,
      user_id,
      domain_id: domainRow.id,
      action: 'org_pre_registered',
      entity_type: 'organization',
      entity_id: organization_id,
      detail: {
        org_type: input.org_type,
        is_public_domain: isPublicDomain,
      },
    })
    await logSession({ supabaseAdmin, user_id, request })

    return json(
      {
        user_id,
        organization_id,
      },
      200,
    )
  } catch (err) {
    // ── CLEANUP ATOMIQUE (helper partagé, P3) ───────────────────────────
    // Ordre : org -> public.users -> auth.users. `organization_id` (hissé hors
    // du try) est passé en extraDelete parent-first : sa CASCADE B1 emporte
    // organization_members + organization_domains + verification_attempts.
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[register-org] rollback déclenché: ${errMsg}`)

    await atomicCleanup(supabaseAdmin, {
      userId: user_id,
      extraDeletes: organization_id
        ? [
            {
              label: 'organizations',
              run: async () => await supabaseAdmin.from('organizations').delete().eq('id', organization_id as string),
            },
          ]
        : [],
    })

    // Retourner l'erreur originale au client
    if (err instanceof RegisterOrgError) {
      return json({ error: err.userMessage, code: err.code }, err.statusCode)
    }
    // Erreur inattendue : on ne re-throw pas (sinon Next renvoie un 500
    // sans corps JSON typé). On retourne un 500 générique.
    return json({ error: 'Internal error', code: 'internal_error' }, 500)
  }
}
