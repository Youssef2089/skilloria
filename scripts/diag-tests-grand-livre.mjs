#!/usr/bin/env node
// scripts/diag-tests-grand-livre.mjs — CHAQUE ÉCRIVAIN DU GRAND LIVRE A TOURNÉ DANS UN TEST.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE
//   L'audit du 26/09/2026 (docs/reprise.md §1.1) a mesuré que sur 34 fonctions
//   qui écrivent, DEUX avaient exécuté leur écriture au rejeu local : les sondes
//   des autres étaient SAUTÉES sur base vierge (§E.67), sept n'en avaient pas.
//   Une fonction jamais exécutée est une affirmation. Les tests pgTAP de
//   `supabase/tests/database/grand_livre/` la font tourner ; ce contrôle dit
//   qu'AUCUNE fonction nouvelle n'y échappe — la règle « toute action nouvelle
//   arrive avec son test » (CLAUDE.md §G.4 ter) tient ici, pas dans une consigne.
//
// CE QU'IL GARDE (statique, aucun accès base)
//   A. Toute fonction `public` créée depuis le socle du grand livre est APPELÉE
//      (`public.<nom>(`) par un test — ou, pour une fonction de déclencheur, le
//      test provoque l'erreur qu'elle lève (DECLENCHEURS).
//   B. Toute action de la liste fermée est citée par un test — sinon elle est
//      dans GEL, avec sa raison ; le gel ne fait que DESCENDRE : une entrée
//      désormais testée, ou disparue de la liste, rougit (« retire-la »).
//   C. La forme de chaque test : `begin;` … `rollback;`, les fabriques incluses,
//      `plan(n)` égal au nombre d'assertions, au moins un compte de lignes sous
//      une pièce (`pg_temp.lignes(`), jamais `session_replication_role` ni un
//      trigger désactivé.
//   D. Les fabriques naissent par les chemins normaux : `auth.users` puis la
//      vérification que `public.users` existe ; l'organisation par
//      `creer_organisation_avec_admin()` et son siège vérifié.
//   E. Nulle part dans le dépôt la commande de test ne vise la base liée.
// CE QU'IL NE GARDE PAS, ET LE DIT
//   · que les tests PASSENT — seul `npx supabase test db --local` le dit ;
//   · qu'un test vérifie le BON effet métier — une relecture le dit ;
//   · les actions du gel : écrites par le TypeScript à travers `journaliser()`,
//     leur forme est tenue par diag-grand-livre (C bis), pas par un test SQL.
//
//   node scripts/diag-tests-grand-livre.mjs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const TESTS = join(ROOT, 'supabase', 'tests', 'database', 'grand_livre')
// Le socle du grand livre, résolu PAR SUFFIXE (§G.3) — jamais par numéro.
const SUFFIXE_SOCLE = '_grand_livre.sql'

const lire = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n') // §E.3
// Le code sans ses commentaires `--` : une règle ÉCRITE en commentaire ne doit ni verdir ni rougir (§E.7).
// Approximation assumée : un `--` à l'intérieur d'une chaîne SQL tronquerait la ligne — aucun test n'en porte.
const sansCommentaires = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const montrer = (l) => l.slice(0, 10).join(', ') + (l.length > 10 ? ` … (+${l.length - 10})` : '')

// Une fonction de déclencheur ne s'appelle pas : le test prouve qu'elle tourne en provoquant ce qu'elle lève.
const DECLENCHEURS = {
  grand_livre_ajout_seul: "'GL001'",
}

// LE GEL — une raison par entrée (§G.8). Il ne fait que descendre.
const TS = 'LÉGITIME : écrite par le TypeScript à travers journaliser() (journal après écriture, §C.21), sans écrivain SQL propre ; forme tenue par diag-grand-livre C bis'
const GEL = {
  annonce_modifiee: `${TS} — app/api/publications/[id]/route.ts`,
  cv_televerse: `${TS} — lib/profil/journal-profil.ts`,
  disponibilite_basculee: `${TS} — lib/profil/journal-profil.ts`,
  email_change: `${TS} — lib/comptes/journal-compte.ts`,
  journal_nettoye: 'LÉGITIME : l\'écrivain est la RPC de nettoyage de l\'étape 4, pas encore écrite — son test arrive avec elle',
  mot_de_passe_change: `${TS} — lib/comptes/journal-compte.ts`,
  plafond_atteint: `${TS} — lib/ai-budget.ts`,
  profil_modifie: `${TS} — app/api/profile/route.ts`,
  profil_publie: `${TS} — lib/profil/journal-profil.ts`,
  recherche_abandonnee: `${TS} — lib/matching/journal-de-recherche.ts`,
  recherche_classee: `${TS} — lib/matching/journal-de-recherche.ts`,
  recherche_correspondances: `${TS} — lib/matching/journal-de-recherche.ts`,
  recherche_echouee: `${TS} — lib/matching/journal-de-recherche.ts`,
  recherche_filtree: `${TS} — lib/matching/journal-de-recherche.ts`,
  recherche_lancee: `${TS} — lib/matching/journal-de-recherche.ts`,
  recherche_notifiee: `${TS} — lib/matching/journal-de-recherche.ts`,
  recherche_terminee: `${TS} — lib/matching/journal-de-recherche.ts`,
  refus_expert_inapte: `${TS} — lib/candidatures/depot.ts`,
  refus_garde_eligibilite: `${TS} — lib/candidatures/depot.ts`,
  refus_plafond_atteint: `${TS} — lib/ai-budget.ts`,
  refus_quota_cv: `${TS} — lib/ai-quotas.ts`,
  session_revoquee: `${TS} — lib/comptes/journal-compte.ts`,
  suppression_annulee: `${TS} — lib/comptes/journal-compte.ts`,
}

