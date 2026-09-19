// scripts/diag-etat-repartition.mjs — « AUCUNE EXECUTION » N'EST PAS
//                                     « LECTURE EN PANNE ».
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE CONTROLE — C'EST UNE RECHUTE, PAS UNE NOUVEAUTE
//
//   Le lot 1.3 a passe une journee a fermer cette classe dans `lib/` : une
//   erreur technique convertie en affirmation metier (§E.22). L'ecran de
//   reglage livre LE MEME JOUR l'a rouverte. Il affichait :
//
//       « Repartition indisponible : la lecture a echoue. »
//
//   alors que le moteur n'avait tout simplement JAMAIS TOURNE.
//
//   ACCUSER UNE PANNE QUAND IL N'Y A RIEN A LIRE envoie chercher un defaut qui
//   n'existe pas. Et le jour ou la lecture tombe vraiment, la phrase ne veut
//   plus rien dire — on l'a deja vue mentir.
//
// LA CAUSE, ET ELLE EST EN SQL
//   `matching_threshold_health()` batit ses tranches par
//   `from runs, generate_series(1, 10)`. Quand `runs` est VIDE, la jointure
//   croisee ne rend AUCUNE ligne, donc `array_agg` rend NULL. Le `null` de
//   « rien a agreger » et le `null` de « je n'ai pas pu lire » avaient la meme
//   forme. C'est §E.22 mot pour mot, a un etage plus haut.
//
// CE QUE CE CONTROLE VERIFIE
//   (A) LA FONCTION PURE, EPROUVEE EN L'EXECUTANT — six cas, trois etats.
//       C'est la forme la plus forte : on ne lit pas un motif, on appelle.
//   (B) L'ECRAN PASSE PAR ELLE, et ne rebricole pas un ternaire sur `null`.
//   (C) LA ROUTE ne rend `null` que sur ERREUR — jamais un tableau vide.
//   (D) LES TROIS ETATS ONT TROIS TEXTES DIFFERENTS, dans les quatre langues.
//       Deux etats qui disent la meme phrase ne sont pas distingues.
//
//   node scripts/diag-etat-repartition.mjs
//   Aucune base, aucun reseau. 0 = vert · 1 = rouge.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// Import RELATIF avec extension explicite : un alias `@/` ne se resout pas hors
// du bundler, et le diagnostic mourrait en ERR_MODULE_NOT_FOUND — ni vert ni
// rouge, c'est-a-dire ne verifiant plus rien (§E.3).
import { etatRepartition, inclusExclus } from '../lib/matching/etat-repartition.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (l.trimStart().startsWith('//') || l.trimStart().startsWith('*') ? '' : l))
    .join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

// ═══════════════════════════════════════════════════════════════════════════
section('A. La fonction, EPROUVEE EN L EXECUTANT')
// ═══════════════════════════════════════════════════════════════════════════

const CAS = [
  [null, 'indisponible', 'la route a rendu null : LA LECTURE A ECHOUE'],
  [[], 'aucune_execution', 'reponse vide : rien a agreger, pas une panne'],
  [
    [{ runs_observes: 0, repartition: null, notes_totales: 0 }],
    'aucune_execution',
    'zero run et repartition NULL — LE CAS EXACT DU CROSS JOIN SANS MATIERE',
  ],
  [
    [{ runs_observes: 3, repartition: null, notes_totales: 0 }],
    'aucune_execution',
    'des runs, mais aucune note agregee',
  ],
  [
    [{ runs_observes: 2, repartition: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], notes_totales: 0 }],
    'aucune_execution',
    'dix tranches a zero : rien n a ete note',
  ],
  [
    [{ runs_observes: 2, repartition: [1, 0, 0, 0, 2, 0, 0, 5, 1, 0], notes_totales: 9 }],
    'disponible',
    'de la matiere : on peut repondre « a 7, combien entrent »',
  ],
]
for (const [entree, attendu, quoi] of CAS) {
  const obtenu = etatRepartition(entree).etat
  ok(obtenu === attendu, `${quoi} → ${attendu}`, `obtenu : ${obtenu}`)
}

