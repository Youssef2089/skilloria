// scripts/diag-lot2-socle.mjs — LE SOCLE DES ÉCRANS, ÉPROUVÉ EN L'EXÉCUTANT.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le lot 2 introduit trois choses dont la correction ne se voit pas à la
//   relecture, et dont l'échec est SILENCIEUX :
//
//   ① UN MIROIR. `expandToCountryCodes` (TypeScript) doit rendre exactement ce
//      que rend `work_zone_country_codes` (SQL). La base écrit la colonne
//      dérivée qui FILTRE, l'écran affiche ce que la sélection RECOUVRE. Si les
//      deux divergent, l'écran annonce une couverture que le moteur n'applique
//      pas — et personne ne s'en aperçoit, puisque les deux ont l'air corrects
//      chacun de son côté.
//
//   ② UN PRÉDICAT PARTAGÉ. Ce qui rend un profil visible vivait en TROIS
//      exemplaires : contrainte base, route, formulaire. Trois copies dérivent.
//      Le fichier lib/profile-visibility.ts est désormais la seule écriture, et
//      ce diag vérifie qu'il dit bien la même chose que la contrainte.
//
//   ③ DES MESSAGES QUI DOIVENT EXISTER. Cinq experts ont été rendus invisibles
//      par la migration SANS ÊTRE PRÉVENUS. La seule réparation possible est de
//      leur dire précisément ce qui manque. Un champ manquant sans traduction
//      afficherait une clé technique — ou rien. Le contrôle est donc : TOUT
//      champ que le prédicat peut rendre a un libellé dans LES QUATRE langues.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-lot2-socle.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE variable d'environnement.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  buildWorkZoneTree,
  continentsOf,
  countryCountOf,
  dedupeCoveredZones,
  expandToCountryCodes,
  worldZoneOf,
} from '../lib/work-zones.ts'
import {
  CHAMPS_AUSSI_GARANTIS_EN_BASE,
  PROFILE_VISIBILITY_FIELDS,
  RESUME_MAX,
  RESUME_MIN,
  missingForVisibility,
} from '../lib/profile-visibility.ts'
import {
  CHAMPS_AUSSI_GARANTIS_EN_BASE as CHAMPS_ANNONCE_EN_BASE,
  missingForPublish,
} from '../lib/publications/publishable.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/** Résout une migration par son SUFFIXE : le renumérotage est normal ici. */
function migration(suffixe) {
  const t = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith(`_${suffixe}.sql`))
  if (t.length !== 1) {
    console.error(`\n❌ ${t.length} migration(s) « ${suffixe} » — attendu exactement une.\n`)
    process.exit(1)
  }
  return `supabase/migrations/${t[0]}`
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const eq = (a, b, label) =>
  ok(a === b, `${label} → ${JSON.stringify(a)}`, a === b ? undefined : `attendu ${JSON.stringify(b)}`)
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const SRC_ZONES = read(migration('referentiel_zones_de_travail'))
const SRC_CHAMPS = read(migration('profil_annonce_multivalues'))

// ══════════════════════════════════════════════════════════════════════════
section('A. LE MIROIR — TypeScript contre SQL, sur la vraie donnée')
// ══════════════════════════════════════════════════════════════════════════
//
// On reconstruit la liste de zones exactement comme la migration la seede, puis
// on compare DEUX implémentations indépendantes de la descente : celle de
// lib/work-zones.ts (utilisée par les écrans) et une descente écrite ici, qui
// rejoue le CTE récursif du SQL. Un écart signalerait que l'écran et le moteur
// ne parlent pas de la même chose.

