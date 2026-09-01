// scripts/diag-login-loading.mjs — ÉTATS DE CHARGEMENT DES ÉCRANS D'OUVERTURE
// DE SESSION : relâchés dans un `finally`, jamais par énumération.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   `/connexion` relâchait son drapeau en listant ses chemins de sortie. Sur
//   NEUF sorties, DEUX avaient été oubliées — les deux refus pour compte
//   suspendu. Ces deux-là redirigent vers `/connexion` alors qu'on y est DÉJÀ :
//   pas de démontage, et le bouton restait figé sur « Connexion en cours… »
//   indéfiniment. Il fallait recharger la page à la main.
//
//   Le défaut n'était PAS propre à la suspension : toute exception levée dans
//   le handler produisait le même gel, en silence. L'énumération marche jusqu'au
//   jour où quelqu'un ajoute un chemin — ou jusqu'à la première exception, qui
//   n'est énumérable par personne.
//
//   Trois régressions à empêcher, et ce script existe pour ça :
//     R1 — le `finally` disparaît (réécriture, refactor « qui simplifie ») ;
//     R2 — un relâchement RÉAPPARAÎT dans le corps, hors du `finally` :
//          l'énumération repart, et le prochain chemin ajouté sera oublié ;
//     R3 — la garde de ré-entrance saute : le bouton redevient cliquable
//          pendant la navigation de succès, et un double envoi passe.
//
//   `/auth/callback` est traité à part : il n'a AUCUN drapeau et son état
//   d'attente est l'absence de verdict. Son immunité tient à son `catch` — le
//   script vérifie qu'elle tient toujours, et que personne n'y a glissé un
//   booléen de chargement sans appliquer le motif des deux autres.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-login-loading.mjs   → contrôles statiques. AUCUN accès base.
//
// LECTURE PURE : ce script n'écrit JAMAIS.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/** Retire les commentaires : un anti-pattern doit pouvoir être DOCUMENTÉ. */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/**
 * Corps d'un handler, isolé entre sa déclaration et sa première accolade
 * fermante en colonne 2 (`  }`). Chercher dans le fichier entier ferait dire au
 * diagnostic n'importe quoi : ces pages contiennent d'autres handlers.
 */
function bodyOf(src, declaration) {
  const start = src.indexOf(declaration)
  if (start === -1) return ''
  const end = src.indexOf('\n  }', start)
  return end === -1 ? src.slice(start) : src.slice(start, end)
}

/**
 * Découpe un corps en { avant le `finally`, dans le `finally` }.
 * C'est CE découpage qui donne son mordant au contrôle R2 : un relâchement
 * réapparu dans le corps tombe dans `beforeFinally`, jamais dans `inFinally`.
 */
function splitOnFinally(body) {
  const i = body.lastIndexOf('} finally {')
  if (i === -1) return { hasFinally: false, beforeFinally: body, inFinally: '' }
  return {
    hasFinally: true,
    beforeFinally: body.slice(0, i),
    inFinally: body.slice(i),
  }
}

const SCREENS = [
  {
    label: '/connexion',
    file: 'app/[locale]/connexion/page.tsx',
    handler: 'const handleSubmit = async () => {',
    flag: 'loading',
    release: 'setLoading(false)',
  },
  {
    label: '/nouveau-mot-de-passe',
    file: 'app/[locale]/nouveau-mot-de-passe/page.tsx',
    handler: 'const handleSubmit = async () => {',
    flag: 'submitting',
    release: 'setSubmitting(false)',
  },
]

// ═══ A. UN SEUL POINT DE RELÂCHEMENT, DANS LE `finally` ════════════════════
section('A. Le drapeau se relâche dans un finally')

