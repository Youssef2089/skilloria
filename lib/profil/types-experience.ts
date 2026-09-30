// lib/profil/types-experience.ts
//
// LES TYPES D'EXPÉRIENCE — le MIROIR TypeScript de `public.types_experience()`
// (migration types_experience), la liste que lit la contrainte
// `profile_experiences_experience_type_check` (§E.88).
//
// ⚠️ CE MODULE N'A AUCUN IMPORT : `diag-parcours-expert` le charge tel quel et
//    compare cette liste, DANS LES DEUX SENS, à la fonction SQL et au schéma de
//    l'analyseur (`lib/cv-parser.ts`, `lib/cv-parser-cdi.ts`). Une liste qui
//    diverge fait rougir le contrôle — c'est ce qui manquait le jour où un test
//    a posé `'mission'`, que la table refuse.

export const TYPES_EXPERIENCE = ['career', 'project'] as const

export type TypeExperience = (typeof TYPES_EXPERIENCE)[number]

export function estTypeExperience(x: unknown): x is TypeExperience {
  return typeof x === 'string' && (TYPES_EXPERIENCE as readonly string[]).includes(x)
}
