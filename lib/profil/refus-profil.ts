/**
 * lib/profil/refus-profil.ts — CHAQUE REFUS DE L'ENREGISTREMENT DU PROFIL A SON MESSAGE
 * (audit du 30/09/2026 : M9, m7).
 *
 * ═══ LE CAS ════════════════════════════════════════════════════════════════
 *   L'écran de validation ne connaissait que cinq codes de `PATCH /api/profile` ;
 *   tous les autres — `journal_error` après une publication RÉUSSIE, `bad_branch`,
 *   `liste_illisible`, `db_error`… — disaient « Erreur lors de la sauvegarde ».
 *   L'expert croyait sa soumission perdue alors que son profil était publié, ou
 *   réessayait une saisie que la base refusait pour une raison qu'on ne lui disait pas.
 *
 * ═══ LA RÈGLE ══════════════════════════════════════════════════════════════
 *   Chaque code rendu par la route a sa clé sous `profil_refus` (quatre langues). Un
 *   refus de liste (`liste_refusee`, LP001 en base) NOMME la liste, le rang et la cause ;
 *   un champ refusé NOMME le champ. Un code INCONNU est cité, jamais tu. `incomplete`
 *   n'est pas ici : l'écran le traite en surlignant les champs.
 *   Les DEUX écrans de validation et « Mon profil » l'appellent (§E.20).
 *
 * Module PUR : l'écran l'importe, `diag-parcours-expert` l'exécute contre la route.
 */

/** Code de la route → clé sous `profil_refus`. */
export const CLE_PAR_CODE: Readonly<Record<string, string>> = {
  cv_not_ready: 'cv_non_pret',
  effacement_non_declare: 'effacement',
  effacement_verification_indisponible: 'effacement',
  referentiel_indisponible: 'lecture_indisponible',
  completude_indisponible: 'lecture_indisponible',
  profil_verification_indisponible: 'lecture_indisponible',
  compte_verification_indisponible: 'lecture_indisponible',
  listes_non_ecrites: 'ecriture',
  db_error: 'ecriture',
  journal_error: 'journal',
  verification_non_deposee: 'verification_non_deposee',
  bad_branch: 'branche_inconnue',
  bad_speciality: 'specialite_inconnue',
  bad_work_zone: 'zone_inconnue',
  bad_speciality_other: 'autre_trop_long',
  liste_illisible: 'liste_illisible',
  liste_refusee: 'liste_refusee',
  champ_refuse: 'champ_refuse',
  texte_trop_long: 'texte_trop_long',
  profile_missing: 'profil_absent',
  no_fields: 'rien_a_enregistrer',
  bad_body: 'inattendu',
  no_token: 'session',
  invalid_token: 'session',
  session_superseded: 'session',
  compte_different: 'session',
  auth_error: 'inattendu',
}

/** Les listes et les causes qu'un refus de liste peut nommer (clés sous `profil_refus.listes` / `.causes`). */
export const LISTES_NOMMEES = ['experiences', 'formations', 'langues'] as const
export const CAUSES_DE_LISTE = [
  'champ_obligatoire', 'doublon', 'texte_trop_long', 'date_illisible', 'nombre_illisible',
  'fin_avant_debut', 'annee_hors_bornes', 'valeur_hors_liste', 'ligne_refusee',
  // LG001 en base : une langue hors de la liste fermée (recette du 01/10/2026, point 3).
  'langue_hors_liste',
] as const
/** Les champs qu'un refus de la base peut nommer (clés sous `profil_refus.champs`). */
export const CHAMPS_NOMMES = [
  'birth_year', 'years_total_experience', 'cdi_salary_min', 'cdi_salary_max', 'cdi_variable_pct',
  'availability', 'work_modes', 'temps_travail', 'seniorities', 'visibilite',
] as const

type Traducteur = (cle: string, valeurs?: Record<string, string | number>) => string

/** Le message d'un refus de `PATCH /api/profile`, dans la langue de l'écran. */
export function messageRefusProfil(payload: unknown, statutHttp: number, t: Traducteur): string {
  const p = (payload ?? {}) as Record<string, unknown>
  const code = typeof p.code === 'string' ? p.code : null
  const cle = code ? CLE_PAR_CODE[code] : undefined
  if (!cle) return t('inattendu', { code: code ?? `HTTP ${statutHttp}` })
  if (cle === 'liste_refusee') {
    const liste = typeof p.liste === 'string' && (LISTES_NOMMEES as readonly string[]).includes(p.liste) ? p.liste : null
    const cause = typeof p.cause === 'string' && (CAUSES_DE_LISTE as readonly string[]).includes(p.cause) ? p.cause : 'ligne_refusee'
    const rang = typeof p.rang === 'number' ? p.rang : null
    if (!liste || rang == null) return t('liste_refusee_sans_rang', { cause: t(`causes.${cause}`) })
    return t('liste_refusee', { liste: t(`listes.${liste}`), rang, cause: t(`causes.${cause}`) })
  }
  if (cle === 'champ_refuse') {
    const champ = typeof p.champ === 'string' && (CHAMPS_NOMMES as readonly string[]).includes(p.champ) ? p.champ : null
    return champ ? t('champ_refuse', { champ: t(`champs.${champ}`) }) : t('texte_trop_long')
  }
  return t(cle)
}
