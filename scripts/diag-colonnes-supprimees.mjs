// scripts/diag-colonnes-supprimees.mjs — AUCUNE LECTURE NE CITE UNE COLONNE MORTE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LA PROPRIETE DEFENDUE
//
//   Aucun fichier du depot ne lit ni n'ecrit une colonne qui n'existe plus dans
//   le schema RECONSTRUIT DEPUIS LES MIGRATIONS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE CONTROLE A ETE REECRIT — ET CE N'EST PAS LA LIGNE OUBLIEE
//
//   La version precedente tenait la liste des colonnes mortes A LA MAIN :
//   `speciality_id`, `seniority`, trois colonnes Stripe, `location`. Six noms,
//   ajoutes un par un par ceux qui y pensaient.
//
//   ELLE NE CONNAISSAIT PAS `matches.score`, supprimee le 01/09/2026 par
//   `score_de_pertinence`. `GET /api/me/missions/[id]` la selectionnait encore :
//   la base repondait « column matches.score does not exist », AUCUNE mission ne
//   s'ouvrait, et comme le bouton « Postuler » ne vit que sur cet ecran,
//   PERSONNE NE POUVAIT POSTULER. Trois semaines, et rien ne l'a dit.
//
//   Le defaut n'etait donc pas la ligne oubliee : c'etait UN CONTROLE DONT LA
//   COUVERTURE DEPEND DE LA MEMOIRE DE CELUI QUI L'ALIMENTE. Une liste tenue a
//   la main est une DISCIPLINE ; la parade doit etre un MECANISME (§E.31).
//
//   Mesure du 22/09/2026 : la liste a la main connaissait 6 noms, le rejeu en
//   trouve 21 hors tables heritees — dont `matches.score` et les six colonnes
//   d'abonnement remontees de `organization_domains` vers `organizations`.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI L'ATTRIBUTION DE LA TABLE EST OBLIGATOIRE, ET PAS UN RAFFINEMENT
//
//   `score` est MORTE sur `matches` et VIVANTE sur `matching_notes_partielles`.
//   `location` est MORTE sur `publications` (renommee) et VIVANTE sur `profiles`
//   et `profile_educations`. Un balayage par NOM SEUL serait donc faux dans les
//   deux sens : il crierait sur du code sain, et il serait desactive dans la
//   semaine (§E.14).
//
//   On resout donc la table de chaque lecture : `.from('x')` et sa CHAINE
//   d'appels, les embeds PostgREST, les references qualifiees `x.col`, et les
//   corps de fonction SQL par leurs alias de `from` / `join`.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE PERIMETRE, ECRIT — ET CHAQUE EXCLUSION JUSTIFIEE
//
//   BALAYE   app/ lib/ components/  — le produit. Une colonne morte y casse la
//                                     requete en production.
//            scripts/               — diagnostics, recette et outils lisent la
//                                     base aussi ; une colonne morte y fait
//                                     MENTIR un controle ou echouer la recette.
//            supabase/migrations/   — les corps de FONCTION et de VUE. Une vue
//                                     qui lit une colonne morte casse EN BASE,
//                                     pas a la compilation, et aucun `tsc` ne
//                                     la voit. Seule la DERNIERE definition de
//                                     chaque fonction compte : c'est elle qui
//                                     vit.
//
//   EXCLU    node_modules/ .next/   — pas du depot / genere.
//            supabase/_archive/     — traces d'avant la baseline, JAMAIS
//                                     rejouees (§B.2 ⑥). Les lire ferait
//                                     denoncer l'histoire.
//            docs/ messages/        — de la prose et des traductions : rien n'y
//                                     est execute contre la base.
//            lib/database.types.ts  — EXEMPTION NOMMEE, avec sa sentinelle
//                                     ci-dessous.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-colonnes-supprimees.mjs            controle
//   node scripts/diag-colonnes-supprimees.mjs --reste    ce qui reste a reprendre
//   node scripts/diag-colonnes-supprimees.mjs --registre les colonnes mortes
//
// AUCUN acces base, AUCUN reseau, AUCUNE ecriture.
// 0 = vert · 1 = rouge · 2 = n'a pas tourne.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { rejouerMigrations } from './lib/schema-migrations.mjs'

const MOI = fileURLToPath(import.meta.url)
const ROOT = join(dirname(MOI), '..')
const RACINES = ['app', 'lib', 'components', 'scripts']
const EXCLUS_DOSSIER = new Set(['node_modules', '.next', '_archive'])

/**
 * CE FICHIER SE RETIRE LUI-MEME DU BALAYAGE, ET IL FAUT DIRE POURQUOI.
 *
 * Ses TEMOINS sont de vrais `.from('matches').select('… score …')` — c'est tout
 * leur interet : ils prouvent que le motif voit le defaut fondateur. Balaye, il
 * se denoncerait donc lui-meme, a chaque execution, sur sa propre preuve. C'est
 * la forme exacte de §E.57 (`diag-scripts-destructeurs` PORTE le motif qu'il
 * cherche) et de §E.7 (un anti-pattern doit pouvoir etre documente).
 *
 * ⚠️ L'EXCLUSION SUIT LE FICHIER, PAS SON NOM (§E.34) : `import.meta.url` reste
 *    juste apres un renommage, une liste de chemins non.
 */
const estMoi = (chemin) => chemin === MOI

