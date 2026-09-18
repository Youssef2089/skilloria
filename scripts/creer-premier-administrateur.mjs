// scripts/creer-premier-administrateur.mjs — LE PROBLEME DU JOUR ZERO.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE SCRIPT EXISTE
//
//   SUR UNE PRODUCTION NEUVE, PERSONNE NE PEUT ADMINISTRER LE SITE. Les deux
//   chemins qu'on croirait ouverts sont fermes, et aucun des deux ne le dit :
//
//   ① LA ROUTE APPLICATIVE NE PEUT PAS SERVIR.
//      `POST /api/admin/create-admin` est gardee par `requireAdmin` ET exige un
//      jeton de re-authentification. Il faut deja etre administrateur pour en
//      fabriquer un. Son propre en-tete le dit : « Elle ne cree PAS le PREMIER
//      administrateur ; ce bootstrap-la est un chantier distinct. »
//
//   ② UNE INSCRIPTION ORDINAIRE NE PRODUIT PAS UN ADMINISTRATEUR, ET ECHOUE EN
//      SILENCE. `handle_new_user` ne connait que expert / cdi / entreprise /
//      cabinet. Pour tout autre role — 'admin' compris — il fait
//      `RAISE WARNING` puis `RETURN NEW` : le compte `auth.users` est cree, la
//      fonction rend la main SANS ERREUR, et `public.users` n'a AUCUNE ligne.
//      Un compte fantome, inconnectable, qui OCCUPE l'adresse e-mail.
//
//   Sans ce script, la seule issue est une suite de gestes a la main dans
//   l'editeur SQL — c'est-a-dire exactement §E.10 : une valeur posee a la main
//   ne survit pas a une reconstruction, et personne ne sait qu'elle a existe.
//   Le seul jour ou l'on en a besoin est le jour ou personne n'est la pour
//   l'avoir vu faire.
//
// CE QU'IL FAIT — LA MEME CHOSE QUE LA ROUTE, DANS LE MEME ORDRE
//   1. resout l'ecosysteme par son slug (ACTIF uniquement) ;
//   2. resout le role commercial « Admin » ;
//   3. refuse si l'adresse est deja prise ;
//   4. cree le compte `auth.users` avec le role de pont 'entreprise' — que le
//      trigger SAIT traiter — et un mot de passe aleatoire qui n'est ni rendu,
//      ni journalise, ni affiche ;
//   5. VERIFIE QUE LE MIROIR EXISTE. C'est le controle a ne jamais retirer : le
//      point mort du trigger ne remonte aucune erreur. Miroir absent ⇒ le
//      compte auth est supprime, et le script echoue proprement ;
//   6. bascule vers le role reel : user_type 'admin', role_id Admin,
//      status 'active' (un administrateur en 'draft' ne serait pas compte comme
//      disponible par l'anti-lock-out plateforme), email_verified ;
//   7. VERIFIE QUE LE SIEGE D'ADMINISTRATEUR PLATEFORME EST POURVU. Il l'est par
//      un trigger (`users_pourvoir_siege_plateforme`), pas par ce script : on ne
//      le pose pas, on constate qu'il a ete pris ;
//   8. laisse une trace dans `audit_logs`.
//
// CE QU'IL NE FAIT PAS, ET POURQUOI
//   IL N'ENVOIE PAS L'INVITATION. Le produit a deja un chemin pour ca — l'ecran
//   « mot de passe oublie », qui est exactement celui qu'emprunte
//   `lib/admin/admin-invitation.ts`. En recrire un ici en ferait un JUMEAU, et
//   §E.20 dit ce que devient un jumeau : on corrige l'un, on documente la
//   correction dans son commentaire, et le defaut reste vivant dans l'autre.
//
//   IL NE SERT QU'UNE FOIS. S'il existe deja un administrateur plateforme, il
//   REFUSE. Sans ce refus, il deviendrait une porte derobee permanente : la
//   route applicative exige une re-authentification et laisse une trace nominale,
//   ce script n'a ni l'une ni l'autre — par construction, puisqu'il n'y a
//   personne pour s'authentifier.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node --env-file=.env.local scripts/creer-premier-administrateur.mjs \
//        --email=... --prenom=... --nom=... --ecosysteme=<slug> --db
//
//   Sans `--db`, le script REFUSE, annonce ce qu'il ecrirait, et sort en code 2
//   (§E.4). 0 = fait · 1 = refus ou echec · 2 = n'a pas tourne.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { exigerAutorisationEcriture } from './garde-ecriture.mjs'

