// scripts/diag-annonce-expiree.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ « UNE ANNONCE EST ENCORE ACTIVE » S'ÉCRIT À UN SEUL ENDROIT PAR LANGAGE. ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LE CAS MESURÉ, LE 22/09/2026 ───────────────────────────────────────────┐
// │ DOUZE lecteurs du filtre d'expiration dans le produit. ZÉRO dans         │
// │ `lib/matching/`, et ZÉRO dans `next_unfinished_matching_run`.            │
// │                                                                           │
// │ Le moteur notait donc des annonces EXPIRÉES — et il les PAYAIT, profil    │
// │ par profil, au tarif du reranker. Pour rien : le flux de l'expert         │
// │ (`lib/missions/feed.ts`) filtre à la lecture, et aucun de ces             │
// │ rapprochements n'aurait jamais été vu. Les six annonces de la base de     │
// │ recette sont expirées depuis des mois : c'est exactement le vivier que le │
// │ cron de rattrapage se serait offert.                                      │
// │                                                                           │
// │ ET LES DEUX CÔTÉS SE CONTREDISAIENT DÉJÀ. Depuis le 21/09,               │
// │ `matching_runs_inacheves` (la SUPERVISION) excluait les expirées ;        │
// │ `next_unfinished_matching_run` (la REPRISE, celle qui paie) ne le         │
// │ faisait pas. L'écran disait « rien à rejouer » pendant que le cron        │
// │ rejouait.                                                                 │
// └───────────────────────────────────────────────────────────────────────────┘
//
// LA PARADE N'EST PAS « AJOUTER LE FILTRE » — c'est qu'il n'y ait QU'UNE
// EXPRESSION par langage, et que toute autre fasse rougir :
//   · TypeScript → `lib/publications/expiry.ts`
//   · SQL        → `public.annonce_active(…)` (migration `annonce_active_partagee`)
// La durée vient de `duree_reglages` dans les deux cas, jamais d'un nombre
// écrit dans un fichier (§D.7).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE PÉRIMÈTRE, ÉCRIT — ET CHAQUE EXCLUSION JUSTIFIÉE
//
//   BALAYE   app/ lib/ components/  — tout code qui décide si une annonce est
//                                     active. Une expression locale y produit
//                                     un compte que l'écran voisin ne retrouve
//                                     pas, et rien ne casse (§E.24).
//            scripts/               — la recette et les diagnostics décident
//                                     aussi ; un contrôle qui dérive la règle
//                                     à sa façon valide sa propre version.
//            supabase/migrations/   — les corps de FONCTION et de VUE, DERNIÈRE
//                                     définition retenue. Une fonction qui
//                                     dérive la règle choisit des lignes EN
//                                     BASE, hors de toute route, et aucun `tsc`
//                                     n'en voit rien.
//
//   EXCLU    node_modules/ .next/   — pas du dépôt / généré.
//            supabase/_archive/     — migrations retirées du tronc, jamais
//                                     rejouées : les lire ferait dénoncer
//                                     l'histoire (§B.2 ⑥).
//            docs/ messages/        — de la prose et des traductions ; rien
//                                     n'y est exécuté contre la base.
//            lib/database.types.ts  — EXEMPTION NOMMÉE : fichier GÉNÉRÉ, inerte
//                                     (aucun `createClient<Database>` dans le
//                                     dépôt — `diag-colonnes-supprimees` tient
//                                     cette sentinelle). Il déclare les deux
//                                     colonnes côte à côte dans un type ; ce
//                                     n'est pas une dérivation, c'est un schéma.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-annonce-expiree.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE écriture.
// 0 = vert · 1 = rouge · 2 = n'a pas tourné.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { rejouerMigrations, depouiller } from './lib/schema-migrations.mjs'

const MOI = fileURLToPath(import.meta.url)
const ROOT = join(dirname(MOI), '..')
const RACINES = ['app', 'lib', 'components', 'scripts']
const EXCLUS_DOSSIER = new Set(['node_modules', '.next', '_archive'])

