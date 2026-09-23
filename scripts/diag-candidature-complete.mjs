// scripts/diag-candidature-complete.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ UNE CANDIDATURE EXISTE AVEC SA NOTE ET SON RÉSUMÉ, OU ELLE N'EXISTE PAS. ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LA DÉCISION, ARBITRÉE PAR YOUSSEF LE 23/09/2026 ────────────────────────┐
// │ « Une candidature avec sa note et son résumé, ou pas de candidature.     │
// │   Une candidature nue chez un client, c'est amateur. On ne la livre      │
// │   pas. » Elle REMPLACE la règle précédente — « rien ne bloque une        │
// │   candidature ».                                                          │
// └──────────────────────────────────────────────────────────────────────────┘
//
// ═══ CE QUE CE CONTRÔLE DÉFEND, ET CE QU'IL REFUSE ═══════════════════════
//
//   ① L'OBJET INCOMPLET **N'EXISTE PAS** — il n'est pas caché.
//      Mesuré le 23/09/2026 : **17 fichiers** lisent `candidatures`. Un filtre
//      d'affichage demanderait le même test dans chacun, plus dans chaque
//      compteur, et il suffirait d'en oublier un. Ce contrôle refuse donc
//      DEUX choses : qu'une candidature nue puisse être écrite, ET qu'on
//      ait tenté de la cacher.
//   ② LE JUGEMENT PRÉCÈDE L'ÉCRITURE — prouvé par la STRUCTURE (le retour
//      anticipé sur échec est avant l'insertion), pas par un commentaire.
//   ③ LA BASE REFUSE — contrainte, pas discipline (§E.31).
//   ④ LA RELANCE REJOUE LE MÊME CHEMIN — la même fonction, pas une copie
//      (§E.20 : un jumeau de rattrapage ne sert que le jour où le chemin
//      normal a déjà échoué, donc son écart ne se découvre jamais avant).
//   ⑤ LE REJEU N'EST JAMAIS AUTOMATIQUE — refusé par Youssef : « ça tournerait
//      en boucle et ça coûterait ».
//   ⑥ LA PERTE SE VOIT — l'expert n'est pas prévenu, donc la plateforme, elle,
//      doit l'être : signal BLOQUANT et EXTINGUIBLE (§E.52).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE PÉRIMÈTRE, ÉCRIT — ET CHAQUE EXCLUSION JUSTIFIÉE
//
//   BALAYE   app/api/               le dépôt, la relance, la supervision
//            app/[locale]/          l'écran d'erreurs
//            lib/                   le chemin partagé, le vocabulaire, la
//                                   supervision, la navigation
//            components/            ⚠️ DANS le périmètre : c'est le CLIENT du
//                                   dépôt (MissionDetailView) qui décide de ce
//                                   que l'expert lit. L'exclure « parce que
//                                   c'est de l'affichage » manquerait la
//                                   moitié de la décision ②.
//            supabase/migrations/   la contrainte, le journal, la fonction
//            messages/*.json        les quatre langues
//
//   EXCLU    node_modules/ .next/   pas du dépôt / généré
//            supabase/_archive/     retirées du tronc, jamais rejouées
//            docs/                  de la prose ; rien n'y est exécuté
//            scripts/               ⚠️ EXCLU AVEC SA RAISON, pas par oubli :
//                                   l'écriture en base depuis un script est
//                                   déjà gardée par `garde-ecriture.mjs` et
//                                   `diag-scripts-destructeurs.mjs` (§E.4).
//                                   L'y ajouter ferait DEUX gardes sur la même
//                                   panne (§E.36) — et la seconde rougirait
//                                   sur les gardes elles-mêmes.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-candidature-complete.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE écriture.
// 0 = vert · 1 = rouge · 2 = n'a pas tourné.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
// ⚠️ IMPORT STATIQUE, ET C EST LE PIEGE QUE CE LOT VIENT DE PAYER DEUX FOIS :
//    un `await import()` en milieu de fichier fait planter Node a la SORTIE,
//    sous Windows, quand stdout est redirige — vert a la main, MUET dans la
//    serie (§E.57). Le second a ete pose vingt minutes apres avoir ecrit la
//    regle.
import * as REGLE_ELIGIBILITE from '../lib/matching/eligibilite.ts'

const MOI = fileURLToPath(import.meta.url)
const ROOT = join(dirname(MOI), '..')
const LOCALES = ['fr', 'en', 'es', 'de']

let echecs = 0
const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)
/** §E.3 — CRLF normalisé, sinon tout motif qui traverse un saut de ligne rate. */
const lire = (rel) => readFileSync(join(ROOT, rel), 'utf8').split('\r\n').join('\n')

/** §E.7 — commentaires retirés SANS perdre de lignes ni de positions. */
function depouillerJs(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i)
      if (j === -1) j = src.length
      out += ' '.repeat(j - i)
      i = j
      continue
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2)
      j = j === -1 ? src.length : j + 2
      out += src.slice(i, j).replace(/[^\n]/g, ' ')
      i = j
      continue
    }
    out += c
    i++
  }
  return out
}

/** §E.7 — commentaires SQL retirés, positions préservées. */
function depouillerSql(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    if (src[i] === '-' && src[i + 1] === '-') {
      let j = src.indexOf('\n', i)
      if (j === -1) j = src.length
      out += ' '.repeat(j - i)
      i = j
      continue
    }
    out += src[i]
    i++
  }
  return out
}

