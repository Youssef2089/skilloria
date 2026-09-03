import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { getOrgEntitlements, monthlyPeriodStart } from '@/lib/entitlements'
import { activePublishedOrClause } from '@/lib/publications/expiry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/org-usage?organization_id=uuid
 *
 * Lecture seule : package effectif d'une org + conso du mois courant
 * (usage_peek publications / manual_unlocks) pour la section « Package » de la
 * fiche org admin.
 *
 * `usage.active_published` — annonces ACTIVES à l'instant T, comptées À LA
 * LECTURE via activePublishedOrClause (règle 30 j, aucun batch, aucun cron).
 * Ce n'est PAS un compteur usage_counters : le plafond d'actives n'est pas
 * consommable, il se recalcule (une annonce expirée ou clôturée libère son
 * slot). Même définition exacte que le gate publish et que
 * /api/me/collaboration/quota — un seul comptage, trois lecteurs.
 *
 * Domaine ciblé = organization_domains ACTIVE unique (même règle que
 * assign-org-package) : 0 → available:false 'no_active_domain' ; >1 →
 * available:false 'multiple_active_domains'. Garde admin per-route. service_role.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

async function peek(
  admin: Awaited<ReturnType<typeof requireAdmin>>['supabaseAdmin'],
  orgId: string,
  key: string,
  period: string,
): Promise<number> {
  const { data, error } = await admin.rpc('usage_peek', {
    p_org: orgId,
    p_key: key,
    p_period: period,
  })
  if (error) {
    console.warn('[admin:org-usage] usage_peek error', key, error.message)
    return 0
  }
  return typeof data === 'number' ? data : 0
}

/**
 * Annonces ACTIVES de l'org à l'instant T : published NON expirées (règle 30 j
 * calculée à la lecture). Miroir strict du gate publish. Fail-open à 0 : une
 * erreur de comptage n'a pas à casser la fiche.
 */
async function countActivePublished(
  admin: Awaited<ReturnType<typeof requireAdmin>>['supabaseAdmin'],
  orgId: string,
): Promise<number> {
  const { count, error } = await admin
    .from('publications')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'published')
    .or(activePublishedOrClause())
  if (error) {
    console.warn('[admin:org-usage] active publications count error', error.message)
    return 0
  }
  return count ?? 0
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const url = new URL(request.url)
  const organizationId = (url.searchParams.get('organization_id') ?? '').trim()
  if (!organizationId || !UUID_REGEX.test(organizationId)) {
    return json({ error: 'Invalid organization_id', code: 'invalid_id' }, 400)
  }

  // ── Abonnement de l'organisation ────────────────────────────────────────────
  //  L'ABONNEMENT VIT SUR L'ORGANISATION, plus sur le couple (org, écosystème).
  //  Une organisation accède à TOUS les écosystèmes actifs : le porter sur la
  //  ligne de rattachement produisait un défaut d'argent SILENCIEUX — partout
  //  ailleurs que sur l'écosystème d'inscription, aucune ligne, donc repli sur
  //  l'offre gratuite alors que l'organisation paie.
  //  Cf. supabase/migrations/20260903000000_abonnement_sur_organisation.sql.
  //
  //  Le préambule « domaine actif unique » a disparu avec ses deux réponses
  //  `available: false` (`no_active_domain`, `multiple_active_domains`) : elles
  //  masquaient TOUT l'écran de pilotage — offre, limites et compteurs — au nom
  //  d'un rattachement qui ne porte plus rien.
  const { data: target, error: subErr } = await auth.supabaseAdmin
    .from('organizations')
    .select('package_id, package_started_at, package_valid_until')
    .eq('id', organizationId)
    .maybeSingle()
  if (subErr || !target) {
    console.error('[admin:org-usage] organization lookup failed', subErr?.message ?? 'not found')
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  // ── Package effectif (fail-open) + compteurs du mois ────────────────────────
  const ents = await getOrgEntitlements(auth.supabaseAdmin, organizationId)
  const period = monthlyPeriodStart().toISOString().slice(0, 10)

  const [publicationsUsed, manualUnlocksUsed, activePublished] = await Promise.all([
    peek(auth.supabaseAdmin, organizationId, 'publications', period),
    peek(auth.supabaseAdmin, organizationId, 'manual_unlocks', period),
    countActivePublished(auth.supabaseAdmin, organizationId),
  ])

  return json(
    {
      available: true,
      assignment: {
        package_id: target.package_id,
        package_started_at: target.package_started_at,
        package_valid_until: target.package_valid_until,
      },
      package_slug: ents.packageSlug,
      limits: {
        publicationsPerMonth: ents.limits.publicationsPerMonth,
        activePublicationsMax: ents.limits.activePublicationsMax,
        revealedCandidatesPerPublication: ents.limits.revealedCandidatesPerPublication,
        manualUnlocksPerMonth: ents.limits.manualUnlocksPerMonth,
      },
      usage: {
        publications: publicationsUsed,
        manual_unlocks: manualUnlocksUsed,
        active_published: activePublished,
      },
      period_start: period,
    },
    200,
  )
}
