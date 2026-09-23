import { NextRequest, after } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { checkRateLimit } from '@/lib/rate-limit'
import type { IssueDeRecherche } from '@/lib/matching/issue-de-recherche'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/me/sync-matching — LA RECHERCHE DE MISSIONS DE L'EXPERT COURANT.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ CE QUE CETTE ROUTE FAISAIT, ET CE QUE L'EXPERT VOYAIT — mesuré 21/09/26. ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 *   Elle POSAIT UNE ÉCHÉANCE À SOIXANTE MINUTES et rendait la main en quelques
 *   millisecondes. Rien ne partait. L'écran, lui, affichait « Analyse de votre
 *   profil en cours… », puis, soixante-quinze secondes plus tard, retirait le
 *   message en silence, et cent vingt secondes plus tard annonçait « Aucune
 *   mission ne correspond à votre profil pour le moment ».
 *
 *   LES DEUX PHRASES ÉTAIENT FAUSSES, et la seconde était la plus coûteuse :
 *   elle annonçait un RÉSULTAT — « on a cherché, il n'y a rien » — alors que la
 *   recherche n'avait pas commencé et ne commencerait pas avant une heure.
 *
 *   Le report avait une bonne raison — absorber une rafale d'enregistrements de
 *   profil — mais elle ne valait PAS ICI : un interrupteur à deux positions ne
 *   produit pas de rafale. Le report a donc été retiré de ce chemin et gardé
 *   sur `/api/profile`, où la rafale existe (cf. `lib/matching/relance.ts`).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ CE QU'ELLE FAIT MAINTENANT : ELLE CHERCHE, ET ELLE DIT CE QU'ELLE TROUVE.║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 *   ① LA RÉPONSE CONNUE AU CLIC SE DIT AU CLIC. Profil non visible, CV non
 *      analysé, consentement absent, profil non approuvé : ces réponses
 *      existent en UNE LECTURE DE LIGNE. Elles sortent en `ineligible`, sans
 *      run, sans roue qui tourne, sans attente d'aucune sorte.
 *
 *   ② LE MOTEUR TOURNE DANS LA REQUÊTE. La réponse porte l'issue RÉELLE du run
 *      (`IssueDeRecherche`), jamais un « c'est parti » que rien ne vérifie.
 *
 *   ③ LE PLAFOND HORAIRE S'APPLIQUE TOUJOURS — le même, pas une copie :
 *      `consommerPlafondHoraire()`. Il borne les écritures qu'un client peut
 *      déclencher, et un run direct en déclenche autant qu'une relance.
 *
 *   ④ L'ÉLAGAGE RESTE À PART. Un périmètre qui RÉTRÉCIT ne demande aucune
 *      notation : c'est une suppression SQL, et elle ne rend pas d'issue —
 *      il n'y a rien à annoncer à l'expert, sa liste se raccourcit, c'est tout.
 *
 * Garde : `requireAuth` (le caller est l'expert lui-même). Le périmètre est son
 * `profile_id` ; aucun paramètre d'entrée n'est accepté.
 */

/**
 * LA MARGE SOUS LE COUPERET.
 *
 * `maxDuration = 60` est le plafond de l'hébergement (§E.5). Au-delà, Vercel
 * tue la requête : le client reçoit une connexion morte, et l'écran ne peut
 * plus rien dire de vrai. On s'arrête AVANT, à quarante-cinq secondes, pour
 * rendre une issue NOMMÉE plutôt qu'une absence de réponse.
 *
 * ⚠️ LE RUN, LUI, N'EST PAS INTERROMPU. Il est confié à `after()` — sans quoi
 *    le couperet le tuerait à la seconde où l'on répond (§E.5) — et il ira
 *    jusqu'au bout, notera, et écrira ses recommandations. L'expert les verra
 *    au prochain rafraîchissement. Ce qui expire ici, c'est L'ATTENTE, pas le
 *    travail.
 *
 * Mesuré : un run expert note les annonces publiées de son écosystème qui
 * partagent sa branche et ses zones — quelques dizaines de documents, en lots
 * parallèles, avec mémorisation des notes déjà acquises. Les quarante-cinq
 * secondes sont une sécurité, pas un budget nominal.
 */
const ATTENTE_MAX_MS = 45_000

/**
 * CE QU'ON ACCEPTE D'ATTENDRE QU'UN AUTRE RUN FINISSE — un TIERS du budget.
 *
 * ⚠️ IL EST **DÉRIVÉ**, ET C'EST LA MOITIÉ QUI COMPTE. Attendre le bail et
 *    attendre le run puisent dans le MÊME budget : celui de la réponse. Une
 *    constante écrite à côté se désaccorderait d'`ATTENTE_MAX_MS` au premier
 *    ajustement, et l'un des deux mangerait le temps de l'autre — le couperet
 *    de Vercel tomberait avant que l'écran n'ait rien à dire (§E.5).
 *
 * UN TIERS : assez pour couvrir un run voisin qui finit, pas assez pour
 * dévorer le temps du nôtre. Ce n'est pas une mesure — rien dans le dépôt ne
 * dit combien de temps dure un run concurrent —, c'est une répartition, et
 * elle se change en une ligne.
 */
const ATTENTE_BAIL_MS = Math.floor(ATTENTE_MAX_MS / 3)

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { supabaseAdmin, user } = auth

  // Hint client OPTIONNEL { reason } : lu en TÉLÉMÉTRIE uniquement, JAMAIS pour
  // décider (le client n'est pas autoritaire — cf. audit sécurité). Best-effort.
  let clientReason: string | null = null
  try {
    const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
    if (body && typeof body.reason === 'string') clientReason = body.reason
  } catch {
    /* body vide/non-JSON → ignoré */
  }

  // Profil courant : id + flags d'ouverture croisée ACTUELS + trace du dernier
  // run. La trace permet de DÉRIVER le sens du changement de scope côté serveur.
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('id, open_to_cdi, open_to_freelance, last_matching_scope, users!profiles_user_id_fkey!inner(user_type)')
    .eq('user_id', user.id)
    .maybeSingle()
  // Une lecture de `profiles` en panne n'est pas un profil absent (§E.42) :
  // 503 qui se reessaie, jamais le 404 qui se croit. L'absence reelle garde son code.
  if (pErr) {
    console.error('[me/sync-matching] profil ILLISIBLE', { userId: user.id, message: pErr.message })
    return json(
      { error: 'Could not read the profile', code: 'profil_verification_indisponible' },
      503,
    )
  }
  if (!profile) {
    return json({ ok: false, code: 'profile_not_found' }, 404)
  }
  const prof = profile as unknown as {
    id: string
    open_to_cdi: boolean | null
    open_to_freelance: boolean | null
    last_matching_scope: { crossOpen?: boolean } | null
    users: { user_type: string | null } | { user_type: string | null }[] | null
  }
  const uRel = Array.isArray(prof.users) ? prof.users[0] : prof.users
  const userType = uRel?.user_type === 'expert_cdi' ? 'expert_cdi' : 'expert_freelance'
  const currentCrossOpen =
    (userType === 'expert_freelance' && prof.open_to_cdi === true) ||
    (userType === 'expert_cdi' && prof.open_to_freelance === true)
  const traceCrossOpen = prof.last_matching_scope?.crossOpen === true

  // ── SENS DÉRIVÉ SERVEUR ────────────────────────────────────────────────
  //  RÉTRÉCI (crossOpen true → false) : le pool n'a fait que se réduire → un
  //  simple élagage SQL suffit (ZÉRO notation). On le sort du plafond de
  //  relance et on lui applique un rate-limit PERMISSIF (10/min) : le coût est
  //  purement DB.
  //  La trace DOIT exister et valoir true, l'état courant DOIT être false.
  if (traceCrossOpen && !currentCrossOpen) {
    const allowedPrune = await checkRateLimit(supabaseAdmin, 'matching_prune_60s', user.id, 60, 10)
    if (!allowedPrune) return json({ ok: false, code: 'rate_limited', retry_after_seconds: 60 }, 429)

    after(async () => {
      try {
        const { runPruneForExpert } = await import('@/lib/matching')
        const r = await runPruneForExpert({ supabaseAdmin, profileId: prof.id })
        console.log('[me/sync-matching] élagage fait', { profileId: prof.id, ok: r.ok, deleted: r.deleted, kept: r.kept, hint: clientReason })
      } catch (err) {
        console.error('[me/sync-matching] élagage en échec (after)', err)
      }
    })

    // PAS D'ISSUE : rien n'a été cherché. L'écran ne doit donc rien annoncer —
    // la liste se raccourcit d'elle-même, et prétendre le contraire serait la
    // même faute qu'on vient de corriger, dans l'autre sens.
    return json({ ok: true, profile_id: prof.id, mode: 'elagage' }, 200)
  }

  // ── L'ORIGINE, DÉRIVÉE DU SERVEUR ET NON DU CLIENT ──────────────────────
  //
  //  Le périmètre s'est ÉLARGI (trace à false ou absente, état à true) ⇒ c'est
  //  l'interrupteur d'ouverture croisée. Il est INCHANGÉ ⇒ c'est la bascule de
  //  disponibilité, seule autre surface qui appelle cette route.
  //
  //  `'disponibilite'` existait dans `OrigineRelance` et n'était appelée nulle
  //  part : tout partait sous `'ouverture_croisee'`, y compris les bascules de
  //  disponibilité. Les dépassements de plafond étaient donc comptés sous une
  //  étiquette fausse — un chiffre juste sous un mauvais label (§E.24), dans le
  //  seul compteur qui dise qui heurte le plafond.
  const origine = currentCrossOpen !== traceCrossOpen ? 'ouverture_croisee' : 'disponibilite'

  // ── ① LA RÉPONSE CONNUE AU CLIC SE DIT AU CLIC ──────────────────────────
  const { raisonIneligibilite } = await import('@/lib/matching/run-for-expert')
  const eligibilite = await raisonIneligibilite(supabaseAdmin, prof.id)
  if (eligibilite.etat === 'indisponible') {
    // Une lecture en panne n'est PAS une inéligibilité (§E.22) : on ne dit pas
    // à un expert parfaitement en règle que son profil ne l'est pas.
    console.error('[me/sync-matching] éligibilité ILLISIBLE', { profileId: prof.id, detail: eligibilite.detail })
    return json({ error: 'Could not read the profile', code: 'profil_verification_indisponible' }, 503)
  }
  if (eligibilite.etat === 'ineligible') {
    const issue: IssueDeRecherche = { etat: 'ineligible', raison: eligibilite.raison }
    console.log('[me/sync-matching] inéligible — aucune recherche lancée', {
      profileId: prof.id,
      raison: eligibilite.raison,
      origine,
      hint: clientReason,
    })
    return json({ ok: true, profile_id: prof.id, mode: 'direct', issue }, 200)
  }

  // ── ② bis. LE SECOND ATTEND — il ne consomme pas le plafond pour rien ───
  //
  //  ┌─ LE FAUX MESSAGE D'ÉCHEC QUE CECI FAIT DISPARAÎTRE (§D.22) ─────────┐
  //  │ Un expert qui cliquait deux fois consommait DEUX jetons du plafond   │
  //  │ horaire, et le second lui répondait « Trop de recherches lancées     │
  //  │ coup sur coup. Patientez une minute avant de réessayer. » — un       │
  //  │ message d'ÉCHEC pour quelque chose qui n'a pas échoué. Pendant ce    │
  //  │ temps, les deux runs notaient le même vivier, et le payaient deux    │
  //  │ fois.                                                                │
  //  └──────────────────────────────────────────────────────────────────────┘
  //
  //  ⚠️ CETTE LECTURE EST CONSULTATIVE, ET ELLE NE GARDE RIEN. La garantie
  //     est la PRISE du bail, atomique, faite par le moteur lui-même
  //     (`runMatchingForExpert`). Ce qu'on gagne ici est de ne pas DÉPENSER
  //     un jeton de plafond pour un run qui n'aura pas lieu. Si un autre
  //     détenteur prend le bail entre cette lecture et la prise, le moteur
  //     rend `deja_en_cours` et l'issue devient `trop_long` — qui dit vrai.
  const { attendreBailLibre } = await import('@/lib/bail')
  await attendreBailLibre(supabaseAdmin, {
    portee: 'matching_expert',
    cle: prof.id,
    maxDurationSec: 300,
    attenteMaxMs: ATTENTE_BAIL_MS,
  })

  // ── ③ LE PLAFOND HORAIRE, LE MÊME QUE CELUI DES RELANCES ────────────────
  const { consommerPlafondHoraire } = await import('@/lib/matching/relance')
  if (!(await consommerPlafondHoraire(supabaseAdmin, prof.id, origine))) {
    const issue: IssueDeRecherche = { etat: 'echec', raison: 'trop_de_demandes' }
    return json({ ok: false, profile_id: prof.id, mode: 'direct', issue, code: 'relance_plafond' }, 429)
  }

  // ── ② LE MOTEUR TOURNE ICI, ET L'ÉCRAN ATTEND SA FIN ────────────────────
  const debutRun = new Date()
  const { runMatchingForExpert } = await import('@/lib/matching')
  const { issueDepuisVerdict } = await import('@/lib/matching/issue-de-recherche')
  const { solderRelance, runAcheve, codeDEchec, marquerTentativeRelance, echouerRelance } =
    await import('@/lib/matching/relance')

  const course = (async () => {
    // Même compteur que le cron : ce chemin lance le MÊME moteur, et un run
    // direct en échec doit pouvoir être rejoué exactement pareil.
    await marquerTentativeRelance(supabaseAdmin, prof.id)
    // ON ATTEND LE BAIL, parce que quelqu'un regarde l'écran (§D.22). Une
    // tâche de fond, elle, passe son tour et rattrape au passage suivant.
    const verdict = await runMatchingForExpert({ supabaseAdmin, profileId: prof.id })
    // Une relance en attente porterait sur un profil qu'on vient de noter : la
    // solder évite de repayer le même travail dans l'heure. `debutRun` protège
    // un déclenchement arrivé PENDANT le run — il ne sera pas soldé.
    //
    // ⚠️ MAIS SEULEMENT SI LE RUN A ABOUTI. Ce chemin soldait aussi sur un
    //    échec : l'expert lisait « la recherche a échoué » à l'écran — ce qui
    //    était vrai — pendant que la base effaçait l'échéance, de sorte que
    //    rien ne rejouait jamais. L'écran disait la vérité, la base l'oubliait.
    if (runAcheve(verdict)) {
      await solderRelance(supabaseAdmin, prof.id, debutRun)
    } else {
      await echouerRelance(supabaseAdmin, prof.id, codeDEchec(verdict))
    }
    console.log('[me/sync-matching] run direct terminé', {
      profileId: prof.id,
      origine,
      status: verdict.status,
      retenues: verdict.proposals.length,
      ms: Date.now() - debutRun.getTime(),
      notes: verdict.notes,
      hint: clientReason,
    })
    return verdict
  })()

  // LE RUN SURVIT À LA RÉPONSE, QUOI QU'IL ARRIVE. Sans cet `after()`, une
  // réponse rendue sur expiration de l'attente tuerait le run en cours (§E.5)
  // et l'expert perdrait à la fois l'attente ET le travail.
  after(async () => {
    try {
      await course
    } catch (err) {
      console.error('[me/sync-matching] run direct en ÉCHEC (after)', err)
    }
  })

  let issue: IssueDeRecherche
  try {
    issue = await Promise.race([
      course.then(issueDepuisVerdict),
      new Promise<IssueDeRecherche>((resolve) =>
        setTimeout(() => resolve({ etat: 'echec', raison: 'trop_long' }), ATTENTE_MAX_MS),
      ),
    ])
  } catch (err) {
    // Le moteur a levé. C'est un ÉCHEC NOMMÉ, pas « aucune mission » : annoncer
    // un résultat qu'on n'a pas est exactement ce que ce lot corrige.
    console.error('[me/sync-matching] run direct a levé', { profileId: prof.id, err })
    issue = { etat: 'echec', raison: 'lecture_en_panne' }
  }

  return json({ ok: true, profile_id: prof.id, mode: 'direct', issue }, 200)
}
