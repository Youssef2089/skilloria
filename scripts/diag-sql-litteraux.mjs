// scripts/diag-sql-litteraux.mjs — VALIDATEUR DE LITTÉRAUX SQL.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE SCRIPT EXISTE
//   Une migration a échoué TROIS FOIS au push. La troisième sur ceci :
//
//     ERROR: syntax error at or near "E'APRÈS le repli : la contrainte ..."
//     (SQLSTATE 42601)
//
//   La cause est une règle de PostgreSQL qu'on croit connaître et qu'on énonce
//   de travers. Deux constantes de chaîne séparées par un saut de ligne sont
//   concaténées :
//
//     'première partie '
//     'seconde partie'          -- OK
//
//   MAIS la continuation doit être une chaîne SIMPLE. Un littéral d'échappement
//   en deuxième position est une ERREUR DE SYNTAXE :
//
//     E'première partie \n'
//     E'seconde partie'         -- ERREUR 42601
//
//   Ce n'est pas rattrapable à la relecture : le fichier « a l'air » correct,
//   et l'erreur ne sort qu'au push, sur la base de quelqu'un d'autre. D'où ce
//   validateur, qui lit le SQL comme le ferait un analyseur lexical.
//
// CE QU'IL VÉRIFIE
//   1. CONTINUATION INVALIDE — un E'...' en position de continuation.
//   2. CONCATÉNATION SANS SAUT DE LIGNE — 'a' 'b' sur la même ligne, que
//      PostgreSQL refuse également.
//   3. CONSTRUCTIONS NON TERMINÉES — chaîne ou bloc $tag$ jamais refermé.
//   4. RAISE MAL FORMÉ — le nombre de « % » du message ne correspond pas au
//      nombre d'arguments fournis. Erreur d'exécution, pas de syntaxe : elle ne
//      sort qu'au moment où le message part, c'est-à-dire au pire moment.
//
// CE QU'IL NE VÉRIFIE PAS — à dire honnêtement
//   Ce n'est PAS un analyseur SQL complet. Il ne valide ni la grammaire, ni les
//   noms de colonnes, ni les types. Il couvre une classe d'erreurs précise,
//   celle qui a coûté trois push. Une migration verte ici peut encore échouer
//   pour une autre raison ; elle n'échouera plus pour celle-là.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-sql-litteraux.mjs                  → toutes les migrations
//   node scripts/diag-sql-litteraux.mjs <chemin.sql> ... → des fichiers précis
//                                                          (y compris hors de
//                                                          ce worktree)
//
// AUCUN accès base, AUCUN réseau, AUCUNE variable d'environnement.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Analyse lexicale d'un fichier SQL PostgreSQL.
 *
 * Reconnaît, dans l'ordre de priorité du lexer réel : les blocs $tag$…$tag$
 * (dans lesquels RIEN n'est interprété), les commentaires -- et /* *\/, les
 * chaînes '…' avec doublement du quote, et les chaînes E'…' avec échappement
 * par barre oblique inverse.
 *
 * Rend la liste des constantes de chaîne rencontrées (position, ligne, préfixe
 * E ou non) et la liste des anomalies de structure.
 */
function lexer(src) {
  const chaines = []
  const anomalies = []
  const ligneDe = (i) => src.slice(0, i).split('\n').length

  // Pile des blocs $tag$ ouverts dont le contenu est du CODE (corps de fonction
  // ou bloc DO) et doit donc être analysé comme tel.
  const pileCode = []

  /**
   * Un bloc $tag$ contient-il du CODE ou du TEXTE ?
   *
   * C'est LA distinction qui manquait, et son absence rendait ce validateur
   * inutile : tous les `raise` d'une migration vivent dans un `do $$ … $$`, et
   * sauter ces blocs revenait à ne rien vérifier. L'auto-test l'a montré.
   *
   * Mais on ne peut pas non plus analyser tous les blocs : un
   * `comment on … is $$Compteurs d'un run…$$` contient des apostrophes de
   * français qui ne sont pas des quotes SQL. Les analyser produirait une
   * fausse alerte « chaîne jamais refermée ».
   *
   * Le mot qui précède tranche, et il suffit : `as` (corps de fonction) et
   * `do` (bloc anonyme) introduisent du code. Tout le reste — `is`, une
   * virgule, une parenthèse — introduit du texte, qu'on laisse opaque.
   */
  const introduitDuCode = (pos) => {
    let k = pos - 1
    while (k >= 0 && /\s/.test(src[k])) k--
    let motFin = k + 1
    while (k >= 0 && /[A-Za-z_]/.test(src[k])) k--
    return /^(as|do)$/i.test(src.slice(k + 1, motFin))
  }

  let i = 0
  while (i < src.length) {
    const c = src[i]
    const deux = src.slice(i, i + 2)

    // ── Bloc $tag$ … $tag$ ────────────────────────────────────────────────
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i))
      if (m) {
        const tag = m[0]

        // Fermeture d'un bloc de code ouvert plus haut.
        if (pileCode.length > 0 && pileCode[pileCode.length - 1] === tag) {
          pileCode.pop()
          i += tag.length
          continue
        }

        if (introduitDuCode(i)) {
          // CODE : on entre dedans et on continue d'analyser normalement.
          pileCode.push(tag)
          i += tag.length
          continue
        }

        // TEXTE : opaque, on saute jusqu'à la fermeture.
        const fin = src.indexOf(tag, i + tag.length)
        if (fin === -1) {
          anomalies.push({ ligne: ligneDe(i), quoi: `bloc ${tag} jamais refermé` })
          break
        }
        i = fin + tag.length
        continue
      }
    }

    // ── Commentaire de ligne ──────────────────────────────────────────────
    if (deux === '--') {
      const fin = src.indexOf('\n', i)
      i = fin === -1 ? src.length : fin
      continue
    }

    // ── Commentaire de bloc (imbricable en PostgreSQL) ───────────────────
    if (deux === '/*') {
      let profondeur = 1
      i += 2
      while (i < src.length && profondeur > 0) {
        if (src.slice(i, i + 2) === '/*') { profondeur++; i += 2 }
        else if (src.slice(i, i + 2) === '*/') { profondeur--; i += 2 }
        else i++
      }
      if (profondeur > 0) anomalies.push({ ligne: ligneDe(i), quoi: 'commentaire /* jamais refermé' })
      continue
    }

    // ── Chaîne d'échappement E'…' ────────────────────────────────────────
    if ((c === 'E' || c === 'e') && src[i + 1] === "'") {
      const debut = i
      i += 2
      let clos = false
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }        // échappement
        if (src[i] === "'" && src[i + 1] === "'") { i += 2; continue } // '' doublé
        if (src[i] === "'") { i++; clos = true; break }
        i++
      }
      if (!clos) anomalies.push({ ligne: ligneDe(debut), quoi: "chaîne E'…' jamais refermée" })
      chaines.push({ debut, fin: i, ligne: ligneDe(debut), echappement: true })
      continue
    }

    // ── Chaîne simple '…' ────────────────────────────────────────────────
    if (c === "'") {
      const debut = i
      i += 1
      let clos = false
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") { i += 2; continue } // '' doublé
        if (src[i] === "'") { i++; clos = true; break }
        i++
      }
      if (!clos) anomalies.push({ ligne: ligneDe(debut), quoi: "chaîne '…' jamais refermée" })
      chaines.push({ debut, fin: i, ligne: ligneDe(debut), echappement: false })
      continue
    }

    i++
  }

  for (const tag of pileCode) {
    anomalies.push({ ligne: ligneDe(src.length), quoi: `bloc ${tag} jamais refermé` })
  }

  return { chaines, anomalies }
}

