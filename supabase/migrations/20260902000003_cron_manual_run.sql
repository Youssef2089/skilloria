-- ─────────────────────────────────────────────────────────────────────────────
-- SUPERVISION DES TACHES PLANIFIEES — EXECUTION MANUELLE (lot 4)
--
-- Youssef declenchait jusqu'ici a la main, en ligne de commande, avec le
-- CRON_SECRET. C'est le seul filet quand une nuit est sautee — depuis le retrait
-- des crons d'hebergeur, il n'y a plus de rattrapage automatique.
--
-- ⚠️ NE JAMAIS GRANTER LE SCHEMA `cron` A `service_role`.
--
-- ═══ ON REJOUE LA COMMANDE DU JOB, ON NE LA REECRIT PAS ══════════════════════
--   La fonction lit `cron.job.command` et l'EXECUTE telle quelle. C'est
--   exactement ce que ferait pg_cron : le comportement est identique PAR
--   CONSTRUCTION, pas par ressemblance. Redefinir ici « ce que fait cette
--   tache » creerait une seconde definition qui divergerait — c'est deja
--   l'histoire de `deriveCandidatureLifecycle` sur ce projet.
--
--   La chaine executee est DIGNE DE CONFIANCE : `cron.job.command` n'est
--   ecrivable que par le proprietaire. Les fonctions des lots 2 et 3 ne
--   touchent QUE `active` et `schedule` — jamais `command`. Cette propriete est
--   verifiee par le diagnostic ; si elle tombait, cette fonction deviendrait un
--   chemin d'execution arbitraire.
--
-- ═══ VERROU CONSULTATIF, PAS UN DRAPEAU EN TABLE ═════════════════════════════
--   `pg_try_advisory_xact_lock` meurt avec la transaction. Un drapeau
--   `is_running` en table resterait a `true` POUR TOUJOURS si le processus
--   tombait entre la pose et la leve — il faudrait alors un second mecanisme
--   pour reparer le premier. Le verrou n'a rien a nettoyer.
--
--   Il ne couvre PAS la collision avec l'execution planifiee (pg_cron ouvre sa
--   propre session). C'est sans consequence : les deux routes de purge sont
--   idempotentes, et un double passage a deja ete valide comme sur au lot de
--   portage. On le documente plutot que de le prevenir.
--
-- ═══ UNE TACHE DESACTIVEE RESTE DECLENCHABLE ═════════════════════════════════
--   Refuser serait defendable — on a pu la desactiver deliberement. Mais
--   l'execution manuelle EST le mecanisme de rattrapage : la refuser sur une
--   tache desactivee retirerait le filet exactement quand il sert. L'ecran
--   annonce donc l'etat au moment de confirmer, et laisse decider.
--
-- Additif et idempotent.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── PROVENANCE DANS LE JOURNAL ──────────────────────────────────────────────
-- Un declenchement manuel est un FAIT a tracer. Sans ces colonnes, on lirait
-- dans l'historique une execution a 14h37 sans savoir si l'horaire a change ou
-- si quelqu'un a clique.
alter table public.cron_run_log
  add column if not exists trigger_source text not null default 'schedule',
  add column if not exists triggered_by   uuid;

do $$
begin
  alter table public.cron_run_log
    add constraint cron_run_log_trigger_source_check
    check (trigger_source in ('schedule', 'manual'));
exception when duplicate_object then null;
end
$$;

-- L'historique UNIT les executions planifiees (cron.job_run_details) et les
-- declenchements manuels (ici) : cet index sert la seconde branche.
create index if not exists cron_run_log_manual_idx
  on public.cron_run_log (job_name, requested_at desc)
  where trigger_source = 'manual';


-- ─── DECLENCHEMENT MANUEL ────────────────────────────────────────────────────
create or replace function public.admin_cron_run_now(
  p_job_name     text,
  p_triggered_by uuid
)
  returns table (
    started_at   timestamptz,
    logged_rows  integer
  )
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_jobid   bigint;
  v_command text;
  v_started timestamptz := now();
  v_rows    integer;
