-- LES TÂCHES PLANIFIÉES : CHACUNE A SON EFFET PROUVÉ (lot DevOps CI, partie A bis, point 4).
--
-- L'INVENTAIRE — les douze tâches de pg_cron, et ce qui prouve leur effet :
--   constats_trigger                → /api/cron/constats : constater_annonces_expirees (grand_livre/annonce_expiree),
--                                     constater_devoilement_ferme (grand_livre/devoilement_ferme)
--   purge_deletions_trigger         → /api/cron/purge-deletions : anonymiser_compte (grand_livre/purges),
--                                     programmer_suppression_compte (grand_livre/suppression_programmee)
--   purge_inactive_trigger          → /api/cron/purge-inactive : constater_avertissement_inactivite, anonymiser_compte (grand_livre/purges)
--   travaux_ia_pilote               → piloter_travaux_ia (profil/travaux_ia)
--   expert_relance_trigger          → /api/cron/expert-relance : programmer / prochaine / marquer / échouer la relance
--                                     (matching/premiere_recherche, ecritures_effectives)
--   ip_retention_purge              → effacer_adresses_ip (grand_livre/socle)
--   stripe_reconcile_trigger        → /api/cron/stripe-reconcile : la lecture de Stripe (code applicatif, Stripe coupé au
--                                     lancement — §D.1) ; son VERDICT, comme celui de chaque tâche, ci-dessous (⑥)
--   la joignabilité du site         → cron_joignabilite (taches_planifiees/joignabilite)
--   ── ET CE FICHIER, pour les six qui n'avaient pas de test d'effet :
--   cron_run_log_purge              → purge_cron_maintenance (①)
--   cron_run_reconcile              → reconcile_cron_run_log (②)
--   matching_notes_partielles_purge → purger_notes_partielles (③)
--   rate_limit_hits_purge           → sa commande même, lue dans cron.job (④)
--   matching_retry_trigger          → /api/cron/match-retry : next_unfinished_matching_run (⑤)
--   chaque tâche HTTP               → cloturer_run_cron, le verdict écrit par la tâche (⑥)
-- Une tâche AJOUTÉE sans être nommée ici rougit (⓪) : elle n'a pas encore de preuve.
--
-- Données FABRIQUÉES (tâches `sonde_*`, identifiants de requête hors de toute file réelle) ; tout est annulé.
-- Colonnes lues (§G.10) : cron_run_log (job_name NOT NULL, requested_at NOT NULL default now(), request_id bigint,
-- verdict_source ∈ (tache, reconciliation) ou nul, attendu_de_la_tache NOT NULL default true) ; net._http_response
-- (id, status_code, content, timed_out, error_msg) ; matching_notes_partielles (publication_id, profile_id, score real,
-- model, empreinte NOT NULL sans défaut, created_at ; clé (publication_id, profile_id)) ; rate_limit_hits (bucket,
-- key_hash, hit_at).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(18);

-- ⓪ L'inventaire : les douze tâches, elles seules, et chacune appelle ce que son test éprouve.
create temp table taches_attendues (nom text primary key, motif text not null);
insert into taches_attendues values
  ('constats_trigger', '/api/cron/constats'),
  ('cron_run_log_purge', 'purge_cron_maintenance()'),
  ('cron_run_reconcile', 'reconcile_cron_run_log()'),
  ('expert_relance_trigger', '/api/cron/expert-relance'),
  ('ip_retention_purge', 'effacer_adresses_ip()'),
  ('matching_notes_partielles_purge', 'purger_notes_partielles()'),
  ('matching_retry_trigger', '/api/cron/match-retry'),
  ('purge_deletions_trigger', '/api/cron/purge-deletions'),
  ('purge_inactive_trigger', '/api/cron/purge-inactive'),
  ('rate_limit_hits_purge', 'delete from public.rate_limit_hits'),
  ('stripe_reconcile_trigger', '/api/cron/stripe-reconcile'),
  ('travaux_ia_pilote', 'piloter_travaux_ia()');
select set_eq($$select jobname::text from cron.job where jobname not like 'sonde%'$$,
              $$select nom from taches_attendues$$,
              'les douze tâches planifiées, et elles seules — une tâche nouvelle se nomme ici avec la preuve de son effet');
