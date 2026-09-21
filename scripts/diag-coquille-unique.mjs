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
import { dirname, join, relative, sep } from 'node:path'

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

  // ⚠️ TOUS LES `<header>`, PAS LE PREMIER (§E.8).
  //
  //    La première version lisait `indexOf('<header')` — le PREMIER. Depuis
  //    que la barre supérieure sert aussi l'admin, ce fichier en contient
  //    DEUX : repeindre le second en blanc serait passé inaperçu, et le
  //    contrôle aurait déclaré vert un cadre à deux couleurs. Exactement la
  //    panne qu'il est écrit pour empêcher.
  const fondsDe = (src, balise) =>
    src
      .split(balise)
      .slice(1)
      .map((bloc) => {
        const m = bloc.slice(0, 700).match(/background: '(var\(--sk-[a-z0-9-]+\))'/)
        return m ? m[1] : null
      })

  const fondsTopbar = fondsDe(topbar, '<header')
  const fondsSidebar = fondsDe(sidebar, '<aside')

  ok(fondsTopbar.length > 0 && fondsTopbar.every((f) => f !== null),
    `les ${fondsTopbar.length} en-tête(s) déclarent un fond (${fondsTopbar.join(' · ')})`)
  ok(fondsSidebar.length > 0 && fondsSidebar.every((f) => f !== null),
    `la barre latérale aussi (${fondsSidebar.join(' · ')})`)

  const tous = [...fondsTopbar, ...fondsSidebar]
  ok(new Set(tous).size === 1,
    'et TOUS portent la MÊME couleur',
    'l en-tete etait en --sk-surface (le blanc des CARTES) pendant que la barre laterale etait en --sk-bandeau : deux surfaces du meme cadre, deux couleurs')
  ok(tous.every((f) => f === 'var(--sk-bandeau)'),
    'et c est le BEIGE du cadre, choisi par le propriétaire du produit',
    '--sk-surface-2 porte aujourd hui la meme valeur mais ne dit pas la meme chose : il nomme un fond DANS une carte')
}

