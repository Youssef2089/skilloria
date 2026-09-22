import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { resolveCatalogueKey } from '@/lib/billing/config'
import { modeDeLaCle } from '@/lib/billing/catalogue-stripe'
import { syncCatalogue } from '@/lib/billing/catalogue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// La synchronisation appelle Stripe une à trois fois PAR OFFRE. Sans plafond
// explicite, un catalogue qui grossit se ferait couper au milieu — et une
// synchro à moitié faite laisserait la moitié des offres non reliées sans que
// la réponse le dise.
export const maxDuration = 60

/**
 * POST /api/admin/synchroniser-catalogue — RELIER LE CATALOGUE À STRIPE.
 *
 * ┌─ RELIER N'EST PAS ENCAISSER (§D.16) ────────────────────────────────────┐
 * │ Cette action crée chez Stripe un `Product` et un `Price` par offre       │
 * │ vendable, et range les identifiants obtenus dans `packages_stripe`.      │
 * │                                                                          │
 * │ ELLE NE FAIT PAYER PERSONNE : aucune session de paiement n'est ouverte,  │
 * │ aucun droit n'est accordé, aucune carte n'est touchée. Elle n'exige donc │
 * │ PAS `ENABLE_BILLING` — seulement une clé Stripe valide et cohérente avec │
 * │ son environnement.                                                       │
 * │                                                                          │
 * │ Exiger le verrou d'encaissement ici créait une dépendance circulaire de  │
 * │ fait : pour ouvrir l'encaissement il faut les identifiants de prix, et   │
 * │ pour les obtenir il fallait ouvrir l'encaissement. C'est ce qui a laissé │
 * │ le catalogue NON RELIÉ.                                                  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POURQUOI UNE ROUTE DÉDIÉE, ET PAS UN EFFET DE BORD D'ÉDITION ──────────┐
 * │ L'édition d'une offre synchronise déjà (lib/billing/catalogue-guard).    │
 * │ Mais elle ne synchronise QUE l'offre éditée, et seulement si le prix a   │
 * │ changé : elle ne peut pas relier un catalogue qui ne l'a jamais été.     │
 * │                                                                          │
 * │ Surtout, « relier le catalogue » est une ACTION D'EXPLOITATION qu'on     │
 * │ exécute sciemment, dont on lit le compte rendu, et qu'on rejoue.         │
 * │ La déguiser en effet de bord d'un enregistrement de prix, c'est la       │
 * │ rendre impossible à déclencher et impossible à vérifier.                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ IDEMPOTENTE : LE SECOND CLIC NE CRÉE RIEN ─────────────────────────────┐
 * │ Chaque création porte une clé d'idempotence DÉRIVÉE (slug, produit,      │
 * │ devise, montant) : Stripe reconnaît la seconde requête et renvoie        │
 * │ l'objet de la première. Un double clic, ou deux administrateurs en même  │
 * │ temps, ne produisent pas deux produits — un doublon chez Stripe ne se    │
 * │ verrait pas dans notre base et fausserait l'écran des écarts.            │
 * │ Voir lib/billing/idempotence.ts, et son diagnostic qui EXÉCUTE les clés. │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ AUCUN MONTANT NE SE SAISIT CÔTÉ STRIPE. Le catalogue local fait autorité :
 *    les prix partent d'ici vers Stripe, jamais l'inverse. Le seul montant lu
 *    chez Stripe l'est pour COMPARER (détecter une dérive), jamais pour être
 *    écrit en base (décision figée, §C.10).
 *
 * Réponse 200 même quand des offres sont refusées ou en échec : les trois
 * issues sont rendues SÉPARÉMENT (`synchronisees`, `refusees`, `en_echec`).
 * Une offre non vendable n'est pas une panne, et les confondre ferait lire
 * « échec » sur un catalogue parfaitement sain.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(request: NextRequest) {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (e) {
    if (e instanceof AuthError) return e.toResponse()
    throw e
  }

  // LE VERROU DE CATALOGUE, ET LUI SEUL. Les trois contrôles de clé restent
  // entiers — présence, format, et cohérence clé/environnement DANS LES DEUX
  // SENS : on ne relie pas un catalogue live depuis un poste de développement,
  // et on ne relie pas un catalogue de test depuis la production.
  const cle = resolveCatalogueKey()
  if (!cle.ok) {
    return json({ error: cle.detail, code: cle.code }, 503)
  }
  const mode = modeDeLaCle(cle.live)

  let rapport
  try {
    rapport = await syncCatalogue(auth.supabaseAdmin)
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : String(err),
        code: 'synchronisation_impossible',
      },
      502,
    )
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'billing.catalogue.sync',
    entity_type: 'packages',
    entity_id: null,
    request,
    detail: {
      mode,
      synchronisees: rapport.synced.map((r) => r.slug),
      refusees: rapport.refused.map((r) => `${r.slug}: ${r.reason}`),
      en_echec: rapport.failed.map((r) => `${r.slug}: ${r.error}`),
    },
  })

  return json({
    // LE MODE EST DANS LA RÉPONSE, ET CE N'EST PAS DÉCORATIF. « 2 offres
    // reliées » sans le mode est l'énoncé exact qui rendait le passage en
    // production faux en silence.
    mode,
    synchronisees: rapport.synced.map((r) => ({
      slug: r.slug,
      price_id: r.priceIdMonthly,
      actions: r.actions,
    })),
    refusees: rapport.refused.map((r) => ({ slug: r.slug, raison: r.reason })),
    en_echec: rapport.failed.map((r) => ({ slug: r.slug, erreur: r.error })),
  })
}
