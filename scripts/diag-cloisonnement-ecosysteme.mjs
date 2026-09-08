// scripts/diag-cloisonnement-ecosysteme.mjs — LA FALSIFICATION DE `x-subdomain`
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LA QUESTION, POSÉE FRANCHEMENT
//   `x-subdomain` est un en-tête. Un en-tête se falsifie : n'importe qui peut
//   en poser un autre et rejouer la requête. Toute la question est de savoir ce
//   que le serveur en fait — et la réponse ne doit jamais dépendre du bon
//   vouloir de l'appelant.
//
//   Un EXPERT appartient à UN écosystème, à vie. S'il en désigne un autre, il
//   doit être REFUSÉ. Pas averti, pas dégradé : refusé.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE FICHIER A ÉTÉ RÉÉCRIT — ET LA LEÇON QUI COMPTE
//   Sa première version importait le code applicatif par l'alias `@/`, que Node
//   ne connaît pas. Elle exigeait donc une invocation particulière :
//   `node --import ./scripts/_alias-register.mjs --env-file=.env.local …`.
//   Lancée normalement — c'est-à-dire par n'importe quel balayage
//   `scripts/diag-*.mjs` — elle s'arrêtait sur ERR_MODULE_NOT_FOUND.
//
//   Elle ne rendait alors NI vert NI rouge : elle ne vérifiait plus rien. Et
//   personne ne pouvait dire depuis quand, ce qui est très exactement le défaut
//   qu'un diagnostic est censé empêcher. Le pire est que mon propre balayage la
//   lançait avec l'invocation spéciale : elle était verte chez moi et morte
//   partout ailleurs.
//
//   UN DIAGNOSTIC DOIT TOURNER DEPUIS N'IMPORTE QUEL WORKTREE, SANS
//   PRÉPARATION. Celui-ci n'a plus ni chargeur, ni variable d'environnement, ni
//   réseau, ni base. Il suit la convention déjà en usage dans le dépôt : un
//   import relatif avec extension explicite.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'IL EXERCE, ET CE QU'IL LIT
//   La RÈGLE PAR POPULATION est exécutée pour de vrai : `ecosystem-scope.ts`
//   est un fichier pur, sans aucun import, donc chargeable tel quel. C'est la
//   décision « qui a droit à quoi », et elle est vérifiée en l'appelant.
//
//   La RÉSOLUTION (`ecosystem-guard.ts`) et la SANCTION (`auth-guard.ts`) sont
//   vérifiées sur le code : les exécuter demanderait une base et un jeton de
//   session, c'est-à-dire la préparation qu'on vient de supprimer. Ce choix est
//   dit, pas masqué.
//
//   HORS PÉRIMÈTRE, ET COUVERT AILLEURS : le filtre `domain_id` sur les
//   requêtes elles-mêmes appartient à `diag-ecosystem-scope.mjs`, qui découvre
//   les routes touchant une table cloisonnée. Ici on garde la FRONTIÈRE (qui
//   peut viser quel écosystème) ; là-bas on garde les REQUÊTES. La section (D)
//   vérifie que ce second contrôle existe toujours — sans lui, on croirait le
//   sujet couvert alors qu'il ne le serait plus qu'à moitié.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-cloisonnement-ecosysteme.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE variable d'environnement.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// Import RELATIF avec extension explicite — la convention du dépôt
// (cf. diag-lot2-socle, diag-expert-name-masking…). `ecosystem-scope.ts`
// n'importe rien : il se charge sans alias ni chargeur.
import { ecosystemAccessScope } from '../lib/ecosystem-scope.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// NORMALISATION DES FINS DE LIGNE (convention du dépôt) : le dépôt sort les
// fichiers en CRLF, et un retour chariot casse tout motif qui traverse un saut
// de ligne — vert chez son auteur, rouge dans les autres worktrees.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let echecs = 0
function ok(libelle, condition, detail = '') {
  if (condition) console.log(`  ✓ ${libelle}`)
  else {
    echecs++
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`)
  }
}
const titre = (s) => console.log(`\n=== ${s} ===`)

const GUARD = 'lib/ecosystem-guard.ts'
const AUTH = 'lib/auth-guard.ts'
const SCOPE = 'lib/ecosystem-scope.ts'
const DIAG_REQUETES = 'scripts/diag-ecosystem-scope.mjs'

for (const f of [GUARD, AUTH, SCOPE]) {
  if (!existsSync(join(ROOT, f))) {
    console.log(`\n  ✗ FICHIER ABSENT : ${f}\nLe diagnostic ne peut rien affirmer. ÉCHEC.\n`)
    process.exit(1)
  }
}
const guard = read(GUARD)
const auth = read(AUTH)

console.log("\n━━━ CLOISONNEMENT — un compte peut-il désigner un autre écosystème ? ━━━")

// ═══════════════════════════════════════════════════════════════════════════
// (A) LA RÈGLE PAR POPULATION — EXÉCUTÉE, pas relue
// ═══════════════════════════════════════════════════════════════════════════
titre('(A) qui a droit à quoi — la règle est appelée pour de vrai')

ok('un expert freelance est borné à SON écosystème', ecosystemAccessScope('expert_freelance') === 'own',
  `obtenu : ${ecosystemAccessScope('expert_freelance')}`)
ok('un expert CDI est borné à SON écosystème', ecosystemAccessScope('expert_cdi') === 'own',
  `obtenu : ${ecosystemAccessScope('expert_cdi')}`)

// Les organisations circulent, mais seulement sur des écosystèmes ACTIFS.
ok('un client circule sur les écosystèmes actifs', ecosystemAccessScope('client') === 'all_active',
  `obtenu : ${ecosystemAccessScope('client')}`)
ok('un cabinet circule sur les écosystèmes actifs', ecosystemAccessScope('cabinet') === 'all_active',
  `obtenu : ${ecosystemAccessScope('cabinet')}`)
ok('un admin atteint la plateforme entière', ecosystemAccessScope('admin') === 'platform',
  `obtenu : ${ecosystemAccessScope('admin')}`)

// LE TÉMOIN INVERSE : un type inconnu ne doit hériter d'AUCUN régime. C'est ce
// qui distingue une règle d'une liste — le défaut est le refus, jamais le
// régime le plus permissif.
for (const inconnu of ['inconnu', '', 'ADMIN', 'expert', null, undefined]) {
  ok(`un type « ${String(inconnu)} » ne reçoit aucun régime`, ecosystemAccessScope(inconnu) === null,
    `obtenu : ${ecosystemAccessScope(inconnu)}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// (B) LA RÉSOLUTION — l'expert ne franchit pas la frontière
// ═══════════════════════════════════════════════════════════════════════════
titre("(B) la résolution refuse l'écosystème d'autrui")

// LE contrôle central : un compte « own » visant un autre écosystème est refusé.
ok(
  'un compte borné à son écosystème est REFUSÉ ailleurs',
  /if \(scope === 'own' && target\.id !== userDomainId\) return deny\('domain_mismatch'\)/.test(guard),
  "la borne « son écosystème à vie » a disparu : un expert atteindrait un autre écosystème",
)

// Règle d'or : aucun écosystème par défaut. Un en-tête absent est une anomalie,
// pas une invitation à choisir à la place de l'appelant.
ok(
  'un en-tête absent est REFUSÉ (aucun rattachement implicite)',
  /if \(!headerSubdomain\) return deny\('domain_mismatch'\)/.test(guard),
  "l'absence d'en-tête vaudrait autorisation, sur un écosystème figé par défaut",
)

// Le slug est RÉSOLU en base, jamais comparé de chaîne à chaîne : sans cela un
// écosystème inexistant et l'écosystème d'autrui deviennent indistinguables.
ok(
  'le slug est résolu en base, pas comparé de chaîne à chaîne',
  /\.from\('domains'\)/.test(guard) && /\.eq\('slug', headerSubdomain\)/.test(guard),
)
ok('un écosystème inexistant est REFUSÉ', /return deny\('unknown_domain'\)/.test(guard))

// Une base muette ne vaut pas une autorisation.
ok(
  'une lecture en échec REFUSE au lieu de laisser passer',
  /return deny\('domain_lookup_failed'\)/.test(guard),
  'une base indisponible ouvrirait la frontière',
)
ok('un user_type inconnu est REFUSÉ', /return deny\('unknown_user_type'\)/.test(guard))

// Désactiver un écosystème, c'est cesser de l'OFFRIR — pas mettre à la porte
// les experts qui y travaillent.
ok(
  'un écosystème désactivé se ferme aux organisations, pas aux experts',
  /if \(scope === 'all_active' && !target\.active\) return deny\('domain_inactive'\)/.test(guard),
)

// ═══════════════════════════════════════════════════════════════════════════
// (C) LA SANCTION — le verdict est appliqué, sur l'en-tête REÇU
// ═══════════════════════════════════════════════════════════════════════════
titre('(C) requireAuth transmet l’en-tête reçu, et sanctionne le verdict')

ok(
  "l'arbitrage est appelé avec l'en-tête x-subdomain de la requête",
  /headerSubdomain:\s*request\.headers\.get\('x-subdomain'\)/.test(auth),
  "l'en-tête n'alimente plus l'arbitrage : la garde jugerait autre chose que ce que le client a envoyé",
)
ok(
  'un verdict négatif lève une AuthError 403',
  /if \(!access\.ok\) \{[\s\S]{0,400}?throw new AuthError\(403/.test(auth),
  'le refus serait calculé mais jamais appliqué',
)
ok(
  "la règle n'est écrite qu'une fois (importée, jamais recopiée)",
  auth.includes("from '@/lib/ecosystem-guard'") && !auth.includes('=== userDomainId'),
  'une seconde copie de la règle divergerait de la première',
)
ok(
  "aucun repli d'en-tête sur le jeton de session",
  !/request\.headers\.get\('x-session-token'\)/.test(auth),
  'un secret de session redeviendrait lisible en JavaScript',
)

// ═══════════════════════════════════════════════════════════════════════════
// (D) LE SECOND VERROU EXISTE TOUJOURS
// ═══════════════════════════════════════════════════════════════════════════
titre('(D) les requêtes, elles, sont gardées ailleurs — et ce garde existe')

ok(
  'diag-ecosystem-scope.mjs est toujours là',
  existsSync(join(ROOT, DIAG_REQUETES)),
  "le filtre domain_id sur les requêtes n'est plus surveillé par personne",
)
if (existsSync(join(ROOT, DIAG_REQUETES))) {
  const r = read(DIAG_REQUETES)
  ok(
    'il DÉCOUVRE les routes au lieu de tenir une liste',
    /readdirSync/.test(r),
    'une liste écrite à la main ignore la route ajoutée demain',
  )
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n━━━ ${echecs === 0 ? 'TOUT VERT' : `${echecs} ÉCHEC(S)`} ━━━\n`)
process.exit(echecs === 0 ? 0 : 1)
