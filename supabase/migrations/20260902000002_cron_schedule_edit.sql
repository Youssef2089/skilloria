-- ─────────────────────────────────────────────────────────────────────────────
-- SUPERVISION DES TACHES PLANIFIEES — MODIFICATION D'HORAIRE (lot 3)
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️  LE RISQUE PRINCIPAL DE CE CHANTIER : « 30 FEVRIER »                   ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║ pg_cron valide la FORME d'une expression (cinq champs), pas sa           ║
-- ║ SATISFIABILITE. `0 3 30 2 *` — 30 fevrier — est acceptee sans erreur et  ║
-- ║ NE SE DECLENCHERA JAMAIS. Aucune exception, aucun avertissement, aucune  ║
-- ║ ligne dans job_run_details. La purge CNIL s'arreterait en silence : le   ║
-- ║ scenario EXACT que cet ecran existe pour rendre impossible.              ║
-- ║                                                                          ║
-- ║ D'ou le parti pris : ON NE RECOIT JAMAIS D'EXPRESSION CRON. On recoit    ║
-- ║ des composants typees et bornes (frequence, heure, minutes, jours), et   ║
-- ║ c'est LE SERVEUR qui construit l'expression. Une expression              ║
-- ║ insatisfiable n'est pas rejetee : elle n'est pas REPRESENTABLE.          ║
-- ║                                                                          ║
-- ║ Le jour du mois est borne a 28 — jamais 29, 30 ni 31. C'est ce qui       ║
-- ║ elimine la classe entiere du probleme, pas un controle a ajouter.        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ NE JAMAIS GRANTER LE SCHEMA `cron` A `service_role`.
--
-- ═══ LA CHAINE D'ENCHAINEMENT ════════════════════════════════════════════════
--   `cron_run_reconcile` lit ce que les purges ont produit ; `cron_run_log_purge`
--   efface ce que la reconciliation a ecrit. Inverser l'ordre ne casse rien de
--   VISIBLE : la reconciliation tourne, ne trouve rien, et le diagnostic lit ce
--   silence comme une PANNE. On fabriquerait un faux rouge permanent en croyant
--   deplacer une heure.
--
--   L'invariant n'est PAS « toutes les executions de la cible apres toutes celles
--   de ses dependances ». `cron_run_reconcile` tourne a 3h15 ET 3h45 justement
--   pour reconcilier la purge de 3h00 puis celle de 3h30. L'invariant exact est :
--
--     POUR CHAQUE execution d'une dependance, il EXISTE une execution de la
--     cible au moins `min_gap_minutes` plus tard dans la meme journee.
--
--   Il est verifie DANS LES DEUX SENS : reprogrammer une dependance verifie
--   aussi que ses dependants la satisfont encore.
--
-- ═══ REFUS QUI PROPOSE ═══════════════════════════════════════════════════════
--   Un refus qui dit seulement « non » oblige a deviner. La fonction calcule le
--   plus petit decalage uniforme qui rend l'horaire valide, et le renvoie. Le
--   message peut alors nommer la contrainte ET proposer l'horaire le plus proche.
--
-- Additif et idempotent.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── MINUTES D'EXECUTION D'UNE EXPRESSION, DANS LA JOURNEE ───────────────────
-- Renvoie les minutes-depuis-minuit auxquelles l'expression se declenche.
-- NULL si l'expression sort du sous-ensemble reconnu — on ne devine pas.
create or replace function public.cron_schedule_run_minutes(p_schedule text)
  returns integer[]
  language plpgsql
  immutable
  set search_path to 'public'
as $fn$
declare
  v_fields  text[];
  v_minutes integer[];
  v_hours   integer[];
  v_out     integer[] := '{}';
  m integer;
  h integer;
