// scripts/diag-selecteur-ecosysteme.mjs — LA BASCULE ENTRE ECOSYSTEMES
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le lot 2 a ferme la garde d'entree. Il restait une porte sans poignee :
//   les trois refus qu'il cree n'avaient AUCUN ecran, et un sous-domaine
//   inconnu rendait la coquille du tableau de bord dont chaque appel repondait
//   403. La securite etait fermee, l'experience ne l'etait pas.
//
//   Six regressions defont ce lot, et ce script existe pour chacune :
//
//   R1 — init-session est rappele a la bascule. C'est LE reflexe a ne pas
//        avoir : il fait TOURNER `last_session_token`, et la session unique
//        (11F) ejecte alors en `session_superseded` tous les autres onglets
//        ouverts — sur des ecosystemes qu'ils regardaient paisiblement. Rien
//        ne l'exige : le cookie est pose sur `Domain=.skilloria.io`, donc
//        partage par tous les sous-domaines.
//
//   R2 — un SECOND ETAT apparait a cote de l'URL (cookie de preference, etat
//        React, parametre de requete). Il finira par diverger, et l'ecran
//        affichera un ecosysteme pendant que le serveur en sert un autre.
//
//   R3 — la construction d'URL diverge de `resolveSubdomainFromHost`. Le
//        selecteur fabriquerait alors des adresses que la garde refuse : un
//        aller simple vers un 403. Le controle verifie l'ALLER-RETOUR.
//
//   R4 — le slug cesse d'etre valide. Il arrive parfois d'un parametre d'URL,
//        donc de n'importe qui : une valeur comme `evil.com` construirait un
//        lien vers un hote etranger, affiche dans nos couleurs et presente
//        comme « votre ecosysteme ».
//
//   R5 — la route sert la liste COMPLETE au lieu de ce que l'appelant peut
//        atteindre. Le selecteur proposerait des destinations que la garde
//        refuse ensuite : une porte ouverte pour etre fermee au nez.
//
//   R6 — un des trois codes perd son ecran, ou son texte dans une langue.
//        Il retombe alors sur le message generique, et l'utilisateur perd la
//        seule information qui lui servait : ou aller.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-selecteur-ecosysteme.mjs
//
//   Les sections A et B n'analysent aucun texte : elles IMPORTENT les vraies
//   fonctions et les executent sur de vrais hotes et de vraies entrees
//   hostiles.
//
// LECTURE PURE : ce script n'ecrit JAMAIS et ne touche JAMAIS la base.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

// Commentaires retires : toute la lecture statique cherche des fragments de
// code qu'un commentaire contient aussi bien. Sans ce depouillement, une garde
// pourrait etre supprimee et remplacee par sa description.
const strip = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// UN SEUL module, et il n'a AUCUN import : Node l'execute tel quel.
const {
  swapEcosystemHost, ecosystemHref, isValidEcosystemSlug,
  parseEcosystemScreenParams, ECOSYSTEM_SCREEN_CODES, ECOSYSTEM_UNAVAILABLE_PATH,
} = await import('../lib/ecosystem-url.ts')
const { resolveSubdomainFromHost } = await import('../lib/subdomain.ts')

// ═══ A. L'URL, SEULE SOURCE DE VERITE ══════════════════════════════════════
section('A. Construction d’adresse, executee')

const HOSTS = [
  ['microsoft.skilloria.io', 'sap', 'sap.skilloria.io', 'production'],
  ['microsoft.staging.skilloria.io', 'sap', 'sap.staging.skilloria.io', 'staging par sous-domaine'],
  ['microsoft.skilloria.io:3000', 'sap', 'sap.skilloria.io:3000', 'le port est conserve'],
  ['MICROSOFT.Skilloria.IO', 'sap', 'sap.skilloria.io', 'casse normalisee'],
  ['skilloria.io', 'sap', null, 'apex : rien a remplacer'],
  ['localhost:3000', 'sap', null, 'developpement local'],
  ['127.0.0.1:3000', 'sap', null, 'developpement local (IP)'],
]
for (const [host, slug, attendu, quoi] of HOSTS) {
  const got = swapEcosystemHost(host, slug)
  ok(got === attendu, `${quoi} — ${host} → ${attendu ?? 'null'}`, `obtenu ${JSON.stringify(got)}`)
}

