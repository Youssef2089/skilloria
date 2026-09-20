// scripts/diag-plafonds-listes.mjs — UN PLAFOND MUET EST UN MENSONGE DIFFÉRÉ
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE SCRIPT DÉFEND
//   Une liste serveur porte un plafond. Tant que le volume reste dessous, il
//   n'existe pas ; le jour où il passe dessus, la queue disparaît et PERSONNE
//   ne l'apprend — la requête réussit, elle rend simplement moins de lignes.
//   C'est le genre de défaut qu'on ne découvre qu'en cherchant autre chose,
//   des mois plus tard.
//
//   Trois promesses, qu'aucun compilateur ne garde :
//     • ON LIT UNE LIGNE DE PLUS que le plafond, ou on COMPTE — sans l'un ni
//       l'autre, un résultat de exactement PLAFOND lignes est indistinguable
//       d'un résultat complet.
//     • LA LIGNE-SONDE N'EST JAMAIS SERVIE.
//     • LA TRONCATURE EST DITE : dans la réponse, et sur l'écran qui l'appelle.
//   Et une quatrième, apprise sur la messagerie :
//     • LE SENS DE LA TRONCATURE EST LE BON. Un plafond coupe la queue de
//       l'histoire, jamais sa tête. Le tri décide de quel bout tombe.
//
// ┌─ CONVERTI EN BALAYAGE (lot C4a, 20/09/2026) ────────────────────────────┐
// │ Il ouvrait SIX fichiers par leur chemin — les deux listes qu'un lot     │
// │ avait rendues honnêtes — et ne savait rien des autres. Il balaie        │
// │ désormais TOUS les `.limit(` de `app/api/` + `lib/` et classe chacun :  │
// │   · LOOKUP      `.limit(1)` — une lecture, pas une liste ;              │
// │   · SONDÉ       `.limit(limiteSondee(…))` suivi de `couperEtSignaler(` ; │
// │   · ANNONCÉ     le fichier COMPTE (`count: 'exact'`) ou REND le plafond │
// │                 (`truncated`, `troncature`, `has_more`, `limite`,       │
// │                 `plafond`, `total`) ;                                   │
// │   · MUET        rien de tout ça — et un plafond muet est soit LU et    │
// │                 GELÉ avec sa raison (§G.8), soit ROUGE.                 │
// │ Le balayage a trouvé 47 plafonds là où le contrôle en connaissait 2 :  │
// │ 18 lookups, 12 annoncés, 2 sondés, 15 MUETS — tous lus : 8 légitimes   │
// │ (9 occurrences), 6 DÉFAUTS NOMMÉS rendus à l'arbitrage. Et côté ÉCRAN, │
// │ 8 lecteurs d'une route qui DIT sa troncature ne la LISENT pas — nommés  │
// │ aussi. Le classement est fait au FICHIER (un signal de compte ailleurs  │
// │ dans le fichier range son plafond en ANNONCÉ) : c'est grossier, c'est   │
// │ dit, et ça se relit dans le gel.                                         │
// └─────────────────────────────────────────────────────────────────────────┘
//
//   node scripts/diag-plafonds-listes.mjs
//
// AUCUN accès base, AUCUN réseau.

import {
  RACINES_CLIENT, LOCALES, lire, sansCommentaires, fichiers, routesApi, lecteurs,
  messages, lireCle, clesPlates, localesManquantes, bilan,
} from './balayage-promesse.mjs'

const { ok, section, info, fin } = bilan()

/**
 * GEL DES PLAFONDS MUETS — un ÉTAT LU (§G.8). Clé : fichier + argument du
 * `.limit(` (pas le numéro de ligne, qui bouge). Chaque raison commence par
 * LÉGITIME ou par DÉFAUT NOMMÉ ; un plafond muet NEUF rougit ; une entrée
 * dont le plafond a disparu ou cessé d'être muet doit sortir du gel.
 */
