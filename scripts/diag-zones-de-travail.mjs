// scripts/diag-zones-de-travail.mjs — le référentiel de zones, ÉPROUVÉ EN
// SIMULANT SA HIÉRARCHIE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   « Zones de travail » remplace « Localisation » des deux côtés du marché, et
//   toute la propriété qu'on en attend tient en une phrase : une annonce
//   « Europe » doit recouper un expert « France », ET un expert « Europe » doit
//   recouper une annonce « France ».
//
//   Cette symétrie ne vient pas d'un test dans le code : elle vient de
//   l'APLATISSEMENT des zones déclarées vers l'ensemble des codes pays qu'elles
//   recouvrent. Le recoupement devient alors un simple `&&` entre deux ensembles
//   de pays, symétrique par construction.
//
//   Ce qui peut casser cette propriété n'est PAS la logique — elle tient en cinq
//   lignes de SQL récursif — mais LA DONNÉE : un pays rattaché à aucun continent
//   est invisible au matching ; un pays rattaché à deux continents fausse
//   l'aplatissement ; un pays absent d'Europe fait qu'une annonce « Europe » ne
//   trouve pas les experts de ce pays. Aucune de ces trois erreurs ne produit la
//   moindre exception : elles produisent un matching silencieusement faux.
//
//   Ce diag lit la correspondance ISO dans la migration, rejoue l'aplatissement
//   en JavaScript, et vérifie la symétrie sur des cas réels.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE LE DIAG VÉRIFIE
//   A. La correspondance ISO   — aucun doublon, aucun orphelin, continents connus.
//   B. L'aplatissement         — rejoué en JS depuis la donnée de la migration.
//   C. La symétrie du `&&`     — dans les deux sens, sur des cas réels.
//   D. Les traductions         — 4 langues, parité stricte sur les zones racines.
//   E. La forme des migrations — le trigger, les contraintes, le renommage.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-zones-de-travail.mjs
//
// AUCUN accès base, AUCUNE variable d'environnement, AUCUN réseau. Le diag lit
// les fichiers de migration et rejoue leur logique.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = 'supabase/migrations'
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/**
 * Résout une migration par son NOM DESCRIPTIF, jamais par son horodatage.
 *
 * POURQUOI : plusieurs espaces de travail produisent des migrations en
 * parallèle, et un horodatage en collision bloque le push de tout le monde. Le
 * renumérotage est donc une opération NORMALE, pas un accident — et un
 * diagnostic qui code un horodatage en dur casse à chaque fois, silencieusement
 * (fichier introuvable = plus aucun contrôle exécuté). Le suffixe descriptif,
 * lui, ne bouge pas.
 *
 * L'unicité est vérifiée : deux fichiers portant le même suffixe seraient deux
 * versions de la même migration, ce qui est une erreur en soi.
 */
function migration(suffixe) {
  const trouves = readdirSync(join(ROOT, MIGRATIONS))
    .filter((f) => f.endsWith(`_${suffixe}.sql`))
    .sort()
  if (trouves.length !== 1) {
    console.error(
      `\n❌ ${trouves.length} migration(s) « ${suffixe} » trouvée(s)` +
      (trouves.length ? ` : ${trouves.join(', ')}` : '') +
      `\n   Attendu : exactement une. Le diagnostic ne peut rien vérifier.\n`,
    )
    process.exit(1)
  }
  return `${MIGRATIONS}/${trouves[0]}`
}

const M_ZONES  = migration('referentiel_zones_de_travail')
const M_CHAMPS = migration('profil_annonce_multivalues')

/**
 * Retire les commentaires avant de chercher un anti-pattern. Sans ça, ce diag
 * interdirait de DOCUMENTER ce qu'il surveille : les migrations expliquent en
 * toutes lettres pourquoi telle colonne est supprimée, et ces phrases
 * suffisaient à déclencher l'alerte. Même correctif que dans diag-suspension.
 */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const eq = (actual, expected, label) =>
  ok(actual === expected, `${label} → ${JSON.stringify(actual)}`,
    actual === expected ? undefined : `attendu ${JSON.stringify(expected)}`)
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const SRC_ZONES  = read(M_ZONES)
const SRC_CHAMPS = read(M_CHAMPS)

// ══════════════════════════════════════════════════════════════════════════
section('A. LA CORRESPONDANCE ISO — la donnée, pas la logique')
// ══════════════════════════════════════════════════════════════════════════

