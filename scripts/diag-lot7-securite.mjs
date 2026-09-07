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
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

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
