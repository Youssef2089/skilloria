// scripts/diag-issue-de-recherche.mjs — UN ÉCRAN N'AFFIRME PAS UN RÉSULTAT
//                                       QU'IL N'A PAS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE CAS MESURÉ, LE 21/09/2026
//
//   Un expert bascule sa disponibilité sur « à l'écoute ». L'écran affiche
//   « Analyse de votre profil en cours… vos missions arrivent dans quelques
//   instants », puis, deux minutes plus tard, « Aucune mission ne correspond à
//   votre profil pour le moment ».
//
//   LES DEUX PHRASES ÉTAIENT FAUSSES.
//     · Rien n'était analysé : la route posait une échéance à SOIXANTE MINUTES
//       et rendait la main en quelques millisecondes.
//     · Et la seconde affirmait un RÉSULTAT — « on a cherché, il n'y a rien » —
//       alors que la recherche n'avait pas commencé.
//
//   La fin de « l'analyse » était décidée par deux chronomètres : 75 secondes
//   (`useMatchingAnalyzing`) et 120 secondes (`matching-resync-hint`). Ni l'un
//   ni l'autre ne savait quoi que ce soit du moteur : ils mesuraient le TEMPS.
//
//   ET LE MOTEUR ÉTAIT ÉTEINT. `ENABLE_RERANKING` et `COHERE_API_KEY` étaient
//   absents : même après soixante minutes, rien ne serait sorti — et l'écran
//   l'aurait présenté comme « aucune mission ne correspond ». Une panne de
//   configuration annoncée comme un verdict sur le profil de l'expert.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE CONTRÔLE DÉFEND
//
//   (A) LA RÉPONSE CONNUE AU CLIC SE DIT AU CLIC. L'éligibilité est lisible en
//       une ligne : elle est vérifiée AVANT de lancer, et rendue telle quelle.
//   (B) LE MOTEUR TOURNE DANS LA REQUÊTE, et la réponse porte son issue RÉELLE.
//   (C) AUCUN CHRONOMÈTRE NE DÉCIDE DE LA FIN D'UNE RECHERCHE.
//   (D) « aucune mission » NE S'ÉCRIT QUE SUR UNE RECHERCHE ACHEVÉE.
//   (E) L'ISSUE SE LIT SUR UNE VALEUR, JAMAIS SUR UNE PHRASE (§E.24).
//   (F) UNE SEULE IMPLÉMENTATION DE L'ÉLIGIBILITÉ, ET DU PLAFOND (§E.20).
//   (G) PARITÉ FREELANCE / CDI : LE MÊME COMPOSANT, PAS DEUX JUMEAUX.
//
// CE QU'IL NE VÉRIFIE PAS, ET IL LE DIT
//   Il ne dit pas que le moteur trouve quelque chose, ni qu'il est rapide :
//   cela demande la base, un fournisseur et de l'argent. Il dit que l'écran ne
//   peut pas affirmer ce qu'il ne sait pas.
//
//   node scripts/diag-issue-de-recherche.mjs
//   Aucune base, aucun réseau, aucune écriture. Lecture seule.
//   0 = vert · 1 = rouge · 2 = n'a pas tourné.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ⚠️ FINS DE LIGNE NORMALISÉES (§E.3). Le dépôt est en CRLF : tout motif qui
 *    traverse un saut de ligne ne mord JAMAIS sans cette normalisation, et le
 *    contrôle passe au vert en n'ayant rien regardé.
 */
const lire = (p) => {
  const abs = join(ROOT, p)
  if (!existsSync(abs)) {
    console.error(`\n❌ Fichier introuvable : ${p}`)
    process.exit(2)
  }
  return readFileSync(abs, 'utf8').split('\r\n').join('\n')
}

/**
 * ⚠️ LES COMMENTAIRES SONT RETIRÉS AVANT TOUTE ASSERTION (§E.7).
 *    Ce fichier-ci DÉCRIT les phrases qu'il interdit ; un contrôle qui les
 *    chercherait dans du texte brut se déclencherait sur la documentation de
 *    sa propre règle — « un contrôle qui punit la documentation de sa propre
 *    règle finit par être désactivé ».
 */
const sansCommentaires = (src) =>
  src
    .split('\n')
    .map((l) => {
      const nu = l.trimStart()
      if (nu.startsWith('//') || nu.startsWith('*') || nu.startsWith('/*')) return ''
      return l
    })
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

let echecs = 0
const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

