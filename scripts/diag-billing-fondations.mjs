// scripts/diag-billing-fondations.mjs — LOT 0 STRIPE : les fondations tiennent-elles ?
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le Lot 0 ne produit AUCUN comportement observable : ni écran, ni route, ni
//   encaissement. On ne peut donc pas le vérifier « en cliquant ». Ce qu'il
//   pose, ce sont des INVARIANTS — et un invariant qui n'est pas testé n'en est
//   pas un.
//
//   Cinq invariants, chacun protégeant contre un manquement réel :
//
//   1. OFFRE PAR DÉFAUT GRATUITE. Une organisation retombe sur l'offre
//      `is_default` quand son abonnement expire, échoue au renouvellement ou
//      est résilié. Si cette offre était payante, elle devrait de l'argent SANS
//      avoir souscrit. Verrouillé par CHECK, pas seulement par du code.
//
//   2. PIÈCE COMPTABLE INDESTRUCTIBLE. Conservation légale 10 ans. Le risque
//      est ici INVERSE de l'habituel : ce n'est pas « on garde trop », c'est
//      « on détruit une pièce ». Vérifié à deux niveaux — la purge RGPD
//      anonymise sans supprimer, ET un trigger interdit la suppression.
//
//   3. IDEMPOTENCE PAR CONTRAINTE, JAMAIS PAR LECTURE-PUIS-ÉCRITURE. Stripe
//      rejoue le même événement ; deux livraisons simultanées existent. Un
//      `select` suivi d'un `insert` a un trou. La clé primaire n'en a pas.
//
//   4. AUCUNE FUITE DU VERROU CÔTÉ CLIENT. Le mur payant est fermé au SERVEUR.
//      Une variable NEXT_PUBLIC_ le rendrait lisible — et contournable — dans
//      le bundle navigateur.
//
//   5. UN SEUL `consumeQuota`. `lib/packages.ts` en exposait un SECOND, mort
//      (« NON appelé par les routes existantes », TODO B5). Deux fonctions
//      homonymes dont une morte, au moment d'écrire du code d'argent, est le
//      piège que quelqu'un déclenchera. Le module est supprimé ; ce diag
//      empêche son retour.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-billing-fondations.mjs        → contrôles statiques.
//                                                     AUCUN accès base.
//   node --env-file=.env.local scripts/diag-billing-fondations.mjs --db
//                                                   → + inventaire LECTURE SEULE
//                                                     (migration poussée ?
//                                                      invariant tenu en base ?)
//
// LECTURE PURE : ce script n'écrit JAMAIS, dans aucun mode.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const exists = (p) => existsSync(join(ROOT, p))

/** Retire les commentaires : un anti-pattern doit pouvoir être DOCUMENTÉ. */
const stripJsComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')

