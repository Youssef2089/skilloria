// scripts/diag-publication-gate.mjs — la gate qualité des annonces, ÉPROUVÉE
// EN L'EXÉCUTANT.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   lib/verification/ai-publication-quality.ts décide seul si une annonce est
//   PUBLIÉE automatiquement ou part en revue admin. Deux défauts viennent d'y
//   être corrigés, et tous deux étaient invisibles à la relecture :
//
//     1. UN VERDICT FABRIQUÉ. Si l'IA renvoyait un JSON lisible mais sans
//        champ `score`, le code posait 5. Ce 5 n'était le jugement de
//        personne : selon le seuil configuré en base, il pouvait PUBLIER une
//        annonce que rien n'avait évaluée. Même défaut, en pire, sur `flags` :
//        un tableau vide de repli affirmait « aucun contournement, aucune
//        discrimination, aucune illégalité » — le verdict le plus lourd du
//        fichier, rendu par défaut, dans le sens qui publie.
//
//     2. UN REPLI QUI NE SE DÉCLENCHAIT PRESQUE JAMAIS. Le repli Haiku →
//        Sonnet testait le MESSAGE de l'erreur avec une expression régulière.
//        Une panne réseau, une surcharge (429) ou un délai dépassé n'y
//        correspondaient pas : aucun second essai, revue admin directe. À
//        l'inverse, rien n'empêchait de réessayer sur une clé invalide, ce qui
//        ne peut que coûter.
//
//   Ces deux corrections tiennent à des cas limites — champ absent, chaîne
//   numérique, tableau vide contre clé absente, 401 contre 429. Relire le code
//   ne prouve rien ; l'exécuter, si.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE LE DIAG VÉRIFIE
//   A. Lecture du score      — aucune valeur de repli : l'absence est un échec.
//   B. Lecture des flags     — clé absente = échec ; tableau vide = verdict.
//   C. Classement des échecs — le repli couvre le transitoire (429, 5xx,
//                              délai, réseau, modèle inconnu) et JAMAIS
//                              l'authentification (401/403) ni la requête
//                              malformée (400).
//   D. Bout en bout          — la fonction complète, `fetch` remplacé par un
//                              double local : réponse sans score → revue
//                              admin ; 401 → aucun second appel ; 500 →
//                              second appel sur le modèle de repli.
//   E. Forme du code         — les deux pièges retirés ne reviennent pas.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-publication-gate.mjs
//
// AUCUN accès base, AUCUNE variable d'environnement lue, AUCUN réseau : la
// section D remplace `globalThis.fetch` par un double local et pose une fausse
// clé API dans le processus. Rien ne sort de la machine.
//
// Node 24 retire les annotations de type nativement (`process.features
// .typescript === 'strip'`) : on importe donc le module .ts DIRECTEMENT, comme
// diag-expert-name-masking.mjs.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  readPublicationScore,
  readPublicationFlags,
  isRetryableFailure,
  verifyAiPublicationQuality,
} from '../lib/verification/ai-publication-quality.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const SOURCE = 'lib/verification/ai-publication-quality.ts'

/**
 * Retire les commentaires avant de chercher un anti-pattern. Sans ça, ce diag
 * interdirait de DOCUMENTER le piège qu'il surveille : le module explique en
 * toutes lettres pourquoi le repli à 5 était faux, et cette phrase suffisait à
 * déclencher l'alerte. Même correctif que dans diag-suspension.
 */
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
const eq = (actual, expected, label) =>
  ok(
    actual === expected,
    `${label} → ${JSON.stringify(actual)}`,
    actual === expected ? undefined : `attendu ${JSON.stringify(expected)}`,
  )
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

// ══════════════════════════════════════════════════════════════════════════
section('A. LECTURE DU SCORE — aucune valeur de repli')
// ══════════════════════════════════════════════════════════════════════════
//
// La règle : `null` signifie « l'IA n'a pas jugé ». TOUT ce qui n'est pas un
// nombre exploitable doit rendre `null`, jamais un chiffre inventé. Le piège
// visé est le 5 historique, mais aussi les valeurs que `Number()` convertit
// silencieusement (null → 0, true → 1, [] → 0, "" → 0) : un 0 fabriqué serait
// tout autant un verdict que personne n'a rendu.

console.log('— un score rendu par l\'IA est lu tel quel')
eq(readPublicationScore(8), 8, 'score 8')
eq(readPublicationScore(0), 0, 'score 0 (verdict légitime le plus bas)')
eq(readPublicationScore(10), 10, 'score 10')
eq(readPublicationScore(7.4), 7, 'score 7.4 arrondi')
eq(readPublicationScore(7.6), 8, 'score 7.6 arrondi')
eq(readPublicationScore(42), 10, 'score hors barème borné à 10')
eq(readPublicationScore(-3), 0, 'score négatif borné à 0')
eq(readPublicationScore('8'), 8, 'chaîne numérique "8" (modèle mal typé)')
eq(readPublicationScore(' 8 '), 8, 'chaîne numérique espacée')