begin
  if p_schedule is null then return null; end if;
  v_fields := regexp_split_to_array(btrim(p_schedule), '\s+');
  if array_length(v_fields, 1) <> 5 then return null; end if;

  -- Listes simples uniquement : `3` ou `15,45`. Un `*` ou un pas `*/n` sur la
  -- minute ou l'heure signifie des dizaines d'executions — l'enchainement n'a
  -- alors plus de sens a la minute pres, et on prefere ne rien affirmer.
  if v_fields[1] !~ '^[0-9]+(,[0-9]+)*$' then return null; end if;
  if v_fields[2] !~ '^[0-9]+(,[0-9]+)*$' then return null; end if;

  select array_agg(x::integer) into v_minutes from unnest(string_to_array(v_fields[1], ',')) x;
  select array_agg(x::integer) into v_hours   from unnest(string_to_array(v_fields[2], ',')) x;

  foreach h in array v_hours loop
    foreach m in array v_minutes loop
      if h < 0 or h > 23 or m < 0 or m > 59 then return null; end if;
      v_out := v_out || (h * 60 + m);
    end loop;
  end loop;

  select array_agg(x order by x) into v_out from unnest(v_out) x;
  return v_out;
end;
$fn$;


-- ─── CONSTRUCTION D'UNE EXPRESSION A PARTIR DE COMPOSANTS BORNES ─────────────
-- LEVE sur toute valeur hors bornes. C'est ici que « 30 fevrier » devient
-- irrepresentable : `p_day_of_month` est borne a 28.
create or replace function public.cron_build_schedule(
  p_frequency    text,        -- 'daily' | 'weekly' | 'monthly'
  p_minutes      integer[],   -- 1..6 valeurs, 0-59
  p_hour         integer,     -- 0-23
  p_days_of_week integer[] default null,  -- 0-6, requis si 'weekly'
  p_day_of_month integer default null     -- 1-28, requis si 'monthly'
)
  returns text
  language plpgsql
  immutable
  set search_path to 'public'
as $fn$
declare
  v_minutes text;
  v_dows    text;
  m integer;
  d integer;
begin
  if p_frequency is null or p_frequency not in ('daily', 'weekly', 'monthly') then
    raise exception 'cron_build_schedule: frequence invalide (%)', p_frequency
      using errcode = 'invalid_parameter_value';
  end if;
  if p_minutes is null or array_length(p_minutes, 1) is null
     or array_length(p_minutes, 1) > 6 then
    raise exception 'cron_build_schedule: 1 a 6 minutes attendues'
      using errcode = 'invalid_parameter_value';
  end if;
  foreach m in array p_minutes loop
    if m < 0 or m > 59 then
      raise exception 'cron_build_schedule: minute hors bornes (%)', m
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  if p_hour is null or p_hour < 0 or p_hour > 23 then
    raise exception 'cron_build_schedule: heure hors bornes (%)', p_hour
      using errcode = 'invalid_parameter_value';
  end if;

  select string_agg(x::text, ',' order by x) into v_minutes
    from (select distinct unnest(p_minutes) as x) s;

  if p_frequency = 'daily' then
    return v_minutes || ' ' || p_hour::text || ' * * *';
  end if;

  if p_frequency = 'weekly' then
    if p_days_of_week is null or array_length(p_days_of_week, 1) is null then
      raise exception 'cron_build_schedule: jours de semaine requis'
        using errcode = 'invalid_parameter_value';
    end if;
    foreach d in array p_days_of_week loop
      if d < 0 or d > 6 then
        raise exception 'cron_build_schedule: jour de semaine hors bornes (%)', d
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
    select string_agg(x::text, ',' order by x) into v_dows
      from (select distinct unnest(p_days_of_week) as x) s;
    return v_minutes || ' ' || p_hour::text || ' * * ' || v_dows;
  end if;

  -- Mensuel. LE PLAFOND A 28 EST LA PIECE MAITRESSE : il rend « 30 fevrier »
  -- irrepresentable, plutot que detectable. Tous les mois ont un 28.
  if p_day_of_month is null or p_day_of_month < 1 or p_day_of_month > 28 then
    raise exception 'cron_build_schedule: jour du mois hors bornes (%) — 1 a 28', p_day_of_month
      using errcode = 'invalid_parameter_value';
  end if;
  return v_minutes || ' ' || p_hour::text || ' ' || p_day_of_month::text || ' * *';
