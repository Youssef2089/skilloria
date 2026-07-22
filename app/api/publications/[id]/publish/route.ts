import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { runPublicationVerification } from '@/lib/verification/publication-verification'
import type {
  PublicationLocale,
  PublicationQualityInput,
} from '@/lib/verification/ai-publication-quality'
import { runMatching } from '@/lib/matching'
import { getOrgEntitlements, consumeQuota, monthlyPeriodStart } from '@/lib/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Vercel function timeout : la séquence verif IA publication (~20s) + matching
// IA (~15s) tourne synchrone dans cette route. 60s = max Hobby ; Pro/Enterprise
// peuvent monter plus haut (cf. https://vercel.com/docs/functions/runtimes#max-duration).
export const maxDuration = 60

/**
 * POST /api/publications/[id]/publish — LE GATE IA.
 *
 * Garde : appartenance org active (RLS publications_member_write joue en
 * défense en profondeur). Status courant doit être 'draft' UNIQUEMENT.
 *
 * ⚠️ Anti re-roll IA : on REFUSE de re-publier depuis 'pending_review'.
 * Sinon, sur le même contenu, l'IA pourrait par chance ne PAS reflagger
 * (contact_info / discriminatory / illegal) → publication contournant la
 * revue admin. Le seul chemin de sortie de 'pending_review' = décision
 * admin (lot ultérieur) OU futur flux 'revise' qui repasse par draft +
 * édition + re-gate sur contenu modifié.
 *
 * Transition status='published' UNIQUEMENT côté serveur (la RLS l'interdit
 * au client via le status guard de 20260602130000). Verdict IA stocké
 * directement sur la ligne publications (verification_score / method / data).
 *
 * Pas d'écriture dans verification_attempts (consigne Lot 1a).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const PUBLISHABLE_FROM = ['draft'] as const
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const VALID_LOCALES: readonly PublicationLocale[] = ['fr', 'en', 'es', 'de']

function localeFromRequest(request: NextRequest): PublicationLocale {
  // 1) Header explicite x-locale (posé par secure-fetch côté client si on
  //    veut forcer la langue de scoring IA). Sinon Accept-Language.
  const explicit = request.headers.get('x-locale')?.trim().toLowerCase()
  if (explicit && (VALID_LOCALES as readonly string[]).includes(explicit)) {
    return explicit as PublicationLocale
  }
  const accept = request.headers.get('accept-language') ?? ''
  const first = accept.split(',')[0]?.trim().toLowerCase().slice(0, 2)
  if (first && (VALID_LOCALES as readonly string[]).includes(first)) {
    return first as PublicationLocale
  }
  return 'fr'
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  // ── Auth + appartenance org active ──────────────────────────────────────
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const orgId = auth.organization?.id
  if (!orgId) {
    return json({ error: 'No organization', code: 'org_required' }, 403)
  }

  // ── Id de route ─────────────────────────────────────────────────────────
  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }

  // ── Pré-check ownership + status publishable ────────────────────────────
  const { data: pub, error: fetchErr } = await auth.supabaseAdmin
    .from('publications')
    .select(
      'id, organization_id, status, type, title, description, skills_required, seniority, work_mode, location, duration, budget_min, budget_max',
    )
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) {
    console.error('[publications:publish] fetch failed', fetchErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pub) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  if ((pub.organization_id as string) !== orgId) {
    return json({ error: 'Forbidden', code: 'forbidden' }, 403)
  }
  const currentStatus = pub.status as string
  if (!(PUBLISHABLE_FROM as readonly string[]).includes(currentStatus)) {
    return json(
      { error: 'Cannot publish', code: 'wrong_status', current_status: currentStatus },
      409,
    )
  }

  // ── GATE COMMERCE (Lot 2) : plafond de publications actives + quota mensuel ─
  //  Placée AVANT la vérif IA (coûteuse) : on refuse tôt. Ordre des gardes :
  //  1) plafond d'actives (SANS consommation) ; 2) compteur mensuel (consomme).
  //  On ne consomme JAMAIS le compteur mensuel si on refuse sur le plafond actif.
  //  getOrgEntitlements/consumeQuota sont fail-open (une panne moteur ne bloque pas).
  const ents = await getOrgEntitlements(auth.supabaseAdmin, orgId, auth.domain.id)

  if (ents.limits.activePublicationsMax !== null) {
    const { count: activeCount, error: countErr } = await auth.supabaseAdmin
      .from('publications')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'published')
    if (countErr) {
      // Fail-open : on ne bloque pas sur une erreur de comptage.
      console.warn('[publications:publish] active count error — fail-open', countErr.message)
    } else if ((activeCount ?? 0) + 1 > ents.limits.activePublicationsMax) {
      return json(
        { error: 'Active publications limit reached', code: 'active_publications_limit_reached' },
        402,
      )
    }
  }

  if (ents.limits.publicationsPerMonth !== null) {
    const allowed = await consumeQuota(
      auth.supabaseAdmin,
      orgId,
      'publications',
      ents.limits.publicationsPerMonth,
      monthlyPeriodStart(),
    )
    if (!allowed) {
      return json({ error: 'Monthly publications quota reached', code: 'quota_publications_reached' }, 402)
    }
  }

  // ── Build input IA depuis la ligne ──────────────────────────────────────
  const aiInput: PublicationQualityInput = {
    type: pub.type as 'mission' | 'offre',
    title: pub.title as string,
    description: pub.description as string,
    skills_required: (pub.skills_required as string[] | null) ?? [],
    seniority: (pub.seniority as string | null) ?? null,
    work_mode: (pub.work_mode as string | null) ?? null,
    location: (pub.location as string | null) ?? null,
    duration: (pub.duration as string | null) ?? null,
    budget_min: (pub.budget_min as number | null) ?? null,
    budget_max: (pub.budget_max as number | null) ?? null,
    locale: localeFromRequest(request),
  }

  // ── Gate IA ─────────────────────────────────────────────────────────────
  let verdict
  try {
    verdict = await runPublicationVerification({
      supabaseAdmin: auth.supabaseAdmin,
      publication_id: id,
      input: aiInput,
    })
  } catch (err) {
    console.error('[publications:publish] verification threw', err)
    return json({ error: 'Verification failed', code: 'verification_failed' }, 500)
  }

  // ── UPDATE atomique : status + verification_* (+ published_at si OK) ────
  const nowIso = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status: verdict.status,
    verification_score: verdict.score,
    verification_method: verdict.method,
    verification_data: verdict.data,
  }
  if (verdict.status === 'published') {
    updates.published_at = nowIso
    updates.expires_at = null
  }

  const { error: updateErr } = await auth.supabaseAdmin
    .from('publications')
    .update(updates)
    .eq('id', id)

  if (updateErr) {
    console.error('[publications:publish] update failed', updateErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  // ── Matching IA — synchrone, isolé, FAIL-SAFE ──────────────────────────
  // Lance le moteur de matching profils ↔ publication APRÈS que la publi est
  // effectivement passée en 'published'. Un échec ici n'impacte JAMAIS la
  // publication (la ligne reste publiée, matching re-jouable via un futur
  // endpoint admin appelant runMatching directement).
  if (verdict.status === 'published') {
    try {
      const matchingVerdict = await runMatching({
        supabaseAdmin: auth.supabaseAdmin,
        publicationId: id,
        locale: aiInput.locale,
      })
      console.log('[publications:publish] matching done', {
        publicationId: id,
        status: matchingVerdict.status,
        proposalsCount: matchingVerdict.proposals.length,
        model: matchingVerdict.model,
      })
    } catch (err) {
      // Best-effort : tout échec matching est non-bloquant.
      console.error('[publications:publish] matching threw (non-blocking)', err)
    }
  }

  // ── Audit ──────────────────────────────────────────────────────────────
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action:
      verdict.status === 'published'
        ? 'publication_published'
        : 'publication_submitted_review',
    entity_type: 'publication',
    entity_id: id,
    detail: {
      score: verdict.score,
      flags: verdict.data.flags,
      method: verdict.method,
    },
  })

  return json({ status: verdict.status, score: verdict.score }, 200)
}
