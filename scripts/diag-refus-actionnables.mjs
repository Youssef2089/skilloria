// scripts/diag-refus-actionnables.mjs — UN REFUS DIT CE QUI BLOQUE ET QUOI FAIRE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le serveur NOMME depuis toujours la cause de ses refus commerciaux — trois
//   codes en 402, dans trois routes. Trois écrans sur cinq les jetaient à
//   l'arrivée et affichaient « Une erreur est survenue ».
//
//   L'organisation qui atteignait son quota mensuel de publications, son
//   plafond d'annonces actives, ou ses dévoilements inclus, lisait la même
//   phrase que pour une panne réseau. Elle ne savait ni ce qui bloquait, ni si
//   c'était sa faute, ni quoi faire ensuite. Côté EXPERT le même refus produit
//   un encart qui explique et propose — l'asymétrie n'avait aucune raison
//   d'être, et le modèle existait déjà dans le dépôt.
//
//   Ce défaut est invisible pour `tsc` et pour le build : une table de
//   correspondance à laquelle il manque une entrée est du code parfaitement
//   valide. Seul un contrôle qui compare les codes ÉMIS aux codes TRAITÉS le
//   voit — c'est ce que fait celui-ci.
//
// CE QU'IL VÉRIFIE
//   1. Tout code de refus COMMERCE émis par une route a un message dans l'écran
//      qui appelle cette route. Les codes sont DÉCOUVERTS dans les routes, pas
//      recopiés : une quatrième limite ajoutée demain fera échouer ce contrôle
//      tant que son message n'existe pas.
//   2. Chaque message dit CE QUI BLOQUE **et** CE QU'ON PEUT FAIRE — jamais
//      seulement l'un des deux.
//   3. Les quatre langues, à l'identique.
//   4. Aucune VALEUR commerciale n'est écrite dans les messages : les quotas
//      vivent au catalogue, les recopier ici les figerait.
//   5. Le verrou reste fermé : aucun bouton de paiement sur ces refus.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-refus-actionnables.mjs   → contrôles statiques.
//                                                AUCUN accès base.
//
// LECTURE PURE : ce script n'écrit JAMAIS et ne joint jamais la base.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Fins de ligne NORMALISEES. Le depot sort les fichiers en CRLF : un controle
 * dont le motif traverse une fin de ligne (`...\n\s+...`) ne matche jamais sur
 * une copie de travail fraichement extraite, et le diagnostic vire au rouge
 * sans qu'aucun code n'ait change. Un diagnostic dont le resultat depend de la
 * machine qui l'execute ne dit pas si le code est juste : il dit d'ou il vient.
 */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`)
  }
}
const info = (l) => console.log(`  ··   ${l}`)
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/**
 * OÙ CHAQUE REFUS EST ÉMIS, ET OÙ IL DOIT ÊTRE LU.
 *
 * La route est la SOURCE : les codes y sont découverts, jamais recopiés ici.
 * L'écran est le LECTEUR : c'est lui qui doit savoir les traduire.
 */
const CHAINES = [
  {
    route: 'app/api/publications/[id]/publish/route.ts',
    ecran: 'components/dashboard/PublicationForm.tsx',
    espace: 'publications.errors',
  },
  {
    route: 'app/api/candidatures/[id]/unlock/route.ts',
    ecran: 'components/dashboard/SpotlightCandidateCard.tsx',
    espace: 'candidatures.card',
    // Cet écran nomme ses clés `error_<code>` là où l'autre les nomme `<code>`.
    prefixe: 'error_',
  },
]

/** Les codes de refus COMMERCE émis en 402 par une route. */
function codesEmis(sourceRoute) {
  const codes = new Set()
  // `return json({ error: '…', code: 'xxx' }, 402)` — sur une ou plusieurs lignes.
  for (const m of sourceRoute.matchAll(/code:\s*'([a-z_]+)'\s*\}[\s\S]{0,40}?402/g)) {
    codes.add(m[1])
  }
  return [...codes]
}

const messages = Object.fromEntries(
  ['fr', 'en', 'es', 'de'].map((l) => [l, JSON.parse(read(`messages/${l}.json`))]),
)
const cle = (obj, chemin) => chemin.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)

console.log('\nREFUS ACTIONNABLES — dire ce qui bloque ET quoi faire\n')

// ─────────────────────────────────────────────────────────────────────────────
section('1. Tout refus commerce émis est traité par son écran')

let totalCodes = 0
for (const chaine of CHAINES) {
  const route = read(chaine.route)
  const ecran = read(chaine.ecran)
  const codes = codesEmis(route)
  const nomRoute = chaine.route.split('/').slice(-2).join('/')

  ok(codes.length > 0, `${nomRoute} émet au moins un refus 402`, 'Découverte vide : le motif ne reconnaît plus les refus.')
  for (const code of codes) {
    totalCodes++
    // ⚠️ Chercher la simple PRÉSENCE du code ne prouve rien, et la mutation l'a
    //    montré deux fois : le code survit ailleurs dans le fichier — dans un
    //    `new Set([...])` qui pilote l'appel à l'action, ou à l'intérieur d'une
    //    clé i18n `error_<code>`. Les deux mutations qui SUPPRIMAIENT le
    //    traitement laissaient le contrôle vert.
    //
    //    On exige donc la FORME qui traite réellement le code :
    //      · une entrée de table  →  `<code>: t(`
    //      · une comparaison      →  `=== '<code>'`
    const traite = new RegExp(`===\\s*'${code}'|\\b${code}\\s*:\\s*t\\(`).test(ecran)
    ok(traite, `« ${code} » est traité par ${chaine.ecran.split('/').pop()}`,
      "Le serveur nomme la cause ; l'écran la jette et affiche « une erreur est survenue ».")
    const cheminCle = `${chaine.espace}.${chaine.prefixe ?? ''}${code}`
    ok(typeof cle(messages.fr, cheminCle) === 'string', `« ${code} » a un message (${cheminCle})`)
  }
}
info(`${totalCodes} code(s) de refus commerce découvert(s) dans les routes`)

// ─────────────────────────────────────────────────────────────────────────────
section('2. Chaque message dit ce qui BLOQUE et ce qu’on peut FAIRE')

const MESSAGES = [
  'publications.errors.quota_publications_reached',
  'publications.errors.active_publications_limit_reached',
  'candidatures.card.error_unlock_limit_reached',
]
// Un message actionnable comporte DEUX temps : le constat, puis l'issue. Deux
// phrases au minimum — un constat seul laisse l'utilisateur devant un mur.
for (const c of MESSAGES) {
  const txt = cle(messages.fr, c)
  ok(typeof txt === 'string' && txt.length > 60, `${c} : message étoffé`, 'Un refus tenant en cinq mots ne dit jamais quoi faire.')
  ok(
    typeof txt === 'string' && (txt.match(/[.!?]/g) || []).length >= 2,
    `${c} : constat PUIS issue (au moins deux phrases)`,
    `« ${txt} » — il manque ce qu'on peut faire.`,
  )
}

