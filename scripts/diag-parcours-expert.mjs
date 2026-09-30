/**
 * diag-parcours-expert.mjs — DU CV À LA PREMIÈRE MISE EN RELATION, SANS UN MUR (ARRÊT 19, 30/09/2026).
 *
 * L'audit rendu sur `aac5f79` a trouvé 4 bloquants, 12 majeurs et des mineurs sur le chemin de l'expert.
 * Ce contrôle en garde CHAQUE correctif, par sa PROPRIÉTÉ (§E.34), et il EXÉCUTE ce qui peut l'être —
 * les modules purs (normalisation d'un CV, prédicat de visibilité, verdict d'identité, messages, bornes,
 * causes d'échec du modèle) tournent ici sur des cas fabriqués (§E.33).
 *
 * CE QU'IL NE VOIT PAS, ET IL FAUT LE LIRE :
 *   · la base : les fonctions SQL sont lues, pas exécutées — leur comportement est prouvé par pgTAP
 *     (`supabase/tests/database/profil/*`, `matching/*`, `grand_livre/verification_conclue`, `…/travaux_ia`),
 *     que seul `npx supabase test db --local` fait tourner ;
 *   · un navigateur : l'écran se lit dans le code (le dépôt n'a pas de navigateur de test) ;
 *   · l'hébergeur : que `maxDuration = 300` soit accepté par le plan Vercel.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const existe = (p) => existsSync(join(ROOT, p))
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
const section = (t) => console.log(`\n═══ ${t} ═══\n`)

const MIGRATIONS = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
const migration = (suffixe) => {
  const f = MIGRATIONS.filter((m) => m.endsWith(`_${suffixe}.sql`))
  if (f.length !== 1) {
    console.error(`✘ migration « ${suffixe} » : ${f.length} correspondance(s) — le contrôle ne tourne pas sur une ambiguïté (§G.3)`)
    process.exit(2)
  }
  return sansCommentairesSql(lire(`supabase/migrations/${f[0]}`))
}
/** La DERNIÈRE définition d'une fonction SQL, toutes migrations confondues. */
const corpsSql = (nom) => {
  let corps = ''
  for (const f of MIGRATIONS) {
    const m = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${nom}\\s*\\([\\s\\S]*?\\$fn\\$([\\s\\S]*?)\\$fn\\$`, 'i').exec(lire(`supabase/migrations/${f}`))
    if (m) corps = sansCommentairesSql(m[1])
  }
  return corps
}
const LANGUES = ['fr', 'en', 'es', 'de']
const MESSAGES = Object.fromEntries(LANGUES.map((l) => [l, JSON.parse(lire(`messages/${l}.json`))]))
const cle = (o, chemin) => chemin.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o)
const dans4Langues = (chemin) => LANGUES.every((l) => typeof cle(MESSAGES[l], chemin) === 'string' && cle(MESSAGES[l], chemin).length > 0)

let modules
try {
  modules = {
    types: await importer('lib/profil/types-experience.ts'),
    norm: await importer('lib/profil/normaliser-analyse.ts'),
    vis: await importer('lib/profile-visibility.ts'),
    verdict: await importer('lib/identite/verdict.ts'),
    refusProfil: await importer('lib/profil/refus-profil.ts'),
    refusCv: await importer('lib/profil/refus-depot-cv.ts'),
    cause: await importer('lib/profil/cause-echec-modele.ts'),
    bornes: await importer('lib/profil/bornes-saisie.ts'),
  }
} catch (err) {
  console.error('✘ un module pur ne se charge pas — le contrôle n’a pas tourné', err)
  process.exit(2)
}

// ─────────────────────────────────────────────────────────────────────────────
section('A. Les types d’expérience : UNE liste — TypeScript, base, contrainte, analyseurs (point 4)')
{
  const ts = [...modules.types.TYPES_EXPERIENCE]
  const sql = /select\s+array\[([^\]]*)\]::text\[\]/.exec(corpsSql('types_experience'))?.[1]
  const listeSql = sql ? [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : []
  ok(listeSql.length > 0 && JSON.stringify(ts) === JSON.stringify(listeSql),
    `la liste TypeScript (${ts.join(', ')}) est EXACTEMENT celle de types_experience() (${listeSql.join(', ')})`)
  ok(/add constraint profile_experiences_experience_type_check\s+check \(experience_type::text = any \(public\.types_experience\(\)\)\)/.test(migration('types_experience')),
    'la contrainte LIT la fonction (aucune troisième copie en base)')
  for (const p of ['lib/cv-parser.ts', 'lib/cv-parser-cdi.ts']) {
    const src = sansCommentaires(lire(p))
    ok(/enum: \[\.\.\.TYPES_EXPERIENCE\]/.test(src) && !/enum: \['career', 'project'\]/.test(src), `${p} : le schéma de l’analyseur LIT la liste partagée`)
  }
  ok(/'experience_type', 'project'/.test(lire('supabase/tests/database/profil/analyse_cv.test.sql')) && !/'mission'/.test(lire('supabase/tests/database/profil/analyse_cv.test.sql')),
    'le test analyse_cv pose un type ADMIS (il posait « mission », que la table refuse)')
}

// ─────────────────────────────────────────────────────────────────────────────
section('B. B1 — la disponibilité est DEMANDÉE et ENVOYÉE (freelance)')
{
  const v = sansCommentaires(lire('app/[locale]/dashboard/freelance/profil/valider/page.tsx'))
  ok(/ref=\{fieldRefs\.availability\}/.test(v), 'le champ « disponibilité » est à l’écran, et le surlignage a une cible')
  ok(/availability_status: availabilityStatus,/.test(v) && !/availabilityStatus \|\| 'available'/.test(v),
    'l’écran ne SUPPOSE plus « available » : il envoie ce que l’expert a répondu')
  ok(/\(\['available', 'do_not_disturb'\] as const\)\.map/.test(v) && dans4Langues('profile_validation.sections.availability.status_label'),
    'la question a ses deux réponses, sans valeur cochée d’avance, dans les quatre langues')
  const cdi = sansCommentaires(lire('app/[locale]/dashboard/cdi/profil/valider/page.tsx'))
  ok(/cdi_status: cdiStatus,/.test(cdi), 'le jumeau CDI envoie sa disponibilité (cdi_status)')
}

// ─────────────────────────────────────────────────────────────────────────────
section('C. B2 — la fiche admin d’un expert s’ouvre : aucun embed sur une clé morte')
{
  const fichiers = []
  const marche = (d) => {
    for (const e of readdirSync(join(ROOT, d))) {
      const p = `${d}/${e}`
      if (statSync(join(ROOT, p)).isDirectory()) marche(p)
      else if (/\.(ts|tsx)$/.test(e)) fichiers.push(p)
    }
  }
  for (const d of ['app', 'lib', 'components']) marche(d)
  const embeds = fichiers.filter((f) => /['`][^'`\n]*\bspecialities\(/.test(sansCommentaires(lire(f))))
  ok(embeds.length === 0, 'aucune requête n’embarque `specialities(…)` (la clé profiles.speciality_id est morte)', embeds.join(', '))
  const g = sansCommentaires(lire('app/api/admin/get-expert/[id]/route.ts'))
  ok(/'speciality_ids, speciality_other, '/.test(g) && /from\('specialities'\)\.select\('id, name, slug'\)\.in\('id', idsSpecialites\)/.test(g),
    'les spécialités se résolvent depuis speciality_ids')
  ok(/if \(expRes\.error \|\| eduRes\.error \|\| langRes\.error \|\| spsRes\.error\)/.test(g), 'une fiche amputée n’est pas servie (les erreurs sont LUES)')
}

// ─────────────────────────────────────────────────────────────────────────────
section('D. B3, M3 — les travaux d’IA ne dépendent plus d’une requête plafonnée (point 6)')
{
  const patch = sansCommentaires(lire('app/api/profile/route.ts'))
  ok(!/runExpertVerification|evaluerVerificationExpert/.test(patch) && /await deposerVerificationExpert\(supabaseAdmin, journal, \{ profileId: cp\.id \}\)/.test(patch),
    'la publication DÉPOSE la vérification, elle ne l’exécute plus')
  ok(/export const maxDuration = 30/.test(lire('app/api/profile/route.ts')), 'la route de publication n’a plus de travail long (30 s)')
  for (const [r, voie] of [['app/api/profile/upload-cv/route.ts', 'expert_freelance'], ['app/api/profile/cdi-upload-cv/route.ts', 'expert_cdi']]) {
    const src = lire(r)
    ok(new RegExp(`return deposerCv\\(request, '${voie}'\\)`).test(src) && /export const maxDuration = 30/.test(src), `${r} : la porte dépose, rien de long`)
  }
  const depot = sansCommentaires(lire('lib/profil/depot-cv.ts'))
  ok(!/parseCV|parseCdiCV/.test(depot) && /await deposerAnalyseCv\(supabaseAdmin, journal, \{/.test(depot) && /, 202\)/.test(depot),
    'le dépôt stocke et DÉPOSE ; il répond 202, sans appeler le modèle')
  const route = lire('app/api/cron/travaux-ia/route.ts')
  ok(/export const maxDuration = 300/.test(route) && /prendreBailRun\(/.test(route) && /executerTravauxDus\(/.test(route), 'l’exécutant a son propre budget (300 s), sous bail')
  const sql = migration('travaux_ia')
  ok(/select cron\.schedule\(\s*'travaux_ia_pilote',\s*'\* \* \* \* \*',\s*\$job\$select public\.piloter_travaux_ia\(\)\$job\$/.test(sql), 'le pilote pg_cron tourne CHAQUE MINUTE, en SQL (aucun cron d’hébergeur)')
  const clore = corpsSql('clore_travaux_ia_perdus')
  ok(/t\.statut = 'en_cours' and t\.bail_jusqu_a < now\(\)/.test(clore) && /t\.statut = 'en_attente' and t\.prochaine_tentative_at < now\(\) - p_attente_max/.test(clore),
    'le pilote clôt ce qui est perdu : un bail expiré, un travail que personne ne prend')
  const repli = corpsSql('clore_travail_ia_en_echec')
  ok(/set cv_parsing_status = 'failed', cv_parsing_error = p_code/.test(repli) && /poser_verdict_verification\(v_t\.piece, v_t\.profile_id, false, 'manual_only', null, 'travail_echoue'\)/.test(repli),
    'le REPLI en base : analyse « échouée, nommée », vérification en revue humaine — aucun profil « en cours » pour toujours')
  ok(/unique index if not exists travaux_ia_un_actif\s+on public\.travaux_ia \(profile_id, nature\) where statut in \('en_attente', 'en_cours'\)/.test(sql),
    'au plus un travail ACTIF par profil et par nature : la garde est une clé (§E.31)')
  const admin = sansCommentaires(lire('app/api/admin/travaux-ia/route.ts'))
  ok(/rpc\('travaux_ia_en_souffrance'\)/.test(admin) && /rpc\('relancer_travail_ia'/.test(admin)
     && /rpc\('travaux_ia_en_souffrance', \{\}, \{ count: 'exact', head: true \}\)/.test(lire('app/api/admin/supervision/route.ts'))
     && /cle: 'travaux_ia_en_souffrance',\s*gravite: 'bloquant'/.test(lire('lib/supervision/problemes.ts')),
    'l’admin VOIT et RELANCE ; la supervision rougit sur la MÊME liste (§E.36)')
  ok(existe('app/[locale]/admin/travaux-ia/page.tsx') && /href: '\/admin\/travaux-ia'/.test(lire('lib/nav-config.ts')), 'l’écran « Travaux d’IA » existe, et le menu y mène')
}

// ─────────────────────────────────────────────────────────────────────────────
section('E. B4 — « Autre » est publiable (prédicat EXÉCUTÉ, contrainte lue)')
{
  const base = {
    title: 'Architecte', summary: 'x'.repeat(300), skills: ['a', 'b', 'c'], branch_id: 'b', speciality_ids: [],
    seniorities: ['senior'], work_zone_ids: ['z'], availability_status: 'available', cdi_status: null,
    experiences_count: 1, languages_count: 1, cv_parsing_status: 'done', ai_consent_at: '2026-09-30',
  }
  ok(!modules.vis.missingForVisibility({ ...base, speciality_other: 'Sonde' }, 'expert_freelance').includes('speciality_ids'),
    'une précision « Autre » TIENT le critère « spécialité »')
  ok(modules.vis.missingForVisibility({ ...base, speciality_other: '  ' }, 'expert_freelance').includes('speciality_ids'),
    '… une précision vide, non')
  ok(/or nullif\(btrim\(speciality_other\), ''\) is not null/.test(migration('specialite_autre_publiable')), 'la contrainte en base dit la même chose')
  // m5 : le résumé se mesure en caractères, comme la base.
  const resume = '😀'.repeat(500)
  ok(!modules.vis.missingForVisibility({ ...base, summary: resume, speciality_other: 'X' }, 'expert_freelance').includes('summary'),
    'm5 — 500 emojis font 500 caractères (et non 1000 unités UTF-16, au-delà de 800), comme `char_length` en base')
}

// ─────────────────────────────────────────────────────────────────────────────
section('F. Point 5 — une valeur fautive ne rejette plus l’analyse (normalisation EXÉCUTÉE)')
{
  const n = modules.norm.normaliserAnalyse({
    title: '  Architecte  ', summary: 'Phrase. '.repeat(150), years_experience: 7.5, country: 'France',
    seniorities: ['senior', 'chef'], work_modes: ['remote', 'nomade'], skills: ['Azure', 'azure', ' '],
    linkedin_url: 'linkedin.com/in/x',
    experiences: [
      { experience_type: 'mission', role: 'Consultant', start_date: '2020-01', end_date: '2021', is_current: false },
      { experience_type: 'career', role: '', start_date: '2019-01-01' },
      { experience_type: 'career', role: 'Chef', start_date: 'jamais', employer: 'Sonde' },
    ],
    educations: [{ school: 'Sonde', degree: 'Master', start_year: 2008.4, end_year: 2010 }],
    languages_structured: [
      { language: 'Français', level: 'natif', is_primary: true },
      { language: 'français', level: 'C2', is_primary: true },
      { language: 'Anglais', level: 'Z9' },
    ],
    first_name: 'Autre', photo_url: 'https://mouchard.invalid/x.png',
  })
  const a = (code) => n.ecarts.some((e) => e.code === code)
  ok(n.experiences?.[0]?.start_date === '2020-01-01' && n.experiences?.[0]?.end_date === '2021-01-01' && a('date_completee'), '« 2020-01 » et « 2021 » sont COMPLÉTÉS, et c’est dit')
  ok(n.experiences?.[0]?.experience_type === 'project' && a('type_ramene'), 'le type « mission » est ramené à la liste (project), et c’est dit')
  ok(n.experiences?.length === 1 && a('ligne_sans_intitule') && a('date_illisible'), 'une ligne sans intitulé et une date illisible sont ÉCARTÉES, le reste gardé')
  ok(n.profil.years_experience === 8 && a('nombre_arrondi'), 'une décimale est ARRONDIE, et c’est dit')
  ok(n.profil.country === null && a('code_pays_illisible'), 'un pays illisible est écarté, et c’est dit')
  ok(JSON.stringify(n.profil.seniorities) === '["senior"]' && JSON.stringify(n.profil.work_modes) === '["remote"]' && a('valeur_hors_liste'), 'une valeur hors liste est écartée, et c’est dit')
  ok(Array.from(n.profil.summary).length <= 800 && a('resume_raccourci'), 'un résumé trop long est RACCOURCI à une phrase entière')
  ok(n.langues?.length === 1 && n.langues[0].level === 'native' && a('niveau_ramene') && a('doublon'), 'un niveau « natif » est ramené ; un doublon et un niveau inconnu écartés')
  ok(!('first_name' in n.profil) && !('photo_url' in n.profil), 'ni l’identité ni une adresse d’image ne sortent de l’analyse (§E.87, §E.17)')
  ok(n.profil.linkedin_url === null && a('adresse_web_illisible'), 'une adresse web illisible est écartée')
  const codesSql = [...lire(`supabase/migrations/${MIGRATIONS.find((f) => f.endsWith('_analyse_cv_tolerante.sql'))}`).matchAll(/'code', '([a-z_]+)'/g)].map((m) => m[1])
  const inconnus = [...new Set(codesSql)].filter((c) => !modules.norm.CODES_ECART.includes(c))
  ok(codesSql.length > 5 && inconnus.length === 0, 'chaque écart que la BASE rend a son code dans la liste partagée', inconnus.join(', '))
  const manquants = modules.norm.CODES_ECART.filter((c) => !dans4Langues(`ecarts_analyse.codes.${c}`))
  ok(manquants.length === 0, `chaque écart a son message, dans les quatre langues (${modules.norm.CODES_ECART.length})`, manquants.join(', '))
  const ecrire = corpsSql('ecrire_analyse_cv')
  ok((ecrire.match(/exception when sqlstate 'AC001' then/g) ?? []).length === 3 && /when others then\s+v_ecarts := v_ecarts \|\| jsonb_build_object\('bloc', 'profil', 'champ', v_col, 'code', 'valeur_refusee'/.test(ecrire),
    'en base : un champ refusé n’emporte pas les autres ; une liste entièrement refusée n’efface rien')
  // LA LIGNE DYNAMIQUE TOURNE, SUR CHAQUE COLONNE (ARRÊT 19, rejeu local) : le test G écrit un profil propre
  // et exige zéro écart ; ses clés doivent être EXACTEMENT la liste fermée de la fonction — une colonne
  // ajoutée à la liste sans passer par le test rougit ici.
  const listeFermee = [...(/c_colonnes constant text\[\] := array\[([\s\S]*?)\];/.exec(ecrire)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  const testTol = lire('supabase/tests/database/profil/analyse_cv_tolerante.test.sql')
  const blocG = /v_complet := jsonb_build_object\(([\s\S]*?)\);\n/.exec(testTol)?.[1] ?? ''
  // Les arguments de PREMIER niveau de jsonb_build_object : on efface les parenthèses imbriquées (valeurs
  // composées), on coupe aux virgules ; les clés sont aux positions paires.
  let plat = blocG
  for (let avant = ''; avant !== plat;) { avant = plat; plat = plat.replace(/\([^()]*\)/g, '') }
  const args = plat.split(',').map((x) => x.trim())
  const clesTest = args.filter((_, i) => i % 2 === 0).map((x) => /^'([a-z_]+)'$/.exec(x)?.[1] ?? `?${x}`).sort()
  ok(listeFermee.length === 28 && JSON.stringify(listeFermee) === JSON.stringify(clesTest)
     && /jsonb_array_length\(v_res -> 'ecarts'\) = 0/.test(testTol) && /to_jsonb\(p\) -> e\.key is distinct from e\.value/.test(testTol),
    `la ligne dynamique d'ecrire_analyse_cv est EXÉCUTÉE par un test sur les ${listeFermee.length} colonnes de la liste fermée, aucun écart admis`,
    `liste : ${listeFermee.join(',')} · test : ${clesTest.join(',')}`)
  ok(/for v_col in select c\.colonne from unnest\(c_colonnes\) as c\(colonne\) loop/.test(ecrire) && !/foreach v_col in array c_colonnes/.test(ecrire),
    'la boucle ne donne pas à plpgsql_check le tableau entier pour valeur (for … in select, pas foreach sur la constante)')
  ok(/cv_parsing_count_24h = case when p\.cv_parsing_reset_at > now\(\)/.test(ecrire) && !/cv_parsing_count_24h/.test(sansCommentaires(lire('lib/profil/depot-cv.ts')).replace(/cv_parsing_count_24h, cv_parsing_reset_at/, '').replace(/profile\.cv_parsing_count_24h/g, '')),
    'le quota ne compte que l’analyse ABOUTIE, dans la transaction qui l’écrit — le dépôt ne le compte plus')
  const ex = sansCommentaires(lire('lib/travaux-ia/executer-analyse.ts'))
  ok(/acteur: \{ type: 'non_imputable', pourquoi: `analyse non écrite/.test(ex), 'une analyse que NOUS n’avons pas su écrire n’est pas imputée à l’expert')
  // Les causes d'échec du modèle : une panne se rejoue, un document refusé non.
  const c = modules.cause
  ok(c.causeEchecModele({ status: 529 }) === 'modele_indisponible' && c.estRejouable('modele_indisponible')
     && c.causeEchecModele({ status: 400 }) === 'document_refuse' && !c.estRejouable('document_refuse')
     && c.causeEchecModele(new Error('ANTHROPIC_API_KEY missing')) === 'configuration',
    'une surcharge du fournisseur se REJOUE ; un document refusé, une clé absente, non (exécuté)')
}

// ─────────────────────────────────────────────────────────────────────────────
section('G. M1 — une déconnexion dit SON motif (verdict EXÉCUTÉ)')
{
  const { verdictCompte } = modules.verdict
  ok(verdictCompte('a', null) === 'absent' && verdictCompte('a', 'b') === 'different', 'plus aucune session = une déconnexion, jamais « un autre compte »')
}

// ─────────────────────────────────────────────────────────────────────────────
section('H. M4 — les listes du profil : tout ou rien, un refus nommé')
{
  const patch = sansCommentaires(lire('app/api/profile/route.ts'))
  ok(/rpc\('remplacer_listes_profil', \{/.test(patch) && !/\.delete\(\)/.test(patch), 'la route ne supprime plus rien elle-même')
  ok(/if \(listesErr\.code === 'LP001'\)[\s\S]{0,400}?code: 'liste_refusee', \.\.\.cause \}, 400\)/.test(patch), 'une ligne refusée rend 400 liste_refusee, avec la liste, le rang, la cause')
}

// ─────────────────────────────────────────────────────────────────────────────
section('I. M5, M6 — la première recherche est rejouée si elle échoue, et un e-mail ne l’annule pas')
{
  ok(/matching_relance_due_at\s*=\s*coalesce\(matching_relance_due_at, now\(\)\)/.test(corpsSql('echouer_relance_expert')), 'un échec POSE une échéance (le pilote le rejoue, l’écran le dit)')
  const imm = sansCommentaires(lire('lib/matching/mise-en-relation-immediate.ts'))
  ok(/await marquerTentativeRelance\(admin, profileId\)/.test(imm) && /await echouerRelance\(admin, profileId, codeDEchec\(verdict\)\)/.test(imm), 'la recherche immédiate compte la tentative et enregistre l’échec')
  for (const f of ['app/api/admin/approve-expert/route.ts', 'lib/travaux-ia/executer-verification.ts', 'lib/travaux-ia/executer-analyse.ts']) {
    ok(/lancerMiseEnRelationImmediate\(/.test(sansCommentaires(lire(f))), `${f} passe par la recherche immédiate UNIQUE`)
  }
  const ap = sansCommentaires(lire('app/api/admin/approve-expert/route.ts'))
  const corpsAfter = ap.slice(ap.indexOf('after(async () => {'))
  ok(corpsAfter.indexOf('lancerMiseEnRelationImmediate(') > 0 && corpsAfter.indexOf('lancerMiseEnRelationImmediate(') < corpsAfter.indexOf('await envoyerBienvenue()')
     && !/\breturn\b/.test(corpsAfter.slice(0, corpsAfter.indexOf('lancerMiseEnRelationImmediate('))),
    'M6 — la recherche passe AVANT l’e-mail, et aucun `return` ne la saute')
  for (const voie of ['freelance', 'cdi']) {
    const acc = sansCommentaires(lire(`app/[locale]/dashboard/${voie}/page.tsx`))
    ok(/derniereRecherche\?\.etat === 'echec'/.test(acc), `l’accueil ${voie} dit qu’une recherche a échoué, au lieu d’« aucune mission »`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
section('J. M7 — la notification d’une mise en relation s’écrit (§E.69)')
{
  const sh = sansCommentaires(lire('lib/matching/shared.ts'))
  ok(/rpc\('poser_notifications_match', \{ p_lignes: tranche \}\)/.test(sh) && !/onConflict: 'user_id,entity_id'/.test(sh), 'l’insertion passe par la RPC, plus par un upsert sans prédicat')
  ok(/if \(!enPlace\.has\(`\$\{s\.user_id\}:::\$\{s\.publication_id\}`\)\) continue/.test(sh), 'une correspondance ne passe « notifiée » que si sa notification EXISTE')
}

// ─────────────────────────────────────────────────────────────────────────────
section('K. M8 — aucun écran n’écrit `profiles` depuis le navigateur')
{
  const aa = sansCommentaires(lire('lib/availability-actions.ts'))
  ok(!/setExpertListening|\.from\('profiles'\)/.test(aa), '« Repasser à l’écoute » n’a plus d’écriture navigateur')
  ok(/basculerDisponibilite\(\s*secureFetch,/.test(sansCommentaires(lire('components/dashboard/DndEmptyState.tsx'))), 'la bascule passe par POST /api/profile/disponibilite')
}

// ─────────────────────────────────────────────────────────────────────────────
section('L. M9, m6 — chaque refus de l’enregistrement dit sa raison (EXÉCUTÉ)')
{
  const { CLE_PAR_CODE, messageRefusProfil, LISTES_NOMMEES, CAUSES_DE_LISTE, CHAMPS_NOMMES } = modules.refusProfil
  const patch = sansCommentaires(lire('app/api/profile/route.ts'))
  const codes = [...new Set([...patch.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]))].filter((c) => c !== 'incomplete')
  const sansMessage = codes.filter((c) => !(c in CLE_PAR_CODE))
  ok(codes.length >= 15 && sansMessage.length === 0, `chacun des ${codes.length} codes de PATCH /api/profile a son message`, sansMessage.join(', '))
  const cles = [...new Set(Object.values(CLE_PAR_CODE)), 'liste_refusee_sans_rang', 'incomplet',
    ...LISTES_NOMMEES.map((l) => `listes.${l}`), ...CAUSES_DE_LISTE.map((c) => `causes.${c}`), ...CHAMPS_NOMMES.map((c) => `champs.${c}`)]
  const manquantes = cles.filter((c) => !dans4Langues(`profil_refus.${c}`))
  ok(manquantes.length === 0, `chaque message existe dans les quatre langues (${cles.length})`, manquantes.join(', '))
  const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`
  ok(messageRefusProfil({ code: 'journal_error' }, 500, t) === 'journal' && messageRefusProfil({ code: 'jamais_vu' }, 500, t).startsWith('inattendu')
     && /liste_refusee.*"rang":2/.test(messageRefusProfil({ code: 'liste_refusee', liste: 'experiences', rang: 2, cause: 'fin_avant_debut' }, 400, t)),
    'journal_error après une publication RÉUSSIE ne se dit plus « échec » ; un code inconnu est CITÉ ; une liste refusée NOMME son rang')
  for (const voie of ['freelance', 'cdi']) {
    const src = sansCommentaires(lire(`app/[locale]/dashboard/${voie}/profil/valider/page.tsx`))
    ok(/messageRefusProfil\(payload, res\.status,/.test(src) && !/setErrorMsg\(tProfile\('errors\.save_failed'\)\)\s*\}\s*return/.test(src), `la validation ${voie} passe par la table des refus`)
    const mp = sansCommentaires(lire(`app/[locale]/dashboard/${voie}/mon-profil/page.tsx`))
    ok(/tRefus\('incomplet', \{/.test(mp) && /messageRefusProfil\(payload, res\.status,/.test(mp), `« Mon profil » ${voie} NOMME ce qui manque`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
section('M. M10 — le verdict automatique s’écrit au grand livre')
{
  ok(/'verification_conclue', 'reussi', 'systeme'/.test(corpsSql('poser_verdict_verification')), 'poser_verdict_verification écrit verification_conclue, origine système')
  ok(/'verification_conclue'/.test(lire('lib/journal/actions.ts')) && dans4Langues('journal.actions.verification_conclue'), 'l’action est dans la liste fermée TS, et libellée en quatre langues')
  ok(/status\s*= case when p_approuve and u\.status = 'in_review' then 'active' else u\.status end/.test(corpsSql('poser_verdict_verification'))
     && /status\s*= case when p_approuve and u\.status = 'in_review' then 'active' else u\.status end/.test(corpsSql('statuer_sur_expert')),
    'm — le compte quitte « en revue » à l’approbation, automatique ou humaine')
}

// ─────────────────────────────────────────────────────────────────────────────
section('N. M11, M12, et les mineurs')
{
  for (const voie of ['freelance', 'cdi']) {
    const src = sansCommentaires(lire(`app/[locale]/dashboard/${voie}/profil/valider/page.tsx`))
    ok(/__illisible: true/.test(src) && /if \(taxonomieIndisponible\) \{/.test(src), `M11 — ${voie} : un référentiel illisible bloque l’enregistrement au lieu d’effacer`)
    ok(/listesLues\.includes\('languages_structured'\) \? \{ languages: /.test(src), `m — ${voie} : la liste plate des langues n’est envoyée que si elle a été lue`)
    ok(/sessionDuCompteAffiche\(\)/.test(src), `m7 — ${voie} : la validation lit l’identité par le compte affiché`)
    ok(/<EcartsAnalyse profileId=\{profileId\} \/>/.test(src), `point 5 — ${voie} : les écarts de l’analyse sont DITS`)
    const m = sansCommentaires(lire(`app/[locale]/dashboard/${voie}/missions/page.tsx`))
    ok(/notificationsActives \? t\('empty_subtitle'\) : t\('empty_subtitle_sans_notification'\)/.test(m) && /horsDuMoteur \? \(/.test(m),
      `M12, m — missions ${voie} : « vous serez notifié » seulement si c’est vrai ; « hors du moteur » est dit`)
  }
  ok(/\.or\(filtreEnAttente\)/.test(lire('lib/notifications/dispatch.ts')) && /CANAUX_OUVERTS\.map/.test(lire('lib/notifications/dispatch.ts')), 'M7 — le dispatcher n’attend que les canaux OUVERTS (une notification posée part)')
  ok(/upsert\(toInsert, \{ onConflict: 'publication_id,profile_id', ignoreDuplicates: true \}\)/.test(lire('lib/matching/reconcile.ts')), 'm9 — deux runs sur une paire ne font plus échouer le lot')
  ok(!/\.neq\('created_by'/.test(sansCommentaires(lire('lib/matching/run-for-expert.ts'))), 'm8 — une annonce sans auteur n’est plus écartée du sens expert')
  ok(!/verification_attempts/.test(sansCommentaires(lire('lib/verification/expert-verification.ts'))), 'm2 — plus d’écriture muette dans verification_attempts')
  const ia = sansCommentaires(lire('lib/verification/ai-expert-verification.ts'))
  ok(/message\.stop_reason === 'pause_turn'/.test(ia) && /maxRetries: 0/.test(ia) && /usages\.push\(consommationJetons\(model, message\.usage\)\)/.test(ia),
    'm4 — un tour mis en pause se reprend ; chaque tentative payée est comptée ; aucun rejeu caché du SDK')
  const ev = sansCommentaires(lire('lib/verification/expert-verification.ts'))
  ok(/if \(expRes\.error \|\| eduRes\.error \|\| langRes\.error \|\| domRes\.error\) \{[\s\S]{0,400}?return 'indisponible'/.test(ev)
     && /if \(aiOut\.echec === 'modele_indisponible'\) return \{ issue: 'rejouer'/.test(ev) && /return deferer\(cause, NOTE_ECHEC\[cause\]/.test(ev),
    'm3 — une panne de lecture se rejoue au lieu de se dire « domaine introuvable » ; un échec du modèle est déféré avec SA cause')
  const exa = sansCommentaires(lire('lib/travaux-ia/executer-analyse.ts'))
  ok(!/cv_parsing_count_24h/.test(exa) && /rpc\('terminer_analyse_cv'/.test(exa),
    'm1 — un refus au dépôt (budget, référentiel) ne consomme plus d’analyse : le quota se compte à l’écriture réussie, en base')
  // Les bornes de saisie sont celles de la BASE.
  const base = lire('supabase/migrations/00000000000000_baseline.sql')
  const longueur = (table, col) => {
    const bloc = new RegExp(`CREATE TABLE IF NOT EXISTS "public"\\."${table}" \\(([\\s\\S]*?)\\n\\);`).exec(base)?.[1] ?? ''
    return Number(new RegExp(`"${col}" character varying\\((\\d+)\\)`).exec(bloc)?.[1] ?? NaN)
  }
  const L = modules.bornes.LONGUEURS_SAISIE
  const pairs = [['profiles', 'title', L.title], ['profiles', 'location', L.location], ['profiles', 'linkedin_url', L.linkedin_url], ['profiles', 'phone', L.phone],
    ['profiles', 'address_line', L.address_line], ['profiles', 'postal_code', L.postal_code], ['profiles', 'city', L.city],
    ['profile_experiences', 'role', L.role], ['profile_experiences', 'employer', L.employer], ['profile_experiences', 'client_name', L.client_name],
    ['profile_experiences', 'sector', L.sector], ['profile_educations', 'school', L.school], ['profile_educations', 'degree', L.degree],
    ['profile_educations', 'field', L.field], ['profile_educations', 'location', L.education_location], ['profile_languages', 'language', L.language]]
  const divergentes = pairs.filter(([t, c, v]) => longueur(t, c) !== v).map(([t, c, v]) => `${t}.${c} : ${v} ≠ ${longueur(t, c)}`)
  ok(divergentes.length === 0, `M4 — les ${pairs.length} longueurs de saisie sont celles des colonnes (une ligne trop longue n’arrive plus au serveur)`, divergentes.join(' · '))
  ok(/"birth_year" > 1920/.test(base) && modules.bornes.ANNEE_NAISSANCE_MIN === 1921 && /"start_year" > 1950/.test(base) && modules.bornes.ANNEE_FORMATION_MIN === 1951,
    'M4 — les années bornées sont celles des contraintes')
}

// ─────────────────────────────────────────────────────────────────────────────
section('O. Point 7 — le profil se remplit par le CV ou l’export LinkedIn')
{
  const bandeau = sansCommentaires(lire('components/profile/ProfilMasqueBanner.tsx'))
  ok(!/manquants\.map/.test(bandeau) && /tMasque\('cta'\)/.test(bandeau), 'le bandeau ne liste plus de champs ; il mène à l’import')
  ok(/href="\/dashboard\/freelance\/profil"\n/.test(lire('app/[locale]/dashboard/freelance/page.tsx')) && /href="\/dashboard\/cdi\/profil"\n/.test(lire('app/[locale]/dashboard/cdi/page.tsx')),
    'les deux tableaux de bord mènent le bandeau à l’IMPORT')
  const guide = sansCommentaires(lire('components/dashboard/ExpertOnboardingGuide.tsx'))
  ok(!/profil\/valider/.test(guide), 'les étapes de démarrage mènent à l’import, jamais au formulaire')
  for (const voie of ['freelance', 'cdi']) {
    const up = sansCommentaires(lire(`app/[locale]/dashboard/${voie}/profil/page.tsx`))
    ok(new RegExp(`<EtatAnalyseCv validerHref="/dashboard/${voie}/profil/valider" />`).test(up) && /suivreAnalyse\(secureFetch, payload\.jobId, setReprise\)/.test(up),
      `l’import ${voie} dit où en est l’analyse, et la SUIT jusqu’à son issue`)
  }
  ok(/export PDF d'un profil LinkedIn/.test(lire('lib/cv-parser.ts')) && /export PDF d'un profil LinkedIn/.test(lire('lib/cv-parser-cdi.ts')), 'les deux analyseurs lisent l’export PDF LinkedIn')
}

// ─────────────────────────────────────────────────────────────────────────────
section('P. Mise en page — pleine largeur, alignée à gauche, jamais centrée ni bornée')
{
  for (const f of ['app/[locale]/admin/travaux-ia/page.tsx', 'components/profile/EtatAnalyseCv.tsx', 'components/profile/EcartsAnalyse.tsx', 'components/profile/ProfilMasqueBanner.tsx']) {
    const src = sansCommentaires(lire(f))
    const fautif = /maxWidth|margin:\s*'0 auto'|textAlign:\s*'center'|justifyContent:\s*'center'/.exec(src)
    ok(!fautif, `${f} : aucune largeur bornée, aucun centrage`, fautif?.[0])
  }
  ok(/<div style=\{\{ padding: 24,/.test(lire('app/[locale]/admin/travaux-ia/page.tsx')), 'l’écran « Travaux d’IA » a sa marge de 24 px')
}

console.log(echecs === 0 ? '\n✅ Du CV à la première mise en relation : chaque mur de l’audit est fermé, et le contrôle le vérifie.' : `\n✘ ${echecs} CONTRÔLE(S) EN ÉCHEC`)
process.exit(echecs === 0 ? 0 : 1)
