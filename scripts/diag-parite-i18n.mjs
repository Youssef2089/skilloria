#!/usr/bin/env node
// scripts/diag-parite-i18n.mjs — LES QUATRE LANGUES PORTENT EXACTEMENT LES MÊMES CLÉS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE
//   La parité des quatre fichiers `messages/{fr,en,es,de}.json` n'était gardée
//   par AUCUN contrôle global : quelques diagnostics vérifiaient LEURS clés, et
//   la parité d'ensemble se mesurait à la main (audit du 26/09/2026 : 3 710 clés
//   dans chacune, 0 écart — un chiffre juste ce jour-là, que rien ne tenait).
//   Une clé ajoutée dans une seule langue s'affiche BRUTE aux trois autres.
//
// CE QU'IL GARDE, sur des CHEMINS (a.b.c), jamais sur un nombre seul
//   · le français est la référence (langue par défaut, CLAUDE.md) ;
//   · chaque autre langue a EXACTEMENT les mêmes chemins : aucune manquante,
//     aucune orpheline (en trop) — les deux sens, nommés ;
//   · chaque valeur est une chaîne NON VIDE (une chaîne vide s'affiche vide) ;
//   · aucun chemin n'est une feuille dans une langue et une branche dans une autre.
// CE QU'IL NE GARDE PAS, ET LE DIT
//   · que la traduction est juste — seulement qu'elle existe ;
//   · les variables d'interpolation ({name}) : même nom dans les quatre — non vérifié.
//
//   node scripts/diag-parite-i18n.mjs   → statique, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LANGUES = ['fr', 'en', 'es', 'de']
const REFERENCE = 'fr'

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}

/** Les feuilles d'un fichier : chemin → valeur ; et les branches, pour le conflit feuille/branche. */
function aplatir(obj) {
  const feuilles = new Map()
  const branches = new Set()
  ;(function marche(x, pre) {
    for (const [k, v] of Object.entries(x)) {
      const p = pre ? `${pre}.${k}` : k
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) { branches.add(p); marche(v, p) }
      else feuilles.set(p, v)
    }
  })(obj, '')
  return { feuilles, branches }
}

const fichiers = new Map()
for (const l of LANGUES) {
  const brut = readFileSync(join(ROOT, 'messages', `${l}.json`), 'utf8')
  fichiers.set(l, aplatir(JSON.parse(brut)))
}
const ref = fichiers.get(REFERENCE)
console.log(`\n═══ Parité des quatre langues — référence : ${REFERENCE} (${ref.feuilles.size} clés) ═══\n`)

const montrer = (l) => l.slice(0, 8).join(', ') + (l.length > 8 ? ` … (+${l.length - 8})` : '')
for (const l of LANGUES) {
  const { feuilles, branches } = fichiers.get(l)
  if (l !== REFERENCE) {
    const manquantes = [...ref.feuilles.keys()].filter((k) => !feuilles.has(k))
    const orphelines = [...feuilles.keys()].filter((k) => !ref.feuilles.has(k))
    ok(manquantes.length === 0, `${l} : aucune clé manquante (${feuilles.size} clés)`, manquantes.length ? `manquantes : ${montrer(manquantes)}` : undefined)
    ok(orphelines.length === 0, `${l} : aucune clé orpheline`, orphelines.length ? `orphelines : ${montrer(orphelines)}` : undefined)
    const conflits = [...feuilles.keys()].filter((k) => ref.branches.has(k)).concat([...branches].filter((k) => ref.feuilles.has(k)))
    ok(conflits.length === 0, `${l} : aucun chemin feuille ici et branche en ${REFERENCE}`, conflits.length ? montrer(conflits) : undefined)
  }
  const vides = [...feuilles].filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k)
  ok(vides.length === 0, `${l} : chaque valeur est une chaîne non vide`, vides.length ? montrer(vides) : undefined)
}

console.log(failures === 0
  ? `\n✅ Les quatre langues portent les mêmes ${ref.feuilles.size} clés, toutes renseignées.`
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — la parité i18n ne tient pas`)
process.exit(failures === 0 ? 0 : 1)
