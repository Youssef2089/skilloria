import type { SupabaseClient } from '@supabase/supabase-js'

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
export type PriseDeBail = 'pris' | 'occupe' | 'erreur'

/**
 * Le délai de grâce, DÉDUIT de la durée maximale du run.
 *
 * Le double de `maxDuration`, avec un plancher d'une minute : une tâche
 * redevient exécutable dès que son run précédent ne peut plus être vivant.
 * C'est le même rapport que le verrou de rejeu du matching (10 min pour un run
 * de 300 s), et pour la même raison — plus court laisserait le chevauchement,
 * plus long retarderait le rattrapage sans rien gagner.
 */
export function graceSecondes(maxDurationSec: number): number {
  return Math.max(60, Math.ceil(maxDurationSec) * 2)
}

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
  const { data, error } = await admin.rpc('prendre_bail_run', {
    p_job_name: params.job,
    p_grace: `${graceSecondes(params.maxDurationSec)} seconds`,
  })
  if (error) {
    console.error(`[cron:${params.job}] prise de bail impossible — on ne tourne pas`, error.message)
    return 'erreur'
  }
  return data === true ? 'pris' : 'occupe'
}

/**
 * Rend le bail plus tôt que son délai de grâce.
 *
 * PUREMENT FACULTATIF, et c'est le point : le bail expire tout seul. Un échec
 * ici retarde le prochain run, il ne bloque RIEN — un processus tué ne peut pas
 * coincer sa tâche. C'est l'inverse exact d'un drapeau qu'il faudrait baisser.
 *
 * N'échoue jamais vers l'appelant : sa réponse ne doit pas dépendre de ceci.
 */
export async function rendreBailRun(admin: SupabaseClient, job: string): Promise<void> {
  const { error } = await admin.rpc('rendre_bail_run', { p_job_name: job })
  if (error) {
    console.warn(`[cron:${job}] restitution du bail en echec — il expirera seul`, error.message)
  }
}