const GEL = {
  // ── Entrées d'un JUGEMENT, pas des listes servies ────────────────────────
  //   (`candidatures/route.ts .limit(20)` est du même usage, mais son fichier
  //   porte un signal de compte ailleurs : le classement, fait au FICHIER, le
  //   range en ANNONCÉ. Limite dite, pas cachée : le signal est grossier.)
  'app/api/candidatures/[id]/pitch/route.ts | 20':
    'LÉGITIME — 20 expériences comme entrée du prompt de pitch ; rien n’est servi',
  'lib/verification/expert-verification.ts | 20':
    'LÉGITIME — 20 expériences en entrée de la vérification IA d’un profil ; le verdict se porte sur un échantillon, et c’est dit ici',
  'lib/verification/expert-verification.ts | 10':
    'LÉGITIME — 10 formations, même usage',
  'lib/verification/expert-verification.ts | 15':
    'LÉGITIME — 15 langues, même usage',
  // ── Lots traités par PASSES : la suite est reprise au passage suivant ────
  'app/api/cron/purge-deletions/route.ts | BATCH_LIMIT':
    'LÉGITIME — un cron traite BATCH_LIMIT comptes par passage ; le reste attend le prochain passage, rien n’est « servi »',
  'app/api/cron/purge-inactive/route.ts | BATCH_LIMIT':
    'LÉGITIME — deux lots par passage (avertissement, purge), même raison',
  'lib/notifications/dispatch.ts | SCAN_LIMIT':
    'LÉGITIME — le dispatcher réclame SCAN_LIMIT notifications par passe ; la suite part à la passe suivante',
  // ── Un FLUX, pas un inventaire ────────────────────────────────────────────
  'app/api/me/missions/route.ts | EXPERT_FEED_LIMIT':
    'LÉGITIME — un flux de propositions ordonné par pertinence : la queue est la moins pertinente, et le flux ne promet pas d’être exhaustif',
  //   (`me/notifications .limit(50)` : la cloche montre les 50 plus récentes et le
  //   seul chiffre qu'elle promet — les non-lues — vient d'un `count: 'exact'` à
  //   part ; ce compte range le fichier en ANNONCÉ, pour la bonne raison.)
  // ── DÉFAUTS NOMMÉS : des listes servies comme complètes, coupées en silence ─
  'app/api/me/candidatures/route.ts | 200':
    'DÉFAUT NOMMÉ — le suivi des candidatures d’un EXPERT : 200 les plus récentes, sans sonde ni compte. Un expert très actif verrait ses candidatures anciennes disparaître de son suivi sans un mot. Correctif connu : limiteSondee + couperEtSignaler, comme les deux listes d’organisation',
  'app/api/me/conversations/route.ts | 200':
    'DÉFAUT NOMMÉ — la boîte de réception : 200 conversations les plus récentes, sans sonde. Même correctif',
  'app/api/conversations/[id]/messages/route.ts | 500':
    'DÉFAUT NOMMÉ — un fil de 500 messages : le BON bout est gardé (les plus récents, tri descendant puis renversé), mais personne n’apprend que des messages plus anciens existent. Une ligne-sonde suffit',
  'app/api/admin/get-expert/[id]/route.ts | 20':
    'DÉFAUT NOMMÉ — l’écran où un administrateur APPROUVE un expert : 20 expériences, 10 formations, 15 langues, coupées en silence. Rare, mais la décision se prend sur la liste affichée (§E.22 ⑦ a fermé la PANNE sur ces trois lectures ; la TRONCATURE reste muette)',
  'app/api/admin/get-expert/[id]/route.ts | 10':
    'DÉFAUT NOMMÉ — idem, formations',
  'app/api/admin/get-expert/[id]/route.ts | 15':
    'DÉFAUT NOMMÉ — idem, langues',
}
/**
 * GEL DES ÉCRANS MUETS — des écrans qui LISENT une route qui DIT sa troncature,
 * et ne la montrent pas. Le serveur relaie `troncature` précisément pour que
 * l'écran l'affiche ; « le champ serait servi mais jamais montré : muet à
 * l'écran, donc muet tout court ». Clé : écran + chemin de la route.
 */
