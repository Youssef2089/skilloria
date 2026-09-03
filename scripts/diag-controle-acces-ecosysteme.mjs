// scripts/diag-controle-acces-ecosysteme.mjs — QUI A LE DROIT D'ETRE ICI
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Le lot 1 a pose le CLOISONNEMENT DES DONNEES : une fois entre sur un
//   ecosysteme, on ne voit que le sien. Il ne dit rien de QUI ENTRE. Cloisonner
//   les donnees d'un ecosysteme ou n'importe qui peut se poser ne cloisonne
//   rien : ce lot pose la garde d'entree, et ce script la surveille.
//
//   Cinq regressions la vident de son sens, et ce script existe pour chacune :
//
//   R1 — un `default:` permissif apparait dans `ecosystemAccessScope`. Un
//        user_type inconnu, futur ou mal orthographie heriterait alors du
//        regime le plus large. La regle doit REFUSER par defaut.
//
//   R2 — la garde redevient une comparaison de CHAINES (« le slug recu vaut-il
//        celui de mon compte ? »). Elle ne distingue plus un ecosysteme
//        inexistant d'un ecosysteme desactive : le slug doit etre RESOLU EN
//        BASE, et son inexistence refusee explicitement.
//
//   R3 — un ecosysteme DESACTIVE laisse encore entrer. La desactivation
//        cesserait d'avoir le moindre effet, sans que rien ne le signale.
//
//   R4 — une erreur de lecture sur `domains` finit en autorisation. Une base
//        muette ne vaut PAS un droit d'entree.
//
//   R5 — `auth.domain` redevient l'ecosysteme DU COMPTE au lieu de celui du
//        SOUS-DOMAINE. C'est la regression la plus grave et la plus muette :
//        `activeEcosystemId(auth)` renvoie `auth.domain.id`, donc TOUT le
//        cloisonnement du lot 1 filtrerait sur le mauvais ecosysteme. Une
//        organisation naviguant ailleurs verrait les donnees de son ecosysteme
//        d'inscription, sans erreur, sans symptome.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-controle-acces-ecosysteme.mjs
//
//   La section A n'analyse RIEN : elle IMPORTE la vraie fonction et l'execute
//   sur les cinq populations. Ce n'est pas une relecture du texte de la regle,
//   c'est la regle elle-meme qui repond.
//
// LECTURE PURE : ce script n'ecrit JAMAIS et ne touche JAMAIS la base.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES : les sources du depot sont en CRLF, et un controle
// ancre sur `...\n` ne mordrait jamais. Un diagnostic qui depend de la
// plateforme sur laquelle il tourne ne garantit rien.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/**
 * COMMENTAIRES RETIRES — de bloc ET de ligne.
 *
 * Toute la section C cherche des fragments de code (`code: 'unknown_domain'`,
 * `!target.active`). Ces memes fragments s'ecrivent dans un commentaire, et un
 * commentaire n'a jamais refuse personne. Sans ce depouillement, la garde
 * pourrait etre entierement supprimee et remplacee par sa description : le
 * diagnostic resterait vert. Le `[^:]` epargne les `https://`.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const guard = stripComments(read('lib/auth-guard.ts'))
const scopeSrc = stripComments(read('lib/ecosystem-scope.ts'))

// ═══ A. LA REGLE, EXECUTEE ═════════════════════════════════════════════════
section('A. Les cinq populations')

const { ecosystemAccessScope } = await import('../lib/ecosystem-scope.ts')

// Le modele produit, fige. Chaque ligne est une decision produit, pas un detail
// d'implementation — c'est pourquoi elles sont ecrites ici en toutes lettres.
const TRUTH = [
  ['expert_freelance', 'own', 'un expert freelance : SON ecosysteme, a vie'],
  ['expert_cdi', 'own', 'un expert CDI : SON ecosysteme, a vie'],
  ['client', 'all_active', 'une organisation cliente : TOUS les ecosystemes actifs'],
  ['cabinet', 'all_active', 'un cabinet / une ESN : TOUS les ecosystemes actifs'],
  ['admin', 'platform', 'un administrateur : la PLATEFORME, ecosysteme desactive compris'],
]
for (const [type, expected, label] of TRUTH) {
  ok(ecosystemAccessScope(type) === expected, label,
    `attendu '${expected}', obtenu '${ecosystemAccessScope(type)}'`)
}

