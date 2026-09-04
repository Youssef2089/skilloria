import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { loadTranslations } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import {
  buildPublicationSynthesis,
  loadReferentielLabels,
  PUBLICATION_SYNTHESIS_SELECT,
} from '@/lib/publication-synthesis'
import {
  buildExpertMissionsSelect,
  expertMissionsQuery,
  loadExpertFeedContext,
  EXPERT_FEED_LIMIT,
} from '@/lib/missions/feed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/missions — feed des opportunités matchées de l'expert courant.
 *
 * Garde : requireAuth → service_role.
 * - Charge le profile expert (profiles.user_id = auth.uid()).
 * - Joint matches → publications status='published' où le profile est matché.
 * - Filtre les matches en status 'dismissed' (l'expert les a déclinés).
 * - Masque l'identité de l'org si publication.confidential = true.
 *
 * SOURCE DES RÈGLES : lib/missions/feed.ts. Éligibilité (profil, vérification,
 * « Ne pas déranger ») et filtres publication (publiée, non expirée à 30 j, org
 * existante) ne sont PAS écrits ici — /api/me/badges appelle les mêmes
 * fonctions, de sorte que le badge nav est un sous-ensemble de cette liste par
 * construction. Toute règle recopiée dans l'une des deux routes est un bug.
 *
 * → L'expert ne peut PAS parcourir le catalogue : la curation par matching
 *   est imposée côté serveur ET par la RLS publications (publications_published_expert_read
 *   a été retirée — cf. migration 20260603160000).
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

type MatchRow = {
  id: string
  publication_id: string
  // Le score de pertinence NE SORT PAS de cette route. Il vit dans [0,1], il est
  // propre à une annonce, et le fournisseur écrit qu'on ne peut ni le lire comme
  // une proportion ni comparer deux requêtes. Ce qui sort, c'est le PALIER —
  // figé au moment de la notation.
  relevance_score: number | null
  relevance_tier: string | null
  status: string
  explanation: { reason?: string; model?: string; evaluated_at?: string } | null
  created_at: string
  publications: {
    id: string
    type: string
    title: string
    branch_id: string | null
    speciality_id: string | null
    budget_min: number | null
    budget_max: number | null
    confidential: boolean
    status: string
    published_at: string | null
    organization_id: string
    branches: { id: string; name: string } | { id: string; name: string }[] | null
    specialities: { id: string; name: string } | { id: string; name: string }[] | null
    organizations: { id: string; company_name: string | null; logo_url: string | null } | { id: string; company_name: string | null; logo_url: string | null }[] | null
  } | { /* same */ }[] | null
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

  // ── Contexte d'éligibilité (helper PARTAGÉ avec /api/me/badges) ────────
  //  Lot compteurs : profil, vérification et barrière « Ne pas déranger » sont
  //  lus par lib/missions/feed.ts. Le badge nav consomme EXACTEMENT le même
  //  contexte — il ne peut donc plus compter ce que ce feed refuse de servir.
  //
  //  Lot vérif expert : defense-in-depth — exige verification_status='approved'.
  //  Si non vérifié → 403 not_verified. La nav freelance gate déjà côté UI.
  //
  //  Lot disponibilité — BARRIÈRE FEED non contournable côté serveur. Un expert
  //  en « Ne pas déranger » ne reçoit AUCUNE mission, peu importe les matches
  //  déjà calculés. Symétrique côté entreprise via loadEligibleProfiles
  //  (lib/matching/index.ts).
  //
  //  Lot A : on expose `expert_status.is_dnd` dans la réponse pour que les
  //  pages clientes affichent l'empty-state ROUGE conditionnel + le bouton
  //  "Repasser À l'écoute". Le side (freelance/cdi) est connu côté page
  //  appelante — pas besoin de le faire transiter par l'API.
  const feedCtx = await loadExpertFeedContext(auth.supabaseAdmin, auth.user.id)
  if (!feedCtx.ok) {
    console.error('[me/missions:GET] profile lookup failed', feedCtx.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const { profile, isApproved, isDnd } = feedCtx.context
  if (!profile) {
    // L'utilisateur n'a pas de profile (expert pas encore inscrit). Feed vide.
    return json({ missions: [] }, 200)
  }
  if (!isApproved) {
    return json({ error: 'Profile not verified', code: 'not_verified' }, 403)
  }
  if (isDnd) {
    return json({ missions: [], expert_status: { is_dnd: true } }, 200)
  }

  const locale = normalizeLocale(new URL(request.url).searchParams.get('locale'))

  // ── Matches de l'expert + jointures, statut hors 'dismissed' ───────────
  //  Lot synthèse : on étend le select publications avec les champs requis
  //  par buildPublicationSynthesis (location, work_mode, duration, start_date,
  //  seniority). Branches/specialities passent par la même jointure pour
  //  obtenir les labels traduits via tBDD.
  //
  //  Les FILTRES (non décliné, publication publiée, non expirée à 30 j, org
  //  existante) vivent dans expertMissionsQuery — la route ne fournit que ses
  //  colonnes. Le badge nav appelle la même fonction avec un select minimal :
  //  aucune règle n'est recopiée, donc aucune divergence possible.
  const [matchesResult, translations] = await Promise.all([
    expertMissionsQuery(auth.supabaseAdmin, profile.id, {
      select: buildExpertMissionsSelect({
        matchColumns: 'id, publication_id, relevance_score, relevance_tier, status, explanation, created_at',
        // SOURCE UNIQUE des colonnes de synthèse : la liste vivait recopiée
        // ici, et c'est cette copie qui citait encore `speciality_id`,
        // `seniority` et `location` — trois colonnes supprimées. La requête
        // échouait ENTIÈREMENT : plus une seule mission dans le flux.
        publicationColumns:
          PUBLICATION_SYNTHESIS_SELECT +
          ', skills_required, status, published_at, organization_id',
        // Plus d'embed `specialities(...)` : la clé étrangère est morte avec le
        // passage au multiple. Les libellés se résolvent par lot, plus bas.
        publicationEmbeds: 'branches(id, name)',
        organizationColumns: 'id, company_name, logo_url',
      }),
    })
      // Ordonner PAR le score reste juste : à l'intérieur d'une même annonce, il
      // dit lequel des deux profils correspond le mieux. C'est l'AFFICHER qui ne
      // l'est pas.
      .order('relevance_score', { ascending: false, nullsFirst: false })
      .limit(EXPERT_FEED_LIMIT),
    loadTranslations(locale),
  ])

  if (matchesResult.error) {
    console.error('[me/missions:GET] matches query failed', matchesResult.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const rows = (matchesResult.data ?? []) as unknown as MatchRow[]

  // Libellés des référentiels multiples : DEUX requêtes pour toute la page,
  // jamais une par ligne.
  type LigneAvecReferentiels = { speciality_ids?: string[] | null; work_zone_ids?: string[] | null }
  const pubsDeLaPage: LigneAvecReferentiels[] = []
  for (const r of rows) {
    const p = pickRel(r.publications) as LigneAvecReferentiels | null
    if (p) pubsDeLaPage.push(p)
  }
  // Le cast structurel casse une explosion de généricité du client Supabase
  // (TS2589). Il ne relâche aucune vérification utile : le helper n'attend
  // qu'un `from().select().in()`.
  const labels = await loadReferentielLabels(
    auth.supabaseAdmin as unknown as Parameters<typeof loadReferentielLabels>[0],
    translations,
    pubsDeLaPage,
  )

  const missions = rows.map((row) => {
    const pub = pickRel(row.publications)
    if (!pub) return null
    const orgRaw = pickRel((pub as { organizations: unknown }).organizations as never) as
      | { id: string; company_name: string | null; logo_url: string | null }
      | null

    // Synthèse publication via le helper partagé (source unique).
    const synthesis = buildPublicationSynthesis(
      pub as Parameters<typeof buildPublicationSynthesis>[0],
      translations,
      labels,
    )

    return {
      // Match (côté expert)
      match_id: row.id,
      match_status: row.status,           // pending | notified | viewed | dismissed
      // Deux paliers, aucun nombre (cf. migration score_de_pertinence).
      relevance_tier: row.relevance_tier === 'strong' ? 'strong' : 'normal',
      ai_reason: row.explanation?.reason ?? null,
      matched_at: row.created_at,
      // Publication (DTO masqué + synthèse parlante via helper partagé)
      publication: {
        ...synthesis,
        published_at: (pub as { published_at: string | null }).published_at,
      },
      // Compétences requises (chips carte casting). Additif : ignoré par
      // MissionCard / la page dédiée /missions.
      skills_required: ((pub as { skills_required?: string[] | null }).skills_required ?? []),
      // Org : masqué si confidential
      org: (pub as { confidential: boolean }).confidential
        ? null
        : orgRaw
          ? { name: orgRaw.company_name ?? null, logo_url: orgRaw.logo_url ?? null }
          : null,
    }
  }).filter((x): x is NonNullable<typeof x> => x !== null)

  return json({ missions, expert_status: { is_dnd: false } }, 200)
}