/** Idem pour le SQL : les commentaires `--` décrivent, ils ne prouvent rien. */
const stripSqlComments = (src) =>
  src
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`)
  }
}
const info = (label) => console.log(`  ··   ${label}`)
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const MIGRATION = 'supabase/migrations/20260901000000_stripe_fondations.sql'

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nLOT 0 STRIPE — FONDATIONS\n')

section('0. Présence des artefacts')

ok(exists(MIGRATION), `la migration ${MIGRATION} existe`, 'Le lot 0 est une migration : sans elle, rien ne tient.')
if (!exists(MIGRATION)) {
  console.log('\nArrêt : la migration est introuvable.\n')
  process.exit(1)
}

const sqlRaw = read(MIGRATION)
const sql = stripSqlComments(sqlRaw)

ok(
  !exists('lib/packages.ts'),
  'lib/packages.ts est supprimé (stub mort, second consumeQuota)',
  "Le module se déclarait lui-même « NON appelé par les routes existantes » et portait un TODO B5.",
)

// ─────────────────────────────────────────────────────────────────────────────
section('1. Invariant tarifaire — une offre par défaut est gratuite')

ok(
  /add\s+constraint\s+packages_default_must_be_free/i.test(sql),
  'la contrainte packages_default_must_be_free est posée EN BASE',
  "Un garde-fou seulement en code se contourne par la première route qui oublie de l'appeler.",
)

ok(
  /check\s*\(\s*\n?\s*is_default\s*=\s*false[\s\S]{0,220}?coalesce\s*\(\s*price_monthly[\s\S]{0,80}?=\s*0/i.test(sql),
  'la contrainte exige bien price_monthly nul pour is_default',
  'Le CHECK doit porter sur les DEUX cadences, coalesce comprise.',
)

// La normalisation NULL -> 0 doit précéder la contrainte, sinon le push échoue
// sur les offres seedées 'free' et 'collaboration' (price_monthly null).
const idxNormalise = sql.search(/update\s+public\.packages\s+set\s+price_monthly\s*=\s*0/i)
const idxContrainte = sql.search(/add\s+constraint\s+packages_default_must_be_free/i)
ok(
  idxNormalise !== -1 && idxContrainte !== -1 && idxNormalise < idxContrainte,
  'la normalisation NULL → 0 précède la pose de la contrainte',
  "Les offres seedées 'free' et 'collaboration' ont price_monthly NULL : sans normalisation préalable, le push échoue.",
)

ok(
  /raise\s+exception[\s\S]{0,400}?Offre\(s\)\s+par\s+défaut\s+PAYANTE/i.test(sqlRaw),
  'un pré-contrôle nomme les offres fautives avant de laisser le CHECK échouer',
  "Sans lui, un push échoue sur un message Postgres illisible.",
)

// Sémantique côté écran : null et 0 ne doivent plus être confondus.
const offrePage = stripJsComments(read('app/[locale]/dashboard/entreprise/offre/page.tsx'))
ok(
  !/price\s*==\s*null\s*\|\|\s*Number\(price\)\s*===\s*0/.test(offrePage),
  "l'écran « Mon offre » ne confond plus null et 0",
  "Le test `price == null || Number(price) === 0` affichait « Gratuit » pour une offre sans tarif.",
)
ok(
  /t\('price_undefined'\)/.test(offrePage) && /t\('free'\)/.test(offrePage),
  "l'écran distingue « tarif non défini » de « gratuit »",
)

// ─────────────────────────────────────────────────────────────────────────────
section('2. Conservation comptable — une pièce ne se détruit pas')

const purge = read('lib/account-purge.ts')
const purgeCode = stripJsComments(purge)

ok(
  !/auth\.admin\.deleteUser/.test(purgeCode),
  'purgeAccount n\'appelle JAMAIS auth.admin.deleteUser',
  "Une suppression cascaderait sur messages.sender_id ET rendrait la ligne users supprimable.",
)
ok(
  !/from\(['"]users['"]\)[\s\S]{0,120}?\.delete\(\)/.test(purgeCode),
  'purgeAccount ne supprime pas la ligne users (elle l\'anonymise en place)',
)
ok(
  /status:\s*'archived'/.test(purgeCode) && /anonymized_at:/.test(purgeCode),
  'purgeAccount anonymise et marque le compte (status archived + anonymized_at)',
)
ok(
  !/transactions/i.test(purgeCode),
  'purgeAccount ne touche à AUCUNE transaction',
  "Anonymiser un compte ne doit jamais effacer un montant ni une date : conservation 10 ans.",
)

// Les deux chemins de suppression doivent passer par la MÊME fonction.
ok(
  /purgeAccount/.test(read('app/api/admin/user-purge/route.ts')),
  'la suppression back-office passe par purgeAccount',
)

// Verrou en base, pas seulement « ça se trouve être vrai ».
ok(
  /create\s+trigger\s+transactions_block_delete[\s\S]{0,120}?before\s+delete\s+on\s+public\.transactions/i.test(sql),
  'un trigger BEFORE DELETE protège transactions',
  'Le service-role bypasse RLS mais PAS les triggers : le verrou lie tous les chemins.',
)
ok(
  /if\s+old\.livemode\s+then[\s\S]{0,400}?raise\s+exception/i.test(sql),
  'le trigger ne bloque que les lignes livemode (les lignes de TEST restent nettoyables)',
)
ok(
  /transactions_organization_id_fkey[\s\S]{0,300}?on\s+delete\s+restrict/i.test(sql),
  "transactions.organization_id est en ON DELETE RESTRICT",
  "Une organisation qui a des pièces comptables ne doit pas pouvoir disparaître.",
)
ok(
  /add\s+column\s+if\s+not\s+exists\s+organization_id/i.test(sql),
  'transactions gagne organization_id (le débiteur est une organisation, pas une personne)',
)

// ─────────────────────────────────────────────────────────────────────────────
section('3. Idempotence — par contrainte de base, jamais par lecture-puis-écriture')

ok(
  /create\s+table\s+if\s+not\s+exists\s+public\.stripe_events/i.test(sql),
  'la table stripe_events existe',
)
ok(
  /id\s+text\s+primary\s+key/i.test(sql),
  "la clé primaire de stripe_events EST l'identifiant Stripe (evt_...)",
  "L'unicité doit être STRUCTURELLE, pas vérifiée applicativement.",
)

// Le corps de stripe_event_claim : un seul INSERT, aucun SELECT préalable.
const claimBody = (sql.match(
  /create\s+or\s+replace\s+function\s+public\.stripe_event_claim[\s\S]*?\$\$([\s\S]*?)\$\$\s*;/i,
) || [])[1]
ok(Boolean(claimBody), 'la fonction stripe_event_claim est définie')
if (claimBody) {
  const inserts = (claimBody.match(/insert\s+into\s+public\.stripe_events/gi) || []).length
  ok(inserts === 1, `stripe_event_claim fait UN SEUL insert (${inserts} trouvé(s))`)
  // Le contrôle ne cherche PAS un mot-clé de lecture : il vérifie que le tout
  // PREMIER accès à la table est l'insert. `select … from`, `perform … from`,
  // un `exists(…)`, une jointure — n'importe quelle lecture préalable rouvre la
  // course entre deux livraisons simultanées. Chercher « select » aurait laissé
  // passer « perform » (qui EST une lecture en plpgsql).
  const firstTouch = claimBody.search(/public\.stripe_events/i)
  const before = claimBody.slice(Math.max(0, firstTouch - 60), firstTouch)
  ok(
    firstTouch !== -1 && /insert\s+into\s+$/i.test(before.replace(/\s+/g, ' ').replace(/ $/, ' ')),
    "le PREMIER accès de stripe_event_claim à la table est l'insert (aucune lecture préalable)",
    'Toute lecture avant l\'insert (select, perform, exists…) laisse une course entre deux livraisons simultanées de Stripe.',
  )
  ok(
    /on\s+conflict\s*\(\s*id\s*\)\s+do\s+update/i.test(claimBody),
    "l'idempotence passe par ON CONFLICT (id)",
  )
  ok(
    /where\s+se\.status\s*=\s*'failed'/i.test(claimBody),
    "seul un événement en échec est rejouable (les autres sont refusés)",
  )
}

ok(
  /alter\s+table\s+public\.stripe_events\s+enable\s+row\s+level\s+security/i.test(sql),
  'RLS est activée sur stripe_events',
)
ok(
  !/create\s+policy[\s\S]{0,200}?stripe_events/i.test(sql),
  'aucune policy sur stripe_events (service-role uniquement, modèle usage_counters)',
)
for (const fn of ['stripe_event_claim', 'stripe_event_mark']) {
  ok(
    new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}[\\s\\S]{0,160}?from\\s+public,\\s*anon,\\s*authenticated`, 'i').test(sql),
    `${fn} est révoquée pour public/anon/authenticated`,
  )
  ok(
    new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}[\\s\\S]{0,160}?to\\s+service_role`, 'i').test(sql),
    `${fn} n'est exécutable que par service_role`,
  )
}

