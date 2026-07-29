/**
 * lib/collaboration-links.ts — dérivation CENTRALISÉE du lien profond de la vue
 * « candidatures d'une publication », selon le TYPE d'organisation propriétaire.
 *
 * Pourquoi une fonction dédiée (arbitrage A4) : une notification « nouvelle
 * candidature » doit pointer là où le PROPRIÉTAIRE peut réellement aller.
 *   - Org CLIENTE (client/cabinet/esn) → dashboard entreprise.
 *   - Org PERSONNELLE d'un expert (org_type='freelance') → dashboard expert,
 *     section Sous-traitance. L'expert NE PEUT PAS accéder à /dashboard/
 *     entreprise/* (guard de routage) → un lien entreprise y serait cassé.
 *
 * Le rôle expert (`freelance` vs `cdi`) est déduit du user_type du propriétaire
 * (organizations.owner_user_id). On garde ici l'UNIQUE endroit qui connaît ce
 * mapping, pour qu'aucun cas particulier ne se disperse dans les routes.
 */

/** Contexte minimal nécessaire à la dérivation. */
export type OrgLinkContext = {
  /** organizations.org_type ('client' | 'cabinet' | 'esn' | 'freelance'). */
  orgType: string | null
  /** users.user_type du propriétaire de l'org personnelle (sinon null). */
  ownerUserType: string | null
}

/**
 * Segment de dashboard expert ('freelance' | 'cdi') pour un user_type expert.
 * Défaut prudent : 'freelance' (le cas majoritaire ; un user_type inattendu
 * ne doit pas casser le lien).
 */
function expertDashboardSegment(userType: string | null): 'freelance' | 'cdi' {
  return userType === 'expert_cdi' ? 'cdi' : 'freelance'
}

/**
 * Lien vers la gestion des candidatures d'une publication, selon l'org.
 *   - freelance (org perso) → /dashboard/{role}/sous-traitance/{id}
 *   - autre (org cliente)   → /dashboard/entreprise/annonces/{id}/candidatures
 */
export function publicationCandidaturesLinkForOrg(
  publicationId: string,
  ctx: OrgLinkContext,
): string {
  if (ctx.orgType === 'freelance') {
    const role = expertDashboardSegment(ctx.ownerUserType)
    return `/dashboard/${role}/sous-traitance/${publicationId}`
  }
  return `/dashboard/entreprise/annonces/${publicationId}/candidatures`
}
