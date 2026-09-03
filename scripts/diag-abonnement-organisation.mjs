// scripts/diag-abonnement-organisation.mjs — L'ABONNEMENT VIT SUR L'ORGANISATION
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   L'abonnement vivait sur `organization_domains(organisation, domaine)`. Dans
//   le modele produit actuel — toute organisation accede a TOUS les ecosystemes
//   actifs, avec UN SEUL abonnement partage — cette resolution produisait un
//   DEFAUT D'ARGENT SILENCIEUX :
//
//     une organisation qui paie sur son ecosysteme d'inscription et navigue sur
//     un autre n'y trouve AUCUNE ligne de rattachement. `getOrgEntitlements`
//     retombe alors sur l'offre GRATUITE par defaut. Elle paie, perd ses
//     droits, et AUCUN ecran ne le signale.
//
//   Trois regressions le ramenent, et ce script existe pour chacune :
//
//   R1 — quelqu'un relit `organization_domains.package_id`. La table est
//        conservee en TRACE HISTORIQUE ; son commentaire dit qu'elle n'alimente
//        plus aucune decision. Un commentaire n'empeche personne : ce controle,
//        si.
//
//   R2 — `getOrgEntitlements` reprend un parametre de domaine. Il a ete RETIRE,
//        pas ignore : un argument qu'on passe et qui ne sert a rien reinstalle
//        exactement l'ambiguite qu'on vient de supprimer.
//
//   R3 — le filtre par ecosysteme revient dans le back-office. Un administrateur
//        est PLATEFORME : restreindre son enrichissement a son propre
//        ecosysteme lui masquerait l'offre des organisations vues d'ailleurs.
//
//   Plus une quatrieme, propre a la coordination entre worktrees :
//   R4 — les colonnes Stripe reapparaissent sur `organization_domains`. Le
//        webhook Stripe (lot 1, pas encore ecrit) doit viser `organizations`.
//        Deux cibles concurrentes = un abonnement encaisse et invisible.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-abonnement-organisation.mjs        → controles statiques.
//   node --env-file=.env.local scripts/diag-abonnement-organisation.mjs --db
//                                                        → + PREUVE que la
//                                                          reprise n'a rien
//                                                          perdu.
//
// LECTURE PURE : ce script n'ecrit JAMAIS, dans aucun mode.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const MIGRATION = 'supabase/migrations/20260903000000_abonnement_sur_organisation.sql'
const mig = read(MIGRATION)

/**
 * SQL EXECUTABLE UNIQUEMENT — commentaires retires.
 *
 * Ce controle a d'abord ete DECORATIF : il cherchait `usage_counters` dans le
 * fichier entier, et matchait le commentaire de la migration qui dit, mot pour
 * mot, qu'on n'y touche pas. Il passait donc du rouge au vert selon ce que la
 * migration RACONTE, jamais selon ce qu'elle FAIT.
 */
const stripSql = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
const migSql = stripSql(mig)
const ents = read('lib/entitlements.ts')

// ═══ A. LA MIGRATION DEPLACE VRAIMENT ══════════════════════════════════════
section('A. La migration deplace l’abonnement')

for (const col of [
  'package_id', 'package_started_at', 'package_valid_until',
  'stripe_subscription_id', 'stripe_subscription_status', 'package_source_event_at',
]) {
  ok(new RegExp(`add column if not exists ${col}`).test(mig),
    `organizations gagne ${col}`)
}
// R4 — les colonnes PARTENT de organization_domains, elles n'y sont pas dupliquees.
for (const col of ['stripe_subscription_id', 'stripe_subscription_status', 'package_id']) {
  ok(new RegExp(`drop column if exists ${col}`).test(mig),
    `organization_domains perd ${col}`,
    'une colonne d’abonnement sur une table qui n’alimente plus aucune decision est le piege exact que la trace est censee eviter')
}
ok(/drop index if exists public\.idx_org_domains_stripe_subscription/.test(mig),
  'l’index unique Stripe est retire de organization_domains')
ok(/drop constraint if exists org_domains_subscription_status_check/.test(mig),
  'la contrainte de statut est retiree de organization_domains')
