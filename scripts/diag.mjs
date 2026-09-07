// scripts/diag.mjs — LE LANCEUR DE DIAGNOSTICS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE
//
//   1. UN PLANTAGE SE FAISAIT PASSER POUR UN ÉCHEC.
//      Trois diagnostics du dépôt plantent AVANT d'assertionner quoi que ce
//      soit : import introuvable, alias non résolu, TypeError sur `null`. Une
//      boucle qui ne regarde que le code de sortie les range avec les rouges —
//      or un rouge VÉRIFIE et conclut « c'est faux », tandis qu'un plantage ne
//      vérifie RIEN et ne conclut rien. Ils couvrent la vérification des
//      experts, le moteur de mise en relation et la messagerie : trois pans
//      entiers du produit n'étaient plus surveillés, et l'affichage disait
//      « rouge », ce qui rassurait presque.
//
//      D'où TROIS ÉTATS, et jamais deux : VERT / ROUGE / N'A PAS TOURNÉ.
//      Le décompte les sépare, et les muets sont listés EN PREMIER — un
//      « 24 verts, 5 rouges » qui tait 6 muets est un mensonge par omission.
//
//   2. LANCER TOUT LES DIAGNOSTICS POUVAIT ÉCRIRE EN BASE.
//      Huit d'entre eux lisent `.env.local` EUX-MÊMES : ils atteignent donc la
//      base sans qu'on leur passe le moindre argument. Deux de ceux-là
//      (`diag-lot2b-expert`, `diag-lot2c-org`) font des INSERT, UPDATE et
//      DELETE sur candidatures, conversations et matches — ce sont des tests de
//      bout en bout, pas des contrôles statiques.
//
//      Un lanceur naïf « pour tout vérifier » aurait donc MODIFIÉ la base à
//      chaque exécution. Le lanceur les ÉCARTE par défaut, en le disant, et ne
//      les exécute que sur `--avec-base`, demandé explicitement.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag.mjs              → tous les diagnostics STATIQUES.
//                                        Aucun accès base, aucune écriture.
//   node scripts/diag.mjs --avec-ecritures
//                                      → y compris ceux qui MODIFIENT la base.
//                                        À n'utiliser qu'en connaissance de cause.
//   node scripts/diag.mjs --detail     → affiche la sortie complète des
//                                        diagnostics non verts.
//   node scripts/diag.mjs <motif>      → n'exécute que les noms contenant le motif.
//
// Code de sortie : 0 si tout est vert. Non nul dès qu'un diagnostic est ROUGE
// ou N'A PAS TOURNÉ — un muet compte autant qu'un rouge, c'est le principe.

import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SCRIPTS = dirname(fileURLToPath(import.meta.url))
const MOI = 'diag.mjs'
const DELAI_MS = 120_000

const args = process.argv.slice(2)
const avecEcritures = args.includes('--avec-ecritures')
const detail = args.includes('--detail')
const motif = args.find((a) => !a.startsWith('--')) ?? null