// R1 — le refus par defaut. `esn` est un org_type, PAS un user_type : c'est
// exactement le genre de valeur voisine qu'un `default:` permissif laisserait
// passer.
const REFUSED = ['esn', 'ADMIN', 'Expert_CDI', 'expert', 'client ', '', null, undefined, 'freelance']
const leaked = REFUSED.filter((t) => ecosystemAccessScope(t) !== null)
ok(leaked.length === 0,
  'tout user_type non prevu est REFUSE (aucun default permissif)',
  leaked.length ? `admis a tort : ${leaked.map((t) => JSON.stringify(t)).join(', ')}` : undefined)

// ═══ B. LA REGLE COUVRE EXACTEMENT LA BASE ═════════════════════════════════
section('B. Accord avec le CHECK de users.user_type')

// Un user_type ajoute en migration sans etre ajoute a la regle tomberait dans
// le refus par defaut : personne de ce type ne pourrait plus se connecter, et
// rien dans le code ne dirait pourquoi. Ce controle le dit.
const baseline = read('supabase/migrations/00000000000000_baseline.sql')
const checkLine = baseline
  .split('\n')
  .find((l) => l.includes('users_user_type_check'))
ok(!!checkLine, 'le CHECK users_user_type_check est trouve dans le schema')
const dbTypes = checkLine
  ? [...checkLine.matchAll(/'([a-z_]+)'::character varying/g)].map((m) => m[1])
  : []
const known = TRUTH.map(([t]) => t)
const missing = dbTypes.filter((t) => !known.includes(t))
const extra = known.filter((t) => !dbTypes.includes(t))
ok(dbTypes.length === 5, `le CHECK declare 5 user_type (${dbTypes.length} trouve(s))`)
ok(missing.length === 0,
  'aucun user_type de la base n’est absent de la regle',
  missing.length ? `absent(s) de ecosystemAccessScope : ${missing.join(', ')}` : undefined)
ok(extra.length === 0,
  'la regle ne prevoit aucun user_type que la base refuse',
  extra.length ? `code mort : ${extra.join(', ')}` : undefined)

// CE QUI REND LE REFUS PAR DEFAUT SUR : la colonne est NOT NULL et contrainte
// aux cinq valeurs ci-dessus. AUCUN compte existant ne peut donc tomber dans
// `unknown_user_type`. Rendre la colonne nullable transformerait une garde
// prudente en verrouillage silencieux de comptes parfaitement valides — d'ou
// ce controle, qui n'a l'air de rien.
ok(/"user_type" character varying\(30\) NOT NULL/.test(baseline),
  'users.user_type est NOT NULL — le refus par defaut ne verrouille aucun compte',
  'colonne nullable + refus par defaut = comptes valides bloques sans explication')

// ═══ C. LA GARDE DU SLUG ═══════════════════════════════════════════════════
section('C. La garde echoue FERME')

// Le corps de requireAuth : on ne veut pas qu'une occurrence dans un
// commentaire de tete ou dans requireOrgRole fasse passer un controle.
const guardBody = guard.slice(
  guard.indexOf('export async function requireAuth'),
  guard.indexOf('export function requireOrgRole'),
)

// R2 — le slug est RESOLU EN BASE, pas compare a une chaine.
ok(/\.from\('domains'\)[\s\S]{0,200}?\.eq\('slug', headerSubdomain\)/.test(guardBody),
  'le slug recu est resolu sur la table domains',
  'une comparaison de chaines ne peut pas distinguer inconnu / desactive / ailleurs')
ok(/code: 'unknown_domain'/.test(guardBody),
  'un ecosysteme INEXISTANT est refuse explicitement')

// R3 — l'ecosysteme desactive.
ok(/scope !== 'platform' && !target\.active/.test(guardBody),
  'un ecosysteme DESACTIVE est refuse a tous sauf a l’administrateur')
ok(/code: 'domain_inactive'/.test(guardBody),
  'ce refus porte un code distinct')