/** Contenu d'une constante, quotes et préfixe retirés, '' ramené à '. */
const contenu = (src, ch) =>
  src.slice(ch.debut + (ch.echappement ? 2 : 1), ch.fin - 1).replace(/''/g, "'")

/**
 * Deux constantes se suivent-elles en position de CONCATÉNATION ? C'est le cas
 * quand l'intervalle qui les sépare ne contient que des blancs et des
 * commentaires — PostgreSQL traite un commentaire comme un blanc.
 */
function intervalle(src, a, b) {
  const brut = src.slice(a.fin, b.debut)
  const sansCommentaires = brut
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
  return { brut, blanc: /^\s*$/.test(sansCommentaires) }
}

let erreurs = 0
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const ok = (cond, label, detail) => {
  if (cond) console.log(`  ok   ${label}`)
  else { erreurs++; console.log(`  KO   ${label}${detail ? `\n       → ${detail}` : ''}`) }
}

function problemesDe(src) {
  const { chaines, anomalies } = lexer(src)
  const problemes = []

  // ── 1 & 2 : les concaténations ────────────────────────────────────────
  for (let k = 1; k < chaines.length; k++) {
    const a = chaines[k - 1]
    const b = chaines[k]
    const { brut, blanc } = intervalle(src, a, b)
    if (!blanc) continue

    if (b.echappement) {
      problemes.push(
        `ligne ${b.ligne} — CONTINUATION INVALIDE : un littéral E'…' suit une autre ` +
        `constante (ligne ${a.ligne}). PostgreSQL refuse (42601). ` +
        `Retirer le préfixe E, ou fusionner en un seul littéral.`,
      )
    } else if (!brut.includes('\n')) {
      problemes.push(
        `ligne ${b.ligne} — CONCATÉNATION SANS SAUT DE LIGNE : deux constantes ` +
        `adjacentes sur la même ligne. PostgreSQL exige au moins un saut de ligne ` +
        `entre elles, ou un opérateur ||.`,
      )
    }
  }

  // ── 3 : constructions non terminées ───────────────────────────────────
  for (const a of anomalies) problemes.push(`ligne ${a.ligne} — ${a.quoi}`)

  // ── 4 : raise — « % » du message contre arguments fournis ─────────────
  for (const m of src.matchAll(/\braise\s+(notice|exception|warning|info|log|debug)?\s*/gi)) {
    const apres = m.index + m[0].length
    // Le mot-clé doit être du code : on l'ignore s'il tombe dans une chaîne.
    if (chaines.some((c) => m.index >= c.debut && m.index < c.fin)) continue

    // Message = la suite immédiate de constantes concaténées.
    const morceaux = []
    let curseur = apres
    for (const c of chaines) {
      if (c.debut < curseur) continue
      if (!/^\s*$/.test(src.slice(curseur, c.debut).replace(/--[^\n]*/g, ' '))) break
      morceaux.push(c)
      curseur = c.fin
    }
    if (morceaux.length === 0) continue // raise sans message (re-raise) : rien à vérifier

    const message = morceaux.map((c) => contenu(src, c)).join('')
    const attendus = (message.match(/%/g) ?? []).length - 2 * (message.match(/%%/g) ?? []).length
    if (attendus <= 0) continue

    // Arguments : expressions séparées par des virgules de profondeur 0,
    // jusqu'au « ; » de fin d'instruction.
    let j = curseur
    let profondeur = 0
    let fournis = 0
    let vuArgument = false
    while (j < src.length) {
      const ch = src[j]
      const dansChaine = chaines.find((c) => j >= c.debut && j < c.fin)
      if (dansChaine) { vuArgument = true; j = dansChaine.fin; continue }
      if (src.slice(j, j + 2) === '--') { j = src.indexOf('\n', j); if (j === -1) break; continue }
      if (ch === '(' || ch === '[') profondeur++
      else if (ch === ')' || ch === ']') profondeur--
      else if (ch === ';' && profondeur <= 0) break
      else if (ch === ',' && profondeur === 0) { if (vuArgument) fournis++; vuArgument = false }
      else if (!/\s/.test(ch)) vuArgument = true
      j++
    }
    if (vuArgument) fournis++
    // Pas de correction à appliquer : la virgule qui sépare le message des
    // arguments arrive alors qu'aucun argument n'a encore été vu, donc elle
    // n'incrémente rien. Une soustraction « pour la compenser » décalait tout
    // d'un rang et faisait crier au loup sur douze migrations déjà en
    // production — trouvé par l'auto-test.

    if (fournis !== attendus) {
      problemes.push(
        `ligne ${morceaux[0].ligne} — RAISE MAL FORMÉ : ${attendus} « % » dans le ` +
        `message, ${fournis} argument(s) fourni(s). Erreur d'exécution garantie.`,
      )
    }
  }

  return { problemes, nbChaines: chaines.length }
}

