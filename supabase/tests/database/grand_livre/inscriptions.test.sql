-- LES LIGNES DES ROUTES D'INSCRIPTION — la preuve qu'une route est passée, sous la pièce de compte_cree.
-- Écrites par le TypeScript (lib/comptes/journal-inscription.ts) à travers journaliser() : ce test rejoue
-- EXACTEMENT les formes que le module écrit, pour chaque population, sur des comptes FABRIQUÉS par le vrai
-- chemin (auth.users → handle_new_user, qui écrit compte_cree sous la même pièce). Il prouve que la base les
-- accepte, que la paire se lit sous une pièce, et qu'une clé hors liste est refusée.
--   expert_inscrit : expert freelance, expert CDI — réussie, puis échouée (compte nettoyé)
--   organisation_preinscrite : client, cabinet, ESN — réussie (sujet l'organisation), puis échouée (sujet le compte)
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(11);

-- Une inscription telle que la route l'envoie : la pièce et la voie dans les métadonnées.
create or replace function pg_temp.inscrire(p_id uuid, p_role text, p_piece uuid, p_voie text) returns void
language plpgsql as $$
declare v_slug text;
begin
  select d.slug into v_slug from public.domains d where d.id = pg_temp.fab_domaine();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
          'sonde+' || p_id || '@exemple.invalid', '', null, '{}'::jsonb,
          jsonb_build_object('role', p_role, 'domain_slug', v_slug, 'firstname', 'Sonde', 'lastname', 'Essai',
                             'piece', p_piece, 'voie', p_voie), now(), now());
end $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_dom uuid := pg_temp.fab_domaine();
  v_ids uuid[] := array(select gen_random_uuid() from generate_series(1, 4));
  v_p   uuid[] := array(select gen_random_uuid() from generate_series(1, 4));
  v_o   uuid[] := array(select gen_random_uuid() from generate_series(1, 4));
  v_q   uuid[] := array(select gen_random_uuid() from generate_series(1, 4));
  v_org uuid;
