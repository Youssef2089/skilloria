// scripts/diag-lot7-securite.mjs — LES CORRECTIFS DE SÉCURITÉ, SOUS CONTRÔLE
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE FICHIER EXISTE
//   Les défauts couverts ici sont DÉJÀ corrigés. Ce n'est pas une raison de ne
//   rien faire : un correctif que rien ne surveille est à un refactor de
//   revenir, et il reviendra en silence — aucun de ces invariants ne laisse de
//   trace dans le compilateur.
//
//   On ne refait pas le correctif. On pose le contrôle.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-lot7-securite.mjs
//
// AUCUN accès base, AUCUN réseau. Les constats qui ONT demandé une requête
// (bucket privé, lecture directe) sont consignés en tête de leur section avec
// la date et le résultat ; le contrôle, lui, porte sur le code et les
// migrations versionnées — les seuls artefacts qu'un refactor peut changer.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// NORMALISATION DES FINS DE LIGNE (reprise du tronc) : le depot sort les
// fichiers en CRLF, et un retour chariot casse tout motif qui traverse un
// saut de ligne. Sans elle, ce diagnostic serait vert chez son auteur et
// rouge dans les autres worktrees, sur un fichier identique.
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

/** Toutes les migrations, concaténées, en minuscules — pour chercher un retour en arrière. */
function toutesLesMigrations() {
  const dossier = join(ROOT, 'supabase', 'migrations')
  return readdirSync(dossier)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ nom: f, sql: readFileSync(join(dossier, f), 'utf8') }))
}

function sansCommentairesSql(sql) {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
}

/**
 * Toutes les INSTRUCTIONS SQL, dans l'ordre chronologique des migrations.
 *
 * Pourquoi pas une fenêtre de N caractères après chaque motif : une fenêtre
 * CONSOMME le texte, donc l'instruction suivante n'est jamais examinée — un
 * `for all` ajouté juste après une policy longue passait inaperçu. Et pourquoi
 * pas un balayage fichier par fichier : deux instructions contradictoires dans
 * le MÊME fichier doivent être départagées par leur ordre, pas par l'ordre où
 * le contrôle pose ses questions.
 *
 * L'ordre est la seule chose qui distingue un correctif d'un retour en arrière.
 */
function instructions() {
  const out = []
  for (const { nom, sql } of toutesLesMigrations()) {
    for (const brut of sansCommentairesSql(sql).split(';')) {
      const texte = brut.trim()
      if (texte) out.push({ nom, texte, plat: texte.toLowerCase().replace(/\s+/g, ' ') })
    }
  }
  return out
}

console.log('\n━━━ LOT 7 — LES CORRECTIFS DE SÉCURITÉ SONT-ILS TENUS ? ━━━')

// ═══════════════════════════════════════════════════════════════════════════
// 2.1 — E1 : ÉCHAPPEMENT HTML DES EMAILS
//
//   Le correctif : `interpolate()` échappe CHAQUE valeur substituée, au point
//   unique. Le gabarit, lui, n'est jamais échappé — il contient du HTML
//   légitime (`<strong>{companyName}</strong>`).
//
//   Ce qui peut revenir sans bruit : quelqu'un réintroduit une substitution
//   « simple » dans un gabarit, hors de ce point unique. Le rendu est correct,
//   les tests passent, et un nom d'organisation devient un vecteur d'injection.
// ═══════════════════════════════════════════════════════════════════════════
titre("2.1 — E1 : aucune valeur n'entre dans un email sans échappement")

const locales = read('lib/emails/locales.ts')
const escape = read('lib/emails/escape.ts')
const layout = read('lib/emails/layout.ts')
const templates = read('lib/emails/templates.ts')

// (i) Le point unique applique bien l'échappement.
const debutInterp = locales.indexOf('export function interpolate')
const corpsInterp = debutInterp >= 0 ? locales.slice(debutInterp, debutInterp + 400) : ''
ok('interpolate() existe', corpsInterp.length > 0)
ok(
  'interpolate() échappe la valeur substituée',
  corpsInterp.includes('escapeHtml('),
  'la substitution ne passe plus par escapeHtml — injection HTML rouverte',
)
ok(
  "interpolate() n'échappe PAS le gabarit (le HTML légitime doit survivre)",
  !corpsInterp.includes('escapeHtml(template'),
)

