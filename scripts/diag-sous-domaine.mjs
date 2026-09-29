#!/usr/bin/env node
// scripts/diag-sous-domaine.mjs — LE SOUS-DOMAINE D'UN ÉCOSYSTÈME EST UN RÉGLAGE, ET AUCUN NOM D'ÉCOSYSTÈME
// N'EST ÉCRIT DANS LE CODE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE (29/09/2026)
//   Le champ « Sous-domaine » n'apparaissait qu'à la création : Skilloria 365 portait `microsoft` sans
//   que l'écran permette de le changer. Décision de Youssef : le sous-domaine se règle dans l'admin et se
//   modifie ; aucun nom d'écosystème dans le code.
//
// LA PROPRIÉTÉ
//   A. UNE RÈGLE DE FORME : la contrainte en base (`domains_sous_domaine_forme`, dernière définition dans
//      les migrations), `SLUG_ECOSYSTEME` (lib/subdomain.ts) et `SLUG_RE` (lib/ecosystem-url.ts) disent la
//      même chose — comparées ET exécutées sur une batterie de cas (63 et 64 caractères compris) ;
//   B. MODIFIABLE : le PATCH de l'écosystème prend le sous-domaine SEUL, écrit à la condition que la valeur
//      lue n'ait pas bougé, nomme les refus de la base (23505, 23514), trace `ecosysteme_modifie` avec
//      l'opération `sous_domaine`, avant et après ; chaque refus nommé par la route a son message dans les
//      quatre langues, et l'écran le sait ; le champ n'est plus en lecture seule ;
//   C. UNE SEULE SOURCE : `getDomainConfig` et la garde d'écosystème lisent `domains.slug` à chaque appel,
//      sans cache ; la liste blanche TS de `ecosysteme_modifie` porte avant/après ;
//   D. AUCUN NOM D'ÉCOSYSTÈME DANS LE CODE : les noms que le dépôt connaît — ceux que les migrations sèment
//      dans `domains` (sous-domaine, nom) et dans `translations` (nom, nom d'écosystème), plus leur forme
//      tassée (« Skilloria 365 » → « skilloria365 ») — n'apparaissent ni dans le code (commentaires exclus)
//      de app/, lib/, components/, context/, i18n/, proxy.ts, ni dans les messages des quatre langues, ni
//      dans les documents légaux servis (docs/legal).
//
// CE QU'IL NE VOIT PAS, ET LE DIT
//   · un nom qui n'existe QUE dans une base (créé dans l'admin, jamais semé) : il ne le connaît pas ;
//   · les COMMENTAIRES (ils racontent des cas passés, ils n'exécutent rien) ; les tests et les scripts
//     (scripts/, supabase/tests) ; les migrations (la graine est une DONNÉE, rejouée sur une base neuve) ;
//   · ce qui arrive aux liens déjà envoyés et aux sessions : c'est documenté (mise-en-production, étape 6).
//
//   node scripts/diag-sous-domaine.mjs   → statique, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (t) => console.log(`\n═══ ${t} ═══\n`)

/** Retire les commentaires d'un source TS/JS sans toucher aux chaînes (`//` d'une URL reste). */
function sansCommentaires(src) {
  let out = ''
  let i = 0
  let etat = null // null | "'" | '"' | '`' | 'ligne' | 'bloc'
  while (i < src.length) {
    const c = src[i], d = src[i + 1]
    if (etat === 'ligne') { if (c === '\n') { etat = null; out += c } else out += ' '; i++; continue }
    if (etat === 'bloc') { if (c === '*' && d === '/') { etat = null; out += '  '; i += 2 } else { out += c === '\n' ? c : ' '; i++ } continue }
    if (etat) {
      out += c
      if (c === '\\') { out += d ?? ''; i += 2; continue }
      if (c === etat) etat = null
      i++; continue
    }
    if (c === '/' && d === '/') { etat = 'ligne'; out += '  '; i += 2; continue }
    if (c === '/' && d === '*') { etat = 'bloc'; out += '  '; i += 2; continue }
    if (c === "'" || c === '"' || c === '`') etat = c
    out += c; i++
  }
  return out
}
const fichiers = (d, motif, o = []) => {
  if (!existsSync(join(ROOT, d))) return o
  for (const e of readdirSync(join(ROOT, d))) {
    const p = `${d}/${e}`
    if (statSync(join(ROOT, p)).isDirectory()) fichiers(p, motif, o); else if (motif.test(e)) o.push(p)
  }
  return o
}
const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
const sqlSansCommentaires = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

