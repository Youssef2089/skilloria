-- ════════════════════════════════════════════════════════════════════════════
--  LA PIÈCE DANS LES CINQ SOUS-JOURNAUX — on remonte la chaîne depuis n'importe
--  quel bout, sans rien recopier.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Elle n'AJOUTE que des colonnes
--  nullables et des index, et recrée deux fonctions sous la même signature
--  (`trigger_purge_cron`, la nouvelle `admin_cron_run_now`). Le code en ligne
--  n'écrit pas la colonne : elle reste nulle, rien ne casse. Rejouable.
--
--  LE MANDAT (§D.26, étape 3 du socle, phase B 2.5) : le grand livre porte la
--  SYNTHÈSE, les sous-journaux gardent le DÉTAIL — `audit_logs`, `ai_spend_events`,
--  `stripe_events`, `cron_run_log`, `notifications`. Chacun reçoit `piece uuid`,
--  NULLABLE : **aucune reprise de l'historique** (décision de Youssef) — une ligne
--  d'avant la colonne n'a pas de pièce, et on ne lui en invente pas. Un index
--  partiel par table (`where piece is not null`) sert l'écran qui rassemble une
--  pièce depuis une de ses lignes.
--
--  LA PIÈCE D'UNE TÂCHE PLANIFIÉE NAÎT EN SQL ET VOYAGE DANS LE CORPS HTTP.
--  `trigger_purge_cron` la génère (`gen_random_uuid()`), la pose sur la ligne
--  `cron_run_log` du passage et l'envoie avec `log_id` ; la tâche la lit
--  (`lib/cron/verdict-de-run.ts`) et ses lignes du grand livre la portent.
--  Quand le passage est LANCÉ À LA MAIN, la pièce est celle du GESTE de
--  l'administrateur : `admin_cron_run_now` la pose en réglage de transaction
--  (`skilloria.piece_geste`, `set_config(…, true)` — il meurt avec la
--  transaction, la même où la commande de la tâche s'exécute), et
--  `trigger_purge_cron` la reprend au lieu d'en créer une. Le geste, sa ligne
--  `tache_lancee_a_la_main`, la ligne du journal des tâches et les lignes de la
--  tâche elle-même : une pièce.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.audit_logs      add column if not exists piece uuid;
alter table public.ai_spend_events add column if not exists piece uuid;
alter table public.stripe_events   add column if not exists piece uuid;
alter table public.cron_run_log    add column if not exists piece uuid;
alter table public.notifications   add column if not exists piece uuid;

create index if not exists audit_logs_piece_idx      on public.audit_logs (piece)      where piece is not null;
create index if not exists ai_spend_events_piece_idx on public.ai_spend_events (piece) where piece is not null;
create index if not exists stripe_events_piece_idx   on public.stripe_events (piece)   where piece is not null;
create index if not exists cron_run_log_piece_idx    on public.cron_run_log (piece)    where piece is not null;
create index if not exists notifications_piece_idx   on public.notifications (piece)   where piece is not null;


-- ── L'ÉVÉNEMENT STRIPE RÉCLAMÉ SOUS LA PIÈCE DE SA LIVRAISON ──
--  `stripe_event_reclamer` = `stripe_event_claim` (fondations Stripe) À L'IDENTIQUE —
--  un seul INSERT … ON CONFLICT (id), aucune lecture préalable, seul un événement
--  `failed` se rejoue — plus la pièce, posée DANS la même instruction : à la
--  première réception comme à la relivraison d'un échec (la pièce est celle de la
--  livraison qui le traite). Un NOM NOUVEAU, pas une surcharge : deux fonctions de
--  même nom dont l'une a un paramètre de plus rendraient l'appel PostgREST ambigu.
--  ⚠️ `stripe_event_claim` RESTE jusqu'au déploiement suivant (§E.72) : le webhook
--     EN LIGNE l'appelle. Sa suppression est une migration à part — dette nommée.
create or replace function public.stripe_event_reclamer(
  p_id       text,
  p_type     text,
  p_payload  jsonb,
  p_livemode boolean,
  p_piece    uuid
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_claimed boolean;
begin
  insert into public.stripe_events as se (id, type, payload, livemode, status, attempts, piece)
  values (p_id, p_type, p_payload, p_livemode, 'received', 1, p_piece)
  on conflict (id) do update
     set status   = 'received',
         attempts = se.attempts + 1,
         payload  = excluded.payload,
         error    = null,
         piece    = excluded.piece
   where se.status = 'failed'
  returning true into v_claimed;

  -- Aucune ligne insérée ni mise à jour => déjà reçu et non rejouable.
  return coalesce(v_claimed, false);
end;
$fn$;

revoke all on function public.stripe_event_reclamer(text, text, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function public.stripe_event_reclamer(text, text, jsonb, boolean, uuid) to service_role;


-- ── LE PILOTE DES TÂCHES HTTP : la pièce naît ici (ou vient du geste), et part avec log_id ──
create or replace function public.trigger_purge_cron(
  p_job_name text,
  p_path     text
) returns bigint
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_secret text;
  v_base   text;
  v_req_id bigint;
  v_log_id bigint;
  v_n      integer;
  -- La pièce du geste qui a lancé le passage à la main, sinon une pièce neuve.
  v_piece  uuid := coalesce(nullif(current_setting('skilloria.piece_geste', true), '')::uuid, gen_random_uuid());
begin
  if p_path is null or left(p_path, 1) <> '/' then
    raise exception 'trigger_purge_cron: chemin invalide (%) — attendu un chemin absolu', p_path;
  end if;

  -- Secret partage. Absent => on LEVE : jamais d'appel non authentifie.
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cron_secret';
  if v_secret is null or btrim(v_secret) = '' then
    raise exception
      'trigger_purge_cron(%): secret Vault "cron_secret" absent ou vide — appel annule', p_job_name;
  end if;

  -- Origine de l'application pour CET environnement. Absente => on LEVE.
  select decrypted_secret into v_base
    from vault.decrypted_secrets
   where name = 'purge_cron_base_url';
  if v_base is null or btrim(v_base) = '' then
    raise exception
      'trigger_purge_cron(%): secret Vault "purge_cron_base_url" absent ou vide — appel annule', p_job_name;
  end if;
  v_base := rtrim(btrim(v_base), '/');

  -- LA LIGNE D'ABORD : c'est son identifiant — et sa pièce — que la tache recevra.
  insert into public.cron_run_log (job_name, piece)
  values (p_job_name, v_piece)
  returning id into v_log_id;

  select net.http_post(
           url                  := v_base || p_path,
           body                 := jsonb_build_object('log_id', v_log_id, 'piece', v_piece),
           headers              := jsonb_build_object(
                                     'Content-Type',  'application/json',
                                     'Authorization', 'Bearer ' || v_secret
                                   ),
           timeout_milliseconds := 60000
         )
    into v_req_id;

  update public.cron_run_log set request_id = v_req_id where id = v_log_id;
  get diagnostics v_n = row_count;
  -- La ligne vient d'être insérée : zéro est une anomalie. La transaction est annulée,
  -- et la requête pg_net avec elle (la file ne part qu'à la validation).
  perform public.exiger_ecriture(v_n, 'trigger_purge_cron : cron_run_log');
  return v_req_id;
end;
$fn$;


-- ── LE LANCEMENT À LA MAIN : sa pièce devient celle du passage ──
--  Corps repris À L'IDENTIQUE de journal_tache_lancee_a_la_main, plus : le réglage
--  de transaction avant la commande, et la pièce sur la ligne manuelle d'une tâche
--  SQL pure.
create or replace function public.admin_cron_run_now(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_job_name      text
)
  returns table (
    started_at   timestamptz,
    logged_rows  integer,
    issue        text
  )
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_jobid   bigint;
  v_command text;
  v_active  boolean;
  v_started timestamptz := now();
  v_rows    integer;
  v_sujet   uuid := public.identifiant_derive('cron_job', p_job_name);
  v_cause   text;
begin
  if p_origine is distinct from 'administrateur' or not exists (
       select 1 from public.users a where a.id = p_acteur_id and a.user_type = 'admin' and a.status = 'active') then
    raise exception 'admin_cron_run_now : l acteur % n est pas un administrateur actif', p_acteur_id
      using errcode = 'AD002';
  end if;

  select j.jobid, j.command::text, j.active into v_jobid, v_command, v_active
    from cron.job j where j.jobname = p_job_name;
  if v_jobid is null then
    raise exception 'cron_job_not_found: %', p_job_name using errcode = 'no_data_found';
  end if;

  -- Verrou CONSULTATIF, porté par la transaction. Non obtenu = une autre
  -- exécution manuelle de CETTE tâche est déjà en cours.
  if not pg_try_advisory_xact_lock(hashtext('cron_manual:' || p_job_name)) then
    raise exception 'cron_already_running: %', p_job_name using errcode = 'lock_not_available';
  end if;

  -- LA PIÈCE DU GESTE devient celle du passage : trigger_purge_cron la reprend.
  perform set_config('skilloria.piece_geste', p_piece::text, true);

  -- On rejoue la commande du job, telle quelle — dans un SOUS-BLOC : si elle lève,
  -- ses effets sont annulés, et l'échec s'écrit au lieu de disparaître.
  begin
    execute v_command;
  exception when others then
    v_cause := sqlstate;
    perform public.journaliser(
      p_piece, 'tache_lancee_a_la_main', 'echoue', p_origine,
      p_acteur_id, p_acteur_type, null::uuid, 'cron_job', v_sujet,
      jsonb_build_object('tache', p_job_name, 'etait_active', v_active, 'cause', v_cause),
      p_piece_origine, null::numeric, null::text);
    return query select v_started, 0, 'echoue'::text;
    return;
  end;

  -- PROVENANCE. Les tâches HTTP viennent d'insérer leur propre ligne via
  -- `trigger_purge_cron` (sous la pièce du geste) : on la marque. Les tâches SQL
  -- pures n'en créent aucune — on en pose une, sous la pièce du geste.
  update public.cron_run_log
     set trigger_source = 'manual',
         triggered_by   = p_acteur_id
   where job_name = p_job_name
     and requested_at >= v_started
     and trigger_source = 'schedule';
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    insert into public.cron_run_log (job_name, requested_at, trigger_source, triggered_by, piece)
    values (p_job_name, v_started, 'manual', p_acteur_id, p_piece);
    v_rows := 1;
  end if;

  perform public.journaliser(
    p_piece, 'tache_lancee_a_la_main', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, null::uuid, 'cron_job', v_sujet,
    jsonb_build_object('tache', p_job_name, 'etait_active', v_active),
    p_piece_origine, null::numeric, null::text);
  return query select v_started, v_rows, 'reussi'::text;
end;
$fn$;

revoke all on function public.admin_cron_run_now(uuid, uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_cron_run_now(uuid, uuid, text, uuid, text, text) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
--  Les colonnes (uuid, nullables), un index partiel par table SUR la colonne piece —
--  vérifié par le catalogue, pas par le nom (§E.60 : un nom déjà pris ferait sauter
--  la création en silence) —, et les deux fonctions qui portent la pièce.
do $post$
declare
  v_t   text;
  v_n   integer;
begin
  foreach v_t in array array['audit_logs', 'ai_spend_events', 'stripe_events', 'cron_run_log', 'notifications'] loop
    if not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = v_t and c.column_name = 'piece'
                      and c.data_type = 'uuid' and c.is_nullable = 'YES') then
      raise exception 'postcondition NON TENUE : %.piece absente, ou pas uuid nullable', v_t;
    end if;
    select count(*) into v_n
      from pg_index i
      join pg_class t on t.oid = i.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
     where n.nspname = 'public' and t.relname = v_t and a.attname = 'piece' and i.indnatts = 1;
    if v_n < 1 then
      raise exception 'postcondition NON TENUE : aucun index sur %.piece', v_t;
    end if;
  end loop;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'trigger_purge_cron'
                    and p.prosrc ~ 'skilloria\.piece_geste' and p.prosrc ~ '''piece'', v_piece') then
    raise exception 'postcondition NON TENUE : trigger_purge_cron ne pose pas la piece dans le corps HTTP';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.admin_cron_run_now(uuid, uuid, text, uuid, text, text)')
                    and p.prosrc ~ 'set_config\(''skilloria\.piece_geste''') then
    raise exception 'postcondition NON TENUE : admin_cron_run_now ne transmet pas la piece du geste';
  end if;
  if to_regprocedure('public.stripe_event_reclamer(text, text, jsonb, boolean, uuid)') is null then
    raise exception 'postcondition NON TENUE : stripe_event_reclamer absente';
  end if;
  if has_function_privilege('authenticated', 'public.stripe_event_reclamer(text, text, jsonb, boolean, uuid)', 'execute')
     or has_function_privilege('anon', 'public.stripe_event_reclamer(text, text, jsonb, boolean, uuid)', 'execute') then
    raise exception 'postcondition NON TENUE : stripe_event_reclamer executable depuis le navigateur';
  end if;
  raise notice 'postcondition tenue : piece uuid nullable et indexee sur les cinq sous-journaux, sans reprise ; trigger_purge_cron pose la piece et l envoie, admin_cron_run_now transmet celle du geste, stripe_event_reclamer la pose avec la reclamation ; prouve par tests/database/grand_livre/piece_sous_journaux.test.sql';
end
$post$;
