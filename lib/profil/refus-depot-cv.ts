/**
 * lib/profil/refus-depot-cv.ts — CHAQUE REFUS DU DÉPÔT DE CV A SON MESSAGE (§E.87, 30/09/2026).
 *
 * ═══ LE CAS MESURÉ ════════════════════════════════════════════════════════
 *   Sur staging, le dépôt du CV d'un compte d'essai a répondu « Une erreur est survenue, veuillez
 *   réessayer. ». La route avait dit `wrong_user_type` (403) : la requête partait sous le compte admin,
 *   connecté dans le même navigateur. L'écran (`/dashboard/freelance/profil`) ne connaissait que six codes ;
 *   tous les autres tombaient dans « une erreur est survenue » — et réessayer n'y changeait rien.
 *
 * ═══ LA RÈGLE ═════════════════════════════════════════════════════════════
 *   Chaque code que la route peut rendre (et ceux de `requireAuth` qui ne déclenchent pas une navigation)
 *   est ici, avec la clé de son message (`profile_upload.errors.<clé>`, quatre langues). Un code INCONNU
 *   rend `inattendu`, qui CITE le code — jamais une phrase qui ne dit rien. `diag-identite-cv` confronte
 *   cette table aux codes réellement rendus par la route.
 *
 * Module PUR : l'écran l'importe, le contrôle l'exécute.
 */

/** Code rendu par la route → clé du message sous `profile_upload.errors`. */
export const MESSAGE_PAR_CODE: Readonly<Record<string, string>> = {
  // Le fichier et le consentement
  consent_missing: 'consent_required',
  file_too_large: 'file_too_large',
  bad_mime: 'invalid_format',
  file_missing: 'fichier_absent',
  bad_body: 'fichier_absent',
  // Le compte
  no_token: 'session_expired',
  invalid_token: 'session_expired',
  session_superseded: 'session_expired',
  compte_different: 'compte_different',
  wrong_user_type: 'mauvais_type',
  user_missing: 'compte_introuvable',
  profile_missing: 'compte_introuvable',
  // Une lecture qui n'a pas abouti : ni un refus, ni un problème du fichier
  compte_verification_indisponible: 'verification_indisponible',
  profil_verification_indisponible: 'verification_indisponible',
  cache_indisponible: 'verification_indisponible',
  referentiel_indisponible: 'verification_indisponible',
  domain_lookup_failed: 'verification_indisponible',
  // L'analyse
  ai_disabled: 'ai_disabled',
  ai_budget_exhausted: 'budget',
  quota_config_missing: 'configuration',
  rate_limited: 'rate_limit',
  cv_parsing_failed: 'parsing_default',
  // L'écriture : rien n'a été modifié
  storage_error: 'stockage',
  db_error: 'ecriture',
  analyse_non_ecrite: 'ecriture',
  journal_error: 'journal',
  // La configuration du site : ce n'est pas de la personne
  ecosysteme_non_configure: 'configuration',
  unknown_user_type: 'configuration',
  auth_error: 'configuration',
  // Le dépôt lui-même (§D.30) : l'analyse est un TRAVAIL, déposé après le stockage
  depots_trop_frequents: 'depots_trop_frequents',
  depot_non_enregistre: 'ecriture',
  // L'ISSUE du travail d'analyse, lue par `cv-status` (lib/travaux-ia/executer-analyse.ts, et le repli en base).
  // Une erreur de NOTRE côté ne coûte aucune analyse à l'expert : le message le dit.
  plafond_depense: 'budget',
  quota_non_configure: 'configuration',
  configuration: 'configuration',
  document_refuse: 'document_refuse',
  reponse_illisible: 'parsing_default',
  modele_indisponible: 'modele_indisponible',
  document_absent: 'fichier_absent',
  profil_introuvable: 'compte_introuvable',
  voie_inconnue: 'mauvais_type',
  profil_illisible: 'echec_technique',
  compte_illisible: 'echec_technique',
  stockage_illisible: 'echec_technique',
  referentiel_illisible: 'echec_technique',
  quota_illisible: 'echec_technique',
  ecriture_en_panne: 'echec_technique',
  exception_interne: 'echec_technique',
  delai_depasse: 'echec_technique',
  non_execute: 'echec_technique',
}

/**
 * La clé du message pour un refus de la route. Inconnu → `inattendu` (le message cite le code).
 * @param code le `code` du corps de la réponse, s'il y en a un
 */
export function cleMessageDepotCv(code: unknown): string {
  return typeof code === 'string' && code in MESSAGE_PAR_CODE ? MESSAGE_PAR_CODE[code] : 'inattendu'
}
