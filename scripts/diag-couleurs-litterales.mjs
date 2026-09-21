#!/usr/bin/env node
// scripts/diag-couleurs-litterales.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ AUCUNE COULEUR LITTÉRALE DANS UN COMPOSANT.                              ║
// ║                                                                          ║
// ║ Une couleur se lit dans un jeton `--sk-*`, jamais dans un littéral. La   ║
// ║ seule source est `lib/palette.ts`, et elle se règle par écosystème.      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ CE QUE CE CONTRÔLE EST, ET CE QU'IL N'EST PAS ─────────────────────────┐
// │ C'est un CLIQUET, et son gel est un INVENTAIRE DE MIGRATION, par        │
// │ fichier. Ce ne sont pas des défauts à juger un par un : ce sont des     │
// │ fichiers à migrer, tous de la même nature, et leur raison est donc      │
// │ COLLECTIVE — c'est ce que §G.8 autorise et ce qu'elle exige d'écrire.   │
// │ Un gel d'EXEMPTIONS demande une raison par entrée ; celui-ci fige un    │
// │ ÉTAT MESURÉ, et le compte ne peut que DESCENDRE.                        │
// │                                                                        │
// │ Deux choses le font rougir, et elles sont différentes :                 │
// │  · une couleur dans un fichier qui N'EST PAS au gel → occurrence NEUVE ; │
// │  · un fichier du gel qui en porte PLUS qu'au gel → la dette remonte.    │
// └────────────────────────────────────────────────────────────────────────┘
//
// Trois codes de sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
// Il tourne sans base, sans réseau, sans identifiants, depuis n'importe quel
// worktree (§E.3).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RACINES = ['app', 'lib', 'components']

// §E.3 : le dépôt est en CRLF, et un motif qui traverse un saut de ligne ne
// mord pas sans cette normalisation.
const lire = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n')

/* ═══════════════════════════════════════════════════════════════════════════
   LES SOURCES AUTORISÉES — nommées, avec leur raison
   ═══════════════════════════════════════════════════════════════════════════ */
