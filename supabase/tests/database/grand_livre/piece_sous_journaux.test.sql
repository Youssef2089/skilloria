-- LA PIÈCE DANS LES CINQ SOUS-JOURNAUX (phase B 2.5) — colonnes et index ; la réclamation Stripe qui pose la
-- pièce de sa livraison ; la pièce du geste d'un lancement manuel reprise pendant l'exécution de la commande ;
-- trigger_purge_cron qui pose la pièce sur la ligne du passage ET dans le corps HTTP. Tout sur des données
-- FABRIQUÉES ; la requête pg_net reste en file et part avec le rollback (jamais envoyée).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(10);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin   uuid := pg_temp.fab_admin();
  v_evt     text := 'evt_sonde_' || gen_random_uuid();
  v_p       uuid[] := array(select gen_random_uuid() from generate_series(1, 6));
  v_b       boolean;
  v_job     text := 'sonde_piece_' || left(md5(random()::text), 8);
  v_r       record;
  v_req     bigint;
  v_corps   jsonb;
begin
  -- ── les colonnes : uuid, nullables, indexées ──
  return next is((select count(*) from information_schema.columns c
                   where c.table_schema = 'public' and c.column_name = 'piece' and c.data_type = 'uuid' and c.is_nullable = 'YES'
                     and c.table_name in ('audit_logs', 'ai_spend_events', 'stripe_events', 'cron_run_log', 'notifications')),
                 5::bigint, 'les cinq sous-journaux portent piece uuid nullable');
  return next is((select count(distinct t.relname) from pg_index i
                   join pg_class t on t.oid = i.indrelid
                   join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
                  where t.relnamespace = 'public'::regnamespace and a.attname = 'piece' and i.indnatts = 1
                    and t.relname in ('audit_logs', 'ai_spend_events', 'stripe_events', 'cron_run_log', 'notifications')),
                 5::bigint, 'chacun a un index sur piece');

  -- ── la réclamation Stripe : reçue, doublon refusé, relivraison d'un échec sous SA pièce ──
  v_b := public.stripe_event_reclamer(v_evt, 'invoice.paid', '{}'::jsonb, false, v_p[1]);
  return next ok(v_b and exists (select 1 from public.stripe_events e where e.id = v_evt and e.piece = v_p[1] and e.status = 'received'),
                 'première réception : réclamée, sous la pièce de la livraison');
  v_b := public.stripe_event_reclamer(v_evt, 'invoice.paid', '{}'::jsonb, false, v_p[2]);
  return next ok(not v_b and exists (select 1 from public.stripe_events e where e.id = v_evt and e.piece = v_p[1]),
                 'doublon : refusé, la pièce de la première livraison reste');
  update public.stripe_events set status = 'failed' where id = v_evt;
  v_b := public.stripe_event_reclamer(v_evt, 'invoice.paid', '{}'::jsonb, false, v_p[3]);
  return next ok(v_b and exists (select 1 from public.stripe_events e where e.id = v_evt and e.piece = v_p[3] and e.attempts = 2),
                 'relivraison d''un échec : réclamée, sous la pièce de la NOUVELLE livraison');

  -- ── le lancement manuel : la commande voit la pièce du geste, la ligne du passage la porte ──
  perform cron.schedule(v_job, '0 0 1 1 *',
    format('insert into public.cron_run_log (job_name, piece) values (%L, nullif(current_setting(%L, true), %L)::uuid)',
           v_job, 'skilloria.piece_geste', ''));
  select * into v_r from public.admin_cron_run_now(v_p[4], null, 'administrateur', v_admin, 'admin', v_job);
  return next ok(v_r.issue = 'reussi' and exists (select 1 from public.cron_run_log c where c.job_name = v_job
                   and c.piece = v_p[4] and c.trigger_source = 'manual' and c.triggered_by = v_admin),
                 'lancement manuel : la commande a vu la pièce du GESTE, la ligne du passage la porte (marquée manuelle)');
  return next ok(pg_temp.lignes(v_p[4]) = 1
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[4] and g.type_action = 'tache_lancee_a_la_main'),
                 'la ligne tache_lancee_a_la_main et le passage partagent la pièce — UNE ligne au grand livre');

  -- ── trigger_purge_cron : la pièce sur la ligne ET dans le corps HTTP (secrets fabriqués, requête jamais envoyée) ──
  if to_regclass('vault.secrets') is null or to_regclass('net.http_request_queue') is null then
    return next skip('vault ou pg_net absent de cette base : trigger_purge_cron ne se fabrique pas', 3);
  else
    if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
      perform vault.create_secret('secret-de-sonde', 'cron_secret');
    end if;
    if not exists (select 1 from vault.decrypted_secrets where name = 'purge_cron_base_url') then
      perform vault.create_secret('https://sonde.exemple.invalid', 'purge_cron_base_url');
    end if;
    perform set_config('skilloria.piece_geste', v_p[5]::text, true);
    v_req := public.trigger_purge_cron(v_job || '_http', '/api/sonde');
    perform set_config('skilloria.piece_geste', '', true);
    return next ok(exists (select 1 from public.cron_run_log c where c.job_name = v_job || '_http' and c.piece = v_p[5] and c.request_id = v_req),
                   'trigger_purge_cron : la ligne du passage porte la pièce du geste');
    select convert_from(q.body, 'UTF8')::jsonb into v_corps from net.http_request_queue q where q.id = v_req;
    return next ok(v_corps ->> 'piece' = v_p[5]::text and (v_corps ->> 'log_id') is not null,
                   'trigger_purge_cron : le corps HTTP porte la pièce et log_id');
    v_req := public.trigger_purge_cron(v_job || '_seul', '/api/sonde');
    return next ok(exists (select 1 from public.cron_run_log c where c.job_name = v_job || '_seul' and c.piece is not null
                             and c.piece <> v_p[5]),
                   'sans geste : trigger_purge_cron fait naître une pièce NEUVE');
  end if;
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
