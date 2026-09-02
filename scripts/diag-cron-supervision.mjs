// scripts/diag-cron-supervision.mjs — SUPERVISION DES TACHES PLANIFIEES (lot 0)
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Cet ecran existe parce qu'une purge legale a cesse de fonctionner pendant
//   des MOIS sans que personne ne puisse le voir. Trois proprietes le rendent
//   capable de reveler ce trou. Ce sont exactement celles qu'une reecriture
//   bien intentionnee ferait sauter :
//
//   P1 — LA LISTE VIENT DE `cron.job`, JAMAIS DU CODE.
//        `cron_purge_health()` part d'un `VALUES` de quatre noms en dur :
//        c'est PRECISEMENT pour cela que `rate_limit_hits_purge` n'y a jamais
//        figure. Quelqu'un voudra « optimiser » en partant du catalogue, ou en
//        codant la liste dans la route. Un ecran de supervision dont la liste
//        vient du code ne peut montrer que ce que le code sait deja — il ne
//        supervise rien.
//
//   P2 — LES SEUILS SONT DERIVES DE L'EXPRESSION CRON, JAMAIS CONSTANTS.
//        Une constante de 26 h convient au quotidien et devient absurde pour
//        une tache toutes les 5 min — ce que le chantier matching ajoutera.
//
//   P3 — LE SCHEMA `cron` N'EST JAMAIS GRANTE A `service_role`.
//        Ce serait donner a la cle applicative le droit de planifier n'importe
//        quoi, depuis n'importe quelle faille. Tout passe par des fonctions
//        SECURITY DEFINER, en lecture.
//
//   Plus une quatrieme, propre au lot 0 :
//   P4 — `writes_run_log` distingue les taches HTTP des taches SQL pures. Sans
//        lui, l'ecran afficherait les secondes en « aucune reponse observee » —
//        un faux rouge permanent sur trois taches saines.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-cron-supervision.mjs        → controles statiques.
//                                                   AUCUN acces base.
//   node --env-file=.env.local scripts/diag-cron-supervision.mjs --db
//                                                 → + inventaire LECTURE SEULE
//                                                   (taches reelles, etats,
//                                                   entrees de catalogue
//                                                   manquantes).
//
// LECTURE PURE : ce script n'ecrit JAMAIS, dans aucun mode.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/** Retire les commentaires : un anti-pattern doit pouvoir etre DOCUMENTE. */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('--')
    })
    .join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

const CATALOG_SQL = 'supabase/migrations/20260901000002_cron_job_catalog.sql'
const READ_SQL = 'supabase/migrations/20260901000003_cron_supervision_read.sql'
const catalog = stripComments(read(CATALOG_SQL))
const readFns = stripComments(read(READ_SQL))
const route = stripComments(read('app/api/admin/cron-jobs/route.ts'))
const screen = stripComments(read('app/[locale]/admin/taches-planifiees/page.tsx'))
const navConfig = stripComments(read('lib/nav-config.ts'))

// ═══ A. P1 — LA LISTE VIENT DE cron.job ════════════════════════════════════
section('A. La liste vient de cron.job, jamais du code')

// Le FROM de la vue d'ensemble, isole : c'est LUI le controle, pas la simple
// presence du mot « cron.job » quelque part dans le fichier.
const overviewStart = readFns.indexOf('create or replace function public.admin_cron_jobs_overview')
const overview = overviewStart === -1 ? '' : readFns.slice(overviewStart)
ok(overview !== '' && /from cron\.job\b/.test(overview),
  'admin_cron_jobs_overview : le FROM est cron.job',
  'partir du catalogue reproduirait l’angle mort de cron_purge_health()')
ok(/left join public\.cron_job_catalog/.test(overview),
  'le catalogue arrive en LEFT JOIN — il enrichit, il ne filtre pas',
  'un INNER JOIN masquerait toute tache non cataloguee, exactement le trou qu’on comble')
ok(!/\bjoin public\.cron_job_catalog\b(?!.*left)/i.test(overview.replace(/left join/gi, 'LJ')),
  'aucune jointure du catalogue autre que LEFT')
ok(/'uncatalogued'/.test(overview),
  'une tache absente du catalogue reste VISIBLE, marquee non cataloguee')
// La route ne doit connaitre aucun nom de tache.
for (const name of ['purge_deletions_trigger', 'purge_inactive_trigger', 'rate_limit_hits_purge']) {
  ok(!route.includes(name), `la route ne code pas en dur « ${name} »`)
}
ok(/rpc\('admin_cron_jobs_overview'\)/.test(route),
  'la route delegue entierement a la fonction de base')

