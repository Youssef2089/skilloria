// scripts/diag-score-de-pertinence.mjs — LE SCORE A CHANGÉ DE NATURE
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUI A CHANGÉ, ET POURQUOI CE SCRIPT EXISTE
//   `matches.score` portait une note de Claude sur 10, avec un barème écrit
//   dans le prompt. Elle était interprétable, et à peu près comparable d'une
//   annonce à l'autre.
//
//   Le score d'un reranker n'a AUCUNE de ces propriétés. Il vit dans [0,1], il
//   est propre à une requête, et le fournisseur écrit noir sur blanc qu'on ne
//   peut ni le lire comme une proportion, ni comparer les scores de deux
//   requêtes différentes.
//
//   Le risque n'est donc pas qu'on se trompe de colonne : c'est qu'un jour,
//   quelqu'un affiche « 0,4 / 10 », ou qu'un écran classe deux annonces sur une
//   échelle qui ne le permet pas. Rien dans le compilateur ne l'empêche : un
//   nombre reste un nombre.
//
// CE QUE CE SCRIPT VÉRIFIE — et il ÉCHOUE, ce n'est pas un recensement
//   A. la migration sépare les deux grandeurs, et les borne chacune ;
//   B. le score de pertinence NE SORT PAS de l'API — seul le palier sort ;
//   C. aucun nombre de pertinence n'atteint AUCUN écran ;
//   D. le palier n'est jamais RECALCULÉ à l'affichage ;
//   E. les deux échelles ne se croisent nulle part.
//
// ┌─ CONVERTI EN BALAYAGE (lot C4a, 20/09/2026) ────────────────────────────┐
// │ Il ouvrait DEUX routes et QUATRE vues par leur chemin. Un cinquième     │
// │ écran qui aurait affiché `{relevance_score}` n'aurait pas été regardé,  │
// │ et déplacer `MissionCard.tsx` l'aurait fait rougir sans qu'un nombre    │
// │ n'apparaisse (§E.34 : ancré sur un nom, il rougit au renommage et       │
// │ verdit au déplacement). Il balaie désormais `components/` +             │
// │ `app/[locale]/` côté écran, `app/api/` côté API, et il demande « ceci   │
// │ existe-t-il QUELQUE PART ? ». Ses motifs restent éprouvés sur fixtures  │
// │ AVANT le balayage.                                                       │
// └─────────────────────────────────────────────────────────────────────────┘
//
//   node scripts/diag-score-de-pertinence.mjs
//
// AUCUN accès base, AUCUN réseau.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ROOT, RACINES_CLIENT, LOCALES, lire, sansCommentaires, fichiers, messages, lireCle, bilan,
} from './balayage-promesse.mjs'

const { ok, section, info, fin } = bilan()

/**
 * Une migration se retrouve par son SUFFIXE DESCRIPTIF, jamais par son numéro
 * (§G.3). Zéro ou deux correspondances : on refuse de tourner.
 */
function migration(suffixe) {
  const dossier = join(ROOT, 'supabase', 'migrations')
  const trouvees = readdirSync(dossier).filter((x) => x.endsWith(`_${suffixe}.sql`))
  if (trouvees.length !== 1) {
    console.error(`\n❌ Migration *_${suffixe}.sql : ${trouvees.length} correspondance(s)`)
    process.exit(2)
  }
  return join('supabase', 'migrations', trouvees[0])
}
const sansCommentairesSql = (sql) => sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

// ══════════════════════════════════════════════════════════════════════════
section('ÉPREUVE DU DÉTECTEUR — avant de lui faire confiance')
// ══════════════════════════════════════════════════════════════════════════
//
// Le contrôle central de ce script cherche un NOMBRE DE PERTINENCE affiché.
// Un détecteur qui ne détecte rien passe pour vert. On l'éprouve donc à chaque
// exécution, sur des cas écrits ici.

/**
 * Une vue affiche-t-elle un nombre issu du score de pertinence ?
 *
 * On cherche les formes qui MÈNENT à un nombre visible : arrondi, division,
 * pourcentage, ou interpolation directe d'une variable de score. On ne cherche
 * PAS le mot « score » : il apparaît légitimement dans d'autres échelles
 * (vérification d'entreprise, note de candidature), et un contrôle qui crie au
 * loup finit ignoré.
 */
