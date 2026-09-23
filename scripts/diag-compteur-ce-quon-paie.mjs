// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  diag-compteur-ce-quon-paie — LE COMPTEUR COMPTE CE QU'ON PAIE (§D.24)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//  ┌─ LE DÉFAUT QUE CE CONTRÔLE FERME, MESURÉ LE 23/09/2026 ────────────────┐
//  │ ① Le reranker était compté AU DOCUMENT — `unites: lot.length` × un     │
//  │    prix au document — alors que Cohere facture À LA RECHERCHE. Un lot  │
//  │    de 200 documents valait 0,0004 $ au compteur contre 0,002 $ à la    │
//  │    facture. L'écart DÉPEND de `rerank_batch_size` : ~10 sur des lots   │
//  │    pleins, plus de 60 sur des lots d'une quinzaine.                    │
//  │                                                                        │
//  │ ② Les recherches WEB des deux vérificateurs n'étaient comptées NULLE   │
//  │    PART. L'outil natif `web_search_20250305` se facture à la           │
//  │    recherche EN PLUS des jetons ; seuls les jetons étaient comptés.    │
//  └────────────────────────────────────────────────────────────────────────┘
//
//  ═══ CE QUE CE CONTRÔLE VÉRIFIE, ET COMMENT ═════════════════════════════
//    · il DÉCOUVRE les points de dépense au lieu de les lister (§E.61) : un
//      fichier qui appelle un fournisseur payant est reconnu à ce qu'il FAIT
//      — importer le SDK et appeler `messages.create`, ou appeler l'API du
//      reranker —, pas à son nom ni à son chemin (§E.34). Un module ajouté
//      demain est donc couvert sans qu'on l'inscrive nulle part ;
//    · il EXÉCUTE `lib/ai-consommation.ts`, qui est pur (§E.33) : les règles
//      de coût sont mesurées sur la vraie fonction, pas sur son texte ;
//    · il lit le code SANS SES COMMENTAIRES (§E.7) : une règle qui disparaît
//      du code mais reste décrite en commentaire doit faire rougir.
//
//  ═══ CE QU'IL NE FAIT PAS, PARCE QU'UN AUTRE LE FAIT DÉJÀ ═══════════════
//    `diag-depense-ia.mjs` DÉCOUVRE déjà tout fichier qui appelle un modèle
//    payant et exige de chacun qu'il consulte le plafond AVANT et enregistre
//    la dépense APRÈS, en remontant la chaîne jusqu'à l'appelant d'un module
//    pur. Refaire cette découverte ici en ferait DEUX gardes sur la même
//    panne, et deux gardes sur la même panne n'en font qu'une (§E.36) : le
//    jour où l'une est corrigée, l'autre continue de la déclarer fermée.
//
//    CE CONTRÔLE-CI PORTE L'UNITÉ, et elle seule : « la dépense est-elle
//    comptée DANS CE QUE LE FOURNISSEUR FACTURE ». Un appel peut être
//    parfaitement enregistré et parfaitement faux — c'était le cas du
//    reranker, compté au document, et l'autre contrôle le voyait vert.
//
//  ⚠️ CE QU'IL NE VÉRIFIE PAS, ET IL FAUT LE SAVOIR :
//     · que le PRIX saisi soit le bon. Un tarif est un relevé de grille, il
//       vit en base et se corrige depuis `/admin/tarifs-ia` (§D.7). Ce
//       contrôle garantit l'UNITÉ, jamais le montant ;
//     · que le fournisseur renvoie vraiment `meta.billed_units`. C'est une
//       réponse réseau : le code la lit défensivement et DÉCLARE son repli
//       (`source: 'plancher'`). Le contrôle vérifie que le repli est déclaré,
//       pas qu'il ne sert jamais.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-compteur-ce-quon-paie.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE variable d'environnement.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { coutUsd, unitesBrutes, consommationJetons } from '../lib/ai-consommation.ts'
import { jugerForme, formeDeLigne } from '../lib/ai-tarifs/forme.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ DEUX VUES D'UN MÊME FICHIER — parce qu'un APPEL n'a pas toujours la même ║
 * ║ nature, et qu'une MENTION lui ressemble.                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 *   · un appel au SDK est du CODE : `client.messages.create(` ;
 *   · un appel au reranker est un `fetch` vers une ADRESSE, et une adresse est
 *     une DONNÉE — elle vit dans une chaîne.
 *
 * D'où deux vues, et deux motifs qui ne se cherchent pas dans la même :
 *   `code`          sans commentaires NI chaînes — pour reconnaître un appel ;
 *   `codeEtChaines` sans commentaires — pour y chercher une adresse.
 *
 * ┌─ LES DEUX FAUX RÉSULTATS QUE CE DÉCOUPAGE A CORRIGÉS, MESURÉS ──────────┐
 * │ ① Sans dépouiller les chaînes, la découverte dénonçait DEUX diagnostics │
 * │    qui ne dépensent rien : l'un porte le motif dans une expression      │
 * │    régulière (il CHERCHE les appels), l'autre dans une chaîne de test.  │
 * │    C'est §E.7 d'un cran plus loin — le commentaire n'est pas le seul    │
 * │    endroit où du texte imite du code.                                   │
 * │                                                                          │
 * │ ② En dépouillant les chaînes des DEUX vues, elle perdait le reranker,    │
 * │    dont l'adresse EST une chaîne : 7 points trouvés devenaient 6, et le │
 * │    contrôle restait VERT sur les six autres. Le septième était           │
 * │    exactement celui que ce lot corrige.                                  │
 * │                                                                          │
 * │ UN DÉPOUILLEMENT TROP LARGE NE ROUGIT PAS : IL REND AVEUGLE. C'est la    │
 * │ raison pour laquelle les deux vues existent au lieu d'une.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ ET CE DÉCOUPAGE EST DÉLIBÉRÉMENT SIMPLE. Un premier jet analysait le
 *    fichier caractère par caractère pour distinguer une expression régulière
 *    d'une division ; il s'est trompé sur un `/` suivi de backticks et a perdu
 *    un septième point de dépense, silencieusement. Un contrôle dont le
 *    mécanisme est plus difficile à vérifier que la règle qu'il garde est un
 *    contrôle qu'on ne vérifiera pas (§E.57). Les expressions régulières ne
 *    sont donc jamais dépouillées : elles n'en ont pas besoin — le motif du
 *    SDK ne mord pas sur sa propre forme échappée (`\\.create\\s*\\(` n'est pas
 *    `.create(`), et une adresse en regex ne devient un appel que si le fichier
 *    porte AUSSI un `fetch(` hors chaîne. Les deux sont éprouvés en section F.
 */