console.log('\n— aucun score exploitable → null, JAMAIS un chiffre')
eq(readPublicationScore(undefined), null, 'champ absent  (le défaut corrigé)')
eq(readPublicationScore(null), null, 'null           (Number() en ferait 0)')
eq(readPublicationScore(''), null, 'chaîne vide    (Number() en ferait 0)')
eq(readPublicationScore('   '), null, 'espaces        (Number() en ferait 0)')
eq(readPublicationScore([]), null, 'tableau vide   (Number() en ferait 0)')
eq(readPublicationScore(true), null, 'true           (Number() en ferait 1)')
eq(readPublicationScore('bien'), null, 'texte non numérique')
eq(readPublicationScore(NaN), null, 'NaN')
eq(readPublicationScore(Infinity), null, 'Infini')
eq(readPublicationScore({ score: 8 }), null, 'objet imbriqué')

// ══════════════════════════════════════════════════════════════════════════
section('B. LECTURE DES FLAGS — clé absente ≠ tableau vide')
// ══════════════════════════════════════════════════════════════════════════
//
// La distinction est TOUT le sujet : `[]` est un verdict (« j'ai regardé,
// rien à signaler ») ; l'absence de clé n'en est pas un. Les confondre, c'est
// publier automatiquement une annonce dont les axes bloquants — contournement
// de plateforme, discrimination, illégalité — n'ont jamais été examinés.

const flagsOf = (v) => { const r = readPublicationFlags(v); return r === null ? null : r.join('|') }

console.log('— un verdict rendu est conservé')
eq(flagsOf([]), '', 'tableau vide = « aucun signalement », verdict VALIDE')
eq(flagsOf(['spam']), 'spam', 'un flag')
eq(flagsOf(['contact_info', 'illegal']), 'contact_info|illegal', 'deux flags bloquants')
eq(flagsOf(['spam', 'spam']), 'spam', 'doublon dédoublonné')
eq(flagsOf(['spam', 'invente']), 'spam', 'libellé inconnu ignoré, le reste conservé')
eq(flagsOf([1, 'spam', null]), 'spam', 'éléments non-chaîne ignorés')

console.log('\n— aucun verdict rendu → null, JAMAIS un tableau vide')
eq(flagsOf(undefined), null, 'clé absente    (le défaut corrigé)')
eq(flagsOf(null), null, 'null')
eq(flagsOf('spam'), null, 'chaîne au lieu d\'un tableau')
eq(flagsOf({ 0: 'spam' }), null, 'objet au lieu d\'un tableau')

// ══════════════════════════════════════════════════════════════════════════
section('C. CLASSEMENT DES ÉCHECS — qui mérite un second essai')
// ══════════════════════════════════════════════════════════════════════════

const netErr = (name, message) => { const e = new Error(message ?? name); e.name = name; return e }

console.log('— TRANSITOIRE : un second essai a une chance d\'aboutir')
eq(isRetryableFailure({ status: 500 }), true, '500 panne fournisseur')
eq(isRetryableFailure({ status: 502 }), true, '502')
eq(isRetryableFailure({ status: 503 }), true, '503 service indisponible')
eq(isRetryableFailure({ status: 529 }), true, '529 surcharge Anthropic')
eq(isRetryableFailure({ status: 429 }), true, '429 quota de débit')
eq(isRetryableFailure({ status: 408 }), true, '408 délai dépassé côté API')
eq(isRetryableFailure({ status: 404 }), true, '404 modèle inconnu → l\'autre existe peut-être')
eq(isRetryableFailure(netErr('APIConnectionError', 'Connection error.')), true, 'coupure réseau (SDK)')
eq(isRetryableFailure(netErr('APIConnectionTimeoutError', 'Request timed out.')), true, 'délai dépassé (SDK)')
eq(isRetryableFailure(netErr('AbortError', 'The operation was aborted')), true, 'appel abandonné')
eq(isRetryableFailure(netErr('Error', 'fetch failed')), true, 'fetch failed')
eq(isRetryableFailure(netErr('Error', 'socket hang up')), true, 'socket hang up')
eq(isRetryableFailure(netErr('Error', 'connect ECONNRESET 1.2.3.4:443')), true, 'ECONNRESET')
eq(isRetryableFailure(netErr('Error', 'getaddrinfo ENOTFOUND api.anthropic.com')), true, 'ENOTFOUND')

