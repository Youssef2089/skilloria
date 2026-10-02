/**
 * diag-zones-recoupement.mjs — LE FILTRE DES ZONES, DANS LES DEUX SENS, ET SA PREUVE (lot zones de travail, 02/10/2026 —
 * point 5, méthode validée par Youssef).
 *
 * LA RÈGLE (tranchée en septembre, inchangée) : les zones de travail sont le SEUL critère géographique du matching. Elles
 * filtrent AVANT l'IA, dans les deux sens, par recoupement sur les codes pays APLATIS. Un continent entier compte pour
 * tous ses pays : une annonce « Europe » touche un expert « France », et l'inverse.
 *
 * LA RÈGLE DU VIDE (relecture du 02/10/2026 — décision de Youssef, pour les zones seulement) : une liste de pays VIDE ne
 * retient PERSONNE, dans les deux sens — elle remplace « vide = aucune contrainte » de septembre, devenue fausse depuis
 * que les zones sont obligatoires pour publier (une liste ne se vide plus que par la désactivation de ses pays).
 *
 * CE QU'IL VÉRIFIE :
 *   A. LE MOTEUR, TEL QU'IL EST : les deux sens posent le prédicat `.overlaps('work_zone_countries', <l'autre côté>)` —
 *      lib/matching/pool.ts (annonce → experts) et lib/matching/run-for-expert.ts (expert → annonces), hors commentaires ;
 *   B. LE TEST DE BASE EMPLOIE CE PRÉDICAT, TEL QUEL : `work_zone_countries && (… work_zone_countries …)` dans les deux
 *      sens (supabase/tests/database/matching/zones_recoupement.test.sql) — si le moteur ou le test change de forme,
 *      l'un des deux rougit ;
 *   C. CHAQUE CAS DU TEST ÉCHOUE SANS LE FILTRE : les cas sont REJOUÉS ici, sur les mêmes zones, avec l'aplatissement
 *      miroir (lib/work-zones.ts, `expandToCountryCodes`) — avec le filtre, l'ensemble attendu ; SANS le filtre, un
 *      ensemble DIFFÉRENT (le témoin y entre). Un cas qui passerait sans filtre ne prouverait rien.
 *
 * CE QU'IL NE VOIT PAS : la base elle-même — le déclencheur, l'aplatissement SQL et le recalcul ne tournent que dans
 * `npx supabase test db --local` (10 assertions). Ici, la LOGIQUE des cas et la FORME du prédicat.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
// §E.7 : un commentaire ne prouve rien.
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

let Z
try {
  Z = await import(pathToFileURL(join(ROOT, 'lib/work-zones.ts')).href)
} catch (err) {
  console.error('✘ lib/work-zones.ts ne se charge pas — le contrôle ne tourne pas', err)
  process.exit(2)
}

// ══════════════════════════════════════════════════════════════════════════
section('A. Le moteur pose le recoupement des zones, dans les deux sens')
// ══════════════════════════════════════════════════════════════════════════
const pool = sansCommentaires(lire('lib/matching/pool.ts'))
const expert = sansCommentaires(lire('lib/matching/run-for-expert.ts'))
ok(/if \(annonce\.work_zone_countries\.length === 0\) return vide\n/.test(pool) && /\n\s*q = q\.overlaps\('work_zone_countries', annonce\.work_zone_countries\)/.test(pool)
   && !/if \(annonce\.work_zone_countries\.length > 0\)/.test(pool)
   && pool.indexOf('if (annonce.work_zone_countries.length === 0) return vide') < pool.indexOf(".from('matches')"),
  'annonce → experts (pool.ts) : une annonce SANS pays ne retient personne (avant toute requête) ; sinon `overlaps(…)`, SANS condition')
ok(/const paysExpert = p\.work_zone_countries \?\? \[\]/.test(expert) && /\n\s*q = q\.overlaps\('work_zone_countries', paysExpert\)/.test(expert)
   && /paysExpert\.length === 0 \? \{ data: \[\] as unknown\[\], error: null \} : await q/.test(expert)
   && !/work_zone_countries \?\? \[\]\)\.length > 0/.test(expert),
  'expert → annonces (run-for-expert.ts) : un expert SANS pays ne voit aucune annonce (sans requête) ; sinon `overlaps(…)`, SANS condition')
ok(/'seniorities, work_zone_countries, created_by, status'/.test(expert) && /work_zone_countries: pub\.work_zone_countries \?\? \[\]/.test(sansCommentaires(lire('lib/matching/index.ts'))),
  'les deux sens lisent la liste APLATIE (work_zone_countries), jamais les identifiants de zone')

// ══════════════════════════════════════════════════════════════════════════
section('B. Le test de base emploie ce prédicat, tel quel')
// ══════════════════════════════════════════════════════════════════════════
const TEST = 'supabase/tests/database/matching/zones_recoupement.test.sql'
const test = sansCommentairesSql(lire(TEST))
ok(/when cardinality\(\(select a\.work_zone_countries from public\.publications a where a\.id = p_annonce\)\) = 0 then '\{\}'::uuid\[\]/.test(test)
   && /p\.work_zone_countries && \(select a\.work_zone_countries from public\.publications a where a\.id = p_annonce\)/.test(test),
  'sens annonce → experts, LE CHEMIN DU MOTEUR : liste vide → personne, sinon `profiles.work_zone_countries && publications.work_zone_countries`')
ok(/when cardinality\(\(select p\.work_zone_countries from public\.profiles p where p\.id = p_profil\)\) = 0 then '\{\}'::uuid\[\]/.test(test)
   && /a\.work_zone_countries && \(select p\.work_zone_countries from public\.profiles p where p\.id = p_profil\)/.test(test),
  'sens expert → annonces, LE CHEMIN DU MOTEUR : liste vide → personne, sinon `publications.work_zone_countries && profiles.work_zone_countries`')
ok(!/update public\.(profiles|publications) set work_zone_countries/.test(test),
  'le test n’écrit JAMAIS la liste aplatie : la base la calcule (le chemin normal)')
const plan = Number(/select plan\((\d+)\)/.exec(test)?.[1] ?? 0)
const assertions = (test.match(/return next (is|ok)\(/g) ?? []).length
ok(plan === assertions && plan === 11, `le plan annonce exactement ses assertions (${plan} / ${assertions})`)

// ══════════════════════════════════════════════════════════════════════════
section('C. Chaque cas, rejoué : retenu avec le filtre, différent sans lui')
// ══════════════════════════════════════════════════════════════════════════
// Les zones du test : le monde, deux continents, leurs pays, et le pays AJOUTÉ à l'Europe après coup.
const zonesAvant = [
  { id: 'W', parent_id: null, kind: 'world', code: 'WORLD', country_code: null, name: 'Monde entier', slug: 'w' },
  { id: 'EU', parent_id: 'W', kind: 'continent', code: 'EU', country_code: null, name: 'Europe', slug: 'eu' },
  { id: 'AF', parent_id: 'W', kind: 'continent', code: 'AF', country_code: null, name: 'Afrique', slug: 'af' },
  { id: 'FR', parent_id: 'EU', kind: 'country', code: 'C_FR', country_code: 'FR', name: 'France', slug: 'fr' },
  { id: 'MA', parent_id: 'AF', kind: 'country', code: 'C_MA', country_code: 'MA', name: 'Maroc', slug: 'ma' },
]
const zonesApres = [...zonesAvant, { id: 'QZ', parent_id: 'EU', kind: 'country', code: 'C_QZ', country_code: 'QZ', name: 'Sondeland', slug: 'qz' }]
const pays = (zones, choix) => Z.expandToCountryCodes(zones, choix)
const recoupe = (a, b) => a.some((x) => b.includes(x))
/**
 * Le moteur, rejoué : `regle` = 'neuve' (liste vide → personne, puis le recoupement), 'ancienne' (septembre : liste vide →
 * filtre sauté), 'sans_filtre' (aucun recoupement).
 */
