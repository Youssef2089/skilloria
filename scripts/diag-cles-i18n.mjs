// scripts/diag-cles-i18n.mjs — AUCUNE CLE DE TRADUCTION NE S'AFFICHE BRUTE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE DEFAUT QU'ON FERME, ET IL ETAIT VISIBLE A L'ECRAN
//
//   Youssef a vu, en toutes lettres, sur /admin/seuils :
//
//       ADMIN_SEUILS.TYPES.PROFILE_MATCHING.NAME
//
//   LA CHAINE COMPLETE, ETABLIE EN LISANT LE CODE ET LES MIGRATIONS :
//     ① la base porte une ligne VESTIGE, `provider_type = 'profile_matching'`
//        (`claude_profile_matching`, le moteur d'AVANT le reranking). La
//        migration `parametrage_de_production` l'a DESACTIVEE sans la
//        supprimer — deliberement, pour que le type garde une explication ;
//     ② la route servait TOUTES les lignes, actives ou non ;
//     ③ l'ecran rendait `t(\`types.${provider_type}.name\`)` — une cle
//        DYNAMIQUE dont la valeur venait donc de la BASE ;
//     ④ aucune des quatre langues n'a `types.profile_matching.name` ;
//     ⑤ next-intl rend alors le CHEMIN de la cle, et
//        `textTransform: 'uppercase'` le met en capitales.
//
//   ⚠️ ET LE DEVELOPPEUR CROYAIT AVOIR UN REPLI. Il avait ecrit :
//        t(`types.${x}.name`, { default: x })
//      NEXT-INTL N'A PAS D'OPTION `default` : le second argument est l'objet
//      des VALEURS D'INTERPOLATION. Le repli n'a jamais existe. C'est la
//      famille §E.7 appliquee a une API : un code qui affirme une garantie que
//      la bibliotheque ne donne pas est pire qu'un code qui n'en affirme
//      aucune — on cesse de chercher.
//
// CE QUE CE CONTROLE VERIFIE
//   (A) TOUTE CLE LITTERALE se resout dans les QUATRE langues.
//   (B) TOUTE CLE DYNAMIQUE se resout QUELLE QUE SOIT la valeur : les parties
//       fixes doivent former un espace dont CHAQUE enfant porte la feuille
//       demandee. C'est exactement ce qui manquait : `types` avait quatre
//       enfants, la base en servait un cinquieme.
//   (C) `t()` n'est JAMAIS appele avec une option `default` — elle n'existe pas.
//
// CE QU'IL NE VERIFIE PAS, ET IL LE DIT
//   Il ne sait pas quelles VALEURS la base peut rendre. (B) garantit qu'une
//   valeur DECLAREE dans les messages se resout ; elle ne garantit pas que la
//   base n'en invente pas une autre. C'est a la route de ne servir que des
//   sujets NOMMES — ce que fait desormais `lib/jugement/sujets.ts`.
//
//   node scripts/diag-cles-i18n.mjs
//   Aucune base, aucun reseau. 0 = vert · 1 = rouge.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (l.trimStart().startsWith('//') || l.trimStart().startsWith('*') ? '' : l))
    .join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

const LANGUES = ['fr', 'en', 'es', 'de']
const MESSAGES = Object.fromEntries(LANGUES.map((l) => [l, JSON.parse(lire(`messages/${l}.json`))]))

