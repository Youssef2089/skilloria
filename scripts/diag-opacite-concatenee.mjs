#!/usr/bin/env node
// scripts/diag-opacite-concatenee.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ UN SUFFIXE D'OPACITÉ NE SE COLLE PAS À UNE COULEUR. JAMAIS.              ║
// ║                                                                          ║
// ║ `${couleur}33` marchait tant que `couleur` portait un hexadécimal : la   ║
// ║ chaîne produisait `#RRGGBB33`. Le jour où elle porte un jeton, elle      ║
// ║ produit `var(--sk-red)33` — qui n'est pas une couleur. Le navigateur     ║
// ║ IGNORE la déclaration, en silence : le fond disparaît, l'ombre           ║
// ║ disparaît, et rien ne le dit.                                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ CE QUI S'EST PASSÉ, ET POURQUOI CE CONTRÔLE EXISTE ────────────────────┐
// │ Le lot « palette unique » a remplacé les couleurs littérales par des     │
// │ jetons. Son codemod TRAITAIT ce cas — pour `${domain.primaryColor}NN`,   │
// │ qu'il rendait en `color-mix`. Il ne l'a pas traité pour les variables    │
// │ LOCALES qui reçoivent un jeton : `STATUS_COLORS[opt]`, `SECTION_PALETTE`,│
// │ `statusColor`, `accent`, `c`.                                            │
// │                                                                          │
// │ VINGT déclarations sont devenues invalides, dont le fond et l'ombre de   │
// │ la carte SÉLECTIONNÉE du bouton de disponibilité, des deux côtés. Aucun  │
// │ contrôle ne pouvait le voir : il n'y a aucun littéral, et ni `tsc` ni    │
// │ `next build` ne lisent une chaîne de style.                              │
// │                                                                          │
// │ C'est §E.28 ③ : une règle appliquée à une ligne ne protège pas sa        │
// │ voisine. La parade n'est donc pas « penser à `color-mix` » : c'est ce    │
// │ contrôle.                                                                │
// └──────────────────────────────────────────────────────────────────────────┘
//
// LA RÈGLE EST PLUS LARGE QUE LE DÉFAUT, ET C'EST VOULU. Elle refuse le
// suffixe collé MÊME quand la variable porte un hexadécimal, où il marche
// encore. Deux raisons :
//   · savoir si une variable porte un jeton demande de suivre sa valeur à
//     travers les props, les fonctions et les fichiers — c'est exactement le
//     genre de résolution qu'un contrôle ne fait pas bien (§E.42) ;
//   · une forme qui marche « tant que » est une forme qui cassera. Elle a
//     déjà cassé une fois, en masse, sans un mot.
// `color-mix(in srgb, <couleur> N%, transparent)` accepte les deux et ne peut
// pas se taire.
//
// Trois codes de sortie : 0 vert · 1 rouge · 2 n'a pas tourné.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RACINES = ['app', 'lib', 'components']

// §E.3 : le dépôt est en CRLF.
const lire = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n')

/**
 * §E.7 — on retire les commentaires AVANT de chercher.
 * Sans cela ce contrôle rougirait sur son propre en-tête, qui cite la forme
 * qu'il interdit. Un contrôle qui punit la documentation de sa règle est
 * désactivé le jour même.
 */
function sansCommentaires(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)))
}

/**
 * `${expression}` suivi de DEUX caractères hexadécimaux qui ne sont suivis
 * d'aucun autre caractère de mot.
 *
 * ⚠️ POURQUOI EXACTEMENT DEUX, ET PAS « UN OU PLUS ». Un suffixe d'opacité
 *    hexadécimal fait deux chiffres, toujours. Accepter un seul caractère
 *    ferait mordre sur `${jours}j`, `${n}h`, `${pct}%` — et un contrôle qui
 *    crie à tort est désactivé le jour même (§E.14).
 */
const MOTIF = /\$\{([^}]{1,80})\}([0-9a-fA-F]{2})(?![0-9a-zA-Z])/g

/**
 * Ce qui suit un gabarit et ressemble à de l'hexadécimal sans en être.
 *
 * Une unité CSS ou une abréviation de deux lettres tombe dans `[0-9a-fA-F]{2}`
 * par accident : `ad`, `be`, `da`, `fa`, `ef`… On ne les exempte PAS par une
 * liste — elle s'oublierait — mais par la PROPRIÉTÉ qui les distingue : un
 * suffixe d'opacité est collé à une valeur de COULEUR, donc la déclaration qui
 * le contient nomme une couleur.
 */
const PROPRIETES_DE_COULEUR = /\b(background|backgroundColor|color|border|borderColor|borderTop|borderBottom|borderLeft|borderRight|boxShadow|outline|fill|stroke|textShadow|caretColor|accentColor)\b/i

function fichiers(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) fichiers(p, acc)
    else if (/\.(ts|tsx|css)$/.test(e)) acc.push(p)
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
      const lignes = sansCommentaires(lire(p)).split('\n')
      for (let i = 0; i < lignes.length; i++) {
        for (const m of lignes[i].matchAll(MOTIF)) {
          // La déclaration doit parler de COULEUR. Sinon c'est une unité ou un
          // libellé, et ce contrôle n'a rien à y dire.
          if (!PROPRIETES_DE_COULEUR.test(lignes[i])) continue
          prises.push({
            rel,
            ligne: i + 1,
            expr: m[1].trim(),
            alpha: m[2],
            extrait: lignes[i].trim().slice(0, 130),
          })
        }
      }
    }
  }

  console.log("── PAS DE SUFFIXE D'OPACITÉ COLLÉ À UNE COULEUR ────────────────")
  console.log(`   ${balayes} fichiers balayés dans ${RACINES.join(', ')}`)

  if (prises.length) {
    console.log(`\n❌ ${prises.length} déclaration(s) collent un suffixe d'opacité à une couleur.`)
    console.log("   Si la variable porte un jeton, la déclaration est INVALIDE et le")
    console.log('   navigateur l\'ignore SANS RIEN DIRE. Écrivez :')
    console.log('     color-mix(in srgb, <couleur> N%, transparent)')
    console.log('   0x10 → 6 %   0x14 → 8 %   0x1A → 10 %   0x33 → 20 %   0x55 → 33 %')
    for (const p of prises) {
      console.log(`\n     ${p.rel}:${p.ligne}   \${${p.expr}}${p.alpha}`)
      console.log(`       ${p.extrait}`)
    }
    console.log('\n🔴 ROUGE')
    process.exit(1)
  }

  console.log('\n── CE QUE CE CONTRÔLE NE VÉRIFIE PAS (§E.38) ───────────────────')
  console.log("   · une couleur CONCATÉNÉE hors d'un gabarit — `couleur + '33'`.")
  console.log("     Elle n'existe pas dans ce dépôt ; l'ajouter demanderait de suivre")
  console.log('     une expression, et ce contrôle se veut lisible plutôt que complet.')
  console.log('   · que le POURCENTAGE choisi soit le bon. 20 % ou 25 %, il ne le sait')
  console.log("     pas — il vérifie que la déclaration est VALIDE, pas qu'elle est jolie.")

  console.log('\n🟢 VERT')
  process.exit(0)
} catch (err) {
  console.error("Le contrôle n'a pas tourné :", err?.message ?? err)
  process.exit(2)
}
