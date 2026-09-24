#!/usr/bin/env node
// scripts/diag-tables-mortes.mjs — LES TABLES MORTES SONT PARTIES, ET RIEN NE
// LES CITE ; LA VIVANTE QU'ON CROYAIT MORTE EST ÉCRITE EN SQL.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE CAS, MESURÉ LE 24/09/2026 (étapes 0.5 puis « règle 0 » du lot journal)
//   Une revue avait déclaré `rate_limit_hits` morte : aucune ligne de `app/`
//   ni de `lib/` ne la cite. FAUX. Elle est écrite par la fonction SQL
//   `rate_limit_check()` (migration `rate_limiter`), purgée par une tâche
//   pg_cron, lue par la supervision — et c'est sur elle que repose le plafond
//   anti-abus de relance (§D.7). Un balayage qui s'arrête à `app/` et `lib/`
//   ne voit pas un écrivain SQL (§E.61) : le périmètre d'un verdict de mort
//   inclut les fonctions, les vues, les tâches et les politiques.
//
//   Les deux autres — `user_section_visits`, `subscription_history` — n'avaient
//   aucun écrivain ni lecteur nulle part. Règle de l'architecte : elles
//   PARTENT. Migration `tables_mortes_supprimees`, dont la précondition
//   EXÉCUTE la preuve (pg_proc.prosrc, pg_constraint, pg_rewrite, pg_trigger)
//   et dont la postcondition vérifie l'absence (to_regclass) — les types
//   générés sont nettoyés dans le même commit.
//
// CE QUE CE CONTRÔLE GARDE
//   Un ÉTAT MESURÉ (§G.8) — revérifié à chaque passage :
//   · `rate_limit_hits` : VIVANTE — au moins un écrivain SQL, et lue ;
//   · les deux supprimées : une migration les supprime APRÈS leur création,
//     la précondition et la postcondition exécutent les preuves attendues, et
//     PLUS RIEN ne les cite — code (app/, lib/, components/, scripts/), types
//     générés (`lib/database.types.ts`), et SQL hors la DDL de la baseline et
//     le `drop` lui-même. Une citation qui réapparaît (un `select` sur une
//     table qui n'existe plus casse au runtime, en silence — §E.1) rougit en
//     nommant le fichier.
//
// CE QU'IL NE VÉRIFIE PAS
//   · l'état réel de la base — ce contrôle lit le dépôt ; c'est la migration,
//     en s'exécutant, qui prouve l'absence en base ;
//   · les tables mortes qu'on n'a pas encore jugées : dix vestiges de la
//     baseline restent (§B.1 architecture), et ce contrôle ne porte que sur
//     les trois qui ont été instruites.
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

/** L'ÉTAT MESURÉ — revérifié à chaque passage, jamais tenu pour acquis. */
const INVENTAIRE = [
  { table: 'rate_limit_hits',      verdict: 'vivante',   raison: 'écrite par la fonction SQL rate_limit_check(), purgée par pg_cron, lue par la supervision' },
  { table: 'user_section_visits',  verdict: 'supprimee', raison: 'vestige de la baseline, jamais lue ni écrite — supprimée par tables_mortes_supprimees (5 lignes emportées, mesurées le 24/09/2026)' },
  { table: 'subscription_history', verdict: 'supprimee', raison: 'vestige de la baseline, jamais lue ni écrite — supprimée par tables_mortes_supprimees' },
]

/** Résolution d'une migration par suffixe descriptif — jamais par numéro (§G.3). */
function migration(suffixe) {
  const hits = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith(`_${suffixe}.sql`))
  if (hits.length !== 1) throw new Error(`migration « ${suffixe} » : ${hits.length} correspondance(s)`)
  return `supabase/migrations/${hits[0]}`
}
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

/** Les fichiers de code — TYPES GÉNÉRÉS COMPRIS — qui citent la table, hors ce contrôle. */
function citationsCode(table) {
  const out = []
  for (const f of [...fichiers('app'), ...fichiers('lib'), ...fichiers('components'), ...fichiers('scripts')]) {
    if (f === 'scripts/diag-tables-mortes.mjs') continue
    if (new RegExp(`\\b${table}\\b`).test(sansCommentairesTs(read(f)))) out.push(f)
  }
  return out
}

/**
 * Dans les migrations : les lignes qui ÉCRIVENT ou LISENT la table, hors la
 * DDL de la table elle-même (create/alter/index/policy/grant/comment/drop) —
 * et hors la migration qui la supprime, dont la précondition la cite pour
 * prouver que rien d'autre ne le fait.
 */
