import type { SupabaseClient } from '@supabase/supabase-js'
// ⚠️ LE MÉCANISME A DÉMÉNAGÉ DANS `lib/bail.ts`, ET CE MODULE DÉLÈGUE.
//    Le point 4 avait besoin du MÊME verrou sur un EXPERT. Une seconde table
//    et une seconde fonction d'upsert auraient été un JUMEAU (§E.20) — et un
//    jumeau de VERROU est le pire de tous : il ne sert que sous concurrence,
//    c'est-à-dire précisément quand personne ne regarde. Le jour où l'un des
//    deux corrige sa fenêtre de grâce, l'autre reste ouvert, et rien ne le dit.
//
//    Ce module garde son NOM, ses SIGNATURES et sa documentation : les cinq
//    routes de cron n'ont pas une ligne à changer.
import { graceSecondes as graceGenerique, prendreBail, rendreBail, type PriseDeBail } from '@/lib/bail'

/**
 * lib/cron/bail-de-run.ts — AU PLUS UN RUN A LA FOIS, POUR TOUTE TÂCHE.
 *
 * ═══ POURQUOI CE MODULE EXISTE ═════════════════════════════════════════════
 *   Quatre routes vivent sous `app/api/cron/`, et une seule était gardée — le
 *   rejeu de matching, fermé au lot 20260912200000. Les trois autres n'avaient
 *   AUCUNE garde de run.
 *
 *   Et l'une d'elles portait exactement le même calcul que le défaut déjà
 *   corrigé : `expert_relance_trigger` tourne toutes les 5 minutes pour un run
 *   qui peut durer 300 s. Le chevauchement n'était pas hypothétique, il était
 *   structurel.
 *
 *   Les deux purges sont quotidiennes — un chevauchement exigerait un run de
 *   24 h. Leur exposition est ailleurs, et elle est réelle : le bouton
 *   « exécuter maintenant » du back-office, et tout appel porteur de
 *   `CRON_SECRET`. Le `pg_try_advisory_xact_lock` de `cron_manual_run` ne
 *   couvre QUE la mise en file : il meurt avec la transaction, alors que le run
 *   HTTP commence après.
 *
 * ═══ UN GESTE UNIQUE, PAS TROIS CORRECTIFS ════════════════════════════════
 *   Les quatre routes ont le même trou. Trois correctifs sur mesure
 *   laisseraient la cinquième route — celle qu'on écrira dans six mois — sans
 *   rien, et personne ne saurait qu'il faut y penser.
 *
 * ═══ LE DÉLAI SE DÉDUIT, IL NE SE CHOISIT PAS ═════════════════════════════
 *   Le délai de grâce doit valoir au moins la durée maximale du run. Le laisser
 *   saisir à la main, c'est garantir qu'un jour quelqu'un changera
 *   `maxDuration` sans toucher au délai — et le bail se ferait doubler par un
 *   run encore vivant, silencieusement. On passe donc `maxDuration`, et le
 *   délai en découle.
 *
 * ═══ FAIL-CLOSED, ET ÇA NE COÛTE RIEN ICI ════════════════════════════════
 *   Si le bail ne peut pas être pris — panne de lecture, RPC absente — on NE
 *   TOURNE PAS. C'est le bon sens d'échec pour une tâche PÉRIODIQUE : sauter un
 *   passage se rattrape au suivant (cinq minutes, ou le lendemain), alors que
 *   tourner sans bail rouvre exactement le chevauchement qu'on ferme.
 */

/** Résultat de la prise de bail. `occupe` n'est PAS une erreur. */
export type { PriseDeBail }

/**
 * Le délai de grâce, DÉDUIT de la durée maximale du run.
 *
 * Le double de `maxDuration`, avec un plancher d'une minute : une tâche
 * redevient exécutable dès que son run précédent ne peut plus être vivant.
 */
export const graceSecondes = graceGenerique

/**
 * Prend le bail d'exécution d'une tâche. À appeler APRÈS la garde `CRON_SECRET`
 * et AVANT le moindre travail.
 *
 * `occupe` → la route doit rendre 200 et s'arrêter : un run est déjà en cours,
 * ce n'est pas un incident.
 * `erreur` → la route doit s'arrêter AUSSI (fail-closed, cf. l'en-tête).
 */
export async function prendreBailRun(
  admin: SupabaseClient,
  params: { job: string; maxDurationSec: number },
): Promise<PriseDeBail> {
  return prendreBail(admin, {
    portee: 'cron',
    cle: params.job,
    maxDurationSec: params.maxDurationSec,
  })
}

/**
 * Rend le bail plus tôt que son délai de grâce.
 *
 * PUREMENT FACULTATIF, et c'est le point : le bail expire tout seul. Un échec
 * ici retarde le prochain run, il ne bloque RIEN — un processus tué ne peut pas
 * coincer sa tâche. C'est l'inverse exact d'un drapeau qu'il faudrait baisser.
 */
export async function rendreBailRun(admin: SupabaseClient, job: string): Promise<void> {
  return rendreBail(admin, 'cron', job)
}
