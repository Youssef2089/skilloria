import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * INVARIANT DE COUVERTURE du package par défaut — source unique de vérité,
 * partagée par /api/admin/set-default-package et /api/admin/create-package.
 *
 * RÈGLE SYSTÈME : chaque cible (client, cabinet) doit être couverte À TOUT
 * MOMENT par EXACTEMENT UNE offre par défaut ACTIVE — via sa ligne spécifique
 * OU via une ligne 'all' (offre unique couvrant les deux cibles). Sans cela une
 * inscription ne recevrait aucune offre (cf. lib/entitlements.ts, fallback
 * is_default).
 *
 * Le seul geste possible est le TRANSFERT : on ne décoche jamais un défaut, on
 * en désigne un autre. Conséquences :
 *  - Désigner une offre 'all'      → retire le défaut de TOUTES les lignes
 *                                    (les deux cibles sont couvertes par elle).
 *  - Désigner une offre spécifique → retire la couverture de SA cible
 *                                    uniquement. Si la ligne retirée était une
 *                                    'all', l'autre cible se retrouverait
 *                                    orpheline → REFUS 'target_uncovered'.
 */

/** Les cibles qui doivent rester couvertes en permanence. */
export const COVERAGE_TARGETS = ['client', 'cabinet'] as const
export type CoverageTarget = (typeof COVERAGE_TARGETS)[number]

/** Cibles commerciales acceptées par le CHECK packages_target_role_check. */
export const TARGET_ROLES = ['client', 'cabinet', 'all'] as const
export type TargetRole = (typeof TARGET_ROLES)[number]

export function isTargetRole(v: unknown): v is TargetRole {
  return typeof v === 'string' && (TARGET_ROLES as readonly string[]).includes(v)
}

/** Une offre de cible `targetRole` couvre-t-elle la cible `t` ? */
export function covers(targetRole: string, t: CoverageTarget): boolean {
  return targetRole === t || targetRole === 'all'
}

export type DefaultRow = { id: string; target_role: string }

export type TransferPlan =
  | { ok: true; unsetIds: string[] }
  | { ok: false; code: 'target_uncovered'; uncovered: CoverageTarget[] }

/**
 * Calcule le plan de transfert SANS écrire : quelles lignes perdent le statut
 * par défaut, et l'état résultant est-il valide ?
 *
 * `currentDefaults` = toutes les lignes is_default=true ACTIVES du catalogue.
 * `next` = l'offre qui doit devenir le défaut (déjà validée active).
 */
export function planDefaultTransfer(next: DefaultRow, currentDefaults: DefaultRow[]): TransferPlan {
  const others = currentDefaults.filter((r) => r.id !== next.id)

  // Lignes dont le statut est repris par `next` : celles qui couvrent une cible
  // que `next` couvre désormais. Une 'all' absorbe donc tous les défauts.
  const unset = others.filter((r) =>
    COVERAGE_TARGETS.some((t) => covers(next.target_role, t) && covers(r.target_role, t)),
  )
  const unsetIds = new Set(unset.map((r) => r.id))

  // État résultant : les défauts conservés + le nouveau.
  const resulting: DefaultRow[] = [...others.filter((r) => !unsetIds.has(r.id)), next]

  // Chaque cible doit être couverte exactement une fois.
  const uncovered = COVERAGE_TARGETS.filter(
    (t) => resulting.filter((r) => covers(r.target_role, t)).length !== 1,
  )
  if (uncovered.length > 0) return { ok: false, code: 'target_uncovered', uncovered }

  return { ok: true, unsetIds: [...unsetIds] }
}

export type TransferResult =
  | { ok: true; unsetIds: string[] }
  | { ok: false; status: number; code: string; uncovered?: CoverageTarget[] }