// ── Continents seedés : ('EU', 'Europe', 'europe', 10) ───────────────────
const CONTINENTS = new Map()
for (const m of SRC_ZONES.matchAll(/\('([A-Z]{2})',\s*'([^']+)',\s*'([^']+)',\s*(\d+)\)/g)) {
  CONTINENTS.set(m[1], { nom: m[2], slug: m[3] })
}
eq(CONTINENTS.size, 6, 'continents seedés')
for (const c of ['EU', 'AF', 'AS', 'NA', 'SA', 'OC']) {
  ok(CONTINENTS.has(c), `continent ${c} présent (${CONTINENTS.get(c)?.nom ?? '—'})`)
}

// ── Correspondance pays → continent, bornée au bloc iso_continent ─────────
const debut = SRC_ZONES.indexOf('iso_continent(country_code, continent_code) as (values')
const fin   = SRC_ZONES.indexOf('insert into public.work_zones (parent_id, kind, code, country_code, name, slug, sort_order)\nselect cont.id')
ok(debut > -1 && fin > debut, 'le bloc de correspondance ISO est localisable dans la migration',
  'le diag ne peut plus lire la donnée qu il doit vérifier')

const BLOC = SRC_ZONES.slice(debut, fin)
const PAYS = []          // [{ pays, continent }]
for (const m of BLOC.matchAll(/\('([A-Z]{2})','([A-Z]{2})'\)/g)) {
  PAYS.push({ pays: m[1], continent: m[2] })
}
console.log(`  --   ${PAYS.length} pays rattachés`)
ok(PAYS.length >= 150, `au moins 150 pays rattachés (${PAYS.length})`,
  'une correspondance amputée rend des pays entiers invisibles au matching')

// ── Aucun doublon : un pays dans deux continents fausse l aplatissement ──
const vus = new Map()
const doublons = []
for (const { pays, continent } of PAYS) {
  if (vus.has(pays)) doublons.push(`${pays} (${vus.get(pays)} et ${continent})`)
  else vus.set(pays, continent)
}
ok(doublons.length === 0, 'aucun pays rattaché à deux continents',
  doublons.length ? `doublons : ${doublons.join(', ')}` : undefined)

// ── Aucun continent inconnu : un rattachement vers le vide = orphelin ────
const inconnus = [...new Set(PAYS.map((p) => p.continent))].filter((c) => !CONTINENTS.has(c))
ok(inconnus.length === 0, 'tous les continents référencés existent',
  inconnus.length ? `continents inconnus : ${inconnus.join(', ')}` : undefined)

// ── Aucun continent vide ────────────────────────────────────────────────
for (const c of CONTINENTS.keys()) {
  const n = PAYS.filter((p) => p.continent === c).length
  ok(n > 0, `${c} (${CONTINENTS.get(c).nom}) contient ${n} pays`)
}

// ── Sondages : ces rattachements-là DOIVENT être justes ─────────────────
console.log('\n— sondages de rattachement')
for (const [pays, attendu] of [
  ['FR', 'EU'], ['DE', 'EU'], ['ES', 'EU'], ['GB', 'EU'],
  ['TN', 'AF'], ['MA', 'AF'], ['SN', 'AF'],
  ['JP', 'AS'], ['IN', 'AS'], ['AE', 'AS'],
  ['US', 'NA'], ['CA', 'NA'], ['MX', 'NA'],
  ['BR', 'SA'], ['AR', 'SA'],
  ['AU', 'OC'], ['NZ', 'OC'],
  // Pièges : ces codes pays sont aussi des codes de continent.
  ['NA', 'AF'],  // Namibie, pas « Amérique du Nord »
  ['SA', 'AS'],  // Arabie saoudite, pas « Amérique du Sud »
  ['AF', 'AS'],  // Afghanistan, pas « Afrique »
]) {
  eq(vus.get(pays) ?? null, attendu, `${pays}`)
}

// ── La collision de codes est-elle bien évitée par le préfixe ? ─────────
ok(/'C_'\s*\|\|\s*co\.code/.test(SRC_ZONES),
  'les zones-pays sont préfixées (C_XX), sans quoi la Namibie (NA) écraserait l Amérique du Nord (NA)',
  'work_zones.code est UNIQUE : sans préfixe, trois continents entrent en collision avec un pays')

// ══════════════════════════════════════════════════════════════════════════
section('B. L APLATISSEMENT — la logique SQL, rejouée en JavaScript')
// ══════════════════════════════════════════════════════════════════════════
//
// On reconstruit l arbre tel que la migration le seede, puis on rejoue la
// descente récursive de work_zone_country_codes(). Si la donnée est fausse,
// c est ici que ça se voit.

const enfants = new Map()   // code zone -> [codes enfants]
const paysDe  = new Map()   // code zone -> code pays (feuilles seulement)
enfants.set('WORLD', [...CONTINENTS.keys()])
for (const c of CONTINENTS.keys()) enfants.set(c, [])
for (const { pays, continent } of PAYS) {
  const code = `C_${pays}`
  enfants.get(continent).push(code)
  paysDe.set(code, pays)
}