console.log('\n— DÉFINITIF : réessayer ne ferait que coûter')
eq(isRetryableFailure({ status: 401 }), false, '401 clé absente ou invalide')
eq(isRetryableFailure({ status: 403 }), false, '403 droits insuffisants')
eq(isRetryableFailure({ status: 400 }), false, '400 requête malformée')
eq(isRetryableFailure({ status: 413 }), false, '413 charge utile trop grande')
eq(isRetryableFailure({ status: 422 }), false, '422 entité non traitable')
eq(
  isRetryableFailure(netErr('Error', 'invalid x-api-key')),
  false,
  'clé invalide décrite en toutes lettres, SANS code HTTP',
)
eq(isRetryableFailure(netErr('Error', 'quelque chose d\'inconnu')), false, 'échec non classable → sens sûr (revue admin)')

// Garde-fou contre une régression subtile : l'ancien code testait le MESSAGE.
// Un 401 dont le message contient « model » devait donc être rejoué. Plus
// maintenant : c'est le code HTTP qui tranche, le texte ne peut plus le
// contredire.
eq(
  isRetryableFailure(Object.assign(new Error('invalid_request: model access denied'), { status: 401 })),
  false,
  '401 dont le message parle de « model » → toujours définitif',
)

// ══════════════════════════════════════════════════════════════════════════
section('D. BOUT EN BOUT — la fonction complète, sans réseau')
// ══════════════════════════════════════════════════════════════════════════
//
// `globalThis.fetch` est remplacé par un double local : aucun octet ne sort.
// Ce qui est prouvé ici et pas en A/B/C, c'est le CÂBLAGE — que les lectures
// strictes sont bien celles qu'utilise la fonction, et que le repli s'appelle
// au bon moment sur le bon modèle.

const realFetch = globalThis.fetch
const realKey = process.env.ANTHROPIC_API_KEY
process.env.ANTHROPIC_API_KEY = 'diag-fausse-cle-aucun-appel-reel'

const ANNONCE = {
  type: 'mission',
  title: 'Consultant intégration — annonce de diagnostic',
  description: 'Annonce fictive utilisée par le diagnostic. Aucun appel réseau.',
  skills_required: ['integration'],
  locale: 'fr',
}

/** Corps de réponse Anthropic minimal portant le texte donné. */
const messageBody = (text) => ({
  id: 'msg_diag',
  type: 'message',
  role: 'assistant',
  model: 'diag',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
})

/**
 * Installe un double de `fetch`. `plan(model)` rend `{ status, text }`.
 * Les modèles réellement appelés sont collectés pour prouver (ou réfuter) le
 * déclenchement du repli — y compris les reprises internes du SDK.
 */
function stubFetch(plan) {
  const models = []
  globalThis.fetch = async (url, init) => {
    let model = '(inconnu)'
    try { model = JSON.parse(init?.body ?? '{}').model ?? '(inconnu)' } catch { /* corps illisible */ }
    models.push(model)
    const { status, text } = plan(model)
    const body = status === 200
      ? JSON.stringify(messageBody(text))
      : JSON.stringify({ type: 'error', error: { type: 'diag_error', message: `statut ${status}` } })
    return new Response(body, { status, headers: { 'content-type': 'application/json' } })
  }
  return models
}