function usagesSql(table, exclure = null) {
  const ecrivains = []
  const lecteurs = []
  const T = `(?:public\\.)?"?${table}"?`
  const ECRIT = new RegExp(`\\b(insert\\s+into\\s+${T}|update\\s+${T}\\b|delete\\s+from\\s+${T})`, 'i')
  const LIT = new RegExp(`\\b(from\\s+${T}\\b|join\\s+${T}\\b)`, 'i')
  const DDL = new RegExp(`\\b(create\\s+table|alter\\s+table|create\\s+(?:unique\\s+)?index|create\\s+policy|grant\\s+|revoke\\s+|comment\\s+on|drop\\s+table|drop\\s+policy|references\\s+${T})`, 'i')
  for (const f of readdirSync(join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql'))) {
    if (exclure && `supabase/migrations/${f}` === exclure) continue
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

const DROP = migration('tables_mortes_supprimees')
const dropSql = sansCommentairesSql(read(DROP))

// ═══ A. LA VIVANTE — écrite en SQL, et lue ═════════════════════════════════
section('A. rate_limit_hits est VIVANTE — un écrivain SQL, que le code ne voit pas')
{
  const { ecrivains, lecteurs } = usagesSql('rate_limit_hits')
  ok(ecrivains.some((e) => /insert\s+into\s+public\.rate_limit_hits/i.test(e)),
    'rate_limit_hits : écrite par une fonction SQL (rate_limit_check) — c’est l’écrivain que la revue avait manqué',
    `vu : ${ecrivains.join(' | ') || 'aucun écrivain'}`)
  ok(lecteurs.length > 0, `rate_limit_hits : lue (${lecteurs.length} lecture(s) SQL)`)
  ok(citationsCode('rate_limit_hits').length === 0 && /\.rpc\('rate_limit_check'/.test(sansCommentairesTs(read('lib/rate-limit.ts'))),
    'aucun fichier de code ne cite la table — le code appelle rate_limit_check(), et c’est le SQL qui écrit',
    'si le code se met à citer la table, ce n’est pas faux : c’est la raison du piège qui a changé, à relire')
  ok(!new RegExp('drop\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?rate_limit_hits\\b', 'i').test(dropSql),
    'et la migration de suppression ne la touche pas')
}

// ═══ B. LES DEUX SUPPRIMÉES — la migration prouve, puis supprime ═══════════
section('B. user_section_visits et subscription_history sont SUPPRIMÉES, preuve exécutée')
{
  for (const { table } of INVENTAIRE.filter((i) => i.verdict === 'supprimee')) {
    ok(new RegExp(`drop\\s+table\\s+if\\s+exists\\s+public\\.${table};`).test(dropSql),
      `${table} : supprimée par ${DROP.split('/').pop()}`)
  }
  const iPre = dropSql.indexOf('do $pre$')
  const iDrop = dropSql.search(/drop\s+table\s+if\s+exists\s+public\.user_section_visits/i)
  const iPost = dropSql.indexOf('do $post$')
  ok(iPre >= 0 && iDrop > iPre && iPost > iDrop, 'l’ordre est précondition → suppression → postcondition')
  const pre = iPre >= 0 ? dropSql.slice(iPre, iDrop) : ''
  ok(/p\.prosrc\s+ilike\s+'%'\s*\|\|\s*v_t\s*\|\|\s*'%'/.test(pre) && /raise exception 'precondition NON TENUE : des fonctions citent/.test(pre),
    'précondition : le corps de TOUTE fonction est lu (pg_proc.prosrc), et une citation REFUSE la suppression',
    'c’est la preuve que le balayage du code ne peut pas donner (§E.61)')
  ok(/c\.confrelid = v_oid/.test(pre) && /pg_rewrite/.test(pre) && /pg_trigger/.test(pre),
    'précondition : clés étrangères entrantes, vues et triggers sont cherchés, et refusent')
  ok(/select count\(\*\) from public\.%I/.test(pre) && /raise notice/.test(pre),
    'précondition : les lignes emportées sont COMPTÉES et annoncées (5 sur user_section_visits, mesurées) — pas bloquant')
  const post = iPost >= 0 ? dropSql.slice(iPost) : ''
  ok(/to_regclass\('public\.' \|\| v_t\) is not null/.test(post) && /raise exception 'postcondition NON TENUE : public\.% existe encore'/.test(post),
    'postcondition : l’absence est VÉRIFIÉE (to_regclass), pas déduite du succès du drop')
  ok(/p\.prosrc\s+ilike/.test(post), 'postcondition : les fonctions sont RELUES après la suppression')
}

// ═══ C. PLUS RIEN NE LES CITE — code, types générés, SQL ═══════════════════
section('C. Plus rien ne cite les deux tables supprimées')
for (const { table, raison } of INVENTAIRE.filter((i) => i.verdict === 'supprimee')) {
  const code = citationsCode(table)
  const { ecrivains, lecteurs } = usagesSql(table, DROP)
  ok(code.length === 0, `${table} : aucun fichier de code ni de types ne la cite — ${raison}`,
    code.length ? `citée par : ${code.slice(0, 6).join(', ')} — un select sur une table absente casse au runtime, en silence (§E.1)` : undefined)
  ok(ecrivains.length === 0 && lecteurs.length === 0,
    `${table} : aucune fonction, vue ou tâche SQL ne l’écrit ni ne la lit (hors sa DDL et sa suppression)`,
    [...ecrivains, ...lecteurs].slice(0, 4).join(' | ') || undefined)
  const baseline = read('supabase/migrations/00000000000000_baseline.sql')
  ok(new RegExp(`create table if not exists "public"\\."${table}"`, 'i').test(baseline),
    `${table} : créée par la baseline — la suppression porte sur une table réelle`)
}

console.log()
if (failures) {
  console.log(`✘ ${failures} CONTRÔLE(S) EN ÉCHEC — un verdict de mort ou de vie ne correspond plus à ce qu’on mesure`)
  process.exit(1)
}
console.log('✅ la vivante est écrite en SQL ; les deux mortes sont supprimées, preuve exécutée, et plus rien ne les cite')