// LE CALCUL QUI SERT A DECIDER, lui aussi execute.
{
  const tranches = [1, 0, 0, 0, 2, 0, 0, 5, 1, 0] // 9 notes
  const a0 = inclusExclus(tranches, 0)
  ok(a0.inclus === 9 && a0.exclus === 0, 'a 0, tout entre (9 inclus, 0 ecartes)', JSON.stringify(a0))
  const a7 = inclusExclus(tranches, 7)
  ok(a7.inclus === 6 && a7.exclus === 3, 'a 7, 6 entrent et 3 sont ecartes', JSON.stringify(a7))
  const a10 = inclusExclus(tranches, 10)
  ok(a10.inclus === 0 && a10.exclus === 9, 'a 10, personne n entre — 10 veut dire JAMAIS', JSON.stringify(a10))
  // Une valeur fractionnaire est ramenee a sa tranche : on ne pretend pas a une
  // precision que la mesure n'a pas.
  const a74 = inclusExclus(tranches, 7.4)
  ok(a74.inclus === a7.inclus, 'une valeur fractionnaire retombe sur sa tranche', JSON.stringify(a74))
}

// ═══════════════════════════════════════════════════════════════════════════
section('B. L ecran passe par la fonction, il ne la rebricole pas')
// ═══════════════════════════════════════════════════════════════════════════

const ECRAN = 'app/[locale]/admin/matching/page.tsx'
const ecran = sansCommentaires(lire(ECRAN))

ok(
  /from '@\/lib\/matching\/etat-repartition'/.test(ecran),
  `${ECRAN} importe la fonction`,
  "sans elle, la decision se reecrit dans un ternaire au milieu du JSX — et c'est exactement comme ca qu'elle s'est reecrite de travers",
)
for (const etat of ['indisponible', 'aucune_execution']) {
  ok(
    new RegExp(`etat\\.etat === '${etat}'`).test(ecran),
    `l ecran traite explicitement l etat « ${etat} »`,
    'un etat non traite retombe dans la branche du voisin, silencieusement',
  )
}
// LE MOTIF FAUTIF LUI-MEME : tester `repartition === null` pour conclure a une
// panne. C'est la ligne exacte qui a produit la fausse panne.
ok(
  !/repartition\s*===\s*null/.test(ecran),
  `${ECRAN} ne teste plus \`repartition === null\` a la main`,
  'ce test confondait « rien a agreger » et « lecture en panne » — les deux rendent null',
)

// ═══════════════════════════════════════════════════════════════════════════
section('C. La route ne rend `null` que sur ERREUR')
// ═══════════════════════════════════════════════════════════════════════════

const ROUTE = 'app/api/admin/matching-settings/route.ts'
const route = sansCommentaires(lire(ROUTE))
ok(
  /repartitions\[i\]\?\.error \? null : \(repartitions\[i\]\?\.data \?\? \[\]\)/.test(route),
  `${ROUTE} : \`null\` sur erreur, \`[]\` sinon`,
  'rendre `[]` sur erreur ferait lire « aucune execution » la ou il faut lire « on ne sait pas » (§E.22)',
)

// ═══════════════════════════════════════════════════════════════════════════
section('D. Trois etats, trois textes — dans les quatre langues')
// ═══════════════════════════════════════════════════════════════════════════

//   Deux etats qui disent la MEME phrase ne sont pas distingues, meme si le
//   code les separe. La distinction doit arriver jusqu'a l'ecran, sinon on a
//   remplace un mensonge par un silence poli.
const CLES = ['spread_unavailable', 'spread_none_yet_title', 'spread_effect']
for (const langue of ['fr', 'en', 'es', 'de']) {
  const m = JSON.parse(lire(`messages/${langue}.json`))
  const textes = CLES.map((c) => m.admin_matching?.[c])
  ok(
    textes.every((t) => typeof t === 'string' && t.trim().length > 0),
    `${langue} : les trois etats ont un texte`,
    CLES.filter((c, i) => !textes[i]).join(', '),
  )
  ok(
    new Set(textes).size === textes.length,
    `${langue} : les trois textes sont DIFFERENTS`,
    'deux etats qui disent la meme chose ne sont pas distingues',
  )
}

console.log('')
if (echecs > 0) {
  console.log(`✘ ${echecs} CONTROLE(S) EN ECHEC`)
  process.exit(1)
}
console.log('✅ « Aucune execution » et « lecture en panne » ne se confondent plus.')
process.exit(0)