const GEL_ECRANS = {
  'components/collaboration/SousTraitanceListView.tsx | /api/publications':
    'DÉFAUT NOMMÉ — la liste des besoins de sous-traitance d’un expert ignore `troncature` (plafond 500) ; l’écran des annonces d’organisation, lui, l’affiche',
  'components/dashboard/CollaborationDashboardBlock.tsx | /api/publications':
    'DÉFAUT NOMMÉ — le bloc de tableau de bord réutilise GET /api/publications et n’affiche pas la troncature',
  'app/[locale]/dashboard/entreprise/page.tsx | /api/publications':
    'DÉFAUT NOMMÉ — l’accueil entreprise lit la liste des annonces et n’en dit pas la troncature ; la page Annonces, servie par la même route, la dit',
  'app/[locale]/dashboard/entreprise/candidatures/page.tsx | /api/me/candidatures-org':
    'DÉFAUT NOMMÉ — la page Candidatures de l’organisation : la route dit que la liste ET les compteurs sont partiels (plafond 2000), la page ne le dit pas',
  'app/[locale]/dashboard/entreprise/page.tsx | /api/me/candidatures-org':
    'DÉFAUT NOMMÉ — l’accueil entreprise affiche les COMPTEURS de candidatures comme exacts ; au-delà du plafond ils sont partiels et la route le dit',
  'app/[locale]/dashboard/entreprise/annonces/[id]/candidatures/page.tsx | /api/publications/[id]/candidatures':
    'DÉFAUT NOMMÉ — les candidatures d’une annonce : même route-famille, même silence à l’écran',
  'components/collaboration/SousTraitanceDetailView.tsx | /api/publications/[id]/candidatures':
    'DÉFAUT NOMMÉ — le détail d’un besoin de sous-traitance lit la même liste et ignore `troncature`',
  'app/[locale]/admin/utilisateurs/[id]/page.tsx | /api/admin/get-user/[id]/sessions':
    'DÉFAUT NOMMÉ — la fiche utilisateur du back-office ne lit pas `has_more` : le journal de sessions paraît complet quand il est coupé',
}
const defautsNommes =
  Object.values(GEL).filter((r) => r.startsWith('DÉFAUT NOMMÉ')).length +
  Object.values(GEL_ECRANS).filter((r) => r.startsWith('DÉFAUT NOMMÉ')).length

// ══════════════════════════════════════════════════════════════════════════
// LES MOTIFS — éprouvés AVANT le balayage (§E.33)
// ══════════════════════════════════════════════════════════════════════════