// ── Le corpus ──
const toutes = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
const socles = toutes.filter((f) => f.endsWith(SUFFIXE_SOCLE))
if (socles.length !== 1) {
  console.error(`✘ socle introuvable ou ambigu (${socles.length} fichiers en *${SUFFIXE_SOCLE}) — le contrôle ne tourne pas`)
  process.exit(2)
}
const depuisSocle = toutes.filter((f) => f >= socles[0])

let fichiersTest
try {
  fichiersTest = readdirSync(TESTS)
} catch {
  console.error(`✘ ${relative(ROOT, TESTS)} absent — le contrôle ne tourne pas`)
  process.exit(2)
}
const tests = fichiersTest.filter((f) => f.endsWith('.test.sql')).sort()
const corpusTests = fichiersTest.map((f) => sansCommentaires(lire(join(TESTS, f)))).join('\n')
if (tests.length === 0) {
  console.error('✘ aucun fichier *.test.sql — le contrôle ne tourne pas')
  process.exit(2)
}

console.log(`\n═══ Tests du grand livre — ${tests.length} fichiers, ${depuisSocle.length} migrations depuis le socle ═══\n`)

// ── A. Chaque fonction a tourné ──
const fonctions = new Set()
for (const f of depuisSocle) {
  for (const m of lire(join(MIGRATIONS, f)).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi)) fonctions.add(m[1].toLowerCase())
}
const nonAppelees = [...fonctions].filter((fn) =>
  DECLENCHEURS[fn] ? !corpusTests.includes(DECLENCHEURS[fn]) : !corpusTests.includes(`public.${fn}(`)).sort()
ok(fonctions.size > 0 && nonAppelees.length === 0,
  `A. les ${fonctions.size} fonctions créées depuis le socle tournent dans un test`,
  nonAppelees.length ? `jamais appelées : ${montrer(nonAppelees)} — écris leur test dans ${relative(ROOT, TESTS)}` : undefined)
const declencheursMorts = Object.keys(DECLENCHEURS).filter((fn) => !fonctions.has(fn))
ok(declencheursMorts.length === 0, 'A. chaque entrée de DECLENCHEURS est une fonction existante',
  declencheursMorts.length ? montrer(declencheursMorts) : undefined)

