// scripts/diag-verdict-de-run.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ UNE TÂCHE ÉCRIT SON RÉSULTAT ELLE-MÊME — ET SUR TOUS SES CHEMINS.       ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LE CAS MESURÉ, LE 22/09/2026 ───────────────────────────────────────────┐
// │ 9 853 passages des pilotes depuis le 3 septembre, **7 201 sans aucun**    │
// │ **verdict HTTP** — 73 %. La tâche posait sa réponse chez `pg_net`, qui la │
// │ garde ~6 h ; la réconciliation ne passe qu'à 03 h 15 et 03 h 45. Un       │
// │ passage de 10 h du matin n'avait plus de réponse à recopier la nuit       │
// │ suivante. Seule la tranche 21 h – 4 h arrivait à temps.                   │
// │                                                                           │
// │ L'administrateur ne pouvait pas répondre à « est-ce que ça tourne ? »     │
// │ pendant les trois quarts de la journée — et c'est ce qui laisse une       │
// │ panne durer des semaines en plein jour.                                   │
// └───────────────────────────────────────────────────────────────────────────┘
//
// LES QUATRE PROPRIÉTÉS DÉFENDUES :
//   ① TOUTE tâche cron clôt son passage — vérifié sur le COMPORTEMENT (une
//      route ajoutée demain est couverte sans qu'on l'inscrive nulle part) ;
//   ② l'écriture ne peut pas échouer EN SILENCE — les deux issues d'échec
//      journalisent, et le booléen de la base est LU ;
//   ③ la ligne naît AVANT l'appel et son identifiant part avec — sans ça, il
//      n'y a rien à clôturer ;
//   ④ l'écran distingue « aucun verdict attendu » de « la tâche n'a pas rendu
//      compte » — sinon 7 201 lignes de juin se lisent comme une panne (§E.52).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE PÉRIMÈTRE, ÉCRIT — ET CHAQUE EXCLUSION JUSTIFIÉE
//
//   BALAYE   app/api/cron/          les tâches elles-mêmes — c'est là que la
//                                   propriété ① se tient ou se perd
//            lib/cron/              le guichet partagé
//            app/[locale]/admin/    l'écran qui lit le journal
//            components/            ⚠️ DANS le périmètre, et c'est une MESURE
//                                   qui l'a décidé : `CronComplianceBanner` lit
//                                   le journal. L'exclure « parce que c'est de
//                                   l'affichage » aurait été la cinquième fois
//                                   que le périmètre est l'angle mort.
//            supabase/migrations/   le pilote, la clôture, la réconciliation
//            messages/*.json        les quatre langues
//
//   EXCLU    node_modules/ .next/   pas du dépôt / généré
//            supabase/_archive/     retirées du tronc, jamais rejouées
//            docs/                  de la prose ; rien n'y est exécuté
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-verdict-de-run.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE écriture.
// 0 = vert · 1 = rouge · 2 = n'a pas tourné.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { rejouerMigrations, depouiller } from './lib/schema-migrations.mjs'

const MOI = fileURLToPath(import.meta.url)
const ROOT = join(dirname(MOI), '..')
const LOCALES = ['fr', 'en', 'es', 'de']

let echecs = 0
const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)
const lire = (rel) => readFileSync(join(ROOT, rel), 'utf8').split('\r\n').join('\n')

/** §E.7 — commentaires retirés SANS perdre de lignes. */
function depouillerJs(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i)
      if (j === -1) j = src.length
      out += ' '.repeat(j - i)
      i = j
      continue
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2)
      j = j === -1 ? src.length : j + 2
      out += src.slice(i, j).replace(/[^\n]/g, ' ')
      i = j
      continue
    }
    out += c
    i++
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   0. LE DÉTECTEUR S'ÉPROUVE AVANT DE BALAYER (§E.33)
   ═══════════════════════════════════════════════════════════════════════════

   Le témoin du DÉFAUT est ce qui a disparu : un export qui rend `handle(request)`
   nu. Celui du CORRECTIF est la forme livrée. Un détecteur qui ne retrouve pas
   le cas connu ne prouve rien. */
section('0. Le détecteur retrouve le défaut, et se tait sur le correctif')