// ══════════════════════════════════════════════════════════════════════════
section('D bis. Les pages SANS cadre sont celles-là, et pas une de plus')
// ══════════════════════════════════════════════════════════════════════════
//
//  UN GEL D'ÉTAT MESURÉ, PAS D'EXEMPTIONS (§G.8). Il ne dit pas « ce défaut
//  est toléré » : il dit « voici les pages qui n'ont pas de cadre, au moment
//  du gel, CHACUNE avec sa raison ». Le contrôle continue de vérifier chaque
//  ligne, et toute NOUVELLE page sans cadre le fait rougir.
{
  // Une page a un cadre si elle est sous un sub-layout qui monte la coquille.
  // Les trois exceptions ci-dessous n'en ont pas — et chacune dit pourquoi.
  const SANS_CADRE = {
    [`${ESPACE}/dashboard/cabinet/page.tsx`]:
      "REDIRECTION SERVEUR : elle ne rend RIEN, le navigateur ne la dessine jamais",
    [`${ESPACE}/reactivation/page.tsx`]:
      "vit HORS de /dashboard : sous la garde de suppression, elle bouclerait",
    [`${ESPACE}/invitation/[token]/page.tsx`]:
      "le destinataire n'est pas encore membre — il n'a pas de cadre à recevoir",
  }

  // `dashboard/cabinet` est la seule des trois qui soit SOUS `/dashboard` :
  // les deux autres ne sont pas dans le périmètre balayé. On vérifie donc
  // celle-là par sa PROPRIÉTÉ — elle ne doit rien rendre — et non par sa
  // présence dans une liste (§E.34).
  const cabinet = sansCommentaires(lire(`${ESPACE}/dashboard/cabinet/page.tsx`))
  ok(/redirect\(\{/.test(cabinet) && !/'use client'/.test(cabinet),
    'dashboard/cabinet redirige au SERVEUR, sans rien rendre',
    'elle redirigeait dans un useEffect, donc APRES un premier rendu : une page nue, un « … » gris centre, et une couleur ecrite en toutes lettres')
  ok(!/<div|<span|return \(/.test(cabinet),
    'et elle ne dessine aucun élément',
    'lui donner la coquille aurait ete la mauvaise reponse : peindre un cadre complet pour le retirer dans la milliseconde')

  for (const [p, raison] of Object.entries(SANS_CADRE)) {
    ok(existsSync(join(ROOT, p)), `${p.replace(`${ESPACE}/`, '')} existe — ${raison}`)
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('D ter. Aucun jeton qui ne résout NULLE PART')
// ══════════════════════════════════════════════════════════════════════════
//
//  ┌─ LE DÉFAUT ─────────────────────────────────────────────────────────┐
//  │ Le cadre admin lisait cinq jetons `--color-*` qui n'étaient définis  │
//  │ NULLE PART. Ils retombaient donc systématiquement sur leur valeur de │
//  │ secours en dur, et le back-office ne suivait AUCUNE palette          │
//  │ d'écosystème — 574 occurrences sur 22 fichiers.                      │
//  │                                                                      │
//  │ ET ÇA NE LÈVE RIEN. Un `var()` dont la propriété n'existe pas prend  │
//  │ sa valeur de secours, en silence : ni erreur, ni style manquant.     │
//  │ C'est la famille de §E.48 — une variable qui ne résout pas ne se     │
//  │ voit pas.                                                            │
//  └──────────────────────────────────────────────────────────────────────┘
//
//  ⚠️ LE CONTRÔLE VÉRIFIE LA DÉFINITION, PAS UN NOM (§E.34). Il ne cherche
//     pas « --color- » : il relève CHAQUE jeton lu, et exige que chacun soit
//     défini quelque part. Un jeton `--truc-machin` inventé demain serait
//     attrapé par la même règle, sans qu'on ait à l'ajouter à une liste.
{
  const DEFINITIONS = [
    lire('app/globals.css'),
    lire('lib/palette.ts'),
  ].join('\n')

  const racines = [
    join(ROOT, 'app'),
    join(ROOT, 'components'),
    join(ROOT, 'lib'),
  ]
  const sources = []
  const balayer = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) balayer(p)
      else if (/\.(tsx|ts|css)$/.test(e)) sources.push(p)
    }
  }
  racines.forEach(balayer)

  // GEL D'ÉTAT MESURÉ (§G.8) : voici les fichiers qui portent encore des
  // jetons non définis, au 21/09/2026. Ils vivent HORS de l'espace admin —
  // un commit par espace — et le lot du parcours complet les videra. Le
  // compte ne peut que DESCENDRE.
  const GEL_NON_RESOLUS = {
    'components/dashboard/AnnonceCard.tsx': 26,
    'components/dashboard/OrganisationDashboard.tsx': 14,
    'app/[locale]/not-found.tsx': 3,
    'components/layout/LegalFooter.tsx': 3,
    'components/dashboard/MissionCard.tsx': 1,
    'components/dashboard/PublicationForm.tsx': 1,
  }

  // ── CE QUI COMPTE COMME « DÉFINI », ET POURQUOI ────────────────────────
  //
  //  ① `app/globals.css` et `lib/palette.ts` — les deux sources de jetons.
  //  ② LE FICHIER LUI-MÊME. Plusieurs composants posent une propriété sur
  //     leur propre racine (`['--avatar-primary']: 'var(--sk-accent)'`) et la
  //     lisent dans leur `<style>`. C'est un usage LOCAL parfaitement valide,
  //     et le compter comme orphelin ferait crier le contrôle à tort — donc
  //     le ferait désactiver dans la semaine (§E.14).
  //  ③ LES POLICES. `--font-jakarta` et ses semblables sont déclarées par
  //     `next/font` dans une feuille générée au build, que ce contrôle ne
  //     peut pas lire. EXEMPTION DÉCLARÉE, avec sa raison (§E.38) — et
  //     bornée au préfixe `--font-`, pas ouverte à tout.
  const estUnePolice = (j) => j.startsWith('--font-')

  const mesure = {}
  for (const p of sources) {
    const rel = relative(ROOT, p).split(sep).join('/')
    if (rel === 'app/globals.css' || rel === 'lib/palette.ts') continue
    const src = sansCommentaires(readFileSync(p, 'utf8').split('\r\n').join('\n'))
    const lus = [...src.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])
    const orphelins = lus.filter(
      (j) =>
        !estUnePolice(j) &&
        !DEFINITIONS.includes(`'${j}'`) &&
        !DEFINITIONS.includes(`${j}:`) &&
        // Posé par le fichier lui-même, sur sa propre racine.
        !src.includes(`'${j}' as string`) &&
        !src.includes(`['${j}']`),
    )
    if (orphelins.length > 0) mesure[rel] = orphelins.length
  }

  const nouveaux = Object.keys(mesure).filter((f) => !(f in GEL_NON_RESOLUS))
  ok(nouveaux.length === 0,
    'aucun FICHIER NOUVEAU ne lit un jeton qui ne résout nulle part',
    `vu dans : ${nouveaux.join(', ')} — un var() sans definition prend son secours EN SILENCE`)

  const remontes = Object.entries(mesure).filter(([f, n]) => f in GEL_NON_RESOLUS && n > GEL_NON_RESOLUS[f])
  ok(remontes.length === 0,
    'et aucun fichier gelé n en a GAGNÉ',
    `${remontes.map(([f, n]) => `${f} : ${GEL_NON_RESOLUS[f]} → ${n}`).join(' · ')}`)

  const totalGel = Object.values(GEL_NON_RESOLUS).reduce((a, b) => a + b, 0)
  const totalMesure = Object.values(mesure).reduce((a, b) => a + b, 0)
  ok(totalMesure <= totalGel,
    `le compte ne remonte pas (${totalMesure} mesurés, ${totalGel} gelés)`)

  const vides = Object.keys(GEL_NON_RESOLUS).filter((f) => !(f in mesure))
  if (vides.length > 0) {
    note(`✔ ${vides.length} fichier(s) ont quitté le gel : ${vides.join(', ')}`)
    note('  → faites descendre GEL_NON_RESOLUS dans ce fichier.')
  }
  note(`espace admin : ${Object.keys(mesure).filter((f) => f.includes('/admin')).length} fichier(s) restant(s) — attendu 0`)
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
