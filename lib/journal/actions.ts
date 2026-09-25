/**
 * LA LISTE FERMÉE DES ACTIONS DU GRAND LIVRE — miroir TypeScript de la table
 * `grand_livre_actions` (migrations `grand_livre`, `liste_blanche_par_action`, §D.26).
 *
 * ═══ POURQUOI DEUX LISTES, ET POURQUOI CE N'EST PAS UN JUMEAU ══════════════
 *   La liste qui DÉCIDE est en base : `journaliser()` refuse tout type absent
 *   de `grand_livre_actions` (GL003) et toute clé de détail hors de la LISTE
 *   BLANCHE de l'action (GL004) — §E.31, une garde qui est une clé ne dépend
 *   d'aucune discipline. Celle-ci ne décide de rien : elle donne au compilateur
 *   le type `TypeAction`, et elle DOCUMENTE, action par action, ce que son
 *   détail a le droit de porter. Les deux listes — codes ET clés — sont
 *   comparées DANS LES DEUX SENS par `scripts/diag-grand-livre.mjs`.
 *
 * ═══ LA LISTE BLANCHE, ET POURQUOI ELLE REMPLACE LA LISTE NOIRE ════════════
 *   `audit_logs_detail_sans_pii()` retire des clés CONNUES : une clé nouvelle
 *   (« nom_contact », « email_facturation ») passerait. C'est la discipline
 *   qu'on remplace partout. Chaque action déclare donc les CHEMINS autorisés
 *   (`avant.vie_annonce_jours`, `liste[].champ`) ; tout le reste est refusé,
 *   nommément. La liste noire reste en seconde barrière, jamais en première.
 *   Une action sans détail déclare `[]` — et `satisfies` oblige chaque action
 *   à se prononcer : une action ajoutée sans sa liste NE COMPILE PAS.
 *
 * ═══ LA RÈGLE (§D.26) ═══════════════════════════════════════════════════════
 *   Toute action nouvelle s'ajoute ICI (code + clés) et dans le seed de la
 *   migration — et passe par `journaliser()` ou par une RPC métier qui
 *   l'appelle, UNE fois par geste (index unique, GL005). Sinon le contrôle
 *   rougit.
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

/**
 * LA LISTE BLANCHE, PAR ACTION — les chemins de clés que `detail` a le droit
 * de porter. Une action non encore branchée déclare `[]` ; elle reçoit ses
 * clés dans le commit qui la branche, avec la migration qui les pose en base.
 */
export const CLES_DETAIL = {
  annonce_publiee: [],
  annonce_modifiee: [],
  annonce_depubliee: [],
  annonce_expiree: [],
  sous_traitance_publiee: [],
  cv_televerse: [],
  profil_publie: [],
  profil_modifie: [],
  disponibilite_basculee: [],
  recherche_lancee: [],
  recherche_filtree: [],
  recherche_classee: [],
  recherche_correspondances: [],
  recherche_notifiee: [],
  recherche_terminee: [],
  recherche_echouee: [],
  recherche_abandonnee: [],
  candidature_deposee: [],
  candidature_declinee: [],
  candidature_retenue: [],
  sous_traitance_candidature: [],
  devoilement_ouvert: [],
  devoilement_ferme: [],
  message_envoye: [],
  compte_valide: [],
  compte_refuse: [],
  compte_suspendu: [],
  compte_reactive: [],
  session_revoquee: [],
  suppression_programmee: [],
  suppression_annulee: [],
  email_change: [],
  mot_de_passe_change: [],
  telephone_verifie: [],
  membre_invite: [],
  invitation_renvoyee: [],
  invitation_acceptee: [],
  invitation_revoquee: [],
  membre_retire: [],
  membre_parti: [],
  role_membre_change: [],
  paiement_recu: [],
  plafond_atteint: ['action', 'fournisseur', 'portee', 'depense_mois_usd', 'plafond_mensuel_usd', 'mois'],
  reglage_modifie: [
    'avant.vie_annonce_jours', 'avant.fenetre_echange_jours', 'avant.invitation_jours', 'avant.conservation_ip_mois',
    'apres.vie_annonce_jours', 'apres.fenetre_echange_jours', 'apres.invitation_jours', 'apres.conservation_ip_mois',
    'retroactivite', 'retroactivite.basculent', 'retroactivite.dont_devoilees', 'retroactivite.confirmee',
  ],
  inactivite_avertie: [],
  compte_purge_inactivite: [],
  compte_purge_demande: [],
  compte_purge_admin: [],
  ip_effacees: ['mois', 'limite', 'audit_logs', 'session_logs', 'cause', 'sqlstate'],
  journal_nettoye: [],
  refus_plafond_atteint: ['action', 'fournisseur', 'portee', 'depense_mois_usd', 'plafond_mensuel_usd'],
  refus_expert_inapte: [],
  refus_garde_eligibilite: [],
  refus_quota_cv: [],
  refus_depot_sans_jugement: [],
} as const satisfies Record<TypeAction, readonly string[]>
