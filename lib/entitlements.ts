import type { SupabaseClient } from '@supabase/supabase-js'
import { targetRoleForOrgType } from '@/lib/org-target-role'

/**
 * lib/entitlements.ts — couche DROITS du moteur commerce (Lot 2).
 *
 * Traduit la config DB (packages / package_features / organization_domains)
 * en limites exploitables par les gates (publish / unlock / auto-dévoilement),
 * et encapsule la consommation atomique des compteurs (usage_increment).
 *
 * ┌─ PRINCIPE FIGÉ : FAIL-OPEN ────────────────────────────────────────────┐
 * │ Un moteur commercial en panne ne doit JAMAIS bloquer l'usage produit.  │
 * │ Toute erreur de lecture de config/package OU d'appel RPC compteur se   │
 * │ résout en « on laisse passer » (limite null = illimité / quota=true),  │
 * │ avec un console.warn. NE PAS « corriger » ce comportement en           │
 * │ fail-closed : c'est un choix délibéré, pas un oubli.                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Aucune valeur de prix/quota n'est codée ici : tout est lu depuis la config.
 * Les seuls littéraux sont les CODES de features (contrat avec le seed Lot 1)
 * et le mapping org_type → target_role (contrat avec les CHECK de la baseline).
 */

// null = illimité partout dans ce module.
export type OrgEntitlements = {
  packageSlug: string
  limits: {
    publicationsPerMonth: number | null
    activePublicationsMax: number | null
    revealedCandidatesPerPublication: number | null
    manualUnlocksPerMonth: number | null
  }
}

// Codes features — contrat avec 20260709000001_commerce_seed.sql.
const FEATURE_PUBLICATIONS_PER_MONTH = 'publications_per_month'
const FEATURE_ACTIVE_PUBLICATIONS_MAX = 'active_publications_max'
const FEATURE_REVEALED_CANDIDATES_PER_PUBLICATION = 'revealed_candidates_per_publication'
const FEATURE_MANUAL_UNLOCKS_PER_MONTH = 'manual_unlocks_per_month'

// period_start des compteurs 'never' (cf. Lot 1). Exporté pour les futurs
// compteurs non-mensuels ; les gates monthly utilisent monthlyPeriodStart().
export const NEVER_PERIOD = '1970-01-01'

/** Entitlements « tout illimité » — valeur de repli fail-open. */
function unlimitedEntitlements(slug: string): OrgEntitlements {
  return {
    packageSlug: slug,
    limits: {
      publicationsPerMonth: null,
      activePublicationsMax: null,
      revealedCandidatesPerPublication: null,
      manualUnlocksPerMonth: null,
    },
  }
}

/**
 * Parse une `package_features.value` (varchar) en limite numérique.
 *  - 'unlimited' (ou vide / non-parseable) → null (illimité) : fail-open.
 *  - sinon parseInt base 10.
 */
