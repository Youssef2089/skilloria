// scripts/diag-moteur-reranking.mjs — LE MOTEUR APRÈS LE DÉPART DE CLAUDE
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE SCRIPT DÉFEND
//   Le lot 4 repose sur une poignée de promesses qui ne laissent aucune trace
//   dans le compilateur. Elles se re-perdent en une ligne, et personne ne le
//   verrait :
//
//     • Claude est SORTI de la mise en relation. Un import qui revient, et le
//       coût comme la compétition entre experts reviennent avec lui.
//     • « sous_traitance » n'apparaît plus dans lib/matching/. Ce n'est pas une
//       coquetterie : tant que le moteur connaissait le catalogue des types, il
//       fallait le rouvrir pour ajouter un type, et le nom se dispersait.
//     • Il n'y a AUCUN plafond de vivier. C'était une liste d'autorisés stable
//       et invisible, où le 101ᵉ n'existait pas.
//     • Le score n'est JAMAIS normalisé sur le lot. Normaliser, c'est classer
//       les experts les uns par rapport aux autres — la compétition que le
//       moteur vient de supprimer.
//     • Le budget est relu ENTRE LES LOTS. Vérifié une seule fois au début, un
//       run géant dépasse le plafond de dix fois.
//     • La trace écrite par le code et la trace lue par le SQL parlent des
//       MÊMES clés. Sinon la supervision lit `null` et l'appelle « zéro ».
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-moteur-reranking.mjs
//
// AUCUN accès base, AUCUN réseau.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const existe = (p) => existsSync(join(ROOT, p))

function migration(suffixe) {
  const dossier = join(ROOT, 'supabase', 'migrations')
  const f = readdirSync(dossier).find((x) => x.endsWith(`_${suffixe}.sql`))
  if (!f) {
    console.error(`\n❌ Migration introuvable : *_${suffixe}.sql`)
    process.exit(2)
  }
  return join('supabase', 'migrations', f)
}

