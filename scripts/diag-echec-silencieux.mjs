#!/usr/bin/env node
/**
 * diag-echec-silencieux.mjs — UNE ERREUR TECHNIQUE CONVERTIE EN VERDICT MÉTIER.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  LA CLASSE                                                               ║
 * ║                                                                          ║
 * ║  Un `catch` qui rend `null`. Un `if (error)` qui rend `[]`. Un compteur   ║
 * ║  qui rend `0` quand il n'a pas pu compter. Aucun de ces trois n'est un    ║
 * ║  défaut en soi — et c'est précisément ce qui les rend coûteux : sur les   ║
 * ║  trente-sept occurrences mesurees au debut du lot, trente-trois sont      ║
 * ║  legitimes.                                                              ║
 * ║                                                                          ║
 * ║  Le défaut naît une ligne plus loin, chez l'APPELANT : quand la valeur    ║
 * ║  neutre traverse une GARDE, qui la lit comme un FAIT et en tire un refus  ║
 * ║  nommé. L'utilisateur reçoit alors une phrase vraie sur rien : « vous     ║
 * ║  n'avez pas d'organisation », « cet utilisateur n'existe pas », « votre   ║
 * ║  profil n'est pas vérifié ». Le refus est souvent JUSTE — on ne relâche   ║
 * ║  pas une garde qu'on n'a pas pu évaluer. C'est le MOTIF qui ment, et les  ║
 * ║  deux se règlent séparément.                                             ║
 * ║                                                                          ║
 * ║  Cas source : `loadOrganizationContext` (lib/auth-guard.ts). NEUF cas au  ║
 * ║  total — quatre qui refusaient à tort, un qui faisait SAUTER une          ║
 * ║  confirmation sur une action irréversible (la purge), un qui ADMETTAIT à  ║
 * ║  tort (l'entrée en organisation), et trois qui affirmaient un FAIT faux   ║
 * ║  à l'écran ou en base. Cf. CLAUDE.md §E.22.                               ║
 * ║                                                                          ║
 * ║  ⚠️ TROIS ONT ÉTÉ TROUVÉS APRÈS UN PREMIER GEL TROP CONFIANT. Le cliquet   ║
 * ║  ci-dessous fige un inventaire, il ne le JUGE pas : y porter une ligne     ║
 * ║  sans l'ouvrir, c'est déclarer légitime ce qu'on n'a pas lu.              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * CE QU'IL VÉRIFIE
 *   A. CLIQUET — le recensement de la classe est FIGÉ. Une occurrence NEUVE
 *      rougit ; la dette ne peut que décroître.
 *   B. Les cinq réparations qui refusaient à tort tiennent, ancrées sur le bloc
 *      qu'elles visent.
 *   C. Tout appelant d'une porte à états traite « indisponible » — et AVANT la
 *      comparaison métier. C'est l'ordre qui compte : le test métier placé en
 *      premier OUVRE la garde sur une panne.
 *   D. Les motifs de refus temporaires ont une phrase dans les QUATRE langues.
 *      Un motif honnête que personne ne traduit ne sort jamais de l'API.
 *   F. Le seul FAIL-OPEN de la classe — l'entrée en organisation — refuse à
 *      l'écriture et se tait à l'affichage.
 *   E. Les deux compteurs d'administrateurs ne se confondent pas : un appelant
 *      IRRÉVERSIBLE ne consomme jamais le repli prudent écrit pour du
 *      réversible.
 *
 * SANS BASE, SANS RÉSEAU, SANS IDENTIFIANTS — tourne depuis n'importe quel
 * worktree (§E.3). Sorties : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** CRLF normalisé : un motif qui traverse un `\n` mourait sinon (§E.3). */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/**
 * Commentaires retirés SANS PERDRE DE LIGNES — chaque `\n` d'un bloc commenté
 * est conservé. Un recensement dont les numéros de ligne glissent envoie
 * relire le mauvais endroit, et on cesse de le croire (§E.7).
 */
const sansCommentaires = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))

let rouge = 0
let vert = 0
const ok = (cond, libelle, pourquoi) => {
  if (cond) {
    vert++
    console.log(`  ✓ ${libelle}`)
  } else {
    rouge++
    console.log(`  ✗ ${libelle}`)
    if (pourquoi) console.log(`      → ${pourquoi}`)
  }
}
const section = (t) => console.log(`\n═══ ${t} ${'═'.repeat(Math.max(0, 72 - t.length))}`)

/* ══════════════════════════════════════════════════════════════════════════
 * LE BALAYAGE
 * ════════════════════════════════════════════════════════════════════════ */

