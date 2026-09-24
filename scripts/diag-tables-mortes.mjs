#!/usr/bin/env node
// scripts/diag-tables-mortes.mjs — LE VERDICT SUR LES TROIS TABLES DITES
// « MORTES », TENU À JOUR PAR UN BALAYAGE QUI INCLUT LE SQL.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE CAS, MESURÉ LE 24/09/2026 (étape 0.5 du lot journal)
//   Une revue avait déclaré `rate_limit_hits` morte : aucune ligne de `app/`
//   ni de `lib/` ne la cite. FAUX. Elle est écrite par la fonction SQL
//   `rate_limit_check()` (migration `rate_limiter`), purgée par une tâche
//   pg_cron, lue par la supervision — et c'est sur elle que repose le plafond
//   anti-abus de relance (§D.7). Un balayage qui s'arrête à `app/` et `lib/`
//   ne voit pas un écrivain SQL (§E.61) : le périmètre d'un verdict de mort
//   inclut les fonctions, les vues, les tâches et les politiques.
//
//   Les deux autres — `user_section_visits`, `subscription_history` — n'ont
//   aucun écrivain ni lecteur nulle part, hors la DDL de la baseline et les
//   types générés. Elles sont mortes. RIEN N'EST SUPPRIMÉ : la suppression est
//   un lot à part, avec sa migration et son contrôle.
//
// CE QUE CE CONTRÔLE GARDE
//   Un ÉTAT MESURÉ (§G.8 — pas des exemptions : chaque ligne est revérifiée à
//   chaque passage) : pour chaque table, ses ÉCRIVAINS (insert/update/delete/
//   upsert) et ses LECTEURS, dans le code (app/, lib/, components/, scripts/)
//   ET dans les migrations (fonctions, vues, tâches — tout ce qui n'est pas la
//   DDL de la table elle-même). Le verdict inscrit doit être celui qu'on
//   mesure : une table « morte » qui gagne un écrivain, ou une table
//   « vivante » qui perd le sien, fait rougir — et dit lequel.
//
// CE QU'IL NE VÉRIFIE PAS
//   · les écritures directes depuis un navigateur : `user_section_visits`
//     porte encore des politiques RLS d'écriture pour `authenticated`, donc un
//     client muni de la clé anon POURRAIT y écrire. Aucun code ne le fait ;
//     c'est une porte ouverte sur une pièce vide, et elle est DITE (§H).
//   · l'état réel de la base (lignes présentes) — ce contrôle lit le dépôt.
//
//   node scripts/diag-tables-mortes.mjs   → statique, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/** L'ÉTAT MESURÉ le 24/09/2026 — revérifié à chaque passage, jamais tenu pour acquis. */
const INVENTAIRE = [
  { table: 'rate_limit_hits',     verdict: 'vivante', raison: 'écrite par la fonction SQL rate_limit_check(), purgée par pg_cron, lue par la supervision' },
  { table: 'user_section_visits', verdict: 'morte',   raison: 'DDL, politiques RLS et grants de la baseline seulement — aucun écrivain, aucun lecteur' },
  { table: 'subscription_history', verdict: 'morte',  raison: 'DDL et politique RLS de la baseline, types générés seulement — aucun écrivain, aucun lecteur' },
]