// ── A. UNE RÈGLE DE FORME ────────────────────────────────────────────────────
section('A. Une règle de forme — la base, le résolveur, le sélecteur')
let motifSql = null
for (const f of migrations) {
  const m = /add\s+constraint\s+domains_sous_domaine_forme\s+check\s*\(\s*slug\s*~\s*'([^']+)'\s*\)/i.exec(sqlSansCommentaires(read(`supabase/migrations/${f}`)))
  if (m) motifSql = m[1]
}
ok(motifSql !== null, 'A. la contrainte domains_sous_domaine_forme est posée par une migration')
const sub = read('lib/subdomain.ts')
const url = read('lib/ecosystem-url.ts')
const motifSub = /const SLUG_ECOSYSTEME = \/(.+)\/\n/.exec(sub)?.[1] ?? null
const motifUrl = /const SLUG_RE = \/(.+)\/\n/.exec(url)?.[1] ?? null
const norme = (m) => (m ?? '').replace(/\(\?:/g, '(')
ok(motifSub !== null && motifUrl !== null && norme(motifSub) === norme(motifUrl) && norme(motifSub) === norme(motifSql),
  'A. le motif est le MÊME en base, dans le résolveur et dans le sélecteur',
  `base ${motifSql} · subdomain ${motifSub} · ecosystem-url ${motifUrl}`)
// La requête de staging compte les sous-domaines hors forme AVANT le push : avec le même motif, ou elle mentirait.
const motifRequete = /d\.slug !~ '([^']+)'/.exec(read('supabase/verifications/staging-avant-push.sql'))?.[1] ?? null
ok(motifRequete === null || norme(motifRequete) === norme(motifSql),
  'A. la requête de staging compte les sous-domaines hors forme avec le motif de la base',
  `requête ${motifRequete} · base ${motifSql}`)
const CAS = ['a', 'z9', 'skilloria365', 'mon-ecosysteme', 'a'.repeat(63), 'a'.repeat(64), '', 'A', 'a.b', '-a', 'a-', 'a b',
  'é', 'a_b', '0', '9-9', 'a--b']
const rSql = new RegExp(motifSql ?? '$^'), rSub = new RegExp(motifSub ?? '$^'), rUrl = new RegExp(motifUrl ?? '$^')
const divergents = CAS.filter((c) => !(rSql.test(c) === rSub.test(c) && rSub.test(c) === rUrl.test(c)))
ok(divergents.length === 0 && rSql.test('a'.repeat(63)) && !rSql.test('a'.repeat(64)) && !rSql.test('a.b') && rSql.test('skilloria365'),
  `A. exécutés sur ${CAS.length} cas, les trois rendent le même verdict — 63 caractères passent, 64 non, un point non`,
  divergents.length ? `divergent(s) : ${divergents.map((c) => JSON.stringify(c)).join(', ')}` : undefined)

// ── B. MODIFIABLE ────────────────────────────────────────────────────────────
section('B. Le sous-domaine se modifie dans l’écran Écosystèmes')
const route = sansCommentaires(read('app/api/admin/ecosystemes/[id]/route.ts'))
const iFn = route.indexOf('async function changerSousDomaine(')
const corps = iFn >= 0 ? route.slice(iFn) : ''
ok(/if \(has\('slug'\)\) return changerSousDomaine\(auth, journal, id, body, request\)/.test(route),
  'B. le PATCH envoie le sous-domaine sur son propre chemin, avant tout autre champ')
ok(/const autres = Object\.keys\(body\)\.filter\(\(k\) => k !== 'slug'\)[\s\S]{0,80}if \(autres\.length > 0\)[\s\S]{0,160}'sous_domaine_seul'/.test(corps),
  'B. le changement est SEUL dans sa requête (sous_domaine_seul)')
ok(/if \(!isValidEcosystemSlug\(apres\)\)[\s\S]{0,120}'sous_domaine_invalide'/.test(corps),
  'B. la forme est refusée par son nom AVANT l’écriture (la même fonction que le sélecteur)')
