// scripts/diag-murs-fermes.mjs — LES MURS RESTENT DES MURS, ET AUCUN N'EST MORT.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le lancement est gratuit et la date d'ouverture des abonnements n'est pas
//   fixée. Le chemin de paiement est construit, câblé et testable — mais il ne
//   doit PAS s'afficher tant que le verrou est fermé.
//
//   Deux façons de rater ça, et elles sont opposées :
//
//     · LE BOUTON MORT. Le mur de dévoilement portait un bouton DÉSACTIVÉ
//       « Bientôt disponible ». Un bouton qu'on ne peut pas cliquer promet une
//       porte qui n'existe pas : l'utilisateur le vise, ne comprend pas, et
//       recommence. Une ligne d'issue vaut mieux qu'un bouton qui ment.
//
//     · LE VERROU QUI FUIT. Servir l'état par une variable `NEXT_PUBLIC_` le
//       rendrait lisible dans le bundle, et surtout l'UI pourrait diverger du
//       serveur — qui reste seul à décider.
//
//   Et une troisième, plus discrète : OUVRIR PAR IGNORANCE. Si le quota n'est
//   pas lisible, le mur doit rester fermé. `=== true`, jamais une vérité simple.
//
// CE QU'IL VÉRIFIE
//   1. Aucun bouton désactivé sur un mur de conversion.
//   2. Le verrou vient du SERVEUR, transmis en prop, jamais lu par carte.
//   3. Il est FERMÉ par défaut, à chaque étage de la chaîne.
//   4. L'issue bascule avec lui : contact quand c'est fermé, offres quand
//      c'est ouvert — et les deux libellés existent dans les 4 langues.
//   5. Aucune clé i18n orpheline laissée derrière.
//   6. Aucun chiffre commercial écrit dans un mur.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-murs-fermes.mjs   → contrôles statiques. AUCUN accès base.
//
// LECTURE PURE : ce script n'écrit JAMAIS et ne joint jamais la base.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Fins de ligne NORMALISEES. Le depot sort les fichiers en CRLF : un controle
 * dont le motif traverse une fin de ligne ne matche jamais sur une copie de
 * travail fraichement extraite, et le diagnostic vire au rouge sans qu'aucun
 * code n'ait change.
 */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const exists = (p) => existsSync(join(ROOT, p))

/** Retire les commentaires : un anti-pattern doit pouvoir être DOCUMENTÉ. */
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`)
  }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const CARTE = 'components/dashboard/SpotlightCandidateCard.tsx'
const CARROUSEL = 'components/dashboard/CastingCarousel.tsx'
const VUE = 'components/collaboration/SousTraitanceView.tsx'
const DETAIL = 'components/collaboration/SousTraitanceDetailView.tsx'
const QUOTA = 'app/api/me/collaboration/quota/route.ts'

const messages = Object.fromEntries(
  ['fr', 'en', 'es', 'de'].map((l) => [l, JSON.parse(read(`messages/${l}.json`))]),
)
const cle = (o, c) => c.split('.').reduce((x, k) => (x == null ? x : x[k]), o)

console.log('\nLES MURS RESTENT DES MURS\n')

// ─────────────────────────────────────────────────────────────────────────────
section('0. Présence des artefacts')
for (const f of [CARTE, CARROUSEL, VUE, DETAIL, QUOTA]) ok(exists(f), `${f} existe`)

const carte = sansCommentaires(read(CARTE))
const carrousel = sansCommentaires(read(CARROUSEL))
const vue = sansCommentaires(read(VUE))
const detail = sansCommentaires(read(DETAIL))
const quota = sansCommentaires(read(QUOTA))

// ─────────────────────────────────────────────────────────────────────────────
section('1. Aucun bouton mort sur un mur')

/**
 * Le bloc du mur de dévoilement, isolé du reste de la carte.
 *
 * Borné sur le bloc SUIVANT (`conversionMode === 'unlock'`), et non sur le
 * premier `</div>` : le mur en contient un à l'intérieur, et découper là
 * coupait avant la ligne d'issue — le contrôle criait au loup sur du code
 * correct. Cette borne-ci exclut bien les boutons du bloc « unlock », qui
 * viennent après.
 */
const iMur = carte.search(/conversionMode === 'wall'/)
const iSuivant = carte.search(/conversionMode === 'unlock'/)
const mur =
  iMur === -1 ? '' : carte.slice(iMur, iSuivant > iMur ? iSuivant : carte.length)
ok(iMur !== -1, 'le mur de dévoilement existe dans la carte')
ok(
  !/<button/.test(mur),
  'le mur ne contient AUCUN bouton',
  "Il portait un bouton désactivé « Bientôt disponible » : un bouton qu'on ne peut pas cliquer promet une porte qui n'existe pas.",
)
ok(
  !/aria-disabled/.test(mur) && !/cursor: 'not-allowed'/.test(mur),
  'le mur ne simule pas une action indisponible',
)
ok(
  /need_more_contact|need_more_upgrade/.test(mur),
  'le mur porte une ligne d’issue plutôt qu’un bouton',
)

// ─────────────────────────────────────────────────────────────────────────────
section('2. Le verrou vient du SERVEUR')

ok(
  /billingEnabled\(\)/.test(quota) && /billing_enabled/.test(quota),
  'la route quota sert billing_enabled, calculé au serveur',
)
// Les TROIS points de sortie de la route doivent le porter : un écran servi par
// une branche muette retomberait sur « fermé », mais autant qu'il soit dit.
const sorties = (quota.match(/billing_enabled: billingEnabled\(\)/g) || []).length
ok(sorties >= 3, `les ${sorties} points de sortie de la route portent le verrou`)

ok(
  /billingEnabled\?: boolean/.test(carte) && /billingEnabled\?: boolean/.test(carrousel),
  'le verrou descend en PROP jusqu’à la carte',
  'Une lecture par carte interrogerait le serveur autant de fois qu’il y a de candidats.',
)
ok(
  !/secureFetch\([^)]*billing/.test(carte),
  'la carte n’interroge pas le serveur elle-même',
)

// Aucune fuite publique, dans TOUT le code client.
const fuites = [CARTE, CARROUSEL, VUE, DETAIL, QUOTA].filter((f) =>
  /NEXT_PUBLIC_[A-Z_0-9]*(STRIPE|BILLING)/.test(read(f)),
)
ok(fuites.length === 0, 'aucune variable NEXT_PUBLIC_ de facturation', fuites.join(', '))

// ─────────────────────────────────────────────────────────────────────────────
section('3. FERMÉ par défaut, à chaque étage')

ok(
  /billingEnabled === true/.test(carte),
  'la carte teste `=== true` (une prop absente vaut FERMÉ)',
  "`undefined` ne doit jamais ouvrir un chemin de paiement.",
)
for (const [nom, src] of [['SousTraitanceView', vue], ['SousTraitanceDetailView', detail]]) {
  ok(
    /useState\(false\)/.test(src) || /useState<boolean>\(false\)/.test(src),
    `${nom} initialise le verrou à FERMÉ`,
  )
  ok(
    /billing_enabled === true/.test(src),
    `${nom} n’ouvre que sur un \`=== true\` explicite`,
  )
}
// Un quota illisible ne doit pas ouvrir.
ok(
  /setBillingEnabled\(false\)/.test(detail),
  'un quota illisible referme le verrou',
  "Best-effort sur les droits, oui — mais pas sur l'ouverture d'un chemin de paiement.",
)

