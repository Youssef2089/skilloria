-- ─────────────────────────────────────────────────────────────────────────────
-- RETENTION DISSOCIEE DU JOURNAL D'EXECUTION (lot 5)
--
-- ═══ DEUX HORIZONS, JUSQU'ICI CONFONDUS ══════════════════════════════════════
--   `cron_run_log` melangeait deux choses de nature differente, et les
--   supprimait ensemble a 90 jours :
--
--   1. LE COMPTE-RENDU DETAILLE (`response_body`). Il contient les UUID des
--      comptes dont la purge a ECHOUE — donnee pseudonyme. Minimisation
--      (art. 5.1.c) : 90 jours, c'est deja beaucoup pour un detail technique.
--
--   2. LA PREUVE QUE LA PURGE A TOURNE. Elle ne contient QUE des nombres :
--      combien de comptes echus, combien purges, combien en echec. Accountability
--      (art. 5.2) : c'est ce qui permet de demontrer a la CNIL, six mois ou
--      trois ans plus tard, que l'obligation a ete executee.
--
--   Les supprimer ensemble, c'est detruire la preuve pour proteger un detail.
--   Youssef a decouvert qu'une purge ne fonctionnait plus depuis des mois ; la
--   question symetrique — « prouvez-moi qu'elle a tourne en mars » — n'avait
--   aucune reponse possible. C'est le meme trou, vu de l'autre bout.
--
--   DECISION PRODUIT : detail 90 jours (anonymise, pas supprime), preuve
--   5 ANS. Le cout de conservation est nul : ce sont des nombres.
--
-- ═══ LE RESUME EST CAPTURE A LA RECONCILIATION, PAS AU MENAGE ════════════════
--   `cron_run_log.response_body` est TRONQUE a 2000 caracteres
--   (`left(r.content, 2000)`). Une reponse longue y est donc coupee au milieu et
--   n'est plus du JSON valide : extraire le resume depuis cette copie
--   echouerait, silencieusement, sur exactement les executions les plus
--   chargees — celles qui comptent le plus.
--
--   Le resume est donc calcule a la RECONCILIATION, sur `r.content` COMPLET,
--   avant toute troncature. Le menage n'a plus qu'a effacer le detail : la
--   preuve a deja ete mise de cote.
--
-- ═══ « DES NOMBRES, AUCUN IDENTIFIANT » — APPLIQUE LITTERALEMENT ═════════════
--   Le resume ne retire pas les cles connues pour porter des identifiants
--   (`errors`, `blocked_ids`) : ce serait une liste a tenir a jour, et la
--   prochaine cle ajoutee par une route passerait au travers. Il GARDE
--   uniquement les valeurs de type `number` ou `boolean`. Tout tableau, objet ou
--   chaine est ecarte PAR CONSTRUCTION.
--
-- Additif et idempotent. Ne touche a aucune planification.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.cron_run_log
  add column if not exists summary jsonb;

comment on column public.cron_run_log.summary is
  'Preuve d''execution : uniquement les valeurs numeriques et booleennes de la '
  'reponse. Aucun identifiant. Conservee 5 ans, quand response_body est efface a 90 j.';

-- Le menage supprime desormais sur `requested_at` a 5 ans : sans index, ce
-- balayage devient couteux des que le chantier matching aura multiplie les
-- lignes. L'index existant est sur (job_name, requested_at).
create index if not exists cron_run_log_requested_at_idx
  on public.cron_run_log (requested_at);


-- ─── EXTRACTION DU RESUME ────────────────────────────────────────────────────
-- Ne garde QUE les nombres et les booleens (cf. § DES NOMBRES). Renvoie NULL si
-- le corps n'est pas du JSON exploitable — un resume faux serait pire qu'absent.
create or replace function public.cron_run_summary(p_body text)
  returns jsonb
  language plpgsql
  immutable
  set search_path to 'public'
as $fn$
declare
  v_json jsonb;
  v_out  jsonb;
begin
  if p_body is null or btrim(p_body) = '' then return null; end if;
  begin
    v_json := p_body::jsonb;
  exception when others then
    -- Corps tronque ou non-JSON : on ne devine pas.
    return null;
  end;
  if jsonb_typeof(v_json) <> 'object' then return null; end if;

  select jsonb_object_agg(k, v) into v_out
    from jsonb_each(v_json) as e(k, v)
   where jsonb_typeof(v) in ('number', 'boolean');

  return v_out;
end;
$fn$;

revoke all on function public.cron_run_summary(text) from public, anon, authenticated;


-- ─── RECONCILIATION — CAPTURE LE RESUME SUR LA REPONSE COMPLETE ──────────────
-- Corps IDENTIQUE a 20260823000000, a une colonne pres : `summary`, calcule sur
-- `r.content` AVANT la troncature a 2000 caracteres.
create or replace function public.reconcile_cron_run_log()
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_count integer;
begin
  update public.cron_run_log l
     set http_status   = r.status_code,
         timed_out     = r.timed_out,
         error_msg     = r.error_msg,
         response_body = left(r.content, 2000),
         -- PREUVE : extraite du contenu COMPLET, pas de la copie tronquee.
         summary       = public.cron_run_summary(r.content),
         reconciled_at = now()
    from net._http_response r
   where r.id = l.request_id
     and l.reconciled_at is null
     and l.request_id is not null
     and l.requested_at > now() - interval '24 hours';

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function public.reconcile_cron_run_log() from public, anon, authenticated, service_role;


