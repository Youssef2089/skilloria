// scripts/diag-relance-rejouee.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ UNE RELANCE DONT LE RUN A ÉCHOUÉ NE SE SOLDE PAS. ELLE SE REJOUE, BORNÉE.║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LE CAS MESURÉ, LE 22/09/2026 — TROIS APPELANTS ─────────────────────────┐
// │ `cron/expert-relance`, `me/sync-matching` et `admin/approve-expert`       │
// │ appelaient `solderRelance()`                                              │
// │ APRÈS le run, **quel que soit le verdict**. Moteur éteint, clé absente,   │
// │ plafond de dépense atteint, réglages illisibles : l'échéance était        │
// │ effacée exactement comme après un run réussi.                             │
// │                                                                           │
// │ LE JALON EST POSÉ, PLUS RIEN NE REPREND (§E.27 forme B). La modification  │
// │ de profil qui avait déclenché la relance n'est JAMAIS notée — et personne │
// │ ne le sait : ni l'expert, ni nous.                                        │
// │                                                                           │
// │ ⚠️ L'AUDIT N'EN NOMMAIT QUE DEUX. Le troisième — l'APPROBATION — a été     │
// │    trouvé par CE contrôle, à sa première exécution, parce qu'il cherche   │
// │    un COMPORTEMENT (« qui appelle `solderRelance` ? ») et non une liste.  │
// │    C'est le pire des trois : son propre commentaire dit « c'est le moment │
// │    qui compte pour l'expert […] son premier contact avec la plateforme ». │
// │    Un moteur éteint à cette seconde-là, et cet écran restait vide, pour   │
// │    toujours. Une liste d'appelants tenue à la main ne l'aurait pas vu     │
// │    (§E.61, et c'est la même leçon).                                       │
// │                                                                           │
// │ ET LE CÔTÉ ANNONCE FAISAIT L'INVERSE DEPUIS TOUJOURS. `acheverRun(…,      │
// │ acheve)` laisse `matching_completed_at` à NULL sur un échec : le run reste │
// │ rejouable, borné à cinq tentatives, et VISIBLE au-delà. Deux              │
// │ comportements pour un même fait, et c'est celui qui PERD qui était du     │
// │ côté de l'expert.                                                         │
// └───────────────────────────────────────────────────────────────────────────┘
//
// LES TROIS PROPRIÉTÉS DÉFENDUES, ET AUCUNE N'EST UNE DISCIPLINE :
//   ① tout appelant qui SOLDE consulte d'abord `runAcheve()` — vérifié sur le
//      comportement, pas sur une liste d'appelants (§E.34) ;
//   ② la file est BORNÉE — sans plafond, « ne pas solder » est une boucle
//      infinie, payante à chaque passage ;
//   ③ l'expert le SAIT — un run échoué ne se lit pas « aucune mission ».
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE PÉRIMÈTRE, ÉCRIT — ET CHAQUE EXCLUSION JUSTIFIÉE
//
//   BALAYE   app/ lib/              — les appelants du moteur de relance et le
//                                     flux qui doit dire l'échec.
//            components/            — l'état vide d'un écran peut y vivre ;
//                                     l'exclure ferait passer un « aucune
//                                     mission » déplacé dans un composant.
//            app/[locale]/…         — les DEUX écrans jumeaux (parité, §D.14).
//            supabase/migrations/   — les corps SQL : c'est la base qui borne
//                                     la file et qui garde l'échéance.
//            messages/*.json        — les quatre langues : une clé absente
//                                     d'une seule langue s'affiche brute.
//
//   EXCLU    node_modules/ .next/   — pas du dépôt / généré.
//            supabase/_archive/     — retirées du tronc, jamais rejouées.
//            docs/                  — de la prose ; rien n'y est exécuté.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-relance-rejouee.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE écriture.
// 0 = vert · 1 = rouge · 2 = n'a pas tourné.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { rejouerMigrations, depouiller } from './lib/schema-migrations.mjs'

