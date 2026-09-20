// scripts/diag-memoire-exacte.mjs — LA MEMOIRE DIT-ELLE CE QUE LE CODE FAIT ?
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE DEFAUT QU'ON FERME
//
//   La memoire du projet a ete relue ligne a ligne contre le code le
//   16/09/2026. DIX-HUIT affirmations etaient fausses ou perimees (§M1) :
//   un seuil de 9 qui valait 7, une colonne inerte non signalee, dix-huit
//   tables absentes d'un inventaire qui se lit comme exhaustif, six garanties
//   de concurrence manquantes, un ecran documente qui n'existe pas, un ecran
//   livre qui manquait, et trois chiffres vieillis.
//
//   AUCUN N'ETAIT UN MENSONGE. Chacun etait vrai le jour ou il a ete ecrit.
//   C'est ce qui les rend dangereux : ils se citent, et rien ne dit depuis
//   quand ils n'ont pas ete verifies.
//
//   `diag-memoire-a-jour` force la TRACE — que le fichier ait ete touche.
//   Celui-ci verifie une partie du CONTENU. Les deux sont complementaires, et
//   aucun des deux ne promet la justesse de la prose.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'IL VERIFIE — et pourquoi CES quatre familles, pas d'autres
//
//   A. LES LIENS. Un lien mort envoie chercher un fichier qui n'existe pas.
//   B. LES ECRANS, DANS LES DEUX SENS. Un ecran documente qui n'existe pas
//      (le cas `/admin/ecosystemes/[id]`) fait perdre une heure ; un ecran
//      livre et non documente (le cas `/admin/durees`) n'existe pour personne.
//   C. LES TABLES, DANS LES DEUX SENS. Un inventaire incomplet se lit comme
//      exhaustif — c'est ainsi que `branches` et `specialities`, citees dans
//      39 fichiers, ont manque a la liste des tables.
//   D. LES CHIFFRES COMPTABLES. « en tete de 32 scripts », « 438 fichiers »,
//      « 51 migrations » : trois nombres justes a leur date, faux ensuite, et
//      que personne ne recompte jamais a la main.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'IL NE VERIFIE PAS — dit, plutot que tu
//
//   · La PROSE. Aucun controle ne peut dire si une explication est juste.
//   · Les ecrans PUBLICS (§P2.1) : leurs chemins sont trop varies pour etre
//     derives sans inventer des faux positifs, et un controle qui crie a tort
//     est desactive le jour meme.
//   · Les valeurs qui vivent EN BASE (seuils, offres, plafonds). Elles exigent
//     une base ; ce script n'en veut aucune, exactement pour la raison de
//     §E.12 : un controle qui exige une base ne tournera pas.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-memoire-exacte.mjs
//
// AUCUN acces base, AUCUN reseau. LECTURE PURE : ce script n'ecrit JAMAIS.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES (§E.3).
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const existe = (p) => existsSync(join(ROOT, p))

