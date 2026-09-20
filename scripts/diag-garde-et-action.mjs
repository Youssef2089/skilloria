/**
 * diag-garde-et-action.mjs — LA GARDE ET L'ACTION LISENT-ELLES LA MEME LISTE ?
 *
 * ┌─ LA FORME ──────────────────────────────────────────────────────────────┐
 * │ Une garde teste `X`. L'action consomme `f(X)` — une liste FILTREE. Entre │
 * │ les deux, un `.delete()`. Si `f(X)` est vide alors que `X` ne l'est pas, │
 * │ la suppression a lieu et la reinsertion n'ecrit rien : TOUT DISPARAIT.   │
 * │                                                                          │
 * │ C'est §E.36 — deux gardes qui tombent sur la meme panne n'en font        │
 * │ qu'une — A L'INTERIEUR D'UNE SEULE FONCTION. Le couple n'a pas besoin de │
 * │ deux fichiers pour exister : il lui suffit de DEUX LECTURES.             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * LA PROPRIETE GARDEE, et ce n'est pas une forme :
 *   « LA LISTE QUI SERA REINSEREE EST TESTEE AVANT LA SUPPRESSION. »
 * Peu importe comment — une garde locale, ou une barriere en amont qui refuse
 * la requete. Un controle ancre sur la forme locale rougirait sur le seul
 * ecrivain qui se protege autrement (§E.34).
 *
 * CE QU'IL NE VERIFIE PAS, ET IL FAUT LE LIRE :
 *   · il ne suit pas les alias : `const b = a` puis `.insert(b.map(…))` lui
 *     echappe. Il resout `const rows = <B>` et rien de plus ;
 *   · il ne sait pas si `f` RETRECIT vraiment. `.map()` conserve la longueur,
 *     `.filter()` non — il ne fait pas la difference et exige le test dans les
 *     deux cas. C'est volontairement trop strict : une exigence de trop se
 *     voit, une de moins ne se voit jamais ;
 *   · il ne lit que `app/`, `lib/` et `components/`, et seulement les
 *     suppressions ecrites en une chaine `.from(…).delete()`. Une suppression
 *     passee par un RPC lui est invisible.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourne.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RACINES = ['app', 'lib', 'components']

// §E.3 — CRLF : le depot n'a pas de .gitattributes.
const lire = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n')

// §E.7 — un anti-pattern doit pouvoir etre DOCUMENTE. Les lignes sont
// PRESERVEES : un commentaire devient une ligne vide, les numeros restent vrais.
const sansCommentaires = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    echecs++
    console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`)
  }
}
const section = (t) => console.log(`\n═══ ${t} ═══\n`)

/* ══════════════════════════════════════════════════════════════════════════
 * LE MOTIF
 * ════════════════════════════════════════════════════════════════════════ */

/** Profondeur d'accolades, caractere par caractere (chaines ignorees grossierement). */
function profondeurs(src) {
  const d = new Array(src.length).fill(0)
  let n = 0
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') n++
    d[i] = n
    if (src[i] === '}') n--
  }
  return d
}

/** Le bloc `{ … }` le plus proche qui contient `pos`. */
function blocEnglobant(src, prof, pos) {
  const niveau = prof[pos]
  let debut = pos
  while (debut > 0 && !(src[debut] === '{' && prof[debut] === niveau)) debut--
  let fin = pos
  while (fin < src.length - 1 && !(src[fin] === '}' && prof[fin] === niveau - 1)) fin++
  return { debut, fin, texte: src.slice(debut, fin + 1) }
}

/**
 * Cherche les suppressions dont la liste reinseree n'est pas testee AVANT.
 * Rend une liste de `{ ligne, liste, extrait }`.
 */