const MOI = fileURLToPath(import.meta.url)
const ROOT = join(dirname(MOI), '..')
const RACINES = ['app', 'lib', 'components']
const EXCLUS_DOSSIER = new Set(['node_modules', '.next', '_archive'])
const LOCALES = ['fr', 'en', 'es', 'de']

let echecs = 0
const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)
const lire = (rel) => readFileSync(join(ROOT, rel), 'utf8').split('\r\n').join('\n')

/** §E.7 — commentaires retirés SANS perdre de lignes. */
function depouillerJs(src) {
  let out = ''
  let i = 0
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
    out += c
    i++
  }
  return out
}

const fichiers = []
const parcourir = (d) => {
  for (const e of readdirSync(d)) {
    if (EXCLUS_DOSSIER.has(e)) continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) parcourir(p)
    else if (/\.(ts|tsx)$/.test(e)) fichiers.push(p)
  }
}
for (const r of RACINES) parcourir(join(ROOT, r))

/* ═══════════════════════════════════════════════════════════════════════════
   0. LA RÈGLE EST PURE — ON L'EXÉCUTE, ON NE LA RELIT PAS (§E.33)
   ═══════════════════════════════════════════════════════════════════════════ */
section('0. La décision « le run a-t-il abouti » — EXÉCUTÉE')

/**
 * ⚠️ ON IMPORTE LE MODULE, ON NE LE RELIT PAS.
 *
 *    Node 24 retire les annotations de type tout seul, donc `lib/matching/run-
 *    abouti.ts` se charge TEL QUEL — à la condition qu'il n'ait AUCUN import,
 *    ce que son en-tête énonce et qu'on vérifie ci-dessous. Même parti pris que
 *    `diag-expert-name-masking` sur `lib/expert-name-code.ts`.
 *
 *    La première version de ce contrôle découpait les fonctions dans
 *    `relance.ts` et les passait à `new Function` après avoir retiré les types
 *    à coups d'expressions régulières. Ça ne marchait pas (« Unexpected token
 *    ':' »), et surtout ça n'aurait rien prouvé : ce qu'on aurait exécuté,
 *    c'est le résultat d'un découpage, pas le code qui tourne en production
 *    (§E.33 — un point de comparaison mal choisi déplace la faute).
 */
const { runAcheve: ACHEVE, codeDEchec: CODE } = await import('../lib/matching/run-abouti.ts')

ok(typeof ACHEVE === 'function', '`runAcheve` est PURE et exécutable telle quelle',
  'si elle cesse de l’être, ce contrôle ne vérifie plus qu’un texte (§E.7)')
{
  // La pureté n'est pas une promesse d'en-tête : un `import` ajouté demain
  // rendrait ce fichier inchargeable, et le contrôle N'AURAIT PAS TOURNÉ.
  const src = depouillerJs(lire('lib/matching/run-abouti.ts'))
  ok(
    !/^\s*import\s/m.test(src),
    '… et le module n’a TOUJOURS aucun import',
    'un seul import d’alias `@/` le rend inchargeable : le contrôle ne rougirait pas, il MOURRAIT',
  )
}