begin
  select j.jobid, j.command::text into v_jobid, v_command
    from cron.job j where j.jobname = p_job_name;
  if v_jobid is null then
    raise exception 'cron_job_not_found: %', p_job_name using errcode = 'no_data_found';
  end if;

  -- Verrou CONSULTATIF, porte par la transaction (cf. § VERROU). Non obtenu =
  -- une autre execution manuelle de CETTE tache est deja en cours.
  if not pg_try_advisory_xact_lock(hashtext('cron_manual:' || p_job_name)) then
    raise exception 'cron_already_running: %', p_job_name using errcode = 'lock_not_available';
  end if;

  -- On rejoue la commande du job, telle quelle (cf. § ON REJOUE LA COMMANDE).
  execute v_command;

  -- PROVENANCE. Les taches HTTP viennent d'inserer leur propre ligne via
  -- `trigger_purge_cron` : on la marque. Les taches SQL pures n'en creent
  -- aucune — on en pose une, sans quoi le declenchement serait invisible dans
  -- l'historique, qui n'a par ailleurs aucune trace d'ordonnanceur pour un run
  -- manuel (pg_cron ne l'a pas execute).
  update public.cron_run_log
     set trigger_source = 'manual',
         triggered_by   = p_triggered_by
   where job_name = p_job_name
     and requested_at >= v_started
     and trigger_source = 'schedule';
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    insert into public.cron_run_log (job_name, requested_at, trigger_source, triggered_by)
    values (p_job_name, v_started, 'manual', p_triggered_by);
    v_rows := 1;
  end if;

  return query select v_started, v_rows;
end;
$fn$;

revoke all on function public.admin_cron_run_now(text, uuid) from public, anon, authenticated;
grant execute on function public.admin_cron_run_now(text, uuid) to service_role;


-- ─── HISTORIQUE v2 — LES DEUX ORIGINES, DISTINGUEES ──────────────────────────
-- Un declenchement manuel ne produit AUCUNE ligne dans `cron.job_run_details` :
-- pg_cron ne l'a pas execute. L'historique doit donc UNIR deux sources, sans
-- quoi le declenchement de secours serait le seul evenement absent de
-- l'historique — l'inverse du but recherche.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️  DROP OBLIGATOIRE — `CREATE OR REPLACE` NE SUFFIT PAS ICI              ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║ Postgres REFUSE de changer le type de retour d'une fonction existante :  ║
-- ║   ERROR: cannot change return type of existing function (42P13)          ║
-- ║   Row type defined by OUT parameters is different.                       ║
-- ║                                                                          ║
-- ║ La version de 20260902000000 renvoyait 12 colonnes ; celle-ci en renvoie ║
-- ║ 14 (`trigger_source`, `triggered_by_email`). Sans le DROP, la migration  ║
-- ║ echoue au push — et elle a effectivement echoue.                         ║
-- ║                                                                          ║
-- ║ La SIGNATURE du DROP porte sur les ARGUMENTS seuls, jamais sur le retour ║
-- ║ ni sur les valeurs par defaut : `(text, integer, integer)`. Une erreur   ║
-- ║ ici ne supprime rien et le CREATE echoue a nouveau, a l'identique.       ║
-- ║                                                                          ║
-- ║ Le DROP emporte les privileges : les `revoke` / `grant` qui suivent le   ║
-- ║ CREATE ne sont donc pas redondants, ils sont NECESSAIRES.                ║
-- ║                                                                          ║
-- ║ REGLE GENERALE, verifiee par scripts/diag-cron-supervision.mjs : toute   ║
-- ║ redefinition changeant les colonnes renvoyees doit etre precedee d'un    ║
-- ║ DROP. Ce n'est pas un cas isole — cela se reproduira au prochain lot qui ║
-- ║ etend une fonction.                                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
drop function if exists public.admin_cron_job_runs(text, integer, integer);

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
    trigger_source      text,
    triggered_by_email  text,
    total_count         bigint
  )
  language sql
  security definer
  set search_path to 'public'
  stable
as $fn$
  with target as (
    select j.jobid from cron.job j where j.jobname = p_job_name
  ),
  -- Branche A : les executions PLANIFIEES. Ossature = cron.job_run_details,
  -- seule source universelle ; verdict HTTP recoupe par la FENETRE d'execution
  -- (trigger_purge_cron insere sa ligne DANS la transaction du job).
  scheduled as (
    select
      d.start_time                          as run_started_at,
      d.end_time                            as run_ended_at,
      d.status::text                        as status,
      d.return_message::text                as return_message,
      l.requested_at, l.http_status, l.timed_out, l.error_msg,
      l.response_body, l.reconciled_at,
      coalesce(l.trigger_source, 'schedule') as trigger_source,
      l.triggered_by
    from cron.job_run_details d
    join target t on t.jobid = d.jobid
    left join lateral (
      select ll.requested_at, ll.http_status, ll.timed_out, ll.error_msg,
             ll.response_body, ll.reconciled_at, ll.trigger_source, ll.triggered_by
        from public.cron_run_log ll
       where ll.job_name = p_job_name
         and ll.requested_at >= d.start_time
         and ll.requested_at <= coalesce(d.end_time, d.start_time + interval '1 hour')
       order by ll.requested_at asc
       limit 1
    ) l on true
  ),
  -- Branche B : les declenchements MANUELS, qui n'existent que dans le journal.
  manual as (
    select
      ll.requested_at as run_started_at,
      ll.reconciled_at as run_ended_at,
      null::text      as status,
      null::text      as return_message,
      ll.requested_at, ll.http_status, ll.timed_out, ll.error_msg,
      ll.response_body, ll.reconciled_at,
      ll.trigger_source, ll.triggered_by
    from public.cron_run_log ll
    where ll.job_name = p_job_name
      and ll.trigger_source = 'manual'
  ),
  merged as (
    select * from scheduled
    union all
    select * from manual
  ),
  counted as (
    select m.*, count(*) over () as total_count
    from merged m
    order by m.run_started_at desc
    limit greatest(1, least(coalesce(p_limit, 25), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    c.run_started_at,
    c.run_ended_at,
    case when c.run_ended_at is null then null
         else (extract(epoch from (c.run_ended_at - c.run_started_at)) * 1000)::integer end,
    c.status,
    c.return_message,
    c.requested_at,
    c.http_status,
    c.timed_out,
    c.error_msg,
    c.response_body,
    c.reconciled_at,
    c.trigger_source,
    u.email::text,
    c.total_count
  from counted c
  left join public.users u on u.id = c.triggered_by
  order by c.run_started_at desc;
$fn$;

revoke all on function public.admin_cron_job_runs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_cron_job_runs(text, integer, integer)
  to service_role;

comment on function public.admin_cron_run_now(text, uuid) is
  'Rejoue la commande d''une tache pg_cron, sous verrou consultatif. Execute '
  'cron.job.command tel quel — meme comportement que l''ordonnanceur, par '
  'construction. Marque la provenance dans cron_run_log.';