const G = '\x1b[32m', R = '\x1b[31m', J = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', N = '\x1b[0m'

/**
 * Retire les commentaires — de bloc ET de ligne.
 *
 * ⚠️ INDISPENSABLE, et ce n'est pas une précaution de style. Presque tous les
 *    diagnostics documentent en tête comment les lancer :
 *      `node --env-file=.env.local scripts/diag-truc.mjs --db`
 *    Chercher `.env.local` dans le fichier ENTIER classait donc dix-neuf
 *    scripts sur trente-cinq comme « atteint la base », sur la foi de leur mode
 *    d'emploi. Un contrôle qui se déclenche sur la DOCUMENTATION de la règle
 *    qu'il applique finit par être désactivé — c'est le même piège que celui
 *    déjà rencontré deux fois dans ce dépôt.
 */
const sansCommentaires = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/**
 * Un diagnostic ATTEINT-IL LA BASE tout seul ?
 *
 * Décidé sur sa SOURCE, sans l'exécuter — c'est tout l'intérêt : on ne peut pas
 * apprendre qu'un script écrit en le lançant.
 *
 * ┌─ POURQUOI CETTE LISTE EST TENUE À LA MAIN, ET NE PEUT PAS L'ÊTRE AUTREMENT ┐
 * │ J'ai essayé de la déduire de la source, et les deux tentatives étaient     │
 * │ fausses, chacune dans un sens :                                            │
 * │                                                                            │
 * │  · chercher `.env.local` écartait DIX-NEUF scripts sur trente-cinq, parce  │
 * │    qu'ils le nomment dans leur mode d'emploi — d'abord en commentaire,     │
 * │    puis, une fois les commentaires retirés, dans un `console.log` d'aide.  │
 * │                                                                            │
 * │  · chercher `.insert(` / `.update(` pour repérer les écritures désignait   │
 * │    des diagnostics qui CHERCHENT ce motif dans le code source du projet.   │
 * │    Ils en contiennent le texte sans jamais l'exécuter.                     │
 * │                                                                            │
 * │ Un diagnostic qui parle d'une chose n'est pas un diagnostic qui la fait.   │
 * │ La seule méthode fiable est de LIRE le script — et c'est aussi la règle    │
 * │ du dépôt avant d'exécuter un script qu'on n'a pas écrit.                   │
 * │                                                                            │
 * │ La liste est donc explicite, courte, et relue. Le contrôle de péremption   │
 * │ ci-dessous signale toute entrée dont le fichier a disparu — même procédé   │
 * │ que les inventaires de `diag-ecosystem-scope`.                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
const ECRIVENT_EN_BASE = {
  'diag-lot2b-expert':
    'INSERT/UPDATE/DELETE sur matches et candidatures — test de bout en bout, pas un contrôle statique',
  'diag-lot2c-org':
    'INSERT/UPDATE/DELETE sur candidatures et conversations — idem, et il (ré)injecte une candidature',
}

function ecritEnBase(nom) {
  return Object.prototype.hasOwnProperty.call(ECRIVENT_EN_BASE, nom)
}

/**
 * Le processus a-t-il PLANTÉ, ou a-t-il conclu ?
 *
 * On ne se fie pas au seul code de sortie : un diagnostic qui conclut « c'est
 * faux » sort en 1, exactement comme un module introuvable. La différence se lit
 * dans la sortie d'erreur — trace de pile Node, code `ERR_*`, assertion native —
 * ou dans le signal qui a tué le processus.
 */
const SIGNES_DE_PLANTAGE = [
  /\bERR_[A-Z_]+\b/, // ERR_MODULE_NOT_FOUND, ERR_PACKAGE_PATH_NOT_EXPORTED…
  /Assertion failed:/, // assertion native libuv/V8
  /\n\s+at\s+.+:\d+:\d+/, // trace de pile
  /node:internal[/\\]/, // pile interne Node
  /^\s*(TypeError|ReferenceError|SyntaxError|RangeError):/m,
]

function aPlante(stderr, signal) {
  if (signal) return `tué par le signal ${signal}`
  const trouve = SIGNES_DE_PLANTAGE.find((re) => re.test(stderr))
  if (!trouve) return null
  const ligne = stderr
    .split('\n')
    .find((l) => l.trim() && !/^\s+at /.test(l))
    ?.trim()
  return ligne ? ligne.slice(0, 160) : 'plantage sans message exploitable'
}

/**
 * Environnement de l'enfant, PRIVÉ DES SECRETS.
 *
 * Ceinture et bretelles : les diagnostics écartés ci-dessus lisent `.env.local`
 * sur le disque et ne sont donc pas arrêtés par ce retrait. Mais si le lanceur
 * est lui-même appelé avec `--env-file`, ce retrait empêche les AUTRES de
 * joindre la base par accident. Un contrôle statique n'a rien à y faire.
 */
function envSansSecrets() {
  const e = { ...process.env }
  for (const k of Object.keys(e)) {
    if (/^(NEXT_PUBLIC_)?SUPABASE_|^STRIPE_|^ANTHROPIC_|^VONAGE_|^RESEND_|^SIRENE_/.test(k)) {
      delete e[k]
    }
  }
  return e
}

// ─── Péremption de la liste : une entrée dont le fichier a disparu ment ──────
for (const nom of Object.keys(ECRIVENT_EN_BASE)) {
  if (!readdirSync(SCRIPTS).includes(`${nom}.mjs`)) {
    console.log(`${J}≡ Entrée périmée dans ECRIVENT_EN_BASE : ${nom} n'existe plus. À retirer.${N}`)
  }
}

// ─── Découverte ──────────────────────────────────────────────────────────────
const fichiers = readdirSync(SCRIPTS)
  .filter((f) => f.startsWith('diag-') && f.endsWith('.mjs'))
  .filter((f) => f !== MOI)
  .filter((f) => (motif ? f.includes(motif) : true))
  .sort()

const verts = []
const rouges = []
const muets = []

const envEnfant = envSansSecrets()

console.log(`\n${B}DIAGNOSTICS — ${fichiers.length} script(s)${N}`)
console.log(
  avecBase
    ? `${J}Mode --avec-base : les diagnostics qui atteignent la base sont INCLUS. Certains ÉCRIVENT.${N}\n`
    : `${D}Mode statique : les diagnostics qui atteignent la base eux-mêmes sont écartés (--avec-base pour les inclure).${N}\n`,
)

for (const f of fichiers) {
  const nom = f.replace(/\.mjs$/, '')
  const chemin = join(SCRIPTS, f)
  if (!avecEcritures && ecritEnBase(nom)) {
    muets.push({ nom, raison: `écarté : ÉCRIT EN BASE — ${ECRIVENT_EN_BASE[nom]}`, sortie: '' })
    console.log(`  ${J}≡${N} ${nom.padEnd(42)} ${D}N'A PAS TOURNÉ — écarté (écrit en base)${N}`)
    continue
  }

  const r = spawnSync(process.execPath, [chemin], {
    encoding: 'utf8',
    timeout: DELAI_MS,
    env: envEnfant,
    cwd: join(SCRIPTS, '..'),
  })

  const stderr = r.stderr ?? ''
  const sortie = (r.stdout ?? '') + stderr

  if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM') {
    muets.push({ nom, raison: `délai de ${DELAI_MS / 1000} s dépassé`, sortie })
    console.log(`  ${J}≡${N} ${nom.padEnd(42)} ${J}N'A PAS TOURNÉ — délai dépassé${N}`)
    continue
  }

  const plantage = aPlante(stderr, r.signal)
  if (plantage) {
    muets.push({ nom, raison: plantage, sortie })
    console.log(`  ${J}≡${N} ${nom.padEnd(42)} ${J}N'A PAS TOURNÉ${N} ${D}${plantage.slice(0, 60)}${N}`)
    continue
  }

  if (r.status === 0) {
    verts.push({ nom, sortie })
    console.log(`  ${G}✓${N} ${nom.padEnd(42)} ${G}VERT${N}`)
  } else {
    rouges.push({ nom, sortie, status: r.status })
    console.log(`  ${R}✗${N} ${nom.padEnd(42)} ${R}ROUGE${N} ${D}(sortie ${r.status})${N}`)
  }
}

