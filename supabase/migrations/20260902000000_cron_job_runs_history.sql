-- ─────────────────────────────────────────────────────────────────────────────
-- HISTORIQUE D'EXECUTION D'UNE TACHE PLANIFIEE (lot 1)
--
-- Lecture SEULE. Complete `admin_cron_jobs_overview()`, qui ne renvoie que la
-- DERNIERE execution de chaque tache — assez pour la liste, pas pour repondre a
-- « depuis quand est-ce casse ? ».
--
-- ⚠️ NE JAMAIS GRANTER LE SCHEMA `cron` A `service_role`. Meme posture que la
--    migration precedente : le point d'exposition reste une fonction
--    SECURITY DEFINER, nommee, en lecture.
--
-- ═══ POURQUOI DEUX SOURCES, ET COMMENT ELLES SE RECOUPENT ════════════════════
--   `cron.job_run_details` est la SEULE source universelle : toute tache
--   pg_cron y ecrit, y compris celles planifiees en SQL inline. C'est
--   l'ossature de l'historique.
--
--   `public.cron_run_log` n'existe que pour les taches passant par
--   `trigger_purge_cron()` : pg_net etant ASYNCHRONE, l'ordonnanceur voit
--   « succeeded » des que l'appel est MIS EN FILE — un 401 ou un 500 y apparait
--   comme un succes. Le vrai verdict HTTP n'est que la.
--
--   Le RECOUPEMENT se fait par la FENETRE D'EXECUTION, pas par proximite de
--   date : `trigger_purge_cron()` insere sa ligne DANS la transaction du job,
--   donc `requested_at` tombe necessairement entre `start_time` et `end_time`.
--   C'est une jointure exacte, pas une heuristique.
--
-- ═══ PROFONDEUR REELLE : 30 JOURS, PAS 90 ════════════════════════════════════
--   `purge_cron_maintenance()` borne `cron.job_run_details` a 30 jours et
--   `cron_run_log` a 90. L'ossature de l'historique est donc bornee a 30 jours,
--   quoi qu'en dise la retention du journal. L'ecran l'ANNONCE plutot que de
--   laisser croire a 90 — un historique qui s'arrete sans le dire est
--   exactement le genre de silence que cet ecran combat.
--   (La retention de la PREUVE d'execution passera a 5 ans au lot 5 ; c'est une
--   donnee distincte du detail, et elle ne vit pas dans `job_run_details`.)
--
-- Additif et idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_cron_job_runs(
  p_job_name text,
  p_limit    integer default 25,
  p_offset   integer default 0
)
  returns table (
    run_started_at      timestamptz,
    run_ended_at        timestamptz,
    duration_ms         integer,
    status              text,
    return_message      text,
    http_requested_at   timestamptz,
    http_status         integer,
    http_timed_out      boolean,
    http_error          text,
    http_response       text,
    http_reconciled_at  timestamptz,
    total_count         bigint
  )
  language sql
  security definer
  set search_path to 'public'
  stable
as $fn$
  with target as (
    -- Le nom vient de l'appelant : on le resout sur cron.job, jamais sur le
    -- catalogue. Une tache non cataloguee a un historique comme les autres.
    select j.jobid from cron.job j where j.jobname = p_job_name
  ),
  runs as (
    select
      d.start_time,
      d.end_time,
      d.status::text          as status,
      d.return_message::text  as return_message,
      count(*) over ()        as total_count
    from cron.job_run_details d
    join target t on t.jobid = d.jobid
    order by d.start_time desc
    limit greatest(1, least(coalesce(p_limit, 25), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    r.start_time,
    r.end_time,
    case when r.end_time is null then null
         else (extract(epoch from (r.end_time - r.start_time)) * 1000)::integer end,
    r.status,
    r.return_message,
    l.requested_at,
    l.http_status,
    l.timed_out,
    l.error_msg,
    l.response_body,
    l.reconciled_at,
    r.total_count
  from runs r
  left join lateral (
    -- Fenetre d'execution — cf. § RECOUPEMENT. La borne haute est bornee a
    -- +1 h quand `end_time` est NULL (execution encore en cours) : sans elle,
    -- on rattacherait a ce run des appels bien posterieurs.
    select ll.requested_at, ll.http_status, ll.timed_out,
           ll.error_msg, ll.response_body, ll.reconciled_at
      from public.cron_run_log ll
     where ll.job_name = p_job_name
       and ll.requested_at >= r.start_time
       and ll.requested_at <= coalesce(r.end_time, r.start_time + interval '1 hour')
     order by ll.requested_at asc
     limit 1
  ) l on true
  order by r.start_time desc;
$fn$;

revoke all on function public.admin_cron_job_runs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_cron_job_runs(text, integer, integer)
  to service_role;

comment on function public.admin_cron_job_runs(text, integer, integer) is
  'Historique d''execution d''une tache pg_cron. Ossature = cron.job_run_details '
  '(source universelle, bornee a 30 j) ; verdict HTTP recoupe par la FENETRE '
  'd''execution depuis cron_run_log, uniquement pour les taches qui en produisent un.';