/**
 * L'EXEMPTION, AVEC SA RAISON ET SA SENTINELLE (§G.8).
 *
 * `lib/database.types.ts` DECLARE les colonnes de la base — mortes comprises,
 * puisqu'il est perime. Le denoncer serait crier sur un fichier que la memoire
 * declare deja mort : « aucun `createClient<Database>` n'en fait usage dans tout
 * le depot » (§E.1, §H).
 *
 * ⚠️ LA SENTINELLE : le jour ou quelqu'un TYPE un client avec lui, il cesse
 *    d'etre inerte — et l'exemption tombe, bruyamment.
 */
const EXEMPTIONS = {
  'lib/database.types.ts':
    'LEGITIME — fichier de types PERIME et INUTILISE (§E.1) : il decrit un schema, il ne le lit pas. Sentinelle : aucun createClient<Database> dans le depot.',
}

const REGISTRE = process.argv.includes('--registre')
const RESTE = process.argv.includes('--reste')

let echecs = 0
const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE REGISTRE DES MORTES — DERIVE, JAMAIS ECRIT A LA MAIN
   ═══════════════════════════════════════════════════════════════════════════ */

const { schema, mortes, fonctions } = rejouerMigrations()

/** table → Set<colonne morte>. */
const mortesParTable = new Map()
for (const m of mortes.values()) {
  if (!mortesParTable.has(m.table)) mortesParTable.set(m.table, new Map())
  mortesParTable.get(m.table).set(m.colonne, m)
}
const estMorte = (table, colonne) => mortesParTable.get(table)?.get(colonne) ?? null

/* ═══════════════════════════════════════════════════════════════════════════
   2. LIRE DU TYPESCRIPT SANS SE FAIRE PIEGER PAR SES COMMENTAIRES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Commentaires → espaces, chaines PRESERVEES, positions conservees.
 *
 * Un anti-pattern doit pouvoir etre DOCUMENTE (§E.7) : ce fichier cite
 * `matches.score` une dizaine de fois pour expliquer ce qu'il defend, et un
 * controle qui rougirait sur sa propre explication serait desactive le jour meme.
 */
function depouillerJs(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i)
      if (j === -1) j = src.length
      out += ' '.repeat(j - i)
      i = j
      continue
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2)
      j = j === -1 ? src.length : j + 2
      // Les sauts de ligne sont conservés : les numéros de ligne doivent tenir.
      out += src.slice(i, j).replace(/[^\n]/g, ' ')
      i = j
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const fin = finDeChaine(src, i)
      out += src.slice(i, fin)
      i = fin
      continue
    }
    out += c
    i++
  }
  return out
}

/** Index APRES la chaine ouverte en `i`. Gere l'echappement et `${…}`. */
function finDeChaine(src, i) {
  const q = src[i]
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') { j += 2; continue }
    if (q === '`' && c === '$' && src[j + 1] === '{') {
      let prof = 1
      j += 2
      while (j < src.length && prof > 0) {
        if (src[j] === '{') prof++
        else if (src[j] === '}') prof--
        else if (src[j] === "'" || src[j] === '"' || src[j] === '`') { j = finDeChaine(src, j); continue }
        j++
      }
      continue
    }
    if (c === q) return j + 1
    j++
  }
  return src.length
}

/** Index APRES la parenthese ouverte en `i` (qui doit etre un `(`). */
function finDeParenthese(src, i) {
  let prof = 0
  let j = i
  while (j < src.length) {
    const c = src[j]
    if (c === "'" || c === '"' || c === '`') { j = finDeChaine(src, j); continue }
    if (c === '(') prof++
    else if (c === ')') { prof--; if (prof === 0) return j + 1 }
    j++
  }
  return src.length
}

