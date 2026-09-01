import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'
// L'anonymisation elle-même n'est PAS réécrite ici : c'est exactement la même
// mécanique que les deux purges planifiées (cf. § RÉUTILISATION ci-dessous).
import { purgeAccount } from '@/lib/account-purge'
import { countActiveAdmins, wouldRemoveLastAdmin } from '@/lib/org-members'
import {
  loadAdminActionTarget,
  refuseAdminActionOnTarget,
  refusalHttpStatus,
} from '@/lib/admin/user-actions-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/user-purge — SUPPRESSION DÉFINITIVE d'un compte (outil de
 * SECOURS : compte frauduleux, doublon, demande RGPD urgente).
 *
 * Body   : { user_id, confirm_email, acknowledge_org_lockout? }
 * Header : `x-reauth-token` obligatoire.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * « SUPPRESSION DÉFINITIVE » = ANONYMISATION IMMÉDIATE, PAS DELETE DE LA LIGNE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Décision produit tranchée, et le schéma ne laisse de toute façon pas le
 * choix :
 *   - `messages_sender_id_fkey` est ON DELETE **CASCADE** : supprimer la ligne
 *     effacerait les messages, donc l'historique de l'AUTRE partie. Une
 *     organisation perdrait des conversations qu'elle a réellement eues.
 *   - `audit_logs_user_id_fkey` est ON DELETE **RESTRICT** : la base REFUSERAIT
 *     la suppression d'un compte portant la moindre trace d'audit — c'est-à-dire
 *     tous. La preuve du traitement (RGPD art. 5.2) est protégée par le schéma.
 *
 * Différence avec la suppression en self-service (/api/me/account/delete) :
 * AUCUN délai de grâce de 90 jours, l'effet est immédiat.
 *
 * ═══ RÉUTILISATION, PAS SECONDE MÉCANIQUE ══════════════════════════════════
 *   `purgeAccount` (lib/account-purge.ts) est appelée TELLE QUELLE — la même
 *   fonction que /api/cron/purge-deletions et /api/cron/purge-inactive. Elle a
 *   été corrigée (status 'archived' admis par `users_status_check`) et on sait
 *   qu'elle aboutit. Écrire ici un second effacement, c'est garantir que les
 *   deux divergeront : c'est déjà l'histoire de `deriveCandidatureLifecycle`
 *   sur ce projet.
 *
 *   ⚠️ JAMAIS `auth.admin.deleteUser` : cf. le CASCADE sur messages ci-dessus.
 *      `purgeAccount` bannit le compte ~100 ans et libère l'e-mail, elle ne le
 *      supprime pas.
 *
 * ═══ TROIS BARRIÈRES, DE TROIS NATURES DIFFÉRENTES ═════════════════════════
 *   L'action est IRRÉVERSIBLE. La suspension s'annule, pas celle-ci. Trois
 *   verrous, et aucun n'est un doublon de l'autre :
 *
 *   1. IDENTITÉ — `requireReauth` : le mécanisme EXISTANT (grant HMAC 5 min
 *      émis par /api/me/reauth), le même que la suspension et le changement
 *      d'e-mail. Aucun second mécanisme.
 *   2. ATTENTION — `confirm_email` : l'administrateur retape l'adresse de la
 *      CIBLE, et le SERVEUR la compare. Ce n'est pas une garde d'UI : un appel
 *      forgé qui omet le champ est refusé ici. Une double modale n'engage rien
 *      — deux clics au lieu d'un ; retaper une adresse force à lire QUI on
 *      efface. C'est la seule barrière qui adresse l'erreur de cible.
 *   3. RÈGLE MÉTIER — `refuseAdminActionOnTarget` : jamais sur soi-même,
 *      jamais sur un autre administrateur. GARDE PARTAGÉE, importée, pas
 *      réécrite — la même que user-status, user-revoke-session, user-org-role.
 *
 *   Pas de délai d'annulation : un irréversible différé, c'est la suppression
 *   self-service et ses 90 jours, qui existe déjà. Le sens de CETTE action est
 *   l'immédiateté.
 *
 * ═══ DERNIER ADMIN D'UNE ORGANISATION : AVERTIR, PAS BLOQUER ═══════════════
 *   Bloquer subordonnerait un droit RGPD (art. 17) à une structure
 *   d'organisation — inacceptable. On AVERTIT, et on exige un acquittement
 *   explicite (`acknowledge_org_lockout`), REVALIDÉ ICI : sans lui, 409. Le
 *   motif part dans l'audit, avec les organisations concernées.
 *
 *   Le prédicat est `wouldRemoveLastAdmin`, le MÊME que l'anti-lock-out des
 *   organisations et que celui de la plateforme. Trois échelles, un seul
 *   raisonnement.
 *
 *   ⚠️ Cet avertissement est BEST-EFFORT par construction : `countActiveAdmins`
 *      renvoie un compte prudent (2) si sa lecture échoue, ce qui ferait taire
 *      l'avertissement. C'est acceptable ICI, et seulement ici, parce que c'est
 *      un AVERTISSEMENT et non une garde : aucune des trois barrières ci-dessus
 *      n'en dépend.
 *
 * ═══ TRAÇABILITÉ ═══════════════════════════════════════════════════════════
 *   `purgeAccount` écrit déjà `account_purged` avec `user_id` = LA CIBLE. Elle
 *   dit QUE c'est arrivé, pas QUI l'a fait. On ajoute donc
 *   `admin_account_purged` avec `user_id` = L'ADMINISTRATEUR AGISSANT, plus
 *   l'IP et le user-agent (action de sécurité).
 *
 *   AUCUN e-mail dans `detail`, et ce n'est pas seulement de la prudence :
 *   l'adresse est précisément la donnée qu'on efface. L'écrire au journal
 *   annulerait la purge qu'on est en train de tracer. `entity_id` identifie la
 *   cible — c'est tout ce que l'accountability réclame.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Comparaison d'adresses : casse et espaces ne doivent pas faire échouer. */
function normalizeEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

type LockedOutOrg = { id: string; company_name: string | null }

/**
 * Organisations que la purge de `targetUserId` laisserait SANS administrateur
 * joignable. Lecture pure.
 *
 * `countActiveAdmins` compte les administrateurs DISPONIBLES, cible incluse
 * (elle l'est encore : elle n'est pas anonymisée à cet instant). On pose donc
 * exactement la question de `wouldRemoveLastAdmin` — « retirer cette cible
 * viderait-il le dernier admin actif ? » — sans réécrire le prédicat.
 */
async function organizationsLeftWithoutAdmin(
  supabaseAdmin: Parameters<typeof countActiveAdmins>[0],
  targetUserId: string,
): Promise<LockedOutOrg[]> {
  const { data: memberships, error } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, organizations(id, company_name)')
    .eq('user_id', targetUserId)
    .eq('role_in_org', 'admin')
    .eq('status', 'active')
  if (error) {
    console.warn('[admin:user-purge] memberships lookup failed', error.message)
    return []
  }

  const out: LockedOutOrg[] = []
  for (const row of memberships ?? []) {
    const orgId = (row as { organization_id: string }).organization_id
    const rel = (row as { organizations: unknown }).organizations
    const org = (Array.isArray(rel) ? rel[0] : rel) as
      | { id: string; company_name: string | null }
      | null
    const available = await countActiveAdmins(supabaseAdmin, orgId)
    if (wouldRemoveLastAdmin({ targetIsActiveAdmin: true, activeAdminCount: available })) {
      out.push({ id: orgId, company_name: org?.company_name ?? null })
    }
  }
  return out
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // BARRIÈRE 1 — identité. AVANT toute lecture de la cible : on ne renseigne
  // pas un appelant qui n'a pas re-prouvé qui il est.
  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

  let body: { user_id?: unknown; confirm_email?: unknown; acknowledge_org_lockout?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const targetId = typeof body.user_id === 'string' ? body.user_id : ''
  if (!UUID_REGEX.test(targetId)) {
    return json({ error: 'user_id is required', code: 'invalid_body' }, 400)
  }

  // BARRIÈRE 3 — règle métier. Garde PARTAGÉE, jamais réécrite.
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

  // BARRIÈRE 2 — attention. L'adresse retapée doit être celle de la CIBLE.
  // Revalidée ICI : le champ n'est pas une formalité d'écran.
  const typedEmail = normalizeEmail(body.confirm_email)
  const actualEmail = normalizeEmail(t.email)
  if (!typedEmail || !actualEmail || typedEmail !== actualEmail) {
    return json(
      { error: 'Confirmation email does not match the target', code: 'confirm_email_mismatch' },
      400,
    )
  }

  // Idempotence : un compte déjà anonymisé n'a plus rien à effacer. On le dit
  // plutôt que de rejouer une purge et d'écrire une seconde trace d'audit.
  const { data: stateRow, error: stateErr } = await auth.supabaseAdmin
    .from('users')
    .select('anonymized_at')
    .eq('id', t.id)
    .maybeSingle()
  if (stateErr) {
    console.error('[admin:user-purge] state lookup failed', stateErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (stateRow?.anonymized_at) {
    return json({ error: 'Account already anonymized', code: 'already_anonymized' }, 409)
  }

  // `domain_id` est NOT NULL en base ; on ne devine pas s'il manque.
  if (!t.domain_id) {
    console.error('[admin:user-purge] target without domain_id', { targetId: t.id })
    return json({ error: 'Target has no ecosystem', code: 'db_error' }, 500)
  }

  // AVERTISSEMENT (pas une garde) — organisations laissées sans administrateur.
  const lockedOutOrgs = await organizationsLeftWithoutAdmin(auth.supabaseAdmin, t.id)
  const acknowledged = body.acknowledge_org_lockout === true
  if (lockedOutOrgs.length > 0 && !acknowledged) {
    return json(
      {
        error: 'Purging this account would leave organizations without an administrator',
        code: 'org_lockout_ack_required',
        organizations: lockedOutOrgs,
      },
      409,
    )
  }

  // ── EFFACEMENT ────────────────────────────────────────────────────────────
  try {
    await purgeAccount(auth.supabaseAdmin, {
      id: t.id,
      domain_id: t.domain_id,
      email: t.email,
    })
  } catch (err) {
    // `purgeAccount` lève sur échec BLOQUANT (auth, profil, user) et n'a alors
    // PAS posé `anonymized_at` : le compte n'est pas à mi-chemin, il est
    // intact et l'opération peut être relancée telle quelle.
    console.error('[admin:user-purge] purgeAccount failed', {
      targetId: t.id,
      msg: err instanceof Error ? err.message : String(err),
    })
    return json({ error: 'Purge failed', code: 'purge_failed' }, 500)
  }

  // Traçabilité de L'AUTEUR. `purgeAccount` a déjà écrit `account_purged` sur
  // la cible : celle-ci dit que c'est arrivé, celle-là dit qui l'a décidé.
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    // Convention des actions déjà tracées : `domain_id` = domaine de l'ACTEUR
    // (colonne NOT NULL). L'écosystème de la CIBLE va dans `detail`.
    domain_id: auth.user.domain_id,
    action: 'admin_account_purged',
    entity_type: 'user',
    entity_id: t.id,
    detail: {
      target_domain_id: t.domain_id,
      target_user_type: t.user_type,
      // Motif de l'avertissement, porté au journal : on doit pouvoir répondre
      // « l'administrateur savait » six mois plus tard.
      org_lockout_acknowledged: lockedOutOrgs.length > 0 ? true : null,
      org_lockout_organization_ids:
        lockedOutOrgs.length > 0 ? lockedOutOrgs.map((o) => o.id) : null,
    },
    request,
  })

  return json({ ok: true }, 200)
}