/**
 * ⚠️ LE CONTRÔLE SE RETIRE DU BALAYAGE, PAR SON CHEMIN RÉEL.
 *    Ses témoins sont de VRAIES dérivations — c'est tout leur intérêt. Un
 *    chemin écrit en dur rougirait au premier renommage ; `import.meta.url` y
 *    survit (§E.34).
 */
const estMoi = (chemin) => chemin === MOI

/** Le SEUL fichier TypeScript autorisé à exprimer la règle. */
const SOURCE_TS = 'lib/publications/expiry.ts'
/** La SEULE fonction SQL autorisée à l'exprimer. */
const SOURCE_SQL = 'annonce_active'

const EXEMPTIONS = {
  'lib/database.types.ts':
    'fichier GÉNÉRÉ et inerte : il DÉCLARE les colonnes, il n’en dérive rien. Sentinelle tenue par diag-colonnes-supprimees.',
}

let echecs = 0
const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

/* ═══════════════════════════════════════════════════════════════════════════
   1. LES OUTILS — commentaires ET chaînes retirés, sans perdre de lignes
   ═══════════════════════════════════════════════════════════════════════════

   ⚠️ LES CHAÎNES SE RETIRENT AUSSI, ET C'EST LE POINT DÉLICAT.
      Un select PostgREST cite ses colonnes DANS une chaîne :
      `.select('… status, expires_at, published_at')`. C'est une LISTE, pas une
      dérivation — et le moteur en porte une depuis ce lot. Les garder ferait
      rougir le correctif lui-même (§E.8 : on ancre sur ce qu'on défend). */
function depouillerJs(src) {
  let out = ''
  let i = 0
  const finChaine = (s, j) => {
    const q = s[j]
    let k = j + 1
    while (k < s.length) {
      if (s[k] === '\\') { k += 2; continue }
      if (s[k] === q) return k + 1
      k++
    }
    return s.length
  }
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i)
      if (j === -1) j = src.length
      out += ' '.repeat(j - i)
      i = j
      continue
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2)
      j = j === -1 ? src.length : j + 2
      out += src.slice(i, j).replace(/[^\n]/g, ' ')
      i = j
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const fin = finChaine(src, i)
      out += src.slice(i, fin).replace(/[^\n]/g, ' ')
      i = fin
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * UNE DÉRIVATION, ET PAS UN VOISINAGE.
 *
 * La propriété défendue : composer les deux colonnes de la règle SUR LE MÊME
 * OBJET. Citer `expires_at` seule (une conversation, une invitation — d'autres
 * tables, une autre règle) n'est pas une dérivation ; les composer en est une.
 *
 * ⚠️ LA PREMIÈRE VERSION MESURAIT UN VOISINAGE, ET C'EST §E.40.
 *    « les deux noms dans cinq lignes » a rendu CINQ faux positifs sur le
 *    produit : `conversations.expires_at` et `publications.published_at` se
 *    croisent dans une même fonction sans jamais être composées. Une fenêtre
 *    mesure la DISTANCE, pas la composition.
 *
 *    Ce qu'on exige maintenant : le MÊME PORTEUR devant les deux — `pub.`,
 *    `p.`, `row.`. C'est ce qui distingue une règle écrite d'une coïncidence
 *    de lecture, et ça vaut dans les deux langages : `p.expires_at` /
 *    `p.published_at` en SQL, `row.expires_at` / `row.published_at` en TS.
 *    Le cas non porté — deux colonnes NUES dans un même `coalesce` — est
 *    couvert à part, ci-dessous.
 *
 * On rend les fenêtres fautives avec leur ligne, jamais un simple booléen : un
 * contrôle qui dit « il y en a » sans dire où se fait désactiver (§E.14).
 */