end;
$fn$;


-- ─── VERIFICATION DE LA CHAINE ───────────────────────────────────────────────
-- Renvoie la liste des violations pour une tache dont l'horaire deviendrait
-- `p_schedule`. Vide = valide. Verifie DANS LES DEUX SENS.
create or replace function public.admin_cron_chain_violations(
  p_job_name text,
  p_schedule text
)
  returns table (
    direction       text,     -- 'upstream' : une dependance non couverte
                              -- 'downstream' : un dependant qui ne suit plus
    other_job_name  text,
    min_gap_minutes integer
  )
  language sql
  security definer
  set search_path to 'public'
  stable
as $fn$
  with target as (
    select
      p_job_name as job_name,
      public.cron_schedule_run_minutes(p_schedule) as mins,
      coalesce(c.depends_on, '{}'::text[]) as deps,
      coalesce(c.min_gap_minutes, 0) as gap
    from (select 1) _
    left join public.cron_job_catalog c on c.job_name = p_job_name
  ),
  -- AMONT : chaque execution d'une dependance doit etre suivie, le meme jour,
  -- d'au moins une execution de la cible `gap` minutes plus tard.
  upstream as (
    select 'upstream'::text as direction, d.job_name as other_job_name, t.gap as min_gap_minutes
    from target t
    cross join lateral unnest(t.deps) as dep(name)
    join cron.job dj on dj.jobname = dep.name
    cross join lateral (select dep.name as job_name,
                               public.cron_schedule_run_minutes(dj.schedule::text) as mins) d
    where t.mins is not null and d.mins is not null
      and exists (
        select 1 from unnest(d.mins) as dm
        where not exists (
          select 1 from unnest(t.mins) as tm where tm >= dm + t.gap
        )
      )
  ),
  -- AVAL : symetrique. Deplacer une dependance ne doit pas casser ses dependants.
  downstream as (
    select 'downstream'::text as direction, c.job_name as other_job_name, c.min_gap_minutes
    from public.cron_job_catalog c
    join cron.job dj on dj.jobname = c.job_name
    cross join target t
    where p_job_name = any(c.depends_on)
      and t.mins is not null
      and public.cron_schedule_run_minutes(dj.schedule::text) is not null
      and exists (
        select 1 from unnest(t.mins) as tm
        where not exists (
          select 1 from unnest(public.cron_schedule_run_minutes(dj.schedule::text)) as om
          where om >= tm + c.min_gap_minutes
        )
      )
  )
  select * from upstream
  union all
  select * from downstream;
$fn$;


-- ─── PLUS PETIT DECALAGE QUI REND L'HORAIRE VALIDE ───────────────────────────
-- Un refus qui dit seulement « non » oblige a deviner. On cherche le plus petit
-- decalage uniforme (0..1439 min) qui vide la liste des violations, et on
-- renvoie l'expression correspondante. NULL si aucun ne convient.
create or replace function public.admin_cron_suggest_schedule(
  p_job_name text,
  p_schedule text
)
  returns text
  language plpgsql
  security definer
  set search_path to 'public'
  stable
as $fn$
declare
  v_fields  text[];
  v_mins    integer[];
  v_shift   integer;
  v_cand    text;
  v_new_min integer[];
  v_new_h   integer;
  m integer;
