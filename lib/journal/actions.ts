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
  annonce_publiee: ['type', 'organization_id', 'verification_method', 'verification_score', 'published_at'],
  annonce_modifiee: ['champs', 'champs[]', 'statut_annonce', 'organization_id'],
  annonce_depubliee: ['de', 'vers', 'organization_id'],
  annonce_expiree: ['vie_annonce_jours'],
  sous_traitance_publiee: [],
  cv_televerse: ['octets', 'analyse', 'premier_consentement', 'experiences', 'formations', 'langues'],
  profil_publie: ['deja_visible', 'verification_avant'],
  profil_modifie: ['champs', 'champs[]', 'blocs', 'blocs[]'],
  disponibilite_basculee: ['champ', 'de', 'vers'],
  recherche_lancee: ['tentative', 'tache'],
  recherche_filtree: ['eligibles', 'sans_matiere', 'a_noter', 'ecartes_deja_decline', 'ecartes_deja_postule', 'chargees'],
  recherche_classee: ['model', 'notes', 'reprises', 'lots_en_echec', 'arret', 'recherches', 'unites_source'],
  recherche_correspondances: ['retenues', 'fortes', 'inserees', 'mises_a_jour', 'supprimees', 'filtre_flux', 'palier_fort'],
  recherche_notifiee: ['demandees', 'deja_notifiees', 'posees', 'paquets_en_echec', 'renonce'],
  recherche_terminee: ['issue', 'raison'],
  recherche_echouee: ['etape', 'cause', 'tentative', 'arret', 'lots_en_echec'],
  recherche_abandonnee: ['tentatives', 'plafond', 'cause'],
  candidature_deposee: ['publication_id', 'profile_id', 'match_id', 'ai_match_score', 'origine_depot', 'tentative'],
  candidature_declinee: ['publication_id', 'has_reason'],
  candidature_retenue: ['publication_id', 'publication_type', 'profile_id'],
  sous_traitance_candidature: [],
  devoilement_ouvert: ['publication_id', 'profile_id', 'conversation_id', 'auto', 'expires_at'],
  devoilement_ferme: ['publication_id', 'profile_id', 'unlocked_at', 'fin_echange'],
  message_envoye: [],
  compte_valide: ['has_reason', 'de'],
  compte_refuse: ['has_reason', 'de'],
  compte_suspendu: ['de', 'vers', 'type_de_compte'],
  compte_reactive: ['de', 'vers', 'type_de_compte'],
  session_revoquee: [], // AUCUN détail : le fait seul, et rien qui identifie une session.
  suppression_programmee: ['echeance', 'grace_jours'],
  suppression_annulee: ['visibilite_restauree', 'avait_un_profil'],
  email_change: ['etape'],
  mot_de_passe_change: [], // AUCUN détail : ni empreinte, ni longueur (elle réduit l'espace de recherche).
  telephone_verifie: ['methode'],
  membre_invite: ['role_in_org', 'domain_validation_passed', 'email_already_exists'],
  invitation_renvoyee: ['role_in_org', 'expires_at'],
  invitation_acceptee: ['organization_id', 'role_in_org', 'deja_membre', 'reintegre'],
  invitation_revoquee: ['de', 'vers', 'role_in_org'],
  membre_retire: [],
  membre_parti: [],
  role_membre_change: [],
  paiement_recu: [
    'transaction_id', 'organization_id', 'package_id',
    'stripe_invoice_id', 'stripe_event_id',
    'montant', 'montant_ht', 'taxe', 'devise',
    'periode', 'periode_debut', 'periode_fin',
  ],
  plafond_atteint: ['action', 'fournisseur', 'portee', 'depense_mois_usd', 'plafond_mensuel_usd', 'mois'],
  // L'union des familles de réglages — chaque route n'en remplit qu'une, la
  // base refuse le reste (migration `journal_reglages`).
  reglage_modifie: [
    'avant', 'apres',
    // durées
    'avant.vie_annonce_jours', 'avant.fenetre_echange_jours', 'avant.invitation_jours', 'avant.conservation_ip_mois',
    'apres.vie_annonce_jours', 'apres.fenetre_echange_jours', 'apres.invitation_jours', 'apres.conservation_ip_mois',
    'retroactivite', 'retroactivite.basculent', 'retroactivite.dont_devoilees', 'retroactivite.confirmee',
    // tarifs
    'model',
    'avant.usd_par_1m_entree', 'avant.usd_par_1m_sortie', 'avant.usd_par_unite', 'avant.usd_par_recherche', 'avant.usd_par_recherche_web',
    'apres.usd_par_1m_entree', 'apres.usd_par_1m_sortie', 'apres.usd_par_unite', 'apres.usd_par_recherche', 'apres.usd_par_recherche_web',
    // plafonds et alertes
    'champ', 'avant.claude', 'avant.rerank', 'apres.claude', 'apres.rerank',
    'avant.organization', 'avant.profile', 'apres.organization', 'apres.profile',
    // quotas
    'quota', 'avant.max_per_window', 'avant.window_hours', 'apres.max_per_window', 'apres.window_hours',
    // moteur
    'avant.feed_threshold', 'avant.notify_threshold', 'avant.notify_enabled', 'avant.rerank_model', 'avant.rerank_batch_size',
    'apres.feed_threshold', 'apres.notify_threshold', 'apres.notify_enabled', 'apres.rerank_model', 'apres.rerank_batch_size',
    // notes de jugement
    'note_de', 'avant.note', 'avant.drapeaux', 'avant.drapeaux[]', 'apres.note', 'apres.drapeaux', 'apres.drapeaux[]',
    // offres
    'avant.name', 'avant.slug', 'avant.target_role', 'avant.price_monthly', 'avant.price_yearly', 'avant.currency',
    'avant.active', 'avant.is_free', 'avant.is_default', 'avant.scope',
    'apres.name', 'apres.slug', 'apres.target_role', 'apres.price_monthly', 'apres.price_yearly', 'apres.currency',
    'apres.active', 'apres.is_free', 'apres.is_default', 'apres.scope',
    'features', 'features[].feature_code', 'features[].value', 'features[].reset_period', 'features[].avant',
    'package_fields', 'package_fields[]',
    'default_requested', 'default_applied', 'default_refused_code',
    // le défaut du catalogue
    'target_role', 'package_id', 'avant.default_ids', 'avant.default_ids[]', 'apres.default_ids', 'apres.default_ids[]',
    // attribution et migration d'offres
    'avant.package_id', 'avant.package_started_at', 'avant.package_valid_until',
    'apres.package_id', 'apres.package_started_at', 'apres.package_valid_until',
    'count', 'skipped_subscribed',
    // catalogue Stripe
    'mode', 'synchronisees', 'synchronisees[]', 'refusees', 'refusees[]', 'en_echec', 'en_echec[]', 'cause',
  ],
  inactivite_avertie: [],
  compte_purge_inactivite: [],
  compte_purge_demande: [],
  compte_purge_admin: [],
  ip_effacees: ['mois', 'limite', 'audit_logs', 'session_logs', 'cause', 'sqlstate'],
  journal_nettoye: [],
  refus_plafond_atteint: ['action', 'fournisseur', 'portee', 'depense_mois_usd', 'plafond_mensuel_usd'],
  refus_expert_inapte: ['raison', 'publication_id'],
  refus_garde_eligibilite: ['code', 'profile_id'],
  refus_quota_cv: ['quota', 'limite', 'fenetre_heures', 'reset_at', 'compte'],
  refus_depot_sans_jugement: ['publication_id', 'profile_id', 'cause', 'tentative'],
} as const satisfies Record<TypeAction, readonly string[]>