if (typeof ACHEVE === 'function') {
  const cas = [
    [{ status: 'ok', proposals: [] }, true, 'un run réussi ⇒ ON SOLDE'],
    [{ status: 'empty_pool' }, true, 'vivier vide SANS empêchement ⇒ un RÉSULTAT, on solde'],
    [
      { status: 'empty_pool', empechement: { quoi: 'ineligible', raison: 'profil_non_visible' } },
      true,
      'expert inéligible ⇒ on solde (rejouer n’y changerait rien)',
    ],
    [{ status: 'error' }, false, 'une panne de lecture ⇒ ON REJOUE'],
    [{ status: 'no_config' }, false, 'réglages absents ⇒ ON REJOUE'],
    [
      { status: 'empty_pool', empechement: { quoi: 'arret_de_notation', code: 'cle_absente' } },
      false,
      'moteur sans clé ⇒ ON REJOUE',
    ],
    [
      { status: 'empty_pool', empechement: { quoi: 'arret_de_notation', code: 'plafond_atteint' } },
      false,
      'plafond de dépense ⇒ ON REJOUE',
    ],
  ]
  for (const [v, attendu, libelle] of cas) {
    ok(ACHEVE(v) === attendu, libelle, `rendu ${ACHEVE(v)}, attendu ${attendu}`)
  }
  ok(
    CODE({ status: 'empty_pool', empechement: { quoi: 'arret_de_notation', code: 'plafond_atteint' } }) ===
      'plafond_atteint',
    'le motif d’un plafond de dépense est NOMMÉ `plafond_atteint`',
    'un motif imprécis ferait chercher une clé absente pendant que le budget est consommé',
  )
  ok(
    CODE({ status: 'no_config' }) === 'reglages_absents',
    '… et celui de réglages absents, `reglages_absents`',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. TOUT APPELANT QUI SOLDE CONSULTE D'ABORD — sur le COMPORTEMENT (§E.34)
   ═══════════════════════════════════════════════════════════════════════════ */
section('1. Personne ne solde une relance sans avoir consulté `runAcheve`')

const appelants = []
for (const f of fichiers) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  if (rel === 'lib/matching/relance.ts') continue
  const net = depouillerJs(readFileSync(f, 'utf8').split('\r\n').join('\n'))
  if (!/\bsolderRelance\s*\(/.test(net)) continue
  appelants.push({
    rel,
    consulte: /\brunAcheve\s*\(/.test(net),
    compte: /\bmarquerTentativeRelance\s*\(/.test(net),
    ditLEchec: /\bechouerRelance\s*\(/.test(net),
  })
}
ok(appelants.length >= 2, `${appelants.length} appelant(s) de \`solderRelance\` trouvé(s)`,
  'moins de deux : le motif ne voit plus le cron ou le chemin direct')
for (const a of appelants) {
  ok(a.consulte, `${a.rel} consulte \`runAcheve\` avant de solder`,
    'il solde inconditionnellement : un run en échec pose le jalon, plus rien ne reprend (§E.27)')
  ok(a.compte, `${a.rel} compte une tentative`,
    'sans compteur, « ne pas solder » est une boucle infinie, payante à chaque passage')
  ok(a.ditLEchec, `${a.rel} enregistre l’échec`,
    'sans trace, l’expert lira « aucune mission » sur une recherche qui n’a pas eu lieu')
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LA BASE — l'échéance TIENT, la file est BORNÉE
   ═══════════════════════════════════════════════════════════════════════════ */
section('2. SQL : l’échéance tient sur un échec, et la file est bornée')

const { fonctions } = rejouerMigrations()
const corps = (nom) => {
  const d = fonctions.get(nom)
  return d ? depouiller(d.corps, { garderBlocs: true }) : null
}

{
  const echouer = corps('echouer_relance_expert')
  ok(!!echouer, '`echouer_relance_expert()` existe')
  ok(
    !!echouer && !/matching_relance_due_at\s*=/.test(echouer),
    '… et elle NE TOUCHE PAS `matching_relance_due_at`',
    'elle efface l’échéance : la relance ne repartira jamais — le défaut, déplacé en base',
  )
  ok(
    !!echouer && /matching_relance_echec_code\s*=/.test(echouer),
    '… et elle enregistre un motif NOMMÉ',
  )

  const file = corps('prochaine_relance_expert')
  ok(!!file, '`prochaine_relance_expert()` existe')
  ok(
    !!file && /matching_relance_tentatives\s*<\s*p_max_tentatives/.test(file),
    '… et elle BORNE la file sur le compteur de tentatives',
    'sans plafond, un run qui échoue en boucle est repris à chaque passage, et payé',
  )

  const solder = corps('solder_relance_expert')
  ok(!!solder, '`solder_relance_expert()` existe')
  ok(
    !!solder && /matching_relance_tentatives\s*=\s*0/.test(solder),
    '… et un run ABOUTI remet le compteur à zéro',
    'sinon quatre pannes en juin fermeraient le plafond en septembre sur un échec sans rapport',
  )
  ok(
    !!solder && /matching_relance_echec_at\s*=\s*null/.test(solder),
    '… et efface le dernier échec',
    'l’écran de l’expert porterait un motif vieux de trois mois',
  )
}

/* ── L'ANCIENNE SIGNATURE NE DOIT PAS SURVIVRE ────────────────────────────
     `create or replace` ne remplace PAS une fonction dont la liste d'arguments
     change : les deux coexisteraient, et un appel à deux arguments résoudrait
     vers l'ANCIENNE — celle sans plafond. Le correctif serait en place, inerte,
     et rien ne le dirait : la résolution se fait au runtime (§E.1). */
{
  const sql = readdirSync(join(ROOT, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => lire(`supabase/migrations/${f}`))
    .join('\n')
  ok(
    /drop\s+function\s+if\s+exists\s+public\.prochaine_relance_expert\s*\(\s*interval\s*,\s*interval\s*\)/i.test(
      sql,
    ),
    'l’ancienne signature à DEUX arguments est explicitement supprimée',
    'les deux coexisteraient, et l’appel existant résoudrait vers celle SANS plafond (§E.1)',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. LES DEUX JUMEAUX DU PLAFOND — ils ne peuvent pas diverger en silence
   ═══════════════════════════════════════════════════════════════════════════ */
section('3. Le plafond vaut la même chose des deux côtés')

{
  const mTs = lire('lib/matching/run-abouti.ts').match(/RELANCE_MAX_TENTATIVES\s*=\s*(\d+)/)
  const file = corps('prochaine_relance_expert') ?? ''
  const mSql = file.match(/p_max_tentatives\s+integer\s+default\s+(\d+)/i)
  const sante = corps('matching_relance_health') ?? ''
  const mSante = sante.match(/matching_relance_tentatives\s*>=\s*(\d+)/)
  ok(!!mTs, '`RELANCE_MAX_TENTATIVES` existe côté TypeScript (module pur)')
  ok(!!mSql, '`p_max_tentatives` a un défaut côté SQL')
  ok(
    !!mTs && !!mSql && mTs[1] === mSql[1],
    `les deux valent ${mTs?.[1] ?? '?'} — jumeaux assumés, vérifiés (§E.20)`,
    `TypeScript ${mTs?.[1]}, SQL ${mSql?.[1]} : l’écran dirait « abandonnée » quand la file reprend encore, ou l’inverse`,
  )
  ok(
    !!mSante && !!mSql && mSante[1] === mSql[1],
    `… et la supervision compte les abandons au même seuil (${mSante?.[1] ?? '?'})`,
    `supervision ${mSante?.[1]}, file ${mSql?.[1]} : deux écrans, deux vérités`,
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. L'EXPERT LE SAIT — et les DEUX voies le disent (§D.14)
   ═══════════════════════════════════════════════════════════════════════════ */
section('4. Un run échoué ne se lit pas « aucune mission »')

{
  const feed = depouillerJs(lire('lib/missions/feed.ts'))
  ok(
    /etatDerniereRecherche\s*\(/.test(feed),
    'le contexte du flux porte l’état de la dernière recherche',
    'sans lui, un flux vide se lit « aucune mission » alors que rien n’a été cherché',
  )
  ok(
    /matching_relance_echec_code/.test(feed),
    '… et il le CHARGE depuis la base',
    'le champ existe, la colonne n’est pas lue : il vaudra toujours `null` (§E.1)',
  )

  const route = depouillerJs(lire('app/api/me/missions/route.ts'))
  const rendus = [...route.matchAll(/expert_status\s*:/g)].length
  const reconstruits = [...route.matchAll(/expert_status\s*:\s*\{/g)].length
  ok(
    rendus >= 2 && reconstruits === 0,
    `les ${rendus} réponses du flux servent le MÊME objet de statut`,
    'une réponse reconstruit son `expert_status` : c’est l’endroit exact où l’état sera oublié (§E.20)',
  )

  // LA PARITÉ : les deux écrans jumeaux, même traitement.
  /* ⚠️ ON ANCRE SUR LE BLOC DE L'ÉTAT VIDE, PAS SUR LA PRÉSENCE DES MOTS (§E.8).
        La première version testait « le fichier contient `derniere_recherche`
        ET `echec_title` ». Une mutation a remplacé la CONDITION du branchement
        par `false` : les deux mots restaient, le bloc devenait mort, et le
        contrôle est resté VERT sur un écran qui écrit à nouveau « aucune
        mission » sur une recherche en panne.

        La propriété est un ORDRE : entre « le flux est vide » et l'état vide
        générique, il doit exister un branchement qui LIT l'état de la dernière
        recherche. Un `false` n'en est pas un. */
  for (const voie of ['freelance', 'cdi']) {
    const page = depouillerJs(lire(`app/[locale]/dashboard/${voie}/missions/page.tsx`))
    const iVide = page.indexOf('missions.length === 0')
    const iGenerique = page.indexOf('empty_title')
    const bloc = iVide >= 0 && iGenerique > iVide ? page.slice(iVide, iGenerique) : ''
    /* ⚠️ ET LA CONDITION, PAS UNE MENTION QUELCONQUE DE LA VARIABLE.
          Deuxième faute du même détecteur : `recherche` apparaît aussi DANS le
          bloc d'échec (`recherche.abandonnee ? … : …`). Exiger « la variable
          est lue quelque part » laissait donc passer une condition remplacée
          par `false` : le bloc devenait inatteignable, la variable restait
          lue, et le contrôle restait vert. On vise la COMPARAISON qui ouvre la
          branche — `etat === 'echec'`, une valeur de l'union fermée
          `IssueDeRecherche`, donc un ancrage qui ne dépend d'aucun nom de
          variable. */
    const branche = /\brecherche\b[\w?.]*\s*===\s*'echec'/.test(bloc)
    const conditionMorte = /[:{(]\s*(true|false)\s*\?/.test(bloc)
    ok(
      branche && !conditionMorte && /echec_title/.test(bloc),
      `l’écran ${voie} BRANCHE sur l’échec avant d’écrire « aucune mission »`,
      !bloc
        ? 'le bloc de l’état vide est introuvable — l’assertion ne vise plus rien (§E.8)'
        : conditionMorte
          ? 'une branche est ouverte par un littéral : le bloc d’échec est INATTEIGNABLE'
          : 'le branchement ne lit plus l’état : une des deux voies perd ce que l’autre a (§E.20)',
    )
  }

  // Les clés, DANS LES QUATRE LANGUES : une clé absente s'affiche brute.
  const CLES = [
    'echec_title',
    'echec_abandonnee',
    'echec_raison.moteur_indisponible',
    'echec_raison.plafond_atteint',
    'echec_raison.reglages_absents',
    'echec_raison.lecture_en_panne',
  ]
  const manquantes = []
  for (const l of LOCALES) {
    const j = JSON.parse(lire(`messages/${l}.json`))
    for (const c of CLES) {
      const v = c.split('.').reduce((o, k) => (o == null ? undefined : o[k]), j.missions?.feed)
      if (typeof v !== 'string' || !v.trim()) manquantes.push(`${l}:${c}`)
    }
  }
  ok(
    manquantes.length === 0,
    `les ${CLES.length} clés d’échec existent dans les 4 langues`,
    manquantes.join(', '),
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. CE QUE CE CONTRÔLE NE VÉRIFIE PAS
   ═══════════════════════════════════════════════════════════════════════════ */
section('Ce que ce contrôle ne vérifie pas')

note('que le SQL COMPILE ni qu’il s’applique. Il lit des fichiers (§E.12) ;')
note('aucun analyseur PostgreSQL n’est disponible et l’appliquer exigerait')
note('d’écrire en base. La migration part à la recette comme les autres.')
note('qu’une relance est RÉELLEMENT rejouée de bout en bout : cela demande un')
note('expert, un run qui échoue, et deux passages du cron. C’est de la recette.')
note('que le TEXTE affiché est juste dans les quatre langues — il vérifie que la')
note('clé existe et n’est pas vide, jamais ce qu’elle dit.')

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} contrôle(s) en échec\n`)
  process.exit(1)
}
console.log('✅ Un run échoué se rejoue, borné — et l’expert le sait.\n')
process.exit(0)
