import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PATCH /api/admin/matching-settings — les deux seuils, et la dépense.
 *
 * ═══ POURQUOI CET ÉCRAN EXISTE ═════════════════════════════════════════════
 *   Le score d'un reranker n'est pas calibré : aucun seuil ne peut être deviné,
 *   et aucun ne peut être traduit depuis l'ancienne échelle de Claude (7/10 ne
 *   vaut PAS 0,7). Il faut LIRE la distribution réelle des runs, puis régler.
 *   Sans écran, ce réglage demanderait un développeur à chaque fois — et il
 *   resterait donc au réglage initial, c'est-à-dire à personne notifié.
 *
 * ═══ CE QUE LA ROUTE REND EN PLUS DES RÉGLAGES ════════════════════════════
 *   La DISTRIBUTION observée (matching_threshold_health) et la DÉPENSE du mois
 *   (ai_spend_status). Un seuil réglé sans voir la distribution est un nombre
 *   choisi au hasard ; un plafond qu'on ne voit pas est un plafond qu'on
 *   découvre atteint.
 *
 * ═══ CE QUE LA ROUTE REFUSE ═══════════════════════════════════════════════
 *   Un seuil de notification SOUS celui du flux. On notifierait alors un expert
 *   pour une annonce qu'il ne verrait pas en se connectant. La base porte la
 *   même contrainte ; on refuse ici pour rendre une raison lisible plutôt qu'une
 *   erreur Postgres.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin

  const [reglagesRes, domainesRes, distributionRes, depenseRes, couvertureRes] = await Promise.all([
    admin
      .from('matching_settings')
      .select('domain_id, feed_threshold, notify_threshold, notify_enabled, rerank_model, rerank_batch_size, updated_at'),
    admin.from('domains').select('id, slug, name'),
    admin.rpc('matching_threshold_health'),
    admin.rpc('ai_spend_status'),
    admin.rpc('matching_coverage_health'),
  ])

  if (reglagesRes.error) {
    console.error('[admin:matching-settings] lecture des réglages en échec', reglagesRes.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const domaines = new Map(
    ((domainesRes.data ?? []) as Array<{ id: string; slug: string; name: string | null }>).map((d) => [
      d.id,
      { slug: d.slug, name: d.name },
    ]),
  )

  return json(
    {
      reglages: ((reglagesRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        domaine: domaines.get(r.domain_id as string) ?? null,
      })),
      // Les trois lectures suivantes sont INFORMATIVES : si l'une échoue,
      // l'écran doit rester utilisable pour régler les seuils. On rend `null`
      // plutôt qu'un tableau vide — vide se lirait « aucune donnée », null se
      // lit « indisponible », et ce n'est pas la même chose.
      distribution: distributionRes.error ? null : (distributionRes.data ?? []),
      depense: depenseRes.error ? null : (depenseRes.data ?? []),
      couverture: couvertureRes.error ? null : (couvertureRes.data ?? []),
    },
    200,
  )
}

type CorpsPatch = {
  domain_id?: unknown
  feed_threshold?: unknown
  notify_threshold?: unknown
  notify_enabled?: unknown
  rerank_batch_size?: unknown
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function nombreDansBornes(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n) || n < min || n > max) return null
  return n
}

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin

  let body: CorpsPatch
  try {
    body = (await request.json()) as CorpsPatch
  } catch {
    return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  }

  const domainId = typeof body.domain_id === 'string' && UUID.test(body.domain_id) ? body.domain_id : null
  if (!domainId) return json({ error: 'Invalid domain', code: 'bad_domain' }, 400)

  // On lit l'existant pour valider l'ORDRE des deux seuils même quand un seul
  // est envoyé. Sans cela, régler le flux seul pourrait le faire passer
  // au-dessus du seuil de notification sans qu'aucune garde ne le voie.
  const { data: actuel, error: lectureErr } = await admin
    .from('matching_settings')
    .select('feed_threshold, notify_threshold')
    .eq('domain_id', domainId)
    .maybeSingle()
  if (lectureErr) {
    console.error('[admin:matching-settings] lecture en échec', lectureErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!actuel) return json({ error: 'Unknown domain', code: 'bad_domain' }, 404)

  const patch: Record<string, unknown> = {}

  if ('feed_threshold' in body) {
    const v = nombreDansBornes(body.feed_threshold, 0, 1)
    if (v == null) return json({ error: 'feed_threshold hors [0,1]', code: 'bad_threshold' }, 400)
    patch.feed_threshold = v
  }
  if ('notify_threshold' in body) {
    const v = nombreDansBornes(body.notify_threshold, 0, 1)
    if (v == null) return json({ error: 'notify_threshold hors [0,1]', code: 'bad_threshold' }, 400)
    patch.notify_threshold = v
  }
  if ('rerank_batch_size' in body) {
    const v = nombreDansBornes(body.rerank_batch_size, 1, 1000)
    if (v == null) return json({ error: 'rerank_batch_size hors [1,1000]', code: 'bad_batch' }, 400)
    patch.rerank_batch_size = Math.round(v)
  }
  if ('notify_enabled' in body) {
    patch.notify_enabled = body.notify_enabled === true
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: 'No editable field', code: 'invalid_json' }, 400)
  }

  const feedFinal = (patch.feed_threshold as number | undefined) ?? Number(actuel.feed_threshold)
  const notifyFinal = (patch.notify_threshold as number | undefined) ?? Number(actuel.notify_threshold)
  if (notifyFinal < feedFinal) {
    return json(
      {
        error: 'Notification threshold below feed threshold',
        code: 'ordre_seuils',
        feed: feedFinal,
        notify: notifyFinal,
      },
      400,
    )
  }

  patch.updated_at = new Date().toISOString()
  patch.updated_by = auth.user.id

  const { error: majErr } = await admin
    .from('matching_settings')
    .update(patch)
    .eq('domain_id', domainId)
  if (majErr) {
    console.error('[admin:matching-settings] écriture en échec', majErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  return json({ ok: true, domain_id: domainId, applique: patch }, 200)
}