const ISSUE = lire('lib/matching/issue-de-recherche.ts')
const ROUTE = sansCommentaires(lire('app/api/me/sync-matching/route.ts'))
const MOTEUR = sansCommentaires(lire('lib/matching/run-for-expert.ts'))
const RERANK = sansCommentaires(lire('lib/matching/rerank.ts'))
const TYPES = sansCommentaires(lire('lib/matching/types.ts'))
const HOOK = sansCommentaires(lire('hooks/useRechercheDeMissions.ts'))
const VUE = sansCommentaires(lire('components/dashboard/EtatDeRecherche.tsx'))
const FREELANCE = sansCommentaires(lire('app/[locale]/dashboard/freelance/page.tsx'))
const CDI = sansCommentaires(lire('app/[locale]/dashboard/cdi/page.tsx'))
const RELANCE = sansCommentaires(lire('lib/matching/relance.ts'))
const ISSUE_NUE = sansCommentaires(ISSUE)

// ══════════════════════════════════════════════════════════════════════════
section('A. La réponse connue au clic se dit AU CLIC')
// ══════════════════════════════════════════════════════════════════════════

ok(/export async function raisonIneligibilite/.test(MOTEUR),
  'le moteur expose une pré-vérification d éligibilité')
ok(/const verdict = expertEligible\(p, kind\)/.test(MOTEUR),
  'elle appelle la garde EXISTANTE, elle ne la recopie pas',
  'deux listes de conditions feraient dire a l ecran autre chose que ce que le moteur applique (§E.20)')

// §E.8 — on ancre sur l'ORDRE : la pré-vérification doit précéder le run dans
// la route. Deux présences séparées resteraient vertes si le run partait avant.
{
  const iElig = ROUTE.indexOf('raisonIneligibilite(supabaseAdmin, prof.id)')
  const iRun = ROUTE.indexOf('runMatchingForExpert(')
  ok(iElig !== -1 && iRun !== -1 && iElig < iRun,
    'et la route la consulte AVANT de lancer quoi que ce soit',
    'verifier apres coup ferait tourner (et payer) un moteur dont on sait deja qu il ne rendra rien')
}
ok(/etat: 'ineligible', raison: eligibilite\.raison/.test(ROUTE),
  'la raison sort telle quelle vers l écran')

// §E.22 — une lecture EN PANNE n'est pas une inéligibilité.
ok(/etat: 'indisponible'/.test(MOTEUR),
  'une lecture en panne a son propre état, distinct de l inéligibilité',
  'les confondre dirait a un expert en regle que son profil ne l est pas, sur une panne de base (§E.22)')
{
  const iIndispo = ROUTE.indexOf("eligibilite.etat === 'indisponible'")
  const iInelig = ROUTE.indexOf("eligibilite.etat === 'ineligible'")
  ok(iIndispo !== -1 && iInelig !== -1 && iIndispo < iInelig,
    'et la route traite la panne AVANT l inéligibilité',
    'sinon une panne tomberait dans la branche metier')
}

// ══════════════════════════════════════════════════════════════════════════
section('B. Le moteur tourne DANS la requête')
// ══════════════════════════════════════════════════════════════════════════

ok(/runMatchingForExpert\(\{ supabaseAdmin, profileId: prof\.id \}\)/.test(ROUTE),
  'la route exécute le moteur elle-même')
ok(!/programmerRelance/.test(ROUTE),
  'et elle ne programme plus rien à soixante minutes',
  'c est le defaut d origine : l ecran annoncait une analyse qui ne commencerait pas avant une heure')
ok(/issueDepuisVerdict/.test(ROUTE),
  'la réponse porte l ISSUE du run, pas un accusé de réception')