function derivations(net, { horsAppel = null } = {}) {
  const lignes = net.split('\n')
  const out = []
  const porteurs = (txt, col) =>
    new Set([...txt.matchAll(new RegExp(`([A-Za-z_$][\\w$]*)\\s*\\.\\s*${col}\\b`, 'g'))].map((m) => m[1]))
  for (let i = 0; i < lignes.length; i++) {
    const fenetre = lignes.slice(i, i + 5).join('\n')
    // Un APPEL à la source partagée porte les deux noms en ARGUMENTS. C'est
    // l'usage attendu, pas une dérivation.
    /* ⚠️ UNE RECOPIE N'EST PAS UNE DÉRIVATION — SIX FAUX POSITIFS MESURÉS.
          `{ published_at: pub.published_at, expires_at: pub.expires_at }` porte
          les deux colonnes sur le même objet, et ne calcule RIEN : il assemble
          l'argument que `deriveCandidatureLifecycle` passera au module partagé.
          Six endroits du produit font exactement ça, tous corrects. On retire
          donc les COPIES À L'IDENTIQUE avant de juger : ce qui reste, ce sont
          les lectures qui composent. */
    const sansCopies = fenetre.replace(
      /\b(expires_at|published_at)\s*:\s*[^,;}\n]*\.\1\b/g,
      ' ',
    )
    const sansAppel = horsAppel
      ? sansCopies.replace(new RegExp(`${horsAppel}\\s*\\([^)]*\\)`, 'g'), ' ')
      : sansCopies
    const pExp = porteurs(sansAppel, 'expires_at')
    const pPub = porteurs(sansAppel, 'published_at')
    const memePorteur = [...pExp].some((x) => pPub.has(x))
    // Deux colonnes NUES composées dans un `coalesce` : même faute, sans alias.
    const nues =
      /coalesce\s*\([^)]*\bexpires_at\b[^)]*\bpublished_at\b/is.test(sansAppel) ||
      /coalesce\s*\([^)]*\bpublished_at\b[^)]*\bexpires_at\b/is.test(sansAppel)
    if (!memePorteur && !nues) continue
    if (out.some((d) => i - d.ligne < 5)) continue
    out.push({ ligne: i + 1, extrait: lignes[i].trim().slice(0, 100) })
  }
  return out
}

const INTERVALLE_LITTERAL =
  /(make_interval\s*\(\s*days\s*=>\s*\d+\s*\)|interval\s*'\s*\d+\s*days?\s*')/gi

/**
 * UNE DURÉE DE VIE D'ANNONCE ÉCRITE EN DUR — pas n'importe quel intervalle.
 *
 * ⚠️ CE DÉTECTEUR S'EST TROMPÉ DEUX FOIS, ET LES DEUX FAUTES SONT INSTRUCTIVES.
 *    ① Première version : elle cherchait `make_interval(days => 30)` et rendait
 *       ZÉRO — alors que `matching_health()` portait `interval '30 days'` depuis
 *       le 01/09/2026, quinze jours avant que la durée devienne réglable. Un
 *       contrôle ancré sur UNE écriture d'une règle verdit sur toutes les
 *       autres (§E.34).
 *    ② Deuxième version : les deux syntaxes, partout — SEPT résultats, sept
 *       faux positifs. `interval '90 days'` de rétention des journaux,
 *       `p_depuis interval default interval '30 days'` d'une FENÊTRE
 *       D'OBSERVATION. Une durée n'est pas l'autre.
 *
 * La propriété est donc : un intervalle littéral COMPOSÉ avec `published_at` ou
 * `expires_at`. C'est ce qui en fait une durée de vie d'annonce, et rien d'autre
 * ne l'est.
 */
