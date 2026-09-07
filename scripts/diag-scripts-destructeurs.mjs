// scripts/diag-scripts-destructeurs.mjs — AUCUN SCRIPT N'ECRIT SANS LE DIRE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le defaut n'etait pas dans quatre scripts, il etait dans leur FAMILLE :
//   sur trente-trois `diag-*.mjs`, vingt-huit ne font que lire et quatre
//   commencent par un `delete`. Rien ne les distingue — meme prefixe, meme
//   forme, meme facon de se lancer. Un worktree s'est fait prendre.
//
//   Corriger les quatre ne suffit pas : le cinquieme sera ecrit demain, par
//   quelqu'un qui n'aura pas lu cette histoire. Ce controle DECOUVRE les
//   scripts qui ecrivent, et exige de chacun la garde par drapeau.
//
//   Trois regressions :
//
//   R1 — un script se met a ecrire sans garde. C'est le cas nominal, et le
//        seul moyen de le voir est de balayer, pas de tenir une liste.
//
//   R2 — la garde existe mais arrive APRES la premiere ecriture. Elle ne
//        garde alors plus rien : le mal est fait avant qu'elle ne parle.
//
//   R3 — le refus sort en code 1. Il se lirait comme un controle en echec,
//        et pousserait quelqu'un a « reparer » en passant le drapeau. Trois
//        etats, trois codes : 0 vert, 1 rouge, 2 n'a pas tourne.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-scripts-destructeurs.mjs
//
// LECTURE PURE : ce script n'ecrit JAMAIS et ne touche JAMAIS la base.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/** Commentaires retires : un verbe d'ecriture CITE ne detruit rien. */
const strip = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/**
 * UN APPEL, PAS UNE CHAINE.
 *
 * Premiere version : `/\.(insert|update|upsert|delete)\s*\(/`. Elle classait
 * diag-abonnement-organisation parmi les scripts qui ecrivent — alors qu'il ne
 * fait que lire. Ce qu'elle attrapait etait `indexOf('.insert(')`, une chaine
 * cherchee dans du code analyse. Un detecteur qui compte les mentions au lieu
 * des appels denonce les innocents, et un controle qui crie a tort finit ignore.
 *
 * Le point d'un vrai appel n'est jamais precede d'un guillemet.
 */
const ECRITURE = /[^'"`]\.\s*(insert|update|upsert|delete)\s*\(/
const GARDE = 'exigerAutorisationEcriture'

section('A. Tout script qui ecrit porte la garde')

const fichiers = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => f.startsWith('diag-') && f.endsWith('.mjs'))
  .sort()

const ecrivains = []
for (const f of fichiers) {
  const code = strip(read(`scripts/${f}`))
  if (!ECRITURE.test(code)) continue
  ecrivains.push(f)
}

// Le compte lui-meme est une information : il doit BOUGER consciemment.
console.log(`       ${ecrivains.length} script(s) sur ${fichiers.length} ecrivent en base :`)
for (const f of ecrivains) console.log(`         ${f}`)
console.log('')

for (const f of ecrivains) {
  const brut = read(`scripts/${f}`)
  const code = strip(brut)

  const iEcriture = code.search(ECRITURE)

  // ⚠️ L'INVARIANT EST « UN DRAPEAU EST LU AVANT D'ECRIRE », PAS « LA GARDE
  //    PARTAGEE EST EN TETE ». La premiere version de ce controle exigeait
  //    `exigerAutorisationEcriture` ; elle denoncait diag-suspension, dont la
  //    conception est POURTANT MEILLEURE : ses controles statiques tournent
  //    sans drapeau, et seules ses ecritures sont gardees. Forcer la garde
  //    partagee en tete lui aurait fait refuser un mode de lecture utile.
  //
  //    Deux formes sont donc admises, et une seule chose est exigee : que la
  //    lecture du drapeau PRECEDE la premiere ecriture.
  const iGarde = code.indexOf(GARDE)
  const iDrapeau = code.search(/process\.argv\.includes\(\s*'--(db|live)'\s*\)/)
  const iAutorisation = [iGarde, iDrapeau].filter((i) => i !== -1).sort((a, b) => a - b)[0] ?? -1

  // R1 — quelque chose gouverne l'ecriture.
  //
  // ⚠️ L'APPEL NE SUFFIT PAS : IL FAUT AUSSI L'IMPORT. Chercher le seul nom
  //    `exigerAutorisationEcriture` laissait passer la suppression de la ligne
  //    d'import — le script gardait l'appel, restait vert au controle, et
  //    plantait a l'execution sur un identifiant inconnu. Un script qui plante
  //    n'ecrit pas, certes ; mais le controle disait « garde posee » alors
  //    qu'il n'y avait plus de garde.
  const importeGarde = /import\(\s*'\.\/garde-ecriture\.mjs'\s*\)/.test(code)
  ok(iAutorisation !== -1 && (iGarde === -1 || importeGarde),
    `${f} — une autorisation explicite gouverne l’ecriture`,
    iGarde !== -1 && !importeGarde
      ? 'la garde est appelee mais jamais importee : le script plante au lieu de garder'
      : 'garde partagee, ou lecture directe de --db/--live : sans l’une des deux, le script part seul')
  if (iAutorisation === -1) continue

  // R2 — elle arrive AVANT la premiere ecriture.
  ok(iAutorisation < iEcriture, `${f} — l’autorisation precede la premiere ecriture`,
    'posee apres, elle parle quand le mal est deja fait')

  // Ceux qui passent par la garde partagee en respectent le contrat.
  if (iGarde !== -1) {
    const iClient = code.indexOf('createClient(')
    ok(iClient === -1 || iGarde < iClient, `${f} — la garde precede l’ouverture du client`,
      'rien ne doit etre ouvert tant que l’autorisation n’est pas donnee')
    ok(/ecrit:\s*\[/.test(code), `${f} — la garde enumere ce qui serait ecrit`,
      'une garde muette laisse deviner ce qu’on s’apprete a detruire')
  }
}

section('B. Le refus se distingue d’un echec')

const g = read('scripts/garde-ecriture.mjs')
const gCode = strip(g)
// R3 — code 2, pas 1.
ok(/process\.exit\(2\)/.test(gCode), 'le refus sort en code 2 (« n’a pas tourne »)',
  'sortir en 1 ferait lire un refus prudent comme une regression a reparer')
ok(!/process\.exit\(1\)/.test(gCode), 'la garde ne sort JAMAIS en code 1')
ok(/--db/.test(gCode) && /--live/.test(gCode),
  'les drapeaux acceptes sont ceux deja en usage (--db, --live)',
  'inventer un troisieme drapeau ferait une famille de plus a connaitre')

// La garde n'est pas un diagnostic : elle ne doit pas etre balayee comme tel.
ok(!fichiers.includes('garde-ecriture.mjs'),
  'la garde elle-meme n’est pas nommee diag-*',
  'elle ne porte aucun controle : un lanceur qui l’execute compterait un faux resultat')

// UNE SEULE implementation. Quatre copies divergeraient, et celle qui prend du
// retard laisserait passer exactement ce qu'on corrige ici.
const copies = ecrivains.filter((f) => /DRAPEAUX\s*=/.test(strip(read(`scripts/${f}`))))
ok(copies.length === 0, 'aucun script ne recopie la garde',
  copies.length ? `copies : ${copies.join(', ')}` : undefined)

console.log(failures === 0 ? '\n✔ TOUT VERT' : `\n✘ ${failures} CONTROLE(S) EN ECHEC`)
process.exit(failures === 0 ? 0 : 1)
