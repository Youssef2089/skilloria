// scripts/diag-admin-ecosystemes.mjs — L'ECRAN ADMIN DES ECOSYSTEMES
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Ouvrir un marche ne doit pas supposer un deploiement. Cet ecran cree un
//   ecosysteme, l'habille, le traduit et l'ouvre — mais DEUX etapes lui
//   echappent (le sous-domaine chez l'hebergeur, la premiere branche), et
//   c'est precisement la que se joue la qualite de l'ecran.
//
//   Sept regressions le vident de son sens :
//
//   R1 — l'ecosysteme nait ACTIF. Les organisations se verraient proposer une
//        destination sans sous-domaine declare et sans taxonomie : un
//        ecosysteme vide, atteint par un lien qui ne resout pas.
//
//   R2 — le bloc « ce qu'il reste a faire » disparait, ou perd une etape. Un
//        ecran qui masque le travail restant fait croire que c'est fini, et
//        le trou se decouvre le jour du lancement.
//
//   R3 — l'etat « non pret » disparait. Sans branche, personne ne peut creer
//        de profil ni publier : l'ecosysteme existe et ne sert a rien, sans
//        que rien ne le dise.
//
//   R4 — le slug devient modifiable, ou cesse d'etre valide par la MEME
//        fonction que le selecteur. C'est une adresse publique : la renommer
//        depuis un formulaire rend l'ecosysteme injoignable, et l'accepter
//        malformee le rend injoignable des la creation.
//
//   R5 — la table `translations` s'ouvre a l'ecriture libre. Sans le filtre
//        des champs declares traduisibles, le corps de la requete choisit
//        lui-meme quelle colonne de quelle table il peuple.
//
//   R6 — la desactivation redevient un « etes-vous sur ? ». Un compte a zero
//        et un compte a quatre cents ne se decident pas de la meme facon.
//        Pire : un compteur en panne qui afficherait 0 dirait « rien a
//        perdre » au moment precis ou l'on decide de couper.
//
//   R7 — la desactivation met les EXPERTS a la porte. Ils sont inscrits a
//        vie ; leurs missions en cours deviendraient inatteignables.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-admin-ecosystemes.mjs
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

// Commentaires retires — un controle qui accepte un commentaire accepte une
// garde supprimee et remplacee par sa description.
const strip = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const LIST = strip(read('app/api/admin/ecosystemes/route.ts'))
const DETAIL = strip(read('app/api/admin/ecosystemes/[id]/route.ts'))
const IMPACT = strip(read('app/api/admin/ecosystemes/[id]/impact/route.ts'))
const PAGE = strip(read('app/[locale]/admin/ecosystemes/page.tsx'))
const NAV = strip(read('lib/nav-config.ts'))
const GUARD = strip(read('lib/ecosystem-guard.ts'))

const LOCALES = ['fr', 'en', 'es', 'de']
const msgs = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), 'utf8'))]),
)
const at = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o)
const inAll = (p) => LOCALES.filter((l) => typeof at(msgs[l], p) !== 'string')

// ═══ A. CREER NE SUFFIT PAS ════════════════════════════════════════════════
section('A. L’ecosysteme nait inactif, et l’ecran le dit')