function dureesDeVieEnDur(net) {
  const lignes = net.split('\n')
  const out = []
  for (let i = 0; i < lignes.length; i++) {
    const fenetre = lignes.slice(Math.max(0, i - 2), i + 3).join('\n')
    if (!/\b(published_at|expires_at)\b/.test(fenetre)) continue
    INTERVALLE_LITTERAL.lastIndex = 0
    const m = INTERVALLE_LITTERAL.exec(lignes[i])
    if (m) out.push(m[1])
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LES TÉMOINS — EXÉCUTÉS AVANT TOUT BALAYAGE (§E.33)
   ═══════════════════════════════════════════════════════════════════════════

   Un détecteur qui ne retrouve pas le cas connu ne prouve rien. On lui donne
   donc la dérivation RÉELLE qui vivait dans `matching_runs_inacheves`, le
   correctif qui la remplace, et deux voisins qu'il doit IGNORER. */
section('0. Le détecteur retrouve ce qu’il prétend voir — et ignore le reste')

const TEMOIN_DERIVATION = `
where p.status = 'published'
  and coalesce(
        p.expires_at,
        p.published_at + make_interval(days => 30)
      ) > now()
`
const TEMOIN_APPEL = `
where p.matching_completed_at is null
  and public.annonce_active(p.status, p.expires_at, p.published_at, v_vie)
`
const TEMOIN_LISTE = `
const q = admin.from('publications').select('id, status, expires_at, published_at')
`
const TEMOIN_AUTRE_TABLE = `
where c.expires_at < now() and c.unlocked_at is not null
`
/**
 * LE VOISINAGE QUI N'EST PAS UNE COMPOSITION — le faux positif MESURÉ.
 * Deux tables, deux règles, cinq lignes d'écart. C'est exactement ce que la
 * première version du détecteur dénonçait, cinq fois, sur du code sain (§E.40).
 */
const TEMOIN_VOISINAGE = `
const conv = rows.find((c) => c.expires_at !== null)
const lifecycle = deriveCandidatureLifecycle({
  publication: pub,
  publishedAt: pub.published_at,
})
`

ok(derivations(TEMOIN_DERIVATION).length === 1,
  'il VOIT une dérivation écrite à la main (coalesce + make_interval)',
  'le détecteur laisserait passer le défaut qu’il existe pour trouver')
ok(derivations(TEMOIN_APPEL, { horsAppel: SOURCE_SQL }).length === 0,
  '… et il se TAIT sur un appel à `annonce_active(…)`',
  'faux positif : le correctif lui-même rougirait')
ok(derivations(depouillerJs(TEMOIN_LISTE)).length === 0,
  '… et sur une LISTE de colonnes dans un select (chaîne retirée)',
  'un select qui charge les deux colonnes n’est pas une dérivation')
ok(derivations(TEMOIN_AUTRE_TABLE).length === 0,
  '… et sur `expires_at` SEULE (conversation, invitation : autre règle)',
  'citer une colonne n’est pas composer la règle')
ok(derivations(depouillerJs(TEMOIN_VOISINAGE)).length === 0,
  '… et sur un VOISINAGE : deux porteurs différents à cinq lignes d’écart',
  'le détecteur mesure une distance et non une composition — c’est §E.40, et il a déjà rendu 5 faux positifs')
ok(
  derivations(
    depouillerJs(`
const w = { status: pub.status, published_at: pub.published_at, expires_at: pub.expires_at }
`),
  ).length === 0,
  '… et sur une RECOPIE à l’identique dans un objet (six occurrences du produit)',
  'assembler l’argument du module partagé n’est pas écrire la règle',
)

// ── Le second détecteur, éprouvé aussi : la durée de VIE, pas toute durée ──
ok(
  dureesDeVieEnDur(`where coalesce(expires_at, published_at + interval '30 days') > now()`).length === 1,
  'il VOIT une durée de vie écrite en dur — syntaxe `interval \'30 days\'`',
  'la syntaxe qui a vécu trois semaines dans `matching_health()` lui échapperait',
)
ok(
  dureesDeVieEnDur(`coalesce(p.expires_at, p.published_at + make_interval(days => 30))`).length === 1,
  '… et l’autre syntaxe, `make_interval(days => 30)`',
  'un contrôle ancré sur UNE écriture verdit sur toutes les autres (§E.34)',
)
ok(
  dureesDeVieEnDur(`where c.created_at > now() - interval '90 days'`).length === 0,
  '… et il se TAIT sur une fenêtre d’OBSERVATION (rétention, santé)',
  'sept faux positifs mesurés : une durée n’est pas l’autre',
)
ok(
  dureesDeVieEnDur(`p_depuis interval default interval '30 days'`).length === 0,
  '… et sur un PARAMÈTRE de fenêtre, même valeur, même syntaxe',
  'c’est le contexte qui décide, pas le nombre',
)

/* ═══════════════════════════════════════════════════════════════════════════
   3. TYPESCRIPT — une seule expression
   ═══════════════════════════════════════════════════════════════════════════ */
section('1. TypeScript : la règle ne s’écrit que dans `lib/publications/expiry.ts`')

const fichiers = []
const parcourir = (d) => {
  for (const e of readdirSync(d)) {
    if (EXCLUS_DOSSIER.has(e)) continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) parcourir(p)
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) fichiers.push(p)
  }
}
for (const r of RACINES) parcourir(join(ROOT, r))

