#!/usr/bin/env node
// scripts/diag-lint-cliquet.mjs — LE LINT NE PEUT QUE DESCENDRE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE
//   La « base de lint » (66 erreurs / 28 avertissements, puis 65/25) n'était
//   écrite que dans docs/reprise.md : une consigne, que rien ne tenait. Un lot
//   qui ajoutait trois erreurs restait « sous la base » tant que personne ne
//   recomptait à la main. La base vit donc ICI, et ce contrôle la tient.
//
// CE QU'IL GARDE
//   · ESLint (la configuration du dépôt, `eslint.config.mjs`) sur tout le dépôt ;
//   · erreurs ≤ BASE.erreurs ET avertissements ≤ BASE.avertissements — rouge
//     dès que l'un des deux MONTE ;
//   · quand l'un DESCEND, il le dit : la base s'abaisse dans le même commit
//     (un cliquet qu'on n'abaisse pas laisse remonter jusqu'à l'ancien plafond).
// CE QU'IL NE GARDE PAS
//   · QUELLES erreurs : une erreur corrigée et une autre ajoutée s'annulent.
//
//   node scripts/diag-lint-cliquet.mjs   → lance ESLint (lecture seule), ~30 s.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** LA BASE — abaissée à 65/25 le 26/09/2026 (point 2.10), à 65/24 le 29/09/2026 (§E.85). Elle ne remonte jamais. */
const BASE = { erreurs: 65, avertissements: 24 }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const r = spawnSync('npx', ['eslint', '-f', 'json', '.'], { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 256 * 1024 * 1024 })
let rapport
try {
  rapport = JSON.parse(r.stdout)
} catch {
  console.log(`  KO   ESLint n'a pas rendu de rapport lisible (code ${r.status}) — le contrôle N'A PAS TOURNÉ`)
  console.log((r.stderr || '').slice(0, 600))
  process.exit(2)
}
let erreurs = 0
let avertissements = 0
for (const f of rapport) { erreurs += f.errorCount; avertissements += f.warningCount }

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
console.log(`\n═══ Cliquet du lint — base ${BASE.erreurs}/${BASE.avertissements}, mesuré ${erreurs}/${avertissements} ═══\n`)
ok(erreurs <= BASE.erreurs, `erreurs : ${erreurs} ≤ ${BASE.erreurs}`, 'une erreur de lint NOUVELLE — corrigez-la, la base ne remonte pas')
ok(avertissements <= BASE.avertissements, `avertissements : ${avertissements} ≤ ${BASE.avertissements}`, 'un avertissement NOUVEAU — corrigez-le, la base ne remonte pas')
if (erreurs < BASE.erreurs || avertissements < BASE.avertissements) {
  console.log(`  note le lint a DESCENDU : abaissez BASE à ${erreurs}/${avertissements} dans ce fichier, dans le même commit.`)
}
console.log(failures === 0 ? '\n✅ Le lint ne monte pas.' : '\n✘ Le lint a monté.')
process.exit(failures === 0 ? 0 : 1)
