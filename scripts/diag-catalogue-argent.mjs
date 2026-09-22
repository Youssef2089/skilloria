// scripts/diag-catalogue-argent.mjs — LOT 4A : CE QUI TOUCHE L'ARGENT.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Trois défauts, dont aucun ne lève d'erreur et dont chacun coûte de l'argent
//   ou de la crédibilité.
//
//   1. LE CATALOGUE DIVERGE DE STRIPE. Le prix est modifié au back-office, la
//      synchro échoue, et l'écriture locale passe quand même : Skilloria
//      affiche 399 €, Stripe prélève 349 €. Personne ne le voit — les deux
//      côtés fonctionnent parfaitement, séparément.
//
//   2. UNE ATTRIBUTION MANUELLE ÉCRASE UN ABONNEMENT PAYÉ. L'offre change sans
//      qu'on ait facturé ni remboursé, puis le prochain événement Stripe la
//      réécrit — l'admin voit son geste s'annuler seul. Le second dégât efface
//      la trace du premier.
//
//   3. LE PRIX CATALOGUE S'AFFICHE À LA PLACE DU PRIX PAYÉ. Les `Price` Stripe
//      sont IMMUABLES : une organisation abonnée à 349 € y reste quand le
//      catalogue passe à 399 €. Lui montrer 399 € est un litige commercial en
//      puissance.
//
// CE QU'IL VÉRIFIE
//   A. La synchro précède l'écriture, et son échec la refuse. Message explicite.
//   B. Le verrou fermé ne gèle PAS le back-office — sinon la V0 serait bloquée.
//   C. Le garde-fou d'attribution manuelle couvre les DEUX routes qui écrivent
//      `organizations.package_id`. Une garde posée dans une seule se contourne.
//   D. Le prix affiché à une organisation abonnée vient de `transactions`, et
//      l'absence de transaction ne retombe JAMAIS sur le catalogue.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-catalogue-argent.mjs   → contrôles statiques.
//                                              AUCUN accès base, aucun appel Stripe.
//
// LECTURE PURE : ce script n'écrit JAMAIS.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Fins de ligne NORMALISEES. Le depot sort les fichiers en CRLF : un motif qui
 * traverse une fin de ligne ne matche jamais sur une copie fraichement
 * extraite, et le diagnostic vire au rouge sans qu'aucun code n'ait change.
 */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const exists = (p) => existsSync(join(ROOT, p))

/** Retire les commentaires : un anti-pattern doit pouvoir être DOCUMENTÉ. */
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

const CREATE = 'app/api/admin/create-package/route.ts'
const UPDATE = 'app/api/admin/update-package/route.ts'
const ASSIGN = 'app/api/admin/assign-org-package/route.ts'
const MIGRATE = 'app/api/admin/migrate-org-packages/route.ts'
const GARDE = 'lib/billing/catalogue-guard.ts'
const MANUELLE = 'lib/billing/attribution-manuelle.ts'
const ROUTE_OFFRE = 'app/api/me/organisation/offre/route.ts'
const ECRAN_OFFRE = 'app/[locale]/dashboard/entreprise/offre/page.tsx'

const messages = Object.fromEntries(
  ['fr', 'en', 'es', 'de'].map((l) => [l, JSON.parse(read(`messages/${l}.json`))]),
)
const cle = (o, c) => c.split('.').reduce((x, k) => (x == null ? x : x[k]), o)

console.log('\nLOT 4A — CE QUI TOUCHE L’ARGENT\n')

// ─────────────────────────────────────────────────────────────────────────────
section('0. Présence des artefacts')
for (const f of [CREATE, UPDATE, ASSIGN, MIGRATE, GARDE, MANUELLE, ROUTE_OFFRE, ECRAN_OFFRE]) {
  ok(exists(f), `${f} existe`)
}

const create = sansCommentaires(read(CREATE))
const update = sansCommentaires(read(UPDATE))
const assign = sansCommentaires(read(ASSIGN))
const migrate = sansCommentaires(read(MIGRATE))
const garde = sansCommentaires(read(GARDE))
const manuelle = sansCommentaires(read(MANUELLE))
const routeOffre = sansCommentaires(read(ROUTE_OFFRE))
const ecranOffre = sansCommentaires(read(ECRAN_OFFRE))

// ─────────────────────────────────────────────────────────────────────────────
section('A. La synchro précède l’écriture, et son échec la refuse')

