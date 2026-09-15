// scripts/diag-siege-administrateur.mjs — UNE ORGANISATION NE PEUT PLUS TOMBER
// A ZERO ADMINISTRATEUR, ET LA GARANTIE NE REND RIEN INDESTRUCTIBLE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Trois routes retirent un administrateur — changement de role, retrait d'un
//   membre, depart volontaire — et toutes les trois comptaient les admins
//   actifs, comparaient a 1, puis ecrivaient. Deux administrateurs qui se
//   retrogradent au meme instant lisaient tous deux « il en reste 2 » et
//   ecrivaient tous deux : l'organisation tombait a ZERO administrateur.
//
//   Consequence : plus aucune invitation, plus aucune gestion de membres, plus
//   aucun changement d'offre. Aucun ecran ne permet d'en sortir.
//
//   QUATRE PIEGES SE REFERMENT ICI.
//
//   PIEGE 1 — ECRIRE DIRECTEMENT SUR organization_members.
//     Un `.update({ role_in_org })` ou `.update({ status })` hors RPC contourne
//     la garantie. La course revient, sans bruit.
//
//   PIEGE 2 — CROIRE QU'UN TRIGGER QUI RECOMPTE SUFFIT.
//     Il ne voit que ce qui est COMMITE : sous deux transactions simultanees,
//     aucune ne voit l'autre et les deux passent.
//
//   PIEGE 3 — RENDRE L'ORGANISATION INDESTRUCTIBLE.
//     Une cle etrangere en CASCADE ou RESTRICT mal choisie, ou un cliquet qui
//     s'applique aussi a la suppression, bloquerait la suppression d'une
//     organisation entiere — chemin reel (rollback d'inscription, nettoyage des
//     organisations fantomes).
//
//   PIEGE 4 — FERMER LA PORTE DU DEPANNAGE PLATEFORME.
//     /api/admin/user-org-role peut DELIBEREMENT laisser une organisation sans
//     administrateur (`force: true`, sous re-authentification, avec audit).
//     C'est le SEUL outil qui repare une organisation deja bloquee. Une
//     garantie qui le casserait rendrait le probleme irreparable.
//
// CE QU'IL NE VERIFIE PAS — a dire honnetement
//   Il lit le CODE et le SQL, pas la base : il ne prouve pas qu'une transaction
//   concurrente est effectivement refusee en production. Il prouve que le
//   mecanisme qui le garantit est ecrit, et qu'aucune des quatre regressions
//   ci-dessus n'est passee.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-siege-administrateur.mjs   → controles statiques.
//                                                  AUCUN acces base.
//
// LECTURE PURE : ce script n'ecrit JAMAIS, et ne joint jamais la base.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sqlCodeSeul } from './_sql-lecture.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Fins de ligne NORMALISEES — cf. diag-org-lockout.mjs. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/**
 * Retire les commentaires — LE POINT CENTRAL DE CE SCRIPT.
 *
 * La migration et les routes CITENT abondamment les anti-patterns pour
 * expliquer pourquoi ils sont refuses (« pourquoi pas un trigger qui recompte »,
 * « on delete cascade », « force »...). Un controle qui lirait le fichier brut
 * se satisferait — ou paniquerait — sur de la prose. On lit le CODE.
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

console.log('=== diag-siege-administrateur — jamais zero administrateur ===')

// ───────────────────────────────────────────────────────────────────────────
section('A. LA GARANTIE EST DECLARATIVE, ET EN BASE')

const MIG_DIR = 'supabase/migrations'
const migFile = readdirSync(join(ROOT, MIG_DIR)).find((f) => f.endsWith('_siege_administrateur.sql'))
ok(!!migFile, 'la migration du siege d\'administrateur existe', `aucun fichier *_siege_administrateur.sql dans ${MIG_DIR}/`)
if (!migFile) {
  console.log('\n✘ migration absente — controles suivants impossibles\n')
  process.exit(1)
}

