import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { signOrgLogoUrl } from '@/lib/org-logo'
import type { MotifRevue } from '@/lib/verification/types'

/**
 * `verification_data` est du JSON libre en base : une ligne écrite par une
 * version antérieure peut porter n'importe quoi. On ne rend donc un motif
 * que s'il a la FORME attendue — un code connu et un détail textuel. Un code
 * inconnu ne serait pas traduisible par l'écran : on le laisse tomber plutôt
 * que d'afficher une étiquette vide.
 */
const CODES_MOTIF: readonly MotifRevue['code'][] = ['pays_sans_decideur', 'plafond_depense_ia']

function motifRevueValide(brut: unknown): MotifRevue | null {
  if (!brut || typeof brut !== 'object') return null
  const { code, detail } = brut as { code?: unknown; detail?: unknown }
  if (typeof code !== 'string' || !(CODES_MOTIF as readonly string[]).includes(code)) return null
  return { code: code as MotifRevue['code'], detail: typeof detail === 'string' ? detail : '' }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/get-org/[id]
 *
 * Détail complet d'une organisation pour la fiche admin (B5).
 *
 * Retourne :
 *   - org : champs organizations + review_reason
 *   - contact : nom/poste/email/linkedin du membre admin le plus ancien
 *     (role_in_org='admin', status='active', ORDER BY joined_at ASC LIMIT 1)
 *   - verification : extrait de verification_data (méthode, score, notes,
 *     motif_revue, had_rejection, rejected_by, last_provider)
 *
 * Garde admin via requireAdmin. service_role.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id } = await ctx.params
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  // ── Org row ─────────────────────────────────────────────────────────────
  const { data: org, error: orgErr } = await auth.supabaseAdmin
    .from('organizations')
    .select(
      'id, company_name, logo_url, siren, vat_number, org_type, country, email_domain, website_url, verification_status, verification_method, verification_data, verified_at, verified_by, review_reason, created_at',
    )
    .eq('id', id)
    .maybeSingle()

  if (orgErr) {
    console.error('[admin:get-org] org lookup failed', orgErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!org) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── Écosystème de l'org (D1 — admin plateforme multi-écosystème) ────────
  //  Via organization_domains → domains, SANS filtre domaine (vrai écosystème
  //  de l'org, indépendant du domaine de l'admin).
  let ecosystem: string | null = null
  const { data: domLink } = await auth.supabaseAdmin
    .from('organization_domains')
    .select('domains(name)')
    .eq('organization_id', id)
    .limit(1)
    .maybeSingle()
  if (domLink) {
    const dom = Array.isArray(domLink.domains) ? domLink.domains[0] : domLink.domains
    ecosystem = ((dom as { name?: string | null } | null)?.name ?? '').trim() || null
  }

  // ── Contact = membre admin le plus ancien ──────────────────────────────
  const { data: memberRow, error: memberErr } = await auth.supabaseAdmin
    .from('organization_members')
    .select('user_id, joined_at, users!organization_members_user_id_fkey(id, first_name, last_name, email, job_title, linkedin_url, civility, locale)')
    .eq('organization_id', id)
    .eq('role_in_org', 'admin')
    .eq('status', 'active')
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (memberErr) {
    console.error('[admin:get-org] member lookup failed', memberErr.message)
  }

  const userRow = memberRow?.users
    ? Array.isArray(memberRow.users)
      ? memberRow.users[0]
      : memberRow.users
    : null

  const contact = userRow
    ? {
        id: (userRow as { id: string }).id,
        first_name: (userRow as { first_name: string | null }).first_name ?? null,
        last_name: (userRow as { last_name: string | null }).last_name ?? null,
        email: (userRow as { email: string }).email,
        job_title: (userRow as { job_title: string | null }).job_title ?? null,
        linkedin_url: (userRow as { linkedin_url: string | null }).linkedin_url ?? null,
        civility: (userRow as { civility: string | null }).civility ?? null,
        locale: (userRow as { locale: string | null }).locale ?? null,
      }
    : null

  // ── Extraction verification_data ────────────────────────────────────────
  const vd =
    (org.verification_data as
      | {
          score?: number | null
          notes?: string
          motif_revue?: MotifRevue | null
          last_provider?: string
          attempts_count?: number
          had_rejection?: boolean
          rejected_by?: string[]
          discrepancies?: string[]
          sirene_data?: Record<string, unknown> | null
          sirene_status?: 'ok' | 'not_found' | 'error' | 'skipped' | null
          sirene_error_note?: string | null
        }
      | null) ?? null

  const verification = {
    method: org.verification_method as string | null,
    status: org.verification_status as string | null,
    score: typeof vd?.score === 'number' ? vd.score : null,
    notes: vd?.notes ?? null,
    // MOTIF INTERNE de mise en revue — exposé À L'ADMIN SEUL. Il dit pourquoi
    // le dossier est ici : un pays sans décideur configuré et un faux négatif
    // de registre se ressemblaient sur cette fiche, alors qu'ils ne
    // s'instruisent pas de la même façon. Le message rendu à l'organisation,
    // lui, ne change pas et reste neutre.
    motif_revue: motifRevueValide(vd?.motif_revue),
    last_provider: vd?.last_provider ?? null,
    attempts_count: vd?.attempts_count ?? null,
    had_rejection: vd?.had_rejection ?? false,
    rejected_by: vd?.rejected_by ?? [],
    // 11G : écarts détectés par l'IA entre données saisies et INSEE,
    // affichés dans la fiche admin (organisations/[id]/page.tsx).
    discrepancies: Array.isArray(vd?.discrepancies) ? vd.discrepancies : [],
    // 11G : snapshot INSEE comparé (disponible pour usage admin futur,
    // non rendu en V1 — seuls les écarts sont mis en avant côté UI).
    sirene_data: vd?.sirene_data ?? null,
    // Fix Sirene (D4) — état du provider Sirene, exposé pour affichage
    // d'un bandeau "Sirene indisponible" dans la fiche admin si error.
    sirene_status: vd?.sirene_status ?? null,
    sirene_error_note: vd?.sirene_error_note ?? null,
  }

  // Logo : URL SIGNÉE, jamais la valeur de la colonne.
  //
  // Même raison qu'en liste, en plus resserré : cet écran est celui où un
  // administrateur plateforme EXAMINE une organisation. Servir l'adresse
  // qu'elle a saisie ferait appeler, depuis son navigateur, un serveur choisi
  // par la partie examinée. La colonne est un DRAPEAU (migration
  // 20260916300000) ; le chemin est DÉRIVÉ de l'identifiant.
  const logoSigne = await signOrgLogoUrl(
    auth.supabaseAdmin,
    (org as { id: string }).id,
    (org as { logo_url: string | null }).logo_url,
  )

  // L'ordre des clés compte : `...org` d'abord, l'URL signée ensuite.
  return json(
    { org: { ...org, logo_url: logoSigne, ecosystem }, contact, verification },
    200,
  )
}
