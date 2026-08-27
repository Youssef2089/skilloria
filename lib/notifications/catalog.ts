/**
 * lib/notifications/catalog.ts — DÉFINITION UNIQUE des notifications externes.
 *
 * Un seul endroit déclare : quels événements existent, sur quels canaux, et
 * pour qui. L'écran de réglages ET le dispatcher le lisent tous les deux.
 *
 * POURQUOI CE MODULE
 *   Sans lui, l'écran afficherait un interrupteur que le dispatcher n'honore
 *   pas — ou l'inverse : un envoi que l'utilisateur ne peut pas couper. C'est
 *   la même maladie que le compteur qui contredit sa liste, transposée aux
 *   notifications. Une seule définition, deux lecteurs.
 *
 * PAS DE SMS SUR LES MESSAGES (décision produit)
 *   Une conversation compte 5 à 10 allers-retours ; un SMS par message sature
 *   le destinataire pour ~0,08 € pièce. L'e-mail suffit. Le canal n'est donc
 *   pas seulement « désactivé par défaut » : il n'existe pas pour cet
 *   événement, et l'écran de réglages ne peut donc pas l'afficher.
 *
 * LE PUBLIC EST UN FAIT, PAS UN TYPE
 *   `audience` ne teste pas `user_type`. Un expert qui publie via son
 *   organisation personnelle (`org_type='freelance'`) REÇOIT des candidatures —
 *   la cloche le lui dit déjà, puisque la création d'org l'inscrit dans
 *   `organization_members`. Un découpage par type d'utilisateur l'aurait privé
 *   du réglage correspondant. On raisonne donc sur ce que la personne peut
 *   RÉELLEMENT recevoir :
 *     - a un profil expert          → opportunités ;
 *     - est membre actif d'une org  → candidatures reçues ;
 *     - tout le monde               → messages.
 *   Cet expert-publiant voit légitimement les trois. Et les trois sous-types
 *   d'organisation (client, cabinet, esn) sont couverts sans être nommés.
 */

export type NotificationEventType =
  | 'new_match_opportunity'
  | 'new_candidature_received'
  | 'new_message'

export type NotificationChannel = 'email' | 'sms'

/** Critère d'accès au réglage — un FAIT vérifié côté serveur, pas un user_type. */
export type NotificationAudience = 'expert' | 'org_member' | 'everyone'

/**
 * Regroupement des envois.
 *   'digest'   : un seul e-mail mentionnant les N notifications en attente
 *                (anti-rafale du matching, qui peut produire 20 matches d'un coup).
 *   'per_item' : un envoi par notification. Assumé pour les messages —
 *                10 allers-retours = 10 e-mails. Aucun regroupement n'est
 *                possible sans job planifié, ce que la contrainte interdit.
 */
export type NotificationGrouping = 'digest' | 'per_item'

/**
 * VOIX d'un réglage — le vocabulaire à employer selon QUI le lit.
 *
 * Un même événement peut désigner deux réalités que les deux publics ne
 * nomment pas pareil. `new_candidature_received` en est le cas : côté
 * entreprise c'est « un expert postule à mon annonce » ; côté expert
 * publiant, c'est « quelqu'un répond à mon besoin de sous-traitance ».
 * Un libellé unique en trahit forcément un des deux.
 *
 * Même motif que `viewpoint` dans lib/candidatures/use-lifecycle-label : le
 * point de vue diffère, le fait est le même.
 *
 * Les deux publics sont MUTUELLEMENT EXCLUSIFS, donc la voix est toujours
 * déterminable sans ambiguïté :
 *   - un compte expert ne peut pas rejoindre une organisation
 *     (joinBlockReason, lib/org-members.ts) ;
 *   - un compte entreprise n'a jamais de ligne `profiles`
 *     (handle_new_user n'en crée que pour les experts).
 */
export type NotificationVoice = 'expert' | 'org'

export type NotificationEventDef = {
  event: NotificationEventType
  channels: readonly NotificationChannel[]
  audience: NotificationAudience
  grouping: NotificationGrouping
  /**
   * `true` si le vocabulaire diffère selon le public. Par DÉFAUT un événement
   * a UNE seule voix : dupliquer « Nouveaux messages » à l'identique en quatre
   * langues serait une redondance qui finirait par diverger.
   */
  voiced?: boolean
}

export const NOTIFICATION_EVENTS: readonly NotificationEventDef[] = [
  {
    event: 'new_match_opportunity',
    channels: ['email', 'sms'],
    audience: 'expert',
    grouping: 'digest',
  },
  {
    event: 'new_candidature_received',
    channels: ['email', 'sms'],
    audience: 'org_member',
    grouping: 'per_item',
    // Seul événement à deux publics au vocabulaire distinct. Pour un expert,
    // il ne peut désigner QUE des réponses à un besoin de sous-traitance :
    // son unique appartenance possible est son organisation personnelle.
    voiced: true,
  },
  {
    event: 'new_message',
    channels: ['email'],
    audience: 'everyone',
    grouping: 'per_item',
  },
] as const

/** Tous les types d'événement gérés — utilisé pour borner les scans du dispatcher. */
export const DISPATCHABLE_EVENT_TYPES: readonly NotificationEventType[] =
  NOTIFICATION_EVENTS.map((e) => e.event)

export function eventDef(event: string): NotificationEventDef | null {
  return NOTIFICATION_EVENTS.find((e) => e.event === event) ?? null
}

/** Le canal est-il défini pour cet événement ? (`new_message` + `sms` ⇒ false). */
export function eventHasChannel(event: string, channel: NotificationChannel): boolean {
  return eventDef(event)?.channels.includes(channel) ?? false
}

/** Faits d'appartenance de l'utilisateur courant, résolus côté serveur. */
export type AudienceFacts = {
  /** Possède une ligne `profiles` → expert. */
  isExpert: boolean
  /** Membre ACTIF d'au moins une organisation (org personnelle incluse). */
  isOrgMember: boolean
}

export function audienceMatches(audience: NotificationAudience, facts: AudienceFacts): boolean {
  if (audience === 'everyone') return true
  if (audience === 'expert') return facts.isExpert
  return facts.isOrgMember
}

/** Réglages à proposer à cet utilisateur. Source unique de l'écran Notifications. */
export function eventsForFacts(facts: AudienceFacts): NotificationEventDef[] {
  return NOTIFICATION_EVENTS.filter((e) => audienceMatches(e.audience, facts))
}

/**
 * Voix à employer pour cet utilisateur, ou `null` si l'événement n'en a qu'une.
 * DÉRIVÉE SERVEUR et SERVIE au client : celui-ci lit le libellé qu'on lui
 * désigne, il ne déduit rien de son propre type (point 20).
 */
export function resolveVoice(event: string, facts: AudienceFacts): NotificationVoice | null {
  if (!eventDef(event)?.voiced) return null
  return facts.isExpert ? 'expert' : 'org'
}