select is((select count(*)::int from cron.job j join taches_attendues t on t.nom = j.jobname
            where position(t.motif in j.command) > 0), 12,
          'chaque tâche appelle la fonction ou la route que son test éprouve');

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_ancien   bigint;
  v_vieux    bigint;
  v_recent   bigint;
  v_attente  bigint;
  v_deja     bigint;
  v_perime   bigint;
  v_verdict  bigint;
  v_admin    uuid := pg_temp.fab_compte('entreprise');
  v_org      uuid := pg_temp.fab_organisation(v_admin);
  v_pub      uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_pub_finie uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_pub_recente uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_pub_usee uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_profil_a uuid := pg_temp.fab_profil('expert');
  v_profil_b uuid := pg_temp.fab_profil('expert');
  v_cmd      text;
  v_second   boolean;
begin
  -- ① cron_run_log_purge — le détail anonymisé à 90 jours, la ligne retirée à 5 ans, le récent intact.
  insert into public.cron_run_log (job_name, requested_at, response_body) values ('sonde_purge', now() - interval '100 days', 'detail ancien') returning id into v_ancien;
  insert into public.cron_run_log (job_name, requested_at, response_body) values ('sonde_purge', now() - interval '6 years', 'detail tres ancien') returning id into v_vieux;
  insert into public.cron_run_log (job_name, requested_at, response_body) values ('sonde_purge', now() - interval '10 days', 'detail recent') returning id into v_recent;
  perform public.purge_cron_maintenance();
  return next ok(exists (select 1 from public.cron_run_log l where l.id = v_ancien and l.response_body is null),
                 'purge_cron_maintenance : à 90 jours, le détail est effacé, la ligne reste (la preuve)');
  return next ok(not exists (select 1 from public.cron_run_log l where l.id = v_vieux),
                 'purge_cron_maintenance : à 5 ans, la ligne part');
  return next is((select l.response_body from public.cron_run_log l where l.id = v_recent), 'detail recent',
                 'purge_cron_maintenance : une ligne de 10 jours est intacte');

  -- ② cron_run_reconcile — la réponse de pg_net reportée sur ce que la tâche n'a pas clos, et sur rien d'autre.
  insert into public.cron_run_log (job_name, requested_at, request_id) values ('sonde_reconcile', now() - interval '10 minutes', 900000201) returning id into v_attente;
  insert into public.cron_run_log (job_name, requested_at, request_id, http_status, reconciled_at, verdict_source)
    values ('sonde_reconcile', now() - interval '10 minutes', 900000202, 200, now(), 'tache') returning id into v_deja;
  insert into public.cron_run_log (job_name, requested_at, request_id) values ('sonde_reconcile', now() - interval '30 hours', 900000203) returning id into v_perime;
  insert into net._http_response (id, status_code, content, timed_out, error_msg) values
    (900000201, 500, '{"error":"sonde"}', false, null),
    (900000202, 503, 'ecrasement interdit', false, null),
    (900000203, 200, 'trop vieux', false, null);
  perform public.reconcile_cron_run_log();
  return next ok(exists (select 1 from public.cron_run_log l where l.id = v_attente and l.http_status = 500
                          and l.verdict_source = 'reconciliation' and l.reconciled_at is not null),
                 'reconcile_cron_run_log : un passage non clos reçoit le statut de pg_net, source « réconciliation »');
  return next ok(exists (select 1 from public.cron_run_log l where l.id = v_deja and l.http_status = 200 and l.verdict_source = 'tache'),
                 'reconcile_cron_run_log : le verdict écrit par la tâche n''est pas réécrit');
  return next ok(exists (select 1 from public.cron_run_log l where l.id = v_perime and l.reconciled_at is null),
                 'reconcile_cron_run_log : un passage de plus de 24 h n''est pas touché');

  -- ③ matching_notes_partielles_purge — les notes de plus de 24 h partent, les récentes restent.
  insert into public.matching_notes_partielles (publication_id, profile_id, score, model, empreinte, created_at) values
    (v_pub, v_profil_a, 5, 'sonde', 'empreinte-sonde-a', now() - interval '25 hours'),
    (v_pub, v_profil_b, 6, 'sonde', 'empreinte-sonde-b', now() - interval '1 hour');
  perform public.purger_notes_partielles();
  return next ok(not exists (select 1 from public.matching_notes_partielles n where n.publication_id = v_pub and n.profile_id = v_profil_a),
                 'purger_notes_partielles : une note de 25 h part');
  return next ok(exists (select 1 from public.matching_notes_partielles n where n.publication_id = v_pub and n.profile_id = v_profil_b),
                 'purger_notes_partielles : une note d''une heure reste (elle sert encore à reprendre un passage)');

  -- ④ rate_limit_hits_purge — la COMMANDE de la tâche, lue dans cron.job et exécutée telle quelle.
  insert into public.rate_limit_hits (bucket, key_hash, hit_at) values
    ('sonde', 'sonde-ancien', now() - interval '25 hours'),
    ('sonde', 'sonde-recent', now() - interval '1 hour');
  select j.command into v_cmd from cron.job j where j.jobname = 'rate_limit_hits_purge';
  execute v_cmd;
  return next ok(not exists (select 1 from public.rate_limit_hits h where h.key_hash = 'sonde-ancien'),
                 'rate_limit_hits_purge (sa commande) : un passage de 25 h part');
  return next ok(exists (select 1 from public.rate_limit_hits h where h.key_hash = 'sonde-recent'),
                 'rate_limit_hits_purge (sa commande) : un passage d''une heure reste (le plafond le compte encore)');

  -- ⑤ matching_retry_trigger — la reprise choisit un passage du moteur INACHEVÉ, passé son délai de grâce, sous le
  --    plafond de tentatives ; ni un passage achevé, ni un passage qui vient de commencer, ni un passage usé.
  update public.publications set matching_attempted_at = now() - interval '2 hours', matching_completed_at = null, matching_attempts = 1 where id = v_pub;
  update public.publications set matching_attempted_at = now() - interval '3 hours', matching_completed_at = now(), matching_attempts = 1 where id = v_pub_finie;
  update public.publications set matching_attempted_at = now() - interval '1 minute', matching_completed_at = null, matching_attempts = 1 where id = v_pub_recente;
  update public.publications set matching_attempted_at = now() - interval '4 hours', matching_completed_at = null, matching_attempts = 5 where id = v_pub_usee;
  return next is(public.next_unfinished_matching_run(), v_pub,
                 'next_unfinished_matching_run : le passage inachevé est repris (ni l''achevé, ni le tout récent, ni l''usé)');
  update public.publications set matching_completed_at = now() where id = v_pub;
  return next ok(public.next_unfinished_matching_run() is distinct from v_pub
                 and public.next_unfinished_matching_run() is distinct from v_pub_finie,
                 'next_unfinished_matching_run : une fois achevé, il n''est plus repris');

  -- ⑥ Le verdict écrit par la tâche — cloturer_run_cron, appelé par chaque route /api/cron en fin de passage.
  insert into public.cron_run_log (job_name, requested_at, request_id) values ('sonde_verdict', now(), 900000301) returning id into v_verdict;
  return next ok(public.cloturer_run_cron(v_verdict, 200, '{"traites": 3}'::jsonb, null),
                 'cloturer_run_cron : le verdict s''écrit (vrai)');
  return next ok(exists (select 1 from public.cron_run_log l where l.id = v_verdict and l.http_status = 200
                          and l.verdict_source = 'tache' and l.summary = '{"traites": 3}'::jsonb and l.reconciled_at is not null),
                 'cloturer_run_cron : statut, résumé et source « tâche » sont posés');
  v_second := public.cloturer_run_cron(v_verdict, 500, null, 'second verdict');
  return next ok(not v_second and (select l.http_status from public.cron_run_log l where l.id = v_verdict) = 200,
                 'cloturer_run_cron : un verdict déjà posé n''est pas réécrit (faux)');
  return next ok(not public.cloturer_run_cron(null, 200, null, null), 'cloturer_run_cron : sans passage, rien (faux)');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
