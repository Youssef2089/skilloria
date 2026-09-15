// scripts/diag-siege-plateforme.mjs — LA PLATEFORME NE PEUT PLUS TOMBER A ZERO
// ADMINISTRATEUR, ET LA PURGE RGPD GARDE SON REFUS GRACIEUX.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   `/api/me/account/delete` comptait les autres administrateurs plateforme
//   disponibles, comparait, puis ecrivait `deletion_scheduled_at`. Deux
//   administrateurs qui programment leur suppression au meme instant lisaient
//   tous deux « il en reste un autre » et ecrivaient tous deux. C'etait le
//   dernier membre de la classe lire-puis-comparer-puis-ecrire.
//
//   CINQ PIEGES SE REFERMENT ICI.
//
//   PIEGE 1 — ECRIRE deletion_scheduled_at EN DIRECT.
//     Cela contourne le transfert du siege et ramene la course.
//
//   PIEGE 2 — PERDRE LA COLONNE GENEREE, OU LA RENDRE ECRIVABLE.
//     `admin_disponible` replie quatre conditions — dont deux NULLITES — en une
//     EGALITE. C'est la seule forme qu'une cle etrangere sait lire. Ecrite par
//     du code, elle serait falsifiable ; non STOCKEE, elle ne serait pas une
//     colonne de cle et l'argument de verrouillage tomberait.
//
//   PIEGE 3 — LA TABLE SINGLETON QUI CESSE D'ETRE SINGLETON.
//     Sans le CHECK sur la cle primaire booleenne, deux lignes pourraient
//     coexister et deux sieges avec elles.
//
//   PIEGE 4 — CASSER LE REFUS GRACIEUX DE LA PURGE.
//     La purge refuse deja d'anonymiser le dernier administrateur : elle
//     journalise, CONSERVE deletion_scheduled_at, et passe au suivant. Sans
//     liberation prealable du siege, la cle etrangere transformerait ce refus
//     en 23503 au milieu d'une boucle, sur un chemin RGPD irreversible.
//
//   PIEGE 5 — SUPPRIMER LA GARDE APPLICATIVE en croyant la base suffisante.
//     `countOtherAvailablePlatformAdmins` donne le refus PRECIS sans
//     aller-retour, et son fail-safe (`null` sur erreur) est ce qui protege la
//     purge quand le comptage est indisponible. La base ferme la COURSE ; elle
//     ne remplace pas ce fail-safe.
//
// CE QU'IL NE VERIFIE PAS — a dire honnetement
//   Il lit le CODE et le SQL, pas la base : il ne prouve pas qu'une transaction
//   concurrente est effectivement refusee en production. Il prouve que le
//   mecanisme est ecrit et branche.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-siege-plateforme.mjs   → controles statiques.
//                                              AUCUN acces base.
//
// LECTURE PURE : ce script n'ecrit JAMAIS, et ne joint jamais la base.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sqlCodeSeul } from './_sql-lecture.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Fins de ligne NORMALISEES — cf. les autres diagnostics du depot. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/** Retire les commentaires JS : ces fichiers citent les anti-patterns. */
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
 * Retire du SQL les `--` ET les `comment on … is …`. Ces derniers sont des
 * CHAINES, pas des commentaires : les garder ferait lire la prose qui DECRIT la
 * garantie plutot que la garantie. Source unique, cf. _sql-lecture.mjs.
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

console.log('=== diag-siege-plateforme — jamais zero administrateur plateforme ===')

// ───────────────────────────────────────────────────────────────────────────
section('A. LA GARANTIE EST DECLARATIVE, ET EN BASE')

const MIG_DIR = 'supabase/migrations'
const migFile = readdirSync(join(ROOT, MIG_DIR)).find((f) => f.endsWith('_siege_admin_plateforme.sql'))
ok(!!migFile, 'la migration du siege plateforme existe', `aucun fichier *_siege_admin_plateforme.sql dans ${MIG_DIR}/`)
if (!migFile) {
  console.log('\n✘ migration absente — controles suivants impossibles\n')
  process.exit(1)
}
const mig = sqlSansCommentaires(read(join(MIG_DIR, migFile)))
const migPlat = mig.replace(/\s+/g, ' ')

const ts = migFile.slice(0, 14)
ok(/^\d{14}$/.test(ts) && ts > '20260915200010', 'horodatage strictement superieur a la migration precedente', `lu : ${ts}`)

