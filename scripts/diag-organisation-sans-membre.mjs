// scripts/diag-organisation-sans-membre.mjs — UNE ORGANISATION NE PEUT PAS
// NAITRE SANS MEMBRE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Deux organisations de staging existent sans aucune ligne
//   organization_members, sans publication, sans lien d'ecosysteme. Le chemin
//   est etabli : `register-org` inserait l'organisation, PUIS le membre, PUIS
//   le domaine — trois allers-retours, aucune transaction. Le rattrapage de
//   l'epoque supprimait `public.users`, dont la CASCADE emportait le membre, et
//   laissait l'organisation.
//
//   Le rattrapage a ete corrige, mais il reste du code applicatif : une
//   fonction TUEE n'execute jamais son `catch`. Le vrai defaut n'etait pas ces
//   deux lignes — c'est qu'elles ont PU exister.
//
//   QUATRE PIEGES SE REFERMENT ICI.
//
//   PIEGE 1 — REVENIR A DEUX ECRITURES SEPAREES.
//     Un `.from('organizations').insert(...)` suivi d'un
//     `.from('organization_members').insert(...)` rouvre la fenetre, quelle que
//     soit la qualite du rattrapage qui suit.
//
//   PIEGE 2 — CROIRE QU'UN ROLLBACK APPLICATIF SUFFIT.
//     Il ne s'execute pas quand le processus meurt. C'est precisement le cas
//     qui a produit les deux lignes.
//
//   PIEGE 3 — ETENDRE LA CONTRAINTE AUX MISES A JOUR.
//     Elle GELERAIT les organisations deja orphelines : plus aucune ecriture
//     possible dessus. On refuse une naissance, on ne gele pas une ligne.
//
//   PIEGE 4 — AVALER LA VIOLATION D'UNICITE DANS LA RPC.
//     `ensure-personal-org` s'appuie dessus pour rattraper une course sur
//     l'organisation personnelle. Une RPC qui la masquerait ferait echouer ce
//     rattrapage sans que rien ne bronche.
//
// CE QU'IL NE VERIFIE PAS — a dire honnetement
//   Il lit le CODE et le SQL, pas la base : il ne prouve pas qu'une insertion
//   nue est effectivement refusee en production. Il prouve que le mecanisme qui
//   le garantit est ecrit, et qu'aucune des quatre regressions n'est passee.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-organisation-sans-membre.mjs   → controles statiques.
//                                                      AUCUN acces base.
//
// LECTURE PURE : ce script n'ecrit JAMAIS, et ne joint jamais la base.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sqlCodeSeul } from './_sql-lecture.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Fins de ligne NORMALISEES — cf. les autres diagnostics du depot. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/**
 * Retire les commentaires. Ces fichiers CITENT abondamment l'ancien code pour
 * expliquer pourquoi il est refuse — un scan du texte brut se declencherait sur
 * de la prose. On lit le CODE.
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

/**
 * Retire du SQL tout ce qui n'est PAS du code : les commentaires lexicaux `--`
 * ET les instructions `comment on … is …`.
 *
 * CES DERNIERES SONT DES CHAINES SQL, PAS DES COMMENTAIRES, et c'est ce qui a
 * failli passer inapercu : en mutant `for update skip locked` en `for update`,
 * un controle est reste VERT — il trouvait la chaine dans le TEXTE du
 * `comment on` juste en dessous, qui explique pourquoi la garde est la. Le code
 * avait perdu sa garde, la documentation disait encore qu'il l'avait, et le
 * diagnostic croyait la documentation.
 *
 * La regle du projet — lire LE CODE, pas les commentaires qui le decrivent —
 * etait prise en defaut par sa propre mise en oeuvre. Source unique dans
 * scripts/_sql-lecture.mjs, avec un filet qui refuse de rendre un texte tronque.
 */
