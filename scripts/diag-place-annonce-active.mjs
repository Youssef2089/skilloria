// scripts/diag-place-annonce-active.mjs — LE PLAFOND D'ANNONCES ACTIVES TIENT
// EN BASE, IL NE S'OUVRE PAS SUR UNE PANNE, ET UNE PLACE SE LIBERE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   La route de publication lisait un compteur d'annonces actives, le comparait
//   au plafond de l'offre, puis ecrivait. Deux publications simultanees lisaient
//   la meme valeur et passaient toutes les deux : une offre a 3 actives pouvait
//   en porter 4 — un droit payant donne gratuitement.
//
//   Et le comptage etait FAIL-OPEN : une erreur de lecture laissait publier. Un
//   plafond commercial qui s'ouvre quand la base tousse n'est pas un plafond.
//
//   TROIS PIEGES SE REFERMENT ICI, et ce script existe pour qu'aucun ne revienne.
//
//   PIEGE 1 — REVENIR A UN COMPTAGE EN MEMOIRE.
//     `count` + comparaison + ecriture, sous n'importe quelle forme, ramene la
//     course. La reservation doit passer par la base.
//
//   PIEGE 2 — REMETTRE LE FAIL-OPEN.
//     Un `console.warn` suivi d'un `else` qui continue, sur l'erreur de lecture,
//     rouvre le plafond a la premiere panne. Le controle exige un RETOUR.
//
//   PIEGE 3 — LE PLUS SUBTIL : RECOPIER LA REGLE D'EXPIRATION EN SQL.
//     « Actif » se derive a la lecture (lib/publications/expiry.ts) et n'est pas
//     appelable depuis la base. Une reservation posee sur `status='published'`
//     seul ne libererait JAMAIS une place expiree : l'organisation serait
//     bloquee a vie apres N annonces. Et une copie de la regle des 30 jours en
//     SQL divergerait un jour de celle de TypeScript, l'une ayant tort en
//     silence. La migration ne doit contenir NI l'une NI l'autre.
//
//     Ce n'est pas theorique : au moment d'ecrire, l'organisation f812aea7
//     porte 5 lignes `status='published'` pour un plafond de 2 — toutes
//     expirees, donc 0 active. Une reservation naive l'aurait bloquee des la
//     migration.
//
// CE QU'IL NE VERIFIE PAS — a dire honnetement
//   Il lit le CODE et le SQL, pas la base : il ne prouve pas qu'une transaction
//   concurrente est effectivement refusee en production. Il prouve que le
//   mecanisme qui le garantit est ecrit, et qu'aucune des trois regressions
//   ci-dessus n'est passee.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-place-annonce-active.mjs   → controles statiques.
//                                                  AUCUN acces base.
//
// LECTURE PURE : ce script n'ecrit JAMAIS, et ne joint jamais la base.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Fins de ligne NORMALISEES. Le depot sort les fichiers en CRLF : un controle
 * dont le motif traverse une fin de ligne ne matche jamais sur une copie
 * fraichement extraite, et le diagnostic vire au rouge sans qu'aucun code n'ait
 * change. Un diagnostic dont le resultat depend de la machine qui l'execute ne
 * dit pas si le code est juste : il dit d'ou il vient.
 */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/**
 * Retire les commentaires — LE POINT CENTRAL DE CE SCRIPT.
 *
 * Toute cette migration et toute cette route sont abondamment commentees, et
 * les commentaires CITENT les anti-patterns pour expliquer pourquoi ils sont
 * refuses (« pourquoi pas un CHECK sur un compteur », « status='published' »,
 * « fail-open »...). Un controle qui lirait le fichier brut trouverait chacun
 * de ces motifs dans la prose et se declarerait satisfait — ou paniquerait —
 * sur du texte. On lit le CODE.
 */
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')

/** Idem pour le SQL : `--` en debut de ligne. */
const sqlSansCommentaires = (src) =>
  src
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
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

console.log('=== diag-place-annonce-active — le plafond tient en base ===')

// ───────────────────────────────────────────────────────────────────────────
section('A. LA MIGRATION EXISTE, ET PORTE LA GARANTIE')

const MIG_DIR = 'supabase/migrations'
const migFile = readdirSync(join(ROOT, MIG_DIR)).find((f) =>
  f.endsWith('_place_annonce_active.sql'),
)
ok(!!migFile, 'la migration de la place d\'annonce active existe', `aucun fichier *_place_annonce_active.sql dans ${MIG_DIR}/`)

if (!migFile) {
  console.log('\n✘ migration absente — controles suivants impossibles\n')
  process.exit(1)
}

