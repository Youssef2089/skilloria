// scripts/diag-occupe-ferme-le-depot.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ « OCCUPÉ » FERME AUSSI LE DÉPÔT. LE SERVEUR REFUSE, PAS SEULEMENT L'ÉCRAN║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LA DÉCISION, ARBITRÉE PAR YOUSSEF LE 23/09/2026 ───────────────────────┐
// │ « Je ne reçois rien, je ne vois rien, JE NE POSTULE PAS. »               │
// │                                                                          │
// │ Les deux premiers tiers tenaient : le moteur excluait l'expert du vivier │
// │ ET de ses recommandations, le flux fermait sa liste. Le troisième, non : │
// │ un match posé AVANT qu'il ne se déclare occupé restait cliquable, et le  │
// │ serveur ACCEPTAIT le dépôt.                                              │
// └──────────────────────────────────────────────────────────────────────────┘
//
// ═══ ET CE N'EST PAS QUE « OCCUPÉ » ══════════════════════════════════════
//   Le dépôt lit la règle ENTIÈRE (§D.20), parce que §D.19 a rendu le jugement
//   de Claude OBLIGATOIRE au dépôt : un expert dont le consentement IA a été
//   RETIRÉ après la création du match aurait vu son profil partir chez le
//   fournisseur. La condition existait dans le moteur et n'avait aucune raison
//   de s'arrêter à la porte du dépôt.
//
// ═══ LE TROISIÈME ÉCRIVAIN, TROUVÉ EN FAISANT CE POINT ═══════════════════
//   `lib/missions/feed.ts` posait sa propre expression —
//   `availability_status === 'do_not_disturb' || cdi_status === 'employed'` —
//   sous un commentaire disant « UN SEUL endroit lit ces colonnes ». Vrai du
//   flux, faux du produit (§E.7). Le périmètre du contrôle de §D.20 ne
//   balayait que `lib/matching/` : il ne pouvait pas le voir (§E.61).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE PÉRIMÈTRE, ÉCRIT — ET CHAQUE EXCLUSION JUSTIFIÉE
//
//   BALAYE   lib/candidatures/      le chemin de dépôt
//            lib/missions/          le flux — ⚠️ DANS le périmètre, et c'est
//                                   une MESURE qui l'a décidé : il portait un
//                                   troisième écrivain de la règle.
//            lib/matching/          la règle elle-même
//            app/api/               les deux appelants du dépôt, et le détail
//                                   de mission qui sert l'aptitude à l'écran
//            components/            ⚠️ DANS le périmètre : c'est l'écran qui
//                                   ferme le bouton, et c'est LÀ qu'une règle
//                                   serveur se recopie (§E.15)
//            messages/*.json        les quatre langues
//
//   EXCLU    app/[locale]/          ⚠️ APRÈS MESURE : les deux pages de détail
//                                   (freelance et CDI) montent le MÊME
//                                   composant — la parité est structurelle, et
//                                   c'est vérifié ci-dessous plutôt que
//                                   supposé.
//            node_modules/ .next/   pas du dépôt / généré
//            supabase/              aucune règle d'aptitude en base
//            docs/                  de la prose
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-occupe-ferme-le-depot.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE écriture.
// 0 = vert · 1 = rouge · 2 = n'a pas tourné.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
// ⚠️ IMPORT STATIQUE (§E.57) : un `await import()` en milieu de fichier fait
//    planter Node à la sortie, sous Windows, quand stdout est redirigé.
import * as REGLE from '../lib/matching/eligibilite.ts'

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
/** §E.3 — CRLF normalisé. */
const lire = (rel) => readFileSync(join(ROOT, rel), 'utf8').split('\r\n').join('\n')

/** §E.7 — commentaires retirés sans perdre de positions. */
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

const DEPOT = 'lib/candidatures/depot.ts'
const depotNu = depouillerJs(lire(DEPOT))
const ECRAN = 'components/dashboard/MissionDetailView.tsx'
const ecranNu = depouillerJs(lire(ECRAN))

/* ═══════════════════════════════════════════════════════════════════════════
   0. LE DÉTECTEUR S'ÉPROUVE AVANT DE BALAYER (§E.33)
   ═══════════════════════════════════════════════════════════════════════════ */
section('0. Le détecteur retrouve le défaut, et se tait sur le correctif')

