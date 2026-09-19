#!/usr/bin/env node
/**
 * UNE DESTINATION QUI N'EXISTE PAS NE LÈVE RIEN : ELLE REND UN 404.
 *
 * ┌─ LE CAS SOURCE, ET IL EST SUR LE CHEMIN DE REPRISE DE MOT DE PASSE ─────┐
 * │ `FALLBACK_ROUTE_URL` valait `'/dashboard'`. Or                      │
 * │ `app/[locale]/dashboard/` ne porte PAS de `page.tsx` — seulement un      │
 * │ `layout.tsx` et quatre sous-dossiers. Ce chemin tombe donc sur           │
 * │ `app/[locale]/[...rest]/page.tsx`, qui appelle `notFound()`.             │
 * │                                                                          │
 * │ C'est le repli de `dashboardUrlForUserType()` pour TOUT type inconnu.    │
 * │ Quelqu'un qui venait de réinitialiser son mot de passe avec succès y     │
 * │ atterrissait — 404 propre, mais 404, juste après un succès.              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ POURQUOI AUCUN OUTIL NE POUVAIT LE VOIR ════════════════════════════
 *   · `npx tsc` ne voit rien : une route est une CHAÎNE (famille §E.1) ;
 *   · `next build` non plus, pour la même raison ;
 *   · et un balayage des littéraux AU POINT D'APPEL ne le voit pas non plus :
 *     il n'y a aucun `router.push('/dashboard')` dans le dépôt. Le chemin vit
 *     dans une CONSTANTE, rendue par une FONCTION, appelée ailleurs.
 *     **C'est précisément ce qui l'a gardé invisible.** Ce contrôle balaie donc
 *     tous les LITTÉRAUX de chemin, où qu'ils soient, pas les points d'appel.
 *
 * ═══ CE QU'IL VÉRIFIE ═══════════════════════════════════════════════════
 *   A. toute destination d'écran littérale résout vers un `page.tsx` réel ;
 *   B. tout chemin `/api/...` littéral résout vers un `route.ts` réel ;
 *   C. le repli de routage n'est pas un cul-de-sac.
 *
 * ⚠️ L'ATTRAPE-TOUT NE COMPTE PAS COMME UNE DESTINATION. `[...rest]` matche
 *    toute URL et appelle `notFound()` : le prendre pour une route rendrait ce
 *    contrôle vert sur n'importe quoi — il ne pourrait plus rien trouver.
 *
 * ⚠️ §E.7 — les commentaires sont retirés avant détection : ce fichier et les
 *    correctifs du lot citent `/dashboard` pour expliquer ce qu'ils ferment.
 *
 * SANS BASE, SANS RÉSEAU. 0 = vert · 1 = rouge.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** §E.3 — le dépôt sort en CRLF. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/** §E.7 — on lit le CODE, jamais la prose. Les lignes sont préservées. */
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n')

let echecs = 0
const ok = (cond, libelle, pourquoi) => {
  if (cond) console.log(`  ok   ${libelle}`)
  else {
    echecs++
    console.log(`  KO   ${libelle}`)
    if (pourquoi) console.log(`       → ${pourquoi}`)
  }
}
const section = (t) => console.log(`\n═══ ${t} ═══\n`)

// ═════════════════════════════════════════════════════════════════════════════
// L'ARBRE RÉEL DES ROUTES, RECONSTRUIT DEPUIS LE DISQUE
// ═════════════════════════════════════════════════════════════════════════════
const ecrans = new Set()
const ecransDyn = []
const attrapeTout = []
const routesApi = new Set()
const routesApiDyn = []

const parcourirEcrans = (rel) => {
  for (const e of readdirSync(join(ROOT, rel))) {
    const enfant = `${rel}/${e}`
    if (statSync(join(ROOT, enfant)).isDirectory()) parcourirEcrans(enfant)
    else if (e === 'page.tsx') {
      const chemin = rel.replace('app/[locale]', '') || '/'
      if (chemin.includes('[...')) attrapeTout.push(chemin)
      else if (chemin.includes('[')) ecransDyn.push(chemin)
      else ecrans.add(chemin)
    }
  }
}
parcourirEcrans('app/[locale]')

const parcourirApi = (rel) => {
  for (const e of readdirSync(join(ROOT, rel))) {
    const enfant = `${rel}/${e}`
    if (statSync(join(ROOT, enfant)).isDirectory()) parcourirApi(enfant)
    else if (e === 'route.ts') {
      const chemin = rel.replace('app', '')
      if (chemin.includes('[')) routesApiDyn.push(chemin)
      else routesApi.add(chemin)
    }
  }
}
parcourirApi('app/api')

const versMotif = (c) => new RegExp('^' + c.replace(/\[\.\.\.[^\]]+\]/g, '.+').replace(/\[[^\]]+\]/g, '[^/]+') + '$')
const motifsEcrans = ecransDyn.map(versMotif)
const motifsApi = routesApiDyn.map(versMotif)