export function suppressionsNonGardees(src) {
  const code = sansCommentaires(src)
  const prof = profondeurs(code)
  const prises = []

  for (const m of code.matchAll(/\.delete\(\s*\)/g)) {
    const pos = m.index
    const { debut, texte: bloc } = blocEnglobant(code, prof, pos)
    const posDansBloc = pos - debut

    // L'insertion qui SUIT la suppression, dans le meme bloc.
    const apres = bloc.slice(posDansBloc)
    const ins = /\.insert\(\s*([A-Za-z_$][\w$]*)/.exec(apres)
    if (!ins) continue
    let liste = ins[1]

    // `const rows = <B>…` — on resout une indirection, pas deux.
    const aff = new RegExp(`\\b(?:const|let)\\s+${liste}\\s*=\\s*([A-Za-z_$][\\w$.]*)`).exec(bloc)
    if (aff) liste = aff[1]
    // `rows = normalised.map(…)` : la LISTE est `normalised`, pas
    // `normalised.map` — sinon on ira chercher `normalised.map.length`, qui
    // n'existe nulle part, et TOUT le depot se mettra a rougir.
    liste = liste.replace(/\.(map|filter|slice|flatMap|reduce|concat|sort|forEach|reverse)$/, '')

    // La liste reinseree est-elle TESTEE avant la suppression ? On regarde tout
    // ce qui precede la suppression dans le FICHIER — portee, pas voisinage
    // (meme lecon que la fenetre de diag-erreurs-avalees).
    const avant = code.slice(0, pos)
    const nom = liste.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const testee = new RegExp(`${nom}\\s*(?:\\?\\.)?\\.length\\s*(?:===?|!==?|>|<|>=|<=)`).test(avant)
    if (testee) continue

    const ligne = code.slice(0, pos).split('\n').length
    prises.push({ ligne, liste, extrait: bloc.slice(posDansBloc - 120, posDansBloc + 160).replace(/\s+/g, ' ') })
  }
  return prises
}

/* ══════════════════════════════════════════════════════════════════════════
 * A. LE MOTIF EST EPROUVE SUR SON CAS CONNU — AVANT TOUT BALAYAGE
 *
 * Le temoin est CE QUI A DISPARU (§E.33), pas ce qui l'entourait : le bloc
 * langues de `app/api/profile/upload-cv/route.ts` TEL QU'IL ETAIT avant le
 * correctif du 20/09/2026. La garde testait `parsed.languages_structured`,
 * le `delete` agissait, et la reinsertion consommait `normalised` — la liste
 * DEDUPLIQUEE et FILTREE, que rien ne testait.
 * ════════════════════════════════════════════════════════════════════════ */
section('A. LE MOTIF, EPROUVE SUR SON CAS CONNU')

const TEMOIN_AVANT = `
  if (
    Array.isArray(parsed.languages_structured) &&
    parsed.languages_structured.length > 0
  ) {
    const seen = new Set()
    const deduped = parsed.languages_structured.filter(l => {
      const key = l.language?.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    let primaryKept = false
    const normalised = deduped.map(l => ({ ...l, is_primary: false }))
    const { error: delErr } = await supabaseAdmin
      .from('profile_languages')
      .delete()
      .eq('profile_id', profile.id)
    if (delErr) {
      console.error('[upload-cv] languages delete failed', delErr)
    } else {
      const rows = normalised.map(l => ({ profile_id: profile.id, language: l.language.trim() }))
      const { error: insErr } = await supabaseAdmin
        .from('profile_languages')
        .insert(rows)
      if (insErr) console.error('[upload-cv] languages insert failed', insErr)
    }
  }
`

const TEMOIN_APRES = `
  if (
    Array.isArray(parsed.languages_structured) &&
    parsed.languages_structured.length > 0
  ) {
    const seen = new Set()
    const deduped = parsed.languages_structured.filter(l => {
      const key = l.language?.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    let primaryKept = false
    const normalised = deduped.map(l => ({ ...l, is_primary: false }))
    if (normalised.length === 0) {
      console.error('[upload-cv] langues illisibles')
    } else {
      const { error: delErr } = await supabaseAdmin
        .from('profile_languages')
        .delete()
        .eq('profile_id', profile.id)
      if (delErr) {
        console.error('[upload-cv] languages delete failed', delErr)
      } else {
        const rows = normalised.map(l => ({ profile_id: profile.id, language: l.language.trim() }))
        const { error: insErr } = await supabaseAdmin
          .from('profile_languages')
          .insert(rows)
        if (insErr) console.error('[upload-cv] languages insert failed', insErr)
      }
    }
  }
`

const priseTemoin = suppressionsNonGardees(TEMOIN_AVANT)
ok(
  priseTemoin.length === 1 && priseTemoin[0].liste === 'normalised',
  'le motif VOIT le defaut tel qu il etait (liste reinseree : `normalised`)',
  `attendu 1 prise sur \`normalised\`, obtenu ${JSON.stringify(priseTemoin.map((p) => p.liste))}`,
)
ok(
  suppressionsNonGardees(TEMOIN_APRES).length === 0,
  'le motif se TAIT sur le correctif — un balayage qui rend zero se prouve',
)

/* ══════════════════════════════════════════════════════════════════════════
 * B. LE BALAYAGE
 * ════════════════════════════════════════════════════════════════════════ */
section('B. LE BALAYAGE — app/ + lib/ + components/')

const fichiers = []
const marche = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) marche(p)
    else if (/\.tsx?$/.test(p)) fichiers.push(p)
  }
}
for (const r of RACINES) marche(join(ROOT, r))

/**
 * LES EXEMPTIONS — une raison PAR ENTREE (§G.8). Porter une ligne ici sans
 * l'avoir lue, c'est declarer legitime ce qu'on n'a pas regarde.
 *
 * Chaque exemption porte une SENTINELLE : un fragment de code qui doit encore
 * exister. Si la protection en amont disparait, l'exemption tombe et le
 * controle rougit — une exemption qui survit a sa raison est un defaut endormi.
 */