// ── B. Chaque action est citée par un test, ou gelée avec sa raison ──
const codes = new Set()
for (const f of toutes) {
  const s = lire(join(MIGRATIONS, f))
  for (const b of s.matchAll(/insert\s+into\s+public\.grand_livre_actions\b[^;]*?\bvalues\b([\s\S]*?)(?:\bon\s+conflict\b|;)/gi)) {
    for (const c of b[1].matchAll(/\(\s*'(\w+)'/g)) codes.add(c[1])
  }
}
const nonTestees = [...codes].filter((c) => !corpusTests.includes(`'${c}'`))
const horsGel = nonTestees.filter((c) => !(c in GEL)).sort()
ok(codes.size > 0 && horsGel.length === 0, `B. les ${codes.size} actions de la liste fermée sont testées ou gelées (${Object.keys(GEL).length} au gel)`,
  horsGel.length ? `sans test : ${montrer(horsGel)} — une action nouvelle arrive avec son test` : undefined)
const gelTestees = Object.keys(GEL).filter((c) => corpusTests.includes(`'${c}'`)).sort()
ok(gelTestees.length === 0, 'B. le gel ne contient aucune action désormais testée (il ne fait que descendre)',
  gelTestees.length ? `retire du gel : ${montrer(gelTestees)}` : undefined)
const gelMortes = Object.keys(GEL).filter((c) => !codes.has(c)).sort()
ok(gelMortes.length === 0, 'B. chaque entrée du gel est une action de la liste fermée',
  gelMortes.length ? montrer(gelMortes) : undefined)
const sansRaison = Object.entries(GEL).filter(([, r]) => !/^(LÉGITIME|DÉFAUT NOMMÉ)\b/.test(r)).map(([c]) => c)
ok(sansRaison.length === 0, 'B. chaque entrée du gel commence par LÉGITIME ou DÉFAUT NOMMÉ (§G.8)',
  sansRaison.length ? montrer(sansRaison) : undefined)

// ── C. La forme de chaque test ──
const formes = []
let assertions = 0
for (const f of tests) {
  const s = sansCommentaires(lire(join(TESTS, f)))
  const plan = s.match(/select\s+plan\((\d+)\)/i)
  const nexts = (s.match(/\breturn\s+next\b/gi) ?? []).length
  assertions += nexts
  const defauts = []
  if (!/^\s*(?:--[^\n]*\n\s*)*begin;/i.test(s)) defauts.push('ne commence pas par begin;')
  if (!/rollback;\s*$/i.test(s)) defauts.push('ne finit pas par rollback;')
  if (!/\\ir\s+_fabriques\.psql/.test(s)) defauts.push('n\'inclut pas _fabriques.psql')
  if (!plan) defauts.push('sans plan()')
  else if (Number(plan[1]) !== nexts) defauts.push(`plan(${plan[1]}) pour ${nexts} assertions`)
  // Un compte de lignes sous une pièce : la fabrique `pg_temp.lignes(<pièce>)`, ou un décompte explicite
  // (`count(*) from public.grand_livre g where g.piece = …`) pour un constat par lot — une ligne par objet.
  if (!s.includes('pg_temp.lignes(') && !/count\(\*\)\s+from\s+public\.grand_livre\s+\w+\s+where\s+\w+\.piece\s*=/i.test(s)) {
    defauts.push('aucun compte de lignes sous une pièce')
  }
  if (/session_replication_role/i.test(s)) defauts.push('session_replication_role')
  if (/disable\s+trigger/i.test(s)) defauts.push('trigger désactivé')
  if (!/select\s+\*\s+from\s+finish\(\)/i.test(s)) defauts.push('sans finish()')
  if (defauts.length) formes.push(`${f} : ${defauts.join(', ')}`)
}
ok(formes.length === 0, `C. la forme des ${tests.length} tests (${assertions} assertions)`, formes.length ? formes.join('\n       → ') : undefined)

// ── D. Les fabriques ──
const fab = fichiersTest.includes('_fabriques.psql') ? sansCommentaires(lire(join(TESTS, '_fabriques.psql'))) : ''
const fabDefauts = []
if (!/insert\s+into\s+auth\.users/i.test(fab)) fabDefauts.push('un compte ne naît pas par auth.users')
if (!/not\s+exists\s*\(\s*select\s+1\s+from\s+public\.users\b/i.test(fab)) fabDefauts.push('public.users n\'est pas vérifié après handle_new_user')
if (!/public\.creer_organisation_avec_admin\(/.test(fab)) fabDefauts.push('l\'organisation ne naît pas avec son administrateur')
if (!/siege_admin_membre_id\s+is\s+not\s+null/.test(fab)) fabDefauts.push('le siège n\'est pas vérifié')
if (/session_replication_role|disable\s+trigger/i.test(fab)) fabDefauts.push('contournement')
ok(fab !== '' && fabDefauts.length === 0, 'D. les fabriques passent par les chemins normaux', fabDefauts.length ? fabDefauts.join(', ') : '_fabriques.psql absent')

// ── E. La commande de test ne vise jamais la base liée ──
const INTERDIT = new RegExp('test\\s+db\\s+--' + 'linked|test\\s+db\\s+--' + 'db-url')
const RACINES = ['CLAUDE.md', 'AGENTS.md', 'package.json', 'docs', 'scripts', 'supabase/tests']
const fautifs = []
const soi = fileURLToPath(import.meta.url)
const parcourir = (p) => {
  const st = statSync(p)
  if (st.isDirectory()) { for (const e of readdirSync(p)) if (e !== 'node_modules') parcourir(join(p, e)); return }
  if (p === soi || !/\.(md|mjs|js|json|sql|psql|html)$/.test(p)) return
  if (INTERDIT.test(lire(p))) fautifs.push(relative(ROOT, p))
}
for (const r of RACINES) { try { parcourir(join(ROOT, r)) } catch { /* racine absente */ } }
ok(fautifs.length === 0, 'E. aucune commande de test ne vise la base liée ou une URL', fautifs.length ? montrer(fautifs) : undefined)

console.log(failures === 0
  ? `\n✅ ${fonctions.size} fonctions, ${fonctions.size} appelées par ${tests.length} tests (${assertions} assertions) ; ${codes.size - nonTestees.length}/${codes.size} actions testées, ${Object.keys(GEL).length} au gel.`
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — un écrivain du grand livre n'a pas son test`)
process.exit(failures === 0 ? 0 : 1)