const SOURCES = {
  'lib/palette.ts':
    'LA SOURCE UNIQUE. Les huit rôles, les valeurs de référence, les couleurs '
    + "d'état et les marques tierces. C'est le fichier que tout le reste lit.",
  'lib/portraits-demo.ts':
    "COULEURS D'ILLUSTRATION, pas d'interface : carnations, chevelures et "
    + "vêtements des portraits SVG de la démonstration. Elles ne se règlent pas "
    + "par écosystème, ne portent aucun état, et la garde de contraste n'a rien "
    + 'à dire de la couleur de cheveux de quelqu\'un.',
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE GEL — l'inventaire de migration, MESURÉ le 21/09/2026
   ═══════════════════════════════════════════════════════════════════════════
   RAISON COLLECTIVE : ces fichiers portaient déjà leurs couleurs avant le lot
   « palette unique », et ils sont HORS de son périmètre — l'accueil, la
   coquille et les deux tableaux de bord experts. Ils se migreront par lots,
   écran par écran, comme ceux-ci l'ont été. Aucun n'est un défaut toléré :
   ce sont des fichiers en attente, et le compte ne peut que descendre.

   Le nombre est celui mesuré ; il est la LIMITE HAUTE de chaque fichier.
   Un fichier qui descend sous son compte est signalé pour que le gel suive —
   sans faire rougir : on n'empêche pas quelqu'un de faire mieux. */
const GEL = {
  'app/[locale]/admin/organisations/[id]/page.tsx': 122,
  'app/[locale]/admin/experts/[id]/page.tsx': 88,
  'app/[locale]/admin/taxonomie/[id]/page.tsx': 77,
  'app/[locale]/admin/collaboration/page.tsx': 72,
  'app/[locale]/admin/packages/[id]/page.tsx': 72,
  'app/[locale]/admin/taches-planifiees/page.tsx': 72,
  'app/[locale]/admin/utilisateurs/[id]/page.tsx': 69,
  'app/[locale]/admin/packages/page.tsx': 66,
  'app/[locale]/admin/facturation/page.tsx': 63,
  'app/[locale]/admin/ecosystemes/page.tsx': 59,
  'components/dashboard/PublicationForm.tsx': 59,
  'app/[locale]/admin/utilisateurs/page.tsx': 58,
  'app/[locale]/dashboard/entreprise/offre/page.tsx': 57,
  'app/[locale]/dashboard/entreprise/membres/page.tsx': 48,
  'app/[locale]/admin/organisations/page.tsx': 43,
  'app/[locale]/dashboard/entreprise/organisation/page.tsx': 43,
  'app/[locale]/admin/taxonomie/page.tsx': 42,
  'app/[locale]/inscription/[role]/page.tsx': 40,
  'app/[locale]/admin/experts/page.tsx': 36,
  'app/[locale]/admin/taches-planifiees/[job_name]/page.tsx': 36,
  'app/[locale]/admin/matching/page.tsx': 35,
  'app/[locale]/admin/packages/new/page.tsx': 35,
  'app/[locale]/admin/supervision/page.tsx': 35,
  'components/contact/ContactForm.tsx': 30,
  'app/[locale]/admin/seuils/page.tsx': 28,
  'components/dashboard/OrganisationDashboard.tsx': 28,
  'app/[locale]/connexion/page.tsx': 27,
  'app/[locale]/invitation/[token]/page.tsx': 27,
  'app/[locale]/reactivation/page.tsx': 27,
  'components/admin/CronScheduleModal.tsx': 27,
  'app/[locale]/nouveau-mot-de-passe/page.tsx': 24,
  'app/[locale]/admin/durees/page.tsx': 23,
  'app/[locale]/admin/tarifs-ia/page.tsx': 23,
  'components/OrgSetupModal.tsx': 22,
  'app/[locale]/dashboard/entreprise/page.tsx': 21,
  'app/[locale]/inscription/organisation/page.tsx': 21,
  'app/[locale]/mot-de-passe-oublie/page.tsx': 19,
  'app/[locale]/ecosysteme-indisponible/page.tsx': 18,
  'app/[locale]/admin/quotas-ia/page.tsx': 16,
  'components/dashboard/OrgLogoUpload.tsx': 15,
  'components/legal/LegalArticle.tsx': 15,
  'app/[locale]/admin/layout.tsx': 14,
  'app/[locale]/inscription/confirmation/page.tsx': 14,
  'app/[locale]/inscription/organisation/confirmation/page.tsx': 14,
  'app/[locale]/inscription/page.tsx': 14,
  'lib/emails/templates.ts': 14,
  'components/admin/EcosystemeVisuelUpload.tsx': 13,
  'components/dashboard/OrganisationSidebar.tsx': 13,
  'components/PendingInvitationGate.tsx': 13,
  'app/[locale]/auth/callback/page.tsx': 12,
  'app/[locale]/admin/supervision/[sujet]/page.tsx': 9,
  'app/[locale]/contact/page.tsx': 8,
  'app/[locale]/dashboard/entreprise/annonces/[id]/candidatures/page.tsx': 7,
  'lib/emails/layout.ts': 7,
  'components/legal/LegalPageShell.tsx': 6,
  'app/api/contact/route.ts': 5,
  'app/[locale]/not-found.tsx': 5,
  'components/admin/CronComplianceBanner.tsx': 5,
  'app/[locale]/dashboard/entreprise/annonces/page.tsx': 4,
  'app/[locale]/dashboard/entreprise/annonces/[id]/modifier/page.tsx': 3,
  'components/auth/PhoneTakenNotice.tsx': 3,
  'app/api/admin/ecosystemes/route.ts': 2,
  'app/[locale]/dashboard/entreprise/annonces/[id]/page.tsx': 2,
  'components/admin/LogoOrganisation.tsx': 2,
  'app/[locale]/dashboard/cabinet/page.tsx': 1,
  'app/[locale]/dashboard/entreprise/candidatures/page.tsx': 1,
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE MOTIF
   ═══════════════════════════════════════════════════════════════════════════ */

// Une couleur : hexadécimal 3, 6 ou 8 chiffres, ou une fonction rgb/hsl.
const COULEUR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d/g

/**
 * Retire les commentaires AVANT de chercher.
 *
 * ⚠️ §E.7 : un contrôle qui lit un commentaire reste vert quand la règle
 *    disparaît — et, dans l'autre sens, il PUNIT LA DOCUMENTATION DE SA PROPRE
 *    RÈGLE. Ce lot en a fait l'expérience deux fois : l'en-tête de
 *    `DashboardShell` cite `#2553BB` pour raconter le défaut qu'il ferme, et
 *    l'en-tête de `lib/palette.ts` cite les valeurs qu'il remplace. Les deux
 *    sont de la prose. Un anti-motif doit pouvoir être DOCUMENTÉ.
 */
function sansCommentaires(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)))
}

function fichiers(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) fichiers(p, acc)
    else if (/\.(ts|tsx|css)$/.test(e)) acc.push(p)
  }
  return acc
}