const mig = sqlSansCommentaires(read(join(MIG_DIR, migFile)))
const migPlat = mig.replace(/\s+/g, ' ')

const ts = migFile.slice(0, 14)
ok(/^\d{14}$/.test(ts) && ts > '20260913200000', 'horodatage strictement superieur a 20260913200000', `lu : ${ts}`)

// A1 — LA CLE REFERENCABLE. Sans elle, `role_in_org` et `status` ne sont pas
//      des colonnes de cle, les mises a jour ne prennent qu'un verrou faible, et
//      la verification de cle etrangere ne bloque plus rien : la garantie
//      deviendrait une formalite que deux transactions peuvent contourner.
ok(
  /unique\s*\(\s*id\s*,\s*organization_id\s*,\s*role_in_org\s*,\s*status\s*\)/i.test(mig),
  'contrainte UNIQUE (id, organization_id, role_in_org, status) sur les membres',
  'c\'est elle qui fait de role_in_org et status des COLONNES DE CLE — sans quoi une mise a jour ne prend qu\'un verrou faible et n\'entre plus en conflit avec la verification de cle etrangere',
)
// Elle doit etre ORDINAIRE : une contrainte partielle ou sur expression n'est
// pas referencable par une cle etrangere, et PostgreSQL cesserait de traiter ses
// colonnes comme des colonnes de cle. Tout l'argument de concurrence tomberait.
ok(
  !/unique\s*\(\s*id\s*,\s*organization_id\s*,\s*role_in_org\s*,\s*status\s*\)\s*where/i.test(mig),
  'cette contrainte n\'est ni partielle ni sur expression',
  'une contrainte partielle n\'est pas referencable par une cle etrangere : ses colonnes cesseraient d\'etre des colonnes de cle',
)

// A2 — LA CLE ETRANGERE COMPOSITE, avec les QUATRE colonnes.
//      `organizations.id` en troisieme position est ce qui interdit de designer
//      un administrateur d'une AUTRE organisation.
ok(
  /foreign\s+key\s*\(\s*siege_admin_membre_id\s*,\s*id\s*,\s*siege_admin_role\s*,\s*siege_admin_statut\s*\)\s*references\s+public\.organization_members\s*\(\s*id\s*,\s*organization_id\s*,\s*role_in_org\s*,\s*status\s*\)/i.test(migPlat),
  'cle etrangere composite a QUATRE colonnes, dont organizations.id',
  'sans `id` dans la cle, le siege pourrait designer un administrateur d\'une AUTRE organisation : les admins de la sienne seraient tous retrogradables',
)

// A3 — LES CONSTANTES SONT GENEREES, jamais ecrites par du code.
for (const col of ['siege_admin_role', 'siege_admin_statut']) {
  ok(
    new RegExp(`${col}[^;]*generated\\s+always\\s+as`, 'i').test(migPlat),
    `${col} est une colonne GENEREE`,
    'une colonne ecrite par du code pourrait etre falsifiee, et le siege designer un non-administrateur',
  )
}
// Et elles doivent valoir NULL quand le siege est vacant : c'est ce qui
// neutralise la cle etrangere (MATCH SIMPLE) sans exception ecrite nulle part.
ok(
  (migPlat.match(/case when siege_admin_membre_id is null then null else/gi) ?? []).length >= 2,
  'les deux constantes valent NULL quand le siege est vacant',
  'sinon la cle etrangere serait verifiee meme sans siege, et une organisation sans administrateur serait GELEE',
)

// A4 — PIEGE 2 : aucun recomptage.
ok(
  !/count\s*\(\s*\*?\s*\)[^;]{0,200}role_in_org\s*=\s*'admin'/i.test(migPlat),
  'aucun trigger qui RECOMPTE les administrateurs',
  'un recomptage ne voit que ce qui est commite : deux transactions simultanees passeraient toutes les deux',
)