const NOMS_DE_SCORE = 'relevance_score|ai_score|matchScore|pertinence'
function nombresDePertinence(src) {
  const motifs = [
    new RegExp(`Math\\.round\\(\\s*[^)]*(?:${NOMS_DE_SCORE})`, 'g'),
    new RegExp(`toFixed\\(\\s*\\d*\\s*\\)[^\\n]*(?:${NOMS_DE_SCORE})`, 'g'),
    new RegExp(`\\{\\s*(?:[a-zA-Z_$.]*\\.)?(?:${NOMS_DE_SCORE})[a-zA-Z_$]*\\s*\\}`, 'g'),
    new RegExp(`(?:${NOMS_DE_SCORE})[a-zA-Z_$]*\\s*\\*\\s*100`, 'g'),
  ]
  const trouves = []
  for (const m of motifs) for (const t of src.matchAll(m)) trouves.push(t[0].replace(/\s+/g, ' '))
  return trouves
}
/** Une comparaison du score à un seuil — le palier recalculé à l'affichage. */
const comparaisonsDeScore = (src) =>
  [...src.matchAll(new RegExp(`(?:${NOMS_DE_SCORE})[a-zA-Z_$]*\\s*(?:>=|>|<|<=)\\s*[\\w.]+`, 'g'))].map((m) => m[0])
/**
 * Une LECTURE de la valeur du score dans du code serveur : `row.relevance_score`,
 * mais aussi `(r as X).relevance_score` ou `rows[0].relevance_score` — tout
 * accès de propriété, quel que soit ce qui précède le point. La première
 * version exigeait un identifiant devant le point, et une mutation
 * `(r as { relevance_score: number }).relevance_score` est passée VERTE.
 */
const lecturesDeScore = (src) => [...src.matchAll(/[\w)\]]\s*\.relevance_score\b/g)].map((m) => m[0].trim())

{
  const doitTrouver = [
    ['{t("x", { score: Math.round(ai_score) })}', 'un arrondi du score'],
    ['<span>{relevance_score}</span>', 'le score interpolé tel quel'],
    ['const pct = relevance_score * 100', 'un score converti en pourcentage'],
  ]
  const doitIgnorer = [
    ['{Math.round(verification.score)}', 'la note de vérification d entreprise'],
    ['{Math.round(ai_match_score)}', 'la note de candidature, sur 10, légitime'],
    ["order('relevance_score', { ascending: false })", 'un TRI par le score, jamais affiché'],
    ['  relevance_score: number | null', 'une DÉCLARATION de type, qui ne sort rien'],
    ['relevance_tier === "strong"', 'le palier, qui n est pas un nombre'],
    ["tPub('badges.ai_score', { score: Math.round(annonce.verification_score) })", 'la clé i18n `ai_score` d une AUTRE échelle (qualité d annonce)'],
  ]
  for (const [src, libelle] of doitTrouver) {
    ok(nombresDePertinence(src).length > 0, `détecte : ${libelle}`,
      'le détecteur laisserait passer un nombre affiché')
  }
  for (const [src, libelle] of doitIgnorer) {
    ok(nombresDePertinence(src).length === 0, `ignore : ${libelle}`,
      'faux positif : un contrôle qui crie au loup finit ignoré')
  }
  ok(comparaisonsDeScore('const strong = relevance_score >= 0.7').length === 1, 'détecte : un palier recalculé (`score >= seuil`)')
  ok(comparaisonsDeScore("relevance_tier === 'strong'").length === 0, 'ignore : une comparaison du PALIER')
  ok(lecturesDeScore('relevance_tier: row.relevance_tier, x: row.relevance_score').length === 1, 'détecte : une lecture `row.relevance_score`')
  ok(lecturesDeScore("order('relevance_score', { ascending: false })").length === 0, 'ignore : le nom passé en CHAÎNE à order()')
  ok(lecturesDeScore('(r as { relevance_score: number }).relevance_score').length === 1, 'détecte : une lecture derrière un cast `(r as X).relevance_score` — la mutation qui était passée verte')
  ok(lecturesDeScore('  relevance_score: number | null').length === 0, 'ignore : une déclaration de type')
}

// ══════════════════════════════════════════════════════════════════════════
section('A. LA MIGRATION SÉPARE LES DEUX GRANDEURS')
// ══════════════════════════════════════════════════════════════════════════

const SQL = sansCommentairesSql(lire(migration('score_de_pertinence')))

ok(/drop column if exists score\b/.test(SQL),
  'l ancienne note de matching est SUPPRIMÉE',
  'la garder inviterait à y ranger le score du reranker — deux grandeurs, une colonne')