// ═════════════════════════════════════════════════════════════════════════════
// LES LITTÉRAUX DE CHEMIN, OÙ QU'ILS SOIENT
// ═════════════════════════════════════════════════════════════════════════════
const sources = []
const balayer = (rel) => {
  if (!existsSync(join(ROOT, rel))) return
  for (const e of readdirSync(join(ROOT, rel))) {
    if (e === 'node_modules' || e === '.next') continue
    const enfant = `${rel}/${e}`
    if (statSync(join(ROOT, enfant)).isDirectory()) balayer(enfant)
    else if (/\.tsx?$/.test(e)) sources.push(enfant)
  }
}
// §E.15 : `components/` porte des règles serveur — il n'est pas décoratif.
for (const d of ['app', 'lib', 'components']) balayer(d)

/**
 * CE QUI N'EST PAS UNE ROUTE, NOMMÉMENT — et chaque entrée porte sa raison.
 * Une liste d'exceptions sans raisons devient un tampon qu'on remplit sans lire
 * (§G.8).
 */
const PAS_DES_ROUTES = [
  { motif: /^\/fr$|^\/en$|^\/es$|^\/de$/, raison: 'préfixes de locale, posés par next-intl' },
  { motif: /^\/_/, raison: 'chemins internes Next' },
  { motif: /^\/(avatars|cv|org-logos|ecosystemes)\//, raison: 'chemins de bucket Storage, pas des URL' },
  {
    motif: /^\/(jour|an|day|year)$/,
    raison:
      "suffixes d'UNITÉ de tarif (« 650 €/jour », « 55 k€/an »), dans la carte et le " +
      "détail de mission. Ce ne sont pas des chemins — et c'est la limite assumée d'un " +
      "balayage de littéraux : il voit une barre oblique, pas un sens.",
  },
]
const exempte = (c) => PAS_DES_ROUTES.some((x) => x.motif.test(c))

// ⚠️ LA BARRE FINALE SE RETIRE, SAUF POUR LA RACINE. Sans cette exception,
//    « / » devenait la chaîne vide et l'accueil — qui existe — passait pour
//    introuvable : le contrôle rougissait sur sa propre normalisation.
const LITTERAL = /['"`](\/[a-z0-9][a-z0-9\-/]*)['"`]/g
const ciblesEcran = new Map()
const ciblesApi = new Map()

for (const f of sources) {
  const code = sansCommentaires(read(f))
  for (const m of code.matchAll(LITTERAL)) {
    const c = m[1].replace(/(.)\/$/, '$1')
    if (!c || exempte(c)) continue
    const ligne = code.slice(0, m.index).split('\n').length
    const cible = c.startsWith('/api') ? ciblesApi : ciblesEcran
    if (!cible.has(c)) cible.set(c, [])
    cible.get(c).push(`${f}:${ligne}`)
  }
}

// ═════════════════════════════════════════════════════════════════════════════
section('A. Toute destination d’ÉCRAN mène quelque part')
// ═════════════════════════════════════════════════════════════════════════════
//
//   ⚠️ L'ATTRAPE-TOUT EST EXCLU DE LA RÉSOLUTION. `[...rest]` matche tout et
//      appelle `notFound()` : le compter comme une route rendrait ce contrôle
//      incapable de trouver quoi que ce soit — il serait vert sur une faute de
//      frappe. Un 404 propre reste un 404.
{
  console.log(`  (${ecrans.size} écrans statiques · ${ecransDyn.length} dynamiques · ${attrapeTout.length} attrape-tout EXCLU(S))`)
  // ⚠️ MUTATION M7 : SANS CETTE LIGNE, LE CONTRÔLE POUVAIT DEVENIR AVEUGLE
  //    SANS BRONCHER. Si l'attrape-tout cessait d'être reconnu comme tel, il
  //    rejoignait les routes dynamiques, matchait TOUTE URL, et plus aucune
  //    destination morte ne pouvait être trouvée — vert sur n'importe quelle
  //    faute de frappe. Un contrôle doit vérifier la condition qui lui permet
  //    de VOIR, pas seulement ce qu'il regarde.
  ok(
    attrapeTout.length >= 1,
    'l’attrape-tout est reconnu, donc EXCLU de la résolution',
    'sans exclusion il matche tout, et ce contrôle ne peut plus rien trouver',
  )
  ok(
    !ecransDyn.some((c) => c.includes('[...')),
    'aucun attrape-tout n’a glissé parmi les routes dynamiques',
  )
  const mortes = []
  for (const [c, ou] of [...ciblesEcran].sort()) {
    if (ecrans.has(c)) continue
    if (motifsEcrans.some((r) => r.test(c))) continue
    mortes.push(`${c} (${ou.join(' · ')})`)
  }
  ok(
    mortes.length === 0,
    'aucune destination d’écran ne tombe sur l’attrape-tout',
    mortes.join('\n       → '),
  )
}

// ═════════════════════════════════════════════════════════════════════════════
section('B. Tout chemin /api littéral mène à une route réelle')
// ═════════════════════════════════════════════════════════════════════════════
//
//   Même classe, même invisibilité : un chemin d'API est une CHAÎNE (§E.1).
//   Une faute de frappe rend 404 en JSON, que l'appelant traduit en « erreur
//   inconnue » — un refus dont le motif ment, exactement §E.22.
{
  console.log(`  (${routesApi.size} routes statiques · ${routesApiDyn.length} dynamiques)`)
  const mortes = []
  for (const [c, ou] of [...ciblesApi].sort()) {
    if (routesApi.has(c)) continue
    if (motifsApi.some((r) => r.test(c))) continue
    mortes.push(`${c} (${ou.join(' · ')})`)
  }
  ok(mortes.length === 0, 'aucun chemin /api ne pointe dans le vide', mortes.join('\n       → '))
}

// ═════════════════════════════════════════════════════════════════════════════
section('C. Le repli de routage n’est pas un cul-de-sac')
// ═════════════════════════════════════════════════════════════════════════════
//
//   C'est le cas source, et il mérite son assertion propre : le balayage des
//   sections A et B le trouverait, mais un contrôle qui ne nomme pas ce qu'il
//   a été écrit pour fermer se laisse désactiver sans qu'on mesure la perte.
{
  const routage = sansCommentaires(read('lib/auth-routing.ts'))
  // ⚠️ MUTATION M4 : CETTE ASSERTION DISAIT « UNE SEULE FOIS » ET NE COMPTAIT
  //    RIEN. `.exec()` rend la PREMIÈRE correspondance : une seconde
  //    déclaration passait inaperçue, et deux replis qui divergent sont
  //    exactement la dette que la phrase prétend interdire (§E.20 : le dépôt
  //    portait quatre copies du même chargement). On compte.
  // ⚠️ ET ON COMPTE SUR TOUT LE DÉPÔT, PAS DANS CE SEUL FICHIER.
  //    La mutation qui a ouvert ce trou déclarait un second repli AILLEURS :
  //    c'est le scénario §E.20 — deux copies qui divergent, et la recherche
  //    s'arrête sur la première. Un repli unique n'est unique que si rien
  //    d'autre n'en déclare un.
  const declarations = []
  for (const f of sources) {
    for (const m of sansCommentaires(read(f)).matchAll(/export const FALLBACK_ROUTE_URL\b/g)) {
      declarations.push(`${f}:${m.index}`)
    }
  }
  ok(
    declarations.length === 1,
    'le repli de routage est déclaré une seule fois, dans tout le dépôt',
    `déclarations trouvées (${declarations.length}) : ${declarations.join(' · ')}`,
  )
  const repli = /FALLBACK_ROUTE_URL\s*=\s*'([^']+)'/.exec(routage)?.[1] ?? null
  ok(
    repli !== null && (ecrans.has(repli.replace(/(.)\/$/, '$1')) || motifsEcrans.some((r) => r.test(repli))),
    `le repli « ${repli} » mène à un écran qui existe`,
    'un type inconnu, ou une lecture en panne, y envoie quelqu’un qui vient de réussir quelque chose',
  )
  // ET IL DOIT RESTER ATTEIGNABLE SANS DROITS PARTICULIERS : un repli qui exige
  // une population précise rejouerait le cul-de-sac sous une autre forme.
  ok(
    repli !== null && !repli.startsWith('/dashboard/') && !repli.startsWith('/admin'),
    'le repli ne vise pas un tableau de bord réservé à une population',
    'la garde de rôle du layout le renverrait ailleurs — on aurait déplacé le cul-de-sac',
  )
}

// ═════════════════════════════════════════════════════════════════════════════
section('D. Ce que ce contrôle NE vérifie PAS')
// ═════════════════════════════════════════════════════════════════════════════
console.log(`  note il ne lit que des LITTÉRAUX. Un chemin CONSTRUIT (\`/dashboard/\${x}\`)
  note lui échappe — et c'est la limite qui compte, parce que le cas source
  note vivait déjà derrière une constante : il a fallu balayer tous les
  note littéraux, pas les points d'appel, pour qu'il devienne visible.
  note
  note il ne dit rien des DROITS : une route qui existe peut refuser. Résoudre
  note n'est pas atteindre.`)

console.log('')
if (echecs > 0) {
  console.log(`✘ ${echecs} CONTRÔLE(S) EN ÉCHEC`)
  process.exit(1)
}
console.log('✅ Aucune destination ne tombe dans le vide.')