// (ii) L'échappeur couvre les cinq entités, et `&` en premier.
for (const [libelle, aiguille] of [
  ['& est échappé', "replace(/&/g, '&amp;')"],
  ['< est échappé', "replace(/</g, '&lt;')"],
  ['> est échappé', "replace(/>/g, '&gt;')"],
  ['" est échappé (sûr en attribut)', "replace(/\"/g, '&quot;')"],
  ["' est échappé en numérique (&#39;, décodé par stripHtml)", "replace(/'/g, '&#39;')"],
]) {
  ok(libelle, escape.includes(aiguille))
}
ok(
  "`&` est traité EN PREMIER (sinon les entités générées seraient ré-échappées)",
  escape.indexOf("'&amp;'") < escape.indexOf("'&lt;'"),
)

// (iii) LE contrôle qui mord : aucune substitution brute hors du point unique.
//   On cherche, dans les fichiers d'email autres que locales.ts, un appel de
//   remplacement portant sur un motif d'accolade — la signature exacte d'une
//   substitution réécrite à la main.
//   NB — on distingue SUBSTITUER de RETIRER. `templates.ts` retire légitimement
//   un marqueur `{publicationTitle}` d'un sujet quand le titre est vide, par un
//   remplacement vers la chaîne vide : aucune valeur n'entre, rien à échapper.
//   Seul un remplacement qui INJECTE quelque chose est une substitution.
const FICHIERS_EMAIL = ['lib/emails/templates.ts', 'lib/emails/layout.ts', 'lib/emails/brand.ts', 'lib/emails/resend.ts', 'lib/emails/domain-url.ts']
const substitutionsBrutes = []
for (const f of FICHIERS_EMAIL) {
  if (!existsSync(join(ROOT, f))) continue
  const src = read(f)
  src.split('\n').forEach((ligne, i) => {
    const t = ligne.trim()
    if (t.startsWith('//') || t.startsWith('*')) return
    const idx = t.indexOf('.replace(')
    if (idx < 0) return
    const suite = t.slice(idx + '.replace('.length)
    if (!suite.includes('{')) return
    // Le remplacement est le dernier argument. S'il est une chaîne littérale
    // (vide ou non), rien n'est injecté. S'il est une expression, si.
    const injecte = !/,\s*(''|""|``)\s*\)/.test(suite)
    if (injecte) substitutionsBrutes.push(`${f}:${i + 1} ${t.slice(0, 90)}`)
  })
}
ok(
  'aucune substitution de gabarit hors de interpolate()',
  substitutionsBrutes.length === 0,
  substitutionsBrutes.join(' | '),
)

// (iv) Chaque valeur insérée DANS DU HTML est enveloppée.
//
//   Les deux fichiers construisent AUSSI la version texte des emails, avec les
//   mêmes variables — et là, échapper serait un défaut, pas une sécurité (le
//   lecteur verrait `&#39;`). On ne regarde donc que les gabarits qui portent
//   une balise : c'est exactement le périmètre où une valeur devient du code.
function valeursEnContexteHtml(src) {
  const trouvees = []
  for (const m of src.matchAll(/\$\{([^}]+)\}/g)) {
    const avant = src.lastIndexOf('`', m.index)
    const apres = src.indexOf('`', m.index)
    if (avant < 0 || apres < 0) continue
    const gabarit = src.slice(avant, apres)
    if (!/<[a-zA-Z]/.test(gabarit)) continue // version texte : rien à échapper
    trouvees.push(m[1].trim())
  }
  return trouvees
}

