// scripts/diag-moteur-echelle.mjs — LE MOTEUR À L'ÉCHELLE PROMISE
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE FICHIER EXISTE
//   « Aucun plafond de nombre » a été tenu : il n'y a pas un seul `.limit()`
//   dans le moteur. Mais retirer un plafond ne le supprime pas — il le DÉPLACE
//   vers la contrainte suivante. Trois murs attendaient plus loin, et aucun ne
//   prévient : chacun rend un résultat incomplet rigoureusement indistinguable
//   d'un résultat complet.
//
//   La base ne contient qu'une poignée de profils : AUCUN de ces murs ne se
//   manifeste à cette échelle. Le code est juste sur les données d'aujourd'hui
//   et cassait à l'échelle promise. C'est exactement le genre de défaut qu'un
//   diagnostic doit tenir, parce que l'exécution ne le montrera jamais.
//
//   Et huit règles du moteur n'étaient gardées par RIEN — démontré par mutation
//   lors de l'audit. Une règle qu'aucun contrôle ne garde est une règle qui
//   disparaîtra sans bruit.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-moteur-echelle.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE préparation.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Normalisation des fins de ligne : le dépôt sort les fichiers en CRLF, et un
// retour chariot casse tout motif qui traverse un saut de ligne.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const existe = (p) => existsSync(join(ROOT, p))

