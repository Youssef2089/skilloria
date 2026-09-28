-- LES LIGNES DES ROUTES D'INSCRIPTION — la preuve qu'une route est passée, sous la pièce de compte_cree.
-- Écrites par le TypeScript (lib/comptes/journal-inscription.ts) à travers journaliser() : ce test rejoue
-- EXACTEMENT les formes que le module écrit, pour chaque population, sur des comptes FABRIQUÉS par le vrai
-- chemin (auth.users → handle_new_user, qui écrit compte_cree sous la même pièce). Il prouve que la base les
-- accepte, que la paire se lit sous une pièce, et qu'une clé hors liste est refusée.
--   expert_inscrit : expert freelance, expert CDI — réussie, puis échouée (compte nettoyé)
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(6);

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
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