for (const s of SCREENS) {
  const code = stripComments(read(s.file))
  const body = bodyOf(code, s.handler)
  const { hasFinally, beforeFinally, inFinally } = splitOnFinally(body)

  ok(body !== '', `${s.label} : handleSubmit localisé`)

  // R1 — le finally disparaît.
  ok(hasFinally, `${s.label} : le corps est enveloppé dans try { … } finally { … }`,
    'sans lui, tout chemin de sortie non énuméré fige le bouton — dont les exceptions')

  // R2 — le contrôle central : un relâchement réapparu HORS du finally.
  const strayCount = (beforeFinally.match(new RegExp(s.release.replace(/[()]/g, '\\$&'), 'g')) ?? []).length
  ok(strayCount === 0,
    `${s.label} : AUCUN ${s.release} hors du finally`,
    strayCount > 0
      ? `${strayCount} relâchement(s) énuméré(s) réapparu(s) — l’énumération repart, et le prochain chemin ajouté sera oublié`
      : undefined)

  ok(new RegExp(s.release.replace(/[()]/g, '\\$&')).test(inFinally),
    `${s.label} : le finally relâche bien ${s.release}`)

  // Un seul relâchement dans tout le handler : celui du finally.
  const total = (body.match(new RegExp(s.release.replace(/[()]/g, '\\$&'), 'g')) ?? []).length
  ok(total === 1, `${s.label} : exactement UN relâchement dans le handler (trouvé : ${total})`)

  // R3 — la garde de ré-entrance.
  ok(new RegExp(`if \\(${s.flag}\\) return`).test(body),
    `${s.label} : garde de ré-entrance \`if (${s.flag}) return\``,
    'le finally relâche le drapeau pendant que la navigation de succès est en vol')

  // La pose du drapeau doit rester AVANT le try, sinon le finally la relâcherait
  // sur des sorties qui ne l'ont jamais posée.
  const setTrue = body.indexOf(`set${s.flag[0].toUpperCase()}${s.flag.slice(1)}(true)`)
  const tryIdx = body.indexOf('try {')
  ok(setTrue !== -1 && tryIdx !== -1 && setTrue < tryIdx,
    `${s.label} : le drapeau est posé AVANT le try`)
}

// ═══ B. LES DEUX CHEMINS QUI AVAIENT ÉTÉ OUBLIÉS ═══════════════════════════
section('B. Les deux sorties oubliées, désormais couvertes')

const connexion = stripComments(read('app/[locale]/connexion/page.tsx'))
const connexionBody = bodyOf(connexion, 'const handleSubmit = async () => {')
const suspendedExits = (connexionBody.match(/router\.replace\('\/connexion\?reason=account_suspended'\)/g) ?? []).length
ok(suspendedExits === 2,
  `/connexion : les 2 sorties « compte suspendu » sont toujours là (trouvées : ${suspendedExits})`,
  'ce sont elles qui figeaient le bouton — si elles disparaissent, relire ce diag')
ok(splitOnFinally(connexionBody).hasFinally,
  '/connexion : ces deux sorties sont DANS le try, donc couvertes par le finally')

// ═══ C. /auth/callback — IMMUNISÉ, ET IL DOIT LE RESTER ════════════════════
section('C. /auth/callback : immunité par état terminal')

const callbackRaw = read('app/[locale]/auth/callback/page.tsx')
const callback = stripComments(callbackRaw)
// Le CORPS du catch, isolé — et pas un `setHasError(true)` quelconque : il y en
// a un autre plus haut, sur le chemin « session absente ». Cherché trop large,
// ce contrôle ne mordait pas quand on vidait le catch (constaté au test de
// mutation), ce qui en faisait un contrôle décoratif.
const catchStart = callback.indexOf('catch (err) {')
const catchBody =
  catchStart === -1 ? '' : callback.slice(catchStart, callback.indexOf('\n      }', catchStart))
ok(catchStart !== -1 && /setHasError\(true\)/.test(catchBody),
  'le catch de run() pose hasError — tout chemin aboutit à un état terminal',
  'c’est CE catch qui rend l’écran incapable de rester bloqué sur son spinner')
ok(/POURQUOI CET ÉCRAN NE PEUT PAS SE FIGER/.test(callbackRaw),
  'la propriété est DOCUMENTÉE sur place',
  'sans ce commentaire, la prochaine réécriture la perdrait sans le savoir')
// S'il acquiert un jour un drapeau, il doit acquérir le motif avec.
const hasLoadingFlag = /useState\(false\)/.test(callback) &&
  /const \[(loading|submitting|busy)\b/.test(callback)
ok(!hasLoadingFlag || /finally/.test(callback),
  'aucun drapeau de chargement sans finally associé',
  'un booléen d’attente introduit ici doit suivre le motif try/finally des deux autres écrans')

// ═══ D. CE QU'ON N'A PAS TOUCHÉ ════════════════════════════════════════════
section('D. secure-fetch et init-session intacts')

const secureFetch = stripComments(read('lib/secure-fetch.ts'))
ok(/export async function initSession/.test(secureFetch) && /return \{ ok: false, code: payload\?\.code \}/.test(secureFetch),
  'initSession remonte toujours le code de refus au call-site',
  'c’est ce retour qui permet aux écrans de login d’apprendre la suspension')
ok(/onSuspended/.test(secureFetch),
  'secure-fetch conserve son interception `account_suspended` (hors écrans de login)')

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC\n`)
process.exit(failures === 0 ? 0 : 1)
