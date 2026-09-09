// scripts/diag-ordre-des-ecritures.mjs — CE QUI DOIT SURVIVRE À LA FONCTION
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Une route qui écrit plusieurs fois n'est pas jugée sur CE qu'elle écrit,
//   mais sur l'ORDRE dans lequel elle l'écrit. Le jour où la fonction est tuée
//   au milieu — et avec `maxDuration`, ce jour arrive — c'est l'ordre qui
//   décide de ce qui reste et de ce qui manque.
//
//   La route de publication faisait :
//     quota → publication → matching (BLOQUANT) → audit → réponse
//   Un run de matching qui dépasse tuait donc la fonction APRÈS la mise en
//   ligne et APRÈS la consommation du quota, mais AVANT l'audit et AVANT la
//   réponse. L'organisation voyait une erreur réseau sur une annonce pourtant
//   publiée, avec un quota déjà décompté — et le réflexe naturel est de
//   republier, donc d'en consommer un second.
//
//   Sa route SŒUR, le PATCH du même dossier, différait pourtant déjà le
//   matching correctement. Deux routes voisines, deux traitements opposés :
//   c'est le genre d'écart qu'aucun type et aucun build ne signale.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-ordre-des-ecritures.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE préparation.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Normalisation des fins de ligne : le dépôt sort les fichiers en CRLF, et un
// retour chariot casse tout motif qui traverse un saut de ligne.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let echecs = 0
function ok(libelle, condition, detail = '') {
  if (condition) console.log(`  ✓ ${libelle}`)
  else {
    echecs++
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`)
  }
}
const titre = (s) => console.log(`\n=== ${s} ===`)

/** Le CODE seul. Un `after(` cité dans un commentaire ne diffère rien. */
const sansCommentaires = (src) =>
  src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')

const PUBLISH = 'app/api/publications/[id]/publish/route.ts'
const PATCH = 'app/api/publications/[id]/route.ts'

for (const f of [PUBLISH, PATCH]) {
  if (!existsSync(join(ROOT, f))) {
    console.log(`\n  ✗ FICHIER ABSENT : ${f}\nÉCHEC.\n`)
    process.exit(1)
  }
}
const publish = sansCommentaires(read(PUBLISH))
const patch = sansCommentaires(read(PATCH))

console.log('\n━━━ L’ORDRE DES ÉCRITURES À LA PUBLICATION ━━━')

// ═══════════════════════════════════════════════════════════════════════════
titre('(A) LE MATCHING NE BLOQUE PLUS LA RÉPONSE')
// ═══════════════════════════════════════════════════════════════════════════

ok(
  'la route importe `after`',
  /import \{[^}]*\bafter\b[^}]*\} from 'next\/server'/.test(publish),
  'sans lui, un traitement lancé après la réponse est TUÉ (piège Vercel)',
)
ok(
  'le matching est enregistré dans un after()',
  /after\(async \(\) => \{[\s\S]{0,400}?runMatching\(/.test(publish),
  'en synchrone, l’organisation attend la fin du matching avant d’avoir sa réponse',
)
// LE contrôle qui mord : plus aucun appel bloquant.
ok(
  'aucun `await runMatching` bloquant ne subsiste',
  !/^\s*(const [\w]+ = )?await runMatching\(/m.test(publish.split('after(')[0]),
  'remettre le matching en synchrone rouvre exactement le défaut',
)

// ═══════════════════════════════════════════════════════════════════════════
titre('(B) L’AUDIT PRÉCÈDE CE QUI PEUT TUER LA FONCTION')
// ═══════════════════════════════════════════════════════════════════════════

const iQuota = publish.indexOf('consumeQuota(')
const iUpdate = publish.indexOf(".update(updates)")
const iAudit = publish.indexOf('await logAudit(')
const iAfter = publish.indexOf('after(async () =>')
const iReponse = publish.lastIndexOf('return json({ status: verdict.status')

ok('les cinq repères de la séquence sont présents',
  iQuota > 0 && iUpdate > 0 && iAudit > 0 && iAfter > 0 && iReponse > 0,
  `quota=${iQuota} update=${iUpdate} audit=${iAudit} after=${iAfter} réponse=${iReponse}`)

ok(
  'le quota est consommé avant la mise en ligne',
  iQuota < iUpdate,
)
ok(
  'l’AUDIT est écrit APRÈS la mise en ligne',
  iUpdate < iAudit,
  'un audit écrit avant la publication tracerait une annonce qui n’existe pas',
)
ok(
  'l’AUDIT précède le travail différé',
  iAudit < iAfter,
  'une annonce publiée sans trace d’audit est un trou de traçabilité',
)
ok(
  'la réponse part après l’audit',
  iAudit < iReponse,
)

// ═══════════════════════════════════════════════════════════════════════════
titre('(C) LES DEUX ROUTES SŒURS TRAITENT LE MATCHING PAREIL')
// ═══════════════════════════════════════════════════════════════════════════

//   L'écart entre elles était le vrai signal : la route qui publie était la
//   seule à bloquer, et c'est celle qui compte pour l'organisation.
ok(
  'le PATCH diffère aussi le matching',
  /after\(async \(\) => \{[\s\S]{0,400}?runMatchingForPublication\(/.test(patch),
)
ok(
  'les deux routes déclarent un maxDuration',
  /export const maxDuration = \d+/.test(publish) && /export const maxDuration = \d+/.test(patch),
  'sans maxDuration, `after()` ne donne aucun droit de continuer',
)

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n━━━ ${echecs === 0 ? 'TOUT VERT' : `${echecs} ÉCHEC(S)`} ━━━\n`)
process.exit(echecs === 0 ? 0 : 1)
