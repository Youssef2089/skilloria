#!/usr/bin/env node
// scripts/verifier-version-postgres.mjs — LA BASE LIÉE TOURNE SUR UNE VERSION DE POSTGRES CORRIGÉE.
//
// POURQUOI (§E.76, cause racine VÉRIFIÉE le 28/09/2026). En 17.6.1.104, un défaut de supautils tuait le
// processus serveur quand on appelait une fonction dont EXECUTE est retiré à `authenticated` — reproduit
// par Youssef avec une fonction d'une ligne. Toutes les RPC du produit retirent EXECUTE au navigateur :
// sur une telle version, UN appel PostgREST suffisait à redémarrer la base pour tout le monde. Corrigé à
// partir de 17.6.1.121. Staging est en 17.6.1.166 ; la base locale suit la version de la base liée.
//
// CE QU'IL FAIT : lit `supabase/.temp/postgres-version` (posé par `supabase link`, versionné nulle part)
// et refuse une version inférieure à 17.6.1.121. Première étape de la séquence de déploiement
// (CLAUDE.md §G.4 ter) et de la mise en production (docs/mise-en-production.md, étape 0).
//
//   node scripts/verifier-version-postgres.mjs     0 = corrigée · 1 = trop ancienne · 2 = illisible
// Lecture seule, aucun accès réseau.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MINIMUM = [17, 6, 1, 121]
const FICHIER = join(ROOT, 'supabase', '.temp', 'postgres-version')

let brut
try {
  brut = readFileSync(FICHIER, 'utf8').trim()
} catch {
  console.error('✘ supabase/.temp/postgres-version introuvable — lancez `npx supabase link --project-ref <ref>` d’abord.')
  process.exit(2)
}
const m = brut.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/)
if (!m) {
  console.error(`✘ version illisible : « ${brut} » — attendu la forme 17.6.1.166.`)
  process.exit(2)
}
const v = m.slice(1, 5).map(Number)
let cmp = 0
for (let i = 0; i < 4 && cmp === 0; i++) cmp = Math.sign(v[i] - MINIMUM[i])
if (cmp < 0) {
  console.error(`✘ Postgres ${v.join('.')} < ${MINIMUM.join('.')} : un appel à une RPC refusée au navigateur tue le serveur (§E.76).`)
  console.error('  Mettez la base à jour d’abord : tableau de bord Supabase → Settings → Infrastructure → Upgrade, puis `supabase link` à nouveau.')
  process.exit(1)
}
console.log(`✅ Postgres ${v.join('.')} ≥ ${MINIMUM.join('.')} — le défaut de supautils (§E.76) est corrigé sur la base liée.`)
