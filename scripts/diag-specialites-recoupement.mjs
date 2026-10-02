/**
 * diag-specialites-recoupement.mjs — LES SPÉCIALITÉS FILTRENT LA MISE EN RELATION, DANS LES DEUX SENS, PAR LA MÊME RÈGLE,
 * ET LA PREUVE (lot « critères des annonces », 03/10/2026, §D.39 ; la règle symétrique « Autre » décidée par Youssef à la
 * relecture de l'ARRÊT 28).
 *
 * LA RÈGLE : un ensemble de spécialités VIDE d'un côté OU de l'autre — l'annonce qui n'a que « Autre (préciser) », comme
 * l'EXPERT dont la seule spécialité est « Autre » — ne contraint pas ; l'IA juge sur le texte. Sinon, au moins une
 * spécialité en commun. (§D.38 : la règle « vide = personne » ne vaut que pour les zones.)
 *
 * CE QU'IL VÉRIFIE :
 *   A. LE MOTEUR, TEL QU'IL EST : annonce → experts, `lib/matching/pool.ts` pose sur la requête du vivier
 *      `q.or('speciality_ids.eq.{},speciality_ids.ov.{…}')` dès que l'annonce déclare ; expert → annonces,
 *      `lib/matching/run-for-expert.ts` retient chaque annonce par `annonceRetenuePourExpert`, qui passe par
 *      `specialitesCompatibles` (lib/matching/recoupement.ts) — hors commentaires ;
 *   B. LE TEST DE BASE SUIT LE CHEMIN DE LA BASE, ET LUI SEUL (supabase/tests/database/matching/
 *      specialites_recoupement.test.sql) : la traduction SQL exacte du `.or()` du vivier ; il ne RÉÉCRIT PAS le sens en
 *      mémoire (la version précédente le faisait, relevé à la relecture de l'ARRÊT 28) ; il compte ses assertions ;
 *   C. LE PRÉDICAT EN MÉMOIRE DU MOTEUR, EXÉCUTÉ (lib/matching/recoupement.ts importé tel quel) sur les cas des deux
 *      sens : avec lui, l'ensemble attendu ; et chaque cas diffère SOIT sans le filtre (le témoin y entre), SOIT sous
 *      l'ancienne règle (vide côté annonce seulement), SOIT sous la règle des zones (« vide = personne ») ;
 *   D. LA RÈGLE DU VIVIER ET CELLE DE LA MÉMOIRE SONT LA MÊME : la traduction du `.or()` du vivier, exécutée en JS sur
 *      tous les couples, rend exactement `specialitesCompatibles`.
 *
 * CE QU'IL NE VOIT PAS : la base elle-même — `npx supabase test db --local` fait tourner le test (6 assertions).
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansCommentaires = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/ .*$/, ''))).join('\n')
const sansCommentairesSql = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (t) => console.log(`\n── ${t}`)

let R
try {
  R = await import(pathToFileURL(join(ROOT, 'lib/matching/recoupement.ts')).href)
} catch (err) {
  console.error('✘ lib/matching/recoupement.ts ne se charge pas — le contrôle ne tourne pas', err)
  process.exit(2)
}

// ══════════════════════════════════════════════════════════════════════════
section('A. Le moteur filtre les spécialités, dans les deux sens, par la même règle')
// ══════════════════════════════════════════════════════════════════════════
const pool = sansCommentaires(lire('lib/matching/pool.ts'))
const expert = sansCommentaires(lire('lib/matching/run-for-expert.ts'))
const recoupementSrc = sansCommentaires(lire('lib/matching/recoupement.ts'))
ok(/if \(annonce\.speciality_ids\.length > 0\) \{\s*q = q\.or\(`speciality_ids\.eq\.\{\},speciality_ids\.ov\.\{\$\{annonce\.speciality_ids\.join\(','\)\}\}`\)\s*\}/.test(pool)
   && !/q\.overlaps\('speciality_ids'/.test(pool),
  'annonce → experts (pool.ts) : `.or(speciality_ids.eq.{}, speciality_ids.ov.{annonce})` sur la requête du vivier, dès que l’annonce en déclare')
ok((pool.match(/q = q\.or\(|return q\.or\(/g) ?? []).length === 2,
  'pool.ts : un seul `.or()` sur la requête du vivier, en plus de celui de la règle d’éligibilité (aucun « toujours » n’en pose)')
ok(/'id, type, title, description, skills_required, branch_id, speciality_ids, '/.test(expert)
   && /import \{ annonceRetenuePourExpert \} from '\.\/recoupement'/.test(expert)
   && /\(a\) => !tranchees\.has\(a\.id\) && annonceRetenuePourExpert\(a, p\)/.test(expert),
  'expert → annonces (run-for-expert.ts) : les spécialités des annonces sont LUES, et chaque annonce passe par annonceRetenuePourExpert')
ok(/specialitesCompatibles\(annonce\.speciality_ids, expert\.speciality_ids\)/.test(recoupementSrc)
   && /return a\.length === 0 \|\| e\.length === 0 \|\| a\.some\(\(x\) => e\.includes\(x\)\)/.test(recoupementSrc),
  'le prédicat en mémoire : vide côté annonce OU côté expert = aucune contrainte, sinon au moins une spécialité en commun')
{
  const index = sansCommentaires(lire('lib/matching/index.ts'))
  ok(/'id, domain_id, organization_id, type, created_by, title, description, branch_id, speciality_ids, '/.test(index)
     && /speciality_ids: pub\.speciality_ids \?\? \[\]/.test(index),
    'le sens annonce → experts reçoit les spécialités de l’annonce (lib/matching/index.ts)')
}

// ══════════════════════════════════════════════════════════════════════════
section('B. Le test de base suit le chemin de la base — et ne réécrit pas le sens en mémoire')
// ══════════════════════════════════════════════════════════════════════════
const TEST = 'supabase/tests/database/matching/specialites_recoupement.test.sql'
const test = sansCommentairesSql(lire(TEST))
ok(/cardinality\(\(select a\.speciality_ids from public\.publications a where a\.id = p_annonce\)\) = 0\s*or p\.speciality_ids = '\{\}'\s*or p\.speciality_ids && \(select a\.speciality_ids from public\.publications a where a\.id = p_annonce\)/.test(test),
  'sens annonce → experts : `cardinality(annonce) = 0 or profiles.speciality_ids = {} or profiles.speciality_ids && annonce` — le `.or()` du vivier')
ok(!/annonces_retenues|from public\.publications a\s+where a\.id = any \(p_parmi\)/.test(test),
  'aucune réécriture SQL du sens expert → annonces (il vit en mémoire : C l’exécute)')
ok(/insert into public\.specialities \(branch_id, domain_id, name, slug, active, sort_order\)/.test(test) && /pg_temp\.fab_profil\(/.test(test) && /pg_temp\.fab_brouillon\(/.test(test),
  'les spécialités sont des lignes du référentiel ; experts et annonces naissent par les chemins normaux (fabriques)')
const plan = Number(/select plan\((\d+)\)/.exec(test)?.[1] ?? 0)
const assertions = (test.match(/return next (is|ok)\(/g) ?? []).length
ok(plan === assertions && plan === 6, `le plan annonce exactement ses assertions (${plan} / ${assertions})`)

// ══════════════════════════════════════════════════════════════════════════
section('C. Le prédicat du moteur, EXÉCUTÉ sur les cas des deux sens')
// ══════════════════════════════════════════════════════════════════════════
const EXPERTS = { e_a: ['A'], e_b: ['B'], e_ab: ['A', 'B'], e_autre: [] }
const ANNONCES = { a_a: ['A'], a_ac: ['A', 'C'], a_b: ['B'], a_autre: [] }
/** regle : 'moteur' (le prédicat réel) · 'sans_filtre' · 'ancienne' (vide côté annonce seulement) · 'vide_personne' (zones). */
const retenu = (exigees, possedees, regle) => {
  if (regle === 'sans_filtre') return true
  if (regle === 'ancienne') return exigees.length === 0 || exigees.some((x) => possedees.includes(x))
  if (regle === 'vide_personne') return exigees.length > 0 && possedees.length > 0 && exigees.some((x) => possedees.includes(x))
  return R.annonceRetenuePourExpert({ speciality_ids: exigees, seniorities: [] }, { speciality_ids: possedees, seniorities: [] })
}
const experts = (a, parmi, regle = 'moteur') => parmi.filter((e) => retenu(ANNONCES[a], EXPERTS[e], regle)).sort()
const annonces = (e, parmi, regle = 'moteur') => parmi.filter((a) => retenu(ANNONCES[a], EXPERTS[e], regle)).sort()
const CAS = [
  ['1. annonce « A » : A, A+B et « Autre » seul retenus, B (témoin) écarté', (r) => experts('a_a', ['e_a', 'e_b', 'e_ab', 'e_autre'], r), ['e_a', 'e_ab', 'e_autre']],
  ['2. besoin « A ou C » : A retenu, B (témoin) écarté', (r) => experts('a_ac', ['e_a', 'e_b'], r), ['e_a']],
  ['3. offre « B » : B et A+B retenus, A (témoin) écarté', (r) => experts('a_b', ['e_a', 'e_b', 'e_ab'], r), ['e_ab', 'e_b']],
  ['4. offre « B » : l’expert « Autre » seul retenu, A (témoin) écarté', (r) => experts('a_b', ['e_a', 'e_autre'], r), ['e_autre']],
  ['5. annonce « Autre » seule : les trois experts', (r) => experts('a_autre', ['e_a', 'e_b', 'e_autre'], r), ['e_a', 'e_autre', 'e_b']],
  ['6. expert A : « A », « A ou C », « Autre » retenues, « B » (témoin) écartée', (r) => annonces('e_a', ['a_a', 'a_ac', 'a_b', 'a_autre'], r), ['a_a', 'a_ac', 'a_autre']],
  ['7. expert B : « B » et « Autre » retenues, « A » et « A ou C » écartées', (r) => annonces('e_b', ['a_a', 'a_ac', 'a_b', 'a_autre'], r), ['a_autre', 'a_b']],
  ['8. expert « Autre » seul : TOUTES les annonces (non contraint, décision de Youssef)', (r) => annonces('e_autre', ['a_a', 'a_b', 'a_autre'], r), ['a_a', 'a_autre', 'a_b']],
]
for (const [nom, cas, attendu] of CAS) {
  const avec = cas('moteur').join(',')
  const autres = ['sans_filtre', 'ancienne', 'vide_personne'].map((r) => [r, cas(r).join(',')])
  const differe = autres.filter(([, v]) => v !== avec).map(([r]) => r)
  ok(avec === [...attendu].sort().join(',') && differe.length > 0,
    `${nom} — et une autre règle donnerait autre chose (${differe.join(', ')})`,
    `avec : ${avec} (attendu ${attendu.join(',')}) ; ${autres.map(([r, v]) => `${r} : ${v}`).join(' ; ')}`)
}

// ══════════════════════════════════════════════════════════════════════════
section('D. Le vivier et la mémoire disent la même règle')
// ══════════════════════════════════════════════════════════════════════════
{
  // La traduction du `.or()` du vivier : posé seulement si l'annonce déclare ; alors expert vide OU recoupement.
  const vivier = (a, e) => a.length === 0 || e.length === 0 || e.some((x) => a.includes(x))
  const ensembles = [[], ['A'], ['B'], ['A', 'B'], ['C']]
  const divergences = []
  for (const a of ensembles) for (const e of ensembles) {
    if (vivier(a, e) !== R.specialitesCompatibles(a, e)) divergences.push(`annonce [${a}] × expert [${e}]`)
  }
  ok(divergences.length === 0, `les ${ensembles.length ** 2} couples : la règle du vivier et specialitesCompatibles rendent la même chose`, divergences.join(', '))
}

console.log(echecs === 0 ? '\n✅ diag-specialites-recoupement : tout est vert.' : `\n❌ diag-specialites-recoupement : ${echecs} contrôle(s) rouge(s).`)
process.exitCode = echecs === 0 ? 0 : 1
