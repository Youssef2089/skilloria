/**
 * diag-variables-i18n.mjs — UNE CLÉ DONT LE MESSAGE PORTE UNE VARIABLE NE S'APPELLE JAMAIS SANS ELLE
 * (relecture du lot zones de travail, 02/10/2026 — BLOQUANT).
 *
 * LE CAS : `t('continent_entier')` — le message est « {zone} — tout le continent » ; appelé SANS `{ zone }`, next-intl 4
 * ne rend pas le gabarit : il lève une erreur de formatage, et son repli affiche le NOM DE LA CLÉ. Les quatre surfaces
 * de saisie des zones montraient « work_zones.continent_entier » sur chaque continent choisi. Le contrôle du lot
 * EXIGEAIT cette forme : il vérifiait l'appel, pas ce qu'il rend (§E.56).
 *
 * LA RÈGLE, pour TOUT le code (app/, lib/, components/) : pour chaque traducteur lié dans un fichier —
 * `const X = useTranslations('espace')` ou `await getTranslations('espace' | { namespace: 'espace' })` — chaque appel
 * `X('clé')`, `X.rich('clé')`, `X.markup('clé')` dont le message (dans l'UNE des quatre langues) porte une variable ICU
 * (`{zone}`, `{count, plural, …}`) doit passer ses valeurs, et un objet littéral doit nommer CHACUNE d'elles.
 *
 * CE QU'IL NE VOIT PAS, ET IL LE COMPTE À VOIX HAUTE :
 *   · une clé calculée (`t(\`…${x}\`)`, `t(cle)`) ;
 *   · des valeurs passées par une variable (`t('clé', valeurs)`) — non vérifiables ici ;
 *   · un traducteur reçu en paramètre ou en propriété (son espace n'est pas lisible dans le fichier) ;
 *   · le serveur qui lit les JSON directement (lib/notifications/inapp-labels.ts, lib/zones/libelle-serveur.ts…) :
 *     ses substitutions sont gardées par leurs propres contrôles.
 *
 * Il s'éprouve lui-même (§E.33) sur des sources fabriquées avant de juger le dépôt.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
// Commentaires retirés en gardant les positions (§E.7).
const sansCommentaires = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (/^\s*\/\//.test(l) ? l.replace(/[^\n]/g, ' ') : l.replace(/(\s)\/\/ .*$/, (m, e) => e + ' '.repeat(m.length - 1)))).join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}

const LANGUES = ['fr', 'en', 'es', 'de']
let MSG
try {
  MSG = Object.fromEntries(LANGUES.map((l) => [l, JSON.parse(lire(`messages/${l}.json`))]))
} catch (err) {
  console.error('✘ messages illisibles — le contrôle ne tourne pas', err)
  process.exit(2)
}
const message = (langue, chemin) => chemin.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), MSG[langue])

/** Les variables ICU d'un message : `{nom}` et `{nom, plural|select|number|date|time, …}` (les branches `{# …}` non). */
export function variablesIcu(texte) {
  const sortie = new Set()
  const sansEchappes = texte.replace(/'\{[^']*'/g, '')
  for (const m of sansEchappes.matchAll(/\{\s*([A-Za-z_]\w*)\s*(?=[,}])/g)) sortie.add(m[1])
  return [...sortie]
}

