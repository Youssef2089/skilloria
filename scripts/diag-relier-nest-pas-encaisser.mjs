// scripts/diag-relier-nest-pas-encaisser.mjs
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LES DEUX PROPRIETES DEFENDUES (§D.16, §D.17)
//
//   ① RELIER N'EST PAS ENCAISSER. Synchroniser le catalogue cree des objets
//      chez Stripe ; ca ne fait payer personne. Cette action n'exige donc
//      QU'UNE CLE VALIDE — pas ENABLE_BILLING. En echange, TOUT CE QUI
//      ENCAISSE reste derriere ENABLE_BILLING : le checkout, le portail, le
//      changement d'offre, et l'APPLICATION des evenements du webhook.
//
//   ② TEST ET PRODUCTION SONT DEUX CATALOGUES. Un identifiant de prix cree
//      avec sk_test n'existe pas en live. Le mode est dans la CLE de
//      `packages_stripe`, et le webhook prend le sien de `event.livemode` —
//      JAMAIS de la cle en usage.
//
// CE QU'IL NE VERIFIE PAS, ET IL LE DIT
//   · Que Stripe ait reellement cree les objets : il faudrait une cle et un
//     appel reseau. C'est la recette, et l'ecran des ecarts, qui le disent.
//   · Que la base porte bien les lignes : aucun acces base ici (§E.12).
//
// EPROUVE PAR MUTATION (§G.5) — 18 mutations, 18 detections, le 22/09/2026.
//
//   node scripts/diag-relier-nest-pas-encaisser.mjs
//   Aucune base, aucun reseau, aucune ecriture. Lecture seule.
//   0 = vert · 1 = rouge · 2 = n'a pas tourne.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

const sansCommentaires = (src) =>
  src
    .split('\n')
    .map((l) => {
      const nu = l.trimStart()
      return nu.startsWith('//') || nu.startsWith('*') || nu.startsWith('/*') ? '' : l
    })
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

let echecs = 0
const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

/* ═══════════════════════════════════════════════════════════════════════════
   A. LES DEUX VERROUS SONT DEUX, ET UNE SEULE REGLE DE CLE
   ═══════════════════════════════════════════════════════════════════════════ */

section('A. Deux fabriques, une seule règle de clé')

const config = sansCommentaires(lire('lib/billing/config.ts'))

ok(
  /export function resolveCatalogueKey\(\)/.test(config),
  'la clé de CATALOGUE a sa propre fonction',
)
ok(
  /export function resolveBillingKey\(\)[\s\S]{0,700}?return resolveCatalogueKey\(\)/.test(config),
  'la clé d’ENCAISSEMENT délègue à celle de catalogue — une seule règle de clé',
  'deux implémentations des contrôles de clé divergeraient (§E.20)',
)
ok(
  /export function resolveBillingKey\(\)[\s\S]{0,400}?if \(!billingEnabled\(\)\)[\s\S]{0,200}?billing_disabled/.test(
    config,
  ),
  'et elle ajoute ENABLE_BILLING, AVANT tout examen de clé',
  "l'ordre est ce qui fait sortir `billing_disabled` plutôt que « clé absente »",
)

/**
 * ⚠️ ON NE VERIFIE PAS QUE `resolveCatalogueKey` « NE CONTIENT PAS »
 *    billingEnabled : une absence se satisfait trop facilement. On verifie que
 *    les TROIS contrôles de cle y sont ENTIERS — c'est la propriete qui compte,
 *    et elle ne peut pas etre satisfaite par omission (§E.8).
 */
const corpsCatalogue =
  config.split('export function resolveCatalogueKey()')[1]?.split('\nexport ')[0] ?? ''
ok(corpsCatalogue.length > 0, 'le corps de resolveCatalogueKey est lisible')
ok(/billing_key_missing/.test(corpsCatalogue), '… il refuse une clé ABSENTE')
ok(/billing_key_malformed/.test(corpsCatalogue), '… il refuse une clé MAL FORMÉE')
ok(
  /prod && mode !== 'live'/.test(corpsCatalogue) && /!prod && mode === 'live'/.test(corpsCatalogue),
  '… et la cohérence clé/environnement, DANS LES DEUX SENS',
  'une clé live hors production débiterait de vraies cartes ; une clé test en production ne débiterait rien',
)
ok(
  !/billingEnabled\(\)/.test(corpsCatalogue),
  '… sans exiger ENABLE_BILLING — relier n’est pas encaisser',
)

