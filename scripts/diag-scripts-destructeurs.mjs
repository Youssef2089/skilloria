// scripts/diag-scripts-destructeurs.mjs — AUCUN SCRIPT N'ECRIT SANS LE DIRE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le defaut n'etait pas dans quatre scripts, il etait dans leur FAMILLE :
//   l'inoffensif et le destructeur ont le meme prefixe, la meme forme, la meme
//   facon de se lancer. Un worktree s'est fait prendre.
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
// CE QUI A CHANGE, ET POURQUOI TROIS SCRIPTS SONT PASSES AU TRAVERS
//
//   ① LE BALAYAGE NE REGARDAIT QUE `diag-*.mjs`.
//      Trois ecrivains vivaient juste a cote — cleanup-test-data.mjs (des
//      suppressions IRREVERSIBLES), verify-test-profile-once.mjs,
//      backfill-matching-experts.mts — et aucun ne portait de garde.
//      Le controle etait vert. Il regardait ailleurs.
//
//      UN PREFIXE EST UNE CONVENTION, PAS UNE GARANTIE. Filtrer sur `diag-`
//      revenait a demander a un script de se denoncer par son nom. Le balayage
//      couvre desormais TOUT `scripts/*.mjs` et `scripts/*.mts`.
//
//   ② LA DETECTION NE VOYAIT QUE LES ECRITURES DIRECTES.
//      C'est le point important, et il n'aurait pas ete corrige en elargissant
//      le seul filtre de noms : verify-test-profile-once et backfill-matching-
//      experts ne contiennent AUCUN `.insert(`, `.update(` ni `.delete(`.
//      Ils ecrivent en appelant du code applicatif —
//      `runExpertVerification()` ecrit sur `profiles` et `users`,
//      `runMatchingForExpert()` ecrit `matches` et `notifications`.
//
//      Un detecteur qui cherche des VERBES dans le fichier les declare
//      inoffensifs. On SUIT donc les imports : un script qui importe un module
//      applicatif qui ecrit, ecrit. La chaine est resolue jusqu'a une
//      profondeur bornee, et le controle NOMME le module fautif — sans quoi
//      « ce script ecrit » serait une affirmation qu'on ne peut pas verifier.
//
//   ③ LA REGLE D'ORDRE S'ADAPTE A CE QU'ELLE GARDE.
//      Pour un ecrivain DIRECT, ouvrir le client est deja le prelude a
//      l'ecriture : la garde doit le preceder.
//      Pour un ecrivain INDIRECT, le client sert souvent a un mode de LECTURE
//      legitime (`--dry-run` de backfill lit la base et n'ecrit rien). Exiger
//      la garde avant le client interdirait ce mode utile, et un controle qui
//      interdit le bon usage finit contourne. Ce qui est exige, pour eux,
//      c'est que la garde precede l'IMPORT DU MODULE QUI ECRIT.
//      Meme raisonnement que pour diag-suspension (cf. plus bas) : on garde
//      les ECRITURES, pas la mise en route.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-scripts-destructeurs.mjs
//
// LECTURE PURE : ce script n'ecrit JAMAIS et ne touche JAMAIS la base.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative, sep } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES. Le depot sort les fichiers en CRLF, et un retour
// chariot casse tout motif qui traverse un saut de ligne — le diagnostic
// virerait au rouge sur une copie fraiche sans qu'aucun code n'ait change.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const readAbs = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/**
 * Commentaires retires : un verbe d'ecriture CITE ne detruit rien.
 *
 * ⚠️ L'ORDRE N'EST PAS UN DETAIL DE STYLE — IL DECIDE DE CE QUE LE CONTROLE VOIT.
 *
 *   La version d'origine retirait les blocs `/* … *\/` AVANT les lignes `//`.
 *   Consequence : un commentaire de LIGNE qui contient la suite `/` + `*` —
 *   ecrire un chemin en `scripts/` suivi d'une etoile suffit — ouvre un FAUX
 *   bloc, que le depouilleur referme sur le prochain `*` + `/` rencontre,
 *   c'est-a-dire a la fin d'un JSDoc situe des dizaines de lignes plus bas.
 *   Tout le code intermediaire disparait AVANT analyse.
 *
 *   Mesure faite sur le depot : ce fichier perdait 832 caracteres, dont la
 *   declaration meme de son perimetre de balayage ; `diag-ecosystem-scope` en
 *   perdait 952 ; et `app/api/conversations/[id]/messages/route.ts` — analyse
 *   par plusieurs controles de securite — en perdait 1575.
 *
 *   Rien ne se plaint. Le controle reste VERT, sur un texte amoindri. C'est la
 *   meme famille que tout le reste de ce fichier : un controle qui regarde
 *   ailleurs et qu'on croit satisfait.
 *
 *   Les LIGNES d'abord, les BLOCS ensuite : un `/*` vivant dans un `//` part
 *   avec la ligne qui le porte, et n'ouvre plus rien.
 */