ok(/create unique index if not exists idx_organizations_stripe_subscription/.test(mig),
  'l’index unique Stripe est REPOSE sur organizations',
  'sans lui, deux organisations pourraient porter la meme Subscription')
// Les valeurs de statut doivent rester celles de l'API Stripe, a l'identique.
for (const st of ['incomplete_expired', 'trialing', 'past_due', 'unpaid', 'paused']) {
  ok(mig.includes(`'${st}'`), `contrainte de statut : ${st} conserve`)
}

// ═══ B. LA MIGRATION EST RELISIBLE PAR LE CHANTIER STRIPE ══════════════════
section('B. Relisible par le worktree Stripe')

ok(/A LIRE PAR LE CHANTIER STRIPE|À LIRE PAR LE CHANTIER STRIPE/.test(mig),
  'la migration s’adresse explicitement au chantier Stripe')
ok(/REMPLAC/.test(mig) && /stripe_fondations/.test(mig),
  'elle NOMME la decision d’archi qu’elle remplace, et le fichier d’origine',
  'sans cela, l’autre worktree decouvrirait le changement par un conflit, pas par une lecture')
ok(/CE QUE LE WEBHOOK DOIT VISER/.test(mig),
  'elle donne la nouvelle cible du webhook, colonne par colonne')
ok(/Le Customer est port/.test(mig),
  'elle rappelle que le Customer etait DEJA sur organizations',
  'c’est ce qui montre que la migration finit le raisonnement du lot 0 Stripe au lieu de le contredire')

// ═══ C. LA REPRISE NE PERD RIEN ════════════════════════════════════════════
section('C. Reprise des donnees')

ok(/distinct on \(od\.organization_id\)/.test(mig) && /order by od\.organization_id, od\.activated_at desc/.test(mig),
  'la ligne la PLUS RECEMMENT ACTIVEE est retenue')
ok(/count\(distinct od\.package_id\) > 1/.test(mig) && /raise notice/.test(mig),
  'toute organisation aux offres divergentes est NOMMEE dans un RAISE NOTICE',
  'le cas est impossible aujourd’hui — une migration ne doit pas supposer')
ok(/and o\.package_id is null/.test(mig),
  'la reprise est rejouable : elle n’ecrase jamais un abonnement deja remonte')

// ═══ D. LE MOTEUR DE DROITS LIT LA NOUVELLE SOURCE ═════════════════════════
section('D. getOrgEntitlements')

ok(/\.from\('organizations'\)[\s\S]{0,160}?package_valid_until/.test(ents),
  'l’abonnement est lu sur organizations')
// R1 — la table de trace ne doit plus alimenter la moindre decision.
ok(!/organization_domains/.test(ents.replace(/\/\*[\s\S]*?\*\//g, '')),
  'lib/entitlements.ts ne lit PLUS organization_domains',
  'la table est conservee en trace historique — elle n’alimente plus aucune decision')
// R2 — le parametre a ete retire, pas ignore.
ok(/export async function getOrgEntitlements\(\s*\n\s*admin: SupabaseClient,\s*\n\s*organizationId: string,\s*\n\s*\): Promise<OrgEntitlements>/.test(ents),
  'getOrgEntitlements ne prend PLUS de domaine en parametre',
  'un argument passe et inutilise reinstalle l’ambiguite qu’on vient de supprimer')
ok(/L'ABONNEMENT EST UNIQUE ET PARTAG/.test(ents),
  'la doctrine est ecrite au-dessus de la fonction')

// ═══ E. PLUS AUCUN LECTEUR D'ABONNEMENT PAR ECOSYSTEME ═════════════════════
section('E. Aucun lecteur residuel')

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e === 'route.ts') out.push(p)
  }
  return out
}
const API_DIR = join(ROOT, 'app', 'api')
const routes = walk(API_DIR).map((p) => relative(API_DIR, p).split('\\').join('/')).sort()

