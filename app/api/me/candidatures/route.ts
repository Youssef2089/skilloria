import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { loadTranslations } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import { buildPublicationSynthesis } from '@/lib/publication-synthesis'
import {
  deriveCandidatureLifecycle,
  parseBucketFilter,
  type CandidatureLifecycle,
} from '@/lib/candidatures/lifecycle'
import { aggregateCandidatures } from '@/lib/candidatures/aggregate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/candidatures — liste les candidatures de l'expert courant.
 *
 *  Garde : requireAuth → service_role.
 *  Source : candidatures.profile_id = profile.user_id == auth.uid().
 *  Filtre : ne renvoie pas les 'withdrawn' (l'expert s'est retiré).
 *
 *  DTO : id, publication_id, publication = PublicationSynthesis (synthèse
 *  parlante via helper partagé), status, status_reason, ai_match_score,
 *  unlocked_at, cover_message, created_at, conversation_id si unlocked,
 *  + `lifecycle` = { bucket, reason, until } DÉRIVÉ SERVEUR.
 *
 *  ÉTAT DE VIE (lot « libellés d'état réels ») :
 *   `status` seul ment — une candidature 'unlocked' dont la fenêtre 15 j est
 *   passée s'affichait « Échange ouvert ». On DÉRIVE l'état à la lecture via
 *   lib/candidatures/lifecycle.ts (zéro écriture, zéro job) et on expose
 *   `lifecycle` ; le client rend la raison, il ne la calcule pas (point 20).
 *
 *  ?filter=active|archived|all — ACTIVES PAR DÉFAUT. Le filtrage est
 *   appliqué APRÈS dérivation, donc côté serveur : le client ne peut pas
 *   afficher active ce que le serveur dit archivé.
 *
 *  Tri : created_at DESC (les plus récentes d'abord).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
}

type CandRow = {
  id: string
  publication_id: string
  status: string
  status_reason: string | null
  ai_match_score: number | null
  unlocked_at: string | null
  // Lot état 'selected' : timestamp posé par la transition unlocked → selected.
  selected_at: string | null
  cover_message: string | null
  created_at: string
  updated_at: string
  publications: unknown
}

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const url = new URL(request.url)
  const locale = normalizeLocale(url.searchParams.get('locale'))
  // Actives par défaut (cf. en-tête). 'all' → null = pas de filtrage.
  const bucketFilter = parseBucketFilter(url.searchParams.get('filter'))

  // Profile expert
  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, user_id')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (pErr) {
    console.error('[me/candidatures:GET] profile lookup failed', pErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!profile) {
    return json({ candidatures: [] }, 200)
  }

  // Candidatures + publication enrichie (Lot synthèse parlante).
  //  Le SELECT publications est élargi pour alimenter buildPublicationSynthesis.
  const [candResult, translations] = await Promise.all([
    auth.supabaseAdmin
      .from('candidatures')
      .select(
        'id, publication_id, status, status_reason, ai_match_score, unlocked_at, selected_at, ' +
          'cover_message, created_at, updated_at, ' +
          'publications!inner(' +
          'id, type, title, branch_id, speciality_id, budget_min, budget_max, ' +
          'location, work_mode, duration, start_date, seniority, skills_required, ' +
          // published_at + expires_at : indispensables à la dérivation de
          // l'état de vie (règle 30 j lue par isActivePublished).
          'confidential, status, published_at, expires_at, organization_id, ' +
          'branches(id, name), specialities(id, name), ' +
          'organizations(id, company_name, logo_url)' +
          ')',
      )
      .eq('profile_id', (profile as { id: string }).id)
      .neq('status', 'withdrawn')
      .order('created_at', { ascending: false })
      .limit(200),
    loadTranslations(locale),
  ])
  if (candResult.error) {
    console.error('[me/candidatures:GET] candidatures query failed', candResult.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const rows = (candResult.data ?? []) as unknown as CandRow[]

  // Conversation_id pour les unlocked OU selected (batch query).
  //  Lot 'selected' : la conversation reste accessible côté expert après
  //  avoir été retenu (caler date / contrat).
  const accessibleStatuses = new Set(['unlocked', 'selected'])
  const accessibleCandIds = rows.filter((r) => accessibleStatuses.has(r.status)).map((r) => r.id)
  const convByCand = new Map<string, string>()
  // `expires_at` de la conversation : c'est LA fenêtre 15 j qui décide si un
  // échange 'unlocked' est encore ouvert ou archivé (cf. lifecycle.ts §3).
  const convExpiryByCand = new Map<string, string | null>()
  if (accessibleCandIds.length > 0) {
    const { data: convs } = await auth.supabaseAdmin
      .from('conversations')
      .select('id, candidature_id, expires_at')
      .in('candidature_id', accessibleCandIds)
    for (const c of ((convs ?? []) as { id: string; candidature_id: string; expires_at: string | null }[])) {
      convByCand.set(c.candidature_id, c.id)
      convExpiryByCand.set(c.candidature_id, c.expires_at)
    }
  }

  // Lot bascule badges par item : viewed_by_me pour chaque candidature.
  // "Consultée" = candidature_views.viewed_at >= candidatures.updated_at
  // (un changement de statut côté org bump updated_at → re-marquage requis).
  const allCandIds = rows.map((r) => r.id)
  const viewedAtByCand = new Map<string, string>()
  if (allCandIds.length > 0) {
    const { data: viewsRaw } = await auth.supabaseAdmin
      .from('candidature_views')
      .select('candidature_id, viewed_at')
      .eq('user_id', auth.user.id)
      .in('candidature_id', allCandIds)
    for (const v of ((viewsRaw ?? []) as { candidature_id: string; viewed_at: string }[])) {
      viewedAtByCand.set(v.candidature_id, v.viewed_at)
    }
  }

  // Instant unique pour toute la page : deux candidatures de la même réponse
  // ne doivent pas être dérivées à des `now` différents.
  const now = new Date()

  const candidatures = rows.map((r) => {
    const pubRaw = pickRel(r.publications as Parameters<typeof buildPublicationSynthesis>[0] | Parameters<typeof buildPublicationSynthesis>[0][] | null)
    const publication = pubRaw
      ? {
          ...buildPublicationSynthesis(pubRaw, translations),
          status: (pubRaw as { status?: string }).status ?? null,
        }
      : null
    // Org + compétences pour la carte casting des accueils experts (additif ;
    // la page dédiée /candidatures ignore ces champs).
    // Masquage confidential STRICTEMENT identique à /api/me/missions.
    const isConfidential = !!(pubRaw as { confidential?: boolean } | null)?.confidential
    const orgRaw = pubRaw
      ? (pickRel((pubRaw as { organizations?: unknown }).organizations as never) as
          | { company_name: string | null; logo_url: string | null }
          | null)
      : null
    const org = !isConfidential && orgRaw
      ? { name: orgRaw.company_name ?? null, logo_url: orgRaw.logo_url ?? null }
      : null
    const skills_required = ((pubRaw as { skills_required?: string[] | null } | null)?.skills_required ?? [])
    const v = viewedAtByCand.get(r.id)
    const viewedByMe = !!v && new Date(v).getTime() >= new Date(r.updated_at).getTime()
    // DÉRIVATION SERVEUR de l'état de vie — même helper que côté org.
    const lifecycle = deriveCandidatureLifecycle(
      {
        status: r.status,
        unlocked_at: r.unlocked_at,
        publication: pubRaw
          ? {
              status: (pubRaw as { status?: string | null }).status ?? null,
              published_at: (pubRaw as { published_at?: string | null }).published_at ?? null,
              expires_at: (pubRaw as { expires_at?: string | null }).expires_at ?? null,
            }
          : null,
        conversation: convExpiryByCand.has(r.id)
          ? { expires_at: convExpiryByCand.get(r.id) ?? null }
          : null,
      },
      now,
    )
    return {
      id: r.id,
      publication_id: r.publication_id,
      publication,
      org,
      skills_required,
      status: r.status,
      status_reason: r.status_reason,
      ai_match_score: r.ai_match_score,
      unlocked_at: r.unlocked_at,
      selected_at: r.selected_at,
      cover_message: r.cover_message,
      created_at: r.created_at,
      conversation_id: accessibleStatuses.has(r.status) ? convByCand.get(r.id) ?? null : null,
      viewed_by_me: viewedByMe,
      lifecycle,
    }
  })

  // Filtrage APRÈS dérivation : le bucket est un fait serveur, pas un choix
  // client. `null` (?filter=all) = tout, pour les compteurs des deux onglets.
  const visible = bucketFilter
    ? candidatures.filter((c) => (c.lifecycle as CandidatureLifecycle).bucket === bucketFilter)
    : candidatures

  // ─── COMPTEURS ET AGRÉGATS — TOUT DANS LA PASSE EXISTANTE ────────────────
  //
  // POURQUOI LES AGRÉGATS DESCENDENT D'ICI
  //   Le client les recomposait lui-même, sur la liste déjà filtrée. Résultat
  //   vécu : « 3 candidatures » au-dessus de « Aucune candidature », et sur
  //   l'accueil « Postulées 3 » à côté de trois zéros. Un tableau, plusieurs
  //   altitudes. Le client affiche désormais, il n'agrège plus rien : compteur
  //   et liste ne peuvent plus diverger — même tableau, même passe.
  //
  // ═══ DEUX PORTÉES, DEUX ÉCRANS — LIRE AVANT DE « CORRIGER » ══════════════
  //   `stats.all`    : agrégat sur la TOTALITÉ (actives + archivées).
  //   `stats.active` : agrégat sur le SEUL bucket actif.
  //
  //   Ce n'est PAS une incohérence, c'est une décision produit :
  //
  //   • La PAGE CANDIDATURES consomme `stats.all`. Elle porte les chips
  //     Actives/Archivées : le contexte est à l'écran, le bandeau peut donc
  //     décrire l'ensemble sans ambiguïté. Et `exchange_open` /
  //     `awaiting_review` étant des raisons du bucket ACTIVE par définition
  //     (cf. lib/candidatures/lifecycle.ts), les borner à l'onglet courant les
  //     rendrait structurellement nuls sur Archivées — un zéro qui ne veut
  //     rien dire.
  //
  //   • L'ACCUEIL EXPERT consomme `stats.active`. Il n'a PAS d'onglets : il
  //     doit dire où l'expert en est MAINTENANT. Une candidature sur annonce
  //     expirée n'appelle plus aucune action, elle ne doit pas gonfler un
  //     chiffre d'accueil. C'est déjà la règle de l'accueil ENTREPRISE
  //     (cf. dashboard/entreprise/page.tsx, somme de `candidatures.active`).
  //
  //   Symétriquement, `rejected` est une raison du bucket ARCHIVÉ par
  //   définition : aucune tuile d'accueil ne doit la compter, elle y serait un
  //   zéro permanent. L'accueil affiche donc « En attente » (awaiting_review),
  //   pas « Refusées ».
  //
  //   → Si une session future trouve « incohérent » que deux écrans affichent
  //     des nombres différents pour la même personne : c'est voulu, ne pas
  //     aligner l'un sur l'autre. Deux écrans, deux besoins.
  // ═════════════════════════════════════════════════════════════════════════

  const counts = { active: 0, archived: 0 }
  for (const c of candidatures) counts[(c.lifecycle as CandidatureLifecycle).bucket]++

  const stats = {
    all: aggregateCandidatures(candidatures),
    active: aggregateCandidatures(
      candidatures.filter((c) => (c.lifecycle as CandidatureLifecycle).bucket === 'active'),
    ),
  }

  return json({ candidatures: visible, counts, stats, filter: bucketFilter ?? 'all' }, 200)
}
