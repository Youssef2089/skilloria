// scripts/diag-controles-a-rejouer.mjs — QUELS CONTROLES LE LOT EN COURS DOIT-IL REJOUER ?
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE DEFAUT QU'ON FERME — ET IL EST ARRIVE
//
//   Le lot « les sept points de depense » a ete livre (246c592) avec
//   `diag-moteur-reranking` AU ROUGE. Il ancrait `enregistrerDepense(` ; le lot
//   avait renomme l'appel en `enregistrerDepenseIA(`. Aucun defaut reel — mais
//   un controle rouge livre, donc un controle qu'on apprend a ignorer.
//
//   POURQUOI PERSONNE NE L'A VU : les diagnostics avaient ete choisis DE
//   MEMOIRE, quatre sur soixante-dix, ceux qu'on avait en tete. Le depot ne
//   disait nulle part lesquels LISENT les fichiers qu'on vient de modifier.
//
//   « Lancer les bons diagnostics » etait donc une affaire de vigilance. Ce
//   fichier en fait une affaire de commande.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMMENT IL DECIDE
//
//   ① Les fichiers du lot = `git diff --name-only <base>` + les non suivis.
//   ② Un diagnostic est CONCERNE s'il cite l'un de ces chemins litteralement.
//   ③ Un diagnostic qui BALAIE un dossier (readdirSync sur app/, lib/,
//      supabase/migrations/, messages/) ne cite aucun chemin : il est concerne
//      des qu'un fichier de ce dossier bouge. Sans cette regle, les controles
//      de CLASSE — justement ceux qui attrapent le cas non prevu — ne seraient
//      jamais proposes.
//
//   Ce script ne remplace pas le jugement : il enleve l'oubli.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-controles-a-rejouer.mjs             (liste ET rejoue)
//   node scripts/diag-controles-a-rejouer.mjs --lister    (liste seulement)
//   node scripts/diag-controles-a-rejouer.mjs --base HEAD~1
//
// AUCUN acces base, AUCUN reseau. Il n'ECRIT jamais — il lit et il execute
// d'autres diagnostics, lesquels sont eux-memes en lecture seule.

import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES (§E.3) : le depot sort en CRLF.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

const argv = process.argv.slice(2)
const lireOption = (nom, defaut) => {
  const i = argv.indexOf(nom)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : defaut
}
const BASE = lireOption('--base', 'HEAD')
const LISTER_SEULEMENT = argv.includes('--lister')

// `stderr` ignore : sur Windows, git avertit a chaque fichier que « LF sera
// remplace par CRLF ». Onze lignes de bruit avant chaque verdict, et le verdict
// finit par ne plus se voir.
const git = (...a) =>
  execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\r\n')
    .join('\n')
    .trim()

// ─────────────────────────────────────────────────────────────────────────────
// ① LES FICHIERS DU LOT
// ─────────────────────────────────────────────────────────────────────────────
let modifies = []
try {
  const suivis = git('diff', '--name-only', BASE)
  const nonSuivis = git('ls-files', '--others', '--exclude-standard')
  modifies = [...suivis.split('\n'), ...nonSuivis.split('\n')].map((s) => s.trim()).filter(Boolean)
} catch (err) {
  console.error(`impossible de lire les fichiers modifies depuis « ${BASE} » : ${err.message}`)
  process.exit(2)
}

if (modifies.length === 0) {
  console.log(`\nAucun fichier modifie depuis ${BASE} — rien a rejouer.\n`)
  process.exit(0)
}

console.log(`\n═══ Les ${modifies.length} fichier(s) du lot (depuis ${BASE}) ═══\n`)
for (const f of modifies) console.log(`  ${f}`)