//   Toute exception doit être NOMMÉE, avec sa raison — jamais tolérée en
//   silence.
const EXCEPTIONS = new Set([
  'params.bodyHtml', // HTML déjà assemblé par les templates, valeurs déjà échappées
  'cta', // fragment construit juste au-dessus, ctaUrl/ctaLabel déjà échappés
])
function estSur(expr) {
  if (/^(escapeText|escapeHtml|interpolate|stripHtml)\(/.test(expr)) return true
  if (/^[A-Z][A-Z0-9_]*$/.test(expr)) return true // constante de style (PRIMARY, BG…)
  // Sorties d'interpolate : la convention de nommage du fichier. `…Html`
  // (fragment assemblé) et `…Line` (ligne interpolée).
  if (/(Html|Line)$/.test(expr)) return true
  // Texte de gabarit issu du fichier de messages : écrit par nous, jamais par
  // un utilisateur. Aucune injection possible — c'est la source, pas la valeur.
  if (/^m\.[a-z_0-9]+$/.test(expr)) return true
  return EXCEPTIONS.has(expr)
}

const nonEnveloppes = []
for (const [f, src] of [['lib/emails/layout.ts', layout], ['lib/emails/templates.ts', templates]]) {
  for (const expr of valeursEnContexteHtml(src)) {
    if (!estSur(expr)) nonEnveloppes.push(`${f} → ${expr}`)
  }
}
ok(
  'toute valeur insérée dans du HTML est échappée, ou nommée en exception',
  nonEnveloppes.length === 0,
  [...new Set(nonEnveloppes)].join(' | '),
)

// ═══════════════════════════════════════════════════════════════════════════
// 2.2 — M4 : ÉCRITURE SUR organization_members
//
//   Le correctif : la policy unique FOR ALL a été remplacée par trois policies
//   par commande, et un admin ne peut plus toucher SA PROPRE ligne.
//
//   Ce qui peut revenir sans bruit : une migration qui « simplifie » en
//   recollant un FOR ALL. Elle passerait toutes les relectures — c'est plus
//   court, et ça a l'air équivalent.
//
//   PREUVE PAR REQUÊTE — voir le rapport du lot : la tentative d'écriture en
//   direct est refusée avant même d'atteindre la policy (RLS active, aucune
//   ligne lisible ni écrivable par un porteur de clé anon). L'auto-promotion
//   est bloquée par le `with check (… and user_id <> auth.uid())` ci-dessous,
//   et le cloisonnement inter-organisations par `is_active_admin_of_org`.
// ═══════════════════════════════════════════════════════════════════════════
titre('2.2 — M4 : aucun retour du FOR ALL sur organization_members')

const migrations = toutesLesMigrations()

// (i) Aucun FOR ALL sur cette table, dans AUCUNE migration — y compris futures.
const SQL = instructions()
const forAll = []
for (const { nom, plat } of SQL) {
  if (!/^create policy .* on (public\.)?organization_members\b/.test(plat)) continue
  if (/\bfor all\b/.test(plat)) forAll.push(`${nom} → ${plat.slice(0, 60)}`)
}
ok(
  'aucune policy FOR ALL sur organization_members',
  forAll.length === 0,
  forAll.join(' | '),
)

// (ii) Les trois policies par commande existent.
const M4 = migrations.find((m) => m.nom.endsWith('_org_members_write_hardening.sql'))
ok('la migration de resserrement existe', !!M4, 'org_members_write_hardening introuvable')
if (M4) {
  const sql = sansCommentairesSql(M4.sql).toLowerCase()
  for (const commande of ['insert', 'update', 'delete']) {
    ok(
      `policy dédiée pour ${commande.toUpperCase()}`,
      sql.includes(`organization_members_admin_${commande}`) && sql.includes(`for ${commande}`),
    )
  }
  // (iii) Le cloisonnement inter-organisations : la même gate partout.
  const nbGate = (sql.match(/is_active_admin_of_org\(organization_id\)/g) ?? []).length
  ok(
    "chaque policy est gardée par is_active_admin_of_org (cloisonnement inter-org)",
    nbGate >= 4,
    `gate comptée ${nbGate}× (attendu ≥ 4 : insert, update using+check, delete)`,
  )
  // (iv) L'auto-promotion : un admin ne peut pas toucher sa propre ligne.
  const nbSoi = (sql.match(/user_id\s*<>\s*auth\.uid\(\)/g) ?? []).length
  ok(
    "un admin ne peut ni se promouvoir ni se supprimer lui-même",
    nbSoi >= 2,
    `garde « user_id <> auth.uid() » comptée ${nbSoi}× (attendu ≥ 2 : update + delete)`,
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 2.3 — M1 : LA VÉRIFICATION D'UN CODE OTP EST FAIL-CLOSED
//
//   À l'ENVOI, laisser passer quand le limiteur est cassé est le bon choix :
//   le pire cas est un SMS de trop. À la VÉRIFICATION, c'est l'inverse — la
//   limite EST la défense anti-force-brute sur un code à 4-6 chiffres, et le
//   seul moment où elle compte vraiment est celui où on l'ignorerait.
//
//   Ce qui peut revenir sans bruit : quelqu'un « harmonise » les deux routes
//   en rebranchant `checkRateLimit` (fail-open) sur la vérification. Le code
//   serait plus court et l'inversion repartirait avec.
// ═══════════════════════════════════════════════════════════════════════════
titre("2.3 — M1 : à la vérification, un limiteur indisponible REFUSE")

const VERIFY = ['app/api/auth/public/verify-phone-otp/route.ts', 'app/api/auth/verify-phone-otp/route.ts']
const ENVOI = 'app/api/auth/public/send-phone-otp/route.ts'
const limiteur = read('lib/rate-limit.ts')

// (i) Le verdict à trois états existe, et distingue bien l'indisponibilité.
ok("le limiteur rend un verdict à trois états", limiteur.includes("'autorise' | 'refuse' | 'indisponible'"))
// UNE SEULE sortie « indisponible ». Chercher la chaîne n'importe où dans le
// fichier ne suffit pas : avec deux sorties jumelles, en supprimer une laissait
// le contrôle vert et emportait la moitié du fail-closed. Le code a donc été
// réécrit pour n'en avoir qu'une — et le contrôle compte.
ok(
  "une RPC en échec vaut « indisponible », plus « autorisé »",
  (limiteur.match(/return 'indisponible'/g) ?? []).length === 1,
  `sorties « indisponible » comptées : ${(limiteur.match(/return 'indisponible'/g) ?? []).length} (attendu : exactement 1)`,
)
ok(
  "l'exception converge vers la MÊME sortie (gestionnaire de rejet sur la RPC)",
  /\.then\(\s*\n?\s*\(r\)/.test(limiteur) && /\(err: unknown\) =>/.test(limiteur),
  "le chemin d'exception a été détaché : il pourrait retomber en « autorisé »",
)
// UN SEUL mécanisme : la même fonction SQL, jamais un limiteur parallèle.
ok(
  "une seule et même RPC rate_limit_check",
  (limiteur.match(/rpc\('rate_limit_check'/g) ?? []).length === 1,
)

for (const f of VERIFY) {
  const src = read(f)
  const court = f.replace('app/api/auth/', '')
  // (ii) La vérification n'utilise PAS l'aide fail-open.
  ok(`${court} : n'appelle pas checkRateLimit (fail-open)`, !src.includes('checkRateLimit('))
  ok(`${court} : lit le verdict brut (evaluerLimite)`, src.includes('evaluerLimite('))
  // (iii) Tout ce qui n'est pas « autorisé » refuse — y compris l'indisponibilité.
  const comparaisons = (src.match(/!==\s*\n?\s*'autorise'/g) ?? []).length
  ok(
    `${court} : seul « autorise » laisse passer (${comparaisons} comparaison(s))`,
    comparaisons >= 2,
    'une comparaison a disparu : un verdict « indisponible » pourrait passer',
  )
  // (iv) Les deux clés, dont l'IP, sur la même fonction.
  ok(`${court} : clé (request_id + téléphone)`, src.includes("'otp_verify'"))
  ok(`${court} : clé IP`, src.includes("'otp_verify_ip'") && src.includes('extractClientIp('))
  // (v) Le refus ne dit jamais si le code était bon.
  //   Compter les occurrences ne suffit pas : on peut AJOUTER un champ révélateur
  //   sans toucher au compte. On lit donc la FORME EXACTE de la réponse — un
  //   champ de plus, quel qu'il soit, et le contrôle tombe.
  const CHAMPS_REFUS_ATTENDUS = ['error', 'code', 'retry_after_seconds']
  const fab = src.match(/const refus = \(\) =>\s*\n?\s*json\(\{([^}]*)\}/)
  ok(`${court} : un seul fabricant de refus (const refus)`, !!fab)
  if (fab) {
    const champs = [...fab[1].matchAll(/(\w+):/g)].map((x) => x[1])
    ok(
      `${court} : la réponse de refus ne porte QUE ${CHAMPS_REFUS_ATTENDUS.join(', ')}`,
      champs.length === CHAMPS_REFUS_ATTENDUS.length &&
        CHAMPS_REFUS_ATTENDUS.every((c) => champs.includes(c)),
      `champs trouvés : ${champs.join(', ')} — tout champ supplémentaire peut trahir la justesse du code`,
    )
  }
  // Et une seule fabrication : pas de refus écrit à la main ailleurs, qui
  // échapperait à la forme ci-dessus.
  ok(
    `${court} : aucun refus de limite écrit hors du fabricant`,
    (src.match(/code: 'rate_limited'/g) ?? []).length === 1,
  )
}

// (vi) Le service-role manquant REFUSE côté route publique (pas d'auth pour le fournir).
const pub = read(VERIFY[0])
ok(
  'public/verify : service-role indisponible → refus (fail-closed)',
  /if \(!admin\) \{[\s\S]{0,300}?return refus\(\)/.test(pub),
  "l'absence de service-role laisse encore passer",
)

// (vii) ET SURTOUT : l'inversion ne déborde pas sur l'ENVOI, où le fail-open
//   est un choix délibéré et documenté. Un contrôle qui laisserait basculer les
//   deux aurait transformé un correctif en régression.
const envoi = read(ENVOI)
ok(
  "l'ENVOI conserve son fail-open (checkRateLimit)",
  envoi.includes('checkRateLimit('),
  "l'inversion a débordé sur l'envoi : un limiteur cassé y bloquerait les inscriptions",
)

// (viii) Le message de refus existe dans les quatre langues.
for (const langue of ['fr', 'en', 'es', 'de']) {
  const msg = JSON.parse(read(`messages/${langue}.json`))
  const v = msg?.signup_form?.errors?.rate_limited
  ok(`message de refus traduit (${langue})`, typeof v === 'string' && v.length > 0)
}

// ═══════════════════════════════════════════════════════════════════════════
// 2.4 — M2 : LE PLAFOND DE RELANCE EST UN GARDE D'ÉCRITURE
//
//   Requalification : depuis le lot 6, la route ne lance plus de reranking —
//   elle PROGRAMME une relance. Le coût est déjà borné par la temporisation
//   (une rafale ne produit qu'un seul run). Ce qui n'était borné par rien,
//   c'est le nombre d'ÉCRITURES sur `profiles` qu'un client peut déclencher.
//
//   Deux choses doivent tenir ensemble, et elles se contredisent en apparence :
//     • le seuil n'a AUCUN champ d'administration — un garde anti-abus n'est
//       pas un réglage commercial, et le rendre modifiable invite à le relever
//       le jour où il gêne, c'est-à-dire le jour où il sert ;
//     • en échange, les dépassements sont COMPTÉS et LISIBLES, au même endroit
//       que le compteur de pannes. Un plafond qu'on ne peut pas observer est un
//       plafond qu'on découvre par un ticket.
//   Retirer l'une des deux casse le marché. Le contrôle tient les deux.
// ═══════════════════════════════════════════════════════════════════════════
titre("2.4 — M2 : plafond en constante, sans réglage, mais observable")

const relance = read('lib/matching/relance.ts')
const sync = read('app/api/me/sync-matching/route.ts')
const routeAdmin = read('app/api/admin/matching-settings/route.ts')
const pageAdmin = read('app/[locale]/admin/matching/page.tsx')

// (i) Le seuil est une constante NOMMÉE, pas un nombre posé dans un appel.
ok('le plafond est une constante nommée', /export const RELANCE_MAX_PAR_HEURE = \d+/.test(relance))
ok('la fenêtre est une constante nommée', /export const RELANCE_FENETRE_S = \d+/.test(relance))
ok(
  'le plafond vaut 20 par heure',
  /RELANCE_MAX_PAR_HEURE = 20\b/.test(relance) && /RELANCE_FENETRE_S = 3600\b/.test(relance),
)

// (ii) La garde est posée dans programmerRelance — donc sur TOUS les appelants,
//   pas seulement sur la route qu'on avait en tête le jour du correctif.
const debutProg = relance.indexOf('export async function programmerRelance')
const finProg = relance.indexOf('export async function solderRelance')
const corpsProg = debutProg >= 0 && finProg > debutProg ? relance.slice(debutProg, finProg) : ''
ok('programmerRelance existe', corpsProg.length > 0)

// On lit L'APPEL, pas le fichier. Chercher un nom de constante n'importe où
// dans la fonction ne prouve rien : il survit dans le message de journal juste
// en dessous, et remplacer les constantes par des nombres au point d'appel
// laissait le contrôle vert. C'est l'invocation qui décide, pas la prose.
const appelGarde = corpsProg.match(/checkRateLimit\(([^)]*)\)/)
ok(
  'la garde est DANS programmerRelance (tous les appelants sont bornés)',
  !!appelGarde && appelGarde[1].includes("'relance_programmation'"),
)
if (appelGarde) {
  ok(
    "l'appel utilise les constantes nommées, pas des nombres posés là",
    appelGarde[1].includes('RELANCE_FENETRE_S') && appelGarde[1].includes('RELANCE_MAX_PAR_HEURE'),
    `arguments trouvés : ${appelGarde[1].trim()}`,
  )
  // Elle passe AVANT l'écriture : garder après ne garderait rien.
  ok(
    "la garde précède l'écriture",
    corpsProg.indexOf(appelGarde[0]) < corpsProg.indexOf("rpc('programmer_relance_expert'"),
  )
}
// Et elle s'appuie sur la même fonction SQL — aucun limiteur parallèle.
ok('elle utilise le limiteur partagé', corpsProg.includes('checkRateLimit('))

// (iii) FAIL-OPEN ici, et c'est l'inverse de l'OTP — pour une bonne raison :
//   refuser sur limiteur cassé ferait PERDRE un déclenchement, soit exactement
//   le défaut corrigé au lot 6.
ok(
  "le plafond de relance reste fail-open (checkRateLimit, pas evaluerLimite)",
  corpsProg.includes('checkRateLimit(') && !corpsProg.includes('evaluerLimite('),
  'un limiteur cassé perdrait des déclenchements — le défaut corrigé au lot 6',
)

// (iv) AUCUN réglage d'administration. Ni champ éditable, ni colonne.
ok(
  "le seuil n'est pas exposé en écriture par la route d'administration",
  !routeAdmin.includes('RELANCE_MAX') && !/relance_max|relance_plafond_reglable/.test(routeAdmin),
)
ok(
  "aucun champ de saisie du plafond sur l'écran /admin/matching",
  !/RELANCE_MAX|relance_max/.test(pageAdmin),
  'un seuil anti-abus est devenu un réglage commercial',
)
// La table des réglages ne doit pas non plus l'avoir absorbé.
const colonneReglage = SQL.some(
  (i) => /alter table (public\.)?matching_settings/.test(i.plat) && /relance/.test(i.plat),
)
ok("le plafond n'a pas été ajouté aux réglages en base", !colonneReglage)

// (v) EN ÉCHANGE : les dépassements sont comptés, et lus au même endroit.
// Là encore : ce qui compte n'est pas que la fonction de comptage EXISTE, mais
// qu'elle soit APPELÉE sur le chemin du refus. Une fonction orpheline laisse le
// compteur à zéro pour toujours, et zéro se lit « tout va bien ».
ok(
  'le dépassement est compté SUR LE CHEMIN DU REFUS',
  /return \{ ok: false, raison: 'plafond_horaire' \}/.test(corpsProg) &&
    corpsProg.indexOf('compterDepassement(') >= 0 &&
    corpsProg.indexOf('compterDepassement(') < corpsProg.indexOf("raison: 'plafond_horaire'"),
  'la fonction de comptage existe peut-être encore, mais plus personne ne l’appelle',
)
ok(
  'le comptage écrit bien dans relance_overruns',
  relance.includes("from('relance_overruns')") && relance.includes('.insert('),
)
ok(
  'le comptage est best-effort (ne fait jamais échouer une programmation)',
  /dépassement NON COMPTÉ/.test(relance),
)
const migrationPlafond = migrations.find((m) => m.nom.endsWith('_plafond_relance.sql'))
ok('la migration du compteur existe', !!migrationPlafond)
if (migrationPlafond) {
  const sql = sansCommentairesSql(migrationPlafond.sql).toLowerCase()
  ok('table relance_overruns', sql.includes('create table if not exists public.relance_overruns'))
  ok('RLS active sans policy (service-role seul)', sql.includes('enable row level security'))
  ok('fonction de santé relance_overrun_health', sql.includes('function public.relance_overrun_health'))
  // Jamais additionnés : les origines n'appellent pas la même action.
  ok('les dépassements ne sont JAMAIS agrégés en un seul nombre', sql.includes('group by o.origine'))
}
// ⚠️ CES QUATRE ASSERTIONS S ANCRAIENT SUR DEUX ADRESSES DE FICHIER, et elles
//    ont rougi quand les dépassements ont DÉMÉNAGÉ — pas quand ils ont
//    disparu. Ils vivaient sur /admin/matching ; la refonte a séparé le
//    RÉGLAGE de la MESURE (§D.11) et les a portés à /admin/supervision.
//
//    UN CONTRÔLE QUI S ANCRE SUR UN NOM ROUGIT AU PREMIER RENOMMAGE ET
//    VERDIT AU PREMIER DÉPLACEMENT. On garde la PROPRIÉTÉ : les dépassements
//    sont lus, ils atteignent un écran, un compteur illisible ne vaut pas
//    zéro, et les origines sont écrites en MOTS. Où cela vit est un détail.
const ADMIN_SOURCES = []
const balayerAdmin = (rel) => {
  if (!existsSync(join(ROOT, rel))) return
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const enfant = `${rel}/${e.name}`
    if (e.isDirectory()) balayerAdmin(enfant)
    else if (/\.tsx?$/.test(e.name)) ADMIN_SOURCES.push(read(enfant))
  }
}
for (const d of ['app/api/admin', 'app/[locale]/admin']) balayerAdmin(d)
const surAdmin = (motif) => ADMIN_SOURCES.some((c) => motif.test(c))

ok(
  "les dépassements de relance sont LUS par une surface d'administration",
  surAdmin(/rpc\('relance_overrun_health'\)/),
)
ok(
  "ils atteignent un écran",
  surAdmin(/plafond_relance_depasse|'relances'/),
)
// « Indisponible » et « zéro » restent distincts, comme pour les pannes.
ok(
  "« compteur illisible » ne se lit pas « aucun dépassement »",
  surAdmin(/relances:\s*ouNull\(/) &&
    read('lib/supervision/problemes.ts').includes('s.relances === null ? null'),
)
// ⚠️ ET LES ORIGINES SE LISENT EN MOTS, PAS EN IDENTIFIANTS DE BASE (§E.26).
//    « profil_modifie » affiché brut sur un écran d'exploitation est une clé.
ok('les origines sont TRADUITES, jamais rendues brutes', surAdmin(/t\(`origine\.\$\{/))
for (const langue of ['fr', 'en', 'es', 'de']) {
  const msg = JSON.parse(read(`messages/${langue}.json`))
  const o = msg?.admin_back_office?.supervision
  ok(
    `libellés des dépassements traduits (${langue})`,
    !!o?.origine?.profil_modifie &&
      !!o?.origine?.ouverture_croisee &&
      !!o?.origine?.disponibilite &&
      !!o?.origine?.cv_reanalyse &&
      typeof o?.detail_title?.relances === 'string',
  )
}

// (vi) Le refus est un refus DÉLIBÉRÉ, pas une panne : il ne doit pas se
//   confondre avec une erreur serveur, sinon on cherche une panne inexistante.
ok(
  'sync-matching distingue le plafond (429) de la panne (500)',
  sync.includes("prog.raison === 'plafond_horaire'") && sync.includes("code: 'relance_plafond'"),
)

// ═══════════════════════════════════════════════════════════════════════════
// 2.5 — M3 : photo_url ET LES BUCKETS
//
//   CONSTAT ÉTABLI (lecture de code + requête, staging) :
//     • photo_url N'EST PAS une colonne morte, et le client N'ÉCRIT PAS en
//       base : elle est écrite par PATCH /api/profile, via la liste blanche
//       `directFields`. Le client, lui, écrit dans le STOCKAGE (upload direct
//       du blob sous `<uid>/avatar.jpg`, policy owner-scoped).
//     • Sa VALEUR n'est qu'un drapeau de présence. Aucune URL n'est jamais
//       construite à partir d'elle : `signAvatarUrl` redérive le chemin depuis
//       `user_id`. Une valeur falsifiée par PATCH ne donne donc accès à rien.
//     • En base : 1 ligne non nulle, au format `<user_id>/avatar.jpg`, 0 URL
//       externe.
//     • Bucket `avatars` : GET public → HTTP 400 ; URL signée → HTTP 200.
//
//   C'est cette dernière ligne qui doit être verrouillée : un bucket repasse
//   public en une instruction, et rien ne le dirait.
// ═══════════════════════════════════════════════════════════════════════════
titre('2.5 — M3 : la valeur de photo_url ne donne accès à rien, et le bucket reste privé')

const avatar = read('lib/avatar.ts')

// (i) Le chemin vient de user_id, JAMAIS de la valeur stockée.
ok(
  'le chemin de stockage est dérivé de user_id (source unique)',
  avatar.includes('export function avatarStoragePath(userId: string)') &&
    avatar.includes('return `${userId}/avatar.jpg`'),
)
// On lit le CODE, jamais la prose : le module DOCUMENTE `photo_url` dans son
// en-tête, et un contrôle qui lit les commentaires échoue sur la phrase même
// qui énonce sa règle.
const avatarCode = avatar
  .split('\n')
  .filter((l) => {
    const t = l.trim()
    return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
  })
  .join('\n')
ok(
  "signAvatarUrl ne lit pas photo_url — il redérive le chemin",
  avatarCode.includes('avatarStoragePath(userId)') && !avatarCode.includes('photo_url'),
  'signAvatarUrl utilise la valeur stockée : une valeur falsifiée deviendrait un chemin',
)

// (ii) Le bucket est privé, et aucune migration ne le rouvre.
// L'état qui compte est l'état NET, résolu dans l'ordre des migrations : une
// policy créée puis retirée n'est pas un défaut — c'est l'histoire du correctif
// lui-même (…0004 l'ouvre, …0006 la referme). Seul le dernier mot compte.
let lectureAvatarsOuverte = false
let bucketPublic = false
let dernierActe = 'aucun'
let dernierBucket = 'aucun'
for (const { nom, plat } of SQL) {
  if (/^drop policy if exists avatars_public_read/.test(plat)) {
    lectureAvatarsOuverte = false
    dernierActe = `${nom} (refermée)`
  } else if (/^create policy avatars_public_read/.test(plat)) {
    lectureAvatarsOuverte = true
    dernierActe = `${nom} (ouverte)`
  }
  if (/^update storage\.buckets set public = true/.test(plat)) {
    bucketPublic = true
    dernierBucket = `${nom} (rendu public)`
  } else if (/^update storage\.buckets set public = false/.test(plat)) {
    bucketPublic = false
    dernierBucket = `${nom} (rendu privé)`
  }
}
ok(
  "au terme des migrations, aucune lecture publique des avatars n'est ouverte",
  !lectureAvatarsOuverte,
  `dernier acte : ${dernierActe}`,
)
ok("au terme des migrations, aucun bucket n'est repassé public", !bucketPublic, `dernier acte : ${dernierBucket}`)
ok(
  'la migration qui rend le bucket avatars privé est toujours là',
  migrations.some((m) => sansCommentairesSql(m.sql).toLowerCase().includes("set public = false where id = 'avatars'")),
)

// (iii) Aucune surface ne renvoie la valeur brute au client : tout passe par
//   la signature. On vérifie que chaque fichier qui projette `photo_url` vers
//   l'extérieur importe le signataire.
const PROJETTENT = [
  'lib/candidature-org-dto.ts',
  'app/api/admin/get-expert/[id]/route.ts',
  'app/api/admin/list-experts/route.ts',
  'app/api/conversations/[id]/messages/route.ts',
  'app/api/me/conversations/route.ts',
]
for (const f of PROJETTENT) {
  if (!existsSync(join(ROOT, f))) {
    ok(`surface présente : ${f}`, false, 'fichier introuvable — contrôle périmé, à remettre à jour')
    continue
  }
  ok(`${f} signe l'avatar au lieu de renvoyer la valeur`, read(f).includes('signAvatarUrl('))
}

// ═══════════════════════════════════════════════════════════════════════════
// 2.6 — LECTURE DIRECTE DE users PAR UN CLIENT
//
//   CONSTAT ÉTABLI, ET IL COMMANDE LA SUITE :
//     La seule policy de LECTURE sur public.users est `users_self_read`, en
//     `auth.uid() = id` (baseline), resserrée depuis en
//     `auth.uid() = id AND NOT account_in_grace(auth.uid())`.
//     Un client qui interroge la table EN DIRECT ne lit QUE sa propre ligne.
//     Il n'atteint aucun expert, dévoilé ou non.
//     Corroboré par requête : porteur de clé anon → 0 ligne sur users,
//     profiles, organizations, candidatures, publications (RLS active).
//
//   DONC : la lecture directe n'ouvre RIEN, et il n'y a AUCUNE policy
//   `users_org_unlocked_read` à écrire. En poser une serait ajouter une
//   seconde règle de dévoilement, à côté de celle du DTO — exactement ce qu'il
//   fallait éviter. Le dévoilement reste décidé à UN seul endroit,
//   `disclosurePolicyForCandidatureLifecycle`, côté serveur.
//
//   Ce qui est posé ici n'est donc pas une ouverture : c'est le verrou qui
//   empêche d'en créer une par distraction.
// ═══════════════════════════════════════════════════════════════════════════
titre('2.6 — la lecture directe de users reste strictement personnelle')

const policiesUsers = []
for (const { nom, sql } of migrations) {
  const propre = sansCommentairesSql(sql)
  for (const m of propre.matchAll(/create policy\s+"?([\w]+)"?\s+on\s+"?public"?\."?users"?([\s\S]{0,300})/gi)) {
    const corps = m[2].toLowerCase()
    if (/for\s+select/.test(corps) || !/for\s+(insert|update|delete|all)/.test(corps)) {
      policiesUsers.push({ nom, policy: m[1], corps })
    }
  }
}
ok(
  'une seule policy de lecture sur public.users',
  policiesUsers.length === 1,
  `trouvées : ${policiesUsers.map((p) => `${p.policy} (${p.nom})`).join(', ') || 'aucune'}`,
)
if (policiesUsers.length >= 1) {
  ok(
    "elle est bornée à la ligne de l'appelant (auth.uid() = id)",
    // La baseline écrit les identifiants entre guillemets : `"auth"."uid"() = "id"`.
    // On normalise avant de comparer, sinon le contrôle dépend du style du dump
    // et non de la règle.
    policiesUsers.every((p) => /auth\.uid\(\)\s*=\s*id/.test(p.corps.replace(/"/g, ''))),
  )
}
ok(
  "aucune policy nommée users_org_unlocked_read n'a été créée",
  !migrations.some((m) => m.sql.toLowerCase().includes('users_org_unlocked_read')),
  'une seconde règle de dévoilement a été écrite en SQL, à côté de celle du DTO',
)

// La règle de dévoilement reste unique et côté serveur.
const dto = existsSync(join(ROOT, 'lib/candidature-org-dto.ts')) ? read('lib/candidature-org-dto.ts') : ''
ok(
  'la règle de dévoilement est appliquée par le DTO serveur',
  dto.includes('disclosurePolicyForCandidatureLifecycle'),
  'le DTO ne dérive plus la politique de dévoilement de la source unique',
)

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n━━━ ${echecs === 0 ? 'TOUT VERT' : `${echecs} ÉCHEC(S)`} ━━━\n`)
process.exit(echecs === 0 ? 0 : 1)