/**
 * Un fichier RECOPIE-t-il la règle de disponibilité au lieu de la lire ?
 *
 * ⚠️ LES VALEURS VIENNENT DE LA RÈGLE, pas d'une liste écrite ici (§E.61) : un
 *    public ajouté demain étend le balayage sans qu'on l'y inscrive.
 */
const VALEURS_INDISPO = REGLE.CONDITIONS_ELIGIBILITE.filter((c) => c.portee !== 'toujours').map(
  (c) => String(c.filtre.valeur),
)
// ⚠️ UNE **COMPARAISON**, PAS UNE OCCURRENCE — MESURÉ À LA PREMIÈRE
//    EXÉCUTION. Le détecteur cherchait la VALEUR, et il a dénoncé huit
//    fichiers qui ont tous raison : un type (`cdi_status: 'employed' | …`),
//    l'énumération donnée au modèle qui lit les CV, et l'ÉCRITURE elle-même
//    (`{ cdi_status: listening ? 'open_to_work' : 'employed' }`). Écrire la
//    valeur n’est pas en juger (§E.34).
//    Ce qui se défend est qu’aucun chemin de DÉCISION ne re-dérive « cet
//    expert est-il indisponible ». La forme d’une dérivation est une
//    comparaison, ou un filtre.
const recopieLaRegle = (src) => {
  const nu = depouillerJs(src)
  return VALEURS_INDISPO.filter((v) =>
    [
      new RegExp(`(?:===|!==|==|!=)\\s*['"\`]${v}['"\`]`),
      new RegExp(`['"\`]${v}['"\`]\\s*(?:===|!==|==|!=)`),
      new RegExp(`\\.(?:eq|neq|is|not)\\(\\s*['"\`][a-z_]+['"\`]\\s*,\\s*['"\`]${v}['"\`]`),
      new RegExp(`\\.or\\(\\s*['"\`][^'"\`]*${v}`),
    ].some((r) => r.test(nu)),
  )
}

const TEMOIN_RECOPIE = `  const isDnd = p.availability_status === 'do_not_disturb' || p.cdi_status === 'employed'`
const TEMOIN_LECTURE = `  const isDnd = enIndisponibilite(row)`
const TEMOIN_COMMENTE = `  // autrefois : availability_status === 'do_not_disturb'\n  const x = 1`
/** Le TYPE de la colonne — huit fichiers en portent un, et ils ont raison. */
const TEMOIN_TYPE = `  cdi_status: 'employed' | 'open_to_work' | null`
/** L'ÉCRITURE de la valeur — c'est la bascule elle-même. */
const TEMOIN_ECRITURE = `  { cdi_status: listening ? 'open_to_work' : 'employed' }`
/** L'énumération donnée au modèle qui lit les CV. */
const TEMOIN_ENUM = `  enum: ['employed', 'open_to_work', null],`

ok(recopieLaRegle(TEMOIN_RECOPIE).length === 2, 'il VOIT une recopie de la règle de disponibilité')
ok(recopieLaRegle(TEMOIN_LECTURE).length === 0, '… et il se TAIT sur une lecture de la règle')
ok(
  recopieLaRegle(TEMOIN_COMMENTE).length === 0,
  '… et un COMMENTAIRE qui la cite ne compte pas (§E.7)',
  'un commentaire n’a jamais ferme un bouton',
)
ok(recopieLaRegle(TEMOIN_TYPE).length === 0, "… ni le TYPE de la colonne")
ok(
  recopieLaRegle(TEMOIN_ECRITURE).length === 0,
  "… ni son ÉCRITURE — la bascule elle-même",
  'ecrire la valeur n est pas en juger (§E.34)',
)
ok(recopieLaRegle(TEMOIN_ENUM).length === 0, "… ni l’énumération donnée au modèle")
ok(VALEURS_INDISPO.length === 2, `deux valeurs d’indisponibilité : ${VALEURS_INDISPO.join(', ')}`,
  'la règle a changé de forme : ce contrôle mesure autre chose que ce qu’il croit')

/* ═══════════════════════════════════════════════════════════════════════════
   1. LE SERVEUR REFUSE — et avant toute dépense
   ═══════════════════════════════════════════════════════════════════════════ */
section('1. Le dépôt juge l’aptitude, avant tout ce qui coûte')