// A5 — PIEGE 3 : la cle etrangere ne doit etre NI en cascade NI en restrict.
//      NO ACTION (le defaut) laisse passer la suppression d'une organisation
//      entiere : la verification, declenchee par la cascade sur les membres, ne
//      trouve plus l'organisation qui les referencait.
const fkBloc = migPlat.match(/foreign key \(\s*siege_admin_membre_id[\s\S]*?references public\.organization_members\s*\([^)]*\)([^;]*)/i)
const fkSuite = fkBloc ? fkBloc[1] : ''
ok(
  !/on\s+delete\s+(cascade|restrict|set\s+null|set\s+default)/i.test(fkSuite),
  'la cle etrangere reste en ON DELETE NO ACTION (defaut)',
  'CASCADE supprimerait l\'organisation avec un membre ; RESTRICT bloquerait la suppression d\'une organisation entiere ; SET NULL declencherait le cliquet',
)
ok(
  !/on\s+update\s+(cascade|set\s+null|set\s+default)/i.test(fkSuite),
  'la cle etrangere reste en ON UPDATE NO ACTION (defaut)',
  'ON UPDATE CASCADE propagerait la retrogradation au lieu de la refuser : la garantie disparaitrait',
)

// A6 — LE CLIQUET ne doit s'appliquer QU'A UPDATE. Un cliquet sur DELETE
//      rendrait l'organisation indestructible.
ok(
  /create\s+trigger\s+organizations_cliquet_siege_admin\s+before\s+update\s+of\s+siege_admin_membre_id\s+on\s+public\.organizations/i.test(migPlat),
  'le cliquet est BEFORE UPDATE OF siege_admin_membre_id, jamais sur DELETE',
  'un cliquet declenche sur DELETE rendrait toute organisation indestructible',
)

// A7 — PIEGE 4 : LA PORTE DU DEPANNAGE. Elle doit exister, et etre unique.
ok(/p_forcer\s+boolean/i.test(migPlat), 'la RPC expose une porte explicite (p_forcer)', 'sans elle, le depannage plateforme casse et une organisation bloquee devient irreparable')
// Le drapeau du cliquet doit etre LOCAL A LA TRANSACTION (3e argument `true`),
// sinon il fuirait vers les appels suivants de la meme connexion et le cliquet
// cesserait de garder — sans que rien ne bronche.
const setConfigs = migPlat.match(/set_config\s*\(\s*'skilloria\.liberation_siege_admin'\s*,\s*'[^']*'\s*,\s*(true|false)\s*\)/gi) ?? []
ok(setConfigs.length >= 2, 'le drapeau de liberation est pose ET retire', `occurrences : ${setConfigs.length}`)
ok(
  setConfigs.length >= 2 && setConfigs.every((s) => /,\s*true\s*\)$/i.test(s)),
  'le drapeau est LOCAL A LA TRANSACTION',
  'un drapeau de session fuirait vers les appels suivants de la meme connexion : le cliquet cesserait de garder en silence',
)

// A8 — le transfert se rattrape sur le candidat suivant : un candidat
//      retrograde au meme instant ne doit pas produire un « dernier
//      administrateur » mensonger alors qu'il en reste d'autres.
ok(/exception\s+when\s+foreign_key_violation/i.test(mig), 'la collision concurrente est rattrapee (foreign_key_violation)', 'sans elle, la garantie remonterait en 500 au lieu d\'un refus propre')

