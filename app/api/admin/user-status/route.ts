import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'
import { generateSessionToken, setSessionToken } from '@/lib/session-token'
import {
  loadAdminActionTarget,
  refuseAdminActionOnTarget,
  refusalHttpStatus,
} from '@/lib/admin/user-actions-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/user-status — SUSPENDRE ou RÉACTIVER un compte.
 *
 * Body : { user_id, action: 'suspend' | 'reactivate' }
 * Header : `x-reauth-token` obligatoire (cf. plus bas).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SUSPENDRE = CHANGER LE STATUT **ET** ROTER LE JETON, EN UNE OPÉRATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ LA ROTATION, JAMAIS L'EFFACEMENT. Ne pas utiliser `clearSessionToken()`
 *    ici, quoi qu'en suggère son nom.
 *
 *    `clearSessionToken()` met `users.last_session_token` à NULL. Or le garde
 *    de session est écrit `if (userRow.last_session_token) { … }`
 *    (lib/auth-guard.ts, compatibilité ascendante D4) : une valeur NULL
 *    **DÉSACTIVE la vérification** au lieu de la faire échouer. L'appeler pour
 *    « déconnecter » quelqu'un produirait l'inverse du résultat voulu — la
 *    session en cours survivrait ET cesserait d'être contrôlée. C'est une
 *    régression de sécurité, pas une déconnexion.
 *
 *    La bonne primitive est `setSessionToken()` avec un jeton fraîchement
 *    généré et **transmis à personne** : le cookie du navigateur ne peut plus
 *    correspondre, tous les appareils tombent en `session_superseded` au
 *    prochain appel. C'est déjà le mécanisme de /api/me/sessions/revoke-others,
 *    à ceci près qu'on ne ré-émet aucun cookie.
 *
 *    Une suspension qui laisse vivre la session en cours ne suspend rien : le
 *    changement de statut et la rotation sont donc faits ensemble, ici, et
 *    jamais séparément.
 *
 * MESURE D'ACCÈS, PAS SANCTION COMMERCIALE (décision produit). Cette route ne
 * touche QUE `users.status` et `users.last_session_token`. Les annonces
 * publiées restent en ligne, les candidatures et le matching sont inchangés.
 * Aucune autre table n'est écrite — et ce n'est pas un oubli.
 *
 * PAS D'E-MAIL AUTOMATIQUE (décision produit) : une suspension peut être une
 * mesure conservatoire pendant une enquête ; prévenir automatiquement
 * retirerait à l'administrateur le choix du moment.
 *
 * RÉ-AUTHENTIFICATION EXIGÉE. Mécanisme EXISTANT (`requireReauth`, grant HMAC
 * de 5 min émis par /api/me/reauth) — le même que le changement d'e-mail et la
 * suppression de compte. Aucun second mécanisme.
 *
 * GARDES (lib/admin/user-actions-guard.ts) : jamais sur soi-même, jamais sur un
 * autre administrateur, jamais zéro administrateur plateforme actif.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // Ré-auth AVANT toute lecture de la cible : on ne renseigne pas un appelant
  // qui n'a pas re-prouvé son identité.
  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

  let body: { user_id?: unknown; action?: unknown }
  try {
    body = (await request.json()) as { user_id?: unknown; action?: unknown }
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const targetId = typeof body.user_id === 'string' ? body.user_id : ''
  const action = body.action === 'suspend' || body.action === 'reactivate' ? body.action : null
  if (!UUID_REGEX.test(targetId) || !action) {
    return json({ error: 'user_id and action are required', code: 'invalid_body' }, 400)
  }

  const target = await loadAdminActionTarget(auth.supabaseAdmin, targetId)
  const refusal = await refuseAdminActionOnTarget({
    supabaseAdmin: auth.supabaseAdmin,
    adminUserId: auth.user.id,
    target,
  })
  if (refusal) {
    return json({ error: refusal.message, code: refusal.code }, refusalHttpStatus(refusal))
  }
  // `target` est non-null ici (le refus `target_not_found` l'a garanti).
  const t = target!

  if (action === 'suspend' && t.status === 'suspended') {
    return json({ error: 'Already suspended', code: 'nothing_to_update' }, 400)
  }
  if (action === 'reactivate' && t.status !== 'suspended') {
    return json({ error: 'Account is not suspended', code: 'nothing_to_update' }, 400)
  }

  // ── RÉACTIVATION : à quel statut revenir ? ───────────────────────────────
  // On ne mémorise PAS le statut d'avant-suspension : ce serait une colonne de
  // plus (donc une migration) pour une information que le produit sait
  // reconstruire. Un compte expert dont le profil est en cours de validation
  // repasse en 'in_review', tous les autres en 'active'. La règle est lisible
  // et sans effet de bord : `status` ne gouverne rien d'autre que l'accès.
  let nextStatus: string = 'active'
  if (action === 'reactivate') {
    const { data: prof } = await auth.supabaseAdmin
      .from('profiles')
      .select('verification_status')
      .eq('user_id', t.id)
      .maybeSingle()
    const vs = (prof as { verification_status?: string | null } | null)?.verification_status ?? null
    if (vs === 'pending_admin_review') nextStatus = 'in_review'
  } else {
    nextStatus = 'suspended'
  }

  const { error: upErr } = await auth.supabaseAdmin
    .from('users')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', t.id)
  if (upErr) {
    console.error('[admin:user-status] update failed', upErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  // ── ROTATION (suspension uniquement) ─────────────────────────────────────
  // Cf. l'avertissement en tête : rotation, jamais effacement. Le jeton généré
  // ici n'est envoyé à personne — c'est ce qui rend toutes les sessions
  // existantes invalides.
  let rotated = false
  if (action === 'suspend') {
    const rot = await setSessionToken({
      supabaseAdmin: auth.supabaseAdmin,
      userId: t.id,
      token: generateSessionToken(),
    })
    rotated = rot.ok
    if (!rot.ok) {
      // Le statut est déjà posé, donc `requireAuth` refuse déjà toute requête :
      // l'accès EST coupé. La rotation ratée ne laisse subsister aucun droit,
      // elle prive seulement l'utilisateur du message `session_superseded`.
      // On le signale sans annuler la suspension.
      console.error('[admin:user-status] rotation failed after suspend', { targetId: t.id })
    }
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    // Convention des actions déjà tracées : domaine de l'ACTEUR (NOT NULL).
    // L'écosystème de la cible — potentiellement différent, l'admin étant
    // plateforme — est porté par `detail.target_domain_id`.
    domain_id: auth.user.domain_id,
    action: action === 'suspend' ? 'user_suspended' : 'user_reactivated',
    entity_type: 'user',
    entity_id: t.id,
    detail: {
      target_domain_id: t.domain_id,
      target_user_type: t.user_type,
      previous_status: t.status,
      new_status: nextStatus,
      session_rotated: rotated,
    },
    // Action de sécurité → on veut aussi « depuis où ».
    request,
  })

  return json({ ok: true, user_id: t.id, status: nextStatus, session_rotated: rotated }, 200)
}