-- ─── MENAGE — DEUX HORIZONS, DEUX TRAITEMENTS ────────────────────────────────
create or replace function public.purge_cron_maintenance()
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  -- 1. DETAIL a 90 jours : on ANONYMISE, on ne supprime pas. La ligne survit
  --    avec sa date, son statut et son resume chiffre — c'est la preuve.
  --    `response_body` est la SEULE colonne portant des identifiants (les UUID
  --    des comptes en echec) ; `error_msg` est un message technique pg_net.
  update public.cron_run_log
     set response_body = null
   where requested_at < now() - interval '90 days'
     and response_body is not null;

  -- 2. PREUVE a 5 ANS. Au-dela, la ligne entiere part.
  --    5 ans couvrent un controle tardif, et le cout de conservation est nul :
  --    a ce stade la ligne ne contient plus que des nombres.
  delete from public.cron_run_log
   where requested_at < now() - interval '5 years';

  -- 3. `cron.job_run_details` est tenue par pg_cron et JAMAIS auto-purgee.
  --    30 jours, inchange. Isole dans son propre bloc : si le role proprietaire
  --    n'a pas le droit de supprimer dans le schema `cron`, le menage du
  --    journal a deja eu lieu et ne doit pas etre annule.
  begin
    delete from cron.job_run_details
     where start_time < now() - interval '30 days';
  exception when insufficient_privilege then
    raise warning 'purge_cron_maintenance: suppression dans cron.job_run_details refusee (privileges)';
  end;
end;
$fn$;

revoke all on function public.purge_cron_maintenance() from public, anon, authenticated, service_role;


-- ─── HISTORIQUE v3 — LA PREUVE SURVIT AU DETAIL ──────────────────────────────
-- Sans exposer `summary`, l'ecran afficherait une ligne VIDE au-dela de 90 jours
-- alors que la preuve est la, juste a cote. Une preuve conservee mais invisible
-- ne prouve rien.
-- Corps IDENTIQUE au lot 4, a une colonne pres.
--
-- ⚠️ DROP OBLIGATOIRE — meme raison qu'en 20260902000003 : on passe de 14 a 15
--    colonnes renvoyees, et `CREATE OR REPLACE` ne peut pas changer le type de
--    retour d'une fonction existante (42P13). La signature du DROP porte sur les
--    ARGUMENTS seuls : `(text, integer, integer)`. Le DROP emportant les
--    privileges, les `revoke` / `grant` qui suivent sont necessaires.
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
    summary             jsonb,
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
  scheduled as (
    select
      d.start_time                          as run_started_at,
      d.end_time                            as run_ended_at,
      d.status::text                        as status,
      d.return_message::text                as return_message,
      l.requested_at, l.http_status, l.timed_out, l.error_msg,
      l.response_body, l.reconciled_at,
      coalesce(l.trigger_source, 'schedule') as trigger_source,
      l.triggered_by, l.summary
    from cron.job_run_details d
    join target t on t.jobid = d.jobid
    left join lateral (
      select ll.requested_at, ll.http_status, ll.timed_out, ll.error_msg,
             ll.response_body, ll.reconciled_at, ll.trigger_source,
             ll.triggered_by, ll.summary
        from public.cron_run_log ll
       where ll.job_name = p_job_name
         and ll.requested_at >= d.start_time
         and ll.requested_at <= coalesce(d.end_time, d.start_time + interval '1 hour')
       order by ll.requested_at asc
       limit 1
    ) l on true
  ),
  manual as (
    select
      ll.requested_at as run_started_at,
      ll.reconciled_at as run_ended_at,
      null::text      as status,
      null::text      as return_message,
      ll.requested_at, ll.http_status, ll.timed_out, ll.error_msg,
      ll.response_body, ll.reconciled_at,
      ll.trigger_source, ll.triggered_by, ll.summary
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
    c.summary,
    c.total_count
  from counted c
  left join public.users u on u.id = c.triggered_by
  order by c.run_started_at desc;
$fn$;

revoke all on function public.admin_cron_job_runs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_cron_job_runs(text, integer, integer)
  to service_role;


-- ─── RATTRAPAGE DES LIGNES DEJA RECONCILIEES ─────────────────────────────────
-- BEST-EFFORT, et il faut le dire : ces lignes n'ont plus que la copie TRONQUEE
-- a 2000 caracteres. `cron_run_summary` renvoie NULL sur un JSON coupe — les
-- executions les plus chargees resteront donc sans resume. Les executions
-- futures, elles, sont capturees a la reconciliation sur le contenu complet.
update public.cron_run_log
   set summary = public.cron_run_summary(response_body)
 where summary is null
   and response_body is not null;
