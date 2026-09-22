// scripts/diag-parite-expert.mjs — L'ESPACE CDI PREND EXACTEMENT L'ERGONOMIE
//                                  DE L'ESPACE FREELANCE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE CONTROLE EXISTE
//
//   Le proprietaire du produit a ouvert `/dashboard/cdi/mon-profil` et l'a
//   qualifie d'INACCEPTABLE : la page n'avait ni barre laterale, ni
//   navigation, ni bouton Retour, la ou sa jumelle freelance en avait. Sa
//   consigne : « parite INTEGRALE, pas un rapprochement ».
//
//   La parite ne se verifie pas en relisant deux fichiers de mille lignes.
//   Elle se verifie sur des PROPRIETES, et c'est ce que fait ce controle.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'IL VERIFIE
//   (A) MEME INVENTAIRE D'ECRANS — page pour page, aucune d'un cote seulement.
//   (B) MEME CADRE sur chaque page jumelle.
//   (C) MEMES PRIMITIVES PARTAGEES — les deux montent les memes composants
//       la ou le produit dit qu'ils sont partages.
//   (D) MEME TRAITEMENT DU TEXTE TENU — ce qui a ete corrige d'un cote l'est
//       de l'autre (§E.20 : un correctif non retroporte se LIT comme applique).
//   (E) MEMES CLES i18n structurantes, aux espaces de noms pres.
//
// CE QU'IL NE VERIFIE PAS, ET IL LE DIT
//   Il ne dit PAS que les deux ecrans se RESSEMBLENT a l'oeil : deux pages
//   peuvent monter les memes composants et disposer leurs blocs autrement.
//   Cela demande un navigateur, et c'est une lecture humaine. Ce qui est garde
//   ici, c'est qu'aucune des deux voies ne PERDE ce que l'autre a.
//
//   node scripts/diag-parite-expert.mjs
//   Aucune base, aucun reseau, aucune ecriture. Lecture seule.
//   0 = vert · 1 = rouge · 2 = n'a pas tourne.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const lire = (p) => {
  const abs = join(ROOT, p)
  if (!existsSync(abs)) return ''
  return readFileSync(abs, 'utf8').split('\r\n').join('\n')
}

/** §E.7 — un commentaire n'a jamais monte un composant. */
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

let echecs = 0
const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

const BASE = 'app/[locale]/dashboard'
const VOIES = ['freelance', 'cdi']

/** Les pages d'une voie, en chemins RELATIFS a sa racine. */
function ecrans(voie) {
  const racine = join(ROOT, BASE, voie)
  const out = []
  const parcourir = (d, prefixe) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) parcourir(p, `${prefixe}${e}/`)
      else if (e === 'page.tsx') out.push(`${prefixe}page.tsx`)
    }
  }
  parcourir(racine, '')
  return out.sort()
}

// ══════════════════════════════════════════════════════════════════════════
section('A. Le MEME inventaire d écrans, page pour page')
// ══════════════════════════════════════════════════════════════════════════

const parVoie = Object.fromEntries(VOIES.map((v) => [v, ecrans(v)]))

ok(parVoie.freelance.length > 0 && parVoie.cdi.length > 0,
  `les deux voies ont des écrans (${parVoie.freelance.length} / ${parVoie.cdi.length})`)

{
  const seulFreelance = parVoie.freelance.filter((p) => !parVoie.cdi.includes(p))
  const seulCdi = parVoie.cdi.filter((p) => !parVoie.freelance.includes(p))
  ok(seulFreelance.length === 0,
    'aucun écran n existe côté freelance SEULEMENT',
    `${seulFreelance.join(', ')} — un ecran manquant d un cote est une voie amputee`)
  ok(seulCdi.length === 0,
    'aucun écran n existe côté CDI SEULEMENT',
    `${seulCdi.join(', ')}`)
  ok(parVoie.freelance.length === parVoie.cdi.length,
    `même compte des deux côtés : ${parVoie.freelance.length} écrans`)
}

const JUMELLES = parVoie.freelance.filter((p) => parVoie.cdi.includes(p))

// ══════════════════════════════════════════════════════════════════════════
section('B. Le MÊME cadre sur chaque page jumelle')
// ══════════════════════════════════════════════════════════════════════════

for (const voie of VOIES) {
  const src = sansCommentaires(lire(`${BASE}/${voie}/layout.tsx`))
  ok(/<DashboardShell side=/.test(src), `${voie} : le sub-layout monte la coquille partagée`)
  ok(!/return <>\{children\}<\/>/.test(src),
    `${voie} : aucune page n en est exclue`,
    'c est l exclusion de /mon-profil qui a produit une page sans navigation')
}

{
  // ⚠️ ON LIT CE QUE LA PAGE FAIT, PAS CE QU'ELLE DÉCLARE. Une page qui monte
  //    elle-même la barre latérale, ou qui peint un second plein écran, sort
  //    du cadre commun même si le layout la couvre.
  const coupables = []
  for (const voie of VOIES) {
    for (const p of JUMELLES) {
      const src = sansCommentaires(lire(`${BASE}/${voie}/${p}`))
      if (/<DashboardSidebar\b/.test(src)) coupables.push(`${voie}/${p} : monte la barre latérale`)
      if (/minHeight: '100vh'/.test(src)) coupables.push(`${voie}/${p} : second plein écran`)
      if (/height: 5[89],/.test(src)) coupables.push(`${voie}/${p} : en-tête maison`)
    }
  }
  ok(coupables.length === 0,
    `les ${JUMELLES.length * 2} pages jumelles portent le cadre partagé, sans exception`,
    coupables.join(' · '))
}

