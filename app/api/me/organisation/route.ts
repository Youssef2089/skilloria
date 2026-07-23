import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/me/organisation — édition des informations de l'organisation
 * par un ADMIN de cette organisation (Lot A entreprise, page « Mon entreprise »).
 *
 * ┌─ POURQUOI UNE ROUTE SERVEUR ALORS QUE LA RLS AUTORISE DÉJÀ L'UPDATE ? ──┐
 * │ La policy `organizations_admin_update` laisserait passer un UPDATE      │
 * │ client-direct par un admin actif. On garde malgré tout la garde serveur │
 * │ pour deux raisons NON couvertes par la RLS :                            │
 * │  1. AUDIT : logAudit('organization_updated') tracé côté serveur.        │
 * │  2. COHÉRENCE : la whitelist ci-dessous empêche la modification des     │
 * │     champs qui ENGAGENT LA VÉRIFICATION LÉGALE (siren, vat_number,      │
 * │     org_type, email_domain, tout le bloc verification_*). La RLS, elle, │
 * │     autorise l'UPDATE de N'IMPORTE QUELLE colonne de la ligne.          │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * La LECTURE reste client-direct (policy `organizations_member_read` couvre
 * tous les membres actifs) — voir la page organisation.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Whitelist STRICTE des champs éditables. Toute clé absente d'ici est ignorée
 * silencieusement (on n'échoue pas la requête : le client n'envoie que le
 * formulaire, une clé inconnue est un bug client, pas une attaque à signaler).
 *
 * NON éditables volontairement : siren, vat_number, org_type, email_domain,
 * is_verified, verification_status / _method / _data / _notes, verified_at,
 * verified_by, review_reason, setup_completed_at.
 */
const EDITABLE_FIELDS = [
  'company_name',
  'sector',
  'size',
  'description',
  'website_url',
  'logo_url',
] as const
type EditableField = (typeof EDITABLE_FIELDS)[number]

/** Longueurs max alignées sur la baseline (varchar) — description est en text. */
const MAX_LEN: Record<EditableField, number | null> = {
  company_name: 200,
  sector: 100,
  size: 20,
  description: null,
  website_url: 500,
  logo_url: 500,
}

/** CHECK organizations_size_check de la baseline. */
const VALID_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'] as const

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // ── Garde ADMIN ACTIF ───────────────────────────────────────────────────────
  // `requireAuth` résout déjà l'organisation via organization_members filtré sur
  // status='active' (cf. loadOrganizationContext) : `role_in_org === 'admin'`
  // équivaut donc exactement au prédicat SQL is_active_admin_of_org(org).
  const org = auth.organization
  if (!org) {
    return json({ error: 'No organization', code: 'no_organization' }, 403)
  }
  if (org.role_in_org !== 'admin') {
    return json({ error: 'Admin role required', code: 'not_org_admin' }, 403)
  }

  // ── Corps ───────────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_body' }, 400)
  }

  const patch: Record<string, string | null> = {}
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue
    const raw = body[field]
    if (raw !== null && typeof raw !== 'string') {
      return json({ error: `Field '${field}' must be a string or null`, code: 'invalid_field' }, 400)
    }
    const trimmed = raw === null ? null : raw.trim()
    // Chaîne vide → NULL (colonnes nullable), sauf company_name qui est NOT NULL.
    const value = trimmed === '' ? null : trimmed

    const max = MAX_LEN[field]
    if (value !== null && max !== null && value.length > max) {
      return json({ error: `Field '${field}' too long`, code: 'field_too_long' }, 400)
    }
    patch[field] = value
  }

  // company_name est NOT NULL en base : on refuse explicitement de la vider.
  if ('company_name' in patch && !patch.company_name) {
    return json({ error: 'Company name is required', code: 'company_name_required' }, 400)
  }
  // size doit respecter le CHECK de la baseline (sinon 23514 illisible côté UI).
  if (patch.size != null && !(VALID_SIZES as readonly string[]).includes(patch.size)) {
    return json({ error: 'Invalid size', code: 'invalid_size' }, 400)
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: 'No editable field provided', code: 'nothing_to_update' }, 400)
  }

  // ── Écriture (service-role, org déjà résolue et vérifiée admin) ─────────────
  const { data: updated, error } = await auth.supabaseAdmin
    .from('organizations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', org.id)
    .select(
      'id, company_name, org_type, siren, vat_number, sector, country, size, description, logo_url, website_url, email_domain, is_verified, verification_status, review_reason',
    )
    .maybeSingle()

  if (error) {
    console.error('[me/organisation] update failed', { orgId: org.id, msg: error.message })
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  if (!updated) {
    return json({ error: 'Organization not found', code: 'not_found' }, 404)
  }

  // Audit best-effort : on trace les CHAMPS touchés, pas leurs valeurs.
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'organization_updated',
    entity_type: 'organizations',
    entity_id: org.id,
    detail: { fields: Object.keys(patch) },
  })

  return json({ organization: updated }, 200)
}
