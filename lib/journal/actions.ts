/**
 * LA LISTE FERMÉE DES ACTIONS DU GRAND LIVRE — miroir TypeScript de la table
 * `grand_livre_actions` (migration `grand_livre`, §D.26).
 *
 * ═══ POURQUOI DEUX LISTES, ET POURQUOI CE N'EST PAS UN JUMEAU ══════════════
 *   La liste qui DÉCIDE est en base : `journaliser()` refuse tout type absent
 *   de `grand_livre_actions` (§E.31 — une garde qui est une clé ne dépend
 *   d'aucune discipline). Celle-ci ne décide de rien : elle donne au
 *   compilateur le type `TypeAction`, pour qu'une faute de frappe dans un
 *   appel soit une erreur de compilation et non un refus à l'exécution.
 *   Les deux listes sont comparées DANS LES DEUX SENS par
 *   `scripts/diag-grand-livre.mjs` : un code ajouté d'un seul côté rougit.
 *
 * ═══ LA RÈGLE (§D.26) ═══════════════════════════════════════════════════════
 *   Toute action nouvelle s'ajoute ICI et dans le seed de la migration, avec
 *   sa famille — et passe par `journaliser()` ou par une RPC métier qui
 *   l'appelle. Sinon le contrôle rougit.
 *
 * Les familles suivent le vocabulaire du produit ; `refus` est à part parce
 * qu'un refus n'insère rien : il faut le NOMMER pour qu'il existe.
 */
export const ACTIONS_JOURNAL = [
  // annonce
  'annonce_publiee', 'annonce_modifiee', 'annonce_depubliee', 'annonce_expiree', 'sous_traitance_publiee',
  // profil
  'cv_televerse', 'profil_publie', 'profil_modifie', 'disponibilite_basculee',
  // recherche — une ligne par ÉTAPE de run, jamais par lot ni par profil (§D.26)
  'recherche_lancee', 'recherche_filtree', 'recherche_classee', 'recherche_correspondances',
  'recherche_notifiee', 'recherche_terminee', 'recherche_echouee', 'recherche_abandonnee',
  // candidature
  'candidature_deposee', 'candidature_declinee', 'candidature_retenue', 'sous_traitance_candidature',
  // dévoilement
  'devoilement_ouvert', 'devoilement_ferme',
  // messagerie
  'message_envoye',
  // compte
  'compte_valide', 'compte_refuse', 'compte_suspendu', 'compte_reactive', 'session_revoquee',
  'suppression_programmee', 'suppression_annulee', 'email_change', 'mot_de_passe_change', 'telephone_verifie',
  // organisation
  'membre_invite', 'invitation_renvoyee', 'invitation_acceptee', 'invitation_revoquee',
  'membre_retire', 'membre_parti', 'role_membre_change',
  // commerce
  'paiement_recu', 'plafond_atteint',
  // administration
  'reglage_modifie',
  // rgpd — les trois purges sont SÉPARÉES : elles ne se relisent pas de la même façon
  'inactivite_avertie', 'compte_purge_inactivite', 'compte_purge_demande', 'compte_purge_admin', 'ip_effacees',
  // journal — méta, à part : visible même quand on filtre l'administration
  'journal_nettoye',
  // refus — nommés explicitement, statut imposé « refuse » en base
  'refus_plafond_atteint', 'refus_expert_inapte', 'refus_garde_eligibilite', 'refus_quota_cv', 'refus_depot_sans_jugement',
] as const

export type TypeAction = (typeof ACTIONS_JOURNAL)[number]

export function estTypeAction(x: unknown): x is TypeAction {
  return typeof x === 'string' && (ACTIONS_JOURNAL as readonly string[]).includes(x)
}