const strip = (src) =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '')

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
const VERBE = /[^'"`]\.\s*(insert|update|upsert|delete)\s*\(/

/**
 * UNE ECRITURE EN BASE, PAS UN VERBE HOMONYME.
 *
 * `VERBE` seul denonce des innocents, et ce diagnostic l'a fait des sa premiere
 * execution elargie : il a classe diag-idempotence-catalogue parmi les scripts
 * qui ecrivent, « via lib/billing/idempotence.ts ». Or ce module n'importe que
 * `node:crypto` et ne touche AUCUNE table. Ce qui matchait etait
 *
 *     crypto.createHash('sha256').update(brut, 'utf8')
 *
 * `.update(` sur un condensat. Le meme piege, exactement, que celui contre
 * lequel l'auteur d'origine avait deja durci le motif — il l'avait ferme sur
 * les CHAINES, il restait ouvert sur les HOMONYMES.
 *
 * Le discriminant : une ecriture Supabase descend TOUJOURS d'un `.from('table')`.
 * On exige donc le verbe DANS LE SILLAGE d'un `.from(`, pas n'importe ou dans
 * le fichier. La fenetre couvre les deux formes reelles du depot — tout sur une
 * ligne (`.from('notifications').delete({…})`) et le chainage indente sur
 * plusieurs lignes — sans s'etendre au point d'attraper le module voisin.
 *
 * ⚠️ DEUX FONCTIONS NOMMEES, ET SURTOUT PAS UN OBJET `{ test, search }`.
 *    J'ai d'abord ecrit cet objet pour qu'il s'utilise comme une regex. Il se
 *    lit bien et il est FAUX : `code.search(obj)` n'appelle pas `obj.search`,
 *    il coerce l'objet en `new RegExp('[object Object]')` — une classe de
 *    caracteres qui matche des le premier caractere du fichier. Les trois
 *    scripts deja verts sont passes au rouge et l'ont dit. Une conversion
 *    implicite ne leve rien : elle rend un resultat plausible.
 */
const FENETRE_CHAINE = 300

/** Ce code ecrit-il en base ? */
function ecritEnBase(code) {
  return positionPremiereEcriture(code) !== -1
}

/** Ou commence la premiere ecriture en base, ou -1. */
function positionPremiereEcriture(code) {
  const from = /[^'"`]\.\s*from\s*\(\s*['"`]/g
  let m
  while ((m = from.exec(code))) {
    const suite = code.slice(m.index, m.index + FENETRE_CHAINE)
    const rel = suite.search(VERBE)
    if (rel !== -1) return m.index + rel
  }
  return -1
}

const GARDE = 'exigerAutorisationEcriture'

/**
 * UN AUXILIAIRE N'EST PAS UN SCRIPT, ET ON NE LE RECONNAIT PAS A SON NOM.
 *
 * `_diag-utils.mjs` insere puis supprime une publication ephemere : il ECRIT,
 * le detecteur a raison. Mais il ne se lance pas — il recoit `supabaseAdmin` en
 * PARAMETRE et n'ouvre aucun client. Lui demander une garde par drapeau n'aurait
 * aucun sens : il n'a pas de ligne de commande, et c'est son APPELANT qui doit
 * etre garde (ils le sont).
 *
 * Le critere n'est donc pas le prefixe `_` — une convention, pas une garantie,
 * exactement ce que ce diagnostic reproche a l'ancien filtre `diag-`. Le critere
 * est VERIFIABLE : un module qui n'obtient pas ses propres identifiants ne peut
 * rien ecrire de son propre chef. Ouvrir un client ou lire `.env.local`, c'est
 * cela, etre un script.
 */
function estExecutable(code) {
  return /createClient\s*\(/.test(code) || /\.env\.local/.test(code)
}

/** La garde n'est pas un diagnostic et n'est pas un ecrivain : elle est l'outil. */
const OUTIL = 'garde-ecriture.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// SUIVRE L'IMPORT — le seul moyen de voir une ecriture indirecte
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les specifiers d'import LOCAUX d'une source, statiques comme dynamiques.
 * On ignore les paquets (`@supabase/...`, `node:fs`) : ils ne sont pas dans le
 * depot, on ne peut rien en dire, et les suivre ferait exploser le balayage.
 */
function importsLocaux(code) {
  const out = []
  const motifs = [
    /\bfrom\s+'([^']+)'/g,          // import … from '…'
    /\bimport\s*\(\s*'([^']+)'\s*\)/g, // await import('…')
  ]
  for (const re of motifs) {
    let m
    while ((m = re.exec(code))) {
      const spec = m[1]
      if (spec.startsWith('.') || spec.startsWith('@/')) out.push(spec)
    }
  }
  return out
}