/** Descend un chemin pointé. Rend `undefined` si une marche manque. */
/** Le corps de la DERNIERE definition (ordre des fichiers) d'une fonction SQL `public.<nom>` — nom EXACT. */
const derniereDefinitionSql = (nom) => {
  let corps = ''
  const dossier = 'supabase/migrations'
  for (const f of readdirSync(join(ROOT, dossier)).filter((x) => x.endsWith('.sql')).sort()) {
    const m = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.` + nom + String.raw`\s*\([\s\S]*?\bas\s+(\$[a-z_]*\$)([\s\S]*?)\1`, 'i')
      .exec(lire(`${dossier}/${f}`))
    if (m) corps = m[2].split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
  }
  return corps
}

const descendre = (o, chemin) =>
  chemin.split('.').reduce((n, s) => (n && typeof n === 'object' ? n[s] : undefined), o)

/** Le balayage : app/ + lib/ + components/ (règle projet). */
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

// ═══════════════════════════════════════════════════════════════════════════
section('A. Toute cle LITTERALE se resout dans les quatre langues')
// ═══════════════════════════════════════════════════════════════════════════

let litterales = 0
const manquantes = []
const dynamiques = []
const avecDefault = []

for (const f of sources) {
  const code = sansCommentaires(lire(f))
  // L'espace de noms du fichier. Plusieurs appels = plusieurs candidats ; une
  // cle qui se resout dans L'UN d'eux passe — on ne devine pas lequel sert.
  const espaces = [...code.matchAll(/useTranslations\(\s*'([^']+)'\s*\)/g)].map((m) => m[1])
  if (espaces.length === 0) continue

  // ── (C) L'OPTION QUI N'EXISTE PAS ────────────────────────────────────────
  for (const m of code.matchAll(/\bt\(\s*(?:'[^']*'|`[^`]*`)\s*,\s*\{([^}]*)\}/g)) {
    if (/\bdefault\s*:/.test(m[1])) avecDefault.push(`${f} → ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`)
  }

  // ── (A) LES CLES LITTERALES ──────────────────────────────────────────────
  for (const m of code.matchAll(/\bt(?:Bdd)?\(\s*'([A-Za-z0-9_][A-Za-z0-9_.]*)'/g)) {
    const cle = m[1]
    litterales++
    const resout = (langue) => espaces.some((ns) => typeof descendre(MESSAGES[langue], `${ns}.${cle}`) === 'string')
    const absentes = LANGUES.filter((l) => !resout(l))
    if (absentes.length > 0) manquantes.push(`${f} → ${espaces.join('|')}.${cle} (absente en ${absentes.join(', ')})`)
  }

  // ── (B) LES CLES DYNAMIQUES ──────────────────────────────────────────────
  for (const m of code.matchAll(/\bt\(\s*`([^`]*\$\{[^`]*)`/g)) {
    dynamiques.push({ f, brut: m[1], espaces })
  }
}

ok(litterales > 100, `le balayage voit bien les appels (${litterales} cle(s) litterale(s))`,
  'un balayage qui ne trouve presque rien passerait pour vert sans rien verifier')
ok(manquantes.length === 0, 'toute cle litterale se resout dans les quatre langues',
  manquantes.slice(0, 12).join('\n       · '))

// ═══════════════════════════════════════════════════════════════════════════
section('B. Une cle dynamique nourrie par la BASE est bornee par une LISTE')
// ═══════════════════════════════════════════════════════════════════════════

//   ⚠️ MA PREMIERE VERSION DE CETTE SECTION N'AURAIT PAS ATTRAPE LE BUG.
//      Elle exigeait que CHAQUE ENFANT de l'espace porte la feuille demandee.
//      Or `types` avait bien ses quatre enfants avec `.name` — la valeur
//      fautive, `profile_matching`, N'ETAIT ENFANT DE RIEN. Le controle serait
//      passe vert sur le defaut meme qu'il devait fermer.
//
//      LA PROPRIETE UTILE N'EST PAS « tous les enfants ont la feuille », c'est
//      « LES VALEURS POSSIBLES SONT BORNEES, ET LA BORNE EST LA MEME DES DEUX
//      COTES ». Une cle construite depuis une donnee de base ne peut se resoudre
//      que si la donnee est filtree par une LISTE FERMEE, et que cette liste est
//      exactement l'ensemble des enfants declares dans les messages.
//
//      D'ou l'inventaire ci-dessous : chaque cle dynamique nourrie par la base
//      y est rattachee a sa liste. Ce qui n'y est pas est DIT non analysable,
//      jamais juge (§E.12).
{
  /**
   * cle dynamique → { liste : d'ou viennent les valeurs, espace : ou vivent
   * les textes }. Les deux doivent coincider EXACTEMENT, dans les 4 langues.
   */
  const BORNES = [
    {
      quoi: 'les trois sujets de /admin/seuils',
      module: 'lib/jugement/sujets.ts',
      motif: /sujet:\s*'([a-z]+)'/g,
      espace: 'admin_seuils.sujet',
    },
    {
      quoi: 'les cas qui forcent la revue humaine',
      module: 'lib/jugement/sujets.ts',
      motif: /^\s*'([A-Z_]+)',$/gm,
      espace: 'admin_seuils.flag',
    },
    // RECETTE STAGING (30/09/2026) : deux espaces dont les VALEURS ne vivaient pas dans les messages, et que
    // le balayage des cles litterales ne pouvait pas voir — Youssef a lu les chemins bruts a l'ecran.
    {
      // Le menu d'administration : `t(\`sidebar.${item.labelKey}\`)`, la cle vient de lib/nav-config.ts.
      // `nav_depots_echec` n'y a jamais eu de texte ; `nav_travaux_ia` (ARRET 19) non plus.
      // L'espace porte aussi les titres de section : les orphelins n'y sont pas une faute.
      quoi: 'les entrees du menu d administration',
      module: 'lib/nav-config.ts',
      motif: /labelKey:\s*'([a-z_]+)'/g,
      espace: 'admin_back_office.sidebar',
      orphelins: false,
    },
    {
      // Supervision, « par acteur » : `t(\`actor.${a.acteur_type}\`)`, la valeur vient de la BASE —
      // `ai_spend_par_acteur` rend quatre types, et les messages n'en portaient que deux.
      // Lue dans la DERNIERE definition de la fonction, jamais recopiee ici.
      quoi: 'les acteurs de la depense IA (Supervision)',
      valeurs: () => {
        const corps = derniereDefinitionSql('ai_spend_par_acteur')
        const cas = /then\s+'([a-z_]+)'\s+else\s+'([a-z_]+)'\s+end\s+as\s+acteur_type/.exec(corps)
        const lignes = [...corps.matchAll(/union\s+all\s+select\s+'([a-z_]+)'::text/g)].map((m) => m[1])
        return cas ? [cas[1], cas[2], ...lignes] : []
      },
      source: 'la derniere definition de public.ai_spend_par_acteur (supabase/migrations)',
      espace: 'admin_back_office.supervision.actor',
    },
    {
      // Supervision, « ce qui ne va pas » : `t(\`problem.${p.cle}\`)`. Les cles litterales de
      // lib/supervision/problemes.ts, et `site_injoignable_<cause>` pour chaque cause du module pur
      // (recette staging : la base n'atteint pas le site).
      quoi: 'les problemes de la supervision',
      valeurs: () => {
        const src = sansCommentaires(lire('lib/supervision/problemes.ts'))
        const litterales = [...src.matchAll(/cle:\s*'([a-z_]+)'/g)].map((m) => m[1])
        const causes = [...sansCommentaires(lire('lib/supervision/joignabilite.ts'))
          .matchAll(/^\s*'([a-z_]+)',\s*$/gm)].map((m) => `site_injoignable_${m[1]}`)
        return /cle:\s*`site_injoignable_\$\{t\.cause\}`/.test(src) ? [...litterales, ...causes] : litterales
      },
      source: 'lib/supervision/problemes.ts + lib/supervision/joignabilite.ts',
      espace: 'admin_back_office.supervision.problem',
      orphelins: false,
    },
  ]

  for (const b of BORNES) {
    // DEDOUBLONNE : la declaration de type porte les memes litteraux que les
    // donnees (`sujet: 'experts' | 'entreprises'…`), et compter deux fois
    // `experts` ferait annoncer QUATRE sujets la ou il y en a trois. Un
    // chiffre faux dans un controle est un chiffre qu on citera.
    const valeurs = b.valeurs
      ? [...new Set(b.valeurs())]
      : [...new Set([...sansCommentaires(lire(b.module)).matchAll(b.motif)].map((m) => m[1]))]
    b.module = b.module ?? b.source
    ok(valeurs.length > 0, `${b.quoi} : la liste est lisible dans ${b.module} (${valeurs.length})`,
      'si le motif ne trouve plus rien, ce controle ne garde plus rien — il se relit')
    for (const langue of LANGUES) {
      const espace = descendre(MESSAGES[langue], b.espace)
      const enfants = espace && typeof espace === 'object' ? Object.keys(espace) : []
      const sansTexte = valeurs.filter((v) => !enfants.includes(v))
      const orphelins = enfants.filter((e) => !valeurs.includes(e))
      ok(
        sansTexte.length === 0,
        `${b.quoi} — ${langue} : chaque valeur a son texte`,
        `${sansTexte.join(', ')} n'ont pas d'entree dans ${b.espace} : next-intl rendrait LE CHEMIN DE LA CLE, affiche tel quel`,
      )
      if (b.orphelins !== false) ok(
        orphelins.length === 0,
        `${b.quoi} — ${langue} : aucun texte orphelin`,
        `${orphelins.join(', ')} existent dans ${b.espace} sans valeur correspondante : un texte sans emploi finit par etre cru vivant`,
      )
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('B bis. Les autres cles dynamiques — ce qu on sait, et ce qu on ne sait pas')
// ═══════════════════════════════════════════════════════════════════════════

//   `types.${x}.name` se resout pour toute valeur de `x` SI ET SEULEMENT SI
//   chaque enfant de `types` porte `name`. C'est exactement ce qui manquait :
//   `types` avait quatre enfants, la base en servait un cinquieme.
const trous = []
let verifiees = 0
for (const { f, brut, espaces } of dynamiques) {
  // `a.${x}.b` → prefixe `a`, suffixe `b`. Un motif a plusieurs trous n'est pas
  // analysable : on le DIT plutot que de le juger (§E.12).
  const parties = brut.split(/\$\{[^}]*\}/)
  if (parties.length !== 2) {
    trous.push(`${f} → ${brut} (plusieurs parties variables : non analysable)`)
    continue
  }
  // ⚠️ LA VARIABLE N'EST PAS TOUJOURS UN SEGMENT ENTIER — trouve en executant.
  //    `t(\`status_${x}\`)` met la variable en SUFFIXE d'un segment. Ma premiere
  //    version prenait `status_` pour un espace de noms, ne le trouvait pas, et
  //    denoncait DOUZE lignes parfaitement saines. Un controle qui crie a tort
  //    est desactive le jour meme.
  //    On separe donc le prefixe en PARENT (jusqu'au dernier point) et DEBUT
  //    (le morceau de segment) : les candidats sont les enfants du parent qui
  //    COMMENCENT par ce debut.
  const avant = parties[0]
  const apres = parties[1]
  const coupe = avant.lastIndexOf('.')
  const parent = coupe === -1 ? '' : avant.slice(0, coupe)
  const debut = coupe === -1 ? avant : avant.slice(coupe + 1)
  const suffixe = apres.replace(/^\./, '')
  // Un suffixe qui commence en plein segment n'est pas analysable non plus.
  if (apres !== '' && !apres.startsWith('.')) {
    trous.push(`${f} → ${brut} (la variable est au milieu d'un segment : non analysable)`)
    continue
  }
  verifiees++
  for (const langue of LANGUES) {
    const espace = espaces
      .map((ns) => descendre(MESSAGES[langue], parent === '' ? ns : `${ns}.${parent}`))
      .find((v) => v && typeof v === 'object')
    if (!espace) {
      trous.push(`${f} → ${espaces.join('|')}${parent ? '.' + parent : ''} introuvable en ${langue}`)
      continue
    }
    const candidats = Object.keys(espace).filter((k) => k.startsWith(debut))
    // ZERO candidat : les valeurs viennent d'ailleurs que de cet espace. On le
    // DIT plutot que de le juger — un verdict invente sur ce qu'on ne comprend
    // pas fait croire a une couverture qui n'existe pas (§E.12).
    if (candidats.length === 0) {
      trous.push(`${f} → ${brut} : aucun enfant de « ${parent || espaces[0]} » ne commence par « ${debut} » (non analysable)`)
      continue
    }
    const sansFeuille = candidats.filter(
      (enfant) => typeof descendre(espace, suffixe === '' ? enfant : `${enfant}.${suffixe}`) !== 'string',
    )
    if (sansFeuille.length > 0) {
      trous.push(
        `${f} → ${parent}.${debut}<*>${suffixe ? '.' + suffixe : ''} : ${sansFeuille.join(', ')} n'ont pas cette feuille en ${langue}`,
      )
    }
  }
}

ok(dynamiques.length > 0, `des cles dynamiques existent (${dynamiques.length} trouvee(s), ${verifiees} analysable(s))`,
  "aucune trouvee : si le montage a change, ce controle se relit, il ne se supprime pas")

//   CE QUI EST ROUGE ICI, ET CE QUI NE L'EST PAS.
//     ROUGE  — l'espace de noms n'existe pas, ou AUCUN enfant ne porte la
//              feuille : aucune valeur ne peut se resoudre, c'est certain.
//     DIT    — « certains enfants n'ont pas la feuille » : l'ensemble des
//              valeurs possibles n'est pas connu de ce controle, et juger
//              reviendrait a inventer un verdict. Les bornes declarees en (B)
//              sont la reponse a ce cas-la.
const certains = trous.filter((t) => /introuvable en|aucun enfant/.test(t))
const dits = trous.filter((t) => !certains.includes(t))
ok(
  certains.length === 0,
  'aucune cle dynamique ne vise un espace inexistant',
  certains.slice(0, 10).join('\n       · '),
)
if (dits.length > 0) {
  note(`${dits.length} cle(s) dynamique(s) dont l ensemble des valeurs n est pas connu de ce controle :`)
  for (const d of dits.slice(0, 8)) note(`  · ${d}`)
  note('  Pour qu une d elles soit GARDEE, declarez sa borne dans BORNES, section B.')
}

// ═══════════════════════════════════════════════════════════════════════════
section('C. L option `default` n existe pas dans next-intl')
// ═══════════════════════════════════════════════════════════════════════════

ok(
  avecDefault.length === 0,
  'aucun appel `t()` ne passe une option `default`',
  avecDefault.join('\n       · ') +
    "\n       → Le second argument de `t()` est l'objet des VALEURS D'INTERPOLATION. " +
    "Un `default` y est ignore en silence : le repli qu'on croit avoir n'existe pas (§E.7).",
)

// ═══════════════════════════════════════════════════════════════════════════
section('D. Ce que ce controle ne verifie pas')
// ═══════════════════════════════════════════════════════════════════════════

note("il ne sait pas quelles VALEURS la base peut rendre : (B) garantit qu'une")
note("valeur DECLAREE se resout, pas que la base n'en invente pas une autre.")
note("C'est a la route de ne servir que des sujets NOMMES (lib/jugement/sujets.ts).")
note(`${sources.length} fichier(s) balayes (${RACINES.join(' + ')}).`)

console.log('')
if (echecs > 0) {
  console.log(`✘ ${echecs} CONTROLE(S) EN ECHEC`)
  process.exit(1)
}
console.log('✅ Aucune cle de traduction ne peut s afficher brute.')
process.exit(0)
