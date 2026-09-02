import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { loadTranslations, tBDD } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import { activePublishedOrClause } from '@/lib/publications/expiry'
import { loadReferentielLabels } from '@/lib/publication-synthesis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/missions/[id] — détail d'une opportunité matchée.
 *
 * Garde : requireAuth → service_role.
 *  1. Charge profile expert (profiles.user_id = auth.uid()).
 *  2. Charge le match (profile_id + publication_id). 404 si absent → l'expert
 *     n'a pas accès à cette publi (frontière curation).
 *  3. Charge la publication + jointures (status='published' enforced).
 *  4. Atomique : si match.status='notified' → flip 'viewed', marque les notifs
 *     liées (type='new_match_opportunity', entity_id=publication.id) en read.
 *  5. Renvoie DTO complet (titre, description, skills…) + masquage org si
 *     confidential.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
}

type PublicationRow = {
  id: string
  type: string
  title: string
  description: string
  branch_id: string | null
  speciality_ids: string[] | null
  work_zone_ids: string[] | null
  skills_required: string[] | null
  seniorities: string[] | null
  work_mode: string | null
  location_note: string | null
  duration: string | null
  start_date: string | null
  budget_min: number | null
  budget_max: number | null
  confidential: boolean
  status: string
  published_at: string | null
  organization_id: string
  branches: { id: string; name: string } | { id: string; name: string }[] | null
  organizations: { id: string; company_name: string | null; logo_url: string | null } | { id: string; company_name: string | null; logo_url: string | null }[] | null
}

function pickRel<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id: publicationId } = await ctx.params
  if (!publicationId || !UUID_REGEX.test(publicationId)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }

  // 1. Profile expert ─────────────────────────────────────────────────────
  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, user_id')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (pErr || !profile) {
    return json({ error: 'Profile not found', code: 'not_found' }, 404)
  }

  // 2. Match (frontière curation) ─────────────────────────────────────────
  const { data: match, error: mErr } = await auth.supabaseAdmin
    .from('matches')
    .select('id, publication_id, score, status, explanation, created_at')
    .eq('publication_id', publicationId)
    .eq('profile_id', profile.id)
    .maybeSingle()
  if (mErr) {
    console.error('[me/missions/[id]:GET] match query failed', mErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!match) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  const matchRow = match as unknown as {
    id: string
    score: number
    status: string
    explanation: { reason?: string; model?: string } | null
    created_at: string
  }

  // 3. Publication + jointures (status='published' enforced) ─────────────
  const locale = normalizeLocale(new URL(request.url).searchParams.get('locale'))
  const [pubResult, translations] = await Promise.all([
    auth.supabaseAdmin
      .from('publications')
      .select(
        // Plus d'embed `specialities(...)` : la clé étrangère est morte avec le
        // passage au multiple. Les libellés sont résolus juste après.
        'id, type, title, description, branch_id, speciality_ids, work_zone_ids, ' +
          'skills_required, seniorities, work_mode, location_note, duration, start_date, ' +
          'budget_min, budget_max, confidential, status, published_at, organization_id, ' +
          'branches(id, name), ' +
          'organizations(id, company_name, logo_url)',
      )
      .eq('id', publicationId)
      .eq('status', 'published')
      // Expiration 30j read-time : le détail d'une mission expirée n'est plus
      // servi côté expert (lib/publications/expiry — source unique).
      .or(activePublishedOrClause())
      .maybeSingle(),
    loadTranslations(locale),
  ])
  if (pubResult.error) {
    console.error('[me/missions/[id]:GET] publication query failed', pubResult.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pubResult.data) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  const pub = pubResult.data as unknown as PublicationRow
  const branch = pickRel(pub.branches)
  const orgRaw = pickRel(pub.organizations)

  // 4. Atomique : match notified → viewed + notif read_at ─────────────────
  //    Idempotent : si déjà 'viewed' ou 'dismissed', on ne touche pas.
  if (matchRow.status === 'notified' || matchRow.status === 'pending') {
    const { error: flipErr } = await auth.supabaseAdmin
      .from('matches')
      .update({ status: 'viewed' })
      .eq('id', matchRow.id)
      .in('status', ['notified', 'pending'])  // anti-race
    if (flipErr) {
      console.error('[me/missions/[id]:GET] match flip failed', flipErr.message)
    }
  }
  // notif read_at : on cible la/les notifs pour ce user + cette publi.
  const nowIso = new Date().toISOString()
  const { error: notifErr } = await auth.supabaseAdmin
    .from('notifications')
    .update({ read_at: nowIso, status: 'read' })
    .eq('user_id', auth.user.id)
    .eq('type', 'new_match_opportunity')
    .eq('entity_id', publicationId)
    .is('read_at', null)
  if (notifErr) {
    console.error('[me/missions/[id]:GET] notif read mark failed', notifErr.message)
  }

  // 5. Check si l'expert a déjà candidaté (pour bouton UI) ────────────────
  const { data: existingCand } = await auth.supabaseAdmin
    .from('candidatures')
    .select('id, status, created_at, cover_message')
    .eq('publication_id', publicationId)
    .eq('profile_id', profile.id)
    .maybeSingle()

  // 6. DTO réponse ────────────────────────────────────────────────────────
  const branchLabel = branch
    ? tBDD(translations, 'branches', branch.id, 'name', branch.name)
    : null
  // Libellés des référentiels multiples — une annonce, deux requêtes au plus.
  const labels = await loadReferentielLabels(
    auth.supabaseAdmin as unknown as Parameters<typeof loadReferentielLabels>[0],
    translations,
    [pub],
  )
  const specialityLabels = (pub.speciality_ids ?? [])
    .map((sid) => labels.specialities?.get(sid))
    .filter((x): x is string => !!x)
  const workZoneLabels = (pub.work_zone_ids ?? [])
    .map((zid) => labels.workZones?.get(zid))
    .filter((x): x is string => !!x)

  return json(
    {
      match: {
        id: matchRow.id,
        status: matchRow.status === 'notified' || matchRow.status === 'pending' ? 'viewed' : matchRow.status,
        ai_score: Number(matchRow.score),
        ai_reason: matchRow.explanation?.reason ?? null,
        matched_at: matchRow.created_at,
      },
      publication: {
        id: pub.id,
        type: pub.type,
        title: pub.title,
        description: pub.description,
        branch_label: branchLabel,
        speciality_labels: specialityLabels,
        skills_required: pub.skills_required ?? [],
        seniorities: pub.seniorities ?? [],
        work_mode: pub.work_mode,
        // Ce sont les ZONES qui décident où l'annonce cherche ; la note de
        // localisation n'est qu'une précision d'affichage.
        work_zone_labels: workZoneLabels,
        location_note: pub.location_note,
        duration: pub.duration,
        start_date: pub.start_date,
        budget_min: pub.budget_min,
        budget_max: pub.budget_max,
        confidential: pub.confidential,
        published_at: pub.published_at,
      },
      org: pub.confidential
        ? null
        : orgRaw
          ? { name: orgRaw.company_name ?? null, logo_url: orgRaw.logo_url ?? null }
          : null,
      candidature: existingCand
        ? {
            id: (existingCand as { id: string }).id,
            status: (existingCand as { status: string }).status,
            created_at: (existingCand as { created_at: string }).created_at,
            cover_message: (existingCand as { cover_message: string | null }).cover_message,
          }
        : null,
    },
    200,
  )
}
