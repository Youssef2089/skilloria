/**
 * lib/expert-disclosure.ts — politique de divulgation des données expert
 * côté ORG (Lot grille photo-forward).
 *
 * LE DÉVOILEMENT EST TEMPORAIRE, PAS DÉFINITIF (lot sécurité/RGPD).
 *
 *   `candidatures.status` est la MÉCANIQUE : « l'org a déverrouillé ». Il ne
 *   redescend jamais. L'ÉTAT DE VIE dérivé (lib/candidatures/lifecycle.ts) est
 *   le FAIT : « l'accès est-il encore ouvert ? ». Décider la divulgation sur le
 *   statut brut rendait le dévoilement PERPÉTUEL : une organisation pouvait
 *   publier, déverrouiller, laisser expirer, et se constituer une base de
 *   profils identifiés — un détournement de la finalité du traitement.
 *
 *   Dès que la candidature bascule dans le bucket 'archived' — annonce expirée
 *   à 30 j, annonce clôturée manuellement, annonce retirée, fenêtre d'échange
 *   de 15 j close, refus — le profil REDEVIENT MASQUÉ au niveau strict
 *   d'avant déverrouillage. Le motif de l'archivage est indifférent : clôturer
 *   ses annonces plutôt que les laisser expirer ne contourne rien.
 *
 * V1 : politique déterministe.
 *   - Bucket 'archived'                 → tout masqué (LOCKED_POLICY), quel que
 *                                         soit le statut brut
 *   - Candidature pré-unlock            → tout masqué (LOCKED_POLICY)
 *   - Candidature 'unlocked'/'selected'
 *     ENCORE ACTIVE                     → photo + nom complet révélés,
 *                                         contact (email/tel) JAMAIS exposé
 *   - Conversation org↔expert           → MÊME fonction, mêmes entrées : un fil
 *                                         archivé re-masque son en-tête. Le
 *                                         CORPS des messages n'est pas réécrit
 *                                         (on n'efface aucun historique et on
 *                                         ne prétend pas l'avoir anonymisé) —
 *                                         ce qui se ferme, c'est le CHEMIN
 *                                         D'ACCÈS permanent, pas la trace.
 *
 * V2 (futur, NON branché ici) : la fonction est conçue comme un POINT
 * D'EXTENSION propre. Pour brancher le packaging commerce, il suffira de
 * passer un `package?: OrgPackage` aux helpers ci-dessous et de muter la
 * policy en fonction (ex. `package.includes_contact_directory →
 * reveal_contact: true`). Aucun appelant ne devrait avoir à changer sa
 * forme d'appel.
 *
 * INVARIANTS de sécurité (cf. règles #5 RLS + #20 sécurité serveur) :
 *  - `reveal_contact` reste `false` en V1, partout, toujours. Aucun chemin
 *    serveur ne projette email/phone vers un user ORG.
 *  - Les policies sont appliquées CÔTÉ SERVEUR uniquement, dans les helpers
 *    DTO (lib/candidature-org-dto.ts) + routes conversations. Le client ne
 *    voit jamais que le résultat (un objet avec ou sans le champ).
 */

import type { CandidatureBucket } from '@/lib/candidatures/lifecycle'

export type DisclosurePolicy = {
  /** Permet de projeter `photo_url` dans le payload destiné à l'ORG. */
  reveal_photo: boolean
  /** Permet de projeter `{first_name} {last_name}` (sinon pseudonyme masqué). */
  reveal_full_name: boolean
  /**
   * Permet de projeter `email` / `phone` / `linkedin_url` / `cv_url`.
   * V1 : TOUJOURS `false` quel que soit le call-site. Ne sera pas branché
   * tant que le packaging commerce n'aura pas été conçu (back-office).
   */
  reveal_contact: boolean
}

const UNLOCKED_POLICY: DisclosurePolicy = Object.freeze({
  reveal_photo: true,
  reveal_full_name: true,
  reveal_contact: false,
})

const LOCKED_POLICY: DisclosurePolicy = Object.freeze({
  reveal_photo: false,
  reveal_full_name: false,
  reveal_contact: false,
})

/**
 * Entrées de la décision. Objet nommé À DEUX CHAMPS OBLIGATOIRES, et c'est
 * délibéré : la signature précédente prenait un `status: string` nu, ce qui
 * rendait l'erreur invisible — on croyait décider sur un droit d'accès alors
 * qu'on décidait sur une mécanique de paiement. Ici, oublier l'état de vie ne
 * compile pas.
 */
export type CandidatureDisclosureInput = {
  /** `candidatures.status` — la MÉCANIQUE (l'org a-t-elle déverrouillé ?). */
  candidatureStatus: string
  /**
   * Bucket DÉRIVÉ par `deriveCandidatureLifecycle` — le FAIT (l'accès est-il
   * encore ouvert ?). Jamais recalculé ici : ce module ne connaît aucune règle
   * temporelle, il en consomme le verdict.
   */
  lifecycleBucket: CandidatureBucket
}

/**
 * SEULE fonction de divulgation côté ORG. Les cinq surfaces qui projettent un
 * profil expert vers une organisation la traversent — candidatures agrégées,
 * candidatures d'une annonce, sous-traitance, inbox messagerie, fil de
 * messages. Si une surface décide encore seule, la faille reste ouverte.
 *
 * ORDRE SIGNIFIANT : l'état de vie prime sur le statut. Un statut 'unlocked'
 * figé en base ne rouvre rien une fois la candidature archivée.
 *
 * 'selected' est ACTIF sans limite de durée (cf. lifecycle.ts §2) : un candidat
 * retenu ne se re-masque JAMAIS, l'expiration de l'annonce n'y change rien.
 * La relation commerciale existe, le fait est acquis.
 *
 * Le caller doit avoir vérifié AU PRÉALABLE que l'org courante est bien
 * légitime sur la candidature / la conversation (ownership publication).
 */
export function disclosurePolicyForCandidatureLifecycle(
  input: CandidatureDisclosureInput,
): DisclosurePolicy {
  if (input.lifecycleBucket === 'archived') return LOCKED_POLICY
  if (input.candidatureStatus === 'unlocked' || input.candidatureStatus === 'selected') {
    return UNLOCKED_POLICY
  }
  return LOCKED_POLICY
}
