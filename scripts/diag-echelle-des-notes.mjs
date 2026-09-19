// scripts/diag-echelle-des-notes.mjs — UNE SEULE ECHELLE, ET UNE SEULE
//                                      CONVERSION.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE CONTROLE
//
//   Les filtres de pertinence vivaient en 0-1, les notes de jugement en 0-10, et
//   RIEN ne le disait a l'ecran. « 1 » signifiait PARFAIT d'un cote et MEDIOCRE
//   de l'autre, sur la meme page. Le proprietaire du produit a ouvert
//   /admin/matching et n'a pas su quoi faire — c'est le seul verdict qui compte.
//
//   Le produit n'a plus qu'UNE echelle : 0 a 10. Le reranker, lui, produit du
//   0-1 par nature, et on ne change pas ce qu'il produit : sa sortie est
//   multipliee par 10 AU SEUL POINT ou un score entre dans le systeme.
//
//   CE QUE CE CONTROLE DEFEND, C'EST L'UNICITE DE CETTE CONVERSION. Un second
//   `* 10` ou `/ 10` pose ailleurs — a l'affichage, dans une route, dans une
//   comparaison — rouvre la DOUBLE REPRESENTATION que ce lot ferme, et c'est la
//   classe de defaut du sprint. Le pire est qu'il ne casse rien : il rend un
//   nombre plausible et faux.
//
//   ET LA MIGRATION EST DU TYPE QUE RIEN N'ATTRAPE. `diag-migration-donnees` ne
//   valide que les INSERT litteraux : il ne voit pas un UPDATE. Sans ce
//   controle, la migration de conversion est dans l'etat exact de §E.12 —
//   livree sans avoir ete jouee, et decouverte par celui qui met en production.
//
// CE QU'IL VERIFIE
//   (A) LA CONVERSION EST UNIQUE, et elle est a la frontiere du fournisseur.
//   (B) LE SCHEMA dit 0-10 — reconstruit DEPUIS LES MIGRATIONS, sans base.
//   (C) LA MIGRATION EST IDEMPOTENTE SUR UN FAIT DE SCHEMA, pas sur les valeurs.
//   (D) AUCUNE BORNE 0-1 RESIDUELLE la ou une note 0-10 est attendue.
//   (E) L'ESTAMPILLE d'echelle est ECRITE par le moteur ET LUE par la lecture.
//   (F) LA REPARTITION porte sur TOUS les notes, pas sur ceux qui passent.
//
// CE QU'IL NE VERIFIE PAS, ET IL LE DIT
//   Il ne lit AUCUNE base : il ne peut pas dire que les valeurs ont ete
//   converties en production. Ce que la migration fait, c'est la migration qui
//   le prouve — elle compte, et elle LEVE si une note sort de [0,10].
//
//   node scripts/diag-echelle-des-notes.mjs
//   Aucune base, aucun reseau. 0 = vert · 1 = rouge · 2 = n'a pas tourne.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Fins de ligne NORMALISEES (§E.3). */
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const existe = (p) => existsSync(join(ROOT, p))

/**
 * Retire les commentaires SANS PERDRE DE LIGNES. Ce lot DECRIT abondamment la
 * conversion pour expliquer pourquoi elle est unique : un balayage du texte brut
 * se declencherait sur sa propre explication (§E.7).
 */
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (l.trimStart().startsWith('//') || l.trimStart().startsWith('*') ? '' : l))
    .join('\n')

const sansCommentairesSql = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

