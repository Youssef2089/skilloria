#!/usr/bin/env node
// tests/integration/db-lint.mjs — `supabase db lint`, NIVEAU ERREUR, SUR LA BASE DU RUNNER.
//
// La règle de §G.4 ter, étape 2 : « une sortie vide = aucune erreur ; pas de `--fail-on` (non vérifié sur la
// CLI 2.108.0) : c'est la sortie qu'on lit ». On lit donc la SORTIE STANDARD — le rapport — et on la juge :
// vide (ou une liste vide), vert ; autre chose, rouge, et le rapport est imprimé. Ce que la CLI écrit sur la
// sortie d'erreur (connexion, « No schema errors found ») est imprimé, sans être jugé.

import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { RACINE, nAPasTourne } from './outils.mjs'

const r = spawnSync('npx', ['supabase', 'db', 'lint', '-s', 'public', '--level', 'error'],
  { cwd: RACINE, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 })
const rapport = (r.stdout ?? '').trim()
if (r.stderr) console.log(r.stderr.trim())

if (r.error || (r.status !== 0 && !rapport)) {
  nAPasTourne('db lint', `la CLI n'a pas rendu de rapport (code ${r.status}) : ${(r.stderr ?? r.error?.message ?? '').slice(-600)}`)
} else if (rapport === '' || rapport === '[]' || /^no schema errors found\.?$/i.test(rapport)) {
  console.log('✅ db lint : aucune erreur (sortie vide).')
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### ✅ db lint — aucune erreur\n\n')
  process.exitCode = 0
} else {
  console.log(rapport)
  console.log('\n✘ db lint : le schéma public a des ERREURS (rapport ci-dessus).')
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ❌ db lint — des erreurs\n\n\`\`\`\n${rapport.slice(0, 6000)}\n\`\`\`\n\n`)
  }
  process.exitCode = 1
}
