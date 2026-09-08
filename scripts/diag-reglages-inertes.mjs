// scripts/diag-reglages-inertes.mjs — UN RÉGLAGE RÈGLE QUELQUE CHOSE, OU IL LE DIT.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE SCRIPT EXISTE
//   Trois défauts de la même famille, tous coûteux, tous invisibles à la
//   relecture et au compilateur :
//
//   · UN PLAFOND QU'ON NE VOIT PAS. Le plafond d'ANNONCES ACTIVES est le
//     blocage réellement ressenti par une organisation ; le back-office
//     n'affichait que le quota MENSUEL, qui est une autre limite. Son absence
//     a coûté une heure de diagnostic à l'aveugle.
//
//   · UN RÉGLAGE QUI NE RÈGLE RIEN. `packages.max_seats` existe en base et
//     n'est lu par aucune garde : le poser à 5 ne limite rien, et rien ne le
//     disait. Le champ RESTE (la facturation au siège est prévue), mais il
//     doit se présenter comme inactif — et le jour où du code s'en sert pour
//     APPLIQUER une limite, il faudra DÉCIDER du comportement (bloquer les
//     invitations ? suspendre un membre ? un siège est une personne), pas
//     l'improviser. Ce script rougit ce jour-là.
//
//   · UN RÉGLAGE ÉCRIT DANS LE CODE. « 3 analyses par 24 h » vivait en dur
//     dans SIX écritures réparties sur deux routes. Le relever supposait un
//     déploiement ; le relever à moitié ne signalait rien.
//
// CE QU'IL VÉRIFIE — LE MÉCANISME, PAS LA DOCUMENTATION
//   Un contrôle qui trouve un code dans un commentaire ou dans une chaîne
//   d'aide ne prouve rien. Les commentaires sont donc retirés avant analyse,
//   et chaque contrôle vise la forme qui AGIT.
//
// CE QU'IL NE VÉRIFIE PAS — à dire honnêtement
//   Il ne prouve pas qu'un écran s'affiche correctement, ni qu'une requête
//   renvoie le bon nombre. Il prouve que la RÈGLE est unique, qu'elle est
//   lue là où elle doit l'être, et qu'aucune valeur ne la double en silence.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-reglages-inertes.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE variable d'environnement.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Fins de ligne NORMALISÉES. Le dépôt sort les fichiers en CRLF : un motif qui
 * traverse une fin de ligne ne matche jamais sur une copie fraîchement
 * extraite, et le diagnostic vire au rouge sans qu'aucun code n'ait changé.
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

function fichiers(rel, out = []) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) return out
  if (statSync(abs).isDirectory()) {
    for (const e of readdirSync(abs)) fichiers(join(rel, e), out)
    return out
  }
  if (/\.tsx?$/.test(rel)) out.push(relative('', rel).split('\\').join('/'))
  return out
}

const EXPIRY = 'lib/publications/expiry.ts'
const ORG_USAGE = 'app/api/admin/org-usage/route.ts'
const ECRAN_ORG = 'app/[locale]/admin/organisations/[id]/page.tsx'
const ECRAN_PKG = 'app/[locale]/admin/packages/[id]/page.tsx'
const QUOTAS_LIB = 'lib/ai-quotas.ts'
const ROUTE_CV = 'app/api/profile/upload-cv/route.ts'
const ROUTE_CV_CDI = 'app/api/profile/cdi-upload-cv/route.ts'
const ROUTE_QUOTAS = 'app/api/admin/ai-quotas/route.ts'
const ECRAN_QUOTAS = 'app/[locale]/admin/quotas-ia/page.tsx'
const NAV = 'lib/nav-config.ts'

const messages = Object.fromEntries(
  ['fr', 'en', 'es', 'de'].map((l) => [l, JSON.parse(read(`messages/${l}.json`))]),
)
const cle = (o, c) => c.split('.').reduce((x, k) => (x == null ? x : x[k]), o)
const dansLes4Langues = (chemin) =>
  ['fr', 'en', 'es', 'de'].every((l) => {
    const v = cle(messages[l], chemin)
    return typeof v === 'string' && v.trim().length > 0
  })

// Les sources parcourues couvrent app/ ET lib/ : un client Supabase n'est pas
// typé, un balayage qui s'arrête à app/ rate la moitié du code qui écrit.
const sources = ['app', 'lib'].flatMap((d) => fichiers(d))

console.log('\nLOT 4B — LES RÉGLAGES QUI NE RÉGLAIENT RIEN\n')

