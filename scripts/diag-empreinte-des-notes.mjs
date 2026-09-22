// scripts/diag-empreinte-des-notes.mjs — UNE NOTE APPARTIENT A SES TEXTES.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LA PROPRIETE DEFENDUE
//
//   Une note du brouillon de notation n'est REUTILISEE que si les textes qui
//   l'ont produite sont identiques. Un profil modifie, une annonce modifiee :
//   autre empreinte, donc autre note. Par CONSTRUCTION, pas par discipline
//   (§D.15, §E.31, §E.58).
//
// CE QU'IL FAIT, ET POURQUOI IL EXECUTE PLUTOT QUE DE LIRE
//
//   `lib/matching/empreinte.ts` est PUR — un seul import, `node:crypto`. Le
//   controle l'importe et l'EXECUTE : il mesure donc la vraie fonction, pas une
//   seconde implementation qui ne prouverait rien sur la premiere (§E.33).
//
//   Le reste se lit dans le source : chaque LECTURE du brouillon doit comparer
//   l'empreinte, chaque ECRITURE doit en fournir une, et la colonne doit etre
//   `not null` SANS DEFAUT — une ligne sans empreinte impossible, et non
//   deconseillee.
//
// CE QU'IL NE VERIFIE PAS, ET IL LE DIT
//   · Que le texte hache soit CELUI qui part au reranker. Il verifie que c'est
//     la MEME EXPRESSION, dans la meme portee. Une refonte qui recalculerait le
//     texte autrement entre les deux lignes passerait — c'est le seul endroit
//     ou la justesse redeviendrait une discipline.
//   · Le comportement en base. Aucun acces reseau ici : la colonne est lue dans
//     la MIGRATION, pas dans le schema distant (§E.12).
//
// EPROUVE PAR MUTATION (§G.5) — 8 mutations, 8 detections, le 22/09/2026.
//
//   node scripts/diag-empreinte-des-notes.mjs
//   Aucune base, aucun reseau, aucune ecriture. Lecture seule.
//   0 = vert · 1 = rouge · 2 = n'a pas tourne.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

