-- LA BASE ATTEINT-ELLE LE SITE ? — `cron_joignabilite()` (recette staging, 30/09/2026).
-- Sur des passages FABRIQUÉS (tâches `sonde_*`, identifiants de requête hors de toute file réelle), tout est annulé :
--   A. le verdict écrit par la TÂCHE (le site a été atteint) ; le DERNIER appel de chaque tâche, pas le premier ;
--   B. la RÉCONCILIATION : un 401 de protection (page d'hébergeur) et un 401 de NOTRE secret (corps JSON) se distinguent ;
--   C. la RÉPONSE BRUTE encore gardée par pg_net, lue sans attendre la nuit (une redirection) ;
--   D. un appel sans aucune réponse ; un appel de plus de 24 h n'est pas rendu ;
--   E. fermée au navigateur, ouverte à la clé de service.
-- Colonnes et contraintes lues dans les migrations (§G.10) : job_name NOT NULL, verdict_source ∈ (tache,
-- reconciliation), trigger_source ∈ (schedule, manual) ; net._http_response est la table de pg_net.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.cron_run_log (job_name, requested_at, request_id, http_status, reconciled_at, verdict_source) values
  ('sonde_tache',      now() - interval '2 hours',  900000101, 401, now(), 'reconciliation'),
  ('sonde_tache',      now() - interval '1 hour',   900000102, 200, now(), 'tache'),
  ('sonde_vieille',    now() - interval '30 hours', 900000103, 200, now(), 'tache');
insert into public.cron_run_log (job_name, requested_at, request_id, http_status, response_body, reconciled_at, verdict_source) values
  ('sonde_protection', now() - interval '1 hour', 900000104, 401, '<!doctype html><title>Authentication Required</title>', now(), 'reconciliation'),
  ('sonde_secret',     now() - interval '1 hour', 900000105, 401, '{"error":"Unauthorized","code":"unauthorized"}', now(), 'reconciliation');
insert into public.cron_run_log (job_name, requested_at, request_id) values
  ('sonde_brute',  now() - interval '20 minutes', 900000106),
  ('sonde_muette', now() - interval '20 minutes', 900000107);
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  values (900000106, 307, 'Redirecting...', false, null);

create temp view sondes as
  select * from public.cron_joignabilite() j where j.job_name like 'sonde\_%';

select ok((select s.source = 'tache' and s.http_status = 200 from sondes s where s.job_name = 'sonde_tache'),
          'A. le DERNIER appel de la tâche (200, verdict de la tâche), pas le refus d''avant');
select is((select count(*)::int from sondes s where s.job_name = 'sonde_tache'), 1, 'A. une ligne par tâche');
select ok((select s.source = 'reconciliation' and s.http_status = 401 and not s.secret_refuse from sondes s where s.job_name = 'sonde_protection'),
          'B. un 401 d''hébergeur (page HTML) : réconcilié, PAS notre secret');
select ok((select s.http_status = 401 and s.secret_refuse from sondes s where s.job_name = 'sonde_secret'),
          'B. un 401 au corps « code : unauthorized » : NOTRE secret refusé');
select ok((select s.source = 'reponse_brute' and s.http_status = 307 and not s.timed_out from sondes s where s.job_name = 'sonde_brute'),
          'C. la réponse brute de pg_net, lue sans attendre la réconciliation : une redirection');
select ok((select s.source = 'aucune' and s.http_status is null and not s.erreur_connexion from sondes s where s.job_name = 'sonde_muette')
          and not exists (select 1 from sondes s where s.job_name = 'sonde_vieille'),
          'D. un appel sans réponse est rendu « aucune » ; un appel de plus de 24 h n''est pas rendu');
select ok(not has_function_privilege('authenticated', 'public.cron_joignabilite(interval)', 'execute')
          and not has_function_privilege('anon', 'public.cron_joignabilite(interval)', 'execute'),
          'E. fermée au navigateur');
select ok(has_function_privilege('service_role', 'public.cron_joignabilite(interval)', 'execute'),
          'E. ouverte à la clé de service (la supervision la lit)');

select * from finish();
rollback;
