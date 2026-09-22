// scripts/diag-billing-socle.mjs — LOT 1 STRIPE : le socle serveur tient-il ?
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le lot 1 est du code qu'on ne peut pas encore exercer : le mur est fermé,
//   aucun parcours d'achat n'existe, aucun événement Stripe n'arrivera avant
//   que l'endpoint ne soit créé. Ce qui le rend correct ou faux, ce sont des
//   propriétés STRUCTURELLES du code — et elles se vérifient, elles.
//
//   Sept propriétés, chacune protégeant d'une panne connue et coûteuse :
//
//   1. LE CORPS EST LU BRUT. `request.json()` re-sérialise, et le HMAC ne
//      correspond plus : la vérification échoue sur des événements légitimes,
//      par intermittence. Piège n°1 des webhooks Stripe.
//
//   2. LA SIGNATURE EST VÉRIFIÉE AVANT TOUT ACCÈS BASE. Journaliser un corps
//      non authentifié offrirait à n'importe qui un moyen d'écrire dans notre
//      journal d'événements.
//
//   3. IDEMPOTENCE PAR LA CONTRAINTE DE BASE. La route réclame via
//      `stripe_event_claim` et ne lit JAMAIS `stripe_events` elle-même : une
//      lecture-puis-écriture rouvrirait la course entre deux livraisons.
//
//   4. UN TYPE NON GÉRÉ RÉPOND 200. Stripe désactive un endpoint qui échoue
//      trop. Répondre 4xx/5xx sur un type inconnu ferait perdre les types
//      qu'on gère.
//
//   5. LA GARDE ANTI-DÉSORDRE EST DANS LE `WHERE`. Stripe ne garantit aucun
//      ordre. Comparer en mémoire puis écrire laisse passer deux événements
//      concurrents ; laisser la base arbitrer, non.
//
//   6. LES DEUX VERROUS, DANS LES DEUX SENS, AU SERVEUR. `sk_test` en
//      production ET `sk_live` hors production sont refusés. Aucune variable
//      `NEXT_PUBLIC_` : elle serait inlinée dans le bundle navigateur.
//
//   7. LE CATALOGUE LOCAL FAIT AUTORITÉ. La synchronisation est SORTANTE :
//      aucun montant lu chez Stripe n'est jamais écrit en base.
//
//   8. LES DROITS S'ÉCRIVENT SUR L'ORGANISATION, PAS SUR LE RATTACHEMENT.
//      C'est le contrôle qui manquait, et son absence a coûté un lot entier.
//      Ce socle a d'abord été écrit contre `organization_domains`, du temps où
//      l'abonnement valait pour un couple (organisation, écosystème). Le modèle
//      a changé — un seul abonnement, partagé entre tous les écosystèmes — et
//      le webhook s'est mis à écrire dans des colonnes que le moteur de droits
//      ne lit plus.
//
//      RIEN NE L'AURAIT SIGNALÉ. Les clients Supabase du projet ne sont pas
//      typés : un UPDATE sur une colonne disparue ne lève pas. `tsc` passait,
//      le build passait, et une organisation qui paie serait restée sur l'offre
//      gratuite. Un défaut d'argent parfaitement silencieux.
//
//      Le diagnostic voisin de l'abonnement ne le voyait pas non plus : il ne
//      balaie que `app/api/**/route.ts`, jamais `lib/`. D'où ce contrôle-ci,
//      qui interdit à tout `lib/billing` de nommer la table de trace.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-billing-socle.mjs        → contrôles statiques.
//                                                AUCUN accès base.
//   node --env-file=.env.local scripts/diag-billing-socle.mjs --db
//                                              → + inventaire LECTURE SEULE
//                                                (journal d'événements, état de
//                                                 la synchronisation catalogue)
//
// LECTURE PURE : ce script n'écrit JAMAIS, dans aucun mode. Il ne contacte
// JAMAIS Stripe.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Fins de ligne NORMALISEES. Le depot sort les fichiers en CRLF : un controle
 * dont le motif traverse une fin de ligne (`...\n\s+...`) ne matche jamais sur
 * une copie de travail fraichement extraite, et le diagnostic vire au rouge
 * sans qu'aucun code n'ait change. Un diagnostic dont le resultat depend de la
 * machine qui l'execute ne dit pas si le code est juste : il dit d'ou il vient.
 */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
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

const stripSql = (src) =>
  src.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

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

const ROUTE = 'app/api/stripe/webhook/route.ts'
const BILLING = ['config', 'stripe', 'resolve', 'apply', 'events', 'catalogue'].map(
  (n) => `lib/billing/${n}.ts`,
)

console.log('\nLOT 1 STRIPE — SOCLE SERVEUR, VERROU FERMÉ\n')

// ─────────────────────────────────────────────────────────────────────────────
section('0. Présence des artefacts')

ok(exists(ROUTE), `${ROUTE} existe`)
for (const f of BILLING) ok(exists(f), `${f} existe`)
if (!exists(ROUTE)) {
  console.log('\nArrêt : la route du webhook est introuvable.\n')
  process.exit(1)
}

