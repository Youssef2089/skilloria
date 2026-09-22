// scripts/diag-index-sautes.mjs — UNE CREATION SAUTEE EN SILENCE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LA PROPRIETE DEFENDUE
//
//   Aucune migration ne cree un index `if not exists` dont le NOM a deja ete
//   cree plus tot dans l'historique, sans avoir ete supprime entre-temps.
//
//   UN NOM D'INDEX EST UNIQUE PAR SCHEMA, PAS PAR TABLE. Reutiliser un nom
//   pris, avec `if not exists`, ne cree RIEN et ne dit RIEN : Postgres saute la
//   creation, db push imprime « already exists, skipping », et la migration
//   « reussit ». Si l'ancien index disparait ensuite — par exemple parce qu'on
//   supprime sa colonne — la garantie n'existe NULLE PART, et rien ne l'a dit.
//
//   C'est exactement ce qui est arrive le 22/09/2026 a `packages_stripe` :
//   trois index uniques annonces, zero cree, decouvert en LISANT LA BASE
//   plusieurs jours apres. Detail complet : docs/pieges.md §E.60.
//
// CE QU'IL FAIT
//   Il rejoue l'historique des migrations DANS L'ORDRE, tient le registre des
//   noms d'index vivants, et refuse toute creation `if not exists` sur un nom
//   deja vivant. Il connait les suppressions EXPLICITES (`drop index`) et les
//   suppressions IMPLICITES (`drop column`, `drop table`) — c'est par cette
//   seconde forme que le cas reel est passe.
//
// CE QU'IL NE VERIFIE PAS, ET IL LE DIT
//   · L'etat REEL de la base. Il lit des fichiers (§E.12). Une migration
//     appliquee a la main, ou un index cree hors migration, lui echappe.
//   · Qu'un index existe pour une garantie donnee : c'est a la migration de se
//     verifier elle-meme, en postcondition.
//
// EPROUVE PAR MUTATION (§G.5) — 5 mutations, 5 detections, le 22/09/2026.
//
//   node scripts/diag-index-sautes.mjs [--registre]
//   Aucune base, aucun reseau, aucune ecriture. Lecture seule.
//   0 = vert · 1 = rouge · 2 = n'a pas tourne.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOSSIER = join(ROOT, 'supabase/migrations')
const REGISTRE = process.argv.includes('--registre')

const lire = (f) => readFileSync(join(DOSSIER, f), 'utf8').split('\r\n').join('\n')

/** Les commentaires SQL ne creent rien (§E.7). */
const sansCommentaires = (sql) =>
  sql
    .split('\n')
    .map((l) => (l.trimStart().startsWith('--') ? '' : l.replace(/--.*$/, '')))
    .join('\n')

/* ┌─ IL N'Y A PLUS DE GEL, ET C'EST MIEUX QU'UN GEL VIDE ───────────────────┐
   │ Ce controle a d'abord porte un gel de NOMS : trois occurrences de         │
   │ `catalogue_stripe_par_mode`, une de `suivi_consommation`, chacune avec sa │
   │ raison (§G.8). Un gel tolere une ligne PARCE QU'ELLE EST ECRITE DANS UNE  │
   │ LISTE — et il faut se souvenir de l'en retirer quand elle est reparee.    │
   │                                                                            │
   │ La propriete qui compte n'est pas « ce nom a deja servi » : c'est         │
   │ QU'AUCUN INDEX ANNONCE NE MANQUE. Une creation sautee est donc un defaut  │
   │ SAUF si une migration ULTERIEURE cree le meme index — meme table, memes   │
   │ colonnes — POUR DE BON, sans `if not exists`.                            │
   │                                                                            │
   │ Le gel disparait de lui-meme quand les deux cas sont repares, et une      │
   │ collision NEUVE et non reparee rougit sans qu'on ait rien a inscrire.     │
   └────────────────────────────────────────────────────────────────────────────┘ */

/** Colonnes d'un index, normalisees : l'ORDRE compte, le sens de tri non. */
function colonnesDe(liste) {
  return liste
    .toLowerCase()
    .replace(/\s+(desc|asc)\b/g, '')
    .replace(/\s+nulls\s+(first|last)\b/g, '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .join(',')
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
   LE REJEU DE L'HISTORIQUE
   ═══════════════════════════════════════════════════════════════════════════ */

const migrations = readdirSync(DOSSIER)
  .filter((f) => f.endsWith('.sql'))
  .sort()

/** nom d'index → { migration, table } — les index VIVANTS à cet instant. */
const vivants = new Map()
/** Les créations SAUTÉES — avec ce qui était voulu (table, colonnes). */
const sautees = []
/** Les créations réellement passées : c'est parmi elles qu'on cherche la réparation. */
const creees = []

const CREATION =
  /create\s+(unique\s+)?index\s+(concurrently\s+)?(if\s+not\s+exists\s+)?([a-z0-9_]+)\s+on\s+(?:only\s+)?(?:public\.)?([a-z0-9_]+)\s*\(([^)]*)\)/gi
const SUPPRESSION_INDEX = /drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi
const SUPPRESSION_COLONNE = /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z0-9_]+)([\s\S]*?);/gi
const SUPPRESSION_TABLE = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi

for (const f of migrations) {
  const sql = sansCommentaires(lire(f))

  // ── Les suppressions d'abord : une migration peut supprimer puis recréer.
  for (const m of sql.matchAll(SUPPRESSION_INDEX)) vivants.delete(m[1].toLowerCase())

  for (const m of sql.matchAll(SUPPRESSION_TABLE)) {
    const table = m[1].toLowerCase()
    for (const [nom, e] of [...vivants]) if (e.table === table) vivants.delete(nom)
  }

  /* ⚠️ LA SUPPRESSION IMPLICITE — c'est par elle que le cas reel est passe.
        `alter table packages drop column stripe_price_id_monthly` emporte
        l'index qui portait cette colonne, SANS que le mot « index » apparaisse
        nulle part. Un controle qui ne lirait que `drop index` croirait l'ancien
        index toujours vivant, et ne verrait jamais que la garantie a disparu. */
  for (const m of sql.matchAll(SUPPRESSION_COLONNE)) {
    const table = m[1].toLowerCase()
    const corps = m[2]
    if (!/drop\s+column/i.test(corps)) continue
    // On ne sait pas QUELLES colonnes un index porte : on retire donc, par
    // prudence, tous les index de cette table dont le nom cite une colonne
    // supprimee. Imprecis dans un sens SUR : on suppose l'index mort.
    const colonnes = [...corps.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?([a-z0-9_]+)/gi)].map(
      (c) => c[1].toLowerCase(),
    )
    for (const [nom, e] of [...vivants]) {
      if (e.table !== table) continue
      if (colonnes.some((c) => nom.includes(c) || nom.includes(c.replace(/^stripe_/, '')))) {
        vivants.delete(nom)
      }
    }
  }

  // ── Puis les créations.
  for (const m of sql.matchAll(CREATION)) {
    const siPasExiste = Boolean(m[3])
    const nom = m[4].toLowerCase()
    const table = m[5].toLowerCase()
    const colonnes = colonnesDe(m[6] ?? '')
    const deja = vivants.get(nom)

    if (deja && siPasExiste) {
      // SAUTEE : Postgres ne cree rien et ne dit rien. On note ce qui etait
      // VOULU — table et colonnes — pour savoir plus tard si quelqu'un l'a
      // reellement pose.
      sautees.push({
        migration: f,
        nom,
        table,
        colonnes,
        precedente: deja.migration,
        avant: deja.table,
      })
    } else {
      // REELLEMENT CREE (le nom etait libre). C'est cette liste qui repare.
      creees.push({ migration: f, nom, table, colonnes, siPasExiste })
    }
    // Vivant, quoi qu'il arrive : si la création a été sautée, c'est l'ANCIEN
    // qui reste vivant — et c'est bien ce que la base contient.
    if (!deja) vivants.set(nom, { migration: f, table })
  }
}

section('Les créations d’index sautées en silence')

ok(migrations.length > 0, `${migrations.length} migration(s) rejouée(s) dans l’ordre`)

/**
 * UNE CREATION SAUTEE EST-ELLE REPAREE ?
 *
 * Reparee = une migration ULTERIEURE cree, sur la MEME table et avec les MEMES
 * colonnes dans le MEME ordre, un index qui existe pour de bon — donc sous un
 * nom libre, et sans `if not exists` (sinon on ne fait que deplacer le pari).
 *
 * ⚠️ L'ORDRE DES COLONNES FAIT PARTIE DE L'IDENTITE. `(action, created_at)` et
 *    `(created_at, action)` ne servent pas la meme lecture : les confondre
 *    declarerait reparee une creation qui ne l'est pas — precisement le cas de
 *    `ai_spend_action_mois_idx`.
 */
const reparee = (s) =>
  creees.some(
    (c) =>
      c.migration > s.migration &&
      c.table === s.table &&
      c.colonnes === s.colonnes &&
      !c.siPasExiste,
  )

const orphelines = sautees.filter((s) => !reparee(s))

ok(
  orphelines.length === 0,
  'aucune création d’index sautée n’est restée sans réparation',
  orphelines
    .map(
      (c) =>
        `${c.migration} annonce « ${c.nom} » sur ${c.table} (${c.colonnes}), mais ce nom vit déjà depuis ${c.precedente} (sur ${c.avant}) — la création est SAUTÉE, et rien ne la repose ensuite`,
    )
    .join(' · '),
)