const sqlSansCommentaires = sqlCodeSeul

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`)
  }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

console.log('=== diag-organisation-sans-membre — pas de naissance sans administrateur ===')

// ───────────────────────────────────────────────────────────────────────────
section('A. LA GARANTIE EST EN BASE')

const MIG_DIR = 'supabase/migrations'
const migFile = readdirSync(join(ROOT, MIG_DIR)).find((f) =>
  f.endsWith('_organisation_jamais_sans_membre.sql'),
)
ok(!!migFile, 'la migration existe', `aucun fichier *_organisation_jamais_sans_membre.sql dans ${MIG_DIR}/`)
if (!migFile) {
  console.log('\n✘ migration absente — controles suivants impossibles\n')
  process.exit(1)
}
const mig = sqlSansCommentaires(read(join(MIG_DIR, migFile)))
const migPlat = mig.replace(/\s+/g, ' ')

const ts = migFile.slice(0, 14)
ok(/^\d{14}$/.test(ts) && ts > '20260914200010', 'horodatage strictement superieur a la migration precedente', `lu : ${ts}`)

// A1 — LA RPC fait bien les DEUX ecritures. Une RPC qui n'insererait que
//      l'organisation ne serait qu'un deplacement du defaut.
ok(
  /insert\s+into\s+public\.organizations/i.test(mig) &&
    /insert\s+into\s+public\.organization_members/i.test(mig),
  'la RPC insere l\'organisation ET le membre',
  'une RPC qui n\'inserait que l\'organisation deplacerait le defaut sans le fermer',
)
ok(
  /role_in_org[\s\S]{0,80}'admin'/i.test(migPlat) && /'active'/i.test(migPlat),
  'le membre cree est ADMIN et ACTIF',
  'un membre viewer ne pourvoirait pas le siege : l\'organisation naitrait non administrable',
)

// A2 — PIEGE 4 : aucune exception avalee. `ensure-personal-org` s'appuie sur la
//      remontee de la violation d'unicite pour rattraper une course.
const corpsRpc = migPlat.slice(
  migPlat.indexOf('creer_organisation_avec_admin'),
  migPlat.indexOf('exiger_siege_a_la_naissance'),
)
ok(
  corpsRpc.length > 200 && !/exception\s+when/i.test(corpsRpc),
  'la RPC de creation n\'avale AUCUNE exception',
  'ensure-personal-org rattrape une course sur la violation d\'unicite : la masquer casserait ce rattrapage en silence',
)

// A3 — LA CONTRAINTE : differee, et a l'INSERT SEULEMENT.
ok(
  /create\s+constraint\s+trigger\s+organizations_exiger_siege_naissance\s+after\s+insert\s+on\s+public\.organizations\s+deferrable\s+initially\s+deferred/i.test(migPlat),
  'contrainte DIFFEREE, declenchee APRES INSERT uniquement',
  'sans `deferrable`, le controle tomberait avant que le membre puisse exister ; sans `after insert` seul, il gelerait les lignes existantes',
)
// PIEGE 3, explicitement : pas d'`update` dans l'evenement du trigger.
ok(
  !/create\s+constraint\s+trigger\s+organizations_exiger_siege_naissance[^;]*\bupdate\b/i.test(migPlat),
  'la contrainte NE s\'applique PAS aux mises a jour',
  'elle gelerait les organisations deja orphelines : plus aucune ecriture possible dessus',
)

// A4 — le controle RELIT la ligne. `new` porte l'etat de l'INSERT, ou le siege
//      est forcement vide : s'y fier refuserait TOUTE creation.
ok(
  /select\s+o\.siege_admin_membre_id[\s\S]{0,200}from\s+public\.organizations\s+o\s+where\s+o\.id\s*=\s*new\.id/i.test(migPlat),
  'le controle RELIT la ligne au commit, il ne lit pas `new`',
  '`new` porte l\'etat de l\'INSERT, ou le siege est forcement vide : s\'y fier refuserait toute creation',
)
// Ligne creee puis supprimee dans la meme transaction : rien a exiger.
ok(
  /if\s+not\s+v_trouve\s+then\s+return\s+null/i.test(migPlat),
  'une organisation creee PUIS supprimee dans la meme transaction ne declenche rien',
  'sinon un rollback applicatif qui a eu le temps de tourner ferait echouer le commit',
)

// A5 — bornage.
const m = mig.match(/revoke\s+all\s+on\s+function\s+public\.creer_organisation_avec_admin\s*\([^)]*\)\s+from\s+([^;]+);/i)
const beneficiaires = m ? m[1].split(',').map((s) => s.trim().toLowerCase()) : []
ok(
  ['public', 'anon', 'authenticated'].every((r) => beneficiaires.includes(r)),
  'creer_organisation_avec_admin : revoke couvre public, anon ET authenticated',
  `beneficiaires revoques lus : [${beneficiaires.join(', ')}]`,
)
ok(
  /grant\s+execute\s+on\s+function\s+public\.creer_organisation_avec_admin\s*\([^)]*\)\s+to\s+service_role/i.test(mig),
  'creer_organisation_avec_admin : execute accorde a service_role',
)
for (const fn of ['creer_organisation_avec_admin', 'exiger_siege_a_la_naissance']) {
  ok(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}[\\s\\S]{0,1600}?set\\s+search_path\\s+to\\s+'public'`, 'i').test(mig),
    `${fn} : search_path fige`,
  )
}

// ───────────────────────────────────────────────────────────────────────────
section('B. PLUS AUCUN CHEMIN N\'INSERE UNE ORGANISATION NUE')

