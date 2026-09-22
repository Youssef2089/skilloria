// scripts/diag-contraste-par-ecran.mjs — LE CONTRASTE, PAGE PAR PAGE, MESURE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE CONTROLE, ET POURQUOI IL N'EST PAS UNE MESURE PAR ZONE
//
//   J'ai d'abord mesure le contraste par ZONE — douze couples de jetons, une
//   fois — en arguant qu'une page ne definissant plus aucune couleur, son
//   contraste est entierement determine par les couples qu'elle emploie.
//
//   L'ARGUMENT NE VAUT QUE SI L'INVENTAIRE DES COUPLES EST COMPLET, et je ne
//   l'avais pas verifie : je l'avais SUPPOSE. C'est la meme faute que celle du
//   §E.56 — j'avais verifie le raisonnement, pas l'ecran.
//
//   Ce controle ne suppose plus. Il OUVRE chaque bloc de style de chaque page,
//   en extrait le couple (texte, fond) REELLEMENT ecrit, et le mesure avec
//   `contrastRatio` du depot.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LES MINIMUMS, ET POURQUOI ILS DIFFERENT
//   4,5 : un texte qu'on lit (WCAG AA, texte normal).
//   3,0 : `--sk-faint`, reserve aux etiquettes de structure — la regle §D.12
//         lui interdit de porter une information, et cette moitie-la se lit
//         ecran par ecran, pas ici.
//
// CE QU'IL NE VERIFIE PAS, ET IL LE DIT
//   · Un fond HERITE. Quand un bloc pose une couleur de texte SANS fond, le
//     fond vient d'un parent JSX, d'un composant ou d'une classe : il n'est
//     PAS deductible du source. Le controle NE LE DEVINE PAS — il compte ces
//     blocs et les declare dans son rapport (§E.38).
//     ⚠️ Une premiere version reportait « le dernier fond rencontre ». Elle
//     mesurait la proximite dans le TEXTE, pas l'imbrication dans l'ARBRE, et
//     declarait « --sk-accent sur --sk-accent » a 1,00 : 1 (§E.40). Le bloc
//     ci-dessous, avant la boucle, garde le detail de cette faute.
//   · Que le jeton choisi soit le BON. `--sk-faint` a 3,36 est parfait pour
//     une etiquette et faux pour une phrase : aucun motif ne lit un role.
//
//   node scripts/diag-contraste-par-ecran.mjs [--detail]
//   Aucune base, aucun reseau, aucune ecriture. Lecture seule.
//   0 = vert · 1 = rouge · 2 = n'a pas tourne.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DETAIL = process.argv.includes('--detail')

const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

const sansCommentaires = (src) =>
  src
    .split('\n')
    .map((l) => {
      const nu = l.trimStart()
      if (nu.startsWith('//') || nu.startsWith('*') || nu.startsWith('/*')) return ''
      return l
    })
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/* ═══════════════════════════════════════════════════════════════════════════
   LA PALETTE, LUE DANS SA SOURCE — pas recopiee (§D.12).
   ═══════════════════════════════════════════════════════════════════════════ */