/**
 * Commentaires retires — de bloc ET de ligne. Le `//` d'un commentaire qui
 * PARLE d'une colonne (« aucun package_id ici ») ne doit pas se lire comme du
 * code qui la nomme. Le `[^:]` epargne les `https://` des chaines.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/**
 * LE BLOC D'UNE REQUETE, PAS LE FICHIER QUI LA CONTIENT.
 *
 * Premiere version de ce controle : « le fichier nomme organization_domains ET
 * quelque part package_id ». Il denoncait trois routes parfaitement correctes,
 * qui lisent la TRACE (le nom de l'ecosysteme d'inscription) et vont chercher
 * l'abonnement sur organizations, dans une AUTRE requete du meme fichier.
 * Un controle a la maille du fichier ne peut pas distinguer les deux.
 *
 * On isole donc la chaine d'appels qui suit `.from('organization_domains')`,
 * en equilibrant parentheses et accolades — un `.insert({ ... })` s'etend sur
 * plusieurs lignes dont aucune ne commence par un point.
 */
function queryBlock(src, from) {
  let i = from
  let depth = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') {
      depth--
      if (depth === 0) {
        // Fin d'un appel : la chaine continue si le prochain caractere utile
        // est un point (`.select(`, `.eq(`…), sinon le bloc est termine.
        const rest = src.slice(i + 1)
        const next = rest.match(/^\s*/)[0].length
        if (rest[next] === '.') { i += 1 + next; continue }
        return src.slice(from, i + 1)
      }
    }
    i++
  }
  return src.slice(from)
}

/** Colonnes d'abonnement : elles n'existent PLUS sur organization_domains. */
const SUBSCRIPTION_COLUMNS =
  /package_id|package_started_at|package_valid_until|stripe_subscription/

// Qui nomme encore une colonne d'abonnement DANS une requete sur la trace ?
const readers = []
const traceUsers = []
for (const r of routes) {
  const src = stripComments(read(join('app', 'api', r)))
  const NEEDLE = "from('organization_domains')"
  let at = src.indexOf(NEEDLE)
  if (at === -1) continue
  traceUsers.push(r)
  while (at !== -1) {
    if (SUBSCRIPTION_COLUMNS.test(queryBlock(src, at))) { readers.push(r); break }
    at = src.indexOf(NEEDLE, at + 1)
  }
}
ok(readers.length === 0,
  'aucune requete sur organization_domains ne nomme une colonne d’abonnement',
  readers.length ? `lecteurs residuels : ${readers.join(' · ')}` : undefined)

/**
 * INVENTAIRE DES USAGES RESTANTS DE LA TRACE.
 *
 * Le controle ci-dessus dit « personne n'y lit l'abonnement ». Il ne dit rien
 * d'une route qui s'y BRANCHERAIT demain pour une autre decision. On exige donc
 * que tout usage de la table soit DECLARE ici, avec sa raison — c'est la seule
 * facon de rendre visible un couplage qui, sinon, ne leverait rien.
 */
const TRACE_USERS = {
  'admin/collaboration-orgs/route.ts': 'affiche le nom de l’ecosysteme d’inscription',
  'admin/get-org/[id]/route.ts': 'affiche le nom de l’ecosysteme d’inscription',
  'admin/list-orgs/route.ts': 'affiche le nom de l’ecosysteme d’inscription',
  'auth/register-org/route.ts': 'ECRIT la ligne de trace a l’inscription',
  // Seul usage DECISIONNEL restant, et il est assume : le slug sert a poser
  // l'invite sur un sous-domaine d'atterrissage. Il ne restreint rien — une
  // fois entre, son organisation lui ouvre tous les ecosystemes actifs.
  'invitations/resolve/route.ts': 'choisit le sous-domaine d’atterrissage de l’invite',
}
const undeclared = traceUsers.filter((r) => !(r in TRACE_USERS))
const gone = Object.keys(TRACE_USERS).filter((r) => !traceUsers.includes(r))
ok(undeclared.length === 0,
  'tout usage de organization_domains est declare dans l’inventaire',
  undeclared.length ? `non declare(s) : ${undeclared.join(' · ')}` : undefined)
