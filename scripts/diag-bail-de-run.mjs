// scripts/diag-bail-de-run.mjs — AUCUNE TACHE PLANIFIEE NE TOURNE DEUX FOIS
// EN MEME TEMPS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Quatre routes vivent sous app/api/cron/ et une seule etait gardee. L'une
//   des trois autres portait exactement l'arithmetique du defaut deja corrige :
//       expert_relance_trigger   cadence */5 min   maxDuration 300 s
//   Toutes les cinq minutes, pour un run qui peut durer cinq minutes. Et
//   `prochaine_relance_expert` rendait LE MEME PROFIL aux deux runs.
//
//   Les deux purges sont quotidiennes, donc a l'abri de l'ordonnanceur — mais
//   pas du bouton « executer maintenant » du back-office, dont l'advisory lock
//   meurt avec la transaction alors que le run HTTP commence apres.
//
//   CE DIAG SURVEILLE LA CLASSE, PAS LES QUATRE ROUTES CONNUES. Il DECOUVRE les
//   routes sous app/api/cron/ : la cinquieme, celle qu'on ecrira dans six mois,
//   sera signalee le jour ou elle apparaitra sans bail.
//
//   CINQ PIEGES SE REFERMENT ICI.
//
//   PIEGE 1 — UNE ROUTE CRON SANS BAIL. C'est le defaut d'origine.
//
//   PIEGE 2 — UN DELAI DE GRACE SAISI A LA MAIN.
//     Il doit valoir au moins la duree maximale du run. Saisi separement, il
//     finira par ne plus correspondre a un `maxDuration` modifie — et le bail
//     se ferait doubler par un run encore vivant, en silence.
//
//   PIEGE 3 — OUBLIER DE RENDRE LE BAIL, OU LE RENDRE SUR UN SEUL CHEMIN.
//     Le delai de grace vaut deux fois maxDuration. Pour une tache cadencee
//     toutes les cinq minutes avec un run de 300 s, cela fait dix minutes : un
//     run termine en trois secondes bloquerait le tick suivant et la file se
//     viderait a moitie vitesse. La restitution doit etre dans un `finally`.
//
//   PIEGE 4 — UN BAIL FAIL-OPEN.
//     Si une erreur de prise laissait tourner, le bail ne servirait a rien le
//     jour ou il compte. Pour une tache PERIODIQUE, sauter un passage ne coute
//     rien.
//
//   PIEGE 5 — UN DRAPEAU « en cours » QU'IL FAUDRAIT BAISSER.
//     Un processus tue ne le baisse jamais : la tache resterait bloquee pour
//     toujours. La garantie doit reposer sur un DELAI qui expire seul.
//
// CE QU'IL NE VERIFIE PAS — a dire honnetement
//   Il lit le CODE et le SQL, pas la base : il ne prouve pas que deux appels
//   simultanes sont effectivement departages en production. Il prouve que le
//   mecanisme est ecrit et branche partout.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-bail-de-run.mjs   → controles statiques. AUCUN acces base.
//
// LECTURE PURE : ce script n'ecrit JAMAIS, et ne joint jamais la base.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sqlCodeSeul } from './_sql-lecture.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Fins de ligne NORMALISEES — cf. les autres diagnostics du depot. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/**
 * Retire les commentaires. Ces routes EXPLIQUENT longuement pourquoi le bail
 * est la, en citant ce qu'on refuse (« advisory », « fail-open »…). Un scan du
 * texte brut se declencherait sur de la prose. On lit le CODE.
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

console.log('=== diag-bail-de-run — au plus un run a la fois ===')

// ───────────────────────────────────────────────────────────────────────────
section('A. LE BAIL EST EN BASE, ET IL NE PEUT PAS SE COINCER')

const MIG_DIR = 'supabase/migrations'
const migFile = readdirSync(join(ROOT, MIG_DIR)).find((f) => f.endsWith('_bail_de_run_cron.sql'))
ok(!!migFile, 'la migration du bail de run existe', `aucun fichier *_bail_de_run_cron.sql dans ${MIG_DIR}/`)
if (!migFile) {
  console.log('\n✘ migration absente — controles suivants impossibles\n')
  process.exit(1)
}
const mig = sqlSansCommentaires(read(join(MIG_DIR, migFile)))
const migPlat = mig.replace(/\s+/g, ' ')

