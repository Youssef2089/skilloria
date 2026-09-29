import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { logSession } from '@/lib/session-log'
import { verifyPhoneOtpToken } from '@/lib/phone-otp-token'
import { normalizeE164 } from '@/lib/phone'
import { signUpWithConfirmation } from '@/lib/auth-signup'
import { nouvellePiece } from '@/lib/journal/piece'
import { CGU_VERSION } from '@/lib/legal'
import { signerPreuveInscription } from '@/lib/inscription/preuve.mjs'
import { refusInscription, nommerLeRefus, INSCRIPTION_INDISPONIBLE } from '@/lib/inscription/refus'
import { ecosystemeDeLaRequete, redirectionConfirmation } from '@/lib/inscription/ecosysteme'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/register-org — préinscription d'une ORGANISATION (client, cabinet, ESN).
 *
 * ═══ L'ORGANISATION NAÎT DANS LA TRANSACTION DU COMPTE (§D.27) ════════════════
 *   Le trigger `handle_new_user`, sur une preuve signée ici, écrit le compte, son
 *   téléphone vérifié, son consentement aux CGU, puis l'organisation, son
 *   administrateur et son lien d'écosystème (`creer_organisation_avec_admin`), et
 *   les lignes `compte_cree` + `organisation_preinscrite` sous la pièce de ce
 *   geste. Tout, ou rien : JAMAIS un compte d'organisation sans son organisation,
 *   ni l'inverse. Le nettoyage d'après-coup (trois suppressions ordonnées, dont
 *   l'organisation orpheline de staging était née) n'a plus d'objet — retiré.
 *
 * ═══ CE QUE CETTE ROUTE VÉRIFIE ═════════════════════════════════════════════
 *   Le jeton OTP, la case des CGU, le mot de passe — ce que la base ne peut pas
 *   voir. TOUT le reste est en base, dans `inscription_refus()` : formats, pays
 *   au référentiel, numéro d'identification selon le pays et son unicité,
 *   domaine d'adresse bloqué, public, déjà pris. La route pose la question avant
 *   de créer (GoTrue avale l'erreur du trigger) et rend le code tel quel.
 *
 *  P1 — signUp via client ANON serveur (seul chemin déclenchant le SMTP).
 *  P7 — email_redirect_to strictement regexé (anti open-redirect).
 */

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
  org_type?: unknown
  email_redirect_to?: unknown
  cgu_accepted?: unknown
}

type OrgType = 'client' | 'cabinet' | 'esn'

/**
 * `org_type` (code BDD) → `role` d'inscription que lit le trigger : 'entreprise' pose
 * users.user_type = 'client', 'cabinet' pose 'cabinet' (l'ESN s'inscrit cabinet, son
 * organisation porte org_type = 'esn'). La base vérifie la cohérence (`invalid_org_type`).
 */
function roleDepuisTypeOrg(orgType: OrgType): 'entreprise' | 'cabinet' {
  return orgType === 'client' ? 'entreprise' : 'cabinet'
}

function texte(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
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

export async function POST(request: NextRequest): Promise<Response> {
  let body: RegisterOrgBody
  try {
    body = (await request.json()) as RegisterOrgBody
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  // ── Ce que la route seule vérifie ─────────────────────────────────────────
  const orgType = texte(body.org_type)
  if (orgType !== 'client' && orgType !== 'cabinet' && orgType !== 'esn') {
    return json({ error: 'Invalid input', code: 'invalid_org_type' }, 400)
  }
  const email = texte(body.email).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < 8 || password.length > 200) {
    return json({ error: 'Invalid input', code: 'invalid_password' }, 400)
  }
  if (body.cgu_accepted !== true) {
    return json({ error: 'Invalid input', code: 'cgu_required' }, 400)
  }
  // Canonique E.164 : la forme signée par verify-phone-otp, stockée, indexée par l'unique.
  const phone = normalizeE164(body.phone)
  if (!phone) {
    return json({ error: 'Invalid input', code: 'invalid_phone' }, 400)
  }
  const otpToken = texte(body.phone_otp_token)
  if (!otpToken) {
    return json({ error: 'Invalid input', code: 'phone_otp_required' }, 400)
  }
  // Vonage Verify v2 n'a pas de « GET status » après coup : le jeton HMAC émis par
  // /api/auth/public/verify-phone-otp au code réussi fait foi (lib/phone-otp-token.ts).
  let otpVerify: ReturnType<typeof verifyPhoneOtpToken>
  try {
    otpVerify = verifyPhoneOtpToken(otpToken, phone)
  } catch (err) {
    console.error('[register-org] verifyPhoneOtpToken threw', err)
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }
  if (!otpVerify.ok) {
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
  // `organisation_preinscrite`, écrites par le trigger dans la transaction du compte.
  const piece = nouvellePiece()
  const meta: Record<string, string> = {
    firstname: texte(body.first_name),
    lastname: texte(body.last_name),
    role: roleDepuisTypeOrg(orgType),
    org_type: orgType,
    company_name: texte(body.company_name),
    country_code: texte(body.country_code),
    siren: texte(body.siren),
    vat_number: texte(body.vat_number),
    domain_slug: domainSlug,
    voie: 'preinscription_organisation',
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
    console.error('[register-org] preuve non signée', err instanceof Error ? err.message : String(err))
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
    // GoTrue ne dit pas pourquoi le trigger a refusé : on repose la question (le domaine
    // ou le numéro pris entre-temps se nomme alors), sinon « indisponible » (§E.22).
    console.error('[register-org] signUp refusé', signup.message)
    const nomme = await nommerLeRefus(supabaseAdmin, email, meta)
    return json({ error: 'Registration refused', code: nomme.code }, nomme.statut)
  }
  const userId = signup.userId

  // L'organisation née dans la transaction du compte : lue pour la réponse et l'audit.
  //  (Deux lectures, pas un embed : `organization_members` a DEUX clés vers `users` — §E.18.)
  const { data: siege, error: siegeErr } = await supabaseAdmin
    .from('organization_members')
    // DEUX liens entre ces tables (l'appartenance, et le siège de l'organisation) : on nomme le nôtre (§E.18).
    .select('organization_id, organizations!organization_members_organization_id_fkey(email_domain)')
    .eq('user_id', userId)
    .maybeSingle()
  const { data: compte, error: compteErr } = await supabaseAdmin
    .from('users')
    .select('domain_id')
    .eq('id', userId)
    .maybeSingle()
  if (siegeErr || !siege || compteErr || !compte) {
    // Le compte et son organisation EXISTENT (même transaction) : on ne le dit pas raté.
    console.error('[register-org] organisation créée, trace d’audit non écrite', siegeErr?.message ?? compteErr?.message ?? 'siège illisible')
    return json({ user_id: userId }, 200)
  }
  const org = Array.isArray(siege.organizations) ? siege.organizations[0] : siege.organizations
  const organizationId: string = siege.organization_id
  await logAudit({
    piece,
    supabaseAdmin,
    user_id: userId,
    domain_id: compte.domain_id,
    action: 'org_pre_registered',
    entity_type: 'organization',
    entity_id: organizationId,
    detail: {
      org_type: orgType,
      is_public_domain: (org as { email_domain: string | null } | null)?.email_domain == null,
    },
  })
  await logSession({ supabaseAdmin, user_id: userId, request })

  return json({ user_id: userId, organization_id: organizationId }, 200)
}
