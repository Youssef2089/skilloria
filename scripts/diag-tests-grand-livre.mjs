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
import { rejouerMigrations } from './lib/schema-migrations.mjs'

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
  // Le trigger d'inscription (on_auth_user_created) : il tourne quand un test insère dans auth.users.
  handle_new_user: 'insert into auth.users',
  // Le trigger de confirmation (on_auth_user_email_confirmed) : il tourne quand un test confirme une adresse.
  handle_email_confirmed: 'update auth.users set email_confirmed_at',
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
// Le CORPUS est TOUT `supabase/tests/database/` (sous-dossiers compris, `test db` les parcourt — mesuré
// par Youssef le 28/09/2026) : une fonction appelée par le test d'inscription ou le test global compte.
// La FORME (C) ne vise que les tests du grand livre, qui partagent leurs fabriques.
const RACINE_TESTS = join(ROOT, 'supabase', 'tests', 'database')
const tousLesTests = []
const descendre = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) descendre(p)
    else if (/\.(sql|psql)$/.test(e)) tousLesTests.push(p)
  }
}
descendre(RACINE_TESTS)
const corpusTests = tousLesTests.map((p) => sansCommentaires(lire(p))).join('\n')
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
  // Un \`return next skip(…)\` est l'AUTRE branche d'un \`if\` : il tient la place des assertions de la
  // branche qui ne tourne pas (pgTAP compte skip(…, n) pour n). Il ne s'ajoute donc pas à elles —
  // compté, il ferait exiger un plan que pgTAP rejetterait (le motif de inscription/roles.test.sql).
  const skips = (s.match(/\breturn\s+next\s+skip\s*\(/gi) ?? []).length
  const nexts = (s.match(/\breturn\s+next\b/gi) ?? []).length - skips
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

// ── F. Le test global « une fonction, une signature » (point 2.4, §E.72) existe et compte sur pg_proc ──
const CHEMIN_SIGNATURE = join(ROOT, 'supabase', 'tests', 'database', 'une_signature.test.sql')
let sig = ''
try { sig = sansCommentaires(lire(CHEMIN_SIGNATURE)) } catch { /* absent : rouge ci-dessous */ }
const sigDefauts = []
if (!sig) sigDefauts.push('absent')
else {
  if (!/from\s+pg_proc\b/i.test(sig)) sigDefauts.push('ne lit pas pg_proc')
  if (!/having\s+count\(\*\)\s*>\s*1/i.test(sig)) sigDefauts.push('ne compte pas les signatures par nom')
  if (!/nspname\s*=\s*'public'/i.test(sig)) sigDefauts.push('ne vise pas le schéma public')
  if (!/raison\s+text\s+not\s+null/i.test(sig)) sigDefauts.push('une exception sans raison serait admise')
  if (!/^\s*begin;/i.test(sig) || !/rollback;\s*$/i.test(sig)) sigDefauts.push('pas dans begin/rollback')
}
ok(sigDefauts.length === 0, 'F. le test « une fonction, une signature » compte les surcharges du schéma public, exceptions à raison',
  sigDefauts.length ? `${relative(ROOT, CHEMIN_SIGNATURE)} : ${sigDefauts.join(', ')}` : undefined)

// ── I. L'ÉCRITURE D'ABORD, LA RELECTURE ENSUITE (T.3, §E.74) ──
//  Une sous-requête lit l'instantané pris au DÉBUT de l'instruction : dans
//  `ok(public.f(…) and exists (select …))`, elle ne voit pas ce que f vient d'écrire.
//  Six assertions ont échoué ainsi le 28/09/2026, six autres de même forme n'avaient pas
//  encore tourné. Qui ÉCRIT se déduit des corps (point fixe par les appels), pas d'une liste.
{
  const { fonctions } = rejouerMigrations()
  const ecrit = new Set()
  const direct = /(?<!\bfor\s)(?<!\bdo\s)\b(?:insert\s+into|update\s+(?:only\s+)?(?:public\.)?[a-z_][a-z0-9_]*(?:\s+[a-z_][a-z0-9_]*)?\s+set|delete\s+from)\b/i
  for (const [nom, def] of fonctions) if (direct.test(def.corps.replace(/'(?:[^']|'')*'/g, "''"))) ecrit.add(nom)
  for (let change = true; change; ) {
    change = false
    for (const [nom, def] of fonctions) {
      if (ecrit.has(nom)) continue
      if ([...ecrit].some((e) => new RegExp(`\\bpublic\\.${e}\\s*\\(`, 'i').test(def.corps))) { ecrit.add(nom); change = true }
    }
  }
  const fautes = []
  for (const p of tousLesTests) {
    const s = sansCommentaires(lire(p))
    for (const m of s.matchAll(/return\s+next\b[\s\S]*?;\s*\n/g)) {
      const bloc = m[0].replace(/\$q\$[\s\S]*?\$q\$/g, "''")
      if (/\bthrows_ok\b|\blives_ok\b/.test(bloc)) continue
      const ecrivains = [...bloc.matchAll(/\bpublic\.([a-z_][a-z0-9_]*)\s*\(/gi)].map((x) => x[1].toLowerCase()).filter((f) => ecrit.has(f))
      if (ecrivains.length && /\(\s*select\b/i.test(bloc)) {
        fautes.push(`${relative(ROOT, p)}:${s.slice(0, m.index).split('\n').length} (${[...new Set(ecrivains)].join(', ')})`)
      }
    }
  }
  ok(ecrit.size > 20 && fautes.length === 0,
    `I. aucune assertion n'appelle une fonction qui écrit ET ne relit dans la même instruction (${ecrit.size} fonctions qui écrivent)`,
    fautes.length ? `${fautes.join(' · ')} — appelle d'abord (v := public.f(…)), relis ensuite` : undefined)
}

// ── J. CHANGER D'IDENTITÉ COMME PostgREST, ET PASSER EN DERNIER (lot C, 28/09/2026, §E.76) ──
//  Le test du vrai appelant changeait de rôle DANS une fonction plpgsql (`set local role` +
//  `execute` de RPC SECURITY DEFINER + blocs d'exception) : le serveur local a planté (signal 11), le
//  journal n'a nommé que `select * from pg_temp.essai();`, et les 22 fichiers suivants n'ont pas tourné.
//  La propriété : un changement de rôle est une INSTRUCTION de premier niveau, jamais dans un corps
//  `$…$` ; et tout fichier qui change de rôle passe APRÈS tous les autres (ordre alphabétique des
//  chemins, celui qu'a suivi `test db` le 28/09/2026).
{
  const roleRe = /\b(?:set\s+(?:local\s+)?role|reset\s+role)\b/gi
  const rel = (p) => relative(RACINE_TESTS, p).split('\\').join('/')
  const fichiersDeTest = tousLesTests.filter((p) => p.endsWith('.test.sql')).map(rel).sort()
  const dansUnCorps = []
  const changentDeRole = []
  for (const p of tousLesTests.filter((q) => q.endsWith('.test.sql'))) {
    const s = sansCommentaires(lire(p))
    const total = (s.match(roleRe) ?? []).length
    if (total === 0) continue
    changentDeRole.push(rel(p))
    const horsCorps = (s.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''").match(roleRe) ?? []).length
    if (horsCorps !== total) dansUnCorps.push(`${rel(p)} (${total - horsCorps})`)
  }
  ok(dansUnCorps.length === 0, 'J. aucun changement de rôle dans un corps de fonction — une instruction de premier niveau, comme PostgREST',
    dansUnCorps.length ? `${dansUnCorps.join(' · ')} — sortir le set/reset role au niveau des instructions (§E.76)` : undefined)
  const premier = fichiersDeTest.findIndex((f) => changentDeRole.includes(f))
  const apres = premier < 0 ? [] : fichiersDeTest.slice(premier).filter((f) => !changentDeRole.includes(f))
  ok(changentDeRole.length > 0 && apres.length === 0,
    `J. les ${changentDeRole.length} fichier(s) qui changent de rôle passent EN DERNIER — un plantage n'y prive aucun autre fichier de son verdict`,
    changentDeRole.length === 0 ? 'aucun test ne joue le vrai appelant' : `passent après : ${apres.join(', ')}`)
}

// ── H. plpgsql_check sur chaque fonction de trigger AVEC SA TABLE (T.2, §E.73) ──
//  `db lint` appelle plpgsql_check sans table : une fonction de trigger n'y est pas vérifiée.
//  Le test existe, lit pg_trigger, passe la RELATION, rougit sur le niveau error.
const CHEMIN_CHECK = join(ROOT, 'supabase', 'tests', 'database', 'plpgsql_check.test.sql')
let chk = ''
try { chk = sansCommentaires(lire(CHEMIN_CHECK)) } catch { /* absent : rouge */ }
const chkDefauts = []
if (!chk) chkDefauts.push('absent')
else {
  if (!/from\s+pg_trigger\b/i.test(chk)) chkDefauts.push('ne lit pas pg_trigger')
  if (!/plpgsql_check_function_tb\(\s*\w+\.fonction\s*,\s*\w+\.relation\s*\)/i.test(chk)) chkDefauts.push('ne passe pas la table du trigger')
  if (!/level\s*=\s*'error'/i.test(chk)) chkDefauts.push('ne rougit pas sur le niveau error')
  if (!/not\s+t\.tgisinternal/i.test(chk)) chkDefauts.push('ne filtre pas les triggers internes')
  if (!/^\s*begin;/i.test(chk) || !/rollback;\s*$/i.test(chk)) chkDefauts.push('pas dans begin/rollback')
}
ok(chkDefauts.length === 0, 'H. plpgsql_check passe chaque fonction de trigger AVEC sa table, rouge sur toute erreur',
  chkDefauts.length ? `${relative(ROOT, CHEMIN_CHECK)} : ${chkDefauts.join(', ')}` : undefined)

// ── G. La requête de staging (point 2.13) : UNE instruction, un SELECT, rien qui écrive ──
//  Elle se colle sur staging : une écriture glissée là s'exécuterait sur une base réelle (§G.6).
const CHEMIN_REQUETE = join(ROOT, 'supabase', 'verifications', 'staging-avant-push.sql')
let req = ''
try { req = sansCommentaires(lire(CHEMIN_REQUETE)).replace(/'(?:[^']|'')*'/g, "''") } catch { /* absente : rouge */ }
const reqDefauts = []
if (!req.trim()) reqDefauts.push('absente')
else {
  const instructions = req.split(';').filter((x) => x.trim() !== '')
  if (instructions.length !== 1) reqDefauts.push(`${instructions.length} instructions`)
  if (!/^\s*select\b/i.test(req)) reqDefauts.push('ne commence pas par select')
  const ecrit = req.match(/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|call|perform|copy|vacuum|lock|comment|refresh|reindex|cluster)\b|\bdo\s*\$|\bset\s+(?:local\s+|session\s+)?\w+\s*(?:=|to)\b|\b\w+\s*\.\s*(?:nextval|setval|pg_terminate_backend|pg_cancel_backend)\b|\b(?:nextval|setval|pg_terminate_backend|pg_cancel_backend|dblink\w*|http_\w+|net\.\w+)\s*\(/gi)
  if (ecrit) reqDefauts.push(`mots d'écriture : ${[...new Set(ecrit.map((x) => x.toLowerCase().trim()))].join(', ')}`)
}
ok(reqDefauts.length === 0, 'G. la requête de staging est UNE instruction SELECT, sans rien qui écrive',
  reqDefauts.length ? `${relative(ROOT, CHEMIN_REQUETE)} : ${reqDefauts.join(', ')}` : undefined)

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