const moteur = (paysAutre, paysCandidat, regle) => {
  if (regle === 'sans_filtre') return true
  if (paysAutre.length === 0) return regle === 'ancienne'
  return recoupe(paysCandidat, paysAutre)
}
const regleDe = (f) => (f === true ? 'neuve' : f === false ? 'sans_filtre' : f)
const choixExperts = { europe: ['EU'], maroc: ['MA'], france: ['FR'], partout: ['W'], expert_qz: ['QZ'] }
const choixAnnonces = { a_france: ['FR'], a_europe: ['EU'], a_maroc: ['MA'], a_qz: ['QZ'] }
/** Le sens annonce → experts : avec le filtre (le prédicat), ou sans. */
const experts = (zones, annonce, parmi, filtre = true) =>
  parmi.filter((e) => moteur(pays(zones, choixAnnonces[annonce]), pays(zones, choixExperts[e]), regleDe(filtre))).sort()
const annonces = (zones, expertE, parmi, filtre = true) =>
  parmi.filter((a) => moteur(pays(zones, choixExperts[expertE]), pays(zones, choixAnnonces[a]), regleDe(filtre))).sort()
const CAS = [
  ['1. annonce en France : « Europe — tout le continent » retenu, « Maroc » écarté', (f) => experts(zonesAvant, 'a_france', ['europe', 'maroc'], f), ['europe']],
  ['2. annonce en France : « Maroc » seul écarté, « France » retenu', (f) => experts(zonesAvant, 'a_france', ['maroc', 'france'], f), ['france']],
  ['3a. annonce « Europe — tout le continent » → « France » retenu', (f) => experts(zonesAvant, 'a_europe', ['france', 'maroc'], f), ['france']],
  ['3b. expert « France » → annonce « Europe — tout le continent » retenue', (f) => annonces(zonesAvant, 'france', ['a_europe', 'a_maroc'], f), ['a_europe']],
  ['4b. pays ajouté à l’Europe : couvert pour « Europe — tout le continent » et « Partout »', (f) => experts(zonesApres, 'a_qz', ['europe', 'partout', 'france', 'maroc'], f), ['europe', 'partout']],
  ['4c. expert du pays ajouté → l’annonce « Europe — tout le continent » seulement', (f) => annonces(zonesApres, 'expert_qz', ['a_europe', 'a_maroc', 'a_france'], f), ['a_europe']],
]
for (const [nom, cas, attendu] of CAS) {
  const avec = cas(true).join(',')
  const sans = cas(false).join(',')
  ok(avec === [...attendu].sort().join(',') && sans !== avec, `${nom} — et SANS le filtre il échoue (${sans})`,
    `avec : ${avec} (attendu ${attendu.join(',')}) ; sans : ${sans}`)
}
// ⑥ — le pays ajouté puis DÉSACTIVÉ : il sort du référentiel servi à l'aplatissement (zonesAvant n'a pas « QZ »).
for (const [nom, cas] of [
  ['6b. annonce dont le seul pays est désactivé : personne', (f) => experts(zonesAvant, 'a_qz', ['europe', 'partout'], f)],
  ['6c. expert dont le seul pays est désactivé : aucune annonce', (f) => annonces(zonesAvant, 'expert_qz', ['a_europe', 'a_maroc', 'a_france'], f)],
]) {
  const neuve = cas('neuve').join(',')
  const ancienne = cas('ancienne').join(',')
  ok(neuve === '' && ancienne !== '', `${nom} — et la règle de septembre (« vide = aucune contrainte ») échouerait (${ancienne})`,
    `règle neuve : ${neuve || '∅'} ; ancienne : ${ancienne || '∅'}`)
}
ok(pays(zonesAvant, ['EU']).includes('QZ') === false && pays(zonesApres, ['EU']).includes('QZ') && pays(zonesApres, ['W']).includes('QZ'),
  '4a. le continent entier et le monde couvrent le pays ajouté APRÈS (le choix enregistré est le continent, pas ses pays)')

console.log(echecs === 0 ? '\n✅ diag-zones-recoupement : tout est vert.' : `\n❌ diag-zones-recoupement : ${echecs} contrôle(s) rouge(s).`)
process.exit(echecs === 0 ? 0 : 1)
