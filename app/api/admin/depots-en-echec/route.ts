import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { deposerCandidature, REFUS_DEPOT, type CodeRefus } from '@/lib/candidatures/depot'
import {
  CAUSES_DEPOT,
  etatDeDepot,
  FENETRE_DEPOT_MS,
  filtreDepotsEnSouffrance,
  type EtatDepotAffiche,
} from '@/lib/candidatures/depot-etats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// La relance REJOUE un dépôt : elle attend le modèle exactement comme lui.
export const maxDuration = 60

/**
 * LES DÉPÔTS QUI N'ONT PAS ABOUTI — et le bouton qui les rejoue.
 *
 * ┌─ POURQUOI CET ÉCRAN EXISTE ─────────────────────────────────────────────┐
 * │ Depuis le 23/09/2026, une candidature dont le jugement échoue n'est PAS │
 * │ écrite (§D.19). Sans cet écran, ce refus serait une perte silencieuse :  │
 * │ l'expert croit avoir postulé, l'organisation ignore qu'elle devait       │
 * │ recevoir quelque chose, et PERSONNE NE SE PLAINT.                        │
 * │                                                                          │
 * │ C'est la contrepartie exacte de la décision « l'expert n'est pas         │
 * │ prévenu » : on ne le prévient pas parce que NOUS le savons.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ LA RELANCE REJOUE LE DÉPÔT, ELLE NE LE RECONSTRUIT PAS ══════════════
 *   `deposerCandidature` est appelée avec les trois choses qui identifient le
 *   dépôt — l'annonce, l'expert, le message. TOUT le reste (le match,
 *   l'annonce, le profil, les durées) est relu au moment du rejeu, comme au
 *   premier passage. Un chemin qui recopierait un état figé donnerait un
 *   résultat que le dépôt normal n'aurait jamais produit.
 *
 * ═══ TROIS ÉTATS D'AFFICHAGE, ET LE TROISIÈME EST DÉRIVÉ ═════════════════
 *   `echec`      — le jugement a rendu une cause. On sait pourquoi.
 *   `interrompu` — le dépôt est resté « en cours » au-delà de la fenêtre :
 *                  la fonction a été tuée pendant l'appel au modèle. Personne
 *                  n'a rien écrit, et c'est exactement le cas que rien
 *                  n'aurait vu.
 *   `en_cours`   — un dépôt est en train de se faire. Il n'est PAS un
 *                  problème ; il n'apparaît pas et ne se relance pas.
 *   ⚠️ « interrompu » est DÉRIVÉ de l'heure, jamais stocké. Un état stocké
 *      exigerait que quelqu'un vienne le poser — une tâche, donc un
 *      intervalle, donc la classe de défaut que §E.63 vient de fermer.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type LigneBase = {
  id: string
  publication_id: string
  profile_id: string
  domain_id: string | null
  etat: string
  cause: string | null
  detail: string | null
  tentatives: number
  commence_at: string
  termine_at: string | null
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
  const url = new URL(request.url)

  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 25) || 25))
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const causeDemandee = url.searchParams.get('cause') ?? ''
  const domaineDemande = url.searchParams.get('domain_id') ?? ''
  const jours = Math.max(0, Math.min(365, Number(url.searchParams.get('jours') ?? 0) || 0))

  const limiteInterruption = new Date(Date.now() - FENETRE_DEPOT_MS).toISOString()

  // Les lignes NON SOLDÉES. L'index partiel porte exactement ce prédicat.
  let q = admin
    .from('candidature_depots')
    .select(
      'id, publication_id, profile_id, domain_id, etat, cause, detail, tentatives, commence_at, termine_at',
      { count: 'exact' },
    )
    .neq('etat', 'depose')

  // ── LES FILTRES ─────────────────────────────────────────────────────────
  //  « interrompu » n'est pas une cause : c'est l'absence de cause, passé un
  //  délai. Le filtrer revient donc à filtrer un ÉTAT, pas une colonne
  //  `cause` — les mélanger dans une seule expression rendrait des lignes
  //  « en cours » toutes fraîches, qui ne sont pas un problème.
  if (causeDemandee === 'interrompu') {
    q = q.eq('etat', 'en_cours').lt('commence_at', limiteInterruption)
  } else if ((CAUSES_DEPOT as readonly string[]).includes(causeDemandee)) {
    q = q.eq('etat', 'echec').eq('cause', causeDemandee)
  } else {
    // Sans filtre de cause, on écarte quand même les dépôts RÉCEMMENT
    // commencés : ils ne sont pas en souffrance, ils sont en train de se faire.
    q = q.or(filtreDepotsEnSouffrance(Date.now()))
  }
  if (UUID_REGEX.test(domaineDemande)) q = q.eq('domain_id', domaineDemande)
  if (jours > 0) {
    q = q.gte('commence_at', new Date(Date.now() - jours * 86_400_000).toISOString())
  }

  const { data, error, count } = await q
    .order('commence_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('[depots-en-echec] lecture en panne', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const lignes = (data ?? []) as unknown as LigneBase[]

  // ── CE QUI FAIT QU'UNE LIGNE EST LISIBLE : l'annonce et l'expert ────────
  //  Deux lectures groupées plutôt qu'un embed : `candidature_depots` porte
  //  DEUX clés étrangères vers des tables jointes ailleurs, et un embed
  //  ambigu casse silencieusement (§E.18).
  const pubIds = [...new Set(lignes.map((l) => l.publication_id))]
  const profIds = [...new Set(lignes.map((l) => l.profile_id))]

  const [pubsRes, profsRes] = await Promise.all([
    pubIds.length > 0
      ? admin.from('publications').select('id, title, type').in('id', pubIds)
      : Promise.resolve({ data: [], error: null }),
    profIds.length > 0
      ? admin
          .from('profiles')
          .select('id, title, user_id, users!profiles_user_id_fkey(first_name, last_name)')
          .in('id', profIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  // ⚠️ UNE PANNE ICI N'EST PAS « AUCUNE ANNONCE ». Elle rendrait un écran de
  //    lignes anonymes — « quelque chose a échoué, quelque part » — qui
  //    n'apprend rien et qu'on cesserait de regarder (§E.52). On le DIT.
  if (pubsRes.error) {
    console.error('[depots-en-echec] annonces illisibles', pubsRes.error.message)
  }
  if (profsRes.error) {
    console.error('[depots-en-echec] experts illisibles', profsRes.error.message)
  }

  const pubParId = new Map<string, { title: string | null; type: string | null }>()
  for (const p of (pubsRes.data ?? []) as Array<{ id: string; title: string | null; type: string | null }>) {
    pubParId.set(p.id, { title: p.title, type: p.type })
  }
  type ProfRow = {
    id: string
    title: string | null
    users: { first_name: string | null; last_name: string | null }
      | { first_name: string | null; last_name: string | null }[]
      | null
  }
  const profParId = new Map<string, { titre: string | null; prenom: string | null; nom: string | null }>()
  for (const p of (profsRes.data ?? []) as unknown as ProfRow[]) {
    const u = Array.isArray(p.users) ? p.users[0] : p.users
    profParId.set(p.id, {
      titre: p.title,
      prenom: u?.first_name ?? null,
      nom: u?.last_name ?? null,
    })
  }

  return json({
    lignes: lignes.map((l) => {
      const etat: EtatDepotAffiche = etatDeDepot(l, Date.now())
      const pub = pubParId.get(l.publication_id) ?? null
      const prof = profParId.get(l.profile_id) ?? null
      return {
        id: l.id,
        etat,
        cause: l.cause,
        detail: l.detail,
        tentatives: l.tentatives,
        commence_at: l.commence_at,
        termine_at: l.termine_at,
        domain_id: l.domain_id,
        publication: { id: l.publication_id, title: pub?.title ?? null, type: pub?.type ?? null },
        expert: {
          profile_id: l.profile_id,
          prenom: prof?.prenom ?? null,
          nom: prof?.nom ?? null,
          titre: prof?.titre ?? null,
        },
        // `null` quand la lecture a échoué, et l'écran le DIT — jamais un
        // libellé vide qui se lirait comme « annonce sans titre ».
        contexte_lisible: pub !== null && prof !== null,
      }
    }),
    total: count ?? 0,
  })
}

/**
 * POST — RELANCER un dépôt. Rejoue EXACTEMENT `deposerCandidature`.
 *
 * Body : { id: uuid }  (l'identifiant de la LIGNE DE JOURNAL, pas d'une
 * candidature : par définition il n'y en a pas.)
 */
