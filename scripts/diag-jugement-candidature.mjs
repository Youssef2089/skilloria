// scripts/diag-jugement-candidature.mjs — LE SEUL ENDROIT OÙ CLAUDE SUBSISTE
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE SCRIPT DÉFEND, ET CE QU'IL A CESSÉ DE DÉFENDRE
//
//   IL Y AVAIT UN FILTRE DE SORTIE. Les années étaient expurgées du document
//   envoyé, et un texte produit qui en contenait était refusé. Ce script
//   l'éprouvait. Le filtre est RETIRÉ, et ces contrôles avec lui.
//
//   Ce qui l'a condamné n'est pas le refus, c'est l'AMPUTATION : sur une place
//   de marché Microsoft, les produits portent des années — SQL Server 2019,
//   Dynamics AX 2012, SharePoint 2016. Le modèle recevait « Expert Dynamics AX
//   … et SQL Server … ». On effaçait la compétence en croyant protéger l'âge,
//   et précisément sur les profils les plus pointus.
//
//   LA CONFORMITÉ VIT DÉSORMAIS DANS LE PROMPT. Ce script vérifie donc que la
//   consigne EST ÉCRITE — interdictions, autorisation explicite des produits
//   versionnés, exigence de durées relatives — et que le filtre n'est pas
//   revenu par une autre porte.
//
//   ⚠️ LA RÈGLE LA PLUS IMPORTANTE A ÉTÉ REMPLACÉE, LE 23/09/2026.
//   Ce fichier disait : « RIEN NE BLOQUE UNE CANDIDATURE — jugement confiné
//   dans un `after()` ». Youssef a tranché l'inverse : « une candidature avec
//   sa note et son résumé, ou pas de candidature » (§D.19). Le jugement est
//   donc devenu SYNCHRONE et PRÉCÈDE l'écriture.
//
//   CE QUE CE FICHIER NE VÉRIFIE PLUS, ET OÙ ÇA VIT MAINTENANT :
//     « le jugement est dans le after() » → INVERSÉ. La propriété « le
//     jugement précède l'écriture, et l'échec retourne avant elle » est tenue
//     par `scripts/diag-candidature-complete.mjs`, section 3. Elle n'est PAS
//     re-vérifiée ici : deux gardes sur la même panne n'en font qu'une, et la
//     seconde finit par diverger (§E.36).
//
//   CE QU'IL VÉRIFIE ENCORE, ET QUE PERSONNE D'AUTRE NE TIENT : une fois la
//   candidature écrite, PLUS RIEN ne la perd — aucun refus après l'écriture,
//   et aucune exception relevée dans un `after()`.
//
//   ET CE QUI MANQUE SE COMPTE. Trois causes distinctes, jamais additionnées :
//   plafond, modèle indisponible, réponse illisible. Sans ce compteur, le jour
//   où plus aucun résumé n'est produit, personne ne le voit.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-jugement-candidature.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE écriture.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// Les deux LECTEURS survivants sont importés depuis leur module sans
// dépendance : le SDK et le compteur de dépense ne sont pas chargés, et le
// diagnostic peut donc les éprouver pour de vrai.
import { lireNote, lireTexte } from '../lib/candidatures/lecture-reponse.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// NORMALISATION DES FINS DE LIGNE (reprise du tronc) : le depot sort les
// fichiers en CRLF, et un retour chariot casse tout motif qui traverse un
// saut de ligne. Sans elle, ce diagnostic serait vert chez son auteur et
// rouge dans les autres worktrees, sur un fichier identique.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const existe = (p) => existsSync(join(ROOT, p))

function migration(suffixe) {
  const d = join(ROOT, 'supabase', 'migrations')
  const f = readdirSync(d).find((x) => x.endsWith(`_${suffixe}.sql`))
  if (!f) { console.error(`\n❌ Migration introuvable : *_${suffixe}.sql`); process.exit(2) }
  return join('supabase', 'migrations', f)
}