/**
 * Resout un specifier vers un fichier reel du depot, ou null.
 *
 * Les scripts ecrivent `'../lib/matching/index'` (sans extension),
 * `'../lib/verification/expert-verification.ts'` (avec), et l'applicatif
 * utilise l'alias `'@/lib/...'`. Les trois formes doivent aboutir, sinon la
 * chaine se coupe en silence et le script est declare inoffensif par DEFAUT
 * DE RESOLUTION — l'echec le plus trompeur qui soit.
 */
function resoudre(spec, depuis) {
  const base = spec.startsWith('@/')
    ? join(ROOT, spec.slice(2))
    : resolve(dirname(depuis), spec)
  const essais = [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, `${base}.js`,
    join(base, 'index.ts'), join(base, 'index.tsx'), join(base, 'index.mts'),
    join(base, 'index.mjs'), join(base, 'index.js'),
  ]
  for (const e of essais) {
    // `existsSync` rend `true` sur un DOSSIER : `../lib/matching` existe, et
    // l'accepter ferait lire un repertoire comme un fichier. On exige donc un
    // fichier regulier, pas une simple existence.
    if (existsSync(e) && statSync(e).isFile()) return e
  }
  return null
}

/**
 * Le premier module de la chaine d'imports qui ecrit DIRECTEMENT, ou null.
 *
 * Profondeur bornee et memoire des visites : une chaine applicative se referme
 * souvent sur elle-meme, et un parcours non borne ne finirait pas. La
 * profondeur 4 couvre `script -> lib/x/index -> lib/x/module -> lib/y` — au-dela
 * on sort du voisinage direct et le lien de causalite devient trop lache pour
 * qu'on accuse le script.
 */