// ══════════════════════════════════════════════════════════════════════════
section('C. Les MÊMES primitives partagées, jumelle par jumelle')
// ══════════════════════════════════════════════════════════════════════════

/**
 * Les composants dont le produit dit qu'ils servent LES DEUX voies. Si l'un
 * apparaît d'un côté d'une jumelle et pas de l'autre, une des deux voies a
 * perdu quelque chose — c'est la forme exacte de §E.20.
 */
const PARTAGES = [
  'DndEmptyState',
  'EtatDeRecherche',
  'VerificationStatusPill',
  'SectionHeader',
  'CastingRow',
  'MissionCastingCard',
  'CandidatureCastingCard',
  'ExpertOnboardingGuide',
  'CollaborationDashboardBlock',
  'ProfilMasqueBanner',
]

{
  const ecarts = []
  for (const p of JUMELLES) {
    const f = sansCommentaires(lire(`${BASE}/freelance/${p}`))
    const c = sansCommentaires(lire(`${BASE}/cdi/${p}`))
    for (const comp of PARTAGES) {
      const dansF = new RegExp(`<${comp}\\b`).test(f)
      const dansC = new RegExp(`<${comp}\\b`).test(c)
      if (dansF !== dansC) {
        ecarts.push(`${p} : ${comp} ${dansF ? 'côté freelance seulement' : 'côté CDI seulement'}`)
      }
    }
  }
  ok(ecarts.length === 0,
    `les ${PARTAGES.length} primitives partagées sont montées des DEUX côtés, ou d aucun`,
    ecarts.join(' · '))
}

// ══════════════════════════════════════════════════════════════════════════
section('D. Le MÊME traitement du texte tenu')
// ══════════════════════════════════════════════════════════════════════════
//
//  §D.12 : `--sk-faint` vaut 3,63 et ne porte JAMAIS d'information. Un usage
//  PORTEUR est un usage qui n'est ni une étiquette en majuscules ni un signe
//  `aria-hidden`. Corriger une voie et pas l'autre laisserait la seconde se
//  lire comme corrigée (§E.20).
{
  const porteurs = (src) =>
    sansCommentaires(src)
      .split('\n')
      .filter((l) => l.includes('--sk-faint'))
      .filter((l) => !/textTransform: 'uppercase'/.test(l) && !/aria-hidden/.test(l)).length

  const restes = []
  for (const voie of VOIES) {
    for (const p of JUMELLES) {
      const n = porteurs(lire(`${BASE}/${voie}/${p}`))
      if (n > 0) restes.push(`${voie}/${p} : ${n}`)
    }
  }
  ok(restes.length === 0,
    'aucune page jumelle ne fait porter une information au texte tenu',
    restes.join(' · '))
}

// ══════════════════════════════════════════════════════════════════════════
section('E. Les MÊMES clés i18n structurantes')
// ══════════════════════════════════════════════════════════════════════════
//
//  Les deux voies ont des espaces de noms distincts (`dashboard_freelance` /
//  `dashboard_cdi`), et c'est délibéré — les mots diffèrent (« missions » /
//  « offres »). Ce qui ne doit PAS différer, c'est l'existence des clés qui
//  gouvernent un COMPORTEMENT.
{
  const fr = JSON.parse(readFileSync(join(ROOT, 'messages', 'fr.json'), 'utf8'))
  const cle = (chemin) => chemin.split('.').reduce((o, k) => (o == null ? undefined : o[k]), fr)

  const PAIRES = [
    ['dashboard_freelance.completion.title_complete', 'dashboard_cdi.profile_completion.title_complete'],
    ['dashboard_freelance.completion.cta_complete', 'dashboard_cdi.profile_completion.cta_complete'],
    ['dashboard_freelance.completion.hint_complete', 'dashboard_cdi.profile_completion.hint_complete'],
  ]
  for (const [a, b] of PAIRES) {
    const va = cle(a)
    const vb = cle(b)
    ok(typeof va === 'string' && typeof vb === 'string',
      `${a.split('.').pop()} existe des deux côtés`,
      `freelance=${typeof va} · cdi=${typeof vb}`)
  }

  // La recherche de missions, elle, lit UN SEUL espace de noms : c'est la
  // parité par construction, et non par vérification répétée.
  const vue = sansCommentaires(lire('components/dashboard/EtatDeRecherche.tsx'))
  ok(/useTranslations\('recherche_de_missions'\)/.test(vue),
    'et la recherche de missions lit UN SEUL espace de noms pour les deux voies',
    'deux espaces separes laisseraient une phrase corrigee d un cote et fausse de l autre')
}

// ══════════════════════════════════════════════════════════════════════════
section('Ce que ce contrôle ne vérifie pas')
// ══════════════════════════════════════════════════════════════════════════

note('il ne dit PAS que les deux ecrans se RESSEMBLENT a l oeil : deux pages')
note('peuvent monter les memes composants et disposer leurs blocs autrement.')
note('Cela demande un navigateur, et c est une lecture humaine.')
note('ce qui est garde ici, c est qu aucune des deux voies ne PERDE ce que')
note("l autre a — la forme exacte que prend une derive de parite (§E.20).")

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} CONTRÔLE(S) EN ÉCHEC\n`)
  process.exit(1)
}
console.log(`✅ Parité intégrale : ${JUMELLES.length} écrans jumeaux, même cadre, mêmes primitives.\n`)
process.exit(0)
