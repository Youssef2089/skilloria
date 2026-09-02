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

ok(/banner_title/.test(screen) && /legal_disabled/.test(screen),
  'bandeau de conformite pilote par l’etat legal_disabled')
ok(/role="alert"/.test(screen), 'le bandeau est annonce aux lecteurs d’ecran')
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

const HEALTH = ['legal_disabled', 'never_ran', 'failed', 'stale', 'repeated_failures',
  'verdict_missing', 'disabled', 'uncatalogued', 'ok']
const JOBS = ['purge_deletions', 'purge_inactive', 'reconcile', 'log_purge', 'rate_limit_purge']
for (const loc of ['fr', 'en', 'es', 'de']) {
  const m = JSON.parse(read(`messages/${loc}.json`))
  const c = m.admin_back_office?.cron
  const missing = []
  for (const k of ['title', 'subtitle', 'utc_hint', 'banner_title', 'banner_body', 'banner_hint',
    'migration_pending_title', 'migration_pending_body', 'badge_legal', 'badge_uncatalogued',
    'schedule_advanced', 'chain_notice', 'uncatalogued_body']) {
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