// R3 — L'ALLER-RETOUR. L'hote produit doit se reparser en le slug demande.
// C'est l'invariant qui empeche le selecteur de fabriquer des adresses que la
// garde refusera.
// ⚠️ ON REPARSE CE QUE LA FONCTION A PRODUIT, pas la valeur attendue du
//    tableau. La premiere version comparait `attendu` a lui-meme : elle
//    validait mon tableau contre mon tableau, sans jamais appeler
//    swapEcosystemHost. Un aller-retour qui ne part pas d'un aller ne
//    verifie rien.
process.env.DEV_DOMAIN_SLUG ||= 'diag'
const allerRetour = HOSTS.filter(([, , a]) => a !== null).every(
  ([host, slug]) => resolveSubdomainFromHost(swapEcosystemHost(host, slug)) === slug,
)
ok(allerRetour,
  'tout hote construit se reparse en le slug demande',
  'sinon le selecteur mene vers un 403 : la construction et la lecture ont diverge')

// Le chemin est conserve — la bascule ne fait pas perdre le fil.
ok(
  ecosystemHref({
    host: 'microsoft.skilloria.io',
    slug: 'sap',
    protocol: 'https:',
    pathname: '/fr/dashboard/entreprise/annonces',
    search: '?statut=publiee',
  }) === 'https://sap.skilloria.io/fr/dashboard/entreprise/annonces?statut=publiee',
  'le chemin ET les parametres sont conserves a la bascule')
ok(ecosystemHref({ host: 'localhost:3000', slug: 'sap' }) === null,
  'un hote sans sous-domaine ne produit AUCUNE adresse',
  'le selecteur doit le DIRE, pas proposer un lien sans effet')

// ═══ B. LE SLUG EST UNE ENTREE HOSTILE ═════════════════════════════════════
section('B. Anti-redirection')

const HOSTILES = [
  'evil.com', '../evil', '//evil.com', 'a.b', 'javascript:alert(1)',
  'A', '-a', 'a-', '', ' ', 'a b', 'a/b', 'a:b', null, undefined,
]
const admis = HOSTILES.filter((v) => isValidEcosystemSlug(v))
ok(admis.length === 0,
  'aucune entree hostile n’est acceptee comme slug',
  admis.length ? `admises a tort : ${admis.map((v) => JSON.stringify(v)).join(', ')}` : undefined)
ok(['sap', 'microsoft', 'a', 'a-b-c', 'x1'].every(isValidEcosystemSlug),
  'les slugs legitimes restent acceptes',
  'une garde qui refuse tout ne garde rien, elle casse')

const construits = HOSTILES.filter(
  (v) => swapEcosystemHost('microsoft.skilloria.io', v) !== null,
)
ok(construits.length === 0,
  'aucune entree hostile ne construit d’adresse',
  construits.length ? `construites : ${construits.join(', ')}` : undefined)

// Le lavage des parametres d'ecran.
const lave = parseEcosystemScreenParams({ code: 'domain_mismatch', slug: 'evil.com' })
ok(lave.slug === null, 'un slug hostile est jete par l’ecran')
ok(lave.code === 'domain_mismatch', 'un code legitime traverse')
ok(parseEcosystemScreenParams({ code: 'unknown_user_type' }).code === null,
  'un code SANS ecran retombe sur le message generique',
  'unknown_user_type et domain_lookup_failed sont des anomalies plateforme, pas des situations lisibles')
ok(parseEcosystemScreenParams({ code: '<script>alert(1)</script>' }).code === null,
  'un code arbitraire ne traverse pas',
  'afficher une chaine libre, c’est offrir un ecran de la plateforme a qui veut y ecrire')

// ═══ C. LA BASCULE NE ROTE PAS LE JETON ════════════════════════════════════
section('C. init-session n’est PAS rappele')

const SW = strip(read('components/shell/EcosystemSwitcher.tsx'))

// R1 — LE CONTROLE CENTRAL DE CE LOT.
ok(!/init-session|initSession/.test(SW),
  'le selecteur n’appelle JAMAIS init-session',
  'init-session fait tourner last_session_token : tous les autres onglets seraient ejectes en session_superseded')