// ═════════════════════════════════════════════════════════════════════════════
section('0. Présence des artefacts')
for (const f of [EXPIRY, ORG_USAGE, ECRAN_ORG, ECRAN_PKG, QUOTAS_LIB, ROUTE_CV, ROUTE_CV_CDI, ROUTE_QUOTAS, ECRAN_QUOTAS, NAV]) {
  ok(exists(f), `${f} existe`)
}

const expiry = sansCommentaires(read(EXPIRY))
const orgUsage = sansCommentaires(read(ORG_USAGE))
const ecranOrg = sansCommentaires(read(ECRAN_ORG))
const ecranPkg = sansCommentaires(read(ECRAN_PKG))
const quotasLib = sansCommentaires(read(QUOTAS_LIB))
const routeCv = sansCommentaires(read(ROUTE_CV))
const routeCvCdi = sansCommentaires(read(ROUTE_CV_CDI))
const routeQuotas = sansCommentaires(read(ROUTE_QUOTAS))
const ecranQuotas = sansCommentaires(read(ECRAN_QUOTAS))
const nav = sansCommentaires(read(NAV))

// ═════════════════════════════════════════════════════════════════════════════
section('A. Le plafond d’annonces ACTIVES est visible, et c’est la MÊME règle')

ok(
  /activePublishedOrClause\(/.test(orgUsage),
  'org-usage compte les actives avec la règle PARTAGÉE',
  'Reconstruire le filtre ici ferait diverger le back-office du gate publish.',
)

// L'écran doit afficher le COMPTE et le PLAFOND ensemble. Un compte sans
// plafond ne dit pas si l'organisation est bloquée — c'était l'état de départ.
ok(
  /usage\.usage\.active_published/.test(ecranOrg) && /usage\.limits\.activePublicationsMax/.test(ecranOrg),
  'la fiche organisation affiche « actives / plafond », pas seulement le compte',
  'Le quota MENSUEL est une autre limite : afficher l’un pour l’autre égare.',
)

// « Illimité » doit s'écrire, pas se deviner. Un plafond nul rendu en nombre
// afficherait « 3 / 0 », et rendu en vide afficherait « 3 / ».
ok(
  /limit == null \? `\$\{used\} \/ \$\{t\('pilot\.unlimited'\)\}`/.test(ecranOrg),
  'un plafond absent s’affiche « illimité », ni 0 ni vide',
  'C’est l’inversion corrigée au lot 3 : un plafond nul veut dire SANS limite.',
)

ok(dansLes4Langues('admin_back_office.pilot.unlimited'), 'le libellé « illimité » existe en 4 langues')
ok(
  dansLes4Langues('admin_back_office.pilot.usage_active_published'),
  'le libellé « annonces actives » existe en 4 langues',
)

// UNE SEULE règle d'expiration. Un second endroit qui reconstruit la clause à
// la main, c'est l'incohérence garantie le jour où le TTL change.
const reconstruisent = sources.filter((rel) => {
  if (rel === EXPIRY) return false
  const src = sansCommentaires(read(rel))
  return /expires_at\.(gt|is)\./.test(src) || /published_at\.gt\./.test(src)
})
ok(
  reconstruisent.length === 0,
  'aucun fichier ne reconstruit la règle d’expiration à la main',
  reconstruisent.length ? `à faire passer par ${EXPIRY} : ${reconstruisent.join(' · ')}` : undefined,
)

// Le TTL vit dans le module, et nulle part ailleurs.
ok(/PUBLICATION_TTL_DAYS = 30/.test(expiry), 'le TTL de 30 jours vit dans le module d’expiration')

// ═════════════════════════════════════════════════════════════════════════════
section('B. max_seats : conservé, VISIBLEMENT inactif, et surveillé')

/**
 * QUI PARLE DE max_seats, ET POURQUOI.
 *
 * Inventaire déclaré plutôt que liste de motifs interdits : un fichier qui
 * apparaît sans raison écrite rougit. C'est le sens de l'erreur qu'on veut —
 * mieux vaut déclarer un porteur de trop que rater celui qui applique.
 *
 * `lib/database.types.ts` est EXCLU : il est généré depuis le schéma, il cite
 * toutes les colonnes de la base et n'en applique aucune.
 */
const PORTEURS_ATTENDUS = {
  'app/api/admin/get-package/[id]/route.ts': 'lecture : la fiche a besoin de la valeur pour l’afficher',
  'app/[locale]/admin/packages/[id]/page.tsx': 'affichage INACTIF : champ désactivé + mention',
}
const porteurs = sources.filter((rel) => {
  if (rel === 'lib/database.types.ts') return false
  return /max_seats/.test(sansCommentaires(read(rel)))
})
const nonDeclares = porteurs.filter((r) => !(r in PORTEURS_ATTENDUS))
ok(
  nonDeclares.length === 0,
  `tout fichier citant max_seats est déclaré (${porteurs.length} trouvé(s))`,
  nonDeclares.length
    ? `non déclaré(s) : ${nonDeclares.join(' · ')} — si du code APPLIQUE désormais une limite de sièges, il faut d’abord DÉCIDER du comportement (bloquer l’invitation ? suspendre un membre ?), puis retirer la mention « non appliqué » des 4 langues`
    : undefined,
)
const disparus = Object.keys(PORTEURS_ATTENDUS).filter((r) => !porteurs.includes(r))
ok(disparus.length === 0, 'aucune entrée périmée dans l’inventaire', disparus.join(' · '))

/**
 * max_seats ne doit JAMAIS être COMPARÉ.
 *
 * C'est la forme qui APPLIQUE une limite : `>=`, `>`, `<`, `<=`, ou une
 * comparaison d'égalité contre un compte. Le porter et l'afficher est permis ;
 * le confronter à un nombre de membres ne l'est pas.
 */
const compare = sources.filter((rel) => {
  if (rel === 'lib/database.types.ts') return false
  const src = sansCommentaires(read(rel))
  return /max_seats\s*(>=|<=|>|<|===|!==|==)/.test(src) || /(>=|<=|>|<)\s*[\w.]*max_seats/.test(src)
})
ok(
  compare.length === 0,
  'max_seats n’est comparé nulle part (le comparer, c’est appliquer une limite)',
  compare.join(' · '),
)

// Le moteur de droits est l'endroit où une limite de sièges atterrirait.
ok(
  !/max_seats/.test(sansCommentaires(read('lib/entitlements.ts'))),
  'le moteur de droits ignore max_seats',
  'Une limite de sièges appliquée ici suspendrait des personnes sans décision produit.',
)

// Aucune route ne doit ACCEPTER de l'écrire : désactiver un champ dans l'UI ne
// garde rien, un POST direct passerait.
const ecrivent = sources.filter((rel) => {
  if (!rel.startsWith('app/api/')) return false
  const src = sansCommentaires(read(rel))
  return /max_seats\s*:/.test(src)
})
ok(
  ecrivent.length === 0,
  'aucune route n’accepte d’écrire max_seats (la garde est au SERVEUR)',
  ecrivent.join(' · '),
)

// Visiblement inactif à l'écran : désactivé ET expliqué.
ok(
  /id="max_seats"/.test(ecranPkg) && /disabled/.test(ecranPkg.slice(ecranPkg.indexOf('id="max_seats"'), ecranPkg.indexOf('id="max_seats"') + 400)),
  'le champ sièges est rendu DÉSACTIVÉ sur la fiche offre',
)
ok(
  /packages\.max_seats_inactive/.test(ecranPkg),
  'la mention « non appliqué » est rendue à côté du champ',
  'Un champ grisé sans explication laisse croire à un droit manquant.',
)
for (const k of ['field_max_seats', 'max_seats_badge', 'max_seats_inactive']) {
  ok(dansLes4Langues(`admin_back_office.packages.${k}`), `packages.${k} existe en 4 langues`)
}

// ═════════════════════════════════════════════════════════════════════════════
section('C. Le quota d’analyses de CV se règle sans déploiement')

// Plus AUCUNE valeur en dur dans les deux routes — ni le nombre, ni la fenêtre,
// ni le chiffre réécrit dans le texte du refus.
for (const [nom, src] of [['upload-cv', routeCv], ['cdi-upload-cv', routeCvCdi]]) {
  ok(!/RATE_LIMIT/.test(src), `${nom} n’a plus de constante RATE_LIMIT`)
  ok(
    !/24 \* 60 \* 60 \* 1000/.test(src),
    `${nom} ne recalcule plus la fenêtre de 24 h à la main`,
    'La fenêtre est le second réglage : la laisser en dur, c’est n’en externaliser que la moitié.',
  )
  ok(
    !/\d+\s*parsings\s*\/\s*\d+h/.test(src),
    `${nom} ne réécrit plus le quota dans le texte du refus`,
    'Le message resterait faux le jour où le réglage change.',
  )
  ok(/loadCvParsingQuota\(/.test(src), `${nom} LIT le quota en base`)
  // La MENTION de `quota.maxPerWindow` ne prouve rien : elle survit dans le
  // texte du refus alors que la COMPARAISON est repassée à un littéral
  // (mutation M9). C'est la comparaison elle-même qu'on exige.
  ok(
    /count24h\s*>=\s*quota\.maxPerWindow/.test(src),
    `${nom} COMPARE au quota lu, pas à un nombre écrit là`,
  )
  ok(
    /windowEndsAt\(quota/.test(src),
    `${nom} applique aussi la FENÊTRE lue (le second réglage)`,
  )
  ok(
    /quota_config_missing|err\.code/.test(src) && /503/.test(src),
    `${nom} REFUSE en 503 si le réglage manque, au lieu de deviner`,
  )
}

// Le module ne doit pas contenir de repli : un `?? 3` serait un second réglage
// prenant la main en silence — exactement le défaut corrigé.
// Chercher `?? 3` ou `= 3` ratait la forme la plus naturelle d'un repli :
// `return { maxPerWindow: 3, windowHours: 24 }` (mutation M11). On interdit
// donc qu'un CHAMP de quota reçoive un littéral, quelle que soit l'écriture.
ok(
  !/maxPerWindow\s*:\s*\d/.test(quotasLib) &&
    !/windowHours\s*:\s*\d/.test(quotasLib) &&
    !/\?\?\s*\d/.test(quotasLib),
  'lib/ai-quotas ne contient AUCUNE valeur de repli',
  'Un repli invisible est un second réglage que personne ne sait lire.',
)
ok(/throw new QuotaConfigMissing/.test(quotasLib), 'le module LÈVE quand la ligne manque')
ok(
  !/cache|memo|let\s+cached/i.test(quotasLib),
  'le quota n’est pas mémoïsé',
  'Un réglage mis en cache continuerait d’appliquer l’ancienne valeur après correction.',
)

// La migration crée la ligne, et se contrôle elle-même.
const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
const migQuota = migrations.find((f) => /quota_analyses_cv/.test(f))
ok(migQuota !== undefined, 'la migration du quota existe (résolue par son suffixe, jamais par son numéro)')
if (migQuota) {
  const sql = read(`supabase/migrations/${migQuota}`)
  ok(/create table if not exists public\.ai_quotas/.test(sql), 'elle crée la table ai_quotas')
  ok(/insert into public\.ai_quotas/.test(sql) && /'cv_parsing'/.test(sql), 'elle amorce la ligne cv_parsing')
  ok(/raise exception/.test(sql), 'elle échoue bruyamment si la ligne manque après application')
  ok(
    /revoke all on table public\.ai_quotas/.test(sql) && /enable row level security/.test(sql),
    'la table est fermée (RLS + revoke), service_role seul',
  )
}

// Réglable POUR DE VRAI : une route d'administration et un écran atteignable.
ok(/requireAdmin\(/.test(routeQuotas), 'la route de réglage est gardée admin, au SERVEUR')
ok(/logAudit\(/.test(routeQuotas), 'toute modification du quota laisse une trace d’audit')
ok(
  /avant/.test(routeQuotas) && /apres/.test(routeQuotas),
  'la trace dit d’où vient le réglage ET ce qu’il devient',
)
ok(
  /'\/admin\/quotas-ia'/.test(nav),
  'l’écran de réglage est atteignable depuis la navigation admin',
  'Un réglage rangé en base sans écran reste hors de portée : le défaut aurait juste changé de place.',
)
ok(/useSecureFetch\(/.test(ecranQuotas), 'l’écran passe par useSecureFetch')
ok(
  /bounds/.test(ecranQuotas) && !/max=\{1000\}/.test(ecranQuotas),
  'les bornes affichées viennent du SERVEUR, elles ne sont pas recopiées dans l’écran',
)
for (const k of ['title', 'cv_hint', 'field_max', 'field_window', 'summary', 'err_missing']) {
  ok(dansLes4Langues(`admin_back_office.quotas_ia.${k}`), `quotas_ia.${k} existe en 4 langues`)
}
ok(dansLes4Langues('admin_back_office.sidebar.nav_quotas_ia'), 'l’entrée de menu existe en 4 langues')

// ═════════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ RÉSULTAT : tout est vert. Aucun réglage ne ment, aucun ne vit dans le code.\n'
    : `\n❌ RÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