function fichiers(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir))) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const rel = `${dir}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) fichiers(rel, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(rel)
  }
  return out
}
const sansCommentairesTs = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
const sansCommentairesSql = (src) =>
  src.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

/** Les fichiers de code qui citent la table — hors ce contrôle et les types générés. */
function citationsCode(table) {
  const out = []
  for (const f of [...fichiers('app'), ...fichiers('lib'), ...fichiers('components'), ...fichiers('scripts')]) {
    if (f === 'scripts/diag-tables-mortes.mjs' || f === 'lib/database.types.ts') continue
    const src = sansCommentairesTs(read(f))
    if (new RegExp(`\\b${table}\\b`).test(src)) out.push(f)
  }
  return out
}

/**
 * Dans les migrations : les lignes qui ÉCRIVENT ou LISENT la table, hors la
 * DDL de la table elle-même (create/alter/index/policy/grant/comment/drop).
 * Une fonction, une vue ou une tâche qui insère ou lit compte ; une
 * contrainte ou une politique ne compte pas — elle ne fait vivre personne.
 */
function usagesSql(table) {
  const ecrivains = []
  const lecteurs = []
  const T = `(?:public\\.)?"?${table}"?`
  const ECRIT = new RegExp(`\\b(insert\\s+into\\s+${T}|update\\s+${T}\\b|delete\\s+from\\s+${T})`, 'i')
  const LIT = new RegExp(`\\b(from\\s+${T}\\b|join\\s+${T}\\b)`, 'i')
  const DDL = new RegExp(`\\b(create\\s+table|alter\\s+table|create\\s+(?:unique\\s+)?index|create\\s+policy|grant\\s+|revoke\\s+|comment\\s+on|drop\\s+table|drop\\s+policy|references\\s+${T})`, 'i')
  for (const f of readdirSync(join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql'))) {
    const src = sansCommentairesSql(read(`supabase/migrations/${f}`))
    if (!new RegExp(`\\b${table}\\b`).test(src)) continue
    for (const l of src.split('\n')) {
      if (!new RegExp(`\\b${table}\\b`).test(l) || DDL.test(l)) continue
      if (ECRIT.test(l)) ecrivains.push(`${f}: ${l.trim().slice(0, 90)}`)
      else if (LIT.test(l)) lecteurs.push(`${f}: ${l.trim().slice(0, 90)}`)
    }
  }
  return { ecrivains, lecteurs }
}

// ═══ A. LES TABLES EXISTENT ENCORE — le verdict porte sur du réel ══════════
section('A. Les trois tables existent encore dans le schéma')
{
  const baseline = read('supabase/migrations/00000000000000_baseline.sql')
  const rateLimiter = readdirSync(join(ROOT, 'supabase/migrations')).find((f) => f.endsWith('_rate_limiter.sql'))
  const creees = INVENTAIRE.map((i) => i.table).filter((t) =>
    new RegExp(`create table if not exists "?(?:public"?\\.)?"?${t}"?\\b`, 'i').test(baseline)
    || (rateLimiter && new RegExp(`create table if not exists public\\.${t}\\b`).test(read(`supabase/migrations/${rateLimiter}`))))
  ok(creees.length === INVENTAIRE.length, `les ${INVENTAIRE.length} tables sont créées par une migration (${creees.join(', ')})`)
  const droppees = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).filter((f) => {
    const src = sansCommentairesSql(read(`supabase/migrations/${f}`))
    return INVENTAIRE.some((i) => new RegExp(`drop\\s+table\\s+(?:if\\s+exists\\s+)?"?(?:public"?\\.)?"?${i.table}"?\\b`, 'i').test(src))
  })
  ok(droppees.length === 0, 'aucune migration ne les supprime — RIEN N’EST SUPPRIMÉ par ce lot',
    droppees.length ? `supprimée(s) par : ${droppees.join(', ')} — l’inventaire ci-dessus est périmé, à mettre à jour` : undefined)
}

// ═══ B. LE VERDICT INSCRIT EST LE VERDICT MESURÉ ════════════════════════════
section('B. Chaque verdict est REMESURÉ — code ET SQL')
for (const { table, verdict, raison } of INVENTAIRE) {
  const code = citationsCode(table)
  const { ecrivains, lecteurs } = usagesSql(table)
  const vivante = ecrivains.length > 0
  const mesure = vivante ? 'vivante' : (code.length === 0 && lecteurs.length === 0) ? 'morte' : 'lue sans écrivain'
  ok(mesure === verdict,
    `${table} : ${verdict} — ${raison}`,
    `mesuré « ${mesure} » : ${ecrivains.length} écrivain(s) SQL, ${lecteurs.length} lecteur(s) SQL, ${code.length} fichier(s) de code`
      + (ecrivains.length ? `\n         écrit par : ${ecrivains.slice(0, 3).join(' | ')}` : '')
      + (code.length ? `\n         cité par : ${code.slice(0, 5).join(', ')}` : ''))
  if (verdict === 'vivante') {
    ok(code.length > 0 || lecteurs.length > 0, `${table} : et elle est LUE (${lecteurs.length} lecture(s) SQL, ${code.length} fichier(s))`)
  }
}

// ═══ C. TÉMOINS — le balayage voit un écrivain SQL ═════════════════════════
section('C. Témoins')
{
  const { ecrivains } = usagesSql('rate_limit_hits')
  ok(ecrivains.some((e) => /insert\s+into\s+public\.rate_limit_hits/i.test(e)),
    'témoin : l’insert de rate_limit_check() est vu comme un ÉCRIVAIN — c’est lui que la revue avait manqué')
  // Le code ne cite JAMAIS la table : il appelle la fonction SQL. C'est
  // exactement pourquoi un balayage de `app/` et `lib/` la déclarait morte.
  ok(citationsCode('rate_limit_hits').length === 0 && /\.rpc\('rate_limit_check'/.test(sansCommentairesTs(read('lib/rate-limit.ts'))),
    'témoin : aucun fichier de code ne cite la table — le code appelle rate_limit_check(), et c’est le SQL qui écrit',
    'si le code se met à citer la table, ce n’est pas faux : c’est la raison du piège qui a changé, à relire')
}

console.log()
if (failures) {
  console.log(`✘ ${failures} CONTRÔLE(S) EN ÉCHEC — un verdict de mort ou de vie ne correspond plus à ce qu’on mesure`)
  process.exit(1)
}
console.log('✅ les trois verdicts tiennent : une vivante (écrite en SQL), deux mortes — et rien n’est supprimé')
