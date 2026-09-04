// scripts/diag-relance-expert.mjs — REPORTER N'EST PAS ANNULER
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE SCRIPT DÉFEND
//
//   UN DÉCLENCHEMENT NE DOIT JAMAIS ÊTRE PERDU. Un expert modifiait son profil
//   une seconde fois dans l'heure : le garde-fou de débit refusait, et ses
//   dernières modifications n'étaient JAMAIS notées. Rien ne le signalait.
//
//   Le remplacement — reporter au lieu de refuser — porte son propre piège, et
//   ce script le surveille autant que le défaut d'origine :
//
//     • REPORTER INDÉFINIMENT, C'EST NE JAMAIS EXÉCUTER. Un expert qui modifie
//       son profil toutes les cinquante minutes ne serait jamais noté. Il FAUT
//       donc une borne d'attente maximale, et elle doit être appliquée.
//     • SOLDER TROP LARGEMENT EFFACE UNE MODIFICATION. Un déclenchement arrivé
//       PENDANT le run porte une échéance postérieure : le solder reviendrait à
//       perdre exactement ce qu'on prétend sauver.
//     • UN PLAFOND MUET MENT. Le compteur de badges tronquait à 2 000 sans le
//       dire : au-delà, le chiffre affiché était faux.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-relance-expert.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE écriture.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const existe = (p) => existsSync(join(ROOT, p))

function migration(suffixe) {
  const d = join(ROOT, 'supabase', 'migrations')
  const f = readdirSync(d).find((x) => x.endsWith(`_${suffixe}.sql`))
  if (!f) { console.error(`\n❌ Migration introuvable : *_${suffixe}.sql`); process.exit(2) }
  return join('supabase', 'migrations', f)
}

