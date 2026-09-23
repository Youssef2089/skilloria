// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  diag-plafond-par-acteur — UN PLAFOND PAR COMPTE, LE GLOBAL EN DERNIER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//  ┌─ LE DÉFAUT QU'ON FERME ─────────────────────────────────────────────────┐
//  │ Il existait UN plafond : le global, par fournisseur. Une organisation   │
//  │ pouvait donc consommer le budget de tout l'écosystème, et ce qui        │
//  │ s'arrêtait alors s'arrêtait POUR TOUT LE MONDE. Les seuils par acteur   │
//  │ existaient — mais ils ALERTENT, ils n'ont jamais arrêté une dépense.    │
//  └──────────────────────────────────────────────────────────────────────────┘
//
//  ═══ LA RÈGLE, EN UNE PHRASE ════════════════════════════════════════════
//    Un plafond de compte arrête ce que la PLATEFORME dépense d'elle-même
//    pour ce compte. Il n'arrête RIEN de ce que la personne vient de
//    demander : une organisation au plafond publie, un expert au plafond
//    postule. Le plafond GLOBAL, lui, arrête tout — c'est le dernier
//    garde-fou, et il parle d'un budget qui n'existe plus.
//
//  ═══ CE QUE CE CONTRÔLE VÉRIFIE ═════════════════════════════════════════
//    · il EXÉCUTE `lib/ai-plafonds.ts`, qui est pur (§E.33) : la règle est
//      mesurée sur la vraie fonction, jamais sur son texte ;
//    · il DÉCOUVRE les points de dépense (§E.61) et vérifie que chacun
//      interroge le plafond avec LE MÊME acteur qu'il impute (§E.39) ;
//    · il vérifie que l'exhaustivité tient par le TYPE, pas par la vigilance.
//
//  ⚠️ CE QU'IL NE VÉRIFIE PAS :
//     · que les VALEURS des plafonds soient les bonnes. 25 $ et 5 $ sont des
//       propositions, à réviser sur un mois de données réelles ; elles vivent
//       en base et se règlent dans `/admin/matching` (§D.7) ;
//     · que la dépense soit ENREGISTRÉE et le plafond global consulté :
//       c'est `diag-depense-ia`, et deux gardes sur la même panne n'en font
//       qu'une (§E.36).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-plafond-par-acteur.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE variable d'environnement.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CLASSE_DES_ACTIONS,
  arretParPlafondActeur,
  alerteCoherente,
} from '../lib/ai-plafonds.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/** Sans commentaires (§E.7). Le `[^:]` protège le `//` d'une URL. */
const sansCommentaires = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
/** … et sans chaînes : pour reconnaître un APPEL, jamais une mention. */
const sansChaines = (src) =>
  src
    .replace(/`[^`]*`/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`)
  }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

// ═════════════════════════════════════════════════════════════════════════════
//  LE PÉRIMÈTRE, ÉCRIT AVANT LE BALAYAGE
// ═════════════════════════════════════════════════════════════════════════════
//  BALAYÉS : `app/` et `lib/` — les seuls endroits d'où part un appel payant
//    en production. C'est le même périmètre que `diag-depense-ia`, et c'est
//    délibéré : les deux contrôles parlent des mêmes sept points.
//  EXCLUS, chacun avec sa raison :
//    · `components/` — aucun appel payant ne part d'un composant : la règle
//      du projet veut la garde au SERVEUR, et `diag-depense-ia` la vérifie ;
//    · `scripts/` — les bancs neutralisent le réseau ; c'est
//      `diag-compteur-ce-quon-paie` qui l'exige, on ne le repose pas ici ;
//    · `supabase/` — du SQL, lu séparément pour la contrainte et les fonctions.
const DOSSIERS = ['app', 'lib']

