/**
 * diag-specialites-recoupement.mjs — LES SPÉCIALITÉS FILTRENT LA MISE EN RELATION, DANS LES DEUX SENS, ET LA PREUVE
 * (lot « critères des annonces », 03/10/2026 — point 1, §D.39 ; la méthode des zones, validée par Youssef le 02/10/2026).
 *
 * LA RÈGLE : la spécialité est obligatoire sur l'annonce d'une organisation et sur le besoin de sous-traitance (au moins
 * une, ou « Autre (préciser) »), avec les valeurs de l'expert. Elle FILTRE avant l'IA, dans les deux sens : une annonce
 * qui déclare des spécialités ne retient que les experts qui en possèdent au moins une ; un expert ne voit que les
 * annonces dont il possède une spécialité exigée. Un ensemble VIDE côté annonce (« Autre » seul, ou une annonce publiée
 * avant ce lot) = aucune contrainte sur cet axe (§D.38 : la règle « vide = personne » ne vaut que pour les zones).
 *
 * CE QU'IL VÉRIFIE :
 *   A. LE MOTEUR, TEL QU'IL EST : annonce → experts, `lib/matching/pool.ts` pose
 *      `if (annonce.speciality_ids.length > 0) q = q.overlaps('speciality_ids', annonce.speciality_ids)` sur la requête
 *      du vivier ; expert → annonces, `lib/matching/run-for-expert.ts` lit `speciality_ids` des annonces et les retient
 *      par `annonceRetenuePourExpert` (lib/matching/recoupement.ts) — hors commentaires ;
 *   B. LE TEST DE BASE EMPLOIE CE CHEMIN, TEL QUEL (supabase/tests/database/matching/specialites_recoupement.test.sql) :
 *      `cardinality(annonce) = 0 or profiles.speciality_ids && annonce` et l'inverse ; il n'écrit que par les chemins
 *      normaux et compte ses assertions ;
 *   C. LE PRÉDICAT EN MÉMOIRE DU MOTEUR, EXÉCUTÉ (lib/matching/recoupement.ts importé tel quel) sur les cas du test :
 *      avec lui, l'ensemble attendu ; SANS le filtre, un ensemble DIFFÉRENT (le témoin y entre) ; et la règle « vide =
 *      personne » (celle des zones) donnerait un autre ensemble pour l'annonce « Autre » seule.
 *
 * CE QU'IL NE VOIT PAS : la base elle-même — `npx supabase test db --local` fait tourner le test (8 assertions).
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
section('A. Le moteur filtre les spécialités, dans les deux sens')
// ══════════════════════════════════════════════════════════════════════════
const pool = sansCommentaires(lire('lib/matching/pool.ts'))
const expert = sansCommentaires(lire('lib/matching/run-for-expert.ts'))
const recoupementSrc = sansCommentaires(lire('lib/matching/recoupement.ts'))
ok(/\n\s*if \(annonce\.speciality_ids\.length > 0\) q = q\.overlaps\('speciality_ids', annonce\.speciality_ids\)/.test(pool)
   && pool.indexOf("q.overlaps('speciality_ids'") < pool.indexOf('return q\n'),
  'annonce → experts (pool.ts) : `overlaps(speciality_ids, annonce)` sur la requête du vivier, posé dès que l’annonce en déclare')
ok(/'id, type, title, description, skills_required, branch_id, speciality_ids, '/.test(expert)
   && /import \{ annonceRetenuePourExpert \} from '\.\/recoupement'/.test(expert)
   && /\(a\) => !tranchees\.has\(a\.id\) && annonceRetenuePourExpert\(a, p\)/.test(expert),
  'expert → annonces (run-for-expert.ts) : les spécialités des annonces sont LUES, et chaque annonce passe par annonceRetenuePourExpert')
ok(/recoupe\(annonce\.speciality_ids, new Set\(expert\.speciality_ids \?\? \[\]\)\)/.test(recoupementSrc)
   && /return e\.length === 0 \|\| e\.some\(\(x\) => possedees\.has\(x\)\)/.test(recoupementSrc),
  'le prédicat en mémoire : vide côté annonce = aucune contrainte, sinon au moins une spécialité en commun')
{
  const index = sansCommentaires(lire('lib/matching/index.ts'))
  ok(/'id, domain_id, organization_id, type, created_by, title, description, branch_id, speciality_ids, '/.test(index)
     && /speciality_ids: pub\.speciality_ids \?\? \[\]/.test(index),
    'le sens annonce → experts reçoit les spécialités de l’annonce (lib/matching/index.ts)')
}

// ══════════════════════════════════════════════════════════════════════════
section('B. Le test de base emploie ce chemin, tel quel')
// ══════════════════════════════════════════════════════════════════════════
const TEST = 'supabase/tests/database/matching/specialites_recoupement.test.sql'
const test = sansCommentairesSql(lire(TEST))
ok(/cardinality\(\(select a\.speciality_ids from public\.publications a where a\.id = p_annonce\)\) = 0\s*or p\.speciality_ids && \(select a\.speciality_ids from public\.publications a where a\.id = p_annonce\)/.test(test),
  'sens annonce → experts : `cardinality(annonce) = 0 or profiles.speciality_ids && publications.speciality_ids`')
ok(/cardinality\(a\.speciality_ids\) = 0\s*or a\.speciality_ids && \(select p\.speciality_ids from public\.profiles p where p\.id = p_profil\)/.test(test),
  'sens expert → annonces : `cardinality(annonce) = 0 or publications.speciality_ids && profiles.speciality_ids`')
ok(/insert into public\.specialities \(branch_id, domain_id, name, slug, active, sort_order\)/.test(test) && /pg_temp\.fab_profil\(/.test(test) && /pg_temp\.fab_brouillon\(/.test(test),
  'les spécialités sont des lignes du référentiel ; experts et annonces naissent par les chemins normaux (fabriques)')
const plan = Number(/select plan\((\d+)\)/.exec(test)?.[1] ?? 0)
const assertions = (test.match(/return next (is|ok)\(/g) ?? []).length
ok(plan === assertions && plan === 8, `le plan annonce exactement ses assertions (${plan} / ${assertions})`)

// ══════════════════════════════════════════════════════════════════════════
section('C. Le prédicat du moteur, EXÉCUTÉ sur les cas du test : retenu avec le filtre, différent sans lui')
// ══════════════════════════════════════════════════════════════════════════
const EXPERTS = { e_a: ['A'], e_b: ['B'], e_ab: ['A', 'B'], e_autre: [] }
const ANNONCES = { a_a: ['A'], a_ac: ['A', 'C'], a_b: ['B'], a_autre: [] }
/** regle : 'moteur' (le prédicat réel) · 'sans_filtre' · 'vide_personne' (la règle des zones, appliquée à tort). */
const retenu = (exigees, possedees, regle) => {
  if (regle === 'sans_filtre') return true
  if (regle === 'vide_personne' && exigees.length === 0) return false
  return R.annonceRetenuePourExpert({ speciality_ids: exigees, seniorities: [] }, { speciality_ids: possedees, seniorities: [] })
}
// Le sens annonce → experts : la requête du vivier pose overlaps seulement si l'annonce déclare — le même prédicat.
const experts = (a, parmi, regle = 'moteur') => parmi.filter((e) => retenu(ANNONCES[a], EXPERTS[e], regle)).sort()
const annonces = (e, parmi, regle = 'moteur') => parmi.filter((a) => retenu(ANNONCES[a], EXPERTS[e], regle)).sort()
const CAS = [
  ['1. annonce « A » : A et A+B retenus, B (témoin) et « Autre » écartés', (r) => experts('a_a', ['e_a', 'e_b', 'e_ab', 'e_autre'], r), ['e_a', 'e_ab']],
  ['2. besoin « A ou C » : A retenu, B (témoin) écarté', (r) => experts('a_ac', ['e_a', 'e_b'], r), ['e_a']],
  ['3. offre « B » : B et A+B retenus, A (témoin) écarté', (r) => experts('a_b', ['e_a', 'e_b', 'e_ab'], r), ['e_ab', 'e_b']],
  ['5. expert A : « A », « A ou C », « Autre » retenues, « B » (témoin) écartée', (r) => annonces('e_a', ['a_a', 'a_ac', 'a_b', 'a_autre'], r), ['a_a', 'a_ac', 'a_autre']],
  ['6. expert B : « B » et « Autre » retenues, « A » et « A ou C » écartées', (r) => annonces('e_b', ['a_a', 'a_ac', 'a_b', 'a_autre'], r), ['a_autre', 'a_b']],
  ['7. expert « Autre » seul : l’annonce « Autre » seule', (r) => annonces('e_autre', ['a_a', 'a_b', 'a_autre'], r), ['a_autre']],
]
for (const [nom, cas, attendu] of CAS) {
  const avec = cas('moteur').join(',')
  const sans = cas('sans_filtre').join(',')
  ok(avec === [...attendu].sort().join(',') && sans !== avec, `${nom} — et SANS le filtre il échoue (${sans})`,
    `avec : ${avec} (attendu ${attendu.join(',')}) ; sans : ${sans}`)
}
{
  const avec = experts('a_autre', ['e_a', 'e_b', 'e_autre']).join(',')
  const zones = experts('a_autre', ['e_a', 'e_b', 'e_autre'], 'vide_personne').join(',')
  ok(avec === 'e_a,e_autre,e_b' && zones === '',
    `4. annonce « Autre » seule : aucune contrainte de spécialité (${avec}) — la règle des zones (« vide = personne ») n’y vaut pas (${zones || '∅'})`)
}

console.log(echecs === 0 ? '\n✅ diag-specialites-recoupement : tout est vert.' : `\n❌ diag-specialites-recoupement : ${echecs} contrôle(s) rouge(s).`)
process.exit(echecs === 0 ? 0 : 1)
