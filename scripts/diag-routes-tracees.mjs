#!/usr/bin/env node
// scripts/diag-routes-tracees.mjs — TOUTE ROUTE QUI CHANGE UN ÉTAT LAISSE UNE LIGNE AU GRAND LIVRE,
// OU FIGURE, NOMMÉMENT ET AVEC SA RAISON, DANS LA LISTE DES EXCLUSIONS (§D.26, phase B, 2.3).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// D'OÙ IL VIENT. C'était une MESURE (`mesure-routes-sans-trace`, 26/09/2026) : 63 routes qui écrivent,
// 28 sans trace. L'audit de la phase B les a rangées — 7 gestes sans action (actions nouvelles),
// 14 rattachements (actions existantes ou nouvelles), une route morte (supprimée), 7 hors périmètre —
// et Youssef a arbitré. Tout est branché : la mesure devient un contrôle, et ce qu'elle laisse est
// ÉCRIT ci-dessous, route par route, avec sa raison.
//
// PÉRIMÈTRE (écrit avant le balayage, inchangé) : chaque app/api/**/route.ts ; « écrit » =
// from().insert|update|upsert|delete, storage upload|remove, auth.admin.*, ou .rpc() vers une fonction
// SQL dont la DERNIÈRE définition insère, modifie ou supprime ; « trace » = le fichier appelle un
// écrivain du grand livre, SQL (point fixe depuis journaliser) ou TypeScript (point fixe sur les
// fonctions de lib/) — ou, pour une création de compte, la preuve signée que handle_new_user
// journalise (compte_cree sous sa pièce, §D.27).
//
// CE QU'IL GARDE
//   A. aucune route qui écrit n'est sans trace hors des EXCLUSIONS ;
//   B. aucune exclusion n'est PÉRIMÉE : une route exclue qui trace désormais, qui n'écrit plus, ou qui
//      n'existe plus, rougit (« retire-la ») — la liste ne fait que descendre ;
//   C. chaque exclusion porte une raison qui commence par LÉGITIME (§G.8 : une liste sans raisons
//      devient un tampon qu'on remplit sans lire).
// CE QU'IL NE VOIT PAS, ET LE DIT
//   · la granularité est le FICHIER, pas la méthode : un fichier dont une méthode trace et l'autre
//     non passerait — les preuves D ter de diag-grand-livre, ancrées méthode par méthode, le couvrent
//     pour chaque action branchée ;
//   · une écriture faite par une fonction de lib/ qui ne journalise pas, appelée depuis la route ;
//   · le SQL dynamique.
//
//   node scripts/diag-routes-tracees.mjs     0 = vert · 1 = manquement
// Lecture du dépôt seule, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const R = process.cwd()
const read = (p) => readFileSync(join(R, p), 'utf8').split('\r\n').join('\n')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
const walk = (d, o = []) => { for (const e of readdirSync(join(R, d))) { const p = `${d}/${e}`; if (statSync(join(R, p)).isDirectory()) walk(p, o); else if (/\.tsx?$/.test(e)) o.push(p) } return o }

