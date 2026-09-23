// lib/cron/verdict-de-run.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ UNE TÂCHE ÉCRIT SON RÉSULTAT ELLE-MÊME, AU MOMENT OÙ ELLE FINIT.        ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LE DÉFAUT, MESURÉ LE 22/09/2026 ───────────────────────────────────────┐
// │ 9 853 passages des pilotes depuis le 3 septembre, **7 201 sans aucun**   │
// │ **verdict** — 73 %. La tâche posait sa réponse chez `pg_net`, qui la     │
// │ garde environ six heures ; la réconciliation ne passe qu'à 03 h 15 et    │
// │ 03 h 45. Un passage de 10 h du matin n'avait plus de réponse à recopier  │
// │ la nuit suivante.                                                        │
// │                                                                          │
// │ Ramasser plus souvent réduit la perte sans la supprimer : il reste       │
// │ toujours une fenêtre. Ce qui la supprime, c'est qu'il n'y ait plus       │
// │ d'intervalle du tout.                                                    │
// └──────────────────────────────────────────────────────────────────────────┘
//
// ⚠️ LE VERDICT EST ÉCRIT SUR **TOUS** LES CHEMINS DE SORTIE, Y COMPRIS UNE
//    EXCEPTION. C'est l'objet du guichet ci-dessous : cinq routes ont chacune
//    entre trois et six `return`, et en oublier un rouvrirait le trou sur
//    exactement la branche qu'on ne teste jamais — celle de l'échec. Une
//    discipline « penser à clôturer » aurait la même valeur qu'un commentaire
//    (§E.31).
//
// ⚠️ ET L'ÉCRITURE NE PEUT PAS ÉCHOUER EN SILENCE — c'est la condition que
//    l'architecte a posée. Quatre cas, quatre issues, aucune muette :
//    · la base refuse     → journal d'erreur nommé, et la réconciliation garde
//                           sa chance de remplir la ligne par l'autre chemin ;
//    · la RPC rend false  → aucune ligne n'a bougé (identifiant inconnu, ou
//                           passage déjà clos) : journal d'erreur nommé ;
//    · corps ILLISIBLE    → le pilote a envoyé quelque chose qu'on n'a pas su
//                           lire : journal d'ERREUR — une ligne attend un
//                           verdict qu'elle ne recevra pas par ce chemin ;
//    · corps ABSENT       → l'appel ne vient pas du pilote (un `curl` de mise
//                           au point) : on le dit en INFO, et on ne prétend pas
//                           avoir clôturé quoi que ce soit.
//    Les deux derniers avaient d'abord la même forme — un `null` pour les deux.
//    Le cliquet de `diag-echec-silencieux` a mordu dessus à la première
//    exécution, et il avait raison : c'était §E.29 dans la parade elle-même.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Ce que le pilote met dans le corps. Rien d'autre n'y est attendu. */
type CorpsDePilote = { log_id?: unknown }

/**
 * CE QU'ON A TROUVÉ DANS LE CORPS — trois états, jamais deux.
 *
 * ⚠️ `null` POUR LES DEUX AURAIT ÉTÉ §E.29 DANS LA PARADE ELLE-MÊME, et le
 *    cliquet de `diag-echec-silencieux` a mordu dessus à la première exécution.
 *    « Aucun identifiant » est vrai d'un `curl` de mise au point — c'est le cas
 *    normal, il n'y a rien à clôturer. Il est FAUX d'un corps que le pilote a
 *    bien envoyé et qu'on n'a pas su lire : là, une ligne de journal attend un
 *    verdict qu'elle ne recevra jamais par ce chemin, et ça mérite un cri.
 *    Les deux ont la même forme en mémoire et jamais le même sens.
 */
export type IdentifiantDeJournal =
  | { etat: 'present'; logId: number }
  /** Pas de corps, pas de champ : l'appel ne vient pas du pilote. */
  | { etat: 'absent' }
  /** Un corps est arrivé et n'a pas pu être lu. Anomalie, pas cas normal. */
  | { etat: 'illisible'; cause: string }

/**
 * L'identifiant de la ligne de journal, lu dans le corps de la requête.
 *
 * Ne lève jamais : un corps illisible n'est pas une raison de ne pas faire le
 * travail demandé. Mais il ne se tait pas non plus — l'état le dit.
 */