const fautifsTs = []
for (const f of fichiers) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  if (rel === SOURCE_TS || EXEMPTIONS[rel] || estMoi(f)) continue
  const net = depouillerJs(readFileSync(f, 'utf8').split('\r\n').join('\n'))
  for (const d of derivations(net)) fautifsTs.push(`${rel}:${d.ligne}  ${d.extrait}`)
}
ok(fichiers.length > 0, `${fichiers.length} fichier(s) balayé(s) dans ${RACINES.join(', ')}`)
ok(
  fautifsTs.length === 0,
  `aucune dérivation locale de la règle en TypeScript (${fautifsTs.length})`,
  fautifsTs.slice(0, 8).join('\n       '),
)

/* ═══════════════════════════════════════════════════════════════════════════
   4. SQL — une seule expression, dans la DERNIÈRE définition
   ═══════════════════════════════════════════════════════════════════════════ */
section('2. SQL : la règle ne s’écrit que dans `annonce_active()`')

const { fonctions } = rejouerMigrations()
ok(fonctions.size > 0, `${fonctions.size} fonction(s)/vue(s) SQL, dernière définition retenue`)
ok(fonctions.has(SOURCE_SQL), `\`${SOURCE_SQL}()\` existe`,
  'la source unique SQL a disparu : toutes les assertions qui suivent ne valent plus rien')

const fautifsSql = []
const appelants = []
for (const [nom, def] of fonctions) {
  const net = depouiller(def.corps, { garderBlocs: true })
  if (nom === SOURCE_SQL) continue
  if (new RegExp(`${SOURCE_SQL}\\s*\\(`).test(net)) appelants.push(nom)
  for (const d of derivations(net, { horsAppel: SOURCE_SQL })) {
    fautifsSql.push(`${nom}() — ${def.migration} : ${d.extrait}`)
  }
}
ok(
  fautifsSql.length === 0,
  `aucune fonction ni vue SQL ne réécrit la règle (${fautifsSql.length})`,
  fautifsSql.slice(0, 8).join('\n       '),
)
ok(appelants.length >= 3,
  `${appelants.length} fonction(s) SQL passent par \`${SOURCE_SQL}()\` : ${appelants.join(', ')}`,
  'la reprise, la supervision et la simulation de durée doivent toutes trois y passer')

/* ── LA DURÉE NE S'ÉCRIT PAS EN DUR, NI EN SQL NI AILLEURS (§D.7) ──────────
     `make_interval(days => 30)` était présenté dans le dépôt comme « la valeur
     par défaut de la colonne ». LA COLONNE N'A PAS DE DÉFAUT : le 30 est une
     valeur de SEMIS, écrite une fois dans un `insert`. Un nombre gelé là
     divergerait du réglage sans que rien ne le dise. */
