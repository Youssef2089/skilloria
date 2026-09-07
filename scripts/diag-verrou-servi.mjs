// scripts/diag-verrou-servi.mjs — LE VERROU EST VISIBLE SANS JAMAIS FUIR.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le verrou d'encaissement était PARFAITEMENT ÉTANCHE — et donc TOTALEMENT
//   INVISIBLE. `ENABLE_BILLING` n'était lu que par les routes de paiement ;
//   aucun écran ne savait s'il devait montrer un mur ou une porte. Poser la
//   variable à vrai n'aurait donc rien changé de visible : quatre routes
//   auraient cessé de répondre 503, sans qu'aucun bouton n'existe pour les
//   appeler.
//
//   Deux façons de rater ce point, et elles sont opposées :
//
//     · NE PAS le servir du tout — l'ouverture du jour J ne se voit pas, et il
//       faut alors redéployer de la logique d'écran pour la rendre visible.
//
//     · Le servir par une variable `NEXT_PUBLIC_` — elle est INLINÉE dans le
//       bundle navigateur. Le verrou y devient lisible, et surtout l'UI peut
//       diverger du serveur, qui reste seul à décider. Ce n'est plus un verrou,
//       c'est une préférence d'affichage.
//
//   Ce diagnostic tient les deux bouts : servi depuis le serveur, jamais
//   publié, et l'écran en dérive vraiment ce qu'il propose.
//
// CE QU'IL VÉRIFIE
//   1. Aucune variable publique ne porte le verrou, nulle part.
//   2. Il est servi par une route SERVEUR, depuis lib/billing/config.
//   3. L'écran en dérive ses actions, et FERME par défaut (`=== true`) :
//      un payload sans le champ ne doit jamais ouvrir une porte.
//   4. Le retour de paiement est lu, contre une liste FERMÉE, et n'accorde rien.
//   5. Le bandeau d'échec dérive du statut Stripe — AFFICHAGE UNIQUEMENT :
//      aucune lecture de droits n'en dépend.
//   6. Aucun écran mort : les actions révélées mènent à quelque chose qui existe.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-verrou-servi.mjs   → contrôles statiques. AUCUN accès base.
//
// LECTURE PURE : ce script n'écrit JAMAIS et ne joint jamais la base.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
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

const ECRAN = 'app/[locale]/dashboard/entreprise/offre/page.tsx'
const ROUTE_OFFRE = 'app/api/me/organisation/offre/route.ts'
const ROUTE_OFFRES = 'app/api/billing/offers/route.ts'
const RETOUR = 'app/api/billing/return/route.ts'

console.log('\nLE VERROU — visible, jamais fuité\n')

// ─────────────────────────────────────────────────────────────────────────────
section('0. Présence des artefacts')

for (const f of [ECRAN, ROUTE_OFFRE, ROUTE_OFFRES, RETOUR]) ok(exists(f), `${f} existe`)
if (!exists(ECRAN)) {
  console.log('\nArrêt : écran « Mon offre » introuvable.\n')
  process.exit(1)
}

const ecran = sansCommentaires(read(ECRAN))
const routeOffre = sansCommentaires(read(ROUTE_OFFRE))
const routeOffres = sansCommentaires(read(ROUTE_OFFRES))

// ─────────────────────────────────────────────────────────────────────────────
section('1. Le verrou ne fuit PAS dans le bundle client')

/** Balayage app/ ET lib/ : les clients Supabase ne sont pas typés, rien d'autre
 *  ne verrait une variable publique glissée dans un composant. */
function fichiers(rel, out = []) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) return out
  if (statSync(abs).isDirectory()) {
    for (const e of readdirSync(abs)) fichiers(join(rel, e), out)
    return out
  }
  if (/\.(ts|tsx|mjs)$/.test(rel)) out.push(rel)
  return out
}
const sources = ['app', 'lib', 'components'].flatMap((d) => fichiers(d))

const fuites = []
for (const rel of sources) {
  const m = readFileSync(join(ROOT, rel), 'utf8').match(
    /NEXT_PUBLIC_[A-Z_0-9]*(?:STRIPE|BILLING|PAIEMENT|PAYMENT)[A-Z_0-9]*/,
  )
  if (m) fuites.push(`${rel} → ${m[0]}`)
}
ok(fuites.length === 0, 'aucune variable NEXT_PUBLIC_ ne porte le verrou', fuites.join(' | '))

// Le verrou se lit dans lib/billing, et nulle part ailleurs.
const lecteurs = sources.filter(
  (rel) =>
    /process\.env\.ENABLE_BILLING/.test(readFileSync(join(ROOT, rel), 'utf8')) &&
    !/lib[\\/]billing[\\/]/.test(rel),
)
ok(
  lecteurs.length === 0,
  'ENABLE_BILLING n’est lu que dans lib/billing',
  lecteurs.length ? `lu ailleurs : ${lecteurs.join(', ')}` : undefined,
)

// ─────────────────────────────────────────────────────────────────────────────
section('2. Il est SERVI par une route serveur')