let echecs = 0
const ok = (cond, libelle, indice) => {
  if (cond) console.log(`  ok   ${libelle}`)
  else { echecs++; console.log(`  KO   ${libelle}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

// ─────────────────────────────────────────────────────────────────────────────
// LES FICHIERS DE MEMOIRE. Le decoupage en trois est prevu ; on lit ce qui est
// present, pour que ce controle survive au decoupage sans etre retouche.
// ─────────────────────────────────────────────────────────────────────────────
const CANDIDATS = ['CLAUDE.md', 'docs/produit.md', 'docs/architecture.md']
const DOCS = CANDIDATS.filter(existe)
const MEMOIRE = DOCS.map(read).join('\n')

console.log(`\nLA MEMOIRE, RELUE CONTRE LE CODE\n`)
console.log(`  fichier(s) de memoire : ${DOCS.join(', ')}\n`)

// ═════════════════════════════════════════════════════════════════════════════
section('A. Chaque lien de la memoire mene quelque part')
// ═════════════════════════════════════════════════════════════════════════════

{
  const morts = []
  let total = 0
  for (const d of DOCS) {
    // RESOLUTION RELATIVE AU FICHIER QUI PORTE LE LIEN, et non a la racine.
    //   Depuis le decoupage en trois, `docs/produit.md` pointe vers
    //   `../CLAUDE.md` et `architecture.md` : resolus depuis la racine, ces
    //   liens PARFAITEMENT VALIDES etaient declares morts. Six faux positifs
    //   au premier essai — exactement ce qui fait desactiver un controle.
    const dossier = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : ''
    for (const m of read(d).matchAll(/\]\(([^)\s]+)\)/g)) {
      const brut = m[1]
      if (brut.startsWith('http') || brut.startsWith('#')) continue
      total++
      const chemin = brut.split('#')[0]
      if (!chemin) continue
      const resolu = join(dossier, chemin).split('\\').join('/')
      if (!existe(resolu)) morts.push(`${d} → ${brut}`)
    }
  }
  console.log(`       ${total} lien(s) interne(s).\n`)
  ok(morts.length === 0, 'aucun lien interne ne pointe dans le vide', morts.join(' · '))
}

// ═════════════════════════════════════════════════════════════════════════════
section('B. Les ecrans documentes existent, et les ecrans livres sont documentes')
// ═════════════════════════════════════════════════════════════════════════════

/** Les pages reellement livrees sous une racine, en chemins relatifs. */
function pagesSous(racine) {
  const out = []
  if (!existe(racine)) return out
  const pile = [racine]
  while (pile.length) {
    const d = pile.pop()
    for (const e of readdirSync(join(ROOT, d))) {
      const rel = `${d}/${e}`
      if (statSync(join(ROOT, rel)).isDirectory()) pile.push(rel)
      else if (e === 'page.tsx') {
        const chemin = d.slice(racine.length).replace(/^\//, '')
        out.push(chemin === '' ? '(index)' : chemin)
      }
    }
  }
  return out
}

/**
 * Les chemins CITES dans un bloc de tableau : on ne lit que la PREMIERE
 * cellule de chaque ligne, et seulement ce qui est entre accents graves. Lire
 * la ligne entiere ramasserait les noms de fichiers des descriptions, et un
 * controle qui crie a tort finit desactive.
 */
function citesDansBloc(debut, fin, prefixe) {
  const i = MEMOIRE.indexOf(debut)
  const j = fin ? MEMOIRE.indexOf(fin, i + 1) : MEMOIRE.length
  if (i < 0) return null
  const bloc = MEMOIRE.slice(i, j < 0 ? MEMOIRE.length : j)
  const out = new Set()
  for (const ligne of bloc.split('\n')) {
    if (!ligne.startsWith('|')) continue
    const cellule = ligne.split('|')[1] ?? ''
    if (/^\s*(Écran|Ecran|---)/.test(cellule)) continue
    for (const m of cellule.matchAll(/`([^`]+)`/g)) {
      let t = m[1].trim()
      if (!t) continue
      t = t.replace(prefixe, '').replace(/^\//, '')
      out.add(t === '' ? '(index)' : t)
    }
    if (/\*\(index\)\*/.test(cellule)) out.add('(index)')
  }
  return out
}

const SURFACES = [
  {
    nom: 'administration',
    racine: 'app/[locale]/admin',
    debut: '### P2.4 — Administration',
    fin: '\n---',
    prefixe: /^\/admin\/?/,
  },
  {
    nom: 'organisation',
    racine: 'app/[locale]/dashboard/entreprise',
    debut: '### P2.3 — Organisation',
    fin: '### P2.4',
    prefixe: /^\/dashboard\/entreprise\/?/,
  },
  {
    nom: 'expert freelance',
    racine: 'app/[locale]/dashboard/freelance',
    debut: '### P2.2 — Expert freelance',
    fin: '### P2.3',
    prefixe: /^\/dashboard\/(freelance|cdi)\/?/,
  },
  {
    nom: 'expert CDI',
    racine: 'app/[locale]/dashboard/cdi',
    debut: '### P2.2 — Expert freelance',
    fin: '### P2.3',
    prefixe: /^\/dashboard\/(freelance|cdi)\/?/,
  },
]

for (const s of SURFACES) {
  const cites = citesDansBloc(s.debut, s.fin, s.prefixe)
  if (cites === null) { ok(false, `${s.nom} : bloc §P2 introuvable`, s.debut); continue }
  const livres = new Set(pagesSous(s.racine))

  // ① Un ecran DOCUMENTE qui n'existe pas envoie chercher un fichier absent.
  const fantomes = [...cites].filter((c) => !livres.has(c))
  ok(fantomes.length === 0,
    `${s.nom} : aucun ecran documente n'est introuvable`,
    fantomes.map((f) => `${s.racine}/${f}`).join(' · '))

  // ② Un ecran LIVRE et non documente n'existe pour personne.
  const muets = [...livres].filter((l) => !cites.has(l))
  ok(muets.length === 0,
    `${s.nom} : les ${livres.size} ecran(s) livre(s) sont tous documente(s)`,
    muets.join(' · '))
}

// ═════════════════════════════════════════════════════════════════════════════
section('C. Les tables de la base et l’inventaire de la memoire se repondent')
// ═════════════════════════════════════════════════════════════════════════════

{
  // Le schema vient des MIGRATIONS, pas d'une base : meme raison qu'en §E.12,
  // un controle qui exige une base ne tournera pas.
  const creees = new Set()
  const supprimees = new Set()
  for (const f of readdirSync(join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = read('supabase/migrations/' + f)
    // ANCRÉ EN DÉBUT DE LIGNE, et la forme du dump acceptée.
    //   Le premier motif cherchait `public.x` ou `x` — il ratait
    //   `"public"."x"`, la forme que `pg_dump` écrit et que la baseline porte
    //   sur ses 80 tables. Il trouvait 20 tables sur 64.
    //   Et il n'était pas ancré : `command_tag IN ('CREATE TABLE AS', …)`,
    //   une CHAÎNE dans un corps de fonction, lui faisait déclarer une table
    //   nommée « AS ». Un détecteur qui invente une table n'est pas un
    //   détecteur, c'est une source de bruit.
    const NOM = String.raw`(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`
    const CREATE = new RegExp(String.raw`^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?` + NOM, 'gim')
    const DROP = new RegExp(String.raw`^\s*drop\s+table\s+(?:if\s+exists\s+)?` + NOM, 'gim')
    for (const m of sql.matchAll(CREATE)) creees.add(m[1])
    for (const m of sql.matchAll(DROP)) supprimees.add(m[1])
  }
  // Les tables de sauvegarde du dump de baseline sont creees puis supprimees
  // par la migration suivante : elles n'ont jamais existe pour le produit.
  const vivantes = [...creees].filter((t) => !supprimees.has(t) && !/^_backup_/.test(t))

  console.log(`       ${vivantes.length} table(s) vivante(s) reconstruite(s) depuis les migrations.\n`)

  // ANCRE SUR L'INVENTAIRE, ET SUR LUI SEUL.
  //   Premiere version : « citee au moins une fois dans la memoire ». Elle ne
  //   MORDAIT PAS, et la mutation l'a montre — `branches` retiree de §B.1
  //   restait verte, parce qu'elle est mentionnee en prose dans §P1.1. Ce
  //   controle n'aurait donc PAS attrape le defaut d'origine : les dix-huit
  //   tables manquantes etaient, pour plusieurs, citees ailleurs.
  //   Ce qu'on defend, c'est l'INVENTAIRE — celui qui se lit comme exhaustif.
  const bloc = MEMOIRE.slice(MEMOIRE.indexOf('### B.1'), MEMOIRE.indexOf('### B.2'))

  // ET SEULEMENT LES LIGNES D'INVENTAIRE, PAS LA PROSE DU BLOC.
  //   Deuxieme mutation ratee, et c'est encore §E.7 : `branches` figure DEUX
  //   fois dans §B.1 — dans la liste, et dans la note qui explique pourquoi
  //   elle y manquait. La retirer de la LISTE laissait le controle vert, la
  //   note suffisant a la « citer ». On ne garde donc que les paragraphes
  //   d'inventaire, ceux qui s'ouvrent sur « **Groupe** — ».
  //   Le motif retenu : un paragraphe qui S'OUVRE sur du gras. Il couvre les
  //   deux formes presentes (« **Groupe** — liste » et « **Groupe — TITRE.** »)
  //   et exclut la prose, qui vit en citation (« > … »).
  const inventaire = bloc
    .split('\n\n')
    .filter((para) => para.trimStart().startsWith('**'))
    .join('\n')
  const citee = (t) => inventaire.includes('`' + t + '`')
  const absentes = vivantes.filter((t) => !citee(t))
  ok(absentes.length === 0,
    'chaque table vivante figure dans l’inventaire §B.1',
    absentes.join(', ') + ' — un inventaire incomplet se lit comme exhaustif')

  // Sens inverse : une table citee qu'aucune migration ne cree est un fantome.
  const citeesB1 = [...bloc.matchAll(/`([a-z_][a-z0-9_]*)`/g)].map((m) => m[1])
  const fantomes = [...new Set(citeesB1)].filter((t) => !creees.has(t))
  ok(fantomes.length === 0,
    'aucune table citee en §B.1 n’est introuvable dans les migrations',
    fantomes.join(', '))
}

// ═════════════════════════════════════════════════════════════════════════════
section('D. Les chiffres comptables de la memoire sont a jour')
// ═════════════════════════════════════════════════════════════════════════════

/** Le nombre que la memoire annonce, derriere une amorce donnee. */
function nombreAnnonce(amorce) {
  const re = new RegExp(amorce.source + String.raw`\s*\*\*(\d[\d  ]*)\*\*`)
  const m = MEMOIRE.match(re)
  return m ? Number(m[1].replace(/[^\d]/g, '')) : null
}

/*
 * CE QU'ON NE CONTROLE PAS ICI, ET POURQUOI — c'est la partie utile.
 *
 *   « 51 scripts portent la parade CRLF » a l'air d'un invariant. Ce n'en est
 *   pas un : les 16 autres ne sont PAS exposes. Ils tolerent CRLF autrement —
 *   `/\r?\n/`, `[\s\S]`, ou simplement `\s`, qui matche deja `\r`. Un controle
 *   sur ce compte aurait rougi sur TREIZE scripts sains des le premier jour,
 *   et il aurait ete desactive le jour meme (§E.7). Mesure faite, puis jetee.
 *
 *   Meme raison pour « N fichiers balayes par diag-configuration-absente » :
 *   c'est le chiffre INTERNE d'un autre diagnostic, qui bouge a chaque fichier
 *   ajoute et ne dit rien sur la justesse de la memoire.
 *
 *   Reste le nombre de MIGRATIONS : exact, il change rarement, et quand il
 *   change la memoire doit etre relue de toute facon — c'est la regle de
 *   maintenance du projet.
 */

{
  const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
  const dit = nombreAnnonce(/Sur les/)
  ok(dit === migrations.length,
    `migrations : la memoire annonce ${dit ?? '(introuvable)'}, le depot en compte ${migrations.length}`,
    dit === null
      ? 'amorce « Sur les **N** migrations » introuvable — la phrase a ete reecrite, le controle doit suivre'
      : 'un chiffre juste a sa date devient faux sans que rien ne le signale (§M1)')
}

// ═════════════════════════════════════════════════════════════════════════════
section('E. Le detecteur lui-meme est eprouve')
// ═════════════════════════════════════════════════════════════════════════════

{
  // Le piege §E.7 s'est referme DEUX FOIS sur le relecteur pendant l'audit :
  // un grep a trouve une regle dans un COMMENTAIRE. Le lecteur d'ecrans ne lit
  // donc que la premiere cellule d'un tableau, jamais la description.
  const faux = citesDansBloc.call(null, '### P2.4 — Administration', '\n---', /^\/admin\/?/)
  ok(faux !== null && !faux.has('lib/expert-disclosure.ts'),
    'le lecteur d’ecrans ignore les fichiers cites dans les DESCRIPTIONS',
    'il ramasserait des chemins de code et crierait a tort')

  // Un lien http n'est pas un fichier du depot.
  const liensDoc = [...'[x](https://exemple.test/y)'.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
  ok(liensDoc.every((l) => l.startsWith('http')),
    'le lecteur de liens distingue une URL d’un chemin de fichier')

  // Une table de sauvegarde du dump n'est pas une table du produit.
  ok(/^_backup_/.test('_backup_users_20260422'),
    'le motif des tables de sauvegarde du dump reconnait bien leur forme')
}

// ═════════════════════════════════════════════════════════════════════════════
section('F. Aucun numero de section n est porte deux fois')
// ═════════════════════════════════════════════════════════════════════════════
/*
 * NE DE LA FUSION DU 20/09/2026, ET DE CE QUE GIT N'A PAS DIT.
 *
 * Le tronc et `feat/s1-ux-profil` ont ecrit un §C.10 chacun, dans
 * `docs/architecture.md`, a des endroits DIFFERENTS du fichier. La fusion
 * automatique a donc REUSSI — aucun conflit, aucun marqueur — et produit un
 * fichier valide, coherent a la lecture, et FAUX A LA CITATION : deux
 * sections du meme numero, dont l'une citee deux fois ailleurs.
 *
 * UNE COLLISION QUI NE PRODUIT PAS DE CONFLIT EST PIRE QU'UNE QUI EN PRODUIT :
 * un conflit arrete la fusion et exige une decision ; celle-ci ne laisse
 * aucune trace. Elle a ete trouvee en RECOMPTANT les sections des deux cotes,
 * pas en lisant le rapport de merge (§E.45).
 *
 * ⚠️ CE QU IL NE VERIFIE PAS : que les numeros se SUIVENT. Un §C.8 suivi d un
 *    §C.10 sans §C.7 ne rougit pas — un numero peut avoir ete retire
 *    volontairement, et l'exiger ferait crier le controle a chaque
 *    suppression legitime.
 */

// `bis` / `ter` / `quater` sont des sections A PART ENTIERE, sur les DEUX
// formes : `M1 bis` comme `G.5 bis`. Une premiere version ne les portait que
// sur la forme sans point, et denoncait trois sections saines — `G.5 bis`,
// `P1.2 bis`, `P3.0 bis/ter`. Un controle qui crie a tort est desactive le
// jour meme (§E.16).
const SUFFIXE = String.raw`(?: (?:bis|ter|quater))?`
const EN_TETE_NUMEROTEE = new RegExp(
  String.raw`^(?:#{2,4} |\*\*)([A-Z]\d*\.\d+` + SUFFIXE + String.raw`|[A-Z]\d+` + SUFFIXE + String.raw`)(?![\w.])`,
)

/** Rend une Map identifiant → lignes ou il apparait comme EN-TETE. */
function numerosDeSection(texte) {
  const vus = new Map()
  texte.split('\n').forEach((ligne, i) => {
    const m = EN_TETE_NUMEROTEE.exec(ligne)
    if (!m) return
    if (!vus.has(m[1])) vus.set(m[1], [])
    vus.get(m[1]).push(i + 1)
  })
  return vus
}
const doublons = (texte) =>
  [...numerosDeSection(texte)].filter(([, lignes]) => lignes.length > 1)

// ── LE MOTIF EST EPROUVE SUR SON CAS CONNU, AVANT TOUT BALAYAGE ──────────
//    Le temoin est CE QUI A DISPARU (§E.33) : l etat de `docs/architecture.md`
//    JUSTE APRES la fusion automatique, avant la renumerotation.
const TEMOIN_COLLISION = [
  '### C.9 — Ce que `/admin/supervision` doit porter, mesure par mesure',
  '',
  "### C.10 — Le module Stripe d'exploitation : ce qu'il garantit",
  '',
  '### C.10 — Les TROIS ecrivains des listes de profil',
].join('\n')

const prises = doublons(TEMOIN_COLLISION)
ok(
  prises.length === 1 && prises[0][0] === 'C.10' && prises[0][1].length === 2,
  'le motif VOIT la collision telle qu elle etait (deux §C.10)',
  `attendu un doublon C.10, obtenu ${JSON.stringify(prises)}`,
)

const TEMOIN_SAIN = [
  '**G.5 — Le diagnostic s eprouve par MUTATION.**',
  '**G.5 bis — La regle de maintenance est GARDEE PAR DEUX CONTROLES.**',
  '### P3.0 — L ECHELLE UNIQUE',
  '### P3.0 bis — LE VOCABULAIRE DES REGLAGES',
  '### P3.0 ter — CE QUE PAIE CHAQUE BUDGET',
].join('\n')
ok(
  doublons(TEMOIN_SAIN).length === 0,
  'le motif se TAIT sur `bis` / `ter` — ce sont des sections a part entiere',
  `denonce a tort : ${JSON.stringify(doublons(TEMOIN_SAIN))}`,
)

// ── LE BALAYAGE ──────────────────────────────────────────────────────────
for (const doc of DOCS) {
  const trouves = doublons(read(doc))
  ok(
    trouves.length === 0,
    `${doc} — aucun numero de section porte deux fois`,
    trouves.map(([id, lignes]) => `§${id} aux lignes ${lignes.join(', ')}`).join(' · '),
  )
}

console.log(echecs === 0 ? '\n✔ TOUT VERT' : `\n✘ ${echecs} CONTROLE(S) EN ECHEC`)
process.exit(echecs === 0 ? 0 : 1)