/* ⚠️ DEUX FOIS ANCRÉ SUR LA MAUVAISE CHOSE, ET LES DEUX FAUTES SONT INSTRUCTIVES.
     ① La première version cherchait `make_interval(days => 30)` et rendait
        ZÉRO — alors que `matching_health()` portait `interval '30 days'` depuis
        le 01/09/2026. Un contrôle ancré sur UNE écriture d'une règle verdit sur
        toutes les autres (§E.34).
     ② La seconde cherchait les DEUX syntaxes, partout, et rendait SEPT — dont
        sept faux positifs : `interval '90 days'` de rétention des journaux,
        `p_depuis interval default interval '30 days'` d'une FENÊTRE
        D'OBSERVATION. Une durée n'est pas l'autre.

     La propriété est donc : un intervalle littéral COMPOSÉ avec `published_at`
     ou `expires_at`. C'est ce qui en fait une durée de vie d'annonce, et rien
     d'autre ne l'est. */
const dureesEnDur = []
for (const [nom, def] of fonctions) {
  for (const t of dureesDeVieEnDur(depouiller(def.corps, { garderBlocs: true }))) {
    dureesEnDur.push(`${nom}() — ${def.migration} : ${t} composé avec la date de publication`)
  }
}
ok(
  dureesEnDur.length === 0,
  `aucune durée de vie d’annonce écrite en dur dans une fonction SQL (${dureesEnDur.length})`,
  dureesEnDur.join('\n       '),
)

/* ═══════════════════════════════════════════════════════════════════════════
   5. LE MOTEUR — les DEUX SENS passent par la source, et lisent le réglage
   ═══════════════════════════════════════════════════════════════════════════

   ⚠️ ON ANCRE SUR LE COMPORTEMENT, PAS SUR UN NOM DE FICHIER (§E.34).
      Ce qui est exigé : tout module de `lib/matching/` qui CHOISIT des lignes
      de `publications` doit lire la règle partagée. Un troisième sens ajouté
      demain est donc couvert sans qu'on l'inscrive nulle part. */
section('3. Le moteur : tout module qui choisit des annonces lit la règle partagée')