/** Tous les `.limit(<arg>)` d'un source, avec leur argument et leur position. */
const plafonds = (src) => [...src.matchAll(/\.limit\(\s*([^()]*(?:\([^()]*\))?[^()]*?)\s*\)/g)].map((m) => ({ arg: m[1].trim(), index: m.index }))
const SIGNAL = /count:\s*'exact'|\b(?:truncated|troncature|has_more|limite|plafond|total)\s*[:,]/
function classer(src, p) {
  if (/^1$/.test(p.arg)) return 'LOOKUP'
  if (/^limiteSondee\(/.test(p.arg)) return /couperEtSignaler\(/.test(src) ? 'SONDÉ' : 'SONDÉ SANS COUPE'
  if (SIGNAL.test(src)) return 'ANNONCÉ'
  return 'MUET'
}
/** Le `.order(` le plus proche AVANT un `.limit(` — c'est lui qui décide du bout qui tombe. */
function ordreAvant(src, index) {
  const avant = src.slice(0, index)
  const i = avant.lastIndexOf('.order(')
  return i < 0 ? null : avant.slice(i, Math.min(avant.length, i + 120))
}

section('ÉPREUVE DES MOTIFS — avant de leur faire confiance')
{
  ok(plafonds('.limit(200)')[0]?.arg === '200', 'lit l’argument littéral')
  ok(plafonds('.limit(limiteSondee(PLAFOND_X))')[0]?.arg === 'limiteSondee(PLAFOND_X)', 'lit un argument avec appel imbriqué')
  ok(classer('x.limit(1)', { arg: '1' }) === 'LOOKUP', 'classe `.limit(1)` en LOOKUP')
  ok(classer("q.limit(limiteSondee(P))\ncouperEtSignaler(rows, P, 'x')", { arg: 'limiteSondee(P)' }) === 'SONDÉ', 'classe une sonde suivie d’une coupe en SONDÉ')
  ok(classer('q.limit(limiteSondee(P))', { arg: 'limiteSondee(P)' }) === 'SONDÉ SANS COUPE', 'détecte : une sonde sans coupe — la ligne-sonde serait SERVIE')
  ok(classer("select('id', { count: 'exact' }).limit(500)\nreturn json({ rows, truncated: total > rows.length })", { arg: '500' }) === 'ANNONCÉ', 'classe un plafond compté et rendu en ANNONCÉ')
  ok(classer('q.order(x).limit(200)\nreturn json({ rows })', { arg: '200' }) === 'MUET', 'détecte : un plafond MUET')
  ok(/ascending: false/.test(ordreAvant("q.order('updated_at', { ascending: false }).limit(limiteSondee(P))", 40)), 'lit le sens du tri qui précède')
}

// ══════════════════════════════════════════════════════════════════════════
section('(A) LE SOCLE — trouvé par ce qu’il exporte, pas par son chemin')
const SERVEUR = fichiers(['app/api', 'lib'])
const socles = SERVEUR.filter((f) => /export function limiteSondee\(/.test(sansCommentaires(lire(f))))
ok(socles.length === 1, `un seul socle exporte \`limiteSondee\` (${socles.join(', ') || 'aucun'})`)
for (const s of socles) {
  const socle = sansCommentaires(lire(s))
  ok(/return plafond \+ 1/.test(socle), 'la sonde ajoute exactement UNE ligne', 'sonder de plus d’une ligne servirait des lignes qu’on prétend ne pas servir')
  ok(/atteint: true/.test(socle) && /console\.error\('\[plafond\]/.test(socle) && !/console\.warn\('\[plafond\]/.test(socle),
    'la coupe signale la troncature, en error et non en warn', 'un résultat incomplet servi à un utilisateur ne se range pas dans le bruit')
  const constantes = [...socle.matchAll(/export const (PLAFOND_[A-Z_]+) = \d+/g)].map((m) => m[1])
  ok(constantes.length >= 2, `les plafonds sondés sont des constantes nommées (${constantes.join(', ')})`)
}

// ══════════════════════════════════════════════════════════════════════════
section('(B) TOUS LES PLAFONDS DU SERVEUR — balayage de app/api + lib')
const inventaire = []
for (const f of SERVEUR) {
  const src = sansCommentaires(lire(f))
  for (const p of plafonds(src)) inventaire.push({ f, ...p, classe: classer(src, p), src })
}
const par = {}
for (const p of inventaire) par[p.classe] = (par[p.classe] ?? 0) + 1
info(`${SERVEUR.length} fichiers · ${inventaire.length} plafonds : ${Object.entries(par).map(([k, v]) => `${v} ${k}`).join(' · ')}`)
ok(inventaire.length >= 10, 'le balayage voit les plafonds (au moins dix)', 'un inventaire vide ou minuscule : le motif `.limit(` ne lit plus le code')

const sansCoupe = inventaire.filter((p) => p.classe === 'SONDÉ SANS COUPE')
ok(sansCoupe.length === 0, 'toute sonde est suivie d’une coupe — la ligne-sonde n’est jamais servie',
  sansCoupe.map((p) => `${p.f} .limit(${p.arg})`).join(' ; ') || undefined)

const cle = (p) => `${p.f} | ${p.arg}`
const muets = inventaire.filter((p) => p.classe === 'MUET')
const muetsNeufs = muets.filter((p) => !(cle(p) in GEL))
for (const p of muets.filter((p) => cle(p) in GEL)) info(`MUET, gelé — ${p.f} .limit(${p.arg}) : ${GEL[cle(p)].slice(0, 14)}…`)
ok(muetsNeufs.length === 0, `aucun plafond muet NEUF (${muets.length} muets, tous lus et gelés)`,
  muetsNeufs.map((p) => `${p.f} .limit(${p.arg}) — le LIRE, puis le sonder ou le geler avec sa raison`).join('\n       '))
const sorties = Object.keys(GEL).filter((k) => !muets.some((p) => cle(p) === k))
ok(sorties.length === 0, 'aucune entrée du gel n’a disparu ni cessé d’être muette sans qu’on le dise',
  sorties.length ? `sortie(s) du gel : ${sorties.join(' ; ')} — retirer la ligne` : undefined)
ok(Object.values(GEL).every((r) => /^(LÉGITIME|DÉFAUT NOMMÉ)( |$)/.test(r)), 'chaque raison du gel commence par LÉGITIME ou DÉFAUT NOMMÉ (§G.8)')

// ══════════════════════════════════════════════════════════════════════════
section('(C) LES SONDÉS — la coupe avant le DTO, et le bon bout qui tombe')
for (const p of inventaire.filter((p) => p.classe === 'SONDÉ')) {
  const nom = p.f.split('/').slice(-2).join('/')
  // La coupe DOIT précéder toute dérivation : une ligne-sonde qui atteint un
  // DTO serait servie, et un plafond de 2000 en rendrait 2001.
  const iCoupe = p.src.indexOf('couperEtSignaler(')
  const iDerive = p.src.indexOf('deriveCandidatureLifecycle(')
  if (iDerive > 0) ok(iCoupe < iDerive, `${nom} : la coupe précède la dérivation des DTO`, 'la ligne-sonde atteindrait le DTO et les compteurs')
  // LE SENS. Un tri ascendant garderait les plus anciens et ferait disparaître
  // les vivants — la faute exacte corrigée sur le fil de messagerie.
  const ordre = ordreAvant(p.src, p.index)
  ok(ordre !== null && /ascending: false/.test(ordre), `${nom} : le tri qui précède la sonde est DESCENDANT — la queue qui tombe est la bonne`,
    ordre ? `trouvé : ${ordre.replace(/\s+/g, ' ').slice(0, 80)}` : 'aucun .order( avant la sonde : le bout qui tombe est indéterminé')
  // Le retour porte la troncature comme OBJET (pas un tableau nu), pour que le
  // compilateur force chaque appelant à la voir — §E.34 : on vérifie la forme
  // « objet qui porte troncature », pas une signature au caractère près.
  if (/Promise<\{/.test(p.src)) ok(/Promise<\{[^}]*\btroncature\b/.test(p.src), `${nom} : le retour est un OBJET qui porte la troncature`, 'un tableau nu laisserait la troncature s’oublier en silence')
}

// ══════════════════════════════════════════════════════════════════════════
section('(D) C’EST DIT À QUI CELA CONCERNE — les routes qui rendent une troncature, et leurs écrans')
const ECRANS = fichiers(RACINES_CLIENT)
const ROUTES = routesApi()
const routesQuiDisent = ROUTES.map((r) => {
  const src = sansCommentaires(lire(r.rel))
  const drapeau = /\btroncature\b/.test(src) ? 'troncature' : /\btruncated\b/.test(src) ? 'truncated' : /\bhas_more\b/.test(src) ? 'has_more' : null
  return { ...r, drapeau }
}).filter((r) => r.drapeau)
info(`${routesQuiDisent.length} routes rendent un drapeau de troncature`)
ok(routesQuiDisent.length >= 3, 'au moins trois routes disent leur troncature', 'le motif ne voit plus les drapeaux')
const ecransMuetsVus = new Set()
for (const r of routesQuiDisent) {
  // Les LECTEURS seulement : un écran qui n'appelle la route qu'en écriture
  // (POST /api/publications pour créer) ne reçoit pas de liste, donc pas de
  // troncature à montrer.
  const lit = lecteurs(r.chemin, ECRANS)
  if (lit.length === 0) { info(`${r.chemin} (${r.drapeau}) : aucun lecteur direct trouvé — consommé via un hook ou un autre chemin`); continue }
  for (const e of lit) {
    const src = sansCommentaires(lire(e))
    const montre = new RegExp(`\\b${r.drapeau}\\b`).test(src)
    const cleE = `${e} | ${r.chemin}`
    if (!montre && cleE in GEL_ECRANS) { ecransMuetsVus.add(cleE); info(`${e} ignore \`${r.drapeau}\` de ${r.chemin} — GELÉ, ${GEL_ECRANS[cleE].slice(0, 14)}…`); continue }
    ok(montre, `${e} (lit ${r.chemin}) LIT \`${r.drapeau}\``,
      'le champ serait servi mais jamais montré : muet à l’écran, donc muet tout court')
  }
}
const sortiesEcrans = Object.keys(GEL_ECRANS).filter((k) => !ecransMuetsVus.has(k))
ok(sortiesEcrans.length === 0, 'aucune entrée du gel des écrans n’a disparu ni cessé d’être muette sans qu’on le dise',
  sortiesEcrans.length ? `sortie(s) : ${sortiesEcrans.join(' ; ')}` : undefined)
ok(Object.values(GEL_ECRANS).every((r) => /^(LÉGITIME|DÉFAUT NOMMÉ)( |$)/.test(r)), 'chaque raison du gel des écrans commence par LÉGITIME ou DÉFAUT NOMMÉ (§G.8)')
// Le message : toute clé `*_tronquees` nomme le plafond, dans les quatre langues.
const MSG = messages()
const clesTronc = clesPlates(MSG.fr).filter((k) => /_tronquees$/.test(k))
ok(clesTronc.length >= 1, `au moins un message de troncature existe (${clesTronc.join(', ')})`)
for (const k of clesTronc) {
  ok(localesManquantes(MSG, k).length === 0, `${k} : 4 langues`)
  ok(LOCALES.every((l) => String(lireCle(MSG[l], k) ?? '').includes('{plafond}')), `${k} : nomme le plafond atteint dans chaque langue`,
    '« il en manque » sans dire combien est une information inutilisable')
}

// ══════════════════════════════════════════════════════════════════════════
section('GEL — compté à voix haute')
info(`${defautsNommes} DÉFAUT(S) NOMMÉ(S) au gel — 6 plafonds serveur muets, 8 écrans qui taisent une troncature que le serveur dit — rendus à l’arbitrage`)

fin(`Aucun plafond du serveur n’est muet sans avoir été lu. ${defautsNommes} défaut(s) nommé(s) attendent un arbitrage.`)