const PROFONDEUR_MAX = 4
function moduleQuiEcrit(fichierAbs, profondeur = 0, vus = new Set()) {
  if (profondeur > PROFONDEUR_MAX) return null
  if (vus.has(fichierAbs)) return null
  vus.add(fichierAbs)

  let code
  try {
    code = strip(readAbs(fichierAbs))
  } catch {
    return null
  }

  // A la profondeur 0 on est dans le script lui-meme : ses ecritures directes
  // sont traitees ailleurs, ce parcours ne cherche que l'INDIRECT.
  if (profondeur > 0 && ecritEnBase(code)) {
    return relative(ROOT, fichierAbs).split(sep).join('/')
  }

  for (const spec of importsLocaux(code)) {
    const cible = resoudre(spec, fichierAbs)
    if (!cible) continue
    const trouve = moduleQuiEcrit(cible, profondeur + 1, vus)
    if (trouve) return trouve
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────

section('A. Tout script qui ecrit porte la garde')

// TOUT scripts/*.mjs et *.mts — plus aucun filtre sur le prefixe du nom.
const fichiers = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => f.endsWith('.mjs') || f.endsWith('.mts'))
  .filter((f) => f !== OUTIL)
  .sort()

/** @type {{ fichier: string, direct: boolean, via: string | null }[]} */
const ecrivains = []
/** Ecrivains qui ne sont pas executables : auxiliaires, gardes par leur appelant. */
const auxiliaires = []
for (const f of fichiers) {
  const code = strip(read(`scripts/${f}`))
  const direct = ecritEnBase(code)
  const via = direct ? null : moduleQuiEcrit(join(ROOT, 'scripts', f))
  if (!direct && !via) continue
  if (!estExecutable(code)) { auxiliaires.push(f); continue }
  ecrivains.push({ fichier: f, direct, via })
}

// Le compte lui-meme est une information : il doit BOUGER consciemment.
console.log(`       ${ecrivains.length} script(s) sur ${fichiers.length} ecrivent en base :`)
for (const e of ecrivains) {
  console.log(`         ${e.fichier}${e.direct ? '' : `   (indirectement, via ${e.via})`}`)
}
if (auxiliaires.length) {
  console.log('')
  console.log(`       ${auxiliaires.length} auxiliaire(s) ecrivent mais n’ouvrent aucun client —`)
  console.log('       gardes par leur appelant, pas par un drapeau qu’ils n’ont pas :')
  for (const f of auxiliaires) console.log(`         ${f}`)
}
console.log('')

for (const { fichier: f, direct, via } of ecrivains) {
  const code = strip(read(`scripts/${f}`))

  // OU COMMENCE LE MAL — et ce n'est pas au meme endroit selon le cas.
  //   direct   : la premiere instruction d'ecriture.
  //   indirect : l'import du module qui ecrit. Rien avant lui ne peut ecrire.
  const iEcriture = direct
    ? positionPremiereEcriture(code)
    : (() => {
        // On vise l'import qui MENE au module fautif, pas n'importe lequel.
        for (const spec of importsLocaux(code)) {
          const cible = resoudre(spec, join(ROOT, 'scripts', f))
          if (cible && moduleQuiEcrit(cible, 1, new Set())) {
            const i = code.indexOf(spec)
            if (i !== -1) return i
          }
          // Le module cible peut etre lui-meme l'ecrivain direct.
          if (cible && via && relative(ROOT, cible).split(sep).join('/') === via) {
            const i = code.indexOf(spec)
            if (i !== -1) return i
          }
        }
        return -1
      })()

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
  // DEUX FORMES D'IMPORT, ET LES DEUX SONT LEGITIMES.
  //   Cette regex ne reconnaissait que la forme DYNAMIQUE
  //   (`await import('./garde-ecriture.mjs')`). Elle a denonce
  //   admin-organisations-orphelines.mjs, arrive par une fusion du tronc, qui
  //   importe la garde en STATIQUE — et dont la conception est POURTANT
  //   MEILLEURE : un import statique manquant fait echouer le chargement du
  //   module, avant la moindre ligne. La forme dynamique, elle, ne se plaint
  //   qu'a l'execution de la ligne.
  //
  //   Un detecteur qui denonce la meilleure des deux formes est un detecteur
  //   qu'on desactive. On accepte les deux, et on n'exige qu'une chose : que la
  //   garde soit REELLEMENT importee de quelque part.
  const importeGarde =
    /import\(\s*'\.\/garde-ecriture\.mjs'\s*\)/.test(code) ||
    /import\s*\{[^}]*\bexigerAutorisationEcriture\b[^}]*\}\s*from\s*'\.\/garde-ecriture\.mjs'/.test(code)
  ok(iAutorisation !== -1 && (iGarde === -1 || importeGarde),
    `${f} — une autorisation explicite gouverne l’ecriture`,
    iGarde !== -1 && !importeGarde
      ? 'la garde est appelee mais jamais importee : le script plante au lieu de garder'
      : `garde partagee, ou lecture directe de --db/--live : sans l’une des deux, le script part seul${
          via ? ` (il ecrit via ${via})` : ''
        }`)
  if (iAutorisation === -1) continue

  // R2 — elle arrive AVANT la premiere ecriture.
  if (iEcriture === -1) {
    // On sait que le script ecrit, mais on n'a pas su dire OU. On le DIT :
    // se taire ferait passer l'ignorance pour un controle reussi.
    ok(false, `${f} — le point de premiere ecriture est localisable`,
      'le script ecrit mais l’endroit n’a pas ete resolu : l’ordre de la garde n’est pas verifiable')
  } else {
    ok(iAutorisation < iEcriture, `${f} — l’autorisation precede la premiere ecriture`,
      direct
        ? 'posee apres, elle parle quand le mal est deja fait'
        : `posee apres l’import de ${via}, elle parle quand le module qui ecrit est deja charge`)
  }

  // Ceux qui passent par la garde partagee en respectent le contrat.
  if (iGarde !== -1) {
    // ORDRE DU CLIENT : exige des ECRIVAINS DIRECTS seulement.
    //  Pour eux, ouvrir le client est deja le prelude a l'ecriture.
    //  Pour un ecrivain INDIRECT, le client sert au mode de LECTURE (le
    //  `--dry-run` de backfill lit la base et n'ecrit rien) : exiger la garde
    //  avant lui interdirait ce mode, et un controle qui interdit le bon usage
    //  finit contourne. Ce qu'on garde, ce sont les ECRITURES.
    if (direct) {
      const iClient = code.indexOf('createClient(')
      ok(iClient === -1 || iGarde < iClient, `${f} — la garde precede l’ouverture du client`,
        'rien ne doit etre ouvert tant que l’autorisation n’est pas donnee')
    }
    ok(/ecrit:\s*\[/.test(code), `${f} — la garde enumere ce qui serait ecrit`,
      'une garde muette laisse deviner ce qu’on s’apprete a detruire')
  }
}

