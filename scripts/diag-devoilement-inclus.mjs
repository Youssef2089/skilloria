// scripts/diag-devoilement-inclus.mjs — « ILLIMITÉ » DÉVOILE TOUT, PAS RIEN.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le back-office annonce « les # meilleurs candidats sont dévoilés
//   automatiquement », et propose une case « Illimité ». Le code faisait
//   l'inverse de la case : la chaîne complète était
//
//     package_features.value = 'unlimited'
//       → parseLimit()  → null                       (lib/entitlements.ts)
//         → revealN = null
//           → `if (revealN !== null)` → BLOC SAUTÉ  → zéro dévoilement.
//
//   Conséquence observable en base : `business` et `elite`, les deux offres
//   PAYANTES, dévoilaient MOINS que l'offre gratuite — qui porte un 1 et
//   fonctionnait. Un réglage du back-office produisait le contraire de ce
//   qu'il annonçait, sans qu'aucune erreur ne soit levée nulle part.
//
//   Ce défaut ne pouvait être vu ni par `tsc` ni par le build : il n'y a pas
//   d'erreur de type dans un `if` qui a le mauvais sens.
//
// CE QUE CE DIAG VÉRIFIE, ET DANS LES DEUX SENS
//   1. ILLIMITÉ (null) dévoile — la branche existe et n'est plus une exclusion.
//   2. UN NOMBRE dévoile EXACTEMENT ce nombre — le comptage de places et le
//      départage sont toujours là, intacts.
//   3. LE QUI ET LE COMMENT N'ONT PAS BOUGÉ : même critère de tri, même
//      départage à l'ancienneté, même chemin `performUnlock`, aucune
//      rétrogradation. Ce lot ne changeait QUE le COMBIEN.
//   4. LE CHEMIN RESTE NON BLOQUANT : un échec de dévoilement ne doit jamais
//      faire perdre une candidature.
//
// CE QU'IL NE VÉRIFIE PAS — à dire honnêtement
//   Il lit le CODE, pas la base : il ne prouve pas qu'une organisation donnée
//   voit ses candidats. Il empêche la RÉGRESSION du sens de la règle, ce qui
//   est précisément ce qui a manqué.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-devoilement-inclus.mjs   → contrôles statiques.
//                                                AUCUN accès base.
//
// LECTURE PURE : ce script n'écrit JAMAIS, et ne joint jamais la base.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/** Retire les commentaires : un anti-pattern doit pouvoir être DOCUMENTÉ. */
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`)
  }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const ROUTE = 'app/api/candidatures/route.ts'
const src = sansCommentaires(read(ROUTE))

/** Le bloc d'auto-dévoilement, isolé de la route qui le contient. */
const debut = src.search(/revealedCandidatesPerPublication/)
const bloc = debut === -1 ? '' : src.slice(debut, src.indexOf('return json(', debut))

console.log('\nDÉVOILEMENT INCLUS — « Illimité » dévoile TOUT\n')

// ─────────────────────────────────────────────────────────────────────────────
section('0. Le bloc existe')

ok(debut !== -1, `${ROUTE} lit revealedCandidatesPerPublication`)
if (!bloc) {
  console.log('\nArrêt : bloc d’auto-dévoilement introuvable.\n')
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────────
section('1. ILLIMITÉ (null) dévoile — l’inversion est fermée')

// L'ancien code EXCLUAIT l'illimité en enveloppant tout le bloc dans
// `if (revealN !== null) { … performUnlock … }`. Le signe le plus sûr que
// l'inversion est de retour serait que l'appel à performUnlock retombe DANS
// cette condition.
const iGardeNombre = bloc.search(/if\s*\(\s*revealN\s*!==\s*null\s*\)/)
const iUnlock = bloc.search(/performUnlock\s*\(/)
ok(iGardeNombre !== -1, 'la branche « un nombre » est explicite')
ok(
  iUnlock !== -1 && iGardeNombre !== -1 && iUnlock > iGardeNombre,
  'l’appel de dévoilement est HORS de la branche « un nombre »',
  "Le remettre dedans réinstalle l'inversion : « Illimité » ne dévoilerait plus personne.",
)

ok(
  /devoile\s*=\s*revealN\s*===\s*null/.test(bloc),
  'null (illimité) rend la décision de dévoiler VRAIE d’emblée',
  'C’est le sens de la case : illimité dévoile tout le monde.',
)

// La décision doit être portée par la SEULE variable, sans condition ajoutée.
//
// Les deux contrôles de position ci-dessus surveillent l'imbrication — ils
// voient un appel qu'on remet DANS la branche « un nombre ». Ils ne voient pas
// qu'on peut réinstaller exactement la même inversion sans rien déplacer, en
// écrivant `if (devoile && revealN !== null)`. La mutation l'a prouvé : un seul
// contrôle tirait, et la structure restait irréprochable.
const gardeAppel = (bloc.match(/if\s*\(([^)]*)\)\s*\{\s*\n\s*const res = await performUnlock/) ||
  [])[1]
ok(
  gardeAppel !== undefined && gardeAppel.trim() === 'devoile',
  'le dévoilement est gardé par `devoile` SEUL, sans condition ajoutée',
  gardeAppel === undefined
    ? 'garde de l’appel introuvable'
    : `garde trouvée : « ${gardeAppel.trim()} » — toute condition supplémentaire sur revealN réinstalle l’inversion sans déplacer une ligne.`,
)

// L'ordre des caractères ne suffit pas : il faut que la branche « un nombre »
// soit REFERMÉE avant l'appel. On suit donc la profondeur d'accolades depuis
// son ouverture jusqu'à son retour à zéro, et on exige que l'appel soit APRÈS.
//
// (Première version : compter ouvrantes et fermantes entre les deux repères.
//  Elle était fausse par construction — l'accolade de `if (devoile) {` tombe
//  entre les deux et déséquilibrait toujours le compte de un.)
//
// Limite assumée : ce petit suivi ne connaît ni les chaînes ni les
// commentaires. Ils sont retirés en amont, et cette zone n'en contient pas.
function finDuBloc(texte, depuis) {
  let profondeur = 0
  let vu = false
  for (let i = depuis; i < texte.length; i++) {
    const c = texte[i]
    if (c === '{') { profondeur++; vu = true }
    else if (c === '}') {
      profondeur--
      if (vu && profondeur === 0) return i
    }
  }
  return -1
}
const finBrancheNombre = finDuBloc(bloc, iGardeNombre)
ok(
  finBrancheNombre !== -1 && iUnlock > finBrancheNombre,
  'la branche « un nombre » est REFERMÉE avant l’appel de dévoilement',
  finBrancheNombre === -1
    ? 'branche non refermée : accolades déséquilibrées'
    : "l'appel est encore IMBRIQUÉ dans la branche « un nombre » — l'inversion est de retour.",
)

// ─────────────────────────────────────────────────────────────────────────────
section('2. UN NOMBRE dévoile exactement ce nombre')

ok(
  /\.in\(\s*'status',\s*\['unlocked',\s*'selected'\]\s*\)/.test(bloc),
  'les places déjà prises sont comptées (unlocked + selected)',
)
ok(
  /\(\s*revealedCount\s*\?\?\s*0\s*\)\s*<\s*revealN/.test(bloc),
  'on ne dévoile que s’il RESTE une place',
  'Sans ce test, un nombre se comporterait comme illimité.',
)
ok(
  /count:\s*'exact'/.test(bloc),
  'le comptage est exact, jamais estimé',
)

// ─────────────────────────────────────────────────────────────────────────────
section('3. Le QUI et le COMMENT n’ont pas bougé')

ok(
  /\.order\('ai_match_score',\s*\{\s*ascending:\s*false,\s*nullsFirst:\s*false\s*\}\)/.test(bloc),
  'le critère de sélection est inchangé (meilleure note d’abord)',
  'Ce lot ne devait changer QUE le COMBIEN.',
)
ok(
  /\.order\('created_at',\s*\{\s*ascending:\s*true\s*\}\)/.test(bloc),
  'l’égalité est toujours départagée par l’ancienneté',
)
ok(
  /\.limit\(1\)/.test(bloc) && /top\.id === row\.id/.test(bloc),
  'seule la candidature en tête prend la place, comme avant',
)
ok(
  /performUnlock\(auth\.supabaseAdmin, row\.id, \{\s*\n?\s*auto: true/.test(bloc),
  'le dévoilement passe par le MÊME chemin que l’unlock manuel, marqué auto',
  'Un chemin parallèle divergerait tôt ou tard de l’unlock manuel.',
)
// Aucune rétrogradation : rien ne doit repasser une candidature dévoilée en arrière.
ok(
  !/status:\s*'received'|\.update\(\s*\{[^}]*unlocked_at:\s*null/.test(bloc),
  'aucune rétrogradation : une place prise ne se reprend pas',
)

// ─────────────────────────────────────────────────────────────────────────────
section('4. Le chemin reste NON BLOQUANT')

ok(
  /catch \(err\) \{\s*\n\s*console\.warn\('\[candidatures:POST\] auto-reveal block threw/.test(
    sansCommentaires(read(ROUTE)),
  ),
  'tout le bloc est sous try/catch : un échec ne perd pas la candidature',
  'La candidature doit rester créée même si le dévoilement échoue.',
)
ok(
  /console\.warn\('\[candidatures:POST\] auto-reveal performUnlock failed'/.test(bloc),
  'un échec de dévoilement est journalisé, pas propagé',
)
// La création doit répondre 201 quoi qu'il arrive ensuite.
ok(
  /return json\(\s*\{[\s\S]{0,200}?\},\s*201,?\s*\)/.test(src.slice(debut)),
  'la route répond 201 après le bloc, quel que soit son sort',
)

// ─────────────────────────────────────────────────────────────────────────────
section('5. Rien en dur — la valeur vient du catalogue')

ok(
  /getOrgEntitlements/.test(src),
  'la limite est lue par getOrgEntitlements',
)
ok(
  !/revealedCandidatesPerPublication\s*(\?\?|\|\|)\s*\d/.test(src),
  'aucune valeur de repli codée en dur derrière la limite',
  'Un `?? 1` ferait mentir le back-office aussi sûrement que l’inversion.',
)

console.log(
  failures === 0
    ? '\nRÉSULTAT : tout est vert. Illimité dévoile tout, un nombre en dévoile ce nombre.\n'
    : `\nRÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