// §E.5 — le run doit survivre à la réponse, sinon le couperet le tue.
ok(/after\(async \(\) => \{/.test(ROUTE) && /await course/.test(ROUTE),
  'le run est confié à after() : il survit à la réponse',
  'sans after(), une reponse rendue sur expiration de l attente TUERAIT le run en cours (§E.5)')
ok(/export const maxDuration = 60/.test(ROUTE),
  'et la route déclare son maxDuration',
  'le couperet de l hebergement ne se devine pas (§E.5)')
{
  const m = ROUTE.match(/const ATTENTE_MAX_MS = ([\d_]+)/)
  const attente = m ? Number(m[1].replace(/_/g, '')) : null
  ok(attente !== null && attente < 60_000,
    'l attente rendue à l écran est STRICTEMENT sous le couperet',
    'attendre jusqu au couperet rendrait une connexion morte au lieu d une issue nommee')
}

// ══════════════════════════════════════════════════════════════════════════
section('C. Aucun chronomètre ne décide de la fin d une recherche')
// ══════════════════════════════════════════════════════════════════════════

ok(!existsSync(join(ROOT, 'hooks/useMatchingAnalyzing.ts')),
  'la roue de 75 secondes n existe plus',
  'elle s arretait « en retrait silencieux » sur un travail qui n avait pas commence')
ok(!existsSync(join(ROOT, 'lib/matching-resync-hint.ts')),
  'la fenêtre de 120 secondes n existe plus',
  'elle affichait « analyse en cours » pendant deux minutes, sur rien')

for (const [nom, src] of [['freelance', FREELANCE], ['cdi', CDI]]) {
  ok(!/useMatchingAnalyzing|matching-resync-hint|isWithinMatchingWindow|markMatchingTriggered/.test(src),
    `le tableau de bord ${nom} ne lit plus aucun chronomètre`)
  ok(/useRechercheDeMissions\(\)/.test(src),
    `le tableau de bord ${nom} attend la fin du moteur`)
}
ok(!/setTimeout|setInterval/.test(HOOK),
  'et le hook lui-même n a AUCUN minuteur',
  'un minuteur reintroduirait exactement le defaut : une fin decidee par le temps')

// ══════════════════════════════════════════════════════════════════════════
section('D. « aucune mission » ne s écrit que sur une recherche ACHEVÉE')
// ══════════════════════════════════════════════════════════════════════════

ok(/\| \{ etat: 'aucune' \}/.test(ISSUE_NUE),
  'l état « aucune » existe, et il est distinct des échecs')
ok(/\{ etat: 'echec'; raison: RaisonEchec \}/.test(ISSUE_NUE),
  'un échec est un état à part entière, jamais un résultat vide')
ok(/\{ etat: 'ineligible'; raison: RaisonIneligible \}/.test(ISSUE_NUE),
  'une inéligibilité aussi')

// §E.22 — la traduction verdict → issue ne doit avoir AUCUN repli permissif.
ok(/const ECHEC_PAR_ARRET: Record</.test(ISSUE_NUE),
  'chaque arrêt de notation a SON issue, dans une table totale',
  'une comparaison a une valeur rangerait tout le reste dans sa branche « sinon » : un arret ajoute demain sortirait sous l etiquette d un autre')
ok(/function assertJamais\(x: never\): never/.test(VUE),
  'et l écran refuse de compiler sur une issue non traitée',
  'un default: permissif ferait heriter la phrase d une autre issue (§E.22)')

// L'ordre du rendu : l'état vide ne doit jamais boucher un trou.
for (const [nom, src] of [['freelance', FREELANCE], ['cdi', CDI]]) {
  const iRecherche = src.indexOf("recherche.etat.phase !== 'repos'")
  const iVide = src.indexOf('empty_verified')
  ok(iRecherche !== -1 && iVide !== -1 && iRecherche < iVide,
    `sur ${nom}, la recherche passe AVANT l état vide`,
    'sinon « aucune mission ne correspond » s afficherait pendant que le moteur tourne')
}

// ══════════════════════════════════════════════════════════════════════════
section('E. L issue se lit sur une VALEUR, jamais sur une phrase')
// ══════════════════════════════════════════════════════════════════════════

ok(/arret_code\?: ArretDeNotation/.test(RERANK),
  'le reranker rend son arrêt EN VALEUR, pas seulement en français')
ok(/export type ArretDeNotation =/.test(RERANK),
  'et les arrêts possibles sont une union fermée')
ok(/empechement\?: Empechement/.test(TYPES),
  'le verdict du moteur porte un empêchement structuré')
ok(/Exclude<ArretDeNotation, 'aucun_document'>/.test(TYPES),
  'un vivier VIDE ne peut pas être porté comme un empêchement',
  'ce serait une panne annoncee a un expert dont tout va bien — l exclusion tient a la compilation (§E.31)')

// LE CŒUR DE §E.24 : aucune expression régulière sur `notes`, dont le type dit
// en toutes lettres qu'elle n'est jamais affichée à un utilisateur.
ok(!/verdict\.notes|\.notes\)/.test(ISSUE_NUE),
  'la traduction en issue NE LIT PAS la note de journal',
  'corriger un accent dans cette phrase aurait suffi a faire annoncer « aucune mission » sur une panne de configuration (§E.24)')
ok(/emp\?\.quoi === 'ineligible'/.test(ISSUE_NUE) && /emp\?\.quoi === 'arret_de_notation'/.test(ISSUE_NUE),
  'elle lit l empêchement, qui est une valeur')

// ══════════════════════════════════════════════════════════════════════════
section('F. Une seule implémentation — de l éligibilité, et du plafond')
// ══════════════════════════════════════════════════════════════════════════

{
  // La garde d'éligibilité n'est écrite qu'UNE fois. On compte les tests de
  // `visible !== true` dans le moteur : deux occurrences signeraient un jumeau.
  const n = (MOTEUR.match(/visible !== true/g) ?? []).length
  ok(n === 1, `la condition « profil visible » n est écrite qu une fois (vue ${n} fois)`,
    'un jumeau divergerait, et l ecran dirait autre chose que le moteur (§E.20)')
}
ok(/const JOURNAL_PAR_RAISON: Record<RaisonIneligible, string>/.test(MOTEUR),
  'la phrase de journal est DÉRIVÉE du code, jamais écrite à côté',
  'une chaine de comparaisons avec un repli sortirait une garde ajoutee demain sous l etiquette de sa voisine')
ok(/export async function consommerPlafondHoraire/.test(RELANCE),
  'le plafond horaire est une fonction exportée')
{
  const n = (RELANCE.match(/checkRateLimit\(\s*supabaseAdmin,\s*'relance_programmation'/g) ?? []).length
  ok(n === 1, `et il n est consommé qu à UN endroit (vu ${n} fois)`,
    'deux implementations du meme plafond en feraient deux plafonds portant le meme nom')
}
ok(/consommerPlafondHoraire\(supabaseAdmin, prof\.id, origine\)/.test(ROUTE),
  'la bascule le consomme, elle n en recopie pas la règle')

// ══════════════════════════════════════════════════════════════════════════
section('G. Parité freelance / CDI — un composant, pas deux jumeaux')
// ══════════════════════════════════════════════════════════════════════════

for (const [nom, src] of [['freelance', FREELANCE], ['cdi', CDI]]) {
  ok(/<EtatDeRecherche/.test(src), `le tableau de bord ${nom} monte le composant partagé`)
  ok(/onReprise=\{lancerRecherche\}/.test(src),
    `et ${nom} confie la reprise « ne pas déranger » à sa propre recherche`,
    'lancer depuis un bloc qui va etre demonte laisserait l issue sans personne pour l afficher')
}
{
  const f = (FREELANCE.match(/<EtatDeRecherche/g) ?? []).length
  const c = (CDI.match(/<EtatDeRecherche/g) ?? []).length
  ok(f === c && f === 2,
    `le composant est monté le MÊME nombre de fois des deux côtés (${f} / ${c})`,
    'une surface de moins d un cote est exactement la forme que prend une derive de parite')
}
ok(/useTranslations\('recherche_de_missions'\)/.test(VUE),
  'et les deux espaces lisent le MÊME espace de traduction',
  'deux espaces separes laisseraient une phrase corrigee d un cote et fausse de l autre')

// ── LA PARITÉ DES QUATRE LANGUES ──────────────────────────────────────────
{
  const aplatir = (o, p = '') =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? aplatir(v, p ? `${p}.${k}` : k) : [p ? `${p}.${k}` : k],
    )
  const refs = {}
  for (const langue of ['fr', 'en', 'es', 'de']) {
    const j = JSON.parse(readFileSync(join(ROOT, 'messages', `${langue}.json`), 'utf8'))
    refs[langue] = aplatir(j.recherche_de_missions ?? {}).sort().join('|')
  }
  ok(refs.fr.length > 0, 'l espace de traduction « recherche_de_missions » existe')
  for (const langue of ['en', 'es', 'de']) {
    ok(refs[langue] === refs.fr, `parité stricte des clés en ${langue}`,
      'une langue en retard affiche la cle brute a l utilisateur')
  }

  // Chaque raison NOMMÉE dans le type a sa phrase. C'est l'assertion qui
  // empêche d'ajouter une issue sans l'écrire — dans les quatre langues.
  const raisons = [
    ...(ISSUE_NUE.match(/^\s*\| '([a-z_]+)'$/gm) ?? []).map((l) => l.trim().replace(/^\| '|'$/g, '')),
  ]
  ok(raisons.length >= 11, `les raisons du type sont lisibles (${raisons.length} trouvées)`)
  const fr = JSON.parse(readFileSync(join(ROOT, 'messages', 'fr.json'), 'utf8')).recherche_de_missions ?? {}
  const phrases = new Set([
    ...Object.keys(fr.ineligible ?? {}),
    ...Object.keys(fr.echec ?? {}),
  ])
  for (const r of raisons) {
    ok(phrases.has(r), `la raison « ${r} » a sa phrase`,
      'une raison sans phrase affiche sa cle brute a l expert')
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('H. Ce que ce contrôle ne vérifie pas')
// ══════════════════════════════════════════════════════════════════════════

note('il ne dit PAS que le moteur trouve des missions, ni qu il est rapide :')
note('cela demande la base, un fournisseur et de l argent depense.')
note('il dit que l ecran ne PEUT PAS affirmer ce qu il ne sait pas.')
note('il ne mesure pas non plus la duree reelle d un run — seule une execution le fait.')

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} CONTRÔLE(S) EN ÉCHEC\n`)
  process.exit(1)
}
console.log('✅ Chaque issue de recherche est nommée, et aucune phrase n affirme un résultat absent.\n')
process.exit(0)
