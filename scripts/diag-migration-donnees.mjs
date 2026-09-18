// scripts/diag-migration-donnees.mjs — UNE MIGRATION DE DONNEES S'EPROUVE
//                                       AVANT LE JOUR OU ELLE SERT.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE DEFAUT QU'ON FERME, ET IL A DEJA MORDU
//
//   La migration de parametrage de production a ete livree SANS AVOIR JAMAIS
//   ETE JOUEE. Elle a echoue au deuxieme statement :
//
//     ERROR: column "tags" is of type text[] but expression is of type jsonb
//
//   Les valeurs avaient ete extraites de la base via PostgREST — qui rend du
//   JSON — puis serialisees en `::jsonb` sans jamais confronter chaque valeur
//   au TYPE REEL de sa colonne. `domain_configs.tags` est un `text[]`.
//
//   CE DEFAUT EST STRUCTUREL, PAS UNE ETOURDERIE :
//     · `npx tsc` ne voit rien — c'est du SQL dans un fichier .sql ;
//     · `next build` ne voit rien, pour la meme raison ;
//     · `diag-sql-litteraux` ne voit rien : il valide la LEXIQUE des chaines,
//       pas la GRAMMAIRE ni les types ;
//     · et surtout, ce fichier n'a QU'UN SEUL USAGE — une base NEUVE. Personne
//       ne l'exerce au quotidien. Le premier a le decouvrir serait celui qui
//       met en production.
//
//   C'est la meme famille que « les clients Supabase ne sont pas types » : une
//   erreur qui ne peut etre attrapee par aucun outil de compilation, et qui
//   n'apparait qu'a l'execution, chez quelqu'un d'autre, au pire moment.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMMENT ON L'EPROUVE SANS TOUCHER A LA BASE
//
//   On RECONSTRUIT le schema depuis les migrations elles-memes, dans l'ordre,
//   puis on confronte chaque valeur ecrite au type de sa colonne.
//
//   Pourquoi les migrations et non la base distante : sur une base NEUVE — le
//   seul cas ou ce fichier sert — le schema vient des migrations, pas de la
//   base actuelle. La bonne reference est donc celle-la. Et le controle tourne
//   partout, sans identifiants, sans reseau, depuis n'importe quel worktree.
//
//   CE QUE CE CONTROLE NE REMPLACE PAS, ET IL FAUT LE DIRE :
//     · il n'est PAS un analyseur PostgreSQL. Il couvre les familles de types
//       et les fautes qui ont reellement coute — tableaux, jsonb, booleens,
//       entiers, colonnes inexistantes, NOT NULL omises, ordre des cles
//       etrangeres. Une migration verte ici peut encore echouer pour une autre
//       raison ; elle n'echouera plus pour celles-la.
//     · la preuve ULTIME reste un rejeu reel : `supabase db reset` sur une base
//       locale, ou un `begin; … rollback;` sur un distant. Les deux exigent une
//       base ; celui-ci n'exige rien, et c'est pour ca qu'il tournera.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-migration-donnees.mjs              toutes les migrations
//   node scripts/diag-migration-donnees.mjs <fichier.sql> une en particulier
//
// AUCUN acces base, AUCUN reseau, AUCUNE variable d'environnement.
// LECTURE PURE : ce script n'ecrit JAMAIS.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES : le depot sort les fichiers en CRLF, et un retour
// chariot casse tout motif qui traverse un saut de ligne.
const read = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n')

