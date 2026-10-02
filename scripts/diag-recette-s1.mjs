/**
 * diag-recette-s1.mjs — LES QUATORZE CORRECTIONS DE LA RECETTE STAGING DU 01/10/2026 (S1, parcours expert).
 *
 * Chaque correction est gardée par sa PROPRIÉTÉ (§E.34), et ce qui peut l'être est EXÉCUTÉ (§E.33) :
 * les tranches de séniorité, la saisie des zones, le rattachement des langues, la normalisation d'un CV,
 * l'état affiché du profil, le lien du CV (avec un stockage simulé) tournent ici sur des cas fabriqués.
 *
 * CE QU'IL NE VOIT PAS, ET IL FAUT LE LIRE :
 *   · la base : les migrations sont LUES — leur comportement est prouvé par pgTAP
 *     (taxonomie/autre_hors_referentiel, profil/langues_liste_fermee), que seul `npx supabase test db --local`
 *     fait tourner ;
 *   · un navigateur : le survol, le toucher et le clavier de l'info-bulle, la saisie des zones, se lisent
 *     dans le code ; aucun navigateur de test ;
 *   · le modèle : que le vérificateur suive ses nouvelles consignes (missions, chevauchements, tranches)
 *     ne se prouve que sur un vrai dossier — la note d'un expert d'essai, sur staging.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
// §E.7 : les commentaires ne prouvent rien.
const sansCommentaires = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/ .*$/, ''))).join('\n')
const sansCommentairesSql = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
const importer = (p) => import(pathToFileURL(join(ROOT, p)).href)

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    echecs++
    console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`)
  }
}
const section = (t) => console.log(`\n── ${t}`)

const LANGUES = ['fr', 'en', 'es', 'de']
const MSG = Object.fromEntries(LANGUES.map((l) => [l, JSON.parse(lire(`messages/${l}.json`))]))
const cle = (o, p) => p.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o)
const dans4 = (p) => LANGUES.every((l) => typeof cle(MSG[l], p) === 'string' && cle(MSG[l], p).trim() !== '')
/** Toutes les clés citées par `fn('…')` dans un texte, préfixées. */
const clesCitees = (src, fn, prefixe) => [...src.matchAll(new RegExp(`\\b${fn}\\('([a-zA-Z0-9_.]+)'`, 'g'))].map((m) => `${prefixe}.${m[1]}`)

/** La migration au suffixe donné — jamais par numéro (§G.3) ; refuse zéro ou deux correspondances. */
function migration(suffixe) {
  const f = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((x) => x.endsWith(`_${suffixe}.sql`))
  if (f.length !== 1) { console.error(`✘ migration *_${suffixe}.sql : ${f.length} correspondance(s)`); process.exit(2) }
  return sansCommentairesSql(lire(`supabase/migrations/${f[0]}`))
}

/**
 * LES DEUX TEMPS (relecture indépendante du 01/10/2026, §E.72) : ce qui REFUSE un geste du code en ligne — la garde des
 * langues, la contrainte « Autre », le retrait de l'écriture des photos par le navigateur — part dans un lot déployé
 * APRÈS. Sur le lot A, la migration est ABSENTE ; sur le lot B, elle est là, et son en-tête dit APRÈS. Rend le texte
 * (sans commentaires) ou null ; refuse deux correspondances ; vérifie l'en-tête quand elle existe.
 */