function mesurer() {
  const parFichier = new Map()
  for (const racine of RACINES) {
    for (const p of fichiers(join(ROOT, racine))) {
      const rel = relative(ROOT, p).split(sep).join('/')
      if (SOURCES[rel]) continue
      const occurrences = (sansCommentaires(lire(p)).match(COULEUR) ?? []).length
      if (occurrences > 0) parFichier.set(rel, occurrences)
    }
  }
  return parFichier
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXÉCUTION
   ═══════════════════════════════════════════════════════════════════════════ */
try {
  const mesure = mesurer()

  // `--gel` réimprime le gel tel qu'il devrait être. On ne l'applique jamais
  // tout seul : un gel qui se met à jour seul n'est plus un cliquet.
  if (process.argv.includes('--gel')) {
    const lignes = [...mesure].sort((a, b) => b[1] - a[1]).map(([f, n]) => `  '${f}': ${n},`)
    console.log('const GEL = {\n' + lignes.join('\n') + '\n}')
    console.log(`\n// ${mesure.size} fichiers, ${[...mesure.values()].reduce((a, b) => a + b, 0)} couleurs`)
    process.exit(0)
  }

  const neufs = []
  const remontees = []
  const descendus = []

  for (const [f, n] of mesure) {
    const gele = GEL[f]
    if (gele === undefined) neufs.push([f, n])
    else if (n > gele) remontees.push([f, n, gele])
    else if (n < gele) descendus.push([f, n, gele])
  }
  const disparus = Object.keys(GEL).filter((f) => !mesure.has(f))

  const total = [...mesure.values()].reduce((a, b) => a + b, 0)
  const totalGel = Object.values(GEL).reduce((a, b) => a + b, 0)

  console.log('── AUCUNE COULEUR LITTÉRALE DANS UN COMPOSANT ──────────────────')
  console.log(`   sources autorisées : ${Object.keys(SOURCES).length}`)
  for (const [f, raison] of Object.entries(SOURCES)) {
    console.log(`     · ${f}\n       ${raison.slice(0, 110)}…`)
  }
  console.log(`   mesuré : ${mesure.size} fichiers, ${total} couleurs`)
  console.log(`   gelé   : ${Object.keys(GEL).length} fichiers, ${totalGel} couleurs`)

  if (descendus.length) {
    console.log(`\n   ↓ ${descendus.length} fichier(s) ont MOINS de couleurs qu'au gel — le gel peut suivre :`)
    for (const [f, n, g] of descendus) console.log(`     ${f} : ${g} → ${n}`)
  }
  if (disparus.length) {
    console.log(`\n   ✔ ${disparus.length} fichier(s) ont quitté le gel (plus aucune couleur) :`)
    for (const f of disparus) console.log(`     ${f}`)
  }

  let rouge = false

  if (neufs.length) {
    rouge = true
    console.log(`\n❌ ${neufs.length} FICHIER(S) NEUF(S) portent une couleur littérale.`)
    console.log('   Une couleur se lit dans un jeton --sk-*, jamais dans un littéral.')
    console.log('   Les jetons sont posés sur <html> par app/[locale]/layout.tsx.')
    for (const [f, n] of neufs) console.log(`     ${f} : ${n}`)
  }

  if (remontees.length) {
    rouge = true
    console.log(`\n❌ ${remontees.length} FICHIER(S) DU GEL en portent PLUS qu'au gel.`)
    console.log('   La dette ne peut que descendre.')
    for (const [f, n, g] of remontees) console.log(`     ${f} : ${g} → ${n}  (+${n - g})`)
  }

  console.log('\n── CE QUE CE CONTRÔLE NE VÉRIFIE PAS (§E.38) ───────────────────')
  console.log('   · que le jeton choisi soit le BON. `var(--sk-red)` sur un état de')
  console.log('     succès est vert ici et faux à l\'écran : aucun motif ne lit un rôle.')
  console.log('   · la règle du TEXTE TENU — `--sk-faint` vaut 3,63 et ne doit porter')
  console.log('     aucune information. Rien ne distingue un repère qu\'on balaie d\'un')
  console.log('     texte qu\'on lit ; cela se lit écran par écran.')
  console.log('   · les attributs de présentation SVG. `stroke="var(--sk-muted)"` ne')
  console.log('     peint RIEN et ne lève rien — c\'est `diag-svg-couleurs` qui le tient.')

  if (rouge) {
    console.log('\n🔴 ROUGE')
    process.exit(1)
  }
  console.log('\n🟢 VERT')
  process.exit(0)
} catch (err) {
  console.error("Le contrôle n'a pas tourné :", err?.message ?? err)
  process.exit(2)
}
