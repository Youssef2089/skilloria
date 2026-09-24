-- ════════════════════════════════════════════════════════════════════════════
--  LES ADRESSES IP ONT UNE DURÉE DE VIE : 12 MOIS, RÉGLABLE, PUIS EFFACÉES.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Ajoute une colonne que la route
--  d'administration LIT (`duree_reglages.conservation_ip_mois`) ; déployée
--  avant la colonne, la route répondrait 503 « durées illisibles ». N'efface
--  rien au passage : l'effacement est une tâche, qui tourne la nuit. Rejouable.
--
--  ┌─ LE DÉFAUT QU'ON FERME ─────────────────────────────────────────────────┐
--  │ `audit_logs.ip_address` / `user_agent` et `session_logs.ip_address` /   │
--  │ `user_agent` étaient conservés SANS LIMITE. Une adresse IP est une      │
--  │ donnée personnelle ; la garder indéfiniment n'a aucune base (RGPD       │
--  │ art. 5.1.e, limitation de la conservation). Mesuré le 24/09/2026,       │
--  │ lecture seule : 29 lignes d'audit avec IP, 185 sessions avec IP, et     │
--  │ AUCUNE tâche qui les efface.                                            │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  LA RÈGLE : 12 mois, RÉGLABLE depuis /admin/durees (§D.7 — rien en dur),
--  entre 1 et 60. La durée vit dans `duree_reglages`, avec les trois autres.
--  Passé ce délai, l'adresse ET le navigateur (`user_agent`, qui identifie
--  presque autant) sont mis à NULL — la ligne reste, l'action reste, l'auteur
--  reste : seul le « depuis où » disparaît. Douze mois est une PROPOSITION,
--  pas une mesure : le temps utile pour comprendre une connexion suspecte.
--
--  LA TÂCHE LAISSE SA TRACE. `effacer_adresses_ip()` ouvre sa propre ligne de
--  `cron_run_log` et la CLÔT par `cloturer_run_cron()` — le MÊME guichet que
--  les cinq tâches HTTP (§E.20 : pas un second mécanisme de verdict). Un
--  échec est ÉCRIT sur la ligne (500 + message) et non levé : levée,
--  l'exception emporterait la ligne avec elle, et la panne serait invisible.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── ① LA DURÉE, AVEC LES TROIS AUTRES ───────────────────────────────────────
--  Ajoutée nullable, remplie, puis rendue obligatoire — sans valeur par défaut
--  à l'arrivée, pour la raison écrite dans `duree_invitation` : la ligne existe
--  déjà, personne n'insérera plus dans cette table, et un défaut n'y servirait
--  qu'à masquer un oubli.
alter table public.duree_reglages
  add column if not exists conservation_ip_mois integer;

update public.duree_reglages
   set conservation_ip_mois = 12
 where conservation_ip_mois is null;

alter table public.duree_reglages
  alter column conservation_ip_mois set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'duree_conservation_ip_check') then
    alter table public.duree_reglages
      add constraint duree_conservation_ip_check check (conservation_ip_mois between 1 and 60);
  end if;
end
$$;

comment on column public.duree_reglages.conservation_ip_mois is
  'Conservation des adresses IP et user-agents dans audit_logs et session_logs, en MOIS. '
  'Au-dela, la tache ip_retention_purge les met a NULL. 12 par defaut : une proposition, pas une mesure.';


-- ── ② LA LIMITE — pure, exécutable par la postcondition ─────────────────────
create or replace function public.ip_limite_de_conservation(p_mois integer)
returns timestamptz
language sql
stable
as $$
  select now() - make_interval(months => p_mois)
$$;


-- ── ③ L'EFFACEMENT — et sa trace ────────────────────────────────────────────
create or replace function public.effacer_adresses_ip()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_log_id   bigint;
  v_mois     integer;
  v_limite   timestamptz;
  v_audit    integer;
  v_sessions integer;
  v_resume   jsonb;