ok(gone.length === 0,
  'l’inventaire ne declare aucun usage disparu',
  gone.length ? `a retirer de l’inventaire : ${gone.join(' · ')}` : undefined)

// La trace reste une TRACE : personne n'y ecrit hors de l'inscription.
const writers = traceUsers.filter((r) => {
  if (r === 'auth/register-org/route.ts') return false
  const src = stripComments(read(join('app', 'api', r)))
  let at = src.indexOf("from('organization_domains')")
  while (at !== -1) {
    if (/\.(insert|update|upsert|delete)\(/.test(queryBlock(src, at))) return true
    at = src.indexOf("from('organization_domains')", at + 1)
  }
  return false
})
ok(writers.length === 0,
  'aucune route n’ECRIT sur la trace hors de l’inscription',
  writers.length ? `ecrivains : ${writers.join(' · ')}` : undefined)

// R3 — l'administrateur est PLATEFORME.
const listOrgs = read('app/api/admin/list-orgs/route.ts')
ok(/\.from\('organizations'\)[\s\S]{0,120}?package_valid_until/.test(listOrgs),
  'list-orgs enrichit depuis organizations')
ok(!/from\('organization_domains'\)[\s\S]{0,200}?\.eq\('domain_id', auth\.domain\.id\)/.test(listOrgs),
  'list-orgs ne filtre plus l’abonnement sur l’ecosysteme de l’admin',
  'un administrateur est PLATEFORME : ce filtre lui masquait l’offre des organisations vues d’ailleurs')

// ═══ F. CE QU'ON NE DEVAIT PAS TOUCHER ═════════════════════════════════════
section('F. Quota partage : intact')

ok(!/usage_counters|usage_increment|usage_peek/.test(migSql),
  'la migration ne touche PAS aux compteurs de quota',
  'le quota PARTAGE entre ecosystemes est VOULU — la cle primaire reste sans domain_id')
const counters = read('supabase/migrations/20260709000002_usage_counters.sql')
ok(/primary key \(organization_id, counter_key, period_start\)/.test(counters),
  'la cle primaire de usage_counters est inchangee')

// ═══ G. LA TRACE DIT CE QU'ELLE N'EST PAS ══════════════════════════════════
section('G. organization_domains, en trace')

ok(/comment on table public\.organization_domains/.test(mig),
  'la table porte un commentaire')
for (const [re, label] of [
  [/N''ALIMENTE PLUS AUCUNE DECISION/, 'elle dit qu’elle n’alimente plus aucune decision'],
  [/NE PAS s''en servir pour decider/, 'elle liste ce qu’il NE FAUT PAS en deduire'],
  [/ne signifie \\?n?RIEN|ne signifie /, 'elle dit qu’une ligne absente ne signifie rien'],
]) {
  ok(re.test(mig), `commentaire : ${label}`)
}

// ═══ H. PREUVE SUR LES DONNEES — LECTURE SEULE ═════════════════════════════
if (process.argv.includes('--db')) {
  section('H. Reprise verifiee sur les donnees (LECTURE SEULE)')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absentes')
    failures++
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: orgs, error: oErr } = await db
      .from('organizations')
      .select('id, company_name, package_id, package_valid_until')
    if (oErr) {
      console.log(`  KO   lecture des organisations : ${oErr.message}`)
      console.log('       La migration ..._abonnement_sur_organisation a-t-elle ete poussee ?')
      failures++
    } else {
      const withPkg = (orgs ?? []).filter((o) => o.package_id)
      console.log(`\n       Organisations : ${(orgs ?? []).length}`)
      console.log(`       Dont avec un abonnement : ${withPkg.length}`)
      for (const o of withPkg) {
        console.log(`         · ${o.company_name} — package ${o.package_id}` +
          (o.package_valid_until ? ` (jusqu'au ${String(o.package_valid_until).slice(0, 10)})` : ''))
      }
      if (withPkg.length === 0) {
        console.log('       Aucune : toutes sont sur l’offre par defaut du catalogue.')
      }
      ok(true, 'lecture des abonnements aboutie')
    }
  }
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTROLE(S) EN ECHEC\n`)
process.exit(failures === 0 ? 0 : 1)