/** Miroir JS de public.work_zone_country_codes(uuid[]). */
function aplatir(codes) {
  const out = new Set()
  const pile = [...codes]
  const vu = new Set()
  while (pile.length) {
    const z = pile.pop()
    if (vu.has(z)) continue
    vu.add(z)
    if (paysDe.has(z)) out.add(paysDe.get(z))
    for (const e of enfants.get(z) ?? []) pile.push(e)
  }
  return out
}
/** Miroir de l opérateur && de PostgreSQL. */
const recoupe = (a, b) => [...a].some((x) => b.has(x))

eq(aplatir(['C_FR']).size, 1, 'une zone-pays aplatit vers 1 pays')
ok(aplatir(['EU']).has('FR'), 'Europe aplatit vers un ensemble contenant FR')
ok(aplatir(['EU']).has('DE'), 'Europe aplatit vers un ensemble contenant DE')
ok(!aplatir(['EU']).has('TN'), 'Europe n aplatit PAS vers TN')
eq(aplatir(['WORLD']).size, PAYS.length, 'Monde entier aplatit vers TOUS les pays rattachés')
eq(aplatir([]).size, 0, 'une déclaration vide aplatit vers l ensemble vide')

// ══════════════════════════════════════════════════════════════════════════
section('C. LA SYMÉTRIE — la propriété que tout le reste sert')
// ══════════════════════════════════════════════════════════════════════════

const cas = (expert, annonce, attendu, libelle) =>
  ok(recoupe(aplatir(expert), aplatir(annonce)) === attendu,
    `${libelle} → ${attendu ? 'recoupe' : 'ne recoupe pas'}`,
    `expert ${expert.join('+')} / annonce ${annonce.join('+')}`)

console.log('— le cas fondateur, dans les DEUX sens')
cas(['C_FR'], ['EU'],   true,  'expert « France » vs annonce « Europe »')
cas(['EU'],   ['C_FR'], true,  'expert « Europe » vs annonce « France »')

console.log('\n— le cas d usage énoncé : un expert à Tunis qui accepte l Europe')
cas(['EU'],          ['C_FR'], true,  'expert « Europe » vs annonce « France »')
cas(['EU', 'C_TN'],  ['C_DE'], true,  'expert « Europe + Tunisie » vs annonce « Allemagne »')
cas(['C_TN'],        ['EU'],   false, 'expert « Tunisie » seule vs annonce « Europe »')

console.log('\n— les non-recoupements, tout aussi importants')
cas(['C_FR'], ['C_DE'], false, 'expert « France » vs annonce « Allemagne »')
cas(['AF'],   ['C_FR'], false, 'expert « Afrique » vs annonce « France »')
cas(['AF'],   ['EU'],   false, 'expert « Afrique » vs annonce « Europe »')

console.log('\n— le monde entier recoupe tout, dans les deux sens')
cas(['WORLD'], ['C_TN'],  true, 'expert « Monde » vs annonce « Tunisie »')
cas(['C_TN'],  ['WORLD'], true, 'expert « Tunisie » vs annonce « Monde »')

console.log('\n— déclarations multiples des deux côtés')
cas(['EU', 'AF'], ['C_MA', 'C_ES'], true,  'expert « Europe + Afrique » vs annonce « Maroc + Espagne »')
cas(['OC'],       ['C_MA', 'C_ES'], false, 'expert « Océanie » vs annonce « Maroc + Espagne »')

console.log('\n— l ensemble vide ne recoupe RIEN : c est pourquoi la zone est obligatoire')
cas([], ['C_FR'],  false, 'expert sans zone déclarée')
cas(['C_FR'], [],  false, 'annonce sans zone déclarée')
ok(/work_zone_ids,\s*1\), 0\) > 0/.test(stripComments(SRC_CHAMPS)),
  'la contrainte de visibilité EXIGE au moins une zone côté expert',
  'sans elle, un profil sans zone serait visible et ne recouperait jamais rien, en silence')
ok(/status <> 'published'\s*\n\s*or coalesce\(array_length\(work_zone_ids, 1\), 0\) > 0/.test(stripComments(SRC_CHAMPS)),
  'la contrainte EXIGE au moins une zone sur une annonce publiée')

// ══════════════════════════════════════════════════════════════════════════
section('D. LES TRADUCTIONS — parité stricte sur les zones racines')
// ══════════════════════════════════════════════════════════════════════════
//
// Le FR est le repli automatique de tBDD : il vient de work_zones.name et n a
// pas à figurer dans translations. Les trois autres langues, si.

