#!/usr/bin/env node
// scripts/mesure-routes-sans-trace.mjs — LA MESURE, PAS UN CONTRÔLE : quelles routes changent un
// état sans laisser de ligne au grand livre (§D.26, §H.3). Lecture du dépôt seule, aucun accès base.
//
// PÉRIMÈTRE (écrit avant le balayage) : chaque app/api/**/route.ts ; « écrit » = from().insert|update|
// upsert|delete, storage upload|remove, auth.admin.*, ou .rpc() vers une fonction SQL dont la DERNIÈRE
// définition insère, modifie ou supprime ; « trace » = le fichier appelle un écrivain du grand livre,
// SQL (point fixe depuis journaliser) ou TypeScript (point fixe sur les fonctions de lib/).
// Elle ne devient un contrôle qu'après l'arbitrage des gestes SANS action dans la liste fermée.
//   node scripts/mesure-routes-sans-trace.mjs

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
  const decl = [...s.matchAll(/(?:export )?(?:async )?function (\w+)\(|export class (\w+)/g)]
  decl.forEach((m, k) => fonctions.push({ f, nom: m[1] ?? m[2], corps: s.slice(m.index, k + 1 < decl.length ? decl[k + 1].index : undefined) }))
}
const journalise = (corps, conn) => /\bjournaliserDans\(|\bjournaliser\(|\bjournaliserReglage\(/.test(corps)
  || [...corps.matchAll(/\.rpc\('(\w+)'/g)].some((m) => ecrSql.has(m[1]))
  || [...conn].some((n) => new RegExp('\\b' + n + '\\b').test(corps))
const tracantes = new Set()
for (let b = true; b;) { b = false; for (const fn of fonctions) if (!tracantes.has(fn.nom) && journalise(fn.corps, tracantes)) { tracantes.add(fn.nom); b = true } }

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
  // Fonctions de lib/ appelées qui écrivent sans journaliser : repérées par nom.
  if (!ecr.length) continue
  const trace = journalise(s, tracantes)
  const methodes = [...s.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g)].map((m) => m[1]).join(',')
  out.push({ f, methodes, ecr: [...new Set(ecr)], trace })
}
const sans = out.filter((o) => !o.trace)
console.log(`écrivains SQL du grand livre : ${ecrSql.size} · fonctions TS traçantes : ${tracantes.size}`)
console.log(`routes qui écrivent : ${out.length} · avec trace : ${out.length - sans.length} · SANS trace : ${sans.length}\n`)
for (const o of sans) console.log(`${o.f.replace('app/api/', '').replace('/route.ts', '')} [${o.methodes}] ← ${o.ecr.join(', ')}`)