const debut = SRC_ZONES.indexOf('iso_continent(country_code, continent_code) as (values')
const fin = SRC_ZONES.indexOf('insert into public.work_zones (parent_id, kind, code, country_code, name, slug, sort_order)\nselect cont.id')
const BLOC = SRC_ZONES.slice(debut, fin)
const PAYS = [...BLOC.matchAll(/\('([A-Z]{2})','([A-Z]{2})'\)/g)].map((m) => ({ pays: m[1], continent: m[2] }))
const CONTINENTS = [...SRC_ZONES.matchAll(/\('([A-Z]{2})',\s*'([^']+)',\s*'([^']+)',\s*(\d+)\)/g)]
  .map((m) => ({ code: m[1], nom: m[2] }))

ok(PAYS.length >= 150 && CONTINENTS.length === 6,
  `donnée lue dans la migration : ${CONTINENTS.length} continents, ${PAYS.length} pays`)

/** Les zones telles que /api/taxonomy les rend. */
const ZONES = [
  { id: 'z-WORLD', parent_id: null, kind: 'world', code: 'WORLD', country_code: null, name: 'Monde entier', slug: 'monde-entier' },
  ...CONTINENTS.map((c) => ({
    id: `z-${c.code}`, parent_id: 'z-WORLD', kind: 'continent',
    code: c.code, country_code: null, name: c.nom, slug: c.nom.toLowerCase(),
  })),
  ...PAYS.map((p) => ({
    id: `z-C_${p.pays}`, parent_id: `z-${p.continent}`, kind: 'country',
    code: `C_${p.pays}`, country_code: p.pays, name: p.pays, slug: `pays-${p.pays.toLowerCase()}`,
  })),
]

/** Descente indépendante — le CTE récursif du SQL, réécrit à la main. */
function descenteSql(zones, ids) {
  const parId = new Map(zones.map((z) => [z.id, z]))
  const enfants = new Map()
  for (const z of zones) if (z.parent_id) enfants.set(z.parent_id, [...(enfants.get(z.parent_id) ?? []), z.id])
  const out = new Set(); const vus = new Set(); const pile = [...ids]
  while (pile.length) {
    const id = pile.pop()
    if (vus.has(id) || !parId.has(id)) continue
    vus.add(id)
    const cc = parId.get(id).country_code
    if (cc) out.add(cc)
    for (const e of enfants.get(id) ?? []) pile.push(e)
  }
  return [...out].sort()
}

const memeChose = (ids, libelle) => {
  const ts = expandToCountryCodes(ZONES, ids)
  const sql = descenteSql(ZONES, ids)
  ok(JSON.stringify(ts) === JSON.stringify(sql),
    `${libelle} — ${ts.length} pays, les deux implémentations concordent`,
    `TypeScript ${ts.length} vs SQL ${sql.length} : l'écran annoncerait autre chose que ce que le moteur filtre`)
}

memeChose(['z-WORLD'], 'Monde entier')
memeChose(['z-EU'], 'Europe')
memeChose(['z-AF'], 'Afrique')
memeChose(['z-C_FR'], 'France seule')
memeChose(['z-EU', 'z-AF'], 'Europe + Afrique')
memeChose(['z-EU', 'z-C_TN'], 'Europe + Tunisie')
memeChose([], 'sélection vide')
memeChose(['z-INEXISTANTE'], 'zone inconnue (ignorée des deux côtés)')

// ══════════════════════════════════════════════════════════════════════════
section('B. LE RECOUPEMENT — la symétrie, vue depuis les écrans')
// ══════════════════════════════════════════════════════════════════════════

const recoupe = (a, b) => {
  const ea = new Set(expandToCountryCodes(ZONES, a))
  return expandToCountryCodes(ZONES, b).some((c) => ea.has(c))
}
ok(recoupe(['z-C_FR'], ['z-EU']), 'expert « France » vs annonce « Europe »')
ok(recoupe(['z-EU'], ['z-C_FR']), 'expert « Europe » vs annonce « France » (symétrie)')
ok(!recoupe(['z-C_FR'], ['z-C_DE']), 'expert « France » vs annonce « Allemagne » — ne recoupe pas')
ok(!recoupe([], ['z-C_FR']), 'sélection vide ne recoupe RIEN — d où l obligation du champ')

