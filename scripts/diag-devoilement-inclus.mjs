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

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Fins de ligne NORMALISEES. Le depot sort les fichiers en CRLF : un controle
 * dont le motif traverse une fin de ligne (`...\n\s+...`) ne matche jamais sur
 * une copie de travail fraichement extraite, et le diagnostic vire au rouge
 * sans qu'aucun code n'ait change. Un diagnostic dont le resultat depend de la
 * machine qui l'execute ne dit pas si le code est juste : il dit d'ou il vient.
 */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

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

/**
 * Le bloc de dévoilement, isolé de ce qui l'entoure.
 *
 * ⚠️ IL A DÉMÉNAGÉ, et le contrôle a suivi. Il vivait en ligne dans le POST,
 *    avant la réponse ; un autre worktree l'a extrait dans `devoilementInclus()`
 *    et l'appelle depuis `after()` — le travail part donc APRÈS la réponse, ce
 *    qui est le bon endroit sur cette plateforme.
 *
 *    L'ancienne extraction découpait « de la limite jusqu'au prochain
 *    `return json(` », ce qui n'a plus de sens : la fonction se trouve désormais
 *    APRÈS ce return. On isole donc la FONCTION, par son nom.
 */
const debutFn = src.search(/async function devoilementInclus/)
const debut = src.search(/revealedCandidatesPerPublication/)
const bloc =
  debutFn === -1
    ? ''
    : src.slice(debutFn, (() => {
        // Fin de la fonction : la première accolade fermante en colonne 0.
        const i = src.indexOf('\n}', debutFn)
        return i === -1 ? src.length : i + 2
      })())

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
//
// ⚠️ LE MOTIF NE S'ACCROCHE PLUS À CE QUI SUIT LA GARDE. Il exigeait
//    `performUnlock` en PREMIÈRE instruction du bloc ; la réservation de place
//    en base s'est intercalée entre les deux, et le contrôle est passé rouge
//    alors que la règle qu'il défend n'avait pas bougé d'un caractère.
//    On remonte donc au `if` le plus proche AVANT l'appel, quoi qu'il y ait
//    entre les deux : c'est la GARDE qui est surveillée, pas son voisinage.
//    Et « le `if` le plus proche » ne suffit pas non plus : les refus anticipés
//    (`if (place !== true) { return }`) sont des blocs FRÈRES, refermés avant
//    l'appel. Ce qu'on veut est le `if` ENCORE OUVERT à la position de l'appel,
//    donc un suivi de profondeur d'accolades.
const gardeAppel = (() => {
  if (iUnlock === -1) return undefined
  const avant = bloc.slice(0, iUnlock)
  const pile = [] // { profondeur, garde }
  let profondeur = 0
  const ouvre = /if\s*\(([^)]*)\)\s*\{/g
  const positions = new Map()
  for (const m of avant.matchAll(ouvre)) positions.set(m.index + m[0].length - 1, m[1])
  for (let i = 0; i < avant.length; i++) {
    const c = avant[i]
    if (c === '{') {
      profondeur++
      if (positions.has(i)) pile.push({ profondeur, garde: positions.get(i) })
    } else if (c === '}') {
      while (pile.length > 0 && pile[pile.length - 1].profondeur === profondeur) pile.pop()
      profondeur--
    }
  }
  return pile.length > 0 ? pile[pile.length - 1].garde : undefined
})()
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
  /\.limit\(1\)/.test(bloc) && /top\.id === candidatureId/.test(bloc),
  'seule la candidature en tête prend la place, comme avant',
)
ok(
  /performUnlock\(auth\.supabaseAdmin, candidatureId, \{\s*\n?\s*auto: true/.test(bloc),
  'le dévoilement passe par le MÊME chemin que l’unlock manuel, marqué auto',
  'Un chemin parallèle divergerait tôt ou tard de l’unlock manuel.',
)
// Aucune rétrogradation : rien ne doit repasser une candidature dévoilée en arrière.
ok(
  !/status:\s*'received'|\.update\(\s*\{[^}]*unlocked_at:\s*null/.test(bloc),
  'aucune rétrogradation : une place prise ne se reprend pas',
)

// ─────────────────────────────────────────────────────────────────────────────
section('4. Le chemin reste NON BLOQUANT, et il part APRÈS la réponse')

// Le corps de la fonction est enveloppé dans un try/catch : la candidature
// existe déjà quand ce travail démarre, et rien de ce qui suit ne doit la
// remettre en cause.
ok(
  /try \{/.test(bloc) && /catch \(err\) \{/.test(bloc),
  'toute la fonction est sous try/catch : un échec ne perd pas la candidature',
  'La candidature doit rester créée même si le dévoilement échoue.',
)
ok(
  /console\.warn\('\[candidatures\][^']*',\s*err\)/.test(bloc),
  'une exception est journalisée, pas propagée',
)
ok(
  /console\.warn\('\[candidatures\][^']*',\s*res\.code\)/.test(bloc),
  'un refus de dévoilement est journalisé, pas propagé',
)

// ⚠️ LE DÉPLACEMENT LUI-MÊME. Le dévoilement s'exécute désormais APRÈS la
//    réponse : sur cette plateforme, un travail lancé après la réponse SANS
//    `after()` est tué. Vérifier qu'il est bien appelé DEPUIS un `after()` est
//    donc autant une garantie de non-blocage qu'une garantie d'exécution.
const routeEntiere = sansCommentaires(read(ROUTE))
const appels = [...routeEntiere.matchAll(/devoilementInclus\(/g)].length
ok(appels >= 2, `la fonction est appelée (${appels - 1} appel(s) hors définition)`)
const dansAfter = [...routeEntiere.matchAll(/after\(async \(\) => \{([\s\S]*?)\n  \}\)/g)].some((m) =>
  m[1].includes('devoilementInclus('),
)
ok(
  dansAfter,
  'le dévoilement est appelé DEPUIS un after()',
  "Sans after(), un travail lancé après la réponse est tué par la plateforme — et l'échec serait invisible.",
)
ok(
  /export const maxDuration/.test(routeEntiere),
  'la route déclare un maxDuration (le travail d’après-réponse a le temps de finir)',
)
// La création répond 201 quoi qu'il advienne du dévoilement.
//
// Cherché dans TOUTE la route, et non à partir de la limite : depuis
// l'extraction, la fonction se trouve APRÈS le `return json(…, 201)`, et
// découper « à partir de la limite » sautait précisément le return.
ok(
  /return json\(\s*\{[\s\S]{0,200}?\},\s*201,?\s*\)/.test(routeEntiere),
  'la route répond 201 indépendamment du dévoilement',
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

// ─────────────────────────────────────────────────────────────────────────────
section('6. LE MEILLEUR PROFIL N’EST PAS DÉCIDÉ SUR UN CHAMP INCOMPLET')
//
//   LE DÉFAUT : le classement trie sur `ai_match_score DESC NULLS LAST`. Une
//   candidature dont le jugement n'a pas abouti vaut NULL et passe DERNIÈRE. Le
//   « meilleur profil » n'était donc que le meilleur PARMI CEUX DÉJÀ NOTÉS —
//   deux experts postulant à quelques secondes d'intervalle étaient départagés
//   par l'ordre d'arrivée du modèle, pas par leur dossier. C'est une promesse
//   produit non tenue : l'organisation croit recevoir le meilleur candidat.
//
//   IL NE SE MANIFESTE PAS À « ILLIMITÉ » — il attend qu'on mette un nombre. Le
//   jour où une offre passe à 3 places, il repart sans prévenir.

ok(
  /FENETRE_JUGEMENT_MS/.test(src),
  'la fenêtre de jugement est une constante nommée',
  'Un délai écrit dans l’appel se recopie et diverge.',
)
ok(
  /const FENETRE_JUGEMENT_MS = 45_000/.test(src),
  'la fenêtre couvre le délai d’attente du modèle (30 s) avec sa marge',
  'Plus courte, on décide encore trop tôt ; plus longue, la place reste vide pour rien.',
)
// LE CONTRÔLE CENTRAL : on refuse de décider tant qu'une autre candidature de
// cette annonce peut encore recevoir sa note.
ok(
  /\.is\('ai_match_score', null\)/.test(src) && /\.neq\('id', candidatureId\)/.test(src),
  'les candidatures encore non notées de cette annonce sont recherchées',
  'Sans ce comptage, le départage retombe sur l’ordre d’arrivée du modèle.',
)
ok(
  /if \(\(enAttente \?\? 0\) > 0\) \{[\s\S]{0,320}?return\n/.test(src),
  'on NE DÉCIDE PAS tant que la cohorte n’est pas stable',
  'La dernière candidature à finir verra tout le monde noté et tranchera.',
)
// LE FILET, ET IL EST OBLIGATOIRE.
ok(
  /\.gte\('created_at', limiteFenetre\)/.test(src),
  'au-delà de la fenêtre, une candidature sans note ne bloque plus rien',
  'Sans ce filet, un jugement qui n’aboutit jamais laisserait la place VIDE pour toujours.',
)
// Et le départage lui-même n'a pas bougé : mêmes tris, même ancienneté.
ok(
  /\.order\('ai_match_score', \{ ascending: false, nullsFirst: false \}\)/.test(src) &&
    /\.order\('created_at', \{ ascending: true \}\)/.test(src),
  'le départage reste : note décroissante puis ancienneté',
  'On corrige QUAND on décide, pas COMMENT on départage.',
)

// ─────────────────────────────────────────────────────────────────────────────
section('7. UNE PLACE GRATUITE NE PEUT PAS ÊTRE DONNÉE DEUX FOIS')
//
//   Le comptage des places est un LIRE-PUIS-ÉCRIRE : deux jugements qui
//   finissent au même instant lisent tous deux 0, concluent tous deux 0 < 1, et
//   dévoilent tous deux. Aucune vérification avant écriture ne peut corriger
//   cela — seule la base le peut.
//
//   DEUX SENS, ET IL FAUT LES DEUX : la garantie doit exister, ET le cas
//   ILLIMITÉ ne doit RIEN se voir refuser. C'est le réglage de lancement ; le
//   casser serait pire que le défaut qu'on corrige.

const dossierMig = join(ROOT, 'supabase', 'migrations')
const migPlace = readdirSync(dossierMig).find((f) => f.endsWith('_place_incluse_unique.sql'))
ok(!!migPlace, 'la migration de la place incluse existe')

if (migPlace) {
  const brut = readFileSync(join(dossierMig, migPlace), 'utf8').split('\r\n').join('\n')
  // LE CODE SEUL. Les blocs `comment on ...` décrivent la garantie en toutes
  // lettres : chercher une clause dans le fichier entier la trouverait dans la
  // PROSE, et le contrôle resterait vert alors qu'elle aurait quitté le code.
  // Piège rencontré trois fois sur ce dépôt — il est fermé ici d'emblée.
  const sql = brut
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .replace(/comment on [\s\S]*?\$\$;/g, '')
    .toLowerCase()

  ok(
    /create unique index if not exists candidatures_place_incluse_unique_idx/.test(sql),
    'la garantie est un index UNIQUE — déclaratif, pas une relecture',
    'Un trigger qui recompte voit ce qui est COMMITÉ : deux transactions simultanées passent toutes deux.',
  )
  ok(
    /on public\.candidatures \(publication_id, place_incluse\)/.test(sql),
    'elle porte sur (annonce, numéro de place)',
  )
  // LE SENS INVERSE : partielle, donc muette à ILLIMITÉ.
  ok(
    /where place_incluse is not null/.test(sql),
    'l’index est PARTIEL : il ne voit que les lignes numérotées',
    'Non partiel, il refuserait des dévoilements à plafond illimité.',
  )
  ok(
    /if p_plafond is null then\s*\n\s*return true;/.test(sql),
    'à plafond ILLIMITÉ la réservation rend true SANS RIEN ÉCRIRE',
    'Aucun numéro attribué ⇒ rien à refuser. Le réglage de lancement n’est pas touché.',
  )
  ok(
    /if v_place > p_plafond then\s*\n\s*return false;/.test(sql),
    'au-delà du plafond, la place est refusée',
  )
  ok(
    /exception when unique_violation then\s*\n\s*return false;/.test(sql),
    'une place prise au même instant est un REFUS, pas une panne',
    'Remonter une erreur ferait échouer le after() sur un cas parfaitement normal.',
  )
  // ON LIT LA LISTE DE BÉNÉFICIAIRES, PAS UN PRÉFIXE.
  //   Première version : `to service_role` présent ET `to authenticated` absent.
  //   Elle laissait passer `to service_role, authenticated` — le préfixe matche,
  //   et la chaîne « to authenticated » n'apparaît nulle part. La mutation l'a
  //   prouvé. On capture donc la liste entière et on exige qu'elle soit
  //   EXACTEMENT `service_role`.
  const grants = [...sql.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to ([^;]+);/g)]
  const beneficiaires = new Map(grants.map((g) => [g[1], g[2].trim()]))
  for (const fn of ['reserver_place_incluse', 'liberer_place_incluse']) {
    ok(
      beneficiaires.get(fn) === 'service_role',
      `${fn} n’est exécutable QUE par le service-role`,
      `bénéficiaires : « ${beneficiaires.get(fn) ?? 'aucun grant trouvé'} » — exposée à authenticated, elle deviendrait un chemin d’attribution de droits.`,
    )
  }
  ok(
    /create or replace function public\.liberer_place_incluse/.test(sql),
    'une place réservée mais non honorée peut repartir',
    'Sinon elle serait perdue pour toujours.',
  )
}

// Et le code s'en sert, aux deux bouts.
ok(
  /rpc\(\s*'reserver_place_incluse'/.test(src),
  'le dévoilement RÉSERVE la place avant de dévoiler',
  'Réserver après, c’est laisser la course intacte.',
)
ok(
  /if \(place !== true\) \{[\s\S]{0,240}?return\n/.test(src),
  'un refus de place n’entraîne AUCUN dévoilement',
)
ok(
  /rpc\('liberer_place_incluse'/.test(src),
  'la place repart si le dévoilement échoue après réservation',
)
ok(
  /p_plafond: revealN/.test(src),
  'le plafond transmis est celui de l’offre, jamais une valeur recopiée',
)

console.log(
  failures === 0
    ? '\nRÉSULTAT : tout est vert. Illimité dévoile tout, un nombre en dévoile ce nombre.\n'
    : `\nRÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