section('B. Le refus se distingue d’un echec')

const g = read(`scripts/${OUTIL}`)
const gCode = strip(g)
// R3 — code 2, pas 1.
ok(/process\.exit\(2\)/.test(gCode), 'le refus sort en code 2 (« n’a pas tourne »)',
  'sortir en 1 ferait lire un refus prudent comme une regression a reparer')
ok(!/process\.exit\(1\)/.test(gCode), 'la garde ne sort JAMAIS en code 1')
ok(/--db/.test(gCode) && /--live/.test(gCode),
  'les drapeaux acceptes sont ceux deja en usage (--db, --live)',
  'inventer un troisieme drapeau ferait une famille de plus a connaitre')

// La garde n'est pas un diagnostic : elle ne doit pas etre balayee comme tel.
ok(!g.startsWith('// scripts/diag-'),
  'la garde elle-meme n’est pas nommee diag-*',
  'elle ne porte aucun controle : un lanceur qui l’execute compterait un faux resultat')

// UNE SEULE implementation. Quatre copies divergeraient, et celle qui prend du
// retard laisserait passer exactement ce qu'on corrige ici.
const copies = ecrivains
  .map((e) => e.fichier)
  .filter((f) => /DRAPEAUX\s*=/.test(strip(read(`scripts/${f}`))))
ok(copies.length === 0, 'aucun script ne recopie la garde',
  copies.length ? `copies : ${copies.join(', ')}` : undefined)

section('C. Le balayage lui-meme ne se retrecit pas')