eq(worldZoneOf(ZONES)?.code, 'WORLD', 'zone racine trouvée')
eq(continentsOf(ZONES).length, 6, 'continents')
eq(buildWorkZoneTree(ZONES).length, 1, 'arbre : une seule racine')
ok(countryCountOf(ZONES, 'z-EU') > 40, `Europe couvre ${countryCountOf(ZONES, 'z-EU')} pays`)

console.log('\n— dédoublonnage : cocher un continent PUIS un de ses pays')
eq(dedupeCoveredZones(ZONES, ['z-EU', 'z-C_FR']).join(','), 'z-EU',
  'le pays couvert est retiré, le choix large est gardé')
eq(dedupeCoveredZones(ZONES, ['z-C_FR', 'z-C_DE']).join(','), 'z-C_FR,z-C_DE',
  'deux pays sans lien de parenté sont tous deux gardés')
eq(dedupeCoveredZones(ZONES, ['z-WORLD', 'z-EU', 'z-C_FR']).join(','), 'z-WORLD',
  'le monde absorbe tout le reste')

// ══════════════════════════════════════════════════════════════════════════
section('C. LE PRÉDICAT DE VISIBILITÉ — source unique, comportement')
// ══════════════════════════════════════════════════════════════════════════

const PROFIL_COMPLET = {
  title: 'Consultant D365',
  summary: 'x'.repeat(300),
  skills: ['a', 'b', 'c'],
  branch_id: 'b1',
  speciality_ids: ['s1'],
  seniorities: ['senior'],
  work_zone_ids: ['z-EU'],
  availability_status: 'available',
  cdi_status: null,
  experiences_count: 2,
  languages_count: 1,
  cv_parsing_status: 'done',
  ai_consent_at: '2026-01-01',
}
const sans = (champ, valeur) => ({ ...PROFIL_COMPLET, [champ]: valeur })

eq(missingForVisibility(PROFIL_COMPLET, 'expert_freelance').length, 0, 'profil complet : rien ne manque')

console.log('\n— chaque champ manquant est NOMMÉ, un par un')
for (const [champ, valeur, attendu] of [
  ['title', '', 'title'],
  ['skills', ['a'], 'skills'],
  ['branch_id', null, 'branch_id'],
  ['speciality_ids', [], 'speciality_ids'],
  ['seniorities', [], 'seniorities'],
  ['work_zone_ids', [], 'work_zone_ids'],
  ['availability_status', null, 'availability'],
  ['experiences_count', 0, 'experiences'],
  ['languages_count', 0, 'languages_structured'],
  ['cv_parsing_status', 'pending', 'cv_ready'],
]) {
  const m = missingForVisibility(sans(champ, valeur), 'expert_freelance')
  ok(m.length === 1 && m[0] === attendu, `${champ} vide → « ${attendu} »`, `obtenu : ${m.join(', ')}`)
}

console.log('\n— le résumé : les deux bornes, et elles comptent toutes les deux')
eq(missingForVisibility(sans('summary', 'x'.repeat(RESUME_MIN - 1)), 'expert_freelance').join(','), 'summary',
  `${RESUME_MIN - 1} caractères : trop court`)
eq(missingForVisibility(sans('summary', 'x'.repeat(RESUME_MIN)), 'expert_freelance').join(','), '',
  `${RESUME_MIN} caractères : accepté`)
eq(missingForVisibility(sans('summary', 'x'.repeat(RESUME_MAX)), 'expert_freelance').join(','), '',
  `${RESUME_MAX} caractères : accepté`)
eq(missingForVisibility(sans('summary', 'x'.repeat(RESUME_MAX + 1)), 'expert_freelance').join(','), 'summary',
  `${RESUME_MAX + 1} caractères : trop long — au-delà, le moteur ne le lit plus`)
eq(missingForVisibility(sans('summary', '   ' + 'x'.repeat(RESUME_MIN) + '   '), 'expert_freelance').join(','), '',
  'les espaces de bord ne comptent pas')