/** Une sortie de tâche cron clôt-elle son passage ? */
const clot = (src) => /sousVerdictDeRun\s*\(/.test(depouillerJs(src))

const TEMOIN_DEFAUT = `
export async function GET(request: NextRequest): Promise<Response> {
  return handle(request)
}
`
const TEMOIN_CORRECTIF = `
export async function GET(request: NextRequest): Promise<Response> {
  return sousVerdictDeRun(request, JOB, getAdmin, () => handle(request))
}
`
const TEMOIN_COMMENTAIRE = `
// Cette route pourrait passer par sousVerdictDeRun( un jour.
export async function GET(request: NextRequest): Promise<Response> {
  return handle(request)
}
`
ok(!clot(TEMOIN_DEFAUT), 'il VOIT une sortie qui ne clôt rien')
ok(clot(TEMOIN_CORRECTIF), '… et il se TAIT sur la forme livrée')
ok(
  !clot(TEMOIN_COMMENTAIRE),
  '… et un COMMENTAIRE qui cite le guichet ne compte pas (§E.7)',
  'un commentaire n’a jamais écrit un verdict',
)

/* ═══════════════════════════════════════════════════════════════════════════
   1. TOUTE TÂCHE CLÔT SON PASSAGE — sur le comportement, pas sur une liste
   ═══════════════════════════════════════════════════════════════════════════

   ⚠️ ON DÉCOUVRE LES TÂCHES, ON NE LES LISTE PAS (§E.34, §E.61). Une route
      ajoutée sous `app/api/cron/` demain est couverte sans qu'on l'inscrive
      nulle part — et c'est exactement la leçon que le lot précédent a payée. */
section('1. Toute tâche planifiée clôt son propre passage')

const DOSSIER_CRON = join(ROOT, 'app', 'api', 'cron')
const taches = []
if (existsSync(DOSSIER_CRON)) {
  for (const e of readdirSync(DOSSIER_CRON)) {
    const p = join(DOSSIER_CRON, e, 'route.ts')
    if (statSync(join(DOSSIER_CRON, e)).isDirectory() && existsSync(p)) {
      taches.push(relative(ROOT, p).replace(/\\/g, '/'))
    }
  }
}
ok(taches.length >= 5, `${taches.length} tâche(s) découverte(s) sous app/api/cron/`,
  'moins de cinq : le balayage ne voit plus les routes, et un zéro ne prouverait rien')

const muettes = []
const sorties = []
for (const rel of taches) {
  const net = depouillerJs(lire(rel))
  if (!clot(net)) muettes.push(rel)
  // Chaque export HTTP doit passer par le guichet — pas seulement l'un d'eux.
  for (const m of net.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|DELETE)\s*\(/g)) {
    const suite = net.slice(m.index, m.index + 400)
    sorties.push({ rel, verbe: m[1], clot: /sousVerdictDeRun\s*\(/.test(suite) })
  }
}
ok(muettes.length === 0, `aucune tâche muette (${muettes.length})`, muettes.join(', ') || undefined)
const sortiesMuettes = sorties.filter((s) => !s.clot)
ok(sorties.length >= 10, `${sorties.length} sortie(s) HTTP examinée(s)`,
  'moins de dix : le motif ne voit plus les exports, la boucle serait vide (§E.34)')
ok(
  sortiesMuettes.length === 0,
  `chaque sortie HTTP passe par le guichet (${sortiesMuettes.length} manquante)`,
  sortiesMuettes.map((s) => `${s.rel}:${s.verbe}`).join(', ') || undefined,
)

/* ── UN SEUL GUICHET, PAS CINQ COPIES (§E.20) ───────────────────────────── */
{
  const partage = 'lib/cron/verdict-de-run.ts'
  ok(existsSync(join(ROOT, partage)), `le guichet partagé existe — ${partage}`)
  const net = depouillerJs(lire(partage))
  ok(
    /export\s+async\s+function\s+sousVerdictDeRun/.test(net),
    '… et il exporte le guichet',
  )
  // Personne d'autre ne doit appeler la RPC directement : ce serait un jumeau.
  const autres = []
  for (const rel of taches) {
    if (/cloturer_run_cron/.test(depouillerJs(lire(rel)))) autres.push(rel)
  }
  ok(
    autres.length === 0,
    `aucune tâche n’appelle la clôture en direct (${autres.length})`,
    autres.join(', ') || 'cinq copies seraient cinq occasions d’oublier une branche',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. L'ÉCRITURE NE PEUT PAS ÉCHOUER EN SILENCE
   ═══════════════════════════════════════════════════════════════════════════

   C'est la condition posée par l'architecte : « vérifie que la nouvelle
   écriture ne peut pas échouer en silence — sinon on remplace une perte par
   une autre ». Trois issues, trois journaux. */
section('2. L’écriture du verdict ne peut pas échouer en silence')

{
  const net = depouillerJs(lire('lib/cron/verdict-de-run.ts'))

  ok(
    /if\s*\(\s*error\s*\)\s*\{[\s\S]{0,300}?console\.error/.test(net),
    'une erreur de la base est JOURNALISÉE',
    'la perte de verdict reviendrait par le bas, sur le correctif lui-même',
  )
  ok(
    /data\s*!==\s*true[\s\S]{0,300}?console\.error/.test(net),
    'un « aucune ligne clôturée » est JOURNALISÉ',
    'la RPC rend false quand rien n’a bougé : le taire serait §E.22 dans la parade',
  )
  ok(
    /data\s*!==\s*true/.test(net),
    'le booléen de la base est LU, pas ignoré',
    'une écriture qui ne dit pas si elle a écrit peut échouer en silence',
  )
  ok(
    /catch\s*\([\s\S]{0,200}?console\.error/.test(net),
    'une exception est JOURNALISÉE',
  )

  // ⚠️ L'EXCEPTION DU TRAVAIL EST RELAYÉE, PAS AVALÉE. L'avaler ferait d'une
  //    panne un succès silencieux — la classe même qu'on ferme (§E.22).
  const iCatch = net.indexOf('catch (err)')
  const iThrow = net.indexOf('throw err')
  ok(
    iCatch > 0 && iThrow > iCatch,
    'le guichet RELAIE l’exception après avoir écrit',
    'une tâche qui lève doit lever : l’avaler transformerait une panne en succès',
  )

  // La réponse rendue garde son flux : on lit un CLONE.
  ok(
    /\.clone\(\)/.test(net),
    'le corps est lu sur un CLONE de la réponse',
    'lire le flux original le consommerait, et l’appelant recevrait une réponse vide',
  )

  // §E.55 — jamais une vérité simple sur un identifiant.
  ok(
    /Number\.isInteger\([\s\S]{0,60}?\bn\s*<=\s*0/.test(net) ||
      /Number\.isInteger\([\s\S]{0,60}?&&\s*\w+\s*>\s*0/.test(net),
    'un identifiant de journal est un entier STRICTEMENT positif',
    '`Number("")` vaut 0, et clôturer « la ligne 0 » n’a aucun sens',
  )

  /* ⚠️ ET LES DEUX ABSENCES NE SE CONFONDENT PAS (§E.29).
        « pas de corps » (un `curl` de mise au point — cas normal) et « un corps
        qu'on n'a pas su lire » (le pilote a envoyé, une ligne attend) ont eu la
        même forme — un `null` pour les deux — jusqu'à ce que le cliquet de
        `diag-echec-silencieux` morde dessus. La distinction est un TYPE, et
        c'est le seul niveau où elle ne se reperd pas. */
  ok(
    /etat:\s*'illisible'/.test(net) && /etat:\s*'absent'/.test(net),
    'un corps ILLISIBLE et un corps ABSENT sont deux états distincts',
    'les confondre ferait passer une anomalie du pilote pour un appel manuel',
  )
  ok(
    /etat\s*===\s*'illisible'[\s\S]{0,400}?console\.error/.test(net),
    '… et l’illisible CRIE, quand l’absent se contente d’informer',
    'un journal d’info sur une ligne qui n’aura jamais son verdict ne réveille personne',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. LA BASE — la ligne naît AVANT l’appel, et les deux collecteurs cohabitent
   ═══════════════════════════════════════════════════════════════════════════ */
section('3. SQL : la ligne naît avant l’appel, et son identifiant part avec')

const { fonctions } = rejouerMigrations()
const corps = (nom) => {
  const d = fonctions.get(nom)
  return d ? depouiller(d.corps, { garderBlocs: true }) : null
}

{
  const pilote = corps('trigger_purge_cron')
  ok(!!pilote, '`trigger_purge_cron()` existe')
  ok(
    !!pilote && /jsonb_build_object\s*\(\s*'log_id'/.test(pilote),
    '… et il passe l’identifiant de journal dans le corps',
    'sans lui, la tâche n’a rien à clôturer : le correctif serait inerte',
  )
  // L'ORDRE est la propriété : l'insertion précède l'appel.
  if (pilote) {
    const iInsert = pilote.indexOf('insert into public.cron_run_log')
    const iPost = pilote.indexOf('net.http_post')
    ok(
      iInsert > 0 && iPost > iInsert,
      '… et la ligne naît AVANT l’appel HTTP',
      `insertion à ${iInsert}, appel à ${iPost} — une ligne créée après n’a pas d’identifiant à passer`,
    )
  }

  const cloture = corps('cloturer_run_cron')
  ok(!!cloture, '`cloturer_run_cron()` existe')
  ok(
    !!cloture && /verdict_source\s*=\s*'tache'/.test(cloture),
    '… et elle NOMME son origine',
    'sans elle, un verdict venu de l’ancien chemin se lirait comme un succès du nouveau',
  )
  ok(
    !!cloture && /and\s+reconciled_at\s+is\s+null/.test(cloture),
    '… et elle ne réécrit pas un verdict déjà posé',
  )
  ok(
    !!cloture && /get\s+diagnostics\s+\w+\s*=\s*row_count/.test(cloture),
    '… et elle REND si elle a écrit',
    'une écriture muette rouvre le défaut d’un cran plus bas',
  )

  const recon = corps('reconcile_cron_run_log')
  ok(!!recon, '`reconcile_cron_run_log()` existe toujours — second collecteur')
  ok(
    !!recon && /verdict_source\s*=\s*'reconciliation'/.test(recon),
    '… et elle nomme SON origine',
  )
  ok(
    !!recon && /l\.reconciled_at\s+is\s+null/.test(recon),
    '… et elle ne touche que ce que la tâche n’a pas clos',
    'les deux collecteurs ne se marchent pas dessus : deux pannes différentes, pas §E.36',
  )
}

/* ── LA MIGRATION VÉRIFIE CE QU’ELLE A CRÉÉ (§E.60) ─────────────────────── */
{
  const fichiers = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((f) =>
    f.endsWith('_verdict_ecrit_par_la_tache.sql'),
  )
  ok(fichiers.length === 1, 'la migration du lot est là, et une seule',
    `${fichiers.length} fichier(s) — un suffixe cité doit désigner exactement un fichier (§G.3)`)
  if (fichiers.length === 1) {
    const sql = lire(`supabase/migrations/${fichiers[0]}`)
    ok(
      /postcondition NON TENUE/.test(sql),
      '… et elle porte une POSTCONDITION qui lève',
      'une migration qui « réussit » n’a rien prouvé (§E.60)',
    )
    ok(
      /pg_get_function_identity_arguments/.test(sql),
      '… qui vérifie la SIGNATURE, pas seulement le nom',
      'un nom pris est une chaîne de caractères, pas une garantie',
    )
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. L’ÉCRAN DIT CE QU’IL SAIT — et pas ce qu’il suppose
   ═══════════════════════════════════════════════════════════════════════════ */
section('4. L’écran distingue « pas attendu » de « pas rendu » (§E.52)')

{
  const page = 'app/[locale]/admin/taches-planifiees/[job_name]/page.tsx'
  const net = depouillerJs(lire(page))
  ok(
    /verdict_attendu/.test(net),
    'l’écran lit `verdict_attendu`',
    'sans lui, 7 201 lignes de juin se lisent comme une panne',
  )
  ok(
    /verdict_attendu\s*===\s*true/.test(net),
    '… en `=== true`, jamais une vérité simple (§E.55)',
    '`undefined` (route non redéployée) ne doit pas se peindre en reproche',
  )
  ok(
    /http_avant_verdict/.test(net),
    '… et il a une phrase pour l’historique antérieur',
  )

  const manquantes = []
  for (const l of LOCALES) {
    const j = JSON.parse(lire(`messages/${l}.json`))
    const v = j.admin_back_office?.cron?.http_avant_verdict
    if (typeof v !== 'string' || !v.trim()) manquantes.push(l)
  }
  ok(
    manquantes.length === 0,
    'la phrase existe dans les 4 langues',
    manquantes.join(', ') || undefined,
  )

  // La fonction de lecture doit rendre la colonne, sinon l'écran lit undefined.
  const runs = corps('admin_cron_job_runs')
  ok(!!runs, '`admin_cron_job_runs()` existe')
  ok(
    !!runs && /verdict_attendu\s+boolean/.test(runs),
    '… et elle rend `verdict_attendu`',
    'l’écran le lirait `undefined` et ne dirait plus rien',
  )
  ok(
    !!runs && /coalesce\(\s*c\.attendu_de_la_tache\s*,\s*false\s*\)/.test(runs),
    '… avec `false` quand la ligne de journal n’existe pas',
    'une exécution sans ligne appariée ne doit pas se lire « la tâche n’a pas rendu compte »',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. CE QUE CE CONTRÔLE NE VÉRIFIE PAS
   ═══════════════════════════════════════════════════════════════════════════ */
section('Ce que ce contrôle ne vérifie pas')

note('que le SQL COMPILE ni qu’il s’applique. Il lit des fichiers (§E.12) ;')
note('aucun analyseur PostgreSQL n’est disponible, et l’appliquer exigerait')
note('d’écrire en base. La migration part à la recette comme les autres.')
note('qu’un verdict arrive RÉELLEMENT : cela demande un passage de cron, donc')
note('une base et un serveur. Ce qui est gardé, c’est que le chemin existe et')
note('qu’il ne peut pas se taire — pas qu’il a déjà servi.')
note('les 7 201 passages déjà vides : ils ne se rattrapent pas, la réponse qui')
note('les portait n’existe plus. On repart de maintenant, et l’écran le dit.')

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} contrôle(s) en échec\n`)
  process.exit(1)
}
console.log('✅ Chaque tâche clôt son passage, et son écriture ne peut pas se taire.\n')
process.exit(0)
