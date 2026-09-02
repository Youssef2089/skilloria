-- ─────────────────────────────────────────────────────────────────────────────
-- SUPERVISION DES TACHES PLANIFIEES — FONCTIONS DE LECTURE (lot 0)
--
-- Lecture SEULE. Aucune ecriture, aucune planification modifiee. Les actions
-- (activer, reprogrammer, declencher) viendront dans des lots ulterieurs, avec
-- leurs propres gardes.
--
-- ═══ POURQUOI DES FONCTIONS, ET PAS UN GRANT SUR LE SCHEMA `cron` ════════════
--   Le schema `cron` appartient a l'extension, n'est pas expose par PostgREST
--   (seuls `public` et `graphql_public` le sont), et n'a AUCUN grant pour
--   `service_role` — verifie sur toutes les migrations.
--
--   ⚠️ NE JAMAIS GRANTER LE SCHEMA `cron` A `service_role`. Ce serait donner a
--      la cle applicative le droit de planifier n'importe quoi, y compris depuis
--      une faille ailleurs dans l'application. Le point d'exposition doit rester
--      etroit, nomme, et en LECTURE : ces fonctions-ci.
--
-- ═══ LES SEUILS SONT DERIVES, JAMAIS CONSTANTS ═══════════════════════════════
--   « cette tache n'a pas tourne depuis trop longtemps » n'a de sens que par
--   rapport a SA periode. Une constante de 26 h conviendrait au quotidien et
--   serait absurde pour une tache toutes les 5 minutes — ce que le chantier
--   matching va justement ajouter. La periode se DEDUIT de l'expression cron
--   (`cron_expression_period_minutes`), et le seuil vaut 1,5 x periode.
--
-- ═══ EXPRESSION INCONNUE : ON NE DEVINE PAS ══════════════════════════════════
--   Une expression que le derivateur ne sait pas lire renvoie NULL. L'ecran
--   affiche alors « expression avancee » et N'EMET AUCUNE ALERTE de retard —
--   plutot qu'un faux rouge sur une tache parfaitement saine.
--
-- Additif et idempotent.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── PERIODE DEDUITE D'UNE EXPRESSION CRON ───────────────────────────────────
-- Renvoie l'ecart moyen entre deux executions, en MINUTES. NULL si l'expression
-- sort du sous-ensemble reconnu.
--
-- SOUS-ENSEMBLE RECONNU, ET C'EST VOULU : `*`, une liste `a,b,c`, un pas `*/n`,
-- et rien d'autre. Les intervalles (`1-5`), les noms de mois et les extensions
-- (`@daily`) renvoient NULL. Mieux vaut dire « je ne sais pas » que produire un
-- seuil faux sur une expression qu'on a mal comprise — c'est la meme posture que
-- `countOtherAvailablePlatformAdmins` renvoyant NULL plutot qu'un chiffre poli.
--
-- Ce sous-ensemble est EXACTEMENT celui que le selecteur de frequence (lot 3)
-- saura produire : les deux resteront alignes par construction.
create or replace function public.cron_expression_period_minutes(p_schedule text)
  returns integer
  language plpgsql
  immutable
  set search_path to 'public'
as $fn$
declare
  v_fields  text[];
  v_min     integer;
  v_hour    integer;
  v_dom     integer;
  v_dow     integer;
  v_per_day numeric;
begin
  if p_schedule is null then return null; end if;

  v_fields := regexp_split_to_array(btrim(p_schedule), '\s+');
  if array_length(v_fields, 1) <> 5 then return null; end if;

  -- Le mois doit rester '*' : une tache annuelle n'a pas de « retard » lisible.
  if v_fields[4] <> '*' then return null; end if;

  v_min  := public.cron_field_cardinality(v_fields[1], 60);
  v_hour := public.cron_field_cardinality(v_fields[2], 24);
  v_dom  := public.cron_field_cardinality(v_fields[3], 31);
  v_dow  := public.cron_field_cardinality(v_fields[5], 7);
  if v_min is null or v_hour is null or v_dom is null or v_dow is null then
    return null;
  end if;

  -- Jour du mois ET jour de semaine tous deux restreints : pg_cron applique un
  -- OU, la periode n'est plus une moyenne simple. On ne devine pas.
  if v_fields[3] <> '*' and v_fields[5] <> '*' then return null; end if;

  if v_fields[3] <> '*' then
    -- Mensuel : v_dom executions par mois (~30 jours).
    v_per_day := (v_min::numeric * v_hour::numeric * v_dom::numeric) / 30.0;
  elsif v_fields[5] <> '*' then
    -- Hebdomadaire : v_dow jours actifs par semaine.
    v_per_day := (v_min::numeric * v_hour::numeric * v_dow::numeric) / 7.0;
  else
    v_per_day := v_min::numeric * v_hour::numeric;
  end if;

  if v_per_day <= 0 then return null; end if;
  return greatest(1, round(1440.0 / v_per_day))::integer;
