// scripts/admin-organisations-orphelines.mjs — LES ORGANISATIONS QUE PERSONNE
// NE PEUT ATTEINDRE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'IL TRAITE
//   Une organisation sans AUCUN membre actif n'apparait sur l'ecran de
//   personne : aucun utilisateur ne la porte, aucun ecran ne la montre, et
//   aucune action ne peut la faire revivre. Elle n'est pas « bloquee » — elle
//   est INATTEIGNABLE.
//
//   Deux existent sur staging, nees d'une inscription interrompue le
//   2026-05-30 : `register-org` inserait l'organisation puis le membre en deux
//   allers-retours, et le rattrapage de l'epoque supprimait l'utilisateur —
//   dont la CASCADE emportait le membre — en laissant l'organisation.
//
//   LE CHEMIN EST FERME (migration 20260915200000 : creation transactionnelle
//   + contrainte differee a la naissance). Ce script ne traite donc QUE
//   l'heritage, et il doit rester utile ensuite : si un jour il retrouve
//   quelque chose, c'est qu'un nouveau chemin a ete ouvert.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL DECOUVRE AU LIEU DE CITER DES IDENTIFIANTS
//   Une migration qui nommerait `abbbc311-…` et `d6a1d09b-…` ne voudrait RIEN
//   dire en production : ces identifiants n'y existent pas. Pire, elle
//   donnerait l'illusion que le probleme est traite alors qu'elle ne
//   s'appliquerait a rien. Le critere doit etre une DEFINITION, pas une liste.
//
// LE CRITERE, VOLONTAIREMENT STRICT — on ne supprime que ce dont on est certain
//   qu'il n'a JAMAIS rien porte. Les quatre conditions sont cumulatives :
//     (a) AUCUN membre, quel que soit son statut — pas meme 'removed'.
//         Une ligne 'removed' est une trace de passage : quelqu'un a ete la.
//     (b) AUCUNE publication, quel que soit son statut, brouillon inclus.
//     (c) AUCUN compteur d'usage consomme (`used > 0`).
//     (d) AUCUNE trace de facturation. Il n'existe pas de table de
//         transactions : l'abonnement vit SUR `organizations`
//         (20260903000000). On lit donc ses colonnes — un identifiant client
//         ou abonnement Stripe, un abonnement demarre, une echeance. Une
//         organisation qu'on a seulement TENTE de facturer n'est pas un dechet
//         d'inscription.
//         `package_id` seul ne compte PAS : il est pose d'office a la creation
//         d'une organisation personnelle, sans qu'un centime ait circule.
//   Dans le doute, on garde. C'est la meme posture que la migration
//   20260828000000 de nettoyage des organisations fantomes.
//
// ⚠️ usage_counters N'A AUCUNE CLE ETRANGERE vers organizations (cf. migration
//    20260709000002) : la CASCADE ne les emporte pas. On les supprime donc A LA
//    MAIN, AVANT la ligne `organizations`, sans quoi on laisserait des lignes
//    orphelines que plus rien ne relie a quoi que ce soit.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node --env-file=.env.local scripts/admin-organisations-orphelines.mjs --db
//       → INVENTAIRE. Lit, affiche, ne supprime RIEN. C'est le defaut.
//
//   node --env-file=.env.local scripts/admin-organisations-orphelines.mjs --db --supprimer
//       → SUPPRIME les organisations decouvertes.
//
// DEUX DRAPEAUX, ET C'EST DELIBERE. `--db` ouvre l'acces a la base ; il ne doit
// PAS suffire a detruire. Si lister et supprimer avaient le meme visage, on
// retomberait exactement dans le defaut que scripts/garde-ecriture.mjs
// documente : une famille de commandes ou l'inoffensif et le destructeur se
// ressemblent.

import { createClient } from '@supabase/supabase-js'
import { exigerAutorisationEcriture } from './garde-ecriture.mjs'

const SUPPRIMER = process.argv.includes('--supprimer')

