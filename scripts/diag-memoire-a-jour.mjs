// scripts/diag-memoire-a-jour.mjs — LA MEMOIRE SUIT LE CODE, COMMIT PAR COMMIT.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚠️ CE QUE CE CONTROLE NE PROUVE PAS — A LIRE AVANT DE SE FIER A SON VERT
//
//   IL FORCE LA TRACE, PAS LA VERITE.
//
//   Un vert signifie exactement une chose : « CLAUDE.md a ete touche dans le
//   meme commit que la migration ou la route ajoutee ». Il ne dit RIEN de ce
//   qui y a ete ecrit. Une ligne fausse, une ligne vide, une ligne recopiee
//   d'un resume : le controle est vert dans les trois cas.
//
//   Personne ne doit donc lire ce vert comme « la memoire est a jour ». La
//   justesse d'une entree ne se verifie qu'en relisant le depot, et c'est la
//   regle du fichier lui-meme qui la protege : ce qui n'est pas verifiable
//   dans le depot ne s'ecrit pas, ou se marque NON VERIFIE.
//
//   Un controle qui promettrait la justesse serait pire qu'absent : on
//   cesserait de relire.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE CONTROLE EXISTE
//   CLAUDE.md porte la memoire du projet, et cette memoire n'a de valeur que
//   si elle suit le code. Sans controle, elle ne tient que par la bonne
//   volonte — et la bonne volonte a deja produit trois resumes qui se
//   contredisaient, une panne decrite comme reparee alors qu'elle tournait
//   encore, et trois correctifs refaits parce que personne ne savait qu'ils
//   etaient livres.
//
// QUATRE PARTIS PRIS, chacun repris d'un defaut deja paye dans ce depot
//
//   ① SUR LES AJOUTS SEULEMENT, jamais sur les modifications.
//      Exiger une mise a jour de memoire a chaque `fix` rendrait ce controle
//      rouge en permanence — donc ignore, donc inutile. C'est le raisonnement
//      exact du cliquet de diag-colonnes-supprimees. Ce qui cree de la
//      memoire, c'est une migration nouvelle, une route nouvelle, un
//      diagnostic nouveau : une chose qui n'existait pas et qu'il faudra
//      comprendre dans six mois.
//
//   ② IL NOMME CE QUI MANQUE, il ne dit pas « rouge ».
//      « 20260915_x.sql ajoutee, CLAUDE.md non touche → section B ». Un refus
//      doit dire ce qui bloque ET quoi faire (cf. diag-refus-actionnables).
//
//   ③ TROIS CODES DE SORTIE, comme garde-ecriture.mjs.
//      0 = vert · 1 = manquement · 2 = n'a pas tourne (hors depot git, base
//      introuvable). Confondre 1 et 2 ferait lire une panne d'outillage comme
//      un manquement, et inversement.
//
//   ④ UNE ECHAPPATOIRE NOMMEE, ET TRACEE — pas un contournement.
//      `[memoire:n/a]` EN DEBUT DE LIGNE du message de commit passe le
//      controle. Un controle sans issue legitime se fait desactiver au premier
//      cas limite ; une issue ECRITE DANS LE MESSAGE laisse la decision
//      lisible, datee et attribuee.
//
//      EN DEBUT DE LIGNE, et c'est le fruit d'un defaut immediat : la premiere
//      version cherchait le marqueur n'importe ou dans le corps, et s'est
//      declenchee sur le commit qui introduit ce fichier — dont le message
//      EXPLIQUE l'echappatoire sans la revendiquer. Un commit qui parle de la
//      regle s'en exonerait. On pose un marqueur, on ne le cite pas.
//
// LA REGLE NE VAUT QUE DEPUIS QU'ELLE EXISTE
//   Lance avec `--base` sur de l'historique ANTERIEUR au commit qui a dote
//   CLAUDE.md d'une memoire, ce controle est rouge partout — et c'est exact :
//   ces commits n'ont effectivement laisse aucune trace. Ce n'est pas une
//   dette a rattraper commit par commit, c'est le constat de depart.
//   Choisir une `--base` posterieure a l'introduction de la memoire donne le
//   seul resultat actionnable.
//
// LA GRANULARITE EST LE COMMIT, PAS LA PLAGE
//   La regle dit « dans son propre commit ». Verifier une plage en bloc
//   laisserait ajouter une migration au commit 1 et toucher CLAUDE.md au
//   commit 9 : la trace existerait, mais plus personne ne saurait laquelle
//   decrit quoi. On verifie donc commit par commit.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-memoire-a-jour.mjs                  dernier commit
//   node scripts/diag-memoire-a-jour.mjs --base=origin/main   ce qu'une plage
//                                                            a oublie
//   node scripts/diag-memoire-a-jour.mjs --sections        les chapitres sont
//                                                            tous la
//   node scripts/diag-memoire-a-jour.mjs --base=X --sections
//
// AUCUN acces base, AUCUN reseau, AUCUNE ecriture. Il ne lit que git.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * LA MEMOIRE TIENT EN QUATRE FICHIERS, et n'importe lequel des quatre compte.
 *
 *   CLAUDE.md est charge a chaque session : il ne porte que ce qu'on doit
 *   avoir sous les yeux AVANT d'ecrire (regle de maintenance, §D, §E, §G).
 *   §A/§B/§C/§F/§H vivent dans docs/architecture.md, §P1 a §P4 dans
 *   docs/produit.md.
 *
 *   Exiger CLAUDE.md pour une migration serait faux depuis le decoupage : la
 *   migration s'ecrit en §B, donc dans docs/architecture.md. Ce controle
 *   accepte donc QUE L'UN DES TROIS ait ete touche — se tromper de fichier
 *   n'est pas grave, ne rien ecrire l'est.
 */