// ─── ARGUMENTS ───────────────────────────────────────────────────────────────

const arg = (nom) => {
  const p = process.argv.find((a) => a.startsWith(`--${nom}=`))
  return p ? p.slice(nom.length + 3).trim() : null
}

const email = (arg('email') ?? '').toLowerCase()
const prenom = arg('prenom')
const nom = arg('nom')
const ecosysteme = arg('ecosysteme')

const manquants = []
if (!email) manquants.push('--email')
if (!prenom) manquants.push('--prenom')
if (!nom) manquants.push('--nom')
if (!ecosysteme) manquants.push('--ecosysteme')

// Un refus dit CE QUI BLOQUE et CE QU'ON PEUT FAIRE — y compris dans un script.
if (manquants.length > 0) {
  console.error('')
  console.error(`✖ Argument(s) manquant(s) : ${manquants.join(', ')}`)
  console.error('')
  console.error('  node --env-file=.env.local scripts/creer-premier-administrateur.mjs \\')
  console.error('       --email=vous@exemple.fr --prenom=Prenom --nom=Nom \\')
  console.error('       --ecosysteme=<slug> --db')
  console.error('')
  console.error("  Le slug est celui d'un ecosysteme ACTIF, tel qu'il est en base")
  console.error('  (colonne `slug` de `public.domains`). Il decide de quel ecosysteme')
  console.error("  releve le compte — sans accorder aucun droit : `requireAdmin` ignore")
  console.error("  deliberement `domain_id`, un administrateur est PLATEFORME.")
  console.error('')
  process.exit(2)
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`✖ Adresse e-mail invalide : ${email}`)
  process.exit(2)
}

// ─── LA GARDE D'ECRITURE (§E.4) ──────────────────────────────────────────────

exigerAutorisationEcriture({
  script: 'creer-premier-administrateur.mjs',
  ecrit: [
    `auth.users      — creation du compte ${email}`,
    'public.users    — miroir pose par le trigger, puis bascule en user_type=admin',
    'public.plateforme — le siege d\'administrateur est pourvu PAR UN TRIGGER',
    'public.audit_logs — une trace admin_account_bootstrapped',
  ],
  drapeaux: `--email=${email} --prenom=… --nom=… --ecosysteme=${ecosysteme} --db`,
})

// ─── CONNEXION ───────────────────────────────────────────────────────────────

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const cle = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !cle) {
  console.error('✖ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absentes.')
  console.error('  Relancez avec `node --env-file=.env.local …`, ou exportez-les.')
  process.exit(2)
}
const db = createClient(url, cle, { auth: { persistSession: false } })

const echouer = (msg, indice) => {
  console.error('')
  console.error(`✖ ${msg}`)
  if (indice) console.error(`  → ${indice}`)
  console.error('')
  process.exit(1)
}

// ─── 0. CE SCRIPT NE SERT QU'UNE FOIS ────────────────────────────────────────
// Une erreur de LECTURE ici ne vaut pas « il n'y a pas d'administrateur » : on
// refuse d'agir plutot que d'ouvrir une porte sur une panne (§E.22, le seul
// fail-open des neuf y est nomme).

{
  const { data, error } = await db
    .from('users')
    .select('id, email')
    .eq('user_type', 'admin')
    .is('anonymized_at', null)
    .limit(5)

  if (error) {
    echouer(
      "impossible de verifier s'il existe deja un administrateur.",
      `la LECTURE a echoue (${error.message}). Ce n'est pas « il n'y en a pas » : ` +
        "on ne cree pas un administrateur de secours sur une panne de lecture.",
    )
  }
  if (data.length > 0) {
    echouer(
      `il existe deja ${data.length} administrateur(s) plateforme.`,
      'Ce script ne fabrique QUE le premier. Pour les suivants, passez par ' +
        "/admin/utilisateurs → « Creer un administrateur » : cette route exige une " +
        're-authentification et laisse une trace nominale, que ce script ne peut ' +
        `pas produire. Deja en place : ${data.map((u) => u.email).join(', ')}`,
    )
  }
}

// ─── 1. L'ECOSYSTEME ─────────────────────────────────────────────────────────