const sources = []
const parcours = (rel) => {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) return
  for (const e of readdirSync(abs)) {
    if (e === 'node_modules' || e === '.next') continue
    const enfant = `${rel}/${e}`
    if (statSync(join(ROOT, enfant)).isDirectory()) parcours(enfant)
    else if (/\.tsx?$/.test(e)) sources.push(enfant)
  }
}
// ⚠️ `components/` EN FAIT PARTIE. Le balayage des durées réglables s'était
//    arrêté à `app/` + `lib/` et avait manqué un composant client qui appliquait
//    une règle serveur (§E.15). Une classe de défaut ne connaît pas nos dossiers.
for (const d of ['app', 'lib', 'components']) parcours(d)

/** La valeur neutre, telle que l'appelant la lira. */
const NEUTRE = /^\s*return\s+(null|\[\s*\]|\{\s*\}|0|false)\s*$/

/**
 * ON LIT LE BLOC, PAS UNE FENÊTRE DE CARACTÈRES.
 *
 * La première version bornait la recherche à 400 caractères sans accolade
 * (`[^}]{0,400}`) : elle ne pouvait pas traverser l'objet passé à
 * `console.error({ … })` et a donc RATÉ SON PROPRE CAS SOURCE. Un recensement
 * qui manque l'exemple qui l'a motivé ne vaut rien. On compte les accolades.
 */
function blocApres(code, depuis) {
  const i = code.indexOf('{', depuis)
  if (i < 0) return null
  let profondeur = 0
  // ⚠️ AUCUN PLAFOND DE CARACTÈRES. Une borne de 4000 coupait le corps de
  //    `loadOrganizationContext` (≈5700 caractères) : la fonction rendait
  //    `null`, les deux assertions qui en dépendent rougissaient, et le
  //    contrôle accusait du code correct. Le comptage d'accolades se termine
  //    de lui-même sur du TypeScript valide.
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') profondeur++
    else if (code[j] === '}') {
      profondeur--
      if (profondeur === 0) return code.slice(i + 1, j)
    }
  }
  return null
}