ok(/window\.location\.assign\(/.test(SW),
  'la bascule est une navigation COMPLETE',
  'on change d’origine : un push client ne relirait pas x-subdomain cote serveur')
// R2 — aucun second etat.
ok(!/document\.cookie|localStorage|sessionStorage/.test(SW),
  'aucun etat persiste a cote de l’URL',
  'un second etat finira par diverger de l’adresse, et l’ecran mentira')
ok(/ecosystemHref\(/.test(SW),
  'l’adresse vient de la source unique, elle n’est pas recomposee sur place')

// Il se retire quand il n'a rien a proposer.
ok(/if \(list\.length < 2\) return null/.test(SW),
  'un seul ecosysteme atteignable → aucun rendu',
  'un menu a une entree suggere un choix qui n’existe pas')

// Monte cote ORGANISATION uniquement.
const TOPBAR = strip(read('components/shell/DashboardTopbar.tsx'))
ok(/\{side === 'entreprise' && <EcosystemSwitcher \/>\}/.test(TOPBAR),
  'le selecteur n’est monte que cote organisation',
  'un expert reste sur le sien a vie')

// ═══ D. LA ROUTE SERT CE QUE LA GARDE ADMET ════════════════════════════════
section('D. La liste ne ment pas')

const ROUTE = strip(read('app/api/me/ecosystemes/route.ts'))
ok(/ecosystemAccessScope\(auth\.user\.user_type\)/.test(ROUTE),
  'la route filtre avec la MEME regle que la garde')
// R5 — l'expert ne voit que le sien.
ok(/if \(scope === 'own'\) query = query\.eq\('id', auth\.user\.domain_id\)/.test(ROUTE),
  'un expert ne recoit QUE son ecosysteme')
ok(/if \(scope === null\)[\s\S]{0,220}?403\)/.test(ROUTE),
  'un user_type inconnu fait ECHOUER la liste',
  'plutot que de tout servir « puisque de toute facon la garde refusera »')
ok(/\.eq\('active', true\)/.test(ROUTE),
  'seuls les ecosystemes ACTIFS sont listes')
// Nom, slug, couleur — rien d'autre.
const champs = (ROUTE.match(/\.select\('([^']+)'\)/) ?? [])[1] ?? ''
ok(/^id, slug, name, domain_configs\(primary_color\)$/.test(champs),
  'la route ne lit que id, slug, nom et couleur',
  `lu : ${champs || '(introuvable)'} — tout champ servi « au cas ou » finit lu par quelqu’un`)
ok(/tBDD\(translations, 'domains'/.test(ROUTE),
  'le nom d’ecosysteme passe par la table translations')
ok(/current: auth\.domain\.slug/.test(ROUTE),
  'l’entree cochee est l’ecosysteme ACTIF, pas celui du compte')

// ═══ E. LES TROIS CODES ONT UN ECRAN ═══════════════════════════════════════
section('E. Trois refus, trois ecrans, quatre langues')

ok(ECOSYSTEM_SCREEN_CODES.length === 3 &&
   ['domain_mismatch', 'unknown_domain', 'domain_inactive'].every((c) => ECOSYSTEM_SCREEN_CODES.includes(c)),
  'les trois codes a ecran sont declares',
  `declares : ${ECOSYSTEM_SCREEN_CODES.join(', ')}`)

// R6 — le texte existe dans les QUATRE langues, pour CHAQUE code.
const LOCALES = ['fr', 'en', 'es', 'de']
const msgs = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), 'utf8'))]),
)
const at = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o)
for (const code of [...ECOSYSTEM_SCREEN_CODES, 'generic']) {
  for (const champ of ['title', 'body']) {
    const manquants = LOCALES.filter(
      (l) => typeof at(msgs[l], `ecosystem_unavailable.${code}.${champ}`) !== 'string',
    )
    ok(manquants.length === 0,
      `${code}.${champ} existe dans les 4 langues`,
      manquants.length ? `manquant en : ${manquants.join(', ')}` : undefined)
  }
}
// La SORTIE de l'expert egare : le slug et l'adresse pour y aller.
for (const k of ['own_label', 'cta', 'no_link']) {
  const manquants = LOCALES.filter(
    (l) => typeof at(msgs[l], `ecosystem_unavailable.domain_mismatch.${k}`) !== 'string',
  )
  ok(manquants.length === 0, `domain_mismatch.${k} existe dans les 4 langues`,
    manquants.length ? `manquant en : ${manquants.join(', ')}` : undefined)
}

