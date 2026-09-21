// scripts/diag-coquille-unique.mjs — UNE SEULE COQUILLE POUR TOUT L'ESPACE
//                                    CONNECTE, ET AUCUNE EXCEPTION.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE CAS MESURE, LE 21/09/2026
//
//   L'espace connecte compte 66 pages. Il portait CINQ cadres differents :
//
//     A. `DashboardShell` — 38 pages (freelance, cdi, entreprise)
//     B. le layout admin, en ligne, sans barre superieure — 24 pages
//     C. une coquille recopiee dans `freelance/mon-profil`, EN TROIS
//        EXEMPLAIRES dans le meme fichier (squelette, aide, rendu principal)
//     D. un en-tete maison dans `cdi/mon-profil`, SANS barre laterale
//     E. `OrganisationSidebar` — 338 lignes, montee par ZERO page
//
//   LE PIRE EST D. Une liste d'exclusion sortait `cdi/mon-profil` du cadre
//   partage, et sa justification etait ecrite dans le layout : « elle rend
//   DashboardSidebar elle-meme ». C'ETAIT FAUX, et mesurable en un grep : la
//   barre laterale n'y etait importee nulle part. L'expert qui ouvrait son
//   profil n'avait plus AUCUN lien vers le reste du produit.
//
//   Le commentaire avait survecu au code qu'il decrivait, et c'est lui qui
//   defendait l'exclusion (§E.7 : un commentaire n'a jamais rendu une barre
//   laterale).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE CONTROLE DEFEND
//
//   (A) AUCUNE LISTE D'EXCLUSION dans les sub-layouts. Une exception ouverte
//       pour UNE page devient un endroit ou d'autres tombent — c'est arrive :
//       /profil et /profil/valider y sont tombees, nues, sans que personne ne
//       l'ait voulu.
//   (B) AUCUNE PAGE NE REBATIT DE COQUILLE. Ni barre laterale montee a la
//       main, ni en-tete maison.
//   (C) AUCUN SECOND PLEIN ECRAN dans la coquille. Un `minHeight: 100vh` sous
//       un en-tete de 60 px fait defiler la page deux fois.
//   (D) L'EN-TETE ET LA BARRE LATERALE ONT LA MEME COULEUR — le beige du
//       cadre, choisi par le proprietaire du produit.
//   (E) PAS DE CODE MORT DE COQUILLE.
//
// CE QU'IL NE VERIFIE PAS, ET IL LE DIT
//   Il ne dit pas que le cadre est BEAU, ni qu'il est identique au pixel pres
//   d'une page a l'autre : cela demande un navigateur. Il dit qu'il n'y a
//   qu'un cadre, et qu'aucune page n'y echappe.
//
//   node scripts/diag-coquille-unique.mjs
//   Aucune base, aucun reseau, aucune ecriture. Lecture seule.
//   0 = vert · 1 = rouge · 2 = n'a pas tourne.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** §E.3 — sans normalisation, tout motif qui traverse un saut de ligne ment. */
const lire = (p) => {
  const abs = join(ROOT, p)
  if (!existsSync(abs)) {
    console.error(`\n❌ Fichier introuvable : ${p}`)
    process.exit(2)
  }
  return readFileSync(abs, 'utf8').split('\r\n').join('\n')
}

/** §E.7 — un contrôle qui lit un commentaire défend une prose, pas une règle. */
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
    // Les commentaires JSX `{/* … */}` aussi : ils décrivent souvent
    // précisément ce que le contrôle interdit.
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

let echecs = 0
const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

/** Toutes les pages sous un dossier, en chemins relatifs à la racine. */
function pages(sousDossier) {
  const out = []
  const parcourir = (d) => {
    for (const e of readdirSync(join(ROOT, d))) {
      const rel = `${d}/${e}`
      if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
      else if (e === 'page.tsx') out.push(rel)
    }
  }
  parcourir(sousDossier)
  return out
}

const ESPACE = 'app/[locale]'
const CONNECTE = [`${ESPACE}/dashboard`, `${ESPACE}/admin`]

// ══════════════════════════════════════════════════════════════════════════
section('A. Aucune liste d exclusion dans les sub-layouts')
// ══════════════════════════════════════════════════════════════════════════

const LAYOUTS = [
  `${ESPACE}/dashboard/freelance/layout.tsx`,
  `${ESPACE}/dashboard/cdi/layout.tsx`,
  `${ESPACE}/dashboard/entreprise/layout.tsx`,
]

for (const l of LAYOUTS) {
  const src = sansCommentaires(lire(l))
  const nom = l.split('/').slice(-2)[0]
  ok(/<DashboardShell side=/.test(src),
    `${nom} : monte la coquille partagée`)
  // ⚠️ ANCRE SUR LE COMPORTEMENT, PAS SUR UN NOM (§E.34). Ce n'est pas
  //    `LEGACY_SHELL_ROUTES` qu'on interdit — un renommage y échapperait —
  //    c'est le RETOUR SANS COQUILLE : un chemin qui rend `children` nus.
  ok(!/return <>\{children\}<\/>/.test(src),
    `${nom} : aucun chemin ne rend les pages NUES`,
    'une exception ouverte pour une page devient un endroit ou d autres tombent')
  ok(!/usePathname/.test(src),
    `${nom} : ne consulte même pas le chemin`,
    'lire le chemin dans un layout de cadre n a qu un usage : faire une exception')
}

