// scripts/diag-lot-expert-verification.mjs — LA PORTE D'ENTRÉE DE L'EXPERT
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE SCRIPT DÉFEND
//   Un expert n'entre dans le vivier que s'il a été vérifié. Cette phrase tient
//   sur quatre promesses qui ne laissent AUCUNE trace dans le compilateur :
//
//     • L'approbation est une CONJONCTION, jamais un défaut. Verdict IA `ok`,
//       ET score au-dessus du seuil, ET aucun flag disqualifiant. Retirer un
//       seul des trois termes n'est pas une erreur de type : c'est une porte
//       qui s'ouvre.
//     • Une PANNE de l'IA ne vaut pas une approbation. Le catch remet le score
//       à 0 — pas à la valeur précédente, pas à `null` : à 0. Un fail-open ici
//       vérifierait automatiquement tout profil déposé pendant une panne.
//     • Il n'y a PAS d'auto-reject (règle métier V1). Le statut final est typé
//       sur deux valeurs. `rejected` est une décision d'humain.
//     • Le cap DOMAIN_MISMATCH est appliqué PAR LE CODE, pas seulement demandé
//       au prompt. Une consigne de prompt est un souhait ; la ligne de garde
//       dans shapeOutput est une garantie.
//     • La porte du vivier lit `verification_status = 'approved'`, et rien
//       d'autre. C'est le seul endroit qui transforme la vérification en effet.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL A ÉTÉ RÉÉCRIT
//   La version précédente exerçait ces invariants EN BASE, sur un profil expert
//   codé en dur : elle écrivait `profiles.verification_status` et
//   `users.is_verified` dès qu'on la lançait, sans argument, sans garde-fou, et
//   restaurait `null` en fin de course plutôt que la valeur d'origine. Elle
//   reproduisait en plus le filtre du vivier À LA MAIN — une copie qui serait
//   restée verte le jour où le vrai filtre aurait changé.
//
//   Elle ne pouvait de toute façon plus s'exécuter : `expert-verification.ts`
//   importe `./ai-expert-verification` SANS extension, ce que le type-stripping
//   de Node ne résout pas. Le plantage était à l'import, donc avant toute
//   écriture — mais un import réparé aurait rallumé les écritures.
//
//   Les invariants sont vivants ; c'est la manière de les vérifier qui était
//   dangereuse. Ce diagnostic les vérifie sur le CODE, et vise le vrai fichier.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-lot-expert-verification.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE clé. La section F le prouve sur
// lui-même : ce fichier ne peut plus écrire, et ne peut plus le redevenir en
// silence.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

let echecs = 0
function ok(libelle, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${libelle}`)
  } else {
    echecs++
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`)
  }
}