/** La valeur d'une chaine litterale, ou `null` si ce n'en est pas une. */
function litteral(txt) {
  const t = txt.trim()
  const m = t.match(/^(['"`])([\s\S]*)\1$/)
  if (!m) return null
  if (m[1] === '`' && /\$\{/.test(m[2])) return null
  return m[2]
}

/**
 * La valeur d'une expression de chaine : un litteral, ou une CONCATENATION de
 * litteraux (`'a, b' + 'c, d'`). Rend `null` si une partie n'est pas litterale.
 */
function chaineComposee(txt) {
  const parties = decouperNiveauZero(txt, '+')
  const valeurs = parties.map((p) => litteral(p))
  if (valeurs.some((v) => v === null)) return null
  return valeurs.join('')
}

/** Decoupe au premier niveau de parentheses/crochets/accolades, hors chaines. */
function decouperNiveauZero(txt, sep) {
  const out = []
  let prof = 0
  let courant = ''
  let i = 0
  while (i < txt.length) {
    const c = txt[i]
    if (c === "'" || c === '"' || c === '`') {
      const fin = finDeChaine(txt, i)
      courant += txt.slice(i, fin)
      i = fin
      continue
    }
    if (c === '(' || c === '[' || c === '{') prof++
    if (c === ')' || c === ']' || c === '}') prof--
    if (c === sep && prof === 0) { out.push(courant); courant = ''; i++; continue }
    courant += c
    i++
  }
  out.push(courant)
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. LES CONSTANTES DE CHAINE — UN SEUL SAUT, ET IL EST DECLARE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `const SELECT_PROFIL = 'id, user_id, …'` et `const TABLE = 'matches'`.
 *
 * ⚠️ UN SEUL SAUT (§E.42). Une constante qui en cite une autre, une chaine
 *    construite par une fonction, un select assemble a l'execution : hors de
 *    portee, et DIT plus bas.
 */
function constantesDe(src) {
  const out = new Map()
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    /* ⚠️ ON SAUTE LES BLANCS APRES LE `=`, ET C'EST TOUT L'ENJEU.
          La premiere version s'arretait au premier `\n` dont la suite ne
          commencait pas par `+`. Or la forme la plus courante du depot est
          precisement :
              const SELECT_PROFIL =
                'id, user_id, …' +
                'users!…(…)'
          — le `\n` arrive AVANT le premier caractere de la valeur, la boucle
          rendait une chaine VIDE, et les quatre plus gros selects du moteur
          n'etaient pas resolus. Un resolveur qui rend `null` ne crie pas : il
          laisse simplement une lecture NON VUE (§E.38). */
    let debut = m.index + m[0].length
    while (debut < src.length && /\s/.test(src[debut])) debut++
    let fin = debut
    let prof = 0
    while (fin < src.length) {
      const c = src[fin]
      if (c === "'" || c === '"' || c === '`') { fin = finDeChaine(src, fin); continue }
      if (c === '(' || c === '[' || c === '{') prof++
      if (c === ')' || c === ']' || c === '}') { if (prof === 0) break; prof-- }
      if ((c === ';' || c === '\n') && prof === 0) {
        /* Une expression continue a la ligne suivante quand l'operateur est
           d'un cote OU DE L'AUTRE du saut de ligne. Ne regarder que la SUITE
           coupait la forme la plus repandue du depot — l'operateur en fin de
           ligne :
               'id, user_id, …' +
               'users!…(…)'
           — et les quatre selects du moteur restaient non resolus. */
        const suite = src.slice(fin + 1).match(/^\s*(\S)/)
        const avant = src.slice(0, fin).match(/(\S)\s*$/)
        const continue_ =
          (suite && '+?:.,'.includes(suite[1])) || (avant && '+?:.,('.includes(avant[1]))
        if (!continue_) break
      }
      fin++
    }
    /* ON GARDE LE TEXTE, PAS UNE VALEUR DEJA CALCULEE.
       Ranger ici une chaine deja resolue obligeait a savoir, au moment de la
       collecte, quelles formes comptent — et `const profileSelect = isCdi ?
       baseSelect + cdiSelectExtra : baseSelect` n'en etait pas une. En gardant
       le TEXTE, c'est le meme resolveur qui tranche, une fois, pour tout le
       monde : une forme ajoutee profite aux constantes sans y toucher. */
    const texte = src.slice(debut, fin).trim()
    if (texte) out.set(m[1], texte)
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. LA CHAINE POSTGREST — ANCREE SUR LE BLOC, JAMAIS UNE REGEX LACHEE (§E.8)
   ═══════════════════════════════════════════════════════════════════════════ */

/** Les appels qui portent un nom de colonne en PREMIER argument. */
const FILTRES = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'containedBy', 'overlaps', 'order', 'filter', 'not',
  'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent', 'textSearch',
])
/** Les appels qui portent des colonnes en CLES d'objet. */
const ECRITURES = new Set(['update', 'insert', 'upsert'])

/**
 * Depuis l'index d'un `.` qui ouvre `.methode(`, lit la suite de la chaine.
 * Rend `[{ methode, args, index }]` et l'index de fin.
 */
function lireChaine(src, depart) {
  const appels = []
  let i = depart
  for (;;) {
    const reste = src.slice(i)
    const m = reste.match(/^\s*(?:\?)?\.\s*([A-Za-z_$][\w$]*)\s*\(/)
    if (!m) break
    const ouvrante = i + m[0].length - 1
    const fermante = finDeParenthese(src, ouvrante)
    appels.push({ methode: m[1], args: src.slice(ouvrante + 1, fermante - 1), index: ouvrante })
    i = fermante
  }
  return { appels, fin: i }
}

/**
 * Decompose une liste de select PostgREST.
 * Rend `{ colonnes: [nom], embeds: [{ table, liste }] }`.
 */
function analyserSelect(liste) {
  const colonnes = []
  const embeds = []
  for (const brut of decouperNiveauZero(liste, ',')) {
    const item = brut.trim()
    if (!item || item === '*') continue
    const ouvrante = item.indexOf('(')
    if (ouvrante !== -1 && item.endsWith(')')) {
      // `alias:table!hint(colonnes)` — le `!hint` est un nom de contrainte ou
      // un modificateur de jointure ; ni l'un ni l'autre n'est une table.
      let tete = item.slice(0, ouvrante).trim()
      const alias = tete.match(/^([A-Za-z_][\w]*)\s*:\s*(.+)$/)
      if (alias) tete = alias[2].trim()
      const table = tete.split('!')[0].trim()
      if (/^[a-z_][a-z0-9_]*$/.test(table)) {
        embeds.push({ table, liste: item.slice(ouvrante + 1, -1) })
      }
      continue
    }
    // `col::type`, `col->>'x'`, `alias:col`
    let nom = item
    const alias = nom.match(/^([A-Za-z_][\w]*)\s*:\s*(.+)$/)
    if (alias) nom = alias[2].trim()
    nom = nom.split('::')[0].split('->')[0].trim()
    if (/^[a-z_][a-z0-9_]*$/.test(nom)) colonnes.push(nom)
  }
  return { colonnes, embeds }
}

/** Les identifiants cites en tete de clause dans un filtre `.or(…)`. */
function colonnesDuOr(clause) {
  const out = []
  for (const m of clause.matchAll(/(?:^|[,(])\s*([a-z_][a-z0-9_]*)\./g)) out.push(m[1])
  return out
}

/** Les cles d'un littéral d'objet, au premier niveau. */
function clesDObjet(txt) {
  const t = txt.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return []
  const out = []
  for (const p of decouperNiveauZero(t.slice(1, -1), ',')) {
    const m = p.trim().match(/^(?:\.\.\.)?\s*(['"`]?)([A-Za-z_][\w]*)\1\s*:/)
    if (m) out.push(m[2])
    else {
      // Raccourci `{ score }` — la clé EST le nom.
      const court = p.trim().match(/^([a-z_][a-z0-9_]*)\s*$/)
      if (court) out.push(court[1])
    }
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. LE BALAYAGE D'UN FICHIER TYPESCRIPT
   ═══════════════════════════════════════════════════════════════════════════ */

const GLOBALES = new Map()

/**
 * CE QUE L'ATTRIBUTION N'A PAS SU RESOUDRE — compte ET adresses.
 *
 * Un controle qui rend zero sans pouvoir trouver est pire qu'une dette ecrite :
 * le premier rassure, la seconde attend (§E.38). Chaque argument de `.from(` ou
 * de `.select(` que le resolveur a un saut ne sait pas lire est donc NOMME, a
 * chaque execution, avec son adresse.
 */
const nonResolus = []

/**
 * Rend `[{ table, colonne, ligne, extrait, forme }]` — les citations de colonnes
 * ATTRIBUEES a une table.
 */
function citationsDe(src, constantesGlobales = GLOBALES, fichier = null) {
  const net = depouillerJs(src)
  const locales = constantesDe(net)
  /**
   * RESOUT UNE EXPRESSION DE CHAINE — cinq formes, mesurees sur ce depot.
   *
   * Le resolveur a UN SAUT (§E.42) suivait la seule forme `CONSTANTE`. Mesure du
   * 22/09/2026 : sur 24 selects rattaches a une table, NEUF lui echappaient —
   * et trois familles les expliquent, toutes presentes plusieurs fois. Les
   * couvrir n'est pas un raffinement : c'est ce qui separe « je n'ai rien vu »
   * de « il n'y a rien ».
   *
   *   ① litteral, ou concatenation de litteraux ;
   *   ② identifiant → constante (local d'abord, global ensuite) ;
   *   ③ TABLEAU de litteraux, avec ou sans `.join(…)` — deux routes de profil ;
   *   ④ GABARIT `\`code, ${CONSTANTE}\`` — les trois lectures de `countries` ;
   *   ⑤ TERNAIRE `c ? A : B` → l'UNION des deux branches. Plus severe, jamais
   *      plus permissif : les deux branches EXISTENT toutes les deux a
   *      l'execution, et une colonne morte dans l'une est un defaut.
   *
   * ⚠️ CE N'EST PAS UNE EVALUATION, C'EST UN DEPLIAGE DE CONSTANTES. Il ne
   *    suit que des declarations `const/let/var` et des litteraux ; il n'appelle
   *    aucune fonction et ne connait aucune valeur d'execution. La profondeur
   *    est BORNEE a six niveaux — assez pour
   *    `profileSelect → ternaire → concatenation → baseSelect`, et une borne
   *    ferme par construction le cycle `const a = b; const b = a`.
   */
  const resoudre = (txt, profondeur = 0) => {
    if (profondeur > 6) return null
    const t = txt.trim()
    if (!t) return null

    // ① litteral simple
    const direct = litteral(t)
    if (direct !== null) return direct

    // ② identifiant → le TEXTE de sa declaration, resolu a son tour.
    const ident = t.match(/^([A-Za-z_$][\w$]*)$/)
    if (ident) {
      const texte = locales.get(ident[1]) ?? constantesGlobales.get(ident[1])
      if (texte === undefined || texte === t) return null
      return resoudre(texte, profondeur + 1)
    }

    // ③ tableau de litteraux, éventuellement joint
    const tableau = t.match(/^\[([\s\S]*)\]\s*(?:\.\s*join\s*\([^)]*\))?\s*$/)
    if (tableau) {
      const elements = decouperNiveauZero(tableau[1], ',')
        .map((e) => e.trim())
        .filter(Boolean)
        .map((e) => resoudre(e, profondeur + 1))
      if (!elements.some((x) => x === null)) return elements.join(', ')
    }

    // ④ gabarit avec interpolations résolubles
    if (/^`[\s\S]*`$/.test(t)) {
      const corps = t.slice(1, -1)
      let echec = false
      const rendu = corps.replace(/\$\{([^}]*)\}/g, (_, expr) => {
        const v = resoudre(expr, profondeur + 1)
        if (v === null) { echec = true; return '' }
        return v
      })
      if (!echec) return rendu
    }

    // ⑤ ternaire → union des deux branches
    const ternaire = decouperNiveauZero(t, '?')
    if (ternaire.length === 2) {
      const branches = decouperNiveauZero(ternaire[1], ':')
      if (branches.length === 2) {
        const a = resoudre(branches[0], profondeur + 1)
        const b = resoudre(branches[1], profondeur + 1)
        if (a !== null && b !== null) return `${a}, ${b}`
        if (a !== null) return a
        if (b !== null) return b
      }
    }

    // ① bis — concaténation, chaque morceau résolu séparément
    const parties = decouperNiveauZero(t, '+')
    if (parties.length > 1) {
      const morceaux = parties.map((p) => resoudre(p, profondeur + 1))
      if (!morceaux.some((x) => x === null)) return morceaux.join('')
    }
    return null
  }
  const valeurDe = (txt) => resoudre(txt)

  const ligneDe = (i) => net.slice(0, i).split('\n').length
  const extraitDe = (i) => {
    const lignes = src.split('\n')
    return (lignes[ligneDe(i) - 1] ?? '').trim().slice(0, 120)
  }

  const trouvees = []
  const pousser = (table, colonne, i, forme) => {
    if (!table || !colonne) return
    trouvees.push({ table, colonne, ligne: ligneDe(i), extrait: extraitDe(i), forme })
  }

  /** Attribue les colonnes d'une liste de select, embeds compris. */
  const attribuerSelect = (table, liste, i) => {
    const { colonnes, embeds } = analyserSelect(liste)
    for (const c of colonnes) {
      // `publications.status` dans un embed filtré : la table est explicite.
      if (c.includes('.')) continue
      pousser(table, c, i, 'select')
    }
    for (const e of embeds) attribuerSelect(e.table, e.liste, i)
  }

  /** Attribue les appels d'une chaîne dont la table est connue. */
  const attribuerChaine = (table, appels) => {
    for (const a of appels) {
      if (a.methode === 'select') {
        const brut = decouperNiveauZero(a.args, ',')[0] ?? ''
        const liste = valeurDe(brut)
        if (liste !== null) attribuerSelect(table, liste, a.index)
        else if (fichier && brut.trim() && !/^\s*['"`]?\s*\*/.test(brut)) {
          nonResolus.push({
            fichier,
            ligne: ligneDe(a.index),
            table,
            argument: brut.trim().replace(/\s+/g, ' ').slice(0, 60),
          })
        }
        continue
      }
      if (FILTRES.has(a.methode)) {
        const premier = valeurDe(decouperNiveauZero(a.args, ',')[0] ?? '')
        if (premier === null) continue
        // `referencedTable` deplace la cible.
        const options = decouperNiveauZero(a.args, ',').slice(1).join(',')
        const ref = options.match(/referencedTable\s*:\s*['"`]([a-z_0-9]+)['"`]/)
        const cible = ref ? ref[1] : table
        if (premier.includes('.')) {
          const [t, c] = premier.split('.')
          pousser(t, c, a.index, a.methode)
        } else {
          pousser(cible, premier, a.index, a.methode)
        }
        continue
      }
      if (a.methode === 'or') {
        const clause = valeurDe(decouperNiveauZero(a.args, ',')[0] ?? '')
        if (clause === null) continue
        const options = decouperNiveauZero(a.args, ',').slice(1).join(',')
        const ref = options.match(/referencedTable\s*:\s*['"`]([a-z_0-9]+)['"`]/)
        const cible = ref ? ref[1] : table
        for (const c of colonnesDuOr(clause)) pousser(cible, c, a.index, 'or')
        continue
      }
      if (ECRITURES.has(a.methode)) {
        const premier = decouperNiveauZero(a.args, ',')[0] ?? ''
        for (const c of clesDObjet(premier)) pousser(table, c, a.index, a.methode)
        // `.insert([{…}, {…}])`
        const tableau = premier.trim()
        if (tableau.startsWith('[')) {
          for (const e of decouperNiveauZero(tableau.slice(1, -1), ',')) {
            for (const c of clesDObjet(e)) pousser(table, c, a.index, a.methode)
          }
        }
        continue
      }
    }
  }

  /** variable → table, pour les chaînes construites en plusieurs morceaux. */
  const variables = new Map()

  // ── Les chaînes qui commencent par `.from('table')` ──────────────────────
  for (const m of net.matchAll(/\.\s*from\s*\(/g)) {
    const ouvrante = m.index + m[0].length - 1
    // Le stockage n'est pas une table : `supabase.storage.from('cv')`.
    const avant = net.slice(Math.max(0, m.index - 60), m.index)
    if (/\.storage\s*$/.test(avant)) continue
    const fermante = finDeParenthese(net, ouvrante)
    const table = valeurDe(net.slice(ouvrante + 1, fermante - 1))
    if (!table || !/^[a-z_][a-z0-9_]*$/.test(table)) continue

    const { appels, fin } = lireChaine(net, fermante)
    attribuerChaine(table, appels)

    // ── UNE CHAINE PEUT SE CONSTRUIRE EN PLUSIEURS MORCEAUX ────────────────
    //  `let q = admin.from('publications').select(…)` puis, plus bas,
    //  `if (x) q = q.eq('branch_id', …)`. Le second appel n'est pas dans la
    //  chaine : sans ce lien, les filtres conditionnels du vivier seraient
    //  invisibles. UN SEUL SAUT, et il est declare.
    const debutLigne = net.lastIndexOf('\n', m.index) + 1
    const affectation = net
      .slice(debutLigne, m.index)
      .match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[\w$.]*$/)
    if (affectation) variables.set(affectation[1], table)
    void fin
  }

  // ── Les reprises `q = q.eq(…)` ───────────────────────────────────────────
  for (const [nom, table] of variables) {
    const re = new RegExp(`\\b${nom}\\s*(?=\\.\\s*[A-Za-z_$])`, 'g')
    for (const m of net.matchAll(re)) {
      const { appels } = lireChaine(net, m.index + nom.length)
      attribuerChaine(table, appels)
    }
  }

  return trouvees
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. LE BALAYAGE DES CORPS SQL — UNE VUE MORTE NE CASSE QU'EN BASE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Rend `[{ table, colonne, forme }]` pour un corps de fonction ou de vue.
 *
 * L'attribution se fait par les alias de `from` / `join` / `update` / `insert`.
 * Une reference NON qualifiee n'est retenue que s'il n'y a QU'UNE table en
 * portee — sinon on ne sait pas de qui elle parle, et deviner serait pire que
 * se taire (§E.38).
 */
function citationsSql(corps) {
  const alias = new Map()
  const tables = new Set()
  const lier = (table, a) => {
    tables.add(table)
    if (a) alias.set(a.toLowerCase(), table)
    alias.set(table, table)
  }
  for (const m of corps.matchAll(
    /\b(?:from|join|update|into)\s+(?:only\s+)?public\.([a-z_0-9]+)(?:\s+(?:as\s+)?([a-z][a-z0-9_]*))?/gi,
  )) {
    const suivant = (m[2] ?? '').toLowerCase()
    const MOTS = new Set([
      'on', 'where', 'set', 'using', 'group', 'order', 'limit', 'having', 'left',
      'right', 'inner', 'outer', 'join', 'cross', 'values', 'select', 'returning', 'and', 'or',
    ])
    lier(m[1].toLowerCase(), MOTS.has(suivant) ? null : suivant)
  }

  // Les noms que plpgsql declare : parametres et variables locales. Les
  // retenir comme colonnes serait un faux positif, et un controle qui crie a
  // tort est desactive le jour meme (§E.14).
  const declares = new Set()
  for (const m of corps.matchAll(/\b(p_[a-z0-9_]+|v_[a-z0-9_]+)\b/gi)) declares.add(m[1].toLowerCase())
  const zoneDeclare = corps.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i)
  if (zoneDeclare) {
    for (const m of zoneDeclare[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s+/gim)) declares.add(m[1].toLowerCase())
  }

  const out = []
  // ── Références QUALIFIÉES : `m.score`, `publications.matching_stats` ──────
  for (const m of corps.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
    const t = alias.get(m[1].toLowerCase())
    if (!t) continue
    out.push({ table: t, colonne: m[2].toLowerCase(), forme: 'sql qualifiée' })
  }
  // ── Références NON qualifiées, et seulement si UNE table en portée ───────
  if (tables.size === 1) {
    const [t] = tables
    for (const m of corps.matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)) {
      const nom = m[1].toLowerCase()
      if (declares.has(nom)) continue
      if (corps[m.index - 1] === '.') continue
      out.push({ table: t, colonne: nom, forme: 'sql non qualifiée' })
    }
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. LA PREUVE SUR LE CAS CONNU, AVANT TOUT BALAYAGE (§E.33)
   ═══════════════════════════════════════════════════════════════════════════ */

section('Le motif est éprouvé sur le cas connu AVANT de balayer')

/**
 * LE TEMOIN EST CE QUI A DISPARU, pas ce qui l'entourait. C'est la ligne exacte
 * de `app/api/me/missions/[id]/route.ts` telle qu'elle etait le 22/09/2026 —
 * celle qui empechait toute mission de s'ouvrir.
 */
const TEMOIN_DEFAUT = `
const { data: match, error: mErr } = await auth.supabaseAdmin
  .from('matches')
  .select('id, publication_id, score, status, explanation, created_at')
  .eq('publication_id', publicationId)
  .eq('profile_id', profile.id)
  .maybeSingle()
`
const TEMOIN_CORRECTIF = `
const { data: match, error: mErr } = await auth.supabaseAdmin
  .from('matches')
  .select('id, publication_id, relevance_score, relevance_tier, status, explanation, created_at')
  .eq('publication_id', publicationId)
  .eq('profile_id', profile.id)
  .maybeSingle()
`
/** La MEME colonne, sur la table ou elle est VIVANTE. Le contrôle doit se taire. */
const TEMOIN_VOISIN = `
const { data } = await supabaseAdmin
  .from('matching_notes_partielles')
  .select('profile_id, score, model, empreinte')
  .eq('publication_id', publicationId)
`
/** Une colonne RENOMMEE, sur la table qui l'a perdue, et sur celle qui l'a gardée. */
const TEMOIN_RENOMMEE = `
await admin.from('publications').select('id, title, location')
await admin.from('profiles').select('id, title, location')
`

const mortesDe = (src) =>
  citationsDe(src).filter((c) => estMorte(c.table, c.colonne))

{
  const vues = mortesDe(TEMOIN_DEFAUT)
  ok(
    vues.length === 1 && vues[0].table === 'matches' && vues[0].colonne === 'score',
    'il VOIT le défaut fondateur — `matches.score` dans le select du détail de mission',
    `attendu 1 (matches.score), vu ${vues.length} : ${vues.map((v) => v.table + '.' + v.colonne).join(', ')}`,
  )
  ok(
    mortesDe(TEMOIN_CORRECTIF).length === 0,
    '… et il se TAIT sur le correctif (`relevance_score`, `relevance_tier`)',
  )
  ok(
    mortesDe(TEMOIN_VOISIN).length === 0,
    '… et sur `score` là où elle est VIVANTE (`matching_notes_partielles`)',
    'sans attribution de table, ce témoin rougirait — et le contrôle serait désactivé dans la semaine',
  )
  const renommees = mortesDe(TEMOIN_RENOMMEE)
  ok(
    renommees.length === 1 && renommees[0].table === 'publications',
    'il distingue `publications.location` (RENOMMÉE) de `profiles.location` (vivante)',
    `vu : ${renommees.map((v) => v.table + '.' + v.colonne).join(', ') || 'rien'}`,
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. LE BALAYAGE
   ═══════════════════════════════════════════════════════════════════════════ */

const fichiers = []
const parcourir = (d) => {
  for (const e of readdirSync(d)) {
    if (EXCLUS_DOSSIER.has(e)) continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) parcourir(p)
    else if (/\.(ts|tsx|mjs|mts)$/.test(e)) fichiers.push(p)
  }
}
for (const r of RACINES) {
  const d = join(ROOT, r)
  if (existsSync(d)) parcourir(d)
}

// Les constantes de tout le dépôt : `PUBLICATION_SYNTHESIS_SELECT` est déclarée
// dans un fichier et lue dans trois autres.
for (const f of fichiers) {
  for (const [k, v] of constantesDe(depouillerJs(readFileSync(f, 'utf8')))) {
    if (!GLOBALES.has(k)) GLOBALES.set(k, v)
  }
}

/* ── LE SECOND FILET : LES NOMS MORTS SUR TOUTES LES TABLES ────────────────
   Une liste de colonnes que l'attribution n'a pas su rattacher reste lisible
   pour UN sous-ensemble : les noms qu'AUCUNE table vivante ne porte. Sur
   ceux-la, l'attribution est inutile — le nom suffit, et il n'existe aucun
   faux positif possible.

   ⚠️ CE JEU EST PETIT, ET SA TAILLE SE DIT : `score` est vivante sur
      `matching_notes_partielles`, `location` sur `profiles`, `seniority` et
      `speciality_id` sur `profile_alerts` (une des onze tables heritees de la
      baseline, §B.1). Le filet ne les couvre donc PAS — c'est la section 1 qui
      les tient, par attribution. Mesure du 22/09/2026 : 9 noms sur 21. */
const vivantesPartout = new Set()
for (const t of schema.values()) for (const c of t.colonnes.keys()) vivantesPartout.add(c)
const mortesPartout = new Map()
for (const m of mortes.values()) {
  if (/^_backup_/.test(m.table)) continue
  if (!vivantesPartout.has(m.colonne)) mortesPartout.set(m.colonne, m)
}

/** Une liste de colonnes : au moins deux identifiants snake_case virgules. */
const estListeDeColonnes = (c) =>
  /^[\s(]*[a-z][a-z0-9_]*\s*(\([^)]*\))?\s*(,\s*[a-z][a-z0-9_]*\s*(\([^)]*\))?\s*)+,?\s*$/.test(c)

function nonAttribuees(src) {
  const net = depouillerJs(src)
  const out = []
  let i = 0
  while (i < net.length) {
    const c = net[i]
    if (c === "'" || c === '"' || c === '`') {
      const fin = finDeChaine(net, i)
      const valeur = litteral(net.slice(i, fin))
      if (valeur !== null && estListeDeColonnes(valeur)) {
        const ligne = net.slice(0, i).split('\n').length
        for (const nom of valeur.split(',').map((x) => x.trim().split('(')[0].trim())) {
          const m = mortesPartout.get(nom)
          if (m) out.push({ colonne: nom, table: m.table, ligne, mort: m, forme: 'liste non attribuée' })
        }
      }
      i = fin
      continue
    }
    i++
  }
  return out
}

const trouvailles = []
const trouvaillesLarges = []
for (const f of fichiers) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  if (EXEMPTIONS[rel] || estMoi(f)) continue
  const src = readFileSync(f, 'utf8').split('\r\n').join('\n')
  const attribuees = citationsDe(src, GLOBALES, rel)
  for (const c of attribuees) {
    const m = estMorte(c.table, c.colonne)
    if (m) trouvailles.push({ fichier: rel, ...c, mort: m })
  }
  // Ce que la section 1 a deja vu ne se recompte pas.
  const vues = new Set(attribuees.map((c) => `${c.ligne}:${c.colonne}`))
  for (const c of nonAttribuees(src)) {
    if (vues.has(`${c.ligne}:${c.colonne}`)) continue
    trouvaillesLarges.push({ fichier: rel, ...c })
  }
}

// ── Les corps SQL qui survivent ────────────────────────────────────────────
const trouvaillesSql = []
for (const [nom, def] of fonctions) {
  for (const c of citationsSql(def.corps)) {
    const m = estMorte(c.table, c.colonne)
    if (m) {
      trouvaillesSql.push({
        fichier: `supabase/migrations/${def.migration}`,
        fonction: nom,
        ...c,
        mort: m,
      })
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. LES SORTIES
   ═══════════════════════════════════════════════════════════════════════════ */

if (REGISTRE) {
  section('Le registre des colonnes MORTES, dérivé des migrations')
  const hors = [...mortes.values()].filter((m) => !/^_backup_/.test(m.table))
  console.log(`  ${mortes.size} colonnes mortes au total, dont ${hors.length} hors tables héritées\n`)
  for (const m of hors.sort((a, b) => (a.table + a.colonne).localeCompare(b.table + b.colonne))) {
    console.log(
      `  ${(m.table + '.' + m.colonne).padEnd(48)} ${m.cause.padEnd(14)} ${m.vers ? '→ ' + m.vers : ''}  ${m.migration}`,
    )
  }
  console.log()
  process.exit(0)
}

if (RESTE) {
  section('Les lectures de colonnes mortes, fichier par fichier')
  const parFichier = new Map()
  for (const t of [...trouvailles, ...trouvaillesSql]) {
    if (!parFichier.has(t.fichier)) parFichier.set(t.fichier, [])
    parFichier.get(t.fichier).push(t)
  }
  for (const [f, liste] of [...parFichier.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(liste.length).padStart(3)}  ${f}`)
    for (const t of liste) {
      console.log(
        `       ${t.ligne ? `${t.ligne}:` : ''}${t.fonction ? ` ${t.fonction}()` : ''} [${t.table}.${t.colonne}] (${t.forme}) — ${t.mort.cause}${t.mort.vers ? ' → ' + t.mort.vers : ''}`,
      )
      if (t.extrait) console.log(`         ${t.extrait}`)
    }
  }
  console.log()
  process.exit(0)
}

section('Aucune lecture ne cite une colonne supprimée')

ok(mortes.size > 0, `${mortes.size} colonne(s) morte(s) dérivée(s) des migrations`)
ok(fichiers.length > 0, `${fichiers.length} fichier(s) balayé(s) dans ${RACINES.join(', ')}`)
ok(fonctions.size > 0, `${fonctions.size} fonction(s)/vue(s) SQL, dernière définition retenue`)

ok(
  trouvailles.length === 0,
  `aucune lecture applicative d'une colonne morte (${trouvailles.length})`,
  trouvailles
    .slice(0, 12)
    .map((t) => `${t.fichier}:${t.ligne} lit ${t.table}.${t.colonne} (${t.mort.cause} par ${t.mort.migration})`)
    .join(' · '),
)

ok(
  trouvaillesLarges.length === 0,
  `aucune liste NON ATTRIBUÉE ne cite un nom mort partout (${trouvaillesLarges.length}, sur ${mortesPartout.size} noms)`,
  trouvaillesLarges
    .slice(0, 12)
    .map((t) => `${t.fichier}:${t.ligne} cite ${t.colonne} (morte sur ${t.table})`)
    .join(' · '),
)

ok(
  trouvaillesSql.length === 0,
  `aucune fonction ni vue SQL ne lit une colonne morte (${trouvaillesSql.length})`,
  trouvaillesSql
    .slice(0, 12)
    .map((t) => `${t.fonction}() lit ${t.table}.${t.colonne}`)
    .join(' · '),
)

/* ── L'exemption et sa sentinelle ────────────────────────────────────────── */
{
  /* ⚠️ SUR LE SOURCE DEPOUILLE, ET LA PREMIERE VERSION NE L'ETAIT PAS.
        Elle a rougi immediatement, sur TROIS commentaires — dont le sien et
        celui de `lib/database.types.ts`, qui cite la forme pour expliquer
        qu'elle n'est pas employee. §E.7, dans le controle meme qui s'en
        reclame : un commentaire n'a jamais type un client. */
  const typesUtilises = fichiers.some(
    (f) =>
      !estMoi(f) && /createClient\s*<\s*Database\b/.test(depouillerJs(readFileSync(f, 'utf8'))),
  )
  ok(
    !typesUtilises,
    'la sentinelle de `lib/database.types.ts` tient — aucun `createClient<Database>`',
    "le fichier de types cesse d'être inerte : son exemption tombe, il doit être régénéré ou balayé",
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   CE QUE L'ATTRIBUTION N'A PAS SU LIRE — NOMMÉ, JAMAIS TU (§E.38)
   ═══════════════════════════════════════════════════════════════════════════ */

section('Les selects que le résolveur à un saut ne sait pas lire')

if (nonResolus.length === 0) {
  console.log('  aucun.\n')
} else {
  console.log(
    `  ${nonResolus.length} sur ${nonResolus.length + trouvailles.length + 0} — la table est connue, la LISTE ne l'est pas.\n`,
  )
  for (const n of nonResolus.sort((a, b) => a.fichier.localeCompare(b.fichier))) {
    console.log(`  ${`${n.fichier}:${n.ligne}`.padEnd(52)} from('${n.table}').select(${n.argument})`)
  }
  console.log(
    '\n  Ces listes sont assemblées à l’exécution : un helper, un paramètre, une\n' +
      '  option. Le second filet les couvre pour les 9 noms morts PARTOUT ; pour les\n' +
      '  autres, elles se lisent à la main. C’est une dette écrite, pas un zéro.\n',
  )
}

section('Ce que ce contrôle ne vérifie pas')

note("l'ETAT REEL de la base. Il lit des fichiers (§E.12) : une colonne supprimee")
note('a la main dans l editeur SQL lui echappe — raison de plus de ne pas le faire.')
note('les chaines CONSTRUITES a l execution : un select assemble par une fonction,')
note('une table choisie par une variable calculee. Un seul saut est resolu, et il')
note('est declare (§E.42).')
note('les colonnes citees SANS leur table et sans chaine `.from(` : un objet')
note('d options, une cle de tri passee de composant en composant.')
note('les RPC : une fonction appelee par `.rpc(…)` recoit des PARAMETRES, pas des')
note('colonnes. Son corps, lui, est balaye — c est la section SQL.')

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} CONTRÔLE(S) EN ÉCHEC — `)
  console.log('   `--reste` liste ce qui reste, `--registre` le registre des mortes.\n')
  process.exit(1)
}
console.log('✅ Aucune colonne supprimée n’est citée par le dépôt.\n')
process.exit(0)