const migRaw = read(join(MIG_DIR, migFile))
const mig = sqlSansCommentaires(migRaw)

// A1 — l'horodatage respecte la plage imposee.
const ts = migFile.slice(0, 14)
ok(/^\d{14}$/.test(ts) && ts > '20260913200000', 'horodatage strictement superieur a 20260913200000', `lu : ${ts}`)

// A2 — LA garantie : un index UNIQUE, et PARTIEL.
//      Partiel n'est pas une finition : c'est ce qui rend le cas Illimite
//      structurel. Sans le `where`, une ligne a place NULL serait vue par
//      l'index et le NULL cesserait de vouloir dire « pas de place disputee ».
const idx = /create\s+unique\s+index[\s\S]*?on\s+public\.publications\s*\(\s*organization_id\s*,\s*place_active\s*\)\s*where\s+place_active\s+is\s+not\s+null/i
ok(idx.test(mig), 'index UNIQUE PARTIEL sur (organization_id, place_active)', 'sans index unique il n\'y a aucune garantie ; sans `where ... is not null` le cas Illimite casse')

// A3 — PIEGE 3, premiere moitie : la regle des 30 jours ne doit PAS etre en SQL.
const ttlSql = /interval\s*'?\s*30\s*(days?|jours?)|30\s*\*\s*24\s*\*\s*60|published_at\s*\+\s*interval/i
ok(!ttlSql.test(mig), 'la regle des 30 jours n\'est PAS recopiee en SQL', 'la derivation vit dans lib/publications/expiry.ts et n\'est pas appelable depuis la base ; deux copies divergeraient')

// A4 — PIEGE 3, seconde moitie : la reservation ne doit PAS se fonder sur
//      `status = 'published'`. Ce serait une SECONDE regle d'activite, muette,
//      et surtout elle ne libererait jamais une place expiree.
//      On interdit le LITTERAL, pas une comparaison precise : `status =
//      'published'` et `status <> 'published'` sont la MEME faute, et la
//      seconde echappait a un controle ecrit sur `=`. La migration n'a aucune
//      raison de nommer un statut de publication — si elle le fait, c'est
//      qu'une seconde regle d'activite s'y est glissee.
ok(!/'published'/i.test(mig), 'la migration ne nomme AUCUN statut de publication', 'une place expiree ne serait alors JAMAIS liberee : le plafond deviendrait un compteur a sens unique')

// A5 — la liberation existe, et elle est pilotee par la LISTE fournie.
ok(/p_ids_actives\s+uuid\[\]/i.test(mig), 'la fonction recoit la LISTE des annonces actives (uuid[])', 'c\'est le seul moyen de connaitre « actif » sans recopier la regle')
ok(
  /set\s+place_active\s*=\s*null[\s\S]{0,400}not\s*\(\s*p\.id\s*=\s*any\s*\(\s*p_ids_actives\s*\)\s*\)/i.test(mig),
  'toute annonce numerotee ABSENTE de la liste rend sa place',
  'c\'est ICI, et nulle part ailleurs, qu\'une place expiree ou cloturee redevient disponible',
)

// A6 — la liste ABSENTE (NULL) doit REFUSER, jamais etre lue comme « aucune
//      active ». Confondre les deux libererait tout et donnerait des places en
//      trop : c'est le seul sens d'erreur dangereux du mecanisme.
ok(
  /if\s+p_ids_actives\s+is\s+null\s+then\s+return\s+false\s*;/i.test(mig.replace(/\s+/g, ' ')),
  'liste d\'actives NULL ⇒ refus (jamais « aucune active »)',
  'sans ce garde-fou, un appelant sans liste libererait toutes les places',
)

// A7 — LE CAS ILLIMITE, par construction : plafond NULL ⇒ true SANS ecriture.
const illimite = /if\s+p_plafond\s+is\s+null\s+then\s+return\s+true\s*;/i
ok(illimite.test(mig.replace(/\s+/g, ' ')), 'plafond NULL ⇒ accepte sans attribuer de numero', 'a plafond illimite aucune ligne n\'est numerotee, donc l\'index partiel ne peut rien refuser')

// A8 — LE PLUS PETIT NUMERO LIBRE, pas max+1. Ici les trous sont la NORME
//      (une place liberee au milieu doit etre reutilisable). `max+1` apres une
//      liberation refuserait alors qu'il reste de la place.
ok(/generate_series\s*\(\s*1\s*,\s*p_plafond\s*\)/i.test(mig), 'attribution par le plus PETIT numero libre (generate_series)', 'avec `max + 1`, une place liberee au milieu serait perdue et le plafond redeviendrait un compteur a sens unique')
ok(!/max\s*\(\s*p?\.?place_active\s*\)/i.test(mig), 'aucun `max(place_active) + 1`', 'ne retrouverait pas les trous laisses par les places liberees')

