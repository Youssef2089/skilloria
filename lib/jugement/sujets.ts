/**
 * LES TROIS SUJETS QUI SE JUGENT — et la liste est FERMÉE.
 *
 * ┌─ POURQUOI UNE LISTE, ET PAS « CE QU'IL Y A EN BASE » ───────────────────┐
 * │ L'écran affichait TOUTES les lignes de `verification_providers`, et la   │
 * │ base en porte deux qui ne gouvernent RIEN. Il montrait donc deux champs  │
 * │ qui ne réglaient rien — et §D.11 le dit : un champ qui ne règle rien     │
 * │ finit par être rempli.                                                   │
 * │                                                                          │
 * │ Pire : le type d'une ligne servait à construire une clé i18n             │
 * │ (`types.${provider_type}.name`). La ligne vestige `profile_matching`     │
 * │ n'avait aucune clé, et l'écran affichait le CHEMIN DE LA CLÉ en          │
 * │ capitales. Une liste fermée ferme les deux défauts d'un coup : ce qui    │
 * │ n'est pas déclaré ici n'atteint jamais l'écran.                          │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Ce module ne dépend de RIEN : il est lisible par une route, par un écran et
 * par un diagnostic, sans base et sans réseau.
 */

/** Les cas qui forcent le passage par un humain, quelle que soit la note. */
export const DRAPEAUX_CONNUS = [
  'DOMAIN_MISMATCH',
  'CV_PROFILE_INCOHERENT',
  'LINKEDIN_UNVERIFIABLE',
  'SUSPICIOUS_CONTENT',
] as const

export type Sujet = {
  /** Le nom du sujet à l'écran et dans l'API. Jamais un identifiant de base. */
  sujet: 'experts' | 'entreprises' | 'annonces'
  /** La ligne de `verification_providers` qui décide pour ce sujet. */
  provider_type: 'profile_verification' | 'ai_web_search' | 'opportunity_quality_check'
  /**
   * LA VALEUR QUI TRANCHE. Pour les experts, ce n'est PAS la colonne
   * `confidence_threshold` — elle est lue puis jamais utilisée — mais
   * `config->>'auto_approve_threshold'`. Se tromper de clé ici, c'est régler
   * une valeur que personne ne lit.
   */
  cle_decisive: 'auto_approve_threshold' | 'confidence_threshold'
  /** Ce sujet porte-t-il des cas qui forcent la revue humaine ? */
  porte_drapeaux: boolean
}

export const SUJETS: readonly Sujet[] = [
  {
    sujet: 'experts',
    provider_type: 'profile_verification',
    cle_decisive: 'auto_approve_threshold',
    porte_drapeaux: true,
  },
  {
    sujet: 'entreprises',
    provider_type: 'ai_web_search',
    cle_decisive: 'confidence_threshold',
    porte_drapeaux: false,
  },
  {
    sujet: 'annonces',
    provider_type: 'opportunity_quality_check',
    cle_decisive: 'confidence_threshold',
    porte_drapeaux: false,
  },
] as const

/**
 * CE QUI EXISTE EN BASE ET NE GOUVERNE RIEN — déclaré ici pour que la liste
 * ci-dessus ne se lise pas comme un oubli.
 *
 * Ces deux valeurs NE SONT PAS AFFICHÉES (§D.11). Elles sont documentées dans
 * `docs/architecture.md` §B.2 ⑨, et `diag-reglages-inertes` garde le lien :
 * une valeur morte qui cesse d'être documentée redevient un mystère pour le
 * prochain lecteur, et c'est ce qui la fait « réparer » par quelqu'un qui croit
 * régler quelque chose.
 */
export const NE_GOUVERNENT_RIEN = [
  {
    quoi: "verification_providers.confidence_threshold de la ligne official_api (sirene_insee), valeur 9",
    pourquoi:
      "Sirene est un fournisseur de DONNÉES, pas un décideur. runVerification prend le seuil de la ligne ai_web_search ; aucun chemin ne lit celui-ci.",
  },
  {
    quoi: "la ligne claude_profile_matching (provider_type = 'profile_matching')",
    pourquoi:
      "Le moteur d'AVANT le reranking. Claude est sorti de la mise en relation : aucun code ne lit ce type. Désactivée en base, jamais supprimée — la valeur reste dans le CHECK pour que le type garde une explication.",
  },
] as const