begin
  v_mins := public.cron_schedule_run_minutes(p_schedule);
  if v_mins is null then return null; end if;
  v_fields := regexp_split_to_array(btrim(p_schedule), '\s+');

  for v_shift in 1..1439 loop
    -- Un decalage uniforme conserve l'ecart entre les executions ; il ne peut
    -- donc pas franchir minuit sans changer de jour, ce qu'on refuse.
    v_new_min := '{}';
    v_new_h := null;
    foreach m in array v_mins loop
      if (m + v_shift) > 1439 then
        v_new_h := null;
        exit;
      end if;
      if v_new_h is null then
        v_new_h := (m + v_shift) / 60;
      elsif v_new_h <> (m + v_shift) / 60 then
        -- Les executions ne tomberaient plus dans la meme heure : hors du
        -- sous-ensemble representable par le selecteur. On saute.
        v_new_h := -1;
        exit;
      end if;
      v_new_min := v_new_min || ((m + v_shift) % 60);
    end loop;
    if v_new_h is null or v_new_h < 0 then continue; end if;

    v_cand := (select string_agg(x::text, ',' order by x)
                 from (select distinct unnest(v_new_min) as x) s)
              || ' ' || v_new_h::text || ' ' || v_fields[3] || ' ' || v_fields[4] || ' ' || v_fields[5];

    if not exists (select 1 from public.admin_cron_chain_violations(p_job_name, v_cand)) then
      return v_cand;
    end if;
  end loop;

  return null;
end;
$fn$;


-- ─── ECRITURE DE L'HORAIRE ───────────────────────────────────────────────────
-- Construit l'expression depuis des composants BORNES, verifie la chaine, puis
-- ecrit. Aucune expression n'est acceptee depuis l'exterieur.
create or replace function public.admin_cron_set_schedule(
  p_job_name     text,
  p_frequency    text,
  p_minutes      integer[],
  p_hour         integer,
  p_days_of_week integer[] default null,
  p_day_of_month integer default null
)
  returns table (
    previous_schedule text,
    new_schedule      text
  )
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_jobid    bigint;
  v_previous text;
  v_target   text;
  v_new      text;
  v_bad      record;
begin
  select j.jobid, j.schedule::text into v_jobid, v_previous
    from cron.job j where j.jobname = p_job_name;
  if v_jobid is null then
    raise exception 'cron_job_not_found: %', p_job_name using errcode = 'no_data_found';
  end if;

  -- LEVE si un composant est hors bornes. « 30 fevrier » n'arrive jamais ici :
  -- il n'est pas representable en entree.
  v_target := public.cron_build_schedule(
    p_frequency, p_minutes, p_hour, p_days_of_week, p_day_of_month
  );

  -- Chaine : on refuse AVANT d'ecrire, en nommant la contrainte.
  select * into v_bad
    from public.admin_cron_chain_violations(p_job_name, v_target)
   limit 1;
  if found then
    raise exception 'cron_chain_violation: % % %', v_bad.direction, v_bad.other_job_name, v_bad.min_gap_minutes
      using errcode = 'check_violation';
  end if;

  perform cron.alter_job(v_jobid, schedule := v_target);

  -- RELECTURE : on renvoie ce que la base a retenu, jamais ce qu'on a demande.
  select j.schedule::text into v_new from cron.job j where j.jobid = v_jobid;
  return query select v_previous, v_new;
end;
$fn$;


revoke all on function public.cron_schedule_run_minutes(text) from public, anon, authenticated;
revoke all on function public.cron_build_schedule(text, integer[], integer, integer[], integer)
  from public, anon, authenticated;
revoke all on function public.admin_cron_chain_violations(text, text) from public, anon, authenticated;
revoke all on function public.admin_cron_suggest_schedule(text, text) from public, anon, authenticated;
revoke all on function public.admin_cron_set_schedule(text, text, integer[], integer, integer[], integer)
  from public, anon, authenticated;

grant execute on function public.admin_cron_chain_violations(text, text) to service_role;
grant execute on function public.admin_cron_suggest_schedule(text, text) to service_role;
grant execute on function public.admin_cron_set_schedule(text, text, integer[], integer, integer[], integer)
  to service_role;

comment on function public.admin_cron_set_schedule(text, text, integer[], integer, integer[], integer) is
  'Reprogramme une tache pg_cron. N''ACCEPTE AUCUNE expression cron : elle est '
  'construite depuis des composants bornes, ce qui rend une expression '
  'insatisfiable (« 30 fevrier ») irrepresentable plutot que detectable.';