const ts = migFile.slice(0, 14)
ok(/^\d{14}$/.test(ts) && ts > '20260915200000', 'horodatage strictement superieur a la migration precedente', `lu : ${ts}`)

// A1 — LA PRISE EST UNE SEULE INSTRUCTION. C'est tout l'argument de
//      concurrence : pas de lecture separee de l'ecriture, donc pas de fenetre.
ok(
  /insert\s+into\s+public\.cron_run_leases[\s\S]*?on\s+conflict\s*\(\s*job_name\s*\)\s*do\s+update/i.test(migPlat),
  'la prise du bail est un `insert … on conflict do update` — une seule instruction',
  'une lecture suivie d\'une ecriture rouvrirait exactement la fenetre qu\'on ferme',
)
// Le `where` du DO UPDATE est ce qui REFUSE le second appel.
ok(
  /do\s+update[\s\S]{0,200}where[\s\S]{0,200}started_at\s*<\s*now\(\)\s*-\s*p_grace/i.test(migPlat),
  'le refus repose sur le delai de grace, reevalue sur la ligne verrouillee',
  'sans ce `where`, le second appel ecraserait le bail du premier',
)

// A2 — PIEGE 5 : le bail doit expirer SEUL. Une garantie qui repose sur une
//      restitution se coince des qu'un processus est tue.
ok(
  /p_grace\s+interval/i.test(migPlat),
  'le bail s\'appuie sur un DELAI, pas sur un drapeau a baisser',
  'un processus tue ne baisse jamais son drapeau : la tache resterait bloquee pour toujours',
)
// La restitution ne doit rien garantir : elle ne fait qu'accelerer.
ok(
  /create\s+or\s+replace\s+function\s+public\.rendre_bail_run/i.test(mig),
  'une restitution anticipee existe (pour la cadence, pas pour la garantie)',
  '',
)

