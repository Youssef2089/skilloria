import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { runVerification } from '@/lib/verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Finalisation de l'inscription organisation après le clic email + arrivée
 * sur le dashboard (B3.4).
 *
 * Flow :
 *   1. requireAuth → vérifie session + récupère context (user, org, supabaseAdmin)
 *   2. Vérifier que l'user est admin de son org (role_in_org='admin', status='active')
 *      → déjà chargé par requireAuth via organization_members
 *   3. UPDATE users SET civility, job_title, linkedin_url
 *   4. UPDATE organizations SET siren, org_type, website_url, setup_completed_at
 *   5. runVerification SYNCHRONE (V1) → UPDATE organizations.verification_status
 *   6. Audit log → return 200
 *
 * TODO V2 : migrer vers job queue (Vercel Cron / Supabase Edge Functions /
 *           Inngest) pour vraie async sans risque de coupure serverless.
 *           V1 garde synchrone car Vercel tue la fonction après return Response,
 *           fire-and-forget = risque vérif jamais terminée.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = {
  civility?: unknown
  job_title?: unknown
  linkedin_url?: unknown
  siren?: unknown
  org_sub_type?: unknown
  website?: unknown
}

const CIVILITIES = ['mr', 'mrs', 'mx'] as const
type Civility = (typeof CIVILITIES)[number]

const ORG_SUB_TYPES = ['client', 'esn', 'cabinet'] as const
type OrgSubType = (typeof ORG_SUB_TYPES)[number]

