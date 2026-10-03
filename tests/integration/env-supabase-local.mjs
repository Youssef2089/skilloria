#!/usr/bin/env node
// tests/integration/env-supabase-local.mjs — LES CLÉS DE LA BASE DU RUNNER, LUES APRÈS `supabase start`.
//
// La base démarrée par la CLI a des clés de DÉMONSTRATION, propres à la machine et publiques par nature ; on
// ne les écrit nulle part dans le dépôt : on les lit (`supabase status -o json`) et on les passe aux étapes
// suivantes par GITHUB_ENV, sous les noms que lit l'application. Rien n'est imprimé de leur valeur.
//
// Hors de GitHub Actions, il affiche les NOMS trouvés et ne pose rien.

import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { RACINE, nAPasTourne } from './outils.mjs'

const r = spawnSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: RACINE, encoding: 'utf8', shell: process.platform === 'win32' })
let statut = null
try {
  // La CLI peut faire précéder le JSON d'une ligne d'information : on prend l'objet.
  const debut = (r.stdout ?? '').indexOf('{')
  statut = JSON.parse((r.stdout ?? '').slice(debut))
} catch { /* illisible : dit plus bas */ }

if (!statut) {
  nAPasTourne('Clés de la base locale', `supabase status illisible (code ${r.status}) : ${(r.stderr ?? '').slice(0, 400)}`)
} else {
  const lire = (...cles) => {
    for (const c of cles) {
      const v = statut[c] ?? statut[c.toLowerCase()]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  const valeurs = {
    NEXT_PUBLIC_SUPABASE_URL: lire('API_URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: lire('ANON_KEY', 'PUBLISHABLE_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: lire('SERVICE_ROLE_KEY', 'SECRET_KEY'),
    SUPABASE_DB_URL: lire('DB_URL'),
  }
  const absentes = Object.entries(valeurs).filter(([, v]) => !v).map(([k]) => k)
  if (absentes.length) {
    nAPasTourne('Clés de la base locale', `supabase status ne donne pas : ${absentes.join(', ')} — clés lues : ${Object.keys(statut).join(', ')}`)
  } else if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, Object.entries(valeurs).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
    console.log(`Base locale : ${Object.keys(valeurs).join(', ')} posées pour les étapes suivantes (${valeurs.NEXT_PUBLIC_SUPABASE_URL}).`)
  } else {
    console.log(`Base locale lue (${valeurs.NEXT_PUBLIC_SUPABASE_URL}) — hors de GitHub Actions, rien n'est posé.`)
  }
}