/**
 * LA PROFONDEUR D'ACCOLADES à une position donnée d'un corps de fonction.
 *
 * ⚠️ NÉE D'UNE MUTATION QUI EST PASSÉE AU VERT. Le contrôle vérifiait que
 *    `ouvrirJournal(` apparaît AVANT `jugerCandidature(` — une comparaison de
 *    POSITIONS DE TEXTE. La mutation a enfermé l'appel dans une fonction
 *    fléchée déclarée au même endroit et appelée plus loin : le texte est resté
 *    avant, l'exécution est passée après, et le contrôle n'a rien vu.
 *    Ce qu'on défend n'est pas « le mot est écrit plus haut », c'est « l'appel
 *    a lieu d'abord ». Un appel au PREMIER niveau du corps s'exécute dans
 *    l'ordre où il est écrit ; enfermé dans une closure, non. La profondeur
 *    fait donc la différence, et elle se mesure.
 */
function profondeurA(corps, index) {
  let p = 0
  for (let i = 0; i < index && i < corps.length; i++) {
    if (corps[i] === '{') p++
    else if (corps[i] === '}') p--
  }
  return p
}

/**
 * La position d'un appel AU PREMIER NIVEAU du corps (profondeur 1), ou -1.
 * Rend aussi le nombre total d'occurrences, pour qu'un appel dupliqué se voie.
 */
function appelDePremierNiveau(corps, motif) {
  const toutes = [...corps.matchAll(new RegExp(motif.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c), 'g'))]
  const premier = toutes.filter((m) => profondeurA(corps, m.index) === 1)
  return { index: premier.length > 0 ? premier[0].index : -1, total: toutes.length }
}

/**
 * Le CORPS d'une fonction, depuis une ancre — par comptage d'accolades.
 *
 * ⚠️ PAS UNE FENÊTRE DE N CARACTÈRES. Une fenêtre déborde sur la fonction
 *    suivante, et une fonction qu'on vide se lit alors comme saine parce que
 *    sa voisine, elle, est correcte (§E.40, §E.8). Mesuré au lot précédent :
 *    c'est exactement ce qui a laissé une mutation passer en vert.
 */
function corpsDe(src, ancre) {
  const d = src.indexOf(ancre)
  if (d < 0) return ''
  // ⚠️ LE PREMIER `{` APRÈS L'ANCRE N'EST PAS LE CORPS. Mesuré sur ce dépôt :
  //    `deposerCandidature(args: { … })` ouvre une accolade DANS sa liste de
  //    paramètres. Le comptage partait de là et rendait le TYPE au lieu du
  //    corps — quatre assertions tombaient alors à côté du fichier, et deux
  //    passaient au VERT sur du vide. On saute donc d'abord la liste de
  //    paramètres, parenthèses comptées.
  const par = src.indexOf('(', d)
  if (par < 0) return ''
  let pp = 0
  let finPar = -1
  for (let i = par; i < src.length; i++) {
    if (src[i] === '(') pp++
    else if (src[i] === ')') {
      pp--
      if (pp === 0) { finPar = i; break }
    }
  }
  if (finPar < 0) return ''
  const ouvre = src.indexOf('{', finPar)
  if (ouvre < 0) return ''
  let prof = 0
  for (let i = ouvre; i < src.length; i++) {
    if (src[i] === '{') prof++
    else if (src[i] === '}') {
      prof--
      if (prof === 0) return src.slice(ouvre, i + 1)
    }
  }
  return src.slice(ouvre)
}