const { data: domaine, error: errDomaine } = await db
  .from('domains')
  .select('id, slug, name')
  .eq('slug', ecosysteme)
  .eq('active', true)
  .maybeSingle()

if (errDomaine) echouer(`lecture de l'ecosysteme impossible : ${errDomaine.message}`)
if (!domaine) {
  const { data: dispo } = await db.from('domains').select('slug').eq('active', true)
  echouer(
    `aucun ecosysteme ACTIF avec le slug « ${ecosysteme} ».`,
    dispo?.length
      ? `Actifs en base : ${dispo.map((d) => d.slug).join(', ')}`
      : "Aucun ecosysteme actif en base : l'etape « Appliquer les mises a jour de base » de docs/mise-en-production.md n'a pas abouti.",
  )
}

// ─── 2. LE ROLE COMMERCIAL « Admin » ─────────────────────────────────────────
// Il n'accorde aucun droit : `requireAdmin` lit `users.user_type`. Il est pose
// parce qu'une lecture en base ne doit pas trouver un administrateur sur l'offre
// gratuite — ce serait lisible comme une anomalie de facturation.

const { data: role, error: errRole } = await db
  .from('roles')
  .select('id')
  .eq('name', 'Admin')
  .maybeSingle()

if (errRole) echouer(`lecture des roles impossible : ${errRole.message}`)
if (!role) {
  echouer(
    "le role commercial « Admin » est absent.",
    'Il est pose par la migration `commerce_seed`. Son absence signifie que ' +
      "l'etape « Appliquer les mises a jour de base » de docs/mise-en-production.md n'a pas abouti.",
  )
}

// ─── 3. L'ADRESSE EST-ELLE LIBRE ? ───────────────────────────────────────────

{
  const { data, error } = await db.from('users').select('id').eq('email', email).maybeSingle()
  if (error) echouer(`verification de l'adresse impossible : ${error.message}`)
  if (data) echouer(`l'adresse ${email} est deja utilisee par un compte.`)
}

// ─── 4. CREATION DU COMPTE auth.users ────────────────────────────────────────
// ⚠️ LE ROLE DE PONT. On passe 'entreprise', PAS 'admin' : c'est le seul role
//    que `handle_new_user` sait traiter et qui ne cree ni profil expert ni
//    organisation. La bascule vers le role reel se fait juste apres, en base.
//    Ecrire 'admin' ici produirait le compte fantome decrit en tete de fichier.

const TRIGGER_BRIDGE_ROLE = 'entreprise'

console.log(`  … creation du compte ${email} sur l'ecosysteme « ${domaine.slug} »`)

const { data: cree, error: errCreate } = await db.auth.admin.createUser({
  email,
  // Mot de passe aleatoire : il n'est ni rendu, ni journalise, ni affiche. Le
  // seul acces passe par l'ecran « mot de passe oublie ».
  password: randomUUID() + randomUUID(),
  email_confirm: true,
  user_metadata: {
    role: TRIGGER_BRIDGE_ROLE,
    domain_slug: domaine.slug,
    firstname: prenom,
    lastname: nom,
  },
})

if (errCreate || !cree?.user) {
  echouer(`creation du compte impossible : ${errCreate?.message ?? 'aucun compte rendu'}`)
}
const idNouveau = cree.user.id

/** Retire le compte auth quand la suite echoue — on ne laisse pas de fantome. */
const nettoyer = async () => {
  const { error } = await db.auth.admin.deleteUser(idNouveau)
  if (error) {
    console.error(`  ⚠ le compte auth ${idNouveau} n'a PAS pu etre retire : ${error.message}`)
    console.error("    Il occupe l'adresse e-mail. Retirez-le depuis Supabase → Authentication.")
  } else {
    console.error('  … compte auth retire, aucune trace laissee.')
  }
}

// ─── 5. LE MIROIR — LE CONTROLE A NE JAMAIS RETIRER ──────────────────────────

const { data: miroir, error: errMiroir } = await db
  .from('users')
  .select('id, locale')
  .eq('id', idNouveau)
  .maybeSingle()

if (errMiroir || !miroir) {
  console.error('')
  console.error('✖ MIROIR ABSENT : `public.users` n\'a aucune ligne pour ce compte.')
  console.error(
    `  → C'est le point mort du trigger. ${errMiroir ? `Lecture : ${errMiroir.message}. ` : ''}` +
      'Le compte auth existe mais est inconnectable.',
  )
  await nettoyer()
  process.exit(1)
}

