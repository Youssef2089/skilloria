-- LA CRÉATION D'UN ADMINISTRATEUR — promouvoir_administrateur(), l'écrivain UNIQUE, appelé par create-admin
-- (origine administrateur) et par le script du jour zéro (origine système). Sur des comptes FABRIQUÉS par le
-- vrai chemin : auth.users (rôle de pont 'entreprise', voie déclarée 'administrateur') → handle_new_user
-- (compte_cree) → promotion (administrateur_cree), sous la MÊME pièce. Puis ce que la base refuse.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(9);

-- Un compte créé POUR l'administration, tel que create-admin l'envoie : pièce et voie dans les métadonnées.
create or replace function pg_temp.compte_pour_admin(p_id uuid, p_piece uuid) returns void
language plpgsql as $$
declare v_slug text;
begin
  select d.slug into v_slug from public.domains d where d.id = pg_temp.fab_domaine();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
          'sonde+' || p_id || '@exemple.invalid', '', now(), '{}'::jsonb,
          jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug, 'firstname', 'Sonde', 'lastname', 'Admin',
                             'piece', p_piece, 'voie', 'administrateur'), now(), now());
end $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_dom    uuid := pg_temp.fab_domaine();
  v_admin  uuid := pg_temp.fab_admin();
  v_client uuid := pg_temp.fab_compte('entreprise');
  v_expert uuid := pg_temp.fab_compte('expert');
  v_role   uuid;
  v_ids    uuid[] := array(select gen_random_uuid() from generate_series(1, 3));
  v_p      uuid[] := array(select gen_random_uuid() from generate_series(1, 6));
  v_r      text;
begin
  select r.id into v_role from public.roles r where r.name = 'Admin' and r.active;

  -- ── create-admin : un administrateur en crée un autre ──
  perform pg_temp.compte_pour_admin(v_ids[1], v_p[1]);
  v_r := public.promouvoir_administrateur(v_p[1], null, 'administrateur', v_admin, 'admin', v_ids[1], v_role);
  return next ok(v_r = 'reussi' and exists (select 1 from public.users u where u.id = v_ids[1] and u.user_type = 'admin'
                                              and u.role_id = v_role and u.status = 'active' and u.email_verified),
                 'create-admin : le compte est promu (admin, rôle Admin, actif, adresse vérifiée)');
  return next ok(pg_temp.lignes(v_p[1]) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.type_action = 'compte_cree'
                              and g.origine = 'systeme' and g.acteur_id is null and g.detail ->> 'voie_declaree' = 'administrateur')
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.type_action = 'administrateur_cree'
                              and g.statut = 'reussi' and g.origine = 'administrateur' and g.acteur_id = v_admin and g.acteur_type = 'admin'
                              and g.sujet_id = v_ids[1] and g.ecosysteme_id = v_dom and not (g.detail ->> 'jour_zero')::boolean),
                 'create-admin : compte_cree (trigger) ET administrateur_cree (acteur l''administrateur) sous la MÊME pièce');
  -- ── le jour zéro : personne pour créer le premier ──
  perform pg_temp.compte_pour_admin(v_ids[2], v_p[2]);
  v_r := public.promouvoir_administrateur(v_p[2], null, 'systeme', null, null, v_ids[2], v_role);
  return next ok(v_r = 'reussi' and exists (select 1 from public.grand_livre g where g.piece = v_p[2] and g.type_action = 'administrateur_cree'
                                              and g.origine = 'systeme' and g.acteur_id is null and (g.detail ->> 'jour_zero')::boolean),
                 'jour zéro : promu, origine système, sans acteur, jour_zero vrai');
  -- ── AD001 : un compte qui n'a pas été créé pour l'administration ne se promeut pas — et ça s'écrit ──
  v_r := public.promouvoir_administrateur(v_p[3], null, 'administrateur', v_admin, 'admin', v_client, v_role);
  return next ok(v_r = 'echoue' and exists (select 1 from public.users u where u.id = v_client and u.user_type = 'client'),
                 'AD001 : un client existant (voie non déclarée) reste client');
  return next ok(pg_temp.lignes(v_p[3]) = 1
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[3] and g.type_action = 'administrateur_cree'
                              and g.statut = 'echoue' and g.detail ->> 'cause' = 'AD001' and g.sujet_id = v_client),
                 'AD001 : la ligne est ÉCHOUÉE, cause AD001, sur le compte visé');
  v_r := public.promouvoir_administrateur(v_p[4], null, 'administrateur', v_admin, 'admin', v_expert, v_role);
  return next ok(v_r = 'echoue' and exists (select 1 from public.users u where u.id = v_expert and u.user_type = 'expert_freelance'),
                 'AD001 : un expert ne se promeut pas');
  -- ── AD002 : un acteur qui n'est pas administrateur — refusé, rien n'est écrit ──
  perform pg_temp.compte_pour_admin(v_ids[3], v_p[6]);
  return next throws_ok(format($q$select public.promouvoir_administrateur(%L, null, 'administrateur', %L, 'client', %L, %L)$q$,
                               v_p[5], v_client, v_ids[3], v_role),
                        'AD002', null, 'AD002 : un client qui se dit administrateur est refusé');
  return next ok(pg_temp.lignes(v_p[5]) = 0 and exists (select 1 from public.users u where u.id = v_ids[3] and u.user_type = 'client'),
                 'AD002 : aucune ligne, aucune promotion');
  -- ── la fonction est fermée au navigateur ──
  return next ok(not has_function_privilege('authenticated', 'public.promouvoir_administrateur(uuid, uuid, text, uuid, text, uuid, uuid)', 'execute')
                 and not has_function_privilege('anon', 'public.promouvoir_administrateur(uuid, uuid, text, uuid, text, uuid, uuid)', 'execute'),
                 'promouvoir_administrateur : ni authenticated ni anon ne peuvent l''exécuter');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
