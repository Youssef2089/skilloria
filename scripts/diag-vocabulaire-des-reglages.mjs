// scripts/diag-vocabulaire-des-reglages.mjs — QUATRE MOTS, UN PAR COMPORTEMENT.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE CONTROLE
//
//   Trois worktrees ont pose TRENTE-CINQ reglages sur plusieurs semaines. Chacun
//   a ecrit « seuil » parce que c'etait le mot du moment, et personne n'a impose
//   de vocabulaire. Le mot a fini par designer QUATRE COMPORTEMENTS
//   INCOMPATIBLES — ce qui bloque, ce qui alerte, ce qui trie, ce qui juge.
//
//   Resultat : le proprietaire du produit a ouvert /admin/matching et n'a pas su
//   quoi faire. Ce n'est PAS un defaut de code — rien ne plantait, aucun test
//   n'aurait rougi, chaque reglage pris isolement etait juste. C'est ce que
//   produit l'absence de convention quand plusieurs mains ecrivent en parallele.
//
//   Une regle de vocabulaire qui n'est pas gardee redevient une preference. Le
//   prochain lot reecrira « seuil », de bonne foi, parce que c'est le mot qui
//   vient — et on recommencera.
//
// LES QUATRE MOTS (§D.9)
//   PLAFOND il BLOQUE · ALERTE elle SIGNALE · FILTRE il TRIE · NOTE elle JUGE
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// L'EXCEPTION, ET ELLE EST DANS CE FICHIER PARCE QU'ELLE EST DANS LA REGLE
//
//   Les COLONNES gardent leur nom : `feed_threshold`, `notify_threshold`,
//   `confidence_threshold`, `auto_approve_threshold`, `seuil_mensuel_usd`.
//   Les clients Supabase ne sont pas types (§E.1) : une colonne est lue PAR SON
//   NOM, dans une chaine, et un renommage casse au RUNTIME, en silence. Leur
//   renommage est un lot a lui seul. C'est une DECISION, pas un oubli.
//
//   Ce controle garde donc ce qui est VISIBLE — les textes servis a l'ecran —
//   et laisse les identifiants tranquilles. Interdire le mot partout ferait
//   rougir le dépôt sur sa propre exception, et le controle serait desactive le
//   jour meme.
//
//   node scripts/diag-vocabulaire-des-reglages.mjs
//   Aucune base, aucun reseau. 0 = vert · 1 = rouge.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

const LANGUES = ['fr', 'en', 'es', 'de']
/** Le mot interdit, dans les quatre langues du produit. */
const INTERDIT = /seuil|threshold|umbral|schwelle/i

/**
 * LES SEULS TEXTES AUTORISES A PORTER LE MOT, et la raison est la meme pour les
 * deux : ILS CITENT UN NOM DE COLONNE. `/admin/seuils` affiche `confidence_threshold`
 * EN TANT QUE COLONNE, pour dire qu'elle n'est lue par aucun chemin — c'est la
 * propriete la plus precieuse de cet ecran (§P4), et la masquer ferait remplir
 * par quelqu'un qui croirait regler quelque chose.
 *
 * Une entree de plus ici se justifie PAR ECRIT, ou elle n'entre pas (§G.8).
 */
const CITENT_UNE_COLONNE = new Set([
  'admin_seuils.inert_label',
  'admin_seuils.inert_help',
])

// ═══════════════════════════════════════════════════════════════════════════
section('A. Aucun texte servi a l ecran ne dit « seuil »')
// ═══════════════════════════════════════════════════════════════════════════

const cheminsTexte = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [[`${p}${k}`, v]]
      : v && typeof v === 'object' && !Array.isArray(v)
        ? cheminsTexte(v, `${p}${k}.`)
        : [],
  )

for (const langue of LANGUES) {
  const messages = JSON.parse(lire(`messages/${langue}.json`))
  const fautifs = cheminsTexte(messages)
    .filter(([cle, texte]) => INTERDIT.test(texte) && !CITENT_UNE_COLONNE.has(cle))
    .map(([cle]) => cle)
  ok(
    fautifs.length === 0,
    `${langue} : aucun texte interdit`,
    fautifs.join(' · ') +
      '\n       → Quatre mots, un par comportement : PLAFOND il bloque · ALERTE elle signale · ' +
      'FILTRE il trie · NOTE elle juge. Un reglage qui ne rentre dans aucun des quatre SE DIT (§D.9).',
  )
}

