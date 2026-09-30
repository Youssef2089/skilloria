/**
 * lib/supervision/joignabilite.ts — LA BASE ATTEINT-ELLE LE SITE ? LA CAUSE, NOMMÉE (recette staging, 30/09/2026).
 *
 * Chaque tâche planifiée est un appel de la BASE au SITE (`trigger_purge_cron` → pg_net → /api/cron/…).
 * Sur staging, l'adresse appelée (secret `purge_cron_base_url` du Vault) était la racine, protégée par Vercel :
 * chaque appel recevait un 401 AVANT d'atteindre le code, aucune tâche ne tournait, et la supervision ne
 * lisait aucun passage. `cron_joignabilite()` rend le dernier appel de chaque tâche ; ce module dit POURQUOI
 * il n'a pas atteint le site — une cause par action à faire, jamais « une erreur ».
 *
 * LA RÈGLE QUI SÉPARE « PAS ATTEINT » DE « A ÉCHOUÉ » : une ligne close par la TÂCHE elle-même prouve que
 * la requête a atteint notre code ; son échec éventuel est une panne de la tâche (dite par
 * /admin/taches-planifiees), pas un problème de joignabilité. Tout le reste est jugé sur la réponse que la
 * base a reçue.
 *
 * Module PUR, sans import : le contrôle l'exécute tel quel.
 */

export type AppelDeTache = {
  job_name: string
  requested_at: string
  http_status: number | null
  timed_out: boolean
  erreur_connexion: boolean
  secret_refuse: boolean
  source: 'tache' | 'reconciliation' | 'reponse_brute' | 'aucune'
}

export const CAUSES_INJOIGNABLE = [
  'protection',      // 401 d'une page d'hébergeur : une protection est posée devant l'adresse appelée
  'secret_refuse',   // 401 de NOTRE route : cron_secret (Vault) ≠ CRON_SECRET (Vercel)
  'redirection',     // 3xx : l'adresse redirige — pg_net ne suit pas, la tâche n'est jamais atteinte
  'delai',           // pg_net a abandonné après 60 s
  'connexion',       // pas de réponse HTTP du tout : adresse fausse, DNS, certificat
  'erreur_http',     // une autre réponse (4xx/5xx) sans que la tâche ait écrit son verdict
  'aucune_reponse',  // appel émis, aucune réponse observée (pg_net ne la garde qu'environ 6 h)
] as const
export type CauseInjoignable = (typeof CAUSES_INJOIGNABLE)[number]

/** Au-delà de ce délai sans réponse, « en cours » devient « aucune réponse ». pg_net abandonne à 60 s. */
export const ATTENTE_REPONSE_MS = 5 * 60 * 1000

/** La cause, ou `null` quand le site a été atteint (ou que la réponse est encore attendue). */
export function causeInjoignable(a: AppelDeTache, maintenant: number): CauseInjoignable | null {
  if (a.source === 'tache') return null
  if (a.timed_out) return 'delai'
  const s = a.http_status
  if (s === null) {
    if (a.erreur_connexion) return 'connexion'
    if (a.source === 'aucune') {
      return maintenant - new Date(a.requested_at).getTime() > ATTENTE_REPONSE_MS ? 'aucune_reponse' : null
    }
    return 'connexion'
  }
  if (s >= 200 && s < 300) return null
  if (s === 401) return a.secret_refuse ? 'secret_refuse' : 'protection'
  if (s >= 300 && s < 400) return 'redirection'
  return 'erreur_http'
}