// Deuxième barrière : même journal contourné, on ne crédite pas deux fois.
ok(
  /create\s+unique\s+index\s+if\s+not\s+exists\s+idx_transactions_stripe_pi[\s\S]{0,200}?where\s+stripe_payment_intent_id\s+is\s+not\s+null/i.test(sql),
  'stripe_payment_intent_id devient UNIQUE (index partiel)',
  "L'index de la baseline existait mais n'était PAS unique.",
)
ok(
  /create\s+unique\s+index\s+if\s+not\s+exists\s+idx_transactions_stripe_invoice/i.test(sql),
  'stripe_invoice_id est UNIQUE — clé de dédoublonnage des renouvellements',
)

// Anti-désordre : Stripe ne garantit aucun ordre de livraison.
ok(
  /add\s+column\s+if\s+not\s+exists\s+package_source_event_at/i.test(sql),
  'organization_domains.package_source_event_at existe (garde anti-désordre)',
  "Sans elle, un subscription.updated retardataire écraserait un subscription.deleted plus récent.",
)

// ─────────────────────────────────────────────────────────────────────────────
section('4. Le verrou reste au SERVEUR')

// Aucune variable publique de facturation nulle part dans le projet.
const scanned = [
  'app', 'lib', 'components', 'proxy.ts', 'next.config.ts',
]
let leak = null
const walk = (rel) => {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) return
  const st = statSync(abs)
  if (st.isDirectory()) {
    for (const e of readdirSync(abs)) walk(join(rel, e))
    return
  }
  if (!/\.(ts|tsx|mjs)$/.test(rel)) return
  const src = readFileSync(abs, 'utf8')
  const m = src.match(/NEXT_PUBLIC_[A-Z_0-9]*(?:STRIPE|BILLING)[A-Z_0-9]*/)
  if (m) leak = `${rel} → ${m[0]}`
}
scanned.forEach(walk)
ok(leak === null, 'aucune variable NEXT_PUBLIC_ de facturation', leak ? `Fuite : ${leak}` : undefined)

