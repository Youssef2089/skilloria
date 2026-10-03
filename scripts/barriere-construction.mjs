#!/usr/bin/env node
// scripts/barriere-construction.mjs — LA CONSTRUCTION S'ARRÊTE SI UN RÉGLAGE OBLIGATOIRE MANQUE (§D.51).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI (décision de Youssef, 03/10/2026) : le démarrage nommait déjà chaque variable exigée qui manque
//   (`instrumentation.ts`, §E.86) — mais APRÈS la mise en ligne, dans des journaux qu'on lit quand quelque
//   chose a cassé. La construction est le dernier moment où rien n'est encore remplacé : elle s'arrête, nomme
//   chaque variable, et la version en ligne reste celle d'avant.
//
// CE QU'IL FAIT : `npm run build` le lance AVANT `next build` (package.json), et `vercel.json` impose
//   `npm run build` comme commande de construction — un réglage de l'écran Vercel ne peut pas le contourner.
//   La règle vit dans `barriereDeConstruction()` (lib/configuration/variables.ts), exécutée par
//   `diag-variables-environnement` sur des environnements fabriqués ; ce script ne fait que l'appliquer.
//     · Vercel Production : chaque variable exigée + aucune variable `TEST_…` ;
//     · Vercel Preview (staging) et GitHub Actions : chaque variable exigée ;
//     · le poste local : rien ne bloque (une ligne le dit).
//
// JAMAIS UNE VALEUR : seulement des noms et des motifs.
//
// Codes de sortie : 0 la construction continue · 1 un réglage manque (nommé) · 2 la barrière n'a pas pu
//   lire sa règle (Node trop ancien pour lire un module TypeScript) — et la construction s'arrête aussi.
//   `process.exitCode`, jamais `process.exit()` : sous Windows, sortir pendant une écriture rend muet (§E.108).
//
//   node scripts/barriere-construction.mjs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')

async function principal() {
  let regle
  try {
    regle = await import(pathToFileURL(join(RACINE, 'lib/configuration/variables.ts')).href)
  } catch (err) {
    // Node lit un module TypeScript sans outil depuis 22.18 (24 sur ce dépôt) : plus ancien, la règle est
    // illisible — et une barrière qui ne sait pas lire sa règle reste FERMÉE.
    console.error('[barrière] la règle est illisible : ' + (err instanceof Error ? err.message : String(err)))
    console.error('[barrière] Node ' + process.version + ' — il faut Node 22.18 ou plus (réglage « Node.js Version » de Vercel).')
    return 2
  }

  const { cible, blocages, avertissements } = regle.barriereDeConstruction(process.env)

  if (cible === 'poste_local') {
    console.log('[barrière] poste local : rien ne bloque ici (elle s’applique sur Vercel et dans GitHub Actions).')
    return 0
  }

  for (const a of avertissements) {
    console.warn(`[barrière] avertissement — ${a.nom} : ${a.motif} (${a.siAbsente})`)
  }

  if (blocages.length === 0) {
    console.log(`[barrière] ${cible} : tous les réglages obligatoires sont posés — la construction continue.`)
    return 0
  }

  console.error('')
  console.error(`[barrière] ${cible} : LA CONSTRUCTION S'ARRÊTE — ${blocages.length} réglage(s) à corriger :`)
  for (const b of blocages) console.error(`  ✗ ${b.nom} — ${b.motif} : ${b.explication}`)
  console.error('')
  console.error('[barrière] Les variables exigées et leur rôle : lib/configuration/variables.ts ; la procédure : docs/mise-en-production.md.')
  return 1
}

process.exitCode = await principal()
