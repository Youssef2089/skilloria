-- LES HUIT FONCTIONS RECRÉÉES PAR ecritures_effectives (§E.74) — chacune tourne sur son chemin normal
-- (l'effet est relu), puis sur un identifiant inventé : zéro ligne touchée lève EC001, au lieu de passer
-- en silence ou de rendre null. handle_email_confirmed : la confirmation d'une adresse active le miroir.
begin;
create extension if not exists pgtap with schema extensions;
\ir grand_livre/_fabriques.psql
select plan(15);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil uuid := pg_temp.fab_profil('expert');
  v_user   uuid;
  v_evt    text := 'evt_sonde_' || replace(gen_random_uuid()::text, '-', '');
  v_due    timestamptz;
  v_n      integer;
  v_r      text;
  v_nc     uuid := gen_random_uuid();
begin
  select p.user_id into v_user from public.profiles p where p.id = v_profil;

  -- ── handle_email_confirmed : le vrai chemin — un compte inscrit NON confirmé (la fabrique, elle, crée
  --    des comptes déjà confirmés), puis GoTrue pose email_confirmed_at ──
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', v_nc, 'authenticated', 'authenticated',
         'sonde+' || v_nc || '@exemple.invalid', '', null, '{}'::jsonb,
         jsonb_build_object('role', 'entreprise', 'domain_slug', d.slug, 'firstname', 'Sonde', 'lastname', 'Essai'), now(), now()
    from public.domains d where d.id = pg_temp.fab_domaine();
  return next ok(exists (select 1 from public.users u where u.id = v_nc and not u.email_verified and u.status = 'draft'),
                 'inscription non confirmée : miroir en brouillon, adresse non vérifiée');
  update auth.users set email_confirmed_at = now() where id = v_nc;
  return next ok(exists (select 1 from public.users u where u.id = v_nc and u.email_verified and u.status = 'active'),
                 'handle_email_confirmed : l''adresse confirmée active le miroir (draft → active)');

  -- ── la relance : programmer, marquer, échouer, solder ──
  v_due := public.programmer_relance_expert(v_profil, interval '10 minutes', 'sonde');
  return next ok(v_due is not null and exists (select 1 from public.profiles p where p.id = v_profil and p.matching_relance_due_at = v_due),
                 'programmer_relance_expert : l''échéance est posée et rendue');
  v_n := public.marquer_tentative_relance(v_profil);
  return next is(v_n, 1, 'marquer_tentative_relance : la tentative est comptée');
  perform public.echouer_relance_expert(v_profil, 'sonde_echec');
  return next ok(exists (select 1 from public.profiles p where p.id = v_profil and p.matching_relance_echec_code = 'sonde_echec'),
                 'echouer_relance_expert : l''échec est daté et nommé');
  return next ok(public.solder_relance_expert(v_profil, now() + interval '1 hour'), 'solder_relance_expert : la relance due est soldée');
  return next ok(not public.solder_relance_expert(v_profil, now()), 'solder_relance_expert : rien de dû — la seconde écriture touche le profil, rend false');

  -- ── stripe_event_mark : l'événement réclamé puis clôturé ──
  perform public.stripe_event_reclamer(v_evt, 'invoice.paid', '{}'::jsonb, false, gen_random_uuid());
  perform public.stripe_event_mark(v_evt, 'processed');
  return next ok(exists (select 1 from public.stripe_events e where e.id = v_evt and e.status = 'processed' and e.processed_at is not null),
                 'stripe_event_mark : l''événement réclamé est clôturé');

  -- ── liberer_siege_plateforme : un compte hors du siège — rien à libérer, issue « ok » ──
  v_r := public.liberer_siege_plateforme(v_user, false);
  return next is(v_r, 'ok', 'liberer_siege_plateforme : un compte hors du siège n''a rien à libérer');

  -- ── trigger_purge_cron : un chemin invalide est refusé AVANT tout appel ──
  return next throws_ok($q$select public.trigger_purge_cron('sonde', 'pas-un-chemin')$q$, 'P0001', null,
                        'trigger_purge_cron : un chemin relatif est refusé avant tout appel');

  -- ── ZÉRO LIGNE : EC001, jamais le silence ──
  return next throws_ok(format('select public.programmer_relance_expert(%L, interval %L)', gen_random_uuid(), '10 minutes'),
                        'EC001', null, 'programmer_relance_expert : un profil inexistant lève EC001 (il rendait null)');
  return next throws_ok(format('select public.marquer_tentative_relance(%L)', gen_random_uuid()),
                        'EC001', null, 'marquer_tentative_relance : un profil inexistant lève EC001 (il rendait null)');
  return next throws_ok(format('select public.echouer_relance_expert(%L, %L)', gen_random_uuid(), 'x'),
                        'EC001', null, 'echouer_relance_expert : un profil inexistant lève EC001');
  return next throws_ok(format('select public.solder_relance_expert(%L, now())', gen_random_uuid()),
                        'EC001', null, 'solder_relance_expert : un profil inexistant lève EC001');
  return next throws_ok(format('select public.stripe_event_mark(%L, %L)', 'evt_inexistant_' || gen_random_uuid(), 'processed'),
                        'EC001', null, 'stripe_event_mark : un événement jamais réclamé lève EC001');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