// A1 — PIEGE 2 : la colonne generee, STOCKEE, et portant les QUATRE conditions.
ok(
  /admin_disponible\s+boolean\s+generated\s+always\s+as\s*\([\s\S]*?\)\s*stored/i.test(migPlat),
  'users.admin_disponible est une colonne GENEREE et STOCKEE',
  'ecrite par du code elle serait falsifiable ; non stockee elle ne serait pas une colonne de cle, et l\'argument de verrouillage tomberait',
)
const expr = (migPlat.match(/admin_disponible\s+boolean\s+generated\s+always\s+as\s*\(([\s\S]*?)\)\s*stored/i) ?? [])[1] ?? ''
// LES QUATRE CONDITIONS, CAPTUREES EN ENTIER. En omettre une rendrait le siege
// attribuable a un compte suspendu, en grace, ou anonymise.
for (const [quoi, motif] of [
  ["user_type = 'admin'", /user_type\s*=\s*'admin'/i],
  ["status = 'active'", /status\s*=\s*'active'/i],
  ['deletion_scheduled_at is null', /deletion_scheduled_at\s+is\s+null/i],
  ['anonymized_at is null', /anonymized_at\s+is\s+null/i],
]) {
  ok(motif.test(expr), `admin_disponible exige ${quoi}`, `expression lue : ${expr.trim()}`)
}

// A2 — LA CLE REFERENCABLE, ordinaire : c'est elle qui fait d'admin_disponible
//      une COLONNE DE CLE.
ok(
  /unique\s*\(\s*id\s*,\s*admin_disponible\s*\)/i.test(migPlat),
  'contrainte UNIQUE (id, admin_disponible) sur users',
  'sans elle, la bascule de la colonne ne prend qu\'un verrou faible et n\'entre plus en conflit avec la verification de cle etrangere',
)
ok(
  !/unique\s*\(\s*id\s*,\s*admin_disponible\s*\)\s*where/i.test(migPlat),
  'cette contrainte n\'est ni partielle ni sur expression',
  'une contrainte partielle n\'est pas referencable par une cle etrangere',
)

// A3 — PIEGE 3 : la table singleton en est vraiment une.
ok(
  /ligne_unique\s+boolean\s+primary\s+key\s+default\s+true\s+check\s*\(\s*ligne_unique\s*\)/i.test(migPlat),
  'la table plateforme ne peut porter qu\'UNE ligne (cle primaire booleenne + CHECK)',
  'sans le CHECK, une seconde ligne a `false` coexisterait, et deux sieges avec elle',
)

// A4 — LA CLE ETRANGERE.
ok(
  /foreign\s+key\s*\(\s*siege_admin_user_id\s*,\s*siege_admin_disponible\s*\)\s*references\s+public\.users\s*\(\s*id\s*,\s*admin_disponible\s*\)/i.test(migPlat),
  'cle etrangere composite plateforme → users (id, admin_disponible)',
  '',
)
const fkSuite = (migPlat.match(/references public\.users \(\s*id\s*,\s*admin_disponible\s*\)([^;]*)/i) ?? [])[1] ?? ''
ok(
  !/on\s+delete\s+(cascade|set\s+null|set\s+default)/i.test(fkSuite),
  'la cle etrangere n\'est ni en CASCADE ni en SET NULL',
  'CASCADE ou SET NULL viderait le siege en silence — exactement l\'etat qu\'on interdit',
)

// A5 — la constante generee vaut NULL quand le siege est vacant : c'est ce qui
//      neutralise la cle (MATCH SIMPLE) sans exception ecrite nulle part.
ok(
  /case\s+when\s+siege_admin_user_id\s+is\s+null\s+then\s+null\s+else\s+true\s+end/i.test(migPlat),
  'le siege vacant neutralise la cle etrangere (constante a NULL)',
  'sinon la cle serait verifiee meme sans siege, et une plateforme sans administrateur serait GELEE',
)

// A6 — le cliquet, a l'UPDATE seulement, avec sa porte locale a la transaction.
ok(
  /create\s+trigger\s+plateforme_cliquet_siege\s+before\s+update\s+of\s+siege_admin_user_id\s+on\s+public\.plateforme/i.test(migPlat),
  'le cliquet est BEFORE UPDATE OF siege_admin_user_id, jamais sur DELETE',
  '',
)
const setConfigs = migPlat.match(/set_config\s*\(\s*'skilloria\.liberation_siege_plateforme'\s*,\s*'[^']*'\s*,\s*(true|false)\s*\)/gi) ?? []
ok(setConfigs.length >= 2, 'le drapeau de liberation est pose ET retire', `occurrences : ${setConfigs.length}`)
ok(
  setConfigs.length >= 2 && setConfigs.every((s) => /,\s*true\s*\)$/i.test(s)),
  'le drapeau est LOCAL A LA TRANSACTION',
  'un drapeau de session fuirait vers les appels suivants de la meme connexion : le cliquet cesserait de garder en silence',
)