// L'exception ne doit pas se perimer en silence : si ces cles disparaissent,
// c'est que l'ecran a change, et la liste doit etre relue.
{
  const messages = JSON.parse(lire('messages/fr.json'))
  const presentes = new Set(cheminsTexte(messages).map(([c]) => c))
  const perimees = [...CITENT_UNE_COLONNE].filter((c) => !presentes.has(c))
  ok(
    perimees.length === 0,
    'aucune exception perimee',
    `${perimees.join(' · ')} — ces cles n'existent plus : retirez-les de la liste plutot que de les laisser autoriser un texte qui n'existe pas`,
  )
}

// ═══════════════════════════════════════════════════════════════════════════
section('B. Les quatre mots sont REELLEMENT employes')
// ═══════════════════════════════════════════════════════════════════════════

//   Une interdiction sans remplacement produit des libelles evasifs : on retire
//   « seuil » et on ecrit « valeur ». Le controle verifie donc aussi que les
//   quatre mots SERVENT, dans la langue de reference.
{
  const fr = JSON.stringify(JSON.parse(lire('messages/fr.json')))
  for (const [mot, motif] of [
    ['PLAFOND', /plafond/i],
    ['ALERTE', /alerte/i],
    ['FILTRE', /filtre/i],
    ['NOTE', /\bnote/i],
  ]) {
    ok(motif.test(fr), `le mot « ${mot} » est employe dans les libelles`,
      'retirer le mot interdit sans poser le mot juste produit des libelles evasifs')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('C. L exception des colonnes est ECRITE, pas sous-entendue')
// ═══════════════════════════════════════════════════════════════════════════

//   Une regle qui ne nomme pas son exception ment au premier `grep` : quelqu'un
//   cherchera « threshold », en trouvera cinq colonnes, et conclura que la regle
//   n'est pas appliquee. La memoire doit porter les deux dans le MEME paragraphe.
for (const [fichier, quoi] of [
  ['CLAUDE.md', '§D.9'],
  ['docs/produit.md', '§P3.0 bis'],
]) {
  const texte = lire(fichier)
  const iRegle = texte.search(/le mot « seuil » est interdit|le mot « seuil » ne s'écrit plus/i)
  ok(iRegle >= 0, `${fichier} (${quoi}) : la regle est ecrite`)
  if (iRegle < 0) continue
  // L'exception doit etre PROCHE de la regle — dans le meme passage, pas dix
  // sections plus loin ou personne ne la rattachera.
  const passage = texte.slice(iRegle, iRegle + 2600)
  ok(
    /colonnes existantes/i.test(passage) && /runtime/i.test(passage),
    `${fichier} : l exception des colonnes est dans le MEME passage que la regle`,
    'separees, la regle se lit comme fausse et l exception comme un oubli',
  )
}

// ═══════════════════════════════════════════════════════════════════════════
section('D. Ce que ce controle ne verifie pas')
// ═══════════════════════════════════════════════════════════════════════════

note('il ne lit PAS les identifiants du code : colonnes, cles i18n et chemins')
note("d'URL gardent leur nom, et c'est la decision de §D.9 — un renommage casse")
note('au runtime, en silence, parce que les clients Supabase ne sont pas types.')
{
  const racines = ['app', 'lib', 'components']
  let n = 0
  const parcourir = (d) => {
    for (const e of readdirSync(join(ROOT, d))) {
      const rel = `${d}/${e}`
      if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
      else if (/\.(ts|tsx)$/.test(e)) n += (lire(rel).match(/threshold/gi) ?? []).length
    }
  }
  for (const r of racines) parcourir(r)
  note(`« threshold » reste cite ${n} fois dans le code : ce sont des colonnes et leurs lectures.`)
}

console.log('')
if (echecs > 0) {
  console.log(`✘ ${echecs} CONTROLE(S) EN ECHEC`)
  process.exit(1)
}
console.log('✅ Quatre mots, un par comportement. L exception est nommee.')
process.exit(0)