const PAGE = strip(read('app/[locale]/ecosysteme-indisponible/page.tsx'))
ok(/parseEcosystemScreenParams\(sp\)/.test(PAGE),
  'l’ecran lave ses parametres avant de les afficher')
ok(/ecosystemHref\(\{ host, slug, protocol: proto/.test(PAGE),
  'le lien de sortie est reconstruit depuis l’HOTE COURANT',
  'jamais depuis une valeur recue : c’est ce qui empeche la redirection ouverte')

// Le filet cote client intercepte EXACTEMENT ces codes, sans deconnecter.
const FETCH = strip(read('lib/secure-fetch.ts'))
ok(/const ECOSYSTEM_DENIALS = new Set<string>\(ECOSYSTEM_SCREEN_CODES\)/.test(FETCH),
  'le filet client importe la liste des codes, il ne la recopie pas',
  'deux listes divergent, et le code absent de l’une produit le 403 muet qu’on corrige')
const denied = FETCH.slice(FETCH.indexOf('onEcosystemDenied: (code, ownSlug)'))
ok(!/signOut/.test(denied.slice(0, 400)),
  'un refus d’ecosysteme ne DECONNECTE pas',
  'la session est valide — purger ferait perdre l’acces aux AUTRES ecosystemes')

// ═══ F. AUCUNE BOUCLE DE REDIRECTION ═══════════════════════════════════════
section('F. La redirection ne boucle pas')

ok(!ECOSYSTEM_UNAVAILABLE_PATH.startsWith('/dashboard'),
  'l’ecran vit HORS de /dashboard',
  'sinon la garde du dashboard s’y executerait et redirigerait vers lui-meme')

const DASH = strip(read('lib/dashboard-routing-guard.ts'))
ok(/redirect\(`\$\{ECOSYSTEM_UNAVAILABLE_PATH\}/.test(DASH),
  'la garde du dashboard redirige vers cet ecran')
// ORDRE : l'ecosysteme AVANT le role.
// Dans le CORPS de la fonction, pas dans le fichier : `resolveEcosystemAccess`
// apparait d'abord dans la ligne d'IMPORT, tout en haut. Comparer les positions
// a l'echelle du fichier faisait donc toujours passer l'ecosysteme « avant »,
// quelle que soit la realite du code.
const DASH_BODY = DASH.slice(DASH.indexOf('export async function assertDashboardRoleGuard'))
const iEco = DASH_BODY.indexOf('await resolveEcosystemAccess({')
const iRole = DASH_BODY.indexOf('allowedUserTypesForDashboardSegment(segment)')
ok(iEco !== -1 && iRole !== -1 && iEco < iRole,
  'l’ecosysteme est verifie AVANT le role',
  'rediriger vers le bon dashboard d’abord laisserait l’utilisateur sur le mauvais sous-domaine')

// ═══ G. LE COOKIE DE STAGING VOIT LES SOUS-DOMAINES ════════════════════════
section('G. Staging : une seule regle, et elle voit les sous-domaines')

const TOK = strip(read('lib/session-token.ts'))
ok(/h === 'staging\.skilloria\.io' \|\| h\.endsWith\('\.staging\.skilloria\.io'\)/.test(TOK),
  'l’hote de staging inclut ses SOUS-DOMAINES',
  'sinon <slug>.staging poserait `ss_token` sur .skilloria.io — donc SUR le cookie de production')
ok(!/staging\.skilloria\.io/.test(DASH),
  'la garde du dashboard ne recopie plus la regle',
  'deux copies finissent par lire deux cookies differents, et celle qui lit le mauvais ne garde plus rien')
ok(/sessionCookieNameForHost\(host\)/.test(DASH),
  'elle l’importe depuis lib/session-token.ts')

console.log(failures === 0 ? '\n✔ TOUT VERT' : `\n✘ ${failures} CONTROLE(S) EN ECHEC`)
process.exit(failures === 0 ? 0 : 1)