// A7 — le trigger de pourvoi est AFTER : une colonne generee n'est pas calculee
//      dans NEW au moment d'un BEFORE.
ok(
  /create\s+trigger\s+users_pourvoir_siege_plateforme\s+after\s+insert\s+or\s+update/i.test(migPlat),
  'le pourvoi du siege est un trigger AFTER',
  'dans un trigger BEFORE, une colonne generee n\'est pas encore calculee : on lirait NULL et le siege ne serait jamais pourvu',
)

// A8 — le transfert se rattrape sur le candidat suivant.
ok(/exception\s+when\s+foreign_key_violation/i.test(mig), 'la collision concurrente est rattrapee (foreign_key_violation)', 'sans elle, la garantie remonterait en 500 au lieu d\'un refus propre')

// A9 — bornage.
for (const fn of ['liberer_siege_plateforme', 'programmer_suppression_compte']) {
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
}
for (const fn of ['liberer_siege_plateforme', 'programmer_suppression_compte', 'cliquet_siege_plateforme', 'pourvoir_siege_plateforme_si_vacant']) {
  ok(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}[\\s\\S]{0,900}?set\\s+search_path\\s+to\\s+'public'`, 'i').test(mig),
    `${fn} : search_path fige`,
  )
}

// ───────────────────────────────────────────────────────────────────────────
section('B. LES DEUX APPELANTS')

// B1 — PIEGE 1 : la programmation de suppression passe par la base.
const DELETE = 'app/api/me/account/delete/route.ts'
const del = sansCommentaires(read(DELETE))
ok(/rpc\(\s*'programmer_suppression_compte'/.test(del), `${DELETE} — passe par la RPC`, '')
// Plus aucune ecriture directe de deletion_scheduled_at sur `users`.
const ecrituresUsers = del.match(/from\(\s*'users'\s*\)\s*(?:\r?\n\s*)*\.update\(\s*\{([^}]*)\}/g) ?? []
ok(
  ecrituresUsers.every((e) => !/deletion_scheduled_at/.test(e)),
  `${DELETE} — n'ecrit plus deletion_scheduled_at en direct`,
  `trouvee(s) : ${ecrituresUsers.join(' | ')}`,
)
// Le refus de base remonte avec le MEME code que le refus applicatif.
const iRpc = del.indexOf("rpc(\n    'programmer_suppression_compte'")
const fenetre = del.slice(iRpc < 0 ? del.indexOf('programmer_suppression_compte') : iRpc, (iRpc < 0 ? del.indexOf('programmer_suppression_compte') : iRpc) + 1200)
ok(
  /'dernier_admin'/.test(fenetre) && /last_platform_admin/.test(fenetre),
  `${DELETE} — le refus de base remonte en 'last_platform_admin'`,
  'un « erreur technique » ne dirait pas a l\'administrateur qu\'il doit d\'abord en designer un autre',
)
// PIEGE 5 : la garde applicative reste.
ok(
  /countOtherAvailablePlatformAdmins\(\s*\w/.test(del),
  `${DELETE} — la garde applicative est conservee`,
  'elle donne le refus precis sans aller-retour, et son fail-safe protege la purge',
)

// B2 — PIEGE 4 : la purge libere le siege AVANT d'anonymiser, et garde son
//      refus gracieux.
const PURGE = 'app/api/cron/purge-deletions/route.ts'
const purge = sansCommentaires(read(PURGE))
ok(/rpc\(\s*\n?\s*'liberer_siege_plateforme'/.test(purge), `${PURGE} — libere le siege avant d'anonymiser`, 'sans cela, le refus gracieux deviendrait une erreur 23503 sur un chemin RGPD irreversible')
// L'echec de liberation doit rejoindre le chemin `blocked`, PAS le chemin
// `failed` : c'est la difference entre un refus trace et une panne.
const iLib = purge.indexOf('liberer_siege_plateforme')
const apresLib = purge.slice(iLib, iLib + 1200)
ok(
  /blocked\.push\(/.test(apresLib),
  `${PURGE} — un siege non liberable rejoint le chemin « blocked »`,
  'le chemin « failed » en ferait une panne : la demande de suppression doit rester valide et tracee',
)
ok(
  /deletion_scheduled_at_kept:\s*true/.test(purge),
  `${PURGE} — la demande de suppression reste CONSERVEE`,
  'on ne decide pas a la place de l\'utilisateur : la purge sera honoree des qu\'un autre administrateur existera',
)
// PIEGE 5, cote purge : le fail-safe inverse du comptage reste.
ok(
  /others === null/.test(purge),
  `${PURGE} — comptage indisponible ⇒ on ne purge pas (fail-safe inverse conserve)`,
  'purger a tort est definitif ; reporter au lendemain ne coute rien',
)

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTROLE(S) EN ECHEC\n`)
process.exit(failures === 0 ? 0 : 1)