ok(/\.update\(\{ slug: apres \}\)\s*\.eq\('id', id\)\s*\.eq\('slug', avant\)/.test(corps),
  'B. écrit À LA CONDITION que la valeur lue n’ait pas bougé (lire puis écrire)')
ok(/'23505'[\s\S]{0,120}'sous_domaine_pris'/.test(corps) && /'23514'[\s\S]{0,120}'sous_domaine_invalide'/.test(corps)
   && /ecrit\.length === 0\)[\s\S]{0,120}'sous_domaine_concurrent'/.test(corps),
  'B. les refus de la base sont NOMMÉS : 23505 → sous_domaine_pris, 23514 → sous_domaine_invalide, zéro ligne → sous_domaine_concurrent')
ok(/lectureErr\)[\s\S]{0,160}'lecture_indisponible'[\s\S]{0,40}503/.test(corps),
  'B. une lecture en panne n’est pas « introuvable » (503 lecture_indisponible)')
ok(/ecosystemeModifie\(auth\.supabaseAdmin, journal, \{\s*id,\s*operation: 'sous_domaine',\s*champs: \['slug'\],\s*sousDomaine: \{ avant, apres \},\s*\}\)/.test(corps),
  'B. la trace : ecosysteme_modifie, opération sous_domaine, avant et après, sous la pièce du geste')
const codesRoute = [...new Set([...corps.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]))]
  .filter((c) => c !== 'db_error' && c !== 'not_found')
const page = sansCommentaires(read('app/[locale]/admin/ecosystemes/page.tsx'))
const sdCodes = /const SD_CODES = \[([^\]]+)\]/.exec(page)?.[1] ?? ''
const absentsEcran = codesRoute.filter((c) => !sdCodes.includes(`'${c}'`))
const absentsLangue = []
for (const l of ['fr', 'en', 'es', 'de']) {
  const errs = JSON.parse(read(`messages/${l}.json`))?.admin_ecosystemes?.sous_domaine?.errors ?? {}
  for (const c of [...codesRoute, 'generic']) if (typeof errs[c] !== 'string' || !errs[c].trim()) absentsLangue.push(`${l}:${c}`)
}
ok(codesRoute.length >= 7 && absentsEcran.length === 0 && absentsLangue.length === 0,
  `B. chaque refus nommé par la route (${codesRoute.length}) a son message dans les quatre langues, et l’écran le connaît`,
  [absentsEcran.length ? `inconnus de l’écran : ${absentsEcran.join(', ')}` : '', absentsLangue.length ? `sans message : ${absentsLangue.join(', ')}` : ''].filter(Boolean).join(' · ') || `codes lus : ${codesRoute.join(', ')}`)
ok(!/readOnly/.test(page) && !/slug_locked/.test(page) && /body: JSON\.stringify\(\{ slug: apres \}\)/.test(page)
   && /role="alertdialog"/.test(page) && /consequence_liens/.test(page) && /consequence_sessions/.test(page),
  'B. l’écran offre la modification — plus de champ en lecture seule — et fait LIRE ce qu’elle déplace avant de confirmer')
ok(!/step_host|step_dns/.test(page),
  'B. après création, l’écran ne demande plus de déclarer le sous-domaine chez l’hébergeur (adresse générique)')

// ── C. UNE SEULE SOURCE ──────────────────────────────────────────────────────
section('C. Une seule source : le sous-domaine réglé, lu à chaque requête')
const gdc = sansCommentaires(read('lib/get-domain-config.ts'))
const garde = sansCommentaires(read('lib/ecosystem-guard.ts'))
ok(/\.from\('domains'\)[\s\S]{0,200}\.eq\('slug', slug\)/.test(gdc) && !/new Map|unstable_cache|'use cache'|revalidate/.test(gdc),
  'C. getDomainConfig lit domains.slug à chaque appel — aucun cache qui garderait un ancien sous-domaine')
ok(/\.from\('domains'\)/.test(garde) && !/new Map|unstable_cache|'use cache'/.test(garde),
  'C. la garde d’écosystème lit domains à chaque appel, sans cache')
const actions = read('lib/journal/actions.ts')
// `[\s\S]{0,200}?` et non `[^\]]*` : la liste contient 'champs[]', dont le crochet arrêtait le motif.
ok(/ecosysteme_modifie: \[[\s\S]{0,200}?'sous_domaine', 'sous_domaine\.avant', 'sous_domaine\.apres'\]/.test(actions),
  'C. la liste blanche TS de ecosysteme_modifie porte sous_domaine.avant / .apres (diag-grand-livre la compare à la base)')