const sansCommentaires = (src) =>
  src
    .split('\n')
    .map((l) => {
      const nu = l.trimStart()
      return nu.startsWith('//') || nu.startsWith('*') || nu.startsWith('/*') ? '' : l
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

/* ═══════════════════════════════════════════════════════════════════════════
   A. LA FONCTION, EXECUTEE — pas relue (§E.33).
   ═══════════════════════════════════════════════════════════════════════════ */

section('A. La vraie fonction, exécutée')

let empreinteDeNote
try {
  ;({ empreinteDeNote } = await import(new URL('../lib/matching/empreinte.ts', import.meta.url).href))
} catch (e) {
  console.error(`\n❌ lib/matching/empreinte.ts INIMPORTABLE : ${e.message}\n`)
  process.exit(2)
}

const ANNONCE = 'Mission Azure — migration d’un socle Active Directory. Compétences : Entra ID.'
const PROFIL = 'Architecte cloud, 11 ans, certifié Azure Solutions Architect Expert.'

const base = empreinteDeNote(ANNONCE, PROFIL)

ok(
  typeof base === 'string' && /^[0-9a-f]{64}$/.test(base),
  'l’empreinte est un sha-256 hexadécimal',
  `rendu : ${String(base).slice(0, 40)}`,
)

ok(
  empreinteDeNote(ANNONCE, PROFIL) === base,
  'textes IDENTIQUES → MÊME empreinte (la note se réutilise)',
)

/* ⚠️ LA MUTATION DEMANDEE, ET C'EST LE CŒUR DU CONTROLE.
      « Un profil modifie qui reutiliserait une note de l'ancienne empreinte
      doit faire rougir. » On le mesure sur la vraie fonction : un caractere
      change suffit. */
const PROFIL_MODIFIE = `${PROFIL} Nouvelle certification : Security Engineer.`
ok(
  empreinteDeNote(ANNONCE, PROFIL_MODIFIE) !== base,
  'PROFIL modifié → empreinte DIFFÉRENTE (la note d’avant n’est pas reprise)',
)
ok(
  empreinteDeNote(ANNONCE, `${PROFIL} `) !== base,
  'un seul caractère de plus dans le profil suffit à changer l’empreinte',
)

const ANNONCE_MODIFIEE = `${ANNONCE} Télétravail partiel.`
ok(
  empreinteDeNote(ANNONCE_MODIFIEE, PROFIL) !== base,
  'ANNONCE modifiée → empreinte DIFFÉRENTE (le trou existait des DEUX côtés)',
)

/* L'ORDRE CANONIQUE. Les deux sens appellent le reranker a l'envers l'un de
   l'autre ; c'est l'appelant qui doit ranger ses arguments, et les deux sens
   doivent retomber sur la MEME empreinte — sinon le partage entre sens, qui est
   delibere, disparait (une regression de cout). */
ok(
  empreinteDeNote(ANNONCE, PROFIL) === base,
  'les deux sens produisent la MÊME empreinte pour le même couple de textes',
  'l’ordre est canonique (annonce, profil), jamais celui de l’appel',
)
ok(
  empreinteDeNote(PROFIL, ANNONCE) !== base,
  'et l’ordre COMPTE : inverser les deux textes donne une autre empreinte',
)

/* LE SEPARATEUR NE SE FORGE PAS. Sans separateur — ou avec un separateur
   possible dans les donnees — ("ab","c") et ("a","bc") collisionneraient, et
   deux couples differents partageraient une note. */
ok(
  empreinteDeNote('ab', 'c') !== empreinteDeNote('a', 'bc'),
  'deux découpages différents du même texte ne collisionnent PAS',
)

/* ═══════════════════════════════════════════════════════════════════════════
   B. LE BROUILLON — chaque lecture compare, chaque écriture fournit.
   ═══════════════════════════════════════════════════════════════════════════ */

section('B. Le brouillon : lectures et écritures')

const reprise = sansCommentaires(lire('lib/matching/reprise.ts'))

/**
 * Les appels `.from(TABLE)` et ce qu'ils font, par DECOUPAGE DU SOURCE.
 * On s'ancre sur l'opération (select / upsert / delete), jamais sur le nom de
 * la fonction qui la porte : un renommage ne doit rien casser (§E.34).
 */
function operations(src) {
  const out = []
  const re = /\.from\(TABLE\)([\s\S]{0,700}?)(?=\n\s*(?:if|const|return|\}\n)|$)/g
  let m
  while ((m = re.exec(src)) !== null) {
    const corps = m[1]
    const type = /\.select\(/.test(corps)
      ? 'select'
      : /\.upsert\(/.test(corps)
        ? 'upsert'
        : /\.delete\(/.test(corps)
          ? 'delete'
          : 'inconnu'
    out.push({ type, corps })
  }
  return out
}

const ops = operations(reprise)
const selects = ops.filter((o) => o.type === 'select')
const upserts = ops.filter((o) => o.type === 'upsert')

ok(ops.length > 0, `${ops.length} accès au brouillon repérés dans reprise.ts`)
ok(
  ops.every((o) => o.type !== 'inconnu'),
  'chaque accès est un select, un upsert ou un delete — aucun non classé',
  'un accès non classé ne serait vérifié par rien',
)
ok(selects.length >= 2, `${selects.length} LECTURE(S) du brouillon`)
ok(upserts.length >= 2, `${upserts.length} ÉCRITURE(S) dans le brouillon`)

ok(
  selects.every((o) => /\.select\([^)]*\bempreinte\b/.test(o.corps)),
  'chaque LECTURE projette la colonne `empreinte`',
  'une lecture qui ne la lit pas ne peut pas la comparer',
)

/* ⚠️ L'ECRITURE SE VERIFIE SUR LA FONCTION, PAS SUR UNE FENETRE APRES L'APPEL.
      Premiere version : une fenetre de 700 caracteres APRES `.from(TABLE)`.
      Elle rougissait a tort — les lignes sont construites AVANT l'appel
      (`const lignes = notes.map(...)`), donc `empreinte:` tombait HORS de la
      fenetre. Une fenetre mesure une distance au motif, jamais l'appartenance
      a ce qui le porte (§E.40) : la portee juste est la FONCTION. */
const fonctions = reprise.split(/export async function /).slice(1)
const fonctionsQuiEcrivent = fonctions.filter((f) => /\.upsert\(/.test(f))

ok(
  fonctionsQuiEcrivent.length === upserts.length,
  `${fonctionsQuiEcrivent.length} fonction(s) portent une écriture — autant que d’écritures`,
)
ok(
  fonctionsQuiEcrivent.every((f) => /\bempreinte:\s*empreintes\.get\(/.test(f)),
  'chaque ÉCRITURE fournit une `empreinte`, prise dans la table passée en argument',
  'la colonne est `not null` : une écriture sans empreinte est refusée par la base',
)
ok(
  fonctionsQuiEcrivent.every((f) => /empreintes\.has\(/.test(f)),
  'et une note SANS empreinte est écartée en amont, en le disant',
  'la laisser partir ferait rejeter tout le lot par le `not null`',
)

/**
 * LA COMPARAISON — la moitié qui compte.
 *
 * Projeter la colonne ne sert à rien si la valeur lue n'est jamais confrontée
 * à celle attendue. On exige donc, dans chaque fonction qui lit, une
 * comparaison entre l'empreinte de la ligne et celle de la table passée en
 * argument, ET un `continue` : lire, comparer, puis se servir quand même
 * serait §E.8 dans sa forme la plus coûteuse.
 */
const fonctionsQuiLisent = fonctions.filter((f) => /\.select\([^)]*\bempreinte\b/.test(f))

ok(
  fonctionsQuiLisent.length === selects.length,
  `${fonctionsQuiLisent.length} fonction(s) portent une lecture — autant que de lectures`,
)
ok(
  fonctionsQuiLisent.every((f) => /empreinte\s*!==\s*empreintes\.get\(/.test(f)),
  'chaque lecture COMPARE l’empreinte de la ligne à celle attendue',
  'projeter la colonne sans la comparer ne ferme rien (§E.8)',
)
ok(
  fonctionsQuiLisent.every((f) =>
    /empreinte\s*!==\s*empreintes\.get\([^)]*\)\s*\)\s*\{[\s\S]{0,120}?continue/.test(f),
  ),
  'et une ligne périmée est ÉCARTÉE (`continue`), pas seulement comptée',
)

/* ═══════════════════════════════════════════════════════════════════════════
   C. LE SCHÉMA — la garde EST la clé, elle ne dépend d'aucune relecture.
   ═══════════════════════════════════════════════════════════════════════════ */

section('C. Le schéma : une ligne sans empreinte est IMPOSSIBLE')

const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) =>
  f.endsWith('_empreinte_des_notes.sql'),
)
ok(migrations.length === 1, `la migration existe et est unique (${migrations.length})`)

if (migrations.length === 1) {
  const sql = lire(`supabase/migrations/${migrations[0]}`)
  const ajout = sql.match(/add column\s+empreinte\s+text([^;]*);/i)
  ok(Boolean(ajout), 'elle ajoute la colonne `empreinte text`')
  if (ajout) {
    ok(/not null/i.test(ajout[1]), 'la colonne est `not null`')
    ok(
      !/default/i.test(ajout[1]),
      'et SANS défaut — sinon une ligne sans empreinte porterait une sentinelle',
      'un défaut créerait une valeur à exclure à chaque lecture : une discipline, justement ce qu’on remplace',
    )
  }
  ok(
    /delete from public\.matching_notes_partielles/i.test(sql),
    'elle vide la table avant d’ajouter la colonne',
    'les empreintes des lignes existantes sont INCONNUES, pas vides',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   D. LES APPELANTS — ils hachent le texte QU'ILS ENVOIENT.
   ═══════════════════════════════════════════════════════════════════════════ */

section('D. Les deux sens hachent les textes qu’ils envoient')

const annonce = sansCommentaires(lire('lib/matching/index.ts'))
const expert = sansCommentaires(lire('lib/matching/run-for-expert.ts'))

for (const [nom, src, attendu] of [
  ['index.ts (annonce → experts)', annonce, 'empreinteDeNote(requete, d.texte)'],
  ['run-for-expert.ts (expert → annonces)', expert, 'empreinteDeNote(d.texte, requete)'],
]) {
  ok(src.includes(attendu), `${nom} : empreinte sur \`${attendu}\``,
    'l’ordre est canonique (annonce, profil) — pas celui de l’appel')
  ok(
    /requete,\s*\n?\s*documents: aNoter,/.test(src) ||
      /requete,[\s\S]{0,120}documents: aNoter/.test(src),
    `${nom} : ce sont bien \`requete\` et les documents qui partent au reranker`,
    'le texte haché et le texte envoyé doivent être la même expression',
  )
  ok(
    /empreintes\s*\)/.test(src) || /empreintes,/.test(src),
    `${nom} : la table d’empreintes est passée à la reprise ET à la mémorisation`,
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   E. LE DÉLAI — il ne se justifie plus par un coût qui n'existait pas.
   ═══════════════════════════════════════════════════════════════════════════ */

section('E. Le report a changé de raison')

const relance = lire('lib/matching/relance.ts')

ok(
  !/dix runs co[uû]tent dix fois/i.test(relance),
  'la justification par « dix runs coûtent dix fois » a disparu',
  'elle était FAUSSE : la reprise par identité rendait un second run presque gratuit',
)
ok(
  /DELAI_RELANCE_MINUTES = (\d+)/.test(relance),
  'le délai est une constante nommée',
)
const delai = Number(relance.match(/DELAI_RELANCE_MINUTES = (\d+)/)?.[1])
ok(
  Number.isFinite(delai) && delai > 0 && delai <= 30,
  `le délai vaut ${delai} minutes — l’anti-rafale se règle sur les pauses d’une séance d’édition`,
  'au-delà, il payait la justesse, que la clé donne désormais par construction',
)
ok(
  /anti-rafale/i.test(relance) && /empreinte/i.test(relance),
  'et le module DIT sa vraie raison, en nommant l’empreinte',
)

/* ═══════════════════════════════════════════════════════════════════════════ */

section('Ce que ce contrôle ne vérifie pas')

note('que le texte HACHÉ soit celui qui part au reranker : il vérifie que c est')
note('la MEME EXPRESSION, dans la meme portee. Une refonte qui recalculerait le')
note('texte entre les deux lignes passerait — seul endroit ou la justesse')
note('redeviendrait une discipline.')
note('que la note soit SYMETRIQUE. Le partage entre les deux sens suppose que la')
note('note de (requete = annonce, document = profil) vaut celle de l inverse ; un')
note('reranker ne le garantit pas. Supposition PREEXISTANTE, conservee a')
note('l identique et nommee pour etre arbitrable (§E.38, §E.58).')

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} CONTRÔLE(S) EN ÉCHEC\n`)
  process.exit(1)
}
console.log('✅ Une note appartient aux textes qui l’ont produite, et rien ne la reprend sans eux.\n')
process.exit(0)