// Quatre depuis le 20/09/2026 : les §E ont quitte CLAUDE.md pour docs/pieges.md
// (CLAUDE.md depassait la limite chargee — voir diag-memoire-exacte, section G).
const MEMOIRE = ['CLAUDE.md', 'docs/architecture.md', 'docs/produit.md', 'docs/pieges.md']
const ECHAPPATOIRE = '[memoire:n/a]'

// ─────────────────────────────────────────────────────────────────────────────
// CE QUI CREE DE LA MEMOIRE — et dans quelle section on l'ecrit.
//
// La section est NOMMEE : « mets a jour CLAUDE.md » n'est pas actionnable,
// « section B » l'est. Les libelles suivent les titres du fichier.
// ─────────────────────────────────────────────────────────────────────────────
const DECLENCHEURS = [
  {
    libelle: 'une migration',
    section: 'B (le modele de donnees) — et D si elle fige une decision',
    correspond: (p) => /^supabase\/migrations\/.+\.sql$/.test(p),
  },
  {
    libelle: 'une route API',
    section: 'C (les chaines fonctionnelles)',
    correspond: (p) => /^app\/api\/.+\/route\.ts$/.test(p),
  },
  {
    libelle: 'un diagnostic',
    section: 'E (les pieges verifies) — la regle qu’il garde',
    // Pas de filtre sur le prefixe du nom : un prefixe est une convention, pas
    // une garantie. Meme raisonnement que diag-scripts-destructeurs.
    correspond: (p) => /^scripts\/.+\.(mjs|mts)$/.test(p),
  },
]

// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('--base='))?.slice('--base='.length) ?? null
const verifierSections = args.includes('--sections')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/** Sort en 2 : l'outil n'a pas pu tourner. Ce n'est PAS un manquement. */
function nAPasTourne(raison, quoiFaire) {
  console.log('')
  console.log(`  ${'─'.repeat(72)}`)
  console.log(`  diag-memoire-a-jour — N'A PAS TOURNE`)
  console.log(`  ${'─'.repeat(72)}`)
  console.log(`    ${raison}`)
  if (quoiFaire) console.log(`    ${quoiFaire}`)
  console.log('')
  console.log('    Code 2 : rien n’a ete verifie. Ce n’est pas un controle en echec.')
  console.log('')
  process.exit(2)
}