begin
  -- ── expert_inscrit, freelance : la forme réussie du module ──
  perform pg_temp.inscrire(v_ids[1], 'expert', v_p[1], 'inscription_expert');
  perform public.journaliser(v_p[1], 'expert_inscrit', 'reussi', 'utilisateur', v_ids[1], 'expert_freelance', v_dom,
                             'users', v_ids[1], jsonb_build_object('type_de_compte', 'expert_freelance', 'cgu_version', '2026-09'),
                             null::uuid, null::numeric, null::text);
  return next ok(pg_temp.lignes(v_p[1]) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.type_action = 'compte_cree' and g.sujet_id = v_ids[1])
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.type_action = 'expert_inscrit'
                              and g.statut = 'reussi' and g.acteur_id = v_ids[1] and g.acteur_type = 'expert_freelance'
                              and g.detail ->> 'cgu_version' = '2026-09'),
                 'expert freelance : compte_cree (trigger) ET expert_inscrit (route) sous la MÊME pièce');
  -- ── expert_inscrit, CDI ──
  perform pg_temp.inscrire(v_ids[2], 'cdi', v_p[2], 'inscription_expert');
  perform public.journaliser(v_p[2], 'expert_inscrit', 'reussi', 'utilisateur', v_ids[2], 'expert_cdi', v_dom,
                             'users', v_ids[2], jsonb_build_object('type_de_compte', 'expert_cdi', 'cgu_version', '2026-09'),
                             null::uuid, null::numeric, null::text);
  return next ok(pg_temp.lignes(v_p[2]) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[2] and g.type_action = 'expert_inscrit'
                              and g.acteur_type = 'expert_cdi' and g.detail ->> 'type_de_compte' = 'expert_cdi'),
                 'expert CDI : la paire sous la même pièce');
  -- ── échouée : la route a nettoyé le compte, la ligne le dit (un CODE) ──
  perform pg_temp.inscrire(v_ids[3], 'expert', v_p[3], 'inscription_expert');
  delete from public.users u where u.id = v_ids[3];
  delete from auth.users a where a.id = v_ids[3];
  perform public.journaliser(v_p[3], 'expert_inscrit', 'echoue', 'utilisateur', v_ids[3], 'expert_freelance', v_dom,
                             'users', v_ids[3], jsonb_build_object('type_de_compte', 'expert_freelance', 'cause', 'phone_already_used',
                                                                   'compte_nettoye', true),
                             null::uuid, null::numeric, null::text);
  return next ok(pg_temp.lignes(v_p[3]) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[3] and g.type_action = 'expert_inscrit'
                              and g.statut = 'echoue' and g.detail ->> 'cause' = 'phone_already_used'
                              and (g.detail ->> 'compte_nettoye')::boolean)
                 and not exists (select 1 from public.users u where u.id = v_ids[3]),
                 'échec : compte_cree reste (le compte a existé), expert_inscrit échouée dit qu''il est nettoyé et pourquoi');
  perform pg_temp.inscrire(v_ids[4], 'cdi', v_p[4], 'inscription_expert');
  perform public.journaliser(v_p[4], 'expert_inscrit', 'echoue', 'utilisateur', v_ids[4], 'expert_cdi', v_dom,
                             'users', v_ids[4], jsonb_build_object('type_de_compte', 'expert_cdi', 'cause', 'internal_error',
                                                                   'compte_nettoye', true),
                             null::uuid, null::numeric, null::text);
  return next is(pg_temp.lignes(v_p[4]), 2::bigint, 'échec d''un CDI : la forme échouée est acceptée');
  -- ── une clé hors liste : le téléphone n'entre pas ──
  return next throws_ok(format($q$select public.journaliser(%L, 'expert_inscrit', 'reussi', 'utilisateur', %L, 'expert_freelance', %L,
                                 'users', %L, '{"type_de_compte":"expert_freelance","telephone":"+33600000000"}'::jsonb,
                                 null::uuid, null::numeric, null::text)$q$, gen_random_uuid(), v_ids[1], v_dom, v_ids[1]),
                        'GL004', null, 'expert_inscrit : une clé hors liste (le téléphone) est refusée');
  -- ── une fois par geste ──
  return next throws_ok(format($q$select public.journaliser(%L, 'expert_inscrit', 'reussi', 'utilisateur', %L, 'expert_freelance', %L,
                                 'users', %L, '{"type_de_compte":"expert_freelance"}'::jsonb,
                                 null::uuid, null::numeric, null::text)$q$, v_p[1], v_ids[1], v_dom, v_ids[1]),
                        'GL005', null, 'expert_inscrit : une seconde ligne sous la même pièce est refusée (une fois par geste)');

  -- ── organisation_preinscrite : client, cabinet, ESN — l'organisation naît par creer_organisation_avec_admin ──
  perform pg_temp.inscrire(v_o[1], 'entreprise', v_q[1], 'preinscription_organisation');
  v_org := public.creer_organisation_avec_admin(v_o[1], v_dom, 'client', 'Sonde SAS', 'FR');
  perform public.journaliser(v_q[1], 'organisation_preinscrite', 'reussi', 'utilisateur', v_o[1], 'client', v_dom,
                             'organizations', v_org, jsonb_build_object('org_type', 'client', 'domaine_public', false),
                             null::uuid, null::numeric, null::text);
  return next ok(pg_temp.lignes(v_q[1]) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_q[1] and g.type_action = 'compte_cree' and g.acteur_type = 'client')
                 and exists (select 1 from public.grand_livre g where g.piece = v_q[1] and g.type_action = 'organisation_preinscrite'
                              and g.sujet_type = 'organizations' and g.sujet_id = v_org and g.detail ->> 'org_type' = 'client'),
                 'client : compte_cree (trigger) ET organisation_preinscrite (route, sujet l''organisation) sous la MÊME pièce');
  perform pg_temp.inscrire(v_o[2], 'cabinet', v_q[2], 'preinscription_organisation');
  v_org := public.creer_organisation_avec_admin(v_o[2], v_dom, 'cabinet', 'Sonde Cabinet', 'FR');
  perform public.journaliser(v_q[2], 'organisation_preinscrite', 'reussi', 'utilisateur', v_o[2], 'cabinet', v_dom,
                             'organizations', v_org, jsonb_build_object('org_type', 'cabinet', 'domaine_public', true),
                             null::uuid, null::numeric, null::text);
  return next ok(pg_temp.lignes(v_q[2]) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_q[2] and g.type_action = 'organisation_preinscrite'
                              and g.acteur_type = 'cabinet' and (g.detail ->> 'domaine_public')::boolean),
                 'cabinet : la paire sous la même pièce, domaine public dit');
  perform pg_temp.inscrire(v_o[3], 'cabinet', v_q[3], 'preinscription_organisation');
  v_org := public.creer_organisation_avec_admin(v_o[3], v_dom, 'esn', 'Sonde ESN', 'FR');
  perform public.journaliser(v_q[3], 'organisation_preinscrite', 'reussi', 'utilisateur', v_o[3], 'cabinet', v_dom,
                             'organizations', v_org, jsonb_build_object('org_type', 'esn', 'domaine_public', false),
                             null::uuid, null::numeric, null::text);
  return next ok(pg_temp.lignes(v_q[3]) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_q[3] and g.type_action = 'organisation_preinscrite'
                              and g.acteur_type = 'cabinet' and g.detail ->> 'org_type' = 'esn'),
                 'ESN : le compte est un cabinet, l''organisation est esn — la paire sous la même pièce');
  -- ── échouée : l'organisation était née, elle part avec le compte ; le sujet est le compte ──
  perform pg_temp.inscrire(v_o[4], 'entreprise', v_q[4], 'preinscription_organisation');
  v_org := public.creer_organisation_avec_admin(v_o[4], v_dom, 'client', 'Sonde Echec', 'FR');
  delete from public.organizations o where o.id = v_org;
  delete from public.users u where u.id = v_o[4];
  delete from auth.users a where a.id = v_o[4];
  perform public.journaliser(v_q[4], 'organisation_preinscrite', 'echoue', 'utilisateur', v_o[4], 'client', v_dom,
                             'users', v_o[4], jsonb_build_object('org_type', 'client', 'cause', 'email_domain_taken',
                                                                 'compte_nettoye', true, 'organisation_nettoyee', true),
                             null::uuid, null::numeric, null::text);
  return next ok(pg_temp.lignes(v_q[4]) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_q[4] and g.type_action = 'organisation_preinscrite'
                              and g.statut = 'echoue' and g.sujet_type = 'users' and (g.detail ->> 'organisation_nettoyee')::boolean)
                 and not exists (select 1 from public.organizations o where o.id = v_org),
                 'échec : la ligne dit le compte ET l''organisation nettoyés, et pourquoi (un code)');
  return next throws_ok(format($q$select public.journaliser(%L, 'organisation_preinscrite', 'reussi', 'utilisateur', %L, 'client', %L,
                                 'organizations', %L, '{"org_type":"client","siren":"123456789"}'::jsonb,
                                 null::uuid, null::numeric, null::text)$q$, gen_random_uuid(), v_o[1], v_dom, gen_random_uuid()),
                        'GL004', null, 'organisation_preinscrite : une clé hors liste (l''identifiant d''entreprise) est refusée');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