const palette = lire('lib/palette.ts')
const valeurDe = (champ) => {
  const m = palette.match(new RegExp(`${champ}: '(#[0-9A-Fa-f]{6})'`))
  return m ? m[1] : null
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE CALCUL — celui du depot, pas une seconde implementation (§E.33).
   ═══════════════════════════════════════════════════════════════════════════ */

// ⚠️ ON IMPORTE LE FICHIER DU DÉPÔT, TEL QUEL.
//
//    Une première version le « transpilait » en retirant les annotations de
//    type par expression régulière. Elle mangeait l'accolade ouvrante des
//    corps de fonction (`export function parseHex(hex) {` devenait
//    `export function parseHex(hex)=`), et Node refusait le module.
//
//    Node exécute le TypeScript directement depuis la v22. Mesurer avec le
//    VRAI `contrastRatio` est d'ailleurs le point : une seconde
//    implémentation, même correcte, ne prouverait rien sur la première
//    (§E.33).
const { contrastRatio, deriveAccentColor, accentTint, accentStrong } = await import(
  new URL('../lib/couleur.ts', import.meta.url).href
)

/**
 * ⚠️ `--sk-accent` N'EST PAS LA COULEUR DE MARQUE. C'est l'accent DÉRIVÉ :
 *    `deriveAccentColor(marque, fond, encre)` abaisse la luminance à teinte et
 *    saturation constantes jusqu'à franchir 7 : 1.
 *
 *    La première version de cette table l'avait mis à `marque` — la valeur
 *    brute, `#0EA5E9`. Elle a déclaré TROIS couples sous leur minimum, à
 *    2,77 : 1, sur vingt pages : du blanc sur l'accent, l'accent sur du blanc.
 *    Le produit n'avait rien de faux ; c'est MA TABLE qui l'était.
 *
 *    C'est la troisième fois dans ce lot que recopier une valeur au lieu de la
 *    LIRE À SA SOURCE produit un faux verdict. On la calcule donc ici comme le
 *    produit la calcule, avec sa fonction.
 */
const ACCENT = deriveAccentColor(
  valeurDe('marque'),
  valeurDe('fond_page'),
  valeurDe('texte_principal'),
)

/** jeton `--sk-*` → hexadecimal de la palette de reference. */
const JETONS = {
  '--sk-bg': valeurDe('fond_page'),
  '--sk-bandeau': valeurDe('bandeau'),
  '--sk-surface': valeurDe('cartes'),
  '--sk-surface-2': valeurDe('bandeau'),
  '--sk-border': valeurDe('bordures'),
  '--sk-border-soft': valeurDe('bordureDouce'),
  '--sk-text': valeurDe('texte_principal'),
  '--sk-muted': valeurDe('texte_secondaire'),
  '--sk-faint': valeurDe('texteTenu'),
  '--sk-marque': valeurDe('marque'),
  '--sk-accent': ACCENT,
  // Dérivés de l'accent, exactement comme `resolvePalette` les dérive.
  '--sk-accent-soft': accentTint(ACCENT),
  '--sk-accent-fort': accentStrong(ACCENT),
  '--sk-accent-ink': ACCENT,
  '--sk-sur-accent': valeurDe('cartes'),
  '--sk-success': valeurDe('succes'),
  '--sk-success-soft': valeurDe('succesDoux'),
  '--sk-amber': valeurDe('avertissement'),
  '--sk-amber-soft': valeurDe('avertissementDoux'),
  '--sk-red': valeurDe('erreur'),
  '--sk-red-soft': valeurDe('erreurDoux'),
  '--sk-encre': valeurDe('texte_principal'),
  '--sk-sur-encre': valeurDe('surEncre'),
}

const absents = Object.entries(JETONS).filter(([, v]) => v === null).map(([k]) => k)
if (absents.length > 0) {
  console.error(`\n❌ Jetons introuvables dans lib/palette.ts : ${absents.join(', ')}`)
  process.exit(2)
}


/* ═══════════════════════════════════════════════════════════════════════════
   L'EXTRACTION — chaque bloc `style={{ … }}`, et le couple qu'il porte.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Les blocs de style d'un fichier, du `style={{` a son `}}` equilibre.
 * On compte les accolades : un `${…}` a l'interieur ne doit pas fermer le bloc.
 */
function blocsDeStyle(s) {
  const out = []
  let i = 0
  while ((i = s.indexOf('style={{', i)) !== -1) {
    let prof = 0
    let j = i + 'style={'.length
    for (; j < s.length; j++) {
      if (s[j] === '{') prof++
      else if (s[j] === '}') {
        prof--
        if (prof === 0) break
      }
    }
    out.push(s.slice(i, j + 1))
    i = j + 1
  }
  return out
}

const JETON = /var\((--sk-[a-z0-9-]+)\)/

/** Le couple (texte, fond) d'un bloc — `null` pour ce qu'il ne pose pas. */
function coupleDe(bloc) {
  // On ne retient que les declarations de PREMIER niveau du bloc : un
  // `boxShadow` ou un `border` n'est pas une couleur de texte.
  const texte = bloc.match(/(?:^|[\s,{])color:\s*(?:[^,}]*?)var\((--sk-[a-z0-9-]+)\)/)
  const fond = bloc.match(/(?:^|[\s,{])background(?:Color)?:\s*(?:[^,}]*?)var\((--sk-[a-z0-9-]+)\)/)
  return {
    texte: texte ? texte[1] : null,
    fond: fond ? fond[1] : null,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE BALAYAGE
   ═══════════════════════════════════════════════════════════════════════════ */

const ESPACE = 'app/[locale]'
function pages(d, acc = []) {
  for (const e of readdirSync(join(ROOT, d))) {
    const rel = `${d}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) pages(rel, acc)
    else if (e === 'page.tsx') acc.push(rel)
  }
  return acc
}

const CONNECTE = [`${ESPACE}/dashboard`, `${ESPACE}/admin`].flatMap((d) =>
  existsSync(join(ROOT, d)) ? pages(d) : [],
)

const minimumDe = (jetonTexte) => (jetonTexte === '--sk-faint' ? 3 : 4.5)

let echecs = 0
let couplesMesures = 0
const sousMinimum = []
const inventaire = new Map()
const inconnus = new Set()

/* ┌─ CE QUE J'AI ESSAYÉ D'ABORD, ET POURQUOI C'ÉTAIT FAUX ──────────────────┐
   │ La première version reportait « le dernier fond rencontré » sur les      │
   │ blocs qui n'en posent pas, en croyant remonter au parent.                │
   │                                                                          │
   │ ELLE MESURAIT LA PROXIMITÉ DANS LE TEXTE, PAS L'IMBRICATION DANS L'ARBRE.│
   │ Dans un fichier JSX, deux blocs `style={{…}}` consécutifs sont le plus   │
   │ souvent des FRÈRES : le fond de l'un ne s'applique pas à l'autre. Le     │
   │ résultat était absurde et le disait — « --sk-accent sur --sk-accent »,   │
   │ « --sk-muted sur --sk-muted », ratio 1,00.                               │
   │                                                                          │
   │ C'est §E.40 pour la deuxième fois dans ce lot : une fenêtre de voisinage │
   │ mesure la distance à un motif, jamais l'appartenance à ce qui le porte.  │
   └──────────────────────────────────────────────────────────────────────────┘

   ON NE PEUT PAS DÉDUIRE LE FOND EFFECTIF DU TEXTE SOURCE. Il faudrait
   l'arbre JSX, et même alors le fond vient souvent d'un composant parent ou
   d'une classe CSS. Alors on ne l'invente pas.

   CE QUI SE MESURE EXACTEMENT : les blocs qui posent EUX-MÊMES leur fond ET
   leur texte. Là, le couple est écrit, complet, sans hypothèse. C'est le seul
   ensemble sur lequel un ratio veut dire quelque chose.

   CE QUI NE SE MESURE PAS SE COMPTE ET SE DÉCLARE (§E.38). */
let texteSansFond = 0

/** page → { couples, pire, sansFond } — la matière de la colonne de l'audit. */
const parPage = new Map()

for (const p of CONNECTE.sort()) {
  const s = sansCommentaires(lire(p))
  parPage.set(p, { couples: 0, pire: null, sansFond: 0 })
  const ligne = parPage.get(p)
  for (const bloc of blocsDeStyle(s)) {
    const { texte, fond } = coupleDe(bloc)
    if (!texte) continue

    if (!fond) {
      // Le bloc peint un texte sur un fond qu'il ne déclare pas. Indéterminable
      // depuis le source — compté, jamais deviné.
      texteSansFond++
      ligne.sansFond++
      continue
    }

    // ⚠️ ON NE DEVINE PAS UN JETON QU'ON NE CONNAÎT PAS. Lui donner une valeur
    //    par défaut produirait un ratio inventé, donc un vert inventé — §E.22
    //    dans sa forme la plus coûteuse, une garde qui s'ouvre sur ce qu'elle
    //    n'a pas su lire. On le NOMME et on passe.
    if (!JETONS[texte] || !JETONS[fond]) {
      inconnus.add(!JETONS[texte] ? texte : fond)
      continue
    }

    const cle = `${texte} sur ${fond}`
    const r = contrastRatio(JETONS[texte], JETONS[fond])
    const min = minimumDe(texte)
    couplesMesures++

    if (!inventaire.has(cle)) inventaire.set(cle, { r, min, pages: new Set() })
    inventaire.get(cle).pages.add(p)

    ligne.couples++
    // ⚠️ LE PIRE D'UNE PAGE EST SON ÉCART AU MINIMUM, PAS SON PLUS PETIT RATIO.
    //    `--sk-faint` à 3,63 est conforme (min 3) ; `--sk-muted` à 4,20 ne le
    //    serait pas (min 4,5). Classer sur le ratio nu désignerait le premier.
    if (ligne.pire === null || r - min < ligne.pire.r - ligne.pire.min) {
      ligne.pire = { r, min, cle }
    }

    if (r < min) sousMinimum.push({ page: p, cle, r, min })
  }
}

/* ┌─ LA SORTIE MACHINE — celle qui alimente docs/audit-couleurs.html ────────┐
   │ L'audit ne recopie pas des chiffres : il les REÇOIT de ce contrôle. Une   │
   │ colonne saisie à la main vieillit en silence (§E.16, §E.24).              │
   └──────────────────────────────────────────────────────────────────────────┘ */
if (process.argv.includes('--json')) {
  const sortie = {}
  for (const [p, e] of parPage) {
    sortie[p.replace(`${ESPACE}/`, '')] = {
      couples: e.couples,
      sansFond: e.sansFond,
      pire: e.pire ? { r: Number(e.pire.r.toFixed(2)), min: e.pire.min, cle: e.pire.cle } : null,
    }
  }
  console.log(JSON.stringify({ pages: sortie, sousMinimum: sousMinimum.length }, null, 2))
  process.exit(sousMinimum.length === 0 ? 0 : 1)
}

const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

section('Les couples RÉELLEMENT écrits, et leur ratio')

const tries = [...inventaire.entries()].sort((a, b) => a[1].r - b[1].r)
for (const [cle, e] of tries) {
  const verdict = e.r >= e.min ? 'ok  ' : 'KO  '
  console.log(
    `  ${verdict} ${e.r.toFixed(2).padStart(6)} : 1  (min ${e.min})  ${cle.padEnd(40)} ${e.pages.size} page(s)`,
  )
}

section('Le verdict')

ok(CONNECTE.length >= 60, `${CONNECTE.length} pages balayées`)
ok(couplesMesures > 0, `${couplesMesures} couples (texte, fond) mesurés`)
ok(
  sousMinimum.length === 0,
  'aucun couple sous son minimum',
  sousMinimum.slice(0, 10).map((x) => `${x.page} : ${x.cle} = ${x.r.toFixed(2)} < ${x.min}`).join(' · '),
)

if (DETAIL) {
  section('Les pages, et les couples que chacune emploie')
  for (const p of CONNECTE.sort()) {
    const siens = tries.filter(([, e]) => e.pages.has(p)).map(([cle]) => cle)
    console.log(`  ${p.replace(`${ESPACE}/`, '')}`)
    console.log(`     ${siens.length ? siens.join(' · ') : '(aucun couple écrit — la page hérite entièrement)'}`)
  }
}

section('Ce que ce contrôle ne vérifie pas')

if (inconnus.size > 0) {
  note(`jeton(s) hors table, NON mesure(s) : ${[...inconnus].join(', ')}`)
}
note(`${texteSansFond} bloc(s) peignent un texte sur un fond QU ILS NE DECLARENT PAS.`)
note('Leur fond vient d un parent JSX, d un composant, ou d une classe CSS : il')
note("n est PAS deductible du source, et il n est donc pas devine. Ce sont eux")
note('qui restent a lire a l ecran — le controle dit lesquels, pas ce qu ils valent.')
note('il ne dit pas non plus que le jeton choisi soit le BON — `--sk-faint` a')
note('3,36 est parfait pour une etiquette et faux pour une phrase. Aucun motif')
note('ne lit un role ; cette moitie-la se lit ecran par ecran (§D.12, §E.38).')

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} CONTRÔLE(S) EN ÉCHEC\n`)
  process.exit(1)
}
console.log(`✅ ${couplesMesures} couples mesurés sur ${CONNECTE.length} pages, aucun sous son minimum.\n`)
process.exit(0)