// On balaye app/ ET lib/ — pas seulement les deux fichiers connus. Un troisieme
// chemin de creation est exactement ce qu'on veut voir arriver.
const fichiers = []
const parcourir = (d) => {
  for (const e of readdirSync(join(ROOT, d))) {
    if (e === 'node_modules' || e === '.next') continue
    const rel = `${d}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
    else if (/\.tsx?$/.test(e)) fichiers.push(rel)
  }
}
parcourir('app')
parcourir('lib')

const inserts = []
for (const f of fichiers) {
  const src = sansCommentaires(read(f))
  if (/\.from\(\s*'organizations'\s*\)\s*(?:\r?\n\s*)*\.insert\(/.test(src)) inserts.push(f)
}
ok(
  inserts.length === 0,
  'aucun insert direct dans `organizations` dans app/ ni lib/',
  inserts.length
    ? `chemins fautifs : ${inserts.join(', ')}\n       Toute creation doit passer par creer_organisation_avec_admin, sinon la\n       contrainte differee refusera le commit — et l'utilisateur lira une\n       erreur technique au lieu d'etre inscrit.`
    : '',
)

// B2 — les deux chemins connus appellent bien la RPC.
const CHEMINS = ['app/api/auth/register-org/route.ts', 'lib/collaboration/ensure-personal-org.ts']
for (const f of CHEMINS) {
  const src = sansCommentaires(read(f))
  ok(/rpc\(\s*'creer_organisation_avec_admin'/.test(src), `${f} — passe par la RPC transactionnelle`, '')
  // PIEGE 1 : plus d'insertion separee du membre juste apres.
  ok(
    !/\.from\(\s*'organization_members'\s*\)\s*(?:\r?\n\s*)*\.insert\(/.test(src),
    `${f} — n'insere plus le membre separement`,
    'une insertion separee rouvre la fenetre entre l\'organisation et son membre',
  )
}

// B3 — `ensure-personal-org` doit CONSERVER son rattrapage de course.
const ensure = sansCommentaires(read('lib/collaboration/ensure-personal-org.ts'))
const iRpc = ensure.indexOf("rpc(\n      'creer_organisation_avec_admin'")
const iRpcAlt = ensure.indexOf("'creer_organisation_avec_admin'")
const fenetre = ensure.slice(Math.max(0, (iRpc >= 0 ? iRpc : iRpcAlt)), (iRpc >= 0 ? iRpc : iRpcAlt) + 1600)
ok(
  /isUniqueViolation\(/.test(fenetre) && /findPersonalOrg\(/.test(fenetre),
  'ensure-personal-org — le rattrapage de course sur l\'organisation personnelle est conserve',
  'sans lui, deux appels simultanes feraient echouer le second au lieu de lui rendre l\'organisation existante',
)

// ───────────────────────────────────────────────────────────────────────────
section('C. LE SCRIPT DE NETTOYAGE NE CITE AUCUN IDENTIFIANT')

const NETTOYAGE = 'scripts/admin-organisations-orphelines.mjs'
let net = null
try { net = read(NETTOYAGE) } catch { /* absent */ }
ok(!!net, `${NETTOYAGE} existe`, 'le nettoyage des organisations orphelines doit etre un script d\'administration, pas une migration')
if (net) {
  const code = sansCommentaires(net)
  // Un script qui cite des UUID de staging ne veut rien dire en production.
  const uuids = code.match(/['"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]/gi) ?? []
  ok(uuids.length === 0, 'il DECOUVRE les organisations, il n\'en cite aucune', `identifiants en dur : ${uuids.join(', ')}`)
  ok(/exigerAutorisationEcriture\(/.test(code), 'il passe par la garde d\'ecriture du depot', 'un script qui supprime ne doit pas pouvoir partir sans drapeau explicite')
  // Le drapeau de suppression doit etre DISTINCT du drapeau de lecture base :
  // `--db` ouvre l'acces, il ne doit pas suffire a supprimer.
  //
  // ON LIT LE SITE DE DECISION, PAS LA PRESENCE DE LA CHAINE. Un controle ecrit
  // `/--supprimer/.test(code)` restait VERT apres avoir remplace la condition
  // par `includes('--db')` : le mot survivait dans le message d'aide et dans
  // les drapeaux passes a la garde. Verifier une presence quelque part ne
  // verifie rien — trouve en mutant.
  const decision = code.match(/const\s+SUPPRIMER\s*=\s*([^\n]+)/)
  ok(!!decision, 'la decision de supprimer est portee par une constante nommee SUPPRIMER', '')
  ok(
    !!decision && /'--supprimer'/.test(decision[1]) && !/'--db'/.test(decision[1]),
    'la suppression exige un drapeau PROPRE, distinct de --db',
    decision
      ? `condition lue : ${decision[1].trim()}\n       « --db » sert a joindre la base en lecture : s'il suffisait a supprimer,\n       lister et detruire auraient le meme visage.`
      : '',
  )
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTROLE(S) EN ECHEC\n`)
process.exit(failures === 0 ? 0 : 1)