ok(
  /import \{ billingEnabled \} from '@\/lib\/billing\/config'/.test(routeOffre),
  'la route « Mon offre » importe billingEnabled depuis lib/billing/config',
)
ok(
  /billing_enabled: billingEnabled\(\)/.test(routeOffre),
  'la route renvoie billing_enabled, calculé au serveur',
)
ok(
  /subscription_status:/.test(routeOffre),
  'la route renvoie le statut d’abonnement (affichage du bandeau d’échec)',
)
// Aucun identifiant de paiement ne doit descendre au client.
for (const champ of ['stripe_customer_id', 'stripe_subscription_id', 'stripe_price_id']) {
  ok(
    !new RegExp(`${champ}\\s*:`).test(routeOffre) && !new RegExp(`${champ}\\s*:`).test(routeOffres),
    `aucun ${champ} n’est renvoyé au client`,
    'Un identifiant de paiement n’a rien à faire dans un bundle navigateur.',
  )
}

// ─────────────────────────────────────────────────────────────────────────────
section('3. L’écran en dérive ses actions, et FERME par défaut')

ok(
  /billing_enabled === true/.test(ecran),
  'le verrou est testé avec `=== true` (fermé par défaut)',
  "Un payload sans le champ — route antérieure, réponse tronquée — ne doit JAMAIS ouvrir une porte.",
)
ok(
  /!verrouOuvert &&[\s\S]{0,200}?contact_to_change/.test(ecran),
  'verrou FERMÉ : une ligne de contact, pas un bouton mort',
)
ok(
  /verrouOuvert &&[\s\S]{0,900}?change_plan/.test(ecran),
  'verrou OUVERT : le changement d’offre apparaît',
)
ok(
  /verrouOuvert &&[\s\S]{0,900}?open_portal/.test(ecran),
  'verrou OUVERT : l’accès au portail apparaît',
)
// L'appel à l'action bascule aussi — sinon « contactez-nous » resterait affiché
// à côté d'un bouton de paiement actif.
ok(
  /verrouOuvert \? tCommerce\('need_more_upgrade'\) : tCommerce\('need_more_contact'\)/.test(ecran),
  'l’appel à l’action bascule avec le verrou',
)

// ─────────────────────────────────────────────────────────────────────────────
section('4. Le retour de paiement est lu, et n’accorde rien')

ok(/useSearchParams/.test(ecran), 'l’écran lit les paramètres d’URL')
ok(
  /searchParams\.get\('paiement'\)/.test(ecran),
  'il ramasse le drapeau que la route de retour dépose depuis le premier jour',
)
ok(
  /drapeau === 'succes' \|\| drapeau === 'annule'/.test(ecran),
  'le drapeau est validé contre une liste FERMÉE',
  "Il vient de l'URL, donc de l'utilisateur : tout le reste est ignoré.",
)
// Le drapeau ne doit RIEN écrire : les droits viennent du webhook.
const bloc = ecran.slice(ecran.search(/retourPaiement/), ecran.search(/retourPaiement/) + 1200)
ok(
  !/secureFetch\([^)]*(billing\/(checkout|change-plan))/.test(bloc),
  'le retour de paiement ne déclenche aucun appel de paiement',
)

// ─────────────────────────────────────────────────────────────────────────────
section('5. Le statut Stripe reste de l’AFFICHAGE')

ok(
  /subscription_status === 'past_due'/.test(ecran),
  'le bandeau d’échec dérive du statut d’abonnement',
)
// Il ne doit décider QUE d'un bandeau : jamais d'une limite, jamais d'un droit.
ok(
  !/subscription_status[\s\S]{0,120}?(limits|canPublish|canUnlock)/.test(ecran),
  'aucune limite ni aucun droit ne dépend du statut Stripe',
  'La colonne est commentée « AFFICHAGE UNIQUEMENT » en base : c’est ici que ça se tient.',
)
ok(
  /paiementEnEchec/.test(ecran) && /payment_failed_title/.test(ecran),
  'le bandeau dit que les accès sont maintenus pendant les relances',
)

// ─────────────────────────────────────────────────────────────────────────────
section('6. Aucun écran mort')

// Toute destination interne révélée par le verrou doit exister.
const liens = [...ecran.matchAll(/href=\{?`?\/\$\{locale\}([^`"'}]*)/g)].map((m) => m[1])
const morts = liens.filter((chemin) => {
  const p = join('app', '[locale]', chemin.replace(/^\//, ''))
  return !exists(join(p, 'page.tsx'))
})
ok(
  morts.length === 0,
  `les destinations internes existent (${liens.length} lien(s) examiné(s))`,
  morts.length ? `écran(s) mort(s) : ${morts.join(', ')}` : undefined,
)
ok(
  /\/api\/billing\/offers/.test(ecran) && exists(ROUTE_OFFRES),
  'le sélecteur d’offres appelle une route qui existe',
)
// Le catalogue vient du serveur, jamais de l'écran.
ok(
  !/price_monthly:\s*\d|349|899/.test(ecran),
  'aucun prix n’est écrit dans l’écran',
  'Les prix vivent au catalogue ; les recopier les figerait au premier réglage.',
)
ok(
  /is_default/.test(routeOffres) && /price_monthly/.test(routeOffres),
  'la route n’expose que les offres réellement vendables',
)

console.log(
  failures === 0
    ? '\nRÉSULTAT : tout est vert. Le verrou se voit, il ne fuit pas, et il ferme par défaut.\n'
    : `\nRÉSULTAT : ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