// ─── Synthèse — les muets EN PREMIER ─────────────────────────────────────────
console.log(`\n${B}════ SYNTHÈSE ════${N}\n`)

if (muets.length) {
  console.log(`${J}${B}N'A PAS TOURNÉ — ${muets.length}${N}`)
  console.log(
    `${D}  Ceux-là ne verifient RIEN. Un diagnostic muet est plus grave qu'un rouge :${N}`,
  )
  console.log(`${D}  un rouge a conclu, un muet n'a pas commencé.${N}`)
  for (const m of muets) console.log(`  ${J}≡${N} ${m.nom}\n      ${D}${m.raison}${N}`)
  console.log()
}

if (rouges.length) {
  console.log(`${R}${B}ROUGE — ${rouges.length}${N}`)
  for (const m of rouges) console.log(`  ${R}✗${N} ${m.nom}`)
  console.log()
}

console.log(`${G}VERT : ${verts.length}${N}   ${R}ROUGE : ${rouges.length}${N}   ${J}N'A PAS TOURNÉ : ${muets.length}${N}\n`)

if (detail) {
  for (const m of [...muets, ...rouges]) {
    if (!m.sortie) continue
    console.log(`${B}──────── ${m.nom} ────────${N}`)
    console.log(m.sortie.trim().split('\n').slice(-40).join('\n'))
    console.log()
  }
} else if (muets.length || rouges.length) {
  console.log(`${D}(--detail pour la sortie complète des diagnostics non verts)${N}\n`)
}

process.exitCode = rouges.length + muets.length > 0 ? 1 : 0