/**
 * Sans commentaires (§E.7).
 * Le `[^:]` protège le `//` d'une URL — repris tel quel de `diag-depense-ia`
 * plutôt que réécrit : c'est la même règle, elle n'a pas à exister deux fois.
 */
const sansCommentaires = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** … et sans chaînes : pour reconnaître un APPEL, jamais une mention. */
const sansChaines = (src) =>
  src
    .replace(/`[^`]*`/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""')

/** Les deux vues d'un fichier. */
const vuesDe = (src) => {
  const codeEtChaines = sansCommentaires(src)
  return { codeEtChaines, code: sansChaines(codeEtChaines) }
}

/** Le SQL ne commente pas comme le TypeScript : ses commentaires commencent par deux tirets. */
const sansCommentairesSql = (src) =>
  src
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
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

// ═════════════════════════════════════════════════════════════════════════════
//  LE PÉRIMÈTRE, ÉCRIT AVANT LE BALAYAGE
// ═════════════════════════════════════════════════════════════════════════════
//  BALAYÉS : `app/`, `lib/`, `components/`, `scripts/` — tout ce qui peut
//    contenir un appel à un fournisseur payant. `scripts/` EST inclus, et ce
//    n'est pas une précaution de style : un diagnostic qui appelle un modèle
//    dépense de l'argent réel, hors de tout compteur et sans qu'aucun plafond
//    le voie. `diag-depense-ia` ne balaie que `app/` et `lib/` : c'est le seul
//    endroit où ce contrôle-ci élargit la découverte plutôt que de la refaire.
//    Ce qu'on y exige n'est pas un compteur — un banc ne doit RIEN dépenser —
//    mais la NEUTRALISATION du réseau.
//
//  ⚠️ ET LA DÉCOUVERTE LIT DU CODE, PAS DES DONNÉES. Un diagnostic qui cherche
//     `.messages.create(` porte ce motif dans une expression régulière ; un banc
//     qui éprouve un module le porte dans une chaîne de test. Les deux
//     ressemblent à un appel et n'en sont pas — c'est §E.7, d'un cran plus
//     loin : le commentaire n'est pas le seul endroit où du texte imite du
//     code. On dépouille donc AUSSI les chaînes et les expressions régulières
//     avant de chercher un appel. Mesuré : sans ce dépouillement, la
//     découverte dénonçait 2 diagnostics qui ne dépensent rien.
//  EXCLUS, chacun avec sa raison :
//    · `supabase/` — du SQL ; il est lu séparément, pour la grille tarifaire ;
//    · `messages/` — des traductions ; lues séparément, pour la parité ;
//    · `node_modules/`, `.next/`, `public/`, `docs/` — dépendances, produits de
//      build, fichiers statiques et documentation : aucun n'exécute d'appel.
const DOSSIERS = ['app', 'lib', 'components', 'scripts']
const EXTENSIONS = ['.ts', '.tsx', '.mjs']
/** Ce fichier interroge les points de dépense ; il n'en est pas un. */
const MOI = 'scripts/diag-compteur-ce-quon-paie.mjs'

function fichiers(dossier) {
  const out = []
  const parcourir = (d) => {
    for (const e of readdirSync(join(ROOT, d))) {
      const rel = `${d}/${e}`
      if (e === 'node_modules' || e === '.next') continue
      const st = statSync(join(ROOT, rel))
      if (st.isDirectory()) parcourir(rel)
      else if (EXTENSIONS.some((x) => e.endsWith(x))) out.push(rel)
    }
  }
  parcourir(dossier)
  return out
}

const TOUS = DOSSIERS.flatMap(fichiers).filter((f) => f !== MOI)
const SOURCE = new Map(TOUS.map((f) => [f, sansCommentaires(read(f))]))
/** Les deux vues de chaque fichier, pour ne pas confondre un appel et une mention. */
const VUES = new Map(TOUS.map((f) => [f, vuesDe(read(f))]))
const CODE = new Map([...VUES].map(([f, v]) => [f, v.code]))

console.log('\nLE COMPTEUR COMPTE CE QU\'ON PAIE\n')
console.log(`périmètre : ${TOUS.length} fichiers dans ${DOSSIERS.join(', ')}`)

// ═════════════════════════════════════════════════════════════════════════════
section('A. LA DÉCOUVERTE — chaque point de dépense déclare son UNITÉ')

/**
 * UN POINT DE DÉPENSE SE RECONNAÎT À CE QU'IL FAIT, jamais à son nom (§E.34).
 * Deux propriétés, une par fournisseur :
 *   · il appelle le SDK du modèle (`.messages.create(`) ;
 *   · il appelle l'API du reranker (l'hôte du fournisseur dans une URL).
 * Cherchées dans le CODE SEUL : une expression régulière qui contient le motif
 * n'appelle personne.
 */
//  ⚠️ LES DEUX PROPRIÉTÉS NE SE CHERCHENT PAS DANS LA MÊME VUE, et c'est tout
//     l'intérêt du découpage : l'appel au SDK est du code, l'adresse du
//     reranker est une donnée. Confondre les deux vues, c'est perdre l'un des
//     deux fournisseurs — mesuré.
const APPEL = (v) =>
  /\.messages\.create\s*\(/.test(v.code) ||
  (/api\.cohere\.com/.test(v.codeEtChaines) && /\bfetch\s*\(/.test(v.code))
const POINTS = TOUS.filter((f) => APPEL(VUES.get(f)))
const POINTS_PRODUIT = POINTS.filter((f) => !f.startsWith('scripts/'))
const POINTS_BANCS = POINTS.filter((f) => f.startsWith('scripts/'))

ok(
  POINTS_PRODUIT.length >= 7,
  `la découverte trouve les points de dépense du produit (${POINTS_PRODUIT.length} trouvés)`,
  'aucun point trouvé : le motif de découverte ne mord plus, et tout ce qui suit est vide',
)
for (const p of POINTS_PRODUIT) console.log(`       · ${p}`)

/**
 * DÉCLARER SON UNITÉ, c'est produire une consommation par un chemin qui SAIT
 * ce que le fournisseur facture :
 *   · la fabrique unique, pour les jetons — elle seule lit les recherches web ;
 *   · la forme `recherches`, pour le reranker.
 * Un objet écrit à la main est refusé même s'il est juste : c'est le jumeau qui
 * cessera de l'être (§E.20).
 *
 * ⚠️ « LA DÉPENSE EST-ELLE ENREGISTRÉE, ET LE PLAFOND CONSULTÉ » est une AUTRE
 *    question, et elle a son contrôle — `diag-depense-ia`. On ne la repose pas
 *    ici (§E.36).
 */
const declareSonUnite = (s) =>
  /consommationJetons\s*\(/.test(s) || /forme:\s*'recherches'/.test(s)

const SANS_UNITE = POINTS_PRODUIT.filter((f) => !declareSonUnite(SOURCE.get(f)))
ok(
  SANS_UNITE.length === 0,
  'chaque point de dépense du produit déclare son unité',
  SANS_UNITE.length
    ? `${SANS_UNITE.join(', ')} appelle(nt) un fournisseur sans passer par un chemin qui sait ce qu'il facture`
    : undefined,
)

// ── ET LES BANCS NE DOIVENT RIEN DÉPENSER ──────────────────────────────────
//  Un diagnostic qui atteint vraiment le réseau dépense de l'argent réel, hors
//  de tout compteur et sans qu'aucun plafond le voie. Ce qu'on exige d'eux
//  n'est donc pas un compteur : c'est de NE PAS APPELER.
//
//  ⚠️ UN BANC N'APPELLE PRESQUE JAMAIS LE FOURNISSEUR DIRECTEMENT : il IMPORTE
//     le module qui le fait, et l'exécute. Chercher l'appel dans le banc
//     lui-même rendait cette assertion VIDE — zéro banc trouvé, donc toujours
//     verte, ce qui se lit comme une garantie et n'en est pas une (§E.38).
//     Une mutation l'a montré : retirer la neutralisation d'un banc réel ne
//     faisait pas rougir.
//
//  LA COUVERTURE SE DÉRIVE DE LA DÉCOUVERTE, elle ne se liste pas (§E.61) : on
//  cherche qui importe l'un des modules trouvés ci-dessus. Un module payant
//  ajouté demain amène ses bancs avec lui.
//
//  ⚠️ ET ON CHERCHE L'IMPORT, PAS LA MENTION. Quatorze diagnostics CITENT le
//     chemin de l'un de ces modules — ils le LISENT comme du texte, ils ne
//     l'exécutent pas. Leur demander de neutraliser le réseau aurait fait
//     rougir treize scripts sains dès le premier jour, et le contrôle aurait
//     été désactivé le jour même.
const SPECIFICATEURS = POINTS_PRODUIT.map((f) => `from '../${f.replace(/\.tsx?$/, '.ts')}'`)
const BANCS = TOUS.filter(
  (f) =>
    f.startsWith('scripts/') &&
    SPECIFICATEURS.some((s) => (VUES.get(f)?.codeEtChaines ?? '').includes(s)),
)
//  ⚠️ NEUTRALISER, C'EST POSER UN DOUBLE — PAS TOUCHER À `fetch`. Le premier
//     motif acceptait n'importe quelle affectation, y compris la RESTAURATION
//     de fin de banc (`globalThis.fetch = realFetch`) : un banc qui aurait perdu
//     ses deux doubles et gardé sa restauration se lisait comme neutralisé.
//     Trouvé par mutation. On exige donc l'affectation d'une FONCTION.
const NEUTRALISE = (s) => /global(?:This)?\.fetch\s*=\s*(?:async\b|function\b|\()/.test(s)
const BANCS_VIFS = BANCS.filter((f) => !NEUTRALISE(CODE.get(f)))
ok(
  BANCS.length > 0,
  `la découverte trouve les bancs qui exercent un module payant (${BANCS.length})`,
  'zéro banc trouvé : l\'assertion suivante serait vide, donc toujours verte',
)
ok(
  BANCS_VIFS.length === 0,
  `les ${BANCS.length} banc(s) qui exercent un module payant neutralisent le réseau`,
  BANCS_VIFS.length
    ? `${BANCS_VIFS.join(', ')} atteindrai(en)t le fournisseur pour de vrai`
    : undefined,
)
// Les appels DIRECTS depuis un script restent refusés, eux aussi.
const SCRIPTS_APPELANTS = POINTS.filter((f) => f.startsWith('scripts/') && !NEUTRALISE(CODE.get(f)))
ok(
  SCRIPTS_APPELANTS.length === 0,
  'aucun script n\'appelle un fournisseur en direct sans neutraliser le réseau',
  SCRIPTS_APPELANTS.length ? SCRIPTS_APPELANTS.join(', ') : undefined,
)

// ═════════════════════════════════════════════════════════════════════════════
section('B. UNE SEULE FABRIQUE DE LA FORME « JETONS »')

//  Sept sites construisaient l'objet à la main. Deux d'entre eux cherchaient
//  sur le web sans le compter. Corriger ces deux-là aurait laissé cinq jumeaux
//  (§E.20) : le jour où l'un des cinq active la recherche, sa dépense redevient
//  muette, en silence, et un appel qui cherche a la même tête qu'un appel qui
//  ne cherche pas.
const FABRIQUE = 'lib/ai-consommation.ts'
const AILLEURS = TOUS.filter(
  (f) => f !== FABRIQUE && /forme:\s*'jetons'/.test(SOURCE.get(f) ?? ''),
)
ok(
  AILLEURS.length === 0,
  'la forme « jetons » ne se construit qu\'à un seul endroit',
  AILLEURS.length ? `construite à la main dans : ${AILLEURS.join(', ')}` : undefined,
)

const ANTHROPIQUES = POINTS_PRODUIT.filter((f) => /\.messages\.create\s*\(/.test(CODE.get(f)))
const SANS_FABRIQUE = ANTHROPIQUES.filter((f) => !/consommationJetons\s*\(/.test(SOURCE.get(f)))
ok(
  SANS_FABRIQUE.length === 0,
  `les ${ANTHROPIQUES.length} appels au modèle passent tous par la fabrique`,
  SANS_FABRIQUE.length ? `n'y passent pas : ${SANS_FABRIQUE.join(', ')}` : undefined,
)

const CONSO = SOURCE.get(FABRIQUE)
ok(
  /server_tool_use/.test(CONSO) && /web_search_requests/.test(CONSO),
  'la fabrique lit les recherches web dans l\'usage rendu par le fournisseur',
  'sans cette lecture, un appel qui cherche est compté comme un appel qui ne cherche pas',
)
ok(
  !/max_uses/.test(CONSO),
  'la fabrique ne déduit RIEN d\'un plafond d\'usage',
  '`max_uses` est un PLAFOND, pas une mesure : en déduire un nombre de recherches serait estimer',
)

// ═════════════════════════════════════════════════════════════════════════════
section('C. LE RERANKER COMPTE DES RECHERCHES, PLUS DES DOCUMENTS')

const RERANK = SOURCE.get('lib/matching/rerank.ts')
ok(
  /forme:\s*'recherches'/.test(RERANK),
  'le reranker déclare une consommation en RECHERCHES',
)
ok(
  !/forme:\s*'unites'/.test(RERANK),
  'le reranker ne déclare plus de consommation en DOCUMENTS',
  'un prix au document et un prix à la recherche sur le même appel : le coût dépendrait de l\'ordre de lecture',
)
//  ⚠️ LA MUTATION A TROUVÉ CE TROU. L'assertion cherchait `billed_units` dans
//     tout le fichier — or le TYPE de la réponse les nomme aussi. Remplacer la
//     lecture par `undefined` laissait donc le contrôle VERT : le compteur
//     retombait sur le plancher à chaque appel, sans que rien ne le dise.
//     On ancre sur la FONCTION qui lit (§E.8), pas sur le fichier qui en parle.
//  ⚠️ ET L'ANCRE ELLE-MÊME A DÛ ÊTRE CORRIGÉE, pour la raison qui rend ce
//     genre d'extraction traître : le TYPE DE RETOUR de cette fonction est un
//     objet, il ouvre donc une accolade AVANT le corps. Un motif qui s'arrête
//     à la première accolade fermante capturait la SIGNATURE et rien d'autre —
//     un bloc vide dans lequel aucune assertion ne peut rien trouver, donc une
//     assertion qui rougit toujours (ici) ou, pire, qui verdit toujours si elle
//     teste une ABSENCE. On s'arrête sur une accolade SEULE EN DÉBUT DE LIGNE.
const LECTURE_FACTURE = RERANK.match(/function unitesFacturees\([\s\S]*?\n\}\n/)
ok(LECTURE_FACTURE !== null, 'la lecture des unités facturées est identifiable')
ok(
  LECTURE_FACTURE !== null &&
    /charge\.meta\?\.billed_units\?\.search_units/.test(LECTURE_FACTURE[0]),
  'le nombre d\'unités est LU dans la réponse du fournisseur',
  'sans cette lecture, chaque appel retombe sur le plancher — une sous-estimation muette',
)
ok(
  LECTURE_FACTURE !== null && /'plancher'/.test(LECTURE_FACTURE[0]),
  'et le repli, quand le fournisseur ne dit rien, est DÉCLARÉ',
)

//  ⚠️ L'ASSERTION QUI COMPTE VRAIMENT, ET ELLE EST PLUS FINE QUE LES TROIS
//     PRÉCÉDENTES. Le fichier pourrait très bien lire `billed_units` quelque
//     part ET passer `lot.length` à sa consommation : les trois assertions
//     ci-dessus resteraient vertes, et le compteur resterait faux. On ancre
//     donc sur le BLOC de la consommation (§E.8), pas sur le fichier.
const BLOC_CONSO = RERANK.match(/consommation:\s*\{[\s\S]*?\n\s*\},/)
ok(BLOC_CONSO !== null, 'le bloc de consommation du reranker est identifiable')
if (BLOC_CONSO) {
  ok(
    !/lot\.length/.test(BLOC_CONSO[0]),
    'la consommation du reranker ne se déduit PAS de la taille du lot',
    'la taille du lot est un RÉGLAGE : en déduire une dépense, c\'est faire dépendre le coût d\'un curseur d\'écran',
  )
  ok(
    /r\.facture\./.test(BLOC_CONSO[0]),
    'la consommation du reranker vient de ce que l\'appel a rendu',
  )
  ok(
    /source:/.test(BLOC_CONSO[0]),
    'la consommation du reranker DÉCLARE d\'où vient son nombre',
    'sans `source`, une valeur lue et une valeur bornée se liraient pareil (§E.24)',
  )
}

// ═════════════════════════════════════════════════════════════════════════════
section('D. LES RÈGLES DE COÛT, EXÉCUTÉES (§E.33)')

const TARIF_JETONS = {
  model: 'm',
  usd_par_1m_entree: 1,
  usd_par_1m_sortie: 10,
  usd_par_unite: null,
  usd_par_recherche: null,
  usd_par_recherche_web: 0.01,
}
const TARIF_JETONS_SANS_WEB = { ...TARIF_JETONS, usd_par_recherche_web: null }
const TARIF_RECHERCHE = {
  model: 'r',
  usd_par_1m_entree: null,
  usd_par_1m_sortie: null,
  usd_par_unite: null,
  usd_par_recherche: 0.002,
  usd_par_recherche_web: null,
}
const TARIF_UNITE = { ...TARIF_RECHERCHE, usd_par_recherche: null, usd_par_unite: 0.000002 }

const presque = (a, b) => a !== null && Math.abs(a - b) < 1e-12

ok(
  presque(
    coutUsd({ forme: 'jetons', model: 'm', entree: 1_000_000, sortie: 1_000_000 }, TARIF_JETONS),
    11,
  ),
  'un appel sans recherche coûte ses jetons',
)
ok(
  presque(
    coutUsd(
      { forme: 'jetons', model: 'm', entree: 1_000_000, sortie: 1_000_000, recherches_web: 3 },
      TARIF_JETONS,
    ),
    11.03,
  ),
  'un appel qui a cherché paie ses jetons ET ses recherches',
)
ok(
  coutUsd(
    { forme: 'jetons', model: 'm', entree: 1_000_000, sortie: 0, recherches_web: 3 },
    TARIF_JETONS_SANS_WEB,
  ) === null,
  'un appel qui a cherché SANS prix de recherche n\'a pas de coût connu',
  'rendre le prix des seuls jetons serait un coût PARTIEL, donc FAUX, et il se lirait comme complet (§E.24)',
)
ok(
  presque(
    coutUsd({ forme: 'jetons', model: 'm', entree: 1_000_000, sortie: 0 }, TARIF_JETONS_SANS_WEB),
    1,
  ),
  'un appel qui n\'a PAS cherché n\'exige aucun prix de recherche',
  'exiger le prix partout rendrait NULL le coût de tous les appels ordinaires',
)
ok(
  presque(coutUsd({ forme: 'recherches', model: 'r', recherches: 3, source: 'fournisseur' }, TARIF_RECHERCHE), 0.006),
  'une recherche coûte le prix d\'une recherche',
)
ok(
  coutUsd({ forme: 'recherches', model: 'r', recherches: 3, source: 'fournisseur' }, TARIF_UNITE) === null,
  'une recherche facturée à un tarif PAR DOCUMENT n\'a pas de coût',
  'la forme et le tarif doivent s\'accorder : sinon un lot de 200 se paierait au prix d\'un document',
)
ok(
  presque(coutUsd({ forme: 'unites', model: 'r', unites: 200 }, TARIF_UNITE), 0.0004),
  'la forme historique PAR DOCUMENT reste calculable',
  'les lignes écrites avant le 23/09/2026 la portent : la retirer les rendrait illisibles',
)
ok(
  coutUsd({ forme: 'recherches', model: 'r', recherches: 1, source: 'plancher' }, null) === null,
  'un tarif absent ne donne aucun coût',
)

//  ── LES UNITÉS BRUTES ─────────────────────────────────────────────────────
ok(
  unitesBrutes({ forme: 'jetons', model: 'm', entree: 10, sortie: 5, recherches_web: 3 }) === 15,
  'les recherches web n\'entrent PAS dans les unités brutes',
  'jetons et recherches sont deux unités : les additionner ferait un nombre qui ne compte rien',
)
ok(
  unitesBrutes({ forme: 'recherches', model: 'r', recherches: 4, source: 'fournisseur' }) === 4,
  'les unités brutes d\'une recherche sont son nombre',
)

//  ── LA FABRIQUE ───────────────────────────────────────────────────────────
const AVEC_RECHERCHE = consommationJetons('m', {
  input_tokens: 10,
  output_tokens: 5,
  server_tool_use: { web_search_requests: 2 },
})
ok(
  AVEC_RECHERCHE.forme === 'jetons' && AVEC_RECHERCHE.recherches_web === 2,
  'la fabrique récupère les recherches web',
)
const SANS_RECHERCHE = consommationJetons('m', { input_tokens: 10, output_tokens: 5 })
ok(
  !('recherches_web' in SANS_RECHERCHE),
  'la fabrique n\'écrit pas de recherches quand il n\'y en a pas',
  'un `recherches_web: 0` partout ferait croire que la question se pose sur toutes les lignes',
)
const ABSENT = consommationJetons('m', undefined)
ok(
  ABSENT.entree === 0 && ABSENT.sortie === 0 && !('recherches_web' in ABSENT),
  'un usage absent ne produit ni NaN ni recherche imaginaire',
)
const ABERRANT = consommationJetons('m', {
  input_tokens: -5,
  output_tokens: 'beaucoup',
  server_tool_use: { web_search_requests: -1 },
})
ok(
  ABERRANT.entree === 0 && ABERRANT.sortie === 0 && !('recherches_web' in ABERRANT),
  'un usage aberrant vaut zéro, jamais NaN',
  'NaN traverse un calcul sans rien faire rougir, et journalise un coût vide',
)

// ═════════════════════════════════════════════════════════════════════════════
section('E. LA GRILLE SAIT EXPRIMER UN PRIX PAR RECHERCHE')

const MIGRATIONS = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
const NOM_MIG = MIGRATIONS.filter((f) => f.includes('tarif_par_recherche'))
ok(NOM_MIG.length === 1, `une seule migration « tarif_par_recherche » (${NOM_MIG.length})`)
//  ⚠️ LE SQL SE DÉPOUILLE AUSSI. Ses commentaires commencent par deux tirets,
//     que le dépouilleur TypeScript ne connaît pas — et l'encadré de cette
//     migration CITE `NOT VALID` pour expliquer pourquoi elle ne l'emploie pas.
//     Mesuré : sans ce dépouillement, l'assertion « posée VALIDÉE » rougissait
//     sur sa propre justification. §E.7, à la lettre.
const MIG = NOM_MIG.length === 1 ? sansCommentairesSql(read(`supabase/migrations/${NOM_MIG[0]}`)) : ''

ok(
  /add column if not exists usd_par_recherche\b/.test(MIG) &&
    /add column if not exists usd_par_recherche_web\b/.test(MIG),
  'la migration ajoute les deux colonnes',
)
ok(
  /usd_par_recherche = 0\.002/.test(MIG) && /usd_par_unite = null/.test(MIG),
  'la migration donne au reranker un prix par recherche et lui retire son prix par document',
)
//  ⚠️ SANS CE BLOC, LA MIGRATION ÉCHOUE. La contrainte exigeait EXACTEMENT une
//     forme parmi DEUX : retirer le prix par document sans en donner un autre
//     laisse la ligne sans forme, et l'`update` est rejeté. Une garde qui est
//     une contrainte ne dépend d'aucune discipline (§E.31) — elle s'apprend.
ok(
  /drop constraint if exists ai_model_tarifs_forme_check/.test(MIG) &&
    /add constraint ai_model_tarifs_forme_check/.test(MIG),
  'la contrainte de forme apprend la troisième forme',
  'sans cela, la migration est rejetée par la contrainte qu\'elle n\'a pas mise à jour',
)
ok(
  !/not valid/i.test(MIG),
  'la contrainte est posée VALIDÉE',
  '`NOT VALID` ne dispense que l\'insertion : il rend IMMUABLES les lignes qu\'il tolère (§E.64)',
)
//  UNE MIGRATION QUI « RÉUSSIT » N'A RIEN PROUVÉ (§E.60) — et une postcondition
//  qui LIT `pg_constraint` prouve qu'un nom est pris, pas qu'une règle mord.
const SONDES = (MIG.match(/exception when check_violation/g) ?? []).length
ok(SONDES >= 4, `la postcondition ÉPROUVE la contrainte (${SONDES} sondes)`)
//  ⚠️ LA MUTATION A TROUVÉ CE TROU AUSSI. L'assertion cherchait le NOM de la
//     sonde — et ce nom survit dans la liste de vérification finale, si bien
//     que la renommer laissait le contrôle VERT (§E.34). Ce qu'on garde, ce
//     n'est pas un nom : c'est qu'une sonde RAISE quand la contrainte a
//     REFUSÉ, c'est-à-dire une assertion RETOURNÉE.
ok(
  /if v_mord then\s*\n\s*raise exception/.test(MIG),
  'une sonde vérifie que la troisième forme est ACCEPTÉE',
  'toutes les sondes testent un REFUS : une contrainte qui refuse TOUT les passerait (§E.34)',
)
ok(
  (MIG.match(/raise exception 'postcondition NON TENUE/g) ?? []).length >= 8,
  'la postcondition LÈVE, elle ne se contente pas de signaler',
)

const ROUTE = sansCommentaires(read('app/api/admin/tarifs-ia/route.ts'))
ok(
  /usd_par_recherche_web/.test(ROUTE) && /usd_par_recherche\b/.test(ROUTE),
  'la route des tarifs connaît les deux nouvelles colonnes',
)
//  ⚠️ ET LE TROISIÈME TROU QUE LA MUTATION A TROUVÉ, LE PLUS INSTRUCTIF.
//     L'assertion cherchait le NOM d'une variable locale de la route
//     (`parRecherche`) : un renommage la laissait verte alors que la règle
//     pouvait avoir changé, et une règle écrite dans un `if` ne peut pas
//     s'exécuter (§E.34).
//     LA RÈGLE A DONC ÉTÉ EXTRAITE dans un module PUR, que la route ET l'écran
//     lisent, et que ce contrôle EXÉCUTE (§E.33). Une mutation de banc a produit
//     un module — c'est le meilleur usage qu'on puisse en faire.
const NUL = { entree: null, sortie: null, unite: null, recherche: null, rechercheWeb: null }
{
  const v = jugerForme({ ...NUL, recherche: 0.002 })
  ok(
    v.ok && v.forme === 'recherche',
    'la route accepte la forme PAR RECHERCHE',
    'un tarif qui ne se saisit pas est un tarif qu\'on ne peut pas corriger (§D.7)',
  )
}
{
  const v = jugerForme({ ...NUL, recherche: 0.002, rechercheWeb: 0.01 })
  ok(
    !v.ok && v.code === 'invalid_web_search_price',
    'la route refuse un prix de recherche web hors de la forme JETONS',
    'un prix que rien ne peut consommer est un réglage mort qui a l\'air vivant (§D.11)',
  )
}
ok(
  jugerForme({ ...NUL }).ok === false,
  'une ligne SANS aucune forme est refusée',
  'elle produirait un coût nul silencieux — le défaut que la table existe pour fermer',
)
ok(
  jugerForme({ ...NUL, entree: 1, sortie: 10, recherche: 0.002 }).ok === false,
  'une ligne à DEUX formes est refusée',
)
{
  const v = jugerForme({ ...NUL, entree: 1, sortie: 10, rechercheWeb: 0.01 })
  ok(v.ok && v.forme === 'jetons', 'le supplément de recherche web est accepté SUR les jetons')
}
ok(
  formeDeLigne({ unite: null, recherche: 0.002 }) === 'recherche' &&
    formeDeLigne({ unite: 0.000002, recherche: null }) === 'unite' &&
    formeDeLigne({ unite: null, recherche: null }) === 'jetons',
  'la forme d\'une ligne existante se LIT, dans les trois cas',
)
ok(
  /jugerForme\s*\(/.test(ROUTE),
  'la route délègue à la règle partagée, elle ne la réécrit pas',
  'trois écritures d\'une même règle font trois occasions de diverger (§E.20)',
)
ok(
  /invalid_web_search_price/.test(ROUTE),
  'la route rend le motif NOMMÉ du refus',
  'un 500 « db_error » de la contrainte n\'apprendrait rien à l\'administrateur',
)

const ECRAN = sansCommentaires(read('app/[locale]/admin/tarifs-ia/page.tsx'))
ok(
  /formeDeLigne\s*\(/.test(ECRAN),
  'l\'écran DÉRIVE la forme avec la MÊME règle que la route',
  'une copie de la règle dans l\'écran diverge le jour où l\'une des deux change (§E.20)',
)
//  ⚠️ ON ANCRE SUR L'AFFECTATION, PAS SUR LA COMPARAISON (§E.8). L'écran
//     compare légitimement `usd_par_unite == null` pour REMPLIR un champ de
//     saisie — comme il le fait pour les quatre autres prix. Ce qu'on refuse,
//     c'est qu'une comparaison devienne un NOM dont on se sert pour brancher :
//     `const parJetons = ligne.usd_par_unite == null`. Interdire la comparaison
//     aurait rougi sur du code sain, et la vraie règle serait restée non gardée.
const INFERENCE = ECRAN.match(/(?:const|let)\s+\w+\s*=[^\n;]*usd_par_\w+\s*==\s*null/)
ok(
  INFERENCE === null,
  'l\'écran n\'infère plus la forme par la NÉGATIVE',
  INFERENCE
    ? `inférence trouvée : « ${INFERENCE[0].trim()} » — avec deux formes l'absence de l'une prouvait l'autre ; avec trois elle ne prouve plus rien (§E.37)`
    : undefined,
)
ok(
  /field_search'/.test(ECRAN) && /field_web_search'/.test(ECRAN),
  'l\'écran offre un champ pour chacun des deux nouveaux prix',
)

// ── LA PARITÉ DES QUATRE LANGUES ───────────────────────────────────────────
const CLES = [
  'field_search',
  'field_search_help',
  'field_web_search',
  'field_web_search_help',
  'err_invalid_web_search_price',
]
let manquantes = 0
for (const langue of ['fr', 'en', 'es', 'de']) {
  const j = JSON.parse(read(`messages/${langue}.json`))
  const n = j.admin_back_office?.tarifs_ia ?? {}
  for (const c of CLES) {
    if (typeof n[c] !== 'string' || n[c].trim() === '') {
      manquantes++
      console.log(`  KO   ${langue}.json : admin_back_office.tarifs_ia.${c} manque`)
    }
  }
}
if (manquantes > 0) failures++
ok(manquantes === 0, `les ${CLES.length} clés existent dans les quatre langues`)

// ═════════════════════════════════════════════════════════════════════════════
section('F. LES TÉMOINS — les détecteurs peuvent-ils rougir ? (§E.33)')

//  Un détecteur qui ne peut pas rougir ne prouve rien. Chacun est retourné
//  contre une entrée FABRIQUÉE, de la forme exacte qu'il doit refuser.
ok(
  /forme:\s*'jetons'/.test(sansCommentaires("const x = { forme: 'jetons', model: 'm' }")),
  'témoin : le motif de la fabrique à la main mord sur du code',
)
ok(
  !/forme:\s*'jetons'/.test(sansCommentaires("// const x = { forme: 'jetons' }")),
  'témoin : il ne mord PAS sur un commentaire (§E.7)',
)
ok(
  /\.messages\.create\s*\(/.test('await client.messages.create({'),
  'témoin : la découverte reconnaît un appel au modèle',
)
ok(
  !/\.messages\.create\s*\(/.test('await client.messages.list()'),
  'témoin : elle ne confond pas avec un autre appel du SDK',
)
{
  const bloc = "consommation: {\n  forme: 'recherches',\n  recherches: lot.length,\n},"
  const m = bloc.match(/consommation:\s*\{[\s\S]*?\n\s*\},/)
  ok(
    m !== null && /lot\.length/.test(m[0]),
    'témoin : l\'ancrage sur le bloc attrape un retour à la taille du lot',
    'ce témoin garantit que l\'assertion C ne verdit pas par accident',
  )
}
ok(
  !APPEL(vuesDe('const re = /\\.messages\\.create\\s*\\(/')) &&
    !APPEL(vuesDe("const attendu = 'await client.messages.create({})'")),
  'témoin : la découverte ignore un motif porté par une regex ou une chaîne',
  'sans ce dépouillement, elle dénonce les diagnostics qui CHERCHENT les appels (§E.7)',
)
ok(
  APPEL(vuesDe('const r = await client.messages.create({ model })')),
  'témoin : … et elle voit toujours un vrai appel',
  'un dépouillement trop large rendrait la découverte aveugle, donc verte en toutes circonstances',
)
//  ⚠️ LE TÉMOIN QUI A TROUVÉ LE DÉFAUT DE CE CONTRÔLE. Un dépouillement qui
//     jette les chaînes perd l'ADRESSE du reranker — la découverte tombe de 7
//     points à 6, reste verte, et rate exactement celui que ce lot corrige.
ok(
  APPEL(vuesDe("const E = 'https://api.cohere.com/v2/rerank'\nawait fetch(E, {})")),
  'témoin : un appel dont l\'adresse vit dans une CHAÎNE est vu',
  'c\'est le cas du reranker : jeter les chaînes rend la découverte aveugle, pas rouge',
)
ok(
  !APPEL(vuesDe('const motifs = [{ re: /api\\.cohere\\.com/ }]')),
  'témoin : … et une adresse portée par une regex, sans fetch, ne l\'est pas',
)
ok(
  !APPEL(vuesDe("const u = 'https://api.cohere.com/x'")),
  'témoin : une adresse SANS aucun fetch n\'est pas un appel',
)
ok(
  !APPEL(vuesDe('const a = 1 // client.messages.create(')),
  'témoin : un motif en commentaire de FIN de ligne ne compte pas',
  'le dépouilleur de commentaires doit mordre ailleurs qu\'en début de ligne',
)
ok(
  NEUTRALISE('globalThis.fetch = async (u) => new Response()') &&
    NEUTRALISE('globalThis.fetch = (u) => 1') &&
    !NEUTRALISE('globalThis.fetch = realFetch'),
  'témoin : neutraliser, c\'est poser un DOUBLE — pas restaurer l\'original',
)
ok(
  sansCommentaires("const u = 'https://x.y/z'").includes('https://x.y/z'),
  'témoin : … mais il ne coupe PAS une URL en deux',
  'sans le garde-fou du deux-points, toute adresse disparaîtrait et le reranker avec',
)
ok(
  sansCommentairesSql('select 1; -- not valid\nselect 2;').includes('not valid') === false,
  'témoin : le dépouilleur SQL retire un commentaire à deux tirets',
)
ok(
  sansCommentairesSql("alter table t add constraint c check (x) not valid;").includes('not valid'),
  'témoin : … et il garde le SQL qui porte vraiment la clause',
  'un dépouilleur qui mange tout rendrait l\'assertion « posée VALIDÉE » verte quoi qu\'il arrive',
)
{
  const RE = /(?:const|let)\s+\w+\s*=[^\n;]*usd_par_\w+\s*==\s*null/
  ok(
    RE.test('const parJetons = ligne.usd_par_unite == null') &&
      !RE.test("unite: l.usd_par_unite == null ? '' : String(l.usd_par_unite),"),
    'témoin : le détecteur d\'inférence distingue un branchement d\'un remplissage de champ',
  )
}
{
  //  Une fonction dont le type de retour est un objet — la forme exacte qui a
  //  piégé la première version de l'ancre.
  const echantillon = [
    'function f(x: T): {',
    '  a: number',
    '} {',
    '  const u = LU_ICI',
    '  return { a: u }',
    '}',
    '',
  ].join('\n')
  const court = echantillon.match(/function f\([\s\S]*?\n\}/)
  const juste = echantillon.match(/function f\([\s\S]*?\n\}\n/)
  ok(
    court !== null && !/LU_ICI/.test(court[0]) && juste !== null && /LU_ICI/.test(juste[0]),
    'témoin : l\'ancre de bloc traverse un type de retour en objet',
    'l\'ancre courte s\'arrête sur l\'accolade du TYPE et capture une signature vide',
  )
}
ok(
  coutUsd({ forme: 'jetons', model: 'm', entree: 0, sortie: 0, recherches_web: 1 }, TARIF_JETONS_SANS_WEB) === null &&
    coutUsd({ forme: 'jetons', model: 'm', entree: 0, sortie: 0, recherches_web: 1 }, TARIF_JETONS) === 0.01,
  'témoin : la règle du coût partiel distingue bien les deux tarifs',
  'sans ce témoin, un `return null` inconditionnel passerait l\'assertion D',
)

// ═════════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ le compteur compte ce qu\'on paie\n'
    : `\n❌ ${failures} écart(s)\n`,
)
process.exit(failures === 0 ? 0 : 1)
