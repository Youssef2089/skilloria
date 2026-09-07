// scripts/diag-messagerie-selection.mjs — CE QU'ON SÉLECTIONNE, ET CE QU'ON PERD
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEUX DÉFAUTS DE SÉLECTION, ET AUCUN NE SE VOIT AVANT D'AVOIR DU VOLUME
//
//   1. LE FIL D'UNE CONVERSATION gardait les 500 messages LES PLUS ANCIENS —
//      `ascending: true` suivi de `limit(500)`. Au-delà de 500, l'utilisateur
//      voyait le début de l'échange et PLUS ce qu'on venait de lui écrire.
//      La troncature était dans le mauvais sens : un plafond doit couper la
//      queue de l'histoire, jamais sa tête.
//
//   2. L'INBOX dérivait l'aperçu de chaque fil en lisant 500 messages TOUTES
//      CONVERSATIONS CONFONDUES. Au-delà, certains fils n'apparaissaient dans
//      aucune ligne lue et n'avaient donc AUCUN aperçu. Ce n'était pas une
//      troncature : une conversation sans aperçu se lit « personne n'a rien
//      écrit », soit l'inverse de la vérité. Le compteur de non-lus, dérivé de
//      la même lecture, sous-comptait pour la même raison.
//
//   Les deux ont la même signature : un plafond posé sur la MAUVAISE
//   dimension. Le premier coupait le bon ensemble par le mauvais bout ; le
//   second bornait des MESSAGES là où le besoin se compte en CONVERSATIONS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-messagerie-selection.mjs
//
// AUCUN accès base, AUCUN réseau. Ce diagnostic porte sur la SÉLECTION des
// lignes — ni sur l'affichage, ni sur les règles de re-masquage, qui sont
// livrés et figés.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// NORMALISATION DES FINS DE LIGNE (reprise du tronc) : le depot sort les
// fichiers en CRLF, et un retour chariot casse tout motif qui traverse un
// saut de ligne. Sans elle, ce diagnostic serait vert chez son auteur et
// rouge dans les autres worktrees, sur un fichier identique.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let echecs = 0
function ok(libelle, condition, detail = '') {
  if (condition) console.log(`  ✓ ${libelle}`)
  else {
    echecs++
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`)
  }
}
const titre = (s) => console.log(`\n=== ${s} ===`)

const FIL = 'app/api/conversations/[id]/messages/route.ts'
const INBOX = 'app/api/me/conversations/route.ts'

for (const f of [FIL, INBOX]) {
  if (!existsSync(join(ROOT, f))) {
    console.log(`\n  ✗ FICHIER ABSENT : ${f}\nÉCHEC.\n`)
    process.exit(1)
  }
}
const fil = read(FIL)
const inbox = read(INBOX)

/** Le bloc de la requête `messages` du fil, de la table jusqu'au limit. */
function selectionMessages(src) {
  const i = src.indexOf(".from('messages')")
  if (i < 0) return ''
  const j = src.indexOf('.limit(', i)
  if (j < 0) return src.slice(i, i + 600)
  return src.slice(i, src.indexOf(')', j) + 1)
}

console.log('\n━━━ MESSAGERIE — la sélection des lignes ━━━')

// ═══════════════════════════════════════════════════════════════════════════
// (A) LE FIL — on garde les messages RÉCENTS
// ═══════════════════════════════════════════════════════════════════════════
titre('(A) le fil garde les messages les plus RÉCENTS')

const selFil = selectionMessages(fil)
ok('la requête des messages du fil existe', selFil.length > 0)

// LE contrôle qui mord : le tri de SÉLECTION est décroissant.
// Viser `created_at` NOMMÉMENT : un `ascending: false` cherché au hasard dans
// le bloc est aussi satisfait par le tri de départage sur `id`. Le contrôle
// resterait alors vert avec un `created_at` ascendant — ou sans tri du tout,
// auquel cas le plafond couperait un ensemble arbitraire.
ok(
  'la sélection est décroissante SUR created_at (les plus récents)',
  /\.order\('created_at',\s*\{\s*ascending:\s*false/.test(selFil),
  'tri ascendant + limit = on garde les plus ANCIENS, et les messages récents disparaissent',
)
ok(
  "aucun tri ascendant ne subsiste dans la sélection",
  !/ascending:\s*true/.test(selFil),
  `sélection lue : ${selFil.replace(/\s+/g, ' ').slice(0, 160)}`,
)

// L'ordre d'AFFICHAGE, lui, reste chronologique : sélectionner par le bon bout
// ne doit pas retourner le fil à l'écran.
ok(
  "l'ordre chronologique est rétabli pour l'affichage (.reverse())",
  /\.reverse\(\)/.test(fil),
  "le fil s'afficherait à l'envers : on aurait échangé un défaut contre un autre",
)

// Départage déterministe : sans lui, la frontière des 500 peut bouger d'une
// lecture à l'autre sans qu'aucun message n'ait été écrit.
ok(
  'les horodatages égaux sont départagés (order id)',
  /\.order\('id',\s*\{\s*ascending:\s*false/.test(selFil),
)

// ═══════════════════════════════════════════════════════════════════════════
// (B) L'INBOX — chaque conversation garde son aperçu
// ═══════════════════════════════════════════════════════════════════════════
titre('(B) chaque conversation a son aperçu, quel que soit le volume')

// L'aperçu vient d'une dérivation UNE-LIGNE-PAR-CONVERSATION…
ok(
  "l'aperçu vient de conversation_apercus (une ligne par conversation)",
  inbox.includes("rpc('conversation_apercus'"),
  "l'aperçu est de nouveau dérivé d'une lecture de messages : les fils au-delà du plafond en seront privés",
)

// …et SURTOUT plus d'aucune lecture bornée de `messages` dans cette route.
// C'est ce contrôle-là qui attrape le retour en arrière : le plafond ne portait
// pas sur la bonne dimension.
ok(
  "l'inbox ne lit plus la table messages avec un plafond global",
  !inbox.includes(".from('messages')"),
  'une lecture de messages est revenue : un plafond sur les MESSAGES ne garantit rien par CONVERSATION',
)

// Le compteur de non-lus vient de la MÊME dérivation — il souffrait du même mal.
ok(
  'les non-lus viennent de la même dérivation par conversation',
  /non_lus/.test(inbox) && inbox.includes('unreadByConv.set'),
  'le compteur de non-lus est redevenu dépendant d’une lecture bornée',
)

// L'erreur est traitée. Elle ne l'était pas : une panne rendait zéro aperçu
// partout, silencieusement — donc indistinguable du défaut corrigé.
ok(
  "une panne de la dérivation est DITE, pas avalée",
  /apErr/.test(inbox) && /if \(apErr\)/.test(inbox) && /code: 'db_error'/.test(inbox),
  'une panne redonnerait zéro aperçu en silence, exactement comme le défaut',
)

// ═══════════════════════════════════════════════════════════════════════════
// (C) LA FONCTION SQL — ce qui rend la garantie possible
// ═══════════════════════════════════════════════════════════════════════════
titre('(C) la dérivation SQL tient sa promesse')

const dossier = join(ROOT, 'supabase', 'migrations')
const nomMigration = readdirSync(dossier).find((f) => f.endsWith('_apercus_conversations.sql'))
ok('la migration des aperçus existe', !!nomMigration)

if (nomMigration) {
  const sql = readFileSync(join(dossier, nomMigration), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .toLowerCase()

  ok('une seule ligne par conversation (distinct on)', sql.includes('distinct on (m.conversation_id)'))
  ok(
    'la ligne retenue est la plus RÉCENTE, départagée par id',
    /order by m\.conversation_id, m\.created_at desc, m\.id desc/.test(sql),
  )
  // Les non-lus sont comptés à part : les mélanger au distinct on ne rendrait
  // qu'un seul message, donc au plus un non-lu par fil.
  ok('les non-lus sont comptés séparément, par conversation', /group by m\.conversation_id/.test(sql))
  ok(
    "ses propres messages ne comptent jamais comme non-lus",
    /m\.sender_id <> p_user_id/.test(sql) && /m\.read_at is null/.test(sql),
  )
  // LEFT JOIN, et c'est le point : un fil entièrement LU doit garder son
  // aperçu. Un INNER JOIN le priverait d'aperçu — le défaut, réintroduit par
  // une jointure.
  ok(
    "un fil entièrement lu garde son aperçu (left join, pas inner)",
    /left join restants r/.test(sql),
    'une jointure interne priverait d’aperçu toute conversation sans non-lu',
  )
  ok('les index qui rendent la dérivation indexée existent', sql.includes('messages_conversation_recent_idx'))
  ok(
    "la fonction n'est exécutable que par le service-role",
    /revoke all on function public\.conversation_apercus/.test(sql) &&
      /grant execute on function public\.conversation_apercus\(uuid\[\], uuid\) to service_role/.test(sql),
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// (D) CE QUI N'A PAS BOUGÉ, ET NE DOIT PAS
// ═══════════════════════════════════════════════════════════════════════════
titre("(D) le périmètre : la sélection, rien d'autre")

// Le re-masquage et l'état de vie sont livrés et figés : ils continuent de
// passer par la MÊME source unique que les candidatures.
ok(
  "l'état de vie reste dérivé par le helper partagé (fil)",
  fil.includes('deriveCandidatureLifecycle('),
)
ok(
  "le re-masquage reste décidé par la source unique (inbox)",
  inbox.includes('disclosurePolicyForCandidatureLifecycle'),
)

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n━━━ ${echecs === 0 ? 'TOUT VERT' : `${echecs} ÉCHEC(S)`} ━━━\n`)
process.exit(echecs === 0 ? 0 : 1)