/**
 * Applique le transfert du statut par défaut vers `packageId`.
 *
 * L'ÉCRITURE est déléguée à la RPC Postgres `set_default_package` (migration
 * 20260709000005) : retrait des anciens défauts + pose du nouveau se jouent
 * dans UNE SEULE TRANSACTION, donc aucune fenêtre pendant laquelle une cible
 * serait sans offre par défaut. La RPC réapplique l'invariant côté base et
 * refuse d'elle-même ('target_uncovered') — les vérifications faites ici sont
 * un pré-contrôle, pas la garantie.
 *
 * ORDRE : (1) lit les défauts actifs courants → (2) pré-valide l'invariant (on
 * évite d'écrire un snapshot pour une opération qui sera refusée) → (3)
 * SNAPSHOT dans package_history de TOUTES les offres touchées AVANT modif →
 * (4) appel de la RPC (atomique) → (5) mapping des exceptions.
 *
 * L'appelant reste responsable de logAudit (l'action diffère selon le contexte :
 * package_default_changed vs package_created).
 */
export async function applyDefaultTransfer(
  admin: SupabaseClient,
  opts: {
    packageId: string
    targetRole: string
    userId: string
    changeReason: string
    /** Snapshot de l'offre cible si elle vient d'être créée (déjà en base). */
    includeTargetSnapshot?: boolean
  },
): Promise<TransferResult> {
  const { packageId, targetRole, userId, changeReason } = opts

  // ── (1) Défauts ACTIFS courants du catalogue ────────────────────────────────
  const { data: currentRows, error: curErr } = await admin
    .from('packages')
    .select('*')
    .eq('is_default', true)
    .eq('active', true)
  if (curErr) {
    console.error('[package-default] current defaults lookup failed', curErr.message)
    return { ok: false, status: 500, code: 'db_error' }
  }
  const current = (currentRows ?? []) as (DefaultRow & Record<string, unknown>)[]

  // ── (2) Plan + validation de l'invariant ────────────────────────────────────
  const plan = planDefaultTransfer({ id: packageId, target_role: targetRole }, current)
  if (!plan.ok) {
    return { ok: false, status: 400, code: plan.code, uncovered: plan.uncovered }
  }

  // ── (3) SNAPSHOT des offres touchées AVANT toute modif ──────────────────────
  const touched = current.filter((r) => plan.unsetIds.includes(r.id))
  const historyRows = touched.map((p) => ({
    package_id: p.id,
    snapshot: { package: p },
    changed_by: userId,
    change_reason: changeReason.slice(0, 200),
  }))
  if (opts.includeTargetSnapshot) {
    const { data: tgt } = await admin.from('packages').select('*').eq('id', packageId).maybeSingle()
    if (tgt) {
      historyRows.push({
        package_id: packageId,
        snapshot: { package: tgt },
        changed_by: userId,
        change_reason: changeReason.slice(0, 200),
      })
    }
  }
  if (historyRows.length > 0) {
    const { error: histErr } = await admin.from('package_history').insert(historyRows)
    if (histErr) {
      // On refuse d'appliquer sans trace : le snapshot est la garantie d'auditabilité.
      console.error('[package-default] history snapshot failed', histErr.message)
      return { ok: false, status: 500, code: 'db_error' }
    }
  }

  // ── (4) Transfert ATOMIQUE côté base (une seule transaction) ────────────────
  const { error: rpcErr } = await admin.rpc('set_default_package', {
    p_package_id: packageId,
  })

  // ── (5) Mapping des exceptions levées par la RPC ────────────────────────────
  if (rpcErr) {
    const msg = `${rpcErr.message ?? ''} ${rpcErr.details ?? ''}`
    if (msg.includes('target_uncovered')) {
      // La base a refusé : on recalcule les cibles orphelines pour le message.
      const replay = planDefaultTransfer({ id: packageId, target_role: targetRole }, current)
      return {
        ok: false,
        status: 400,
        code: 'target_uncovered',
        uncovered: replay.ok ? [...COVERAGE_TARGETS] : replay.uncovered,
      }
    }
    if (msg.includes('package_inactive')) {
      return { ok: false, status: 400, code: 'package_inactive' }
    }
    if (msg.includes('package_not_found')) {
      return { ok: false, status: 404, code: 'not_found' }
    }
    if (msg.includes('invariant_broken')) {
      console.error('[package-default] INVARIANT BROKEN — transaction annulée', rpcErr.message)
      return { ok: false, status: 500, code: 'invariant_broken' }
    }
    console.error('[package-default] set_default_package rpc failed', rpcErr.message)
    return { ok: false, status: 500, code: 'db_error' }
  }

  return { ok: true, unsetIds: plan.unsetIds }
}