ok(/add column if not exists relevance_score\s+numeric/.test(SQL),
  'relevance_score existe, en numeric')
ok(/relevance_score >= 0 and relevance_score <= 1/.test(SQL),
  'relevance_score est bornée à [0,1]',
  'sans borne, une valeur sur 10 s y rangerait sans un mot')
ok(/add column if not exists relevance_model/.test(SQL),
  'le modèle qui a produit le score est conservé',
  'changer de reranker change l échelle : un score sans son modèle est illisible')
ok(/add column if not exists relevance_tier/.test(SQL),
  'le PALIER affiché existe en base')
ok(/relevance_tier in \('strong', 'normal'\)/.test(SQL),
  'le palier est borné à deux valeurs',
  'une troisième valeur réintroduirait une graduation, donc un classement')
ok(/ai_match_score >= 0 and ai_match_score <= 10/.test(SQL),
  'la note de candidature reste bornée à [0,10]',
  'c est une AUTRE échelle : les deux bornes doivent rester distinctes')
ok(/create index if not exists matches_profile_relevance_idx/.test(SQL),
  'l index du flux porte sur la nouvelle colonne')
ok(/drop index if exists public\.matches_profile_score_idx/.test(SQL),
  'l index de l ancienne colonne est retiré',
  'un index sur une colonne supprimée fait échouer la migration')

// ══════════════════════════════════════════════════════════════════════════
section('B. LE SCORE NE SORT D AUCUNE ROUTE — balayage de app/api')
// ══════════════════════════════════════════════════════════════════════════
//
// Le moteur (`lib/matching/`) PRODUIT le score : il a le droit de le lire et
// de l'écrire. Une ROUTE, elle, ne fait que servir — et servir la valeur,
// c'est la voir finir affichée. Le score peut être TRIÉ (son nom passe alors
// en chaîne à `.order()`) mais jamais LU.