// LA LISTE DE LA BASE, lue dans la migration qui la sème : le rattachement EXÉCUTÉ ici est celui des lignes réelles
// (relecture du 01/10/2026, point 20 — une seule liste).
function listeDesLanguesSemee() {
  const sql = migration('langues_liste_fermee')
  const bloc = (debut) => { const i = sql.indexOf(debut); return sql.slice(i, sql.indexOf('on conflict', i)) }
  const codes = [...bloc('insert into public.langues (code)').matchAll(/\('([a-z]{2})'\)/g)].map((m) => m[1])
  const noms = [...bloc('insert into public.langues_noms (nom, code)').matchAll(/\('((?:[^']|'')+)', '([a-z]{2})'\)/g)]
    .map((m) => ({ nom: m[1].replace(/''/g, "'"), code: m[2] }))
  return { codes, noms }
}
function fichiersTs(d) {
  const out = []
  for (const e of readdirSync(join(ROOT, d))) {
    const p = d + '/' + e
    if (statSync(join(ROOT, p)).isDirectory()) { if (e !== 'node_modules') out.push(...fichiersTs(p)) }
    else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

function migrationDuSecondTemps(suffixe) {
  const f = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((x) => x.endsWith(`_${suffixe}.sql`))
  if (f.length > 1) { console.error(`✘ migration *_${suffixe}.sql : ${f.length} correspondances`); process.exit(2) }
  if (f.length === 0) return null
  const brut = lire(`supabase/migrations/${f[0]}`)
  ok(/ORDRE DE PASSAGE : APRÈS le déploiement/.test(brut.slice(0, 2500)) && f[0] > '20261002000000',
    `${suffixe} : migration du SECOND temps — en-tête APRÈS, horodatée après le lot A`)
  return sansCommentairesSql(brut)
}

let modules
try {
  modules = {
    sen: await importer('lib/profil/seniorites.ts'),
    lang: await importer('lib/profil/langues.ts'),
    zones: await importer('lib/work-zones.ts'),
    etat: await importer('lib/verification-state.ts'),
    autre: await importer('lib/taxonomie/specialite-autre.ts'),
    norm: await importer('lib/profil/normaliser-analyse.ts'),
    cv: await importer('lib/profil/lien-cv.ts'),
  }
} catch (err) {
  console.error('✘ un module ne se charge pas — le contrôle ne tourne pas', err)
  process.exit(2)
}

const FL_VAL = 'app/[locale]/dashboard/freelance/profil/valider/page.tsx'
const CDI_VAL = 'app/[locale]/dashboard/cdi/profil/valider/page.tsx'
const VALIDATIONS = [FL_VAL, CDI_VAL]

// ══════════════════════════════════════════════════════════════════════════
section('1. « Autre » : une seule notion, jamais une ligne du référentiel')
// ══════════════════════════════════════════════════════════════════════════
{
  const SURFACES = ['app/[locale]/inscription/[role]/page.tsx', ...VALIDATIONS, 'components/dashboard/PublicationForm.tsx']
  const copies = []
  const balayer = (d) => {
    for (const e of readdirSync(join(ROOT, d))) {
      const p = `${d}/${e}`
      if (statSync(join(ROOT, p)).isDirectory()) { if (e !== 'node_modules') balayer(p) }
      else if (/\.(ts|tsx)$/.test(e) && p !== 'lib/taxonomie/specialite-autre.ts' && sansCommentaires(lire(p)).includes("'__other__'")) copies.push(p)
    }
  }
  for (const r of ['app', 'components', 'lib']) balayer(r)
  ok(copies.length === 0, 'la sentinelle « Autre » n’est écrite qu’une fois (lib/taxonomie/specialite-autre.ts)', copies.join(', '))
  // L'annonce d'une organisation rend le composant de champs partagé avec le besoin de sous-traitance (lot « critères des
  // annonces », §D.39) : la sentinelle est importée par lui — ou par la fonction des options de spécialités.
  const importeAutre = (src) => /from '@\/lib\/taxonomie\/specialite-autre'/.test(src)
  const champsAnnonce = lire('components/annonces/ChampsAnnonce.tsx')
  ok(SURFACES.every((p) => importeAutre(lire(p))
      || (/<ChampsAnnonce\b/.test(lire(p)) && importeAutre(champsAnnonce))),
    'les quatre écrans l’importent (l’annonce d’organisation, par le composant de champs qu’elle rend)')
  // La DÉFINITION, une seule, en base (premier temps) ; l'administration la DEMANDE avant d'écrire (point 11).
  ok(/create or replace function public\.est_specialite_autre\(p_nom text, p_slug text\)/.test(migration('specialite_autre_hors_referentiel')),
    'la définition de « Autre » (est_specialite_autre) est en base, dès le premier temps')
  for (const [route, appel] of [
    ['app/api/admin/create-speciality/route.ts', /contientAutre\(auth\.supabaseAdmin, \[name, \.\.\.Object\.values\(translations\)\], slug\)/],
    ['app/api/admin/update-speciality/route.ts', /contientAutre\(auth\.supabaseAdmin, \[updates\.name as string \| undefined, \.\.\.trToUpsert\.map\(\(t\) => t\.value\)\], \(updates\.slug as string \| undefined\) \?\? null\)/],
  ]) {
    const r = sansCommentaires(lire(route))
    const i = r.search(appel)
    // La relecture du 02/10/2026 (point 4) fait écrire update-speciality par `modifier_specialite` (tout ou rien) : la
    // PREMIÈRE écriture est cet appel ; la question doit le précéder, comme elle précédait l'écriture directe.
    const ecritures = [r.search(/\.from\('specialities'\)\s*\.(insert|update)\(/), r.search(/from\('translations'\)\s*\.(upsert|insert|update|delete)\(/),
      r.indexOf(".rpc('modifier_specialite'")].filter((x) => x >= 0)
    ok(i >= 0 && ecritures.length > 0 && i < Math.min(...ecritures),
      `${route.split('/')[3]} : le nom, le slug ET chaque traduction se demandent à la base AVANT toute écriture (« Other », « Otra » refusés)`)
  }
  ok(!/function contientAutre[\s\S]*?(autres\?|others\?)/.test(lire('lib/taxonomie/specialite-autre.ts')),
    'le code ne recopie pas la règle : il demande est_specialite_autre (une définition, §E.20)')
  // LA FENÊTRE DU SECOND TEMPS (§E.72) : entre son push et le déploiement suivant, le code de CE lot reçoit encore
  // « Autre » d'une page chargée avant. Il ne refuse plus une spécialité INACTIVE : il la sort, et garde « Autre » en
  // précision — seul un slug INCONNU rend 400.
  {
    const p = sansCommentaires(lire('app/api/profile/route.ts'))
    const bloc = p.slice(p.indexOf("if ('speciality_slugs' in body)"), p.indexOf("if ('work_zone_codes' in body)") > 0 ? p.indexOf("if ('work_zone_codes' in body)") : undefined)
    const lecture = bloc.slice(bloc.indexOf(".from('specialities')"), bloc.indexOf('if (spsErr)'))
    ok(lecture.includes('.from(') && !/\.eq\('active', true\)/.test(lecture) && /active/.test(lecture),
      '/api/profile lit les spécialités SANS filtrer sur active — une spécialité retirée n’est pas « inconnue »')
    ok(/\.filter\(\(t\) => t\.active\)/.test(bloc) && /contientAutre\(supabaseAdmin, \[r\.name\], r\.slug\)/.test(bloc)
       && /patch\.speciality_other = r\.name/.test(bloc),
      '/api/profile : une spécialité inactive sort des spécialités, « Autre » devient la précision (comme la reprise)')
    ok(/patch\.speciality_other = raw\.length > 0 \? raw : \(patch\.speciality_other \?\? null\)/.test(p),
      '/api/profile : une précision VIDE n’efface pas le « Autre » repris d’une spécialité retirée')
  }
  const sql = migrationDuSecondTemps('specialite_autre_garde')
  if (sql === null) {
    // TEMPS 1 : la ligne « Autre » reste active — le code en ligne (13d1524) rend 400 bad_speciality sur une spécialité
    // inactive qu'une page chargée avant le push enverrait encore.
    ok(!readdirSync(join(ROOT, 'supabase', 'migrations')).some((f) => /specialities_autre_hors_referentiel|retirer_specialites_autre/.test(lire(`supabase/migrations/${f}`))),
      'TEMPS 1 : ni la reprise « Autre » ni sa contrainte ne sont dans le lot A — elles partent au lot B')
  } else {
    ok(/add constraint specialities_autre_hors_referentiel\s+check \(not active or not public\.est_specialite_autre\(name, slug\)\)/.test(sql),
      'la base refuse une spécialité ACTIVE « Autre »')
    ok(/perform|retirer_specialites_autre\(\)/.test(sql) && /v_bilan := public\.retirer_specialites_autre\(\)/.test(sql),
      'la migration reprend les lignes existantes (profils, annonces) avant de poser la contrainte')
    ok(sql.indexOf('retirer_specialites_autre();') < sql.indexOf('add constraint specialities_autre_hors_referentiel'),
      'la reprise PRÉCÈDE la contrainte — sinon la contrainte échouerait sur la ligne semée')
    ok(/before insert or update of value on public\.translations/.test(sql) && /est_specialite_autre\(new\.value, null\)/.test(sql),
      'TEMPS 2 : la base refuse aussi une TRADUCTION « Autre » d’une spécialité active (« Other », « Otra »)')
  }
  ok(modules.autre.estRefusAutre({ code: '23514', message: 'new row violates check constraint "specialities_autre_hors_referentiel"' })
    && !modules.autre.estRefusAutre({ code: '23514', message: 'autre contrainte' }) && !modules.autre.estRefusAutre(null),
    'le refus « Autre » se reconnaît (exécuté), et seulement lui')
  for (const r of ['app/api/admin/create-speciality/route.ts', 'app/api/admin/update-speciality/route.ts']) {
    const s = sansCommentaires(lire(r))
    ok(/if \(estRefusAutre\((insErr|updErr|ecrErr)\)\)\s*\{\s*return json\(\{[^}]*code: 'specialite_autre_reservee' \}, 400\)/.test(s),
      `${r.split('/').slice(-2, -1)[0]} rend specialite_autre_reservee (400), pas db_error`)
  }
  ok(dans4('admin_taxonomie.err_specialite_autre_reservee') && /'specialite_autre_reservee'\) return t\('err_specialite_autre_reservee'\)/.test(lire('app/[locale]/admin/taxonomie/[id]/page.tsx')),
    'l’écran de taxonomie le dit, dans les quatre langues')
}

// ══════════════════════════════════════════════════════════════════════════
section('2. Zones de travail : deux temps, aucun clic absorbé')
// ══════════════════════════════════════════════════════════════════════════
{
  const Z = modules.zones
  const zones = [
    { id: 'W', parent_id: null, kind: 'world', code: 'WORLD', country_code: null, name: 'Monde entier', slug: 'w' },
    { id: 'EU', parent_id: 'W', kind: 'continent', code: 'EU', country_code: null, name: 'Europe', slug: 'eu' },
    { id: 'AF', parent_id: 'W', kind: 'continent', code: 'AF', country_code: null, name: 'Afrique', slug: 'af' },
    { id: 'FR', parent_id: 'EU', kind: 'country', code: 'C_FR', country_code: 'FR', name: 'France', slug: 'fr' },
    { id: 'MA', parent_id: 'AF', kind: 'country', code: 'C_MA', country_code: 'MA', name: 'Maroc', slug: 'ma' },
  ]
  ok(Z.ajouterZone(zones, ['W'], 'EU').join() === 'EU', 'le cas de la recette : depuis « Monde entier », UN clic sur Europe donne Europe')
  ok(Z.ajouterZone(zones, ['EU'], 'FR').join() === 'EU' && Z.zoneCouvrante(zones, ['EU'], 'FR')?.id === 'EU',
    'un pays déjà couvert ne s’ajoute pas, et l’on sait par quoi il est couvert')
  ok(Z.ajouterZone(zones, ['FR', 'MA'], 'EU').sort().join() === 'EU,MA', 'un continent ajouté absorbe ses pays, pas les autres')
  ok(Z.retirerZone(['EU', 'MA'], 'EU').join() === 'MA', 'une étiquette se retire')
  ok(Z.modeDeSelection(zones, []) === null && Z.modeDeSelection(zones, ['W']) === 'monde' && Z.modeDeSelection(zones, ['MA']) === 'zones',
    'aucun mode n’est choisi d’office')
  ok(Z.normaliserRecherche('  RÉunion ') === 'reunion', 'la recherche ignore la casse et les accents')
  const sel = sansCommentaires(lire('components/ui/WorkZoneSelector.tsx'))
  ok(/role="radiogroup"/.test(sel) && (sel.match(/role="radio"/g) ?? []).length === 2, 'une question fermée à deux réponses')
  ok(/\{mode === 'zones' \?/.test(sel) && !/basculer\(monde\.id\)/.test(sel),
    'le monde n’est plus un bouton parmi les continents : continents et recherche n’existent qu’en « certaines zones »')
  // Le lot « zones de travail » (02/10/2026, décision de Youssef) a remplacé « continents entiers + ajouter un pays » par
  // des continents qui se déplient : un pays se coche DANS son continent — la recherche aussi (diag-lot-zones le détaille).
  ok(/basculerPays\(liste, selected, id\)/.test(sel) && /choisirContinentEntier\(liste, selected, id, coche\)/.test(sel) && /role="combobox"/.test(sel),
    'les choix passent par choisirContinentEntier et basculerPays (aucun clic absorbé) ; la recherche est un combobox')
  // Point 13 de la relecture : le clavier, la fermeture, la zone retirée.
  ok(/role="radiogroup"[^>]*onKeyDown=\{clavierRadio\}/.test(sel) && /'ArrowRight'/.test(sel) && /'ArrowLeft'/.test(sel)
     && (sel.match(/tabIndex=\{rangChoisi === /g) ?? []).length === 2,
    'point 13 : la question fermée se joue aux flèches, une seule tabulation pour le groupe (motif radio)')
  ok(/aria-activedescendant=\{listeOuverte && resultats\[actif\] \? idOption\(actif\) : undefined\}/.test(sel) && /id=\{idOption\(i\)\}/.test(sel),
    'point 13 : l’option active de la recherche est annoncée (aria-activedescendant, chaque option a son id)')
  ok(/onBlur=\{\(\) => setOuverte\(false\)\}/.test(sel) && /\{listeOuverte \? \(\s*<ul/.test(sel) && /aria-expanded=\{listeOuverte\}/.test(sel),
    'point 13 : la liste des pays se ferme quand le champ perd le focus')
  ok(/if \(!z\) \{[\s\S]{0,200}t\('zone_retiree'\)/.test(sel) && !/if \(!z\) return null/.test(sel)
     && /paysCouverts\.length === 0\s*\?\s*t\(selected\.length === 0 \? 'none_selected' : 'aucun_pays_couvert'\)/.test(sel),
    'point 13 : une zone retirée reste visible et retirable, et « 0 pays couverts » ne s’affiche jamais')
  ok(/continentsOf\(liste\)\.filter\(\(c\) => countryCountOf\(liste, c\.id\) > 0\)/.test(sel),
    'point 13 : un continent sans aucun pays proposé n’est pas offert (il ne couvrirait rien)')
  const cles = clesCitees(sel, 't', 'work_zones')
  const manquantes = cles.filter((c) => !dans4(c))
  ok(cles.length >= 15 && manquantes.length === 0, `les ${cles.length} textes du sélecteur existent dans les quatre langues`, manquantes.join(', '))
}

// ══════════════════════════════════════════════════════════════════════════
section('3. Langues : une liste fermée, aucun niveau d’office, le CV rattaché')
// ══════════════════════════════════════════════════════════════════════════
{
  const L = modules.lang
  const semee = listeDesLanguesSemee()
  const rattacher = L.rattacheurDeLangues(semee.codes, semee.noms)
  ok(semee.codes.length === 92 && semee.noms.length > 300, `la liste semée est lue (${semee.codes.length} langues, ${semee.noms.length} noms)`)
  ok(['French', 'Français', 'francais', 'Francés', 'Französisch', 'FR'].every((x) => rattacher(x) === 'fr')
    && rattacher('English') === 'en' && rattacher('Arabic') === 'ar' && rattacher('Klingon') === null,
    'le cas de la recette : « French, English, Arabic » se rattachent à fr, en, ar — par la liste de la BASE (exécuté)')
  ok(rattacher('Latin') === null && rattacher('la') === null && rattacher('Mandarin') === 'zh',
    'point 20 : une langue HORS de la liste fermée ne se rattache pas (« Latin » ≠ « la ») — la même réponse qu’en base')
  // La RÈGLE est la même texte pour texte : un code de la liste d'abord, puis un nom connu, en minuscules sans espaces autour.
  {
    const corpsSql = migration('langues_liste_fermee').match(/function public\.code_de_langue\(p_texte text\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/)?.[1] ?? ''
    const ts = sansCommentaires(lire('lib/profil/langues.ts'))
    const corpsTs = ts.slice(ts.indexOf('export function rattacheurDeLangues'), ts.indexOf('export function', ts.indexOf('export function rattacheurDeLangues') + 10))
    ok(/l\.code = lower\(btrim\(p_texte\)\)/.test(corpsSql) && /n\.nom = lower\(btrim\(p_texte\)\)/.test(corpsSql)
       && corpsSql.indexOf('public.langues l') < corpsSql.indexOf('public.langues_noms n')
       && /texte\.trim\(\)\.toLowerCase\(\)/.test(corpsTs) && corpsTs.indexOf('lesCodes.has(cle)') < corpsTs.indexOf('parNom.get(cle)')
       && !/Intl/.test(corpsTs),
      'point 20 : rattacheurDeLangues applique la règle de code_de_langue (code, puis nom ; minuscules) — sans Intl')
    const tout = ['lib', 'app', 'components'].flatMap((d) => fichiersTs(d))
    const autres = tout.filter((f) => /\bcodeDeLangue\b|indexDesNoms/.test(lire(f)))
    ok(autres.length === 0, 'point 20 : plus aucune seconde liste de rattachement dans le code (codeDeLangue, indexDesNoms)', autres.join(', '))
    const ex = sansCommentaires(lire('lib/travaux-ia/executer-analyse.ts'))
    ok(/from\('langues'\)/.test(ex) && /from\('langues_noms'\)/.test(ex) && ex.indexOf("from('langues_noms')") < ex.search(/await parseC(dc)?V\(|parseCdiCV\(buffer/)
       && /normaliserAnalyse\(brut, rattacher\)/.test(ex),
      'point 20 : l’analyse du CV lit la liste de la base AVANT l’appel au modèle, et la passe à la normalisation')
    const choix = sansCommentaires(lire('components/profile/ChoixLangue.tsx'))
    ok(/t\('heritee', \{ valeur: nomDeLangue\(valeur, locale\) \}\)/.test(choix),
      'point 12 : une ligne héritée qui est un CODE hors liste se NOMME dans la langue de l’écran (« la » → « Latin »)')
    ok(L.nomDeLangue('la', 'fr') === 'Latin' && L.nomDeLangue('Wolof ancien', 'fr') === 'Wolof ancien',
      'point 12 : « la » s’affiche « Latin », un texte libre tel qu’il est écrit (exécuté)')
  }
  ok(L.nomDeLangue('en', 'fr') === 'Anglais' && L.nomDeLangue('ar', 'de') === 'Arabisch' && L.nomDeLangue('Wolof ancien', 'fr') === 'Wolof ancien',
    'le nom s’affiche dans la langue de l’écran ; une ligne héritée s’affiche telle quelle')
  const codes = new Set(['fr', 'en'])
  ok(L.languesAEnvoyer([{ language: 'fr', level: 'C2', is_primary: true }, { language: '', level: '', is_primary: false }], codes).ok === true,
    'une ligne vide est ignorée, une ligne complète part')
  const sansNiveau = L.languesAEnvoyer([{ language: 'en', level: '', is_primary: false }], codes)
  const heritee = L.languesAEnvoyer([{ language: 'fr', level: 'B2', is_primary: false }, { language: 'French', level: 'B2', is_primary: false }], codes)
  ok(sansNiveau.ok === false && sansNiveau.raison === 'niveau_manquant' && heritee.ok === false && heritee.raison === 'langue_hors_liste' && heritee.rang === 2,
    'un niveau non choisi ou une langue hors liste bloquent, avec leur rang')
  for (const p of VALIDATIONS) {
    const s = sansCommentaires(lire(p))
    ok(!/level: 'B2'/.test(s) && /level: ''/.test(s), `${p.includes('cdi') ? 'CDI' : 'freelance'} : aucun niveau choisi d’office`)
    ok(/<ChoixLangue\b/.test(s) && !/LONGUEURS_SAISIE\.language/.test(s), `${p.includes('cdi') ? 'CDI' : 'freelance'} : la langue se choisit dans la liste, plus de saisie libre`)
    ok(/languesAEnvoyer\(languagesStructured/.test(s) && /&avec=langues/.test(s), `${p.includes('cdi') ? 'CDI' : 'freelance'} : la liste est demandée, la saisie contrôlée avant l’envoi`)
    ok(/language: l\.language \?\? ''/.test(s) && !/codeDeLangue/.test(s), `${p.includes('cdi') ? 'CDI' : 'freelance'} : une ligne héritée arrive telle que la base l’a laissée — rattachée EN BASE, jamais par une seconde liste`)
  }
  const n = modules.norm.normaliserAnalyse({ languages_structured: [
    { language: 'French', level: 'native', is_primary: true }, { language: 'English', level: 'C1', is_primary: false },
    { language: 'Arabic', level: 'B2', is_primary: false }, { language: 'Klingon', level: 'A1', is_primary: false },
  ], languages: ['French', 'Français', 'Klingon'] }, rattacher)
  ok(n.langues?.map((x) => x.language).join() === 'fr,en,ar' && n.ecarts.some((e) => e.bloc === 'langues' && e.rang === 4 && e.code === 'langue_inconnue')
    && n.profil.languages?.join() === 'fr',
    'l’analyse du CV écrit des codes, et dit la langue qu’elle n’a pas reconnue (exécuté)')
  ok(dans4('ecarts_analyse.codes.langue_inconnue') && dans4('profil_refus.causes.langue_hors_liste'), 'les deux nouveaux motifs existent dans les quatre langues')
  const sql = migration('langues_liste_fermee')
  ok(!/create trigger|errcode = 'LG001'/.test(sql),
    'TEMPS 1 : la liste des langues ne pose AUCUNE garde — le code en ligne envoie du texte libre, la base l’accepte')
  const garde = migrationDuSecondTemps('langues_garde')
  if (garde !== null) {
    ok(/before insert or update of language on public\.profile_languages/.test(garde) && /errcode = 'LG001'/.test(garde),
      'TEMPS 2 : la base refuse une langue hors liste (LG001), à l’insertion comme au changement')
    ok(garde.indexOf('rattacher_langues_heritees()') >= 0 && garde.indexOf('rattacher_langues_heritees()') < garde.indexOf('create trigger'),
      'TEMPS 2 : la reprise est RELANCÉE (les lignes écrites entre-temps) AVANT que la garde ne se pose')
  }
  ok(/when v_etat = 'LG001' then 'langue_hors_liste'/.test(sql), 'remplacer_listes_profil nomme ce refus')
  ok(/v_bilan := public\.rattacher_langues_heritees\(\)/.test(sql) && !/delete from public\.profile_languages pl\s+where/.test(sql),
    'les lignes héritées sont rattachées, jamais effacées en bloc (seuls les doublons fondus)')
  const taxo = sansCommentaires(lire('app/api/taxonomy/route.ts'))
  ok(/searchParams\.get\('avec'\) === 'langues'/.test(taxo) && /from\('langues'\)/.test(taxo), '/api/taxonomy sert la liste sur demande (l’inscription n’en dépend pas)')
  const cles = [...clesCitees(lire('components/profile/ChoixLangue.tsx'), 't', 'langues'), ...VALIDATIONS.flatMap((p) => clesCitees(lire(p), 'tLangues', 'langues'))]
  const manquantes = cles.filter((c) => !dans4(c))
  ok(manquantes.length === 0, `les textes des langues existent dans les quatre langues (${new Set(cles).size})`, manquantes.join(', '))
}

// ══════════════════════════════════════════════════════════════════════════
section('4. Étape 3 « Publier votre profil » : vers la validation')
// ══════════════════════════════════════════════════════════════════════════
{
  const g = sansCommentaires(lire('components/dashboard/ExpertOnboardingGuide.tsx'))
  ok(/publish: `\$\{basePath\}\/profil\/valider`/.test(g), 'l’étape 3 mène à la validation')
  ok(/cv: `\$\{basePath\}\/profil`/.test(g) && /profile: `\$\{basePath\}\/profil`/.test(g), 'les étapes 1 et 2 mènent toujours à l’import (décision du 30/09)')
}

// ══════════════════════════════════════════════════════════════════════════
section('5. Le statut : un libellé et une couleur par état réel, le même partout')
// ══════════════════════════════════════════════════════════════════════════
{
  const E = modules.etat
  const etats = ['draft', 'pending', 'admin_review', 'approved', 'approved_masque', 'rejected']
  ok(new Set(etats.map(E.cleLibelleStatut)).size === etats.length, 'chaque état a SON libellé — « l’IA vérifie » et « un humain relit » ne se confondent plus')
  ok(E.deriveVerificationUiState({ visible: true, verificationStatus: 'pending' }) === 'pending'
    && E.deriveVerificationUiState({ visible: true, verificationStatus: 'pending_admin_review' }) === 'admin_review'
    && E.deriveVerificationUiState({ visible: false, verificationStatus: null }) === 'draft'
    && E.deriveVerificationUiState({ visible: true, verificationStatus: 'requires_more_info' }) === 'admin_review',
    'les états réels se déduisent (exécuté)')
  ok(etats.every((s) => E.verificationDotColor(s) === E.verificationChipColors(s).fg), 'la couleur du point est celle du libellé : une couleur constante par état')
  // Relecture du 01/10/2026 (point 10) : admin_review et approved_masque partageaient l'ambre.
  ok(new Set(etats.map((s) => JSON.stringify(E.verificationChipColors(s)))).size === etats.length, 'chaque état a SA couleur — deux états ne se confondent ni par le libellé ni par la couleur')
  // Point 5 : l'en-tête de « Mon profil » lit l'état AFFICHÉ (masqué compris), pas l'état brut.
  const monProfil = sansCommentaires(lire('app/[locale]/dashboard/freelance/mon-profil/page.tsx'))
  ok(/etatAffiche\(verifState, profilMasque\) === 'approved' \?/.test(monProfil) && !/\{verifState === 'approved' \? \(/.test(monProfil)
     && /verificationChipColors\(etatAffiche\(verifState, profilMasque\)\)/.test(monProfil),
    'l’en-tête de « Mon profil » dit le même état que la pastille — jamais « vérifié » sur un profil masqué')
  const manquantes = []
  for (const s of etats) {
    if (!dans4(`statut_profil.${E.cleLibelleStatut(s)}`)) manquantes.push(s)
    for (const v of ['freelance', 'cdi']) if (!dans4(`statut_profil.${E.clePhraseStatut(s, v)}`)) manquantes.push(`${v}.${s}`)
  }
  ok(manquantes.length === 0 && dans4('statut_profil.titre'), '« Statut de votre profil : … » et la phrase de chaque état, dans les quatre langues', manquantes.join(', '))
  ok(cle(MSG.fr, 'statut_profil.phrase.freelance.draft') === 'Les missions vous seront proposées dès que votre profil sera publié et validé.',
    'le brouillon dit exactement la phrase demandée')
  const PASTILLES = ['app/[locale]/dashboard/freelance/page.tsx', 'app/[locale]/dashboard/cdi/page.tsx',
    'app/[locale]/dashboard/freelance/mon-profil/page.tsx', 'app/[locale]/dashboard/cdi/mon-profil/page.tsx']
  ok(PASTILLES.every((p) => /<VerificationStatusPill state=\{verifState\} masque=\{profilMasque\} voie="(freelance|cdi)" \/>/.test(lire(p))), 'les quatre pastilles portent la voie')
  ok(/useTranslations\('statut_profil'\)/.test(lire('components/dashboard/VerificationStatusPill.tsx')), 'la pastille lit l’espace commun')
  ok(/tStatut\('titre', \{ etat: tStatut\(cleLibelleStatut\(verifState\)\) \}\)/.test(sansCommentaires(lire('components/dashboard/ExpertOnboardingGuide.tsx'))),
    'l’étape 3 dit le même libellé que la pastille')
  ok(!/expert_verification\.badge/.test(sansCommentaires(lire('app/[locale]/dashboard/freelance/mon-profil/page.tsx'))) && cle(MSG.fr, 'expert_verification.badge') === undefined,
    'le second vocabulaire de « Mon profil » a disparu')
  ok(/texteNotificationStatut\(etat, voieDuCompte\(user_type\), locale\)/.test(sansCommentaires(lire('lib/verification/expert-verification.ts'))),
    'les notifications de vérification disent le même texte que l’écran')
}

// ══════════════════════════════════════════════════════════════════════════
section('6. Une icône « i » sur chaque case et chaque bloc ; « Modifier » quand le TJM existe')
// ══════════════════════════════════════════════════════════════════════════
{
  const ib = sansCommentaires(lire('components/ui/InfoBulle.tsx'))
  ok(/onPointerEnter=\{\(e\) => \{ if \(e\.pointerType === 'mouse'\)/.test(ib) && /pointeur\.current === 'mouse' \? true : !o/.test(ib),
    'ordinateur : au survol ; téléphone : au toucher')
  ok(/matches\(':focus-visible'\)/.test(ib) && /aria-describedby/.test(ib) && /'Escape'/.test(ib), 'clavier : au focus, Échap ferme ; relié au lecteur d’écran')
  // Des BALISES, pas des cases rendues : une balise posée dans un `.map` ou dans un composant de case
  // en couvre plusieurs — d'où le second compte, celui des cases qui reçoivent leur texte.
  const ATTENDUES = {
    'app/[locale]/dashboard/freelance/page.tsx': 6,
    'app/[locale]/dashboard/cdi/page.tsx': 5,
    'app/[locale]/dashboard/entreprise/page.tsx': 4,
    'components/dashboard/CollaborationDashboardBlock.tsx': 1,
    'components/dashboard/ExpertOnboardingGuide.tsx': 1,
  }
  const CASES = {
    'app/[locale]/dashboard/freelance/page.tsx': [/info: tInfo\('freelance\.[a-z_]+'\)/g, 4],
    'app/[locale]/dashboard/cdi/page.tsx': [/info=\{tInfo\('cdi\.[a-z_]+'\)\}/g, 4],
    'app/[locale]/dashboard/entreprise/page.tsx': [/info=\{tInfo\('entreprise\.[a-z_]+'\)\}/g, 8],
  }
  for (const [p, [re, n]] of Object.entries(CASES)) {
    const k = (sansCommentaires(lire(p)).match(re) ?? []).length
    ok(k === n, `${p.split('/').slice(-2).join('/')} : chacune des ${n} cases de comptage a son texte`, `${k} trouvées`)
  }
  const toutes = []
  for (const [p, n] of Object.entries(ATTENDUES)) {
    const s = sansCommentaires(lire(p))
    const poses = (s.match(/<InfoBulle\b/g) ?? []).length
    ok(poses >= n, `${p.split('/').slice(-2).join('/')} : ${poses} info-bulle(s) posée(s)`, `au moins ${n} attendues`)
    toutes.push(...clesCitees(s, 'tInfo', 'infobulles'))
  }
  // Les cases cliquables : l'icône est un FRÈRE du lien, jamais son enfant.
  for (const p of ['app/[locale]/dashboard/entreprise/page.tsx', 'app/[locale]/dashboard/cdi/page.tsx']) {
    const s = sansCommentaires(lire(p))
    const liens = [...s.matchAll(/<Link\b[\s\S]*?<\/Link>/g)].map((m) => m[0])
    ok(!liens.some((l) => /<InfoBulle\b|\{bulle\}|\{info\}/.test(l)), `${p.split('/').slice(-2).join('/')} : aucune info-bulle dans un lien`)
  }
  const manquantes = [...new Set(toutes)].filter((c) => !dans4(c))
  ok(manquantes.length === 0, `les ${new Set(toutes).size} textes d’info-bulle existent dans les quatre langues`, manquantes.join(', '))
  ok(/profile\?\.tjm_min != null && profile\?\.tjm_max != null \? t\('stats\.daily_rate_edit'\) : t\('stats\.daily_rate_set'\)/.test(lire('app/[locale]/dashboard/freelance/page.tsx'))
    && dans4('dashboard_freelance.stats.daily_rate_edit'), '« Modifier » quand le TJM est renseigné, « Définir » sinon')
}

{
  // Relecture du 01/10/2026, point 9 : l'info-bulle du TJM disait qu'il « sert à vous proposer des missions dans votre
  // budget » — le moteur ne lit pas le TJM (lib/matching/document.ts : ni budget, ni tarif). Elle ne doit plus le dire.
  const dit = LANGUES.map((lg) => cle(MSG[lg], 'infobulles.freelance.daily_rate') ?? '')
  ok(dit.every((x) => x && !/dans votre budget|within your budget|dentro de tu presupuesto|in Ihrem Budget|sert à vous proposer|used to offer you|sirve para proponer|dient dazu, Ihnen/i.test(x)),
    'l’info-bulle du TJM ne prétend plus qu’il choisit les missions proposées (le moteur ne le lit pas)')
  ok(/Ni budget, ni durée, ni mode de travail, ni zone/.test(lire('lib/matching/document.ts')), 'et le moteur, lui, l’exclut toujours de ce qu’il compare')
}
// ══════════════════════════════════════════════════════════════════════════
section('7. Publier : retour au tableau de bord ; la notification part à la publication')
// ══════════════════════════════════════════════════════════════════════════
{
  const route = sansCommentaires(lire('app/api/profile/route.ts'))
  const iDepot = route.indexOf('const depot = await deposerVerificationExpert(')
  const bloc = route.slice(iDepot, iDepot + 1200)
  ok(iDepot > 0 && /else if \(cp\.verification_status !== 'approved'\) \{\s*await notifyExpertResult\(\{[\s\S]*?verification_status: 'pending'/.test(bloc),
    'la notification « l’IA vérifie » est posée dans la requête de publication, après un dépôt réussi')
  for (const p of VALIDATIONS) {
    const s = sansCommentaires(lire(p))
    ok(/if \(visible && !res\.ok && payload\?\.code === 'journal_error'\) \{\s*router\.push\('\/dashboard\/(freelance|cdi)'\)/.test(s),
      `${p.includes('cdi') ? 'CDI' : 'freelance'} : une publication écrite ramène au tableau de bord, même si seule la ligne du grand livre a échoué`)
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('8. La photo : le serveur dépose, chaque refus dit sa raison')
// ══════════════════════════════════════════════════════════════════════════
{
  const modal = sansCommentaires(lire('components/AvatarUploadModal.tsx'))
  ok(!/\.storage\b/.test(modal) && /secureFetch\('\/api\/profile\/photo', \{ method: 'POST', body: corps \}\)/.test(modal),
    'la fenêtre n’écrit plus dans le stockage : elle envoie le fichier au serveur')
  ok(!/t\('error_save'\)/.test(modal), 'plus de message unique « Erreur lors de l’enregistrement »')
  const route = sansCommentaires(lire('app/api/profile/photo/route.ts'))
  // Fusion (01/10/2026, décision de Youssef) : la route LIT le profil (sujet et « remplacement ») et écrit `photo_deposee`
  // à chaque dépôt ; elle n'ÉCRIT toujours pas le profil — PATCH /api/profile pose `photo_url`.
  ok(/verifierFichierLogo\(/.test(route) && /avatarStoragePath\(auth\.user\.id\)/.test(route)
     && !/\.from\('profiles'\)[\s\S]{0,120}?\.(update|insert|upsert)\(/.test(route) && /await photoDeposee\(/.test(route),
    'la route vérifie le CONTENU, dépose au chemin dérivé du compte, n’écrit pas le profil (PATCH /api/profile le fait) et écrit « photo déposée » à chaque dépôt')
  const codesRoute = [...new Set([...route.matchAll(/'(photo_[a-z_]+|pas_expert)'/g)].map((m) => m[1]))]
  const sansMessage = codesRoute.filter((c) => !dans4(`dashboard_freelance.avatar_modal.errors.${c}`) || !modal.includes(`'${c}'`))
  ok(codesRoute.length >= 7 && sansMessage.length === 0, `les ${codesRoute.length} codes de la route ont leur message, dans les quatre langues`, sansMessage.join(', '))
  const sql = migrationDuSecondTemps('photo_par_le_serveur')
  if (sql === null) {
    // L'ÉTAT FINAL de chaque politique, migration après migration : la dernière instruction qui la nomme décide
    // (storage_buckets_policies la retire PUIS la recrée — une simple présence de « drop » ne dit rien).
    const etat = {}
    for (const f of readdirSync(join(ROOT, 'supabase', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
      for (const m of sansCommentairesSql(lire(`supabase/migrations/${f}`)).matchAll(/(drop policy if exists|create policy)\s+"?(avatars_auth_(?:upload|update|delete))"?/g)) {
        etat[m[2]] = m[1] === 'create policy' ? 'créée' : 'retirée'
      }
    }
    ok(['avatars_auth_upload', 'avatars_auth_update', 'avatars_auth_delete'].every((p) => etat[p] === 'créée'),
      'TEMPS 1 : le navigateur garde son écriture sur avatars — le code en ligne dépose encore depuis le navigateur', JSON.stringify(etat))
  } else {
    ok(['avatars_auth_upload', 'avatars_auth_update', 'avatars_auth_delete'].every((p) => sql.includes(`drop policy if exists ${p} on storage.objects`)),
      'TEMPS 2 : les trois politiques d’écriture du navigateur sur avatars sont retirées')
  }
  const ecritures = []
  const balayer = (d) => {
    for (const e of readdirSync(join(ROOT, d))) {
      const p = `${d}/${e}`
      if (statSync(join(ROOT, p)).isDirectory()) balayer(p)
      else if (/\.tsx?$/.test(e)) {
        const s = lire(p)
        if (/^['"]use client['"]/.test(s.trimStart()) && /\.storage\s*\.from\('avatars'\)\s*\.(upload|update|remove)/.test(sansCommentaires(s))) ecritures.push(p)
      }
    }
  }
  for (const r of ['app', 'components', 'lib']) balayer(r)
  ok(ecritures.length === 0, 'aucun composant client n’écrit dans le bucket avatars', ecritures.join(', '))
}

{
  // Relecture du 01/10/2026, points 7 et 8.
  const modalP = sansCommentaires(lire('components/AvatarUploadModal.tsx'))
  ok(/const deposee = !!recu\.chemin && \(depot\.ok \|\| recu\.code === 'journal_error'\)/.test(modalP) && /if \(!deposee\) \{/.test(modalP),
    'une photo DÉPOSÉE dont seule la ligne du grand livre est refusée est quand même rattachée au profil')
  const routeP = sansCommentaires(lire('app/api/profile/photo/route.ts'))
  const lectures = [...routeP.matchAll(/code: '(photo_[a-z_]+)' \}, 503\)/g)].map((m) => m[1])
  ok(lectures.length === 3 && lectures[0] === 'photo_compte_illisible' && lectures[1] === 'photo_compte_illisible' && lectures[2] === 'photo_stockage_indisponible',
    'une lecture du compte ou du profil en panne dit SA cause — « stockage indisponible » n’est dit que du stockage (§E.22)', lectures.join(', '))
}
// ══════════════════════════════════════════════════════════════════════════
section('9. Paramètres > Notifications : la phrase claire')
// ══════════════════════════════════════════════════════════════════════════
ok(cle(MSG.fr, 'settings.notifications.grouping_note_digest') ===
  'Quand plusieurs missions vous correspondent en même temps, vous recevez un seul e-mail qui les regroupe. Les messages, eux, vous sont envoyés un par un.'
  && LANGUES.every((l) => !/cycle|run\b|Empfehlungslauf|ciclo/.test(cle(MSG[l], 'settings.notifications.grouping_note_digest'))),
  'la phrase dit ce qui arrive, sans « cycle de recommandation », dans les quatre langues')

// ══════════════════════════════════════════════════════════════════════════
section('10 à 13. La vérification par l’IA')
// ══════════════════════════════════════════════════════════════════════════
{
  const aev = sansCommentaires(lire('lib/verification/ai-expert-verification.ts'))
  const ev = sansCommentaires(lire('lib/verification/expert-verification.ts'))
  ok(!/web_search_2025|tools[,:]/.test(aev) && !/linkedin/i.test(aev.replace(/LinkedIn n'est ni fourni ni consulté, et son absence ne compte JAMAIS/, '')),
    '10. LinkedIn : aucun outil offert, aucune adresse transmise, aucune consigne (sauf celle qui dit qu’il ne compte pas)')
  ok(!/'LINKEDIN_UNVERIFIABLE'/.test(aev) && !/'LINKEDIN_UNVERIFIABLE'/.test(ev) && !/'LINKEDIN_UNVERIFIABLE'/.test(sansCommentaires(lire('lib/jugement/sujets.ts'))),
    '10. le drapeau LinkedIn ne peut plus être posé, ni réglé comme bloquant')
  ok(!/linkedin_url/.test(ev) && !/web_search_max_uses == null/.test(ev), '10. la vérification ne lit plus LinkedIn et n’exige plus le réglage de recherche')
  ok(/NE_GOUVERNENT_RIEN[\s\S]*web_search_max_uses/.test(lire('lib/jugement/sujets.ts')), '10. le réglage devenu inerte est déclaré comme tel (§D.11)')
  ok(/se CHEVAUCHENT sont normales/.test(aev) && /Ne les signale pas, ne les pénalise pas/.test(aev), '11. les missions qui se chevauchent sont dites normales au modèle')
  ok(/select\('experience_type, role, employer, client_name, sector/.test(ev), '12. le vérificateur lit le type et le CLIENT de chaque expérience')
  ok(/e\.experience_type === 'project'[\s\S]{0,80}MISSION — \$\{role\} pour le client \$\{client \|\| '\(client confidentiel\)'\}/.test(aev)
    && /Ne compte JAMAIS une\s+mission comme un « employeur non nommé »/.test(aev),
    '12. une mission se lit avec son client, jamais comme un employeur non nommé')
  const S = modules.sen
  const cas = [[0, 'junior'], [2.9, 'junior'], [3, 'confirmed'], [5.9, 'confirmed'], [6, 'senior'], [11.9, 'senior'], [12, 'expert'], [30, 'expert']]
  const faux = cas.filter(([a, t]) => S.trancheDesAnnees(a) !== t)
  ok(faux.length === 0, '13. chaque nombre d’années tombe dans UNE tranche — 12 ans est expert (exécuté)', JSON.stringify(faux))
  ok(/de 6 à moins de 12 ans/.test(S.tranchesPourConsigne()) && /expert : 12 ans et plus/.test(S.tranchesPourConsigne()), '13. la consigne dit des bornes sans recouvrement')
  for (const p of ['lib/verification/ai-expert-verification.ts', 'lib/cv-parser.ts', 'lib/cv-parser-cdi.ts']) {
    const s = sansCommentaires(lire(p))
    ok(/\$\{tranchesPourConsigne\(\)\}/.test(s) && !/6-12|12\+|7 ans, entre/.test(s), `13. ${p.split('/').pop()} tire ses tranches du module, sans chiffre recopié`)
  }
  const parser = sansCommentaires(lire('lib/cv-parser.ts'))
  ok(/language: \{ type: 'string', description: 'Code ISO 639-1/.test(parser), '3 bis. l’analyseur demande un CODE de langue')
}

// ══════════════════════════════════════════════════════════════════════════
section('14. Le CV dans la fiche admin : lecture seule, lien qui expire')
// ══════════════════════════════════════════════════════════════════════════
{
  const fauxAdmin = (rep) => ({ storage: { from: (b) => ({ createSignedUrl: async (p, d) => (b === 'cv' && d <= 60 ? rep : { data: null, error: { message: 'mauvais bucket ou durée' } }) }) } })
  const C = modules.cv
  const r1 = await C.signerLienCv(fauxAdmin({}), null)
  const r2 = await C.signerLienCv(fauxAdmin({ data: null, error: { status: 404, statusCode: '404', message: 'Object not found' } }), 'u/x.pdf')
  const r3 = await C.signerLienCv(fauxAdmin({ data: null, error: { status: 500, message: 'panne' } }), 'u/x.pdf')
  const r4 = await C.signerLienCv(fauxAdmin({ data: { signedUrl: 'https://exemple.invalid/s' }, error: null }), 'u/x.pdf')
  ok(r1.etat === 'absent' && r2.etat === 'absent' && r3.etat === 'indisponible' && r4.etat === 'disponible',
    'trois issues, jamais deux : absent, indisponible, disponible — bucket cv, une minute au plus (exécuté)')
  const route = sansCommentaires(lire('app/api/admin/lien-cv/[id]/route.ts'))
  ok(/requireAdmin\(request\)/.test(route) && /signerLienCv\(/.test(route) && /'cv_absent'/.test(route) && /'lien_cv_indisponible'/.test(route) && /export async function POST/.test(route),
    'la route est réservée à l’administrateur et nomme ses issues')
  const fiche = sansCommentaires(lire('app/api/admin/get-expert/[id]/route.ts'))
  ok(!/\bcv_url\b/.test(fiche) && /cv_depose:/.test(fiche) && /cv_file_path/.test(fiche), 'la fiche lit cv_file_path, et n’expose que le FAIT qu’un CV existe')
  const page = sansCommentaires(lire('app/[locale]/admin/experts/[id]/page.tsx'))
  ok(/`\/api\/admin\/lien-cv\/\$\{id\}`/.test(page) && /window\.open\('', '_blank'\)/.test(page) && !/e\.cv_url/.test(page),
    'l’écran demande le lien au clic et l’ouvre dans un onglet')
  const manquantes = clesCitees(page, 't', 'admin_back_office.experts').filter((c) => c.includes('.cv_') || c.includes('experience_')).filter((c) => !dans4(c))
  ok(manquantes.length === 0, 'les textes du CV et des missions existent dans les quatre langues', manquantes.join(', '))
}

// ══════════════════════════════════════════════════════════════════════════
section('Mise en page et vocabulaire')
// ══════════════════════════════════════════════════════════════════════════
{
  const NEUFS = ['components/ui/InfoBulle.tsx', 'components/ui/WorkZoneSelector.tsx', 'components/profile/ChoixLangue.tsx', 'components/dashboard/VerificationStatusPill.tsx']
  ok(NEUFS.every((p) => !/textAlign: 'center'|margin: '0 auto'|marginInline: 'auto'/.test(lire(p))), 'aucun composant neuf n’est centré')
  const textes = []
  const parcourir = (o) => {
    for (const v of Object.values(o ?? {})) {
      if (typeof v === 'string') textes.push(v)
      else parcourir(v)
    }
  }
  for (const l of LANGUES) for (const ns of ['statut_profil', 'infobulles', 'langues']) parcourir(MSG[l][ns])
  for (const l of LANGUES) parcourir(MSG[l].work_zones)
  ok(!textes.some((t) => /\bseuils?\b|\bthreshold\b|\bumbral\b|\bSchwellenwert\b/i.test(t)), 'le mot « seuil » n’apparaît dans aucun texte neuf (§D.9)')
}

console.log(echecs === 0 ? '\n✅ diag-recette-s1 : tout est vert.' : `\n❌ diag-recette-s1 : ${echecs} contrôle(s) rouge(s).`)
process.exit(echecs === 0 ? 0 : 1)