const TRAD = new Map()   // code -> Set(locales)
for (const m of SRC_ZONES.matchAll(/\('((?:[A-Z]{2})|WORLD)','(en|es|de)','([^']+)'\)/g)) {
  if (!TRAD.has(m[1])) TRAD.set(m[1], new Set())
  TRAD.get(m[1]).add(m[2])
}
for (const code of ['WORLD', ...CONTINENTS.keys()]) {
  const l = TRAD.get(code) ?? new Set()
  ok(l.size === 3 && l.has('en') && l.has('es') && l.has('de'),
    `${code} traduit en en/es/de (${[...l].sort().join(', ') || 'aucune'})`)
}
ok(/co\.name_en/.test(SRC_ZONES) && /co\.name_es/.test(SRC_ZONES) && /co\.name_de/.test(SRC_ZONES),
  'les pays reprennent les 4 langues déjà présentes dans `countries`')

// ══════════════════════════════════════════════════════════════════════════
section('E. LA FORME DES MIGRATIONS')
// ══════════════════════════════════════════════════════════════════════════

const Z = stripComments(SRC_ZONES)
const C = stripComments(SRC_CHAMPS)

console.log('— référentiel')
ok(/create extension/.test(Z) === false, 'aucune extension supplémentaire requise')
ok(/references public\.countries\(code\)/.test(Z),
  'country_code porte une clé étrangère vers countries',
  'sans elle on peut rattacher un pays qui n existe pas')
ok(/work_zones_country_code_coherence_check/.test(Z),
  'un continent ne peut pas porter de code pays (et réciproquement)')
ok(/work_zones_racine_check/.test(Z),
  'toute zone non-racine est rattachée : aucun orphelin invisible à la descente')
ok(/create or replace function public\.work_zone_country_codes/.test(Z),
  'l aplatissement est une fonction UNIQUE, pas une requête recopiée')
ok(/domain_id/.test(Z) === false,
  'aucun domain_id sur les zones : la géographie n appartient à aucun écosystème')

console.log('\n— champs multiples')
for (const [motif, libelle] of [
  [/profiles[\s\S]*?add column if not exists speciality_ids\s+uuid\[\]/, 'profiles.speciality_ids'],
  [/profiles[\s\S]*?add column if not exists seniorities\s+text\[\]/, 'profiles.seniorities'],
  [/publications[\s\S]*?add column if not exists speciality_ids\s+uuid\[\]/, 'publications.speciality_ids'],
  [/publications[\s\S]*?add column if not exists seniorities\s+text\[\]/, 'publications.seniorities'],
]) ok(motif.test(C), `${libelle} ajouté`)

ok(/drop column if exists speciality_id;/.test(C) && /drop column if exists seniority;/.test(C),
  'les colonnes à valeur unique sont SUPPRIMÉES, pas laissées en double source de vérité')
ok(/rename column location to location_note/.test(C),
  '« localisation » devient location_note — renommage délibérément cassant')
ok(/alter column visible set default false/.test(C),
  'un profil neuf n est plus visible par défaut')
ok(/char_length\(btrim\(summary\)\) between 200 and 800/.test(C),
  'le résumé est borné 200-800 pour un profil visible — c est le texte que le reranker lit')

console.log('\n— colonne dérivée et index')
ok(/create or replace trigger trg_profiles_work_zones/.test(C)
  && /create or replace trigger trg_publications_work_zones/.test(C),
  'le trigger d aplatissement existe des DEUX côtés',
  'un seul côté suffirait à rendre le recoupement asymétrique')
ok(/sync_work_zone_countries/.test(C),
  'la dérivée est maintenue au SERVEUR, pas dans une route (règle 20)')
for (const t of ['profiles', 'publications']) {
  for (const col of ['speciality_ids', 'seniorities', 'work_zone_countries']) {
    ok(new RegExp(`create index if not exists ${t}_${col}_gin[\\s\\S]{0,120}using gin \\(${col}\\)`).test(C),
      `index GIN ${t}.${col}`)
  }
}
ok(/profiles_pool_matching_idx/.test(C), 'index de parcours du pool')
ok(/50 000/.test(SRC_CHAMPS),
  'la CONDITION DE RETOUR d une présélection est écrite là où on lira la taille du pool',
  'sans elle, personne ne saura quand ré-ouvrir la question')

console.log('\n— ordre de déploiement')
for (const [f, src] of [[M_ZONES, SRC_ZONES], [M_CHAMPS, SRC_CHAMPS]]) {
  ok(/ORDRE D'EXÉCUTION/.test(src), `${f.split('/').pop()} porte son ordre de déploiement en tête`)
}

// ══════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ Tous les contrôles passent.\n'
    : `\n❌ ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
