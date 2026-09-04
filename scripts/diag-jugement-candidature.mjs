// scripts/diag-jugement-candidature.mjs — LE SEUL ENDROIT OÙ CLAUDE SUBSISTE
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE SCRIPT DÉFEND
//
//   LE CONTRÔLE CENTRAL EST LA CONFORMITÉ. `pitch_org` est lu par
//   l'organisation AVANT le déverrouillage payant : c'est le seul texte qui
//   traverse le masquage. Un nom d'employeur, un nom d'école, une année de
//   diplôme, et le masquage est contourné — sans qu'aucune erreur ne se
//   produise, sans qu'aucun écran ne change, sans que personne le sache.
//
//   Une consigne de rédaction ne garantit rien. Ce script vérifie donc les
//   TROIS barrières, et il éprouve la troisième pour de vrai :
//     1. ce qui entre : le type ne PEUT PAS porter de nom, d'employeur ni de
//        date — ces champs n'existent pas ;
//     2. ce qui entre, bis : les textes libres sont expurgés de leurs années ;
//     3. ce qui sort : un texte contenant une année est REFUSÉ.
//
//   Le reste suit :
//     • Claude intervient au DÉPÔT, dans un after() — le recruteur qui ouvre un
//       dossier n'attend rien ;
//     • le pitch est rédigé à la DEMANDE, une fois, jamais régénéré ;
//     • les deux scores ne sont JAMAIS affichés côte à côte ;
//     • au plafond, la candidature se dépose quand même.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-jugement-candidature.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE écriture.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// Les barrieres de conformite sont importees DEPUIS leur module dedie, sans
// dependance : le SDK du modele et le compteur de depense ne sont pas charges,
// et le diagnostic peut donc les eprouver pour de vrai. C'est la raison d'etre
// de ce fichier separe.
import { expurgerAnnees, contientUneAnnee, lireNote, lireTexte } from '../lib/candidatures/conformite.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
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
const DEPOT = read('app/api/candidatures/route.ts')
const PITCH = read('app/api/candidatures/[id]/pitch/route.ts')

// ══════════════════════════════════════════════════════════════════════════
section('A. CONFORMITÉ — LE CONTRÔLE CENTRAL')
// ══════════════════════════════════════════════════════════════════════════

console.log('— barrière 1 : ce qui ne peut pas entrer\n')

// Le type d'entrée est la barrière la plus solide : un champ absent ne se
// transmet pas par étourderie. On vérifie que ces champs n'existent PAS.
{
  // Les CHAMPS, pas la prose : le commentaire qui explique qu'un employeur est
  // absent contient le mot « employeur ». Un controle qui lirait les
  // commentaires echouerait sur la phrase documentant sa propre regle — et
  // pousserait a retirer l'explication pour faire taire le controle.
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
  ok(/years_total_experience/.test(bloc),
    'la durée est exprimée en ANNÉES ÉCOULÉES, jamais en dates',
    'une date de début est une année deguisee')
}