console.log('\n— la disponibilité dépend du TYPE d expert, ce qu une contrainte de base ne sait pas faire')
const cdi = { ...PROFIL_COMPLET, availability_status: null, cdi_status: 'open_to_work' }
eq(missingForVisibility(cdi, 'expert_cdi').join(','), '', 'CDI : cdi_status suffit')
eq(missingForVisibility(cdi, 'expert_freelance').join(','), 'availability',
  'freelance : cdi_status ne suffit PAS — la route exige le bon champ')

console.log('\n— annonce')
eq(missingForPublish({ title: 'T', description: 'D', branch_id: 'b', work_zone_ids: ['z'] }).length, 0,
  'annonce complète')
eq(missingForPublish({ title: 'T', description: 'D', branch_id: 'b', work_zone_ids: [] }).join(','), 'work_zone_ids',
  'sans zone : refusée')
eq(missingForPublish({ title: 'T', description: 'D', branch_id: 'b', work_zone_ids: ['z'] })
  .concat(missingForPublish({ title: 'T', description: 'D', branch_id: 'b', work_zone_ids: ['z'] })).length, 0,
  'spécialités et séniorités NON exigées — un ensemble vide y signifie « aucune contrainte »')

// ══════════════════════════════════════════════════════════════════════════
section('D. PARITÉ AVEC LA CONTRAINTE BASE — la dérive qui a coûté un push')
// ══════════════════════════════════════════════════════════════════════════

const C = stripComments(SRC_CHAMPS)
const blocCheck = C.slice(
  C.indexOf('add constraint profiles_visible_requiert_criteres_check'),
  C.indexOf('add constraint profiles_visible_requiert_criteres_check') + 600,
)
const COLONNE_DE = {
  branch_id: 'branch_id',
  speciality_ids: 'speciality_ids',
  seniorities: 'seniorities',
  work_zone_ids: 'work_zone_ids',
  availability: 'availability_status',
  summary: 'summary',
}
for (const champ of CHAMPS_AUSSI_GARANTIS_EN_BASE) {
  ok(blocCheck.includes(COLONNE_DE[champ]),
    `« ${champ} » est aussi garanti par la contrainte base`,
    'déclaré partagé côté code, absent de la contrainte : les deux divergent')
}
ok(blocCheck.includes(`between ${RESUME_MIN} and ${RESUME_MAX}`),
  `les bornes du résumé (${RESUME_MIN}-${RESUME_MAX}) sont les MÊMES en base et dans le code`,
  'un écran qui accepte ce que la base refuse produit une erreur incompréhensible')

const blocCheckAnnonce = C.slice(
  C.indexOf('add constraint publications_publiee_requiert_zones_check'),
  C.indexOf('add constraint publications_publiee_requiert_zones_check') + 300,
)
for (const champ of CHAMPS_ANNONCE_EN_BASE) {
  ok(blocCheckAnnonce.includes(champ), `annonce : « ${champ} » garanti en base aussi`)
}

// ══════════════════════════════════════════════════════════════════════════
section('E. LES MESSAGES — un champ manquant doit être DISABLE, pas muet')
// ══════════════════════════════════════════════════════════════════════════
//
// Cinq experts sont devenus invisibles sans être prévenus. Leur dire « profil
// incomplet » ne répare rien : il leur faut la liste des champs. Un champ sans
// traduction afficherait une clé technique.

