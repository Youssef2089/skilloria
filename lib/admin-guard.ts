import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

/**
 * Garde serveur pour les routes /api/admin/*.
 *
 * Décision B5/D2 : garde PER-ROUTE (pas de middleware global).
 *
 * Implémentation : on réutilise `requireAuth`, qui remonte désormais
 * `user_type` dans le contexte, et on vérifie qu'il vaut 'admin'.
 *
 * LA SECONDE LECTURE A DISPARU. `requireAuth` doit connaître `user_type` pour
 * décider quels écosystèmes ce compte peut atteindre (cf.
 * `ecosystemAccessScope`) : la relire ici, c'était un aller-retour de plus
 * ET une seconde photo de la même ligne, que rien ne garantissait identique
 * à celle sur laquelle la garde d'écosystème venait de statuer.
 *
 * NB (obsolète) : `AuthContext.user` ne contenait pas `user_type` —
 * on l'ajoute ici via le retour étendu `AdminContext`.
 *
 * ⚠️ MODÈLE ADMIN = ADMIN PLATEFORME UNIQUE (décision produit D1).
 *   L'admin consulte et administre TOUS les écosystèmes (microsoft, sap,
 *   salesforce…). C'est pourquoi `requireAdmin` N'AJOUTE VOLONTAIREMENT AUCUN
 *   filtre `domain_id` : les routes /api/admin/* opèrent cross-domaine par
 *   conception. L'ABSENCE de scoping par domaine est INTENTIONNELLE.
 *   ➜ Ne PAS ajouter de scoping `domain_id` ici ni dans les routes admin sans
 *      décision produit explicite (cela casserait la vue plateforme unifiée).
 *   Corollaire (D1) : les écrans admin AFFICHENT l'écosystème de chaque entité
 *   (colonne/libellé « Écosystème ») pour que l'admin distingue les domaines.
 */

export type AdminContext = AuthContext & {
  adminUserType: 'admin'
}

export class AdminGuardError extends AuthError {}

export async function requireAdmin(request: NextRequest): Promise<AdminContext> {
  const auth = await requireAuth(request)

  if (auth.user.user_type !== 'admin') {
    throw new AdminGuardError(403, { error: 'Admin access only', code: 'forbidden' })
  }

  return { ...auth, adminUserType: 'admin' }
}
