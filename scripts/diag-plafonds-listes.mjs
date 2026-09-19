// scripts/diag-plafonds-listes.mjs — UN PLAFOND MUET EST UN MENSONGE DIFFÉRÉ
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE SCRIPT DÉFEND
//   Deux listes serveur portent un plafond. Tant que le volume reste dessous,
//   il n'existe pas ; le jour où il passe dessus, la queue disparaît et
//   PERSONNE ne l'apprend — la requête réussit, elle rend simplement moins de
//   lignes. C'est le genre de défaut qu'on ne découvre qu'en cherchant autre
//   chose, des mois plus tard.
//
//   Trois promesses, qu'aucun compilateur ne garde :
//
//     • ON LIT UNE LIGNE DE PLUS que le plafond. Sans elle, un résultat de
//       exactement PLAFOND lignes est indistinguable d'un résultat complet :
//       la question « y en avait-il d'autres ? » n'a alors aucune réponse.
//     • LA LIGNE-SONDE N'EST JAMAIS SERVIE. Elle répond à une question, elle
//       n'entre ni dans un DTO, ni dans un compteur, ni dans une réponse.
//     • LA TRONCATURE EST DITE. Au serveur dans les journaux, à l'utilisateur
//       sur l'écran qui le concerne, et dans la réponse de l'API.
//
//   Et une quatrième, apprise sur la messagerie du lot précédent :
//     • LE SENS DE LA TRONCATURE EST LE BON. Un plafond coupe la queue de
//       l'histoire, jamais sa tête. Le tri décide de quel bout tombe.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-plafonds-listes.mjs
//
// AUCUN accès base, AUCUN réseau.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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

const SOCLE = 'lib/plafonds-liste.ts'
const DTO = 'lib/candidature-org-dto.ts'
const PUBS = 'app/api/publications/route.ts'
const ROUTE_ORG = 'app/api/me/candidatures-org/route.ts'
const ROUTE_PUB = 'app/api/publications/[id]/candidatures/route.ts'
const ECRAN = 'app/[locale]/dashboard/entreprise/annonces/page.tsx'

for (const f of [SOCLE, DTO, PUBS, ROUTE_ORG, ROUTE_PUB, ECRAN]) {
  if (!existsSync(join(ROOT, f))) {
    console.log(`\n  ✗ FICHIER ABSENT : ${f}\nÉCHEC.\n`)
    process.exit(1)
  }
}
const socle = read(SOCLE)
const dto = read(DTO)
const pubs = read(PUBS)
const routeOrg = read(ROUTE_ORG)
const routePub = read(ROUTE_PUB)
const ecran = read(ECRAN)

console.log('\n━━━ PLAFONDS DE LISTE — sont-ils encore muets ? ━━━')

// ═══════════════════════════════════════════════════════════════════════════
// (A) LE SOCLE
// ═══════════════════════════════════════════════════════════════════════════
titre('(A) le socle partagé')

ok('les deux plafonds sont des constantes nommées',
  /export const PLAFOND_CANDIDATURES_ORG = \d+/.test(socle) &&
  /export const PLAFOND_PUBLICATIONS_ORG = \d+/.test(socle))
ok('la sonde ajoute exactement UNE ligne', /return plafond \+ 1/.test(socle),
  'sonder de plus d’une ligne servirait des lignes qu’on prétend ne pas servir')
ok('la coupe signale la troncature', /atteint: true/.test(socle) && /console\.error/.test(socle),
  'un plafond qui coupe sans le dire est exactement le défaut qu’on ferme')
ok('le signalement est en error, pas en warn',
  /console\.error\('\[plafond\]/.test(socle) && !/console\.warn\('\[plafond\]/.test(socle),
  'un résultat incomplet servi à un utilisateur ne se range pas dans le bruit')

// ═══════════════════════════════════════════════════════════════════════════
// (B) LES CANDIDATURES — et le piège des compteurs
// ═══════════════════════════════════════════════════════════════════════════
titre('(B) candidatures : la sonde, la coupe, et les compteurs')

ok('la requête sonde une ligne de plus',
  /\.limit\(limiteSondee\(PLAFOND_CANDIDATURES_ORG\)\)/.test(dto),
  'un .limit() nu ne permet plus de savoir s’il y avait une suite')
ok('aucun plafond en dur ne subsiste dans la requête', !/\.limit\(2000\)/.test(dto))

// La coupe DOIT précéder la dérivation : une ligne-sonde qui atteint un DTO
// serait servie, et un plafond de 2000 en rendrait 2001.
const iCoupe = dto.indexOf('couperEtSignaler(')
const iDerive = dto.indexOf('deriveCandidatureLifecycle(')
ok('la coupe précède la dérivation des DTO', iCoupe > 0 && iDerive > 0 && iCoupe < iDerive,
  'la ligne-sonde atteindrait le DTO et les compteurs')

// Le compilateur DOIT forcer chaque appelant à voir la troncature.
// ⚠️ CETTE ASSERTION ÉPINGLAIT UNE ORTHOGRAPHE, PAS UNE PROPRIÉTÉ.
//    Elle exigeait la signature au caractère près. Le lot 4.1b a ajouté
//    « | null » — « je n'ai pas su lire l'état de vie », l'appelant refusant
//    en 503 — et elle a rougi sur une AMÉLIORATION. Même famille que §E.24 :
//    ce qu'on vérifie doit être ce qu'on DÉFEND, pas la façon dont c'est
//    écrit. Ce qu'on défend ici : le retour est un OBJET qui porte
//    « troncature », donc le compilateur force chaque appelant à la voir.
ok('le retour force les appelants à voir la troncature (objet, pas tableau)',
  /Promise<\{[^}]*dtos:\s*OrgCandidatureDTO\[\];\s*troncature:\s*Troncature\s*\}/.test(dto),
  'un tableau nu laisserait la troncature s’oublier en silence')

