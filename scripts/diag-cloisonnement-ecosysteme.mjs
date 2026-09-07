// scripts/diag-cloisonnement-ecosysteme.mjs — LA FALSIFICATION DE `x-subdomain`
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LA QUESTION, POSÉE FRANCHEMENT
//   `x-subdomain` est un en-tête. Un en-tête se falsifie : n'importe qui peut
//   en poser un autre et rejouer la requête. Toute la question est de savoir
//   ce que le serveur en fait — et la réponse ne doit pas dépendre du bon
//   vouloir de l'appelant.
//
//   Un EXPERT appartient à UN écosystème, à vie. S'il en désigne un autre, il
//   doit être REFUSÉ. Pas averti, pas dégradé : refusé.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE DIAGNOSTIC EXERCE, ET CE QU'IL N'EXERCE PAS
//   Il appelle la VRAIE fonction d'arbitrage — `resolveEcosystemAccess`,
//   importée depuis lib/, pas recopiée — avec de VRAIES lignes de la base. Une
//   copie de la règle resterait verte le jour où l'originale changerait, ce qui
//   est la pire des deux situations.
//
//   Il ne rejoue PAS une requête HTTP complète : cela demanderait de forger un
//   jeton de session, donc le secret JWT, qui n'est pas disponible ici. Ce que
//   la couche HTTP ajoute — appeler l'arbitrage avec l'en-tête reçu, et lever
//   un 403 sur son verdict — est donc vérifié STATIQUEMENT plus bas, section D.
//   Cette limite est dite plutôt que masquée.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node --import ./scripts/_alias-register.mjs --env-file=.env.local \
//        scripts/diag-cloisonnement-ecosysteme.mjs
//
// LECTURES SEULES. Aucune écriture, aucun compte créé, aucun domaine ajouté.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { resolveEcosystemAccess } from '@/lib/ecosystem-guard'
import { ecosystemAccessScope } from '@/lib/ecosystem-scope'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