const ROUTES = fichiers(['app/api'], /route\.ts$/)
const routesQuiLisent = []
const routesQuiOrdonnent = []
for (const r of ROUTES) {
  const src = sansCommentaires(lire(r))
  if (/order\(\s*'relevance_score'/.test(src)) routesQuiOrdonnent.push(r)
  const lectures = lecturesDeScore(src)
  if (lectures.length) routesQuiLisent.push(`${r} : ${lectures.join(' ; ')}`)
}
info(`${ROUTES.length} routes balayées · ${routesQuiOrdonnent.length} ordonnent par le score`)
ok(routesQuiLisent.length === 0, 'aucune route ne LIT la valeur du score',
  routesQuiLisent.join('\n       ') || undefined)
ok(routesQuiOrdonnent.length >= 1, 'au moins une route ORDONNE par le score — le flux',
  'ordonner reste juste : c est afficher qui ne l est pas. Zéro route ordonnée = le motif ne voit plus le flux')
// Le PALIER est ce qui explique à l'expert pourquoi ce profil apparaît, sans
// nombre. Toute route qui ordonne par le score (le flux) ou qui SÉLECTIONNE le
// palier (le détail) doit le RENDRE — et il en existe au moins deux, le flux et
// le détail : une route de détail qui cesserait de le lire ferait tomber le
// compte, pas seulement disparaître de la liste.
const routesDuPalier = ROUTES.filter((r) => {
  const src = sansCommentaires(lire(r))
  return routesQuiOrdonnent.includes(r) || /['"][^'"]*\brelevance_tier\b[^'"]*['"]/.test(src)
})
ok(routesDuPalier.length >= 2, `au moins deux routes servent le palier — le flux et le détail (${routesDuPalier.length})`,
  'une route de détail a cessé de lire le palier : l expert perd l explication sur la fiche')
for (const r of routesDuPalier) {
  ok(/relevance_tier:/.test(sansCommentaires(lire(r))), `${r} rend le PALIER`)
}

// ══════════════════════════════════════════════════════════════════════════
section('C. AUCUN NOMBRE DE PERTINENCE SUR AUCUN ÉCRAN — balayage de components/ + app/[locale]/')
// ══════════════════════════════════════════════════════════════════════════

const ECRANS = fichiers(RACINES_CLIENT)
const ecransFautifs = []
for (const v of ECRANS) {
  const trouves = nombresDePertinence(sansCommentaires(lire(v)))
  if (trouves.length) ecransFautifs.push(`${v} : ${trouves.slice(0, 3).join(' ; ')}`)
}
info(`${ECRANS.length} fichiers client balayés`)
ok(ecransFautifs.length === 0, 'aucun écran n affiche un nombre de pertinence',
  ecransFautifs.join('\n       ') || undefined)

const MSG = messages()
// Un libellé qui contient encore « {score} » est une invitation permanente à
// réafficher le nombre. Il ne doit plus exister dans AUCUNE langue.
for (const chemin of ['missions.card.ai_score', 'missions.detail.ai_score_label', 'missions.casting.top_match']) {
  const survivantes = LOCALES.filter((l) => lireCle(MSG[l], chemin) !== undefined)
  ok(survivantes.length === 0, `« ${chemin} » n existe plus`,
    survivantes.length ? `encore présent en : ${survivantes.join(', ')} — quelqu un le réutilisera` : undefined)
}
for (const cle of ['strong', 'normal', 'tooltip']) {
  const absentes = LOCALES.filter((l) => !lireCle(MSG[l], `matching_badge.${cle}`))
  ok(absentes.length === 0, `matching_badge.${cle} dans les 4 langues`, absentes.join(', ') || undefined)
}
for (const l of LOCALES) {
  for (const cle of ['strong', 'normal']) {
    const v = String(lireCle(MSG[l], `matching_badge.${cle}`) ?? '')
    ok(!/\{\s*score\s*\}|\d+\s*\/\s*10|%/.test(v), `matching_badge.${cle} (${l}) ne porte aucun nombre`, `libellé : « ${v} »`)
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('D. LE PALIER N EST JAMAIS RECALCULÉ À L AFFICHAGE — même balayage')
// ══════════════════════════════════════════════════════════════════════════
//
// Le seuil est réglable et les scores ne sont pas comparables entre deux runs.
// Recalculer le palier à l'affichage rebaptiserait en silence des matches
// anciens : un expert verrait « forte » redevenir « correspondance » sans que
// rien n'ait changé pour lui.

const recalculs = []
const seuilsLocaux = []
for (const v of ECRANS) {
  const src = sansCommentaires(lire(v))
  const c = comparaisonsDeScore(src)
  if (c.length) recalculs.push(`${v} : ${c.join(' ; ')}`)
  if (/TOP_MATCH_THRESHOLD\s*=/.test(src)) seuilsLocaux.push(v)
}
ok(recalculs.length === 0, 'aucun écran ne compare un score à un seuil', recalculs.join('\n       ') || undefined)
ok(seuilsLocaux.length === 0, 'aucun écran ne redéfinit un seuil local',
  seuilsLocaux.length ? `${seuilsLocaux.join(', ')} — un seuil dans une vue est un second réglage que personne ne sait retrouver` : undefined)

// ══════════════════════════════════════════════════════════════════════════
section('E. LES DEUX ÉCHELLES NE SE CROISENT PAS — balayage de app/api + lib')
// ══════════════════════════════════════════════════════════════════════════
//
// Ranger un score de pertinence dans une note sur 10 le ferait lire « 0,73 / 10 ».
// La frontière est le SEUL point de conversion (§D.10) ; ailleurs, la note de
// candidature ne se copie jamais depuis le matching, et l'ancienne colonne
// `score` n'est plus lue.

const SERVEUR = fichiers(['app/api', 'lib'])
const croisements = []
const anciennes = []
for (const f of SERVEUR) {
  const src = sansCommentaires(lire(f))
  const m = src.match(/ai_match_score:\s*\w+\.(?:relevance_score|score)\b/g)
  if (m) croisements.push(`${f} : ${m.join(' ; ')}`)
  const a = src.match(/\bmatchRow\.score\b/g)
  if (a) anciennes.push(f)
}
ok(croisements.length === 0, 'la note de candidature n est copiée depuis aucun score de match',
  croisements.join('\n       ') || undefined)
ok(anciennes.length === 0, 'plus aucune lecture de l ancienne colonne `score` d un match', anciennes.join(', ') || undefined)
// ⚠️ CETTE ASSERTION EST **RETOURNÉE**, PAS SUPPRIMÉE (§E.34).
//    Elle exigeait `ai_match_score: null` au dépôt — c'était la forme que
//    prenait la règle « la note n'est PAS héritée du matching » tant que le
//    jugement arrivait après l'écriture, dans un `after()`.
//
//    Depuis §D.19, une candidature n'existe que complète : elle naît AVEC sa
//    note, produite par le jugement dans la même opération. Exiger un `null`
//    aujourd'hui exigerait le retour du défaut qu'on vient de fermer.
//
//    LA RÈGLE, ELLE, N'A PAS BOUGÉ ET RESTE GARDÉE DEUX FOIS, CI-DESSUS ET
//    CI-DESSOUS : la note de candidature ne se copie depuis AUCUN score de
//    match (le balayage `croisements`), et elle vient du JUGEMENT.
const depots = SERVEUR.filter((f) =>
  /ai_match_score:\s*resultat\.jugement\.score/.test(sansCommentaires(lire(f))),
)
ok(depots.length === 1, 'au dépôt, la note écrite est celle du JUGEMENT, jamais celle du match',
  `${depots.length} fichier(s) écrivent la note du jugement : elle doit venir de là, et de là seulement`)
ok(!SERVEUR.some((f) => /ai_match_score:\s*null/.test(sansCommentaires(lire(f)))),
  'et plus aucun chemin n écrit une candidature SANS note',
  'une candidature nue chez un client, c est ce que §D.19 interdit')

// ══════════════════════════════════════════════════════════════════════════
section('F. UN E-MAIL EST UNE SURFACE EXPERT — balayage de lib/emails')
// ══════════════════════════════════════════════════════════════════════════
//
// ⚠️ CETTE SECTION MANQUAIT, ET SON ABSENCE A COÛTÉ (§E.62).
//    La section C balaie `components/` et `app/[locale]/` — les ÉCRANS. Un
//    gabarit d'e-mail n'en est pas un, et il atteint pourtant l'expert sans
//    qu'il ouvre quoi que ce soit. Le digest des mises en relation a composé
//    « {titre} · {note}/10 » pendant tout l'été ; la note venait de
//    `matches.score`, supprimée le 01/09/2026, et la ligne n'a cessé d'être
//    juste que parce que la requête ÉCHOUAIT. Ce contrôle était vert.
//
//    Le vrai risque n'était pas le nombre affiché — il ne l'était plus. C'est
//    la RÉPARATION : remettre `relevance_score` là où `score` était mort avait
//    l'air d'un correctif, et aurait rouvert §D.6 en silence.
//
// LES MÊMES DÉTECTEURS QUE LES ÉCRANS, PAS UN SECOND DIALECTE (§E.20) :
//    `nombresDePertinence` et `lecturesDeScore` sont éprouvés plus haut, sur
//    des témoins exécutés AVANT tout balayage. En écrire d'autres ici aurait
//    fait deux jumeaux qui dérivent.

const EMAILS = fichiers(['lib/emails'])
const emailsFautifs = []
const emailsQuiLisent = []
for (const f of EMAILS) {
  const src = sansCommentaires(lire(f))
  const n = nombresDePertinence(src)
  if (n.length) emailsFautifs.push(`${f} : ${n.slice(0, 3).join(' ; ')}`)
  const l = lecturesDeScore(src)
  if (l.length) emailsQuiLisent.push(`${f} : ${l.slice(0, 3).join(' ; ')}`)
}
info(`${EMAILS.length} gabarit(s) et module(s) d e-mail balayés`)
ok(emailsFautifs.length === 0, 'aucun e-mail n interpole un nombre de pertinence',
  emailsFautifs.join('\n       ') || undefined)
ok(emailsQuiLisent.length === 0, 'aucun e-mail ne lit `relevance_score`',
  emailsQuiLisent.join('\n       ') || undefined)

// ── ET LE TYPE, PAS SEULEMENT LE RENDU (§E.31) ────────────────────────────
//    Un champ déclaré finit par être rempli. `MatchDigestItem` portait
//    `score: number` ; le retirer du rendu sans le retirer du type aurait
//    laissé la porte ouverte, et TypeScript aurait aidé à la repasser.
{
  const src = sansCommentaires(lire('lib/emails/templates.ts'))
  const i = src.indexOf('MatchDigestItem')
  const bloc = i < 0 ? '' : src.slice(i, src.indexOf('}', i) + 1)
  ok(i >= 0, 'le type du digest de mises en relation existe toujours',
    'renommé ou supprimé : cette assertion vise un nom qui n existe plus, relisez-la')
  ok(
    i >= 0 && !/\bscore\b|\brelevance/i.test(bloc),
    'le type du digest ne déclare AUCUN champ de score',
    bloc ? `déclaration : ${bloc.replace(/\s+/g, ' ').slice(0, 160)}` : undefined,
  )
}

fin('Le score a bien changé de nature : une grandeur, une colonne, un palier — sur tout le périmètre.')
