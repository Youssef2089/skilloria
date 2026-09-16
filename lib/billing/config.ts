import { capaciteActive } from '@/lib/interrupteurs'
import { isProduction } from '@/lib/env'

/**
 * lib/billing/config.ts — LES DEUX VERROUS, tous deux AU SERVEUR.
 *
 * ┌─ POURQUOI DEUX VERROUS ET NON UN ───────────────────────────────────────┐
 * │ Un verrou unique est un point de défaillance unique.                    │
 * │                                                                          │
 * │  VERROU 1 — L'ENVIRONNEMENT. Les clés Stripe sont scopées par           │
 * │    environnement Vercel. Clé absente = les routes de paiement répondent  │
 * │    503. En production, tant que Youssef n'a pas ouvert, il n'y a PAS de  │
 * │    clé du tout.                                                          │
 * │                                                                          │
 * │  VERROU 2 — L'INTERRUPTEUR PRODUIT `ENABLE_BILLING`. Même forme que      │
 * │    ENABLE_AI_CV_PARSING (déjà en place → 503 'ai_disabled') : aucun      │
 * │    concept nouveau. Ouvrir = poser la variable. Fermer = la retirer.     │
 * │    Un RÉGLAGE, pas un déploiement.                                       │
 * │                                                                          │
 * │ Ensemble, ouvrir la production demande DEUX actions distinctes et        │
 * │ délibérées. Aucune ne peut être faite par inadvertance.                  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ AUCUNE variable `NEXT_PUBLIC_`. Jamais. Une variable publique est
 *    inlinée dans le bundle navigateur : le verrou serait lisible, et surtout
 *    l'UI pourrait diverger du serveur. L'UI apprendra l'état du mur par une
 *    réponse serveur (Lot 3), jamais par une variable.
 *
 * ⚠️ CE MODULE NE FAIT AUCUN APPEL RÉSEAU. Il lit des variables et compare des
 *    préfixes. Il est donc appelable sur un chemin critique sans coût.
 */

/** Motifs de refus. Codes stables : ils partent dans les réponses HTTP. */
export type BillingRefusal =
  | 'billing_disabled'
  | 'billing_key_missing'
  | 'billing_key_malformed'
  | 'billing_key_env_mismatch'
  | 'billing_webhook_secret_missing'

export type BillingKey =
  | { ok: true; key: string; live: boolean }
  | { ok: false; code: BillingRefusal; detail: string }

/**
 * Mode d'une clé Stripe, déduit de son préfixe.
 *
 * Deux familles existent : les clés secrètes (`sk_`) et les clés restreintes
 * (`rk_`). On reconnaît les deux — une clé restreinte est un choix légitime et
 * même prudent. Tout le reste (une clé publiable `pk_`, une chaîne vide, un
 * copier-coller tronqué) est REFUSÉ : on ne devine pas.
 */
function keyMode(raw: string): 'live' | 'test' | null {
  if (/^(sk|rk)_live_/.test(raw)) return 'live'
  if (/^(sk|rk)_test_/.test(raw)) return 'test'
  return null
}

/**
 * L'interrupteur produit.
 *
 * LA RÈGLE N'EST PLUS ÉCRITE ICI, ELLE EST DÉLÉGUÉE. Elle l'était aussi dans
 * `lib/interrupteurs.ts`, à l'identique — la chaîne 'true' EXACTEMENT, rien
 * d'autre, fail-closed. Deux implémentations d'une même règle ne divergent
 * jamais le jour où on les écrit : elles divergent le jour où l'une des deux
 * est corrigée, et c'est alors le comportement le plus permissif qui gagne
 * silencieusement.
 *
 * CE QUI NE CHANGE PAS : le comportement, à l'identique — `ENABLE_BILLING` doit
 * valoir exactement 'true'. Cette fonction reste exportée et gardée, pour que
 * ses appelants n'aient pas à connaître le module d'interrupteurs. Le mur reste
 * fermé par défaut.
 */
export function billingEnabled(): boolean {
  return capaciteActive('ENABLE_BILLING')
}