let echecs = 0
function ok(libelle, condition, detail = '') {
  if (condition) console.log(`  ✓ ${libelle}`)
  else {
    echecs++
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`)
  }
}
const titre = (s) => console.log(`\n=== ${s} ===`)

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_SB || !SERVICE) {
  console.log("\nABANDON : variables d'environnement absentes.")
  console.log('  node --import ./scripts/_alias-register.mjs --env-file=.env.local scripts/diag-cloisonnement-ecosysteme.mjs\n')
  process.exit(2)
}
const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } })

console.log("\n━━━ CLOISONNEMENT — un expert peut-il désigner un autre écosystème ? ━━━")

// ───────────────────────────────────────────────────────────────────────────
// (A) Les faits, lus en base
// ───────────────────────────────────────────────────────────────────────────
titre('(A) le terrain')

const { data: domaines, error: errDom } = await admin.from('domains').select('id, slug, active')
ok('les écosystèmes sont lisibles', !errDom && Array.isArray(domaines), errDom?.message)
const { data: experts, error: errExp } = await admin
  .from('users')
  .select('id, user_type, domain_id')
  .in('user_type', ['expert_freelance', 'expert_cdi'])
  .limit(1)
ok('au moins un compte expert existe', !errExp && (experts ?? []).length > 0, errExp?.message)

if (echecs > 0) {
  console.log('\nLe terrain manque : le diagnostic ne peut rien affirmer. ÉCHEC.\n')
  process.exit(1)
}

const expert = experts[0]
const sien = domaines.find((d) => d.id === expert.domain_id) ?? null
console.log(`  écosystèmes en base : ${domaines.map((d) => d.slug).join(', ')} (${domaines.length})`)
console.log(`  expert de test : ${expert.user_type}, écosystème « ${sien?.slug ?? '?'} »`)

// ───────────────────────────────────────────────────────────────────────────
// (B) LE TEST EXIGÉ — l'expert désigne un AUTRE écosystème
// ───────────────────────────────────────────────────────────────────────────
titre("(B) l'expert falsifie x-subdomain vers un autre écosystème")

const arbitrer = (headerSubdomain, userDomainId, ownDomain, userType = expert.user_type) =>
  resolveEcosystemAccess({
    admin,
    headerSubdomain,
    userType,
    userDomainId,
    ownDomain,
    logTag: 'diag-cloisonnement',
  })

// B1 — un écosystème qui EXISTE, mais qui n'est pas le sien.
//   La base n'en contient qu'un seul aujourd'hui, donc « un autre écosystème
//   existant » ne peut pas être lu : on le fabrique en désignant l'écosystème
//   RÉEL alors que le compte appartient à un AUTRE. Aucune ligne n'est créée —
//   c'est le paramètre d'entrée de l'arbitrage qui change, exactement ce que
//   la couche HTTP lui transmet.
const AUTRE_ID = '00000000-0000-4000-8000-0000000000ff'
const autreEcosysteme = domaines[0]
const b1 = await arbitrer(autreEcosysteme.slug, AUTRE_ID, null)
ok(
  `un expert d'un autre écosystème visant « ${autreEcosysteme.slug} » est REFUSÉ`,
  b1.ok === false,
  b1.ok ? 'ACCÈS ACCORDÉ — le cloisonnement ne tient pas' : '',
)
ok(
  "le refus est bien un domain_mismatch",
  b1.ok === false && b1.denial.code === 'domain_mismatch',
  b1.ok === false ? `code obtenu : ${b1.denial.code}` : '',
)

// B2 — un écosystème qui n'existe pas du tout.
const b2 = await arbitrer('ecosysteme-inexistant-' + Date.now(), expert.domain_id, sien)
ok(
  "un slug inventé est REFUSÉ",
  b2.ok === false,
  b2.ok ? 'ACCÈS ACCORDÉ sur un écosystème inexistant' : '',
)
ok(
  "le refus nomme l'écosystème inconnu (incident diagnosticable)",
  b2.ok === false && b2.denial.code === 'unknown_domain',
  b2.ok === false ? `code obtenu : ${b2.denial.code}` : '',
)

// B3 — en-tête ABSENT. Règle d'or : aucun écosystème par défaut.
const b3 = await arbitrer(null, expert.domain_id, sien)
ok(
  "un en-tête absent est REFUSÉ (aucun rattachement implicite)",
  b3.ok === false,
  b3.ok ? "l'absence d'en-tête vaut autorisation — écosystème figé par défaut" : '',
)

// B4 — en-tête VIDE, la variante qu'on oublie.
const b4 = await arbitrer('', expert.domain_id, sien)
ok("un en-tête vide est REFUSÉ", b4.ok === false)

// ───────────────────────────────────────────────────────────────────────────
// (C) LE TÉMOIN — sans lui, une fonction qui refuse TOUT passerait le test
// ───────────────────────────────────────────────────────────────────────────
titre('(C) le témoin : le cas légitime doit PASSER')

const c1 = await arbitrer(sien?.slug ?? '', expert.domain_id, sien)
ok(
  `l'expert accède à SON écosystème (« ${sien?.slug} »)`,
  c1.ok === true,
  c1.ok === false
    ? `REFUSÉ (${c1.denial.code}) — la garde ne cloisonne pas, elle ferme tout`
    : '',
)

// Et la règle par population reste celle attendue.
ok("un expert freelance est borné à son écosystème", ecosystemAccessScope('expert_freelance') === 'own')
ok("un expert CDI est borné à son écosystème", ecosystemAccessScope('expert_cdi') === 'own')
ok("un type inconnu ne reçoit AUCUN régime", ecosystemAccessScope('inconnu') === null)

// ───────────────────────────────────────────────────────────────────────────
// (D) CE QUE LA COUCHE HTTP AJOUTE — vérifié sur le code
// ───────────────────────────────────────────────────────────────────────────
titre("(D) requireAuth transmet l'en-tête reçu, et sanctionne le verdict")

const guard = read('lib/auth-guard.ts')
ok(
  "l'arbitrage est appelé avec l'en-tête x-subdomain de la requête",
  /headerSubdomain:\s*request\.headers\.get\('x-subdomain'\)/.test(guard),
  "l'en-tête n'alimente plus l'arbitrage : la garde jugerait autre chose que ce que le client a envoyé",
)
ok(
  'un verdict négatif lève une AuthError 403',
  /if \(!access\.ok\) \{[\s\S]{0,400}?throw new AuthError\(403/.test(guard),
  'le refus est calculé mais pas appliqué',
)
ok(
  "la règle n'est écrite qu'une fois (importée, jamais recopiée)",
  guard.includes("from '@/lib/ecosystem-guard'") && !guard.includes('=== userDomainId'),
)

// ── L'EN-TÊTE x-session-token A ÉTÉ RETIRÉ ────────────────────────────────
//   Il offrait un repli non-httpOnly à un secret de session, gardé par une
//   simple variable d'environnement. Une porte de service dont la serrure est
//   un réglage n'est pas fermée : elle l'est tant que personne ne se trompe.
ok(
  "aucun repli d'en-tête sur le jeton de session",
  !guard.includes('x-session-token') || !/request\.headers\.get\('x-session-token'\)/.test(guard),
  "le repli x-session-token est revenu : un secret de session redevient lisible en JavaScript",
)
ok(
  'le jeton de session ne vient QUE du cookie httpOnly',
  /const clientToken = readSessionCookieToken\(request\)/.test(guard),
)

// ───────────────────────────────────────────────────────────────────────────
console.log(`\n━━━ ${echecs === 0 ? 'TOUT VERT' : `${echecs} ÉCHEC(S)`} ━━━\n`)
process.exit(echecs === 0 ? 0 : 1)
