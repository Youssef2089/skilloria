#!/usr/bin/env node
// scripts/diag-portes-laterales.mjs — AUCUN CLIENT N'ÉCRIT DIRECTEMENT DANS UNE
// TABLE DONT L'ÉCRITURE EST UNE ACTION DU GRAND LIVRE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE (point 2.8, 26/09/2026)
//   Une action du grand livre s'écrit par une route ou une RPC qui journalise
//   (§D.26). Une politique RLS qui laisse un rôle CLIENT écrire la même table
//   est une SECONDE PORTE : le geste a lieu, sans pièce ni ligne. L'audit en a
//   trouvé TREIZE en état final ; douze sont fermées par la migration
//   `portes_laterales_fermees`, la treizième est une exception ÉCRITE.
//
// PÉRIMÈTRE, ÉCRIT AVANT LE BALAYAGE
//   · les politiques en ÉTAT FINAL : chaque `create policy` et `drop policy` de
//     TOUTES les migrations, rejoués dans l'ordre (baseline comprise) ; sans
//     `for`, une politique vaut pour ALL ; sans `to`, pour public ;
//   · les tables dont l'écriture est une action — DÉRIVÉES, jamais listées : celles
//     qu'insèrent, modifient ou suppriment les écrivains SQL du grand livre
//     (point fixe depuis `journaliser`, dernière définition de chaque fonction) ;
//   · une PORTE = une politique ALL/INSERT/UPDATE/DELETE pour anon, authenticated
//     ou public, sur l'une de ces tables ;
//   · côté code : toute écriture (insert/update/upsert/delete) du client
//     navigateur (`@/lib/supabase`) sur l'une de ces tables, dans app/, components/, lib/.
//
// CE QU'IL NE GARDE PAS, ET LE DIT
//   · l'état RÉEL de la base : une politique posée à la main sur staging lui
//     échappe — la postcondition de la migration relit `pg_policies`, elle ;
//   · une écriture par un client construit autrement que `@/lib/supabase`.
//
//   node scripts/diag-portes-laterales.mjs   → statique, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansComSql = (s) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
const sansComTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}

/**
 * LES EXCEPTIONS — une gelée par entrée, chacune avec sa raison (§G.8). La liste ne
 * peut que se vider : une exception qui ne correspond plus à une porte ROUGIT.
 */
//  (vide depuis le 28/09/2026 : `profiles_self_update`, dernier DÉFAUT NOMMÉ, est fermée — les
//  bascules passent par POST /api/profile/disponibilite, T.4. La machinerie reste : une porte
//  rouverte un jour s'y écrira avec sa raison, ou rougira.)
const EXCEPTIONS = new Map([
])

const MIG = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
const SQLS = MIG.map((f) => [f, sansComSql(read(`supabase/migrations/${f}`))])
const norm = (s) => s.replace(/"/g, '').replace(/^public\./, '').trim()

// ── Politiques en état final ──
const politiques = new Map()
for (const [f, s] of SQLS) {
  const evts = []
  for (const m of s.matchAll(/create policy\s+("[^"]+"|\S+)\s+on\s+([\w."]+)([\s\S]*?);/gi)) {
    const corps = m[3]
    const cmd = (/\bfor\s+(all|select|insert|update|delete)\b/i.exec(corps)?.[1] ?? 'all').toLowerCase()
    const roles = (/\bto\s+([\w",\s]+?)(?:\s+using\b|\s+with\b|$)/i.exec(corps)?.[1] ?? 'public').split(',').map((r) => r.replace(/"/g, '').trim().toLowerCase())
    evts.push({ i: m.index, k: 'c', table: norm(m[2]), nom: norm(m[1]), cmd, roles, f })
  }
  for (const m of s.matchAll(/drop policy\s+(?:if exists\s+)?("[^"]+"|\S+)\s+on\s+([\w."]+)/gi)) evts.push({ i: m.index, k: 'd', table: norm(m[2]), nom: norm(m[1]) })
  for (const e of evts.sort((a, b) => a.i - b.i)) {
    const k = `${e.table}::${e.nom}`
    if (e.k === 'c') politiques.set(k, e)
    else politiques.delete(k)
  }
}

// ── Tables dont l'écriture est une action (dérivées) ──
const defs = new Map()
for (const [, s] of SQLS) {
  for (const m of s.matchAll(/create or replace function public\.(\w+)\(/g)) {
    const i = s.indexOf('$fn$', m.index)
    const j = i < 0 ? -1 : s.indexOf('$fn$;', i + 4)
    if (j > 0) defs.set(m[1], s.slice(m.index, j))
  }
}
const ecrivains = new Set(['journaliser'])
for (let b = true; b; ) {
  b = false
  for (const [n, c] of defs) if (!ecrivains.has(n) && [...ecrivains].some((e) => new RegExp('\\b' + e + '\\(').test(c))) { ecrivains.add(n); b = true }
}
const tables = new Set()
for (const n of ecrivains) for (const m of (defs.get(n) ?? '').matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+public\.(\w+)/gi)) tables.add(m[1])
tables.delete('grand_livre')

console.log(`\n═══ Les portes latérales du grand livre ═══\n`)
ok(tables.size >= 10 && ['organization_invitations', 'publications', 'candidatures', 'messages', 'profiles', 'users'].every((t) => tables.has(t)),
  `${tables.size} tables dont l’écriture est une action, DÉRIVÉES de ${ecrivains.size} écrivains SQL (témoins présents)`)

