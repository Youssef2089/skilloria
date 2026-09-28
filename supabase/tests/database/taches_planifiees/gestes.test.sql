-- LES GESTES DE L'ÉCRAN /admin/taches-planifiees — chacun par la fonction que sa route appelle, sur une tâche
-- FABRIQUÉE par cron.schedule() dans la transaction annulée (aucune vraie tâche touchée, rien n'appelle le réseau).
--   voir         admin_cron_jobs_overview()                      GET  /api/admin/cron-jobs
--   activer      admin_cron_set_active()   → cron.alter_job()    POST /api/admin/cron-jobs/[name]/toggle
--   replanifier  admin_cron_set_schedule() → cron.alter_job()    POST /api/admin/cron-jobs/[name]/schedule
--   suggérer     admin_cron_suggest_schedule()                   (refus de chaîne, même route)
--   lancer       admin_cron_run_now() (nouvelle signature)        POST /api/admin/cron-jobs/[name]/run
--   historique   admin_cron_job_runs()                           GET  /api/admin/cron-jobs/[name]/runs
-- ⚠️ cron.job NE S'ÉCRIT JAMAIS DIRECTEMENT — pas même par postgres (« permission denied for table job », §E.79) :
--    les gestes passent par les fonctions de pg_cron, et ce test le prouve en les faisant tourner.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(12);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin uuid := pg_temp.fab_admin();
  v_job   text := 'sonde_gestes_' || left(md5(random()::text), 8);
  v_jobid bigint;
  v_r     record;
  v_p     uuid := gen_random_uuid();
begin
  v_jobid := cron.schedule(v_job, '0 0 1 1 *', 'select 1');

  -- ── voir : la tâche est là, hors catalogue, active ──
  select * into v_r from public.admin_cron_jobs_overview() o where o.job_name = v_job;
  return next ok(v_r.jobid = v_jobid and v_r.active and not v_r.catalogued and v_r.schedule = '0 0 1 1 *',
                 'voir : la tâche fabriquée apparaît, active, avec son horaire, hors catalogue');

  -- ── activer / suspendre : par cron.alter_job, jamais par une écriture directe ──
  select * into v_r from public.admin_cron_set_active(v_job, false);
  return next ok(v_r.previous_active and not v_r.new_active, 'suspendre : l''état d''avant et d''après sont rendus');
  return next ok(not (select j.active from cron.job j where j.jobid = v_jobid), 'suspendre : cron.job porte active = false');
  select * into v_r from public.admin_cron_set_active(v_job, true);
  return next ok(not v_r.previous_active and v_r.new_active
                 and (select j.active from cron.job j where j.jobid = v_jobid),
                 'réactiver : la tâche redevient active');
  return next throws_ok(format('select * from public.admin_cron_set_active(%L, true)', 'sonde_tache_inconnue'),
                        'P0002', null, 'une tâche inconnue est nommée (no_data_found), rien n''est écrit');

  -- ── replanifier : l'horaire est CONSTRUIT depuis des composants bornés, puis posé par cron.alter_job ──
  select * into v_r from public.admin_cron_set_schedule(v_job, 'daily', array[45, 15], 3);
  return next ok(v_r.previous_schedule = '0 0 1 1 *' and v_r.new_schedule = '15,45 3 * * *'
                 and (select j.schedule from cron.job j where j.jobid = v_jobid) = '15,45 3 * * *',
                 'replanifier : quotidien à 3 h 15 et 3 h 45, posé dans cron.job');
  return next throws_ok(format('select * from public.admin_cron_set_schedule(%L, %L, array[10], 4)', v_job, 'weekly'),
                        '22023', null, 'replanifier : hebdomadaire sans jour de semaine est refusé (invalid_parameter_value)');
  return next ok((select j.schedule from cron.job j where j.jobid = v_jobid) = '15,45 3 * * *',
                 'le refus n''a rien changé');
  return next lives_ok(format('select public.admin_cron_suggest_schedule(%L, %L)', v_job, '15,45 3 * * *'),
                       'suggérer : la fonction tourne sur une tâche hors chaîne, sans lever');

  -- ── lancer à la main, puis l'historique le montre, avec sa provenance ──
  select * into v_r from public.admin_cron_run_now(v_p, null, 'administrateur', v_admin, 'admin', v_job);
  return next ok(v_r.issue = 'reussi' and pg_temp.lignes(v_p) = 1, 'lancer : la tâche tourne, UNE ligne tache_lancee_a_la_main');
  return next ok(exists (select 1 from public.admin_cron_job_runs(v_job) h where h.trigger_source = 'manual'),
                 'historique : le lancement manuel y figure, avec sa provenance');

  -- ── fermées au navigateur ──
  return next ok(not has_function_privilege('authenticated', 'public.admin_cron_set_active(text, boolean)', 'execute')
                 and not has_function_privilege('authenticated', 'public.admin_cron_set_schedule(text, text, integer[], integer, integer[], integer)', 'execute')
                 and not has_function_privilege('authenticated', 'public.admin_cron_jobs_overview()', 'execute'),
                 'les gestes sont fermés au navigateur (service_role seulement)');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