if (sautees.length > 0) {
  console.log('')
  for (const c of sautees) {
    console.log(
      `       ≡ sautée puis RÉPARÉE : ${c.migration} → « ${c.nom} » (${c.table} : ${c.colonnes})`,
    )
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ET LA MIGRATION CORRECTIVE SE VERIFIE ELLE-MEME
   ═══════════════════════════════════════════════════════════════════════════ */

section('La migration corrective')

const corrective = migrations.filter((f) => f.endsWith('_index_packages_stripe.sql'))
ok(corrective.length === 1, `la migration corrective existe et est unique (${corrective.length})`)
if (corrective.length === 1) {
  const sql = lire(corrective[0])
  /* ⚠️ SUR LE SQL SANS COMMENTAIRES, ET LA PREMIERE VERSION NE L'ETAIT PAS.
        Elle rougissait sur la migration corrective elle-meme : son en-tete
        CITE le `create unique index IF NOT EXISTS` fautif pour expliquer le
        defaut. Un controle qui lit un commentaire ne mesure pas ce qu'il croit
        (§E.7) — et ici il l'a fait sur le fichier meme qui repare le defaut. */
  ok(
    !/create\s+unique\s+index\s+if\s+not\s+exists/i.test(sansCommentaires(sql)),
    'elle n’utilise PAS `if not exists`',
    "c'est `if not exists` qui a transformé la collision en silence",
  )
  ok(
    /uq_packages_stripe_prix_mensuel_par_mode/.test(sql),
    'elle emploie des noms qui n’appartiennent qu’à elle',
  )
  ok(
    /raise exception/i.test(sql) && /indisunique/i.test(sql),
    'elle VÉRIFIE ce qu’elle a créé, et exige l’UNICITÉ',
    'un index non unique ne garde rien',
  )
  ok(
    /tc\.relname = 'packages_stripe'/.test(sql),
    '… et que l’index porte bien sur `packages_stripe`',
    "la postcondition de 20260910300000 n'interrogeait que `relname` : elle aurait trouvé l'index de `packages` et conclu que tout allait bien",
  )
}

/**
 * LA SECONDE CORRECTIVE — celle qui SUPPRIME un index avant d'en créer un.
 *
 * ⚠️ C'EST LE GESTE LE PLUS DANGEREUX DE TOUT CE LOT. Un nom d'index étant
 *    unique PAR SCHÉMA, un `drop index if exists` à l'aveugle sur un nom qui
 *    appartiendrait à une AUTRE table supprimerait l'index de cette autre
 *    table — la faute du jour, en pire et SANS RETOUR : un index supprimé ne
 *    se redécouvre pas, il se remarque quand une lecture devient lente.
 */
const correctiveDepense = migrations.filter((f) => f.endsWith('_index_depense_par_mois.sql'))
ok(
  correctiveDepense.length === 1,
  `la corrective de la dépense existe et est unique (${correctiveDepense.length})`,
)
if (correctiveDepense.length === 1) {
  const sql = sansCommentaires(lire(correctiveDepense[0]))
  ok(
    !/drop\s+index\s+if\s+exists/i.test(sql),
    'elle ne fait AUCUN `drop index if exists`',
    'un nom d’index est unique par schéma : un drop à l’aveugle emporte l’index d’une autre table',
  )
  ok(
    /v_table\s*<>\s*'ai_spend_events'[\s\S]{0,300}?raise exception/i.test(sql),
    '… elle VÉRIFIE la table du nom avant de supprimer, et LÈVE si ce n’est pas la sienne',
  )
  ok(
    /created_at DESC, action/.test(sql) && /raise exception/i.test(sql),
    'et sa postcondition exige les colonnes DANS L’ORDRE',
    '(action, created_at) et (created_at, action) ne servent pas la même lecture',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════ */

if (REGISTRE) {
  section('Le registre des index vivants, à la fin de l’historique')
  for (const [nom, e] of [...vivants].sort()) {
    console.log(`  ${nom.padEnd(46)} ${e.table.padEnd(24)} ${e.migration}`)
  }
}

section('Ce que ce contrôle ne vérifie pas')

note('l ETAT REEL de la base. Il lit des fichiers (§E.12) : une migration')
note('appliquee a la main, ou un index cree hors migration, lui echappe.')
note('qu un index existe pour une garantie donnee. C est a chaque migration de')
note('se verifier ELLE-MEME, en postcondition — ce controle dit seulement')
note('qu aucune creation ne sera sautee.')
note('la suppression implicite est DEDUITE du nom de l index : on retire ceux')
note('dont le nom cite une colonne supprimee. Un index nomme sans rapport avec')
note('ses colonnes serait cru vivant a tort — ce qui rend le controle PLUS')
note('severe, jamais plus permissif.')

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} CONTRÔLE(S) EN ÉCHEC\n`)
  process.exit(1)
}
console.log('✅ Aucune création d’index ne sera sautée en silence.\n')
process.exit(0)