// ─── LE BALAYAGE : app/ + lib/ + components/ ────────────────────────────────
const RACINES = ['app', 'lib', 'components']
const sources = []
const parcourir = (d) => {
  for (const e of readdirSync(join(ROOT, d))) {
    const rel = `${d}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
    else if (/\.(ts|tsx)$/.test(e)) sources.push(rel)
  }
}
for (const r of RACINES) parcourir(r)

const FRONTIERE = 'lib/matching/rerank.ts'
const MIGRATION = 'supabase/migrations/20260919000000_echelle_des_notes.sql'

// ═══════════════════════════════════════════════════════════════════════════
section('A. La conversion est UNIQUE, et elle est a la frontiere')
// ═══════════════════════════════════════════════════════════════════════════

ok(existe(FRONTIERE), `${FRONTIERE} existe`)

const frontiere = sansCommentaires(lire(FRONTIERE))
ok(
  /Math\.max\(0,\s*Math\.min\(1,\s*s\)\)\s*\*\s*10/.test(frontiere),
  'la frontiere borne le score du fournisseur PUIS le multiplie par 10',
  "sans la borne AVANT, un score hors [0,1] deviendrait hors [0,10] et ferait echouer tout le lot d'ecriture",
)

/**
 * TOUTE AUTRE CONVERSION D'ECHELLE SUR UNE NOTE.
 *
 * ⚠️ SIX FAUX POSITIFS TROUVES EN L'EXECUTANT, ET ILS DISENT CE QUI COMPTE.
 *    Le premier motif cherchait un facteur 10 a portee des mots « score »,
 *    « note », « filtre ». Il a denonce six emplacements, tous legitimes :
 *      · `{Math.round(r.verification_score)}/10` — le « /10 » est du TEXTE
 *        affiche a l'ecran, pas une division ;
 *      · `Math.round(it.score * 10) / 10` — l'idiome d'arrondi a une decimale ;
 *      · `(scoreSum / scoreN) * 10` — un pourcentage, sur une autre grandeur.
 *
 *    Un controle qui crie a tort est desactive le jour meme. Trois regles en
 *    sortent, et elles suivent §E.17 : ce qui compte est la PROVENANCE, pas le
 *    nom.
 *      ① les identifiants EXACTS du moteur sont surveilles PARTOUT ;
 *      ② les mots generiques ne le sont que DANS la chaine de mise en relation,
 *        seul endroit ou une note de pertinence circule ;
 *      ③ l'idiome d'arrondi est exclu, nommement.
 */
const IDENTIFIANTS_MOTEUR = '(?:relevance_score|feed_threshold|notify_threshold)'
const MOTS_GENERIQUES = '(?:\\bscore\\b|\\bnote\\b|\\bnotes\\b)'
const FACTEUR = '(?:\\*\\s*10\\b|\\/\\s*10\\b|\\*\\s*0\\.1\\b)'

/** Ou une note de PERTINENCE circule reellement. */
const CHAINE_PERTINENCE = (f) =>
  f.startsWith('lib/matching/') ||
  f === 'app/api/admin/matching-settings/route.ts' ||
  f.startsWith('app/[locale]/admin/matching')

/**
 * ⚠️ LE GROUPE NON CAPTURANT N'EST PAS DECORATIF — TROISIEME FAUX POSITIF.
 *    Sans lui, `mots` valant « A|B » se melangeait a l'alternation du motif :
 *      A|B[^\n;]{0,40}?FACTEUR|FACTEUR[^\n;]{0,40}?A|B
 *    dont la PREMIERE branche est « A » tout court. Le controle denoncait alors
 *    toute ligne contenant `feed_threshold`, facteur 10 ou pas — huit lignes
 *    d'une route parfaitement saine. Une precedence oubliee dans une regex ne
 *    se voit pas en relisant : elle se voit en l'executant.
 */
const motif = (mots) =>
  new RegExp(`(?:${mots})[^\\n;]{0,40}?${FACTEUR}|${FACTEUR}[^\\n;]{0,40}?(?:${mots})`, 'i')

/** L'idiome d'arrondi a une decimale — jamais une conversion d'echelle. */
const ARRONDI = /\*\s*10\s*\)\s*\/\s*10\b/

const convertisseurs = []
for (const f of sources) {
  if (f === FRONTIERE) continue
  const re = motif(CHAINE_PERTINENCE(f) ? `${IDENTIFIANTS_MOTEUR}|${MOTS_GENERIQUES}` : IDENTIFIANTS_MOTEUR)
  const code = sansCommentaires(lire(f))
  for (const ligne of code.split('\n')) {
    if (ARRONDI.test(ligne)) continue
    if (re.test(ligne)) convertisseurs.push(`${f} → ${ligne.trim().slice(0, 90)}`)
  }
}
ok(
  convertisseurs.length === 0,
  'aucune SECONDE conversion d echelle sur une note, nulle part',
  convertisseurs.join('\n       · ') +
    '\n       → Une conversion d unite se pose a la frontiere du systeme externe, ' +
    'et nulle part ailleurs. Un second facteur 10 ne casse rien : il rend un nombre plausible et faux.',
)

// ═══════════════════════════════════════════════════════════════════════════
section('B. Le schema dit 0-10 — reconstruit depuis les migrations')
// ═══════════════════════════════════════════════════════════════════════════

ok(existe(MIGRATION), `${MIGRATION} existe`)
const migration = existe(MIGRATION) ? sansCommentairesSql(lire(MIGRATION)) : ''

/** Toutes les migrations, dans l'ordre : la derniere contrainte posee gagne. */
const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
const sqlTotal = migrations
  .map((f) => sansCommentairesSql(lire(`supabase/migrations/${f}`)))
  .join('\n')

const CIBLES = [
  ['matches_relevance_score_range_check', 'relevance_score', 'la note d un couple (annonce, profil)'],
  ['matching_settings_filtre_flux_check', 'feed_threshold', 'le filtre du flux'],
  ['matching_settings_filtre_notification_check', 'notify_threshold', 'le filtre de notification'],
]
for (const [contrainte, colonne, quoi] of CIBLES) {
  // ⚠️ LA DERNIERE POSEE GAGNE, ET MA PREMIERE VERSION PRENAIT LA PREMIERE.
  //    `matches_relevance_score_range_check` existe dans DEUX migrations : celle
  //    de 2026-09-01 qui la posait a [0,1], et celle-ci qui la repose a [0,10].
  //    Un `exec` simple rendait l'ancienne, et le controle rougissait sur un
  //    schema pourtant juste. Trouve en l'executant, comme les six faux
  //    positifs ci-dessus — pas en relisant.
  const re = new RegExp(
    `constraint\\s+${contrainte}[\\s\\S]{0,200}?check\\s*\\(([\\s\\S]{0,220}?)\\)\\s*(?:\\$c\\$|;|\\n)`,
    'gi',
  )
  const toutes = [...sqlTotal.matchAll(re)]
  const m = toutes.length > 0 ? toutes[toutes.length - 1] : null
  ok(!!m, `${quoi} : la contrainte ${contrainte} est posee`, 'sans elle, rien ne borne la nouvelle echelle')
  if (!m) continue
  const corps = m[1].replace(/\s+/g, ' ')
  ok(
    new RegExp(`${colonne}\\s*<=\\s*10\\b`).test(corps),
    `${quoi} : borne haute a 10`,
    `lu : ${corps.slice(0, 120)}`,
  )
  ok(
    !new RegExp(`${colonne}\\s*<=\\s*1\\s*[^0-9]`).test(corps + ' '),
    `${quoi} : plus aucune borne a 1`,
    `lu : ${corps.slice(0, 120)}`,
  )
}

// Les anciennes contraintes 0-1 doivent avoir ete RETIREES, pas laissees.
for (const ancienne of ['matching_settings_feed_range_check', 'matching_settings_notify_range_check']) {
  ok(
    new RegExp(`drop constraint if exists ${ancienne}`, 'i').test(migration),
    `l ancienne contrainte ${ancienne} est explicitement retiree`,
    'une contrainte 0-1 laissee en place ferait echouer toute ecriture sur la nouvelle echelle',
  )
}

// ═══════════════════════════════════════════════════════════════════════════
section('C. L idempotence ne repose pas sur les VALEURS')
// ═══════════════════════════════════════════════════════════════════════════

//   LE PIEGE, ET JE SUIS TOMBE DEDANS EN ECRIVANT CETTE MIGRATION : garder la
//   conversion par `where relevance_score <= 1` parait juste — « ne convertis
//   que ce qui est encore en 0-1 ». C'est faux : une note de 0.1 devient 1.0,
//   et un rejeu la multiplierait UNE SECONDE FOIS. Une garde batie sur les
//   valeurs ne peut pas distinguer un avant d un apres quand les deux domaines
//   se chevauchent.
ok(
  /select exists \([\s\S]{0,200}?pg_constraint[\s\S]{0,200}?matching_settings_filtre_flux_check/i.test(migration),
  'la garde d idempotence lit un FAIT DE SCHEMA (existence de la contrainte cible)',
  'sans elle, un rejeu multiplierait une seconde fois',
)
ok(
  !/update public\.matches[\s\S]{0,200}?where[\s\S]{0,120}?relevance_score\s*<=\s*1\b/i.test(migration),
  'la conversion n est PAS gardee par une comparaison de valeur',
  'une note de 0.1 convertie vaut 1.0 : un rejeu la reconvertirait a 10',
)
ok(
  /notify_threshold\s*<=\s*0\.1/.test(migration) && /raise exception/i.test(migration),
  'la migration REFUSE quand la fenetre avant deploiement serait muette',
  "converti, un filtre de notification <= 0.1 reste dans [0,1] : l ancien code l accepte au lieu de refuser, et filtre dix fois trop large en silence",
)
ok(
  /delete from public\.matching_notes_partielles/i.test(migration),
  'le brouillon de notes est vide (il ne porte AUCUNE echelle)',
  'une note ecrite avant la bascule et reprise apres melangerait les deux echelles dans le meme run',
)

// ═══════════════════════════════════════════════════════════════════════════
section('D. Aucune borne 0-1 residuelle la ou une note est attendue')
// ═══════════════════════════════════════════════════════════════════════════

const REGLAGES = 'lib/matching/settings.ts'
const ROUTE = 'app/api/admin/matching-settings/route.ts'

const reglages = sansCommentaires(lire(REGLAGES))
ok(
  /feed\s*>\s*10\b/.test(reglages) && /notify\s*>\s*10\b/.test(reglages),
  `${REGLAGES} : les deux filtres sont bornes a 10`,
)
ok(
  !/feed\s*>\s*1\s*\|\||notify\s*>\s*1\s*\)/.test(reglages),
  `${REGLAGES} : plus aucune borne a 1`,
  'un refus a 1 ferait echouer tout run des la premiere note au-dessus de 1',
)

const route = sansCommentaires(lire(ROUTE))
for (const champ of ['feed_threshold', 'notify_threshold']) {
  ok(
    new RegExp(`nombreDansBornes\\(body\\.${champ}, 0, 10\\)`).test(route),
    `${ROUTE} : ${champ} valide sur [0,10]`,
    'le serveur est la garde ; une borne restee a 1 refuserait toute valeur utile',
  )
}

// ═══════════════════════════════════════════════════════════════════════════
section('E. L estampille est ECRITE, et elle est LUE')
// ═══════════════════════════════════════════════════════════════════════════

const moteur = sansCommentaires(lire('lib/matching/index.ts'))

/**
 * ⚠️ COMPTER NE SUFFIT PAS — TROUVE PAR MUTATION (§G.5), ET C'EST §E.8.
 *    Ma premiere version exigeait « au moins deux `echelle: 10` » dans le
 *    fichier. Or il y en a TROIS : les deux points de sortie, PLUS la
 *    declaration du type. Retirer l'estampille d'un point de sortie en laissait
 *    deux, et le controle restait VERT sur la moitie des runs devenus
 *    illisibles. Une assertion doit etre ANCREE SUR LE BLOC qu'elle vise, pas
 *    lachee sur le fichier.
 */
const blocsDeTrace = [...moteur.matchAll(/construireTrace\(\{([\s\S]{0,1400}?)\n\s*\}\)/g)]
ok(
  blocsDeTrace.length >= 2,
  `les deux points de sortie du run sont bien trouves (${blocsDeTrace.length})`,
  'le run sans matiere et le run complet ecrivent chacun une trace ; si ce motif ne les voit plus, ce controle ne garde plus rien',
)
const sansEstampille = blocsDeTrace.filter((b) => !/echelle:\s*10\b/.test(b[1])).length
ok(
  blocsDeTrace.length >= 2 && sansEstampille === 0,
  'CHAQUE trace ecrite porte l estampille d echelle',
  `${sansEstampille} trace(s) sans estampille — les runs correspondants seraient invisibles a la lecture, qui ne prend que les runs estampilles`,
)
ok(
  /matching_stats->>'echelle'\)?\s*=\s*'10'/.test(migration),
  'la lecture ne prend QUE les runs estampilles',
  "sans ce filtre, les runs d avant la bascule (0-1) seraient moyennes avec les nouveaux (0-10) : un nombre juste sous une etiquette fausse (§E.24)",
)

// ═══════════════════════════════════════════════════════════════════════════
section('F. La repartition porte sur TOUS les notes')
// ═══════════════════════════════════════════════════════════════════════════

//   Batie sur les seuls profils RETENUS, elle ne saurait pas dire ce qu un
//   filtre PLUS BAS laisserait entrer — c est-a-dire la question meme qu on
//   pose en reglant. L assertion est ANCREE sur l expression (§E.8) : chercher
//   « repartition » n importe ou dans le fichier attraperait le commentaire.
ok(
  /repartition:\s*\n?\s*notation\.scores\.size > 0 \? repartitionParTranche\(notation\.scores\.values\(\)\)/.test(
    moteur,
  ),
  'la repartition est construite sur `notation.scores` (tous les notes)',
  "construite sur `scores` (les retenus), elle ne repondrait pas a « et si je descendais a 4 ? »",
)
ok(
  /const tranches = new Array<number>\(10\)\.fill\(0\)/.test(moteur) &&
    /Math\.min\(9, Math\.max\(0, Math\.floor\(n\)\)\)/.test(moteur),
  'dix tranches, et une note de 10 pile tombe dans la derniere',
  'sans le plafond a 9, un 10 creerait une onzieme tranche que personne ne lit',
)
ok(
  /repartition'->>\(i - 1\)/.test(migration) && /generate_series\(1, 10\)/.test(migration),
  'la lecture agrege bien les dix tranches',
)

// ═══════════════════════════════════════════════════════════════════════════
section('G. Ce que ce controle ne verifie pas')
// ═══════════════════════════════════════════════════════════════════════════

note('il ne lit AUCUNE base : il ne peut pas dire que les valeurs sont converties')
note('en production. C est la migration qui le prouve — elle compte les notes et')
note('elle LEVE si l une sort de [0,10] apres conversion.')
note(`${sources.length} fichier(s) balayes (${RACINES.join(' + ')}).`)

console.log('')
if (echecs > 0) {
  console.log(`✘ ${echecs} CONTROLE(S) EN ECHEC`)
  process.exit(1)
}
console.log('✅ Une seule echelle, une seule conversion, et elle est a la frontiere.')
process.exit(0)
