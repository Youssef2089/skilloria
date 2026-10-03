#!/usr/bin/env node
// scripts/diag-integration-continue.mjs — LES CONTRÔLES DE GITHUB ACTIONS SE TIENNENT (lot DevOps CI, 03/10/2026).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI : les contrôles tournent sur GitHub, plus sur le poste (CLAUDE.md §G.13). Un flux qu'on ne peut pas
//   lancer ici se casse en silence : une étape retirée, un travail renommé (la règle des branches attend un NOM),
//   une valeur qui ressemble à une vraie clé, une route publique de plus que personne n'a déclarée. Ce contrôle
//   dit tout cela SANS GitHub, sur le poste et dans la série.
//
// CE QU'IL VÉRIFIE
//   A. le flux .github/workflows/controles.yml : ses déclencheurs (demande de fusion vers les deux branches
//      protégées, jamais `pull_request_target`), ses droits (lecture seule), ses trois travaux et les étapes que
//      chacun DOIT porter, aucune clé écrite (toute valeur d'un nom en *KEY*, *SECRET*, *TOKEN* est « ci-factice »),
//      aucune action sur une branche flottante (`@main`) ;
//   B. le verrou .github/controles-exiges.json : un contrôle par travail du flux, sous le MÊME nom, et un contrôle
//      « exige » porte la preuve de sa première exécution verte ;
//   C. les routes publiques (tests/integration/routes-publiques.mjs) : chaque route qui n'appelle aucune garde
//      d'authentification est DÉCLARÉE, et chaque route déclarée existe et n'appelle pas `requireAuth` ;
//   D. le test de base des accès croisés : son `plan(n)` égale son nombre d'assertions ;
//   E. le jeu de référence du moteur : chaque couple du vivier est noté, chaque correspondance attendue est tirée
//      de sa note (fort → strong, normal → normal, sous → aucune), chaque référence existe ;
//   F. Dependabot : npm en mises à jour de SÉCURITÉ seules, regroupées ; aucune fusion automatique ;
//   G. le moteur se charge hors de Next (le banc du moteur en dépend) — exécuté, dans un processus enfant.
//
// CE QU'IL NE VOIT PAS : ce que GitHub fera vraiment (le premier passage le dira), la règle des branches réglée
//   dans l'écran de GitHub, le résultat des bancs (ils exigent une base et une application démarrées).
//
//   node scripts/diag-integration-continue.mjs     → statique (+ un import exécuté), aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (t) => console.log(`\n═══ ${t} ═══\n`)
const sansCommentairesYaml = (s) => s.split('\n').map((l) => (/^\s*#/.test(l) ? '' : l)).join('\n')

// ── A. LE FLUX ───────────────────────────────────────────────────────────────
section('A. Le flux .github/workflows/controles.yml')
const CHEMIN_FLUX = '.github/workflows/controles.yml'
const flux = existsSync(join(ROOT, CHEMIN_FLUX)) ? sansCommentairesYaml(read(CHEMIN_FLUX)) : ''
ok(flux.length > 0, 'le flux existe')
ok(/\bon:\s*\n\s+pull_request:\s*\n\s+branches:\s*\[feat\/sprint-archi-orga, main\]/.test(flux),
  'il se déclenche sur chaque demande de fusion vers feat/sprint-archi-orga et main')
ok(!/pull_request_target/.test(flux), 'jamais `pull_request_target` (il donnerait des droits d’écriture au code d’une branche)')
ok(/\npermissions:\s*\n\s+contents: read\s*\n/.test(flux), 'droits du flux : lecture seule')
/** Les travaux : `  nom:` au premier niveau sous `jobs:`, avec leur texte. */
const travaux = {}
const blocJobs = flux.split(/\njobs:\s*\n/)[1] ?? ''
for (const m of blocJobs.matchAll(/^ {2}([a-z][a-z0-9_-]*):\s*\n([\s\S]*?)(?=^ {2}[a-z][a-z0-9_-]*:\s*\n|(?![\s\S]))/gm)) travaux[m[1]] = m[2]
ok(JSON.stringify(Object.keys(travaux)) === '["statique","base","application"]', 'trois travaux : statique, base, application', Object.keys(travaux).join(', '))
for (const [id, corps] of Object.entries(travaux)) {
  ok(new RegExp(`^ {4}name: ${id}\\s*$`, 'm').test(corps), `${id} : son nom affiché est son identifiant (la règle des branches attend ce NOM)`)
}
const ETAPES = {
  statique: [/fetch-depth: 0/, /cache: npm/, /run: npm ci/, /run: npx tsc --noEmit/, /run: node scripts\/diag-lint-cliquet\.mjs/,
    /run: node scripts\/diag-parite-i18n\.mjs/, /run: node scripts\/diag-memoire-a-jour\.mjs --base=origin\/\$\{\{ github\.base_ref \}\}/,
    /run: node scripts\/diag\.mjs --detail --sauf=diag-lint-cliquet,diag-parite-i18n/],
  base: [/cache: npm/, /run: npm ci/, /run: npx supabase start -x "\$SUPABASE_EXCLUS"/, /run: npx supabase db reset --local/,
    /run: node tests\/integration\/db-lint\.mjs/, /run: npx supabase test db --local/, /run: node tests\/integration\/env-supabase-local\.mjs/,
    /run: node --experimental-transform-types --no-warnings tests\/integration\/moteur-reference\.mjs/],
  application: [/cache: npm/, /run: npm ci/, /run: npx supabase start -x "\$SUPABASE_EXCLUS"/, /run: node tests\/integration\/env-supabase-local\.mjs/,
    /path: \.next\/cache/, /run: npm run build/, /npx next start -H 127\.0\.0\.1 -p 3000/, /node tests\/integration\/attendre-application\.mjs/,
    /run: node tests\/integration\/acces-routes\.mjs/],
}
for (const [id, motifs] of Object.entries(ETAPES)) {
  const manquent = motifs.filter((re) => !re.test(travaux[id] ?? '')).map((re) => re.source)
  ok(manquent.length === 0, `${id} : porte chacune de ses ${motifs.length} étapes`, manquent.join(' · '))
}
const exclus = /SUPABASE_EXCLUS: ([a-z,-]+)/.exec(flux)?.[1]?.split(',') ?? []
ok(exclus.length > 0 && !exclus.some((e) => ['db', 'kong', 'rest', 'storage', 'meta'].includes(e)),
  'supabase start n’exclut que l’accessoire (jamais la base, l’API, le stockage)', exclus.join(','))
const valeurs = [...flux.matchAll(/^\s+([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*):\s*(.+)$/gm)]
const douteuses = valeurs.filter(([, , v]) => !/^'?ci-factice[\w-]*'?$/.test(v.trim()) && !/^\$\{\{\s*secrets\./.test(v.trim()))
ok(valeurs.length >= 8 && douteuses.length === 0, `aucune clé écrite : les ${valeurs.length} valeurs de noms sensibles sont « ci-factice »`,
  douteuses.map(([, n]) => n).join(', '))
const actions = [...flux.matchAll(/uses:\s*([^\s]+)/g)].map((m) => m[1])
const flottantes = actions.filter((a) => !/@v\d+(\.\d+){0,2}$|@[0-9a-f]{40}$/.test(a))
ok(actions.length > 0 && flottantes.length === 0, `chaque action est épinglée à une version (${[...new Set(actions)].join(', ')})`, flottantes.join(', '))

// ── B. LE VERROU ─────────────────────────────────────────────────────────────
section('B. Le verrou .github/controles-exiges.json')
let verrou = null
try { verrou = JSON.parse(read('.github/controles-exiges.json')) } catch (e) { ok(false, 'le verrou se lit', e.message) }
if (verrou) {
  const noms = (verrou.controles ?? []).map((c) => c.nom)
  ok(JSON.stringify(noms) === JSON.stringify(Object.keys(travaux)), 'un contrôle par travail du flux, sous le même nom', `${noms.join(', ')} ≠ ${Object.keys(travaux).join(', ')}`)
  ok(JSON.stringify(verrou.branches_protegees) === '["feat/sprint-archi-orga","main"]', 'les branches protégées sont celles que le flux surveille')
  const mauvais = (verrou.controles ?? []).filter((c) => !['en_rodage', 'exige'].includes(c.etat)
    || (c.etat === 'exige' && !(c.premiere_execution_verte && /^\d{4}-\d{2}-\d{2}$/.test(c.premiere_execution_verte.date ?? '')
      && /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+/.test(c.premiere_execution_verte.adresse ?? '')))
    || (c.etat === 'en_rodage' && c.premiere_execution_verte !== null))
  ok(mauvais.length === 0, 'chaque contrôle est « en_rodage » sans preuve, ou « exige » avec la date et l’adresse de sa première exécution verte',
    mauvais.map((c) => c.nom).join(', '))
  const exiges = (verrou.controles ?? []).filter((c) => c.etat === 'exige').map((c) => c.nom)
  console.log(`  note exigés aujourd’hui : ${exiges.length ? exiges.join(', ') : 'aucun — tous en rodage jusqu’à leur premier passage vert sur GitHub'}`)
}

// ── C. LES ROUTES PUBLIQUES ───────────────────────────────────────────────────
section('C. Les routes publiques sont déclarées, et seulement elles')
const { PUBLIQUES, routesDuDepot } = await import(pathToFileURL(join(ROOT, 'tests/integration/routes-publiques.mjs')).href)
const routes = routesDuDepot(ROOT)
const parChemin = new Map(routes.map((r) => [r.chemin, r.code]))
// Une garde d'authentification APPELÉE (pas citée) : requireAuth, requireAdmin, le dépôt de CV (qui l'appelle),
// le secret des tâches planifiées, ou la vérification du jeton par la route elle-même (init-session).
const GARDE = /\brequireAuth\(|\brequireAdmin\(|\bdeposerCv\(|process\.env\.CRON_SECRET|code: 'no_token'/
const sansGarde = [...parChemin].filter(([, c]) => !GARDE.test(c)).map(([ch]) => ch)
const nonDeclarees = sansGarde.filter((ch) => !PUBLIQUES.has(ch))
ok(nonDeclarees.length === 0, `chaque route sans garde d’authentification est déclarée publique (${sansGarde.length} sans garde)`,
  nonDeclarees.map((c) => `${c} — à protéger, ou à déclarer avec sa raison dans tests/integration/routes-publiques.mjs`).join(' · '))
const fantomes = [...PUBLIQUES.keys()].filter((ch) => !parChemin.has(ch))
const gardees = [...PUBLIQUES.keys()].filter((ch) => /\brequireAuth\(/.test(parChemin.get(ch) ?? ''))
ok(fantomes.length === 0 && gardees.length === 0, `les ${PUBLIQUES.size} routes déclarées publiques existent et n’appellent pas requireAuth`,
  [...fantomes.map((c) => `${c} : n’existe plus`), ...gardees.map((c) => `${c} : appelle requireAuth — ce n’est pas une route publique`)].join(' · '))
ok([...PUBLIQUES.values()].every((r) => typeof r === 'string' && r.length >= 20), 'chaque route publique porte sa raison')
ok(routes.filter((r) => r.chemin.startsWith('admin/')).every((r) => /\brequireAdmin\(/.test(r.code)),
  'chaque route sous /api/admin appelle requireAdmin (le banc l’éprouve contre chaque rôle)')

// Les gestes réservés à une organisation approuvée (§D.52) : la garde, APPELÉE, avant toute lecture de l'objet.
const RESERVEES = [['publications', 'POST'], ['publications/[id]', 'PATCH'], ['publications/[id]/publish', 'POST'],
  ['candidatures/[id]/select', 'POST'], ['candidatures/[id]/reject', 'POST'], ['candidatures/[id]/unlock', 'POST'], ['candidatures/[id]/pitch', 'POST']]
const sansGardeApprobation = RESERVEES.filter(([ch, m]) => {
  const r = routes.find((x) => x.chemin === ch && x.methode === m)
  if (!r) return true
  const corps = r.code.slice(r.code.search(new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`)))
  const iGarde = corps.search(/requireOrgApproved\(auth\)/)
  const iLecture = corps.search(/\.from\('(publications|candidatures)'\)/)
  return iGarde < 0 || (iLecture >= 0 && iLecture < iGarde)
}).map(([ch, m]) => `${m} ${ch}`)
ok(sansGardeApprobation.length === 0, `les ${RESERVEES.length} gestes réservés appellent requireOrgApproved avant de lire l’objet (§D.52)`, sansGardeApprobation.join(' · '))
ok(/code: 'org_not_approved'/.test(parChemin.get('admin/annonces/[id]/valider') ?? ''), 'la validation administrateur refuse une organisation non approuvée, nommé (§D.52)')
const revelent = [...parChemin].filter(([ch]) => ch.startsWith('publications/')).filter(([, c]) => /code: 'forbidden'/.test(c)).map(([ch]) => ch)
ok(revelent.length === 0, 'aucune route à identifiant d’annonce ne rend 403 forbidden : l’annonce d’un autre est introuvable (§D.53)', revelent.join(', '))

// ── D. LE TEST DE BASE DES ACCÈS CROISÉS ─────────────────────────────────────
section('D. Le test de base des accès croisés')
const CHEMIN_TEST = 'supabase/tests/database/vrai_appelant/acces_croises.test.sql'
const test = existsSync(join(ROOT, CHEMIN_TEST)) ? read(CHEMIN_TEST).split('\n').filter((l) => !/^\s*--/.test(l)).join('\n') : ''
const plan = Number(/select plan\((\d+)\)/.exec(test)?.[1] ?? NaN)
const assertions = (test.match(/^select (ok|is|isnt|throws_ok|lives_ok|results_eq|set_eq)\(/gm) ?? []).length
ok(test.length > 0 && plan === assertions, `plan(${plan}) = ${assertions} assertions`)
// L'expert B n'y joue pas sous son jeton : il est la CIBLE de l'expert A (ses lignes, relues après coup).
const roles = ['expert_a', 'cdi', 'client_a', 'client_b', 'cabinet', 'esn', 'admin']
ok(roles.every((r) => new RegExp(`'sub', :'${r}'`).test(test)) && /set local role anon;/.test(test),
  'chaque rôle y joue sous son propre jeton (expert A, CDI, clients A et B, cabinet, ESN, administrateur) et le visiteur sous anon')

// ── E. LE JEU DE RÉFÉRENCE ───────────────────────────────────────────────────
section('E. Le jeu de référence du moteur est cohérent')
const jeu = await import(pathToFileURL(join(ROOT, 'tests/integration/jeu-de-reference.mjs')).href)
const experts = new Set(jeu.EXPERTS.map((e) => e.ref))
const annonces = new Set(jeu.ANNONCES.map((a) => a.ref))
const incoherences = []
for (const [a, { vivier, correspondances }] of Object.entries(jeu.ATTENDU)) {
  if (!annonces.has(a)) incoherences.push(`${a} : annonce inconnue`)
  const notes = jeu.NOTES[a] ?? {}
  if (JSON.stringify([...vivier].sort()) !== JSON.stringify(Object.keys(notes).sort())) incoherences.push(`${a} : le vivier et les couples notés diffèrent`)
  for (const e of vivier) if (!experts.has(e)) incoherences.push(`${a} : expert ${e} inconnu`)
  const tirees = Object.fromEntries(Object.entries(notes).filter(([, n]) => n !== 'sous').map(([e, n]) => [e, n === 'fort' ? 'strong' : 'normal']))
  if (JSON.stringify(Object.entries(tirees).sort()) !== JSON.stringify(Object.entries(correspondances).sort())) incoherences.push(`${a} : correspondances non tirées des notes`)
}
for (const e of jeu.INELIGIBLES) {
  const x = jeu.EXPERTS.find((y) => y.ref === e)
  if (!x || !(x.invisible || x.indisponible)) incoherences.push(`${e} : déclaré inéligible sans raison`)
}
for (const e of jeu.SENS_EXPERT) if (!experts.has(e)) incoherences.push(`${e} : inconnu`)
ok(incoherences.length === 0, `vivier noté, correspondances tirées des notes, références existantes (${experts.size} experts, ${annonces.size} annonces)`, incoherences.join(' · '))
ok(jeu.FEED < jeu.PALIER && jeu.PALIER <= 10 && jeu.FEED > 0, `les filtres du jeu laissent trois issues : sous ${jeu.FEED}, entre, au-dessus de ${jeu.PALIER}`)
const N = jeu.NOTE_SIMULEE
ok(N && N.fort >= jeu.PALIER && jeu.PALIER > N.normal && N.normal >= jeu.FEED && jeu.FEED > N.sous && N.fort <= 10 && N.sous >= 0,
  `les notes simulées fixes (fort ${N?.fort}, normal ${N?.normal}, sous ${N?.sous}) tombent dans les trois issues des filtres du jeu`)
const R = jeu.REGLAGES ?? []
const memeFiltre = R.filter((x) => x.feed === jeu.FEED).map((x) => x.palier)
const filtres = new Set(R.map((x) => x.feed))
ok(R.length >= 4 && R.every((x) => x.feed >= 0 && x.feed <= x.palier && x.palier <= 10 && typeof x.pourquoi === 'string')
   && new Set(memeFiltre).size >= 2 && filtres.size >= 2
   && R.some((x) => x.feed > N.normal) && R.some((x) => x.palier <= N.normal) && R.some((x) => x.palier > N.fort),
  `les réglages rejoués (${R.length}) font bouger le filtre ET le palier, et chaque note change d’issue au moins une fois`)

// ── F. DEPENDABOT ────────────────────────────────────────────────────────────
section('F. Dependabot : la sécurité regroupée, rien ne fusionne seul')
const dependabot = existsSync(join(ROOT, '.github/dependabot.yml')) ? sansCommentairesYaml(read('.github/dependabot.yml')) : ''
const blocNpm = /package-ecosystem: npm[\s\S]*?(?=\n {2}- package-ecosystem|(?![\s\S]))/.exec(dependabot)?.[0] ?? ''
ok(/open-pull-requests-limit: 0/.test(blocNpm) && /applies-to: security-updates/.test(blocNpm) && /patterns: \['\*'\]/.test(blocNpm),
  'npm : aucune mise à jour de version, les mises à jour de SÉCURITÉ regroupées en une demande de fusion')
ok(/package-ecosystem: github-actions/.test(dependabot), 'les actions du flux sont tenues à jour')
const tousLesFlux = ['.github/workflows/controles.yml', '.github/workflows/nuit-matching.yml'].map((p) => (existsSync(join(ROOT, p)) ? read(p) : '')).join('\n')
ok(!/auto-?merge|gh pr merge|enable-pull-request-automerge/i.test(sansCommentairesYaml(tousLesFlux)), 'aucune fusion automatique dans nos flux')

// ── F bis. LES TÂCHES PLANIFIÉES ONT CHACUNE LEUR PREUVE ─────────────────────
section('F bis. Chaque tâche planifiée est nommée dans le test de ses effets')
{
  const dossierMig = join(ROOT, 'supabase/migrations')
  const planifiees = new Set()
  for (const f of readdirSync(dossierMig).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = read(`supabase/migrations/${f}`).split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
    for (const m of sql.matchAll(/cron\.schedule\(\s*'([a-z0-9_-]+)'/g)) planifiees.add(m[1])
  }
  const CHEMIN_EFFETS = 'supabase/tests/database/taches_planifiees/effets.test.sql'
  const effets = existsSync(join(ROOT, CHEMIN_EFFETS)) ? read(CHEMIN_EFFETS) : ''
  const bloc = /insert into taches_attendues values([\s\S]*?);/.exec(effets)?.[1] ?? ''
  const nommees = new Set([...bloc.matchAll(/\('([a-z0-9_-]+)',/g)].map((m) => m[1]))
  const sansPreuve = [...planifiees].filter((n) => !nommees.has(n))
  const fantomes = [...nommees].filter((n) => !planifiees.has(n))
  ok(planifiees.size >= 12 && sansPreuve.length === 0 && fantomes.length === 0,
    `les ${planifiees.size} tâches planifiées par les migrations sont exactement celles que nomme ${CHEMIN_EFFETS.split('/').slice(-2).join('/')}`,
    [...sansPreuve.map((n) => `${n} : sans preuve d’effet`), ...fantomes.map((n) => `${n} : nommée, jamais planifiée`)].join(' · '))
}

// ── F ter. LE GRAND JEU DE NUIT ───────────────────────────────────────────────
section('F ter. Le grand jeu de nuit : un flux à part, un générateur déterministe, jamais la production')
{
  const CHEMIN_NUIT = '.github/workflows/nuit-matching.yml'
  const nuit = existsSync(join(ROOT, CHEMIN_NUIT)) ? sansCommentairesYaml(read(CHEMIN_NUIT)) : ''
  ok(/\non:\s*\n\s+schedule:\s*\n\s+- cron: '[0-9*/ ,-]+'\s*\n\s+workflow_dispatch:\s*\n/.test(nuit) && !/pull_request|\bpush:/.test(nuit),
    'le flux de nuit se déclenche la nuit et à la main — jamais sur une demande de fusion ni un envoi')
  ok(/\npermissions:\s*\n\s+contents: read/.test(nuit) && !/secrets\./.test(nuit)
     && [...nuit.matchAll(/uses:\s*([^\s]+)/g)].every((m) => /@v\d+(\.\d+){0,2}$/.test(m[1])),
    'flux de nuit : lecture seule, aucune clé, actions épinglées')
  ok(/run: node --experimental-transform-types --no-warnings tests\/integration\/nuit-matching\.mjs/.test(nuit)
     && /actions\/upload-artifact@v\d+/.test(nuit) && /path: nuit-matching\.json/.test(nuit),
    'il lance le banc de nuit et garde son résultat chiffré (artefact)')
  ok(!/nuit-matching|generateur-jeu/.test(flux), 'le grand jeu ne tourne JAMAIS dans les contrôles d’une demande de fusion')

  const gen = await import(pathToFileURL(join(ROOT, 'tests/integration/generateur-jeu.mjs')).href)
  const referentiel = { branches: [{ id: 'b1', specialites: ['s1', 's2', 's3'] }, { id: 'b2', specialites: ['s4'] }],
    pays: ['FR', 'DE', 'MA', 'ES', 'IT'], continents: ['EU', 'AF'], monde: 'WORLD' }
  const un = gen.genererJeu({ graine: 7, experts: 40, organisations: 6, missions: 12, referentiel })
  const deux = gen.genererJeu({ graine: 7, experts: 40, organisations: 6, missions: 12, referentiel })
  const autre = gen.genererJeu({ graine: 8, experts: 40, organisations: 6, missions: 12, referentiel })
  ok(JSON.stringify(un) === JSON.stringify(deux) && JSON.stringify(un) !== JSON.stringify(autre)
     && gen.sqlDuJeu(un) === gen.sqlDuJeu(deux) && gen.noteFixe('GEN-M001', 'GEN-E0001', 7) === gen.noteFixe('GEN-M001', 'GEN-E0001', 7),
    'le générateur est déterministe : même graine, même jeu et même SQL ; autre graine, autre jeu ; une note fixe par couple')
  const tel = new Set([...un.experts, ...un.organisations].map((x) => x.telephone))
  ok(tel.size === un.experts.length + un.organisations.length && un.experts.every((e) => e.resume.length >= 200 && e.resume.length <= 800)
     && un.experts.some((e) => e.specialites.length === 0) && un.experts.some((e) => e.occupe) && un.experts.some((e) => e.voie === 'cdi'),
    'le jeu tient les règles d’inscription et couvre les cas : téléphones uniques, résumés de 200 à 800 caractères, « Autre » seule, Occupés, CDI')

  const { cibleDuJeu } = await import(pathToFileURL(join(ROOT, 'tests/integration/cible-du-jeu.mjs')).href)
  const { cibleDeConstruction } = await import(pathToFileURL(join(ROOT, 'lib/configuration/variables.ts')).href)
  const LOCALE = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  const uat = 'abcdefghijklmnopqrst', prod = 'zyxwvutsrqponmlkjihg'
  const DISTANTE = (ref) => `postgresql://postgres:x@db.${ref}.supabase.co:5432/postgres`
  const motif = (env, url) => { const v = cibleDuJeu(env, url, cibleDeConstruction); return v.autorisee ? `ok:${v.cible}` : v.motif }
  const cas = [
    [{}, LOCALE, 'ok:locale'],
    [{ VERCEL: '1', VERCEL_ENV: 'production' }, LOCALE, 'environnement_de_production'],
    [{}, DISTANTE(uat), 'production_non_declaree'],
    [{ SUPABASE_REF_PRODUCTION: prod, JEU_CIBLE_AUTORISEE: prod }, DISTANTE(prod), 'cible_de_production'],
    [{ SUPABASE_REF_PRODUCTION: prod }, DISTANTE(uat), 'cible_non_autorisee_explicitement'],
    [{ SUPABASE_REF_PRODUCTION: prod, JEU_CIBLE_AUTORISEE: uat }, DISTANTE(uat), 'ok:distante'],
    [{}, 'postgresql://x@exemple.org/p', 'projet_non_identifie'],
  ]
  const fautes = cas.filter(([env, url, attendu]) => motif(env, url) !== attendu).map(([env, url, attendu]) => `${JSON.stringify(env)} ${url} → ${motif(env, url)} (attendu ${attendu})`)
  ok(fautes.length === 0, 'le générateur n’écrit JAMAIS en production : refusé sous la barrière de production, sur la base déclarée de production, sur une base distante non nommée, ou quand la production n’est pas déclarée', fautes.join(' · '))
  ok(/cibleDuJeu\(process\.env, db, cibleDeConstruction\)/.test(read('tests/integration/generateur-jeu.mjs'))
     && /if \(!cible\.autorisee\) throw/.test(read('tests/integration/generateur-jeu.mjs')),
    'le générateur pose cette garde AVANT toute lecture ou écriture de la base visée')
}

// ── G. LE MOTEUR SE CHARGE HORS DE NEXT ──────────────────────────────────────
section('G. Le moteur se charge hors de Next (exécuté)')
const essai = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', '--input-type=module', '-e',
  `import { importerDuDepot } from ${JSON.stringify(pathToFileURL(join(ROOT, 'scripts/lib/chargeur-ts.mjs')).href)};
   const m = await importerDuDepot('lib/matching/index.ts'); const p = await importerDuDepot('lib/matching/pool.ts');
   const f = await importerDuDepot('lib/missions/feed.ts'); const d = await importerDuDepot('lib/durees.ts');
   const j = await importerDuDepot('lib/journal/contexte.ts');
   console.log([typeof m.runMatchingForPublication, typeof m.runMatchingForExpert, typeof p.chargerVivierPourAnnonce, typeof j.ouvrirContexte, typeof f.expertMissionsQuery, typeof d.chargerDurees].join(','))`],
  { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } })
ok(essai.stdout?.trim().split('\n').pop() === 'function,function,function,function,function,function',
  'runMatchingForPublication, runMatchingForExpert, chargerVivierPourAnnonce, ouvrirContexte, expertMissionsQuery et chargerDurees se chargent tels qu’ils sont livrés',
  (essai.stderr || essai.stdout || '').trim().slice(-400))

console.log(failures === 0
  ? '\n✅ Le flux, le verrou, les routes publiques, les bancs et le jeu de référence se tiennent.'
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — l’intégration continue ne vérifierait pas ce qu’elle annonce`)
process.exitCode = failures === 0 ? 0 : 1