// Retire les lignes de commentaire : un invariant écrit dans une phrase de
// documentation n'est pas un invariant. Faux positif déjà rencontré ailleurs.
function sansCommentaires(source) {
  return source
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

const DISPATCHER = 'lib/verification/expert-verification.ts'
const IA = 'lib/verification/ai-expert-verification.ts'
const VIVIER = 'lib/matching/pool.ts'

console.log('\n━━━ VÉRIFICATION EXPERT — la porte d\'entrée du vivier ━━━\n')

for (const f of [DISPATCHER, IA, VIVIER]) {
  if (!existsSync(join(ROOT, f))) {
    console.log(`  ✗ FICHIER ABSENT : ${f}`)
    console.log('\nLe diagnostic ne peut rien affirmer. ÉCHEC.\n')
    process.exit(1)
  }
}

const dispatcher = sansCommentaires(read(DISPATCHER))
const ia = sansCommentaires(read(IA))
const vivier = sansCommentaires(read(VIVIER))

// ───────────────────────────────────────────────────────────────────────────
// (A) L'approbation est une CONJONCTION, jamais un défaut
// ───────────────────────────────────────────────────────────────────────────
console.log('=== (A) approbation = conjonction des trois termes ===')

const debutA = dispatcher.indexOf('const isApproved')
const finA = dispatcher.indexOf('const finalStatus', debutA)
const expression = debutA >= 0 && finA > debutA ? dispatcher.slice(debutA, finA) : ''

ok("l'expression d'approbation existe", expression.length > 0, 'const isApproved / const finalStatus introuvables')

const TERMES = [
  ["le verdict IA doit valoir 'ok'", "result === 'ok'"],
  ['le score doit atteindre le seuil configuré', 'confidence_score >= config.auto_approve_threshold'],
  ['aucun flag disqualifiant ne doit être présent', '!hasDisqualifyingFlag'],
]
for (const [libelle, aiguille] of TERMES) {
  ok(libelle, expression.includes(aiguille), `« ${aiguille} » absent de l'expression`)
}

// Les trois termes doivent être liés par ET. Un seul OU, et la porte s'ouvre.
const nbEt = expression.split('&&').length - 1
ok('les termes sont liés par ET (&&), pas par OU', nbEt >= 2 && !expression.includes('||'), `&& compté ${nbEt}× / || présent : ${expression.includes('||')}`)

// ───────────────────────────────────────────────────────────────────────────
// (B) Une panne de l'IA ne vaut pas une approbation
// ───────────────────────────────────────────────────────────────────────────
console.log('\n=== (B) panne IA → score 0, jamais une approbation ===')

const debutB = dispatcher.indexOf('catch (err)')
const finB = debutB >= 0 ? dispatcher.indexOf('const blockingFlagsHit', debutB) : -1
const blocCatch = debutB >= 0 && finB > debutB ? dispatcher.slice(debutB, finB) : ''

ok('le bloc de rattrapage autour de l\'appel IA existe', blocCatch.length > 0)
ok("il produit result: 'error'", blocCatch.includes("result: 'error'"))
ok('il remet le score à 0 — pas à la valeur précédente', blocCatch.includes('confidence_score: 0'))
ok("il ne relance pas l'erreur (sinon le profil resterait sans verdict)", !blocCatch.includes('throw '))

// Et le terme (A) fait le reste : result 'error' ne peut pas satisfaire === 'ok'.
ok("un verdict 'error' ne peut pas franchir la conjonction (A)", expression.includes("result === 'ok'"))

// ───────────────────────────────────────────────────────────────────────────
// (C) Pas d'auto-reject : rejeter est une décision d'humain
// ───────────────────────────────────────────────────────────────────────────
console.log('\n=== (C) aucun auto-reject (règle métier V1) ===')

ok(
  "le statut final est typé sur deux valeurs seulement",
  dispatcher.includes("const finalStatus: 'approved' | 'pending_admin_review'"),
  'annotation de finalStatus modifiée ou absente',
)

// Le dispatcher n'écrit jamais 'rejected' sur un profil de lui-même.
const ecritRejected = dispatcher.includes("verification_status: 'rejected'")
ok("le dispatcher n'écrit jamais verification_status: 'rejected'", !ecritRejected)

// Le repli sans provider / sans domaine remonte en revue humaine, pas en refus.
ok(
  'les sorties anticipées remontent en pending_admin_review',
  dispatcher.includes("verification_status: 'pending_admin_review'"),
)

// ───────────────────────────────────────────────────────────────────────────
// (D) Le cap DOMAIN_MISMATCH est appliqué par le CODE
// ───────────────────────────────────────────────────────────────────────────
console.log('\n=== (D) cap DOMAIN_MISMATCH : garde de code, pas consigne de prompt ===')

const debutD = ia.indexOf("flags.includes('DOMAIN_MISMATCH')")
ok(
  'la garde de plafonnement existe hors commentaire',
  debutD >= 0,
  "aucune ligne exécutable ne teste flags.includes('DOMAIN_MISMATCH')",
)
if (debutD >= 0) {
  const garde = ia.slice(debutD, debutD + 200)
  ok('elle compare le score au cap configuré', garde.includes('score > cfg.domain_mismatch_cap'))
  ok('elle écrase le score par le cap', garde.includes('score = cfg.domain_mismatch_cap'))
}

// Le cap reste borné à l'échelle 0–10 même si la configuration déraille.
ok(
  'le cap lu en configuration est borné à [0,10]',
  dispatcher.includes('Math.max(0, Math.min(10, cfg.domain_mismatch_cap))'),
)

// ───────────────────────────────────────────────────────────────────────────
// (E) La porte du vivier — sur le VRAI fichier, pas sur une copie du filtre
// ───────────────────────────────────────────────────────────────────────────
console.log('\n=== (E) porte du vivier : seul « approved » entre ===')

ok(
  "le vivier filtre sur verification_status = 'approved'",
  vivier.includes(".eq('verification_status', 'approved')"),
  `filtre absent de ${VIVIER}`,
)

// Élargir la porte ne se fait pas en supprimant la ligne : il suffit de la
// remplacer par un `in` ou un `or`. Les deux sont refusés.
ok(
  "aucun élargissement par .in() sur verification_status",
  !vivier.includes(".in('verification_status'"),
)
const orElargit = vivier
  .split('.or(')
  .slice(1)
  .some((suite) => suite.slice(0, 200).includes('verification_status'))
ok("aucun élargissement par .or() mentionnant verification_status", !orElargit)

// ───────────────────────────────────────────────────────────────────────────
// (F) Ce diagnostic n'écrit rien — et ne peut plus le redevenir en silence
// ───────────────────────────────────────────────────────────────────────────
console.log('\n=== (F) le diagnostic lui-même n\'écrit pas en base ===')

const moi = read('scripts/diag-lot-expert-verification.mjs')
const moiCode = sansCommentaires(moi)

// Les aiguilles sont assemblées morceau par morceau À DESSEIN : ce fichier se
// scanne lui-même. Écrites d'un bloc, elles se trouveraient elles-mêmes et le
// contrôle serait rouge en permanence — donc désactivé le jour même.
// Ne les recollez pas.
for (const verbe of ['upd' + 'ate', 'ins' + 'ert', 'del' + 'ete', 'ups' + 'ert', 'r' + 'pc']) {
  ok(`aucun .${verbe}( dans ce fichier`, !moiCode.includes(`.${verbe}(`))
}
ok("aucun client Supabase n'est instancié", !moiCode.includes('create' + 'Client'))
ok("aucune clé de service n'est lue", !moiCode.includes('SERVICE' + '_ROLE'))

// ───────────────────────────────────────────────────────────────────────────
console.log(`\n━━━ ${echecs === 0 ? 'TOUT VERT' : `${echecs} ÉCHEC(S)`} ━━━\n`)
process.exit(echecs === 0 ? 0 : 1)