try {
  console.log('— réponse complète : le verdict de l\'IA passe intact')
  {
    stubFetch(() => ({ status: 200, text: '{"score": 9, "notes": "Annonce claire.", "flags": []}' }))
    const r = await verifyAiPublicationQuality(ANNONCE)
    eq(r.result, 'ok', 'result')
    eq(r.score, 9, 'score')
    eq(r.flags.length, 0, 'flags')
  }

  console.log('\n— réponse complète avec un flag bloquant : transmis tel quel')
  {
    stubFetch(() => ({ status: 200, text: '{"score": 2, "notes": "Email en clair.", "flags": ["contact_info"]}' }))
    const r = await verifyAiPublicationQuality(ANNONCE)
    eq(r.result, 'ok', 'result')
    eq(r.flags.join('|'), 'contact_info', 'flags')
  }

  console.log('\n— JSON lisible SANS score → échec, jamais un 5 (LE défaut corrigé)')
  {
    stubFetch(() => ({ status: 200, text: '{"notes": "Analyse partielle.", "flags": []}' }))
    const r = await verifyAiPublicationQuality(ANNONCE)
    eq(r.result, 'error', 'result')
    eq(r.score, 0, 'score neutralisé')
    ok(/[Ss]core/.test(r.notes), 'la note dit que le score manque', `note obtenue : ${r.notes}`)
    ok(r.score !== 5, 'le 5 fabriqué ne revient pas')
  }

  console.log('\n— JSON lisible avec un score NON NUMÉRIQUE → échec')
  {
    stubFetch(() => ({ status: 200, text: '{"score": "excellent", "notes": "x", "flags": []}' }))
    const r = await verifyAiPublicationQuality(ANNONCE)
    eq(r.result, 'error', 'result')
    eq(r.score, 0, 'score neutralisé')
  }

  console.log('\n— JSON lisible SANS flags → échec (axes bloquants non évalués)')
  {
    stubFetch(() => ({ status: 200, text: '{"score": 9, "notes": "Annonce claire."}' }))
    const r = await verifyAiPublicationQuality(ANNONCE)
    eq(r.result, 'error', 'result')
    eq(r.flags.length, 0, 'aucun flag affirmé')
    ok(/ignalements|flags/i.test(r.notes), 'la note dit que les signalements manquent', `note obtenue : ${r.notes}`)
  }

  console.log('\n— réponse hors JSON → échec (comportement historique, préservé)')
  {
    stubFetch(() => ({ status: 200, text: 'Je ne peux pas répondre en JSON.' }))
    const r = await verifyAiPublicationQuality(ANNONCE)
    eq(r.result, 'error', 'result')
    eq(r.score, 0, 'score')
  }

  console.log('\n— 401 sur le modèle principal → AUCUN second essai')
  {
    const models = stubFetch(() => ({ status: 401 }))
    const r = await verifyAiPublicationQuality(ANNONCE)
    eq(r.result, 'error', 'result')
    ok(
      !models.includes('claude-sonnet-4-6'),
      `le modèle de repli n'est jamais appelé (modèles vus : ${models.join(', ') || 'aucun'})`,
      'une clé invalide rejouée sur Sonnet coûterait sans rien résoudre',
    )
  }

  console.log('\n— 400 requête malformée → AUCUN second essai')
  {
    const models = stubFetch(() => ({ status: 400 }))
    const r = await verifyAiPublicationQuality(ANNONCE)
    eq(r.result, 'error', 'result')
    ok(!models.includes('claude-sonnet-4-6'), 'le modèle de repli n\'est jamais appelé')
  }

  console.log('\n— 500 sur le principal, 200 sur le repli → verdict rendu')
  {
    const models = stubFetch((model) =>
      model === 'claude-sonnet-4-6'
        ? { status: 200, text: '{"score": 8, "notes": "Rendu par le repli.", "flags": []}' }
        : { status: 500 },
    )
    const r = await verifyAiPublicationQuality(ANNONCE)
    ok(models.includes('claude-sonnet-4-6'), 'le repli a bien été tenté', `modèles vus : ${models.join(', ')}`)
    eq(r.result, 'ok', 'result')
    eq(r.score, 8, 'score rendu par le modèle de repli')
  }

  console.log('\n— coupure réseau sur le principal, repli disponible → verdict rendu')
  {
    const models = []
    globalThis.fetch = async (url, init) => {
      let model = '(inconnu)'
      try { model = JSON.parse(init?.body ?? '{}').model ?? '(inconnu)' } catch { /* corps illisible */ }
      models.push(model)
      if (model === 'claude-sonnet-4-6') {
        return new Response(
          JSON.stringify(messageBody('{"score": 7, "notes": "Rendu apres coupure.", "flags": []}')),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      const e = new Error('fetch failed')
      e.name = 'TypeError'
      throw e
    }
    const r = await verifyAiPublicationQuality(ANNONCE)
    ok(models.includes('claude-sonnet-4-6'), 'le repli a bien été tenté', `modèles vus : ${models.join(', ')}`)
    eq(r.result, 'ok', 'result')
    eq(r.score, 7, 'score rendu par le modèle de repli')
  }
} finally {
  globalThis.fetch = realFetch
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = realKey
}

// ══════════════════════════════════════════════════════════════════════════
section('E. FORME DU CODE — les pièges retirés ne reviennent pas')
// ══════════════════════════════════════════════════════════════════════════

const src = stripComments(read(SOURCE))

ok(
  !/parsed\.score\s*:\s*-?\d/.test(src),
  'aucune valeur numérique de repli pour le score',
  'un `typeof parsed.score === \'number\' ? parsed.score : 5` est de retour',
)
ok(
  /readPublicationScore\(parsed\.score\)/.test(src),
  'le score passe par la lecture stricte',
)
ok(
  /readPublicationFlags\(parsed\.flags\)/.test(src),
  'les flags passent par la lecture stricte',
)
ok(
  !/function\s+isModelError/.test(src),
  'le classement par message seul (isModelError) a disparu',
  'le repli redeviendrait aveugle aux pannes réseau et aux surcharges',
)
ok(
  /isRetryableFailure\(err\)/.test(src),
  'le repli est conditionné au classement transitoire/définitif',
)
ok(
  /TOTAL_BUDGET_MS/.test(src) && /MIN_RETRY_BUDGET_MS/.test(src),
  'le budget de temps est partagé entre les essais',
  'deux essais pleins dépasseraient le maxDuration de la route /publish',
)

// ══════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ Tous les contrôles passent.\n'
    : `\n❌ ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
