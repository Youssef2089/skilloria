// scripts/lib/schema-migrations.mjs — LE SCHEMA, REJOUE DEPUIS LES MIGRATIONS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE MODULE EXISTE, ET POURQUOI IL EST PARTAGE
//
//   Ce rejeu vivait dans `diag-migration-donnees.mjs`, qui l'utilisait pour
//   confronter chaque valeur inseree au TYPE de sa colonne. Il tenait donc deja
//   le registre des colonnes VIVANTES — create table, add column, drop column,
//   rename column, drop table, dans l'ordre.
//
//   Le 22/09/2026, il a fallu la meme chose pour les colonnes MORTES : savoir
//   qu'une lecture du depot cite une colonne qui n'existe plus. Ecrire un second
//   rejeu a cote aurait produit deux lectures du meme SQL, vieillissant
//   separement — §E.20, la forme exacte du jumeau. Le rejeu est donc EXTRAIT
//   ici, et il a desormais deux lecteurs : les types (diag-migration-donnees) et
//   les morts (diag-colonnes-supprimees).
//
//   C'est la meme mecanique que `diag-index-sautes` applique aux index : rejouer
//   l'historique dans l'ordre et tenir un registre. Un troisieme dialecte
//   n'aurait servi a rien.
//
// CE QU'IL REND
//   { schema, mortes, fonctions }
//     schema    : table -> { colonnes: Map<nom, {famille, brut, notNull, aDefaut}>, fks }
//                 — l'etat FINAL, apres toutes les migrations.
//     mortes    : Map<'table.colonne', { table, colonne, migration, cause, vers? }>
//                 — les colonnes qui ont existe et n'existent PLUS a la fin.
//                 Une colonne supprimee puis recreee n'y est pas : elle vit.
//     fonctions : nom -> { migration, corps } — la DERNIERE definition de chaque
//                 fonction ou vue, celle qui fait foi en base.
//
// CE QU'IL NE FAIT PAS, ET IL LE DIT
//   · Il n'est PAS un analyseur PostgreSQL. Il lit les formes que ce depot
//     emploie reellement ; une syntaxe exotique lui echappe.
//   · Il lit des FICHIERS, jamais la base (§E.12). Une colonne supprimee a la
//     main dans l'editeur SQL n'y figure pas — et c'est justement pour ca qu'on
//     ne supprime pas de colonne a la main (§E.10).
//
// AUCUN acces base, AUCUN reseau. Lecture pure.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DOSSIER = join(ROOT, 'supabase', 'migrations')

// Fins de ligne NORMALISEES : le depot sort les fichiers en CRLF, et un retour
// chariot casse tout motif qui traverse un saut de ligne (§E.3).
const lire = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n')

/**
 * RETIRER LES COMMENTAIRES SQL — SANS TOUCHER AUX CHAINES.
 *
 * Un `--` dans une chaine ('a--b') n'ouvre pas un commentaire, et une apostrophe
 * dans un commentaire n'ouvre pas une chaine. Un depouillement naif par regex se
 * trompe dans les deux sens. On lit donc caractere par caractere.
 *
 * LES BLOCS $tag$…$tag$ ONT DEUX LECTEURS QUI N'EN VEULENT PAS LA MEME CHOSE :
 *   · les TYPES (diag-migration-donnees) les sautent — le SQL qu'ils portent
 *     n'est pas execute a ce niveau, et leurs `insert` internes ne sont pas des
 *     insertions de cette migration ;
 *   · les MORTS (diag-colonnes-supprimees) en ont besoin — c'est LA que vivent
 *     les corps de fonction, et une fonction qui lit une colonne morte casse en
 *     base, pas a la compilation.
 * D'ou l'option, et son defaut qui preserve le comportement historique.
 */