// ── La garde d'ecriture ne s'applique QUE si on supprime ────────────────────
// L'inventaire est une lecture pure : lui demander un drapeau d'ecriture
// dresserait les gens a passer le drapeau par reflexe, et le jour ou il
// compterait vraiment il ne voudrait plus rien dire.
if (SUPPRIMER) {
  exigerAutorisationEcriture({
    script: 'admin-organisations-orphelines.mjs',
    ecrit: [
      'usage_counters : suppression des lignes des organisations decouvertes',
      'organizations  : suppression des lignes decouvertes',
      '  (CASCADE : organization_members, organization_domains,',
      '   organization_invitations, publications, verification_attempts)',
    ],
    perte:
      'les organisations decouvertes et tout leur derive sont supprimes DEFINITIVEMENT. ' +
      'Le critere est strict (aucun membre, aucune publication, aucun usage, aucune facturation), ' +
      'mais aucune sauvegarde n\'est faite ici.',
    // LES DEUX drapeaux. Sans cela, le refus afficherait `--db` seul et
    // apprendrait a l'operateur que `--db` supprime — alors qu'il ne fait
    // qu'ouvrir la lecture.
    drapeaux: '--db --supprimer',
  })
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absentes.')
  console.error('  node --env-file=.env.local scripts/admin-organisations-orphelines.mjs --db')
  process.exit(2)
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

/** Une lecture qui echoue ARRETE tout : on ne supprime jamais sur une vue partielle. */
const lire = async (label, requete) => {
  const { data, error } = await requete
  if (error) {
    console.error(`\n  ECHEC de lecture (${label}) : ${error.message}`)
    console.error('  Rien n\'a ete supprime. Une vue partielle ne doit JAMAIS decider d\'une suppression.')
    process.exit(1)
  }
  return data ?? []
}

console.log('\n=== organisations orphelines — inventaire ===\n')

const orgs = await lire(
  'organizations',
  db
    .from('organizations')
    .select(
      'id, company_name, org_type, created_at, verification_status, ' +
        'stripe_customer_id, stripe_subscription_id, package_started_at, package_valid_until',
    ),
)
const membres = await lire('organization_members', db.from('organization_members').select('organization_id'))
const publis = await lire('publications', db.from('publications').select('organization_id'))
const compteurs = await lire('usage_counters', db.from('usage_counters').select('organization_id, used'))

// LA FACTURATION VIT SUR `organizations`, il n'y a pas de table de
// transactions (20260903000000). `package_id` est EXCLU a dessein : il est pose
// d'office a la creation d'une organisation personnelle, sans qu'un centime ait
// circule. Ce qui compte, c'est un lien Stripe ou un abonnement reellement
// demarre.
const COLONNES_FACTURATION = [
  'stripe_customer_id',
  'stripe_subscription_id',
  'package_started_at',
  'package_valid_until',
]

// ⚠️ LES CLIENTS SUPABASE NE SONT PAS TYPES. Une colonne renommee ou supprimee
//    reviendrait simplement absente, donc lue comme « pas de facturation » —
//    et on supprimerait une organisation payante sans que rien ne bronche. On
//    verifie donc la FORME de la ligne, pas seulement ses valeurs.
if (orgs.length > 0) {
  const manquantes = COLONNES_FACTURATION.filter((c) => !(c in orgs[0]))
  if (manquantes.length > 0) {
    console.error(`\n  Colonnes de facturation absentes de la lecture : ${manquantes.join(', ')}`)
    console.error('  Le critere (d) ne peut pas etre evalue. RIEN n\'a ete supprime :')
    console.error('  une colonne disparue se lirait « pas de facturation », donc supprimerait.')
    process.exit(1)
  }
}
const aUneTraceDeFacturation = (o) => COLONNES_FACTURATION.some((c) => o[c] != null)

const avecMembre = new Set(membres.map((r) => r.organization_id))
const avecPubli = new Set(publis.map((r) => r.organization_id))
const avecUsage = new Set(compteurs.filter((r) => (r.used ?? 0) > 0).map((r) => r.organization_id))

const orphelines = orgs.filter(
  (o) =>
    !avecMembre.has(o.id) &&
    !avecPubli.has(o.id) &&
    !avecUsage.has(o.id) &&
    !aUneTraceDeFacturation(o),
)

console.log(`  Organisations en base                : ${orgs.length}`)
console.log(`  Portant au moins un membre           : ${orgs.filter((o) => avecMembre.has(o.id)).length}`)
console.log(`  ORPHELINES (aucun membre, aucune publication, aucun usage, aucune facturation) : ${orphelines.length}\n`)

for (const o of orphelines) {
  console.log(`    · ${o.id}`)
  console.log(`      « ${o.company_name} » (${o.org_type}) — creee ${o.created_at} — ${o.verification_status}`)
}
if (orphelines.length === 0) {
  console.log('    Aucune. Rien a nettoyer.')
}

if (!SUPPRIMER) {
  console.log('\n  INVENTAIRE SEUL — rien n\'a ete supprime.')
  if (orphelines.length > 0) {
    console.log('  Pour supprimer, volontairement :')
    console.log('    node --env-file=.env.local scripts/admin-organisations-orphelines.mjs --db --supprimer')
  }
  console.log('')
  process.exit(0)
}

if (orphelines.length === 0) {
  console.log('\n  Rien a supprimer.\n')
  process.exit(0)
}

console.log('\n  SUPPRESSION EN COURS…\n')
const ids = orphelines.map((o) => o.id)

// usage_counters D'ABORD : aucune cle etrangere ne les emporterait.
const { error: cntErr, count: cntSupprimes } = await db
  .from('usage_counters')
  .delete({ count: 'exact' })
  .in('organization_id', ids)
if (cntErr) {
  console.error(`  ECHEC usage_counters : ${cntErr.message}`)
  console.error('  Les organisations n\'ont PAS ete supprimees : on ne laisse pas de compteurs orphelins derriere soi.')
  process.exit(1)
}
console.log(`    usage_counters supprimes : ${cntSupprimes ?? 0}`)

const { error: orgErr, count: orgSupprimees } = await db
  .from('organizations')
  .delete({ count: 'exact' })
  .in('id', ids)
if (orgErr) {
  console.error(`  ECHEC organizations : ${orgErr.message}`)
  process.exit(1)
}
console.log(`    organisations supprimees : ${orgSupprimees ?? 0}`)
console.log('\n  Termine.\n')
