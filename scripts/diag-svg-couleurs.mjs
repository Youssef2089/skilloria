#!/usr/bin/env node
// scripts/diag-svg-couleurs.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ UNE VARIABLE CSS NE RÉSOUT PAS DANS UN ATTRIBUT DE PRÉSENTATION SVG.     ║
// ║                                                                          ║
// ║ `stroke="var(--sk-muted)"` n'est pas une couleur invalide qui lèverait :  ║
// ║ c'est un attribut que le navigateur IGNORE. Le trait disparaît, en       ║
// ║ silence, et rien dans `tsc`, `next build` ou la console ne le dit.       ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// LE CAS FONDATEUR, ET IL EST DE MA MAIN. Le lot « palette unique » a converti
// la chaîne de l'accueil en remplaçant chaque couleur par son jeton. La
// conversion a mordu, entre autres, sur le curseur de la démonstration :
//   `<path … fill="var(--sk-text)" stroke="var(--sk-surface)">`
// Le curseur a disparu. Trouvé en relisant le RENDU, pas le code — et c'est
// tout l'intérêt de ce contrôle : la relecture ne l'aurait pas vu, parce que
// la ligne a l'air juste.
//
// LA PARADE, DEUX FORMES, TOUTES DEUX ACCEPTÉES ICI :
//   · la PROPRIÉTÉ plutôt que l'attribut — `style={{ stroke: 'var(--sk-muted)' }}` ;
//   · la VALEUR plutôt que le jeton — `fill={palette.cartes}`, quand le code
//     dispose de la palette résolue (c'est le cas de la démonstration).
//
// Trois codes de sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
// Sans base, sans réseau, depuis n'importe quel worktree.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RACINES = ['app', 'lib', 'components']

// §E.3 : CRLF.
const lire = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n')

// Les attributs de PRÉSENTATION qui portent une couleur. `color` n'en est pas
// un en SVG (c'est une propriété héritée), et `stop-color` / `flood-color`
// n'apparaissent pas dans ce dépôt — on ne garde que ce qu'on peut montrer.
const ATTRIBUTS = ['fill', 'stroke']

/**
 * Un attribut de présentation dont la valeur est une VARIABLE CSS.
 *
 * On vise `fill="var(…)"` et `fill='color-mix(…)'` — la valeur entre
 * guillemets, donc littéralement un attribut. `fill={expression}` est du
 * JavaScript : il rend une vraie couleur, et il est légitime.
 */
const MOTIF = new RegExp(
  `\\b(${ATTRIBUTS.join('|')})\\s*=\\s*["'](var\\(|color-mix\\()`,
  'g',
)

/**
 * §E.7 — retirer les commentaires avant de chercher.
 * Sans cela ce contrôle rougirait sur son propre en-tête, qui cite le défaut
 * qu'il défend. Un contrôle qui punit la documentation de sa règle est
 * désactivé le jour même.
 */
function sansCommentaires(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)))
}

function fichiers(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) fichiers(p, acc)
    else if (/\.(ts|tsx)$/.test(e)) acc.push(p)
  }
  return acc
}

try {
  const prises = []
  let balayes = 0

  for (const racine of RACINES) {
    for (const p of fichiers(join(ROOT, racine))) {
      balayes++
      const rel = relative(ROOT, p).split(sep).join('/')
      const src = sansCommentaires(lire(p))
      const lignes = src.split('\n')
      for (let i = 0; i < lignes.length; i++) {
        for (const m of lignes[i].matchAll(MOTIF)) {
          prises.push({ rel, ligne: i + 1, attribut: m[1], extrait: lignes[i].trim().slice(0, 120) })
        }
      }
    }
  }

  console.log('── PAS DE VARIABLE CSS DANS UN ATTRIBUT SVG ────────────────────')
  console.log(`   ${balayes} fichiers balayés dans ${RACINES.join(', ')}`)
  console.log(`   attributs surveillés : ${ATTRIBUTS.join(', ')}`)

  if (prises.length) {
    console.log(`\n❌ ${prises.length} attribut(s) de présentation portent une variable CSS.`)
    console.log('   Le navigateur les IGNORE : la forme ne se peint pas, et rien ne le dit.')
    console.log("   Écrivez-la en PROPRIÉTÉ — style={{ stroke: 'var(--sk-muted)' }} —")
    console.log('   ou passez la VALEUR résolue — fill={palette.cartes}.')
    for (const p of prises) console.log(`     ${p.rel}:${p.ligne}  ${p.attribut}=…\n       ${p.extrait}`)
    console.log('\n🔴 ROUGE')
    process.exit(1)
  }

  console.log('\n── CE QUE CE CONTRÔLE NE VÉRIFIE PAS (§E.38) ───────────────────')
  console.log('   · `fill={x}` où `x` vaut une chaîne `var(…)` construite ailleurs.')
  console.log("     La valeur n'est pas dans le fichier, et la suivre demanderait")
  console.log("     d'exécuter le code. Cette forme SE LIT (§E.38).")
  console.log('   · les SVG servis comme FICHIERS depuis public/ : ils ne passent par')
  console.log('     aucune de ces racines.')

  console.log('\n🟢 VERT')
  process.exit(0)
} catch (err) {
  console.error("Le contrôle n'a pas tourné :", err?.message ?? err)
  process.exit(2)
}