// SQL : dernière définition de chaque fonction.
const defs = new Map()
for (const f of readdirSync(join(R, 'supabase/migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  const s = read(`supabase/migrations/${f}`).split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
  for (const m of s.matchAll(/create or replace function (?:public\.|"public"\.")(\w+)"?\(/gi)) {
    const i = m.index
    const as = s.slice(i).search(/\bas\s+\$/i)
    if (as < 0) continue
    const o = i + as + s.slice(i + as).indexOf('$')
    const tag = s.slice(o, s.indexOf('$', o + 1) + 1)
    const fin = s.indexOf(tag, o + tag.length)
    defs.set(m[1], s.slice(i, fin < 0 ? undefined : fin))
  }
}
const ecrSql = new Set(['journaliser'])
for (let b = true; b;) {
  b = false
  for (const [n, c] of defs) if (!ecrSql.has(n) && [...ecrSql].some((e) => new RegExp('\\b' + e + '\\(').test(c))) { ecrSql.add(n); b = true }
}
const ecritSql = (n) => { const c = defs.get(n); return !!c && /\b(insert\s+into|update\s+(public\.)?\w+\s+|delete\s+from)/i.test(c) }

// TS : fonctions de lib/ qui journalisent, par point fixe sur les noms.
const libs = walk('lib').map((f) => [f, strip(read(f))])
const fonctions = []
for (const [f, s] of libs) {
  // ⚠️ UNE FONCTION GÉNÉRIQUE EST UNE DÉCLARATION (\`function journaliser<A …>(\`). Le motif d'origine
  //    exigeait \`nom(\` : il ratait les génériques, et le corps de la déclaration PRÉCÉDENTE — la classe
  //    JournalError — avalait ceux de journaliser() et journaliserDans(). La classe devenait « traçante »,
  //    puis contexteDepuisAuth() qui la lève : toute route qui ouvrait un contexte passait pour tracée,
  //    sans écrire une ligne. Vu par mutation le 28/09/2026 (§G.5) : le faux vert dans le sens rassurant.
  const decl = [...s.matchAll(/(?:export )?(?:async )?function (\w+)\s*(?:<[^(]*>)?\(|export class (\w+)/g)]
  decl.forEach((m, k) => fonctions.push({ f, nom: m[1] ?? m[2], corps: s.slice(m.index, k + 1 < decl.length ? decl[k + 1].index : undefined) }))
}
const journalise = (corps, conn) => /\bjournaliserDans\(|\bjournaliser\(|\bjournaliserReglage\(/.test(corps)
  || [...corps.matchAll(/\.rpc\('(\w+)'/g)].some((m) => ecrSql.has(m[1]))
  // Un APPEL, pas une mention : un \`import { identiteModifiee }\` resté seul après la perte de l'appel
  // rendait la route « tracée » (vu par mutation le 28/09/2026, §G.5).
  || [...conn].some((n) => new RegExp('\\b' + n + '\\s*\\(').test(corps))
const tracantes = new Set()
for (let b = true; b;) { b = false; for (const fn of fonctions) if (!tracantes.has(fn.nom) && journalise(fn.corps, tracantes)) { tracantes.add(fn.nom); b = true } }

// ── LES EXCLUSIONS — une raison chacune (§G.8), arbitrées le 28/09/2026 (phase B, 2.3) ──
//  Les lectures sont hors périmètre du grand livre (§D.26) : il enregistre ce qui change un état MÉTIER.
const EXCLUSIONS = {
  'auth/init-session': 'LÉGITIME — la session unique (jeton de session posé à la connexion) : un mécanisme, pas un geste métier ; la révocation, elle, a son action (session_revoquee)',
  'cron/stripe-reconcile': 'LÉGITIME — la vérification nocturne ne change aucun état métier : elle CONSTATE les écarts avec Stripe et écrit son propre journal de tâche (stripe_reconciliation_runs, un sous-journal)',
  'me/candidatures/[id]/view': 'LÉGITIME — une CONSULTATION (candidature_views) : les lectures sont hors périmètre du grand livre',
  'me/locale': 'LÉGITIME — une préférence d’AFFICHAGE (users.locale) : elle choisit la langue des écrans et des e-mails, elle ne change aucun état métier',
  'me/missions/[id]': 'LÉGITIME — une marque de LECTURE à l’ouverture d’une mission (match vu, notification lue) ; l’écart, lui, a son action (mission_ecartee)',
  'me/notifications': 'LÉGITIME — des notifications marquées LUES : une lecture',
  'me/notifications/[id]/read': 'LÉGITIME — une notification marquée LUE : une lecture',
}

// Routes.
const out = []
for (const f of walk('app/api').filter((x) => x.endsWith('route.ts'))) {
  const s = strip(read(f))
  const ecr = []
  for (const m of s.matchAll(/\.from\('(\w+)'\)[\s\S]{0,300}?\.(insert|update|upsert|delete)\(/g)) {
    // Un `.from()` de stockage suivi d'un `.remove()` n'est pas une table.
    ecr.push(`${m[1]}.${m[2]}`)
  }
  for (const m of s.matchAll(/\.rpc\('(\w+)'/g)) if (ecritSql(m[1])) ecr.push(`rpc:${m[1]}`)
  if (/\.storage\s*\.from\([^)]*\)\s*\.(upload|remove)\(/.test(s)) ecr.push('storage')
  if (/auth\.admin\.(updateUserById|createUser|deleteUser|inviteUserByEmail)\(/.test(s)) ecr.push('auth.admin')
  // CRÉER UN COMPTE EST UNE ÉCRITURE — même par le client anonyme caché dans lib/auth-signup.ts (angle mort
  // jusqu'au 28/09/2026 : les deux routes d'inscription publiques n'étaient pas comptées).
  if (/\bsignUpWithConfirmation\(/.test(s)) ecr.push('auth.signUp')
  if (!ecr.length) continue
  // LA TRACE D'UNE CRÉATION DE COMPTE PROUVÉE (§D.27) : la route signe la preuve et la passe dans les
  // métadonnées ; handle_new_user écrit compte_cree (et la ligne sœur) sous la pièce signée, dans la
  // transaction du compte. Une MENTION ne suffit pas : l'appel au signataire ET les champs signés transmis.
  const traceParLeTrigger = ecrSql.has('handle_new_user')
    && /\bsignerPreuveInscription\(/.test(s) && /\{ \.\.\.meta, \.\.\.signees \}/.test(s)
  const trace = journalise(s, tracantes) || traceParLeTrigger
  const methodes = [...s.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g)].map((m) => m[1]).join(',')
  out.push({ f, route: f.replace('app/api/', '').replace('/route.ts', ''), methodes, ecr: [...new Set(ecr)], trace })
}

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const sans = out.filter((o) => !o.trace)
const nonExclues = sans.filter((o) => !(o.route in EXCLUSIONS))
ok(nonExclues.length === 0,
  `A. toute route qui écrit laisse une ligne au grand livre, hors exclusions écrites (${out.length} routes qui écrivent, ${out.length - sans.length} tracées)`,
  nonExclues.map((o) => `${o.route} [${o.methodes}] ← ${o.ecr.join(', ')} — branche un écrivain, ou écris l’exclusion et sa raison`).join('\n       → '))
const perimees = Object.keys(EXCLUSIONS).filter((r) => !sans.some((o) => o.route === r))
ok(perimees.length === 0,
  `B. aucune exclusion périmée (${Object.keys(EXCLUSIONS).length} exclusions)`,
  perimees.map((r) => `${r} — elle trace désormais, n’écrit plus ou n’existe plus : retire-la`).join('\n       → '))
const sansRaison = Object.entries(EXCLUSIONS).filter(([, r]) => !/^LÉGITIME — .{20,}/.test(r)).map(([k]) => k)
ok(sansRaison.length === 0, 'C. chaque exclusion porte sa raison (LÉGITIME — …)', sansRaison.join(', '))

console.log(`\n  ·    écrivains SQL du grand livre : ${ecrSql.size} · fonctions TS traçantes : ${tracantes.size}`)
for (const o of sans) console.log(`  ·    exclue : ${o.route} [${o.methodes}] ← ${o.ecr.join(', ')}`)
if (failures > 0) {
  console.log(`\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — une route change un état sans ligne au grand livre`)
  process.exit(1)
}
console.log(`\n✅ ${out.length} routes qui écrivent : ${out.length - sans.length} laissent une ligne, ${sans.length} exclues nommément, chacune avec sa raison.`)
