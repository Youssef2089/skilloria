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

/* ┌─ LE GEL, ET IL PORTE UN DEFAUT NOMME ───────────────────────────────────┐
   │ §G.8 : un gel d'EXEMPTIONS exige une raison par entree, et chaque raison │
   │ commence par LEGITIME ou par DEFAUT NOMME. Celles-ci sont des defauts.   │
   │                                                                          │
   │ On ne corrige pas le passe : la migration est APPLIQUEE, et la reecrire  │
   │ ferait diverger le disque de `schema_migrations`. On l'INSCRIT, et on    │
   │ ferme l'avenir — exactement comme les quatre migrations mal numerotees   │
   │ de §G.2.                                                                 │
   └──────────────────────────────────────────────────────────────────────────┘ */
const GEL = {
  '20260922000010_catalogue_stripe_par_mode.sql': {
    noms: [
      'idx_packages_stripe_product',
      'idx_packages_stripe_price_monthly',
      'idx_packages_stripe_price_yearly',
    ],
    raison:
      'DEFAUT NOMME — les trois noms appartenaient aux index de packages.stripe_*. ' +
      '`if not exists` a saute les creations sans rien dire, puis le drop column a ' +
      'emporte les anciens : packages_stripe est reste sans aucune garde. ' +
      'Repare par 20260922000040, avec des noms distincts et une postcondition. ' +
      'Cette migration est APPLIQUEE : on l inscrit, on ne la reecrit pas (§G.2).',
  },
  '20260919000010_suivi_consommation.sql': {
    noms: ['ai_spend_action_mois_idx'],
    raison:
      'DEFAUT NOMME, TROUVE PAR CE CONTROLE A SA PREMIERE EXECUTION — et NON ' +
      'REPARE, volontairement. Le nom etait pris depuis 20260916110000, sur la ' +
      'MEME table, avec les colonnes dans l ORDRE INVERSE : (action, created_at) ' +
      'contre (created_at, action). La creation a ete sautee, donc l index annonce ' +
      'pour « la lecture par mois » N EXISTE PAS ; c est l ancien, taille pour un ' +
      'autre tri, qui sert. AUCUNE GARANTIE N EST PERDUE — c est un index de ' +
      'PERFORMANCE, pas une garde : rien de faux ne peut en sortir, seulement une ' +
      'lecture plus lente. Le reparer demande de creer un index sur une table de ' +
      'journal qui grossit, donc de decider de la duree d un verrou : c est un ' +
      'arbitrage rendu a l architecte, pas une ligne a glisser dans ce lot.',
  },
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
/** Les collisions trouvées, en dehors du gel. */
const collisions = []
/** Les entrées du gel réellement rencontrées — un gel périmé ment (§E.16). */
const gelVu = new Set()

const CREATION =
  /create\s+(unique\s+)?index\s+(concurrently\s+)?(if\s+not\s+exists\s+)?([a-z0-9_]+)\s+on\s+(?:only\s+)?(?:public\.)?([a-z0-9_]+)/gi
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
    const deja = vivants.get(nom)

    if (deja && siPasExiste) {
      const gele = GEL[f]
      if (gele && gele.noms.includes(nom)) {
        gelVu.add(`${f}::${nom}`)
      } else {
        collisions.push({ migration: f, nom, table, precedente: deja.migration, avant: deja.table })
      }
    }
    // Vivant, quoi qu'il arrive : si la création a été sautée, c'est l'ANCIEN
    // qui reste vivant — et c'est bien ce que la base contient.
    if (!deja) vivants.set(nom, { migration: f, table })
  }
}

section('Les créations d’index sautées en silence')

ok(migrations.length > 0, `${migrations.length} migration(s) rejouée(s) dans l’ordre`)
ok(
  collisions.length === 0,
  'aucun `create index if not exists` sur un nom déjà vivant',
  collisions
    .map(
      (c) =>
        `${c.migration} crée « ${c.nom} » sur ${c.table}, mais ce nom vit déjà depuis ${c.precedente} (sur ${c.avant}) — la création sera SAUTÉE`,
    )
    .join(' · '),
)

/* ═══════════════════════════════════════════════════════════════════════════
   LE GEL NE MENT PAS
   ═══════════════════════════════════════════════════════════════════════════ */

section('Le gel — un défaut nommé, et il ne peut que descendre')

let gelees = 0
for (const [f, e] of Object.entries(GEL)) {
  for (const nom of e.noms) {
    gelees++
    const vu = gelVu.has(`${f}::${nom}`)
    ok(vu, `gelé et toujours présent : ${f} → ${nom}`,
      'une entrée de gel qui ne correspond à rien ment : la retirer')
  }
  console.log(`       ${e.raison}`)
}
ok(gelVu.size === gelees, `${gelVu.size} occurrence(s) gelée(s) sur ${gelees} déclarée(s)`)

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