// A3 — LA CLE PRIMAIRE sur job_name : c'est elle qui rend le conflit possible.
ok(
  /create\s+table\s+if\s+not\s+exists\s+public\.cron_run_leases\s*\(\s*job_name\s+text\s+primary\s+key/i.test(migPlat),
  'une seule ligne par tache (job_name en cle primaire)',
  'sans unicite, `on conflict` ne se declencherait jamais et deux baux coexisteraient',
)

// A4 — LA RELANCE : second etage, delai de grace + skip locked.
ok(
  /drop\s+function\s+if\s+exists\s+public\.prochaine_relance_expert\s*\(\s*interval\s*\)/i.test(migPlat),
  'l\'ancienne signature de prochaine_relance_expert est SUPPRIMEE, pas laissee a cote',
  'un `create or replace` avec un parametre de plus cree une SURCHARGE : la version sans garde resterait joignable',
)
const relance = migPlat.slice(migPlat.indexOf('create or replace function public.prochaine_relance_expert'))
ok(/for\s+update\s+skip\s+locked/i.test(relance), 'prochaine_relance_expert : for update skip locked', 'ferme la fenetre des appels rigoureusement simultanes')
ok(/<\s*now\(\)\s*-\s*p_grace/i.test(relance), 'prochaine_relance_expert : delai de grace', 'sans lui, deux runs recoivent le meme profil')
// `for update` est INTERDIT dans une fonction `stable` : le refus ne sortirait
// qu'a l'execution, invisible pour tsc et pour le build.
ok(
  /returns\s+uuid\s+language\s+sql\s+volatile/i.test(relance),
  'prochaine_relance_expert est VOLATILE (for update est interdit dans une fonction stable)',
  'le refus ne sortirait qu\'a l\'execution : ni tsc ni le build ne le verraient',
)

// A5 — bornage des deux fonctions.
for (const fn of ['prendre_bail_run', 'rendre_bail_run', 'prochaine_relance_expert']) {
  const m = mig.match(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+from\\s+([^;]+);`, 'i'))
  const beneficiaires = m ? m[1].split(',').map((s) => s.trim().toLowerCase()) : []
  ok(
    ['public', 'anon', 'authenticated'].every((r) => beneficiaires.includes(r)),
    `${fn} : revoke couvre public, anon ET authenticated`,
    `beneficiaires revoques lus : [${beneficiaires.join(', ')}]`,
  )
  ok(
    new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+to\\s+service_role`, 'i').test(mig),
    `${fn} : execute accorde a service_role`,
  )
  ok(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}[\\s\\S]{0,900}?set\\s+search_path\\s+to\\s+'public'`, 'i').test(mig),
    `${fn} : search_path fige`,
  )
}

// ───────────────────────────────────────────────────────────────────────────
section('B. LE DELAI SE DEDUIT DE maxDuration, IL NE SE SAISIT PAS')

// ⚠️ LE MÉCANISME A DÉMÉNAGÉ, ET CE CONTRÔLE AVEC LUI (§E.34).
//    Il vivait dans `lib/cron/bail-de-run.ts` ; le point 4 avait besoin du
//    MÊME verrou sur un EXPERT, et une seconde implémentation aurait été un
//    jumeau de VERROU — celui qui ne sert que sous concurrence, quand personne
//    ne regarde. `lib/bail.ts` porte désormais la seule implémentation, et le
//    module de cron DÉLÈGUE en gardant son nom et ses signatures.
//    On vérifie donc les deux : la garantie là où elle est, et la délégation
//    là où elle était.
const HELPER = 'lib/bail.ts'
const HELPER_CRON = 'lib/cron/bail-de-run.ts'
ok(existsSync(join(ROOT, HELPER)), `${HELPER} existe`, '')
const helper = sansCommentaires(read(HELPER))
const helperCron = sansCommentaires(read(HELPER_CRON))

// LA DÉLÉGATION : le module de cron ne réimplémente RIEN. S'il recommençait,
// le jumeau serait revenu par la porte que ce lot ferme.
ok(
  /from '@\/lib\/bail'/.test(helperCron),
  'le module de cron lit le mécanisme partagé',
  'deux implementations du meme verrou divergent sur la fenetre de grace, et rien ne le dit',
)
ok(
  !/\.rpc\(\s*'prendre_bail/.test(helperCron),
  '… et il n’appelle plus la base lui-même',
  'un second appelant de la RPC est un second endroit ou se tromper de parametres',
)
ok(
  /prendreBail\(/.test(helperCron) && /rendreBail\(/.test(helperCron),
  '… il délègue les deux gestes',
)
// PIEGE 2 : le delai doit etre CALCULE, pas passe en clair par l'appelant.
ok(
  /export\s+function\s+graceSecondes\s*\(\s*maxDurationSec\s*:\s*number\s*\)/.test(helper),
  'le delai de grace est DERIVE de maxDuration',
  'saisi separement, il finirait par ne plus correspondre a un maxDuration modifie',
)
ok(
  /Math\.max\(\s*60\s*,[\s\S]{0,60}\*\s*2\s*\)/.test(helper),
  'le delai vaut au moins le DOUBLE de la duree maximale du run',
  'un delai plus court laisserait doubler un run encore vivant',
)
// PIEGE 4 : la prise est fail-closed.
ok(
  /if\s*\(\s*error\s*\)\s*\{[\s\S]{0,260}return\s+'erreur'/.test(helper),
  'une erreur de prise rend `erreur`, jamais `pris`',
  'un bail fail-open ne sert a rien le jour ou il compte',
)
// La restitution ne doit JAMAIS faire echouer l'appelant : la garantie ne
// repose pas sur elle, le bail expire seul.
//
// ON LIT LE CORPS DE LA FONCTION, pas une distance entre deux chaines. Une
// premiere version de ce controle niait la proximite de `return 'erreur'` et de
// `rendreBailRun` — deux textes voisins par pure mise en page, qui ne disaient
// rien de ce qu'on voulait verifier. Il rougissait sur du code correct.
const iRendre = helper.indexOf('export async function rendreBail')
const corpsRendre = iRendre < 0 ? '' : helper.slice(iRendre, iRendre + 600)
ok(
  /export\s+async\s+function\s+rendreBail\s*\([\s\S]*?\)\s*:\s*Promise<void>/.test(corpsRendre),
  'la restitution ne rend RIEN a l\'appelant (Promise<void>)',
  'un resultat inviterait un jour quelqu\'un a en dependre',
)
ok(
  corpsRendre.length > 0 && !/\bthrow\b/.test(corpsRendre) && /console\.warn/.test(corpsRendre),
  'la restitution avertit, elle ne leve JAMAIS',
  'la garantie ne doit pas dependre de la restitution : le bail expire seul, un processus tue ne coince rien',
)

// ───────────────────────────────────────────────────────────────────────────
section('C. TOUTE ROUTE CRON PREND UN BAIL — decouvertes, pas listees')

const CRON_DIR = 'app/api/cron'
const routes = []
for (const e of readdirSync(join(ROOT, CRON_DIR))) {
  const p = `${CRON_DIR}/${e}/route.ts`
  if (existsSync(join(ROOT, p))) routes.push(p)
}
ok(routes.length > 0, `routes cron decouvertes : ${routes.length}`, `aucune route sous ${CRON_DIR}/`)

for (const r of routes) {
  const src = sansCommentaires(read(r))
  ok(/prendreBailRun\(/.test(src), `${r} — prend un bail de run`, 'une route cron sans bail peut tourner deux fois en meme temps')

  // PIEGE 2, cote appelant : le delai doit venir de maxDuration, pas d'un
  // nombre ecrit sur place.
  const appels = [...src.matchAll(/prendreBailRun\(([\s\S]{0,200}?)\)\s*\n/g)]
  ok(
    appels.length > 0 && appels.every((a) => /maxDurationSec:\s*maxDuration\b/.test(a[1])),
    `${r} — le delai vient de maxDuration, pas d'un nombre en dur`,
    appels.length ? `appel lu : ${appels[0][1].replace(/\s+/g, ' ').trim()}` : '',
  )
  // Et maxDuration doit etre DECLARE : sinon il n'y a rien a quoi s'adosser.
  ok(
    /export\s+const\s+maxDuration\s*=\s*\d+/.test(src),
    `${r} — maxDuration est declare explicitement`,
    'sans valeur, le delai s\'appuierait sur un defaut de plateforme invisible dans le code',
  )

  // PIEGE 3 : la restitution doit etre dans un `finally`, donc sur TOUS les
  // chemins. Une restitution posee sur le seul chemin nominal laisserait le
  // bail courir apres chaque erreur.
  ok(
    /\}\s*finally\s*\{[\s\S]{0,200}rendreBailRun\(/.test(src),
    `${r} — le bail est rendu dans un `.concat('`finally`'),
    'rendu sur le seul chemin nominal, il courrait encore apres chaque erreur — et pour une tache cadencee */5 avec dix minutes de grace, le tick suivant serait perdu',
  )

  // PIEGE 4, cote route : `occupe` n'est pas une erreur, `erreur` ne tourne pas.
  const iPrise = src.indexOf('prendreBailRun(')
  const fenetre = src.slice(iPrise, iPrise + 900)
  ok(
    /'occupe'/.test(fenetre) && /'erreur'/.test(fenetre),
    `${r} — distingue « occupe » (normal) de « erreur » (panne)`,
    'confondre les deux ferait crier la supervision a chaque chevauchement normal, ou avaler une panne',
  )
  ok(
    /=== 'erreur'\)\s*\{[\s\S]{0,320}return/.test(fenetre),
    `${r} — une erreur de bail ARRETE le run (fail-closed)`,
    'sauter un passage se rattrape ; tourner sans bail rouvre le chevauchement',
  )
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTROLE(S) EN ECHEC\n`)
process.exit(failures === 0 ? 0 : 1)