// R1
ok(/\.insert\(\{[\s\S]{0,320}?active: false,/.test(LIST),
  'la creation pose active: false',
  'un ecosysteme sans sous-domaine ni branche ne doit pas etre propose aux organisations')
ok(/born_inactive/.test(PAGE), 'le formulaire annonce que l’ecosysteme naitra inactif')

// La ligne de configuration nait avec lui : sans elle, aucune couleur ni
// vocabulaire, et getDomainConfig sert un ecosysteme nu.
ok(/\.from\('domain_configs'\)\s*\.insert\(\{/.test(LIST),
  'la ligne domain_configs est creee dans la foulee')
ok(/config_failed: true/.test(LIST),
  'un echec de la config est DIT, pas avale',
  'renvoyer un succes franc laisserait un ecosysteme sans couleurs, sans que personne le sache')

// ═══ B. CE QU'IL RESTE A FAIRE ═════════════════════════════════════════════
section('B. Le travail restant est affiche')

// R2 — les quatre etapes, dans les quatre langues.
for (const step of ['step_host', 'step_dns', 'step_branch', 'step_activate']) {
  const m = inAll(`admin_ecosystemes.after_create.${step}`)
  ok(m.length === 0, `after_create.${step} existe dans les 4 langues`,
    m.length ? `manquant en : ${m.join(', ')}` : undefined)
  ok(new RegExp(`after_create\\.${step}`).test(PAGE), `l’ecran affiche ${step}`)
}
// Les deux etapes hors application sont NOMMEES, pas suggerees.
ok(/Vercel/.test(at(msgs.fr, 'admin_ecosystemes.after_create.step_host') ?? ''),
  'l’etape hebergeur nomme l’endroit exact ou aller')
ok(/cname\.vercel-dns\.com/.test(at(msgs.fr, 'admin_ecosystemes.after_create.step_dns') ?? ''),
  'l’etape DNS donne l’enregistrement exact')

// ═══ C. « NON PRET » ═══════════════════════════════════════════════════════
section('C. Sans branche, l’ecosysteme ne sert a rien')

// R3
ok(/ready: nbBranches > 0/.test(LIST),
  'la liste calcule « pret » sur la presence d’au moins une branche')
ok(/ready: \(branches \?\? 0\) > 0/.test(DETAIL),
  'le detail calcule « pret » de la meme facon')
// ⚠️ `state.not_ready` est un PREFIXE de `state.not_ready_hint` et de
//    `state.not_ready_detail`. Le chercher tel quel restait vrai apres
//    suppression du badge : le controle constatait ses propres voisins.
ok(/t\('state\.not_ready'\)/.test(PAGE),
  'l’ecran porte le badge « non pret »')
ok(/t\('state\.not_ready_detail'\)/.test(PAGE),
  'et son explication, dans le panneau de detail')
for (const k of ['state.not_ready', 'state.not_ready_hint', 'state.not_ready_detail']) {
  const m = inAll(`admin_ecosystemes.${k}`)
  ok(m.length === 0, `${k} existe dans les 4 langues`, m.length ? `manquant en : ${m.join(', ')}` : undefined)
}

// ═══ D. LE SLUG EST UNE ADRESSE PUBLIQUE ═══════════════════════════════════
section('D. Le slug : valide a la creation, fige ensuite')

// R4 — meme fonction que le selecteur et l'ecran de refus.
ok(/import \{ isValidEcosystemSlug \} from '@\/lib\/ecosystem-url'/.test(LIST),
  'la creation valide le slug avec la MEME fonction que le selecteur',
  'une seconde regle accepterait un slug que la construction d’URL refuse ensuite')
ok(/if \(!isValidEcosystemSlug\(slug\)\) \{[\s\S]{0,160}?invalid_slug/.test(LIST),
  'un slug invalide est refuse a la creation')
ok(/isValidEcosystemSlug/.test(PAGE),
  'l’ecran valide le slug a la saisie, pas seulement au serveur')

// Le PATCH ne doit PAS pouvoir renommer le sous-domaine.
const patchBody = DETAIL.slice(DETAIL.indexOf('export async function PATCH'))
ok(!/for \(const k of \[[^\]]*'slug'/.test(patchBody),
  'le PATCH ne met JAMAIS a jour le slug',
  'c’est une adresse publique : declaree chez l’hebergeur, dans le DNS, et dans des liens deja envoyes')
ok(/readOnly/.test(PAGE), 'le champ slug est en lecture seule dans l’ecran')

// ═══ E. TRADUCTIONS ════════════════════════════════════════════════════════
section('E. Le FR est la colonne, les trois autres sont des lignes')

// R5 — pas d'ecriture libre dans `translations`.
ok(/const allowed =[\s\S]{0,320}?TRANSLATABLE\.domain_configs[\s\S]{0,80}?\.includes\(field\)/.test(patchBody),
  'seuls les champs DECLARES traduisibles sont ecrits',
  'sans ce filtre, le corps de la requete choisit quelle colonne de quelle table peupler')
ok(/if \(!allowed\) continue/.test(patchBody),
  'un champ non declare est ignore, pas ecrit')
// Vide = SUPPRESSION, pas ecrasement par du vide.
ok(/toDelete\.push\(\{ table_name: table, row_id: rowId, field, locale: loc \}\)/.test(patchBody),
  'une chaine vide SUPPRIME la traduction',
  'l’ecraser par du vide afficherait un libelle blanc au lieu de retomber sur le francais')
ok(/onConflict: 'table_name,row_id,field,locale'/.test(patchBody),
  'l’upsert vise la cle naturelle de la table translations')
ok(/fallback_fr/.test(PAGE),
  'l’ecran dit qu’un champ vide retombe sur le francais')

// TOUT CHAMP DECLARE TRADUISIBLE DOIT ETRE SAISISSABLE.
// `domains.ecosystem_name` etait declare et lu par getDomainConfig, mais aucun
// ecran ne permettait de le renseigner : une traduction impossible a saisir est
// une traduction qui n'existera jamais. Les champs de `domain_configs` sont
// rendus dynamiquement depuis `translatable` ; ceux de `domains` sont
// explicites — d'ou ce controle, qui verifie les deux de la meme facon.
const declares = [
  ...(DETAIL.match(/domains: \[([^\]]+)\]/)?.[1] ?? '')
    .split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)
    .map((f) => `domains.${f}`),
]
const nonSaisissables = declares.filter((k) => !PAGE.includes(`"${k}"`) && !PAGE.includes(`'${k}'`))
ok(nonSaisissables.length === 0,
  'tout champ traduisible de domains est saisissable depuis l’ecran',
  nonSaisissables.length ? `declare mais absent de l’ecran : ${nonSaisissables.join(', ')}` : undefined)
ok(/detail\.translatable\.domain_configs\.map/.test(PAGE),
  'ceux de domain_configs sont rendus DEPUIS la liste declaree',
  'les recopier dans l’ecran ferait diverger les deux listes')

// ═══ F. DESACTIVATION ══════════════════════════════════════════════════════
section('F. Des volumes reels, et l’expert garde son acces')

// R6 — un compteur en panne ne dit pas « zero ».
// ⚠️ IL Y A TROIS COMPTEURS (count, countUsers, countPublished). La premiere
//    version de ce controle cherchait UNE occurrence du motif : muter le
//    premier bloc laissait les deux autres le satisfaire. On exige donc que
//    CHAQUE branche d'erreur renvoie null, et on les compte.
const branchesErreur = [...IMPACT.matchAll(/if \(error\) \{([\s\S]{0,260}?)\n  \}/g)]
ok(branchesErreur.length === 3,
  `les trois compteurs ont leur branche d’erreur (${branchesErreur.length} trouvee(s))`)
const zeroTrompeur = branchesErreur.filter((m) => !/return null/.test(m[1]))
ok(branchesErreur.length === 3 && zeroTrompeur.length === 0,
  'un comptage en panne renvoie null, JAMAIS zero',
  'afficher 0 dirait « rien a perdre » au moment ou l’on decide de couper')
ok(/v === null \? '—'/.test(PAGE),
  'l’ecran affiche « — » pour un compteur indisponible')

// L'apercu LIT, il n'ecrit pas.
ok(!/\.(insert|update|upsert|delete)\(/.test(IMPACT),
  'la route d’impact n’ecrit rien',
  'un « apercu » qui desactiverait serait un piege')
ok(!/export async function (POST|PATCH|DELETE|PUT)/.test(IMPACT),
  'la route d’impact n’expose QUE GET')

// Les volumes affiches sont ceux qui servent a decider.
for (const k of ['keeps', 'loses', 'published', 'publications', 'candidatures', 'conversations', 'reversible']) {
  const m = inAll(`admin_ecosystemes.deactivate.${k}`)
  ok(m.length === 0, `deactivate.${k} existe dans les 4 langues`,
    m.length ? `manquant en : ${m.join(', ')}` : undefined)
}
ok(/keeps_access: \{ experts \}/.test(IMPACT) && /loses_access: \{ organisation_accounts/.test(IMPACT),
  'l’impact distingue qui GARDE son acces de qui le perd')

// R7 — LA REGLE ELLE-MEME. L'ecran promet que l'expert garde son acces : la
// garde doit le tenir, sans quoi l'ecran ment a l'administrateur.
ok(/if \(scope === 'all_active' && !target\.active\) return deny\('domain_inactive'\)/.test(GUARD),
  'la garde ne refuse l’ecosysteme desactive qu’aux ORGANISATIONS',
  'l’ecran annonce que les experts gardent leur acces — la garde doit le tenir')

// Les pluriels sont de vrais pluriels ICU, dans les 4 langues.
for (const l of LOCALES) {
  const v = at(msgs[l], 'admin_ecosystemes.deactivate.keeps') ?? ''
  ok(/\{n, plural,/.test(v) && /=0 \{/.test(v),
    `deactivate.keeps est un pluriel ICU en ${l}, avec le cas zero`,
    '« 0 expert » se lit mal, et c’est justement le cas ou l’on desactive')
}

// ═══ G. LE MENU ════════════════════════════════════════════════════════════
section('G. Atteignable sans developpeur')

ok(/href: '\/admin\/ecosystemes'/.test(NAV), 'l’ecran est declare dans le menu admin')
ok(/labelKey: 'nav_ecosystemes'/.test(NAV), 'son libelle vient d’une cle i18n')
const mNav = inAll('admin_back_office.sidebar.nav_ecosystemes')
ok(mNav.length === 0, 'le libelle du menu existe dans les 4 langues',
  mNav.length ? `manquant en : ${mNav.join(', ')}` : undefined)
// Une icone distincte : deux entrees voisines ne doivent pas se confondre.
// ⚠️ La premiere version verifiait que l'icone `globe` EXISTE dans la carte du
//    layout. Elle y reste quoi qu'il arrive : rebrancher l'entree sur l'icone
//    d'une voisine ne la faisait pas rougir. Ce qui compte, c'est que l'entree
//    porte une icone QU'AUCUNE AUTRE n'utilise.
const LAYOUT = read('app/[locale]/admin/layout.tsx')
const iconKeys = [...NAV.matchAll(/iconKey: '([a-z-]+)'/g)].map((m) => m[1])
const ecoEntry = NAV.match(/href: '\/admin\/ecosystemes',\s*\n\s*labelKey: '[^']+',\s*\n\s*iconKey: '([a-z-]+)'/)
ok(!!ecoEntry, 'l’entree ecosystemes declare une icone')
const ecoIcon = ecoEntry?.[1] ?? ''
ok(!!ecoIcon && iconKeys.filter((k) => k === ecoIcon).length === 1,
  'l’entree a sa propre icone',
  `${ecoIcon || '(aucune)'} est partagee avec une autre entree — reprendre l’icone d’une voisine rend la sidebar illisible`)
ok(!!ecoIcon && new RegExp(`^\\s{2}${ecoIcon}: \\(`, 'm').test(LAYOUT),
  'cette icone est bien dessinee dans le layout',
  'une iconKey sans dessin affiche un trou dans la sidebar')

console.log(failures === 0 ? '\n✔ TOUT VERT' : `\n✘ ${failures} CONTROLE(S) EN ECHEC`)
process.exit(failures === 0 ? 0 : 1)