ok(/jugerEligibilite\s*\(/.test(depotNu), 'le dépôt lit la règle d’éligibilité')
ok(
  /return \{ issue: 'inapte', raison: aptitude\.raison \}/.test(depotNu),
  '… et il REFUSE avec la raison, sans rien écrire',
)

const iAptitude = depotNu.indexOf('jugerEligibilite(')
const iJournal = depotNu.indexOf('await ouvrirJournal(')
const iModele = depotNu.indexOf('jugerCandidature(')
const iInsert = depotNu.search(/from\(\s*['"]candidatures['"]\s*\)\s*\n?\s*\.insert\(/)
ok(iAptitude >= 0 && iJournal > iAptitude, 'l’aptitude est jugée AVANT l’ouverture du journal')
ok(
  iAptitude >= 0 && iModele > iAptitude,
  'l’aptitude est jugée AVANT l’appel au modèle',
  'juger après, c’est payer un jugement dont on va jeter le résultat',
)
ok(iAptitude >= 0 && iInsert > iAptitude, '… et AVANT toute écriture')

// Le PUBLIC vient du compte, jamais d'une constante : c'est lui qui décide
// laquelle des deux disponibilités s'applique.
ok(
  /user_type ===\s*\n?\s*'expert_cdi'/.test(depotNu) || /user_type === 'expert_cdi'/.test(depotNu),
  'le public de l’expert est lu sur SON compte',
  'une constante appliquerait la disponibilité freelance à un salarié, et inversement',
)

/* ═══════════════════════════════════════════════════════════════════════════
   2. LE `SELECT` CHARGE DE QUOI JUGER — sinon le test lit `undefined` (§E.1)
   ═══════════════════════════════════════════════════════════════════════════ */
section('2. Les trois lecteurs chargent les colonnes de la règle, dérivées')

// ⚠️ ON DÉFEND « DÉRIVÉ », PAS UNE FORME D’ÉCRITURE. Le dépôt compose son
//    `select` par UNION dédoublonnée avec ses champs d’aperçu : il n’écrit
//    donc pas `COLONNES_PROFIL.join(`. Exiger la forme aurait fait rougir sur
//    du code strictement plus juste (§E.34).
for (const [nom, rel, avecCompte] of [
  ['le dépôt', DEPOT, true],
  ['le flux de missions', 'lib/missions/feed.ts', false],
  ['le détail d’une mission', 'app/api/me/missions/[id]/route.ts', true],
]) {
  const src = depouillerJs(lire(rel))
  ok(
    /COLONNES_PROFIL/.test(src),
    `${nom} : les colonnes de profil sont DÉRIVÉES`,
    'listées à la main, un test sur une colonne non chargée lit `undefined` et conclut',
  )
  if (avecCompte) {
    ok(/COLONNES_COMPTE/.test(src), `${nom} : les colonnes de compte aussi`)
  }
  // ⚠️ CE QUI N’EST **PAS** VÉRIFIÉ ICI, ET C’EST DÉCLARÉ (§E.38).
  //    « Les colonnes ne sont pas AUSSI écrites en dur » a été tenté, et le
  //    motif dénonçait du code juste : la whitelist d’aperçu du dépôt NOMME
  //    `availability_status` et `cdi_status` — elle décide ce qui part vers
  //    l’organisation, pas qui est éligible —, et `status` est le nom le
  //    plus commun du dépôt.
  //    Isoler chacun des trois `select` demanderait trois découpeurs, pour
  //    une propriété que `diag-eligibilite-unique` tient déjà sur les deux
  //    `select` du moteur (§E.36). Ce qui se défend ici est la DÉRIVATION :
  //    la retirer est le chemin de régression réel, et il est couvert.
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. PERSONNE NE RECOPIE LA RÈGLE — y compris le flux, qui le faisait
   ═══════════════════════════════════════════════════════════════════════════ */
section('3. Aucune recopie de la règle de disponibilité')

const PERIMETRE = fichiersSous(['lib', 'app/api', 'components'])
ok(PERIMETRE.length > 150, `${PERIMETRE.length} fichiers balayés`,
  'un balayage qui ne voit presque rien passerait pour vert sans rien vérifier')

const REGLE_FICHIER = 'lib/matching/eligibilite.ts'
/**
 * ⚠️ UNE SEULE EXEMPTION, ET ELLE PORTE SA RAISON (§G.8).
 *
 *    `SpotlightCandidateCard` compare la valeur pour choisir un LIBELLÉ et
 *    une COULEUR, et il distingue TROIS états — disponible, occupé, inconnu.
 *    La règle, elle, répond à une question binaire : « peut-il recevoir ? ».
 *    La lui faire poser perdrait le libellé « disponible ». Il ne décide de
 *    RIEN : ni accès, ni envoi, ni écriture.
 *
 *    `DashboardShell` en était une aussi, et CE LOT LA FERME : sa pastille
 *    posait mot pour mot l’expression du flux, et aurait dit « disponible »
 *    à un expert que le serveur venait de fermer.
 */
const EXEMPTIONS_AFFICHAGE = {
  'components/dashboard/SpotlightCandidateCard.tsx':
    'AFFICHAGE : trois etats vers un libelle et une couleur, aucune decision',
}
const recopieurs = PERIMETRE.filter(
  (f) =>
    f !== REGLE_FICHIER && !(f in EXEMPTIONS_AFFICHAGE) && recopieLaRegle(lire(f)).length > 0,
)
ok(
  recopieurs.length === 0,
  `aucun recopieur : ${recopieurs.map((f) => `${f} (${recopieLaRegle(lire(f)).join(', ')})`).join(' · ') || '—'}`,
  'le flux de missions en était un, sous un commentaire disant qu’il était le seul lecteur',
)
ok(
  /enIndisponibilite\s*\(/.test(depouillerJs(lire('lib/missions/feed.ts'))),
  'le flux de missions PLIE la règle',
  'sans elle il ne ferme plus rien, et « je ne vois rien » cesse d’être vrai',
)

/* ═══════════════════════════════════════════════════════════════════════════
   4. L'UNION EST FERMÉE — les deux appelants traitent `inapte`
   ═══════════════════════════════════════════════════════════════════════════ */
section('4. Les deux appelants du dépôt traitent le refus, avec un statut')

// ⚠️ ON DÉCOUPE LE `case`, PAS UNE FENÊTRE (§E.40). La première version
//    lisait 500 caractères après `case 'inapte':` — et le commentaire qui
//    explique le choix du statut, une fois dépouillé, les remplit d'espaces.
//    Le `return` tombait hors fenêtre, et l’assertion rougissait sur du code
//    juste. Une fenêtre mesure la distance, jamais l’appartenance.
const corpsDuCase = (src, cas) => {
  const d = src.indexOf(`case '${cas}':`)
  if (d < 0) return ''
  const f = src.indexOf('case ', d + 6)
  return f < 0 ? src.slice(d) : src.slice(d, f)
}
for (const [nom, rel, statut] of [
  ['le dépôt par l’expert', 'app/api/candidatures/route.ts', '403'],
  ['la relance du back-office', 'app/api/admin/depots-en-echec/route.ts', '403'],
]) {
  const src = depouillerJs(lire(rel))
  ok(/case 'inapte':/.test(src), `${nom} traite explicitement le refus`)
  const bloc = corpsDuCase(src, 'inapte')
  ok(bloc.includes('return'), `${nom} : le corps du case est isolé`,
    'un corps vide passerait les deux assertions suivantes sans rien mesurer (§E.33)')
  ok(
    new RegExp(`,\\s*${statut}\\)`).test(bloc),
    `… et il répond ${statut}`,
    'un refus de garde rendu en 200 se lirait « c’est reparti » (§E.22)',
  )
  ok(/raison/.test(bloc), '… en portant la RAISON', 'un refus sans motif envoie cliquer en boucle')
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. L'ÉCRAN FERME LE BOUTON AVANT LE CLIC — et ne recalcule rien (§E.15)
   ═══════════════════════════════════════════════════════════════════════════ */
section('5. L’écran ferme le bouton avec sa raison, et il la reçoit du serveur')

ok(/aptitude/.test(ecranNu), 'l’écran lit l’aptitude servie par le serveur')
ok(
  /peut_postuler !== false/.test(ecranNu),
  '… avec `!== false`, jamais une vérité simple',
  'une réponse plus ancienne que ce champ fermerait le bouton sans raison (§E.55)',
)
// ⚠️ LE BOUTON QU’ON DÉFEND EST CELUI DE L’ACTION, PAS N’IMPORTE LEQUEL.
//    L'assertion cherchait `disabled={` dans tout l'écran — et le bouton
//    « écarter », lui, se grise pendant son propre envoi, ce qui est juste.
//    On isole donc le bloc du bouton « postuler » (§E.8).
const blocBouton = (() => {
  const d = ecranNu.indexOf('button_apply')
  if (d < 0) return ''
  const o = ecranNu.lastIndexOf('<button', d)
  return o < 0 ? '' : ecranNu.slice(o, d)
})()
ok(blocBouton.includes('onClick'), 'le bouton « postuler » est isolé',
  'un bloc vide passerait l’assertion suivante sans rien mesurer (§E.33)')
ok(
  !/disabled=\{/.test(blocBouton),
  'le bouton « postuler » n’est pas GRISÉ : il est REMPLACÉ',
  'un bouton qu’on ne peut pas cliquer promet une porte qui n’existe pas (§D.1)',
)
ok(/t\(`inapte\.\$\{raisonInaptitude\}`\)/.test(ecranNu), '… et la raison s’affiche à sa place')
ok(
  /expert_inapte/.test(ecranNu),
  'le refus SERVEUR est traité aussi, s’il arrive quand même',
  'l’écran a pu être chargé avant que l’expert ne se déclare occupé',
)
// Et l'écran ne REJUGE rien : la règle reste au serveur.
ok(
  recopieLaRegle(lire(ECRAN)).length === 0,
  'l’écran ne recopie AUCUNE condition de la règle',
  'une règle serveur appliquée dans l’UI se fige dans le bundle et diverge (§E.15)',
)

/* ═══════════════════════════════════════════════════════════════════════════
   6. PARITÉ CDI — mesurée, pas supposée
   ═══════════════════════════════════════════════════════════════════════════ */
section('6. Les deux voies passent par le MÊME écran et la MÊME règle')

const monteurs = fichiersSous(['app/[locale]']).filter((f) =>
  /MissionDetailView/.test(depouillerJs(lire(f))),
)
ok(
  monteurs.length === 2 &&
    monteurs.some((f) => f.includes('/freelance/')) &&
    monteurs.some((f) => f.includes('/cdi/')),
  `deux monteurs, un par voie : ${monteurs.join(' · ')}`,
  'la parité est STRUCTURELLE — un second composant la ferait diverger (§E.20)',
)
// Et la règle porte bien une condition par public.
for (const kind of ['expert_freelance', 'expert_cdi']) {
  const propres = REGLE.CONDITIONS_ELIGIBILITE.filter((c) => c.portee === kind)
  ok(propres.length === 1, `${kind} : une condition de disponibilité (${propres.length})`,
    'zéro laisserait ce public postuler en étant indisponible')
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. LA RÈGLE S'EXÉCUTE — un occupé ne postule pas, et seulement lui
   ═══════════════════════════════════════════════════════════════════════════ */
section('7. « Occupé » refuse, et n’attrape pas l’autre public')

const APTE = {
  visible: true,
  cv_parsing_status: 'done',
  ai_consent_at: '2026-01-01T00:00:00Z',
  verification_status: 'approved',
  availability_status: 'available',
  cdi_status: 'searching',
  users: { status: 'active', deletion_scheduled_at: null, anonymized_at: null },
}

const cas = [
  ['freelance occupé', { ...APTE, availability_status: 'do_not_disturb' }, 'expert_freelance', 'ne_pas_deranger'],
  ['freelance disponible', APTE, 'expert_freelance', null],
  ['freelance sans disponibilité déclarée', { ...APTE, availability_status: null }, 'expert_freelance', null],
  ['salarié en poste', { ...APTE, cdi_status: 'employed' }, 'expert_cdi', 'non_en_recherche'],
  ['salarié en recherche', APTE, 'expert_cdi', null],
  ['salarié sans statut déclaré', { ...APTE, cdi_status: null }, 'expert_cdi', null],
  ['consentement IA retiré', { ...APTE, ai_consent_at: null }, 'expert_freelance', 'consentement_absent'],
  ['compte suspendu', { ...APTE, users: { ...APTE.users, status: 'suspended' } }, 'expert_freelance', 'compte_suspendu'],
]
for (const [nom, ligne, kind, attendu] of cas) {
  const v = REGLE.jugerEligibilite(ligne, kind)
  const rendu = v.ok ? null : v.raison
  ok(rendu === attendu, `${nom} → ${rendu ?? 'peut postuler'}`, `attendu ${attendu ?? 'apte'}`)
}
// Le croisement : la disponibilité de l'un ne ferme jamais l'autre.
ok(
  REGLE.jugerEligibilite({ ...APTE, availability_status: 'do_not_disturb' }, 'expert_cdi').ok,
  'le « ne pas déranger » d’un freelance ne ferme PAS le dépôt d’un salarié',
)
ok(
  REGLE.jugerEligibilite({ ...APTE, cdi_status: 'employed' }, 'expert_freelance').ok,
  '… et réciproquement',
)
// `enIndisponibilite` — la question que le flux pose, sans connaître le public.
ok(
  REGLE.enIndisponibilite({ ...APTE, availability_status: 'do_not_disturb' }) &&
    REGLE.enIndisponibilite({ ...APTE, cdi_status: 'employed' }) &&
    !REGLE.enIndisponibilite(APTE),
  'sans connaître le public, l’une OU l’autre suffit à fermer le flux',
  'le flux ne connaît pas le type de compte : ne pas le savoir ne doit jamais ouvrir',
)

/* ═══════════════════════════════════════════════════════════════════════════
   8. CHAQUE RAISON A SA PHRASE ET SON LIBELLÉ, EN QUATRE LANGUES
   ═══════════════════════════════════════════════════════════════════════════ */
section('8. Neuf raisons, deux surfaces, quatre langues')

const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(ROOT, 'messages', `${l}.json`), 'utf8'))]),
)
const raisons = REGLE.CONDITIONS_ELIGIBILITE.map((c) => c.raison)

const manquantes = []
for (const l of LOCALES) {
  const inapte = messages[l]?.missions?.detail?.inapte ?? {}
  const admin = messages[l]?.admin_back_office?.depots_echec ?? {}
  for (const r of raisons) {
    if (!inapte[r]) manquantes.push(`${l}.missions.detail.inapte.${r}`)
    if (!admin[`raison_${r}`]) manquantes.push(`${l}.admin.raison_${r}`)
  }
}
ok(
  manquantes.length === 0,
  `chaque raison a sa phrase et son libellé : ${manquantes.slice(0, 5).join(', ') || '—'}`,
  'l’écran rend une clé CONSTRUITE : une clé absente s’affiche BRUTE',
)

const orphelines = []
for (const l of LOCALES) {
  const inapte = messages[l]?.missions?.detail?.inapte ?? {}
  for (const k of Object.keys(inapte)) if (!raisons.includes(k)) orphelines.push(`${l}.inapte.${k}`)
  const admin = messages[l]?.admin_back_office?.depots_echec ?? {}
  for (const k of Object.keys(admin)) {
    if (k.startsWith('raison_') && !raisons.includes(k.slice(7))) orphelines.push(`${l}.admin.${k}`)
  }
}
ok(
  orphelines.length === 0,
  `aucune phrase orpheline : ${orphelines.slice(0, 5).join(', ') || '—'}`,
  'une phrase que plus aucune condition ne produit survit à sa règle',
)

// ⚠️ LES DEUX JEUX SONT DISTINCTS, ET C'EST VOULU : la phrase de l'expert est à
//    la deuxième personne, le libellé de l'administrateur est un constat. Les
//    partager ferait lire « vous êtes en “ne pas déranger” » à quelqu'un qui ne
//    l'est pas (§E.29).
const identiques = raisons.filter(
  (r) =>
    messages.fr?.missions?.detail?.inapte?.[r] ===
    messages.fr?.admin_back_office?.depots_echec?.[`raison_${r}`],
)
ok(
  identiques.length === 0,
  `les deux surfaces ne partagent aucune phrase : ${identiques.join(', ') || '—'}`,
  'un libellé n’est pas une phrase, et une phrase à la 2ᵉ personne ment dans un bandeau admin',
)

note(`${raisons.length} raisons : ${raisons.join(', ')}`)

console.log(
  echecs === 0
    ? '\n✅ VERT — « occupé » ferme le dépôt, au serveur, et l’écran le dit avant le clic.\n'
    : `\n❌ ROUGE — ${echecs} écart(s).\n`,
)
process.exit(echecs === 0 ? 0 : 1)