let echecs = 0
function ok(libelle, condition, detail = '') {
  if (condition) console.log(`  ✓ ${libelle}`)
  else {
    echecs++
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`)
  }
}
const titre = (s) => console.log(`\n=== ${s} ===`)

/** Code seul : un verbe CITÉ dans un commentaire ne fait rien. */
const sansCommentaires = (src) =>
  src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')

// ═══════════════════════════════════════════════════════════════════════════
// LE PÉRIMÈTRE — DÉCOUVERT, JAMAIS ÉCRIT À LA MAIN
//
//   Le contrôle de plafond existant ne lisait QUE pool.ts : un `.limit(300)`
//   injecté dans run-for-expert.ts laissait les trois diagnostics verts. Une
//   liste de fichiers écrite à la main oublie toujours celui d'après.
// ═══════════════════════════════════════════════════════════════════════════
const DOSSIER_MOTEUR = 'lib/matching'
const MODULES = readdirSync(join(ROOT, DOSSIER_MOTEUR))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `${DOSSIER_MOTEUR}/${f}`)

console.log('\n━━━ LE MOTEUR À L’ÉCHELLE PROMISE ━━━')
console.log(`    ${MODULES.length} modules découverts dans ${DOSSIER_MOTEUR}/`)

// ═══════════════════════════════════════════════════════════════════════════
titre('(A) M1 — le vivier est lu EN ENTIER, et le nombre lu est confronté')
// ═══════════════════════════════════════════════════════════════════════════

const POOL = read('lib/matching/pool.ts')

ok('la lecture est paginée jusqu’à épuisement',
  /\.range\(debut, debut \+ TAILLE_PAGE - 1\)/.test(POOL),
  'sans pagination, la borne est le réglage « Max rows » du projet — invisible et non versionné')
ok('une page incomplète termine la lecture', /page\.length < TAILLE_PAGE/.test(POOL))
ok('le nombre ATTENDU est demandé séparément',
  /count: 'exact', head: true/.test(POOL),
  'sans comptage, une lecture partielle est indistinguable d’une lecture complète')
ok('le nombre lu est CONFRONTÉ à l’attendu',
  /r\.lignes\.length !== r\.attendu/.test(POOL))
ok('une divergence INTERROMPT le run au lieu d’être déduite',
  /vivier incomplet/.test(POOL) && /LECTURE INCOMPLÈTE/.test(POOL),
  'un compteur qui ment est pire qu’un compteur absent')

// LE PLAFOND, SUR TOUT LE MOTEUR — pas seulement pool.ts.
const avecPlafond = []
for (const f of MODULES) {
  const code = sansCommentaires(read(f))
  // `.limit(` sur une requête, hors pagination (`.range`) et hors tranches.
  for (const m of code.matchAll(/\.limit\((\d+)\)/g)) {
    avecPlafond.push(`${f} → .limit(${m[1]})`)
  }
}
ok('aucun plafond de nombre nulle part dans le moteur', avecPlafond.length === 0,
  avecPlafond.join(' | ') + ' — un plafond sans tri est une liste d’autorisés invisible')

// ═══════════════════════════════════════════════════════════════════════════
titre('(B) M2 — le couperet : notation par vagues, et run reprenable')
// ═══════════════════════════════════════════════════════════════════════════

const RERANK = read('lib/matching/rerank.ts')
const INDEX = read('lib/matching/index.ts')
const EXPERT = read('lib/matching/run-for-expert.ts')

ok('la concurrence est une constante nommée', /const CONCURRENCE_LOTS = \d+/.test(RERANK))
ok('les lots partent par vagues, plus en file',
  /for \(const vague of enLots\(lots, CONCURRENCE_LOTS\)\)/.test(RERANK),
  'la séquence EST le mur : 60 appels enchaînés dépassent le couperet')
ok('la vague est attendue en bloc', /await Promise\.all\(/.test(RERANK))
// Le budget doit rester relu ENTRE les vagues, jamais une fois au début.
const iBoucle = RERANK.indexOf('for (const vague of')
const iBudget = RERANK.indexOf('budgetDisponible(', iBoucle)
ok('le budget est relu à chaque vague', iBoucle > 0 && iBudget > iBoucle,
  'vérifié une seule fois au début, un run géant dépasse le plafond de dix fois')

ok('la notation accepte un point de mémorisation', /memoriser\?:/.test(RERANK))
ok('elle mémorise APRÈS chaque lot payé', /await args\.memoriser\(r\.scores\)/.test(RERANK))
for (const [nom, src] of [['annonce→experts', INDEX], ['expert→annonces', EXPERT]]) {
  ok(`${nom} : les notes déjà acquises sont relues`, /notesDejaAcquises/.test(src))
  ok(`${nom} : seuls les documents non notés sont envoyés`,
    /documents: aNoter/.test(src),
    'sans cela le run repaye ce qu’il vient de payer')
  ok(`${nom} : les notes reprises rejoignent celles du run`, /notation\.scores\.set\(/.test(src))
}
ok('le brouillon n’est soldé QUE si le run s’est achevé',
  /if \(acheve\) await solderBrouillon\(/.test(INDEX),
  'soldé plus tôt, il rouvre exactement le mur qu’il ferme')

// ═══════════════════════════════════════════════════════════════════════════
titre('(B bis) L’INDÉPENDANCE DES NOTES SURVIT À LA PARALLÉLISATION')
// ═══════════════════════════════════════════════════════════════════════════
//
//   C'est l'exigence la plus forte du moteur, et la parallélisation est
//   précisément le genre de changement qui pourrait l'entamer sans bruit. Si le
//   découpage ou l'ordre d'envoi influençait la note d'un expert, on aurait
//   recréé une compétition invisible — celle que le départ de Claude avait
//   supprimée.
//
//   LA PREUVE TIENT EN QUATRE POINTS, et chacun est vérifiable ici :
//     1. la note d'un document ne dépend que de (requête, document) DANS SON
//        PROPRE APPEL — le lot est le seul contexte, et `top_n` vaut sa taille,
//        donc aucun document n'est écarté par comparaison avec ses voisins ;
//     2. la constitution d'un lot ne lit JAMAIS les notes déjà obtenues : sans
//        cette lecture, l'ordre d'exécution ne peut pas entrer dans le calcul ;
//     3. les notes sont rangées PAR IDENTIFIANT, jamais par position — une
//        arrivée dans le désordre ne peut pas les permuter ;
//     4. le découpage en vagues est une partition pure de la liste des lots,
//        sans tri ni réordonnancement.
//
//   Autrement dit : changer la concurrence ne peut déplacer aucune note, parce
//   que ni l'ordre ni le parallélisme n'apparaissent nulle part dans le calcul.

{
  const iVague = RERANK.indexOf('for (const vague of enLots(lots, CONCURRENCE_LOTS))')
  const iRetour = RERANK.indexOf('return { scores, notes', iVague)
  const corpsBoucle = iVague >= 0 && iRetour > iVague ? RERANK.slice(iVague, iRetour) : ''
  const codeBoucle = sansCommentaires(corpsBoucle)

  ok('1. la note ne dépend que de son propre lot (top_n = taille du lot)',
    /top_n: args\.lot\.length/.test(RERANK))

  // Le point qui compte : rien dans la constitution d'un lot ne lit `scores`.
  const iMap = codeBoucle.indexOf('vague.map(')
  const iFinMap = codeBoucle.indexOf('return { lot, r }', iMap)
  const closure = iMap >= 0 && iFinMap > iMap ? codeBoucle.slice(iMap, iFinMap) : ''
  ok('2. la constitution d’un lot ne lit AUCUNE note déjà obtenue',
    closure.length > 0 && !/\bscores\b/.test(closure),
    'une dépendance aux notes précédentes ferait entrer l’ordre d’exécution dans le calcul')

  ok('3. les notes sont rangées par IDENTIFIANT, jamais par position',
    /scores\.set\(s\.id, s\.score\)/.test(codeBoucle),
    'rangées par index, une arrivée dans le désordre les permuterait')
  ok('3. aucune note n’est rangée par indice de tableau',
    !/scores\[\s*i\s*\]|scores\.set\(i,/.test(codeBoucle))

  ok('4. le découpage en vagues est une partition pure, sans tri',
    /enLots\(lots, CONCURRENCE_LOTS\)/.test(codeBoucle) && !/\.sort\(/.test(codeBoucle),
    'trier les lots avant envoi ferait dépendre le résultat de l’ordre')

  // Et le lot lui-même n'est pas trié avant d'être envoyé.
  ok('4. les documents ne sont pas triés avant l’appel',
    !/documents[\s\S]{0,40}\.sort\(/.test(sansCommentaires(RERANK)))
}

// ═══════════════════════════════════════════════════════════════════════════
titre('(C) M3 — aucune liste d’identifiants entière dans une URL')
// ═══════════════════════════════════════════════════════════════════════════

ok('la taille de tranche est écrite une seule fois',
  /export const TAILLE_TRANCHE_IDS = \d+/.test(read('lib/matching/tranches.ts')))

// Découverte : tout `.in(` sur une variable, dans tout le moteur, doit porter
// une TRANCHE — pas la liste entière.
const inNonDecoupes = []
for (const f of MODULES) {
  if (f.endsWith('tranches.ts')) continue
  const code = sansCommentaires(read(f))
  for (const m of code.matchAll(/\.in\('([a-z_]+)',\s*([A-Za-z_][\w.]*)\)/g)) {
    const colonne = m[1]
    const variable = m[2]
    // Le mur porte sur les listes d'IDENTIFIANTS. Un catalogue borné — les
    // trois types d'annonce, par exemple — tient dans n'importe quelle URL, et
    // l'interdire ferait crier le contrôle à tort. Un contrôle qui crie à tort
    // finit ignoré.
    if (!/(^id$|_id$)/.test(colonne)) continue
    if (!/tranche/i.test(variable)) inNonDecoupes.push(`${f} → .in('${colonne}', ${variable})`)
  }
}
ok('tout filtre `in` porte une tranche, jamais la liste entière',
  inNonDecoupes.length === 0,
  inNonDecoupes.join(' | ') + ' — le mur d’URL tombe vers 220 à 440 identifiants')

ok('l’idempotence des notifications découpe SES DEUX dimensions',
  /enTranches\(userIds, TAILLE_TRANCHE_IDS\)/.test(read('lib/matching/shared.ts')) &&
    /enTranches\(pubIds, TAILLE_TRANCHE_IDS\)/.test(read('lib/matching/shared.ts')),
  'tronquée, elle produirait les NOTIFICATIONS EN DOUBLE que son commentaire interdit')
ok('une tranche en échec fait renoncer à TOUT envoi',
  /aucun envoi ce run/.test(read('lib/matching/shared.ts')),
  'poursuivre sur une vue partielle de l’existant produit les doublons qu’on refuse')

// Le filtre NÉGATIF ne se découpe pas : il doit avoir quitté la requête.
ok('aucun filtre négatif ne porte une liste d’identifiants',
  !/not\('id', 'in'/.test(sansCommentaires(POOL)),
  'un `not in` entier dépasse l’URL, et se découper le rendrait FAUX (l’union réadmet)')
ok('les décisions déjà prises sont retirées en mémoire', /exclusSet\.has\(r\.id\)/.test(POOL))

// ═══════════════════════════════════════════════════════════════════════════
titre('(D) M4 — top_n ne retronque jamais le lot')
// ═══════════════════════════════════════════════════════════════════════════

ok('top_n vaut exactement la taille du lot',
  /top_n: args\.lot\.length/.test(RERANK),
  'un seul chiffre à cette ligne retronque le lot, et personne ne le verrait')
ok('aucun top_n numérique',
  !/top_n:\s*\d+/.test(sansCommentaires(RERANK)))

// ═══════════════════════════════════════════════════════════════════════════
titre('(E) G2 — le fournisseur a un délai d’attente RÉEL')
// ═══════════════════════════════════════════════════════════════════════════

ok('un délai est posé sur l’appel', /signal: AbortSignal\.timeout\(DELAI_FOURNISSEUR_MS\)/.test(RERANK),
  'un `signal?` que personne ne fournit donne l’APPARENCE d’une garde')
ok('le délai est une constante nommée', /const DELAI_FOURNISSEUR_MS = [\d_]+/.test(RERANK))
// Lu sur le CODE seul : le commentaire qui raconte le défaut corrigé cite
// forcément le paramètre disparu. Un contrôle qui lit la prose échoue sur la
// phrase même qui énonce sa règle — faux positif déjà rencontré ce sprint.
ok('plus aucun paramètre `signal` optionnel non fourni',
  !/signal\?: AbortSignal/.test(sansCommentaires(RERANK)))

// ═══════════════════════════════════════════════════════════════════════════
titre('(F) LES HUIT RÈGLES QUE RIEN NE GARDAIT')
// ═══════════════════════════════════════════════════════════════════════════

// 1-3 : les conditions d'entrée dans le vivier.
ok('1. seuls les profils VISIBLES entrent', /\.eq\('visible', true\)/.test(POOL))
ok('2. seuls les profils VÉRIFIÉS entrent', /\.eq\('verification_status', 'approved'\)/.test(POOL))
ok('3. le consentement IA reste EXIGÉ', /\.not\('ai_consent_at', 'is', null\)/.test(POOL),
  'sans lui, on envoie au fournisseur le profil de qui ne l’a pas accepté')

// 4 : D1 — suspendus et supprimés.
ok('4. les comptes suspendus et supprimés sont exclus EXPLICITEMENT',
  /\.neq\('users\.status', 'suspended'\)/.test(POOL) &&
    /\.is\('users\.deletion_scheduled_at', null\)/.test(POOL) &&
    /\.is\('users\.anonymized_at', null\)/.test(POOL),
  'la garde tenait à un `visible = false` posé dans une AUTRE route')

// 5 : le palier est figé À L'ÉCRITURE, contre le seuil du jour.
for (const [nom, src] of [['annonce→experts', INDEX], ['expert→annonces', EXPERT]]) {
  ok(`5. ${nom} : le palier est figé à l’écriture`,
    /relevance_tier: s\.notify_threshold > 0 && score >= s\.notify_threshold \? 'strong' : 'normal'/.test(src),
    'recalculé à l’affichage, il rebaptiserait des matches anciens en silence')
  ok(`6. ${nom} : le seuil du FLUX écarte avant écriture`,
    /if \(score < s\.feed_threshold\) continue/.test(src))
}

// 7 : aucun repli codé en dur des réglages.
const SETTINGS = read('lib/matching/settings.ts')
ok('7. les réglages n’ont AUCUN repli codé en dur',
  !/\?\?\s*\d+/.test(sansCommentaires(SETTINGS)) && /ok: false/.test(SETTINGS),
  'un repli invisible est un second réglage qui prend la main quand on comprend le moins')

// 8 : RGPD — LE PLUS IMPORTANT. Rien ne vérifiait ce qui compose le document
//     envoyé au fournisseur. La frontière tient structurellement ; rien
//     n'empêchait un futur champ de s'y glisser.
const DOCUMENT = read('lib/matching/document.ts')
const INTERDITS = [
  ['nom', /\bfirst_name\b|\blast_name\b|\bfull_name\b/],
  ['adresse électronique', /\bemail\b/],
  ['téléphone', /\bphone\b/],
  ['employeur', /\bemployer\b|\bcompany_name\b/],
  ['adresse postale', /\baddress_line\b|\bpostal_code\b/],
  ['date de naissance', /\bbirth_year\b|\bbirth_date\b/],
  ['photo', /\bphoto_url\b/],
  ['identifiant de compte', /\buser_id\b/],
]
for (const [quoi, motif] of INTERDITS) {
  ok(`8. RGPD — aucun(e) ${quoi} dans le document envoyé au fournisseur`,
    !motif.test(sansCommentaires(DOCUMENT)),
    'le document part chez un tiers : ce qui y entre en sort')
}
// Et le TYPE d'entrée lui-même reste clos : c'est lui qui rend la frontière
// structurelle plutôt que déclarative.
const CHAMPS_AUTORISES = ['title', 'summary', 'skills', 'certifications_count', 'years_total_experience', 'experiences']
const profil = read('lib/matching/pool.ts')
const debutType = profil.indexOf('export type ProfilDuVivier = {')
const finType = profil.indexOf('}', debutType)
const corpsType = debutType >= 0 ? profil.slice(debutType, finType) : ''
const champsInattendus = [...corpsType.matchAll(/^\s{2}(\w+)[?]?:/gm)]
  .map((m) => m[1])
  .filter((c) => !['profile_id', 'user_id', 'user_type', 'locale', 'ouverture_croisee', ...CHAMPS_AUTORISES].includes(c))
ok('8. RGPD — le type du profil noté ne s’est pas élargi',
  champsInattendus.length === 0,
  `champs nouveaux : ${champsInattendus.join(', ')} — vérifier qu’aucun n’atteint le document`)

// ═══════════════════════════════════════════════════════════════════════════
titre('(G) D2 — une seule convention d’interrupteur, et elle échoue FERMÉ')
// ═══════════════════════════════════════════════════════════════════════════

const INTER = read('lib/interrupteurs.ts')
ok('la convention est écrite une seule fois',
  /process\.env\[capacite\] === 'true'/.test(INTER))

const lecturesDirectes = []
for (const f of [...MODULES, 'lib/candidatures/ai-assessment.ts', 'app/api/profile/upload-cv/route.ts', 'app/api/profile/cdi-upload-cv/route.ts']) {
  if (!existe(f)) continue
  const code = sansCommentaires(read(f))
  for (const m of code.matchAll(/process\.env\.(ENABLE_[A-Z_]+)/g)) lecturesDirectes.push(`${f} → ${m[1]}`)
}
ok('aucun interrupteur n’est lu en direct', lecturesDirectes.length === 0,
  lecturesDirectes.join(' | ') + ' — ENABLE_RERANKING=0 laisserait la dépense partir')
ok('plus aucune comparaison à la chaîne « false »',
  !/=== 'false'/.test(sansCommentaires(read('lib/matching/rerank.ts'))) &&
    !/=== 'false'/.test(sansCommentaires(read('lib/candidatures/ai-assessment.ts'))))

// ═══════════════════════════════════════════════════════════════════════════
titre('(H) G1 — un run inachevé se voit')
// ═══════════════════════════════════════════════════════════════════════════

const dossier = join(ROOT, 'supabase', 'migrations')
const migration = readdirSync(dossier).find((f) => f.endsWith('_reprise_notation.sql'))
ok('la migration de reprise existe', !!migration)
if (migration) {
  const sql = readFileSync(join(dossier, migration), 'utf8').toLowerCase()
  ok('le brouillon de notation existe', sql.includes('create table if not exists public.matching_notes_partielles'))
  ok('il est purgé (un brouillon éternel deviendrait une source de vérité)',
    sql.includes('function public.purger_notes_partielles'))
  ok('RLS active sans policy (service-role seul)', sql.includes('enable row level security'))
  ok('les runs inachevés sont dénombrables', sql.includes('function public.matching_runs_inacheves'))
  ok('les trois états ne sont JAMAIS additionnés', /group by etat/.test(sql))
}
const ROUTE_ADMIN = read('app/api/admin/matching-settings/route.ts')
const PAGE_ADMIN = read('app/[locale]/admin/matching/page.tsx')
ok('la route d’administration expose les runs inachevés',
  /rpc\('matching_runs_inacheves'\)/.test(ROUTE_ADMIN) && /inacheves:/.test(ROUTE_ADMIN))
ok('l’écran les affiche', /t\('unfinished\.title'\)/.test(PAGE_ADMIN) && /charge\?\.inacheves/.test(PAGE_ADMIN))
ok('« illisible » ne se lit pas « aucun »',
  /charge\?\.inacheves === null/.test(PAGE_ADMIN) && /t\('unfinished\.unavailable'\)/.test(PAGE_ADMIN))
for (const langue of ['fr', 'en', 'es', 'de']) {
  const msg = JSON.parse(read(`messages/${langue}.json`))
  const u = msg?.admin_matching?.unfinished
  ok(`libellés traduits (${langue})`,
    !!u && typeof u.title === 'string' && !!u.etat?.abandonne && !!u.etat?.en_cours)
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n━━━ ${echecs === 0 ? 'TOUT VERT' : `${echecs} ÉCHEC(S)`} ━━━\n`)
process.exit(echecs === 0 ? 0 : 1)
