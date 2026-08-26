/**
 * lib/org-target-role.ts — mapping UNIQUE `organizations.org_type` → cible
 * commerciale (`packages.target_role`).
 *
 * POURQUOI UN MODULE DÉDIÉ
 *   Ce mapping vivait recopié dans SIX endroits (entitlements, update-package,
 *   list-orgs, fiche org admin, …) et les copies avaient divergé : toutes
 *   faisaient retomber `org_type='freelance'` sur la cible `client`. Résultat :
 *   l'organisation PERSONNELLE d'un expert dont le rattachement au package
 *   sautait héritait SILENCIEUSEMENT de l'offre ENTREPRISE par défaut. Une
 *   seule implémentation, importée partout, ferme cette porte définitivement.
 *
 * AUCUN import : ce module est consommé aussi bien par des routes serveur que
 * par des composants client ('use client'), il doit rester sans dépendance.
 *
 * CONTRAT avec le CHECK `packages_target_role_check` :
 *   client | cabinet | all | collaboration
 * et avec `organizations_org_type_check` :
 *   client | cabinet | esn | freelance
 */

/** Cible commerciale d'un `org_type`. Défaut prudent : 'client'. */
export function targetRoleForOrgType(orgType: string | null | undefined): string {
  // L'organisation PERSONNELLE d'un expert (sous-traitance, Option A) vit dans
  // son propre monde commercial : elle ne doit JAMAIS retomber sur une offre
  // entreprise, même en repli.
  if (orgType === 'freelance') return 'collaboration'
  // En V1, 'esn' (prestataire) accède à la même offre que 'cabinet'.
  if (orgType === 'cabinet' || orgType === 'esn') return 'cabinet'
  return 'client'
}

/** true si l'org est une organisation PERSONNELLE d'expert (pas une entreprise). */
export function isPersonalOrgType(orgType: string | null | undefined): boolean {
  return orgType === 'freelance'
}