// R4 — une base muette n'autorise pas.
ok(/if \(domErr\)[\s\S]{0,320}?throw new AuthError\(403/.test(guardBody),
  'une erreur de lecture sur domains REFUSE',
  'une base muette ne vaut pas une autorisation')

// L'en-tete absent refuse, et aucun slug par defaut ne le remplace.
ok(/if \(!headerSubdomain\) \{\s*\n\s*throw new AuthError\(403/.test(guardBody),
  'un x-subdomain absent refuse')
// La LECTURE doit etre nue, terminee par la fin de ligne. Chercher un repli sur
// la VARIABLE (`headerSubdomain ??`) etait decoratif : le repli s'ecrit sur la
// lecture (`.get('x-subdomain') ?? 'default'`), et passait sous le controle.
ok(/const headerSubdomain = request\.headers\.get\('x-subdomain'\)\n/.test(guardBody),
  'aucun slug par defaut ne remplace un en-tete manquant',
  'un repli implicite rattacherait le compte a un ecosysteme fige')

// La regle vient de la source unique, elle n'est pas recopiee ici.
ok(/import \{ ecosystemAccessScope \} from '@\/lib\/ecosystem-scope'/.test(guard),
  'la garde importe la regle, elle ne la redecrit pas')
ok(/if \(scope === null\)[\s\S]{0,300}?code: 'unknown_user_type'/.test(guardBody),
  'un user_type inconnu refuse, au lieu d’heriter d’un regime')
ok(/scope === 'own' && target\.id !== userRow\.domain_id/.test(guardBody),
  'un expert hors de SON ecosysteme est refuse')

// ═══ D. L'ECOSYSTEME ACTIF, PAS CELUI DU COMPTE ════════════════════════════
section('D. auth.domain est le SOUS-DOMAINE')

// R5 — la regression muette. Le contexte doit etre construit sur `target`
// (l'ecosysteme resolu depuis l'en-tete), jamais sur la ligne jointe au user.
ok(/domain: \{ id: target\.id, slug: target\.slug, active: target\.active \}/.test(guardBody),
  'le contexte porte l’ecosysteme resolu depuis x-subdomain')
ok(!/domain: \{[\s\S]{0,160}?ownDomain/.test(guardBody),
  'le contexte NE porte PAS l’ecosysteme du compte',
  'activeEcosystemId(auth) renvoie auth.domain.id : tout le cloisonnement du lot 1 en depend')

// Le lot 1 et le lot 2 se rejoignent exactement ici.
const ecoScope = scopeSrc.slice(scopeSrc.indexOf('export function activeEcosystemId'))
ok(/return auth\.domain\.id/.test(ecoScope),
  'activeEcosystemId lit bien auth.domain.id',
  'si cette valeur change de sens, le lot 1 filtre sur le mauvais ecosysteme')

// L'ecosysteme du COMPTE reste disponible, et distinctement nomme.
ok(/user_type: \(userRow\.user_type \?\? null\)/.test(guardBody),
  'user_type remonte dans le contexte')
ok(/domain_id: userRow\.domain_id/.test(guardBody),
  'l’ecosysteme du COMPTE reste expose, sous un autre nom')

// ═══ E. AUCUN CONTOURNEMENT ════════════════════════════════════════════════
section('E. Une seule photo de la ligne user')

// La garde admin relisait `users.user_type` dans une SECONDE requete, apres que
// requireAuth avait deja statue sur l'ecosysteme avec la premiere. Deux photos
// de la meme ligne, que rien ne garantissait identiques.
const adminGuard = read('lib/admin-guard.ts')
const adminBody = adminGuard.slice(adminGuard.indexOf('export async function requireAdmin'))
ok(!/\.from\('users'\)/.test(adminBody),
  'requireAdmin ne relit plus users',
  'requireAuth connait deja user_type — il en depend pour decider de l’ecosysteme')
ok(/auth\.user\.user_type !== 'admin'/.test(adminBody),
  'requireAdmin statue sur le contexte deja charge')

console.log(
  failures === 0
    ? '\n✔ TOUT VERT'
    : `\n✘ ${failures} CONTROLE(S) EN ECHEC`,
)
process.exit(failures === 0 ? 0 : 1)