let failures = 0
const ok = (cond, label, hint) => {
  if (!cond) failures++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && hint) console.log(`       → ${hint}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const FICHIERS_MOTEUR = readdirSync(join(ROOT, 'lib', 'matching'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `lib/matching/${f}`)

// ══════════════════════════════════════════════════════════════════════════
section('ÉPREUVE DES DÉTECTEURS — avant de leur faire confiance')
// ══════════════════════════════════════════════════════════════════════════

/** Une normalisation de scores sur le lot : diviser par le max, ou ramener à [0,1]. */
function normalisationsSurLeLot(src) {
  const motifs = [
    /Math\.max\(\s*\.\.\./g,
    /\/\s*maxScore\b/g,
    /\bnormaliser?\w*\s*\(/gi,
    /score\s*\/\s*(?:max|total|somme|sum)\b/g,
  ]
  const t = []
  for (const m of motifs) for (const x of src.matchAll(m)) t.push(x[0].replace(/\s+/g, ' '))
  return t
}

/** Un plafond de vivier : une limite posée sur le nombre de profils chargés. */
function plafondsDeVivier(src) {
  const motifs = [/\.limit\(/g, /max_candidates/g, /maxCandidates/g, /\.slice\(0,\s*max/gi]
  const t = []
  for (const m of motifs) for (const x of src.matchAll(m)) t.push(x[0])
  return t
}

{
  const doitTrouver = [
    ['const m = Math.max(...scores)', 'une normalisation par le maximum du lot', normalisationsSurLeLot],
    ['const m = Math.max(...lot.map((x) => x.score))', 'un maximum pris sur une expression', normalisationsSurLeLot],
    ['const x = score / maxScore', 'une division par le max', normalisationsSurLeLot],
    ['q = q.limit(100)', 'un plafond de vivier', plafondsDeVivier],
    ['rows.slice(0, maxCandidates)', 'une coupe à un maximum', plafondsDeVivier],
  ]
  const doitIgnorer = [
    ['Math.max(0, Math.min(1, s))', 'un bornage de score dans [0,1], qui ne compare rien', normalisationsSurLeLot],
    ['const lots = enLots(documents, taille)', 'un découpage en lots, qui ne coupe personne', plafondsDeVivier],
  ]
  for (const [src, libelle, detecteur] of doitTrouver) {
    ok(detecteur(src).length > 0, `détecte : ${libelle}`, 'le détecteur laisserait passer le défaut')
  }
  for (const [src, libelle, detecteur] of doitIgnorer) {
    ok(detecteur(src).length === 0, `ignore : ${libelle}`, 'faux positif : un contrôle qui crie au loup finit ignoré')
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('A. CLAUDE EST SORTI DE LA MISE EN RELATION')
// ══════════════════════════════════════════════════════════════════════════

for (const f of FICHIERS_MOTEUR) {
  const src = read(f)
  ok(!/@anthropic-ai\/sdk/.test(src), `${f} n importe pas le SDK du modèle`,
    'un import qui revient ramène le coût ET la compétition entre experts')
  ok(!/messages\.create\(/.test(src), `${f} n appelle aucun modèle de langage`)
}
ok(!existe('lib/matching/ai-profile-matching.ts') && !existe('lib/matching/ai-expert-matching.ts'),
  'les deux fichiers de notation par prompt ont disparu',
  'les laisser en place laisserait un second moteur, appelable par mégarde')

ok(existe('lib/candidatures/ai-assessment.ts'),
  'le jugement de Claude a un nouveau domicile : la candidature')
ok(/jugerCandidature\(/.test(read('app/api/candidatures/route.ts')),
  'et il est appelé au dépôt d une candidature')
ok(/after\(/.test(read('app/api/candidatures/route.ts')),
  'après la réponse : un dépôt ne dépend jamais d un modèle',
  'faire échouer un dépôt pour une panne de modèle punirait l expert')

// ══════════════════════════════════════════════════════════════════════════
section('B. LE MOTEUR NE CONNAÎT PLUS LE CATALOGUE DES TYPES')
// ══════════════════════════════════════════════════════════════════════════
//
// L'engagement était explicite : « sous_traitance » ne doit plus apparaître une
// seule fois dans lib/matching/. Commentaires compris — un nom de type dans un
// commentaire signale que la connaissance est encore là.

for (const f of FICHIERS_MOTEUR) {
  const occurrences = (read(f).match(/sous_traitance/g) ?? []).length
  ok(occurrences === 0, `${f} ne cite pas « sous_traitance »`,
    occurrences ? `${occurrences} occurrence(s) — le moteur reconnaît encore le catalogue` : undefined)
}
ok(existe('lib/annonces/audience.ts'), 'le catalogue vit dans lib/annonces/audience.ts')
{
  const src = read('lib/annonces/audience.ts')
  ok(/sous_traitance:\s*'expert_freelance'/.test(src),
    'et il y déclare le public de chaque type, une seule fois')
  ok(/export function estTypeAnnonce/.test(src),
    'la reconnaissance d un type y vit aussi',
    'une liste recopiée ailleurs oublierait le type ajouté demain')
}

// ══════════════════════════════════════════════════════════════════════════
section('C. AUCUN PLAFOND DE VIVIER')
// ══════════════════════════════════════════════════════════════════════════

{
  const src = read('lib/matching/pool.ts')
  const trouves = plafondsDeVivier(src)
  ok(trouves.length === 0, 'le vivier n est plafonné nulle part',
    trouves.length
      ? `trouvé : ${trouves.join(' ; ')} — un plafond sans tri est une liste d autorisés invisible`
      : undefined)
}

// ══════════════════════════════════════════════════════════════════════════
section('D. LES FILTRES PORTENT SUR DES CRITÈRES DÉCLARÉS')
// ══════════════════════════════════════════════════════════════════════════

const POOL = read('lib/matching/pool.ts')
const EXPERT = read('lib/matching/run-for-expert.ts')

for (const [motif, libelle] of [
  [/eq\('branch_id'/, 'la branche'],
  [/overlaps\('speciality_ids'/, 'les spécialités'],
  [/overlaps\('seniorities'/, 'les séniorités'],
  [/overlaps\('work_zone_countries'/, 'les zones de travail'],
  [/availability_status\.neq\.do_not_disturb/, 'la disponibilité freelance'],
  [/cdi_status\.neq\.employed/, 'la disponibilité CDI'],
  [/open_to_freelance|open_to_cdi/, 'l ouverture croisée, déclarée par l expert'],
]) {
  ok(motif.test(POOL), `le vivier filtre sur ${libelle}`)
}

console.log('\n— les deux décisions de l expert, dans les DEUX sens')
for (const [nom, src] of [['annonce → experts', POOL], ['expert → annonces', EXPERT]]) {
  ok(/eq\('status', 'dismissed'\)/.test(src), `${nom} : un profil ayant DÉCLINÉ n est pas renoté`,
    'on paierait pour le noter, et la réconciliation ignorerait le résultat')
  ok(/from\('candidatures'\)/.test(src), `${nom} : un profil ayant DÉJÀ POSTULÉ n est pas renoté`)
}

console.log('\n— la sémantique de l ensemble vide')
ok(/annonce\.speciality_ids\.length > 0/.test(POOL),
  'un axe non déclaré par l annonce ne filtre RIEN',
  'un ensemble vide veut dire « aucune contrainte », jamais « personne »')
ok(/annonce\.seniorities\.length > 0/.test(POOL), 'idem pour les séniorités')

// ══════════════════════════════════════════════════════════════════════════
section('E. LE SCORE N EST JAMAIS NORMALISÉ SUR LE LOT')
// ══════════════════════════════════════════════════════════════════════════

for (const f of FICHIERS_MOTEUR) {
  const trouves = normalisationsSurLeLot(read(f))
  ok(trouves.length === 0, `${f} ne normalise aucun score`,
    trouves.length
      ? `trouvé : ${trouves.join(' ; ')} — normaliser, c est classer les experts entre eux`
      : undefined)
}

// ══════════════════════════════════════════════════════════════════════════
section('F. LE BUDGET, ET CE QUI SE PASSE AU PLAFOND')
// ══════════════════════════════════════════════════════════════════════════

const RERANK = read('lib/matching/rerank.ts')
{
  // Le contrôle de budget doit être DANS la boucle sur les lots, pas avant.
  const debutBoucle = RERANK.indexOf('for (const lot of lots)')
  const appelBudget = RERANK.indexOf('budgetDisponible(', debutBoucle)
  ok(debutBoucle !== -1 && appelBudget > debutBoucle,
    'le budget est relu ENTRE LES LOTS',
    'vérifié une seule fois au début, un run géant dépasse le plafond de dix fois')
}
ok(/arret\s*=\s*budget\.raison/.test(RERANK),
  'au plafond, le moteur s arrête et NOMME la raison',
  's arrêter sans un mot fait chercher un bug pendant deux jours')
ok(/enregistrerDepense\(/.test(RERANK), 'la dépense est enregistrée')
{
  const iAppel = RERANK.indexOf('notes += lot.length')
  const iDepense = RERANK.indexOf('enregistrerDepense(', iAppel)
  ok(iAppel !== -1 && iDepense > iAppel,
    'et elle l est APRÈS l appel, sur ce qui a été consommé',
    'un plafond réglé sur des estimations dérive en silence')
}
{
  const BUDGET = read('lib/ai-budget.ts')
  ok(/on refuse plutôt que de dépenser à l'aveugle/.test(BUDGET),
    'une lecture de dépense en échec fait REFUSER, pas passer',
    'ne pas savoir combien on a dépensé n autorise pas à dépenser plus')
}
ok(/lots_en_echec/.test(RERANK),
  'un lot en échec est COMPTÉ, jamais confondu avec un lot vide',
  'des experts disparaîtraient du vivier sans qu aucune règle ne les ait écartés')

// ══════════════════════════════════════════════════════════════════════════
section('G. AUCUNE BIBLIOTHÈQUE AJOUTÉE')
// ══════════════════════════════════════════════════════════════════════════
//
// La règle n'a été levée que pour le FOURNISSEUR de reranking, pas pour son
// paquet npm.

{
  const pkg = JSON.parse(read('package.json'))
  const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) })
  const suspectes = deps.filter((d) => /cohere|voyage|jina|rerank/i.test(d))
  ok(suspectes.length === 0, 'aucun paquet de reranking installé',
    suspectes.length ? `trouvé : ${suspectes.join(', ')}` : undefined)
  ok(/fetch\(ENDPOINT/.test(RERANK), 'l appel se fait en HTTP direct')
}

// ══════════════════════════════════════════════════════════════════════════
section('H. LA TRACE ÉCRITE ET LA TRACE LUE PARLENT DES MÊMES CLÉS')
// ══════════════════════════════════════════════════════════════════════════
//
// Les fonctions de supervision lisent `matching_stats->>'x'`. Si le code
// n'écrit pas `x`, elles lisent `null` — et une somme de `null` s'affiche zéro.
// La supervision dirait alors « tout va bien » sur un moteur muet.

{
  const SQL_TRACE = read(migration('matching_trace_et_reprise'))
  const luesParSql = new Set(
    [...SQL_TRACE.matchAll(/matching_stats->>'([a-z0-9_]+)'/g)].map((m) => m[1]),
  )
  const MOTEUR = read('lib/matching/index.ts')
  // Le TYPE de la trace est la SOURCE UNIQUE : les deux façons de terminer un
  // run — vivier sans personne à noter, run qui a noté — passent par la même
  // fabrique. L'une ne peut donc plus oublier une clé que l'autre écrit, et
  // c'est ce que ce contrôle protège. Vérifier une occurrence quelconque dans
  // le fichier ne le protégeait PAS : une clé retirée d'un chemin restait
  // trouvée dans l'autre.
  const TYPE_TRACE = /type TraceDeRun = \{([\s\S]*?)\n\}/.exec(MOTEUR)?.[1] ?? ''
  ok(TYPE_TRACE.length > 0, 'la trace est décrite par un type UNIQUE',
    'deux objets écrits à la main divergent, et une clé absente se lit zéro')
  ok(luesParSql.size > 0, `${luesParSql.size} clé(s) lue(s) par la supervision`)
  for (const cle of [...luesParSql].sort()) {
    ok(new RegExp(`^  ${cle}:`, 'm').test(TYPE_TRACE), `la trace déclare « ${cle} »`,
      'clé absente : la supervision lit null et l affiche zéro')
  }
  // Et les deux chemins passent BIEN par la fabrique : deux appels, pas un.
  const passages = (MOTEUR.match(/construireTrace\(/g) ?? []).length
  ok(passages >= 3, `les deux fins de run passent par la fabrique (${passages} références)`,
    'un chemin qui écrit son propre objet peut oublier une clé sans que rien ne le dise')
}
{
  const MOTEUR = read('lib/matching/index.ts')
  ok(/matching_completed_at: acheve \? new Date/.test(MOTEUR),
    'un run interrompu reste INACHEVÉ',
    'un trou qui reste ouvert vaut mieux qu un trou refermé sur une erreur')
  ok(/arret: notation\.arret \?\? null/.test(MOTEUR),
    'et la raison de l arrêt voyage avec lui')
}
ok(existe('app/api/cron/match-retry/route.ts'),
  'la route de rattrapage existe — la tâche planifiée l appelle depuis la base')

// ══════════════════════════════════════════════════════════════════════════
section('I. LES DEUX SEUILS SE RÈGLENT, ET N ONT AUCUN REPLI CACHÉ')
// ══════════════════════════════════════════════════════════════════════════

{
  const REGLAGES = read('lib/matching/settings.ts')
  ok(/raison: 'absente'/.test(REGLAGES) && /raison: 'illisible'/.test(REGLAGES),
    'ligne ABSENTE et lecture ILLISIBLE sont distinguées',
    'les confondre enverrait chercher un réglage qui existe')
  // UN REPLI CODÉ EN DUR serait un second réglage, invisible, qui prendrait la
  // main le jour où la ligne manque. Aucune décimale n'a de raison d'être dans
  // ce fichier — ses seules bornes sont 0, 1, 1 et 1000 : toute décimale y est
  // donc un seuil écrit à la main.
  const replis = [...REGLAGES.matchAll(/[0-9]*[.][0-9]+/g)]
  ok(replis.length === 0, 'aucune valeur de seuil codée en dur',
    replis.length ? `trouvé : ${replis.map((m) => m[0]).join(' ; ')}` : undefined)
  ok(/notify < feed/.test(REGLAGES),
    'un seuil de notification sous celui du flux est REFUSÉ',
    'on notifierait pour une annonce que l expert ne verrait pas')
}
ok(existe('app/[locale]/admin/matching/page.tsx') && existe('app/api/admin/matching-settings/route.ts'),
  'l écran d administration existe, avec sa route')
ok(/'\/admin\/matching'/.test(read('lib/nav-config.ts')),
  'et il est ATTEIGNABLE depuis la navigation',
  'un écran sans lien est un écran que personne ne trouve')

{
  const LOCALES = ['fr', 'en', 'es', 'de']
  const MSG = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`))]))
  const lire = (m, c) => c.split('.').reduce((o, k) => (o == null ? o : o[k]), m)
  for (const cle of [
    'admin_matching.title',
    'admin_matching.fields.feed_help',
    'admin_matching.fields.notify_help',
    'admin_matching.errors.ordre_seuils',
    'admin_matching.spend.capped',
    'admin_back_office.sidebar.nav_matching',
  ]) {
    const absentes = LOCALES.filter((l) => !lire(MSG[l], cle))
    ok(absentes.length === 0, `${cle} dans les 4 langues`, absentes.join(', ') || undefined)
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ Le moteur tient ses promesses : sans Claude, sans plafond, sans compétition.\n'
    : `\n❌ ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
