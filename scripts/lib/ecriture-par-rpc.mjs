// scripts/lib/ecriture-par-rpc.mjs — UNE ROUTE QUI ÉCRIT PAR UNE RPC : LA PREUVE
// PASSE PAR LE SQL, PARTAGÉE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE MODULE EXISTE
//
//   Plusieurs contrôles gardaient « le réglage X est ÉCRIT depuis le
//   back-office » en cherchant `.from('table').update(` dans la route. Le
//   grand livre (§D.26) a déplacé ces écritures dans des RPC métier — la ligne
//   de réglage et la ligne de journal dans la même transaction — et les trois
//   contrôles ont rougi d'un coup : ils gardaient une FORME, pas la propriété
//   (§E.34, §E.65 : déplacer un traitement déplace les gardes qui en dépendent).
//
//   La propriété est : « la route appelle une fonction SQL dont la DERNIÈRE
//   définition écrit cette table ». Elle se vérifie ici, une fois, depuis les
//   migrations — jamais depuis une liste de noms de RPC tenue à la main (§E.61).
//   Un écrivain qui redescendrait dans la route (`.from().update`) n'est PAS
//   couvert par ce module : c'est aux contrôles de dire lequel des deux ils
//   acceptent — et depuis §D.26, seule la RPC l'est.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const sansCommentairesSql = (s) =>
  s.split('\r\n').join('\n').split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

/**
 * Toutes les fonctions SQL du dépôt dans leur DERNIÈRE définition : nom →
 * texte de la création (signature et corps). La dernière migration qui
 * redéfinit une fonction est celle qui vit en base.
 */
export function definitionsSql(root) {
  const dir = join(root, 'supabase/migrations')
  const defs = new Map()
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = sansCommentairesSql(readFileSync(join(dir, f), 'utf8'))
    for (const m of sql.matchAll(/create or replace function public\.(\w+)\(/g)) {
      const fin = /\$[a-z]*\$;/g
      fin.lastIndex = m.index
      const f2 = fin.exec(sql)
      defs.set(m[1], sql.slice(m.index, f2 ? f2.index + f2[0].length : undefined))
    }
  }
  return defs
}

/**
 * Les RPC que `source` appelle (`.rpc('x'`) et dont la dernière définition
 * ÉCRIT `table` (`update` / `insert into` / `delete from public.table`).
 * Vide = la route n'écrit pas cette table par une RPC.
 */
export function rpcQuiEcrivent(source, table, defs) {
  const appelees = [...source.matchAll(/\.rpc\('(\w+)'/g)].map((m) => m[1])
  const ecrit = new RegExp(`(update|insert into|delete from)\\s+public\\.${table}\\b`)
  return [...new Set(appelees)].filter((fn) => ecrit.test(defs.get(fn) ?? ''))
}

/** L'index, dans `source`, du premier appel à l'une de ces RPC — pour un contrôle d'ORDRE. */
export function indexDuPremierAppel(source, fns) {
  const idx = fns.map((fn) => source.indexOf(`.rpc('${fn}'`)).filter((i) => i >= 0)
  return idx.length ? Math.min(...idx) : -1
}