// ── D. AUCUN NOM D'ÉCOSYSTÈME DANS LE CODE ───────────────────────────────────
section('D. Aucun nom d’écosystème dans le code')
const noms = new Set()
for (const f of migrations) {
  const sql = sqlSansCommentaires(read(`supabase/migrations/${f}`))
  for (const m of sql.matchAll(/insert\s+into\s+public\.domains\s*\(([^)]*)\)\s*values\s*([\s\S]*?);/gi)) {
    const cols = m[1].split(',').map((c) => c.trim())
    for (const t of m[2].matchAll(/\(([^()]*)\)/g)) {
      const vals = [...t[1].matchAll(/'((?:[^']|'')*)'|(null|true|false|[\d.]+)/gi)].map((v) => v[1] ?? v[2])
      for (const col of ['slug', 'name']) { const i = cols.indexOf(col); if (i >= 0 && vals[i]) noms.add(vals[i]) }
    }
  }
  for (const m of sql.matchAll(/\(\s*'domains'\s*,\s*'[0-9a-f-]{36}'\s*,\s*'(name|ecosystem_name)'\s*,\s*'[a-z]{2}'\s*,\s*'((?:[^']|'')*)'\s*\)/gi)) noms.add(m[2])
}
for (const n of [...noms]) { const tasse = n.toLowerCase().replace(/[^a-z0-9]/g, ''); if (tasse.length >= 3) noms.add(tasse) }
const listeNoms = [...noms].filter((n) => n.length >= 3)
ok(listeNoms.length > 0, `D. les noms que le dépôt connaît, lus dans la graine des migrations : ${listeNoms.map((n) => `« ${n} »`).join(', ')}`,
  'aucun nom lu : si la graine a changé de forme, ce contrôle se relit, il ne se supprime pas')
const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const motifNoms = new RegExp(`(?<![A-Za-z0-9])(${listeNoms.map(echapper).join('|')})(?![A-Za-z0-9])`, 'i')
const trouves = []
const sources = [
  ...['app', 'lib', 'components', 'context', 'i18n'].flatMap((d) => fichiers(d, /\.(ts|tsx|mjs|js)$/)),
  ...(existsSync(join(ROOT, 'proxy.ts')) ? ['proxy.ts'] : []),
].filter((f) => f !== 'lib/database.types.ts')
for (const f of sources) {
  const lignes = sansCommentaires(read(f)).split('\n')
  lignes.forEach((l, i) => { const m = motifNoms.exec(l); if (m) trouves.push(`${f}:${i + 1} « ${m[1]} »`) })
}
const feuilles = (o, chemin, out) => {
  if (typeof o === 'string') out.push([chemin, o])
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) feuilles(v, chemin ? `${chemin}.${k}` : k, out)
  return out
}
for (const l of ['fr', 'en', 'es', 'de']) {
  for (const [chemin, v] of feuilles(JSON.parse(read(`messages/${l}.json`)), '', [])) {
    const m = motifNoms.exec(v); if (m) trouves.push(`messages/${l}.json ${chemin} « ${m[1]} »`)
  }
}
for (const f of fichiers('docs/legal', /\.md$/)) {
  read(f).split('\n').forEach((l, i) => { const m = motifNoms.exec(l); if (m) trouves.push(`${f}:${i + 1} « ${m[1]} »`) })
}
ok(sources.length > 100 && trouves.length === 0,
  `D. aucun nom d’écosystème dans le code (${sources.length} fichiers, commentaires exclus), les messages des quatre langues ni les documents légaux`,
  trouves.length ? trouves.slice(0, 12).join(' · ') + (trouves.length > 12 ? ` … (+${trouves.length - 12})` : '') : `balayage trop court : ${sources.length} fichiers`)

console.log(failures === 0
  ? '\n✅ Le sous-domaine est un réglage, tenu en base et modifiable ; aucun nom d’écosystème n’est écrit dans le code.'
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — le sous-domaine n’est pas un réglage, ou un nom d’écosystème est écrit dans le code`)
process.exit(failures === 0 ? 0 : 1)