// Et les requêtes ne CHARGENT même pas ces colonnes : ce qu'on ne lit pas ne
// peut pas partir chez un tiers.
for (const [nom, src] of [['dépôt', DEPOT], ['pitch', PITCH]]) {
  const selects = [...src.matchAll(/from\('profile_experiences'\)\s*\n\s*\.select\('([^']*)'\)/g)]
    .map((m) => m[1])
  ok(selects.length > 0, `${nom} : le parcours est chargé`)
  const fautifs = selects.filter((s) => /employer|client_name|start_date|end_date|description/.test(s))
  ok(fautifs.length === 0, `${nom} : le parcours ne charge NI employeur NI date`,
    fautifs.length ? `colonnes chargées à tort : ${fautifs.join(' | ')}` : undefined)
}

console.log('\n— barrière 2 : les années sont expurgées de l entrée\n')

ok(/expurgerAnnees\(propre\(p\.summary\)\)/.test(ASSESSMENT),
  'le résumé libre est expurgé de ses années avant l envoi',
  'un expert ecrit « diplome en 2015 » sans y penser')
ok(/expurgerAnnees\(propre\(a\.description\)\)/.test(ASSESSMENT),
  'la description de l annonce aussi')

console.log('\n— barrière 3 : ce qui sort est VÉRIFIÉ, pas seulement demandé\n')

// ÉPREUVE RÉELLE du garde-fou de sortie, à chaque exécution. Un contrôle qui
// se contente de chercher un appel de fonction ne prouve pas que la fonction
// fait ce qu'elle annonce.
{
  const doitRefuser = [
    'Diplômé en 2015, huit ans sur ce type de poste.',
    'A conduit la migration de 2019 à 2022.',
    'Certifié depuis 2021.',
  ]
  const doitAccepter = [
    'Huit ans sur ce type de poste, dont plusieurs sur des migrations comparables.',
    'Profil senior, à l aise sur les architectures distribuées.',
    // Un nombre qui n'est pas une année ne doit pas déclencher le refus :
    // « 12 personnes », « 300 serveurs » sont des faits utiles.
    'A encadré 12 personnes sur un parc de 300 serveurs.',
  ]
  for (const t of doitRefuser) {
    ok(contientUneAnnee(t), `refuse : « ${t.slice(0, 42)}… »`,
      'une annee dans un texte lu avant deverrouillage est une donnee identifiante')
  }
  for (const t of doitAccepter) {
    ok(!contientUneAnnee(t), `accepte : « ${t.slice(0, 42)}… »`,
      'faux positif : un controle qui refuse des textes valides finit desactive')
  }
  ok(expurgerAnnees('Diplômé en 2015, 8 ans d expérience.') === 'Diplômé en …, 8 ans d expérience.',
    'l expurgation retire l année et garde la phrase',
    `obtenu : « ${expurgerAnnees('Diplômé en 2015, 8 ans d expérience.')} »`)
}

ok(/contientUneAnnee\(pitch\)/.test(ASSESSMENT) && /contientUneAnnee\(reason\)/.test(ASSESSMENT),
  'les DEUX textes produits sont vérifiés, pas seulement le pitch',
  'le texte destine a l expert traverse les memes ecrans')
ok(/texte produit non conforme/.test(ASSESSMENT),
  'un texte non conforme est REFUSÉ, pas corrigé',
  'corriger un texte non conforme masquerait que la consigne n a pas ete suivie')

console.log('\n— la consigne, malgré tout\n')
for (const [motif, quoi] of [
  [/Ne nomme JAMAIS une personne, un employeur, un client, une école ni une ville/, 'l interdiction de nommer'],
  [/N'écris JAMAIS d'année ni de date/, 'l interdiction des dates'],
  [/en RELATIF/, 'l obligation de dire les durées en relatif'],
  [/AVANT que l'organisation n'ait accès à l'identité/, 'la RAISON de l interdiction'],
]) {
  ok(motif.test(ASSESSMENT), `le prompt porte ${quoi}`)
}

// ══════════════════════════════════════════════════════════════════════════
section('B. AU DÉPÔT, JAMAIS À L OUVERTURE')
// ══════════════════════════════════════════════════════════════════════════

ok(/jugerCandidature\(/.test(DEPOT), 'le jugement est appelé au dépôt')
{
  const iAfter = DEPOT.indexOf('after(async ()')
  const iJuger = DEPOT.indexOf('jugerCandidature(')
  ok(iAfter !== -1 && iJuger > iAfter,
    'et il vit DANS un after() — la réponse part avant',
    'le recruteur qui ouvre un dossier ne doit rien attendre ; le candidat qui depose non plus')
}
ok(/return json\(\s*\{\s*\n\s*id: row\.id/.test(DEPOT.replace(/\r\n/g, '\n')),
  'le dépôt répond 201 sans attendre le modèle')

// ══════════════════════════════════════════════════════════════════════════
section('C. LE PITCH : À LA DEMANDE, UNE FOIS, JAMAIS RÉGÉNÉRÉ')
// ══════════════════════════════════════════════════════════════════════════

ok(existe('app/api/candidatures/[id]/pitch/route.ts'), 'la route de rédaction à la demande existe')
ok(/pitchExistant: dejaEcrit/.test(PITCH),
  'le pitch déjà écrit est passé au module, qui le rend tel quel',
  'sans cela, chaque ouverture repaierait le meme texte')
ok(/if \(dejaEcrit\) return \{ ok: true, pitch: dejaEcrit, deja: true \}/.test(ASSESSMENT),
  'et le module SORT avant tout appel quand le texte existe',
  'c est la seule garde qui tient apres un rafraichissement de page')
ok(/if \(resultat\.deja\) return json/.test(PITCH),
  'un pitch déjà écrit n est pas réécrit en base',
  'une ecriture inutile fait bouger updated_at et brouille les traces')
ok(/pitch_org: resultat\.pitch/.test(PITCH) && /matches'\)/.test(PITCH),
  'le pitch est persisté dans matches.explanation')
ok(/NON PERSISTÉ — il sera régénéré, donc repayé/.test(PITCH),
  'une persistance en échec est DITE, avec sa conséquence',
  'un texte repaye a chaque ouverture sans que personne le sache est le pire des cas')

ok(existe('lib/candidature-pitch-client.ts'), 'le hook client existe')
{
  const CLIENT = read('lib/candidature-pitch-client.ts')
  ok(/enCours\.current\.get\(candidatureId\)/.test(CLIENT),
    'deux ouvertures rapprochées partagent le même appel')
  ok(/ne remplace pas la garde serveur/.test(CLIENT),
    'et le code dit que cette garde mémoire ne remplace PAS celle du serveur',
    'sans cela, quelqu un la prendra pour la garantie, et la garantie disparaitra avec elle')
}
{
  const CAROUSEL = read('components/dashboard/CastingCarousel.tsx')
  ok(/onCenterChange=\{\(c\) => \{/.test(CAROUSEL) && /demanderPitch\(c\.id\)/.test(CAROUSEL),
    'la demande part quand la carte passe sous le projecteur',
    'un appel par profil REELLEMENT ouvert, pas un de plus')
  ok(/if \(c\.ai_pitch\) return/.test(CAROUSEL),
    'et pas du tout si le pitch est déjà là')
}

// ══════════════════════════════════════════════════════════════════════════
section('D. LES DEUX SCORES NE SE CROISENT JAMAIS')
// ══════════════════════════════════════════════════════════════════════════
//
// Sur la fiche de candidature, la note de Claude EST le score. Celui du
// reranker n'y apparaît pas : il vit dans [0,1], il est propre à une annonce,
// et l'afficher à côté d'une note sur 10 inviterait à les comparer.

for (const f of [
  'lib/candidature-org-dto.ts',
  'components/dashboard/CandidatureCard.tsx',
  'components/dashboard/SpotlightCandidateCard.tsx',
  'components/dashboard/CastingCarousel.tsx',
]) {
  const src = read(f)
  ok(!/relevance_score|relevance_tier/.test(src),
    `${f.split('/').pop()} n expose aucun score de pertinence`,
    'deux echelles cote a cote finissent comparees')
}
{
  const SQL = read(migration('score_de_pertinence'))
  ok(/ne doivent JAMAIS être affichés côte à côte/.test(SQL),
    'la base porte la règle en commentaire de colonne',
    'la regle doit survivre au depart de celui qui l a ecrite')
}

// ══════════════════════════════════════════════════════════════════════════
section('E. AU PLAFOND, LA CANDIDATURE SE DÉPOSE QUAND MÊME')
// ══════════════════════════════════════════════════════════════════════════

ok(/budgetDisponible\(args\.supabaseAdmin, 'claude'\)/.test(ASSESSMENT),
  'le budget est vérifié AVANT l appel')
{
  const iBudget = ASSESSMENT.indexOf("budgetDisponible(args.supabaseAdmin, 'claude')")
  const iAppel = ASSESSMENT.indexOf('client.messages.create(')
  ok(iBudget !== -1 && iAppel > iBudget, 'et le refus court-circuite l appel')
}
ok(/aucun jugement rendu/.test(DEPOT) && /raison: resultat\.raison/.test(DEPOT),
  'l absence de jugement est journalisée AVEC sa raison',
  'une note absente sans raison envoie chercher un bug la ou il n y a qu un plafond')
ok(/await devoilementInclus\(auth, publicationId, row\.id\)/.test(DEPOT),
  'le dévoilement inclus a lieu même sans jugement',
  'une place offerte ne doit pas rester vide parce qu un modele n a pas repondu')
{
  const SQL = read(migration('score_de_pertinence'))
  ok(/candidature_ai_health/.test(SQL), 'candidature_ai_health() existe pour compter les manquants')
  ok(/sans_jugement_ia/.test(SQL), 'et elle compte explicitement les dossiers SANS jugement')
}

// ══════════════════════════════════════════════════════════════════════════
section('F. LA NOTE A RETROUVÉ UN PRODUCTEUR')
// ══════════════════════════════════════════════════════════════════════════

{
  const iJugement = DEPOT.indexOf('ai_match_score: resultat.jugement.score')
  const iDevoilement = DEPOT.lastIndexOf('await devoilementInclus(')
  ok(iJugement !== -1, 'le jugement écrit ai_match_score')
  ok(iDevoilement > iJugement,
    'et le dévoilement inclus s exécute APRÈS lui',
    'departager avant l ecriture comparerait des notes toutes nulles : la place irait a la PREMIERE candidature, pas a la meilleure')
}
ok(!/CONSÉQUENCE DU LOT 3, ÉCRITE PLUTÔT QUE SUBIE/.test(DEPOT),
  'le commentaire de l état transitoire a été retiré',
  'un commentaire qui decrit un etat revolu devient un mensonge')
ok(/order\('ai_match_score', \{ ascending: false, nullsFirst: false \}\)/.test(DEPOT),
  'le départage se fait bien sur la note')

// ══════════════════════════════════════════════════════════════════════════
section('G. LE MODÈLE, ET LA LECTURE STRICTE')
// ══════════════════════════════════════════════════════════════════════════

ok(/const MODELE = 'claude-sonnet-5'/.test(ASSESSMENT),
  'le modèle est Sonnet 5',
  'volume faible, et c est le texte que l organisation lit avant de payer')
ok(/SEUL appel de modèle qui subsiste hors/.test(ASSESSMENT),
  'et le code dit POURQUOI ce modèle-là')

// Lecture stricte : l'absence de valeur est un échec, jamais un repli.
ok(lireNote(undefined) === null && lireNote('') === null && lireNote(null) === null,
  'une note absente rend null, jamais 0',
  'un 0 fabrique serait un verdict que personne n a rendu')
ok(lireNote('8') === 8 && lireNote(12) === 10 && lireNote(-3) === 0,
  'une note valide est bornée à [0,10]')
ok(lireTexte('   ') === null && lireTexte(42) === null,
  'un texte vide rend null, jamais une chaîne vide')
ok(/score == null \|\| !reason \|\| !pitch/.test(ASSESSMENT),
  'un jugement incomplet est un échec ENTIER, pas un demi-jugement',
  'le completer par des replis produirait un verdict que personne n a rendu')

// ══════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ Le jugement est conforme : rien d identifiant ne traverse le masquage.\n'
    : `\n❌ ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
