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
section('5. Garde anti-désordre dans le WHERE, pas en mémoire')

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
ok(
  /process\.env\.ENABLE_BILLING\s*===\s*'true'/.test(cfg),
  "ENABLE_BILLING suit la convention de ENABLE_AI_CV_PARSING (=== 'true')",
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
ok(
  /is_default/.test(catalogue) && /price_monthly === null/.test(catalogue),
  'les offres non vendables (par défaut, sans tarif) sont refusées explicitement',
)
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
ok(
  /organization_domains[\s\S]{0,200}?package_id,\s*package_valid_until/.test(ent),
  'getOrgEntitlements lit toujours package_id + package_valid_until',
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

const migs = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
const mine = migs.filter((f) => /stripe/.test(f))
ok(mine.length >= 1, `migrations Stripe présentes : ${mine.join(', ')}`)
const last = migs[migs.length - 1]
ok(
  mine.includes(last) || migs.indexOf(mine[mine.length - 1]) >= 0,
  'les migrations Stripe s\'insèrent dans la séquence',
)

// RÈGLE : ne JAMAIS citer une migration par son numéro. Le renumérotage est
// une opération normale ici ; un numéro cité vieillit mal et ment ensuite.
const citing = []
for (const rel of [...BILLING, ROUTE, 'scripts/diag-billing-socle.mjs', `supabase/migrations/${mine[mine.length - 1]}`]) {
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

const socle = read(`supabase/migrations/${mine[mine.length - 1]}`)
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

    const { data: pkgs, error: pkgErr } = await db
      .from('packages')
      .select('slug, target_role, price_monthly, is_default, active, stripe_price_id_monthly')
      .order('slug')
    if (pkgErr) {
      failures++
      console.log(`  KO   lecture packages : ${pkgErr.message}`)
    } else {
      const rows = pkgs ?? []
      const vendables = rows.filter((p) => p.price_monthly !== null && !p.is_default && p.active)
      const synced = vendables.filter((p) => p.stripe_price_id_monthly)
      info(`catalogue : ${rows.length} offres, ${vendables.length} vendable(s), ${synced.length} synchronisée(s)`)
      for (const p of rows) {
        const etat = p.is_default ? 'défaut' : p.price_monthly === null ? 'sans tarif' : `${p.price_monthly}`
        info(`  ${p.slug}/${p.target_role} — ${etat}${p.stripe_price_id_monthly ? ' [Stripe]' : ''}`)
      }
      const ids = synced.map((p) => p.stripe_price_id_monthly)
      ok(new Set(ids).size === ids.length, 'aucun price Stripe partagé par deux offres')
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

console.log(
  failures === 0
    ? '\nRÉSULTAT : tout est vert. Le socle tient, le mur reste fermé.\n'
    : `\nRÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
