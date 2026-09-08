// scripts/diag-idempotence-catalogue.mjs — UNE SECONDE CRÉATION NE CRÉE RIEN.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE SCRIPT EXISTE
//   La synchronisation du catalogue s'appuyait sur `products.search` pour ne
//   pas créer deux fois le même produit. L'index de recherche de Stripe est
//   DIFFÉRÉ d'environ une minute : deux synchros quasi simultanées d'une offre
//   jamais synchronisée créaient donc DEUX produits, et la recherche n'y
//   pouvait rien.
//
//   La correction n'est pas un contournement : une clé d'idempotence DÉRIVÉE
//   supprime la fenêtre. Encore faut-il que la clé soit réellement dérivée —
//   un UUID, un horodatage, un compteur redonneraient deux créations
//   distinctes, c'est-à-dire aucune protection, sans que rien ne le signale.
//
// CE QU'IL VÉRIFIE — LE COMPORTEMENT, PAS LA PRÉSENCE D'UN MOT
//   Le cœur du script n'est pas une recherche de motif : c'est une DOUBLURE de
//   Stripe qui applique la vraie règle d'idempotence (même clé ⇒ objet déjà
//   créé renvoyé, rien de neuf), à travers laquelle on rejoue deux créations
//   sur le même slug. Un contrôle qui se contenterait de trouver la chaîne
//   « idempotencyKey » passerait sur une clé aléatoire.
//
// CE QU'IL NE VÉRIFIE PAS — à dire honnêtement
//   Il ne parle pas à Stripe. Il prouve que NOS clés sont stables et
//   discriminantes, et que les deux créations les reçoivent. Que Stripe
//   honore une clé pendant 24 h est leur contrat, pas quelque chose qu'on
//   puisse démontrer ici — et c'est précisément pourquoi `products.search`
//   reste en place pour les orphelins plus vieux que cette fenêtre.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-idempotence-catalogue.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE variable d'environnement.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cleProduit, clePrix } from '../lib/billing/idempotence.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
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
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const CATALOGUE = sansCommentaires(read('lib/billing/catalogue.ts'))
const IDEM = sansCommentaires(read('lib/billing/idempotence.ts'))

const OFFRE = {
  id: 'pkg-1',
  slug: 'pro',
  name: 'Pro',
  description: 'Offre professionnelle',
  target_role: 'client',
  currency: 'EUR',
}

console.log('\nIDEMPOTENCE DE LA SYNCHRO CATALOGUE\n')

// ═════════════════════════════════════════════════════════════════════════════
section('A. Les clés sont DÉRIVÉES et STABLES')

ok(
  cleProduit(OFFRE) === cleProduit(OFFRE),
  'deux appels successifs donnent la MÊME clé de produit',
  'Une clé qui change d’un appel à l’autre n’offre aucune protection.',
)
ok(
  cleProduit(OFFRE) === cleProduit({ ...OFFRE }),
  'la clé ne dépend que des VALEURS, pas de l’objet passé',
)
ok(
  clePrix({ slug: 'pro', productId: 'prod_A', currency: 'EUR', unitAmount: 2900 }) ===
    clePrix({ slug: 'pro', productId: 'prod_A', currency: 'eur', unitAmount: 2900 }),
  'la devise est normalisée : EUR et eur donnent la même clé',
)

// Aucune source d'aléa ni de temps dans le module : c'est ce qui rend la
// stabilité structurelle, et non observée par chance sur deux appels rapprochés.
for (const interdit of ['randomUUID', 'Math.random', 'Date.now', 'new Date', 'randomBytes']) {
  ok(!IDEM.includes(interdit), `le module n’utilise pas ${interdit}`)
}

// ═════════════════════════════════════════════════════════════════════════════
section('B. Les clés DISCRIMINENT ce qui doit l’être')

ok(
  cleProduit(OFFRE) !== cleProduit({ ...OFFRE, slug: 'starter' }),
  'deux offres différentes ont des clés de produit différentes',
  'Une clé partagée ferait renvoyer le produit d’une AUTRE offre.',
)
ok(
  cleProduit(OFFRE) !== cleProduit({ ...OFFRE, name: 'Pro Plus' }),
  'un renommage donne une clé différente',
  'Stripe REFUSE une clé déjà vue avec d’autres paramètres : même clé + autre nom = erreur dure.',
)
ok(
  clePrix({ slug: 'pro', productId: 'prod_A', currency: 'EUR', unitAmount: 2900 }) !==
    clePrix({ slug: 'pro', productId: 'prod_A', currency: 'EUR', unitAmount: 3900 }),
  'un changement de tarif donne une clé de prix différente',
  'Sinon le nouveau tarif ne créerait aucun Price — le grand-père tarifaire tomberait.',
)
ok(
  clePrix({ slug: 'pro', productId: 'prod_A', currency: 'EUR', unitAmount: 2900 }) !==
    clePrix({ slug: 'pro', productId: 'prod_B', currency: 'EUR', unitAmount: 2900 }),
  'le produit porteur entre dans la clé de prix',
  'Sans lui, la clé pourrait renvoyer un prix rattaché à un produit orphelin.',
)

