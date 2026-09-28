-- LA CRÉATION D'UN ADMINISTRATEUR — promouvoir_administrateur(), l'écrivain UNIQUE de administrateur_cree,
-- appelé désormais par handle_new_user DANS LA TRANSACTION du compte (§D.27), sur la voie « administrateur »
-- PROUVÉE : create-admin (un acteur administrateur) et le script du jour zéro (sans acteur). Sur des comptes
-- FABRIQUÉS par le vrai chemin (preuve signée) : compte_cree ET administrateur_cree, sous la MÊME pièce.
-- Puis ce que la base refuse : la promotion d'un compte qui n'a pas été créé pour l'administration (AD001, écrite),
-- un acteur qui n'est pas administrateur (AD002 en appel direct, refus d'inscription par la voie).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(9);

-- Un compte créé POUR l'administration, tel que create-admin l'envoie : la voie, la pièce, l'acteur — signés.
create or replace function pg_temp.compte_pour_admin(p_id uuid, p_piece uuid, p_acteur uuid) returns text
language plpgsql as $$
declare
  v_slug  text;
  v_email text := pg_temp.fab_email(p_id);
begin
  select d.slug into v_slug from public.domains d where d.id = pg_temp.fab_domaine();
  perform pg_temp.fab_auth(p_id, v_email, pg_temp.fab_signer(v_email,
    jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug, 'firstname', 'Sonde', 'lastname', 'Admin',
                       'piece', p_piece::text, 'voie', 'administrateur', 'acteur_id', coalesce(p_acteur::text, ''))), true);
  return 'cree';
exception when others then
  return sqlstate || ' ' || sqlerrm;
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

  -- ── create-admin : un administrateur en crée un autre — une création, une transaction ──
  v_r := pg_temp.compte_pour_admin(v_ids[1], v_p[1], v_admin);
  return next ok(v_r = 'cree' and exists (select 1 from public.users u where u.id = v_ids[1] and u.user_type = 'admin'
                                            and u.role_id = v_role and u.status = 'active' and u.email_verified),
                 'create-admin : le compte naît promu (admin, rôle Admin, actif, adresse vérifiée)');
  return next ok(pg_temp.lignes(v_p[1]) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.type_action = 'compte_cree'
                              and g.origine = 'systeme' and g.acteur_id is null and g.detail ->> 'voie_declaree' = 'administrateur')
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.type_action = 'administrateur_cree'
                              and g.statut = 'reussi' and g.origine = 'administrateur' and g.acteur_id = v_admin and g.acteur_type = 'admin'
                              and g.sujet_id = v_ids[1] and g.ecosysteme_id = v_dom and not (g.detail ->> 'jour_zero')::boolean),
                 'create-admin : compte_cree ET administrateur_cree (acteur l''administrateur) sous la MÊME pièce');
  -- ── le jour zéro : personne pour créer le premier ──
  v_r := pg_temp.compte_pour_admin(v_ids[2], v_p[2], null);
  return next ok(v_r = 'cree' and exists (select 1 from public.grand_livre g where g.piece = v_p[2] and g.type_action = 'administrateur_cree'
                                            and g.origine = 'systeme' and g.acteur_id is null and (g.detail ->> 'jour_zero')::boolean),
                 'jour zéro : promu, origine système, sans acteur, jour_zero vrai');
  -- ── un acteur qui n'est pas administrateur : la voie refuse, RIEN n'existe ──
  v_r := pg_temp.compte_pour_admin(v_ids[3], v_p[6], v_client);
  return next ok(v_r = 'IN010 inscription refusee : acteur_non_admin'
                 and not exists (select 1 from public.users u where u.id = v_ids[3]) and pg_temp.lignes(v_p[6]) = 0,
                 'un client qui se dit administrateur : refusé à l''inscription, ni compte ni ligne');
  -- ── AD001 : un compte qui n'a pas été créé pour l'administration ne se promeut pas — et ça s'écrit ──
  v_r := public.promouvoir_administrateur(v_p[3], null, 'administrateur', v_admin, 'admin', v_client, v_role);
  return next ok(v_r = 'echoue' and exists (select 1 from public.users u where u.id = v_client and u.user_type = 'client'),
                 'AD001 : un client existant (voie non administrateur) reste client');
  return next ok(pg_temp.lignes(v_p[3]) = 1
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[3] and g.type_action = 'administrateur_cree'
                              and g.statut = 'echoue' and g.detail ->> 'cause' = 'AD001' and g.sujet_id = v_client),
                 'AD001 : la ligne est ÉCHOUÉE, cause AD001, sur le compte visé');
  v_r := public.promouvoir_administrateur(v_p[4], null, 'administrateur', v_admin, 'admin', v_expert, v_role);
  return next ok(v_r = 'echoue' and exists (select 1 from public.users u where u.id = v_expert and u.user_type = 'expert_freelance'),
                 'AD001 : un expert ne se promeut pas');
  -- ── AD002 : un acteur qui n'est pas administrateur, en appel direct — refusé, rien n'est écrit ──
  return next throws_ok(format($q$select public.promouvoir_administrateur(%L, null, 'administrateur', %L, 'client', %L, %L)$q$,
                               v_p[5], v_client, v_expert, v_role),
                        'AD002', null, 'AD002 : un client qui se dit administrateur est refusé');
  -- ── la fonction est fermée au navigateur ──
  return next ok(not has_function_privilege('authenticated', 'public.promouvoir_administrateur(uuid, uuid, text, uuid, text, uuid, uuid)', 'execute')
                 and not has_function_privilege('anon', 'public.promouvoir_administrateur(uuid, uuid, text, uuid, text, uuid, uuid)', 'execute')
                 and pg_temp.lignes(v_p[5]) = 0,
                 'promouvoir_administrateur : fermée au navigateur ; AD002 n''a rien écrit');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