let echecs = 0
const ok = (cond, libelle, indice) => {
  if (cond) console.log(`  ok   ${libelle}`)
  else { echecs++; console.log(`  KO   ${libelle}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

// ─────────────────────────────────────────────────────────────────────────────
// 1. RETIRER LES COMMENTAIRES SQL — SANS TOUCHER AUX CHAINES
//
//   Un `--` dans une chaine ('a--b') n'ouvre pas un commentaire, et une
//   apostrophe dans un commentaire n'ouvre pas une chaine. Un depouillement
//   naif par regex se trompe dans les deux sens. On lit donc caractere par
//   caractere, comme le ferait un analyseur lexical.
//
//   Les blocs $tag$…$tag$ (corps de fonction) sont SAUTES ENTIEREMENT : ils
//   contiennent du SQL qui n'est pas execute a ce niveau, et leurs `insert`
//   internes ne sont pas des insertions de cette migration.
// ─────────────────────────────────────────────────────────────────────────────
function depouiller(sql) {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const d = sql[i + 1]
    // Bloc $tag$ … $tag$
    const dollar = sql.slice(i).match(/^\$([A-Za-z_]*)\$/)
    if (dollar) {
      const tag = dollar[0]
      const fin = sql.indexOf(tag, i + tag.length)
      // On remplace par des espaces pour PRESERVER LES POSITIONS : les indices
      // servent ensuite a ordonner les statements les uns par rapport aux autres.
      const bloc = fin === -1 ? sql.slice(i) : sql.slice(i, fin + tag.length)
      out += ' '.repeat(bloc.length)
      i += bloc.length
      continue
    }
    // Chaine '…' (avec '' echappe)
    if (c === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue }
        if (sql[j] === "'") { j++; break }
        j++
      }
      out += sql.slice(i, j)
      i = j
      continue
    }
    // Commentaire de ligne
    if (c === '-' && d === '-') {
      let j = sql.indexOf('\n', i)
      if (j === -1) j = sql.length
      out += ' '.repeat(j - i)
      i = j
      continue
    }
    // Commentaire de bloc
    if (c === '/' && d === '*') {
      let j = sql.indexOf('*/', i + 2)
      j = j === -1 ? sql.length : j + 2
      out += ' '.repeat(j - i)
      i = j
      continue
    }
    out += c
    i++
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. LE SCHEMA, RECONSTRUIT DEPUIS LES MIGRATIONS DANS L'ORDRE
// ─────────────────────────────────────────────────────────────────────────────

/** `"text"[]` · `character varying(7)` · `"jsonb"` → famille normalisee. */
function famille(brut) {
  const t = brut.replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (/\[\]\s*$/.test(t)) return 'tableau'
  if (t.startsWith('jsonb') || t.startsWith('json')) return 'json'
  if (t.startsWith('boolean') || t === 'bool') return 'booleen'
  if (/^(integer|int|int4|int8|bigint|smallint|serial|bigserial)\b/.test(t)) return 'entier'
  if (/^(numeric|decimal|real|double)\b/.test(t)) return 'decimal'
  if (/^(timestamp|timestamptz|date|time)\b/.test(t)) return 'temps'
  if (t.startsWith('uuid')) return 'uuid'
  if (/^(text|character varying|varchar|char|citext)\b/.test(t)) return 'texte'
  return 'autre'
}

function construireSchema() {
  const fichiers = readdirSync(join(ROOT, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()

  /** table → { colonnes: Map<nom, {famille, brut, notNull, aDefaut}>, fks: [{colonne, cible}] } */
  const schema = new Map()
  const tableDe = (n) => {
    if (!schema.has(n)) schema.set(n, { colonnes: new Map(), fks: [] })
    return schema.get(n)
  }

  for (const f of fichiers) {
    const sql = depouiller(read(join(ROOT, 'supabase', 'migrations', f)))

    // ── CREATE TABLE ──────────────────────────────────────────────────────
    const reCreate = /create table (?:if not exists )?"?public"?\.?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\n\)\s*;/gi
    let m
    while ((m = reCreate.exec(sql))) {
      const t = tableDe(m[1])
      // Decoupe au premier niveau de parentheses : un `numeric(10,2)` ou un
      // CHECK(...) ne doit pas couper la definition en deux.
      const corps = m[2]
      const parties = []
      let prof = 0
      let courant = ''
      for (const ch of corps) {
        if (ch === '(') prof++
        if (ch === ')') prof--
        if (ch === ',' && prof === 0) { parties.push(courant); courant = ''; continue }
        courant += ch
      }
      parties.push(courant)

      for (const p of parties) {
        const l = p.trim()
        if (!l) continue
        if (/^(constraint|primary key|unique|check|foreign key|exclude)\b/i.test(l)) {
          const fk = l.match(/foreign key\s*\(\s*"?([a-z_0-9]+)"?\s*\)\s*references\s+"?public"?\.?"?([a-z_0-9]+)"?/i)
          if (fk) t.fks.push({ colonne: fk[1], cible: fk[2] })
          continue
        }
        const col = l.match(/^"?([a-z_0-9]+)"?\s+([\s\S]+)$/i)
        if (!col) continue
        const reste = col[2]
        const typeBrut = reste.split(/\s+(?:default|not null|null|generated|references|check|collate)\b/i)[0]
        t.colonnes.set(col[1], {
          famille: famille(typeBrut),
          brut: typeBrut.replace(/"/g, '').trim(),
          notNull: /\bnot null\b/i.test(reste),
          aDefaut: /\bdefault\b/i.test(reste),
        })
        const refInline = reste.match(/references\s+"?public"?\.?"?([a-z_0-9]+)"?/i)
        if (refInline) t.fks.push({ colonne: col[1], cible: refInline[1] })
      }
    }

    // ── ALTER TABLE ───────────────────────────────────────────────────────
    const reAlter = /alter table (?:only )?"?public"?\.?"?([a-z_0-9]+)"?([\s\S]*?);/gi
    while ((m = reAlter.exec(sql))) {
      const t = tableDe(m[1])
      const corps = m[2]
      for (const a of corps.matchAll(/add column (?:if not exists )?"?([a-z_0-9]+)"?\s+([^,;]+)/gi)) {
        const typeBrut = a[2].split(/\s+(?:default|not null|null|references|check|collate)\b/i)[0]
        if (!t.colonnes.has(a[1])) {
          t.colonnes.set(a[1], {
            famille: famille(typeBrut),
            brut: typeBrut.replace(/"/g, '').trim(),
            notNull: /\bnot null\b/i.test(a[2]),
            aDefaut: /\bdefault\b/i.test(a[2]),
          })
        }
      }
      for (const d of corps.matchAll(/drop column (?:if exists )?"?([a-z_0-9]+)"?/gi)) {
        t.colonnes.delete(d[1])
      }
      for (const r of corps.matchAll(/rename column "?([a-z_0-9]+)"? to "?([a-z_0-9]+)"?/gi)) {
        const v = t.colonnes.get(r[1])
        if (v) { t.colonnes.delete(r[1]); t.colonnes.set(r[2], v) }
      }
      const fk = corps.match(/add constraint [^\s]+ foreign key\s*\(\s*"?([a-z_0-9]+)"?\s*\)\s*references\s+"?public"?\.?"?([a-z_0-9]+)"?/i)
      if (fk) t.fks.push({ colonne: fk[1], cible: fk[2] })
    }

    // ── DROP TABLE ────────────────────────────────────────────────────────
    for (const d of sql.matchAll(/drop table (?:if exists )?"?public"?\.?"?([a-z_0-9]+)"?/gi)) {
      schema.delete(d[1])
    }
  }
  return schema
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. LIRE LES INSERTIONS D'UNE MIGRATION
// ─────────────────────────────────────────────────────────────────────────────

/** Decoupe une liste de valeurs au premier niveau : `'a,b', array[1,2], 3`. */
function decouperValeurs(s) {
  const out = []
  let prof = 0
  let courant = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "'") {
      let j = i + 1
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") { j += 2; continue }
        if (s[j] === "'") { j++; break }
        j++
      }
      courant += s.slice(i, j)
      i = j
      continue
    }
    if (c === '(' || c === '[') prof++
    if (c === ')' || c === ']') prof--
    if (c === ',' && prof === 0) { out.push(courant.trim()); courant = ''; i++; continue }
    courant += c
    i++
  }
  if (courant.trim()) out.push(courant.trim())
  return out
}

/** La famille d'un LITTERAL SQL, telle que PostgreSQL la voit. */
function familleValeur(v) {
  const t = v.trim()
  if (/^null$/i.test(t)) return 'null'
  if (/^(true|false)$/i.test(t)) return 'booleen'
  if (/::jsonb?\s*$/i.test(t)) return 'json'
  if (/::[a-z_ ]+\[\]\s*$/i.test(t) || /^array\s*\[/i.test(t)) return 'tableau'
  // '{…}' est la forme litterale d'un tableau PostgreSQL.
  if (/^'\{[\s\S]*\}'/.test(t) && !/::jsonb?/i.test(t)) return 'tableau'
  if (/^-?\d+$/.test(t)) return 'entier'
  if (/^-?\d+\.\d+$/.test(t)) return 'decimal'
  if (/^'/.test(t)) return 'texte'
  return 'inconnu'
}

/**
 * Une valeur de famille X est-elle acceptable dans une colonne de famille Y ?
 *
 * On modelise ce que PostgreSQL FAIT REELLEMENT, pas ce qu'on aimerait :
 *   · une chaine SANS cast est de type « unknown » et se coule dans presque
 *     tout — c'est pour cela que `'{a,b}'` marche dans un text[] et que
 *     `'{"a":1}'` marche dans un jsonb ;
 *   · une chaine AVEC cast a un type ferme, et un `::jsonb` dans un `text[]`
 *     est un refus dur. C'est exactement l'erreur qui a coute ce lot.
 */
function compatible(famColonne, famValeur, litteral) {
  if (famValeur === 'null') return true
  switch (famColonne) {
    case 'tableau':
      // Un ::jsonb NE SE COULE PAS dans un text[]. C'est LE defaut corrige.
      if (famValeur === 'json') return false
      return famValeur === 'tableau' || famValeur === 'texte'
    case 'json':
      if (famValeur === 'tableau' && /::[a-z_ ]+\[\]/i.test(litteral)) return false
      return famValeur === 'json' || famValeur === 'texte'
    case 'booleen':
      return famValeur === 'booleen'
    case 'entier':
      return famValeur === 'entier'
    case 'decimal':
      return famValeur === 'entier' || famValeur === 'decimal'
    case 'uuid':
    case 'temps':
      return famValeur === 'texte'
    case 'texte':
      // Un ::jsonb ou un tableau caste dans une colonne texte echoue aussi.
      if (famValeur === 'json' || famValeur === 'tableau') {
        return !/::/.test(litteral) && famValeur !== 'json'
      }
      return famValeur === 'texte'
    default:
      return true
  }
}

function lireInsertions(sql) {
  const out = []
  const re = /insert\s+into\s+"?public"?\."?([a-z_0-9]+)"?\s*\(([^)]*)\)\s*(values|select)/gi
  let m
  while ((m = re.exec(sql))) {
    const table = m[1]
    const colonnes = m[2].split(',').map((c) => c.trim().replace(/"/g, ''))
    const debut = m.index + m[0].length
    // Jusqu'au `;` de fin de statement, en sautant les chaines.
    let i = debut
    let fin = sql.length
    while (i < sql.length) {
      if (sql[i] === "'") {
        let j = i + 1
        while (j < sql.length) {
          if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue }
          if (sql[j] === "'") { j++; break }
          j++
        }
        i = j
        continue
      }
      if (sql[i] === ';') { fin = i; break }
      i++
    }
    let corps = sql.slice(debut, fin)

    // ⚠️ LA LISTE DE VALEURS S'ARRETE AVANT LA CLAUSE FINALE.
    //    Premiere version : on allait jusqu'au `;`. `on conflict (name) do
    //    nothing` etait alors lu comme un TUPLE DE PLUS, a une seule valeur —
    //    et le controle criait « arite : 1 valeur pour 3 colonnes » sur six
    //    migrations deja appliquees avec succes. Un controle qui denonce des
    //    fichiers sains est desactive le jour meme.
    const coupure = corps.search(/\b(on\s+conflict|returning)\b/i)
    if (coupure !== -1) corps = corps.slice(0, coupure)

    const tuples = []
    let analysable = true
    let raisonNonAnalysable = ''

    if (m[3].toLowerCase() === 'values') {
      // Chaque tuple de premier niveau.
      let prof = 0
      let courant = ''
      for (let k = 0; k < corps.length; k++) {
        const c = corps[k]
        if (c === "'") {
          let j = k + 1
          while (j < corps.length) {
            if (corps[j] === "'" && corps[j + 1] === "'") { j += 2; continue }
            if (corps[j] === "'") { j++; break }
            j++
          }
          courant += corps.slice(k, j)
          k = j - 1
          continue
        }
        if (c === '(') { prof++; if (prof === 1) { courant = ''; continue } }
        if (c === ')') { prof--; if (prof === 0) { tuples.push(courant); continue } }
        if (prof >= 1) courant += c
      }
    } else {
      // ── `insert … select` ────────────────────────────────────────────────
      //  DEUX FORMES, ET UNE SEULE EST ANALYSABLE.
      //
      //   ① `select 'a', 'b', true where not exists (…)` — une liste de
      //      LITTERAUX. On la lit comme un tuple.
      //   ② `select … from (values …) cross join …` — les valeurs viennent
      //      d'une sous-requete. Leur type depend de la jointure, et le deduire
      //      demanderait un analyseur SQL complet.
      //
      //  Sur ② on NE DEVINE PAS : on le DIT, et on ne compte pas d'echec. Un
      //  controle qui invente un verdict sur ce qu'il ne sait pas lire est pire
      //  qu'un controle qui reconnait sa limite — il fait croire a une
      //  couverture qui n'existe pas.
      const avantWhere = corps.split(/\bwhere\b/i)[0]
      if (/\b(from|join)\b/i.test(avantWhere)) {
        analysable = false
        raisonNonAnalysable = 'insert … select avec from/join : les valeurs viennent d’une sous-requete'
      } else {
        tuples.push(avantWhere)
      }
    }
    out.push({
      table, colonnes, tuples, position: m.index,
      forme: m[3].toLowerCase(), analysable, raisonNonAnalysable,
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const DOSSIER = join(ROOT, 'supabase', 'migrations')
const cibles = args.length
  ? args.map((a) => (existsSync(a) ? a : join(ROOT, a)))
  : readdirSync(DOSSIER).filter((f) => f.endsWith('.sql')).map((f) => join(DOSSIER, f))

for (const c of cibles) {
  if (!existsSync(c)) { ok(false, `${c} introuvable`); process.exit(2) }
}

console.log('\nMIGRATIONS DE DONNEES — TYPES, COLONNES, ORDRE\n')
const schema = construireSchema()
console.log(`  schema reconstruit depuis les migrations : ${schema.size} table(s)\n`)

section('A. Chaque valeur est compatible avec le TYPE de sa colonne')

let insertionsVues = 0
let valeursVues = 0
const nonAnalysables = []
for (const chemin of cibles) {
  const sql = depouiller(read(chemin))
  const insertions = lireInsertions(sql)
  if (insertions.length === 0) continue
  const nom = basename(chemin)

  for (const ins of insertions) {
    insertionsVues++
    if (!ins.analysable) {
      nonAnalysables.push(`${nom} — ${ins.table} : ${ins.raisonNonAnalysable}`)
      continue
    }
    const def = schema.get(ins.table)
    if (!def) {
      ok(false, `${nom} — table « ${ins.table} » inconnue du schema`,
        'la table n’est creee par aucune migration : l’insertion echouera')
      continue
    }

    // ① LES COLONNES CITEES EXISTENT-ELLES ?
    //    C'est la famille « une colonne supprimee ne fait echouer ni tsc ni
    //    build » — ici on l'attrape avant l'execution.
    const inconnues = ins.colonnes.filter((c) => !def.colonnes.has(c))
    if (inconnues.length) {
      ok(false, `${nom} — ${ins.table} : colonne(s) inexistante(s) : ${inconnues.join(', ')}`,
        'renommee ou supprimee par une migration posterieure')
      continue
    }

    // ② LES NOT NULL SANS DEFAUT SONT-ELLES TOUTES FOURNIES ?
    const omises = [...def.colonnes.entries()]
      .filter(([n, v]) => v.notNull && !v.aDefaut && !ins.colonnes.includes(n))
      .map(([n]) => n)
    if (omises.length) {
      ok(false, `${nom} — ${ins.table} : colonne(s) NOT NULL sans defaut omise(s) : ${omises.join(', ')}`,
        'l’insertion echouera sur une contrainte de non-nullite')
      continue
    }

    // ③ LES TYPES
    const ecarts = []
    for (const tuple of ins.tuples) {
      const vals = decouperValeurs(tuple)
      if (vals.length !== ins.colonnes.length) {
        ecarts.push(`arite : ${vals.length} valeur(s) pour ${ins.colonnes.length} colonne(s)`)
        break
      }
      for (let k = 0; k < vals.length; k++) {
        valeursVues++
        const col = def.colonnes.get(ins.colonnes[k])
        const fv = familleValeur(vals[k])
        if (!compatible(col.famille, fv, vals[k])) {
          const extrait = vals[k].length > 60 ? vals[k].slice(0, 60) + '…' : vals[k]
          const e = `${ins.colonnes[k]} est ${col.brut} (${col.famille}) mais reçoit ${fv} : ${extrait}`
          if (!ecarts.includes(e)) ecarts.push(e)
        }
      }
    }
    ok(ecarts.length === 0, `${nom} — ${ins.table} (${ins.tuples.length} ligne(s), ${ins.colonnes.length} colonne(s))`,
      ecarts.length ? ecarts.join('\n       → ') : undefined)
  }
}
console.log(
  `\n       ${insertionsVues} insertion(s) vue(s), ` +
    `${insertionsVues - nonAnalysables.length} analysee(s), ` +
    `${valeursVues} valeur(s) confrontee(s).`,
)
// CE QU'IL N'A PAS SU LIRE, IL LE DIT. Un controle qui tait sa limite fait
// croire a une couverture qui n'existe pas — et c'est exactement ainsi qu'une
// migration non eprouvee a ete livree.
if (nonAnalysables.length > 0) {
  console.log(`\n       ${nonAnalysables.length} insertion(s) NON ANALYSABLE(S) — dites, pas devinees :`)
  for (const n of nonAnalysables) console.log(`         ${n}`)
  console.log('         → seul un rejeu reel les couvre (db reset local, ou begin/rollback).')
}

section('B. L’ordre des insertions respecte les cles etrangeres')

for (const chemin of cibles) {
  const sql = depouiller(read(chemin))
  const insertions = lireInsertions(sql)
  if (insertions.length === 0) continue
  const nom = basename(chemin)

  // Premiere position d'insertion pour chaque table, dans CE fichier.
  const premiere = new Map()
  for (const ins of insertions) {
    if (!premiere.has(ins.table)) premiere.set(ins.table, ins.position)
  }

  const fautes = []
  for (const [table, pos] of premiere) {
    const def = schema.get(table)
    if (!def) continue
    for (const fk of def.fks) {
      if (fk.cible === table) continue // auto-reference : hors de portee ici
      if (!premiere.has(fk.cible)) continue // la cible n'est pas alimentee ici
      if (premiere.get(fk.cible) > pos) {
        fautes.push(`${table}.${fk.colonne} → ${fk.cible} : la cible est inseree APRES`)
      }
    }
  }
  ok(fautes.length === 0, `${nom} — ordre des insertions`,
    fautes.length ? fautes.join('\n       → ') : undefined)

  // ── `translations` : UNE DEPENDANCE QUE POSTGRESQL NE VOIT PAS ───────────
  //
  //  Elle n'a AUCUNE cle etrangere : `row_id` est un uuid libre, et
  //  `table_name` dit a quelle table il appartient. Le schema ne peut donc pas
  //  garantir son ordre — il faut le lire DANS LES DONNEES.
  //
  //  ⚠️ PREMIERE VERSION DE CE CONTROLE : « translations doit etre la
  //     DERNIERE insertion ». Trop strict, et il a crie a tort — il denoncait
  //     `public_email_domains`, qui n'est reference par AUCUNE traduction.
  //     Un controle qui crie a tort finit ignore. On exige donc exactement ce
  //     qui compte : les tables REELLEMENT citees par les traductions de ce
  //     fichier doivent etre inserees AVANT.
  const insTrad = insertions.filter((i) => i.table === 'translations')
  if (insTrad.length > 0) {
    const iTable = insTrad[0].colonnes.indexOf('table_name')
    const referencees = new Set()
    if (iTable !== -1) {
      for (const ins of insTrad) {
        for (const tuple of ins.tuples) {
          const v = decouperValeurs(tuple)[iTable]
          if (v) referencees.add(v.trim().replace(/^'|'$/g, ''))
        }
      }
    }
    const posTrad = premiere.get('translations')
    const tropTard = [...referencees].filter(
      (t) => premiere.has(t) && premiere.get(t) > posTrad,
    )
    ok(
      iTable !== -1 && tropTard.length === 0,
      `${nom} — translations vient apres les ${referencees.size} table(s) qu’elle reference`,
      iTable === -1
        ? 'colonne table_name absente : la dependance n’est pas verifiable'
        : tropTard.length
          ? `inserees APRES : ${tropTard.join(', ')} — leurs row_id n’existeraient pas encore`
          : undefined,
    )
    // Et celles qu'elle reference SANS que ce fichier les alimente : ce n'est
    // pas une faute (elles peuvent venir d'une autre migration), mais ca se dit.
    const ailleurs = [...referencees].filter((t) => !premiere.has(t))
    if (ailleurs.length) {
      console.log(`       note : traductions visant ${ailleurs.join(', ')} — lignes alimentees ailleurs`)
    }
  }
}

section('C. Le detecteur lui-meme est eprouve')

// UN DETECTEUR QU'ON NE TESTE PAS EST UNE OPINION. Cas construits, qui incluent
// LE DEFAUT REEL de ce lot.
{
  const cas = [
    { col: 'tableau', val: "'[\"a\",\"b\"]'::jsonb", attendu: false, quoi: 'LE DEFAUT REEL : du jsonb dans un text[]' },
    { col: 'tableau', val: "'{a,b}'", attendu: true, quoi: 'la forme litterale d’un tableau PostgreSQL' },
    { col: 'tableau', val: "array['a','b']", attendu: true, quoi: 'un constructeur array[]' },
    { col: 'json', val: "'{\"a\":1}'::jsonb", attendu: true, quoi: 'du jsonb dans un jsonb' },
    { col: 'json', val: "array['a']::text[]", attendu: false, quoi: 'un text[] caste dans un jsonb' },
    { col: 'booleen', val: 'true', attendu: true, quoi: 'un booleen dans un boolean' },
    { col: 'booleen', val: "'true'", attendu: false, quoi: 'une CHAINE dans un boolean' },
    { col: 'entier', val: '7', attendu: true, quoi: 'un entier dans un integer' },
    { col: 'entier', val: "'7'", attendu: false, quoi: 'une chaine dans un integer' },
    { col: 'entier', val: '7.5', attendu: false, quoi: 'un decimal dans un integer' },
    { col: 'uuid', val: "'86841d30-cab0-476f-9778-26af5360b3d9'", attendu: true, quoi: 'un uuid en chaine' },
    { col: 'texte', val: "'bonjour'", attendu: true, quoi: 'une chaine dans un text' },
    { col: 'texte', val: "'{\"a\":1}'::jsonb", attendu: false, quoi: 'du jsonb dans un text' },
    { col: 'texte', val: 'null', attendu: true, quoi: 'null, acceptable partout' },
  ]
  for (const c of cas) {
    const r = compatible(c.col, familleValeur(c.val), c.val)
    ok(r === c.attendu, `${c.attendu ? 'accepte' : 'refuse'} : ${c.quoi}`,
      c.attendu ? 'faux positif : un controle qui crie a tort finit ignore'
                : 'le detecteur laisserait passer une migration qui echouera au push')
  }

  // Le depouilleur ne doit ni couper une chaine contenant `--`, ni garder un
  // commentaire contenant une apostrophe.
  const e1 = depouiller("select 'a--b' -- vrai commentaire\n, 2;")
  ok(e1.includes("'a--b'") && !e1.includes('vrai commentaire'),
    'le depouilleur distingue un -- dans une chaine d’un vrai commentaire')
  const e2 = depouiller("-- l'apostrophe d'un commentaire\nselect 1;")
  ok(e2.includes('select 1'), 'une apostrophe dans un commentaire n’avale pas le code qui suit')
}

section('E. La plage de numerotation du worktree — un CLIQUET')

/**
 * LE DEFAUT QU'ON FERME, ET IL EST DE LA MAISON.
 *
 *   §G.2 est explicite et marque TRANCHE : la plage du tronc est `0xxxxx`, et
 *   « la consigne orale 1xxxxx etait fausse, elle est corrigee ». Quatre
 *   migrations du tronc portent pourtant `1xxxxx` — 20260916100000, 110000,
 *   120000 et 130000, ecrites les 16 et 17 septembre. Personne ne l'a vu, et
 *   rien ne pouvait le voir.
 *
 *   AUCUNE COLLISION N'EN A RESULTE : `1xxxxx` n'est attribuee a aucun
 *   worktree, et l'ordre chronologique tient. Mais la plage existe POUR
 *   eviter la collision, et une collision de numeros s'est deja produite sur
 *   ce depot (e33fdab), suivie d'un renumerotage en urgence (912d437) sur une
 *   migration qui se serait rejouee AVANT quatre migrations deja appliquees.
 *
 *   TROIS DES QUATRE SONT DEJA APPLIQUEES EN BASE. Les renommer ferait
 *   diverger `supabase_migrations.schema_migrations` du disque, donc REJOUER
 *   des migrations deja passees. On ne corrige pas le passe : on l'inscrit, et
 *   on ferme l'avenir.
 *
 * LE CLIQUET — meme forme que `diag-colonnes-supprimees`.
 *   La dette est GELEE, nommement. Le compte ne peut que DESCENDRE : toute
 *   NOUVELLE migration hors plage fait rougir. Une migration gelee qui serait
 *   renommee sort du gel, et le controle le lit comme une baisse.
 */
{
  /** Les plages attribuees, telles que §G.2 les fixe. */
  const PLAGES = { '0': 'tronc', '2': 'S1', '3': 'S2' }

  /**
   * LA DETTE GELEE — quatre migrations du tronc en `1xxxxx`, plage que §G.2
   * declare fausse. Chacune porte SA raison : un gel sans raison par entree
   * devient un tampon qu'on remplit sans lire (§G.8).
   *
   * LA RAISON EST LA MEME POUR LES QUATRE, ET ELLE EST DESORMAIS EXACTE :
   * elles sont APPLIQUEES EN BASE. Les renommer ferait diverger
   * `supabase_migrations.schema_migrations` du disque, donc rejouer des
   * migrations deja passees. On ne corrige pas le passe : on l'inscrit, et on
   * ferme l'avenir.
   *
   * ⚠️ CE PARAGRAPHE A DIT « DONT TROIS DEJA APPLIQUEES » — et c'etait vrai a
   *    sa date. La quatrieme etait donc RENOMMABLE, et le gel ne disait pas
   *    laquelle : c'etait la seule ligne du depot gelee sans raison
   *    individuelle. La fenetre est refermee — le tronc a ete pousse depuis, et
   *    les 65 migrations du disque sont appliquees.
   *
   * ⚠️ ET CET ETAT NE SE LIT PAS DEPUIS LE DEPOT. Ce script tourne sans base,
   *    par construction (§E.12). L'etat ci-dessus est DECLARE par Youssef le
   *    18/09/2026, pas mesure ici. Pour le verifier, dans l'editeur SQL :
   *
   *      select version from supabase_migrations.schema_migrations
   *       where version in ('20260916100000','20260916110000',
   *                         '20260916120000','20260916130000')
   *       order by version;
   *
   *    Quatre lignes ⇒ aucune n'est renommable, le gel est definitif.
   *    Moins de quatre ⇒ celles qui manquent SONT renommables, et doivent
   *    l'etre dans la plage `0xxxxx` avant d'etre appliquees.
   */
  const GEL = new Set([
    // Les quatre, meme infraction, meme raison : appliquees, donc figees.
    '20260916100000_tarifs_ia.sql',
    '20260916110000_depense_ia_par_acteur.sql',
    '20260916120000_durees_reglables.sql',
    '20260916130000_duree_invitation.sql',
  ])

  const horsPlage = []
  for (const f of readdirSync(join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql'))) {
    const horodatage = f.split('_')[0]
    // La baseline n'a pas de suffixe de worktree : elle precede la convention.
    if (horodatage.length !== 14 || /^0+$/.test(horodatage)) continue
    const plage = horodatage.slice(8, 9)
    if (PLAGES[plage]) continue
    horsPlage.push(f)
  }

  const nouvelles = horsPlage.filter((f) => !GEL.has(f))
  const sorties = [...GEL].filter((f) => !horsPlage.includes(f))

  ok(nouvelles.length === 0,
    `aucune NOUVELLE migration hors des plages attribuees (gel : ${GEL.size})`,
    nouvelles.map((f) => `${f} — suffixe ${f.split('_')[0].slice(8)}, plage inconnue`).join(' · ') +
      ' — §G.2 : tronc 0xxxxx, S1 2xxxxx, S2 3xxxxx')

  if (sorties.length > 0) {
    console.log(`  note ${sorties.length} migration(s) sortie(s) du gel — pensez a les retirer de GEL :`)
    for (const f of sorties) console.log(`         ${f}`)
  }
  if (horsPlage.length > 0) {
    console.log(`  note dette gelee : ${horsPlage.length} migration(s) du tronc en 1xxxxx,`)
    console.log('         APPLIQUEES en base — irrenommables sans les rejouer.')
    console.log('         (etat DECLARE, non lu d ici : la requete de verification')
    console.log('          est en tete du gel, dans ce fichier.)')
  }
}

console.log(echecs === 0 ? '\n✔ TOUT VERT' : `\n✘ ${echecs} CONTROLE(S) EN ECHEC`)
process.exit(echecs === 0 ? 0 : 1)