// ─────────────────────────────────────────────────────────────────────────────
section('4. L’issue bascule avec le verrou')

for (const [nom, src] of [['la carte', carte], ['SousTraitanceView', vue]]) {
  ok(
    /need_more_upgrade/.test(src) && /need_more_contact/.test(src),
    `${nom} porte les DEUX libellés d’issue`,
    'Un seul libellé, et le jour de l’ouverture il faudrait revenir modifier l’écran.',
  )
}
for (const c of ['commerce.need_more_contact', 'commerce.need_more_upgrade']) {
  const manquantes = ['fr', 'en', 'es', 'de'].filter((l) => typeof cle(messages[l], c) !== 'string')
  ok(manquantes.length === 0, `${c} : 4 langues`, manquantes.join(', '))
}

// ─────────────────────────────────────────────────────────────────────────────
section('5. Aucune clé orpheline')

// Les clés du mur retirées de l'écran doivent l'être aussi des traductions :
// une clé que plus personne n'affiche est du texte qu'on maintiendra pour rien.
const sourceComplete = read(CARTE) + read(CARROUSEL) + read(VUE) + read(DETAIL)
for (const k of ['wall_cta', 'wall_cta_hint']) {
  const dansTraductions = ['fr', 'en', 'es', 'de'].some((l) =>
    JSON.stringify(messages[l]).includes(`"${k}"`),
  )
  const dansCode = sourceComplete.includes(`'${k}'`)
  ok(
    !dansTraductions && !dansCode,
    `« ${k} » a disparu du code ET des 4 traductions`,
    dansTraductions ? 'encore dans les traductions' : 'encore dans le code',
  )
}
// Et les clés encore affichées doivent exister.
for (const k of ['candidatures.card.wall_title', 'candidatures.card.wall_body']) {
  ok(typeof cle(messages.fr, k) === 'string', `${k} existe toujours`)
}

// ─────────────────────────────────────────────────────────────────────────────
section('6. Aucun chiffre commercial dans un mur')

const CHIFFRE = /\b\d+\s*(profil|candidat|dévoilement|annonce|publication|reveal|listing)/i
for (const l of ['fr', 'en', 'es', 'de']) {
  for (const k of ['candidatures.card.wall_body', 'collaboration.wall_body']) {
    const txt = String(cle(messages[l], k) ?? '')
    ok(
      !CHIFFRE.test(txt),
      `${k} [${l}] : aucune quantité écrite en dur`,
      `« ${txt} » — un quota recopié ment dès qu'on le règle au back-office.`,
    )
  }
}

console.log(
  failures === 0
    ? '\nRÉSULTAT : tout est vert. Les murs restent des murs, et aucun n’est mort.\n'
    : `\nRÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