end;
$fn$;


-- Nombre de valeurs couvertes par UN champ cron. NULL si le champ sort du
-- sous-ensemble reconnu (cf. avertissement ci-dessus).
create or replace function public.cron_field_cardinality(p_field text, p_span integer)
  returns integer
  language plpgsql
  immutable
  set search_path to 'public'
as $fn$
declare
  v_step integer;
begin
  if p_field is null then return null; end if;

  if p_field = '*' then
    return p_span;
  end if;

  -- Pas : `*/n`
  if p_field ~ '^\*/[0-9]+$' then
    v_step := substring(p_field from 3)::integer;
    if v_step <= 0 then return null; end if;
    return greatest(1, ceil(p_span::numeric / v_step)::integer);
  end if;

  -- Liste de valeurs simples : `3` ou `15,45`
  if p_field ~ '^[0-9]+(,[0-9]+)*$' then
    return array_length(string_to_array(p_field, ','), 1);
  end if;

  -- Intervalles, noms, extensions : non reconnus.
  return null;
end;
$fn$;

revoke all on function public.cron_expression_period_minutes(text) from public, anon, authenticated;
revoke all on function public.cron_field_cardinality(text, integer) from public, anon, authenticated;
grant execute on function public.cron_expression_period_minutes(text) to service_role;


-- ─── VUE D'ENSEMBLE — LE POINT D'ENTREE DE L'ECRAN ───────────────────────────
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️  LA LISTE VIENT DE `cron.job`, JAMAIS DU CATALOGUE.                    ║
-- ║                                                                          ║
-- ║ Le FROM est `cron.job`, et le catalogue arrive en LEFT JOIN. Quelqu'un   ║
-- ║ voudra « optimiser » en partant du catalogue, ou en codant la liste des  ║
-- ║ taches en dur — c'est exactement ce que fait `cron_purge_health()` avec  ║
-- ║ son `VALUES`, et c'est pour cela que `rate_limit_hits_purge` a pu        ║
-- ║ tourner pendant des mois sans apparaitre nulle part.                     ║
-- ║                                                                          ║
-- ║ Un ecran de supervision dont la liste vient du code ne supervise rien :  ║
-- ║ il ne peut montrer que ce que le code sait deja. Le sens de cette        ║
-- ║ fonction est de montrer ce que PERSONNE n'a declare.                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
create or replace function public.admin_cron_jobs_overview()
  returns table (
    job_name                     text,
    jobid                        bigint,
    catalogued                   boolean,
    label_key                    text,
    description_key              text,
    criticality                  text,
    legal_basis_key              text,
    depends_on                   text[],
    min_gap_minutes              integer,
    writes_run_log               boolean,
    display_order                integer,
    schedule                     text,
    active                       boolean,
    command                      text,
    period_minutes               integer,
    staleness_threshold_minutes  integer,
    last_run_started_at          timestamptz,
    last_run_ended_at            timestamptz,
    last_run_status              text,
    last_run_message             text,
    recent_runs                  integer,
    recent_failures              integer,
    http_requested_at            timestamptz,
    http_status                  integer,
    http_timed_out               boolean,
    http_error                   text,
    http_reconciled_at           timestamptz,
    health                       text
  )
  language sql
  security definer
  set search_path to 'public'
  stable