// Un séparateur est nécessaire : sans lui, ('ab','c') et ('a','bc') se
// confondraient, et deux offres distinctes partageraient une clé.
ok(
  cleProduit({ ...OFFRE, name: 'ab', description: 'c' }) !==
    cleProduit({ ...OFFRE, name: 'a', description: 'bc' }),
  'les champs sont séparés dans l’empreinte (aucune collision par concaténation)',
)

// ═════════════════════════════════════════════════════════════════════════════
section('C. PREUVE : une seconde création sur le même slug ne crée rien')

/**
 * Doublure de Stripe appliquant la règle réelle : une clé déjà vue renvoie
 * l'objet mémorisé sans rien créer, et la MÊME clé présentée avec d'autres
 * paramètres est REFUSÉE (c'est le comportement documenté de Stripe).
 */
function stripeDouble() {
  const vus = new Map()
  const creations = []
  const creer = (genre) => (params, opts) => {
    const cle = opts?.idempotencyKey
    if (!cle) throw new Error(`${genre} créé SANS clé d'idempotence`)
    const signature = JSON.stringify(params)
    if (vus.has(cle)) {
      const memo = vus.get(cle)
      if (memo.signature !== signature) {
        throw new Error(`clé ${cle} réutilisée avec d'autres paramètres`)
      }
      return Promise.resolve(memo.objet)
    }
    const objet = { id: `${genre}_${vus.size + 1}` }
    vus.set(cle, { signature, objet })
    creations.push({ genre, cle, id: objet.id })
    return Promise.resolve(objet)
  }
  return {
    products: { create: creer('prod') },
    prices: { create: creer('price') },
    creations,
  }
}

// Deux synchros CONCURRENTES de la même offre jamais synchronisée : elles lisent
// la même ligne, donc présentent la même clé.
{
  const s = stripeDouble()
  const params = {
    name: OFFRE.name,
    description: OFFRE.description,
    metadata: { skilloria_package_slug: OFFRE.slug },
  }
  const [a, b] = await Promise.all([
    s.products.create(params, { idempotencyKey: cleProduit(OFFRE) }),
    s.products.create(params, { idempotencyKey: cleProduit(OFFRE) }),
  ])
  ok(
    s.creations.filter((c) => c.genre === 'prod').length === 1,
    'deux créations concurrentes du même produit → UN SEUL produit',
    `${s.creations.length} création(s) enregistrée(s)`,
  )
  ok(a.id === b.id, 'les deux appels reçoivent le MÊME identifiant de produit')
}

// Le même scénario sur le prix : rejouer une synchro identique ne doit pas
// empiler des Price jumeaux.
{
  const s = stripeDouble()
  const cle = clePrix({ slug: OFFRE.slug, productId: 'prod_1', currency: 'EUR', unitAmount: 2900 })
  const params = { product: 'prod_1', currency: 'eur', unit_amount: 2900 }
  await s.prices.create(params, { idempotencyKey: cle })
  await s.prices.create(params, { idempotencyKey: cle })
  ok(
    s.creations.filter((c) => c.genre === 'price').length === 1,
    'rejouer la même synchro de prix → UN SEUL price',
  )
}

// Et la démonstration inverse : une clé NON dérivée ne protège de rien. C'est
// ce que la doublure permet de montrer, plutôt que de l'affirmer.
{
  const s = stripeDouble()
  const params = { name: OFFRE.name }
  await s.products.create(params, { idempotencyKey: `alea-${1}` })
  await s.products.create(params, { idempotencyKey: `alea-${2}` })
  ok(
    s.creations.length === 2,
    'témoin : avec une clé variable, DEUX produits sont bien créés',
    'Si ce témoin passait à 1, la doublure ne prouverait plus rien.',
  )
}

// ═════════════════════════════════════════════════════════════════════════════
section('D. Les deux créations réelles présentent bien la clé')

// La forme qui AGIT : un SECOND argument passé à create, contenant la clé.
ok(
  /products\.create\([\s\S]{0,600}?\{\s*idempotencyKey:\s*cleProduit\(/.test(CATALOGUE),
  'products.create reçoit la clé dérivée du produit',
)
ok(
  /prices\.create\([\s\S]{0,700}?idempotencyKey:\s*clePrix\(/.test(CATALOGUE),
  'prices.create reçoit la clé dérivée du prix',
)
ok(
  !/idempotencyKey:\s*(crypto\.|`?\$?\{?Date|randomUUID|Math\.random)/.test(CATALOGUE),
  'aucune clé d’idempotence construite à la volée sur place',
  'Une clé calculée sur place échapperait aux contrôles de stabilité ci-dessus.',
)

// products.search reste, mais il n'est PLUS ce qui empêche le doublon. On
// vérifie qu'il n'a pas disparu (ce serait perdre la récupération longue) ET
// qu'il ne se retrouve pas seul (ce serait revenir au défaut).
ok(
  /products\.search\(/.test(CATALOGUE),
  'products.search est conservé pour la récupération au-delà de 24 h',
  'Le retirer perdrait la reprise d’un produit orphelin découvert des jours plus tard.',
)

// ═════════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ RÉSULTAT : tout est vert. Une seconde création sur le même slug ne crée pas un second produit.\n'
    : `\n❌ RÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
