import type { NotificationChannel } from './catalog'

/**
 * lib/notifications/canaux.ts — QUELS CANAUX SONT OUVERTS, ET UN SEUL ENDROIT LE DIT.
 *
 * ═══ LE DÉFAUT QU'ON FERME ════════════════════════════════════════════════
 *   Le canal SMS des NOTIFICATIONS n'a jamais été coupé. Le dispatcher
 *   l'empruntait sans aucune condition, et le seul filtre était une préférence
 *   par utilisateur EN OPT-OUT : `isChannelEnabled` rend `!disabled.has(...)`,
 *   donc l'absence de ligne valait ACTIF — et le défaut en base est
 *   `notify_match_sms boolean NOT NULL DEFAULT true`.
 *
 *   Conséquence, en production : chaque candidature déposée envoyait un SMS
 *   Vonage PAYANT à tous les membres de l'organisation au téléphone vérifié. Et
 *   comme les interrupteurs avaient été retirés des écrans, personne ne pouvait
 *   s'en désinscrire.
 *
 * ═══ POURQUOI UN SEUL POINT, ET PAS UN FILTRE PAR ÉVÉNEMENT ═══════════════
 *   Couper au cas par cas laisse le PROCHAIN événement ajouté repartir tout
 *   seul : celui qui l'écrira recopiera `channels: ['email', 'sms']` du voisin
 *   sans savoir qu'il rouvre une dépense. Le canal doit donc être FERMÉ PAR
 *   DÉFAUT, et le rouvrir doit être un geste explicite — une ligne à changer
 *   ici, visible en revue, et non un tableau à ne pas oublier.
 *
 * ═══ CE QUI N'EST PAS TOUCHÉ, ET IL FAUT LE DIRE ══════════════════════════
 *   LES SMS D'AUTHENTIFICATION (OTP de connexion et d'inscription) NE PASSENT
 *   PAS PAR ICI. Ils utilisent une autre API Vonage — Verify v2
 *   (`api.nexmo.com/v2/verify`) — appelée directement par les routes d'auth,
 *   sans jamais toucher ni ce module, ni le dispatcher, ni `lib/sms/vonage.ts`
 *   (qui vise `rest.nexmo.com/sms/json`). Les deux chemins n'ont aucun point
 *   commun : fermer celui-ci ne peut pas casser l'inscription.
 *
 * ═══ LE CODE DE LA V2 EST CONSERVÉ ════════════════════════════════════════
 *   On coupe l'EMPRUNT du canal, on ne démolit pas la route : `runChannel`, le
 *   gabarit SMS et `lib/sms/vonage.ts` restent en place. Rouvrir la V2 sera un
 *   changement de cette constante, pas une réécriture.
 *
 *   CE QUI DEVIENT INATTEIGNABLE, ET JE LE DIS PLUTÔT QUE DE LE LAISSER
 *   TRAÎNER : tant que `sms` est fermé, `lib/sms/vonage.ts` (`sendSms`,
 *   `smsSenderFrom`), le gabarit `lib/sms/templates.ts`, et les branches
 *   `channel === 'sms'` de `dispatch.ts` ne sont plus atteints à l'exécution.
 *   Ils sont conservés DÉLIBÉRÉMENT, pour la V2 ; ce n'est pas un oubli.
 */

/**
 * Les canaux qu'une notification a le droit d'emprunter.
 *
 * ⚠️ AJOUTER `'sms'` ICI RÉACTIVE UNE DÉPENSE SORTANTE sur tous les événements
 *    qui le déclarent, immédiatement et sans autre changement. Avant de le
 *    faire, il faut au minimum : un défaut de préférence en OPT-IN (le défaut
 *    en base est encore `true`), et des interrupteurs rendus aux écrans.
 */
export const CANAUX_OUVERTS: readonly NotificationChannel[] = ['email']

/** Ce canal peut-il être emprunté ? Fermé par défaut : tout ce qui n'est pas ouvert est fermé. */
export function canalOuvert(channel: NotificationChannel): boolean {
  return CANAUX_OUVERTS.includes(channel)
}

/** Les canaux d'un événement, réduits à ceux réellement ouverts. */
export function canauxOuvertsDe(channels: readonly NotificationChannel[]): NotificationChannel[] {
  return channels.filter(canalOuvert)
}
