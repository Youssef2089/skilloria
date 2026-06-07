/**
 * lib/expert-disclosure.ts — politique de divulgation des données expert
 * côté ORG (Lot grille photo-forward).
 *
 * V1 : politique déterministe.
 *   - Candidature pré-unlock          → tout masqué (LOCKED_POLICY)
 *   - Candidature 'unlocked'/'selected' → photo + nom complet révélés,
 *                                         contact (email/tel) JAMAIS exposé
 *   - Conversation org↔expert         → même reveal que candidature unlocked
 *                                         (une conv n'existe que post-unlock,
 *                                         donc l'org a déjà vu photo+nom dans
 *                                         la grille — l'afficher en initiale
 *                                         dans le chat serait incohérent).
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
 * Policy applicable à une candidature côté ORG en fonction de son `status`.
 *  - 'unlocked' | 'selected' → UNLOCKED_POLICY
 *  - sinon                    → LOCKED_POLICY
 *
 * `status` reste la source de vérité ; on ne fait jamais confiance au flag
 * client (sécurité serveur non contournable).
 */
export function disclosurePolicyForCandidatureStatus(status: string): DisclosurePolicy {
  if (status === 'unlocked' || status === 'selected') return UNLOCKED_POLICY
  return LOCKED_POLICY
}

/**
 * Policy applicable à la vue ORG d'une conversation. Une conversation
 * n'existe QUE post-unlock (cf. /api/candidatures/[id]/unlock qui crée la
 * conversation), donc l'org est par définition autorisé à voir photo+nom.
 * Même politique que UNLOCKED_POLICY ; contact toujours hors périmètre.
 *
 * Le caller doit avoir vérifié AU PRÉALABLE que l'org courant est bien
 * participant légitime de la conversation (pub.organization_id == auth.org.id).
 */
export function disclosurePolicyForConversationOrgSide(): DisclosurePolicy {
  return UNLOCKED_POLICY
}