export function depouiller(sql, { garderBlocs = false } = {}) {
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
      const bloc = fin === -1 ? sql.slice(i) : sql.slice(i, fin + tag.length)
      if (garderBlocs) {
        // On depouille le CONTENU (ses commentaires n'executent rien non plus)
        // en preservant les longueurs : les indices servent a ordonner.
        const interieur = bloc.slice(tag.length, bloc.length - (fin === -1 ? 0 : tag.length))
        const nettoye = depouiller(interieur, { garderBlocs: true })
        out +=
          ' '.repeat(tag.length) + nettoye + ' '.repeat(fin === -1 ? 0 : tag.length)
      } else {
        // On remplace par des espaces pour PRESERVER LES POSITIONS.
        out += ' '.repeat(bloc.length)
      }
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

/** `"text"[]` · `character varying(7)` · `"jsonb"` → famille normalisee. */
export function famille(brut) {
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

/** La liste des migrations, dans l'ordre d'application. */
export function migrations() {
  return readdirSync(DOSSIER).filter((f) => f.endsWith('.sql')).sort()
}

/**
 * REJOUE L'HISTORIQUE, ET REND TROIS CHOSES.
 *
 * Les trois sortent du MEME parcours : deux parcours donneraient deux verites,
 * et c'est exactement ce qu'on evite.
 */
export function rejouerMigrations() {
  const fichiers = migrations()

  /** table → { colonnes: Map<nom, {famille, brut, notNull, aDefaut}>, fks: [{colonne, cible}] } */
  const schema = new Map()
  /** 'table.colonne' → { table, colonne, migration, cause, vers? } */
  const mortes = new Map()
  /** nom de fonction/vue → { migration, corps } — la DERNIERE definition. */
  const fonctions = new Map()

  const tableDe = (n) => {
    if (!schema.has(n)) schema.set(n, { colonnes: new Map(), fks: [] })
    return schema.get(n)
  }
  const naitre = (table, colonne) => mortes.delete(`${table}.${colonne}`)
  const mourir = (table, colonne, migration, cause, vers) => {
    mortes.set(`${table}.${colonne}`, { table, colonne, migration, cause, vers })
  }

  for (const f of fichiers) {
    const brut = lire(join(DOSSIER, f))
    // Le SQL AVEC les corps de fonction, depouille de ses commentaires (§E.7).
    //
    // ⚠️ LE DDL SE LIT ICI, ET PAS SUR LA VERSION SANS BLOCS — MESURE.
    //    Cinq `alter table … rename column` du depot vivent A L'INTERIEUR d'un
    //    `do $$ … $$` (garde d'idempotence : « renomme si le nouveau nom n'existe
    //    pas encore »). Sur la version sans blocs, ils sont INVISIBLES : le
    //    schema reconstruit croyait donc `publications.location` vivante et
    //    `location_note` inexistante, exactement a l'envers de la base.
    //    Mesure du 22/09/2026 : 5 occurrences, toutes des renames gardes, AUCUN
    //    `drop column` conditionnel — les lire ne suppose donc aucune execution
    //    incertaine.
    const sql = depouiller(brut, { garderBlocs: true })
    const sqlAvecCorps = sql

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
        naitre(m[1], col[1])
        const refInline = reste.match(/references\s+"?public"?\.?"?([a-z_0-9]+)"?/i)
        if (refInline) t.fks.push({ colonne: col[1], cible: refInline[1] })
      }
    }

    // ── ALTER TABLE ───────────────────────────────────────────────────────
    const reAlter = /alter table (?:only )?"?public"?\.?"?([a-z_0-9]+)"?([\s\S]*?);/gi
    while ((m = reAlter.exec(sql))) {
      const nomTable = m[1]
      const t = tableDe(nomTable)
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
        // UNE COLONNE RECREEE N'EST PLUS MORTE. Sans cette ligne, une colonne
        // supprimee puis remise serait denoncee pour toujours.
        naitre(nomTable, a[1])
      }
      for (const d of corps.matchAll(/drop column (?:if exists )?"?([a-z_0-9]+)"?/gi)) {
        if (t.colonnes.delete(d[1])) mourir(nomTable, d[1], f, 'drop column')
        else mourir(nomTable, d[1], f, 'drop column')
      }
      for (const r of corps.matchAll(/rename column "?([a-z_0-9]+)"? to "?([a-z_0-9]+)"?/gi)) {
        const v = t.colonnes.get(r[1])
        if (v) { t.colonnes.delete(r[1]); t.colonnes.set(r[2], v) }
        // L'ANCIEN NOM EST MORT, LE NOUVEAU NAIT. C'est le cas
        // `publications.location → location_note`, que l'ancien cliquet tenait
        // a la main avec une heuristique de voisinage.
        mourir(nomTable, r[1], f, 'rename column', r[2])
        naitre(nomTable, r[2])
      }
      const fk = corps.match(/add constraint [^\s]+ foreign key\s*\(\s*"?([a-z_0-9]+)"?\s*\)\s*references\s+"?public"?\.?"?([a-z_0-9]+)"?/i)
      if (fk) t.fks.push({ colonne: fk[1], cible: fk[2] })
    }

    // ── DROP TABLE ────────────────────────────────────────────────────────
    for (const d of sql.matchAll(/drop table (?:if exists )?"?public"?\.?"?([a-z_0-9]+)"?/gi)) {
      const nomTable = d[1]
      const t = schema.get(nomTable)
      if (t) for (const c of t.colonnes.keys()) mourir(nomTable, c, f, 'drop table')
      schema.delete(nomTable)
    }

    // ── FONCTIONS ET VUES — la DERNIERE definition fait foi ───────────────
    //  `create or replace` remplace : une fonction ecrite en migration 12 et
    //  reecrite en migration 40 ne vit qu'a travers la seconde. C'est donc
    //  celle-la, et elle seule, qu'il faut confronter au schema FINAL.
    for (const d of sqlAvecCorps.matchAll(
      /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?(function|view)\s+"?public"?\.?"?([a-z_0-9]+)"?/gi,
    )) {
      const nom = d[2].toLowerCase()
      const debut = d.index
      // Le corps s'arrete au `;` de fin de statement au niveau zero de
      // parentheses. Suffisant ici : les corps sont en $tag$ deja depouilles.
      let prof = 0
      let fin = sqlAvecCorps.length
      for (let k = debut; k < sqlAvecCorps.length; k++) {
        const ch = sqlAvecCorps[k]
        if (ch === '(') prof++
        else if (ch === ')') prof--
        else if (ch === ';' && prof <= 0) { fin = k; break }
      }
      fonctions.set(nom, { migration: f, corps: sqlAvecCorps.slice(debut, fin) })
    }
    for (const d of sqlAvecCorps.matchAll(
      /drop\s+(?:materialized\s+)?(?:function|view)\s+(?:if\s+exists\s+)?"?public"?\.?"?([a-z_0-9]+)"?/gi,
    )) {
      // ⚠️ UN `drop function` SUIVI D'UN `create` DANS LA MEME MIGRATION EST LE
      //    MOTIF NORMAL (changer la signature). On ne supprime donc que si
      //    aucune creation du meme nom ne suit dans ce fichier.
      const nom = d[1].toLowerCase()
      const apres = sqlAvecCorps.slice(d.index)
      const recree = new RegExp(
        `create\\s+(?:or\\s+replace\\s+)?(?:materialized\\s+)?(?:function|view)\\s+"?public"?\\.?"?${nom}"?`,
        'i',
      ).test(apres)
      if (!recree) fonctions.delete(nom)
    }
  }

  return { schema, mortes, fonctions }
}

/** Compatibilite : l'appelant historique ne veut que le schema. */
export function construireSchema() {
  return rejouerMigrations().schema
}