/* ═══════════════════════════════════════════════════════════════════════════
   B. QUI PASSE PAR QUELLE FABRIQUE
   ═══════════════════════════════════════════════════════════════════════════ */

section('B. Chaque appelant passe par la fabrique de son rôle')

const stripeLib = sansCommentaires(lire('lib/billing/stripe.ts'))
ok(
  /export function getStripeCatalogue\(\)[\s\S]{0,200}?resolveCatalogueKey\(\)/.test(stripeLib),
  'getStripeCatalogue() lit la clé de CATALOGUE',
)
ok(
  /export function getStripe\(\)[\s\S]{0,200}?resolveBillingKey\(\)/.test(stripeLib),
  'getStripe() lit la clé d’ENCAISSEMENT',
)
ok(
  (stripeLib.match(/new Stripe\(/g) ?? []).length === 2,
  'deux `new Stripe(` seulement : la construction partagée, et le vérificateur de signature',
  'deux constructions côte à côte divergeraient sur leurs options (§E.20)',
)

/** Tous les fichiers de app/ et lib/, une fois. */
function fichiers(d, acc = []) {
  if (!existsSync(join(ROOT, d))) return acc
  for (const e of readdirSync(join(ROOT, d))) {
    if (e === 'node_modules' || e === '.next') continue
    const rel = `${d}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) fichiers(rel, acc)
    else if (/\.tsx?$/.test(e)) acc.push(rel)
  }
  return acc
}
const TOUS = [...fichiers('app'), ...fichiers('lib')]

const hors = TOUS.filter(
  (f) => f !== 'lib/billing/stripe.ts' && /new Stripe\(/.test(sansCommentaires(lire(f))),
)
ok(
  hors.length === 0,
  'aucun `new Stripe(` hors de lib/billing/stripe.ts',
  hors.join(', '),
)

/**
 * LES CHEMINS QUI ENCAISSENT. Chacun doit atteindre `getStripe` (donc
 * ENABLE_BILLING) et JAMAIS `getStripeCatalogue`.
 *
 * On s'ancre sur le CHEMIN DE ROUTE, pas sur un nom de fonction : une route
 * d'encaissement renommée resterait au même endroit (§E.34). Une route
 * d'encaissement AJOUTÉE sans être listée ici est le seul angle mort, et il
 * est déclaré en fin de rapport.
 */
const ENCAISSENT = [
  'app/api/billing/checkout/route.ts',
  'app/api/billing/portal/route.ts',
  'app/api/billing/change-plan/route.ts',
  'app/api/stripe/webhook/route.ts',
]
for (const r of ENCAISSENT) {
  const src = existsSync(join(ROOT, r)) ? sansCommentaires(lire(r)) : null
  ok(src !== null, `${r} existe`)
  if (!src) continue
  ok(
    !/getStripeCatalogue/.test(src),
    `${r} n’emprunte PAS la fabrique de catalogue`,
    'elle ouvrirait un encaissement sans ENABLE_BILLING',
  )
}

const webhook = sansCommentaires(lire('app/api/stripe/webhook/route.ts'))
ok(
  /if \(!billingEnabled\(\)\)[\s\S]{0,300}?return json\(/.test(webhook),
  'le webhook n’APPLIQUE rien tant que ENABLE_BILLING est absent',
  "c'est le verrou qui garde les DROITS, et il reste fermé pendant et après la synchro",
)
/* ⚠️ ON COMPARE LA POSITION DE L'APPEL, PAS CELLE DU NOM.
      Premiere version : `indexOf('handleStripeEvent')`. Elle mesurait la ligne
      d'IMPORT, en tete de fichier, donc toujours AVANT le verrou — et elle
      rougissait sur un ordre parfaitement juste. Un motif qui attrape la
      declaration au lieu de l'usage ne mesure pas ce qu'on croit (§E.34). */
const appelTraitement = webhook.indexOf('handleStripeEvent(admin')
ok(
  appelTraitement > 0 && webhook.indexOf('billingEnabled()') < appelTraitement,
  '… et ce refus vient AVANT le traitement de l’événement',
)

const routeSync = 'app/api/admin/synchroniser-catalogue/route.ts'
const sync = existsSync(join(ROOT, routeSync)) ? sansCommentaires(lire(routeSync)) : null
ok(sync !== null, `${routeSync} existe`)
if (sync) {
  ok(/requireAdmin\(request\)/.test(sync), 'la synchronisation est derrière requireAdmin')
  ok(/resolveCatalogueKey\(\)/.test(sync), '… et derrière une clé valide')
  ok(
    !/billingEnabled\(\)/.test(sync),
    '… sans ENABLE_BILLING : sinon relier exigerait d’avoir déjà ouvert l’encaissement',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   C. LE MODE EST DANS LA CLE, ET IL VIENT DE L'EVENEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

section('C. Test et production sont deux catalogues')

const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) =>
  f.endsWith('_catalogue_stripe_par_mode.sql'),
)
ok(migrations.length === 1, `la migration existe et est unique (${migrations.length})`)
if (migrations.length === 1) {
  const sql = lire(`supabase/migrations/${migrations[0]}`)
  ok(
    /primary key \(package_id, mode\)/.test(sql),
    'le MODE est dans la clé primaire',
    'un lecteur qui l’oublie obtient deux lignes — il ne lit pas l’autre mode en silence',
  )
  ok(
    /check \(mode in \('test', 'live'\)\)/.test(sql),
    'et il ne peut valoir que `test` ou `live`',
  )
  ok(
    /create unique index[\s\S]{0,120}?\(mode, price_id_monthly\)/.test(sql),
    'l’unicité d’un prix est PAR MODE',
  )
  ok(
    /raise exception/.test(sql) && /stripe_price_id_monthly is not null/.test(sql),
    'elle REFUSE de tourner si un identifiant existait encore sur `packages`',
    'on ne supprime pas une colonne en CROYANT qu’elle est vide : on vérifie',
  )
  ok(
    /drop column if exists stripe_price_id_monthly/.test(sql),
    'et les anciennes colonnes sont supprimées — pas deux sources pour une même chose',
  )
  ok(
    /^-- \d{14}_catalogue_stripe_par_mode\.sql/m.test(sql) &&
      /20260922000010/.test(migrations[0]),
    'elle porte un suffixe 0xxxxx — la plage du tronc (§G.2)',
    'la plage 1xxxxx est celle que §G.2 déclare fausse',
  )
}

const resolve = sansCommentaires(lire('lib/billing/resolve.ts'))
ok(
  /export async function resolvePackageByPrice\([\s\S]{0,400}?mode: ModeStripe,?\s*\)/.test(resolve),
  'resolvePackageByPrice EXIGE un mode',
)
ok(
  !/mode: ModeStripe = /.test(resolve),
  '… sans valeur par défaut, qui rouvrirait la porte en silence',
)
ok(
  /offresParPrix\(admin, priceId, mode\)/.test(resolve),
  '… et il descend jusqu’à la lecture',
)

const events = sansCommentaires(lire('lib/billing/events.ts'))
ok(
  /const mode = modeDeLEvenement\(event\.livemode\)/.test(events),
  'le webhook prend son mode de `event.livemode`',
)
ok(
  !/modeDeLaCle/.test(events),
  '… et JAMAIS de la clé en usage',
  'lire le mode de la clé supposerait que l’endpoint et la clé sont accordés — c’est ce qui casse quand on les croise',
)
ok(
  (events.match(/resolvePackageByPrice\(admin, [^)]*, mode\)/g) ?? []).length ===
    (events.match(/resolvePackageByPrice\(/g) ?? []).length,
  'toutes les résolutions de prix du webhook passent ce mode',
)

/** Le propriétaire de la table est SEUL à la lire. */
const lecteurs = TOUS.filter(
  (f) =>
    f !== 'lib/billing/catalogue-stripe.ts' &&
    /from\('packages_stripe'\)/.test(sansCommentaires(lire(f))),
)
ok(
  lecteurs.length === 0,
  'aucun accès à `packages_stripe` hors de son module propriétaire',
  lecteurs.join(', '),
)

/* ═══════════════════════════════════════════════════════════════════════════
   C bis. UNE OFFRE NE SE RELIE PAS A LA MAIN
   ═══════════════════════════════════════════════════════════════════════════ */

section('C bis. Créer et modifier relient, dans la même action')

/**
 * LES DEUX ROUTES QUI ECRIVENT UNE OFFRE, découvertes et non recopiées : on
 * balaie app/api/admin/ et on retient celles qui INSERENT ou METTENT A JOUR
 * `packages`. Une liste ecrite a la main oublierait la route ajoutee demain —
 * et c'est exactement par la que le defaut reviendrait.
 */
const ECRIVENT_UNE_OFFRE = fichiers('app/api/admin').filter((f) => {
  const src = sansCommentaires(lire(f))
  return /\.from\('packages'\)[\s\S]{0,200}?\.(insert|update)\(/.test(src)
})

ok(
  ECRIVENT_UNE_OFFRE.length >= 2,
  `${ECRIVENT_UNE_OFFRE.length} route(s) écrivent une offre — découvertes, pas listées`,
)

for (const f of ECRIVENT_UNE_OFFRE) {
  const src = sansCommentaires(lire(f))
  // `set-default-package` et `migrate-org-packages` ne touchent ni au prix ni
  // a la mise en vente : ils ne changent RIEN de ce que Stripe connait. On ne
  // les exige donc pas — mais on ne les exempte pas par leur NOM : on regarde
  // s'ils ecrivent un champ du catalogue Stripe.
  const toucheAuPrix = /price_monthly|price_yearly|currency|\bactive\b/.test(src)
  if (!toucheAuPrix) continue

  ok(
    /synchroniserAvantEcriture\(/.test(src),
    `${f.replace('app/api/admin/', '')} : relie l'offre DANS LA MÊME ACTION`,
    'une offre payante créée sans liaison sortirait « hors catalogue » au premier paiement',
  )
  ok(
    /stripe_sync_failed/.test(src),
    `${f.replace('app/api/admin/', '')} : refuse avec la RAISON nommée si Stripe échoue`,
    "« échec » sans motif envoie chercher au hasard",
  )
}

/**
 * LA CREATION NE PEUT PAS SYNCHRONISER AVANT D'ECRIRE — l'offre n'existe pas
 * encore. Elle doit donc DEFAIRE ce qu'elle vient de creer quand Stripe refuse :
 * sinon l'offre existe A MOITIE, payante et non reliee, c'est-a-dire l'etat
 * exact qu'on ferme.
 */
const creation = sansCommentaires(lire('app/api/admin/create-package/route.ts'))
const refusSynchro = creation.indexOf('if (!synchro.ok)')
ok(refusSynchro > 0, 'la création teste le refus de synchronisation')
ok(
  refusSynchro > 0 &&
    /from\('packages'\)\.delete\(\)\.eq\('id', pkg\.id\)/.test(creation.slice(refusSynchro, refusSynchro + 400)),
  '… et SUPPRIME l’offre créée : elle n’existe jamais à moitié',
)

/* ═══════════════════════════════════════════════════════════════════════════
   C ter. « RIEN A RELIER » SE DECIDE SUR LE PRIX, JAMAIS SUR LE NOM
   ═══════════════════════════════════════════════════════════════════════════ */

section('C ter. La vendabilité, exécutée')

const { vendabilite } = await import(
  new URL('../lib/billing/vendabilite.ts', import.meta.url).href
)

ok(
  vendabilite({ is_free: false, active: true }).vendable,
  'une offre DÉCLARÉE payante est vendable',
)
ok(
  !vendabilite({ is_free: true, active: true }).vendable,
  'une offre DÉCLARÉE gratuite n’a rien à relier',
)
ok(
  !vendabilite({ is_free: false, active: false }).vendable,
  'une offre retirée de la vente n’a rien à relier',
)

/* ⚠️ LA DECISION NE REGARDE PLUS LE PRIX DU TOUT, ET C'EST LE POINT (§D.18).
      Tant qu'elle le deduisait, une offre payante saisie a 0 par erreur sortait
      de la vente EN SILENCE. On verifie donc que le module n'a AUCUN moyen de
      lire un prix : son type d'entree ne le porte pas. */
const sourceVendabilite = sansCommentaires(lire('lib/billing/vendabilite.ts'))
ok(
  !/price_monthly|price_yearly/.test(sourceVendabilite),
  'le module ne lit AUCUN prix — l’intention seule décide',
  'une offre payante saisie à 0 sortirait de la vente en silence',
)

/* ⚠️ LA REGLE N'EXISTE QU'UNE FOIS — et la premiere version de CETTE assertion
      etait fausse. Elle cherchait `is_default` suivi d'un `return` ou d'un
      `reason` a moins de 120 caracteres : elle a mordu sur la LISTE DE
      COLONNES de `catalogue.ts`, ou `is_default` est un nom de colonne dans une
      chaine, suivi quelques lignes plus bas par la signature de `sellability`.
      Une fenetre mesure une distance, jamais une appartenance (§E.40).

      La propriete est : AUCUNE DECISION n'est prise sur le statut de defaut
      hors du module. On cherche donc une LIGNE qui cite le champ ET porte un
      operateur de decision — ce qu'une liste de colonnes ne fait jamais. */
/* ⚠️ ET LA SECONDE VERSION ETAIT TROP LARGE, DANS L'AUTRE SENS. Elle balayait
      TOUT app/ et lib/, et denoncait vingt lignes parfaitement justes :
      `is_default` est une notion PRODUIT — quelle offre sert de repli, peut-on
      la desactiver — utilisee partout, et legitimement. Elle n'etait fausse
      que comme critere de VENDABILITE.

      Le balayage porte donc sur le CHEMIN DU CATALOGUE STRIPE, et lui seul :
      c'est la que la decision devait sortir. Ailleurs, le statut de defaut
      decide autre chose, et ce n'est pas l'affaire de ce controle. */
const CHEMIN_CATALOGUE = /^(lib\/billing\/|lib\/stripe-exploitation\/|app\/api\/admin\/synchroniser)/
const DECISION = /(^|[^\w])(if\s*\(|return |\?\s|&&|\|\|)/
const copies = []
for (const f of TOUS) {
  if (f === 'lib/billing/vendabilite.ts' || !CHEMIN_CATALOGUE.test(f)) continue
  for (const ligne of sansCommentaires(lire(f)).split('\n')) {
    if (!/\bis_default\b|\bisDefault\b/.test(ligne)) continue
    if (DECISION.test(ligne)) copies.push(`${f} → ${ligne.trim().slice(0, 70)}`)
  }
}
ok(
  copies.length === 0,
  'aucune décision prise sur le statut de défaut hors du module de vendabilité',
  copies.join(' · '),
)

for (const f of ['lib/billing/catalogue.ts', 'lib/stripe-exploitation/catalogue-relie.ts']) {
  ok(
    /vendabilite\(/.test(sansCommentaires(lire(f))),
    `${f.replace('lib/', '')} DÉLÈGUE la décision`,
    'deux copies de la même règle divergent le jour où l’une est corrigée (§E.20)',
  )
}

const slugsEnDur = TOUS.filter(
  (f) =>
    /lib\/billing|lib\/stripe-exploitation|app\/api\/admin\/synchroniser/.test(f) &&
    /'(free|collaboration)'/.test(sansCommentaires(lire(f))),
)
ok(
  slugsEnDur.length === 0,
  'aucun slug d’offre en dur sur le chemin du catalogue',
  slugsEnDur.join(', '),
)

/* ═══════════════════════════════════════════════════════════════════════════
   C quater. LE PASSAGE EN PRODUCTION NE PEUT PAS S'OUBLIER
   ═══════════════════════════════════════════════════════════════════════════ */

section('C quater. La supervision le dit, et en BLOQUANT')

const supervision = sansCommentaires(lire('lib/supervision/problemes.ts'))
ok(
  /offresPayantesNonReliees: number \| null/.test(supervision),
  'la supervision connaît le nombre d’offres payantes non reliées',
)
ok(
  /cle: 'catalogue_non_relie',\s*gravite: 'bloquant'/.test(supervision),
  '… et une seule suffit à rendre le problème BLOQUANT',
  'un lien manquant ne se découvre pas au premier paiement',
)
ok(
  /cle: 'catalogue_etat_inconnu',\s*gravite: 'attention'/.test(supervision),
  '… tandis que « je ne sais pas » est distinct de « rien à relier » (§E.22)',
)

const routeSupervision = sansCommentaires(lire('app/api/admin/supervision/route.ts'))
ok(
  /modeDeLaCle\(cleCatalogue\.live\)/.test(routeSupervision),
  'le compte est fait DANS LE MODE DE LA CLÉ en usage',
  'compter dans l’autre mode dirait « tout est relié » au moment de la bascule',
)
ok(
  /vendabilite\(/.test(routeSupervision),
  '… et sur la même règle de vendabilité que partout ailleurs',
)


/* ═══════════════════════════════════════════════════════════════════════════
   C quinquies. UNE OFFRE GRATUITE NE PASSE JAMAIS PAR STRIPE
   ═══════════════════════════════════════════════════════════════════════════ */

section('C quinquies. Ni synchronisation, ni paiement')

/**
 * LA SYNCHRONISATION refuse déjà une offre gratuite — c'est `sellability`.
 * LE PAIEMENT, lui, avait un trou RÉEL : une offre payante RELIÉE, puis passée
 * en gratuite, garde sa ligne dans `packages_stripe`. La liaison rendait donc
 * un prix, et le checkout s'ouvrait AU PRIX D'AVANT sur une offre déclarée
 * gratuite. Le refus doit donc venir AVANT toute lecture de liaison.
 */
const achat = sansCommentaires(lire('lib/billing/purchase.ts'))
ok(/vendabilite\(/.test(achat), 'le parcours d’achat consulte la vendabilité')

const posVendabilite = achat.indexOf('vendabilite({')
const posLiaison = achat.indexOf('lireLiaison(')
ok(
  posVendabilite > 0 && posLiaison > 0 && posVendabilite < posLiaison,
  '… AVANT de lire la liaison Stripe',
  'une offre devenue gratuite garde sa liaison : la lire d’abord rouvrirait un checkout au prix d’avant',
)
ok(
  /return \{ code: 'package_not_sellable'/.test(achat),
  '… et refuse explicitement, avec la raison',
)

/* LA BASE, ELLE, NE DEPEND D'AUCUNE DISCIPLINE (§E.31). */
const migGratuite = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) =>
  f.endsWith('_offre_gratuite_explicite.sql'),
)
ok(migGratuite.length === 1, `la migration de la case existe et est unique (${migGratuite.length})`)
if (migGratuite.length === 1) {
  const sql = lire(`supabase/migrations/${migGratuite[0]}`)
  ok(
    /add column if not exists is_free boolean not null/.test(sql),
    'la colonne `is_free` est `not null`',
  )
  ok(
    /\(is_free[\s\S]{0,160}?coalesce\(price_monthly, 0\) = 0/.test(sql),
    'gratuite ⇒ les deux prix sont nuls',
  )
  ok(
    /not is_free[\s\S]{0,160}?coalesce\(price_monthly, 0\) > 0/.test(sql),
    'non gratuite ⇒ au moins un prix strictement positif',
    "sans ce sens-là, une offre payante à 0 resterait écrivable",
  )
  ok(
    /packages_default_must_be_free check \(\s*is_default = false or is_free\s*\)/.test(sql),
    'l’offre par défaut est un CAS de la gratuité, exprimé une seule fois',
  )
  ok(
    /raise exception/.test(sql) && /PAR DEFAUT portant un prix/.test(sql),
    'elle REFUSE de tourner sur un état qu’elle ne peut pas trancher, en nommant les offres',
  )
  ok(
    /20260922000030/.test(migGratuite[0]),
    'elle porte un suffixe 0xxxxx — la plage du tronc (§G.2)',
    'la plage 1xxxxx est celle que §G.2 déclare fausse, et que diag-migration-donnees refuse',
  )
}

/* LES DEUX ROUTES EXIGENT L'INTENTION, ET VERIFIENT LA COHERENCE. */
for (const r of [
  'app/api/admin/create-package/route.ts',
  'app/api/admin/update-package/route.ts',
]) {
  const src = sansCommentaires(lire(r))
  ok(
    /coherenceGratuite\(/.test(src),
    `${r.replace('app/api/admin/', '')} : vérifie que la case et le prix ne se contredisent pas`,
  )
  ok(
    /free_with_price/.test(src) && /paid_without_price/.test(src),
    `${r.replace('app/api/admin/', '')} : les deux contradictions ont leur propre code`,
    'un refus sans motif envoie chercher au hasard',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   D. L'IDEMPOTENCE — EXECUTEE, PAS RELUE (§E.33)
   ═══════════════════════════════════════════════════════════════════════════ */

section('D. Le second clic ne crée pas de doublon')

const { cleProduit, clePrix } = await import(
  new URL('../lib/billing/idempotence.ts', import.meta.url).href
)

const OFFRE = { slug: 'business', name: 'Business', description: null, target_role: 'client' }
const a = cleProduit(OFFRE)
ok(a === cleProduit({ ...OFFRE }), 'même offre → MÊME clé de produit (le doublon est fermé)')
ok(
  a !== cleProduit({ ...OFFRE, name: 'Business Plus' }),
  'offre renommée → clé DIFFÉRENTE (Stripe refuserait une clé réutilisée autrement)',
)
ok(a.includes('business'), 'le slug reste lisible en clair dans la clé (journaux Stripe)')

const PRIX = { slug: 'business', productId: 'prod_X', currency: 'EUR', unitAmount: 34900 }
ok(clePrix(PRIX) === clePrix({ ...PRIX }), 'même prix → MÊME clé (rejouer ne crée rien)')
ok(
  clePrix(PRIX) !== clePrix({ ...PRIX, unitAmount: 35900 }),
  'tarif changé → clé DIFFÉRENTE (nouveau Price, grand-père tarifaire)',
)
ok(
  clePrix(PRIX) !== clePrix({ ...PRIX, productId: 'prod_Y' }),
  'produit différent → clé différente (jamais un prix rattaché à un orphelin)',
)

/* ═══════════════════════════════════════════════════════════════════════════
   E. LE MONTANT VIENT DU CATALOGUE LOCAL
   ═══════════════════════════════════════════════════════════════════════════ */

section('E. Aucun montant ne vient de Stripe')

const catalogue = sansCommentaires(lire('lib/billing/catalogue.ts'))
ok(
  /unit_amount: minor\.value/.test(catalogue),
  'le montant poussé est celui du catalogue local, converti une seule fois',
)
ok(
  !/unit_amount:\s*existing\./.test(catalogue) && !/price_monthly:\s*existing\./.test(catalogue),
  'aucun montant lu chez Stripe n’est réécrit en base',
  'le montant lu ne sert qu’à COMPARER — c’est une décision figée (§C.10)',
)

/* ═══════════════════════════════════════════════════════════════════════════
   F. L'ECRAN DIT CE QUI EST RELIE, ET DANS QUEL MODE
   ═══════════════════════════════════════════════════════════════════════════ */

section('F. L’écran des écarts nomme le mode')

const ecran = sansCommentaires(lire('app/api/admin/facturation/route.ts'))
ok(/catalogue_relie: catalogueRelie/.test(ecran), 'la route rend l’état du raccordement')
ok(
  /if \(modeCourant !== null && l\.mode !== modeCourant\) continue/.test(ecran),
  'la table de traduction des prix est filtrée SUR LE MODE COURANT',
  'sans ce filtre, un abonnement live se résoudrait avec un prix de test',
)

const relie = sansCommentaires(lire('lib/stripe-exploitation/catalogue-relie.ts'))
ok(
  /etat: 'impossible'/.test(relie) && /etat: 'mesure'/.test(relie),
  '« je n’ai pas pu lire » et « rien à relier » sont deux branches distinctes',
)
ok(
  /autre: \{ mode: ModeStripe; lignes: LigneCatalogue\[\] \}/.test(relie),
  '… et l’état de l’AUTRE mode est rendu, pour qu’on ne le découvre pas à la bascule',
)
ok(
  /'rien_a_relier'/.test(relie),
  'une offre par défaut, gratuite, n’est pas « manquante » : elle n’a rien à relier',
  'les confondre ferait rougir un écran pour Free et Collaboration, et on apprendrait à ignorer le rouge',
)

/* ═══════════════════════════════════════════════════════════════════════════ */

section('Ce que ce contrôle ne vérifie pas')

note('que Stripe ait REELLEMENT cree les objets : il faudrait une cle et un')
note('appel reseau. Seuls la recette et l ecran des ecarts le disent.')
note('qu une route d encaissement AJOUTEE demain soit listee en B. Le balayage')
note('verifie qu aucune route existante n emprunte la fabrique de catalogue ;')
note('une route neuve qui l emprunterait ne serait vue que si on l ajoute ici.')
note('rien de la base : aucun acces (§E.12). « NULL sur les quatre offres » est')
note('une mesure HUMAINE, datee, qu aucun controle ne refait seul.')

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} CONTRÔLE(S) EN ÉCHEC\n`)
  process.exit(1)
}
console.log('✅ Relier n’est pas encaisser, et un identifiant n’existe que dans son mode.\n')
process.exit(0)
