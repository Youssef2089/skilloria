import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { loadTranslations, tBDD } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import { activePublishedOrClause } from '@/lib/publications/expiry'
import { loadReferentielLabels } from '@/lib/publication-synthesis'
import { chargerDurees, DUREES_ILLISIBLES_CODE } from '@/lib/durees'
import { signOrgLogoUrl } from '@/lib/org-logo'
// LA RÈGLE D'ÉLIGIBILITÉ, ÉCRITE UNE FOIS (§D.20) — l'écran la REND, il ne la
// calcule pas (§E.15).
import {
  COLONNES_COMPTE,
  COLONNES_PROFIL,
  jugerEligibilite,
  type PublicExpert,
} from '@/lib/matching/eligibilite'

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

  // ── LES DURÉES SONT LUES ICI, PAR LA ROUTE ───────────────────────────────
  //  Aucun défaut dans le code (cf. lib/durees.ts) : illisibles, on REFUSE en
  //  le nommant plutôt que de servir une durée inventée. Même parti pris que
  //  `matching_settings` — un repli codé en dur devient une seconde source de
  //  vérité, et elle prend la main le jour où l'on comprend le moins.
  const lectureDurees = await chargerDurees(auth.supabaseAdmin)
  if (!lectureDurees.ok) {
    console.error('[me/missions/[id]:GET] durées de la place illisibles', lectureDurees.raison)
    return json({ error: 'Durations unavailable', code: DUREES_ILLISIBLES_CODE }, 503)
  }
  const durees = lectureDurees.durees

  const { id: publicationId } = await ctx.params
  if (!publicationId || !UUID_REGEX.test(publicationId)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }

  // 1. Profile expert ─────────────────────────────────────────────────────
  // ⚠️ ON CHARGE DE QUOI JUGER L'APTITUDE, ET LES COLONNES SONT DÉRIVÉES.
  //    Depuis §D.21, « occupé » ferme aussi le dépôt : l'écran doit pouvoir
  //    fermer le bouton AVANT le clic, avec sa raison. La réponse existe en une
  //    lecture de ligne — la faire attendre un refus serveur serait §D.13 ①.
  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select(
      `id, user_id, ${COLONNES_PROFIL.join(', ')}, ` +
        `users!profiles_user_id_fkey!inner(user_type, ${COLONNES_COMPTE.join(', ')})`,
    )
    .eq('user_id', auth.user.id)
    .maybeSingle()
  // Une lecture de `profiles` en panne n'est pas un profil absent (§E.42) :
  // 503 qui se reessaie, jamais le 404 qui se croit. L'absence reelle garde son code.
  if (pErr) {
    console.error('[me/missions] profil ILLISIBLE', { userId: auth.user.id, message: pErr.message })
    return json(
      { error: 'Could not read the profile', code: 'profil_verification_indisponible' },
      503,
    )
  }
  if (!profile) {
    return json({ error: 'Profile not found', code: 'not_found' }, 404)
  }
  // L'APTITUDE À POSTULER — jugée ICI, par la règle partagée, et servie telle
  // quelle à l'écran (§D.20, §D.21).
  // Le client Supabase n est pas type (§E.1) : un embed construit par gabarit
  //  ne se laisse pas inferer. Le cast est explicite, et il est LE seul.
  const profilJugeable = profile as unknown as Record<string, unknown> & {
    id: string
    users: { user_type: string | null } | Array<{ user_type: string | null }> | null
  }
  const kindExpert: PublicExpert =
    (Array.isArray(profilJugeable.users) ? profilJugeable.users[0] : profilJugeable.users)
      ?.user_type === 'expert_cdi'
      ? 'expert_cdi'
      : 'expert_freelance'
  const verdictAptitude = jugerEligibilite(profilJugeable, kindExpert)
  const aptitude = verdictAptitude.ok
    ? { peut_postuler: true as const, raison: null }
    : { peut_postuler: false as const, raison: verdictAptitude.raison }

  // 2. Match (frontière curation) ─────────────────────────────────────────
  const { data: match, error: mErr } = await auth.supabaseAdmin
    .from('matches')
    // ⚠️ `relevance_tier`, ET SURTOUT PAS `score`. La colonne `score` a été
    //    SUPPRIMÉE le 01/09/2026 (migration `score_de_pertinence`) : la base
    //    répondait « column matches.score does not exist », la route rendait
    //    500, AUCUNE mission ne s'ouvrait — et comme le bouton « Postuler » ne
    //    vit que sur cet écran, personne ne pouvait postuler. Trois semaines,
    //    sans qu'aucun contrôle ne le dise (§E.61).
    //
    //    `relevance_score` n'est PAS sélectionné, et c'est délibéré : ce qui
    //    sort vers l'expert est le PALIER, jamais le nombre (§D.6). Cette route
    //    ne trie rien — elle n'a donc aucune raison de lire la note.
    .select('id, publication_id, relevance_tier, status, explanation, created_at')
    .eq('publication_id', publicationId)
    .eq('profile_id', profilJugeable.id)
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
    // Le type ne promet QUE ce que le select charge : annoncer un
    // `relevance_score` qu'on ne lit pas invite à s'en servir un jour.
    relevance_tier: string | null
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
      // Expiration read-time : le détail d'une mission expirée n'est plus
      // servi côté expert (lib/publications/expiry — source unique).
      .or(activePublishedOrClause({ vieAnnonceJours: durees.vieAnnonceJours }))
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
  const { data: existingCand, error: existingCandErr } = await auth.supabaseAdmin
    .from('candidatures')
    .select('id, status, created_at, cover_message')
    .eq('publication_id', publicationId)
    .eq('profile_id', profilJugeable.id)
    .maybeSingle()
  // ⚠️ `null` FAIT RÉAPPARAÎTRE LE BOUTON « CANDIDATER » à un expert qui a
  //    déjà candidaté. L’écran ment, la garde tient : le dépôt sera refusé
  //    côté serveur. Le coût est une promesse non tenue, pas une double
  //    candidature — on journalise, on ne refuse pas l’affichage de
  //    l’annonce pour autant.
  if (existingCandErr) {
    console.error('[me/missions] candidature existante ILLISIBLE — le bouton peut réapparaître à tort', {
      publicationId,
      profileId: profilJugeable.id,
      message: existingCandErr.message,
    })
  }

  // Logo de l'organisation : URL SIGNÉE, jamais la valeur de la colonne.
  //
  // `organizations.logo_url` n'est plus une adresse mais un DRAPEAU de présence
  // (migration 20260916300000). Servie brute, elle partait dans un `<img src>`
  // de l'écran mission — une adresse choisie par l'organisation, donc un
  // mouchard dans le navigateur de l'expert. On signe un chemin DÉRIVÉ de
  // l'identifiant. Une annonce confidentielle n'est pas signée du tout.
  const logoSigne = pub.confidential
    ? null
    : await signOrgLogoUrl(auth.supabaseAdmin, orgRaw?.id ?? null, orgRaw?.logo_url ?? null)

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
        relevance_tier: matchRow.relevance_tier === 'strong' ? 'strong' : 'normal',
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
          ? { name: orgRaw.company_name ?? null, logo_url: logoSigne }
          : null,
      candidature: existingCand
        ? {
            id: (existingCand as { id: string }).id,
            status: (existingCand as { status: string }).status,
            created_at: (existingCand as { created_at: string }).created_at,
            cover_message: (existingCand as { cover_message: string | null }).cover_message,
          }
        : null,
      // L'APTITUDE À POSTULER, décidée au SERVEUR par la MÊME règle que le
      // dépôt (§D.20). L'écran la rend ; il ne la calcule pas — une règle
      // serveur appliquée dans l'UI se fige dans le bundle (§E.15) et
      // divergerait du refus réel.
      aptitude,
    },
    200,
  )
}