// ─────────────────────────────────────────────────────────────────────────────
// ② et ③ LES DIAGNOSTICS CONCERNES
// ─────────────────────────────────────────────────────────────────────────────
const DIAGS = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => f.startsWith('diag-') && f.endsWith('.mjs'))
  // Ne se propose pas lui-meme : il ne controle rien du produit.
  .filter((f) => f !== 'diag-controles-a-rejouer.mjs')
  .sort()

/** Les dossiers qu'un diagnostic peut BALAYER plutot que citer fichier par fichier. */
const DOSSIERS_BALAYES = ['app', 'lib', 'supabase/migrations', 'messages', 'scripts']

const concernes = []
for (const d of DIAGS) {
  const src = read('scripts/' + d)
  const raisons = []

  for (const f of modifies) {
    if (src.includes(f)) raisons.push(`cite ${f}`)
  }

  // Un controle de CLASSE ne cite personne : il decouvre. Il est donc concerne
  // des qu'un fichier du dossier qu'il balaie bouge — c'est exactement le cas
  // ou il a le plus de chances d'attraper quelque chose.
  if (/readdirSync\s*\(/.test(src)) {
    for (const dossier of DOSSIERS_BALAYES) {
      if (!src.includes(`'${dossier}`) && !src.includes(`"${dossier}`)) continue
      const touche = modifies.filter((f) => f.startsWith(dossier + '/'))
      if (touche.length > 0) raisons.push(`balaie ${dossier}/ (${touche.length} fichier(s))`)
    }
  }

  if (raisons.length > 0) concernes.push({ diag: d, raisons: [...new Set(raisons)] })
}

console.log(`\n═══ ${concernes.length} diagnostic(s) a rejouer ═══\n`)
if (concernes.length === 0) {
  console.log('  Aucun. Verifiez que ce lot ne merite VRAIMENT aucun controle.\n')
  process.exit(0)
}
for (const c of concernes) {
  console.log(`  ${c.diag}`)
  for (const r of c.raisons.slice(0, 3)) console.log(`       ← ${r}`)
}

if (LISTER_SEULEMENT) {
  console.log('\n(--lister : rien n a ete rejoue)\n')
  process.exit(0)
}

// ─────────────────────────────────────────────────────────────────────────────
// ON LES REJOUE — car un diagnostic qu'on se contente de NOMMER n'est pas joue.
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n═══ Rejeu ═══\n`)
const rouges = []
for (const c of concernes) {
  let sortie = ''
  let code = 0
  try {
    sortie = execFileSync(process.execPath, [join(ROOT, 'scripts', c.diag)], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
    })
  } catch (err) {
    code = typeof err.status === 'number' ? err.status : 1
    sortie = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  // Certains diagnostics rendent 0 en imprimant un echec : on lit les DEUX.
  const dit = sortie.split('\r\n').join('\n')
  const rouge =
    code !== 0 ||
    /✘|❌|CONTROLE\(S\) EN ECHEC|contrôle\(s\) en échec|controle\(s\) en echec/.test(dit)
  const derniere = dit.trim().split('\n').filter(Boolean).pop() ?? '(aucune sortie)'
  console.log(`  ${rouge ? 'ROUGE' : 'vert '}  ${c.diag.padEnd(34)} ${derniere.slice(0, 80)}`)
  if (rouge) rouges.push({ diag: c.diag, dit })
}

if (rouges.length > 0) {
  console.log(`\n═══ Le detail des ${rouges.length} diagnostic(s) rouge(s) ═══`)
  for (const r of rouges) {
    console.log(`\n── ${r.diag}`)
    for (const l of r.dit.split('\n')) {
      if (/KO|✘|❌|→/.test(l)) console.log(l)
    }
  }
}

console.log(
  rouges.length === 0
    ? `\n✔ TOUT VERT — ${concernes.length} diagnostic(s) rejoue(s) sur les fichiers du lot`
    : `\n✘ ${rouges.length} DIAGNOSTIC(S) ROUGE(S) — le lot ne doit pas etre livre en l etat`,
)
process.exit(rouges.length === 0 ? 0 : 1)