/** Les clés d'un objet littéral de premier niveau (`{ a, b: x, 'c': y }`), ou null si ce n'en est pas un. */
function clesDeLObjet(src, debut) {
  if (src[debut] !== '{') return null
  let prof = 0
  let i = debut
  let courant = ''
  const cles = []
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{' || c === '(' || c === '[') { prof++; if (prof === 1) continue }
    if (c === '}' || c === ')' || c === ']') { prof--; if (prof === 0) break }
    if (prof === 1) {
      if (c === ',') { cles.push(courant); courant = '' } else courant += c
    }
  }
  cles.push(courant)
  return cles.map((e) => e.trim()).filter(Boolean).map((e) => {
    if (e.startsWith('...')) return '...'
    const m = /^['"]?([A-Za-z_]\w*)['"]?\s*(?::|$)/.exec(e)
    return m ? m[1] : null
  }).filter(Boolean)
}

/** Les fautes d'un fichier : un appel sans les variables de son message. */
export function fautesDuFichier(srcBrut, chercherMessage = (chemin) => LANGUES.map((l) => message(l, chemin))) {
  const src = sansCommentaires(srcBrut)
  const liaisons = [...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([^']*)'|\{[^}]*?namespace:\s*'([^']*)'[^}]*\})?\s*\)/g)]
    .map((m) => ({ nom: m[1], espace: m[2] ?? m[3] ?? '', pos: m.index }))
  const fautes = []
  const nonVerifies = { cle_calculee: 0, valeurs_par_variable: 0 }
  for (const nom of new Set(liaisons.map((l) => l.nom))) {
    const re = new RegExp(`(?<![\\w.])${nom}(?:\\.(?:rich|markup))?\\(\\s*`, 'g')
    for (const m of src.matchAll(re)) {
      const liaison = liaisons.filter((l) => l.nom === nom && l.pos < m.index).at(-1)
      if (!liaison) continue
      const apres = src.slice(m.index + m[0].length)
      const litteral = /^'([^'\n]+)'\s*(,\s*|\))/.exec(apres)
      if (!litteral) { nonVerifies.cle_calculee++; continue }
      const chemin = liaison.espace ? `${liaison.espace}.${litteral[1]}` : litteral[1]
      const textes = chercherMessage(chemin).filter((x) => typeof x === 'string')
      if (textes.length === 0) continue // une clé absente : diag-cles-i18n
      const vars = [...new Set(textes.flatMap(variablesIcu))]
      if (vars.length === 0) continue
      const ligne = src.slice(0, m.index).split('\n').length
      if (litteral[2].trim() === ')') { fautes.push({ ligne, chemin, manque: vars }); continue }
      const debutValeurs = m.index + m[0].length + litteral[0].length
      const valeurs = clesDeLObjet(src, debutValeurs)
      if (!valeurs) { nonVerifies.valeurs_par_variable++; continue }
      if (valeurs.includes('...')) { nonVerifies.valeurs_par_variable++; continue }
      const manque = vars.filter((v) => !valeurs.includes(v))
      if (manque.length) fautes.push({ ligne, chemin, manque })
    }
  }
  return { fautes, nonVerifies, liaisons: liaisons.length }
}

// ── L'ÉPREUVE (§E.33) : le banc rougit sur ce qu'il doit voir, et se tait sur ce qui est juste ──
{
  const faux = { 'z.a': ['{zone} — tout'], 'z.b': ['Bonjour'], 'z.c': ['{count, plural, one {# pays} other {# pays}}'], 'z.d': ['{a} et {b}'] }
  const chercher = (c) => faux[c] ?? []
  const src = [
    "const t = useTranslations('z')",
    "t('a')",                          // faute : {zone}
    "t('a', { zone: x })",             // juste
    "t('b')",                          // juste (pas de variable)
    "t('c')",                          // faute : {count}
    "t('c', { count })",               // juste (raccourci)
    "t('d', { a: 1 })",                // faute : {b}
    "t('d', valeurs)",                 // non vérifié
    "// t('a')",                       // commentaire : ignoré
  ].join('\n')
  const r = fautesDuFichier(src, chercher)
  ok(r.fautes.map((f) => `${f.ligne}:${f.manque.join('+')}`).join(',') === '2:zone,5:count,7:b' && r.nonVerifies.valeurs_par_variable === 1,
    'épreuve : il voit l’appel sans variable, le pluriel sans {count}, la variable oubliée — et se tait sur le juste et le commentaire',
    JSON.stringify(r))
  ok(variablesIcu("{count, plural, one {# pays choisi} other {# pays choisis}}").join() === 'count' && variablesIcu('{zone} — tout le continent').join() === 'zone',
    'épreuve : les variables ICU, branches de pluriel exclues')
}

// ── LE DÉPÔT ──
const fichiers = []
const parcourir = (d) => {
  for (const e of readdirSync(join(ROOT, d))) {
    const p = `${d}/${e}`
    if (statSync(join(ROOT, p)).isDirectory()) { if (e !== 'node_modules') parcourir(p) }
    else if (/\.(ts|tsx)$/.test(e)) fichiers.push(p)
  }
}
;['app', 'lib', 'components'].forEach(parcourir)
const toutes = []
const totalNonVerifies = { cle_calculee: 0, valeurs_par_variable: 0 }
let liaisons = 0
for (const f of fichiers) {
  const r = fautesDuFichier(lire(f))
  liaisons += r.liaisons
  for (const k of Object.keys(totalNonVerifies)) totalNonVerifies[k] += r.nonVerifies[k]
  for (const x of r.fautes) toutes.push(`${f}:${x.ligne} — ${x.chemin} sans {${x.manque.join('}, {')}}`)
}
console.log(`\n  ${fichiers.length} fichiers, ${liaisons} traducteurs liés ; non vérifiés (dit, pas deviné) : ${totalNonVerifies.cle_calculee} clé(s) calculée(s), ${totalNonVerifies.valeurs_par_variable} appel(s) dont les valeurs passent par une variable.\n`)
ok(liaisons > 100, `le balayage a trouvé des traducteurs (${liaisons}) — un zéro dirait qu'il ne voit plus rien`)
ok(toutes.length === 0, `aucun appel ne laisse de côté une variable de son message (${toutes.length})`, toutes.join('\n       → '))

console.log(echecs === 0 ? '\n✅ diag-variables-i18n : tout est vert.' : `\n❌ diag-variables-i18n : ${echecs} contrôle(s) rouge(s).`)
process.exit(echecs === 0 ? 0 : 1)