// ── L'ÉTAT RÉEL, que ce contrôle ne voit pas, se lit dans la requête de staging (ligne « politiques
//    d'écriture client ») : sa liste de tables est tenue à la main, et elle avait PERDU trois tables
//    dérivées (grand_livre_conservation, matches, stripe_events — mesuré le 28/09/2026, §E.61). Elle
//    doit couvrir chaque table dérivée ; une table de plus n'y coûte rien.
{
  const req = read('supabase/verifications/staging-avant-push.sql').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
  const bloc = /'invariant : politiques d''écriture client[\s\S]*?tablename\s+in\s*\(([^)]*)\)/.exec(req)?.[1] ?? ''
  const listees = new Set([...bloc.matchAll(/'(\w+)'/g)].map((m) => m[1]))
  const manquantes = [...tables].filter((t) => !listees.has(t)).sort()
  ok(bloc !== '' && manquantes.length === 0,
    `la requête de staging couvre chaque table journalisée dérivée (${listees.size} listées, ${tables.size} dérivées)`,
    manquantes.length ? `manquantes : ${manquantes.join(', ')}` : 'ligne « invariant : politiques d’écriture client » introuvable')
}

const CLIENTS = new Set(['anon', 'authenticated', 'public'])
// Les portes OUVERTES UN JOUR : toute politique d'écriture cliente créée dans l'histoire des
// migrations sur une table journalisée. Le contrôle dit combien sont fermées, pas seulement « zéro ».
const ouvertesUnJour = new Set()
for (const [, s] of SQLS) {
  for (const m of s.matchAll(/create policy\s+("[^"]+"|\S+)\s+on\s+([\w."]+)([\s\S]*?);/gi)) {
    const cmd = (/\bfor\s+(all|select|insert|update|delete)\b/i.exec(m[3])?.[1] ?? 'all').toLowerCase()
    const roles = (/\bto\s+([\w",\s]+?)(?:\s+using\b|\s+with\b|$)/i.exec(m[3])?.[1] ?? 'public').split(',').map((r) => r.replace(/"/g, '').trim().toLowerCase())
    if (tables.has(norm(m[2])) && cmd !== 'select' && roles.some((r) => CLIENTS.has(r))) ouvertesUnJour.add(`${norm(m[2])}::${norm(m[1])}`)
  }
}
const portes = [...politiques.entries()].filter(([, p]) => tables.has(p.table) && ['all', 'insert', 'update', 'delete'].includes(p.cmd) && p.roles.some((r) => CLIENTS.has(r)))
const ouvertes = portes.filter(([k]) => !EXCEPTIONS.has(k))
ok(ouvertes.length === 0,
  `aucune politique ne laisse un client ÉCRIRE une table journalisée (${portes.length} porte(s), ${EXCEPTIONS.size} exception(s) écrite(s))`,
  ouvertes.map(([k, p]) => `${k} (${p.cmd} → ${p.roles.join(',')}) ← ${p.f}`).join('\n         ') || undefined)
const fermees = [...ouvertesUnJour].filter((k) => !politiques.has(k))
ok(ouvertesUnJour.size >= 13 && fermees.length === ouvertesUnJour.size,
  `${fermees.length} sur ${ouvertesUnJour.size} portes ouvertes un jour sont fermées en état final`,
  [...ouvertesUnJour].filter((k) => politiques.has(k)).join(', ') || undefined)
const perimees = [...EXCEPTIONS.keys()].filter((k) => !portes.some(([kk]) => kk === k))
ok(perimees.length === 0, 'chaque exception correspond encore à une porte réelle — la liste ne peut que se vider', perimees.join(', ') || undefined)
ok([...EXCEPTIONS.values()].every((r) => /^(LÉGITIME|DÉFAUT NOMMÉ) — /.test(r)),
  `chaque exception dit LÉGITIME ou DÉFAUT NOMMÉ (${[...EXCEPTIONS.values()].filter((r) => r.startsWith('DÉFAUT')).length} défaut(s) nommé(s))`)

// ── Côté code : le client navigateur n'écrit que là où une exception l'autorise ──
const tablesExceptees = new Set([...EXCEPTIONS.keys()].map((k) => k.split('::')[0]))
const fichiers = (d, o = []) => { for (const e of readdirSync(join(ROOT, d))) { if (e === 'node_modules' || e.startsWith('.')) continue; const p = `${d}/${e}`; if (statSync(join(ROOT, p)).isDirectory()) fichiers(p, o); else if (/\.tsx?$/.test(e)) o.push(p) } return o }
const ecrituresClient = []
for (const f of [...fichiers('app'), ...fichiers('components'), ...fichiers('lib')]) {
  const src = sansComTs(read(f))
  if (!/from ['"]@\/lib\/supabase['"]/.test(src)) continue
  for (const m of src.matchAll(/\.from\('(\w+)'\)([\s\S]{0,400})/g)) {
    if (!tables.has(m[1])) continue
    const w = /^[^;]*?\.(insert|update|upsert|delete)\(/.exec(m[2])
    if (w && !/\.from\(/.test(m[2].slice(0, w.index))) ecrituresClient.push({ f, table: m[1], op: w[1] })
  }
}
const horsException = ecrituresClient.filter((e) => !tablesExceptees.has(e.table))
ok(horsException.length === 0,
  `le client navigateur n’écrit une table journalisée QUE sous une exception écrite (${ecrituresClient.length} écriture(s) client, toutes sur ${[...tablesExceptees].join(', ') || '—'})`,
  horsException.map((e) => `${e.f} : ${e.table}.${e.op}`).join('\n         ') || undefined)

console.log(failures === 0 ? '\n✅ Aucune porte latérale ouverte hors exception écrite.' : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — une porte latérale est ouverte`)
process.exit(failures === 0 ? 0 : 1)
