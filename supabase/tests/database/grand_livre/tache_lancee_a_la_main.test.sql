-- LA TÂCHE LANCÉE À LA MAIN — admin_cron_run_now() (nouvelle signature), l'écrivain unique, appelé par
-- POST /api/admin/cron-jobs/[name]/run. Population : l'administrateur. Les tâches sont FABRIQUÉES par
-- cron.schedule() dans la transaction du test (annulée) : une tâche SQL pure qui réussit, une dont la
-- commande lève, une désactivée — aucune ne vise une vraie tâche, aucune n'appelle le réseau.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(8);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_admin();
  v_client uuid := pg_temp.fab_compte('entreprise');
  v_jobs   text[] := array['sonde_ok_' || left(md5(random()::text), 8), 'sonde_ko_' || left(md5(random()::text), 8),
                           'sonde_off_' || left(md5(random()::text), 8)];
  v_p      uuid[] := array(select gen_random_uuid() from generate_series(1, 4));
  v_r      record;
begin
  perform cron.schedule(v_jobs[1], '0 0 1 1 *', 'select 1');
  perform cron.schedule(v_jobs[2], '0 0 1 1 *', 'select 1/0');
  perform cron.schedule(v_jobs[3], '0 0 1 1 *', 'select 1');
  update cron.job set active = false where jobname = v_jobs[3];

  -- ── une tâche SQL pure : lancée, une ligne de journal manuelle posée, la ligne du grand livre ──
  select * into v_r from public.admin_cron_run_now(v_p[1], null, 'administrateur', v_admin, 'admin', v_jobs[1]);
  return next ok(v_r.issue = 'reussi' and v_r.logged_rows = 1
                 and exists (select 1 from public.cron_run_log c where c.job_name = v_jobs[1]
                              and c.trigger_source = 'manual' and c.triggered_by = v_admin),
                 'tâche SQL pure : lancée, et sa ligne manuelle posée dans cron_run_log (provenance, auteur)');
  return next ok(pg_temp.lignes(v_p[1]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[1]
                   and g.type_action = 'tache_lancee_a_la_main' and g.statut = 'reussi' and g.acteur_id = v_admin
                   and g.sujet_type = 'cron_job' and g.sujet_id = public.identifiant_derive('cron_job', v_jobs[1])
                   and g.detail ->> 'tache' = v_jobs[1] and (g.detail ->> 'etait_active')::boolean),
                 'UNE ligne, sujet DÉRIVÉ du nom de la tâche, active au moment du lancement');
  -- ── une tâche désactivée : le rattrapage est permis, et la ligne le garde ──
  select * into v_r from public.admin_cron_run_now(v_p[2], null, 'administrateur', v_admin, 'admin', v_jobs[3]);
  return next ok(v_r.issue = 'reussi' and exists (select 1 from public.grand_livre g where g.piece = v_p[2]
                   and not (g.detail ->> 'etait_active')::boolean),
                 'tâche désactivée : lancée quand même, la ligne dit qu''elle était DÉSACTIVÉE');
  -- ── une commande qui lève : ses effets annulés, l'échec ÉCRIT ──
  select * into v_r from public.admin_cron_run_now(v_p[3], null, 'administrateur', v_admin, 'admin', v_jobs[2]);
  return next ok(v_r.issue = 'echoue' and v_r.logged_rows = 0
                 and not exists (select 1 from public.cron_run_log c where c.job_name = v_jobs[2]),
                 'commande en échec : issue echoue, aucune ligne de journal de tâche');
  return next ok(pg_temp.lignes(v_p[3]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[3]
                   and g.type_action = 'tache_lancee_a_la_main' and g.statut = 'echoue' and g.detail ->> 'cause' = '22012'),
                 'commande en échec : la ligne est ÉCHOUÉE, cause le SQLSTATE (division par zéro, 22012)');
  -- ── AD002 : un acteur qui n'est pas administrateur ──
  return next throws_ok(format($q$select * from public.admin_cron_run_now(%L, null, 'administrateur', %L, 'client', %L)$q$,
                               v_p[4], v_client, v_jobs[1]),
                        'AD002', null, 'AD002 : un client ne lance pas une tâche');
  return next ok(pg_temp.lignes(v_p[4]) = 0, 'AD002 : aucune ligne');
  return next ok(not has_function_privilege('authenticated', 'public.admin_cron_run_now(uuid, uuid, text, uuid, text, text)', 'execute')
                 and not has_function_privilege('anon', 'public.admin_cron_run_now(uuid, uuid, text, uuid, text, text)', 'execute'),
                 'admin_cron_run_now : fermée au navigateur');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