// Le lot 0 ne branche RIEN : aucune clé Stripe ne doit encore être lue.
let reads = []
const walkEnv = (rel) => {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) return
  if (statSync(abs).isDirectory()) {
    for (const e of readdirSync(abs)) walkEnv(join(rel, e))
    return
  }
  if (!/\.(ts|tsx|mjs)$/.test(rel)) return
  const src = readFileSync(abs, 'utf8')
  for (const m of src.matchAll(/process\.env\.(STRIPE[A-Z_0-9]*|ENABLE_BILLING)/g)) {
    reads.push(`${rel} → ${m[1]}`)
  }
}
scanned.forEach(walkEnv)
ok(
  reads.length === 0,
  'le Lot 0 ne lit AUCUNE variable Stripe (il ne branche rien)',
  reads.length ? `Trouvé : ${reads.join(', ')}` : undefined,
)

// ─────────────────────────────────────────────────────────────────────────────
section('5. Le moteur commerce n\'a pas bougé')

const ent = stripJsComments(read('lib/entitlements.ts'))
ok(
  /organization_domains[\s\S]{0,200}?package_id,\s*package_valid_until/.test(ent),
  'getOrgEntitlements lit toujours package_id + package_valid_until',
  "Ce sont EXACTEMENT les colonnes que le webhook écrira : c'est le contrat entre les lots.",
)
ok(
  /export\s+async\s+function\s+consumeQuota/.test(ent),
  'lib/entitlements.ts exporte consumeQuota',
)

// Un seul consumeQuota dans tout le projet — l'homonyme mort ne doit pas revenir.
let quotaOwners = []
const walkQuota = (rel) => {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) return
  if (statSync(abs).isDirectory()) {
    for (const e of readdirSync(abs)) walkQuota(join(rel, e))
    return
  }
  if (!/\.ts$/.test(rel)) return
  if (/export\s+(async\s+)?function\s+consumeQuota/.test(readFileSync(abs, 'utf8'))) quotaOwners.push(rel)
}
walkQuota('lib')
ok(
  quotaOwners.length === 1,
  `un SEUL module exporte consumeQuota (${quotaOwners.join(', ') || 'aucun'})`,
  quotaOwners.length > 1 ? `Homonymes : ${quotaOwners.join(', ')}` : undefined,
)

// Les trois gates 402 sont intactes.
const gates = [
  ['app/api/publications/[id]/publish/route.ts', 'active_publications_limit_reached'],
  ['app/api/publications/[id]/publish/route.ts', 'quota_publications_reached'],
  ['app/api/candidatures/[id]/unlock/route.ts', 'unlock_limit_reached'],
]
for (const [file, code] of gates) {
  ok(read(file).includes(code), `gate 402 « ${code} » toujours en place`)
}