// ─── 6. BASCULE VERS LE ROLE REEL ────────────────────────────────────────────

const { error: errBascule } = await db
  .from('users')
  .update({
    user_type: 'admin',
    role_id: role.id,
    // 'active' et pas 'draft' : `countOtherAvailablePlatformAdmins` ne compte
    // QUE les 'active'. Un administrateur reste en 'draft' existerait sans etre
    // compte, et l'anti-lock-out plateforme le croirait absent.
    status: 'active',
    email_verified: true,
  })
  .eq('id', idNouveau)

if (errBascule) {
  console.error('')
  console.error(`✖ la bascule en administrateur a echoue : ${errBascule.message}`)
  await nettoyer()
  process.exit(1)
}

// ─── 7. LE SIEGE D'ADMINISTRATEUR PLATEFORME ─────────────────────────────────
// On ne le POSE pas : le trigger `users_pourvoir_siege_plateforme` le prend des
// qu'un administrateur disponible apparait. On CONSTATE qu'il l'a ete — sinon
// la plateforme resterait sans siege, et rien a l'ecran ne le dirait.

const { data: siege, error: errSiege } = await db
  .from('plateforme')
  .select('siege_admin_user_id')
  .maybeSingle()

let siegePourvu = false
if (errSiege) {
  console.error(`  ⚠ siege plateforme : lecture impossible (${errSiege.message}) — a verifier.`)
} else if (siege?.siege_admin_user_id === idNouveau) {
  siegePourvu = true
} else {
  console.error('')
  console.error('  ⚠ LE SIEGE D\'ADMINISTRATEUR PLATEFORME N\'A PAS ETE POURVU.')
  console.error(`    Attendu : ${idNouveau} — lu : ${siege?.siege_admin_user_id ?? 'VACANT'}`)
  console.error('    Le compte est administrateur et fonctionne, mais la garantie')
  console.error('    « jamais zero administrateur » ne le protege pas. Le trigger')
  console.error('    `users_pourvoir_siege_plateforme` doit etre relu.')
}

// ─── 8. LA TRACE ─────────────────────────────────────────────────────────────
// L'acteur est le compte cree lui-meme : il n'y a personne d'autre, et c'est
// precisement ce que cette ligne doit raconter.

const { error: errTrace } = await db.from('audit_logs').insert({
  user_id: idNouveau,
  domain_id: domaine.id,
  action: 'admin_account_bootstrapped',
  entity_type: 'user',
  entity_id: idNouveau,
  detail: {
    email,
    domain_slug: domaine.slug,
    via: 'scripts/creer-premier-administrateur.mjs',
    motif: 'premier administrateur plateforme — aucun acteur authentifiable',
  },
})
if (errTrace) console.error(`  ⚠ trace d'audit non ecrite : ${errTrace.message}`)

// ─── CE QU'IL RESTE A FAIRE, EN CLAIR ────────────────────────────────────────

console.log('')
console.log('  ' + '─'.repeat(72))
console.log(`  ADMINISTRATEUR CREE — ${email}`)
console.log('  ' + '─'.repeat(72))
console.log(`    identifiant   : ${idNouveau}`)
console.log(`    ecosysteme    : ${domaine.slug} (${domaine.name})`)
console.log(`    siege plateforme : ${siegePourvu ? 'POURVU' : 'a verifier — voir ci-dessus'}`)
console.log('')
console.log('    IL N\'A PAS ENCORE DE MOT DE PASSE, et c\'est voulu : aucun secret')
console.log('    n\'a ete affiche ni journalise.')
console.log('')
console.log('    POUR OUVRIR LA SESSION :')
console.log('      1. ouvrez le site, « Mot de passe oublie »')
console.log(`      2. saisissez ${email}`)
console.log('      3. suivez le lien recu, choisissez un mot de passe')
console.log('')
console.log('    Si le lien est refuse par Supabase (« requested path is invalid »),')
console.log('    c\'est que `/<langue>/nouveau-mot-de-passe` manque dans les')
console.log("    Redirect URLs — voir « Regler l'authentification » dans")
console.log('    docs/mise-en-production.md.')
console.log('')
process.exit(0)