function fichiers(dossier, out = []) {
  for (const e of readdirSync(join(ROOT, dossier))) {
    const rel = `${dossier}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) fichiers(rel, out)
    else if (/\.(ts|tsx)$/.test(e)) out.push(rel)
  }
  return out
}

const TOUS = DOSSIERS.flatMap((d) => fichiers(d))
const SOURCE = new Map(TOUS.map((f) => [f, sansCommentaires(read(f))]))
const CODE = new Map([...SOURCE].map(([f, s]) => [f, sansChaines(s)]))

console.log('\nUN PLAFOND PAR COMPTE, LE GLOBAL EN DERNIER GARDE-FOU\n')
console.log(`périmètre : ${TOUS.length} fichiers dans ${DOSSIERS.join(', ')}`)

// ═════════════════════════════════════════════════════════════════════════════
section('A. LA RÈGLE, EXÉCUTÉE (§E.33)')

const AU_PLAFOND = {
  depense_mois_usd: 30,
  plafond_mensuel_usd: 25,
  seuil_alerte_usd: 10,
  au_plafond: true,
  en_alerte: true,
}
const SOUS_LE_PLAFOND = { ...AU_PLAFOND, depense_mois_usd: 12, au_plafond: false }

ok(
  arretParPlafondActeur('matching_pool', AU_PLAFOND).arrete === true,
  'au plafond, le CLASSEMENT s\'arrête',
  'c\'est la seule dépense que la plateforme déclenche d\'elle-même : si elle ne s\'arrête pas, le plafond ne plafonne rien',
)
ok(
  arretParPlafondActeur('candidature_assessment', AU_PLAFOND).arrete === false,
  'au plafond, l\'expert POSTULE toujours',
  '§D.19 : sans jugement, aucune candidature n\'est écrite — un compte qui ne peut plus postuler n\'est pas « utilisable »',
)
ok(
  arretParPlafondActeur('publication_quality', AU_PLAFOND).arrete === false,
  'au plafond, l\'organisation PUBLIE toujours',
  'elle a payé : son annonce sort, elle n\'est simplement plus classée',
)
ok(
  arretParPlafondActeur('cv_parsing', AU_PLAFOND).arrete === false &&
    arretParPlafondActeur('pitch', AU_PLAFOND).arrete === false &&
    arretParPlafondActeur('expert_verification', AU_PLAFOND).arrete === false &&
    arretParPlafondActeur('org_verification', AU_PLAFOND).arrete === false,
  'au plafond, aucune autre action délibérée ne s\'arrête',
)
ok(
  arretParPlafondActeur('matching_pool', SOUS_LE_PLAFOND).arrete === false,
  'sous le plafond, rien ne s\'arrête',
  'une garde qui arrête AUSSI en dessous du plafond n\'est pas un plafond, c\'est une panne',
)
ok(
  arretParPlafondActeur('matching_pool', null).arrete === false,
  'un acteur NON IMPUTABLE n\'a pas de plafond à lui',
  'il n\'y a personne à qui l\'imputer : seul le global le concerne, et c\'est déclaré',
)
{
  const v = arretParPlafondActeur('matching_pool', AU_PLAFOND)
  ok(
    v.arrete === true && v.depense_mois_usd === 30 && v.plafond_mensuel_usd === 25,
    'l\'arrêt PORTE les deux montants',
    'un refus qui ne dit pas « combien sur combien » ne permet pas de décider de relever le plafond',
  )
}

// ── L'ALERTE RESTE SOUS LE PLAFOND ─────────────────────────────────────────
ok(
  alerteCoherente(10, 25) === true &&
    alerteCoherente(25, 25) === true &&
    alerteCoherente(26, 25) === false,
  'l\'alerte doit rester SOUS le plafond, bornes comprises',
  'au-dessus, elle ne se déclencherait jamais : le plafond arrête la dépense avant',
)

// ═════════════════════════════════════════════════════════════════════════════
section('B. L\'EXHAUSTIVITÉ TIENT PAR LE TYPE, PAS PAR LA VIGILANCE')

//  Les actions sont déclarées dans `ai-budget.ts` ; la table des classes est
//  DÉRIVÉE de cette liste, pas recopiée. Si les deux divergent, le contrôle le
//  dit — et `tsc` aussi, ce qui est la vraie parade (§E.31).
const BUDGET = SOURCE.get('lib/ai-budget.ts')
const BLOC_ACTIONS = BUDGET.match(/export type ActionIA =[\s\S]*?\n\n/)
ok(BLOC_ACTIONS !== null, 'la liste des actions est identifiable')
const ACTIONS = BLOC_ACTIONS
  ? [...BLOC_ACTIONS[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  : []
ok(ACTIONS.length >= 7, `la liste des actions est lue (${ACTIONS.length} trouvées)`)

const SANS_CLASSE = ACTIONS.filter((a) => !(a in CLASSE_DES_ACTIONS))
ok(
  SANS_CLASSE.length === 0,
  'chaque action a une classe',
  SANS_CLASSE.length ? `sans classe : ${SANS_CLASSE.join(', ')}` : undefined,
)
const EN_TROP = Object.keys(CLASSE_DES_ACTIONS).filter((a) => !ACTIONS.includes(a))
ok(
  EN_TROP.length === 0,
  'aucune classe ne porte sur une action qui n\'existe plus',
  EN_TROP.length ? `orpheline(s) : ${EN_TROP.join(', ')}` : undefined,
)

const PLAFONDS = SOURCE.get('lib/ai-plafonds.ts')
ok(
  /satisfies Record<ActionIA, ClasseAction>/.test(PLAFONDS),
  'l\'exhaustivité est tenue par le TYPE',
  'sans `satisfies`, une action ajoutée sans classe COMPILE — et tombe du côté qui ne bloque jamais',
)
ok(
  Object.values(CLASSE_DES_ACTIONS).some((c) => c === 'automatique'),
  'au moins une action est AUTOMATIQUE',
  'si aucune ne l\'est, le plafond par acteur n\'arrête jamais rien et l\'écran ment',
)

// ═════════════════════════════════════════════════════════════════════════════
section('C. LA GARDE ET LA DÉPENSE PORTENT LE MÊME ACTEUR (§E.39)')

//  Une garde qui interroge le plafond de X pendant que la dépense est imputée
//  à Y protège le mauvais compte, et rien ne le signale : les deux appels
//  réussissent, et le chiffre reste plausible.
//  ⚠️ LE MODULE QUI DÉFINIT LA GARDE N'EN EST PAS UN APPELANT, et il porte
//     pourtant le motif — dans sa SIGNATURE. Le premier jet le dénonçait donc
//     pour un désaccord entre `ActeurIA; action: ActionIA }` et `ActeurIA` :
//     un faux positif né d'une annotation de type.
//     On l'écarte par une PROPRIÉTÉ — il déclare la fonction — et non par son
//     chemin : un module renommé resterait exclu, un second définisseur serait
//     vu (§E.34).
const DEFINIT_LA_GARDE = (s) => /export async function budgetDisponible\s*\(/.test(s)
const APPELANTS = TOUS.filter(
  (f) => /budgetDisponible\s*\(/.test(CODE.get(f)) && !DEFINIT_LA_GARDE(CODE.get(f)),
)
ok(APPELANTS.length >= 7, `les appelants de la garde sont découverts (${APPELANTS.length})`)

let desaccords = 0
for (const f of APPELANTS) {
  const s = SOURCE.get(f)
  // L'acteur de la GARDE, et l'acteur de l'ENREGISTREMENT, dans le même fichier.
  const garde = [...s.matchAll(/budgetDisponible\([\s\S]{0,400}?acteur:\s*([^\n,]+)/g)].map((m) =>
    m[1].trim(),
  )
  const depense = [...s.matchAll(/enregistrerDepenseIA\([\s\S]{0,600}?acteur:\s*([^\n,]+)/g)].map(
    (m) => m[1].trim(),
  )
  if (garde.length === 0) {
    failures++
    desaccords++
    console.log(`  KO   ${f} appelle la garde sans lui donner d'acteur`)
    continue
  }
  if (depense.length === 0) continue // la dépense est enregistrée ailleurs (module pur)
  const memeActeur = garde.every((g) => depense.some((d) => d === g))
  if (!memeActeur) {
    failures++
    desaccords++
    console.log(`  KO   ${f} : garde ${JSON.stringify(garde)} ≠ dépense ${JSON.stringify(depense)}`)
  }
}
ok(desaccords === 0, 'chaque appelant interroge le plafond DE L\'ACTEUR qu\'il impute')

