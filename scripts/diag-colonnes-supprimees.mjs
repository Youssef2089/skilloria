// scripts/diag-colonnes-supprimees.mjs — CLIQUET sur les colonnes supprimées.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE SCRIPT
//   La migration profil_annonce_multivalues a SUPPRIMÉ quatre colonnes
//   (profiles.speciality_id, profiles.seniority, publications.speciality_id,
//   publications.seniority) et en a renommé une (publications.location →
//   location_note).
//
//   `npx tsc` n'en voit presque rien : ces colonnes vivent dans des CHAÎNES —
//   `.select('id, seniority, ...')`, `.eq('speciality_id', x)`. Le compilateur
//   est vert, et la requête échoue en production. C'est exactement le genre de
//   panne que ce projet passe son temps à supprimer.
//
// POURQUOI UN CLIQUET, ET PAS UN SIMPLE REFUS
//   Au moment du gel, 24 fichiers citent encore ces colonnes : ce sont les
//   écrans et les routes que le lot 2c doit reprendre, plus trois fichiers de
//   matching que le lot 4 réécrit de toute façon. Refuser tout d'un bloc
//   rendrait le contrôle rouge en permanence, donc ignoré — et un contrôle
//   qu'on ignore ne protège de rien.
//
//   Le cliquet fait l'inverse : il fige l'existant fichier par fichier, et
//   REFUSE toute NOUVELLE occurrence. On ne peut plus en ajouter, et chaque
//   fichier repris se retire de la liste. Quand la liste est vide, le lot 2c
//   est terminé — la liste EST la checklist, et elle ne peut pas mentir.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-colonnes-supprimees.mjs           → contrôle du cliquet
//   node scripts/diag-colonnes-supprimees.mjs --reste   → ce qui reste à reprendre
//
// AUCUN accès base, AUCUN réseau.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RACINES = ['app', 'lib', 'components']

/**
 * DETTE CONNUE, figée fichier par fichier. Chaque entrée est un fichier que le
 * lot 2c doit reprendre, avec le nombre d'occurrences constaté au moment du
 * gel. Le compte ne peut que DESCENDRE : une occurrence de plus fait échouer.
 *
 * Retirer une entrée quand son fichier est repris. Ne JAMAIS en ajouter :
 * l'ajout signifierait qu'on vient d'écrire du code contre un schéma qui
 * n'existe plus.
 */
const DETTE = {
  // ── Écrans et routes à reprendre (lot 2c) ────────────────────────────────
  'app/api/admin/get-branch/[id]/route.ts': 4,
  'app/api/admin/delete-speciality/route.ts': 2,
  'app/api/candidatures/route.ts': 2,
  'app/api/me/candidatures/route.ts': 2,
  'app/api/me/conversations/route.ts': 2,
  'app/api/me/missions/route.ts': 2,
  'app/api/me/missions/[id]/route.ts': 2,
  'app/api/profile/cv-status/[jobId]/route.ts': 2,
  'app/api/publications/[id]/route.ts': 2,
  'app/[locale]/dashboard/freelance/mon-profil/page.tsx': 2,
  'lib/candidature-org-dto.ts': 2,
  'lib/hooks/useCdiProfile.ts': 2,
  'app/api/admin/get-expert/[id]/route.ts': 1,
  'app/api/admin/list-experts/route.ts': 1,
  'app/api/publications/[id]/publish/route.ts': 1,
  'app/[locale]/dashboard/freelance/page.tsx': 1,

  // ── Code RÉÉCRIT au lot 4 : ne pas le reprendre ─────────────────────────
  //  Claude sort du matching. index.ts, run-for-expert.ts et shared.ts sont
  //  réécrits de bout en bout (filtres SQL + reranking) ; leurs chaînes de
  //  select seront refaites à cette occasion. Les corriger aujourd'hui serait
  //  du travail jeté.
  //
  //  CONSÉQUENCE ASSUMÉE : le matching est INOPÉRANT jusqu'au lot 4 — ses
  //  requêtes citent des colonnes supprimées. Ce n'est pas une régression de
  //  ce lot-ci, c'est l'état depuis la migration, et c'est délibéré.
  'lib/matching/run-for-expert.ts': 3,
  'lib/matching/index.ts': 2,
  'lib/matching/shared.ts': 1,
}