for (const [nom, src] of [['create-package', create], ['update-package', update]]) {
  ok(/synchroniserAvantEcriture\(/.test(src), `${nom} appelle la synchro`)
  ok(/stripe_sync_failed/.test(src), `${nom} refuse avec un code dédié`)
}

// update-package : la synchro DOIT précéder l'écriture. C'est le seul ordre qui
// tient la règle — écrire puis synchroniser laisserait, en cas d'échec, la
// divergence qu'on veut interdire.
const iSync = update.search(/synchroniserAvantEcriture\(/)
const iEcrit = update.search(/\.from\('packages'\)\s*\n?\s*\.update\(packageUpdates\)/)
ok(
  iSync !== -1 && iEcrit !== -1 && iSync < iEcrit,
  'update-package synchronise AVANT d’écrire',
  "Écrire puis synchroniser laisse exactement la divergence qu'on veut interdire.",
)
// Et avec les valeurs VOULUES, pas celles encore en base.
ok(
  /syncPackage\(\s*admin,\s*packageId,\s*\{/.test(garde) || /voulu/.test(garde),
  'la synchro pousse les valeurs VOULUES, pas celles encore en base',
  'À cet instant la base porte encore l’ancien prix : une synchro qui la relit pousserait l’ancien.',
)

// create-package : la synchro ne peut pas précéder (l'offre n'existe pas encore),
// donc l'échec doit DÉFAIRE ce qui vient d'être créé.
const blocSync = create.slice(create.search(/synchroniserAvantEcriture\(/))
ok(
  /\.from\('packages'\)\s*\.delete\(\)/.test(blocSync.slice(0, 900)),
  'create-package DÉFAIT la création si la synchro échoue',
  "L'offre n'existe pas avant l'insert : le seul autre moyen de tenir la règle est de créer puis défaire.",
)

// Le message doit dire QUE rien n'a été enregistré — sinon l'admin croit avoir modifié.
for (const l of ['fr', 'en', 'es', 'de']) {
  const txt = String(cle(messages[l], 'admin_back_office.packages.err_stripe_sync_failed') ?? '')
  ok(txt !== '', `err_stripe_sync_failed [${l}] existe`)
  ok(
    /RIEN|NOTHING|NADA|NICHTS/i.test(txt),
    `err_stripe_sync_failed [${l}] dit que RIEN n’a été enregistré`,
    `« ${txt} » — sans cela, l'admin croit avoir modifié le prix et repart.`,
  )
}
for (const [nom, f] of [['édition', 'app/[locale]/admin/packages/[id]/page.tsx'], ['création', 'app/[locale]/admin/packages/new/page.tsx']]) {
  ok(
    /stripe_sync_failed/.test(sansCommentaires(read(f))),
    `l’écran de ${nom} affiche le refus de synchro`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
section('B. Verrou fermé : le back-office n’est PAS gelé')

/* ⚠️ CETTE ASSERTION S'ANCRAIT SUR L'EXPRESSION, PAS SUR LA PROPRIETE.
      Elle exigeait littéralement `if (!billingEnabled()) return { ok: true,
      ignoree: true }`. Le 22/09/2026, §D.16 a remplacé ce verrou par
      `resolveCatalogueKey().ok` — RELIER N'EST PAS ENCAISSER — et elle a rougi
      sur un comportement INCHANGÉ : sans clé, rien n'est tenté, la
      modification passe. C'est §E.34 dans un contrôle de ce dépôt.

      La propriété défendue, elle, n'a pas bougé : QUAND AUCUNE SYNCHRO N'EST
      POSSIBLE SUR CET ENVIRONNEMENT, ON NE TENTE RIEN ET ON N'EMPÊCHE RIEN.
      C'est donc elle qu'on vérifie — le premier refus de la fonction rend
      `ignoree: true`, quel que soit le nom de la condition. */
const premierRefus = garde.match(
  /export async function synchroniserAvantEcriture\([\s\S]*?\)\s*:\s*Promise<Synchro>\s*\{\s*\n\s*(if \([^)]*\)[^\n]*)/,
)
ok(
  Boolean(premierRefus) && /return \{ ok: true, ignoree: true \}/.test(premierRefus[1]),
  'rien à synchroniser sur cet environnement → aucune tentative, la modification passe',
  "Appliquer la règle telle quelle gèlerait le back-office : sans clé Stripe, plus aucune modification d'offre possible.",
)
ok(
  Boolean(premierRefus) && /resolveCatalogueKey\(\)/.test(premierRefus[1]),
  '… et la condition est la CLÉ de catalogue, pas l’interrupteur d’encaissement (§D.16)',
  'exiger ENABLE_BILLING pour relier recrée la dépendance circulaire : relier suppose alors d’avoir déjà ouvert l’encaissement',
)
// Une offre NON VENDABLE n'est pas un échec : il n'y a rien à pousser.
ok(
  /non vendable/.test(garde) && /ok: true/.test(garde),
  'une offre non vendable ne bloque pas la modification',
)
// Seule une VRAIE panne Stripe refuse.
ok(
  /catch \(err\)[\s\S]{0,200}?ok: false/.test(garde),
  'seul un échec Stripe réel refuse l’écriture',
)

// ─────────────────────────────────────────────────────────────────────────────
section('C. Le garde-fou couvre TOUTES les routes qui écrivent l’offre')

/**
 * DÉCOUVERTE, pas liste écrite à la main : on cherche qui écrit
 * `organizations.package_id` dans app/ ET lib/, et on exige que chacun soit
 * gardé. Une garde posée dans une seule route se contourne par l'autre — c'est
 * exactement ce qui a été trouvé pendant ce lot.
 */
function fichiers(rel, out = []) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) return out
  if (statSync(abs).isDirectory()) {
    for (const e of readdirSync(abs)) fichiers(join(rel, e), out)
    return out
  }
  if (/\.ts$/.test(rel)) out.push(relative('', rel).split('\\').join('/'))
  return out
}
const sources = ['app/api', 'lib'].flatMap((d) => fichiers(d))

/**
 * Écrit-il `package_id` sur `organizations` ?
 *
 * DEUX conditions sur le FICHIER, et non sur une fenêtre autour de l'appel :
 * une écriture sur `organizations`, et une clé `package_id:` quelque part.
 *
 * ⚠️ La première version regardait les 400 caractères qui SUIVENT
 *    `.from('organizations')`. Elle ratait `lib/billing/apply.ts`, où l'objet
 *    est construit AVANT l'appel — `.update(patch)` ne contient alors aucun nom
 *    de colonne. Un détecteur qui suppose que la charge suit l'appel rate
 *    précisément le code le plus soigné.
 *
 * Plus large, donc : les faux positifs éventuels sont attrapés par
 * l'inventaire, qui exige une raison écrite pour chacun. C'est le bon sens de
 * l'erreur — mieux vaut déclarer un lecteur de trop que rater un écrivain.
 */
const ecrivains = sources.filter((rel) => {
  const src = sansCommentaires(read(rel))
  if (!/package_id:/.test(src)) return false
  let at = src.indexOf("from('organizations')")
  while (at !== -1) {
    // Sans ancre de début de ligne : \`a.from('organizations').update({…})\`
    // tient sur UNE seule ligne, et l'ancre \`^\s*\.\` la ratait — un intrus
    // écrit d'un seul trait passait donc inaperçu (mutation M79).
    if (/\.(update|upsert|insert)\(/.test(src.slice(at, at + 200))) return true
    at = src.indexOf("from('organizations')", at + 1)
  }
  return false
})

/**
 * Qui a le droit d'écrire l'offre d'une organisation, et à quelle condition.
 *   'garde'   : attribution MANUELLE — doit refuser sur abonnement vivant ;
 *   'webhook' : Stripe fait autorité, c'est LUI la source ;
 *   'creation': l'organisation naît, elle ne peut pas déjà être abonnée.
 */
const ECRIVAINS_ATTENDUS = {
  'app/api/admin/assign-org-package/route.ts': 'garde',
  'app/api/admin/migrate-org-packages/route.ts': 'garde',
  'lib/billing/apply.ts': 'webhook',
  // 'creation' A QUITTE CETTE LISTE, et ce n'est pas un relâchement.
  // `ensure-personal-org` posait `package_id` dans un `.insert()` applicatif,
  // troisième d'une série de trois allers-retours non transactionnels — la
  // structure qui a produit deux organisations sans aucun membre. L'offre est
  // désormais posée DANS la transaction de création, par
  // `creer_organisation_avec_admin` (migration 20260915200000).
  //
  // L'exigence, elle, n'a pas bougé de place : elle est vérifiée là où elle a
  // du sens, par diag-abonnement-organisation.mjs, qui contrôle que l'offre
  // figure bien dans les arguments de la RPC — « sinon elle naît sans offre et
  // retombe sur le repli ».
}
const nonDeclares = ecrivains.filter((r) => !(r in ECRIVAINS_ATTENDUS))
ok(
  nonDeclares.length === 0,
  `tout écrivain de organizations.package_id est déclaré (${ecrivains.length} trouvé(s))`,
  nonDeclares.length ? `non déclaré(s) : ${nonDeclares.join(' · ')}` : undefined,
)
const disparus = Object.keys(ECRIVAINS_ATTENDUS).filter((r) => !ecrivains.includes(r))
ok(disparus.length === 0, 'aucune entrée périmée', disparus.join(' · '))

// Les deux routes d'attribution manuelle DOIVENT porter la garde.
ok(
  /abonnementStripeVivant\(/.test(assign) && /org_has_stripe_subscription/.test(assign),
  'assign-org-package refuse sur un abonnement vivant',
)
// Les NOMS ne prouvent rien : ils survivent tous les deux à
// `idsAMigrer = idsConcernes`, qui remigre tout le monde (mutation M78). On
// exige donc l'EXCLUSION elle-même, et que l'écriture porte sur la liste
// filtrée et non sur toutes les organisations de l’offre source.
ok(
  /organisationsAbonnees\(/.test(migrate),
  'migrate-org-packages consulte les organisations abonnées',
)
ok(
  /idsAMigrer\s*=\s*idsConcernes\.filter\(\(id\) => !idsEcartes\.has\(id\)\)/.test(migrate),
  'migrate-org-packages ÉCARTE réellement les abonnées de la migration',
  'Cette route écrasait package_id ET remettait package_valid_until à null, en masse.',
)
ok(
  /\.update\([\s\S]{0,240}?\.in\('id', idsAMigrer\)/.test(migrate),
  'l’écriture de masse porte sur la liste FILTRÉE',
  'Un .eq(package_id, fromId) sur l’UPDATE ré-embarquerait les abonnées écartées.',
)
// La garde est AU SERVEUR, avant l'écriture.
const iGarde = assign.search(/abonnementStripeVivant\(/)
const iUpdate = assign.search(/\.from\('organizations'\)\s*\n?\s*\.update\(/)
ok(
  iGarde !== -1 && iUpdate !== -1 && iGarde < iUpdate,
  'la garde précède l’écriture (elle ne se contourne pas par appel direct)',
)
// UNE seule définition de « vivant », partagée.
ok(
  /package_valid_until/.test(manuelle) && !/stripe_subscription_status/.test(manuelle),
  '« vivant » se juge sur package_valid_until, pas sur le statut Stripe',
  'Le statut Stripe n’est chez nous que de l’affichage ; une org en grâce est encore abonnée.',
)

// ─────────────────────────────────────────────────────────────────────────────
section('D. Le prix affiché est celui qui est FACTURÉ')

ok(
  /from\('transactions'\)/.test(routeOffre) && /billed:/.test(routeOffre),
  'la route sert le dernier montant prélevé, lu sur transactions',
)
ok(
  /\.eq\('status', 'success'\)/.test(routeOffre),
  'seuls les paiements RÉUSSIS comptent',
)
ok(
  /has_subscription:/.test(routeOffre),
  'la route dit si l’organisation est abonnée — c’est ce qui décide quel prix fait foi',
)
ok(
  /abonnee \? \(montantPreleve \?\? '—'\) : priceLabel/.test(ecranOffre),
  'abonnée → montant prélevé ; non abonnée → prix catalogue',
)
// LE PIÈGE : ne jamais retomber sur le catalogue faute de transaction.
ok(
  !/montantPreleve \?\? priceLabel/.test(ecranOffre) &&
    !/billed[\s\S]{0,60}?\?\?[\s\S]{0,40}?price_monthly/.test(ecranOffre),
  'aucun repli du montant prélevé vers le prix catalogue',
  "Ce repli réintroduirait le défaut par la bande : l'organisation lirait un montant qu'on ne lui prend pas.",
)
for (const l of ['fr', 'en', 'es', 'de']) {
  ok(
    typeof cle(messages[l], 'dashboard_entreprise.offre.billed_pending') === 'string',
    `billed_pending [${l}] : l’absence de prélèvement se dit`,
  )
}

console.log(
  failures === 0
    ? '\nRÉSULTAT : tout est vert. Le catalogue ne diverge pas, et le prix affiché est celui qui est pris.\n'
    : `\nRÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