/**
 * Résout la clé secrète Stripe, sous les deux verrous.
 *
 * ┌─ LE CONTRÔLE DE COHÉRENCE VA DANS LES DEUX SENS ────────────────────────┐
 * │ Ce n'est pas une précaution symétrique par élégance : les deux erreurs   │
 * │ sont réelles et opposées.                                                │
 * │                                                                          │
 * │  · `sk_test_` EN PRODUCTION → les clients croient payer, rien n'est      │
 * │    encaissé. On accorde des droits contre de l'argent qui n'existe pas.  │
 * │                                                                          │
 * │  · `sk_live_` HORS PRODUCTION → la campagne de test de staging débite    │
 * │    de VRAIES cartes. C'est la faute la plus coûteuse des deux, et la     │
 * │    plus facile à commettre : il suffit de copier une variable            │
 * │    d'environnement d'un projet à l'autre.                                │
 * │                                                                          │
 * │ Les deux sont refusées DUREMENT. Pas de repli, pas de dégradation : une  │
 * │ incohérence de clé n'est pas une panne, c'est une erreur de câblage, et  │
 * │ elle doit s'entendre.                                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * `isProduction()` = VERCEL_ENV === 'production' (lib/env.ts) : le staging
 * (preview) et le local sont donc « hors production » et exigent une clé test.
 */
export function resolveBillingKey(): BillingKey {
  if (!billingEnabled()) {
    return {
      ok: false,
      code: 'billing_disabled',
      detail: "ENABLE_BILLING n'est pas 'true' : le mur payant est fermé.",
    }
  }

  const raw = (process.env.STRIPE_SECRET_KEY ?? '').trim()
  if (!raw) {
    return {
      ok: false,
      code: 'billing_key_missing',
      detail: 'STRIPE_SECRET_KEY absente sur cet environnement.',
    }
  }

  const mode = keyMode(raw)
  if (mode === null) {
    return {
      ok: false,
      code: 'billing_key_malformed',
      detail: "STRIPE_SECRET_KEY ne commence ni par sk_/rk_live_ ni par sk_/rk_test_.",
    }
  }

  const prod = isProduction()
  if (prod && mode !== 'live') {
    return {
      ok: false,
      code: 'billing_key_env_mismatch',
      detail: 'Clé de TEST en PRODUCTION : les clients croiraient payer sans qu\'on encaisse.',
    }
  }
  if (!prod && mode === 'live') {
    return {
      ok: false,
      code: 'billing_key_env_mismatch',
      detail: 'Clé LIVE hors production : les tests débiteraient de vraies cartes.',
    }
  }

  return { ok: true, key: raw, live: mode === 'live' }
}

/**
 * Secret de signature du webhook.
 *
 * Il est généré par Stripe À LA CRÉATION DE L'ENDPOINT, et il y en a un PAR
 * ENDPOINT : celui de l'endpoint de test (staging) et celui de l'endpoint live
 * (production) sont DIFFÉRENTS. La variable doit donc être scopée par
 * environnement Vercel — une valeur unique partagée sur les trois environnements
 * ferait échouer la vérification de signature sur au moins l'un d'eux.
 *
 * Volontairement INDÉPENDANT de `billingEnabled()` : voir la route du webhook.
 * Sans secret on ne peut pas vérifier une signature, donc on ne peut rien
 * journaliser de fiable — on refuse AVANT de lire quoi que ce soit.
 */
export function resolveWebhookSecret():
  | { ok: true; secret: string }
  | { ok: false; code: BillingRefusal; detail: string } {
  const raw = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim()
  if (!raw) {
    return {
      ok: false,
      code: 'billing_webhook_secret_missing',
      detail: "STRIPE_WEBHOOK_SECRET absente : impossible de vérifier une signature.",
    }
  }
  return { ok: true, secret: raw }
}

/**
 * Un événement `livemode` doit arriver sur un environnement de production, et
 * un événement de test sur un environnement hors production. Sinon les
 * endpoints sont croisés — cas typique d'un copier-coller d'URL entre les deux
 * tableaux de bord Stripe.
 *
 * L'événement est alors IGNORÉ (journalisé, réponse 200) : on ne le traite pas,
 * mais on ne fait pas non plus échouer l'endpoint, ce qui le ferait désactiver.
 */
export function livemodeMatchesEnvironment(livemode: boolean): boolean {
  return livemode === isProduction()
}