// A9 — la collision concurrente se RATTRAPE sur le numero suivant, elle ne
//      produit pas un « plafond atteint » mensonger.
ok(/exception\s+when\s+unique_violation/i.test(mig), 'la collision concurrente est rattrapee (unique_violation)', 'sans elle, la garantie remonterait en 500 au lieu d\'un refus propre')

// A10 — PAS de CHECK sur un compteur : il GELERAIT la ligne.
ok(!/add\s+constraint[\s\S]{0,120}check[\s\S]{0,200}place_active/i.test(mig), 'aucun CHECK comparant un compteur a un plafond', 'un tel CHECK bloquerait toute mise a jour d\'une ligne devenue non conforme — on refuse une place en trop, on ne gele pas une ligne')

// A11 — les fonctions sont bornees au service_role, et leur search_path est fige.
for (const fn of ['reserver_place_annonce', 'liberer_place_annonce']) {
  ok(
    new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+to\\s+service_role`, 'i').test(mig),
    `${fn} : execute accorde a service_role`,
  )
  const revoke = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+from\\s+([^;]+);`, 'i')
  const m = mig.match(revoke)
  // LA LISTE ENTIERE, pas un prefixe. Un REVOKE qui ne nommerait que `public`
  // laisserait `authenticated` executer la fonction : la garantie serait
  // ouverte a tout compte connecte sans que rien ne bronche.
  const beneficiaires = m ? m[1].split(',').map((s) => s.trim().toLowerCase()) : []
  ok(
    ['public', 'anon', 'authenticated'].every((r) => beneficiaires.includes(r)),
    `${fn} : revoke couvre public, anon ET authenticated`,
    `beneficiaires revoques lus : [${beneficiaires.join(', ')}]`,
  )
  ok(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}[\\s\\S]{0,600}?set\\s+search_path\\s+to\\s+'public'`, 'i').test(mig),
    `${fn} : search_path fige`,
  )
}

// ───────────────────────────────────────────────────────────────────────────
section('B. LA ROUTE RESERVE EN BASE — ELLE NE COMPTE PLUS')

const ROUTE = 'app/api/publications/[id]/publish/route.ts'
const route = sansCommentaires(read(ROUTE))

// B1 — l'appel a la reservation existe.
ok(/rpc\(\s*'reserver_place_annonce'/.test(route), 'la route appelle reserver_place_annonce', 'sans RPC, la garantie de base n\'est jamais sollicitee')

// B2 — PIEGE 1 : plus aucun comptage en memoire du plafond d'actives.
//      Le `count: 'exact'` sur publications etait le coeur de la course.
ok(
  !/count:\s*'exact'[\s\S]{0,200}activePublishedOrClause/.test(route) &&
    !/activePublishedOrClause[\s\S]{0,200}count:\s*'exact'/.test(route),
  'plus de `count: exact` combine a la clause d\'activite',
  'lire un compteur puis comparer ramene exactement la course qu\'on ferme',
)
ok(!/activeCount/.test(route), 'la variable de comptage a disparu', 'sa presence signale un retour au lire-puis-comparer')

// B3 — la LISTE est bien calculee avec l'unique source, pas reconstruite.
ok(/activePublishedOrClause\(\)/.test(route), 'la liste des actives passe par activePublishedOrClause()', 'toute reconstruction du filtre ici ferait une seconde regle d\'activite')
ok(/p_ids_actives:/.test(route), 'la liste est transmise a la base', '')

// B4 — PIEGE 2 : FAIL-CLOSED. Une erreur de lecture ou de RPC doit RETOURNER.
//      On isole le bloc du plafond et on verifie que chaque branche d'erreur
//      contient un `return`, pas un simple warn suivi d'un `else`.
//      La fenetre s'arrete a `rendreLaPlace` : cette aide-la warn SANS return,
//      et c'est juste — rendre une place est best-effort, un echec y
//      SOUS-attribue (direction sure) et la prochaine reservation reprendra la
//      place de toute facon. L'englober ferait crier ce controle sur du code
//      correct, et un controle qui crie au loup finit par ne plus etre lu.
const blocPlafond = route.slice(
  route.indexOf('activePublicationsMax !== null'),
  route.indexOf('const rendreLaPlace'),
)
ok(blocPlafond.length > 200, 'bloc du plafond d\'actives localise', 'structure de la route modifiee — revoir ce controle')
const branchesErreur = blocPlafond.match(/if\s*\(\s*\w*[Ee]rr\w*\s*\)\s*\{[\s\S]*?\n\s{4}\}/g) ?? []
ok(branchesErreur.length >= 2, 'les deux erreurs (lecture, RPC) sont traitees', `branches trouvees : ${branchesErreur.length}`)
ok(
  branchesErreur.length >= 2 && branchesErreur.every((b) => /return\s+json\(/.test(b)),
  'CHAQUE branche d\'erreur REFUSE (return), aucune ne poursuit',
  'un warn sans return est precisement le fail-open qu\'on ferme : le plafond s\'ouvrirait a la premiere panne',
)
ok(
  !/fail-open/i.test(blocPlafond),
  'aucun fail-open residuel dans le bloc du plafond',
  '',
)

// B5 — le refus de panne est DISTINCT du refus de plafond. Dire « offre pleine »
//      quand on n'a pas pu compter ferait cloturer une annonce pour rien.
ok(
  /active_publications_check_failed/.test(blocPlafond) && /active_publications_limit_reached/.test(blocPlafond),
  'deux codes distincts : panne de verification vs plafond atteint',
  'un seul code confondrait une panne technique avec une limite d\'offre',
)

// B6 — LA PLACE EST RENDUE sur chaque chemin qui ne met PAS l'annonce en ligne.
//      Sans cela, un verdict `pending_review` ou un refus de quota mensuel
//      immobiliserait une place pour une annonce qui n'est pas active.
ok(/rpc\(\s*'liberer_place_annonce'/.test(route), 'la route sait rendre une place', '')
const cheminsRendus = [
  ['quota mensuel refuse', /quota_publications_reached/],
  ['verdict non publie', /verdict\.status\s*!==\s*'published'/],
  ['ecriture du statut en echec', /updateErr/],
]
for (const [label, motif] of cheminsRendus) {
  const i = route.search(motif)
  const fenetre = i < 0 ? '' : route.slice(Math.max(0, i - 400), i + 400)
  ok(i >= 0 && /rendreLaPlace\(/.test(fenetre), `place rendue — ${label}`, 'une place retenue par une annonce non active bloquerait l\'organisation')
}

// ───────────────────────────────────────────────────────────────────────────
section('C. LE REFUS EST ACTIONNABLE, DANS LES QUATRE LANGUES')

const LOCALES = ['fr', 'en', 'es', 'de']
const CLES = [
  ['publications.errors.active_publications_check_failed', ['publications', 'errors', 'active_publications_check_failed']],
  ['collaboration.errors.publish_check_failed', ['collaboration', 'errors', 'publish_check_failed']],
]
for (const [label, chemin] of CLES) {
  const textes = new Map()
  for (const loc of LOCALES) {
    const data = JSON.parse(read(`messages/${loc}.json`))
    let cur = data
    for (const seg of chemin) cur = cur?.[seg]
    textes.set(loc, typeof cur === 'string' ? cur : null)
  }
  ok([...textes.values()].every((v) => v && v.length > 0), `${label} — presente dans les 4 langues`, `manquante : ${LOCALES.filter((l) => !textes.get(l)).join(', ')}`)
  // ACTIONNABLE : le message doit dire quoi faire, pas seulement que ca a rate.
  // On exige un verbe de reprise dans chaque langue — un « une erreur est
  // survenue » ne passe pas ce controle.
  const reprise = { fr: /r[ée]essayez|contactez/i, en: /try again|contact/i, es: /int[ée]nt|contacta/i, de: /erneut|wenden/i }
  ok(
    LOCALES.every((l) => textes.get(l) && reprise[l].test(textes.get(l))),
    `${label} — chaque langue dit QUOI FAIRE`,
    'un message qui constate sans donner d\'issue est un message generique deguise',
  )
}

// C3 — la panne NE DOIT PAS etre classee comme une limite commerciale : le
//      bandeau ambre « passez a l'offre superieure » serait un mensonge.
const form = sansCommentaires(read('components/dashboard/PublicationForm.tsx'))
const limites = form.match(/LIMITES_COMMERCE\s*=\s*new\s+Set\(\[([^\]]*)\]\)/)
ok(
  !!limites && !limites[1].includes('active_publications_check_failed'),
  'la panne de verification n\'est PAS traitee comme une limite d\'offre',
  'l\'organisation se verrait proposer une montee en gamme pour une panne technique',
)

// ───────────────────────────────────────────────────────────────────────────
console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTROLE(S) EN ECHEC\n`)
process.exit(failures === 0 ? 0 : 1)