type ValidatedInput = {
  civility: Civility
  job_title: string
  linkedin_url: string | null
  siren: string
  org_sub_type: OrgSubType
  website_url: string | null
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function isUrl(s: string): boolean {
  if (s.length > 500) return false
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function isLinkedinUrl(s: string): boolean {
  if (!isUrl(s)) return false
  return /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(s)
}

function validate(body: Body): { ok: true; input: ValidatedInput } | { ok: false; error: string } {
  const civility = asString(body.civility)
  if (!civility || !(CIVILITIES as readonly string[]).includes(civility)) {
    return { ok: false, error: 'invalid_civility' }
  }
  const job_title = asString(body.job_title)
  if (!job_title || job_title.length < 2 || job_title.length > 200) {
    return { ok: false, error: 'invalid_job_title' }
  }
  const linkedin_raw = asString(body.linkedin_url)
  let linkedin_url: string | null = null
  if (linkedin_raw) {
    if (!isLinkedinUrl(linkedin_raw)) {
      return { ok: false, error: 'invalid_linkedin' }
    }
    linkedin_url = linkedin_raw
  }
  const siren_raw = asString(body.siren)
  if (!siren_raw) {
    return { ok: false, error: 'invalid_siren' }
  }
  const siren = siren_raw.replace(/\s/g, '')
  if (!/^\d{9}$/.test(siren)) {
    return { ok: false, error: 'invalid_siren' }
  }
  const org_sub_type = asString(body.org_sub_type)
  if (!org_sub_type || !(ORG_SUB_TYPES as readonly string[]).includes(org_sub_type)) {
    return { ok: false, error: 'invalid_org_sub_type' }
  }
  const website_raw = asString(body.website)
  let website_url: string | null = null
  if (website_raw) {
    if (!isUrl(website_raw)) {
      return { ok: false, error: 'invalid_website' }
    }
    website_url = website_raw
  }
  return {
    ok: true,
    input: {
      civility: civility as Civility,
      job_title,
      linkedin_url,
      siren,
      org_sub_type: org_sub_type as OrgSubType,
      website_url,
    },
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  // ── Auth + contexte org ─────────────────────────────────────────────────
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const org = auth.organization
  if (!org) {
    return json({ error: 'No organization', code: 'org_required' }, 403)
  }
  if (org.role_in_org !== 'admin') {
    return json({ error: 'Admin only', code: 'forbidden' }, 403)
  }

  // ── Body parsing + validation ───────────────────────────────────────────
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

  // ── Pré-check : SIREN unicité (sauf si déjà l'org courante) ─────────────
  const { data: existingSiren } = await auth.supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('siren', input.siren)
    .neq('id', org.id)
    .maybeSingle()
  if (existingSiren) {
    return json({ error: 'SIREN already used', code: 'siren_taken' }, 409)
  }

  // ── 1. UPDATE users (civility, job_title, linkedin_url) ─────────────────
  // user_type FIGÉ — voir AGENTS.md / décision B3.4. Le routing dashboard
  // est déterminé à l'inscription et ne change pas en post-login.
  const { error: usersErr } = await auth.supabaseAdmin
    .from('users')
    .update({
      civility: input.civility,
      job_title: input.job_title,
      linkedin_url: input.linkedin_url,
    })
    .eq('id', auth.user.id)
  if (usersErr) {
    console.error('[finalize-org] users update failed', usersErr.message)
    return json({ error: 'Could not update user', code: 'db_error' }, 500)
  }

  // ── 2. Récupérer infos org pour runVerification ─────────────────────────
  const { data: orgRow, error: orgFetchErr } = await auth.supabaseAdmin
    .from('organizations')
    .select('country, company_name, email_domain, vat_number')
    .eq('id', org.id)
    .single()
  if (orgFetchErr || !orgRow) {
    console.error('[finalize-org] organizations fetch failed', orgFetchErr?.message)
    return json({ error: 'Organization not found', code: 'org_not_found' }, 500)
  }

  // ── 3. UPDATE organizations (siren, org_type, website_url, setup_completed_at) ──
  const nowIso = new Date().toISOString()
  const { error: orgUpdErr } = await auth.supabaseAdmin
    .from('organizations')
    .update({
      siren: input.siren,
      org_type: input.org_sub_type, // 'client' | 'esn' | 'cabinet'
      website_url: input.website_url,
      setup_completed_at: nowIso,
    })
    .eq('id', org.id)
  if (orgUpdErr) {
    console.error('[finalize-org] organizations update failed', orgUpdErr.message)
    return json({ error: 'Could not update organization', code: 'db_error' }, 500)
  }

  // ── 4. runVerification SYNCHRONE (V1) ───────────────────────────────────
  // TODO V2 : migrer vers job queue (Vercel Cron / Supabase Edge Functions /
  //           Inngest) pour vraie async sans risque de coupure serverless.
  let verdict
  try {
    verdict = await runVerification({
      supabaseAdmin: auth.supabaseAdmin,
      organization_id: org.id,
      input: {
        country_code: (orgRow.country as string) ?? 'FR',
        company_name: orgRow.company_name as string,
        // `email_domain` est non-null en pratique (rempli à l'inscription
        // par register-org), mais DB-typé nullable. Fallback '' si jamais
        // null pour satisfaire VerificationInput (string non-nullable).
        email_domain: (orgRow.email_domain as string | null) ?? '',
        siren: input.siren,
        vat_number: (orgRow.vat_number as string | null) ?? null,
        // 11G : champs additionnels comparés par l'IA contre les données INSEE.
        website_url: input.website_url,
        org_type: input.org_sub_type,
      },
    })
  } catch (err) {
    console.error('[finalize-org] runVerification threw', err)
    // Non-bloquant : la modale a sauvegardé les données, on retourne quand
    // même 200. La vérif tournera lors d'un futur retry admin / cron.
    verdict = null
  }

  // ── 5. Update verification_status si verdict obtenu ─────────────────────
  if (verdict) {
    const verifUpdates: Record<string, unknown> = {
      verification_status: verdict.verification_status,
      verification_method: verdict.verification_method,
      verification_data: verdict.verification_data,
      // Invariant : is_verified === (verification_status === 'approved').
      // Couvre l'auto-approbation IA (score ≥ threshold → verdict approved
      // → is_verified true sans intervention admin). Sinon reste false.
      is_verified: verdict.verification_status === 'approved',
    }
    if (verdict.verification_status === 'approved') {
      verifUpdates.verified_at = nowIso
    }
    const { error: verifErr } = await auth.supabaseAdmin
      .from('organizations')
      .update(verifUpdates)
      .eq('id', org.id)
    if (verifErr) {
      console.error('[finalize-org] verification update failed', verifErr.message)
      // Non bloquant : organizations.setup_completed_at est déjà posé.
    }
  }

  // ── 6. Audit log + return ───────────────────────────────────────────────
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'org_setup_completed',
    entity_type: 'organization',
    entity_id: org.id,
    detail: {
      org_sub_type: input.org_sub_type,
      siren_provided: true,
      verification_status: verdict?.verification_status ?? 'unknown',
    },
  })

  return json(
    {
      ok: true,
      verification_status: verdict?.verification_status ?? null,
      verification_method: verdict?.verification_method ?? null,
    },
    200,
  )
}