// LE DEFAUT QUI A LAISSE PASSER TROIS SCRIPTS EST ICI, ET NULLE PART AILLEURS.
// Il ne se voyait pas parce que le controle etait vert : il regardait ailleurs.
// On garde donc le PERIMETRE sous controle, comme on garde les scripts.
const tousMjsMts = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => f.endsWith('.mjs') || f.endsWith('.mts'))
ok(fichiers.length === tousMjsMts.length - 1,
  `le balayage couvre tous les scripts (.mjs + .mts), sauf l’outil — ${fichiers.length} fichier(s)`,
  'un filtre de nom reintroduirait l’angle mort qui a coute trois scripts non gardes')
ok(!/startsWith\('diag-'\)/.test(strip(read('scripts/diag-scripts-destructeurs.mjs'))),
  'aucun filtre sur le prefixe du nom',
  'un prefixe est une convention, pas une garantie : filtrer dessus revient a demander au script de se denoncer')
ok(fichiers.some((f) => f.endsWith('.mts')),
  'les scripts .mts sont dans le perimetre',
  'backfill-matching-experts.mts ecrit en base et n’etait balaye par rien')

section('D. Le depouilleur ne mange pas le code qu’il doit montrer')

// CE CONTROLE EXISTE PARCE QUE LE DEFAUT S'EST PRODUIT ICI, ET N'A RIEN DIT.
// Retirer les blocs avant les lignes faisait d'un `//` contenant `/` + `*` un
// ouvrant de bloc, qui avalait le code jusqu'au prochain fermant. Le balayage
// tournait alors sur un texte ampute, et restait VERT.
//
// On l'eprouve donc EN L'EXECUTANT sur des cas construits, plutot qu'en relisant
// l'ordre des deux `replace` — un ordre se relit juste et se reintroduit a la
// premiere reecriture.
{
  const ETOILE = '*' // assemble, pour que ces cas ne se piegent pas eux-memes
  const cas = [
    {
      libelle: 'un // contenant une etoile de chemin n’ouvre pas de bloc',
      source: `// balaie scripts/${ETOILE}.mjs\nconst garde = 1\n/${ETOILE}* doc ${ETOILE}/\nconst apres = 2`,
      doitGarder: ['const garde = 1', 'const apres = 2'],
    },
    {
      libelle: 'un vrai bloc de documentation est bien retire',
      source: `/${ETOILE}${ETOILE} doc ${ETOILE}/\nconst code = 3`,
      doitGarder: ['const code = 3'],
      doitPerdre: ['doc'],
    },
    {
      libelle: 'un // ordinaire est retire sans emporter la suite',
      source: `const avant = 4 // explication\nconst apres = 5`,
      doitGarder: ['const avant = 4', 'const apres = 5'],
      doitPerdre: ['explication'],
    },
  ]
  for (const c of cas) {
    const out = strip(c.source)
    const garde = (c.doitGarder ?? []).every((x) => out.includes(x))
    const perdu = (c.doitPerdre ?? []).every((x) => !out.includes(x))
    ok(garde && perdu, c.libelle,
      !garde ? 'du code a disparu avant analyse : le balayage tournerait sur un texte ampute'
             : 'un commentaire a survecu : un verbe CITE serait lu comme un appel')
  }
}

// Et la mesure sur le depot reel : aucun fichier analyse ne doit perdre de code.
// C'est le controle qui aurait attrape le defaut d'origine, et il porte sur les
// SOURCES REELLES, pas sur des cas construits.
{
  const blocDAbord = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const perdants = []
  for (const f of fichiers) {
    const s = read(`scripts/${f}`)
    if (strip(s).length > blocDAbord(s).length) perdants.push(`${f} (+${strip(s).length - blocDAbord(s).length})`)
  }
  ok(perdants.length > 0,
    `le depouilleur corrige rend plus de code que l’ancien — ${perdants.length} script(s) concerne(s)`,
    'si plus AUCUN script n’est concerne, ce controle ne prouve plus rien : le supprimer ou le reancrer')
  if (perdants.length) console.log(`       ${perdants.join(', ')}`)
}

console.log(failures === 0 ? '\n✔ TOUT VERT' : `\n✘ ${failures} CONTROLE(S) EN ECHEC`)
process.exit(failures === 0 ? 0 : 1)