const fichiers = []
const parcourir = (d) => {
  for (const e of readdirSync(d)) {
    if (e === 'node_modules' || e === '.next') continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) parcourir(p)
    else if (/\.(ts|tsx)$/.test(e)) fichiers.push(p)
  }
}
for (const r of RACINES) parcourir(join(ROOT, r))

/**
 * On ne regarde QUE les littéraux de chaîne : le reste est typé, donc déjà
 * couvert par tsc. Les commentaires sont ignorés — documenter la colonne
 * supprimée doit rester possible, c'est même souhaitable.
 *
 * DEUX RAFFINEMENTS, et ils comptent : un cliquet qui crie à tort finit par
 * être ignoré, ce qui le rend pire qu'absent.
 *
 *  ① L'INTERPOLATION D'UN GABARIT N'EST PAS UNE CHAÎNE. Dans
 *     `- Séniorité : ${sanitize(c.seniority, 50)}`, le `c.seniority` est un
 *     accès de PROPRIÉTÉ, typé, donc déjà couvert par tsc. Le retenir ici
 *     doublonnerait le compilateur et masquerait les vraies occurrences.
 *
 *  ② UNE CHAÎNE N'EST PAS UNE COLONNE PARCE QU'ELLE EN PORTE LE NOM. Dans
 *     `chips.push({ key: 'seniority' })`, c'est une clé d'affichage. On ne
 *     retient donc que deux formes : une chaîne passée à un filtre PostgREST
 *     (.select/.eq/.in/.order/.neq/.not/.is/.gt/.lt), ou une LISTE de colonnes
 *     — au moins deux identifiants en minuscules séparés par des virgules.
 */