function analyser(chemin, etiquette) {
  const { problemes, nbChaines } = problemesDe(readFileSync(chemin, 'utf8'))
  ok(problemes.length === 0,
    `${etiquette}  (${nbChaines} constantes)`,
    problemes.length ? problemes.join('\n       → ') : undefined)
}

/**
 * AUTO-TEST — le validateur se prouve à CHAQUE exécution.
 *
 * Un validateur qu'on ne vérifie pas est pire qu'aucun validateur : il donne
 * une confiance qu'il ne mérite pas. Ces cas sont exactement les quatre classes
 * d'erreur qu'il prétend attraper, plus les formes VALIDES qu'il ne doit
 * surtout pas signaler — un faux positif ferait retirer un E'…' légitime.
 *
 * Le premier cas est, mot pour mot, la forme qui a fait échouer le troisième
 * push.
 */
function autotest() {
  const cas = [
    // [libellé, source, doit-il être signalé ?, motif attendu]
    ["le bug réel : E'…' en continuation",
      "do $$ begin raise exception\n    E'debut '\n    E'suite \\n fin';\nend $$;",
      true, /CONTINUATION INVALIDE/],
    ['deux constantes adjacentes sur la même ligne',
      "select 'abc' 'def';",
      true, /SANS SAUT DE LIGNE/],
    ['bloc $tag$ jamais refermé',
      'create function f() returns int language plpgsql as $fn$\nbegin return 1; end\n',
      true, /jamais refermé/],
    ["chaîne '…' jamais refermée",
      "select 'abc;\n",
      true, /jamais refermée/],
    ['raise : deux % pour un seul argument',
      "do $$ declare a int; begin raise exception 'il y a % lignes : %', a; end $$;",
      true, /RAISE MAL FORMÉ/],

    // ── Formes VALIDES : aucune ne doit être signalée ────────────────────
    ['VALIDE : concaténation simple sur plusieurs lignes',
      "do $$ declare v text; begin raise notice 'premiere '\n  'seconde : %', v; end $$;",
      false],
    ["VALIDE : E'…' isolé, pas en continuation",
      "do $$ declare v text; begin select string_agg(x, E'\\n') into v from t; end $$;",
      false],
    ['VALIDE : deux constantes séparées par ||',
      "select 'abc' || 'def';",
      false],
    ['VALIDE : virgules imbriquées dans les arguments d un raise',
      "do $$ declare t text; begin raise exception 'a %', left(coalesce(t, ''), 60); end $$;",
      false],
    ['VALIDE : %% littéral, aucun argument attendu',
      "do $$ begin raise notice 'cent %% de reussite'; end $$;",
      false],
    ['VALIDE : un E dans un commentaire ne compte pas',
      "-- attention au E'…' en continuation\nselect 1;",
      false],
  ]

  let mordus = 0
  for (const [libelle, src, doitSignaler, motif] of cas) {
    const { problemes } = problemesDe(src)
    const signale = problemes.length > 0
    const bon = signale === doitSignaler && (!motif || problemes.some((p) => motif.test(p)))
    if (bon) mordus++
    ok(bon, libelle,
      bon ? undefined
        : doitSignaler
          ? `non détecté (ou motif inattendu) : ${problemes.join(' | ') || 'aucun problème remonté'}`
          : `faux positif : ${problemes.join(' | ')}`)
  }
  return mordus === cas.length
}

// ══════════════════════════════════════════════════════════════════════════
section('AUTO-TEST — le validateur mord-il encore ?')
autotest()

const args = process.argv.slice(2)
let cibles

if (args.length > 0) {
  cibles = args.map((a) => ({ chemin: a, etiquette: basename(a) }))
  for (const c of cibles) {
    if (!existsSync(c.chemin)) {
      console.error(`\n❌ fichier introuvable : ${c.chemin}\n`)
      process.exit(1)
    }
  }
  section('VALIDATION DE LITTÉRAUX SQL — fichiers désignés')
} else {
  const dir = join(ROOT, 'supabase/migrations')
  cibles = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ chemin: join(dir, f), etiquette: f }))
  section(`VALIDATION DE LITTÉRAUX SQL — ${cibles.length} migrations`)
}

for (const c of cibles) analyser(c.chemin, c.etiquette)

console.log(
  erreurs === 0
    ? '\n✅ Aucun littéral mal formé.\n'
    : `\n❌ ${erreurs} fichier(s) en défaut.\n`,
)
process.exit(erreurs === 0 ? 0 : 1)