/** Tous les fichiers source sous une liste de dossiers. */
function fichiersSous(dossiers, exts = ['.ts', '.tsx']) {
  const out = []
  const marcher = (abs) => {
    for (const e of readdirSync(abs)) {
      const p = join(abs, e)
      if (statSync(p).isDirectory()) {
        if (e === 'node_modules' || e === '.next') continue
        marcher(p)
      } else if (exts.some((x) => e.endsWith(x))) {
        out.push(relative(ROOT, p).replace(/\\/g, '/'))
      }
    }
  }
  for (const d of dossiers) {
    const abs = join(ROOT, d)
    if (existsSync(abs)) marcher(abs)
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   0. LES DÉTECTEURS S'ÉPROUVENT AVANT DE BALAYER (§E.33)
   ═══════════════════════════════════════════════════════════════════════════

   Le témoin du DÉFAUT est la forme qui a disparu : une insertion de
   candidature portant `ai_match_score: null`, suivie d'un jugement dans un
   `after()`. Celui du CORRECTIF est la forme livrée. Un détecteur qui ne
   retrouve pas le cas connu ne prouve rien. */
section('0. Les détecteurs retrouvent le défaut, et se taisent sur le correctif')

/** Un fichier ÉCRIT-il dans `candidatures` ? */
const ecritCandidatures = (src) => {
  const nu = depouillerJs(src)
  // La chaîne peut être coupée sur plusieurs lignes : on cherche `.insert(` ou
  // `.upsert(` APRÈS `from('candidatures')`, dans la même expression — bornée
  // au prochain `;` ou à la prochaine ligne vide.
  for (const m of nu.matchAll(/from\(\s*['"]candidatures['"]\s*\)/g)) {
    const suite = nu.slice(m.index, m.index + 400)
    if (/\.\s*(insert|upsert)\s*\(/.test(suite)) return true
  }
  return false
}

const TEMOIN_ECRITURE = `
  const { data } = await admin
    .from('candidatures')
    .insert({ publication_id: p, ai_match_score: null })
    .select('id')
`
const TEMOIN_LECTURE = `
  const { data } = await admin
    .from('candidatures')
    .select('id, ai_match_score')
    .eq('publication_id', p)
`
const TEMOIN_ECRITURE_COMMENTEE = `
  // On pourrait faire .from('candidatures').insert({ … }) ici un jour.
  const { data } = await admin.from('candidatures').select('id')
`
ok(ecritCandidatures(TEMOIN_ECRITURE), 'il VOIT une écriture de candidature')
ok(!ecritCandidatures(TEMOIN_LECTURE), '… et il se TAIT sur une simple lecture')
ok(
  !ecritCandidatures(TEMOIN_ECRITURE_COMMENTEE),
  '… et un COMMENTAIRE qui décrit une écriture ne compte pas (§E.7)',
  'un commentaire n’a jamais écrit une ligne',
)

/** Un fichier CACHE-t-il les candidatures incomplètes ? */
const cacheLesNues = (src) => {
  const nu = depouillerJs(src)
  return /\.\s*(?:is|not)\s*\(\s*['"]ai_(?:assessment|match_score)['"]/.test(nu)
}
const TEMOIN_FILTRE = `  q = q.not('ai_assessment', 'is', null)`
const TEMOIN_TRI = `  q = q.order('ai_match_score', { ascending: false })`
ok(cacheLesNues(TEMOIN_FILTRE), 'il VOIT un filtre qui cacherait les nues')
ok(!cacheLesNues(TEMOIN_TRI), '… et il se TAIT sur un simple tri')

/* Le témoin de `corpsDe` — et c'est le défaut que CE contrôle a commis à sa
   première exécution : une signature dont un paramètre est un type objet ouvre
   une accolade AVANT le corps. Sans ce témoin, quatre assertions lisaient le
   type et deux passaient au vert sur du vide (§E.33). */
const TEMOIN_SIGNATURE = `
export async function f(args: { a: string; b: number }): Promise<void> {
  LE_CORPS
}
export async function g() { AUTRE_CORPS }
`
const corpsTemoin = corpsDe(TEMOIN_SIGNATURE, 'export async function f')
ok(corpsTemoin.includes('LE_CORPS'), 'il trouve le CORPS d’une fonction, pas son type de paramètre')
ok(!corpsTemoin.includes('AUTRE_CORPS'), '… et il s’arrête avant la fonction suivante (§E.40)')

/* ═══════════════════════════════════════════════════════════════════════════
   1. UN SEUL ÉCRIVAIN, ET C'EST LE CHEMIN PARTAGÉ
   ═══════════════════════════════════════════════════════════════════════════

   ⚠️ ON DÉCOUVRE LES ÉCRIVAINS, ON NE LES LISTE PAS (§E.34, §E.61). Un
      fichier qui écrirait des candidatures demain est couvert sans qu'on
      l'inscrive nulle part. */
section('1. Une seule écriture de candidature dans tout le produit')

const SOURCES = fichiersSous(['app', 'lib', 'components'])
ok(
  SOURCES.length > 200,
  `${SOURCES.length} fichiers source balayés`,
  'moins de deux cents : le balayage ne voit plus le dépôt, et un zéro ne prouverait rien',
)

const ecrivains = SOURCES.filter((f) => ecritCandidatures(lire(f)))
ok(
  ecrivains.length === 1 && ecrivains[0] === 'lib/candidatures/depot.ts',
  `un seul écrivain de candidatures : ${ecrivains.join(', ') || '(aucun)'}`,
  'toute autre écriture contournerait le jugement — et la contrainte la refuserait, en 500',
)

/* ═══════════════════════════════════════════════════════════════════════════
   2. L'OBJET INCOMPLET N'EXISTE PAS — il n'est pas CACHÉ
   ═══════════════════════════════════════════════════════════════════════════ */
section('2. Aucun filtre d’affichage n’a été posé — la garantie est ailleurs')

const lecteurs = SOURCES.filter((f) => /from\(\s*['"]candidatures['"]\s*\)/.test(depouillerJs(lire(f))))
ok(
  lecteurs.length >= 10,
  `${lecteurs.length} fichiers lisent \`candidatures\``,
  'ce nombre EST l’argument : un filtre d’affichage demanderait le même test dans chacun',
)
const filtreurs = lecteurs.filter((f) => cacheLesNues(lire(f)))
ok(
  filtreurs.length === 0,
  `aucun lecteur ne masque les candidatures nues : ${filtreurs.join(', ') || '—'}`,
  'cacher l’objet incomplet est la solution REFUSÉE : il suffit d’oublier un lecteur',
)

/* ═══════════════════════════════════════════════════════════════════════════
   3. LE JUGEMENT PRÉCÈDE L'ÉCRITURE — prouvé par la structure
   ═══════════════════════════════════════════════════════════════════════════ */
section('3. Le jugement précède l’écriture, et l’échec retourne AVANT elle')

const DEPOT = 'lib/candidatures/depot.ts'
const depotNu = depouillerJs(lire(DEPOT))
const corpsDepot = corpsDe(depotNu, 'export async function deposerCandidature')
ok(corpsDepot.length > 1000, 'le corps de `deposerCandidature` est trouvé', 'ancre perdue : tout ce qui suit ne prouverait rien')

const iJuger = corpsDepot.indexOf('jugerCandidature(')
const iInsert = corpsDepot.search(/from\(\s*['"]candidatures['"]\s*\)\s*\n?\s*\.insert\(/)
ok(iJuger >= 0, 'le dépôt appelle bien le jugement')
ok(iInsert >= 0, 'le dépôt insère bien une candidature')
ok(
  iJuger >= 0 && iInsert >= 0 && iJuger < iInsert,
  'le jugement est appelé AVANT l’insertion',
  'inversé, la candidature existerait nue le temps d’un appel au modèle — le défaut exact qu’on ferme',
)

// ⚠️ ON ISOLE **L'OBJET INSÉRÉ**, PAS LE FICHIER. `ai_match_score` et
//    `ai_assessment` figurent AUSSI dans le détail d'audit, quelques lignes
//    plus bas : chercher dans tout le corps laissait passer une insertion à
//    laquelle on avait retiré sa note (§E.8 — on ancre sur le bloc qu'on
//    défend). Mesuré : la mutation passait au vert.
const objetInsere = (() => {
  if (iInsert < 0) return ''
  const o = corpsDepot.indexOf('{', corpsDepot.indexOf('.insert(', iInsert))
  if (o < 0) return ''
  let prof = 0
  for (let i = o; i < corpsDepot.length; i++) {
    if (corpsDepot[i] === '{') prof++
    else if (corpsDepot[i] === '}') {
      prof--
      if (prof === 0) return corpsDepot.slice(o, i + 1)
    }
  }
  return ''
})()
ok(
  objetInsere.length > 0 && objetInsere.includes('publication_id'),
  'l’objet inséré est isolé de ce qui l’entoure',
  'un objet vide passerait toutes les assertions suivantes sans rien mesurer (§E.33)',
)
ok(
  !objetInsere.includes('ai_match_score_MUT') && !objetInsere.includes('logAudit'),
  '… et il ne déborde pas sur l’audit qui le suit',
)

const iRetourEchec = corpsDepot.indexOf("issue: 'sans_jugement'")
ok(
  iRetourEchec >= 0 && iRetourEchec < iInsert,
  'l’échec du jugement RETOURNE avant l’insertion',
  'sans ce retour anticipé, l’insertion serait atteignable sans note — le type ne suffirait plus',
)

ok(
  /ai_match_score:\s*resultat\.jugement\.score/.test(objetInsere),
  'la note écrite est celle du jugement',
  'absente de l OBJET INSERE, la base refuse la ligne — et l expert perd son depot en 500',
)
ok(
  !/ai_match_score:\s*null/.test(corpsDepot),
  'aucune note nulle n’est écrite',
  'c’est la forme d’avant : la candidature naissait nue et attendait un `after()`',
)
ok(
  /ai_assessment:\s*\{/.test(objetInsere) &&
    /reason:\s*resultat\.jugement\.reason/.test(objetInsere) &&
    /pitch_org:\s*resultat\.jugement\.pitch_org/.test(objetInsere),
  'le résumé écrit porte SES DEUX textes',
)

// Le jugement n'est PAS différé : il est attendu dans la requête.
const iAfter = corpsDepot.indexOf('after(')
ok(
  iAfter < 0 || iAfter > iInsert,
  'le jugement n’est pas relégué dans un `after()`',
  'différé, il rendrait de nouveau la candidature écrite AVANT d’être notée',
)

/* ═══════════════════════════════════════════════════════════════════════════
   4. LA BASE REFUSE — contrainte, pas discipline (§E.31)
   ═══════════════════════════════════════════════════════════════════════════ */
section('4. La base refuse une candidature nue')

const DOSSIER_MIG = join(ROOT, 'supabase', 'migrations')
const MIGS = readdirSync(DOSSIER_MIG).filter((f) => f.endsWith('.sql')).sort()
const migCompletude = MIGS.filter((f) => f.includes('candidature_complete'))
ok(
  migCompletude.length === 1,
  `une migration de complétude : ${migCompletude.join(', ') || '(aucune)'}`,
  'zéro ou deux : on ne sait plus laquelle gouverne (§G.3)',
)

const sqlCompletude = migCompletude.length === 1
  ? depouillerSql(lire(`supabase/migrations/${migCompletude[0]}`))
  : ''
const corpsContrainte = (() => {
  const i = sqlCompletude.indexOf('add constraint candidatures_complete_ou_inexistante')
  if (i < 0) return ''
  const j = sqlCompletude.indexOf(';', i)
  return j < 0 ? sqlCompletude.slice(i) : sqlCompletude.slice(i, j)
})()

ok(corpsContrainte.length > 0, 'la contrainte de complétude est déclarée')
ok(/ai_match_score is not null/i.test(corpsContrainte), '… elle exige la NOTE')
ok(/ai_assessment is not null/i.test(corpsContrainte), '… elle exige le RÉSUMÉ')
ok(
  /ai_assessment ->> 'reason'/i.test(corpsContrainte) &&
    /ai_assessment ->> 'pitch_org'/i.test(corpsContrainte),
  '… et elle exige les DEUX textes, non vides',
  'sans eux, un `{}` suffirait : « le résumé existe » serait vrai et faux en même temps',
)
ok(
  !/not\s+valid/i.test(corpsContrainte),
  '… et elle est VALIDÉE, jamais `not valid`',
  'une contrainte `not valid` est quand même vérifiée sur tout UPDATE : les 4 candidatures de juin deviendraient IMMUABLES',
)
ok(
  /created_at < timestamptz '2026-09-23/.test(corpsContrainte),
  '… la borne de date déclare le passé',
  'sans borne, la migration échouerait sur les 4 lignes de juin 2026 — ou les figerait',
)

// La postcondition LÈVE (§E.60) : une migration qui « réussit » n'a rien prouvé.
const nbRaise = (sqlCompletude.match(/raise exception 'postcondition NON TENUE/g) ?? []).length
ok(
  nbRaise >= 8,
  `la postcondition lève sur ${nbRaise} vérification(s)`,
  'moins de huit : la table, la clé, les contraintes, les index ou la fonction ne sont plus vérifiés',
)

/* ═══════════════════════════════════════════════════════════════════════════
   5. LE VOCABULAIRE EST UNIQUE — et le module pur S'EXÉCUTE (§E.33)
   ═══════════════════════════════════════════════════════════════════════════ */
section('5. Les trois causes sont définies une fois, et la base porte les mêmes')

let VOC = null
try {
  VOC = await import(new URL('../lib/candidatures/depot-etats.ts', import.meta.url).href)
} catch (e) {
  console.error(`\n❌ lib/candidatures/depot-etats.ts INIMPORTABLE : ${e.message}\n`)
  process.exit(2)
}

ok(
  Array.isArray(VOC.CAUSES_DEPOT) && VOC.CAUSES_DEPOT.length === 3,
  `trois causes déclarées : ${(VOC.CAUSES_DEPOT ?? []).join(', ')}`,
)
const causesSql = (() => {
  const i = sqlCompletude.indexOf('candidature_depots_cause_valeurs_check')
  if (i < 0) return []
  const j = sqlCompletude.indexOf(')', sqlCompletude.indexOf('in (', i))
  const bloc = sqlCompletude.slice(i, j)
  return [...bloc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
})()
ok(
  causesSql.length === 3 && VOC.CAUSES_DEPOT.every((c) => causesSql.includes(c)),
  `la base porte les mêmes trois causes : ${causesSql.join(', ') || '(aucune)'}`,
  'deux listes du même fait vieillissent séparément (§E.20)',
)
// ⚠️ LE TYPE EST **DÉRIVÉ**, ET C'EST ÇA QU'ON VÉRIFIE — PAS LE RÉ-EXPORT.
//    Le contrôle regardait `ai-assessment.ts` : une recopie replacée dans le
//    module PUR y passait inaperçue, et c'est exactement ce que la mutation a
//    fait. La dérivation est la garantie (une divergence ne compile pas) ; le
//    ré-export n'en est que la conséquence.
const VOC_SRC = lire('lib/candidatures/depot-etats.ts')
ok(
  /export type CausePanne = \(typeof CAUSES_DEPOT\)\[number\]/.test(VOC_SRC),
  'le type `CausePanne` est DÉRIVÉ de la liste',
  'recopié, il divergerait sans faire échouer la compilation',
)
ok(
  !/export type CausePanne =\s*'/.test(VOC_SRC),
  '… et nulle part recopié en toutes lettres',
)
ok(
  /export type \{ CausePanne \}/.test(lire('lib/candidatures/ai-assessment.ts')) &&
    !/export type CausePanne =\s*'/.test(lire('lib/candidatures/ai-assessment.ts')),
  '… et le jugement le ré-exporte au lieu de le redéfinir',
)

section('5 bis. `etatDeDepot` — exécuté, pas relu')

const T0 = Date.parse('2026-09-23T12:00:00Z')
const cas = [
  [{ etat: 'depose', commence_at: '2026-09-23T11:00:00Z' }, T0, 'depose', 'un dépôt abouti reste abouti'],
  [{ etat: 'echec', commence_at: '2026-09-23T11:00:00Z' }, T0, 'echec', 'un échec reste un échec'],
  [{ etat: 'en_cours', commence_at: '2026-09-23T11:59:59Z' }, T0, 'en_cours', 'un dépôt commencé il y a 1 s est EN COURS'],
  [{ etat: 'en_cours', commence_at: '2026-09-23T11:59:30Z' }, T0, 'en_cours', 'à 30 s, il peut encore aboutir (le modèle attend 30 s)'],
  [{ etat: 'en_cours', commence_at: '2026-09-23T11:59:10Z' }, T0, 'interrompu', 'à 50 s, son appel a forcément rendu la main'],
  [{ etat: 'en_cours', commence_at: 'pas une date' }, T0, 'interrompu', 'une date ILLISIBLE ne vaut pas « tout va bien »'],
]
for (const [ligne, maintenant, attendu, pourquoi] of cas) {
  const rendu = VOC.etatDeDepot(ligne, maintenant)
  ok(rendu === attendu, `${pourquoi} → ${rendu}`, `attendu ${attendu}`)
}

section('5 ter. `filtreDepotsEnSouffrance` — un seul prédicat, exécuté')

const filtre = VOC.filtreDepotsEnSouffrance(T0)
ok(filtre.includes('etat.eq.echec'), 'le prédicat retient les ÉCHECS')
ok(
  filtre.includes('etat.eq.en_cours') && filtre.includes('commence_at.lt.'),
  '… et les dépôts en cours au-delà de la fenêtre',
)
ok(
  filtre.includes(new Date(T0 - VOC.FENETRE_DEPOT_MS).toISOString()),
  '… la borne est bien celle de la fenêtre',
  'une borne différente ferait apparaître des dépôts qui peuvent encore aboutir',
)
// Les deux surfaces le LISENT, aucune ne le réécrit.
for (const f of ['app/api/admin/depots-en-echec/route.ts', 'app/api/admin/supervision/route.ts']) {
  ok(
    /filtreDepotsEnSouffrance\s*\(/.test(depouillerJs(lire(f))),
    `${f} lit le prédicat partagé`,
    'deux expressions du même fait annonceraient un jour deux nombres différents (§E.36)',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. LE JOURNAL NAÎT AVANT L'APPEL — §E.63, payé huit jours plus tôt
   ═══════════════════════════════════════════════════════════════════════════ */
section('6. Le journal du dépôt naît AVANT l’appel au modèle')

const journal = appelDePremierNiveau(corpsDepot, 'await ouvrirJournal(')
ok(journal.total === 1, `le dépôt ouvre son journal, une fois (${journal.total})`,
  'deux ouvertures compteraient deux tentatives pour un seul dépôt')
ok(
  journal.index >= 0,
  'le journal est ouvert au PREMIER NIVEAU du dépôt',
  'enferme dans une closure, il s execute quand on l appelle — pas quand il est ecrit',
)
ok(
  journal.index >= 0 && journal.index < iJuger,
  'le journal est ouvert AVANT le jugement',
  'écrit après, il n’existerait PAS dans le seul cas où il sert : la fonction tuée pendant les 30 s d’appel',
)

const corpsOuvrir = corpsDe(depotNu, 'async function ouvrirJournal')
ok(
  /console\.error\(/.test(corpsOuvrir),
  'une ouverture refusée est JOURNALISÉE',
  'muette, le dépôt cesserait d’être relançable sans que rien ne le dise',
)
ok(
  /data !== true/.test(corpsOuvrir),
  '… et le booléen de la base est LU',
  '« aucune ligne écrite » n’est pas « rien à faire » (§E.22)',
)
ok(
  !/return \{ issue: 'refusee'/.test(corpsOuvrir) && !/throw /.test(corpsOuvrir),
  '… mais elle ne fait PAS échouer le dépôt',
  'un défaut d’observation ne doit pas devenir une perte de dossier',
)

/* ═══════════════════════════════════════════════════════════════════════════
   7. LA RELANCE REJOUE LE MÊME CHEMIN (§E.20)
   ═══════════════════════════════════════════════════════════════════════════ */
section('7. La relance rejoue le dépôt — la même fonction, pas une copie')

const RELANCE = 'app/api/admin/depots-en-echec/route.ts'
const relanceNu = depouillerJs(lire(RELANCE))
ok(
  /deposerCandidature\s*\(/.test(relanceNu),
  'la relance appelle `deposerCandidature`',
  'une copie du chemin ne sert que le jour où le chemin normal a déjà échoué',
)
ok(
  !ecritCandidatures(lire(RELANCE)),
  '… et elle n’écrit AUCUNE candidature elle-même',
)
ok(
  !/jugerCandidature\s*\(/.test(relanceNu),
  '… et elle ne juge pas non plus de son côté',
)
ok(/requireAdmin\s*\(/.test(relanceNu), '… et elle est derrière `requireAdmin`')

// Les DEUX appelants partagent la même table de refus.
for (const f of ['app/api/candidatures/route.ts', RELANCE]) {
  ok(
    /REFUS_DEPOT\[/.test(depouillerJs(lire(f))),
    `${f} lit la table de refus partagée`,
    'deux tables de correspondance rendraient deux statuts pour le même refus',
  )
}

// Le seul appelant du jugement de candidature est le chemin de dépôt.
// ⚠️ UNE DÉCLARATION N'EST PAS UN APPEL. `ai-assessment.ts` DÉFINIT
//    `jugerCandidature` : le compter comme appelant ferait rougir le contrôle
//    sur le fichier qui a raison (§E.34 — on ancre sur ce qu'on défend).
const appelleJugement = (src) =>
  [...depouillerJs(src).matchAll(/(\w+\s+)?jugerCandidature\s*\(/g)].some(
    (m) => (m[1] ?? '').trim() !== 'function',
  )
const jugeurs = SOURCES.filter((f) => appelleJugement(lire(f)))
ok(
  jugeurs.length === 1 && jugeurs[0] === DEPOT,
  `un seul appelant du jugement : ${jugeurs.join(', ') || '(aucun)'}`,
  'un second appelant serait un chemin parallèle, avec ses propres oublis',
)

/* ═══════════════════════════════════════════════════════════════════════════
   8. LE REJEU N'EST JAMAIS AUTOMATIQUE
   ═══════════════════════════════════════════════════════════════════════════ */
section('8. Rien ne relance un dépôt tout seul')

// ⚠️ ON CHERCHE L'IMPORT, PAS L'APPEL — DEUX MUTATIONS SONT PASSÉES AU VERT
//    EN L'AJOUTANT SANS PARENTHÈSES. `export const relance = deposerCandidature`
//    n'est pas un appel, et c'est pourtant un accès complet à la fonction :
//    l'appelant réel devient le consommateur de cet export, invisible d'ici.
//    Ce qu'on défend est « qui peut déposer », pas « qui écrit une paire de
//    parenthèses » (§E.34).
const importeLeDepot = (src) =>
  /from '@\/lib\/candidatures\/depot'/.test(depouillerJs(src))

const CRON = fichiersSous(['app/api/cron'])
const cronsQuiDeposent = CRON.filter((f) => importeLeDepot(lire(f)))
ok(
  cronsQuiDeposent.length === 0,
  `aucune tâche planifiée ne dépose : ${cronsQuiDeposent.join(', ') || '—'}`,
  'Youssef l’a refusé : « ça tournerait en boucle et ça coûterait »',
)
const appelants = SOURCES.filter((f) => f !== DEPOT && importeLeDepot(lire(f)))
ok(
  appelants.length === 2 &&
    appelants.includes('app/api/candidatures/route.ts') &&
    appelants.includes(RELANCE),
  `deux appelants, et deux seulement : ${appelants.join(', ')}`,
  'l’expert qui postule, et l’administrateur qui relance. Rien d’autre.',
)

/* ═══════════════════════════════════════════════════════════════════════════
   9. L'EXPERT N'EST PAS PRÉVENU — et la plateforme, elle, l'est
   ═══════════════════════════════════════════════════════════════════════════ */
section('9. L’expert n’est pas prévenu, la plateforme l’est')

const ROUTE_DEPOT = 'app/api/candidatures/route.ts'
const routeNu = depouillerJs(lire(ROUTE_DEPOT))
const corpsPost = corpsDe(routeNu, 'export async function POST')
ok(
  /case 'sans_jugement':/.test(corpsPost),
  'la route traite explicitement le cas « sans jugement »',
)
ok(
  /\}, 202\)/.test(corpsPost),
  '… et elle répond 202, pas 201',
  '201 « Created » quand rien n’a été créé est faux au niveau du protocole',
)

const CLIENT = 'components/dashboard/MissionDetailView.tsx'
const clientNu = depouillerJs(lire(CLIENT))
ok(
  !/depot_non_enregistre/.test(clientNu),
  'le client n’a AUCUNE branche sur le non-enregistrement',
  'lui en donner une reviendrait à prévenir l’expert — ce que la décision refuse',
)
ok(
  /setSuccessBanner\(t\('success_applied'\)\)/.test(clientNu),
  '… il affiche le même succès dans les deux cas',
)

// LE CONTREPOIDS : le signal de supervision est BLOQUANT, et EXTINGUIBLE.
const SUP = 'lib/supervision/problemes.ts'
const supNu = depouillerJs(lire(SUP))
const corpsClasser = corpsDe(supNu, 'export function classerProblemes')
// ⚠️ ON ISOLE **LE BLOC**, PAS UN VOISINAGE (§E.40, §E.8). Une fenêtre de
//    900 caractères partant du premier `s.depotsEnSouffrance` couvrait les
//    DEUX branches : retirer le `lien` du problème bloquant laissait celui du
//    problème « attention » dans la fenêtre, et la mutation passait au vert.
//    Une fenêtre mesure la distance au traitement, jamais son appartenance.
const blocDeCle = (cle) => {
  const i = corpsClasser.indexOf(`cle: '${cle}'`)
  if (i < 0) return ''
  // Le `push({ … })` qui le contient : on remonte à son accolade ouvrante,
  // puis on referme par comptage.
  let debut = corpsClasser.lastIndexOf('{', i)
  if (debut < 0) return ''
  let prof = 0
  for (let j = debut; j < corpsClasser.length; j++) {
    if (corpsClasser[j] === '{') prof++
    else if (corpsClasser[j] === '}') {
      prof--
      if (prof === 0) return corpsClasser.slice(debut, j + 1)
    }
  }
  return ''
}
const blocPerdus = blocDeCle('depots_candidature_perdus')
const blocInconnu = blocDeCle('lecture_indisponible_depots')

ok(blocPerdus.length > 0, 'la supervision regarde les dépôts en souffrance')
// Le découpage MORD : sans cette preuve, deux blocs vides passeraient tous les
// tests qui suivent en ne mesurant plus rien (§E.33).
ok(
  blocPerdus.includes('depots_candidature_perdus') &&
    !blocPerdus.includes('lecture_indisponible_depots'),
  '… et le bloc isolé ne déborde PAS sur son voisin',
  'un bloc qui deborde rend vert le retrait qu il devait voir',
)
ok(
  /gravite: 'bloquant'/.test(blocPerdus),
  '… et elle les classe BLOQUANT',
  'en « attention », le signal se range avec ce qu’on regarde plus tard',
)
ok(
  /compte: s\.depotsEnSouffrance/.test(blocPerdus),
  '… en disant COMBIEN',
  'un signal sans nombre ne permet pas de juger de l urgence',
)
ok(
  blocInconnu.length > 0 && /gravite: 'attention'/.test(blocInconnu),
  '… « je n’ai pas pu compter » est un problème distinct',
  '`null` traité comme 0 dirait « aucun dépôt perdu » au moment où l’on ne sait plus rien (§E.22)',
)
ok(
  /s\.depotsEnSouffrance === null/.test(corpsClasser),
  '… et c’est bien le `null` qui le déclenche',
)
ok(
  /lien: '\/admin\/depots-en-echec'/.test(blocPerdus),
  '… et le signal BLOQUANT ouvre l’écran qui l’éteint',
  'un signal bloquant qu’aucune action ne peut éteindre apprend à être ignoré (§E.52)',
)

const SUP_ROUTE = 'app/api/admin/supervision/route.ts'
ok(
  /depotsEnSouffrance:\s*depotsRes\.error \? null : \(depotsRes\.count \?\? 0\)/.test(
    depouillerJs(lire(SUP_ROUTE)),
  ),
  'la lecture rend `null` sur panne, jamais 0',
)

/* ═══════════════════════════════════════════════════════════════════════════
   10. L'ÉCRAN — atteignable, complet, et sans identifiant brut
   ═══════════════════════════════════════════════════════════════════════════ */
section('10. L’écran existe, il est au menu, et il parle quatre langues')

const ECRAN = 'app/[locale]/admin/depots-en-echec/page.tsx'
ok(existsSync(join(ROOT, ECRAN)), 'l’écran existe')
const ecranSrc = lire(ECRAN)
ok(
  /href: '\/admin\/depots-en-echec'/.test(lire('lib/nav-config.ts')),
  'il est au MENU de l’administration',
  'un écran sans entrée de menu est un écran qu’on ne trouve pas (§M1 ⑩)',
)
ok(
  /labelKey: 'nav_depots_echec'/.test(lire('lib/nav-config.ts')),
  '… avec un libellé traduit, jamais un identifiant (§D.11)',
)

// Les clés utilisées existent dans les QUATRE langues — et aucune n'est orpheline.
const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(ROOT, 'messages', `${l}.json`), 'utf8'))]),
)
// ⚠️ TOUTES LES CLÉS NE SONT PAS LITTÉRALES, ET LE SUPPOSER A FAIT ROUGIR CE
//    CONTRÔLE SUR DU CODE JUSTE. Les libellés d'inaptitude sont atteints par
//    une clé CONSTRUITE, parce que la liste des raisons est DÉRIVÉE de la
//    règle d'éligibilité (§D.20) : les écrire en dur dans l'écran serait la
//    recopie que cette règle interdit.
//    On les prend donc à la MÊME SOURCE que l’écran. Une condition ajoutée
//    demain attend son libellé, et son absence fera rougir — ce qui est
//    exactement ce qu’on veut (§E.61).
const clesDerivees = REGLE_ELIGIBILITE.CONDITIONS_ELIGIBILITE.map(
  (c) => `raison_${c.raison}`,
)
ok(
  /RAISONS_CONNUES/.test(depouillerJs(ecranSrc)) &&
    /CONDITIONS_ELIGIBILITE/.test(depouillerJs(ecranSrc)),
  'l’écran dérive ses libellés de raison de la RÈGLE, il ne les liste pas',
  'une liste écrite à la main se désaccorde de la règle à la première condition ajoutée',
)
const clesUtilisees = [
  ...[...depouillerJs(ecranSrc).matchAll(/\bt\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]),
  ...clesDerivees,
]
ok(clesUtilisees.length >= 20, `${clesUtilisees.length} clés lues dans l’écran`)
const manquantes = []
for (const l of LOCALES) {
  const ns = messages[l]?.admin_back_office?.depots_echec ?? {}
  for (const c of clesUtilisees) if (!(c in ns)) manquantes.push(`${l}.${c}`)
}
ok(manquantes.length === 0, `aucune clé manquante : ${manquantes.slice(0, 6).join(', ') || '—'}`)

const orphelines = []
for (const l of LOCALES) {
  const ns = messages[l]?.admin_back_office?.depots_echec ?? {}
  for (const c of Object.keys(ns)) if (!clesUtilisees.includes(c)) orphelines.push(`${l}.${c}`)
}
ok(
  orphelines.length === 0,
  `aucune clé orpheline : ${orphelines.slice(0, 6).join(', ') || '—'}`,
  'une clé que plus personne n’affiche survit à son écran et se recopie',
)

for (const cle of ['depots_candidature_perdus', 'lecture_indisponible_depots']) {
  const absentes = LOCALES.filter((l) => !messages[l]?.admin_back_office?.supervision?.problem?.[cle])
  ok(absentes.length === 0, `le problème « ${cle} » est traduit partout`, `manque en ${absentes.join(', ')}`)
}

// §D.12 — aucune couleur littérale, et l'état vide DIT quelque chose.
ok(
  !/#[0-9a-fA-F]{3,8}\b/.test(ecranSrc) && !/\brgba?\(/.test(ecranSrc),
  'aucune couleur littérale dans l’écran (§D.12)',
)
ok(
  !/--sk-faint/.test(ecranSrc),
  'l’état vide ne prend pas le texte tenu',
  '`--sk-faint` ne porte JAMAIS d’information : « aucun dépôt perdu » en est une (§D.12)',
)
ok(
  !/disabled=\{/.test(ecranSrc),
  'aucun bouton désactivé',
  'un bouton qu’on ne peut pas cliquer promet une porte qui n’existe pas (§D.1)',
)

/* ═══════════════════════════════════════════════════════════════════════════
   11. LA MIGRATION EST DANS SA PLAGE ET DANS L'ORDRE (§G.2)
   ═══════════════════════════════════════════════════════════════════════════ */
section('11. La migration respecte la plage du tronc et l’ordre')

if (migCompletude.length === 1) {
  const nom = migCompletude[0]
  const suffixe = nom.slice(8, 14)
  ok(/^0\d{5}$/.test(suffixe), `suffixe ${suffixe} dans la plage du tronc (0xxxxx)`)
  const rang = MIGS.indexOf(nom)
  ok(
    rang === MIGS.length - 1 || MIGS.slice(rang + 1).every((f) => f > nom),
    'elle est postérieure à toutes les migrations existantes',
  )
  ok(/ORDRE DE PASSAGE\s*:/.test(lire(`supabase/migrations/${nom}`)), 'son en-tête dit son ordre de passage (§G.4)')
}

note(`${MIGS.length} migrations sur le disque`)

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log(
  echecs === 0
    ? '\n✅ VERT — une candidature n’existe que complète, et ce qui n’aboutit pas se voit.\n'
    : `\n❌ ROUGE — ${echecs} écart(s).\n`,
)
process.exit(echecs === 0 ? 0 : 1)