as $fn$
  with base as (
    select
      j.jobname::text as job_name,
      j.jobid,
      (c.job_name is not null) as catalogued,
      c.label_key,
      c.description_key,
      coalesce(c.criticality, 'technical')      as criticality,
      c.legal_basis_key,
      coalesce(c.depends_on, '{}'::text[])      as depends_on,
      coalesce(c.min_gap_minutes, 0)            as min_gap_minutes,
      coalesce(c.writes_run_log, false)         as writes_run_log,
      -- Non cataloguee : rejetee en fin de liste, jamais masquee.
      coalesce(c.display_order, 9000)           as display_order,
      j.schedule::text                          as schedule,
      j.active,
      j.command::text                           as command,
      public.cron_expression_period_minutes(j.schedule::text) as period_minutes
    from cron.job j
    left join public.cron_job_catalog c on c.job_name = j.jobname
  ),
  last_run as (
    select
      b.jobid,
      d.start_time, d.end_time, d.status::text as status, d.return_message::text as return_message
    from base b
    left join lateral (
      select dd.start_time, dd.end_time, dd.status, dd.return_message
        from cron.job_run_details dd
       where dd.jobid = b.jobid
       order by dd.start_time desc
       limit 1
    ) d on true
  ),
  recent as (
    -- Cinq dernieres executions : sert l'etat « echecs repetes », qui distingue
    -- un incident isole d'une panne installee.
    select
      b.jobid,
      count(r.status)::integer                                          as recent_runs,
      count(*) filter (where r.status is distinct from 'succeeded')::integer as recent_failures
    from base b
    left join lateral (
      select dd.status
        from cron.job_run_details dd
       where dd.jobid = b.jobid
       order by dd.start_time desc
       limit 5
    ) r on true
    group by b.jobid
  ),
  http as (
    -- Verdict HTTP : n'existe QUE pour les taches passant par trigger_purge_cron.
    -- Pour les autres, tout reste NULL — et l'ecran ne doit rien en conclure
    -- (cf. `writes_run_log`).
    select
      b.job_name,
      l.requested_at, l.http_status, l.timed_out, l.error_msg, l.reconciled_at
    from base b
    left join lateral (
      select ll.requested_at, ll.http_status, ll.timed_out, ll.error_msg, ll.reconciled_at
        from public.cron_run_log ll
       where ll.job_name = b.job_name
       order by ll.requested_at desc
       limit 1
    ) l on true
  )
  select
    b.job_name,
    b.jobid,
    b.catalogued,
    b.label_key,
    b.description_key,
    b.criticality,
    b.legal_basis_key,
    b.depends_on,
    b.min_gap_minutes,
    b.writes_run_log,
    b.display_order,
    b.schedule,
    b.active,
    b.command,
    b.period_minutes,
    -- 1,5 x periode : une marge de 50 % absorbe un decalage d'ordonnanceur sans
    -- masquer une execution SAUTEE.
    case when b.period_minutes is null then null
         else (b.period_minutes * 3) / 2 end as staleness_threshold_minutes,
    lr.start_time,
    lr.end_time,
    lr.status,
    lr.return_message,
    coalesce(rc.recent_runs, 0),
    coalesce(rc.recent_failures, 0),
    h.requested_at,
    h.http_status,
    h.timed_out,
    h.error_msg,
    h.reconciled_at,
    -- ── ETAT DE SANTE, par ordre de GRAVITE DECROISSANTE ────────────────────
    -- Calcule A LA LECTURE. Aucun job de surveillance : un surveillant planifie
    -- qui tombe est un angle mort de plus, et il faudrait le surveiller.
    case
      -- Une obligation legale desactivee prime sur tout le reste.
      when b.criticality = 'legal' and b.active is not true then 'legal_disabled'
      -- Planifiee, jamais executee : attrape l'expression syntaxiquement valide
      -- mais jamais satisfiable (« 30 fevrier »), qui ne leve aucune erreur.
      when b.active and lr.start_time is null then 'never_ran'
      when lr.status is not null and lr.status <> 'succeeded' then 'failed'
      when b.writes_run_log and h.http_status is not null and h.http_status <> 200 then 'failed'
      when b.active
       and b.period_minutes is not null
       and lr.start_time is not null
       and lr.start_time < now() - make_interval(mins => (b.period_minutes * 3) / 2)
        then 'stale'
      when coalesce(rc.recent_failures, 0) >= 2 then 'repeated_failures'
      -- pg_net est asynchrone : sans reconciliation, on a l'appel sans le verdict.
      when b.writes_run_log
       and h.requested_at is not null
       and h.reconciled_at is null
       and h.requested_at < now() - interval '24 hours'
        then 'verdict_missing'
      when b.active is not true then 'disabled'
      when not b.catalogued then 'uncatalogued'
      else 'ok'
    end as health
  from base b
  join last_run lr on lr.jobid = b.jobid
  join recent   rc on rc.jobid = b.jobid
  join http     h  on h.job_name = b.job_name
  order by b.display_order, b.job_name;
$fn$;

revoke all on function public.admin_cron_jobs_overview() from public, anon, authenticated;
grant execute on function public.admin_cron_jobs_overview() to service_role;

comment on function public.admin_cron_jobs_overview() is
  'Vue de supervision des taches pg_cron. La liste vient de cron.job — le '
  'catalogue enrichit, il ne filtre jamais. Etat de sante calcule a la lecture.';