// ══════════════════════════════════════════════════════════════════════════
section('B. Aucune page ne rebâtit de coquille')
// ══════════════════════════════════════════════════════════════════════════

const toutesLesPages = CONNECTE.flatMap((d) => pages(d))
ok(toutesLesPages.length >= 60,
  `l espace connecté compte ${toutesLesPages.length} pages (le contrôle les balaie toutes)`)

// La barre latérale partagée ne se monte QUE depuis la coquille.
{
  const montages = []
  for (const p of toutesLesPages) {
    if (/<DashboardSidebar\b/.test(sansCommentaires(lire(p)))) montages.push(p)
  }
  ok(montages.length === 0,
    'aucune page ne monte DashboardSidebar elle-même',
    `vu dans : ${montages.join(', ')} — une page qui rebatit son cadre le laisse deriver (§E.20)`)
}

// Un en-tête maison : un `<header>` ou une barre de hauteur fixe 58/60 px.
{
  const coupables = []
  for (const p of toutesLesPages) {
    const src = sansCommentaires(lire(p))
    if (/height: 5[89],/.test(src) || /height: 60,[\s\S]{0,200}borderBottom/.test(src)) {
      coupables.push(p)
    }
  }
  ok(coupables.length === 0,
    'aucune page ne dessine une barre de la hauteur d un en-tête',
    `vu dans : ${coupables.join(', ')} — 58 px la ou la coquille en fait 60 : le cadre saute au chargement`)
}

// ══════════════════════════════════════════════════════════════════════════
section('C. Aucun second plein écran dans la coquille')
// ══════════════════════════════════════════════════════════════════════════

{
  const coupables = []
  for (const p of toutesLesPages) {
    // L'admin a son propre cadre (section E) : il n'est pas sous `<main>`.
    if (p.startsWith(`${ESPACE}/admin`)) continue
    if (/minHeight: '100vh'/.test(sansCommentaires(lire(p)))) coupables.push(p)
  }
  ok(coupables.length === 0,
    'aucune page du dashboard ne peint un second plein écran',
    `vu dans : ${coupables.join(', ')} — 100vh sous un en-tete de 60 px fait defiler la page deux fois`)
}

// ══════════════════════════════════════════════════════════════════════════
section('D. L en-tête et la barre latérale portent la MÊME couleur')
// ══════════════════════════════════════════════════════════════════════════

{
  const topbar = sansCommentaires(lire('components/shell/DashboardTopbar.tsx'))
  const sidebar = sansCommentaires(lire('components/shell/DashboardSidebar.tsx'))

  const fondDe = (src, balise) => {
    const i = src.indexOf(balise)
    if (i < 0) return null
    const m = src.slice(i, i + 700).match(/background: '(var\(--sk-[a-z0-9-]+\))'/)
    return m ? m[1] : null
  }
  const fondTopbar = fondDe(topbar, '<header')
  const fondSidebar = fondDe(sidebar, '<aside')

  ok(fondTopbar !== null && fondSidebar !== null,
    `les deux fonds sont lisibles (en-tête ${fondTopbar} · barre ${fondSidebar})`)
  ok(fondTopbar === fondSidebar,
    'et ils sont IDENTIQUES',
    'l en-tete etait en --sk-surface (le blanc des CARTES) pendant que la barre laterale etait en --sk-bandeau : deux surfaces du meme cadre, deux couleurs')
  ok(fondTopbar === 'var(--sk-bandeau)',
    'et c est le BEIGE du cadre, choisi par le propriétaire du produit',
    '--sk-surface-2 porte aujourd hui la meme valeur mais ne dit pas la meme chose : il nomme un fond DANS une carte')
}

// ══════════════════════════════════════════════════════════════════════════
section('E. Pas de code mort de coquille')
// ══════════════════════════════════════════════════════════════════════════

{
  const mort = 'components/dashboard/OrganisationSidebar.tsx'
  ok(!existsSync(join(ROOT, mort)),
    'OrganisationSidebar a été supprimée',
    '338 lignes montees par zero page, retenues par un seul import de TYPE (regle 0)')
}

// ══════════════════════════════════════════════════════════════════════════
section('F. Ce que ce contrôle ne vérifie pas')
// ══════════════════════════════════════════════════════════════════════════

note('il ne dit PAS que le cadre est identique au pixel pres d une page a')
note("l autre : cela demande un navigateur. Il dit qu il n y en a QU UN, et")
note("qu aucune page de l espace connecte n y echappe.")
note("il ne juge pas non plus le cadre ADMIN, qui est different par decision")
note('produit — seul son CONTENU de menu change, et sa migration a son commit.')

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} CONTRÔLE(S) EN ÉCHEC\n`)
  process.exit(1)
}
console.log('✅ Une seule coquille, aucune exception, et son en-tête a la couleur de sa barre latérale.\n')
process.exit(0)