const LOCALES = ['fr', 'en', 'es', 'de']
const MSG = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`))]))
const lire = (m, chemin) => chemin.split('.').reduce((o, k) => (o == null ? o : o[k]), m)

for (const champ of PROFILE_VISIBILITY_FIELDS) {
  // 'summary' et 'availability' ont leur propre clé ; les autres portent leur nom.
  const manquantes = LOCALES.filter((l) => {
    const dansExpert = lire(MSG[l], `profile_validation.field_errors.${champ}`)
    const dansCdi = lire(MSG[l], `cdi_profile_validation.field_errors.${champ}`)
    return !dansExpert && !dansCdi
  })
  ok(manquantes.length === 0, `« ${champ} » a un libellé dans les 4 langues`,
    manquantes.length ? `absent en : ${manquantes.join(', ')}` : undefined)
}

console.log('\n— la bannière des profils rendus invisibles')
for (const cle of ['hidden_title', 'hidden_intro', 'hidden_list_intro', 'hidden_cta', 'summary_matching_help']) {
  const manquantes = LOCALES.filter((l) => !lire(MSG[l], `profile_validation.sections.summary_matching.${cle}`))
  ok(manquantes.length === 0, `« ${cle} » dans les 4 langues`, manquantes.join(', ') || undefined)
}

console.log('\n— le vocabulaire du lot')
for (const chemin of [
  'work_zones.label', 'work_zones.hint', 'work_zones.none_selected', 'work_zones.coverage',
  'work_zones.suggestion_confirm', 'work_zones.suggestion_not_applied',
  'matching_badge.strong', 'matching_badge.normal',
  'missions.recommendations_updated',
  'publications.form.field_work_zones', 'publications.form.field_location_note_help',
]) {
  const manquantes = LOCALES.filter((l) => !lire(MSG[l], chemin))
  ok(manquantes.length === 0, chemin, manquantes.join(', ') || undefined)
}

console.log('\n— « Localisation » ne doit plus désigner un critère de mise en relation')
const FR = MSG.fr
ok(lire(FR, 'publications.form.field_work_zones') === 'Zones de travail',
  'le formulaire d annonce dit « Zones de travail »')
ok(/ne sert pas|Ne sert pas/.test(lire(FR, 'publications.form.field_location_note_help') ?? ''),
  'le champ texte libre dit explicitement qu il ne sert PAS à la mise en relation',
  'sans cela, un utilisateur croit filtrer avec un champ décoratif')

// ══════════════════════════════════════════════════════════════════════════
section('F. LE RÉFÉRENTIEL EST SERVI, ET SANS BIBLIOTHÈQUE')
// ══════════════════════════════════════════════════════════════════════════

const TAXO = read('app/api/taxonomy/route.ts')
ok(/from\('work_zones'\)/.test(TAXO), 'la route taxonomie expose les zones')
ok(/tBDD\(translations, 'work_zones'/.test(TAXO), 'les libellés partent traduits (tBDD)')
const blocZones = TAXO.slice(TAXO.indexOf("from('work_zones')"), TAXO.indexOf("from('work_zones')") + 300)
ok(!blocZones.includes('domain_id'),
  'aucun filtre domain_id sur les zones — la géographie n appartient à aucun écosystème')

for (const f of ['components/ui/MultiSelectChips.tsx', 'components/ui/WorkZoneSelector.tsx']) {
  const src = read(f)
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1])
  const externes = imports.filter((i) => !i.startsWith('@/') && !i.startsWith('.') && i !== 'react' && i !== 'next-intl')
  ok(externes.length === 0, `${f.split('/').pop()} : aucune bibliothèque ajoutée`,
    externes.length ? `externes : ${externes.join(', ')}` : undefined)
}

const SEL = read('components/ui/WorkZoneSelector.tsx')
ok(/suggestion_not_applied/.test(SEL) && /selected\.length === 0/.test(SEL),
  'la pré-sélection est NON VALIDANTE : elle n entre pas dans la valeur tant qu on ne confirme pas',
  'une valeur par défaut qui validerait ferait déclarer une zone que personne n a choisie')
ok(/dedupeCoveredZones/.test(SEL), 'la sélection est dédoublonnée par la hiérarchie')
ok(/countryCountOf/.test(SEL), 'l étendue de chaque continent est affichée, pas devinée')

// ══════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0 ? '\n✅ Tous les contrôles passent.\n' : `\n❌ ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
