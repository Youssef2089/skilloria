// scripts/_alias-hooks.mjs — RÉSOUDRE `@/` ET LES IMPORTS SANS EXTENSION
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI
//   Node sait lire du TypeScript, mais il ne connaît NI l'alias `@/` (défini
//   dans tsconfig.json, que Next et tsc lisent, pas lui), NI les imports
//   relatifs sans extension (`./ai-expert-verification`). Ces deux lacunes
//   n'ont rien d'un défaut du code applicatif : le même fichier compile et se
//   déploie sans broncher.
//
//   Elles ont pourtant rendu deux diagnostics MUETS pendant des semaines. Ils
//   plantaient à l'import, et un plantage n'est pas un rouge : un rouge dit
//   « j'ai vérifié, c'est faux », un plantage dit « je n'ai rien vérifié ».
//
//   Ce résolveur permet à un diagnostic d'exercer le VRAI code applicatif au
//   lieu d'en recopier la règle — une copie reste verte le jour où l'original
//   change, ce qui est la pire des deux situations.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node --import ./scripts/_alias-register.mjs scripts/<diagnostic>.mjs
//
// N'affecte QUE les scripts lancés ainsi. Aucune incidence sur le build.

import { existsSync } from 'node:fs'

/** Racine du dépôt, déduite de l'emplacement de ce fichier. */
const RACINE = new URL('../', import.meta.url)

/** Les extensions à essayer, dans l'ordre où Next les résoudrait. */
const CANDIDATS = ['', '.ts', '.tsx', '.mts', '.js', '/index.ts', '/index.tsx', '/index.js']

function premierExistant(base) {
  for (const suffixe of CANDIDATS) {
    const essai = new URL(base.href + suffixe)
    if (existsSync(essai)) return essai.href
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  // Alias `@/…` → racine du dépôt (cf. tsconfig.json, paths).
  if (specifier.startsWith('@/')) {
    const trouve = premierExistant(new URL(specifier.slice(2), RACINE))
    if (trouve) return { url: trouve, shortCircuit: true }
  }

  // Relatif sans extension : on laisse Node essayer d'abord, et on ne comble
  // que s'il échoue — pour ne jamais court-circuiter une résolution correcte.
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await nextResolve(specifier, context)
    } catch (err) {
      const trouve = context.parentURL
        ? premierExistant(new URL(specifier, context.parentURL))
        : null
      if (trouve) return { url: trouve, shortCircuit: true }
      throw err
    }
  }

  return nextResolve(specifier, context)
}
