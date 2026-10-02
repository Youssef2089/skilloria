/**
 * diag-lot-zones.mjs — LE LOT « ZONES DE TRAVAIL ET PETITS DÉFAUTS DU RELECTEUR » (02/10/2026, ARRÊT 26).
 *
 * Chaque point est gardé par sa PROPRIÉTÉ (§E.34) ; ce qui peut l'être est EXÉCUTÉ (§E.33) :
 *   1. la saisie : un continent se déplie, « Tout le continent » en tête, une case par pays ; décocher un pays d'un
 *      continent entier laisse les autres ; la recherche coche dans le continent (lib/work-zones.ts, EXÉCUTÉ) ;
 *   2. ce qui s'enregistre : le continent, ou ces pays (EXÉCUTÉ) ; le recalcul du référentiel est en base
 *      (migration lue ; prouvé par pgTAP) ;
 *   3. toutes les surfaces — même composant ; l'affichage dit « Europe — tout le continent » (cartes, détail, admin) ;
 *   4. sans changement, rien ne s'écrit ni ne se relance ; les zones comparées comme un ENSEMBLE (EXÉCUTÉ) ;
 *   6. la spécialité désactivée prévient l'expert, dans sa langue, avec la variante « seule spécialité » (EXÉCUTÉ) ;
 *      réactivée, elle ne revient pas sous « Autre » (demandé avant d'écrire ; tenu en base) ;
 *   7. `langues_noms` est lue EN ENTIER — la pagination EXÉCUTÉE sur 2 500 noms, avec une API qui coupe à 1 000 ;
 *   9. l'annonce de sous-traitance porte la branche et les zones, et dit chaque refus. Depuis le lot « critères des
 *      annonces » (03/10/2026, §D.39), elle rend LE MÊME composant que l'annonce d'une organisation
 *      (components/annonces/ChampsAnnonce.tsx) et partage sa validation et son corps (lib/annonces/formulaire.ts) : la
 *      propriété est la même, son ancrage a suivi. Les codes qui vont au repli portent CHACUN leur raison (§G.8) — la
 *      garde d'identité n'est plus écartée en bloc (relecteur, 02/10/2026).
 * (5 : diag-zones-recoupement ; 8 : diag-deux-temps.)
 *
 * CE QU'IL NE VOIT PAS : un navigateur (le toucher, le clavier se lisent dans le code) ; la base (les deux migrations
 * sont prouvées par matching/zones_recoupement et taxonomie/reactivation_hors_autre, que seul `test db --local` fait
 * tourner) ; la justesse d'une traduction.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansCommentaires = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/ .*$/, ''))).join('\n')
const sansCommentairesSql = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
const importer = (p) => import(pathToFileURL(join(ROOT, p)).href)

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (t) => console.log(`\n── ${t}`)

const LANGUES = ['fr', 'en', 'es', 'de']
const MSG = Object.fromEntries(LANGUES.map((l) => [l, JSON.parse(lire(`messages/${l}.json`))]))
const cle = (o, p) => p.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o)
const dans4 = (p) => LANGUES.every((l) => typeof cle(MSG[l], p) === 'string' && cle(MSG[l], p).trim() !== '')
const clesCitees = (src, fn, prefixe) => [...src.matchAll(new RegExp(`\\b${fn}\\('([a-zA-Z0-9_.]+)'`, 'g'))].map((m) => `${prefixe}.${m[1]}`)
function migration(suffixe) {
  const f = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((x) => x.endsWith(`_${suffixe}.sql`))
  if (f.length !== 1) { console.error(`✘ migration *_${suffixe}.sql : ${f.length} correspondance(s)`); process.exit(2) }
  return sansCommentairesSql(lire(`supabase/migrations/${f[0]}`))
}

let Z, P, S
try {
  Z = await importer('lib/work-zones.ts')
  P = await importer('lib/matching/lecture-paginee.ts')
  S = await importer('lib/taxonomie/specialite-seule.ts')
} catch (err) {
  console.error('✘ un module ne se charge pas — le contrôle ne tourne pas', err)
  process.exit(2)
}

const zones = [
  { id: 'W', parent_id: null, kind: 'world', code: 'WORLD', country_code: null, name: 'Monde entier', slug: 'w' },
  { id: 'EU', parent_id: 'W', kind: 'continent', code: 'EU', country_code: null, name: 'Europe', slug: 'eu' },
  { id: 'AF', parent_id: 'W', kind: 'continent', code: 'AF', country_code: null, name: 'Afrique', slug: 'af' },
  { id: 'FR', parent_id: 'EU', kind: 'country', code: 'C_FR', country_code: 'FR', name: 'France', slug: 'fr' },
  { id: 'DE', parent_id: 'EU', kind: 'country', code: 'C_DE', country_code: 'DE', name: 'Allemagne', slug: 'de' },
  { id: 'ES', parent_id: 'EU', kind: 'country', code: 'C_ES', country_code: 'ES', name: 'Espagne', slug: 'es' },
  { id: 'MA', parent_id: 'AF', kind: 'country', code: 'C_MA', country_code: 'MA', name: 'Maroc', slug: 'ma' },
]
const SEL = sansCommentaires(lire('components/ui/WorkZoneSelector.tsx'))

// ══════════════════════════════════════════════════════════════════════════
section('1 et 2. La saisie par continent — et ce qui s’enregistre')
// ══════════════════════════════════════════════════════════════════════════
ok(Z.paysDe(zones, 'EU').map((z) => z.id).join() === 'FR,DE,ES', 'un continent déplie SES pays, dans l’ordre du référentiel')
ok(Z.choisirContinentEntier(zones, [], 'EU', true).join() === 'EU', '« Tout le continent » coché enregistre LE CONTINENT')
ok(Z.choisirContinentEntier(zones, ['FR', 'MA'], 'EU', true).sort().join() === 'EU,MA', '« Tout le continent » remplace ses pays déjà cochés, garde les autres')
ok(Z.choisirContinentEntier(zones, ['EU', 'MA'], 'EU', false).join() === 'MA', '« Tout le continent » décoché retire le continent (et aucun de ses pays ne reste)')
ok(Z.choisirContinentEntier(zones, ['W'], 'EU', true).join() === 'EU', 'depuis « Partout dans le monde », choisir un continent efface le monde')
ok(Z.basculerPays(zones, [], 'FR').join() === 'FR' && Z.basculerPays(zones, ['FR', 'DE'], 'FR').join() === 'DE',
  'une case de pays coche CE pays, et le décoche')
ok(Z.basculerPays(zones, ['EU', 'MA'], 'FR').sort().join() === 'DE,ES,MA',
  'décocher la France de « Europe — tout le continent » laisse les AUTRES pays cochés (et Maroc)')
ok(Z.basculerPays(zones, ['FR', 'DE'], 'ES').sort().join() === 'DE,ES,FR' && !Z.basculerPays(zones, ['FR', 'DE'], 'ES').includes('EU'),
  'cocher tous les pays un par un enregistre CES pays, jamais le continent (un pays ajouté plus tard n’y entre pas)')
{
  const e1 = Z.etatDuContinent(zones, ['EU'], 'EU')
  const e2 = Z.etatDuContinent(zones, ['FR', 'MA'], 'EU')
  ok(e1.entier && e1.coches.length === 3 && !e2.entier && e2.coches.join() === 'FR', 'l’état d’un continent : entier (tous ses pays cochés) ou ses pays cochés')
}
ok(Z.continentDe(zones, 'FR')?.id === 'EU' && Z.continentDe(zones, 'EU') === null, 'la recherche sait dans quel continent cocher un pays')
ok(Z.libelleDeZone(zones[1], '{zone} — tout le continent') === 'Europe — tout le continent' && Z.libelleDeZone(zones[3], '{zone} — tout le continent') === 'France',
  'le libellé : « Europe — tout le continent », un pays garde son nom')

// L'écran
ok(/aria-expanded=\{ouvert\}/.test(SEL) && /onClick=\{\(\) => setDeplie\(ouvert \? null : c\.id\)\}/.test(SEL),
  'un clic sur un continent le DÉPLIE (bouton aria-expanded)')
{
  const panneau = SEL.slice(SEL.indexOf('{ouvert ? ('))
  ok(panneau.indexOf("t('tout_le_continent')") > 0 && panneau.indexOf("t('tout_le_continent')") < panneau.indexOf('paysDe(liste, c.id)'),
    '« Tout le continent » EN TÊTE, puis une case par pays')
  ok(/type="checkbox"[\s\S]{0,80}checked=\{etat\.entier\}[\s\S]{0,80}cocherContinent\(c\.id, e\.target\.checked\)/.test(panneau)
     && /type="checkbox"[\s\S]{0,80}checked=\{etat\.coches\.includes\(p\.id\)\}[\s\S]{0,80}cocherPays\(p\.id\)/.test(panneau),
    'des cases NATIVES (clavier, toucher) : le continent par choisirContinentEntier, le pays par basculerPays')
}
ok(SEL.indexOf("t('selection_label')") > 0 && SEL.indexOf("t('selection_label')") < SEL.indexOf('role="combobox"')
   && SEL.indexOf('role="combobox"') < SEL.indexOf("t('continents_label')"),
  'ce qui est choisi s’affiche AU-DESSUS, en étiquettes ; puis la recherche ; puis les continents')
ok(/const choisirPays = \(z: WorkZone\) => \{[\s\S]{0,200}cocherPays\(z\.id\)[\s\S]{0,80}setDeplie\(continentDe\(liste, z\.id\)\?\.id \?\? null\)/.test(SEL),
  'la recherche est un RACCOURCI : le pays trouvé se coche dans son continent, qui se déplie')
ok((SEL.match(/minHeight: 4[48]/g) ?? []).length >= 3, 'aussi simple au doigt : lignes et boutons de 44 px au moins')
// Relecture du 02/10/2026 (BLOQUANT) : ce contrôle EXIGEAIT `libelleDeZone(z, t('continent_entier'))` — un appel SANS la
// variable {zone}, que next-intl rend par le NOM DE LA CLÉ. Il garde désormais l'appel AVEC sa variable, et
// diag-variables-i18n interdit la classe dans tout le code.
ok(/const nommer = \(z: \{ kind: string; name: string \}\) => \(z\.kind === 'continent' \? t\('continent_entier', \{ zone: z\.name \}\) : z\.name\)/.test(SEL)
   && (SEL.match(/nommer\((suggestion|z|couvrante)\)/g) ?? []).length === 3 && !/t\('continent_entier'\)/.test(SEL),
  'l’étiquette d’un continent dit « Europe — tout le continent » : le gabarit appelé AVEC sa variable {zone}, aux trois endroits')
// Point 13 de l'ARRÊT 24, conservé
ok(/role="radiogroup"[^>]*onKeyDown=\{clavierRadio\}/.test(SEL) && (SEL.match(/tabIndex=\{rangChoisi === /g) ?? []).length === 2
   && /aria-activedescendant=\{listeOuverte && resultats\[actif\] \? idOption\(actif\) : undefined\}/.test(SEL)
   && /onBlur=\{\(\) => setOuverte\(false\)\}/.test(SEL) && /if \(!z\) \{[\s\S]{0,200}t\('zone_retiree'\)/.test(SEL),
  'les corrections de l’ARRÊT 24 tiennent : flèches du groupe radio, option active annoncée, liste fermée au départ du focus, zone retirée visible')
// Les mots
{
  const citees = clesCitees(SEL, 't', 'work_zones')
  const manquantes = citees.filter((c) => !dans4(c))
  ok(citees.length >= 18 && manquantes.length === 0, `les ${citees.length} textes du sélecteur existent dans les quatre langues`, manquantes.join(', '))
  ok(MSG.fr.work_zones.mode_monde_aide === 'Tous les pays proposés' && LANGUES.every((l) => !/\{count\}/.test(MSG[l].work_zones.mode_monde_aide)),
    '« Couvre les 64 pays du référentiel » est devenu « Tous les pays proposés » (quatre langues, sans nombre)')
  ok(MSG.fr.work_zones.continent_entier === '{zone} — tout le continent' && MSG.en.work_zones.continent_entier === '{zone} — whole continent'
     && MSG.es.work_zones.continent_entier === '{zone} — todo el continente' && MSG.de.work_zones.continent_entier === '{zone} — ganzer Kontinent',
    'la formule neutre, dans les quatre langues (décision de Youssef)')
  const textes = LANGUES.flatMap((l) => Object.values(MSG[l].work_zones))
  const techniques = textes.filter((t) => /r[ée]f[ée]rent|referen|\buuid\b|\biso\b|\bcode\b/i.test(t))
  ok(techniques.length === 0, 'aucun mot technique à l’écran des zones (référentiel, code, ISO…)', techniques.join(' | '))
}
// Le recalcul du référentiel : par déclencheur, en base
{
  const m = migration('zones_couverture_suit_le_referentiel')
  ok(/after insert or update of parent_id, active, country_code or delete on public\.work_zones/.test(m)
     && /perform public\.recalculer_couverture_des_zones\(/.test(m),
    '2. un pays ajouté, déplacé, activé, désactivé ou supprimé recalcule la couverture — par DÉCLENCHEUR, jamais dans une route')
  ok(/set work_zone_ids = p\.work_zone_ids/.test(m) && /is distinct from public\.work_zone_country_codes\(p\.work_zone_ids\)/.test(m),
    '2. le recalcul passe par la source unique (réécrire work_zone_ids déclenche sync_work_zone_countries), et ne touche que ce qui change')
}

// ══════════════════════════════════════════════════════════════════════════
section('2 bis. Les pays d’une base construite depuis zéro sont rattachés (§E.92, résolu)')
// ══════════════════════════════════════════════════════════════════════════
{
  const correspondance = (sql) => {
    const i = sql.indexOf('iso_continent(country_code, continent_code) as (values')
    const fin = "('VU','OC'),('WS','OC')"
    const bloc = i < 0 ? '' : sql.slice(i, sql.indexOf(fin, i) + fin.length)
    return [...bloc.matchAll(/\('([A-Z]{2})','([A-Z]{2})'\)/g)].map((m) => `${m[1]}>${m[2]}`)
  }
  const origine = correspondance(migration('referentiel_zones_de_travail'))
  const m = migration('zones_pays_rattaches')
  const neuve = correspondance(m)
  ok(origine.length > 190 && neuve.join() === origine.join(),
    `le MÊME rattachement que la migration d’origine (${neuve.length} couples, égaux un à un et dans l’ordre)`)
  // ANCRÉ sur l'insertion (§E.8) : le filet de fin de migration porte le même `not exists`, et un contrôle lâché sur
  // tout le fichier restait vert quand la garde de l'insertion était retirée (trouvé par mutation).
  const insertion = m.slice(m.indexOf('ajoutes as ('), m.indexOf('returning id, country_code'))
  ok(/and not exists \(select 1 from public\.work_zones w where w\.country_code = co\.code\)\s*on conflict \(code\) do nothing\s*$/.test(insertion)
     && !/\bupdate public\.|\bdelete from public\./.test(m),
    'rien de ce qui est DÉJÀ rattaché n’est touché : seuls les pays sans zone, aucun update, aucun delete')
  ok(/raise notice 'zones de travail : % pays rattaché\(s\)/.test(m), 'elle dit ce qu’elle a fait : « N pays rattaché(s) » (0 sur staging, 64 sur une base neuve)')
  ok(/join public\.work_zones cont on cont\.code = ic\.continent_code and cont\.kind = 'continent'/.test(m) && /where co\.active = true/.test(m),
    'chaque pays ACTIF, sous son CONTINENT')
  const fichiers = readdirSync(join(ROOT, 'supabase', 'migrations')).sort()
  const rang = (s) => fichiers.findIndex((f) => f.endsWith(`_${s}.sql`))
  ok(rang('zones_pays_rattaches') > rang('zones_couverture_suit_le_referentiel') && rang('zones_pays_rattaches') > rang('specialite_reactivation_hors_autre'),
    'horodatée après les deux migrations du lot (le déclencheur de couverture tourne pour chaque pays ajouté)')
  const t = sansCommentairesSql(lire('supabase/tests/database/matching/zones_pays_rattaches.test.sql'))
  ok(/select plan\(5\)/.test(t) && /cardinality\(v_actifs\) > 0/.test(t) && /public\.work_zone_country_codes\(array\[v_monde\]\), v_actifs/.test(t),
    'le test de base : une garde contre le vide, chaque pays actif sous un continent, « Partout dans le monde » = tous les pays actifs')
}

// ══════════════════════════════════════════════════════════════════════════
section('3. Toutes les surfaces, le même composant ; l’affichage dit le continent entier')
// ══════════════════════════════════════════════════════════════════════════
{
  const SURFACES = ['app/[locale]/dashboard/freelance/profil/valider/page.tsx', 'app/[locale]/dashboard/cdi/profil/valider/page.tsx',
    'components/dashboard/PublicationForm.tsx', 'components/collaboration/SousTraitanceView.tsx']
  // Le sélecteur, rendu par la surface — ou par le composant des champs d'annonce qu'elle rend (lot « critères des
  // annonces », §D.39 : l'annonce d'organisation et le besoin de sous-traitance rendent components/annonces/ChampsAnnonce.tsx).
  const rendLeSelecteur = (src) => /import WorkZoneSelector from '@\/components\/ui\/WorkZoneSelector'/.test(src) && /<WorkZoneSelector/.test(src)
  const champsAnnonce = lire('components/annonces/ChampsAnnonce.tsx')
  const sans = SURFACES.filter((p) => !rendLeSelecteur(lire(p))
    && !(/import ChampsAnnonce\b[^\n]*from '@\/components\/annonces\/ChampsAnnonce'/.test(lire(p)) && /<ChampsAnnonce\b/.test(lire(p)) && rendLeSelecteur(champsAnnonce)))
  ok(sans.length === 0, 'validation (freelance, CDI), annonce d’organisation, sous-traitance : le MÊME WorkZoneSelector', sans.join(', '))
  const synth = sansCommentaires(lire('lib/publication-synthesis.ts'))
  ok(/from\('work_zones'\)\.select\('id, name, kind'\)/.test(synth) && /libelleZoneServeur\(\{ kind: z\.kind, name: tBDD\(translations, 'work_zones'/.test(synth),
    'cartes et détail d’annonce : le libellé d’une zone passe par « {zone} — tout le continent » (loadReferentielLabels)')
  const appels = ['app/api/me/candidatures/route.ts', 'app/api/me/missions/route.ts', 'app/api/me/missions/[id]/route.ts', 'app/api/publications/route.ts', 'app/api/publications/[id]/route.ts']
    .filter((p) => !/loadReferentielLabels\([\s\S]{0,200}translations,\s*[\w[\]]+,\s*locale,\s*\)/.test(sansCommentaires(lire(p))))
  ok(appels.length === 0, 'les cinq routes qui nomment les zones passent la langue de l’écran', appels.join(', '))
  const serveur = lire('lib/zones/libelle-serveur.ts')
  ok(/fr\.work_zones\.continent_entier/.test(serveur) && /libelleDeZone\(zone, gabaritContinentEntier\(locale\)\)/.test(serveur),
    'le serveur lit LE MÊME gabarit que l’écran (un mot, un endroit)')
  const admin = sansCommentaires(lire('app/api/admin/get-expert/[id]/route.ts'))
  const page = sansCommentaires(lire('app/[locale]/admin/experts/[id]/page.tsx'))
  ok(/zones_de_travail: idsZones/.test(admin) && /libelleZoneServeur\(/.test(admin) && /\?locale=\$\{encodeURIComponent\(locale\)\}/.test(page)
     && /t\('work_zones'\)[\s\S]{0,80}e\.zones_de_travail/.test(page) && dans4('admin_back_office.experts.work_zones'),
    'la fiche admin montre « Zones de travail », nommées dans la langue de l’écran')
}

// ══════════════════════════════════════════════════════════════════════════
section('4. Sans changement, rien ne s’écrit ni ne se relance')
// ══════════════════════════════════════════════════════════════════════════
{
  ok(Z.memesZones(['EU', 'MA'], ['MA', 'EU']) && !Z.memesZones(['EU'], ['EU', 'MA']) && Z.memesZones(null, []) && !Z.memesZones(['EU'], ['FR']),
    'les zones se comparent comme un ENSEMBLE (l’ordre ne change rien)')
  const r = sansCommentaires(lire('app/api/profile/route.ts'))
  ok(/patch\.work_zone_ids = memesZones\(ids, cp\.work_zone_ids as string\[\] \| null\) \? cp\.work_zone_ids : ids/.test(r),
    'la même sélection dans un autre ordre garde la valeur LUE — « Profil modifié » ne la nomme pas')
  ok(/blocsModifies\.length === 0 \? \{ error: null \} : await supabaseAdmin\.rpc\('remplacer_listes_profil'/.test(r),
    'aucune liste ne change : la base n’est pas appelée ; sinon seules celles qui changent sont remplacées')
  ok(/const ecrireLesChamps = shouldUpdateScalars && champsReellementModifies\.length > 0/.test(r) && /if \(ecrireLesChamps\) \{\s*const \{ data: updated, error: updateErr \}/.test(r),
    'aucun champ ne change : aucune écriture du profil')
  const iSortie = r.indexOf('if (!aChange && body.visible !== true) {')
  ok(iSortie > 0 && iSortie < r.indexOf("action: 'profile_update'") && iSortie < r.indexOf('after(async () => {'),
    'sans changement (et hors « publier ») : la route répond AVANT l’audit et AVANT la relance')
  ok(/if \(!aChange\) return\s*\n\s*const \{ programmerRelance \}/.test(r), 'une republication sans changement ne relance pas la recherche')
  ok(/memesZones\(u\.updates\.work_zone_ids as string\[\], avantAnnonce\.work_zone_ids/.test(sansCommentaires(lire('app/api/publications/[id]/route.ts'))),
    'l’annonce aussi : la même sélection de zones n’est pas une modification')
  ok(/'work_zone_ids'/.test(lire('lib/journal/phrase.ts')), 'un vrai changement de zones reste « Profil modifié » (champ nommé, aucune action nouvelle, aucun code pays)')
}

// ══════════════════════════════════════════════════════════════════════════
section('6. La spécialité désactivée : l’expert est prévenu ; réactivée, elle ne revient pas sous « Autre »')
// ══════════════════════════════════════════════════════════════════════════
{
  const actives = new Set(['s2'])
  ok(S.etaitLaSeule('s1', ['s1'], null, actives) && S.etaitLaSeule('s1', ['s1', 's3'], '  ', actives)
     && !S.etaitLaSeule('s1', ['s1', 's2'], null, actives) && !S.etaitLaSeule('s1', ['s1'], 'FinOps', actives),
    '« seule spécialité » : aucune autre ACTIVE (une autre désactivée ne compte pas) et aucune précision « Autre »')
  const route = sansCommentaires(lire('app/api/admin/update-speciality/route.ts'))
  ok(/const desactivation = updates\.active === false && sp\.active === true/.test(route)
     && /const rejeuPrevenir = body\.prevenir === true && sp\.active === false/.test(route)
     && /if \(desactivation \|\| rejeuPrevenir\) \{\s*const prevenir = await notifierRetraitSpecialite\(auth\.supabaseAdmin, \{[\s\S]{0,160}piece: pieceDeDesactivation as string/.test(route),
    'au PASSAGE d’active à inactive (et au rejeu « Prévenir les experts »), les avis partent sous la pièce de LA désactivation')
  // Point 5 de la relecture : une ligne du journal refusée n'empêche plus d'avertir, et chaque manque se dit séparément.
  {
    const iLigne = route.indexOf('const ligne = await taxonomieModifiee(')
    const iAvis = route.indexOf('const prevenir = await notifierRetraitSpecialite(')
    ok(iLigne > 0 && iAvis > iLigne && !/if \(!ligne\.ok\) \{[\s\S]{0,200}return json/.test(route.slice(iLigne, iAvis))
       && /code: 'journal_et_experts'/.test(route) && /code: 'experts_non_prevenus'/.test(route) && /code: 'journal_error'/.test(route),
      'point 5 : une ligne du journal refusée N’EMPÊCHE PLUS d’avertir ; journal, avis, ou les deux : chacun se dit')
  }
  const notif = sansCommentaires(lire('lib/taxonomie/retrait-specialite.ts'))
  ok(/lireToutesLesLignes<LigneProfil>/.test(notif) && /\.contains\('speciality_ids', \[args\.specialiteId\]\)/.test(notif) && /lectureIncomplete\(lecture\)/.test(notif),
    'TOUS les profils qui la portent sont lus, par pages, et une lecture incomplète est une panne')
  const mAvis = migration('specialite_ecriture_et_avis_une_fois')
  ok(/resolveNotificationLocale\(compte\?\.locale/.test(notif) && /tBDD\(await loadTranslations\(locale\), 'specialities'/.test(notif)
     && /\/profil\/valider`/.test(notif) && /\.rpc\('prevenir_retrait_specialite', \{ p_notifications: lignes \}\)/.test(notif)
     && /'specialite_retiree', 'inapp'/.test(mAvis),
    'dans l’application, DANS SA LANGUE (le nom de la spécialité aussi), avec un lien vers la validation du profil')
  ok(/create unique index if not exists notifications_retrait_specialite_une_fois\s+on public\.notifications \(user_id, entity_id, piece\)\s+where type = 'specialite_retiree'/.test(mAvis)
     && /on conflict \(user_id, entity_id, piece\) where type = 'specialite_retiree' do nothing/.test(mAvis)
     && !/from\('notifications'\)\.insert/.test(notif),
    'point 5 : UN avis par expert et par désactivation — index unique partiel, conflit résolu EN SQL avec son prédicat (§E.69), aucun insert direct')
  ok(/desactivation_piece = case when v_apres then null when v_avant then p_piece else s\.desactivation_piece end/.test(mAvis)
     && /update public\.specialities s set desactivation_piece = p_piece where s\.id = p_id and s\.desactivation_piece is null/.test(mAvis),
    'point 5 : la pièce de la désactivation — posée au passage à inactive, gardée par un rejeu, effacée à la réactivation')
  const page = sansCommentaires(lire('app/[locale]/admin/taxonomie/[id]/page.tsx'))
  // Revu par le lot alertes (mineur du relecteur) : le refus de la base se dit par son MOTIF nommé — le message brut de
  // Postgres ne sort plus vers l'écran (`diag-alertes-recommandations` garde chaque motif et sa phrase).
  ok(/body: JSON\.stringify\(\{ id: specId, prevenir: true \}\)/.test(page) && /t\('action_prevenir_experts'\)/.test(page)
     && /code === 'journal_et_experts'/.test(page) && /code === 'journal_error'/.test(page)
     && /if \(code === 'ecriture_refusee'\) \{/.test(page) && !/\{ cause:/.test(page),
    'l’écran dit ce qui n’a pas été fait, et propose « Prévenir les experts » (seuls les oubliés le seront)')
  const manquantes = ['specialite_retiree.titre', 'specialite_retiree.corps', 'specialite_retiree.corps_seule', 'admin_taxonomie.err_experts_non_prevenus',
    'admin_taxonomie.err_journal_et_experts', 'admin_taxonomie.err_journal_non_ecrit', 'admin_taxonomie.err_ecriture_refusee', 'admin_taxonomie.action_prevenir_experts'].filter((c) => !dans4(c))
  ok(manquantes.length === 0 && LANGUES.every((l) => MSG[l].specialite_retiree.titre.includes('{specialite}')),
    'les textes, dont la variante « seule spécialité », existent dans les quatre langues', manquantes.join(', '))
  ok(/const reactivation = updates\.active === true && sp\.active === false/.test(route)
     && route.indexOf("if (deja === 'autre')") > 0 && route.indexOf("if (deja === 'autre')") < route.indexOf(".rpc('modifier_specialite'"),
    'réactiver : les traductions qui RESTERONT sont demandées à la base AVANT toute écriture (« Other », « Otra »)')
  // Point 4 de la relecture : traductions et spécialité, TOUT OU RIEN, et la vraie cause d'un refus.
  {
    const mModif = mAvis.slice(mAvis.indexOf('function public.modifier_specialite('), mAvis.indexOf('function public.prevenir_retrait_specialite('))
    ok(!/\.from\('translations'\)\.(upsert|insert|update|delete)|\.from\('specialities'\)\.update/.test(route)
       && mModif.indexOf('insert into public.translations') > 0 && mModif.indexOf('insert into public.translations') < mModif.indexOf('update public.specialities s'),
      'point 4 : traductions et spécialité s’écrivent en UNE transaction (modifier_specialite), traductions d’abord — aucune écriture directe dans la route')
    ok(/if \(\/\^2\[23\]\/\.test\(ecrErr\.code \?\? ''\)\) \{\s*return json\(\{ error: 'Write refused', code: 'ecriture_refusee', motif: motifDuRefus\(ecrErr\.code\) \}, 400\)/.test(route)
       && !/cause: ecrErr\.message/.test(route),
      'point 4 : un refus de la base se rend avec son MOTIF nommé (ecriture_refusee) — rien n’a été écrit, et le message brut reste au journal du serveur')
  }
  const m = migration('specialite_reactivation_hors_autre')
  ok(/before update of active on public\.specialities/.test(m) && /public\.est_specialite_autre\(t\.value, null\)/.test(m)
     && /errcode = '23514'/.test(m) && /specialities_autre_hors_referentiel/.test(m),
    'la base le tient : 23514 sous le nom de la contrainte, ce que la route rend specialite_autre_reservee')
}

// ══════════════════════════════════════════════════════════════════════════
section('6 bis. Aucune migration citée par son numéro dans les fichiers du lot (§G.3)')
// ══════════════════════════════════════════════════════════════════════════
{
  // Relecture du 02/10/2026, point 6 : deux migrations étaient citées par leur numéro dans `zones_pays_rattaches`. Le
  // contrôle lit le TEXTE ENTIER (commentaires compris : c'est là qu'on cite) ; des lookarounds sur les chiffres, jamais
  // `\b` (un horodatage est suivi d'un `_`, caractère de mot — §G.3).
  const FICHIERS = [
    ...['zones_couverture_suit_le_referentiel', 'specialite_reactivation_hors_autre', 'zones_pays_rattaches', 'specialite_ecriture_et_avis_une_fois']
      .map((s) => `supabase/migrations/${readdirSync(join(ROOT, 'supabase', 'migrations')).find((f) => f.endsWith(`_${s}.sql`))}`),
    'supabase/tests/database/matching/zones_recoupement.test.sql', 'supabase/tests/database/matching/zones_pays_rattaches.test.sql',
    'supabase/tests/database/taxonomie/reactivation_hors_autre.test.sql', 'supabase/tests/database/taxonomie/specialite_ecriture_et_avis.test.sql',
  ]
  const cites = FICHIERS.flatMap((f) => lire(f).split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => /(?<!\d)20\d{12}(?!\d)/.test(l)).map(([f, n]) => `${f}:${n}`))
  ok(cites.length === 0, `les ${FICHIERS.length} migrations et tests du lot citent les migrations par leur NOM`, cites.join(', '))
}

// ══════════════════════════════════════════════════════════════════════════
section('7. Les noms des langues, lus en entier')
// ══════════════════════════════════════════════════════════════════════════
{
  // Une API qui coupe à 1 000 lignes, comme PostgREST : 2 500 noms, rendus page par page dans l'ordre demandé.
  const noms = Array.from({ length: 2500 }, (_, i) => ({ nom: `langue ${String(i).padStart(4, '0')}`, code: 'xx' }))
  const fausseApi = (opt) => {
    if (opt?.head) return Promise.resolve({ data: null, error: null, count: noms.length })
    let tri = null
    const q = {
      order: (col) => { tri = col; return q },
      range: (a, b) => Promise.resolve({ data: [...noms].sort((x, y) => (x[tri] < y[tri] ? -1 : 1)).slice(a, Math.min(b, a + 999) + 1), error: null }),
    }
    return q
  }
  const lu = await P.lireToutesLesLignes({ construire: fausseApi, departageUnique: 'nom', identite: (l) => l.nom, contexte: 'épreuve' })
  ok(lu.lignes.length === 2500 && !P.lectureIncomplete(lu) && new Set(lu.lignes.map((l) => l.nom)).size === 2500,
    `2 500 noms, une API qui coupe à 1 000 : ${lu.lignes.length} lus, aucun en double (EXÉCUTÉ)`)
  const ex = sansCommentaires(lire('lib/travaux-ia/executer-analyse.ts'))
  ok(/lireToutesLesLignes<NomDeLangueConnu>\(\{\s*construire: \(o\) => admin\.from\('langues_noms'\)\.select\('nom, code', o\),\s*departageUnique: 'nom'/.test(ex)
     && /lectureIncomplete\(nomsLus\)/.test(ex) && !/from\('langues_noms'\)\.select\('nom, code'\)\s*,/.test(ex),
    'l’analyse du CV lit langues_noms par pages (ordre total sur la clé `nom`), et une lecture incomplète est une panne rejouée')
  const autres = ['app', 'lib', 'components'].flatMap(function f(d) {
    return readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? f(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : [])
  }).filter((p) => p !== 'lib/travaux-ia/executer-analyse.ts' && /from\('langues_noms'\)/.test(sansCommentaires(lire(p))))
  ok(autres.length === 0, 'aucune autre lecture de langues_noms dans le code', autres.join(', '))
}

// ══════════════════════════════════════════════════════════════════════════
section('9. L’annonce de sous-traitance porte la branche et les zones, et dit chaque refus')
// ══════════════════════════════════════════════════════════════════════════
{
  const st = sansCommentaires(lire('components/collaboration/SousTraitanceView.tsx'))
  const formulaire = sansCommentaires(lire('lib/annonces/formulaire.ts'))
  const champs = sansCommentaires(lire('components/annonces/ChampsAnnonce.tsx'))
  ok(/<ChampsAnnonce type="sous_traitance" valeurs=\{valeurs\}/.test(st)
     && /corpsDeRequete\(valeurs, 'sous_traitance', \(id\) => referentiel\?\.work_zones\.find\(\(z\) => z\.id === id\)\?\.code\)/.test(st)
     && /branch_id: v\.branch_id \|\| null,/.test(formulaire) && /work_zone_codes: v\.work_zone_ids\.map\(codeDeZone\)/.test(formulaire)
     && /<select\s+id="sk-annonce-branche"/.test(champs) && /<WorkZoneSelector/.test(champs),
    'le formulaire envoie la BRANCHE et les ZONES (en codes), par le composant et le corps de l’annonce d’organisation')
  ok(/const fautes = erreursDeSaisie\(valeurs, 'sous_traitance'\)/.test(st) && /return missingForPublish\(\{/.test(formulaire)
     && /for \(const champ of manquantsPourPublier\(v\)\)/.test(formulaire),
    'avant d’envoyer : le MÊME prédicat que /publish (missingForPublish, par erreursDeSaisie), les champs manquants nommés')
  ok(/pub\.code === 'missing_fields' && Array\.isArray\(pub\.missing\)/.test(st) && /messageDuRefus\(pub\.code, t\('errors\.publish_failed'\)\)/.test(st),
    'un refus de /publish se DIT : les champs nommés, chaque code connu traduit — « la publication a échoué » n’est que le dernier recours')
  // LES CODES SONT DÉRIVÉS des routes que le formulaire appelle (§E.61 : une liste tenue à la main ne protège que ce
  // qu'on a pensé à lui donner — la relecture du 02/10/2026 en a trouvé deux oubliés : compte illisible, offre absente).
  const SOURCES = ['app/api/publications/route.ts', 'app/api/publications/[id]/route.ts', 'app/api/publications/[id]/publish/route.ts',
    'lib/collaboration/ensure-personal-org.ts', 'lib/expert-verified-guard.ts', 'lib/durees.ts', 'lib/auth-guard.ts',
    // Les refus des critères (lot « critères des annonces ») : rendus par les deux routes, écrits ici.
    'lib/annonces/criteres.ts']
  const derives = new Set(SOURCES.flatMap((f) => [...sansCommentaires(lire(f)).matchAll(/(?:code|error):\s*'([a-z][a-z_]+)'|_CODE = '([a-z_]+)'/g)].map((m) => m[1] ?? m[2])))
  // Ceux qui ne passent PAS par messageDuRefus, chacun avec sa raison (§G.8).
  const AILLEURS = {
    missing_fields: 'LÉGITIME — traité à part : les champs nommés sous chacun d’eux',
    quota_publications_reached: 'LÉGITIME — le mur « Bientôt disponible » (phase wall)',
    active_publications_limit_reached: 'LÉGITIME — le mur « Bientôt disponible » (phase wall)',
    invalid_type: 'LÉGITIME — le type est écrit par le formulaire (sous_traitance), jamais saisi',
    invalid_json: 'LÉGITIME — le corps est construit par le formulaire, jamais saisi',
    org_required: 'LÉGITIME — la route de création résout l’organisation personnelle elle-même pour une sous-traitance',
    not_found: 'LÉGITIME — le brouillon repris est celui que la route vient de rendre ; à défaut, le repli « de notre côté » est juste',
    forbidden: 'LÉGITIME — le brouillon repris appartient à l’expert ; à défaut, le repli « de notre côté » est juste',
    user_missing: 'LÉGITIME — un compte connecté sans ligne users : de notre côté, le repli le dit',
    db_error: 'LÉGITIME — panne de notre côté : le repli dit exactement cela (create_failed, publish_failed)',
    internal_error: 'LÉGITIME — panne de notre côté : le repli dit exactement cela',
    journal_error: 'LÉGITIME — le besoin est écrit, sa ligne manque : le repli « de notre côté » est juste',
    missing_env: 'LÉGITIME — le serveur est mal configuré : de notre côté, le repli le dit',
    organization_lookup_failed: 'LÉGITIME — une lecture en panne (503) : de notre côté, le repli le dit',
    insufficient_role: 'LÉGITIME — l’expert est administrateur de SON organisation personnelle (ensurePersonalOrg l’y inscrit admin)',
    org_not_approved: 'LÉGITIME — levé par requireOrgApproved, qu’aucune des trois routes n’appelle',
    // ── LA GARDE D'IDENTITÉ (lib/auth-guard.ts) — chaque code nommé, avec SA raison (relecteur, 02/10/2026 : elle était
    //    écartée en bloc par une expression, et un code nouveau de la garde y serait entré sans que personne le lise).
    session_superseded: 'LÉGITIME — intercepté par useSecureFetch : l’onglet se déconnecte et la page de connexion dit « session remplacée »',
    account_suspended: 'LÉGITIME — intercepté par useSecureFetch : redirection vers la connexion, qui dit « compte suspendu »',
    account_deletion_scheduled: 'LÉGITIME — intercepté par useSecureFetch : redirection vers la réactivation du compte',
    account_anonymized: 'LÉGITIME — la purge RGPD bannit le login (users.anonymized_at) : seul un jeton encore en vol l’atteint, et aucune saisie ne le corrige',
    ecosysteme_non_configure: 'LÉGITIME — le serveur est mal configuré (racine d’adresse absente, 500) : le repli « de notre côté » est exact',
  }
  // Un code est « dit » par le formulaire, ou par les refus COMMUNS avec l'annonce d'une organisation (lib/annonces/formulaire.ts).
  const nonDits = [...derives].filter((c) => !(c in AILLEURS) && !new RegExp(`case '${c}':`).test(st) && !new RegExp(`case '${c}':`).test(formulaire))
  ok(derives.size > 15 && nonDits.length === 0,
    `les ${derives.size} codes que la création et la publication peuvent rendre ont chacun leur phrase, ou leur raison d’aller au repli`, nonDits.join(', '))
  ok(/case 'compte_verification_indisponible': return t\('errors\.compte_illisible'\)/.test(st) && /case 'package_missing': return t\('errors\.offre_indisponible'\)/.test(st),
    'relecture du 02/10/2026 : le compte illisible et l’offre absente disent chacun leur vérité')
  ok(LANGUES.every((l) => !/champs|fields|campos|Felder/i.test(MSG[l].collaboration.errors.create_failed)),
    'le repli de la création ne dit plus « vérifiez les champs » (chaque champ fautif est nommé par son propre code)')
  const cles = [...clesCitees(st, 't', 'collaboration'), ...clesCitees(st, 'tPub', 'publications'), ...clesCitees(st, 'tCrit', 'criteres'),
    ...clesCitees(formulaire, 'tPub', 'publications'), ...clesCitees(formulaire, 'tCrit', 'criteres')].filter((c) => !dans4(c))
  ok(cles.length === 0, 'chaque texte du formulaire existe dans les quatre langues', cles.join(', '))
  ok(/let id = brouillonId/.test(st) && /method: 'PATCH'/.test(st) && /setBrouillonId\(id\)/.test(st),
    'une publication refusée se reprend sur le MÊME brouillon (plus un brouillon par essai)')
  ok(/setPhase\(pub\.status === 'pending_review' \? 'pending' : 'published'\)/.test(st),
    'un besoin relu avant sa mise en ligne ne s’annonce pas « publié »')
}

console.log(echecs === 0 ? '\n✅ diag-lot-zones : tout est vert.' : `\n❌ diag-lot-zones : ${echecs} contrôle(s) rouge(s).`)
process.exit(echecs === 0 ? 0 : 1)