let failures = 0
const ok = (cond, label, hint) => {
  if (!cond) failures++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && hint) console.log(`       → ${hint}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const SQL = read(migration('relance_expert'))
const MODULE = read('lib/matching/relance.ts')
const CRON = read('app/api/cron/expert-relance/route.ts')
const PROFIL = read('app/api/profile/route.ts')
const SYNC = read('app/api/me/sync-matching/route.ts')
const APPROB = read('app/api/admin/approve-expert/route.ts')
const BADGES = read('app/api/me/badges/route.ts')

// ══════════════════════════════════════════════════════════════════════════
section('A. IMMÉDIAT À L APPROBATION')
// ══════════════════════════════════════════════════════════════════════════

ok(/runMatchingForExpert\(\{/.test(APPROB),
  'l approbation lance le moteur elle-même',
  'reporter d une heure ferait du premier contact de l expert un ecran vide')
ok(!/programmerRelance/.test(APPROB),
  'et elle ne PROGRAMME rien : elle exécute',
  'programmer a l approbation serait exactement le contraire de ce qui est voulu')
ok(/solderRelance\(auth\.supabaseAdmin, profileId, debutRun\)/.test(APPROB),
  'une relance en attente est soldée par ce run',
  'sinon le moteur tournerait une seconde fois dans l heure, pour rien')

// ══════════════════════════════════════════════════════════════════════════
section('B. REPORTÉ ENSUITE — ET RIEN N EST PERDU')
// ══════════════════════════════════════════════════════════════════════════

ok(/programmerRelance\(supabaseAdmin, cp\.id, 'profil_modifie'\)/.test(PROFIL),
  'l enregistrement du profil PROGRAMME, il n exécute plus')
ok(!/runMatchingForExpert\(\{ supabaseAdmin, profileId: cp\.id \}\)/.test(PROFIL),
  'et il ne lance plus le moteur en direct',
  'dix enregistrements produisaient dix runs, ou un run et neuf refus')

ok(/programmerRelance\(supabaseAdmin, prof\.id/.test(SYNC),
  'la synchronisation programme elle aussi')
ok(!/matching_sync_60s|matching_sync_1h/.test(SYNC),
  'les deux garde-fous qui REFUSAIENT ont disparu',
  'ils ne protegeaient plus rien que la temporisation ne protege mieux, et leur seul effet restant aurait ete d empecher de PROGRAMMER')
ok(/matching_prune_60s/.test(SYNC),
  'celui de l élagage reste : il protège un chemin SQL, pas un coût de modèle')

// L'écriture doit être ATOMIQUE, en base : lire puis écrire depuis l'applicatif
// laisserait deux modifications simultanées se marcher dessus — l'une des deux
// serait perdue, c'est-à-dire le défaut qu'on corrige.
ok(/create or replace function public\.programmer_relance_expert/.test(SQL),
  'programmer/reporter est UNE écriture en base')
ok(/matching_relance_due_at = now\(\) \+ p_delai/.test(SQL),
  'un nouveau déclenchement REPOUSSE l échéance')
ok(/matching_relance_first_at = coalesce\(matching_relance_first_at, now\(\)\)/.test(SQL),
  'et le premier instant de la série NE BOUGE PAS',
  'c est lui qui borne l attente totale : le laisser glisser rendrait le report infini')

// ══════════════════════════════════════════════════════════════════════════
section('C. LE PIÈGE DU REPORT EST BORNÉ')
// ══════════════════════════════════════════════════════════════════════════

ok(/coalesce\(p\.matching_relance_first_at, p\.matching_relance_due_at\) \+ p_attente_max <= now\(\)/.test(SQL),
  'une relance trop ancienne est due MALGRÉ les reports',
  'sans cette borne, un expert modifiant son profil toutes les 50 minutes ne serait JAMAIS note')
ok(/export const ATTENTE_MAX_HEURES/.test(MODULE),
  'l attente maximale est nommée dans le code')
ok(/p_attente_max: `\$\{ATTENTE_MAX_HEURES\} hours`/.test(MODULE),
  'et elle est bien celle qui est passée à la base',
  'une borne declaree mais non transmise laisserait le defaut par defaut de la fonction')
ok(/matching_relance_reported/.test(SQL) && /Ne bloque rien : il RENSEIGNE/.test(SQL),
  'le nombre de reports est compté, sans rien bloquer',
  'un profil reporte vingt fois est un signal, pas un detail')
ok(/create or replace function public\.matching_relance_health/.test(SQL),
  'et la supervision peut le lire')
ok(/jamais_notes/.test(SQL),
  'elle compte aussi les profils visibles JAMAIS passés par le moteur',
  'un expert jamais note n existe pour personne')

// ══════════════════════════════════════════════════════════════════════════
section('D. SOLDER SANS EFFACER CE QUI VIENT D ARRIVER')
// ══════════════════════════════════════════════════════════════════════════

ok(/and matching_relance_due_at <= p_debut_run/.test(SQL),
  'on ne solde QUE ce qui était dû avant le début du run',
  'solder avec now() effacerait une modification faite PENDANT le run')
ok(/const debutRun = new Date\(\)/.test(CRON),
  'le pilote note l instant du début')
{
  const iDebut = CRON.indexOf('const debutRun = new Date()')
  const iRun = CRON.indexOf('runMatchingForExpert(')
  const iSolde = CRON.indexOf('solderRelance(')
  ok(iDebut !== -1 && iRun > iDebut && iSolde > iRun,
    'et l ordre est : instant, run, solde',
    'noter l instant apres le run reintroduirait exactement la fenetre qu on ferme')
}
ok(/un déclenchement est arrivé pendant le run/.test(MODULE),
  'le cas « déclenchement pendant le run » est journalisé, pas silencieux')

// ══════════════════════════════════════════════════════════════════════════
section('E. LE PILOTE, ET UNE SEULE RELANCE PAR PASSAGE')
// ══════════════════════════════════════════════════════════════════════════

ok(existe('app/api/cron/expert-relance/route.ts'), 'la route de relance existe')
ok(/cron\.schedule\(\s*'expert_relance_trigger'/.test(SQL),
  'la tâche planifiée vit dans la BASE',
  'aucune dependance a un ordonnanceur d hebergeur')
ok(/limit 1;/.test(SQL),
  'la file rend UNE relance à la fois',
  'vider la file entiere supposerait un plafond de duree qu on ne controle pas')
ok(/order by coalesce\(p\.matching_relance_first_at/.test(SQL),
  'la plus ANCIENNE d abord',
  'sinon une relance oubliee serait doublee a chaque passage par une plus recente')
ok(/ok: verdict\.status === 'ok'/.test(CRON),
  'le pilote rend le verdict tel quel, échec compris',
  'un pilote qui repond toujours ok rend la supervision aveugle')

// L'index de la file doit être PARTIEL : il ne porte que les lignes en attente.
ok(/create index if not exists profiles_relance_due_idx[\s\S]{0,160}where matching_relance_due_at is not null/.test(SQL),
  'l index de la file est PARTIEL',
  'un index plein porterait des dizaines de milliers de lignes pour en servir trois')

// ══════════════════════════════════════════════════════════════════════════
section('F. LE PLAFOND DES BADGES NE MENT PLUS')
// ══════════════════════════════════════════════════════════════════════════

ok(/const PLAFOND_CANDIDATURES = 2000/.test(BADGES),
  'le plafond est NOMMÉ, plus enfoui dans un .limit()')
ok(/const tronque = candRowsAll\.length >= PLAFOND_CANDIDATURES/.test(BADGES),
  'la troncature est DÉTECTÉE')
ok(/exact: !tronque/.test(BADGES),
  'et rendue avec le compte',
  'un compteur qui ment est pire qu un compteur absent : on lui fait confiance')
ok(/approximatifs/.test(BADGES),
  'la réponse dit QUELS compteurs sont approximatifs')
ok(/order\('updated_at', \{ ascending: false \}\)/.test(BADGES),
  'et la troncature porte sur une liste TRIÉE',
  'tronquer une liste non triee retenait des lignes arbitraires : le chiffre etait faux ET instable d un appel a l autre')
ok(/plafond atteint — le compte est minorant/.test(BADGES),
  'le dépassement est journalisé')

// ══════════════════════════════════════════════════════════════════════════
console.log(
  failures === 0
    ? '\n✅ Reporter, jamais annuler — et la borne du report est en place.\n'
    : `\n❌ ${failures} contrôle(s) en échec.\n`,
)
process.exit(failures === 0 ? 0 : 1)