// A9 — bornage : service_role seul, search_path fige, et la LISTE ENTIERE des
//      beneficiaires revoques — pas un prefixe.
for (const fn of ['maj_membre_organisation']) {
  ok(
    new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+to\\s+service_role`, 'i').test(mig),
    `${fn} : execute accorde a service_role`,
  )
  const m = mig.match(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+from\\s+([^;]+);`, 'i'))
  const beneficiaires = m ? m[1].split(',').map((s) => s.trim().toLowerCase()) : []
  ok(
    ['public', 'anon', 'authenticated'].every((r) => beneficiaires.includes(r)),
    `${fn} : revoke couvre public, anon ET authenticated`,
    `beneficiaires revoques lus : [${beneficiaires.join(', ')}] — un revoke qui ne nomme que 'public' laisse 'authenticated' executer la fonction`,
  )
}
for (const fn of ['maj_membre_organisation', 'cliquet_siege_admin', 'pourvoir_siege_admin_si_vacant']) {
  ok(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}[\\s\\S]{0,800}?set\\s+search_path\\s+to\\s+'public'`, 'i').test(mig),
    `${fn} : search_path fige`,
  )
}

// A10 — le backfill ne doit RIEN exiger : une organisation deja sans
//       administrateur garde un siege vacant, et n'est ni geleee ni reparee.
ok(
  /update\s+public\.organizations[\s\S]{0,600}?siege_admin_membre_id\s+is\s+null/i.test(mig),
  'le backfill ne pourvoit QUE les sieges vacants',
  '',
)
ok(
  !/alter\s+table\s+public\.organizations[^;]*siege_admin_membre_id[^;]*set\s+not\s+null/i.test(migPlat),
  'le siege n\'est PAS declare NOT NULL',
  'les organisations deja sans administrateur feraient echouer la migration, et une organisation ne pourrait plus etre creee avant son premier membre',
)

// ───────────────────────────────────────────────────────────────────────────
section('B. PLUS AUCUNE ROUTE N\'ECRIT LE ROLE OU LE STATUT EN DIRECT')

const ROUTES = [
  'app/api/me/organisation/members/[id]/route.ts',
  'app/api/me/organisation/leave/route.ts',
  'app/api/admin/user-org-role/route.ts',
]
for (const r of ROUTES) {
  const src = sansCommentaires(read(r))
  // PIEGE 1 : une ecriture directe sur organization_members contournerait la
  // garantie. On cherche l'ecriture, pas le nom de la table : les LECTURES
  // restent legitimes et nombreuses.
  const ecrituresDirectes =
    src.match(/from\('organization_members'\)\s*\.update\(\s*\{([^}]*)\}/g) ?? []
  const fautives = ecrituresDirectes.filter((e) => /role_in_org|status/.test(e))
  ok(
    fautives.length === 0,
    `${r} — aucune ecriture directe du role ou du statut`,
    fautives.length ? `trouvee(s) : ${fautives.join(' | ')}` : '',
  )
  const appels = [...src.matchAll(/majMembreOrganisation\(/g)]
  ok(appels.length > 0, `${r} — passe par majMembreOrganisation`, '')

  // Le refus reste NOMME : `dernier_admin` doit remonter en `last_admin`, pas
  // se fondre dans un `db_error` generique.
  //
  // PAR SITE D'APPEL, pas par fichier. Un controle qui cherchait 'dernier_admin'
  // n'importe ou dans le fichier se satisfaisait d'une seule occurrence : une
  // route a deux verbes (PATCH et DELETE) pouvait perdre son refus nomme dans
  // l'un des deux et rester verte. Verifie en mutant, et corrige.
  for (const [i, m] of appels.entries()) {
    const fenetre = src.slice(m.index, m.index + 700)
    ok(
      /['"]dernier_admin['"]/.test(fenetre) && /last_admin/.test(fenetre),
      `${r} — appel ${i + 1}/${appels.length} : le refus remonte en 'last_admin'`,
      'un « erreur technique » ne dirait pas a l\'organisation de designer un autre administrateur',
    )
  }
}

// B2 — LA GARDE APPLICATIVE RESTE. Elle pose une question que la base ne peut
//      pas poser : le COMPTE derriere la ligne est-il encore joignable ? Une
//      purge RGPD laisse la ligne intacte a dessein. Supprimer cet etage en
//      croyant la base suffisante rouvrirait le lock-out silencieux que le lot
//      precedent a ferme.
for (const r of ROUTES) {
  const src = sansCommentaires(read(r))
  // UN APPEL PAR SITE D'ECRITURE, pas un `import` orphelin. Un controle qui se
  // contentait de trouver le mot dans le fichier restait vert alors que seule
  // la ligne d'import survivait — verifie en mutant.
  const gardes = (src.match(/countActiveAdmins\(\s*\w/g) ?? []).length
  const ecritures = (src.match(/majMembreOrganisation\(/g) ?? []).length
  ok(
    gardes >= ecritures,
    `${r} — la garde applicative (compte joignable) couvre chaque ecriture (${gardes}/${ecritures})`,
    'la base ne voit que la LIGNE, pas le COMPTE : un admin purge laisse sa ligne admin/active intacte',
  )
}

// B3 — PIEGE 4, cote route : la porte ne doit s'ouvrir QUE sur le bypass
//      explicite deja trace. Un `forcer: true` inconditionnel ferait de la
//      route de depannage un contournement permanent.
const adminSrc = sansCommentaires(read('app/api/admin/user-org-role/route.ts'))
ok(
  /forcer:\s*lastAdminBypassed/.test(adminSrc),
  'le depannage plateforme force UNIQUEMENT via le bypass deja trace',
  'un `forcer: true` inconditionnel ouvrirait la porte en permanence',
)
ok(
  !/forcer:\s*true/.test(adminSrc),
  'aucun `forcer: true` en dur',
  '',
)
// Et les deux autres routes ne doivent JAMAIS forcer.
for (const r of ROUTES.slice(0, 2)) {
  ok(!/forcer:/.test(sansCommentaires(read(r))), `${r} — ne force jamais`, 'seules les routes de depannage plateforme ont le droit de laisser une organisation sans administrateur')
}

// ───────────────────────────────────────────────────────────────────────────
section('C. LES CAS A NE PAS CASSER')

// C1 — SUPPRESSION D'UNE ORGANISATION ENTIERE. On verifie que la cascade
//      membres→organisation existe toujours et que rien ne l'a remplacee : c'est
//      elle qui rend la suppression possible malgre la nouvelle cle etrangere.
const baseline = sqlSansCommentaires(read('supabase/migrations/00000000000000_baseline.sql'))
ok(
  /organization_members_organization_id_fkey[\s\S]{0,200}on\s+delete\s+cascade/i.test(baseline),
  'les membres sont toujours emportes en cascade par la suppression de l\'organisation',
  '',
)

// C2 — DEPART DU DERNIER MEMBRE. Le retrait doit rester SOFT : une suppression
//      physique de ligne se heurterait a la cle etrangere si l'interesse occupe
//      le siege, et le refus serait technique au lieu d'etre nomme.
for (const r of ROUTES) {
  const src = sansCommentaires(read(r))
  ok(
    !/from\('organization_members'\)\s*\.delete\(/.test(src),
    `${r} — aucune suppression physique d'appartenance`,
    'le retrait est SOFT (status=removed) : une suppression physique buterait sur la cle etrangere avec un refus technique',
  )
}

// C3 — LA PURGE RGPD ne doit toujours pas toucher aux appartenances. Si elle
//      s'y mettait, la cle etrangere pourrait bloquer une purge — irreversible
//      et legalement due.
const purge = sansCommentaires(read('lib/account-purge.ts'))
ok(
  !/organization_members/.test(purge),
  'la purge RGPD ne touche pas aux lignes d\'appartenance',
  'si elle s\'y mettait, la nouvelle cle etrangere pourrait bloquer une purge — irreversible et legalement due',
)

// ───────────────────────────────────────────────────────────────────────────
console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTROLE(S) EN ECHEC\n`)
process.exit(failures === 0 ? 0 : 1)