const LECTEURS_PARTAGE = /isActivePublished|activePublishedOrClause|activePublishedBounds/
const moteursSansFiltre = []
const moteursSansReglage = []
for (const f of fichiers) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  if (!rel.startsWith('lib/matching/')) continue
  const brut = readFileSync(f, 'utf8').split('\r\n').join('\n')
  const net = depouillerJs(brut)
  // Une SÉLECTION de publications — pas un `update`, qui vise un id déjà décidé.
  const choisit = /\.from\(\s*['"]publications['"]\s*\)/.test(brut) && /\.select\s*\(/.test(brut)
  if (!choisit) continue
  if (!LECTEURS_PARTAGE.test(net)) moteursSansFiltre.push(rel)
  if (!/chargerDurees\s*\(/.test(net)) moteursSansReglage.push(rel)
}
ok(
  moteursSansFiltre.length === 0,
  `tout module du moteur qui sélectionne des annonces lit la règle (${moteursSansFiltre.length} manquant)`,
  moteursSansFiltre.join(', ') || undefined,
)
ok(
  moteursSansReglage.length === 0,
  `… et lit la durée dans \`duree_reglages\` (${moteursSansReglage.length} manquant)`,
  moteursSansReglage.join(', ') || undefined,
)

/* ── LE REFUS NE BRÛLE PAS UNE TENTATIVE ──────────────────────────────────
     Compter une tentative sur un REFUS ferait franchir le plafond d'abandon à
     une annonce qui n'a jamais eu de panne, et la ferait disparaître de la
     supervision sous une étiquette fausse (§E.22). L'ordre est donc la garde,
     et il se vérifie par la POSITION, pas par un commentaire (§E.7). */
{
  const net = depouillerJs(
    readFileSync(join(ROOT, 'lib/matching/index.ts'), 'utf8').split('\r\n').join('\n'),
  )
  const iRefus = net.indexOf('isActivePublished(')
  const iTentative = net.indexOf('await marquerTentative(')
  ok(
    iRefus > 0 && iTentative > 0 && iRefus < iTentative,
    'le refus d’une annonce expirée précède `marquerTentative` — aucune tentative brûlée',
    `refus à ${iRefus}, tentative à ${iTentative}`,
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. LES DEUX SENS NE PARTAGENT PAS LEURS STATUTS — et c'est un TYPE (§E.31)
   ═══════════════════════════════════════════════════════════════════════════ */
section('4. `annonce_expiree` ne peut pas remonter à un écran d’expert')

{
  /* ⚠️ CES ASSERTIONS LISENT LE SOURCE BRUT, ET C'EST OBLIGATOIRE.
        Une union de types est faite de LITTÉRAUX DE CHAÎNE — `'annonce_expiree'`
        — que `depouillerJs` blanchit. Sur le source dépouillé, la déclaration
        devient `type StatutExpert = | | |` : l'assertion « ne porte pas
        `annonce_expiree` » passait alors VIDE DE SENS, et celle qui exigeait
        `StatutAnnonce` la porte rougissait sur un type parfaitement correct.
        On dépouille pour chercher du CODE, jamais pour lire une déclaration. */
  const types = readFileSync(join(ROOT, 'lib/matching/types.ts'), 'utf8').split('\r\n').join('\n')
  const netTypes = types
  const mExpert = netTypes.match(/type\s+StatutExpert\s*=([^\n]*(?:\n\s*\|[^\n]*)*)/)
  ok(!!mExpert, '`StatutExpert` existe', 'le type qui sépare les deux sens a disparu')
  ok(
    !!mExpert && !/annonce_expiree/.test(mExpert[1]),
    '`StatutExpert` ne porte PAS `annonce_expiree`',
    mExpert ? `déclaration : ${mExpert[1].replace(/\s+/g, ' ').slice(0, 120)}` : undefined,
  )
  ok(
    /type\s+StatutAnnonce\s*=[\s\S]{0,80}annonce_expiree/.test(netTypes),
    '`StatutAnnonce` la porte, elle',
    'le statut du sens annonce n’existe nulle part : le moteur ne peut plus refuser',
  )

  const issue = depouillerJs(
    readFileSync(join(ROOT, 'lib/matching/issue-de-recherche.ts'), 'utf8').split('\r\n').join('\n'),
  )
  ok(
    /status:\s*StatutExpert/.test(issue),
    '`issueDepuisVerdict` exige `StatutExpert`, plus un `string`',
    'avec un `string`, un statut neuf tomberait dans « aucune mission » sans un mot (§E.29)',
  )

  const expert = depouillerJs(
    readFileSync(join(ROOT, 'lib/matching/run-for-expert.ts'), 'utf8').split('\r\n').join('\n'),
  )
  ok(
    /Promise<VerdictExpert>/.test(expert),
    'le sens expert rend `VerdictExpert` — la séparation tient à la compilation',
    'il rend le verdict large : rien n’empêcherait `annonce_expiree` d’atteindre un écran',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. CE QUE CE CONTRÔLE NE VÉRIFIE PAS
   ═══════════════════════════════════════════════════════════════════════════ */
section('Ce que ce contrôle ne vérifie pas')

note('que le SQL de la migration COMPILE. Il lit des fichiers (§E.12) ; aucun')
note('analyseur PostgreSQL n’est disponible dans ce dépôt, et l’appliquer')
note('exigerait d’écrire en base. La migration part à la recette comme les autres.')
note('que les deux règles — TypeScript et SQL — rendent le MÊME verdict sur une')
note('même ligne. Elles sont écrites à l’identique et lues côte à côte, mais')
note('seule une base le prouverait. C’est une dette DÉCLARÉE, pas un zéro (§E.38).')
note('l’ÉTAT réel des annonces. Six sont expirées sur la base de recette au')
note('22/09/2026 — un chiffre qui vient d’une lecture, pas de ce contrôle.')

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} contrôle(s) en échec\n`)
  process.exit(1)
}
console.log('✅ Une seule expression par langage, et le moteur la lit dans les deux sens.\n')
process.exit(0)
