// lib/profil/bornes-saisie.ts
//
// LES BORNES D'UNE SAISIE DE PROFIL — celles de la BASE, posées sur les champs de
// l'écran (audit du 30/09/2026, m6).
//
// ⚠️ C'EST UN MIROIR, ET IL EST CONTRÔLÉ. Les longueurs sont celles des colonnes
//    `varchar(n)` (baseline) et les années celles des contraintes CHECK de
//    `profiles` et `profile_educations`. Un écran sans ces bornes laissait saisir un
//    téléphone de 40 caractères ou une année de naissance 1910 : la base refusait, et
//    l'expert lisait « Erreur lors de la sauvegarde », sans savoir quel champ.
//    `diag-parcours-expert` relit les migrations et rougit si une borne d'ici diverge
//    de la base. La BASE reste la barrière ; ceci ne fait que prévenir plus tôt.
//
// Module PUR, sans import : le contrôle le charge tel quel.

/** Longueur maximale, en caractères, de chaque champ texte borné en base. */
export const LONGUEURS_SAISIE = {
  // profiles
  title: 200,
  location: 100,
  linkedin_url: 500,
  phone: 30,
  address_line: 200,
  postal_code: 20,
  city: 100,
  // profile_experiences
  role: 200,
  employer: 200,
  client_name: 200,
  sector: 100,
  // profile_educations
  school: 200,
  degree: 200,
  field: 200,
  education_location: 100,
  // profile_languages
  language: 50,
} as const

/** `profiles_birth_year_check` : birth_year > 1920 et < l'année en cours. */
export const ANNEE_NAISSANCE_MIN = 1921
export const anneeNaissanceMax = (maintenant: Date = new Date()): number => maintenant.getFullYear() - 1

/** `profile_educations_start_year_check` / `_end_year_check` : > 1950 ; début < année + 1 ; fin < année + 10. */
export const ANNEE_FORMATION_MIN = 1951
export const anneeDebutFormationMax = (maintenant: Date = new Date()): number => maintenant.getFullYear()
export const anneeFinFormationMax = (maintenant: Date = new Date()): number => maintenant.getFullYear() + 9
