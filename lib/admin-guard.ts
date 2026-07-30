import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

/**
 * Garde serveur pour les routes /api/admin/*.
 *
 * Décision B5/D2 : garde PER-ROUTE (pas de middleware global).
 *
 * Implémentation MODE A (cf. audit B5) : on réutilise `requireAuth` puis
 * on fait une SELECT supplémentaire sur `users.user_type` pour s'assurer
 * que le user courant est admin. Throw `AuthError(403, 'not_admin')` sinon.
 *
 * NB : `AuthContext.user` ne contient pas `user_type` (cf. lib/auth-guard.ts) —
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

  const { data: row, error } = await auth.supabaseAdmin
    .from('users')
    .select('user_type')
    .eq('id', auth.user.id)
    .maybeSingle()

  if (error) {
    console.error('[admin-guard] user_type lookup failed', {
      userId: auth.user.id,
      msg: error.message,
    })
    throw new AdminGuardError(500, { error: 'User lookup failed', code: 'lookup_failed' })
  }

  if (!row || row.user_type !== 'admin') {
    throw new AdminGuardError(403, { error: 'Admin access only', code: 'forbidden' })
  }

  return { ...auth, adminUserType: 'admin' }
}