// ET DEPUIS LE LOT 4.1b, IL FORCE AUSSI À VOIR L'ÉTAT INDÉRIVABLE. Sans
// « | null », une panne de lecture des fenêtres d'annonce rangeait TOUTES les
// candidatures en « Annonce clôturée » : le pipeline entier de l'organisation
// paraissait mort (§E.22). Les deux routes répondent 503 sur ce « null ».
ok('le retour force les appelants à voir l’état INDÉRIVABLE',
  /Promise<\{[^}]*\}\s*\|\s*null>/.test(dto),
  'sans « | null », une lecture en panne redevient « annonce clôturée »')

// Les deux routes la relaient. C'est le point qui compte pour les COMPTEURS :
// ils sont dérivés du tableau tronqué, donc partiels, et le dire est le
// minimum honnête tant qu'on ne les recalcule pas en SQL.
for (const [nom, src] of [['me/candidatures-org', routeOrg], ['publications/[id]/candidatures', routePub]]) {
  ok(`${nom} : lit la troncature du helper`, /troncature = bati\.troncature/.test(src))
  ok(`${nom} : la relaie dans la réponse`, /\btroncature,/.test(src),
    'la réponse tairait que la liste ET les compteurs sont partiels')
  ok(`${nom} : les compteurs sont bien dérivés du même tableau`,
    /countByBucket\(all\)/.test(src),
    'compteurs et liste divergeraient — pire que partiels, contradictoires')
}

// ═══════════════════════════════════════════════════════════════════════════
// (C) LES ANNONCES — et LE SENS de la troncature
// ═══════════════════════════════════════════════════════════════════════════
titre('(C) annonces : la sonde, la coupe, et le bon bout')

ok('la requête sonde une ligne de plus',
  /\.limit\(limiteSondee\(PLAFOND_PUBLICATIONS_ORG\)\)/.test(pubs))
ok('aucun plafond en dur ne subsiste', !/\.limit\(500\)/.test(pubs))
ok('la coupe est appliquée', /couperEtSignaler\(/.test(pubs))
ok('la troncature part dans la réponse', /return json\(\{ publications, troncature \}/.test(pubs))

// LE SENS. Un tri ascendant garderait les annonces les plus anciennement
// touchées et ferait disparaître les vivantes — la faute exacte corrigée sur
// le fil de messagerie.
const iOrdre = pubs.indexOf("order('updated_at'")
const ordre = iOrdre >= 0 ? pubs.slice(iOrdre, iOrdre + 80) : ''
ok('le tri garde les annonces les plus récemment modifiées',
  /ascending: false/.test(ordre),
  'tri ascendant + plafond = les annonces vivantes disparaissent, les dormantes restent')

// ═══════════════════════════════════════════════════════════════════════════
// (D) C'EST DIT À QUI CELA CONCERNE
// ═══════════════════════════════════════════════════════════════════════════
titre("(D) l'organisation apprend que sa liste est incomplète")

ok("l'écran lit la troncature", /annoncesLive\.data\?\.troncature/.test(ecran))
ok("il l'affiche quand elle est atteinte", /troncature\?\.atteint &&/.test(ecran),
  'le champ serait servi mais jamais montré : muet à l’écran, donc muet tout court')
ok("le message est traduit, jamais écrit en dur",
  /tPlafond\('annonces_tronquees'/.test(ecran) && !/incomplète/.test(ecran))
ok('il nomme le plafond atteint', /plafond: troncature\.plafond/.test(ecran),
  '« il en manque » sans dire combien est une information inutilisable')

for (const langue of ['fr', 'en', 'es', 'de']) {
  const msg = JSON.parse(read(`messages/${langue}.json`))
  const v = msg?.plafonds?.annonces_tronquees
  ok(`message traduit (${langue})`, typeof v === 'string' && v.includes('{plafond}'))
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n━━━ ${echecs === 0 ? 'TOUT VERT' : `${echecs} ÉCHEC(S)`} ━━━\n`)
process.exit(echecs === 0 ? 0 : 1)