//  ET L'ARGUMENT EST OBLIGATOIRE : c'est lui qui a fait nommer les sept par le
//  compilateur. Un paramètre optionnel les aurait tous laissés passer.
const SIGNATURE = BUDGET.match(/export async function budgetDisponible\([\s\S]*?\n\)/)
ok(SIGNATURE !== null, 'la signature de la garde est identifiable')
ok(
  SIGNATURE !== null && /pour:\s*\{/.test(SIGNATURE[0]),
  'l\'acteur et l\'action sont OBLIGATOIRES, sans défaut',
  'un paramètre optionnel aurait laissé les sept points de dépense inchangés — et hors plafond',
)

// ═════════════════════════════════════════════════════════════════════════════
section('D. L\'ORDRE : L\'ACTEUR D\'ABORD, LE GLOBAL EN DERNIER')

const CORPS_GARDE = BUDGET.match(
  /export async function budgetDisponible\([\s\S]*?\n\}\n/,
)
ok(CORPS_GARDE !== null, 'le corps de la garde est identifiable')
if (CORPS_GARDE) {
  const posActeur = CORPS_GARDE[0].indexOf('arretParPlafondActeur')
  const posGlobal = CORPS_GARDE[0].indexOf('ai_spend_status')
  ok(
    posActeur >= 0 && posGlobal >= 0 && posActeur < posGlobal,
    'le plafond de l\'ACTEUR est consulté AVANT le global',
    'inversé, un acteur qui dérape serait arrêté par un motif qui dit « la plateforme est à court » — et on chercherait ailleurs',
  )
  ok(
    /return \{ ok: false, raison: acteurEtat\.raison \}/.test(CORPS_GARDE[0]),
    'une lecture d\'acteur en panne REFUSE',
    'ne pas savoir ce qu\'un acteur a dépensé n\'autorise pas à dépenser pour lui (§E.22)',
  )
}

// ═════════════════════════════════════════════════════════════════════════════
section('E. LA BASE TIENT CE QUE LE CODE EXPLIQUE')

const MIGS = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) =>
  f.includes('plafond_par_acteur'),
)
ok(MIGS.length === 1, `une seule migration « plafond_par_acteur » (${MIGS.length})`)
//  Le SQL commente avec deux tirets : un dépouilleur TypeScript ne les voit pas,
//  et l'encadré de cette migration CITE les règles qu'elle pose (§E.7).
const MIG =
  MIGS.length === 1
    ? read(`supabase/migrations/${MIGS[0]}`)
        .split('\n')
        .map((l) => l.replace(/--.*$/, ''))
        .join('\n')
    : ''

