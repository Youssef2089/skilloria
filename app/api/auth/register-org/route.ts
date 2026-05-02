import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { logSession } from '@/lib/session-log'
import { runVerification } from '@/lib/verification'

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
  domain_slug?: unknown
  org_type?: unknown
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
  phone: string | null
  domain_slug: string
  org_type: OrgType
  email_domain: string
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
  const phone = asString(body.phone)
  if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
    return { ok: false, error: 'invalid_phone' }
  }
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
      domain_slug,
      org_type: org_type_raw as OrgType,
      email_domain,
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

  let supabaseAdmin: SupabaseClient
  try {
    supabaseAdmin = getSupabaseAdmin()
  } catch {
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
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

  const { data: existingDomain } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .ilike('email_domain', input.email_domain)
    .maybeSingle()
  if (existingDomain) {
    return json({ error: 'Email domain already used', code: 'email_domain_taken' }, 409)
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
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      firstname: input.first_name,
      lastname: input.last_name,
      role: metadataRoleFromOrgType(input.org_type),
      domain_slug: input.domain_slug,
    },
  })
  if (createErr || !created?.user) {
    console.error('[register-org] createUser failed', createErr?.message)
    return json(
      {
        error: createErr?.message ?? 'Could not create user',
        code: 'create_user_failed',
      },
      500,
    )
  }
  const user_id = created.user.id

  // ── 2. Création organizations ───────────────────────────────────────────
  // Note : les colonnes legacy `user_id` et `domain_id` ont été droppées
  // par la migration B6_MIGRATION_2 (20260502_archi_orga_b6_migration_2_drop_legacy.sql).
  // La liaison user↔org passe par `organization_members`, et la liaison
  // org↔domain par `organization_domains` (inserts plus bas).
  const { data: orgRow, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .insert({
      org_type: input.org_type,
      company_name: input.company_name,
      country: input.country_code,
      siren: input.siren,
      vat_number: input.vat_number,
      email_domain: input.email_domain,
      verification_status: 'pending_provider_check',
    })
    .select('id')
    .single()
  if (orgErr || !orgRow) {
    console.error('[register-org] organizations insert failed', orgErr?.message)
    // Cleanup : on supprime le user créé pour éviter un état incohérent
    await supabaseAdmin.auth.admin.deleteUser(user_id)
    return json({ error: 'Could not create organization', code: 'org_insert_failed' }, 500)
  }
  const organization_id = orgRow.id as string

  // ── 3. organization_members (admin du nouvel org) ───────────────────────
  const { error: memberErr } = await supabaseAdmin.from('organization_members').insert({
    user_id,
    organization_id,
    role_in_org: 'admin',
    status: 'active',
    invited_by: null,
  })
  if (memberErr) {
    console.error('[register-org] organization_members insert failed', memberErr.message)
    return json({ error: 'Could not link member', code: 'member_insert_failed' }, 500)
  }

  // ── 4. organization_domains (1 seul domaine V1, package_id=null) ────────
  const { error: orgDomErr } = await supabaseAdmin.from('organization_domains').insert({
    organization_id,
    domain_id: domainRow.id,
    active: true,
    package_id: null,
  })
  if (orgDomErr) {
    console.error('[register-org] organization_domains insert failed', orgDomErr.message)
    return json({ error: 'Could not link domain', code: 'org_domain_insert_failed' }, 500)
  }

  // ── 5. Vérification entreprise ──────────────────────────────────────────
  const verdict = await runVerification({
    supabaseAdmin,
    organization_id,
    input: {
      country_code: input.country_code,
      company_name: input.company_name,
      email_domain: input.email_domain,
      siren: input.siren,
      vat_number: input.vat_number,
    },
  })

  const updates: Record<string, unknown> = {
    verification_status: verdict.verification_status,
    verification_method: verdict.verification_method,
    verification_data: verdict.verification_data,
  }
  if (verdict.verification_status === 'approved') {
    updates.verified_at = new Date().toISOString()
    // verified_by laissé à null = approval automatique (Q-B2.c.6)
  }
  const { error: updErr } = await supabaseAdmin
    .from('organizations')
    .update(updates)
    .eq('id', organization_id)
  if (updErr) {
    console.error('[register-org] organizations update post-verify failed', updErr.message)
    // Non bloquant : la ligne org existe avec status initial
  }

  // ── 6. Side effects best-effort ─────────────────────────────────────────
  await logAudit({
    supabaseAdmin,
    user_id,
    domain_id: domainRow.id,
    action: 'org_register',
    entity_type: 'organization',
    entity_id: organization_id,
    detail: {
      method: verdict.verification_method,
      status: verdict.verification_status,
      score: verdict.verification_data.score,
      attempts_count: verdict.verification_data.attempts_count,
    },
  })
  await logSession({ supabaseAdmin, user_id, request })

  return json(
    {
      user_id,
      organization_id,
      verification_status: verdict.verification_status,
      verification_method: verdict.verification_method,
    },
    200,
  )
}
