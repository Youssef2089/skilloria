import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'
import { getOrgEntitlements, monthlyPeriodStart } from '@/lib/entitlements'
import { targetRoleForOrgType } from '@/lib/org-target-role'
import { billingEnabled } from '@/lib/billing/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/organisation/offre — offre effective + consommation du mois pour
 * l'organisation de l'appelant (Lot A entreprise, page « Mon offre »).
 *
 * ┌─ POURQUOI UNE ROUTE SERVEUR (et pas du client-direct) ? ────────────────┐
 * │ `usage_peek` est `revoke all from public, anon, authenticated` /        │
 * │ `grant execute to service_role` (cf. 20260709000002_usage_counters).    │
 * │ `getOrgEntitlements` lit aussi packages/package_features en service-    │
 * │ role. Ces deux appels sont donc INAPPELABLES depuis le navigateur.      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Calqué sur app/api/admin/org-usage/route.ts (même règle de domaine actif
 * unique, même pattern d'appel usage_peek), mais garde = membre de l'org
 * (tout rôle : lire son offre n'est pas une action d'admin), et l'org n'est
 * pas un paramètre — elle vient du contexte d'auth, donc pas d'IDOR possible.
 *
 * Lecture SEULE. Aucune notion de facture / paiement / moyen de paiement :
 * Stripe n'est pas branché et `transactions` est indexée sur user_id.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Admin = Awaited<ReturnType<typeof requireAuth>>['supabaseAdmin']

/**
 * `null` — ET SURTOUT PAS `0`.
 *
 *   Un compteur en panne qui affiche zéro dit « cette organisation n'a rien
 *   consommé ce mois-ci » : une phrase fausse, lue au moment précis où l'on
 *   décide de lui attribuer une offre pilote. L'écran montre « — ».
 *
 *   Le dépôt porte déjà ce choix, deux fichiers plus loin :
 *   `app/api/admin/ecosystemes/[id]/impact/route.ts` rend `null` sur le même
 *   motif, avec la même note (« un compteur en panne qui affiche zéro dirait
 *   qu'il n'y a rien à perdre »). Ici, il rendait `0` (§E.22).
 */
async function peek(admin: Admin, orgId: string, key: string, period: string): Promise<number | null> {
  const { data, error } = await admin.rpc('usage_peek', {
    p_org: orgId,
    p_key: key,
    p_period: period,
  })
  if (error) {
    console.warn('[me/organisation/offre] usage_peek error', key, error.message)
    return null
  }
  return typeof data === 'number' ? data : 0
}

/**
 * Résout la ligne `packages` correspondant à l'offre effective, UNIQUEMENT pour
 * l'AFFICHAGE (nom, prix, description). Les LIMITES restent celles renvoyées par
 * `getOrgEntitlements` (source autoritaire, fail-open).
 *
 * On ne peut pas retrouver le package par `packageSlug` seul : la contrainte
 * d'unicité est (domain_id, slug, target_role), donc le slug est ambigu. On
 * rejoue donc la même sélection en deux branches que le moteur.
 *
 * Fail-safe : toute erreur → null (la page retombe sur le slug).
 */
async function resolvePackageRow(
  admin: Admin,
  orgId: string,
  linkPackageId: string | null,
  linkValidUntil: string | null,
): Promise<{ name: string; price_monthly: number | null; currency: string } | null> {
  try {
    const linkActive =
      !!linkPackageId && (linkValidUntil == null || new Date(linkValidUntil).getTime() > Date.now())

    if (linkActive) {
      const { data: pkg, error: pkgErr } = await admin
        .from('packages')
        .select('name, price_monthly, currency, active')
        .eq('id', linkPackageId as string)
        .maybeSingle()
    // ⚠️ LE MENSONGE LE PLUS VISIBLE DU LOT, ET IL EST SUR L'ÉCRAN OÙ L'ON
    //    DÉCIDE DE RESTER OU DE RÉSILIER. L’erreur n’était pas récupérée :
    //    `pkg` tombait à `null`, on filait au repli du catalogue, et une
    //    organisation QUI PAIE lisait le nom et le prix de l'offre
    //    GRATUITE comme étant la sienne.
    //    Rien n'est perdu en base — et c'est bien le problème : rien ne
    //    signale que le chiffre affiché n’est pas le sien.
    //    On LÈVE : l’appelant rend « offre indisponible » plutôt qu’une
    //    offre qui n’est pas la bonne. Une absence se recharge ; un faux
    //    prix se croit.
    if (pkgErr) {
      console.error('[me/organisation/offre] offre souscrite ILLISIBLE', {
        packageId: linkPackageId,
        message: pkgErr.message,
      })
      throw new Error(`offre souscrite illisible — ${pkgErr.message}`)
    }
      if (pkg && pkg.active === true) {
        return {
          name: pkg.name as string,
          price_monthly: (pkg.price_monthly as number | null) ?? null,
          currency: (pkg.currency as string) ?? 'EUR',
        }
      }
    }

    // Fallback : package is_default du catalogue pour le target_role de l'org.
    const { data: org } = await admin
      .from('organizations')
      .select('org_type')
      .eq('id', orgId)
      .maybeSingle()
    const targetRole = targetRoleForOrgType((org?.org_type as string | null) ?? null)

    // Cibles de repli : la ligne spécifique, plus 'all' — SAUF pour
    // 'collaboration', qu'une offre entreprise 'all' ne couvre jamais. Même
    // règle que le moteur (lib/entitlements) et que `covers`.
    const fallbackTargets =
      targetRole === 'collaboration' ? ['collaboration'] : [targetRole, 'all']

    const { data: defs } = await admin
      .from('packages')
      .select('name, price_monthly, currency, target_role')
      .is('domain_id', null)
      .in('target_role', fallbackTargets)
      .eq('is_default', true)
      .eq('active', true)
    const candidates = (defs ?? []) as {
      name: string
      price_monthly: number | null
      currency: string
      target_role: string
    }[]
    // La ligne spécifique prime sur la ligne 'all' (même règle que le moteur).
    const def =
      candidates.find((c) => c.target_role === targetRole) ??
      candidates.find((c) => c.target_role === 'all') ??
      null
    return def
      ? { name: def.name, price_monthly: def.price_monthly ?? null, currency: def.currency ?? 'EUR' }
      : null
  } catch (err) {
    console.warn('[me/organisation/offre] resolvePackageRow threw — affichage dégradé', err)
    return null
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const org = auth.organization
  if (!org) {
    return json({ error: 'No organization', code: 'no_organization' }, 403)
  }

  // ── Abonnement de l'organisation (même source que admin/org-usage) ─────────
  //  L'ABONNEMENT VIT SUR L'ORGANISATION, plus sur le couple (org, écosystème).
  //  Une organisation accède à TOUS les écosystèmes actifs : le porter sur la
  //  ligne de rattachement produisait un défaut d'argent SILENCIEUX — partout
  //  ailleurs que sur l'écosystème d'inscription, aucune ligne, donc repli sur
  //  l'offre gratuite alors que l'organisation paie.
  //  Cf. supabase/migrations/20260903000000_abonnement_sur_organisation.sql.
  //
  //  Les deux replis `available: false` sont tombés avec le préambule : ils
  //  auraient caché son offre à une organisation qui la paie.
  const { data: target, error: subErr } = await auth.supabaseAdmin
    .from('organizations')
    .select('package_id, package_started_at, package_valid_until, stripe_subscription_status, stripe_subscription_id')
    .eq('id', org.id)
    .maybeSingle()
  if (subErr || !target) {
    console.error('[me/organisation/offre] organization lookup failed', subErr?.message ?? 'not found')
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  // ── Offre effective (fail-open) + conso du mois ────────────────────────────
  const ents = await getOrgEntitlements(auth.supabaseAdmin, org.id)
  const period = monthlyPeriodStart().toISOString().slice(0, 10)

  /**
   * LE DERNIER MONTANT RÉELLEMENT PRÉLEVÉ, lu sur `transactions`.
   *
   * Source unique du prix affiché à une organisation ABONNÉE : le catalogue dit
   * ce qu'on VEND aujourd'hui, `transactions` dit ce qu'on lui a PRIS. Les deux
   * divergent dès qu'un tarif change, puisque les `Price` Stripe sont immuables
   * et que les abonnements en cours restent sur l'ancien.
   *
   * Fail-safe : toute erreur → `null`, et l'écran dira qu'aucun montant n'est
   * connu. Jamais un repli sur le prix catalogue.
   */
  const dernierPaiement = await (async () => {
    try {
      const { data } = await auth.supabaseAdmin
        .from('transactions')
        .select('amount, currency, period_end, created_at')
        .eq('organization_id', org.id)
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!data) return null
      return {
        amount: (data.amount as number | null) ?? null,
        currency: (data.currency as string | null) ?? 'EUR',
        period_end: (data.period_end as string | null) ?? null,
        paid_at: (data.created_at as string | null) ?? null,
      }
    } catch (err) {
      console.warn('[me/organisation/offre] lecture transactions — affichage dégradé', err)
      return null
    }
  })()

  const [pkgRow, publicationsUsed, manualUnlocksUsed] = await Promise.all([
    resolvePackageRow(auth.supabaseAdmin, org.id, target.package_id, target.package_valid_until),
    peek(auth.supabaseAdmin, org.id, 'publications', period),
    peek(auth.supabaseAdmin, org.id, 'manual_unlocks', period),
  ])

  return json(
    {
      available: true,
      package: {
        slug: ents.packageSlug,
        // null → la page affiche le slug en repli.
        name: pkgRow?.name ?? null,
        price_monthly: pkgRow?.price_monthly ?? null,
        currency: pkgRow?.currency ?? 'EUR',
      },
      // null = illimité (convention entitlements.ts).
      limits: {
        publicationsPerMonth: ents.limits.publicationsPerMonth,
        activePublicationsMax: ents.limits.activePublicationsMax,
        revealedCandidatesPerPublication: ents.limits.revealedCandidatesPerPublication,
        manualUnlocksPerMonth: ents.limits.manualUnlocksPerMonth,
      },
      usage: {
        publications: publicationsUsed,
        manual_unlocks: manualUnlocksUsed,
      },
      period_start: period,
      package_started_at: target.package_started_at,
      package_valid_until: target.package_valid_until,

      // ── LE VERROU, SERVI DEPUIS LE SERVEUR ──────────────────────────────
      //  Il était parfaitement étanche, donc totalement INVISIBLE : aucun écran
      //  ne savait s'il devait montrer un mur ou une porte, et poser
      //  ENABLE_BILLING à vrai n'aurait rien changé de visible.
      //
      //  Servi ici, et JAMAIS par une variable NEXT_PUBLIC_ : une variable
      //  publique est inlinée dans le bundle navigateur — le verrou y serait
      //  lisible, et surtout l'UI pourrait diverger du serveur, qui reste seul
      //  à décider. Ce booléen n'accorde AUCUN droit : les quatre routes de
      //  paiement le retestent chacune pour leur compte.
      billing_enabled: billingEnabled(),

      // ── LE PRIX RÉELLEMENT FACTURÉ ──────────────────────────────────────
      //  Les `Price` Stripe sont IMMUABLES : une organisation abonnée à 349 €
      //  y reste même si le catalogue passe à 399 €. Afficher le prix catalogue
      //  à la place du prix payé est un litige commercial en puissance —
      //  l'organisation lit un montant qu'on ne lui prélève pas.
      //
      //  `null` = aucun encaissement enregistré. L'écran le DIT plutôt que de
      //  retomber sur le prix catalogue : ce repli-là réintroduirait exactement
      //  le défaut qu'on ferme.
      billed: dernierPaiement,

      // L'organisation est-elle ABONNÉE ? C'est ce qui décide quel prix fait
      // foi : abonnée, seul le montant prélevé compte ; non abonnée, elle est
      // sur l'offre par défaut du catalogue, et « Gratuit » est la vérité.
      has_subscription: target.stripe_subscription_id != null,

      // ── AFFICHAGE UNIQUEMENT ────────────────────────────────────────────
      //  Le statut Stripe sert au bandeau « votre dernier paiement a échoué »,
      //  et à RIEN d'autre. La colonne porte ce commentaire en base, et il est
      //  tenu ici : AUCUNE lecture de droits n'en dépend — les droits se lisent
      //  sur package_id et package_valid_until, par getOrgEntitlements.
      subscription_status: (target.stripe_subscription_status as string | null) ?? null,
    },
    200,
  )
}