// ═══ B. P2 — LES SEUILS SONT DERIVES ═══════════════════════════════════════
section('B. Seuils derives de l’expression cron')

ok(/create or replace function public\.cron_expression_period_minutes/.test(readFns),
  'la periode est DEDUITE de l’expression cron')
ok(/cron_expression_period_minutes\(j\.schedule/.test(overview),
  'la vue d’ensemble appelle bien le derivateur')
// Ancre sur la PROJECTION de la colonne, pas sur le motif « *3/2 » quelque part
// dans la fonction : le meme calcul apparait aussi dans le case de sante, si
// bien qu'un seuil remplace par une constante restait invisible (constate au
// test de mutation). Un controle cherche trop large est un controle decoratif.
ok(/else \(b\.period_minutes \* 3\) \/ 2 end as staleness_threshold_minutes/.test(overview),
  'le seuil de retard vaut 1,5 x la periode, pas une constante')
ok(/make_interval\(mins => \(b\.period_minutes \* 3\) \/ 2\)/.test(overview),
  'l’etat « stale » compare a ce meme seuil derive, pas a une constante')
// Une expression non reconnue ne doit produire AUCUNE alerte.
ok(/b\.period_minutes is not null/.test(overview),
  'expression non reconnue → aucune alerte de retard',
  'mieux vaut « je ne sais pas » qu’un faux rouge sur une tache saine')
ok(/return null/.test(readFns),
  'le derivateur renvoie NULL sur une expression hors du sous-ensemble reconnu')

// ═══ C. P3 — AUCUN GRANT SUR LE SCHEMA cron ════════════════════════════════
section('C. Le schema cron reste ferme')

const allSql = ['supabase/migrations/20260901000002_cron_job_catalog.sql',
  'supabase/migrations/20260901000003_cron_supervision_read.sql']
  .map((f) => stripComments(read(f))).join('\n')
ok(!/grant\s+(usage|all)\s+on\s+schema\s+cron/i.test(allSql),
  'AUCUN grant sur le schema cron',
  'ce serait donner a la cle applicative le droit de planifier n’importe quoi')
ok(!/grant[^;]*\bcron\.(job|job_run_details)\b/i.test(allSql),
  'aucun grant direct sur cron.job / cron.job_run_details')
ok(/security definer/.test(readFns) &&
   /grant execute on function public\.admin_cron_jobs_overview\(\) to service_role/.test(readFns),
  'l’exposition passe par une fonction SECURITY DEFINER grantee a service_role')
ok(/revoke all on function public\.admin_cron_jobs_overview\(\) from public, anon, authenticated/.test(readFns),
  'la fonction est revoquee pour public / anon / authenticated')
// Lecture seule : le lot 0 ne doit rien pouvoir planifier.
for (const forbidden of ['cron.schedule', 'cron.alter_job', 'cron.unschedule']) {
  ok(!readFns.includes(forbidden), `lot 0 en LECTURE SEULE : aucun appel a ${forbidden}`)
}

// ═══ D. P4 — LE CATALOGUE ET SES INVARIANTS ════════════════════════════════
section('D. Catalogue')

ok(/create table if not exists public\.cron_job_catalog/.test(catalog), 'la table existe')
ok(/enable row level security/.test(catalog),
  'RLS activee (sans policy : seul le service-role y accede)')
// L'invariant qui rend la promesse de l'ecran tenable.
ok(/criticality <> 'legal' or legal_basis_key is not null/.test(catalog),
  'INVARIANT : une tache legale NOMME son obligation',
  'sans lui, l’ecran pourrait afficher « LEGAL » sans savoir de quelle loi il s’agit')
ok(/check \(criticality in \('legal', 'technical'\)\)/.test(catalog),
  'criticality contrainte a legal | technical')
// P4 — la distinction qui evite trois faux rouges permanents.
ok(/writes_run_log/.test(catalog) && /b\.writes_run_log and h\.http_status is not null/.test(overview),
  'writes_run_log distingue les taches HTTP des taches SQL pures',
  'sans lui, les taches SQL pures seraient eternellement « aucune reponse observee »')
ok(/j\.writes_run_log &&/.test(screen),
  'l’ecran n’affiche le verdict HTTP que pour les taches qui en produisent un')

// LES CINQ TACHES REELLES sont au seed — dont celle qui etait invisible.
for (const [name, crit] of [
  ['purge_deletions_trigger', 'legal'],
  ['purge_inactive_trigger', 'legal'],
  ['cron_run_reconcile', 'technical'],
  ['cron_run_log_purge', 'technical'],
  ['rate_limit_hits_purge', 'technical'],
]) {
  ok(catalog.includes(`'${name}'`), `seed : ${name} (${crit})`)
}
ok(/'rate_limit_hits_purge'/.test(catalog),
  'la tache qui etait INVISIBLE entre au catalogue',
  'planifiee en SQL inline, absente de cron_purge_health(), inconnue du diagnostic')
// La chaine d'enchainement est declaree EN BASE, pas dans l'ecran.
ok(/purge_deletions_trigger,purge_inactive_trigger/.test(catalog),
  'la reconciliation declare ses dependances (chaine en base, pas dans le code)')
ok(/min_gap_minutes/.test(catalog), 'l’ecart minimal de la chaine est declare')

// ═══ E. L'ECRAN ════════════════════════════════════════════════════════════
section('E. Ecran')

// Le bandeau a DEMENAGE dans le layout au lot 1 : ces deux controles visaient
// l'ecran des taches, ils visent desormais le composant partage. Les laisser
// pointer sur l'ecran les aurait rendus contradictoires avec le controle
// « l'ecran ne rend PAS un second bandeau » (section E2).
ok(/banner_title/.test(stripComments(read('components/admin/CronComplianceBanner.tsx'))),
  'bandeau de conformite : libelle porte par le composant partage')
ok(/role="alert"/.test(stripComments(read('components/admin/CronComplianceBanner.tsx'))),
  'le bandeau est annonce aux lecteurs d’ecran')
ok(/migration_pending/.test(screen) && /migration_pending/.test(route),
  'migration non poussee : etat DEDIE, jamais un ecran mort')
ok(/empty_title/.test(screen), 'etat vide traite explicitement')
ok(!/Retour|back_to/.test(screen),
  'page de MENU : aucun bouton Retour local (regle projet)')
ok(/utc_hint/.test(screen) && /Date\.UTC/.test(screen),
  'horaires en UTC, heure locale en indication seulement',
  'afficher l’heure locale seule produirait un decalage silencieux deux fois par an')
ok(/section_exploitation/.test(navConfig) && /taches-planifiees/.test(navConfig),
  'l’entree de sidebar est declaree dans nav-config (menu-routes en derive)')
ok(!/batchs/i.test(navConfig),
  'l’ecran ne s’appelle pas « batchs »',
  'le chantier matching introduira des batchs au sens de tranches — deux sens pour un mot')

// ═══ E2. HISTORIQUE ET BANDEAU GLOBAL (lot 1) ══════════════════════════════
section('E2. Historique pagine et bandeau global')

const HISTORY_SQL = 'supabase/migrations/20260902000000_cron_job_runs_history.sql'
const history = stripComments(read(HISTORY_SQL))
const runsRoute = stripComments(read('app/api/admin/cron-jobs/[name]/runs/route.ts'))
const detail = stripComments(read('app/[locale]/admin/taches-planifiees/[job_name]/page.tsx'))
const banner = stripComments(read('components/admin/CronComplianceBanner.tsx'))
const adminLayout = stripComments(read('app/[locale]/admin/layout.tsx'))

// L'ossature de l'historique doit rester cron.job_run_details : c'est la SEULE
// source universelle. cron_run_log n'existe que pour les taches HTTP — en faire
// l'ossature ferait disparaitre les trois taches SQL pures de leur propre
// historique.
ok(/from cron\.job_run_details/.test(history),
  'l’ossature de l’historique est cron.job_run_details (source universelle)',
  'cron_run_log n’existe que pour les taches HTTP — il ne peut pas servir d’ossature')
ok(/left join lateral/.test(history) && /public\.cron_run_log/.test(history),
  'le verdict HTTP est recoupe en LEFT JOIN — jamais exige')
// Le recoupement par FENETRE, pas par proximite de date : trigger_purge_cron
// insere sa ligne DANS la transaction du job.
ok(/ll\.requested_at >= r\.start_time/.test(history) &&
   /ll\.requested_at <= coalesce\(r\.end_time/.test(history),
  'recoupement par la FENETRE d’execution, pas par proximite de date',
  'une heuristique de proximite rattacherait le mauvais appel au mauvais run')
ok(/count\(\*\) over \(\)/.test(history),
  'total EXACT par fenetre SQL — aucun ecretage muet (lecon MAX_ORGS)')
ok(/least\(coalesce\(p_limit, 25\), 200\)/.test(history),
  'la taille de page est bornee cote base, pas seulement cote route')
ok(!/cron\.schedule|cron\.alter_job|cron\.unschedule/.test(history),
  'lot 1 en LECTURE SEULE : l’historique ne planifie rien')
ok(/revoke all on function public\.admin_cron_job_runs/.test(history) &&
   /grant execute on function public\.admin_cron_job_runs\(text, integer, integer\)\s*\n?\s*to service_role/.test(history),
  'admin_cron_job_runs : revoquee puis grantee au seul service_role')
ok(!/grant\s+(usage|all)\s+on\s+schema\s+cron/i.test(history),
  'aucun grant sur le schema cron dans la migration d’historique')

// La fiche ne doit pas RECALCULER l'etat de sante : une seconde formule
// finirait par contredire la liste.
ok(/rpc\('admin_cron_jobs_overview'\)/.test(runsRoute),
  'la fiche lit l’etat de sante de la MEME source que la liste',
  'le recalculer ici garantirait qu’un jour les deux ecrans se contredisent')
ok(/code: 'not_found'/.test(runsRoute),
  'un nom inexistant renvoie 404 — distinct d’un historique vide')
ok(/health\./.test(detail) && !/const SEVERITY/.test(detail),
  'la fiche AFFICHE l’etat de sante sans le recalculer')

// Page de DETAIL : le bouton Retour est celui du layout, unique.
ok(!/back_to|Retour/.test(detail.replace(/AUCUN bouton Retour[\s\S]*?\*\//, '')),
  'fiche : aucun bouton Retour local (le global du layout suffit)')

// UN SEUL bandeau, monte dans le layout.
// Ancre sur l'USAGE JSX, pas sur le nom du composant : demonter la balise
// laisse l'import en place, et le controle restait vert (constate au test de
// mutation). Un import n'a jamais rendu un bandeau.
ok(/<CronComplianceBanner\s*\/>/.test(adminLayout),
  'le bandeau de conformite est MONTE dans le layout admin',
  'sur le seul ecran des taches, il faudrait deja soupconner le probleme pour le voir')
ok(!/banner_title/.test(stripComments(read('app/[locale]/admin/taches-planifiees/page.tsx'))),
  'l’ecran des taches ne rend PAS un second bandeau',
  'deux bandeaux empiles — meme defaut que deux boutons Retour')
ok(/legal_disabled/.test(banner),
  'le bandeau se declenche sur l’etat legal_disabled, pas sur une liste de noms')
ok(/catch \{/.test(banner) && /return null/.test(banner),
  'le bandeau ne casse JAMAIS le layout en cas d’erreur',
  'un bandeau d’alerte qui empeche d’afficher le back-office est pire que le probleme')

// ═══ E3. ACTIVER / DESACTIVER (lot 2) ══════════════════════════════════════
section('E3. Activer / desactiver')

const ACTIONS_SQL = 'supabase/migrations/20260902000001_cron_supervision_actions.sql'
const actionsSql = stripComments(read(ACTIONS_SQL))
const toggleRoute = stripComments(read('app/api/admin/cron-jobs/[name]/toggle/route.ts'))
const auditId = stripComments(read('lib/admin/cron-audit-id.ts'))

// La surface d'ecriture doit rester MINIMALE : basculer un drapeau, rien de plus.
ok(/cron\.alter_job\(v_jobid, active := p_active\)/.test(actionsSql),
  'la fonction ne fait que basculer le drapeau `active`')
for (const forbidden of ['cron.schedule(', 'cron.unschedule(']) {
  ok(!actionsSql.includes(forbidden),
    `la fonction de bascule ne peut pas ${forbidden.includes('unschedule') ? 'desplanifier' : 'planifier'}`)
}
ok(!/grant\s+(usage|all)\s+on\s+schema\s+cron/i.test(actionsSql),
  'aucun grant sur le schema cron dans la migration d’actions')
ok(/revoke all on function public\.admin_cron_set_active/.test(actionsSql) &&
   /grant execute on function public\.admin_cron_set_active\(text, boolean\)\s*\n?\s*to service_role/.test(actionsSql),
  'admin_cron_set_active : revoquee puis grantee au seul service_role')
// Le nom est resolu sur cron.job : une tache non cataloguee reste actionnable.
ok(/from cron\.job j\n\s+where j\.jobname = p_job_name/.test(actionsSql),
  'le nom est resolu sur cron.job, pas sur le catalogue')
// RELECTURE apres ecriture : un alter_job sans effet doit se VOIR.
ok(/select j\.active into v_new/.test(actionsSql),
  'la fonction RELIT l’etat apres ecriture',
  'renvoyer ce qu’on a demande plutot que ce que la base a retenu est le defaut que cet ecran combat')
ok(/row\.new_active !== nextActive/.test(toggleRoute),
  'la route REFUSE de repondre « ok » si l’etat n’a pas change')

// Les deux barrieres, cote serveur.
ok(/requireReauth\(request, auth\.user\.id\)/.test(toggleRoute),
  'barriere 1 : re-authentification exigee')
ok(/confirm_name_mismatch/.test(toggleRoute) && /typed !== jobName/.test(toggleRoute),
  'barriere 2 : le nom retape est REVALIDE au serveur',
  'verifie seulement dans le .tsx, ce champ ne garde rien')
ok(toggleRoute.indexOf('requireReauth') < toggleRoute.indexOf('rpc('),
  'la re-authentification precede toute lecture')
// La barriere vaut dans les DEUX sens : reactiver une purge suspendue
// deliberement (audit, litige) reprend l'anonymisation des comptes.
ok(!/if \(!nextActive\)[\s\S]{0,200}?confirm_name/.test(toggleRoute),
  'le nom retape est exige dans les DEUX sens, pas seulement a la desactivation')

// AUCUN refus sur une tache legale : decision produit explicite.
ok(!/criticality === 'legal'[\s\S]{0,120}?return json\([^)]*403/.test(toggleRoute),
  'aucun refus serveur sur une tache legale',
  'une obligation qu’on ne peut pas suspendre est une obligation qu’on contournera en base')

// L'audit ne doit pas echouer EN SILENCE : entity_id est uuid NOT NULL.
// Ancre sur l'AFFECTATION, pas sur le nom du helper : remplacer la valeur
// laisse l'import en place, et le controle restait vert (constate au test de
// mutation, deja le cas au lot 1 avec le bandeau). Un import n'ecrit rien.
ok(/entity_id: cronJobAuditId\(jobName\)/.test(toggleRoute) && /createHash\('md5'\)/.test(auditId),
  'entity_id derive du nom — audit_logs.entity_id est uuid NOT NULL',
  'un nom brut y serait rejete par Postgres, et logAudit etant best-effort, l’action ne laisserait AUCUNE trace')
ok(/job_name: jobName/.test(toggleRoute),
  'le nom LISIBLE est ecrit dans detail — l’empreinte ne se relit pas')
ok(/'cron_job_enabled' : 'cron_job_disabled'/.test(toggleRoute) && /request,/.test(toggleRoute),
  'audit cron_job_enabled / cron_job_disabled, avec IP et user-agent')

// ═══ E4. MODIFICATION D'HORAIRE — LE « 30 FEVRIER » (lot 3) ════════════════
section('E4. Modification d’horaire')

const SCHED_SQL = 'supabase/migrations/20260902000002_cron_schedule_edit.sql'
const schedSql = stripComments(read(SCHED_SQL))
const schedRoute = stripComments(read('app/api/admin/cron-jobs/[name]/schedule/route.ts'))
const schedModal = stripComments(read('components/admin/CronScheduleModal.tsx'))

// ── LE CONTROLE CENTRAL DE TOUT CE LOT ──────────────────────────────────────
// pg_cron accepte `0 3 30 2 *` sans erreur et ne la declenche JAMAIS. Le
// plafond a 28 rend cette classe d'erreur IRREPRESENTABLE plutot que
// detectable. S'il saute, on retombe sur une purge legale qui s'arrete en
// silence — le scenario exact que cet ecran existe pour rendre impossible.
ok(/p_day_of_month < 1 or p_day_of_month > 28/.test(schedSql),
  'BASE : le jour du mois est borne a 28 — « 30 fevrier » irrepresentable',
  'pg_cron valide la FORME, pas la satisfiabilite : une expression jamais declenchee ne signale rien')
ok(/asBoundedInt\(body\.day_of_month, 1, 28\)/.test(schedRoute),
  'ROUTE : meme borne a 28 (defense en profondeur)')
ok(/length: 28 \}/.test(schedModal),
  'ECRAN : le selecteur ne propose que 1 a 28')
ok(/day_of_month_hint/.test(schedModal),
  'l’ecran DIT pourquoi la liste s’arrete a 28',
  'sans explication, la borne passe pour arbitraire et quelqu’un la « corrigera »')

// AUCUNE expression n'est acceptee de l'exterieur : elle est CONSTRUITE.
ok(/create or replace function public\.cron_build_schedule/.test(schedSql),
  'l’expression est CONSTRUITE en base a partir de composants bornes')
ok(!/p_schedule text[\s\S]{0,200}?perform cron\.alter_job\(v_jobid, schedule := p_schedule\)/.test(schedSql),
  'aucune expression brute n’est ecrite telle quelle dans cron.job')
ok(/v_target := public\.cron_build_schedule\(/.test(schedSql) &&
   /cron\.alter_job\(v_jobid, schedule := v_target\)/.test(schedSql),
  'seule l’expression CONSTRUITE est ecrite')
ok(!/body\.schedule/.test(schedRoute),
  'la route n’accepte JAMAIS de champ `schedule` depuis le client')
ok(/p_frequency/.test(schedRoute) && /p_minutes/.test(schedRoute) && /p_hour/.test(schedRoute),
  'la route envoie des composants types, pas une chaine')

// Les bornes des autres composants, en base ET en route.
for (const [re, label] of [
  [/m < 0 or m > 59/, 'minutes 0-59'],
  [/p_hour < 0 or p_hour > 23/, 'heure 0-23'],
  [/d < 0 or d > 6/, 'jour de semaine 0-6'],
]) {
  ok(re.test(schedSql), `BASE : ${label}`)
}

// ── LA CHAINE, DANS LES DEUX SENS ───────────────────────────────────────────
ok(/create or replace function public\.admin_cron_chain_violations/.test(schedSql),
  'la chaine est verifiee avant ecriture')
ok(/'upstream'/.test(schedSql) && /'downstream'/.test(schedSql),
  'la chaine est verifiee DANS LES DEUX SENS',
  'deplacer une dependance sans verifier ses dependants casserait la chaine par l’autre bout')
// L'invariant EXACT : pour chaque execution d'une dependance, il EXISTE une
// execution de la cible `gap` plus tard. PAS « toutes apres toutes » — la
// reconciliation tourne a 3h15 ET 3h45 pour deux purges a 3h00 et 3h30.
// Ancre sur la FIN du predicat : la mutation « … and false » laissait le motif
// intact et le controle vert (constate au test de mutation).
ok(/where tm >= dm \+ t\.gap\s*\n\s*\)/.test(schedSql),
  'invariant : POUR CHAQUE execution amont, il EXISTE une execution cible plus tard',
  '« toutes apres toutes » refuserait la configuration actuelle, pourtant correcte')
ok(/select \* into v_bad[\s\S]{0,200}?raise exception 'cron_chain_violation/.test(schedSql),
  'la violation LEVE avant tout appel a alter_job')
// L'ORDRE se verifie DANS LE CORPS de admin_cron_set_schedule, et sur le RAISE
// — pas sur la chaine « cron_chain_violation », qui apparait deja bien plus haut
// dans le NOM de la fonction admin_cron_chain_violations. Cherche sur le fichier
// entier, ce controle etait toujours vrai (constate au test de mutation).
const setSchedStart = schedSql.indexOf('create or replace function public.admin_cron_set_schedule')
const setSchedBody = setSchedStart === -1 ? '' : schedSql.slice(setSchedStart)
const raiseIdx = setSchedBody.indexOf("raise exception 'cron_chain_violation")
const writeIdx = setSchedBody.indexOf('perform cron.alter_job(v_jobid, schedule')
ok(raiseIdx !== -1 && writeIdx !== -1 && raiseIdx < writeIdx,
  'la verification precede l’ecriture, jamais l’inverse',
  'verifier apres avoir ecrit laisserait un horaire casse en base jusqu’a la correction')

// ── UN REFUS QUI PROPOSE ────────────────────────────────────────────────────
ok(/create or replace function public\.admin_cron_suggest_schedule/.test(schedSql),
  'la base calcule l’horaire valide le plus proche')
ok(/admin_cron_suggest_schedule/.test(schedRoute) && /suggested_schedule/.test(schedRoute),
  'le refus PROPOSE un horaire valide',
  'un refus qu’on ne sait pas satisfaire est un refus qu’on finit par contourner en base')
ok(/chain_violation_body/.test(schedModal) && /chain_violation_suggestion/.test(schedModal),
  'l’ecran NOMME la contrainte et affiche la proposition')

// ── AUCUN CHAMP LIBRE A L'ECRAN ─────────────────────────────────────────────
ok(!/type="text"/.test(schedModal.replace(/placeholder=\{jobName\}/, '')) || /confirmName/.test(schedModal),
  'la modale n’expose aucun champ texte d’expression cron')
ok(/MINUTE_CHOICES/.test(schedModal) && /HOUR_CHOICES/.test(schedModal) && /DOM_CHOICES/.test(schedModal),
  'la saisie passe par des selecteurs bornes')

// ── LES DEUX BARRIERES, COMME LA BASCULE ────────────────────────────────────
ok(/requireReauth\(request, auth\.user\.id\)/.test(schedRoute),
  'reprogrammation : re-authentification exigee')
ok(/typed !== jobName/.test(schedRoute) && /confirm_name_mismatch/.test(schedRoute),
  'reprogrammation : le nom retape est REVALIDE au serveur')
ok(/select j\.schedule::text into v_new/.test(schedSql),
  'la fonction RELIT l’horaire apres ecriture')
ok(/entity_id: cronJobAuditId\(jobName\)/.test(schedRoute) &&
   /action: 'cron_job_rescheduled'/.test(schedRoute) && /from_schedule/.test(schedRoute),
  'audit cron_job_rescheduled, avec l’horaire avant et apres')
ok(!/grant\s+(usage|all)\s+on\s+schema\s+cron/i.test(schedSql),
  'aucun grant sur le schema cron dans la migration d’horaire')

// ═══ F. LE DIAGNOSTIC EXISTANT NE DOIT PAS CASSER ══════════════════════════
section('F. diag-cron-purges reste utilisable')

const purgesDiag = read('scripts/diag-cron-purges.mjs')
ok(!/horaire inattendu/.test(purgesDiag),
  'diag-cron-purges ne compare plus l’horaire par egalite',
  'reprogrammer est desormais une operation SUPPORTEE — ce controle virerait au rouge a tort')
ok(!/schedule: '/.test(purgesDiag),
  'plus aucun horaire code en dur dans les attentes')
ok(/maxAgeHours/.test(purgesDiag),
  'la FREQUENCE minimale reste exigee (ce qui compte n’est pas perdu)')
ok(/cron_purge_health/.test(purgesDiag),
  'diag-cron-purges lit toujours cron_purge_health() — fonction non modifiee par ce lot')
ok(!/cron_purge_health/.test(readFns),
  'le lot 0 ne touche pas cron_purge_health()',
  'la toucher casserait le diagnostic pendant le developpement')

// ═══ G. i18n — 4 LANGUES ═══════════════════════════════════════════════════
section('G. i18n')

const LOT3_KEYS = ['action_reschedule','reschedule_title','reschedule_body','reschedule_submit','field_frequency','field_hour_utc','field_minutes','field_days_of_week','field_day_of_month','frequency_daily','frequency_weekly','frequency_monthly','day_of_month_hint','preview_utc','chain_violation_body','chain_violation_suggestion','toast_rescheduled','err_invalid_schedule']
const LOT2_KEYS = ['action_enable','action_disable','confirm_cancel','confirm_enable_title','confirm_disable_title','confirm_enable_body','confirm_disable_body','confirm_enable_legal','confirm_disable_legal','confirm_type_name','toast_enabled','toast_disabled','err_confirm_name_mismatch','err_nothing_to_update']
const LOT1_KEYS = ['banner_action','history_title','history_depth_notice','history_empty_title','history_empty_body','runs_count','run_running','duration_ms','duration_s','http_no_verdict','not_found_title','not_found_body','page_of','prev','next']
const HEALTH = ['legal_disabled', 'never_ran', 'failed', 'stale', 'repeated_failures',
  'verdict_missing', 'disabled', 'uncatalogued', 'ok']
const JOBS = ['purge_deletions', 'purge_inactive', 'reconcile', 'log_purge', 'rate_limit_purge']
for (const loc of ['fr', 'en', 'es', 'de']) {
  const m = JSON.parse(read(`messages/${loc}.json`))
  const c = m.admin_back_office?.cron
  const missing = []
  for (const k of ['title', 'subtitle', 'utc_hint', 'banner_title', 'banner_body', 'banner_hint',
    'migration_pending_title', 'migration_pending_body', 'badge_legal', 'badge_uncatalogued',
    'schedule_advanced', 'chain_notice', 'uncatalogued_body', ...LOT1_KEYS, ...LOT2_KEYS, ...LOT3_KEYS]) {
    if (!c?.[k]) missing.push(k)
  }
  for (const h of HEALTH) if (!c?.health?.[h]) missing.push(`health.${h}`)
  for (const j of JOBS) {
    if (!c?.jobs?.[j]?.label) missing.push(`jobs.${j}.label`)
    if (!c?.jobs?.[j]?.description) missing.push(`jobs.${j}.description`)
  }
  if (!c?.legal_basis?.rgpd_art17) missing.push('legal_basis.rgpd_art17')
  if (!c?.legal_basis?.cnil_2y) missing.push('legal_basis.cnil_2y')
  if (!m.admin_back_office?.sidebar?.nav_taches_planifiees) missing.push('sidebar.nav_taches_planifiees')
  ok(missing.length === 0, `i18n ${loc} : libelles de supervision presents`,
    missing.length ? `manquantes : ${missing.slice(0, 6).join(', ')}` : undefined)
}

// LES CLES DU CATALOGUE DOIVENT EXISTER DANS LES MESSAGES. Le catalogue vit en
// base, les libelles dans les JSON : rien ne les relie a la compilation. Sans
// ce controle, une cle mal orthographiee au seed produirait un libelle vide.
const fr = JSON.parse(read('messages/fr.json')).admin_back_office.cron
const declaredKeys = [...catalog.matchAll(/'((?:jobs|legal_basis)\.[a-z0-9_.]+)'/g)].map((m) => m[1])
const resolve = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj)
const unresolved = declaredKeys.filter((k) => !resolve(fr, k))
ok(declaredKeys.length > 0 && unresolved.length === 0,
  `les ${declaredKeys.length} cles i18n du catalogue existent toutes dans messages/fr.json`,
  unresolved.length ? `introuvables : ${unresolved.join(', ')}` : undefined)

// ═══ H. INVENTAIRE BASE — LECTURE SEULE ════════════════════════════════════
if (process.argv.includes('--db')) {
  section('H. Inventaire (LECTURE SEULE)')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absentes')
    console.log('       (charger .env.local : `node --env-file=.env.local scripts/diag-cron-supervision.mjs --db`)')
    failures++
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data, error } = await db.rpc('admin_cron_jobs_overview')
    if (error) {
      console.log(`  KO   admin_cron_jobs_overview() : ${error.message}`)
      console.log(`       Les migrations ${CATALOG_SQL} et ${READ_SQL} ont-elles ete poussees ?`)
      failures++
    } else {
      const rows = data ?? []
      console.log(`\n       Taches planifiees en base : ${rows.length}`)
      for (const r of rows) {
        const flags = [
          r.criticality === 'legal' ? 'LEGAL' : null,
          r.active ? null : 'DESACTIVEE',
          r.catalogued ? null : 'NON CATALOGUEE',
        ].filter(Boolean)
        console.log(
          `         · ${r.job_name.padEnd(26)} ${String(r.schedule).padEnd(14)} ${r.health}` +
            (flags.length ? `  [${flags.join(', ')}]` : ''),
        )
      }
      const uncat = rows.filter((r) => !r.catalogued)
      if (uncat.length > 0) {
        console.log(`\n       ⚠ ${uncat.length} tache(s) hors catalogue : ${uncat.map((r) => r.job_name).join(', ')}`)
        console.log('         Elles s’affichent, mais leur role n’est pas declare.')
      }
      const legalOff = rows.filter((r) => r.health === 'legal_disabled')
      if (legalOff.length > 0) {
        console.log(`\n       🔴 ${legalOff.length} OBLIGATION(S) LEGALE(S) DESACTIVEE(S) : ${legalOff.map((r) => r.job_name).join(', ')}`)
        failures++
      }
      const broken = rows.filter((r) => ['never_ran', 'failed', 'stale'].includes(r.health))
      if (broken.length > 0) {
        console.log(`\n       🔴 ${broken.length} tache(s) en defaut : ${broken.map((r) => `${r.job_name} (${r.health})`).join(', ')}`)
        failures++
      }
      if (legalOff.length === 0 && broken.length === 0) {
        console.log('\n       Aucune tache en defaut.')
      }
    }
  }
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTROLE(S) EN ECHEC\n`)
process.exit(failures === 0 ? 0 : 1)