// ─────────────────────────────────────────────────────────────────────────────
section('6. Parité i18n (4 langues)')

for (const loc of ['fr', 'en', 'es', 'de']) {
  const j = JSON.parse(read(`messages/${loc}.json`))
  const o = j?.dashboard_entreprise?.offre ?? {}
  ok(
    typeof o.price_undefined === 'string' && o.price_undefined.trim() !== '',
    `messages/${loc}.json : dashboard_entreprise.offre.price_undefined`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
section('7. Signalements (non bloquants)')

const pkgJson = JSON.parse(read('package.json'))
if (pkgJson.dependencies?.['@stripe/stripe-js']) {
  info('@stripe/stripe-js est déclaré et jamais importé — à retirer au Lot 5 (Checkout hébergé ne l\'exige pas).')
}
if (pkgJson.dependencies?.stripe) {
  info(`stripe@${pkgJson.dependencies.stripe} déjà présent — aucune dépendance à ajouter (contrainte 11).`)
}
info('lib/database.types.ts est stale et n\'est importé nulle part : la migration n\'impose pas de le régénérer.')

// ─────────────────────────────────────────────────────────────────────────────
// MODE --db : inventaire LECTURE SEULE.
// ─────────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--db')) {
  section('8. Base (lecture seule)')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    failures++
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents')
    console.log('       → node --env-file=.env.local scripts/diag-billing-fondations.mjs --db')
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false } })

    // La migration est-elle poussée ? La table est le marqueur le plus net.
    const { error: evErr } = await db.from('stripe_events').select('id').limit(1)
    const pushed = !evErr
    ok(pushed, 'la migration est poussée (table stripe_events lisible)', evErr?.message)

    // L'invariant tarifaire tient-il sur les DONNÉES réelles ?
    const { data: defs, error: pkgErr } = await db
      .from('packages')
      .select('slug, target_role, price_monthly, price_yearly, is_default, active')
      .eq('is_default', true)
    if (pkgErr) {
      failures++
      console.log(`  KO   lecture packages impossible : ${pkgErr.message}`)
    } else {
      const bad = (defs ?? []).filter(
        (p) => Number(p.price_monthly ?? 0) !== 0 || Number(p.price_yearly ?? 0) !== 0,
      )
      ok(
        bad.length === 0,
        `aucune offre par défaut payante (${defs?.length ?? 0} offre(s) par défaut)`,
        bad.length ? bad.map((p) => `${p.slug}/${p.target_role}`).join(', ') : undefined,
      )
      if (pushed) {
        const nulls = (defs ?? []).filter((p) => p.price_monthly === null)
        ok(
          nulls.length === 0,
          'toutes les offres par défaut ont un prix EXPLICITE à 0 (normalisation appliquée)',
          nulls.length ? nulls.map((p) => `${p.slug}/${p.target_role}`).join(', ') : undefined,
        )
      }
      for (const p of defs ?? []) {
        info(`offre par défaut : ${p.slug}/${p.target_role} — ${p.price_monthly} ${p.active ? '' : '(INACTIVE)'}`)
      }
    }

    // Colonnes neuves lisibles ?
    if (pushed) {
      const { error: orgErr } = await db.from('organizations').select('stripe_customer_id').limit(1)
      ok(!orgErr, 'organizations.stripe_customer_id existe', orgErr?.message)
      const { error: odErr } = await db
        .from('organization_domains')
        .select('stripe_subscription_id, stripe_subscription_status, package_source_event_at')
        .limit(1)
      ok(!odErr, 'organization_domains porte les colonnes d\'abonnement', odErr?.message)
      const { error: txErr } = await db
        .from('transactions')
        .select('organization_id, stripe_invoice_id, livemode, amount_excl_tax, tax_amount, tax_status')
        .limit(1)
      ok(!txErr, 'transactions porte les colonnes comptables et fiscales', txErr?.message)

      const { count: txCount } = await db
        .from('transactions')
        .select('id', { count: 'exact', head: true })
      info(`transactions en base : ${txCount ?? 0} (le Lot 0 n'en écrit aucune)`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(
  failures === 0
    ? '\nRÉSULTAT : tout est vert. Les fondations tiennent, rien n\'encaisse.\n'
    : `\nRÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
