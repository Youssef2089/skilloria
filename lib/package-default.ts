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
 * ORDRE : (1) lit les défauts actifs courants → (2) planifie et valide
 * l'invariant → (3) SNAPSHOT dans package_history de TOUTES les offres touchées
 * AVANT modif → (4) retire les anciens défauts PUIS pose le nouveau → (5)
 * vérification post-état (rollback impossible sans transaction : on remonte une
 * erreur explicite plutôt que de laisser un état muet).
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

  // ── (4) Retrait des anciens PUIS pose du nouveau ────────────────────────────
  // Ordre volontaire : un instant sans défaut est préférable à deux défauts
  // concurrents sur une même cible (entitlements retomberait sur un choix
  // arbitraire).
  const now = new Date().toISOString()
  if (plan.unsetIds.length > 0) {
    const { error: unsetErr } = await admin
      .from('packages')
      .update({ is_default: false, updated_at: now })
      .in('id', plan.unsetIds)
    if (unsetErr) {
      console.error('[package-default] unset previous failed', unsetErr.message)
      return { ok: false, status: 500, code: 'db_error' }
    }
  }

  const { error: setErr } = await admin
    .from('packages')
    .update({ is_default: true, updated_at: now })
    .eq('id', packageId)
  if (setErr) {
    console.error('[package-default] set new default failed', setErr.message)
    // Rollback best-effort : sans transaction multi-requêtes, on restaure les
    // anciens défauts pour ne pas laisser une cible orpheline.
    if (plan.unsetIds.length > 0) {
      await admin
        .from('packages')
        .update({ is_default: true, updated_at: now })
        .in('id', plan.unsetIds)
    }
    return { ok: false, status: 500, code: 'db_error' }
  }

  // ── (5) Vérification post-état : chaque cible couverte exactement une fois ──
  const check = await assertCoverage(admin)
  if (!check.ok) {
    console.error('[package-default] INVARIANT BROKEN after transfer', check)
    return { ok: false, status: 500, code: 'invariant_broken' }
  }

  return { ok: true, unsetIds: plan.unsetIds }
}

/**
 * Contrôle de couverture sur l'état réel en base : chaque cible doit être
 * couverte par exactement une offre par défaut active.
 */
export async function assertCoverage(
  admin: SupabaseClient,
): Promise<{ ok: true } | { ok: false; counts: Record<string, number> }> {
  const { data, error } = await admin
    .from('packages')
    .select('id, target_role')
    .eq('is_default', true)
    .eq('active', true)
  if (error) return { ok: false, counts: {} }

  const rows = (data ?? []) as DefaultRow[]
  const counts: Record<string, number> = {}
  for (const t of COVERAGE_TARGETS) {
    counts[t] = rows.filter((r) => covers(r.target_role, t)).length
  }
  const ok = COVERAGE_TARGETS.every((t) => counts[t] === 1)
  return ok ? { ok: true } : { ok: false, counts }
}