export async function lireIdentifiantDeJournal(request: Request): Promise<IdentifiantDeJournal> {
  let brut: CorpsDePilote
  try {
    brut = (await request.json()) as CorpsDePilote
  } catch (err) {
    return { etat: 'illisible', cause: err instanceof Error ? err.message : String(err) }
  }
  const v = brut?.log_id
  if (v === undefined || v === null) return { etat: 'absent' }
  // Un identifiant est un entier STRICTEMENT positif. `Number('')` vaut 0, et
  // 0 n'est pas un identifiant : on refuse la valeur plutôt que de prétendre
  // clôturer « la ligne 0 ».
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isInteger(n) || n <= 0) {
    return { etat: 'illisible', cause: `log_id inexploitable : ${JSON.stringify(v)}` }
  }
  return { etat: 'present', logId: n }
}

/**
 * Écrit le verdict de ce passage. Ne lève JAMAIS : une tâche qui a fait son
 * travail ne doit pas échouer parce qu'elle n'a pas su le raconter.
 */
export async function ecrireVerdictDeRun(
  admin: SupabaseClient,
  args: {
    identifiant: IdentifiantDeJournal
    job: string
    httpStatus: number
    resume: unknown
    erreur?: string | null
  },
): Promise<void> {
  if (args.identifiant.etat === 'absent') {
    // Pas un incident : le cas normal d'un appel hors pilote.
    console.log('[cron/verdict] aucun identifiant de journal — rien à clôturer', {
      job: args.job,
      status: args.httpStatus,
    })
    return
  }
  if (args.identifiant.etat === 'illisible') {
    // Le pilote a bien envoyé quelque chose, et on ne sait pas quelle ligne
    // clôturer : ce passage restera sans verdict par ce chemin.
    console.error('[cron/verdict] IDENTIFIANT DE JOURNAL ILLISIBLE — passage non clôturé', {
      job: args.job,
      status: args.httpStatus,
      cause: args.identifiant.cause,
    })
    return
  }
  try {
    const { data, error } = await admin.rpc('cloturer_run_cron', {
      p_log_id: args.identifiant.logId,
      p_http_status: args.httpStatus,
      p_summary: args.resume ?? null,
      p_error: args.erreur ?? null,
    })
    if (error) {
      console.error('[cron/verdict] ÉCRITURE REFUSÉE — le passage restera sans verdict', {
        job: args.job,
        logId: args.identifiant.logId,
        message: error.message,
      })
      return
    }
    if (data !== true) {
      // Aucune ligne n'a bougé. Ce n'est pas « rien à faire » : c'est un
      // identifiant qui ne correspond à rien, ou un passage déjà clos — et les
      // deux méritent d'être vus (§E.22 : une valeur neutre n'est pas un fait).
      console.error('[cron/verdict] AUCUNE LIGNE CLÔTURÉE — identifiant inconnu ou déjà clos', {
        job: args.job,
        logId: args.identifiant.logId,
      })
    }
  } catch (err) {
    console.error('[cron/verdict] écriture du verdict en ÉCHEC (exception)', {
      job: args.job,
      logId: args.identifiant.logId,
      cause: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * LE GUICHET — il enveloppe le travail d'une tâche et clôt son passage.
 *
 * ⚠️ IL LIT L'IDENTIFIANT **AVANT** D'APPELER LE TRAVAIL, et c'est nécessaire :
 *    le corps d'une requête ne se lit qu'une fois, et une tâche qui lèverait
 *    tout de suite laisserait sinon la ligne ouverte sans qu'on sache laquelle.
 *
 * ⚠️ IL RELAIE L'EXCEPTION APRÈS AVOIR ÉCRIT. Une tâche qui lève doit lever —
 *    l'avaler ici transformerait une panne en succès silencieux, exactement la
 *    classe qu'on ferme (§E.22). Ce qui change est qu'elle laisse une trace.
 */
export async function sousVerdictDeRun(
  request: Request,
  job: string,
  admin: () => SupabaseClient,
  travail: () => Promise<Response>,
): Promise<Response> {
  const identifiant = await lireIdentifiantDeJournal(request)
  let reponse: Response
  try {
    reponse = await travail()
  } catch (err) {
    await ecrireVerdictDeRun(admin(), {
      identifiant,
      job,
      httpStatus: 500,
      resume: { erreur: 'exception' },
      erreur: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
  // Le corps est lu sur un CLONE : la réponse rendue à l'appelant doit garder
  // son flux intact.
  let resume: unknown = null
  try {
    resume = await reponse.clone().json()
  } catch {
    resume = null
  }
  await ecrireVerdictDeRun(admin(), {
    identifiant,
    job,
    httpStatus: reponse.status,
    resume,
  })
  return reponse
}