export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin

  let body: { id?: unknown }
  try {
    body = (await request.json()) as { id?: unknown }
  } catch {
    return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  const { data: ligneRow, error: ligneErr } = await admin
    .from('candidature_depots')
    .select(
      'id, publication_id, profile_id, domain_id, etat, cause, detail, tentatives, commence_at, termine_at, cover_message',
    )
    .eq('id', id)
    .maybeSingle()
  if (ligneErr) {
    console.error('[depots-en-echec] ligne illisible', ligneErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!ligneRow) return json({ error: 'Not found', code: 'not_found' }, 404)
  const ligne = ligneRow as unknown as LigneBase & { cover_message: string | null }

  // ── ON NE RELANCE QUE CE QUI EST EN SOUFFRANCE ──────────────────────────
  //  Un dépôt ABOUTI n'a rien à rejouer ; un dépôt EN COURS est en train de
  //  se faire, et le relancer ferait partir un SECOND appel au modèle pour le
  //  même dossier — une dépense doublée, sur la seule action de cet écran.
  const etat = etatDeDepot(ligne, Date.now())
  if (etat === 'depose') return json({ error: 'Already deposited', code: 'deja_depose' }, 409)
  if (etat === 'en_cours') return json({ error: 'Deposit running', code: 'depot_en_cours' }, 409)

  const issue = await deposerCandidature({
    supabaseAdmin: admin,
    profileId: ligne.profile_id,
    publicationId: ligne.publication_id,
    coverMessage: ligne.cover_message,
    origine: 'relance_admin',
  })

  // ── L'AUDIT DE **L'ADMINISTRATEUR**, distinct de celui du dépôt ─────────
  //  Le dépôt écrit sa propre ligne au nom de l'EXPERT (c'est lui qui
  //  candidate). Celle-ci dit qui a appuyé sur le bouton. Les confondre ferait
  //  disparaître l'un des deux actes.
  await logAudit({
    supabaseAdmin: admin,
    user_id: auth.user.id,
    domain_id: ligne.domain_id,
    action: 'candidature_depot_relance',
    entity_type: 'candidature_depot',
    entity_id: ligne.id,
    detail: {
      publication_id: ligne.publication_id,
      profile_id: ligne.profile_id,
      tentative: ligne.tentatives + 1,
      issue: issue.issue,
      cause: issue.issue === 'sans_jugement' ? issue.cause : null,
      code: issue.issue === 'refusee' ? issue.code : null,
    },
  })

  switch (issue.issue) {
    case 'deposee':
      return json({ issue: 'deposee', candidature_id: issue.candidatureId }, 200)
    case 'refusee':
      // ⚠️ LE STATUT EST CELUI DU DÉPÔT, PAS 200. Un refus de garde rendu en
      //    200 se lirait « c'est reparti » sur l'écran (§E.22).
      return json({ issue: 'refusee', code: issue.code }, REFUS_DEPOT[issue.code as CodeRefus])
    case 'inapte':
      // Même règle que `refusee` : le statut est celui du DÉPÔT. Un expert
      // devenu « occupé », ou dont le consentement a été retiré, n'est pas une
      // panne à relancer — c'est un dépôt qui n'a plus lieu d'être.
      return json({ issue: 'inapte', raison: issue.raison }, 403)

    case 'sans_jugement':
      // La relance a échoué à son tour, et la ligne reste. 200 : la demande a
      // bien été traitée, son VERDICT est dans le corps — et l'écran le lit.
      return json({ issue: 'sans_jugement', cause: issue.cause, raison: issue.raison }, 200)
  }
}