const route = stripJs(read(ROUTE))
const cfg = stripJs(read('lib/billing/config.ts'))
const apply = stripJs(read('lib/billing/apply.ts'))
const events = stripJs(read('lib/billing/events.ts'))
const catalogue = stripJs(read('lib/billing/catalogue.ts'))
const stripeMod = stripJs(read('lib/billing/stripe.ts'))

// ─────────────────────────────────────────────────────────────────────────────
section('1. Le corps est lu BRUT')

ok(/await\s+request\.text\(\)/.test(route), 'la route lit le corps par request.text()')
ok(
  !/request\.json\(\)/.test(route),
  'la route n\'appelle JAMAIS request.json()',
  'Un JSON re-sérialisé ne produit pas le même HMAC : la signature échouerait sur des événements légitimes.',
)

// ─────────────────────────────────────────────────────────────────────────────
section('2. Signature vérifiée AVANT tout accès base')

const iConstruct = route.search(/constructEvent\(/)
const iAdmin = route.search(/getBillingAdmin\(\)/)
ok(iConstruct !== -1, 'la signature est vérifiée par constructEvent')
ok(
  iConstruct !== -1 && iAdmin !== -1 && iConstruct < iAdmin,
  'constructEvent précède toute obtention du client base',
  'Journaliser un corps non authentifié offrirait un moyen d\'écrire dans notre journal.',
)
ok(
  /stripe-signature/.test(route) && /signature_missing/.test(route),
  'une signature absente est refusée (400) avant lecture',
)
ok(/signature_invalid/.test(route), 'une signature invalide répond 400')

// La route ne doit PAS révéler à l'appelant CE QUI a échoué dans sa signature :
// c'est renseigner un attaquant sur sa propre tentative. Le détail part au
// journal serveur, jamais dans la réponse.
//
// Le contrôle cible la SEULE ligne de retour du bloc catch, et cherche `err` en
// IDENTIFIANT (\b) : chercher la sous-chaîne « err » attrapait le mot « error »
// de la charge JSON et criait au loup sur du code correct.
const retourSignature = (route.match(/catch\s*\(err\)\s*\{[\s\S]*?(return json\([^\n]*)/) || [])[1] ?? ''
ok(
  retourSignature !== '' && !/\berr\b/.test(retourSignature),
  'le détail de l\'échec de signature n\'est pas renvoyé à l\'appelant',
  retourSignature ? `Retour fautif : ${retourSignature.trim()}` : 'bloc catch de signature introuvable',
)

// ─────────────────────────────────────────────────────────────────────────────
section('3. Idempotence par contrainte de base')

ok(/stripe_event_claim/.test(route), 'la route réclame l\'événement via stripe_event_claim')
ok(
  !/from\(['"]stripe_events['"]\)/.test(route),
  'la route ne lit ni n\'écrit stripe_events directement',
  'Toute lecture-puis-écriture rouvrirait la course entre deux livraisons simultanées.',
)
ok(
  /claimed\s*!==\s*true/.test(route) && /duplicate/.test(route),
  'un événement déjà réclamé répond 200 sans effet',
)
ok(/stripe_event_mark/.test(route), 'la route clôture le journal via stripe_event_mark')
ok(
  /'failed'/.test(route) && /handler_failed/.test(route),
  'un échec de traitement est marqué failed (donc REJOUABLE) et répond 500',
)

// ─────────────────────────────────────────────────────────────────────────────
section('4. Un type non géré répond 200')

const dflt = events.slice(events.search(/default:/))
ok(
  /status:\s*'ignored'/.test(dflt),
  'la branche par défaut de l\'aiguillage retourne ignored',
  'Un type inconnu ne doit jamais lever : Stripe désactive un endpoint qui échoue trop.',
)
// Les seuls statuts non-2xx admis, et leurs motifs.
const statuses = [...route.matchAll(/json\([^;]*?,\s*(\d{3})\)/gs)].map((m) => Number(m[1]))
const nonOk = [...new Set(statuses.filter((s) => s < 200 || s > 299))].sort()
ok(
  nonOk.every((s) => [400, 500, 503].includes(s)),
  `les seuls codes non-2xx sont 400/500/503 (trouvés : ${nonOk.join(', ') || 'aucun'})`,
)
ok(
  /ignored:\s*'billing_disabled'/.test(route) && !/billing_disabled['"]\s*\}\s*,\s*4\d\d/.test(route),
  'mur fermé : l\'événement est journalisé et la réponse reste 200',
)

// ─────────────────────────────────────────────────────────────────────────────
section("5. Les droits s'écrivent sur l'ORGANISATION")

// Le contrôle qui manquait. `organization_domains` est une TRACE HISTORIQUE
// dont le commentaire de table interdit de tirer une décision : aucun module de
// facturation ne doit la nommer, hors commentaire expliquant précisément qu'on
// ne s'en sert pas.
const nommeLaTrace = BILLING.filter(
  (f) => exists(f) && /organization_domains/.test(stripJs(read(f))),
)
ok(
  nommeLaTrace.length === 0,
  'aucun module de facturation ne touche organization_domains',
  nommeLaTrace.length
    ? `Trouvé dans : ${nommeLaTrace.join(', ')}. L'abonnement est un attribut de l'ORGANISATION ; écrire sur le rattachement est un défaut d'argent SILENCIEUX (clients Supabase non typés, aucune erreur levée).`
    : undefined,
)
// Le contrôle porte sur le CORPS de applyPackageState : le patch se construit
// avant l'appel, donc chercher `package_id` APRÈS `.from('organizations')` ne
// pouvait pas mordre. On exige les deux dans la même fonction.
const corpsApply = apply.slice(
  apply.search(/export async function applyPackageState/),
  apply.search(/export async function extendValidity/),
)
// Le contrôle vise l'UPDATE, pas le fichier : `applyPackageState` contient AUSSI
// une lecture de diagnostic sur `organizations`, si bien qu'un contrôle à la
// maille de la fonction restait vert alors que l'écriture, elle, était partie
// sur la table de trace. On exige donc `.from('organizations')` immédiatement
// suivi de `.update(`.
const ECRIT_SUR_ORG = /\.from\('organizations'\)\s*\n?\s*\.update\(/
ok(
  ECRIT_SUR_ORG.test(corpsApply) &&
    /package_id:/.test(corpsApply) &&
    /package_valid_until:/.test(corpsApply),
  'applyPackageState ÉCRIT package_id et package_valid_until sur organizations',
  'Ce sont EXACTEMENT les colonnes que getOrgEntitlements lit.',
)
ok(
  ECRIT_SUR_ORG.test(
    apply.slice(apply.search(/export async function extendValidity/), apply.search(/export async function attachCustomer/)),
  ),
  'extendValidity ÉCRIT sur organizations',
)
ok(
  !/domainId/.test(apply) && !/domainId/.test(events),
  "plus aucune notion de domaine dans l'écriture des droits",
  'Un abonnement est UNIQUE et PARTAGÉ entre tous les écosystèmes.',
)

// L'écosystème d'un paiement est une ÉTIQUETTE, pas une règle : il ne doit
// jamais faire échouer l'enregistrement d'un encaissement réel, et il ne doit
// surtout pas être déduit d'une lecture de la table de trace.
const resolveMod = stripJs(read('lib/billing/resolve.ts'))
ok(
  /export function purchaseEcosystem/.test(resolveMod),
  "l'écosystème d'achat est résolu sans lecture de table",
)
ok(
  !/purchaseEcosystem[\s\S]{0,240}?throw/.test(events),
  "un écosystème inconnu ne bloque JAMAIS l'enregistrement d'un paiement",
  "On ne refuse pas de l'argent parce qu'il manque une étiquette.",
)

section('5 bis. Garde anti-désordre dans le WHERE, pas en mémoire')

ok(
  /package_source_event_at/.test(apply),
  'apply.ts utilise package_source_event_at',
)
// LES DEUX écritures de droits doivent porter la garde, pas seulement l'une :
// un contrôle global passerait alors que `extendValidity` aurait perdu la
// sienne, et un événement retardataire pourrait encore prolonger une validité.
const GARDE = /\.or\(\s*`package_source_event_at\.is\.null,package_source_event_at\.lt\./
const corpsDe = (nom, suivant) => {
  const debut = apply.search(new RegExp(`export async function ${nom}`))
  if (debut === -1) return ''
  const fin = suivant ? apply.search(new RegExp(`export async function ${suivant}`)) : apply.length
  return apply.slice(debut, fin > debut ? fin : apply.length)
}
for (const [nom, suivant] of [
  ['applyPackageState', 'extendValidity'],
  ['extendValidity', 'attachCustomer'],
]) {
  const corps = corpsDe(nom, suivant)
  ok(
    corps !== '' && GARDE.test(corps),
    `${nom} pose la garde dans le filtre de l'UPDATE`,
    'Comparer en mémoire puis écrire laisse passer deux événements concurrents.',
  )
}
// applyPackageState : l'update doit venir AVANT toute lecture de diagnostic.
const applyBody = apply.slice(
  apply.search(/export async function applyPackageState/),
  apply.search(/export async function extendValidity/),
)
const iUpdate = applyBody.search(/\.update\(patch\)/)
const iSelect = applyBody.search(/\.select\(['"]id['"]\)\s*\n?\s*\.eq/)
ok(
  iUpdate !== -1 && (iSelect === -1 || iUpdate < iSelect),
  'applyPackageState écrit d\'abord, ne lit qu\'ensuite pour diagnostiquer',
)
ok(
  /'stale'/.test(apply) && /'no_row'/.test(apply),
  'un événement retardataire (stale) est distingué d\'une ligne absente (no_row)',
  'Les confondre ferait passer un vrai défaut pour du bruit normal.',
)

// ÉTAT ABSOLU, jamais de delta : aucune arithmétique sur les colonnes de droits.
ok(
  !/package_valid_until:\s*[^,\n]*[+\-]\s*\d/.test(apply) &&
    !/package_id:\s*[^,\n]*\+\+/.test(apply),
  'aucune dérivation par delta sur les colonnes de droits',
)

// ─────────────────────────────────────────────────────────────────────────────
section('6. Les deux verrous, dans les deux sens, au SERVEUR')

ok(/ENABLE_BILLING/.test(cfg), 'l\'interrupteur ENABLE_BILLING existe')
// LA RÈGLE A CONVERGÉ, ELLE N'A PAS CHANGÉ.
//   Cette assertion cherchait `process.env.ENABLE_BILLING === 'true'` ÉCRIT ICI.
//   La règle est désormais écrite UNE SEULE FOIS (lib/interrupteurs.ts) et
//   `billingEnabled()` y délègue — même convention, même fail-closed, mêmes
//   appelants. Exiger la copie locale reviendrait à exiger la duplication qu'on
//   vient de supprimer.
//   Ce qu'on garde, et qui est plus fort : la délégation existe, ET personne ne
//   réécrit la règle dans son coin.
ok(
  /return capaciteActive\('ENABLE_BILLING'\)/.test(cfg),
  "billingEnabled() délègue à la règle unique (lib/interrupteurs.ts)",
  'une seconde écriture de la même règle finit toujours par diverger de la première',
)
ok(
  !/process\.env\.ENABLE_BILLING/.test(cfg),
  'la règle n\'est pas RÉÉCRITE ici',
  'deux implémentations ne divergent pas le jour où on les écrit, mais le jour où l\'une est corrigée',
)
ok(/isProduction\(\)/.test(cfg), 'le contrôle s\'appuie sur isProduction() (lib/env.ts)')
ok(
  /prod\s*&&\s*mode\s*!==\s*'live'/.test(cfg),
  'clé de TEST en production : REFUSÉE',
  'Les clients croiraient payer sans qu\'on encaisse.',
)
ok(
  /!prod\s*&&\s*mode\s*===\s*'live'/.test(cfg),
  'clé LIVE hors production : REFUSÉE',
  'La campagne de test de staging débiterait de vraies cartes.',
)
ok(
  /billing_key_env_mismatch/.test(cfg),
  'un code d\'erreur dédié distingue l\'incohérence clé/environnement',
)
ok(/livemodeMatchesEnvironment/.test(cfg) && /livemodeMatchesEnvironment/.test(route),
  'un événement livemode reçu hors de son environnement est écarté')

// Aucune fuite côté client, et aucune lecture hors serveur.
const walk = (rel, out = []) => {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) return out
  if (statSync(abs).isDirectory()) {
    for (const e of readdirSync(abs)) walk(join(rel, e), out)
    return out
  }
  if (/\.(ts|tsx|mjs)$/.test(rel)) out.push(rel)
  return out
}
const sources = ['app', 'lib', 'components', 'proxy.ts', 'next.config.ts'].flatMap((p) => walk(p))

let leak = null
let clientRead = null
for (const rel of sources) {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  const m = src.match(/NEXT_PUBLIC_[A-Z_0-9]*(?:STRIPE|BILLING)[A-Z_0-9]*/)
  if (m && !leak) leak = `${rel} → ${m[0]}`
  if (/process\.env\.(?:STRIPE_[A-Z_]+|ENABLE_BILLING)/.test(src)) {
    const serveur = rel.startsWith('lib\\billing') || rel.startsWith('lib/billing')
    if (!serveur && !clientRead) clientRead = rel
  }
}
ok(leak === null, 'aucune variable NEXT_PUBLIC_ de facturation', leak ? `Fuite : ${leak}` : undefined)
ok(
  clientRead === null,
  'les variables Stripe ne sont lues que dans lib/billing',
  clientRead ? `Lecture hors lib/billing : ${clientRead}` : undefined,
)

// Un seul endroit construit un client Stripe.
const builders = sources.filter((rel) => /new Stripe\(/.test(readFileSync(join(ROOT, rel), 'utf8')))
ok(
  builders.length === 1 && /lib[\\/]billing[\\/]stripe\.ts$/.test(builders[0]),
  `un SEUL module construit un client Stripe (${builders.join(', ') || 'aucun'})`,
  'Un client construit ailleurs contournerait le contrôle de cohérence clé/environnement.',
)

// ─────────────────────────────────────────────────────────────────────────────
section('7. Le catalogue local fait autorité')

ok(
  !/price_monthly:\s/.test(catalogue.slice(catalogue.search(/\.from\('packages'\)\s*\n?\s*\.update/))),
  'la synchronisation n\'écrit JAMAIS un prix en base',
  'Le catalogue Skilloria est la source du prix ; Stripe n\'est qu\'un moyen d\'encaisser.',
)
ok(
  /stripe\.prices\.create/.test(catalogue) && /active:\s*false/.test(catalogue),
  'un changement de prix crée un NOUVEAU price et archive l\'ancien',
  'Les Price Stripe sont immuables ; les abonnements en cours restent sur l\'ancien (grand-père tarifaire).',
)
/* ⚠️ CETTE ASSERTION S'ANCRAIT SUR L'EXPRESSION, PAS SUR LA PROPRIETE.
      Elle exigeait `is_default` ET `price_monthly === null` LITTERALEMENT dans
      catalogue.ts. Le 22/09/2026, la regle de vendabilite a ete extraite dans
      lib/billing/vendabilite.ts — une seule implementation au lieu de deux
      copies divergentes (§E.20) — et cette assertion a rougi sur un
      comportement INCHANGE, voire plus strict (le prix nul ecarte desormais
      aussi le zero). C'est §E.34, dans un second controle du meme lot.

      La propriete, elle, n'a pas bouge : UNE OFFRE NON VENDABLE EST REFUSEE
      EXPLICITEMENT, avec sa raison — jamais poussee, jamais ignoree en
      silence. On verifie donc que la decision est DELEGUEE au module qui la
      porte, et que son refus remonte avec un motif. */
ok(
  /vendabilite\(/.test(catalogue) && /raisonNonVendable\(/.test(catalogue),
  'les offres non vendables sont refusées explicitement, AVEC leur raison',
  'la règle vit dans lib/billing/vendabilite.ts — une seule implémentation',
)
/* ⚠️ LA PROPRIETE A CHANGE DE LIEU, ELLE N'A PAS DISPARU — et c'est la
      troisieme fois dans ce lot qu'une assertion s'ancre la ou la regle ETAIT.

      Celle-ci exigeait que `vendabilite.ts` ecarte le tarif absent comme le
      tarif a zero. Le module ne lit PLUS AUCUN PRIX : la gratuite est
      desormais une INTENTION DECLAREE (`packages.is_free`), et c'est la BASE
      qui garantit qu'intention et prix ne se contredisent pas.

      On ne supprime donc pas l'assertion — on la deplace la ou la garantie
      vit maintenant. La supprimer aurait laissé croire que la propriete avait
      ete abandonnee ; la laisser ici la faisait rougir sur un code plus sur
      qu'avant. */
const migGratuite = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) =>
  f.endsWith('_offre_gratuite_explicite.sql'),
)
ok(migGratuite.length === 1, 'la migration de la case « gratuite » existe')
if (migGratuite.length === 1) {
  const sqlGratuite = read(`supabase/migrations/${migGratuite[0]}`)
  ok(
    /not is_free[\s\S]{0,160}?coalesce\(price_monthly, 0\) > 0/.test(sqlGratuite),
    '… et une offre NON gratuite exige un prix strictement positif, EN BASE',
    'un Price récurrent à 0,00 € n’encaisse rien et apparaîtrait pourtant comme une offre réelle',
  )
  ok(
    /\(is_free[\s\S]{0,160}?coalesce\(price_monthly, 0\) = 0/.test(sqlGratuite),
    '… et une offre gratuite ne peut porter aucun prix',
    'une offre affichée gratuite qui facture est la faute la plus chère des deux',
  )
}
ok(
  /toMinorUnits/.test(catalogue) && /toMinorUnits/.test(stripeMod),
  'la conversion euros → centimes vit dans un seul module',
)
const rawMultiply = BILLING.filter(
  (f) => exists(f) && /\*\s*100\b/.test(stripJs(read(f))) && !f.endsWith('stripe.ts'),
)
ok(
  rawMultiply.length === 0,
  'aucun « × 100 » dispersé hors du convertisseur',
  rawMultiply.length ? `Trouvé dans : ${rawMultiply.join(', ')}` : undefined,
)

// ─────────────────────────────────────────────────────────────────────────────
section('8. Le moteur commerce n\'a pas bougé')

const ent = stripJs(read('lib/entitlements.ts'))
ok(!/billing|stripe/i.test(ent), 'lib/entitlements.ts n\'importe rien de la facturation')
// Le contrat entre les lots, réécrit sur la bonne table : le moteur lit
// l'abonnement sur `organizations`, et c'est exactement là que le webhook
// l'écrit. Ce contrôle pointait `organization_domains` — il affirmait donc le
// contraire de la règle actuelle et serait resté vert sur le code fautif.
ok(
  /\.from\('organizations'\)[\s\S]{0,200}?package_id,\s*package_valid_until/.test(ent),
  'getOrgEntitlements lit package_id + package_valid_until sur organizations',
)
ok(
  !/organization_domains/.test(ent),
  'lib/entitlements.ts ne lit plus la table de trace',
)
ok(
  /package_id/.test(apply) && /package_valid_until/.test(apply),
  'le webhook écrit exactement ces deux colonnes',
  'C\'est le contrat entre les lots : Stripe se branche DERRIÈRE le moteur.',
)
for (const [file, code] of [
  ['app/api/publications/[id]/publish/route.ts', 'active_publications_limit_reached'],
  ['app/api/publications/[id]/publish/route.ts', 'quota_publications_reached'],
  ['app/api/candidatures/[id]/unlock/route.ts', 'unlock_limit_reached'],
]) {
  ok(read(file).includes(code), `gate 402 « ${code} » intacte`)
}
// Le webhook est la seule route sans requireAuth — c'est voulu, on le vérifie.
ok(!/requireAuth/.test(route), 'le webhook n\'appelle pas requireAuth (l\'appelant est Stripe)')
ok(
  /runtime = 'nodejs'/.test(route) && /force-dynamic/.test(route) && /maxDuration/.test(route),
  'la route déclare runtime nodejs, force-dynamic et maxDuration',
)

// ─────────────────────────────────────────────────────────────────────────────
section('9. Hygiène des migrations')

/**
 * Migration désignée par son SUFFIXE DESCRIPTIF, jamais par son horodatage.
 *
 * Elle était retrouvée ici par « la dernière dont le nom contient stripe » —
 * une désignation par POSITION, qui se trompe de fichier dès qu'une migration
 * Stripe s'ajoute, ou qu'un renumérotage change l'ordre. Ce dépôt vient
 * précisément d'en renuméroter une pour cause de collision entre worktrees.
 *
 * Refuse de tourner sur zéro OU deux correspondances : deux migrations au même
 * suffixe, et on ne saurait pas laquelle fait foi. Motif repris tel quel de
 * scripts/diag-cron-supervision.mjs — un second résolveur maison finirait par
 * diverger du premier.
 */
function migration(suffixe) {
  const trouves = readdirSync(join(ROOT, 'supabase', 'migrations'))
    .filter((x) => x.endsWith(`_${suffixe}.sql`))
    .sort()
  if (trouves.length !== 1) {
    console.error(
      `\n❌ ${trouves.length} migration(s) « ${suffixe} » trouvée(s)` +
        (trouves.length ? ` : ${trouves.join(', ')}` : '') +
        `\n   Attendu : exactement une. Le diagnostic ne peut rien vérifier.\n`,
    )
    process.exit(1)
  }
  return `supabase/migrations/${trouves[0]}`
}

const MIGRATION_SOCLE = migration('stripe_socle_serveur')
ok(
  exists(MIGRATION_SOCLE),
  `la migration du socle est trouvée par son suffixe (${MIGRATION_SOCLE.split('/').pop()})`,
)

// RÈGLE : ne JAMAIS citer une migration par son numéro. Le renumérotage est
// une opération normale ici ; un numéro cité vieillit mal et ment ensuite.
const citing = []
for (const rel of [...BILLING, ROUTE, 'scripts/diag-billing-socle.mjs', MIGRATION_SOCLE]) {
  if (!exists(rel)) continue
  const src = read(rel)
  // Lookarounds sur les CHIFFRES, et non `\b` : un horodatage de migration est
  // presque toujours suivi de `_` (forme AAAAMMJJhhmmss_nom.sql), et `_` est un
  // caractère de MOT — `\b20\d{12}\b` ne mordait donc jamais sur le cas réel.
  //
  // Et le contrôle scanne les COMMENTAIRES autant que le code : la règle vise
  // « un commentaire ou un diagnostic », pas seulement une chaîne exécutée.
  // Ce contrôle s'est d'ailleurs déclenché sur ce fichier-ci, où l'exemple
  // ci-dessus était écrit en chiffres — d'où sa forme littérale.
  const m = src.match(/(?<!\d)20\d{12}(?!\d)/)
  if (m) citing.push(`${rel} → ${m[0]}`)
}
ok(
  citing.length === 0,
  'aucun fichier ne référence une migration par son numéro',
  citing.length ? citing.join(' | ') : undefined,
)

const socle = read(MIGRATION_SOCLE)
const socleSql = stripSql(socle)
ok(
  /alter column user_id drop not null/i.test(socleSql),
  'transactions.user_id devient facultatif (traçabilité, pas débiteur)',
)
ok(
  /create unique index if not exists idx_packages_stripe_price_monthly/i.test(socleSql),
  'un price Stripe ne peut désigner qu\'une seule offre',
  'Sans cet index, le webhook tirerait au sort entre deux offres pour des droits payés.',
)
ok(
  /packages_default_must_be_free/.test(socleSql) && /transactions_block_delete/.test(socleSql),
  'la migration revérifie que les garanties des fondations tiennent toujours',
)
// On cherche une manipulation DDL/DML de la table, pas une mention.
// Chercher le simple nom déclenchait sur le commentaire de colonne qui dit
// « ne jamais la remplir depuis organization_domains » — c'est-à-dire sur la
// phrase même qui énonce la règle. Un contrôle qui punit la documentation de la
// règle qu'il défend finit par être désactivé.
const TOUCHE_LA_TRACE =
  /(alter\s+table|insert\s+into|update|delete\s+from|from|join|index[\s\S]{0,60}?on)\s+(public\.)?organization_domains/i
ok(
  !TOUCHE_LA_TRACE.test(socleSql),
  'la migration ne pose RIEN sur organization_domains',
  "La table est une trace historique : lui rajouter une colonne relancerait la confusion qu'on vient de fermer.",
)
ok(
  /alter column domain_id drop not null/i.test(socleSql),
  'transactions.domain_id devient facultatif (contexte, pas règle)',
  "Un renouvellement automatique ne vient d'aucune page : exiger un écosystème obligerait à en inventer un.",
)
// La garde de prérequis doit précéder TOUT DDL, sinon elle ne garde rien : une
// migration qui vérifie ses prérequis après avoir modifié le schéma a déjà
// modifié le schéma. Le contrôle exigeait seulement qu'un `information_schema`
// existe QUELQUE PART — et le bloc de vérification FINALE, en fin de fichier, le
// satisfaisait à lui seul. Il restait donc vert la garde retirée.
const iGarde = socleSql.search(/information_schema\.columns[\s\S]{0,600}?raise\s+exception/i)
const iPremierDdl = socleSql.search(/alter\s+table|create\s+(unique\s+)?index/i)
ok(
  iGarde !== -1 && iPremierDdl !== -1 && iGarde < iPremierDdl,
  "la garde de prérequis sur organizations précède tout DDL",
  'Sans elle, le socle écrirait dans des colonnes inexistantes, en silence.',
)

// ─────────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--db')) {
  section('10. Base (LECTURE SEULE)')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    failures++
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents')
    console.log('       → node --env-file=.env.local scripts/diag-billing-socle.mjs --db')
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false } })

    const { data: evs, error: evErr } = await db
      .from('stripe_events')
      .select('id, type, status, attempts, received_at')
      .order('received_at', { ascending: false })
      .limit(20)
    ok(!evErr, 'le journal stripe_events est lisible', evErr?.message)
    if (!evErr) {
      const rows = evs ?? []
      info(`journal : ${rows.length} événement(s) récent(s)`)
      const stuck = rows.filter((r) => r.status === 'received')
      const failed = rows.filter((r) => r.status === 'failed')
      ok(
        failed.length === 0,
        `aucun événement en échec (${failed.length})`,
        failed.map((r) => `${r.id} ${r.type}`).join(', ') || undefined,
      )
      ok(
        stuck.length === 0,
        `aucun événement bloqué en 'received' (${stuck.length})`,
        stuck.length
          ? 'Un received ancien = traitement interrompu. Repasser la ligne à failed pour la rejouer.'
          : undefined,
      )
    }

    // LES IDENTIFIANTS STRIPE NE VIVENT PLUS SUR `packages` : ils sont cles
    // PAR MODE dans `packages_stripe` (migration catalogue_stripe_par_mode).
    // Une offre « reliee » ne l'est que DANS UN MODE — un catalogue relie en
    // test ne l'est pas en live, et l'afficher sans le mode etait precisement
    // ce qui rendait le passage en production faux en silence.
    const { data: pkgs, error: pkgErr } = await db
      .from('packages')
      .select('id, slug, target_role, price_monthly, is_default, active')
      .order('slug')
    const { data: liaisons } = await db
      .from('packages_stripe')
      .select('package_id, mode, price_id_monthly')
    const prixDe = (id, mode) =>
      (liaisons ?? []).find((l) => l.package_id === id && l.mode === mode)?.price_id_monthly ?? null
    const MODES = ['test', 'live']
    if (pkgErr) {
      failures++
      console.log(`  KO   lecture packages : ${pkgErr.message}`)
    } else {
      const rows = pkgs ?? []
      const vendables = rows.filter((p) => p.price_monthly !== null && !p.is_default && p.active)
      for (const mode of MODES) {
        const synced = vendables.filter((p) => prixDe(p.id, mode))
        info(`catalogue [${mode}] : ${rows.length} offres, ${vendables.length} vendable(s), ${synced.length} reliée(s)`)
      }
      for (const p of rows) {
        const etat = p.is_default ? 'défaut' : p.price_monthly === null ? 'sans tarif' : `${p.price_monthly}`
        const modes = MODES.filter((m) => prixDe(p.id, m))
        info(`  ${p.slug}/${p.target_role} — ${etat}${modes.length ? ` [Stripe: ${modes.join(', ')}]` : ''}`)
      }
      for (const mode of MODES) {
        const ids = vendables.map((p) => prixDe(p.id, mode)).filter(Boolean)
        ok(
          new Set(ids).size === ids.length,
          `aucun price Stripe partagé par deux offres (mode ${mode})`,
        )
      }
    }

    const { count: txCount } = await db.from('transactions').select('id', { count: 'exact', head: true })
    info(`transactions : ${txCount ?? 0}`)
    const { count: subCount } = await db
      .from('organization_domains')
      .select('id', { count: 'exact', head: true })
      .not('stripe_subscription_id', 'is', null)
    info(`abonnements rattachés : ${subCount ?? 0}`)
  }
}

section('REJOUER UN EVENEMENT EST INOFFENSIF — la condition du bouton de reprise')

/*
 * ┌─ POURQUOI CETTE SECTION EXISTE ────────────────────────────────────────┐
 * │ `/admin/facturation` porte un bouton qui repasse un evenement coince   │
 * │ de 'received' a 'failed', pour le rendre rejouable. Il n'est acceptable │
 * │ QUE parce que rejouer est inoffensif — et ca l est aujourd hui par     │
 * │ CONSTRUCTION, pas par chance :                                          │
 * │  · on ecrit l ETAT ABSOLU, jamais un delta ;                            │
 * │  · un evenement retardataire est ecarte par un horodatage de source ;   │
 * │  · la transaction est un upsert adosse a un index unique.               │
 * │                                                                          │
 * │ UN SEPTIEME GESTIONNAIRE QUI ECRIRAIT UN DELTA CASSERAIT CETTE          │
 * │ PROPRIETE EN SILENCE, et la reprise deviendrait un double credit.       │
 * │ **Sans cette section, le bouton n existerait pas.**                      │
 * └────────────────────────────────────────────────────────────────────────┘
 */

// ⚠️ ON REUTILISE LES LIAISONS DU FICHIER PLUTOT QUE DE LES REDECLARER.
//    Une premiere version relisait les deux modules ici sous de nouveaux noms :
//    le lint a signale la copie inutilisee, et DEUX LECTURES DU MEME FICHIER
//    SOUS DEUX NOMS sont exactement la forme qui finit par diverger (§E.20).
const ecritures = `${events}\n${apply}`

// ① AUCUN DELTA. Une ecriture qui compose avec l etat anterieur ne se rejoue
//    pas : elle s'ajoute. On cherche l arithmetique ET les increments RPC.
const DELTAS = [
  { motif: /\+\+|--(?!\s*>)/, quoi: 'incrementation (`++` / `--`)' },
  { motif: /\+=|-=/, quoi: 'affectation composee (`+=` / `-=`)' },
  { motif: /\brpc\(\s*'[^']*(increment|decrement|add_|bump)/i, quoi: 'RPC d incrementation' },
  // `x: <qqch> + 1` dans une charge utile d ecriture.
  { motif: /^\s*\w+:\s*[^,\n]*\b[A-Za-z_$][\w$.?\[\]]*\s*[+-]\s*\d+\s*,?\s*$/m, quoi: 'delta dans une charge utile' },
]
for (const { motif, quoi } of DELTAS) {
  const trouve = motif.exec(ecritures)
  ok(
    trouve === null,
    `aucun ${quoi} dans le chemin d ecriture des evenements`,
    trouve ? `trouve : ${trouve[0].trim().slice(0, 80)}` : undefined,
  )
}

// ② L ETAT ABSOLU, ET LA GARDE D ORDRE. Stripe ne garantit aucun ordre : un
//    evenement retardataire ne doit jamais ecraser un plus recent, sinon un
//    rejeu ressusciterait un abonnement resilie.
ok(
  /package_source_event_at/.test(apply),
  'apply.ts porte la garde d ordre `package_source_event_at`',
  'sans elle, rejouer un evenement ancien ecrase un etat plus recent',
)
ok(
  /JAMAIS DE DELTA|ETAT ABSOLU|État ABSOLU|ÉTAT ABSOLU/.test(read('lib/billing/apply.ts')),
  'apply.ts DECLARE ecrire l etat absolu — la regle est ecrite la ou elle s applique',
)
ok(
  /return 'stale'/.test(apply),
  'une ecriture plus ancienne est ECARTEE (`stale`), pas appliquee',
)

// ③ LA SEULE INSERTION EST UN UPSERT, ET SA CLE EST UNIQUE EN BASE (§E.31).
const insertionsNues = [...ecritures.matchAll(/\.insert\(/g)]
ok(
  insertionsNues.length === 0,
  'aucune insertion NUE dans le chemin d ecriture (un rejeu la doublerait)',
  `${insertionsNues.length} occurrence(s) de \`.insert(\``,
)
const upserts = [...ecritures.matchAll(/\.upsert\([\s\S]{0,2000}?onConflict:\s*'([a-z_]+)'/g)]
ok(
  upserts.length >= 1,
  'les ecritures de transaction passent par un `upsert` avec `onConflict`',
)
for (const u of upserts) {
  const colonne = u[1]
  // §G.3 — JAMAIS par le numero. Le controle qui garde cette regle est dans
  //        CE fichier, et il m a pris sur cette ligne meme : un numero cite
  //        vieillit mal et ment ensuite. On resout par SUFFIXE DESCRIPTIF.
  const sql = stripSql(read(migration('stripe_fondations')))
  const uniq = new RegExp(`create unique index[\\s\\S]{0,200}?\\(\\s*${colonne}\\s*\\)`, 'i')
  ok(
    uniq.test(sql),
    `\`${colonne}\` porte un index UNIQUE en base — la garde est dans le schema`,
    'sans contrainte, `onConflict` echoue au runtime (42P10) et le doublon passe',
  )
}

// ④ LE BOUTON LUI-MEME : la garde est dans le WHERE, et le motif est exige.
const routeFacturation = stripJs(read('app/api/admin/facturation/route.ts'))
ok(
  /\.update\(\{\s*status:\s*'failed'[\s\S]{0,400}?\.eq\('status',\s*'received'\)[\s\S]{0,200}?\.lt\('received_at'/.test(
    routeFacturation,
  ),
  'la reouverture porte ses trois conditions dans le WHERE, pas dans une lecture prealable',
  'lire puis ecrire laisse une fenetre ou le processus d origine cloture entre les deux',
)
ok(
  // ⚠️ ON N ANCRE PAS SUR LE NOM DE LA VARIABLE (§E.34) : une contre-mutation
  //    l a dit — renommer `motif` en `raison` ne perd rien, et l assertion
  //    rougissait. Le CODE D ERREUR, lui, fait partie du contrat rendu au
  //    client : le renommer est un changement, pas un renommage neutre. On
  //    ancre donc sur le REFUS, et on exige qu une mesure de longueur le
  //    precede.
  /\.length\s*<\s*\d+[\s\S]{0,300}?motif_requis/.test(routeFacturation),
  'la reouverture EXIGE un motif ecrit — une reprise d argent sans raison ne s explique pas',
)
ok(
  /logAudit\(/.test(routeFacturation) && /stripe_event_reouvert/.test(routeFacturation),
  'la reouverture est TRACEE : qui, quand, pourquoi',
)

console.log(
  failures === 0
    ? '\nRÉSULTAT : tout est vert. Le socle tient, le mur reste fermé.\n'
    : `\nRÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
