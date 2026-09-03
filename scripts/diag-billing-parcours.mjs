// scripts/diag-billing-parcours.mjs — LOT 2 STRIPE : le parcours d'achat.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le parcours ne peut pas encore être exercé : le mur est fermé, aucun
//   endpoint Stripe n'existe. Ce qui le rend correct, ce sont des propriétés
//   structurelles — et celles-là se vérifient.
//
//   1. LE RETOUR DE NAVIGATION N'ACCORDE AUCUN DROIT.
//      C'est LE test qui valide toute l'architecture : payer, puis fermer le
//      navigateur AVANT la redirection. Les droits doivent être posés quand
//      même — ils le sont parce que le WEBHOOK les pose, un appel entrant qui
//      ne dépend d'aucun onglet resté ouvert.
//
//      Le jour où quelqu'un ajoute une écriture dans la route de retour, ce
//      test cesse silencieusement de passer pour les clients qui ferment leur
//      onglet — et personne ne le saura, parce que le développeur, lui, laisse
//      son navigateur ouvert. D'où ce contrôle.
//
//   2. QUI PEUT ENGAGER UNE DÉPENSE : administrateur d'organisation, garde
//      SERVEUR. Pas `editor` — engager une dépense récurrente au nom d'une
//      entreprise n'est pas du même ordre qu'éditer une annonce. Et masquer un
//      bouton ne garde rien : un POST direct passerait.
//
//   3. AUCUNE DONNÉE DE CARTE. Checkout hébergé, jamais de formulaire intégré.
//      Corollaire vérifiable : le SDK navigateur de Stripe ne doit plus être
//      une dépendance du projet.
//
//   4. LE MUR RESTE FERMÉ. Chaque route de paiement refuse en 503 sans
//      ENABLE_BILLING, et le refuse AVANT de faire quoi que ce soit.
//
//   5. LE CHANGEMENT D'OFFRE RESTE CHEZ NOUS. La configuration du portail
//      désactive explicitement sa section « changer d'offre » — en CODE, pas
//      par une case cochée dans un tableau de bord tiers qu'un tiers peut
//      décocher sans que rien ne le signale.
//
//   6. UNE DESCENTE D'OFFRE NE RETIRE RIEN AVANT L'ÉCHÉANCE. Le piège est
//      subtil : changer le prix « sans proration » semble suffire, mais
//      l'abonnement porte aussitôt le nouveau prix, l'événement part, et notre
//      webhook — fidèle à l'état absolu — poserait immédiatement l'offre
//      inférieure. Il faut un calendrier d'abonnement.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-billing-parcours.mjs        → contrôles statiques.
//                                                   AUCUN accès base.
//   node --env-file=.env.local scripts/diag-billing-parcours.mjs --db
//                                                 → + inventaire LECTURE SEULE
//                                                   (offres vendables, clients
//                                                    Stripe rattachés)
//
// LECTURE PURE : ce script n'écrit JAMAIS. Il ne contacte JAMAIS Stripe.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const exists = (p) => existsSync(join(ROOT, p))