const APPELS_POSTGREST = /\.(select|eq|neq|in|order|not|is|gt|gte|lt|lte|filter|match)\s*\(/

function chainesDe(ligne) {
  const out = []
  // Gabarits : on retire les ${…} avant de regarder le texte.
  for (const m of ligne.matchAll(/`([^`]*)`/g)) out.push(m[1].replace(/\$\{[^}]*\}/g, ' '))
  for (const m of ligne.matchAll(/'([^']*)'/g)) out.push(m[1])
  for (const m of ligne.matchAll(/"([^"]*)"/g)) out.push(m[1])
  return out
}

/** Une liste de colonnes : au moins deux identifiants snake_case virgulés. */
const estListeDeColonnes = (c) =>
  /^[\s(]*[a-z][a-z0-9_]*\s*(\([^)]*\))?\s*(,\s*[a-z][a-z0-9_]*\s*(\([^)]*\))?\s*)+,?\s*$/.test(c)

/**
 * Quatrième forme, trouvée par un second faux négatif : certaines routes
 * listent leurs colonnes UNE PAR LIGNE —
 *
 *     'title',
 *     'summary',
 *     'seniority',
 *
 * Chaque ligne ne porte alors qu'un mot, et la règle « trois sur la même
 * ligne » les laissait toutes passer. Trois lignes CONSÉCUTIVES ne portant
 * chacune qu'un identifiant snake_case ne sont pas un hasard non plus.
 *
 * Rend l'ensemble des numéros de ligne appartenant à une telle suite.
 */
function lignesDeListeVerticale(lignes) {
  const seule = (l) => /^'[a-z][a-z0-9_]*',?$/.test(l.trim())
  const dedans = new Set()
  let debut = -1
  for (let i = 0; i <= lignes.length; i++) {
    if (i < lignes.length && seule(lignes[i])) {
      if (debut === -1) debut = i
    } else {
      if (debut !== -1 && i - debut >= 3) {
        for (let k = debut; k < i; k++) dedans.add(k)
      }
      debut = -1
    }
  }
  return dedans
}

function occurrencesDe(src) {
  const trouvees = []
  const lignes = src.split('\n')
  const verticales = lignesDeListeVerticale(lignes)
  lignes.forEach((ligne, i) => {
    const t = ligne.trim()
    if (t.startsWith('//') || t.startsWith('*')) return
    const chaines = chainesDe(ligne)
    if (chaines.length === 0) return

    // Troisième forme, trouvée par un faux NÉGATIF : certains écrans listent
    // leurs colonnes en TABLEAU — ['id', 'title', 'seniority', …] — assemblé
    // plus loin. Chaque élément est alors un mot isolé, sans appel PostgREST
    // sur la ligne : les deux règles précédentes le laissaient passer.
    // Trois identifiants snake_case nus sur une même ligne ne sont pas un
    // hasard : c'est une liste de colonnes.
    const nus = chaines.filter((c) => /^[a-z][a-z0-9_]*$/.test(c))
    const contexteRequete = APPELS_POSTGREST.test(ligne) || nus.length >= 3 || verticales.has(i)

    for (const c of chaines) {
      const pertinent = contexteRequete || estListeDeColonnes(c)
      if (!pertinent) continue

      if (/\bspeciality_id\b/.test(c)) trouvees.push({ l: i + 1, nom: 'speciality_id', t })
      if (/\bseniority\b/.test(c)) trouvees.push({ l: i + 1, nom: 'seniority', t })
      // `location` est un cas à part : profiles.location et
      // profile_educations.location EXISTENT toujours. Seule
      // publications.location a été renommée — on ne signale donc que les
      // chaînes qui citent aussi une colonne exclusive aux publications.
      if (/\blocation\b/.test(c)
        && /(skills_required|work_mode|budget_min|confidential|start_date)/.test(c)) {
        trouvees.push({ l: i + 1, nom: 'location (publications)', t })
      }
    }
  })
  return trouvees
}

const constate = new Map()
const detail = new Map()
for (const f of fichiers) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  const occ = occurrencesDe(readFileSync(f, 'utf8'))
  if (occ.length > 0) { constate.set(rel, occ.length); detail.set(rel, occ) }
}

// ── Mode « ce qui reste » ────────────────────────────────────────────────
if (process.argv.includes('--reste')) {
  const total = [...constate.values()].reduce((a, b) => a + b, 0)
  console.log(`\n${constate.size} fichier(s), ${total} occurrence(s) à reprendre :\n`)
  for (const [f, n] of [...constate.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${f}`)
    for (const o of detail.get(f)) console.log(`       ${o.l}: [${o.nom}] ${o.t.slice(0, 100)}`)
  }
  console.log()
  process.exit(0)
}

// ── Contrôle du cliquet ──────────────────────────────────────────────────
let echecs = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}

console.log('\n═══ CLIQUET — colonnes supprimées citées dans des chaînes ═══\n')

for (const [f, n] of constate) {
  const gele = DETTE[f]
  if (gele === undefined) {
    ok(false, `${f} — ${n} occurrence(s)`,
      'FICHIER NOUVEAU dans la dette : du code vient d\'être écrit contre un schéma supprimé')
  } else if (n > gele) {
    ok(false, `${f} — ${n} occurrence(s), gelé à ${gele}`,
      'la dette AUGMENTE sur ce fichier')
  }
}

for (const [f, gele] of Object.entries(DETTE)) {
  const n = constate.get(f) ?? 0
  if (n === 0) {
    console.log(`  ok   ${f} — REPRIS, à retirer de la dette`)
  } else if (n < gele) {
    console.log(`  ok   ${f} — ${n} / ${gele}, la dette descend`)
  }
}

const total = [...constate.values()].reduce((a, b) => a + b, 0)
const totalGele = Object.values(DETTE).reduce((a, b) => a + b, 0)
console.log(`\n  dette : ${total} occurrence(s) sur ${constate.size} fichier(s) (gel : ${totalGele})`)

if (echecs === 0) {
  console.log(
    total === 0
      ? '\n✅ Plus aucune colonne supprimée citée — le lot 2c est terminé.\n'
      : '\n✅ Cliquet respecté : aucune occurrence nouvelle. `--reste` liste ce qui reste.\n',
  )
} else {
  console.log(`\n❌ ${echecs} régression(s) : du code cite une colonne qui n'existe plus.\n`)
}
process.exit(echecs === 0 ? 0 : 1)
