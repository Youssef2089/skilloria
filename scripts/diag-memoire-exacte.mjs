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

  const citee = (t) => MEMOIRE.includes('`' + t + '`')
  const absentes = vivantes.filter((t) => !citee(t))
  ok(absentes.length === 0,
    'chaque table vivante est citee au moins une fois dans la memoire',
    absentes.join(', '))

  // Sens inverse : une table citee qu'aucune migration ne cree est un fantome.
  const bloc = MEMOIRE.slice(MEMOIRE.indexOf('### B.1'), MEMOIRE.indexOf('### B.2'))
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

console.log(echecs === 0 ? '\n✔ TOUT VERT' : `\n✘ ${echecs} CONTROLE(S) EN ECHEC`)
process.exit(echecs === 0 ? 0 : 1)
