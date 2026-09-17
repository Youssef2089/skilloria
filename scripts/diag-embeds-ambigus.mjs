// scripts/diag-embeds-ambigus.mjs — DEUX CLES ETRANGERES ENTRE DEUX TABLES,
//                                   ET POSTGREST REFUSE DE CHOISIR.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE DEFAUT QU'ON FERME — ET IL ETAIT EN LIGNE SUR STAGING
//
//   La migration `20260914200010_siege_administrateur` a ajoute une SECONDE
//   cle etrangere entre `organizations` et `organization_members` :
//   `organizations_siege_admin_fkey`, composite, dans le sens inverse de la
//   premiere.
//
//   A partir de cet instant, TOUT embed PostgREST entre ces deux tables a
//   cesse de fonctionner :
//
//     « Could not embed because more than one relationship was found
//       for 'organization_members' and 'organizations' »
//
//   NEUF requetes du depot etaient dans ce cas, dont `loadOrganizationContext`
//   dans lib/auth-guard.ts — qui retourne `null` sur erreur. Consequence :
//   TOUT membre d'une organisation devenait « sans organisation », et chaque
//   route gardee repondait 403 `no_organization`. Le dashboard entreprise
//   entier etait mort, sur staging comme sur toute base neuve.
//
//   POURQUOI PERSONNE NE L'A VU :
//     · `npx tsc` ne voit rien — l'embed est une CHAINE (§E.1) ;
//     · `next build` ne voit rien, pour la meme raison ;
//     · la migration s'applique sans erreur : le schema est VALIDE, c'est la
//       LECTURE qui devient ambigue ;
//     · et la panne ne se voit qu'en etant CONNECTE comme membre d'une
//       organisation — ce qu'aucun controle statique ne fait.
//
//   Trouve en rejouant les migrations sur une base vierge, puis confirme sur
//   staging. C'est exactement la famille §E.1 : une erreur qu'aucun outil de
//   compilation ne peut attraper, qui n'apparait qu'a l'execution.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'IL FAIT
//   ① Reconstruit le graphe des cles etrangeres depuis supabase/migrations.
//   ② Compte les liens par PAIRE de tables, quel que soit leur sens.
//   ③ Balaie app/ + lib/ + components/ : tout embed `Y(` dans un
//      `.from('X').select(...)` ou la paire {X,Y} porte PLUS D'UN lien doit
//      nommer sa contrainte (`Y!nom_de_contrainte(`).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUI A ETE AJOUTE APRES COUP, ET POURQUOI
//
//   ④ LES SELECTS NON LITTERAUX. La forme originale ne lisait que les
//      `.select('…')` ecrits sur place. Or DIX lectures du depot passent une
//      CONSTANTE ou un parametre. L'une d'elles, `SELECT_PROFIL` dans
//      lib/matching/pool.ts, porte un embed SUR UNE PAIRE AMBIGUE
//      (`profiles ↔ users`) : le controle etait vert dessus PAR AVEUGLEMENT.
//      Retirer son `!profiles_user_id_fkey` n'aurait rien fait rougir, et le
//      vivier du moteur serait mort.
//      Les constantes du MEME fichier sont desormais resolues. Celles qu'on ne
//      peut pas resoudre (un parametre, un constructeur) sont DITES, nommement
//      — un controle qui invente un verdict sur ce qu'il ne lit pas fait croire
//      a une couverture qui n'existe pas (§E.12).
//
//   ⑤ LE GRAPHE LUI-MEME, GELE. C'est la vraie lecon de la panne : elle n'a
//      ete creee par AUCUN embed. Une migration a rendu ambigue une paire qui
//      ne l'etait pas, et vingt lectures ecrites des mois plus tot sont mortes
//      d'un coup. Le controle defendait donc un ETAT — « les embeds actuels
//      sont bien nommes » — quand le danger est un CHANGEMENT.
//      Les paires ambigues sont desormais GELEES. Une septieme fait rougir AU
//      MOMENT OU LA MIGRATION EST ECRITE, avant qu'elle soit appliquee, et le
//      controle NOMME les lectures qui vont casser.
//
// ⚠️ CE QU'IL NE PROUVE PAS, et il faut le dire
//   Il lit les MIGRATIONS, pas la base. Une cle posee a la main en base lui
//   echappe (§E.10) — mais sur une base neuve, qui est le seul cas ou la
//   production se construit, les migrations FONT foi.
//   Il ne verifie pas non plus que le nom de contrainte cite EXISTE : c'est le
//   role du rejeu, pas d'un balayage de texte.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-embeds-ambigus.mjs
//
// AUCUN acces base, AUCUN reseau. Lecture seule du depot.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sqlCodeSeul } from './_sql-lecture.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES (§E.3) : les motifs ci-dessous traversent des
// sauts de ligne — un `.select(...)` s'ecrit sur plusieurs lignes.
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