let failures = 0
const ok = (cond, label, hint) => {
  if (!cond) failures++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && hint) console.log(`       → ${hint}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const ASSESSMENT = read('lib/candidatures/ai-assessment.ts')
const LECTURE = read('lib/candidatures/lecture-reponse.ts')
// ⚠️ LE CHEMIN DE DÉPÔT A DÉMÉNAGÉ, ET CE N'EST PAS COSMÉTIQUE.
//    `app/api/candidatures/route.ts` est devenue une COQUILLE : elle
//    authentifie et délègue. Tout le dépôt — gardes, jugement, écriture,
//    dévoilement, cloche, audit — vit dans `lib/candidatures/depot.ts`, parce
//    que le bouton RELANCER du back-office doit rejouer EXACTEMENT ce chemin
//    et non une copie (§E.20). S'ancrer sur la route rendrait ce contrôle vert
//    sur un fichier de quinze lignes.
const DEPOT = read('lib/candidatures/depot.ts').replace(/\r\n/g, '\n')
const PITCH = read('app/api/candidatures/[id]/pitch/route.ts')

// ══════════════════════════════════════════════════════════════════════════
section('A. LE FILTRE DE SORTIE EST PARTI, ET NE REVIENT PAS')
// ══════════════════════════════════════════════════════════════════════════
//
// Retiré, pas neutralisé : pas de drapeau, pas de fonction morte, pas de
// constante orpheline. Un filtre désactivé se réactive ; un filtre supprimé se
// réécrit — et se réécrire demande d'y repenser.

for (const [nom, motif] of [
  ['expurgerAnnees', /expurgerAnnees/],
  ['contientUneAnnee', /contientUneAnnee/],
  ['ANNEE_SOURCE', /ANNEE_SOURCE/],
]) {
  ok(!motif.test(LECTURE), `« ${nom} » n existe plus dans lecture-reponse.ts`,
    'un filtre neutralise se reactive ; un filtre supprime se reecrit')
  ok(!motif.test(ASSESSMENT), `« ${nom} » n est plus appelé par le jugement`)
}
// Aucune expression d'année ne doit subsister ailleurs dans ces deux fichiers.
for (const [nom, src] of [['lecture-reponse.ts', LECTURE], ['ai-assessment.ts', ASSESSMENT]]) {
  const motifs = [...src.matchAll(/\(19\|20\)/g)]
  ok(motifs.length === 0, `${nom} ne porte plus d expression d année`,
    motifs.length ? `trouvé ${motifs.length} occurrence(s)` : undefined)
}

console.log('\n— le document part INTACT\n')
ok(/Résumé : \$\{propre\(p\.summary\) \|\| '\(non précisé\)'\}/.test(ASSESSMENT),
  'le résumé de l expert est envoyé tel quel',
  'l amputer revenait a juger un dossier sur un extrait qu on a soi-meme abime')
ok(/Description : \$\{propre\(a\.description\)\}/.test(ASSESSMENT),
  'la description de l annonce aussi')

// ══════════════════════════════════════════════════════════════════════════
section('B. LA CONSIGNE EST ÉCRITE — c est elle qui porte la règle')
// ══════════════════════════════════════════════════════════════════════════

console.log('— ce qui est INTERDIT\n')
for (const [motif, quoi] of [
  [/une année de diplôme, une année de naissance, une année de début de carrière/, "les années d identité"],
  [/aucune date de début ou de fin de poste/, 'les dates de poste'],
  [/le nom d'un employeur ou d'un client de cette personne/, "l employeur et le client"],
  [/le nom d'une personne, d'une école, d'une ville/, 'personne, école, ville'],
  [/toute autre donnée permettant d'identifier la personne/, 'toute donnée identifiante'],
]) {
  ok(motif.test(ASSESSMENT), `le prompt interdit ${quoi}`)
}

console.log('\n— ce qui est EXPLICITEMENT AUTORISÉ\n')
// Sans autorisation explicite, un modèle prudent éviterait les produits
// versionnés de lui-même : le défaut serait reproduit par un autre chemin, et
// cette fois sans une ligne de code à incriminer.
ok(/Y COMPRIS lorsqu'ils contiennent une année/.test(ASSESSMENT),
  'le prompt autorise les produits versionnés',
  'sans autorisation explicite, un modele prudent les evite de lui-meme')
ok(/l'année fait partie du nom du produit et non de l'identité de la personne/.test(ASSESSMENT),
  'et il en donne la RAISON, pas seulement la permission')
for (const produit of ['Dynamics AX 2012', 'SQL Server 2019', 'SharePoint 2016']) {
  ok(ASSESSMENT.includes(produit), `il donne l exemple « ${produit} »`)
}

console.log('\n— ce qui est EXIGÉ\n')
ok(/exprime-la en RELATIF, jamais par des dates/.test(ASSESSMENT),
  'le prompt exige des durées relatives')
ok(/8 ans sur Dynamics/.test(ASSESSMENT), 'avec un exemple de ce qu il faut écrire')
ok(/diplômé en 2015/.test(ASSESSMENT),
  'et un contre-exemple de ce qu il ne faut pas écrire')

console.log('\n— et pour les DEUX textes\n')
ok(/ELLES VALENT POUR LES DEUX TEXTES/.test(ASSESSMENT),
  'la consigne dit explicitement qu elle couvre reason ET pitch_org',
  'le texte destine a l expert traverse les memes ecrans')

// ══════════════════════════════════════════════════════════════════════════
section('C. UNE FOIS ÉCRITE, PLUS RIEN NE PERD LA CANDIDATURE')
// ══════════════════════════════════════════════════════════════════════════

const lignesDepot = DEPOT.split('\n')
const ligneInsert = lignesDepot.findIndex((l) => l.includes('.insert({')) + 1
ok(ligneInsert > 0, `l INSERT de la candidature est localisé (ligne ${ligneInsert})`)

// 1. AUCUN REFUS APRÈS L'INSERT — sauf ceux de l'INSERT lui-même, qui n'ont
//    aucune candidature à perdre puisque l'écriture a échoué.
//
//    ⚠️ LE VOCABULAIRE A CHANGÉ AVEC LE DÉMÉNAGEMENT, ET LE GARDER AURAIT
//       PRODUIT UN VERT VIDE. Le chemin de dépôt ne rend plus de `Response` :
//       il rend une ISSUE, et c'est la route qui traduit. Un motif cherchant
//       `return json(…, 4xx)` ne trouve donc plus RIEN dans ce fichier — il
//       aurait passé au vert en ne mesurant plus rien (§E.27). On s'ancre sur
//       ce qu'on défend : un retour de REFUS après l'écriture.
{
  const blocInsertErr = (() => {
    const d = lignesDepot.findIndex((l) => l.includes('if (insertErr) {'))
    if (d === -1) return { debut: -1, fin: -1 }
    let prof = 0
    for (let i = d; i < lignesDepot.length; i++) {
      prof += (lignesDepot[i].match(/\{/g) ?? []).length
      prof -= (lignesDepot[i].match(/\}/g) ?? []).length
      if (prof === 0) return { debut: d + 1, fin: i + 1 }
    }
    return { debut: d + 1, fin: -1 }
  })()

  const refusApres = []
  for (let i = 0; i < lignesDepot.length; i++) {
    if (!/return \{ issue: 'refusee'/.test(lignesDepot[i])) continue
    const ligne = i + 1
    if (ligne <= ligneInsert) continue
    // Exception NOMMÉE : les sorties du bloc `if (insertErr)`. L'écriture a
    // échoué, il n'y a pas de candidature à perdre.
    if (ligne >= blocInsertErr.debut && ligne <= blocInsertErr.fin) continue
    refusApres.push(`ligne ${ligne}`)
  }
  ok(refusApres.length === 0,
    'aucun refus après l ÉCRITURE, hormis ceux de l écriture elle-même',
    refusApres.length
      ? `une candidature existe deja a ce point et serait perdue : ${refusApres.join(' · ')}`
      : undefined)
  // Le motif MORD : sans cette preuve, un `0 refus` ne dirait rien de plus
  // qu'un fichier qu'on n'a pas su lire (§E.33).
  ok(/return \{ issue: 'refusee'/.test(DEPOT),
    'le motif de refus existe bien dans ce fichier',
    'zero occurrence : le controle ne mesure plus rien et passe au vert')
}

// 2. Le `after()` qui SUBSISTE ne perd rien non plus.
//    Un seul y reste — l'envoi d'e-mail aux membres de l'organisation, qui est
//    lent et sans effet sur le dossier. Le jugement, lui, en est SORTI : c'est
//    la décision de ce lot, et elle est tenue par diag-candidature-complete.
{
  const iAfter = DEPOT.indexOf('after(async ()')
  const finAfter = DEPOT.indexOf('\n    })', iAfter)
  const corps = DEPOT.slice(iAfter, finAfter)
  ok(iAfter !== -1 && finAfter > iAfter, 'le bloc after() est localisé')
  ok(DEPOT.indexOf('jugerCandidature(') < iAfter,
    'le jugement est HORS du after(), et AVANT lui',
    'differe, la candidature redeviendrait ecrite avant d etre notee (§D.19)')
  // ⚠️ LE NOM DE LA VARIABLE N'EST PAS LA PROPRIÉTÉ (§E.34). Ce motif
  //    exigeait `catch (err)` : un `catch (e)` — la forme la plus courante —
  //    le faisait rougir sur du code parfaitement correct, et un renommage
  //    l'aurait fait verdir sur du code qui ne l'est pas.
  ok(/\}\s*catch\s*\(\s*\w+\s*\)\s*\{/.test(corps),
    'le corps du after() est sous try/catch')
  const relance = /catch\s*\(\s*\w+\s*\)\s*\{[\s\S]*?\bthrow\b/.test(corps)
  ok(!relance, 'et son catch ne relève JAMAIS',
    'une exception relevee dans un after() n a plus personne pour la rattraper')
}

// 4. Côté pitch, un échec rend 200 avec un pitch nul — jamais une erreur.
{
  const echecs = [...PITCH.matchAll(/return json\(\{ pitch: null[\s\S]{0,160}?,\s*(\d{3})\)/g)]
    .map((m) => Number(m[1]))
  ok(echecs.length >= 3 && echecs.every((c) => c === 200),
    `les ${echecs.length} sorties « sans pitch » répondent 200`,
    'une erreur HTTP ici empecherait la carte de s afficher pour un texte d agrement')
}

// ══════════════════════════════════════════════════════════════════════════
section('D. CE QUI MANQUE SE COMPTE — trois causes, jamais additionnées')
// ══════════════════════════════════════════════════════════════════════════

const SQL_PANNES = read(migration('pannes_de_redaction'))
const MODULE_PANNES = read('lib/candidatures/pannes-redaction.ts')
// ⚠️ CES DEUX ADRESSES ETAIENT L ANCRAGE, ET ELLES ONT DEMENAGE.
//    Le compteur de pannes vivait sur /admin/matching. La refonte a separe
//    le REGLAGE de la MESURE (§D.11) : il est parti a /admin/supervision,
//    sous le sujet « resumes ». Le controle a rougi sur le demenagement — et
//    j en ai d abord conclu une PERTE, a tort.
//    On s ancre desormais sur la PROPRIETE : le compteur est lu quelque part,
//    son « je ne sais pas » vaut null, et le detail (cause × surface) est
//    montre quelque part avec des LIBELLES, pas des identifiants de base.
const SURFACES_ADMIN = ['app/api/admin', 'app/[locale]/admin']
const ADMIN = []
const balayerAdmin = (rel) => {
  if (!existsSync(join(ROOT, rel))) return
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const enfant = `${rel}/${e.name}`
    if (e.isDirectory()) balayerAdmin(enfant)
    else if (/.tsx?$/.test(e.name)) ADMIN.push([enfant, read(enfant)])
  }
}
for (const d of SURFACES_ADMIN) balayerAdmin(d)
const partoutAdmin = (motif) => ADMIN.some(([, c]) => motif.test(c))

// ⚠️ LA LISTE A DÉMÉNAGÉ DANS UN MODULE PUR, ET LE TYPE EN EST DÉRIVÉ.
//    Elle vivait en trois exemplaires — le type, la contrainte de la base, le
//    filtre de l'écran. Trois listes du même fait vieillissent séparément
//    (§E.20). Aujourd'hui le type ne peut plus diverger sans faire échouer la
//    compilation.
ok(/export const CAUSES_DEPOT = \['plafond', 'modele_indisponible', 'reponse_illisible'\] as const/
  .test(read('lib/candidatures/depot-etats.ts')),
  'les trois causes sont une liste fermée, dans un module pur')
ok(/export type CausePanne = \(typeof CAUSES_DEPOT\)\[number\]/
  .test(read('lib/candidatures/depot-etats.ts')),
  'et le type en est DÉRIVÉ, jamais recopié')
ok(/export type \{ CausePanne \}/.test(ASSESSMENT),
  'le jugement le ré-exporte, il ne le redéfinit pas')
for (const [cause, motif] of [
  ['plafond', /cause: 'plafond'/],
  ['modele_indisponible', /cause: 'modele_indisponible'/],
  ['reponse_illisible', /cause: 'reponse_illisible'/],
]) {
  ok(motif.test(ASSESSMENT), `« ${cause} » est effectivement rendue par un chemin d échec`)
}
ok(/cause in \('plafond', 'modele_indisponible', 'reponse_illisible'\)/.test(SQL_PANNES),
  'et la base les borne par contrainte')
ok(/group by f\.cause, f\.surface/.test(SQL_PANNES),
  'la supervision les garde DISTINCTES',
  'les additionner reproduirait exactement le compteur unique qu on remplace')

// ⚠️ LE DÉPÔT N'ÉCRIT PLUS DANS CE COMPTEUR, ET C'EST VOULU.
//    `ai_redaction_failures.entity_id` désignait la candidature. Depuis
//    §D.19, un dépôt qui échoue n'écrit AUCUNE candidature : la ligne aurait
//    pointé vers un objet inexistant. Sa trace vit dans
//    `public.candidature_depots`, qui elle SE REJOUE — et deux journaux du
//    même événement auraient divergé dès la première relance (§E.36).
ok(/solderJournalEnEchec\(/.test(DEPOT),
  'le dépôt journalise son échec, avec sa cause',
  'sans cette ligne, le depot est perdu : l expert croit avoir postule, personne ne le sait')
ok(/cause: resultat\.cause/.test(DEPOT),
  'et la cause journalisée est celle que le jugement a rendue',
  'une cause inventee enverrait chercher un bug la ou il n y a qu un plafond atteint')
ok(/enregistrerPanne\(auth\.supabaseAdmin/.test(PITCH), 'le pitch aussi')
ok(/panne NON COMPTÉE/.test(MODULE_PANNES),
  'un comptage en échec est journalisé, jamais silencieux')
ok(!/throw/.test(MODULE_PANNES),
  'et le comptage ne lève JAMAIS',
  'faire echouer un depot parce qu on n a pas su COMPTER une panne serait absurde')

console.log('\n— visible depuis l administration\n')
ok(partoutAdmin(/redaction_failure_health/),
  'le compteur de pannes est LU par une surface d administration',
  'une mesure qu aucun ecran ne lit est une mesure morte — celle-ci a deja failli l etre')
ok(partoutAdmin(/pannes:\s*(ouNull\(|\w+Res\.error \? null)/),
  'indisponible rend null, pas un tableau vide',
  'vide se lirait « aucune panne » alors que la verite est « je n ai pas pu lire »')
ok(partoutAdmin(/resumes_non_produits|'resumes'/),
  'le total des resumes non produits atteint un ecran')
// ET LE DETAIL AUSSI : cause ET surface. Un total sans sa ventilation ne dit
// pas QUOI reparer, et c est la moitie que la refonte avait laissee en route.
ok(partoutAdmin(/'cause', 'surface'|cause,\s*surface/),
  'le detail montre la CAUSE et la SURFACE, pas seulement un total')
// ⚠️ ET PAS EN IDENTIFIANTS BRUTS (§E.26). « modele_indisponible » sur un
//    ecran d exploitation est une cle, pas un nom — et c est exactement ce
//    que la refonte avait laisse s afficher.
ok(partoutAdmin(/t\(`cause\.\$\{/) && partoutAdmin(/t\(`surface\.\$\{/),
  'cause et surface sont TRADUITES, jamais rendues brutes')
{
  const LOCALES = ['fr', 'en', 'es', 'de']
  const MSG = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`))]))
  const lireCle = (m, c) => c.split('.').reduce((o, k) => (o == null ? o : o[k]), m)
  for (const cle of [
    // Les trois CAUSES et les deux SURFACES, traduites. Les noms de cles ont
    // change avec le demenagement ; ce qui est garde, c est qu un exploitant
    // lise des mots — dans les quatre langues.
    'admin_back_office.supervision.cause.plafond',
    'admin_back_office.supervision.cause.modele_indisponible',
    'admin_back_office.supervision.cause.reponse_illisible',
    'admin_back_office.supervision.surface.candidature',
    'admin_back_office.supervision.surface.pitch',
    'admin_back_office.supervision.detail_title.resumes',
  ]) {
    const absentes = LOCALES.filter((l) => !lireCle(MSG[l], cle))
    ok(absentes.length === 0, `${cle} dans les 4 langues`, absentes.join(', ') || undefined)
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('E. LA BARRIÈRE STRUCTURELLE, ELLE, RESTE')
// ══════════════════════════════════════════════════════════════════════════
//
// Le type d'entrée ne PEUT PAS porter de nom, d'employeur ni de date : ces
// champs n'existent pas. C'est la seule barrière qui subsiste, et c'est la plus
// solide — une absence ne se contourne pas.

{
  const brut = /export type EntreeJugement = \{([\s\S]*?)\n\}/.exec(ASSESSMENT)?.[1] ?? ''
  const bloc = brut
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((x) => !x.trim().startsWith('//'))
    .join('\n')
  ok(bloc.length > 0, 'le type d entrée est lisible')
  for (const interdit of [
    'employer', 'employeur', 'client_name', 'first_name', 'last_name',
    'email', 'phone', 'school', 'city', 'birth_year', 'start_date', 'end_date',
  ]) {
    ok(!new RegExp(`\\b${interdit}\\b`).test(bloc), `« ${interdit} » n existe pas dans le type d entrée`,
      'un champ present finit par etre rempli — l absence est la seule garantie')
  }
}
for (const [nom, src] of [['dépôt', DEPOT], ['pitch', PITCH]]) {
  const selects = [...src.matchAll(/from\('profile_experiences'\)\s*\n\s*\.select\('([^']*)'\)/g)]
    .map((m) => m[1])
  ok(selects.length > 0, `${nom} : le parcours est chargé`)
  const fautifs = selects.filter((s) => /employer|client_name|start_date|end_date|description/.test(s))
  ok(fautifs.length === 0, `${nom} : le parcours ne charge NI employeur NI date`,
    fautifs.length ? `colonnes chargées à tort : ${fautifs.join(' | ')}` : undefined)
}

// ══════════════════════════════════════════════════════════════════════════
section('F. LE RESTE DU LOT 5, INCHANGÉ')
// ══════════════════════════════════════════════════════════════════════════

ok(/const MODELE = 'claude-sonnet-5'/.test(ASSESSMENT), 'le modèle reste Sonnet 5')
ok(existe('app/api/candidatures/[id]/pitch/route.ts'), 'la route de pitch à la demande existe')
ok(/if \(dejaEcrit\) return \{ ok: true, pitch: dejaEcrit, deja: true \}/.test(ASSESSMENT),
  'le pitch déjà écrit n est jamais régénéré')
for (const f of [
  'lib/candidature-org-dto.ts',
  'components/dashboard/CandidatureCard.tsx',
  'components/dashboard/SpotlightCandidateCard.tsx',
  'components/dashboard/CastingCarousel.tsx',
]) {
  ok(!/relevance_score|relevance_tier/.test(read(f)),
    `${f.split('/').pop()} n expose aucun score de pertinence`,
    'deux echelles cote a cote finissent comparees')
}
{
  const iJugement = DEPOT.indexOf('ai_match_score: resultat.jugement.score')
  const iDevoilement = DEPOT.lastIndexOf('await devoilementInclus(')
  ok(iJugement !== -1 && iDevoilement > iJugement,
    'le dévoilement inclus s exécute APRÈS le jugement')
}

// Lecture stricte : l'absence de valeur reste un échec, jamais un repli.
ok(lireNote(undefined) === null && lireNote('') === null && lireNote(null) === null,
  'une note absente rend null, jamais 0',
  'un 0 fabrique serait un verdict que personne n a rendu')
ok(lireNote('8') === 8 && lireNote(12) === 10 && lireNote(-3) === 0,
  'une note valide est bornée à [0,10]')
ok(lireTexte('   ') === null && lireTexte(42) === null,
  'un texte vide rend null, jamais une chaîne vide')
ok(/score == null \|\| !reason \|\| !pitch/.test(ASSESSMENT),
  'un jugement incomplet est un échec ENTIER, pas un demi-jugement')

// ══════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ La consigne vit dans le prompt, le document part intact, et une candidature écrite ne se perd plus.\n'
    : `\n❌ ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