function parseLimit(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const t = raw.trim().toLowerCase()
  if (t === 'unlimited' || t === '') return null
  const n = parseInt(t, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Cibles de repli acceptables pour une cible donnée, par ordre de préférence.
 *
 * ⚠ 'collaboration' n'accepte QUE 'collaboration' : une offre 'all' couvre les
 *   clients et les cabinets (deux publics ENTREPRISE), jamais l'organisation
 *   personnelle d'un expert. Sans cette exclusion, un expert dont le
 *   rattachement saute hériterait de l'offre entreprise — l'anomalie que tout
 *   ce lot ferme. Règle jumelle de `covers()` (lib/package-default.ts) et de la
 *   RPC set_default_package.
 */
function fallbackTargetsFor(targetRole: string): string[] {
  return targetRole === 'collaboration' ? ['collaboration'] : [targetRole, 'all']
}

/**
 * Premier jour du mois civil courant, en UTC (period_start des compteurs monthly).
 * date_trunc('month') côté TS via Date.UTC(y, m, 1).
 */
export function monthlyPeriodStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/**
 * Résout le package effectif d'une organisation et retourne ses limites.
 *
 * ⚠️ L'ABONNEMENT EST UNIQUE ET PARTAGÉ ENTRE TOUS LES ÉCOSYSTÈMES.
 *    Il ne prend donc AUCUN domaine en paramètre — et le paramètre a été
 *    RETIRÉ plutôt que laissé inutilisé : un argument qu'on passe et qui ne
 *    sert à rien réinstalle exactement l'ambiguïté qu'on vient de supprimer.
 *
 *    Il vivait sur `organization_domains(org, domaine)`. Dans le modèle
 *    actuel — toute organisation accède à tous les écosystèmes actifs — cette
 *    résolution produisait un DÉFAUT D'ARGENT SILENCIEUX : sur tout écosystème
 *    autre que celui d'inscription, aucune ligne n'existait, et l'organisation
 *    retombait sur l'offre GRATUITE alors qu'elle payait.
 *    Voir 20260903000000_abonnement_sur_organisation.sql.
 *
 *    Ce qui reste cloisonné par écosystème, ce sont les DONNÉES
 *    (lib/ecosystem-scope.ts), jamais les droits ni le quota.
 *
 * Package effectif = organizations.package_id :
 *   - package_id non nul ET (package_valid_until null OU dans le futur) → ce package ;
 *   - sinon → package is_default actif du catalogue (domain_id NULL) couvrant le
 *     target_role de l'org (mapping esn→cabinet) : ligne spécifique OU ligne
 *     'all' (offre unique couvrant les deux cibles), la spécifique primant.
 * 'unlimited' → limite null. Feature absente → null (illimité) + warn.
 *
 * FAIL-OPEN : toute erreur (lecture, package introuvable) → entitlements « tout
 * illimité » + console.warn. JAMAIS de throw vers l'appelant.
 */
export async function getOrgEntitlements(
  admin: SupabaseClient,
  organizationId: string,
): Promise<OrgEntitlements> {
  try {
    // 1. L'organisation porte son abonnement ET son type : UNE seule lecture.
    //    (Avant, le type était relu dans la branche de repli — un aller-retour
    //    de plus pour une information qu'on avait déjà sous la main.)
    const { data: org, error: orgErr } = await admin
      .from('organizations')
      .select('org_type, package_id, package_valid_until')
      .eq('id', organizationId)
      .maybeSingle()
    if (orgErr) {
      console.warn('[entitlements] organizations read error — fail-open', orgErr.message)
      return unlimitedEntitlements('free')
    }

    // 2. Package effectif.
    let pkgId: string | null = null
    let pkgSlug = 'free'

    const validUntil = (org?.package_valid_until as string | null | undefined) ?? null
    const subscriptionActive =
      !!org?.package_id && (validUntil == null || new Date(validUntil).getTime() > Date.now())

    if (subscriptionActive) {
      const { data: pkg } = await admin
        .from('packages')
        .select('id, slug, active')
        .eq('id', org!.package_id as string)
        .maybeSingle()
      if (pkg && (pkg.active as boolean)) {
        pkgId = pkg.id as string
        pkgSlug = pkg.slug as string
      }
    }

    // Fallback : package is_default du catalogue pour le target_role de l'org.
    if (!pkgId) {
      const targetRole = targetRoleForOrgType((org?.org_type as string | null) ?? null)
      // La cible 'all' est une offre UNIQUE couvrant client ET cabinet (pas de
      // doublon au catalogue). On accepte donc la ligne spécifique OU la ligne
      // 'all' ; si les deux existent, la ligne spécifique l'emporte (réglage
      // fin d'une cible > réglage commun). Pour 'collaboration', 'all' est
      // exclu (cf. fallbackTargetsFor).
      const { data: defs } = await admin
        .from('packages')
        .select('id, slug, target_role')
        .is('domain_id', null)
        .in('target_role', fallbackTargetsFor(targetRole))
        .eq('is_default', true)
        .eq('active', true)
      const candidates = (defs ?? []) as { id: string; slug: string; target_role: string }[]
      const def =
        candidates.find((c) => c.target_role === targetRole) ??
        candidates.find((c) => c.target_role === 'all') ??
        null
      if (def) {
        pkgId = def.id
        pkgSlug = def.slug
      }
    }

    // Aucun package résoluble (catalogue non seedé ?) → fail-open illimité.
    if (!pkgId) {
      console.warn(
        `[entitlements] no effective package for org ${organizationId} — fail-open (unlimited)`,
      )
      return unlimitedEntitlements(pkgSlug)
    }

    // 3. Limites depuis package_features.
    return await limitsForPackage(admin, pkgId, pkgSlug)
  } catch (err) {
    // FAIL-OPEN global : toute exception inattendue → illimité.
    console.warn('[entitlements] getOrgEntitlements threw — fail-open (unlimited)', err)
    return unlimitedEntitlements('free')
  }
}

/**
 * Limites d'un package donné. EXTRAIT de getOrgEntitlements sans changement de
 * comportement : mêmes replis fail-open, mêmes avertissements. Partagé avec
 * getDefaultCollaborationEntitlements ci-dessous, pour qu'un seul code lise
 * `package_features`.
 */
async function limitsForPackage(
  admin: SupabaseClient,
  pkgId: string,
  pkgSlug: string,
): Promise<OrgEntitlements> {
  const { data: feats, error: featErr } = await admin
    .from('package_features')
    .select('feature_code, value')
    .eq('package_id', pkgId)
  if (featErr) {
    console.warn('[entitlements] package_features read error — fail-open', featErr.message)
    return unlimitedEntitlements(pkgSlug)
  }
  const byCode = new Map<string, string>()
  for (const f of (feats ?? []) as { feature_code: string; value: string }[]) {
    byCode.set(f.feature_code, f.value)
  }

  const limitFor = (code: string): number | null => {
    if (!byCode.has(code)) {
      // Config incomplète = on ne bloque pas (fail-open).
      console.warn(
        `[entitlements] feature '${code}' missing for package '${pkgSlug}' — treating as unlimited`,
      )
      return null
    }
    return parseLimit(byCode.get(code))
  }

  return {
    packageSlug: pkgSlug,
    limits: {
      publicationsPerMonth: limitFor(FEATURE_PUBLICATIONS_PER_MONTH),
      activePublicationsMax: limitFor(FEATURE_ACTIVE_PUBLICATIONS_MAX),
      revealedCandidatesPerPublication: limitFor(FEATURE_REVEALED_CANDIDATES_PER_PUBLICATION),
      manualUnlocksPerMonth: limitFor(FEATURE_MANUAL_UNLOCKS_PER_MONTH),
    },
  }
}

/**
 * Droits de l'offre de collaboration PAR DÉFAUT, SANS organisation.
 *
 * Utilisé par l'écran « Mes besoins » d'un expert qui n'a jamais publié : son
 * organisation personnelle n'existe pas encore, mais les limites qu'il obtiendra
 * à sa première publication sont parfaitement connues — c'est la MÊME offre que
 * celle qu'ensurePersonalOrg lui attribuera. On lit donc le catalogue, pas une
 * supposition.
 */
export async function getDefaultCollaborationEntitlements(
  admin: SupabaseClient,
): Promise<OrgEntitlements> {
  try {
    const { data: pkg } = await admin
      .from('packages')
      .select('id, slug')
      .is('domain_id', null)
      .eq('target_role', 'collaboration')
      .eq('is_default', true)
      .eq('active', true)
      .maybeSingle()
    if (!pkg) {
      console.warn('[entitlements] no default collaboration package — fail-open (unlimited)')
      return unlimitedEntitlements('free')
    }
    return await limitsForPackage(admin, pkg.id as string, pkg.slug as string)
  } catch (err) {
    console.warn('[entitlements] getDefaultCollaborationEntitlements threw — fail-open', err)
    return unlimitedEntitlements('free')
  }
}

/**
 * Consomme atomiquement 1 unité du compteur (org, counterKey, period) sous la
 * limite `limit` via la fonction SQL usage_increment (service-role, atomique).
 *  - retourne true si consommé (AUTORISÉ), false si limite atteinte (REFUSÉ) ;
 *  - `limit` null = illimité : usage_increment incrémente et retourne true.
 *
 * FAIL-OPEN : toute erreur RPC/exception → true (on laisse passer) + warn.
 */
export async function consumeQuota(
  admin: SupabaseClient,
  orgId: string,
  counterKey: string,
  limit: number | null,
  period: Date,
): Promise<boolean> {
  try {
    const p_period = period.toISOString().slice(0, 10) // 'YYYY-MM-DD' UTC
    const { data, error } = await admin.rpc('usage_increment', {
      p_org: orgId,
      p_key: counterKey,
      p_period,
      p_limit: limit,
    })
    if (error) {
      console.warn('[entitlements] usage_increment RPC error — fail-open (allowing)', error.message)
      return true
    }
    return data === true
  } catch (err) {
    console.warn('[entitlements] consumeQuota threw — fail-open (allowing)', err)
    return true
  }
}