/** Retire les commentaires : un anti-pattern doit pouvoir être DOCUMENTÉ. */
const stripJs = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`)
  }
}
const info = (l) => console.log(`  ··   ${l}`)
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const CHECKOUT = 'app/api/billing/checkout/route.ts'
const CHANGE = 'app/api/billing/change-plan/route.ts'
const PORTAL = 'app/api/billing/portal/route.ts'
const RETURN = 'app/api/billing/return/route.ts'
const PURCHASE = 'lib/billing/purchase.ts'
const ROUTES_PAYANTES = [CHECKOUT, CHANGE, PORTAL]

console.log('\nLOT 2 STRIPE — PARCOURS D’ACHAT\n')

// ─────────────────────────────────────────────────────────────────────────────
section('0. Présence des artefacts')

for (const f of [CHECKOUT, CHANGE, PORTAL, RETURN, PURCHASE, 'lib/billing/locale.ts']) {
  ok(exists(f), `${f} existe`)
}
if (!exists(RETURN)) {
  console.log('\nArrêt : la route de retour est introuvable.\n')
  process.exit(1)
}

const retour = stripJs(read(RETURN))
const checkout = stripJs(read(CHECKOUT))
const change = stripJs(read(CHANGE))
const portal = stripJs(read(PORTAL))
const purchase = stripJs(read(PURCHASE))

// ─────────────────────────────────────────────────────────────────────────────
section('1. Le retour de navigation n’accorde AUCUN droit')

// Toute forme d'écriture, et les fonctions qui en portent une.
const ECRITURES = [
  ['.insert(', 'insertion'],
  ['.update(', 'mise à jour'],
  ['.upsert(', 'upsert'],
  ['.delete(', 'suppression'],
  ['.rpc(', 'appel de fonction SQL'],
  ['applyPackageState', 'écriture des droits'],
  ['extendValidity', 'prolongation de validité'],
  ['attachCustomer', 'rattachement de client'],
  ['syncPackage', 'synchronisation catalogue'],
  ["from('transactions')", 'pièce comptable'],
  ["from('organizations')", 'organisation'],
]
const fautes = ECRITURES.filter(([m]) => retour.includes(m)).map(([, l]) => l)
ok(
  fautes.length === 0,
  'la route de retour n’écrit RIEN et ne lit aucune table',
  fautes.length
    ? `Trouvé : ${fautes.join(', ')}. Une écriture ici rendrait le retour de navigation autoritaire — un client qui ferme son onglet perdrait ce qu'il vient de payer.`
    : undefined,
)
ok(
  !/getBillingAdmin|supabaseAdmin|createClient/.test(retour),
  'la route de retour n’ouvre même pas de client base',
  "Pas de client, pas d'écriture possible : la garantie est structurelle, pas déclarative.",
)
ok(
  !/getStripe\(|stripe\./.test(retour),
  'la route de retour n’interroge pas Stripe',
  "Rien à demander : l'écran d'arrivée lit l'offre RÉELLE en base.",
)
ok(
  /Response\.redirect|NextResponse\.redirect/.test(retour),
  'la route de retour ne fait qu’une redirection',
)
// Le drapeau vient de l'URL : il ne doit jamais être recopié tel quel.
ok(
  /STATUTS|new Set\(/.test(retour) && /has\(/.test(retour),
  'le drapeau de statut est validé contre une liste fermée',
  "Un paramètre d'URL est écrit par l'utilisateur, jamais par nous.",
)

// Et l'autorité, elle, est bien ailleurs : le webhook écrit toujours.
const webhook = stripJs(read('app/api/stripe/webhook/route.ts'))
ok(
  /handleStripeEvent/.test(webhook),
  'le webhook reste le seul chemin qui applique un événement de paiement',
)

// ─────────────────────────────────────────────────────────────────────────────
section('2. Qui peut engager une dépense — garde SERVEUR')

ok(
  /role_in_org !== 'admin'/.test(purchase),
  'requireBillingAdmin exige le rôle admin d’organisation',
  "Pas `editor` : engager une dépense n'est pas éditer une annonce.",
)
ok(
  /not_org_admin/.test(purchase),
  'un code d’erreur dédié distingue le refus de rôle',
)
ok(
  /verification_status !== 'approved'/.test(purchase),
  'une organisation non approuvée ne peut pas s’abonner',
)
for (const f of ROUTES_PAYANTES) {
  const src = stripJs(read(f))
  ok(
    /requireBillingAdmin\(auth\)/.test(src),
    `${f.split('/').slice(-2)[0]} passe par la garde admin`,
  )
  // La garde doit précéder toute action : elle ne sert à rien après.
  const iGarde = src.search(/requireBillingAdmin\(auth\)/)
  const iStripe = src.search(/stripeOrRefusal\(\)/)
  ok(
    iGarde !== -1 && iStripe !== -1 && iGarde < iStripe,
    `${f.split('/').slice(-2)[0]} garde AVANT d’ouvrir Stripe`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
section('3. Aucune donnée de carte — Checkout hébergé')

const pkgJson = JSON.parse(read('package.json'))
const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) }
ok(
  !('@stripe/stripe-js' in deps),
  'le SDK NAVIGATEUR de Stripe n’est plus une dépendance',
  "Checkout hébergé ne l'exige pas : une bibliothèque cliente inutilisée sur un projet qui les interdit ne doit pas rester.",
)
ok('stripe' in deps, 'le SDK serveur reste présent (seul moyen d’appeler l’API)')
ok(
  /mode: 'subscription'/.test(checkout) && /checkout\.sessions\.create/.test(checkout),
  'la souscription passe par une session Checkout hébergée',
)
ok(
  !/card|cardNumber|payment_method_data|elements/i.test(checkout),
  'aucune manipulation de moyen de paiement côté serveur',
)
ok(
  /success_url/.test(checkout) && /cancel_url/.test(checkout),
  'les deux URL de retour sont fournies (aucun écran mort après paiement)',
)
ok(
  /client_reference_id/.test(checkout) && /subscription_data: \{ metadata \}/.test(checkout),
  'les DEUX canaux de rattachement sont posés (identifiant + métadonnées)',
  "C'est ce qui rend le webhook insensible à l'ordre de livraison.",
)

// ─────────────────────────────────────────────────────────────────────────────
section('4. Le mur reste FERMÉ')

for (const f of ROUTES_PAYANTES) {
  const src = stripJs(read(f))
  ok(/billingEnabled\(\)/.test(src), `${f.split('/').slice(-2)[0]} teste ENABLE_BILLING`)
  ok(
    /billing_disabled/.test(src) && /503/.test(src),
    `${f.split('/').slice(-2)[0]} refuse en 503 quand le mur est fermé`,
  )
  // Le verrou doit précéder la garde de rôle : on ne dit pas « vous n'êtes pas
  // admin » quand la vraie raison est que rien n'est ouvert.
  const iMur = src.search(/billingEnabled\(\)/)
  const iRole = src.search(/requireBillingAdmin\(auth\)/)
  ok(iMur !== -1 && iRole !== -1 && iMur < iRole, `${f.split('/').slice(-2)[0]} teste le mur en premier`)
}
ok(
  !/NEXT_PUBLIC_/.test(checkout + change + portal + purchase),
  'aucune variable publique dans le parcours',
)

// ─────────────────────────────────────────────────────────────────────────────
section('5. Le changement d’offre reste CHEZ NOUS')

ok(
  /subscription_update: \{ enabled: false \}/.test(portal),
  'la configuration du portail désactive le changement d’offre',
  "Laisser cette décision à une case cochée dans une interface tierce reviendrait à ne pas l'avoir prise.",
)
ok(
  /payment_method_update: \{ enabled: true \}/.test(portal) &&
    /invoice_history: \{ enabled: true \}/.test(portal),
  'le portail couvre bien le moyen de paiement et les factures',
)
ok(
  /mode: 'at_period_end'/.test(portal),
  'la résiliation depuis le portail prend effet à l’échéance',
  'Le client a payé son mois, il le garde. Aucun remboursement au libre-service.',
)
ok(
  /metadata: \{ \[CONFIG_TAG\]/.test(portal),
  'la configuration se retrouve par sa métadonnée, sans colonne en base',
)

// ─────────────────────────────────────────────────────────────────────────────
section('6. Montée immédiate, descente à l’échéance')

ok(
  /proration_behavior: 'always_invoice'/.test(change),
  'une montée d’offre facture le delta immédiatement',
)
ok(
  /subscriptionSchedules\.create/.test(change) && /subscriptionSchedules\.update/.test(change),
  'une descente d’offre passe par un CALENDRIER d’abonnement',
  "Changer le prix « sans proration » ferait porter le nouveau prix aussitôt : le webhook, fidèle à l'état absolu, retirerait des droits déjà payés.",
)
ok(
  !/proration_behavior: 'none'/.test(change),
  'aucune descente ne passe par un simple changement de prix sans proration',
  "C'est le piège exact : rien n'est facturé, mais les droits tombent tout de suite.",
)
// Le sens du changement se tranche sur le CATALOGUE, jamais sur Stripe.
ok(
  /cataloguePrice/.test(change) && !/unit_amount/.test(change),
  'montée ou descente se décide sur le catalogue local',
  "Interroger Stripe pour savoir si le client monte ou descend inverserait l'autorité.",
)
ok(
  /same_package/.test(change) && /no_subscription/.test(change),
  'les deux cas impossibles sont refusés explicitement',
)

// ─────────────────────────────────────────────────────────────────────────────
section('7. Cohérence avec les lots précédents')

ok(
  !/organization_domains/.test(purchase + checkout + change + portal + retour),
  'le parcours ne touche jamais la table de trace',
)
ok(
  /package_valid_until/.test(purchase) && /hasLiveSubscription/.test(purchase),
  'un abonnement vivant se juge sur la donnée que lit le moteur de droits',
  'Le statut Stripe n’est chez nous que de l’affichage.',
)
ok(
  /hasLiveSubscription\(state\)/.test(checkout),
  'checkout refuse une seconde souscription à une organisation déjà abonnée',
  'Une organisation en période de grâce est encore abonnée : elle paierait deux fois.',
)
ok(
  /syncPackage/.test(purchase),
  'une offre non encore synchronisée est poussée vers Stripe à la volée',
  'Le parcours est autonome : il ne dépend pas d’une action de back-office préalable.',
)
ok(
  /routing\.locales/.test(stripJs(read('lib/billing/locale.ts'))),
  'la liste des langues vient de i18n/routing, jamais recopiée',
)
ok(
  /request\.nextUrl\.origin/.test(checkout) && /request\.nextUrl\.origin/.test(retour),
  'les URL de retour dérivent de l’origine de la requête',
  "L'organisation revient sur l'écosystème d'où elle est partie ; une URL figée la déposerait ailleurs.",
)

// ─────────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--db')) {
  section('8. Base (LECTURE SEULE)')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    failures++
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents')
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false } })

    const { data: pkgs, error: pkgErr } = await db
      .from('packages')
      .select('slug, target_role, price_monthly, is_default, active, stripe_price_id_monthly')
      .order('slug')
    if (pkgErr) {
      failures++
      console.log(`  KO   lecture packages : ${pkgErr.message}`)
    } else {
      const vendables = (pkgs ?? []).filter(
        (p) => p.price_monthly !== null && !p.is_default && p.active,
      )
      ok(
        vendables.length > 0,
        `le catalogue propose ${vendables.length} offre(s) achetable(s)`,
        'Sans offre vendable, le parcours n’a rien à vendre.',
      )
      for (const p of vendables) {
        info(`  ${p.slug}/${p.target_role} — ${p.price_monthly}${p.stripe_price_id_monthly ? ' [synchronisée]' : ' [à synchroniser au 1er achat]'}`)
      }
    }

    const { count: withCustomer } = await db
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .not('stripe_customer_id', 'is', null)
    info(`organisations avec un client Stripe : ${withCustomer ?? 0}`)
    const { count: withSub } = await db
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .not('stripe_subscription_id', 'is', null)
    info(`organisations avec un abonnement : ${withSub ?? 0}`)
  }
}

console.log(
  failures === 0
    ? '\nRÉSULTAT : tout est vert. Le parcours tient, le mur reste fermé.\n'
    : `\nRÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