function git(...a) {
  return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

// ── L'outil peut-il seulement tourner ? ──────────────────────────────────────
try {
  git('rev-parse', '--is-inside-work-tree')
} catch {
  nAPasTourne('Hors depot git : il n’y a aucun commit a examiner.')
}
const absents = MEMOIRE.filter((f) => !existsSync(join(ROOT, f)))
if (absents.length > 0) {
  nAPasTourne(
    `${absents.join(', ')} : introuvable(s). La memoire tient en TROIS fichiers.`,
    'Ce controle garde la memoire du projet : sans le fichier, il n’a pas d’objet.',
  )
}

// ── La plage a examiner ──────────────────────────────────────────────────────
let commits
if (base) {
  try {
    git('rev-parse', '--verify', `${base}^{commit}`)
  } catch {
    nAPasTourne(
      `La reference « ${base} » est introuvable.`,
      'Verifiez le nom de la branche, ou lancez `git fetch` si elle est distante.',
    )
  }
  commits = git('rev-list', '--no-merges', `${base}..HEAD`).split('\n').filter(Boolean)
} else {
  // Defaut : le dernier commit. C'est la maille du geste qu'on garde.
  const tout = git('rev-list', '--no-merges', '-n', '1', 'HEAD').split('\n').filter(Boolean)
  commits = tout
}

section(
  base
    ? `A. Ce que ${commits.length} commit(s) depuis ${base} ont laisse dans la memoire`
    : 'A. Ce que le dernier commit a laisse dans la memoire',
)

if (commits.length === 0) {
  console.log('       Aucun commit a examiner dans cette plage.\n')
}

let concernes = 0
for (const sha of commits) {
  // --diff-filter=A : les AJOUTS seulement (cf. parti pris ①).
  // Un commit de fusion est deja exclu par --no-merges : il n'ajoute rien en
  // propre, et l'y compter denoncerait le travail d'un autre worktree.
  const ajoutes = git('show', '--pretty=format:', '--name-only', '--diff-filter=A', sha)
    .split('\n').map((l) => l.trim()).filter(Boolean)
  const touches = git('show', '--pretty=format:', '--name-only', sha)
    .split('\n').map((l) => l.trim()).filter(Boolean)

  const declenches = []
  for (const f of ajoutes) {
    const d = DECLENCHEURS.find((x) => x.correspond(f))
    if (d) declenches.push({ fichier: f, ...d })
  }
  if (declenches.length === 0) continue
  concernes++

  const sujet = git('log', '-1', '--format=%s', sha).trim()
  const corps = git('log', '-1', '--format=%B', sha)
  const court = sha.slice(0, 7)

  // ORDRE SIGNIFIANT : la mise a jour REELLE prime sur l'echappatoire.
  // L'inverse ferait dire « non documente, assume » d'un commit qui a fait le
  // travail — un compte-rendu faux, dans le sens le plus trompeur.
  const ecrits = MEMOIRE.filter((f) => touches.includes(f))
  if (ecrits.length > 0) {
    ok(true, `${court} — ${declenches.length} ajout(s), ${ecrits.join(' + ')} mis a jour dans le meme commit`)
    continue
  }

  // L'ECHAPPATOIRE SE POSE, ELLE NE SE MENTIONNE PAS.
  //
  //   Premiere version : `corps.includes('[memoire:n/a]')`. Elle s'est
  //   declenchee sur le commit qui introduit CE FICHIER — son message EXPLIQUE
  //   l'echappatoire, il ne la revendique pas. Un commit qui parle de la regle
  //   s'en exonerait donc, et le compte-rendu affirmait « non documente » d'un
  //   commit qui avait mis a jour la memoire.
  //
  //   Meme famille que tout le reste de ce depot : un controle qui lit une
  //   DESCRIPTION au lieu d'un ACTE. Le marqueur doit ouvrir une ligne — la
  //   forme d'un trailer de commit, deliberee et non citee au fil du texte.
  const revendiquee = corps.split('\n').some((l) => l.trimStart().startsWith(ECHAPPATOIRE))
  if (revendiquee) {
    console.log(`  ok   ${court} — ${ECHAPPATOIRE} assume : ${declenches.length} ajout(s) non documente(s)`)
    console.log(`       ${sujet}`)
    continue
  }

  // ON NOMME. Pas « rouge » : ce qui a ete ajoute, et ou ca s'ecrit.
  failures++
  console.log(`  KO   ${court} — ${declenches.length} ajout(s) sans trace dans la memoire`)
  console.log(`       ${sujet}`)
  for (const d of declenches) {
    console.log(`         · ${d.fichier}`)
    console.log(`           ${d.libelle} → a decrire en section ${d.section}`)
  }
  console.log(`       Livrer sans mettre a jour l’un des trois (${MEMOIRE.join(', ')}),`)
  console.log(`       c’est livrer a moitie.`)
  console.log(`       Si c’est deliberement hors memoire : ${ECHAPPATOIRE} dans le message.`)
}

if (concernes === 0 && commits.length > 0) {
  console.log('       Aucun commit n’ajoute de migration, de route ni de diagnostic.')
  console.log('       Rien a documenter : ce controle se tait, et c’est le cas normal.\n')
}

// ── --sections : les chapitres tiennent-ils encore ? ─────────────────────────
if (verifierSections) {
  section('B. Les chapitres de la memoire sont tous la')

  // CE QUE CE CONTROLE GARDE : une reecriture qui perd un chapitre entier le
  // fait savoir. Il ne dit rien du CONTENU — cf. l'avertissement en tete.
  const CHAPITRES = [
    // Le guide de reperage : ou vivent les choses, quels pieges les entourent.
    ['A', 'ce qu’est le produit'],
    ['B', 'le modele de donnees et son histoire'],
    ['C', 'les chaines fonctionnelles'],
    ['D', 'les decisions figees'],
    ['E', 'les pieges verifies'],
    ['F', 'la classe « lire puis ecrire »'],
    ['G', 'les regles entre worktrees'],
    ['H', 'ce qui reste ouvert'],
    // LE PRODUIT. C'est la partie qu'on lit quand on reprend le projet, et
    // c'est donc celle dont la disparition couterait le plus cher.
    ['P1', 'les six parcours de bout en bout'],
    ['P2', 'les ecrans qui existent'],
    ['P3', 'les regles metier rassemblees'],
    ['P4', 'ce qui est volontairement inactif'],
  ]
  // Les trois fichiers concatenes : un chapitre peut vivre dans n'importe
  // lequel, et le decoupage ne doit pas faire rougir ce controle.
  const src = MEMOIRE.map((f) => readFileSync(join(ROOT, f), 'utf8').split('\r\n').join('\n')).join('\n')

  for (const [lettre, quoi] of CHAPITRES) {
    // Le titre, pas une mention : un `## X.` en debut de ligne.
    const present = new RegExp(`^## ${lettre}\\.`, 'm').test(src)
    ok(present, `chapitre ${lettre} — ${quoi}`,
      `le titre « ## ${lettre}. » a disparu : une reecriture a perdu un chapitre entier`)
  }

  // La regle de maintenance elle-meme. Si elle saute, tout le reste s'effrite
  // sans que rien ne le signale — c'est la seule ligne qui fait tenir le fichier.
  ok(/CHAQUE WORKTREE MET À JOUR LA SECTION QUI LE CONCERNE/i.test(src),
    'la regle de maintenance est toujours en tete',
    'sans elle, l’architecte redevient la source unique et les memes oublis reviennent')

  // Et l'avertissement que ce controle ne prouve pas la justesse : il doit
  // vivre DANS le fichier, pas seulement ici.
  ok(/NON VÉRIFIÉ|NON VERIFIE/.test(src),
    'la convention « NON VERIFIE » est toujours en usage',
    'elle est ce qui distingue un fait etabli d’une affirmation reprise : sans elle, tout se lit comme verifie')
}

console.log(
  failures === 0
    ? '\n✔ TOUT VERT — la trace existe. Elle ne prouve pas que ce qui est ecrit est juste.'
    : `\n✘ ${failures} MANQUEMENT(S)`,
)
process.exit(failures === 0 ? 0 : 1)