const sansCommentaires = (src) =>
  src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ─────────────────────────────────────────────────────────────────────────────
// ① LE GRAPHE DES CLES ETRANGERES, DEPUIS LES MIGRATIONS
// ─────────────────────────────────────────────────────────────────────────────
const DOSSIER_MIGRATIONS = 'supabase/migrations'
const fichiersSql = readdirSync(join(ROOT, DOSSIER_MIGRATIONS))
  .filter((f) => f.endsWith('.sql'))
  .sort()

if (fichiersSql.length === 0) {
  console.error('Aucune migration lue — le controle serait vert faute de matiere. Arret.')
  process.exit(2)
}

/** Nettoie `"public"."organizations"` → `organizations`. */
const nomTable = (brut) => brut.replace(/"/g, '').replace(/^public\./i, '').trim().toLowerCase()

/** paire triee « a|b » → nombre de liens, et leurs noms. */
const liensParPaire = new Map()
const ajouterLien = (a, b, nom) => {
  if (!a || !b || a === b) return
  const cle = [a, b].sort().join('|')
  if (!liensParPaire.has(cle)) liensParPaire.set(cle, new Set())
  liensParPaire.get(cle).add(nom)
}

for (const f of fichiersSql) {
  const code = sqlCodeSeul(lire(DOSSIER_MIGRATIONS + '/' + f))

  // Forme 1 — `ALTER TABLE [ONLY] X ADD CONSTRAINT C FOREIGN KEY (…) REFERENCES Y`
  for (const m of code.matchAll(
    /alter\s+table\s+(?:only\s+)?([\w".]+)[\s\S]{0,400}?add\s+constraint\s+([\w"]+)[\s\S]{0,200}?foreign\s+key\s*\([^)]*\)\s*references\s+([\w".]+)/gi,
  )) {
    ajouterLien(nomTable(m[1]), nomTable(m[3]), m[2].replace(/"/g, ''))
  }

  // Forme 2 — contrainte nommee DANS un `create table`.
  for (const m of code.matchAll(
    /create\s+table[^;]*?\b(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi,
  )) {
    const table = nomTable(m[1])
    for (const r of m[2].matchAll(
      /constraint\s+([\w"]+)\s+foreign\s+key\s*\([^)]*\)\s*references\s+([\w".]+)/gi,
    )) {
      ajouterLien(table, nomTable(r[2]), r[1].replace(/"/g, ''))
    }
    // Forme 3 — `references Y(id)` en ligne, sans nom : Postgres en derive un.
    for (const r of m[2].matchAll(/\breferences\s+([\w".]+)\s*\(/gi)) {
      ajouterLien(table, nomTable(r[1]), `${table}_ref_${nomTable(r[1])}`)
    }
  }
}

const paquets = [...liensParPaire.entries()]
  .filter(([, noms]) => noms.size > 1)
  .map(([cle, noms]) => ({ paire: cle.split('|'), noms: [...noms] }))

console.log('\n═══ diag-embeds-ambigus ═══\n')
console.log(`  ${liensParPaire.size} paire(s) de tables liees, dont ${paquets.length} AMBIGUE(S) :`)
for (const p of paquets) {
  console.log(`    ${p.paire[0]} ↔ ${p.paire[1]}  (${p.noms.length} liens : ${p.noms.join(', ')})`)
}

const ambigue = (a, b) => {
  const noms = liensParPaire.get([a, b].sort().join('|'))
  return noms ? noms.size > 1 : false
}

// ─────────────────────────────────────────────────────────────────────────────
// ② ET ③ LES EMBEDS DU CODE
// ─────────────────────────────────────────────────────────────────────────────
function fichiersSources(dossiers) {
  const out = []
  const parcours = (rel) => {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) return
    for (const e of readdirSync(abs)) {
      if (e === 'node_modules' || e === '.next') continue
      const enfant = rel + '/' + e
      if (statSync(join(ROOT, enfant)).isDirectory()) parcours(enfant)
      else if (/\.tsx?$/.test(e)) out.push(enfant)
    }
  }
  for (const d of dossiers) parcours(d)
  return out
}

// app/ ET lib/ ET components/ (§E.15) — un embed peut vivre dans un composant
// qui lit en client-direct.
const SOURCES = fichiersSources(['app', 'lib', 'components'])
if (SOURCES.length === 0) {
  console.error('Aucun fichier source — le controle ne verifie rien. Arret.')
  process.exit(2)
}

const fautes = []
const nonResolus = []
let embedsExamines = 0

/**
 * LA VALEUR D'UNE CONSTANTE DE SELECT, DANS LE MEME FICHIER.
 *
 *   `.select(SELECT_PROFIL)` ne dit rien a un balayage de texte. La constante,
 *   elle, est juste au-dessus — et elle porte l'embed. On la resout donc, en se
 *   limitant au meme fichier : suivre un import serait un second graphe a
 *   maintenir, et une resolution partielle qui se croit complete est pire que
 *   pas de resolution du tout.
 *
 *   Les concatenations `'a, ' + 'b(...)'` sont recollees : c'est la forme que
 *   le depot utilise pour tenir la ligne a 100 colonnes.
 */
function valeurConstante(src, nom) {
  const re = new RegExp(
    String.raw`\bconst\s+` + nom + String.raw`\s*(?::[^=]+)?=\s*([\s\S]{0,1200}?)\n\s*(?:const|let|var|function|export|\/\*\*|$)`,
  )
  const m = re.exec(src)
  if (!m) return null
  const morceaux = [...m[1].matchAll(/['"`]([^'"`]*)['"`]/g)].map((x) => x[1])
  return morceaux.length > 0 ? morceaux.join('') : null
}

for (const f of SOURCES) {
  const src = sansCommentaires(lire(f))
  // Chaque `.from('X')` ouvre une fenetre : le `.select(…)` qui suit, jusqu'au
  // prochain `.from(` ou 1200 caracteres. Borne volontaire — au-dela, on ne
  // sait plus a quelle table l'embed se rapporte, et une assertion non ancree
  // attrape le bloc voisin (§E.8).
  for (const m of src.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)/g)) {
    const table = m[1].toLowerCase()
    const depuis = m.index + m[0].length
    const suite = src.slice(depuis, depuis + 1200)
    const finFenetre = suite.search(/\.from\(\s*['"`]/)
    const fenetre = finFenetre === -1 ? suite : suite.slice(0, finFenetre)

    const select = /\.select\(([\s\S]*?)\)\s*(?:\.|$)/.exec(fenetre)
    if (!select) continue

    // UN SELECT NON LITTERAL : on tente la constante du meme fichier, sinon on
    // le DIT. Dix lectures du depot sont dans ce cas, dont une sur une paire
    // ambigue — le controle etait vert dessus par aveuglement.
    let texteSelect = select[1]
    if (!/^\s*['"`]/.test(texteSelect)) {
      // LE PREMIER ARGUMENT SEUL. `.select(SELECT_PROFIL, options)` en porte
      // deux ; exiger que TOUT le contenu soit un identifiant faisait echouer
      // la resolution sur la seule lecture qui touche une paire ambigue.
      const premier = texteSelect.split(',')[0]
      const ident = premier.trim().match(/^([A-Za-z_$][\w$]*)\s*$/)
      const resolu = ident ? valeurConstante(src, ident[1]) : null
      if (resolu) {
        texteSelect = "'" + resolu + "'"
      } else {
        nonResolus.push(`${f} — .from('${table}') … .select(${texteSelect.trim().slice(0, 40)})`)
        continue
      }
    }

    // Chaque `nom(` dans le select est un embed candidat.
    for (const e of texteSelect.matchAll(/(!?)\s*\b(\w+)\s*(!\s*\w+)?\s*\(/g)) {
      const cible = e[2].toLowerCase()
      if (cible === table) continue
      if (!ambigue(table, cible)) continue
      embedsExamines++
      // Desambiguise ? La forme est `cible!nom_de_contrainte(`.
      const desambiguise = new RegExp(`\\b${cible}\\s*!\\s*\\w+\\s*\\(`).test(texteSelect)
      if (!desambiguise) {
        fautes.push(
          `${f} — .from('${table}') … select( … ${cible}( … ) : ` +
            `la paire porte ${liensParPaire.get([table, cible].sort().join('|')).size} liens`,
        )
      }
    }
  }
}

console.log(`\n  ${embedsExamines} embed(s) sur une paire ambigue examine(s).`)

// CE QU'IL N'A PAS PU LIRE, DIT NOMMEMENT. Un controle qui se tait sur ce
// qu'il ne comprend pas fait croire a une couverture qui n'existe pas (§E.12).
if (nonResolus.length > 0) {
  console.log(`\n  ${new Set(nonResolus).size} lecture(s) NON RESOLUE(S) — select construit ailleurs :`)
  for (const x of [...new Set(nonResolus)]) console.log(`    ${x}`)
  console.log(
    '    → la constante n’est pas dans le meme fichier, ou le select vient d’un' +
      '\n      parametre. Ces lectures ne sont PAS verifiees ; si elles traversent une' +
      '\n      paire ambigue, elles doivent nommer leur contrainte a la main.',
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// ⑤ LE GRAPHE LUI-MEME, GELE — c'est la vraie lecon de la panne
// ─────────────────────────────────────────────────────────────────────────────
//
//   LA PANNE N'A ETE CREEE PAR AUCUN EMBED. `siege_administrateur` n'a touche a
//   aucune lecture : elle a rendu AMBIGUE une paire qui ne l'etait pas, et
//   vingt lectures ecrites des mois plus tot sont mortes d'un coup.
//
//   Un controle qui n'examine que les embeds defend donc un ETAT — « ceux
//   d'aujourd'hui sont bien nommes » — alors que le danger est un CHANGEMENT.
//   Il rougirait, certes, mais APRES : au moment ou l'on relit, pas au moment
//   ou l'on ecrit la migration.
//
//   LE GEL INVERSE L'ORDRE. Les paires ambigues connues sont listees ici. Une
//   SEPTIEME fait rougir des l'ecriture de la migration, avant toute
//   application — et le controle NOMME les lectures qui vont casser, y compris
//   celles qu'il ne sait pas resoudre.
//
//   Meme forme que `diag-colonnes-supprimees` : le compte peut DESCENDRE (une
//   cle etrangere retiree sort une paire du gel, c'est signale sans rougir),
//   il ne peut pas MONTER en silence.
const GEL_AMBIGUES = new Set([
  'organization_members|users',
  'organization_members|organizations',
  'organizations|users',
  'profiles|users',
  'publications|users',
  'referrals|users',
])

{
  const actuelles = new Set(paquets.map((p) => p.paire.slice().sort().join('|')))
  const nouvelles = [...actuelles].filter((c) => !GEL_AMBIGUES.has(c))
  const disparues = [...GEL_AMBIGUES].filter((c) => !actuelles.has(c))

  if (nouvelles.length > 0) {
    console.log('')
    for (const c of nouvelles) {
      const [a, b] = c.split('|')
      const noms = [...(liensParPaire.get(c) ?? [])]
      console.log(`  KO   PAIRE NOUVELLEMENT AMBIGUE : ${a} ↔ ${b}`)
      console.log(`         ${noms.length} liens : ${noms.join(', ')}`)

      // CE QUI VA CASSER, nomme. C'est ce qui manquait le jour de la panne :
      // la migration passait, et personne ne savait quelles lectures mouraient.
      const menacees = []
      for (const f of SOURCES) {
        const src = sansCommentaires(lire(f))
        for (const m of src.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)/g)) {
          const t = m[1].toLowerCase()
          if (t !== a && t !== b) continue
          const autre = t === a ? b : a
          const suite = src.slice(m.index + m[0].length, m.index + m[0].length + 1200)
          const fin = suite.search(/\.from\(\s*['"`]/)
          const fenetre = fin === -1 ? suite : suite.slice(0, fin)
          if (new RegExp(`\\b${autre}\\s*(!\\s*inner)?\\s*\\(`).test(fenetre)) menacees.push(f)
        }
      }
      if (menacees.length > 0) {
        console.log(`         lectures qui vont casser (${new Set(menacees).size}) :`)
        for (const x of [...new Set(menacees)]) console.log(`           ${x}`)
      }
      if (nonResolus.length > 0) {
        console.log(
          `         ⚠ et ${new Set(nonResolus).size} lecture(s) NON RESOLUE(S) ci-dessus peuvent la traverser`,
        )
      }
    }
    console.log(
      '\n       → Cette migration n’a peut-etre touche AUCUN embed. Elle change' +
        '\n         quand meme la facon dont on a le droit de LIRE ces deux tables,' +
        '\n         partout, y compris dans du code ecrit des mois plus tot.' +
        '\n         Nommez la contrainte dans chaque lecture ci-dessus, PUIS ajoutez' +
        '\n         la paire a GEL_AMBIGUES.',
    )
    console.log(`\n✘ ${nouvelles.length} PAIRE(S) NOUVELLEMENT AMBIGUE(S)\n`)
    process.exit(1)
  }

  if (disparues.length > 0) {
    console.log(`\n  note ${disparues.length} paire(s) sortie(s) du gel — retirez-les de GEL_AMBIGUES :`)
    for (const c of disparues) console.log(`         ${c.split('|').join(' ↔ ')}`)
  }
}

if (fautes.length > 0) {
  console.log('')
  for (const x of [...new Set(fautes)]) {
    console.log(`  KO   ${x}`)
  }
  console.log(
    '\n       → PostgREST refuse de choisir et rend une ERREUR, pas une ligne vide.' +
      '\n         Nommez le lien a suivre : `cible!nom_de_la_contrainte(...)`.' +
      '\n         Ni tsc ni next build ne peuvent le voir : un embed est une CHAINE (§E.1).',
  )
  console.log(`\n✘ ${[...new Set(fautes)].length} EMBED(S) AMBIGU(S)\n`)
  process.exit(1)
}

console.log(
  '\n✔ TOUT VERT — aucun embed ambigu : chaque lecture entre deux tables doublement' +
    '\n  liees nomme la contrainte qu\'elle suit.\n',
)
process.exit(0)