begin
  -- LA LIGNE D'ABORD, comme trigger_purge_cron : c'est elle qui porte le
  -- verdict, et elle est ouverte HORS du sous-bloc pour survivre à sa panne.
  insert into public.cron_run_log (job_name)
  values ('ip_retention_purge')
  returning id into v_log_id;

  begin
    select conservation_ip_mois into v_mois
      from public.duree_reglages
     where ligne_unique = true;
    if v_mois is null then
      -- AUCUN DÉFAUT DANS LE CODE (même règle que lib/durees.ts) : sans
      -- réglage, on n'efface rien et on le DIT.
      raise exception 'conservation_ip_mois absent de duree_reglages — aucune valeur de repli';
    end if;
    v_limite := public.ip_limite_de_conservation(v_mois);

    update public.audit_logs
       set ip_address = null, user_agent = null
     where created_at < v_limite
       and (ip_address is not null or user_agent is not null);
    get diagnostics v_audit = row_count;

    update public.session_logs
       set ip_address = null, user_agent = null
     where created_at < v_limite
       and (ip_address is not null or user_agent is not null);
    get diagnostics v_sessions = row_count;

    v_resume := jsonb_build_object(
      'mois',         v_mois,
      'limite',       v_limite,
      'audit_logs',   v_audit,
      'session_logs', v_sessions
    );
    perform public.cloturer_run_cron(v_log_id, 200, v_resume, null);
    return v_resume;
  exception when others then
    -- Le sous-bloc est annulé (rien d'effacé à moitié) ; la ligne de run,
    -- ouverte AVANT, survit et reçoit la panne. Pas de `raise` : il
    -- emporterait la ligne, et la panne serait invisible.
    perform public.cloturer_run_cron(v_log_id, 500, null, sqlerrm);
    return jsonb_build_object('erreur', sqlerrm);
  end;
end;
$fn$;

revoke all on function public.effacer_adresses_ip() from public, anon, authenticated;
grant execute on function public.effacer_adresses_ip() to service_role;


-- ── ④ LA PLANIFICATION — 04:20 UTC, entre le ménage du journal (04:10) et ───
--     la purge des brouillons (04:30). Idempotent : déplanifiée si présente.
do $$
begin
  perform cron.unschedule('ip_retention_purge');
exception when others then
  null; -- pas encore planifiée
end
$$;

select cron.schedule(
  'ip_retention_purge',
  '20 4 * * *',
  $$select public.effacer_adresses_ip()$$
);


-- ── ⑤ LE CATALOGUE — une tâche légale nomme son obligation ──────────────────
insert into public.cron_job_catalog (
  job_name, label_key, description_key,
  criticality, legal_basis_key,
  depends_on, min_gap_minutes, writes_run_log, display_order
) values (
  'ip_retention_purge',
  'jobs.ip_retention.label', 'jobs.ip_retention.description',
  'legal', 'legal_basis.ip_12m',
  '{}'::text[], 0,
  true,   -- elle écrit son verdict elle-même, par cloturer_run_cron
  25
)
on conflict (job_name) do nothing;


-- ── ⑥ LA SANTÉ DES PURGES LA VOIT ───────────────────────────────────────────
--  `cron_purge_health()` ÉNUMÈRE ses tâches : une tâche légale absente de la
--  liste n'y serait jamais rouge. Recréée avec la cinquième — corps identique
--  à `purges_rgpd_pg_cron`, une ligne de plus dans `jobs`.
create or replace function public.cron_purge_health()
  returns table (
    job_name           text,
    schedule           text,
    active             boolean,
    sched_status       text,
    sched_end          timestamptz,
    sched_message      text,
    http_requested_at  timestamptz,
    http_status        integer,
    http_timed_out     boolean,
    http_error         text,
    http_response      text,
    http_reconciled_at timestamptz
  )
  language sql
  security definer
  set search_path to 'public'
  stable
as $fn$
  with jobs(name) as (
    values ('purge_deletions_trigger'),
           ('purge_inactive_trigger'),
           ('cron_run_reconcile'),
           ('cron_run_log_purge'),
           ('ip_retention_purge')
  )
  select
    j.name::text,
    c.schedule::text,
    c.active,
    d.status::text,
    d.end_time,
    d.return_message::text,
    l.requested_at,
    l.http_status,
    l.timed_out,
    l.error_msg,
    l.response_body,
    l.reconciled_at
  from jobs j
  left join cron.job c
    on c.jobname = j.name
  left join lateral (
    select dd.status, dd.end_time, dd.return_message
      from cron.job_run_details dd
     where dd.jobid = c.jobid
     order by dd.start_time desc
     limit 1
  ) d on true
  left join lateral (
    select ll.requested_at, ll.http_status, ll.timed_out,
           ll.error_msg, ll.response_body, ll.reconciled_at
      from public.cron_run_log ll
     where ll.job_name = j.name
     order by ll.requested_at desc
     limit 1
  ) l on true;
$fn$;


-- ── POSTCONDITION — ELLE S'EXÉCUTE, ELLE N'AFFIRME PAS (§E.67) ──────────────
do $post$
declare
  v_sig text;
  v_n   integer;
  v_lim timestamptz;
  v_res jsonb;
begin
  -- Les signatures, résolues par TYPES — jamais par une chaîne rendue.
  for v_sig in
    select s from unnest(array[
      'public.ip_limite_de_conservation(integer)',
      'public.effacer_adresses_ip()',
      'public.cloturer_run_cron(bigint, integer, jsonb, text)',
      'public.cron_purge_health()'
    ]) as s
    where to_regprocedure(s) is null
  loop
    raise exception
      'postcondition NON TENUE : % manque ou a change de signature [vu : %]',
      v_sig,
      coalesce(
        (select string_agg(p.oid::regprocedure::text, ' | ')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = split_part(split_part(v_sig, '.', 2), '(', 1)),
        'aucune fonction de ce nom');
  end loop;

  -- La colonne existe, NOT NULL, et la ligne porte une valeur dans les bornes.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'duree_reglages'
       and column_name = 'conservation_ip_mois' and is_nullable = 'NO'
  ) then
    raise exception 'postcondition NON TENUE : duree_reglages.conservation_ip_mois absente ou nullable';
  end if;
  select conservation_ip_mois into v_n from public.duree_reglages where ligne_unique = true;
  if v_n is null or v_n < 1 or v_n > 60 then
    raise exception 'postcondition NON TENUE : conservation_ip_mois vaut % — attendu entre 1 et 60', v_n;
  end if;

  -- LA CONTRAINTE REFUSE — éprouvée, pas lue. Deux sondes en sous-transaction :
  -- une écriture acceptée ferait passer le `raise` qui suit (errcode P0001,
  -- pas check_violation), et la migration s'arrêterait en le nommant.
  begin
    update public.duree_reglages set conservation_ip_mois = 0 where ligne_unique = true;
    raise exception 'postcondition NON TENUE : 0 mois ACCEPTE — duree_conservation_ip_check ne tient pas';
  exception when check_violation then
    null;
  end;
  begin
    update public.duree_reglages set conservation_ip_mois = 61 where ligne_unique = true;
    raise exception 'postcondition NON TENUE : 61 mois ACCEPTES — duree_conservation_ip_check ne tient pas';
  exception when check_violation then
    null;
  end;

  -- La limite S'EXÉCUTE.
  v_lim := public.ip_limite_de_conservation(12);
  if v_lim > now() - interval '11 months' or v_lim < now() - interval '13 months' then
    raise exception 'postcondition NON TENUE : ip_limite_de_conservation(12) rend % — attendu il y a 12 mois', v_lim;
  end if;

  -- La tâche est planifiée, active, et au catalogue comme LÉGALE avec sa base.
  if not exists (select 1 from cron.job where jobname = 'ip_retention_purge' and active) then
    raise exception 'postcondition NON TENUE : ip_retention_purge absente de cron.job ou inactive';
  end if;
  if not exists (
    select 1 from public.cron_job_catalog
     where job_name = 'ip_retention_purge' and criticality = 'legal'
       and legal_basis_key is not null and writes_run_log
  ) then
    raise exception 'postcondition NON TENUE : ip_retention_purge absente du catalogue, ou non legale, ou sans verdict attendu';
  end if;
  if not exists (select 1 from public.cron_purge_health() h where h.job_name = 'ip_retention_purge') then
    raise exception 'postcondition NON TENUE : cron_purge_health() ne voit pas ip_retention_purge';
  end if;

  -- L'EFFACEMENT S'EXÉCUTE, PUIS EST ANNULÉ — sonde en sous-transaction : un
  -- corps plpgsql ne se vérifie qu'en s'exécutant, et cette exécution ne doit
  -- laisser ni ligne de run, ni adresse effacée par une migration.
  begin
    v_res := public.effacer_adresses_ip();
    if v_res ? 'erreur' then
      raise exception 'postcondition NON TENUE : effacer_adresses_ip a echoue : %', v_res->>'erreur';
    end if;
    if not (v_res ? 'audit_logs' and v_res ? 'session_logs' and v_res ? 'limite' and v_res ? 'mois') then
      raise exception 'postcondition NON TENUE : resume incomplet : %', v_res;
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;

  raise notice 'postcondition tenue : les adresses IP vivent % mois, la tache ip_retention_purge les efface et laisse sa trace', v_n;
end
$post$;