const EXEMPTIONS = {
  'app/api/profile/route.ts': {
    raison:
      'Les trois blocs suppriment AVANT de tester, mais la requete ne les atteint ' +
      'jamais dans ce cas : une barriere en amont compte les entrees ECRIVABLES ' +
      'avec le meme predicat que les `.filter()`, et refuse 400 `liste_illisible`. ' +
      'La propriete est tenue, pas par la forme locale mais par un refus anterieur.',
    sentinelle: /liste_illisible[\s\S]{0,200}400/,
  },
}

const prisesParFichier = new Map()
for (const f of fichiers) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  const prises = suppressionsNonGardees(lire(f))
  if (prises.length > 0) prisesParFichier.set(rel, prises)
}

const nonExemptees = []
for (const [rel, prises] of prisesParFichier) {
  const ex = EXEMPTIONS[rel]
  if (!ex) {
    nonExemptees.push([rel, prises])
    continue
  }
  ok(
    ex.sentinelle.test(sansCommentaires(lire(join(ROOT, rel)))),
    `${rel} — l exemption tient encore : ${ex.raison.slice(0, 70)}…`,
    'la sentinelle de l exemption a disparu : la protection en amont n est plus la',
  )
}

ok(
  nonExemptees.length === 0,
  `aucune suppression dont la liste reinseree n est pas testee avant (${prisesParFichier.size} fichier(s) vus, ${Object.keys(EXEMPTIONS).length} exempte(s) avec raison)`,
  nonExemptees
    .map(([rel, ps]) => ps.map((p) => `${rel}:${p.ligne} — liste \`${p.liste}\` jamais testee`).join('\n       '))
    .join('\n       '),
)

/* ══════════════════════════════════════════════════════════════════════════
 * C. LES TROIS ECRIVAINS PORTENT LA MEME GARDE
 *
 * Ancre sur le BLOC vise (§E.8), jamais une regex lachee sur le fichier.
 * ════════════════════════════════════════════════════════════════════════ */
section('C. L INVENTAIRE DES ECRIVAINS DE `profile_languages`')

/*
 * ⚠️ CETTE SECTION S ETAIT ANCREE SUR UN NOM, ET LA MUTATION L A DIT.
 *
 *    Elle exigeait le litteral `normalised` et le test `normalised.length
 *    === 0`. La contre-mutation de §E.34 — RENOMMER la liste en `aEcrire`
 *    sans rien perdre — la faisait rougir : le controle defendait un
 *    identifiant, pas une propriete. C'est §E.34 dans le controle ecrit pour
 *    fermer §E.36, et c est exactement la raison pour laquelle on mute.
 *
 *    Ce que cette section garde maintenant est un INVENTAIRE (§G.8, etat
 *    mesure : chaque ligne reste verifiee, aucune raison par entree n est
 *    due) — QUI ecrit cette table par suppression + reinsertion. La
 *    PROPRIETE, elle, est verifiee par la section B pour tout le depot.
 *    Un QUATRIEME ecrivain fait rougir : il doit etre lu, pas devine.
 */
const ECRIVAINS_ATTENDUS = [
  ['app/api/profile/upload-cv/route.ts', 'analyse de CV — freelance'],
  ['app/api/profile/cdi-upload-cv/route.ts', 'analyse de CV — CDI'],
  ['app/api/profile/route.ts', 'PATCH du profil'],
]

const ecrivainsTrouves = []
for (const f of fichiers) {
  const code = sansCommentaires(lire(f))
  if (/from\('profile_languages'\)\s*\n?\s*\.delete\(/.test(code)) {
    ecrivainsTrouves.push(relative(ROOT, f).replace(/\\/g, '/'))
  }
}

for (const [rel, label] of ECRIVAINS_ATTENDUS) {
  ok(
    ecrivainsTrouves.includes(rel),
    `${label} — supprime puis reinsere \`profile_languages\``,
    `${rel} ne porte plus cette suppression : l inventaire a bouge, relisez-le`,
  )
  ok(
    !prisesParFichier.has(rel) || rel in EXEMPTIONS,
    `${label} — la propriete est tenue (garde locale, ou barriere declaree)`,
    'la liste reinseree n est testee nulle part avant la suppression',
  )
}

const inconnus = ecrivainsTrouves.filter((r) => !ECRIVAINS_ATTENDUS.some(([x]) => x === r))
ok(
  inconnus.length === 0,
  'aucun QUATRIEME ecrivain n est apparu sans avoir ete lu',
  inconnus.join(', '),
)

/* ══════════════════════════════════════════════════════════════════════════ */
console.log('')
if (echecs > 0) {
  console.log(`✘ ${echecs} CONTROLE(S) EN ECHEC`)
  process.exit(1)
}
console.log('✅ La garde et l action lisent la meme liste — et le motif a prouve qu il voit.')
