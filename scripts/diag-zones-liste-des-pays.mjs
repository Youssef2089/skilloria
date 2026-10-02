/**
 * diag-zones-liste-des-pays.mjs — LA LISTE DES PAYS DES ZONES DE TRAVAIL (lot finitions et pays, 02/10/2026 —
 * décisions de Youssef, points 3 à 6 ; pas de régions).
 *
 * LA RÈGLE :
 *   · la liste des zones porte CHAQUE État membre et observateur de l'ONU, ISRAËL EXCEPTÉ ;
 *   · le ROYAUME-UNI y est remplacé par ses quatre pays (Angleterre, Écosse, Pays de Galles, Irlande du Nord), chacun
 *     son code (ISO 3166-2) — et il reste UN pays partout ailleurs : `countries` (adresse, organisation et sa
 *     vérification, téléphone) n'est ni lue, ni écrite, ni changée ;
 *   · les rattachements existants ne changent pas ; un pays nouveau va dans le continent de la division géographique de
 *     l'ONU (M49), l'Amérique centrale et les Caraïbes avec l'Amérique du Nord ;
 *   · une base neuve et staging aboutissent à la même liste — les 64 de départ, plus ceux-ci.
 *
 * CE QU'IL VÉRIFIE (statique, aucun accès base) :
 *   A. LA LISTE DE LA MIGRATION, contre la SOURCE écrite ici (l'ONU, par continent) : les 64 de départ
 *      (`parametrage_de_production`) plus les lignes de la migration = l'ONU, moins Israël et le Royaume-Uni, plus les
 *      quatre pays ; aucun doublon, aucun pays de départ réécrit ; chaque pays nouveau dans le continent de l'ONU ;
 *      chaque ligne a ses quatre noms, et un code de la forme que la base exige ;
 *   B. LE TEST DE BASE attend EXACTEMENT cette liste et ces comptes par continent (sinon il prouverait autre chose) ;
 *   C. LA MIGRATION : la clé vers `countries` retirée, aucune écriture de `countries`, la forme posée, les types en
 *      `text`, l'aplatissement recréé à l'identique (même signature, même corps hors types), le déclencheur de
 *      couverture reposé À L'IDENTIQUE, le remplacement fermé au navigateur, la reprise (Royaume-Uni → quatre, puis
 *      Royaume-Uni et Israël désactivés) dans son propre bloc ;
 *   D. LE MIROIR JS (`lib/work-zones.ts`, EXÉCUTÉ) aplatit un code à six caractères comme un code à deux ;
 *   E. les fabriques des tests ne prennent qu'une zone ACTIVE (sinon une annonce fabriquée tomberait, au hasard des
 *      identifiants, sur une zone retirée) ;
 *   F. la requête d'avant-push COMPTE les profils et annonces qui avaient Israël, et ceux qui avaient le Royaume-Uni.
 *
 * CE QU'IL NE VOIT PAS : la base — l'insertion, le remplacement, le recalcul et les refus ne tournent que dans
 * `npx supabase test db --local` (matching/zones_liste_des_pays, 19 assertions) ; la justesse d'une traduction.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansCommentairesSql = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (t) => console.log(`\n── ${t}`)

function migration(suffixe) {
  const f = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((x) => x.endsWith(`_${suffixe}.sql`))
  if (f.length !== 1) { console.error(`✘ migration *_${suffixe}.sql : ${f.length} correspondance(s) — le contrôle ne tourne pas`); process.exit(2) }
  return lire(`supabase/migrations/${f[0]}`)
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// LA SOURCE — les 193 États membres de l'ONU et ses deux observateurs (Saint-Siège VA, Palestine PS), par continent du
// référentiel, d'après la division géographique de l'ONU (M49) ; l'Amérique centrale et les Caraïbes avec l'Amérique du
// Nord. CHYPRE : Asie occidentale pour l'ONU, mais rattaché à l'Europe depuis l'origine — un rattachement existant ne
// change pas (décision de Youssef) : il est écrit ici en Europe. LA TURQUIE : Asie occidentale pour l'ONU, rangée en
// EUROPE par décision de Youssef (02/10/2026), et nommée « Turkey » en anglais (pas « Türkiye ») — écrite ici en Europe.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const ONU = {
  EU: 'AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MC ME NL MK NO PL PT MD RO RU SM RS SK SI ES SE CH UA GB VA TR',
  AF: 'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW',
  AS: 'KZ KG TJ TM UZ CN JP KP KR MN BN KH ID LA MY MM PH SG TH TL VN AF BD BT IN IR MV NP PK LK AM AZ BH GE IQ IL JO KW LB OM QA SA SY AE YE PS',
  NA: 'CA US BZ CR SV GT HN MX NI PA AG BS BB CU DM DO GD HT JM KN LC VC TT',
  SA: 'AR BO BR CL CO EC GY PY PE SR UY VE',
  OC: 'AU FJ KI MH FM NR NZ PW PG WS SB TO TV VU',
}
const NATIONS = ['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR']
const source = new Map(Object.entries(ONU).flatMap(([c, s]) => s.split(' ').map((p) => [p, c])))

const ML = migration('zones_liste_des_pays')
const M = sansCommentairesSql(ML)
const PROD = migration('parametrage_de_production')
const RATT = sansCommentairesSql(migration('zones_pays_rattaches'))

// ══════════════════════════════════════════════════════════════════════════
section('A. La liste de la migration, contre la source (ONU)')
// ══════════════════════════════════════════════════════════════════════════
ok(source.size === 195 && [...source.keys()].length === new Set(source.keys()).size, `la source : 193 membres + 2 observateurs (${source.size})`)
const depart = [...PROD.matchAll(/^\s*\('([A-Z]{2})', '(?:[^']|'')+', '(?:[^']|'')+', '(?:[^']|'')+', '(?:[^']|'')+', '[^']*', '\+\d+', '\w+', true, \d+\)/gm)].map((m) => m[1])
ok(depart.length === 64, `les pays de départ : 64 (parametrage_de_production) — ${depart.length}`)
const correspondance = new Map([...RATT.matchAll(/\('([A-Z]{2})','([A-Z]{2})'\)/g)].map((m) => [m[1], m[2]]))
const ecartsDepart = depart.filter((p) => correspondance.get(p) !== source.get(p))
ok(ecartsDepart.length === 0, 'les 64 de départ sont, dans la source, au continent où ils sont déjà rattachés (rien ne bouge)',
  ecartsDepart.map((p) => `${p} : rattaché ${correspondance.get(p)}, source ${source.get(p)}`).join(' · '))

const blocListe = /with liste\(country_code, continent_code, fr, en, es, de\) as \(values([\s\S]*?)\n\s*\),\n\s*ajoutes as/.exec(M)?.[1] ?? ''
const LIGNE = /\('([A-Z]{2}(?:-[A-Z]{3})?)', '([A-Z]{2})', '((?:[^']|'')+)', '((?:[^']|'')+)', '((?:[^']|'')+)', '((?:[^']|'')+)'\)/g
const lignes = [...blocListe.matchAll(LIGNE)].map((m) => ({ code: m[1], continent: m[2], noms: m.slice(3, 7) }))
const lignesBrutes = blocListe.split('\n').filter((l) => /^\s*\(/.test(l)).length
ok(lignes.length > 0 && lignes.length === lignesBrutes, `chaque ligne de la liste se lit (${lignes.length} sur ${lignesBrutes})`)
const codes = lignes.map((l) => l.code)
ok(new Set(codes).size === codes.length, 'aucun pays deux fois dans la liste')
const reecrits = codes.filter((c) => depart.includes(c))
ok(reecrits.length === 0, 'aucun pays de départ n’est réécrit (son nom et son continent restent les siens)', reecrits.join(', '))
ok(!codes.includes('IL') && !codes.includes('GB'), 'ni Israël, ni le Royaume-Uni ne sont des zones nouvelles')
const finale = new Set([...depart, ...codes].filter((c) => c !== 'IL' && c !== 'GB'))
const attendue = new Set([...[...source.keys()].filter((c) => c !== 'IL' && c !== 'GB'), ...NATIONS])
const manquants = [...attendue].filter((c) => !finale.has(c))
const enTrop = [...finale].filter((c) => !attendue.has(c))
ok(manquants.length === 0 && enTrop.length === 0, `la liste finale = l’ONU, moins Israël et le Royaume-Uni, plus ses quatre pays (${finale.size})`,
  [manquants.length ? `manquants : ${manquants.join(', ')}` : '', enTrop.length ? `en trop : ${enTrop.join(', ')}` : ''].filter(Boolean).join(' · '))
const malRanges = lignes.filter((l) => (NATIONS.includes(l.code) ? 'EU' : source.get(l.code)) !== l.continent)
ok(malRanges.length === 0, 'chaque pays nouveau est dans le continent de la source (les quatre pays du Royaume-Uni en Europe)',
  malRanges.map((l) => `${l.code} : ${l.continent}`).join(' · '))
const sansNom = lignes.filter((l) => l.noms.some((n) => !n.trim() || /&|^[A-Z]{2}$/.test(n)))
ok(sansNom.length === 0, 'chaque ligne a ses quatre noms (fr, en, es, de), sans abréviation « & » ni code nu', sansNom.map((l) => l.code).join(', '))
const nations = Object.fromEntries(lignes.filter((l) => NATIONS.includes(l.code)).map((l) => [l.code, l.noms.join(' / ')]))
ok(nations['GB-ENG'] === 'Angleterre / England / Inglaterra / England' && nations['GB-SCT'] === 'Écosse / Scotland / Escocia / Schottland'
   && nations['GB-WLS'] === 'Pays de Galles / Wales / Gales / Wales' && nations['GB-NIR'] === 'Irlande du Nord / Northern Ireland / Irlanda del Norte / Nordirland',
  'les quatre pays du Royaume-Uni, nommés dans les quatre langues', JSON.stringify(nations))
const turquie = lignes.find((l) => l.code === 'TR')
ok(turquie?.continent === 'EU' && turquie.noms.join(' / ') === 'Turquie / Turkey / Turquía / Türkei',
  'la Turquie : en Europe, « Turkey » en anglais (décision de Youssef)', JSON.stringify(turquie))
const FORME = /^[A-Z]{2}(-[A-Z]{3})?$/
ok(codes.every((c) => FORME.test(c)) && /check \(country_code is null or country_code ~ '\^\[A-Z\]\{2\}\(-\[A-Z\]\{3\}\)\?\$'\)/.test(M),
  'chaque code a la forme que la base exige (ISO 3166-1, ou 3166-2 pour une nation) — la même expression, ici et en base')

// Les comptes finaux par continent (servent à B).
const parContinent = {}
for (const c of finale) {
  const cont = NATIONS.includes(c) ? 'EU' : (correspondance.has(c) && depart.includes(c) ? correspondance.get(c) : source.get(c))
  parContinent[cont] = (parContinent[cont] ?? 0) + 1
}

// ══════════════════════════════════════════════════════════════════════════
section('B. Le test de base attend exactement cette liste')
// ══════════════════════════════════════════════════════════════════════════
const TEST = 'supabase/tests/database/matching/zones_liste_des_pays.test.sql'
const T = lire(TEST)
const attenduTest = /string_to_array\(\s*([\s\S]*?), ','\)\)/.exec(T)?.[1]?.replace(/'\s*'/g, '').replace(/[\s']/g, '').split(',') ?? []
ok(attenduTest.length === finale.size && attenduTest.every((c) => finale.has(c)), `le test attend les ${finale.size} codes de la liste finale, ni plus ni moins (${attenduTest.length})`)
const comptesTest = JSON.parse(/'(\{"EU"[^']*\})'::jsonb/.exec(T)?.[1] ?? '{}')
ok(JSON.stringify(Object.keys(comptesTest).sort().map((k) => [k, comptesTest[k]])) === JSON.stringify(Object.keys(parContinent).sort().map((k) => [k, parContinent[k]])),
  `le test attend les comptes par continent de la liste (${JSON.stringify(parContinent)})`, JSON.stringify(comptesTest))
ok(/select plan\(19\)/.test(T) && (T.match(/return next /g) ?? []).length === 19, 'le test annonce 19 assertions et en fait 19')
ok(/remplacer_zone_de_travail\('C_GB', array\['C_GB-ENG', 'C_GB-SCT', 'C_GB-WLS', 'C_GB-NIR'\]\)/.test(T) && /'ZN001'/.test(T) && /'ZN002'/.test(T) && /'23514'/.test(T),
  'le test fait tourner le remplacement réel, ses deux refus, et la forme')

// ══════════════════════════════════════════════════════════════════════════
section('C. La migration : détachée de countries, en text, la reprise à part')
// ══════════════════════════════════════════════════════════════════════════
ok(/ORDRE DE PASSAGE : AVANT/.test(ML.slice(0, 3000)), 'elle dit son ordre de passage (AVANT)')
ok(/alter table public\.work_zones drop constraint if exists work_zones_country_code_fkey;/.test(M) && /confrelid = 'public\.countries'::regclass/.test(M),
  'la clé étrangère vers countries est retirée, et la postcondition vérifie qu’aucune ne reste')
ok(!/(insert\s+into|update|delete\s+from|alter\s+table)\s+(public\.)?countries\b/i.test(M), 'countries n’est ni écrite ni changée (adresse, organisation, téléphone intacts)')
ok(/alter table public\.work_zones alter column country_code type text;/.test(M)
   && /alter table public\.profiles\s+alter column work_zone_countries type text\[\]/.test(M)
   && /alter table public\.publications alter column work_zone_countries type text\[\]/.test(M),
  'le code pays d’une zone et les deux listes aplaties passent en text')
const corpsDe = (src) => /create (?:or replace )?function public\.work_zone_country_codes\(p_zone_ids uuid\[\]\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/.exec(src)?.[1]
const avant = corpsDe(sansCommentairesSql(migration('referentiel_zones_de_travail')))
const apres = corpsDe(M)
ok(avant && apres && avant.replace(/'\{\}'::varchar\(2\)\[\]/, "'{}'::text[]").replace(/\s+/g, ' ') === apres.replace(/\s+/g, ' '),
  'l’aplatissement est recréé avec le MÊME corps (seul le type du vide change) et la même signature')
ok(M.indexOf('drop function public.work_zone_country_codes(uuid[]);') > 0 && M.indexOf('drop function public.work_zone_country_codes(uuid[]);') < M.indexOf('create function public.work_zone_country_codes(p_zone_ids uuid[])')
   && /returns text\[\]/.test(M.slice(M.indexOf('create function public.work_zone_country_codes'))),
  'supprimé puis recréé dans la même migration, en text[] (le type de retour ne se change pas par « or replace »)')
const declencheur = (src) => /create trigger work_zones_couverture\s+(after insert or update of parent_id, active, country_code or delete on public\.work_zones\s+for each row execute function public\.work_zones_couverture\(\));/.exec(src)?.[1]?.replace(/\s+/g, ' ')
const declencheurOrigine = declencheur(sansCommentairesSql(migration('zones_couverture_suit_le_referentiel')))
const iRetire = M.indexOf('drop trigger if exists work_zones_couverture on public.work_zones;')
ok(declencheurOrigine && declencheur(M) === declencheurOrigine && iRetire >= 0 && iRetire < M.indexOf('alter column country_code type text')
   && M.indexOf('alter column country_code type text') < M.indexOf('create trigger work_zones_couverture'),
  'le déclencheur de couverture est retiré AVANT le changement de type, et reposé À L’IDENTIQUE après')
ok(/revoke all on function public\.remplacer_zone_de_travail\(text, text\[\]\) from public, anon, authenticated;/.test(M)
   && /has_function_privilege\('authenticated', 'public\.remplacer_zone_de_travail\(text, text\[\]\)', 'execute'\)/.test(M),
  'le remplacement est fermé au navigateur (et la postcondition le vérifie)')
const reprise = /do \$reprise\$([\s\S]*?)\$reprise\$/.exec(M)?.[1] ?? ''
ok(/public\.remplacer_zone_de_travail\('C_GB', array\['C_GB-ENG', 'C_GB-SCT', 'C_GB-WLS', 'C_GB-NIR'\]\)/.test(reprise)
   && reprise.indexOf('remplacer_zone_de_travail') < reprise.indexOf("update public.work_zones set active = false where code in ('C_GB', 'C_IL')"),
  'la reprise, dans son propre bloc : le Royaume-Uni devient ses quatre pays, PUIS le Royaume-Uni et Israël sont désactivés')
ok(M.indexOf('do $liste$') < M.indexOf('do $reprise$'), 'les quatre pays existent avant que la reprise les donne')
ok(!/\b(delete\s+from\s+public\.work_zones|work_zone_ids\s*=\s*'\{\}')/.test(M), 'aucune zone n’est supprimée, aucune liste de zones n’est vidée (une liste vide ne retiendrait personne)')

// ══════════════════════════════════════════════════════════════════════════
section('D. Le miroir JS aplatit un code de nation comme un code de pays')
// ══════════════════════════════════════════════════════════════════════════
let Z
try {
  Z = await import(pathToFileURL(join(ROOT, 'lib/work-zones.ts')).href)
} catch (err) {
  console.error('✘ lib/work-zones.ts ne se charge pas — le contrôle ne tourne pas', err)
  process.exit(2)
}
const zones = [
  { id: 'W', parent_id: null, kind: 'world', code: 'WORLD', country_code: null, name: 'Monde', slug: 'm' },
  { id: 'EU', parent_id: 'W', kind: 'continent', code: 'EU', country_code: null, name: 'Europe', slug: 'e' },
  { id: 'ENG', parent_id: 'EU', kind: 'country', code: 'C_GB-ENG', country_code: 'GB-ENG', name: 'Angleterre', slug: 'a' },
  { id: 'SCT', parent_id: 'EU', kind: 'country', code: 'C_GB-SCT', country_code: 'GB-SCT', name: 'Écosse', slug: 'b' },
  { id: 'FR', parent_id: 'EU', kind: 'country', code: 'C_FR', country_code: 'FR', name: 'France', slug: 'c' },
]
ok(Z.expandToCountryCodes(zones, ['ENG']).join() === 'GB-ENG' && Z.expandToCountryCodes(zones, ['EU']).join() === 'FR,GB-ENG,GB-SCT',
  'l’Angleterre seule couvre GB-ENG ; l’Europe couvre la France et les deux nations')
const recoupe = (a, b) => Z.expandToCountryCodes(zones, a).some((c) => Z.expandToCountryCodes(zones, b).includes(c))
ok(!recoupe(['ENG'], ['SCT']) && recoupe(['ENG'], ['EU']) && recoupe(['ENG'], ['ENG']), '« Angleterre » ne recoupe pas « Écosse » ; elle recoupe l’Europe et elle-même')

// ══════════════════════════════════════════════════════════════════════════
section('E. Les fabriques des tests ne prennent qu’une zone active')
// ══════════════════════════════════════════════════════════════════════════
for (const f of ['supabase/tests/database/grand_livre/_fabriques.psql', 'supabase/tests/database/profil/specialite_autre.test.sql']) {
  const s = sansCommentairesSql(lire(f))
  const prises = [...s.matchAll(/select z\.id into v_zone from public\.work_zones z([^;]*);/g)].map((m) => m[1])
  ok(prises.length > 0 && prises.every((p) => /where z\.active/.test(p)), `${f} : la zone fabriquée est ACTIVE (${prises.length})`)
}

// ══════════════════════════════════════════════════════════════════════════
section('F. La requête d’avant-push compte ceux qui avaient Israël ou le Royaume-Uni')
// ══════════════════════════════════════════════════════════════════════════
const Q = lire('supabase/verifications/staging-avant-push.sql')
ok(/prochain push : profils et annonces qui ont choisi Israël/.test(Q) && /code = 'C_IL'/.test(Q), 'une ligne compte les profils et les annonces qui avaient choisi Israël')
ok(/prochain push : profils et annonces qui ont choisi le Royaume-Uni/.test(Q) && /code = 'C_GB'/.test(Q), 'une ligne compte ceux qui avaient choisi le Royaume-Uni (ils reçoivent les quatre)')
ok(/prochain push : zones pays actives aujourd''hui — 64/.test(Q) && /'64',\s*\(select count\(\*\)::text from public\.work_zones w where w\.kind = 'country' and w\.active\)/.test(Q),
  'une ligne vérifie que staging part des 64 zones (même liste qu’une base neuve)')

console.log(echecs === 0 ? '\n✓ La liste des pays est celle de l’ONU, Israël excepté, le Royaume-Uni en quatre pays — et countries est intacte.' : `\n✘ ${echecs} CONTRÔLE(S) EN ÉCHEC`)
// `exitCode`, jamais `process.exit()` : sous Windows, couper le processus pendant qu'une écriture est en cours le fait
// planter dans libuv (« UV_HANDLE_CLOSING », 0xC0000409) — un rouge devenait un muet, vu en éprouvant ce contrôle.
process.exitCode = echecs === 0 ? 0 : 1