// L'appel à l'action est PARTAGÉ, donc jamais recopié dans chaque message.
ok(
  typeof cle(messages.fr, 'commerce.need_more_contact') === 'string',
  'l’appel à l’action vit dans un espace partagé (commerce.*)',
)
ok(
  MESSAGES.every((c) => !/[Cc]ontact/.test(String(cle(messages.fr, c)))),
  'aucun message ne recopie l’appel à l’action',
  "Recopié, il faudrait le changer en trois endroits le jour où le verrou s'ouvre.",
)

// ─────────────────────────────────────────────────────────────────────────────
section('3. Les quatre langues, à l’identique')

for (const c of [...MESSAGES, 'commerce.need_more_contact', 'commerce.need_more_upgrade']) {
  const manquantes = ['fr', 'en', 'es', 'de'].filter((l) => typeof cle(messages[l], c) !== 'string')
  ok(manquantes.length === 0, `${c} : 4 langues`, manquantes.length ? `absente en ${manquantes.join(', ')}` : undefined)
}

// ─────────────────────────────────────────────────────────────────────────────
section('4. Rien en dur — les valeurs vivent au catalogue')

const CHIFFRES = /\b\d+\s*(annonce|publication|profil|dévoilement|listing|post|reveal|Anzeige|anuncio)/i
for (const c of MESSAGES) {
  for (const l of ['fr', 'en', 'es', 'de']) {
    const txt = String(cle(messages[l], c) ?? '')
    ok(!CHIFFRES.test(txt), `${c} [${l}] : aucune quantité écrite en dur`,
      `« ${txt} » — un quota recopié dans une traduction ment dès qu'on le règle au back-office.`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
section('5. Le verrou reste fermé : aucun chemin de paiement sur un refus')

for (const chaine of CHAINES) {
  const ecran = read(chaine.ecran)
  const nom = chaine.ecran.split('/').pop()
  ok(
    !/billing\/checkout|billing\/change-plan|billing\/portal/.test(ecran),
    `${nom} n’ouvre aucun parcours de paiement`,
    'Le lancement est gratuit : un refus propose de nous contacter, pas de payer.',
  )
  ok(
    !/NEXT_PUBLIC_[A-Z_]*(STRIPE|BILLING)/.test(ecran),
    `${nom} ne lit aucune variable publique de facturation`,
  )
}
// Le libellé servi aujourd'hui est bien celui du verrou FERMÉ.
for (const chaine of CHAINES) {
  const ecran = read(chaine.ecran)
  ok(
    /need_more_contact/.test(ecran),
    `${chaine.ecran.split('/').pop()} affiche l’issue « contactez-nous »`,
  )
}

console.log(
  failures === 0
    ? '\nRÉSULTAT : tout est vert. Chaque refus commerce dit ce qui bloque et quoi faire.\n'
    : `\nRÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