ok(
  /add column if not exists plafond_mensuel_usd/.test(MIG),
  'la migration ajoute le plafond par acteur',
)
ok(
  /alter column plafond_mensuel_usd set not null/.test(MIG),
  'le plafond est OBLIGATOIRE',
  'nullable, un acteur sans plafond n\'aurait pas de plafond — sans que rien ne le dise',
)
ok(
  /add constraint ai_spend_alerte_sous_plafond[\s\S]{0,120}seuil_mensuel_usd <= plafond_mensuel_usd/.test(
    MIG,
  ),
  'la base garantit que l\'alerte reste SOUS le plafond',
  'une garde qui est une contrainte ne dépend d\'aucune discipline (§E.31)',
)
ok(
  !/not valid/i.test(MIG),
  'les contraintes sont posées VALIDÉES',
  '`NOT VALID` rend IMMUABLES les lignes qu\'il tolère (§E.64)',
)

// ── LA FENÊTRE MENSUELLE EST UN MÉCANISME, PLUS UNE DISCIPLINE ────────────
ok(
  /create or replace function public\.ai_spend_debut_du_mois/.test(MIG),
  'la fenêtre mensuelle devient une fonction',
  'trois fonctions la recopiaient sous un commentaire disant « AU CARACTÈRE PRÈS » — une discipline, pas une garantie',
)
//  ⚠️ LA MUTATION A TROUVÉ CE TROU. L'assertion COMPTAIT les occurrences de
//     l'appel dans toute la migration — définition, postcondition et lectures
//     confondues. En retirer une laissait le compte au-dessus du seuil, donc
//     le contrôle VERT, pendant qu'une lecture recopiait de nouveau
//     l'expression. On vérifie désormais CHAQUE corps de fonction (§E.8).
const CORPS_SQL = (nom) => {
  const m = MIG.match(new RegExp(`create (?:or replace )?function public\\.${nom}\\([\\s\\S]*?\\$fn\\$;`))
  return m ? m[0] : null
}
const LECTRICES = ['ai_spend_status', 'ai_spend_par_acteur', 'ai_spend_acteur_etat', 'ai_spend_acteurs_au_plafond']
const SANS_FENETRE = LECTRICES.filter((n) => {
  const corps = CORPS_SQL(n)
  return corps === null || !/ai_spend_debut_du_mois\(\)/.test(corps)
})
ok(
  SANS_FENETRE.length === 0,
  `les ${LECTRICES.length} lectures de dépense LISENT cette fenêtre`,
  SANS_FENETRE.length
    ? `recopie(nt) l'expression ou sont introuvable(s) : ${SANS_FENETRE.join(', ')} — une seule qui dérive décale les totaux en fin de mois, et la somme cesse de boucler`
    : undefined,
)
const RECOPIES = LECTRICES.filter((n) => {
  const corps = CORPS_SQL(n)
  return corps !== null && /date_trunc\('month'/.test(corps)
})
ok(
  RECOPIES.length === 0,
  'et aucune ne RECOPIE l\'expression à côté',
  RECOPIES.length ? `recopie(nt) : ${RECOPIES.join(', ')}` : undefined,
)
//  ⚠️ ET CELUI-CI AUSSI. Le NOM de la fonction survit dans la postcondition
//     qui l'éprouve : le renommer laissait l'assertion verte. Ce qu'on garde,
//     c'est qu'elle est CRÉÉE, et qu'un écran l'APPELLE — sans quoi le
//     décompte existe et ne remonte nulle part.
ok(
  CORPS_SQL('ai_spend_acteurs_au_plafond') !== null,
  'un DÉCOMPTE des acteurs au plafond est CRÉÉ',
  'compter depuis la liste des dix plus gros rendrait un nombre juste tant qu\'il y en a moins de dix (§E.24)',
)
ok(
  /ai_spend_acteurs_au_plafond/.test(SOURCE.get('app/api/admin/supervision/route.ts') ?? ''),
  'et la supervision l\'APPELLE',
  'un décompte que personne ne lit ne remonte nulle part',
)
ok(
  (MIG.match(/exception when check_violation/g) ?? []).length >= 2,
  'la postcondition ÉPROUVE la contrainte, dans les deux sens (§E.34)',
)
ok(
  (MIG.match(/raise exception 'postcondition NON TENUE/g) ?? []).length >= 8,
  'la postcondition LÈVE, elle ne se contente pas de signaler',
)

// ═════════════════════════════════════════════════════════════════════════════
section('F. LES ÉCRANS — le réglage, la supervision, la consommation')

const ROUTE = SOURCE.get('app/api/admin/plafonds-ia/route.ts')
//  ⚠️ TROISIÈME TROU DE LA MÊME FAMILLE. `plafonds_acteur` vit aussi dans le
//     TYPE du corps et dans la réponse : vider la lecture du corps laissait le
//     mot partout, et l'assertion verte, pendant que plus aucun réglage
//     n'arrivait. On ancre sur l'ÉCRITURE — la seule chose qui règle vraiment.
ok(
  /\.update\(\{ plafond_mensuel_usd:/.test(ROUTE),
  'le plafond par acteur est ÉCRIT en base (§D.7)',
  'un réglage qu\'on saisit et qui n\'atteint pas la base est un réglage mort qui a l\'air vivant (§D.11)',
)
ok(
  /corps\.plafonds_acteur/.test(ROUTE),
  'et il est LU dans le corps de la requête',
  'sans lecture, l\'écriture porte toujours la même valeur — celle d\'un objet vide',
)
ok(
  /alerteCoherente\s*\(/.test(sansChaines(ROUTE)),
  'la route lit la règle de cohérence PARTAGÉE',
  'la réécrire ici ferait deux règles, et celle qui diverge en dernier aurait l\'air d\'être la bonne (§E.20)',
)
ok(
  /avantPlafondsActeur\[acteur\]/.test(ROUTE),
  'la cohérence est jugée sur l\'ÉTAT FINAL, pas sur le corps reçu',
  'un corps qui ne change QUE l\'alerte est valide en lui-même et peut contredire le plafond déjà en base (§D.18)',
)
ok(
  /ai_spend_actor_cap_updated/.test(ROUTE),
  'le changement laisse une trace SOUS SA PROPRE ACTION',
  'un plafond global qui coupe tout et un plafond d\'acteur qui coupe un compte ne se relisent pas pareil',
)

const SUPERVISION = SOURCE.get('lib/supervision/problemes.ts')
ok(
  /organisations_au_plafond_ia/.test(SUPERVISION) && /experts_au_plafond_ia/.test(SUPERVISION),
  'un compte au plafond REMONTE en supervision',
  'sinon l\'annonce sort, reste sans candidats, et personne ne sait qu\'il manque quelque chose',
)
ok(
  /lecture_indisponible_acteurs_plafond/.test(SUPERVISION),
  'une lecture en panne se DIT, elle ne se lit pas comme « aucun » (§E.22)',
)
{
  //  ⚠️ ON ANCRE SUR LE BLOC, PAS SUR LE FICHIER (§E.8) : la gravité doit être
  //     celle de CE signal. Un `attention` présent ailleurs suffirait sinon.
  const bloc = SUPERVISION.match(/organisations_au_plafond_ia[\s\S]{0,200}?\}/)
  ok(
    bloc !== null && /gravite: 'attention'/.test(bloc[0]),
    'le signal est une ATTENTION, pas un bloquant',
    'un acteur au plafond est le fonctionnement NORMAL d\'une règle posée : en bloquant, il sonnerait chaque mois et on apprendrait à l\'ignorer (§E.52)',
  )
  ok(
    bloc !== null && /lien: '\/admin\/consommation'/.test(bloc[0]),
    'le signal porte l\'endroit où AGIR',
    'un signal qu\'aucune action ne peut éteindre apprend à être ignoré (§E.52)',
  )
}

const ECRAN = SOURCE.get('app/[locale]/admin/consommation/page.tsx')
ok(ECRAN !== undefined, 'l\'écran de consommation par compte existe')
if (ECRAN) {
  ok(
    /l\.au_plafond === true/.test(ECRAN) && /l\.en_alerte === true/.test(ECRAN),
    'l\'écran LIT les deux états rendus par la base',
  )
  ok(
    !/depense_mois\s*>=\s*plafond/.test(ECRAN),
    'l\'écran ne RECALCULE pas l\'état',
    'une seconde règle, sur une seconde fenêtre mensuelle : c\'est ainsi que deux écrans cessent de dire la même chose (§E.15, §E.20)',
  )
  ok(
    /reste_non_detaille/.test(ECRAN) && /non_imputable/.test(ECRAN),
    'ce qui n\'est pas détaillé est DIT, pas caché',
    'cacher le non-imputable donnerait un total plus propre et faux',
  )
}

//  AUCUN ÉCRAN MORT : il est dans le menu, et son icône existe.
const NAV = SOURCE.get('lib/nav-config.ts')
ok(/\/admin\/consommation/.test(NAV), 'l\'écran est atteignable depuis le menu')
const LAYOUT = SOURCE.get('app/[locale]/admin/layout.tsx')
const ICONE = NAV.match(/href: '\/admin\/consommation'[\s\S]{0,120}?iconKey: '([a-z]+)'/)
ok(ICONE !== null, 'l\'entrée de menu déclare une icône')
ok(
  ICONE !== null && new RegExp(`\\n  ${ICONE[1]}: \\(`).test(LAYOUT),
  'et cette icône EXISTE dans le registre',
  'le registre n\'a AUCUN repli : une clé absente rend une entrée sans icône, sans la moindre erreur',
)

// ── LA PARITÉ DES QUATRE LANGUES ───────────────────────────────────────────
const CLES = [
  ['admin_back_office', 'consommation', 'title'],
  ['admin_back_office', 'consommation', 'state_capped'],
  ['admin_back_office', 'consommation', 'unattributed'],
  ['admin_back_office', 'sidebar', 'nav_consommation'],
  ['admin_back_office', 'supervision', 'problem', 'organisations_au_plafond_ia'],
  ['admin_back_office', 'supervision', 'problem', 'experts_au_plafond_ia'],
  ['admin_back_office', 'supervision', 'problem', 'lecture_indisponible_acteurs_plafond'],
  ['admin_matching', 'actor_caps_title'],
  ['admin_matching', 'actor_cap', 'organization'],
  ['admin_matching', 'alerts_under_cap'],
  ['admin_matching', 'err_alerte_au_dessus'],
]
let manquantes = 0
for (const langue of ['fr', 'en', 'es', 'de']) {
  const j = JSON.parse(read(`messages/${langue}.json`))
  for (const chemin of CLES) {
    let v = j
    for (const seg of chemin) v = v?.[seg]
    if (typeof v !== 'string' || v.trim() === '') {
      manquantes++
      console.log(`  KO   ${langue}.json : ${chemin.join('.')} manque`)
    }
  }
}
if (manquantes > 0) failures++
ok(manquantes === 0, `les ${CLES.length} clés existent dans les quatre langues`)

// ═════════════════════════════════════════════════════════════════════════════
section('G. LES TÉMOINS — les détecteurs peuvent-ils rougir ? (§E.33)')

ok(
  arretParPlafondActeur('matching_pool', { ...AU_PLAFOND, au_plafond: false }).arrete === false,
  'témoin : la règle lit bien `au_plafond`, et pas seulement les montants',
)
ok(
  /budgetDisponible\s*\(/.test(sansChaines('await budgetDisponible(a, b, c)')) &&
    !/budgetDisponible\s*\(/.test(sansChaines("const s = 'budgetDisponible('")),
  'témoin : la découverte des appelants ignore une mention en chaîne',
)
{
  const faux = "budgetDisponible(a, 'claude', { acteur: X, action: 'y' })\nenregistrerDepenseIA(a, { acteur: Y, action: 'y' })"
  const g = [...faux.matchAll(/budgetDisponible\([\s\S]{0,400}?acteur:\s*([^\n,]+)/g)].map((m) => m[1].trim())
  const d = [...faux.matchAll(/enregistrerDepenseIA\([\s\S]{0,600}?acteur:\s*([^\n,]+)/g)].map((m) => m[1].trim())
  ok(
    g.length === 1 && d.length === 1 && !g.every((x) => d.includes(x)),
    'témoin : le détecteur d\'acteur voit un DÉSACCORD entre la garde et la dépense',
    'sans ce témoin, l\'assertion C serait verte parce qu\'elle ne trouve jamais rien',
  )
}
{
  const bloc = "cle: 'organisations_au_plafond_ia',\n  gravite: 'bloquant',\n}"
  const m = bloc.match(/organisations_au_plafond_ia[\s\S]{0,200}?\}/)
  ok(
    m !== null && !/gravite: 'attention'/.test(m[0]),
    'témoin : l\'ancrage sur le bloc voit une gravité changée',
  )
}
ok(
  !new RegExp('\\n  introuvable: \\(').test(LAYOUT),
  'témoin : le détecteur d\'icône ne trouve pas une clé qui n\'existe pas',
)
{
  //  Un corps de fonction SQL qui recopie l'expression au lieu de la lire.
  const faux = [
    'create or replace function public.ai_faux()',
    'as $fn$',
    "  select 1 where x >= date_trunc('month', now() at time zone 'utc');",
    '$fn$;',
  ].join('\n')
  const m = faux.match(/create (?:or replace )?function public\.ai_faux\([\s\S]*?\$fn\$;/)
  ok(
    m !== null && /date_trunc\('month'/.test(m[0]) && !/ai_spend_debut_du_mois\(\)/.test(m[0]),
    'témoin : l\'extraction d\'un corps SQL voit une recopie de la fenêtre',
    'sans ce témoin, un compte d\'occurrences passerait pour une vérification',
  )
}
ok(
  /\.update\(\{ plafond_mensuel_usd:/.test('.update({ plafond_mensuel_usd: Number(v) })') &&
    !/\.update\(\{ plafond_mensuel_usd:/.test('const plafonds_acteur = {}'),
  'témoin : le détecteur d\'écriture distingue un réglage écrit d\'un mot présent',
)
ok(
  DEFINIT_LA_GARDE('export async function budgetDisponible(') &&
    !DEFINIT_LA_GARDE('const x = await budgetDisponible(a, b, c)'),
  'témoin : le définisseur de la garde se distingue de ses appelants',
  'sans cette distinction, la signature du module se lit comme un désaccord d\'acteur',
)

// ═════════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ un plafond par compte, et il n\'arrête que ce qu\'il doit\n'
    : `\n❌ ${failures} écart(s)\n`,
)
process.exit(failures === 0 ? 0 : 1)