const DECLENCHEURS = [
  { nom: 'erreur', re: /\bif\s*\(\s*\w*(?:[Ee]rr|[Ee]rror)\w*\s*\)\s*(?=\{)/g },
  { nom: 'catch', re: /\bcatch\s*(?:\([^)]*\))?\s*(?=\{)/g },
]

const trouvailles = []
for (const f of sources) {
  const code = sansCommentaires(read(f))
  for (const d of DECLENCHEURS) {
    d.re.lastIndex = 0
    for (const m of code.matchAll(d.re)) {
      const bloc = blocApres(code, m.index)
      if (!bloc) continue
      const ligneNeutre = bloc.split('\n').find((l) => NEUTRE.test(l))
      if (!ligneNeutre) continue
      trouvailles.push({
        f,
        ligne: code.slice(0, m.index).split('\n').length,
        forme: d.nom,
        valeur: ligneNeutre.trim().replace(/^return\s+/, '').replace(/\s/g, ''),
      })
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * A. LE CLIQUET
 *
 * La dette est FIGÉE fichier par fichier, avec sa forme et sa valeur — jamais
 * par numéro de ligne, qui bouge au premier commentaire ajouté. Le cliquet ne
 * juge pas les 33 occurrences existantes : la plupart sont légitimes (un
 * formateur de date qui rend `null`, un pitch best-effort). Il refuse qu'il en
 * apparaisse une NOUVELLE sans qu'on ait regardé ce que l'appelant en fait.
 *
 * MODE D'EMPLOI quand il rougit : ouvrir l'occurrence et répondre à UNE
 * question — la valeur neutre traverse-t-elle une garde qui en tire un refus
 * nommé ? Si non, ajouter la ligne au GEL. Si oui, ce n'est pas un GEL qu'il
 * faut, c'est un état de plus dans le type.
 * ════════════════════════════════════════════════════════════════════════ */

const GEL = {
  'app/[locale]/dashboard/cdi/mon-profil/page.tsx': { 'catch:null': 1 },
  'app/api/admin/durees/route.ts': { 'erreur:null': 1 },
  'app/api/admin/ecosystemes/[id]/impact/route.ts': { 'erreur:null': 3 },
  // NEUVE au lot 4.1c, et c'est une HAUSSE ASSUMEE — la meme forme, le sens
  // inverse. `countByDomain` rendait une map VIDE sur erreur, donc un ZERO,
  // alors que son propre commentaire disait deja « un zero silencieux se lirait
  // comme rien a perdre ». Ce zero n'alimentait pas qu'une colonne : il
  // alimentait `ready`, qui AFFIRME « cet ecosysteme n'accepte ni inscription
  // ni annonce ». Il rend desormais `null`, et l'ecran distingue — comme le
  // detail, qui le faisait deja : les laisser diverger aurait ete §E.36 dans le
  // lot qui le ferme.
  'app/api/admin/ecosystemes/route.ts': { 'erreur:null': 1 },
  // Étaient `erreur:0` — un compteur en panne qui affichait zéro. Devenus
  // `erreur:null` : la forme demeure, le sens s'inverse (§E.22, cas ⑨).
  'app/api/admin/org-usage/route.ts': { 'erreur:null': 2 },
  'app/api/admin/user-purge/route.ts': { 'erreur:null': 1 },
  'app/api/auth/finalize-org-registration/route.ts': { 'catch:false': 1 },
  'app/api/me/organisation/offre/route.ts': { 'catch:null': 2, 'erreur:null': 1 },
  'components/NotificationBell.tsx': { 'catch:[]': 1 },
  'components/OrgSetupModal.tsx': { 'catch:false': 1 },
  'lib/admin/admin-invitation.ts': { 'erreur:false': 1, 'catch:false': 1 },
  'lib/admin/user-actions-guard.ts': { 'erreur:null': 1 },
  'lib/ai-budget.ts': { 'catch:null': 1 },
  'lib/avatar.ts': { 'erreur:null': 1, 'catch:null': 1 },
  // ── LOT 4.1b — SIX HAUSSES ASSUMÉES, ET C'EST LE CLIQUET QUI FONCTIONNE ──
  //   Il a mordu sur mes réparations, comme au lot 1.3. Dans les trois fichiers
  //   ci-dessous, `null` ne veut PAS dire « rien » : il veut dire « je n'ai pas
  //   su lire », et chaque appelant REFUSE dessus (503 nommé). La forme est
  //   celle du défaut, le sens en est l'inverse — le cliquet compte des FORMES,
  //   pas des verdicts, et c'est pour ça qu'il fait lever les yeux.
  'lib/candidature-org-dto.ts': {
    // Fenêtres d'annonce, fenêtres d'échange, profils déverrouillés. Sur une
    // map incomplète, TOUTES les candidatures de l'organisation basculaient en
    // « Annonce clôturée » : son pipeline entier paraissait mort, et le motif
    // accusait ses propres annonces. Les deux routes rendent 503.
    'erreur:null': 3,
  },
  'lib/candidatures/lifecycle-batch.ts': {
    // Le même défaut, côté EXPERT — le jumeau que §E.20 fait chercher.
    // `loadLifecyclePublicationWindows` et la fenêtre d'échange rendent `null` ;
    // `unlock` refuse en 503 plutôt que de déverrouiller (payant, irréversible).
    'erreur:null': 2,
  },
  'lib/verification/expert-verification.ts': {
    // Libellés de spécialité illisibles ⇒ `null`, puis `pending_admin_review`
    // avec un motif NOMMÉ et AUCUNE dépense d'IA. On ne paie pas un verdict
    // qu'on sait bâti sur un dossier amputé (§E.21 : la revue humaine est le
    // repli CONÇU ; ce qui était faux, c'était d'y arriver sans le dire).
    'erreur:null': 1,
  },
  'lib/candidature-pitch-client.ts': { 'catch:null': 1 },
  'lib/candidatures/ai-assessment.ts': { 'catch:null': 1 },
  'lib/emails/domain-url.ts': { 'catch:null': 1 },
  'lib/home-ecosystem.ts': { 'catch:[]': 1 },
  'lib/matching-resync-hint.ts': { 'catch:null': 1 },
  // NEUF au lot 4.1b, et c'est une HAUSSE ASSUMÉE — même raison qu'`org-members`
  // ci-dessous : le cliquet compte des FORMES, pas des verdicts.
  // `runChannel` réclame ses notifications par un UPDATE atomique et ne lisait
  // pas son erreur : « zéro réclamé » et « je n'ai pas pu réclamer » rendaient
  // tous deux 0, qui se lit « rien à envoyer » (§E.22). L'erreur est désormais
  // récupérée et JOURNALISÉE avec l'état du tampon déclaré INCONNU ; le `return 0`
  // qui subsiste est la seule réponse que le type de retour permette, et il
  // n'affirme plus rien puisque le journal, lui, parle.
  'lib/notifications/dispatch.ts': { 'erreur:0': 1 },
  'lib/org-logo.ts': { 'erreur:null': 1, 'catch:null': 1 },
  // 3 depuis ce lot, et c'est une HAUSSE ASSUMÉE : deux `return
  // PRUDENT_COUNT_ON_READ_ERROR` sont devenus `return null`. La forme est la
  // même, le sens est l'inverse — ici `null` veut dire « je ne sais pas » et
  // l'appelant le traite. Le cliquet compte des formes, pas des verdicts ;
  // c'est à la revue de trancher, et c'est pour ça qu'il fait lever les yeux.
  'lib/org-members.ts': { 'erreur:null': 2 },
  'lib/use-org-role.ts': { 'catch:null': 1 },
  'lib/verification/ai-expert-verification.ts': { 'catch:null': 3 },
  // `lib/verification/expert-verification.ts` avait QUITTÉ ce gel au lot 1.3 :
  // ses deux `return null` étaient devenus des motifs nommés (§E.22 ⑦ et ⑧).
  // Il y REVIENT au lot 4.1b, pour une raison OPPOSÉE — une lecture de plus a
  // été rendue honnête, et sa forme est `erreur:null`. L'entrée est plus haut,
  // avec sa raison. Ce n'est pas un retour de dette : c'est la même parade, sur
  // une troisième lecture du même fichier.
}

section('A. CLIQUET — le recensement de la classe est figé')
console.log(`  (${sources.length} sources balayées : app/ + lib/ + components/)`)

const mesure = {}
for (const t of trouvailles) {
  ;(mesure[t.f] ??= {})[`${t.forme}:${t.valeur}`] =
    (mesure[t.f]?.[`${t.forme}:${t.valeur}`] ?? 0) + 1
}

const neuves = []
const disparues = []
for (const [f, formes] of Object.entries(mesure)) {
  for (const [k, n] of Object.entries(formes)) {
    const gele = GEL[f]?.[k] ?? 0
    if (n > gele) neuves.push(`${f} — ${k} × ${n} (gelé : ${gele})`)
  }
}
for (const [f, formes] of Object.entries(GEL)) {
  for (const [k, n] of Object.entries(formes)) {
    const vu = mesure[f]?.[k] ?? 0
    if (vu < n) disparues.push(`${f} — ${k} × ${vu} (gelé : ${n})`)
  }
}

const total = trouvailles.length
const totalGele = Object.values(GEL).reduce(
  (a, formes) => a + Object.values(formes).reduce((b, n) => b + n, 0),
  0,
)
ok(
  neuves.length === 0,
  `aucune occurrence NEUVE de la classe (${total} mesurées, ${totalGele} gelées)`,
  neuves.length ? `neuves :\n        ${neuves.join('\n        ')}` : undefined,
)
if (disparues.length) {
  console.log(`  ↓ la dette a BAISSÉ — retirez ces lignes du GEL :`)
  for (const d of disparues) console.log(`      ${d}`)
}

/* ══════════════════════════════════════════════════════════════════════════
 * B. LES CINQ RÉPARATIONS
 *
 * Chaque assertion est ANCRÉE sur le bloc qu'elle vise, jamais lâchée sur tout
 * le fichier : une regex libre attrape le bloc voisin qui porte le même motif
 * et passe au vert alors que la condition a été retirée (§E.8).
 * ════════════════════════════════════════════════════════════════════════ */

section('B. Les cinq réparations tiennent')

/** Le corps de la fonction nommée, accolades comptées. */
function corpsDe(code, entete) {
  const i = code.indexOf(entete)
  if (i < 0) return ''
  return blocApres(code, i) ?? ''
}

// B.1 — LE CAS SOURCE. `loadOrganizationContext` rendait `null` sur erreur de
//       lecture, et `requireAuth` traduisait ce `null` en 403 `no_organization`.
const authGuard = sansCommentaires(read('lib/auth-guard.ts'))
const corpsOrg = corpsDe(authGuard, 'async function loadOrganizationContext')
/**
 * ⚠️ ANCRÉ SUR LE BLOC `if (memberErr)`, pas sur une fenêtre de caractères.
 *    La première version cherchait `throw` dans les 600 caractères suivants :
 *    les vingt lignes de commentaire du bloc (blanchies, pas supprimées) l'ont
 *    poussé hors de portée, et l'assertion rougissait sur du code correct. Un
 *    contrôle qui crie à tort est désactivé le jour même (§E.12).
 */
const blocMemberErr = blocApres(corpsOrg, corpsOrg.indexOf('if (memberErr)')) ?? ''
ok(
  corpsOrg.includes('if (memberErr)') &&
    /throw new AuthError\(\s*503/.test(blocMemberErr) &&
    !/return null/.test(blocMemberErr),
  'auth-guard : une lecture en échec LÈVE (503), elle ne rend plus `null`',
  '`null` y veut dire « aucune organisation » — et sortait en 403 no_organization',
)
ok(
  corpsOrg !== '' && /if \(!memberRow\) return null/.test(corpsOrg),
  'auth-guard : `null` reste réservé au SEUL cas « aucune organisation »',
)

// B.2 — LA BARRIÈRE D'ACQUITTEMENT. `[]` faisait sauter une confirmation sur
//       une action IRRÉVERSIBLE.
const purge = sansCommentaires(read('app/api/admin/user-purge/route.ts'))
const corpsLock = corpsDe(purge, 'async function organizationsLeftWithoutAdmin')
ok(
  /Promise<LockedOutOrg\[\] \| null>/.test(purge),
  'user-purge : le comptage sait dire « je ne sais pas » (`null`, pas `[]`)',
  "une liste vide affirme « aucune organisation ne sera orpheline »",
)
ok(
  corpsLock !== '' && !/return \[\]/.test(corpsLock),
  'user-purge : plus aucun `return []` dans le comptage',
)
/**
 * ⚠️ LA CONDITION EST ANCRÉE, PAS CHERCHÉE DANS UNE FENÊTRE.
 *    `/lockedOutOrgs === null[\s\S]{0,400}?503/` restait vert sur
 *    `if (false && lockedOutOrgs === null)` — la mutation l'a montré. On exige
 *    la forme exacte du test, puis on lit SON bloc.
 */
const blocLock = blocApres(purge, purge.indexOf('if (lockedOutOrgs === null)')) ?? ''
ok(
  /if \(lockedOutOrgs === null\) \{/.test(purge) &&
    /org_lockout_check_unavailable/.test(blocLock) &&
    /503/.test(blocLock),
  'user-purge : le comptage indisponible REFUSE (503), il ne se tait pas',
  "une purge est irréversible : on ne la lance pas sans savoir ce qu'elle laisse",
)
ok(
  /activeAdminCountOrUnknown/.test(purge) && !/\bcountActiveAdmins\b/.test(purge),
  'user-purge : lit le compteur qui dit `null`, jamais le repli prudent (2)',
  'le repli prudent est écrit pour des appelants RÉVERSIBLES (§E.22)',
)

// B.3 — LE MOTIF QUI MENT. L'erreur de lecture sortait en 403 « profil non
//       vérifié » : le refus était juste, la raison était fausse.
const expertGuard = sansCommentaires(read('lib/expert-verified-guard.ts'))
ok(
  /ExpertProfileGate =[^\n]*'indisponible'/.test(expertGuard),
  "expert-verified-guard : un QUATRIÈME état, `indisponible`, qui n'est pas un verdict",
)
const corpsGate = corpsDe(expertGuard, 'export async function expertProfileGate')
ok(
  corpsGate !== '' && /if \(error\) \{[\s\S]{0,400}?return 'indisponible'/.test(corpsGate),
  "expert-verified-guard : la lecture en échec rend `indisponible`, plus `not_approved`",
)
const corpsBool = corpsDe(expertGuard, 'export async function isExpertProfileApproved')
ok(
  corpsBool !== '' && !/\.from\(/.test(corpsBool) && /expertProfileGate\(/.test(corpsBool),
  'expert-verified-guard : la porte booléenne DÉLÈGUE (une lecture, un raisonnement)',
  'deux lectures parallèles divergent — c’est déjà l’histoire de ce projet',
)

// B.4 — « CET UTILISATEUR N'EXISTE PAS », dit d'un compte parfaitement réel.
const adminGuard = sansCommentaires(read('lib/admin/user-actions-guard.ts'))
const corpsCible = corpsDe(adminGuard, 'export async function loadAdminActionTarget')
ok(
  /Promise<AdminActionTarget \| null \| 'indisponible'>/.test(adminGuard),
  'user-actions-guard : trois réponses distinctes (la cible, `null`, `indisponible`)',
)
ok(
  corpsCible !== '' && /if \(error\) \{[\s\S]{0,600}?return 'indisponible'/.test(corpsCible),
  'user-actions-guard : la lecture en échec ne se fait plus passer pour une absence',
  "`null` sortait en 404 target_not_found sur un compte qui existe",
)
const corpsStatut = corpsDe(adminGuard, 'export function refusalHttpStatus')
ok(
  corpsStatut !== '' && /target_lookup_unavailable[^\n]*503/.test(corpsStatut),
  'user-actions-guard : le refus temporaire sort en 503, ni 403 ni 404',
  'un 403 envoie chercher un droit manquant, un 404 un compte disparu',
)

// B.5 — L'AVERTISSEMENT AVANT LE CLIC. Une liste vide par panne se lisait
//       « rien à perdre » sur la seule action irréversible du back-office.
const getUser = sansCommentaires(read('app/api/admin/get-user/[id]/route.ts'))
ok(
  /purge_org_lockout_unknown/.test(getUser) && /activeAdminCountOrUnknown/.test(getUser),
  'get-user : la fiche distingue « aucune organisation » de « je n’ai pas pu lire »',
)
const ecran = sansCommentaires(read('app/[locale]/admin/utilisateurs/[id]/page.tsx'))
ok(
  /purge_org_lockout_unknown !== false/.test(ecran),
  "l'écran : le drapeau ABSENT vaut « je ne sais pas », jamais « tout va bien »",
  'un défaut optimiste (`?? false`) reproduit exactement le silence qu’on ferme',
)
ok(
  /confirm_purge_org_lockout_unknown/.test(ecran),
  "l'écran : le doute est affiché AVANT le clic, pas découvert après",
)

/* ══════════════════════════════════════════════════════════════════════════
 * C. L'ORDRE DES TESTS CHEZ L'APPELANT
 *
 * Ajouter un état à une union n'est pas gratuit. Le jour où `indisponible` est
 * apparu, `quota/route.ts` testait `gate === 'not_approved'` : le nouvel état
 * ne correspondait à rien, la garde se serait OUVERTE sur une panne de lecture
 * — l'inverse exact du correctif. Le compilateur ne dit rien d'une comparaison
 * qui reste possible. Ce contrôle, si.
 * ════════════════════════════════════════════════════════════════════════ */

section("C. Chaque appelant traite « indisponible » — et AVANT le test métier")

const APPELANTS_GATE = [
  'app/api/me/collaboration/quota/route.ts',
  'app/api/publications/[id]/publish/route.ts',
  'lib/collaboration/ensure-personal-org.ts',
]
for (const f of APPELANTS_GATE) {
  const code = sansCommentaires(read(f))
  if (!/expertProfileGate\(/.test(code)) {
    ok(false, `${f} — appelle bien la porte à quatre états`, 'la porte booléenne ne sait pas expliquer son refus')
    continue
  }
  const iIndispo = code.indexOf("=== 'indisponible'")
  const metier = [...code.matchAll(/(?:!==\s*'approved'|===\s*'not_approved')/g)].map((m) => m.index)
  ok(iIndispo >= 0, `${f} — traite explicitement « indisponible »`)
  ok(
    iIndispo >= 0 && metier.every((i) => i > iIndispo),
    `${f} — le traite AVANT la comparaison métier`,
    'placé après, l’état inconnu tombe dans la branche « approuvé » et OUVRE la garde',
  )
}

// Le balayage de classe : aucun AUTRE fichier ne doit consommer la porte à
// quatre états sans nommer le quatrième.
const autres = sources.filter(
  (f) =>
    !APPELANTS_GATE.includes(f) &&
    f !== 'lib/expert-verified-guard.ts' &&
    /expertProfileGate\(/.test(sansCommentaires(read(f))),
)
ok(
  autres.length === 0,
  'aucun appelant de `expertProfileGate` hors des trois recensés',
  autres.length ? `non traités : ${autres.join(', ')}` : undefined,
)

/* ══════════════════════════════════════════════════════════════════════════
 * D. LE MOTIF HONNÊTE DOIT ARRIVER JUSQU'À L'ÉCRAN
 *
 * Un code de refus que personne ne traduit retombe sur le message générique :
 * on aura remplacé un mensonge précis par un silence poli, ce qui n'est pas
 * mieux. Parité stricte sur les quatre langues (règle projet).
 * ════════════════════════════════════════════════════════════════════════ */

section('D. Les motifs temporaires sont dits, dans les quatre langues')

const LANGUES = ['fr', 'en', 'es', 'de']
const CLES = [
  'admin_back_office.users.confirm_purge_org_lockout_unknown',
  'admin_back_office.users.err_org_lockout_check_unavailable',
  'admin_back_office.users.err_target_lookup_unavailable',
  'collaboration.errors.profile_check_failed',
]
const valeurA = (obj, chemin) => chemin.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
for (const cle of CLES) {
  const manquantes = LANGUES.filter((l) => {
    const v = valeurA(JSON.parse(read(`messages/${l}.json`)), cle)
    return typeof v !== 'string' || v.trim() === ''
  })
  ok(manquantes.length === 0, `${cle} — 4/4 langues`, manquantes.length ? `manque : ${manquantes.join(', ')}` : undefined)
}

// Et le code doit effectivement router le motif vers sa phrase.
ok(
  /case 'org_lockout_check_unavailable'/.test(ecran) && /case 'target_lookup_unavailable'/.test(ecran),
  "l'écran admin route les deux motifs vers leur phrase, pas vers le générique",
)
ok(
  /profile_check_unavailable/.test(sansCommentaires(read('components/collaboration/SousTraitanceView.tsx'))),
  'sous-traitance : la panne de vérification a son propre motif, pas « la publication a échoué »',
)

/* ══════════════════════════════════════════════════════════════════════════
 * F. LE SEUL FAIL-OPEN DE LA CLASSE
 *
 * Les quatre premiers cas REFUSAIENT à tort. Celui-ci ADMETTAIT à tort : une
 * erreur de lecture rendait `null`, c'est-à-dire « ce compte peut rejoindre »,
 * et un compte expert pouvait devenir membre d'une organisation — contre une
 * règle figée du produit. L'affichage peut se taire ; l'écriture, non.
 * ════════════════════════════════════════════════════════════════════════ */

const orgMembersF = sansCommentaires(read('lib/org-members.ts'))

section("F. L'entrée dans une organisation : l'affichage se tait, l'écriture refuse")

const corpsJoin = corpsDe(orgMembersF, 'export async function joinBlockReason')
ok(
  /Promise<JoinBlockReason \| null \| 'indisponible'>/.test(orgMembersF),
  "org-members : `joinBlockReason` distingue « autorisé » de « je n'ai pas pu lire »",
  '`null` était une AUTORISATION : la rendre sur une panne éteint la garde',
)
ok(
  corpsJoin !== '' && (corpsJoin.match(/return 'indisponible'/g) ?? []).length === 2,
  'org-members : les DEUX lectures de la garde rendent « indisponible »',
  'une seule gardée laisse l’autre rouvrir le passage',
)
const accept = sansCommentaires(read('app/api/me/invitations/accept/route.ts'))
const blocJoin = blocApres(accept, accept.indexOf("if (block === 'indisponible')")) ?? ''
ok(
  /if \(block === 'indisponible'\) \{/.test(accept) &&
    /join_check_unavailable/.test(blocJoin) &&
    /503/.test(blocJoin),
  "accept : l'ÉCRITURE refuse (503) quand la vérification n'a pas pu être faite",
  "sans ce refus, le commentaire « jamais d'insertion dans ces cas » est faux",
)
const resolve = sansCommentaires(read('app/api/invitations/resolve/route.ts'))
ok(
  /=== 'indisponible' \? null :/.test(resolve),
  "resolve : l'AFFICHAGE ne signale rien — il n'a jamais gardé, il annonce",
  'afficher un blocage sur une panne accuserait l’invité à tort',
)
for (const [f, cle] of [
  ['components/PendingInvitationGate.tsx', 'join_check_unavailable'],
  ['app/[locale]/invitation/[token]/page.tsx', 'join_check_unavailable'],
]) {
  ok(new RegExp(cle).test(sansCommentaires(read(f))), `${f} — nomme le motif temporaire`)
}
{
  const manquantes = LANGUES.filter((l) => {
    const v = valeurA(JSON.parse(read(`messages/${l}.json`)), 'invitation_public.err_join_check_unavailable')
    return typeof v !== 'string' || v.trim() === ''
  })
  ok(
    manquantes.length === 0,
    'invitation_public.err_join_check_unavailable — 4/4 langues',
    manquantes.length ? `manque : ${manquantes.join(', ')}` : undefined,
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * G. LA VÉRIFICATION D'EXPERT DIT CE QUI LUI MANQUE
 *
 * `loadConfig` rendait `null` pour QUATRE situations — lecture impossible,
 * non configuré, ambigu, incomplet — et l'appelant écrivait EN BASE, sous les
 * yeux de l'administrateur, « Provider profile_verification non configuré ».
 * Sur une panne de lecture, cette phrase envoie configurer ce qui l'est déjà.
 * `loadProfileForVerification` faisait pire : son propre commentaire nommait la
 * distinction (« envoie chercher un profil disparu qui se porte très bien »),
 * puis rendait `null` dans les deux cas — et l'appelant n'écrivait RIEN. Le
 * profil restait en `pending`, « vérification en cours », indéfiniment, sans
 * qu'aucun humain soit saisi.
 * ════════════════════════════════════════════════════════════════════════ */

section("G. La vérification d'expert nomme ce qui manque, et saisit un humain")

const verif = sansCommentaires(read('lib/verification/expert-verification.ts'))
ok(
  /MotifConfigAbsente =[^\n]*'lecture_impossible'/.test(verif) &&
    /'non_configure'/.test(verif) &&
    /'ambigu'/.test(verif) &&
    /'incomplet'/.test(verif),
  'expert-verification : quatre motifs distincts, plus un `null` pour quatre situations',
)
{
  // Les quatre NOTES doivent être distinctes : c'est la note qui est écrite en
  // base et lue par l'administrateur, pas le motif interne.
  const bloc = blocApres(verif, verif.indexOf('const NOTE')) ?? ''
  const notes = [...bloc.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).filter((t) => t.length > 30)
  ok(
    notes.length >= 4 && new Set(notes).size === notes.length,
    'expert-verification : les quatre notes écrites en base sont DISTINCTES',
    "c'est la note que l'administrateur lit, et elle décide de ce qu'il va regarder",
  )
}
ok(
  /return 'indisponible'/.test(verif) &&
    /loaded === 'indisponible'/.test(verif),
  'expert-verification : la lecture de profil en échec est distinguée de « profil absent »',
)
{
  const bloc = blocApres(verif, verif.indexOf("if (loaded === 'indisponible')")) ?? ''
  ok(
    /verification_status: 'pending_admin_review'/.test(bloc) && /\.update\(/.test(bloc),
    'expert-verification : elle ÉCRIT, et saisit un humain — elle ne se tait plus',
    "ne rien écrire laissait le profil en `pending` : « en cours », pour toujours",
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * H. UN COMPTEUR EN PANNE N'AFFICHE PAS ZÉRO
 *
 * « 0 / 2 annonces ce mois-ci » lu par l'administrateur qui décide d'attribuer
 * une offre pilote, et par l'organisation qui croit avoir toute sa place. Le
 * dépôt portait déjà le bon choix deux fichiers plus loin
 * (`ecosystemes/[id]/impact` rend `null` et l'écran montre « — ») ; ces deux
 * compteurs-là rendaient `0`.
 * ════════════════════════════════════════════════════════════════════════ */

section("H. Un compteur illisible affiche « — », jamais zéro")

for (const [f, label] of [
  ['app/api/admin/org-usage/route.ts', 'back-office : consommation d’une organisation'],
  ['app/api/me/organisation/offre/route.ts', 'organisation : sa propre consommation'],
]) {
  const code = sansCommentaires(read(f))
  ok(
    /Promise<number \| null>/.test(code) && !/return 0\b/.test(code),
    `${label} — le compteur rend \`null\`, plus \`0\``,
    'zéro affirme « rien consommé » au moment précis où l’on décide',
  )
}
for (const [f, motif, label] of [
  ['app/[locale]/admin/organisations/[id]/page.tsx', /used == null \? '—'/, "l'écran back-office"],
  ['app/[locale]/dashboard/entreprise/offre/page.tsx', /used == null \? '—'/, "l'écran de l'organisation"],
]) {
  ok(motif.test(sansCommentaires(read(f))), `${label} — rend « — » sur un compteur illisible`)
}
ok(
  /used != null && limit != null && used >= limit/.test(
    sansCommentaires(read('app/[locale]/dashboard/entreprise/offre/page.tsx')),
  ),
  "l'écran de l'organisation — une consommation inconnue n'est ni « au plafond » ni « à zéro »",
  'un repli à 0 aurait peint la barre vide et promis de la place non comptée',
)

/* ══════════════════════════════════════════════════════════════════════════
 * E. LES DEUX COMPTEURS NE SE CONFONDENT PAS
 * ════════════════════════════════════════════════════════════════════════ */

section('E. Le repli prudent reste réservé aux appelants réversibles')

const corpsFacade = corpsDe(orgMembersF, 'export async function countActiveAdmins')
const orgMembers = orgMembersF
ok(
  /export async function activeAdminCountOrUnknown/.test(orgMembers),
  'org-members : la lecture vit une seule fois, et sait rendre `null`',
)
ok(
  corpsFacade !== '' && !/\.from\(/.test(corpsFacade) && /activeAdminCountOrUnknown\(/.test(corpsFacade),
  'org-members : `countActiveAdmins` n’est plus qu’une façade qui applique le repli',
  'deux lectures jumelles divergent, et c’est la garde qui s’éteint',
)
ok(
  /PRUDENT_COUNT_ON_READ_ERROR = 2/.test(orgMembers),
  'org-members : le repli prudent (2) existe toujours pour les trois appelants réversibles',
)
for (const f of ['app/api/admin/user-purge/route.ts', 'app/api/admin/get-user/[id]/route.ts']) {
  ok(
    !/\bcountActiveAdmins\b/.test(sansCommentaires(read(f))),
    `${f} — appelant DÉFINITIF : n’utilise pas le repli prudent`,
    'rendre 2 sur une panne affirme « cette organisation a d’autres administrateurs »',
  )
}

/* ════════════════════════════════════════════════════════════════════════ */
console.log(`\n${'─'.repeat(78)}`)
console.log(`${vert} vert${vert > 1 ? 's' : ''} · ${rouge} rouge${rouge > 1 ? 's' : ''}`)
if (rouge === 0) {
  console.log('VERT — la classe est sous cliquet, les cinq réparations tiennent.')
} else {
  console.log('ROUGE — voir ci-dessus.')
}
process.exit(rouge === 0 ? 0 : 1)
