-- tests/integration/semences-acces.sql — LES COMPTES ET LES DONNÉES DU BANC DES ROUTES (lot DevOps CI).
--
-- Exécuté par tests/integration/acces-routes.mjs, sur la base JETABLE du runner, en postgres, et VALIDÉ
-- (contrairement aux tests pgTAP, rien n'est annulé : l'application démarrée doit voir ces lignes).
-- Les comptes naissent par l'inscription (fabriques : auth.users → handle_new_user, avec leur preuve), puis
-- reçoivent un mot de passe pour que GoTrue les connecte comme un navigateur. RGPD : adresses en `.invalid`.
-- La dernière ligne imprimée, `REFERENCES:{…}`, rend au banc les identifiants et les adresses.
\ir ../../supabase/tests/database/grand_livre/_fabriques.psql

create or replace function pg_temp.fab_compte_esn() returns uuid
language plpgsql as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := pg_temp.fab_email(v_id);
begin
  perform pg_temp.fab_auth(v_id, v_email,
    pg_temp.fab_signer(v_email, pg_temp.fab_meta('cabinet', v_id) || jsonb_build_object('org_type', 'esn')));
  if not exists (select 1 from public.users u where u.id = v_id) then
    raise exception 'semences : le compte ESN % n est pas ne', v_id;
  end if;
  return v_id;
end $$;

create temp table refs (ref text primary key, valeur text not null);

insert into refs values ('domaine', pg_temp.fab_domaine()::text);
insert into refs select 'slug', d.slug from public.domains d where d.id = pg_temp.fab_domaine();

insert into refs values ('expert_a', pg_temp.fab_compte('expert')::text);
insert into refs values ('expert_b', pg_temp.fab_compte('expert')::text);
insert into refs values ('cdi',      pg_temp.fab_compte('cdi')::text);
insert into refs values ('client_a', pg_temp.fab_compte('entreprise')::text);
insert into refs values ('client_b', pg_temp.fab_compte('entreprise')::text);
insert into refs values ('cabinet',  pg_temp.fab_compte('cabinet')::text);
insert into refs values ('esn',      pg_temp.fab_compte_esn()::text);
insert into refs values ('admin',    pg_temp.fab_admin()::text);

-- Les profils et les organisations nés avec les comptes.
insert into refs select 'profil_' || r.ref, p.id::text
  from refs r join public.profiles p on p.user_id = r.valeur::uuid where r.ref in ('expert_a', 'expert_b', 'cdi');
insert into refs select 'org_' || r.ref, m.organization_id::text
  from refs r join public.organization_members m on m.user_id = r.valeur::uuid and m.status = 'active'
 where r.ref in ('client_a', 'client_b', 'cabinet', 'esn');
insert into refs select 'membre_' || r.ref, m.id::text
  from refs r join public.organization_members m on m.user_id = r.valeur::uuid and m.status = 'active'
 where r.ref in ('client_a', 'client_b');

-- Une annonce publiée par chaque client ; deux candidatures croisées ; un rapprochement et une notification par expert.
insert into refs select 'pub_a', pg_temp.fab_annonce_publiee((select valeur::uuid from refs where ref = 'org_client_a'),
                                                           (select valeur::uuid from refs where ref = 'client_a'))::text;
insert into refs select 'pub_b', pg_temp.fab_annonce_publiee((select valeur::uuid from refs where ref = 'org_client_b'),
                                                           (select valeur::uuid from refs where ref = 'client_b'))::text;
insert into refs select 'cand_a', pg_temp.fab_candidature((select valeur::uuid from refs where ref = 'pub_b'),
                                                        (select valeur::uuid from refs where ref = 'profil_expert_a'))::text;
insert into refs select 'cand_b', pg_temp.fab_candidature((select valeur::uuid from refs where ref = 'pub_a'),
                                                        (select valeur::uuid from refs where ref = 'profil_expert_b'))::text;
with m as (
  insert into public.matches (publication_id, profile_id, domain_id, status)
  select (select valeur::uuid from refs where ref = x.pub), (select valeur::uuid from refs where ref = x.profil), pg_temp.fab_domaine(), 'notified'
    from (values ('pub_a', 'profil_expert_a', 'match_a'), ('pub_b', 'profil_expert_b', 'match_b')) x(pub, profil, ref)
  returning id, publication_id
)
insert into refs select case when m.publication_id = (select valeur::uuid from refs where ref = 'pub_a') then 'match_a' else 'match_b' end, m.id::text from m;
with n as (
  insert into public.notifications (user_id, domain_id, type)
  select (select valeur::uuid from refs where ref = x.compte), pg_temp.fab_domaine(), 'new_match_opportunity'
    from (values ('expert_a'), ('expert_b')) x(compte)
  returning id, user_id
)
insert into refs select case when n.user_id = (select valeur::uuid from refs where ref = 'expert_a') then 'notif_a' else 'notif_b' end, n.id::text from n;

-- Le mot de passe, pour la connexion par GoTrue ; et les jetons textuels à '' (GoTrue ne lit pas un NULL).
update auth.users u set encrypted_password = extensions.crypt(:'mdp', extensions.gen_salt('bf'))
 where u.id in (select valeur::uuid from refs where ref in ('expert_a', 'expert_b', 'cdi', 'client_a', 'client_b', 'cabinet', 'esn', 'admin'));
do $$
declare c text;
begin
  for c in select column_name from information_schema.columns
            where table_schema = 'auth' and table_name = 'users' and is_generated = 'NEVER'
              and data_type in ('character varying', 'text')
              and (column_name like '%token%' or column_name in ('email_change', 'phone_change'))
  loop
    execute format('update auth.users set %I = coalesce(%I, %L) where email like %L', c, c, '', 'sonde+%');
  end loop;
end $$;

insert into refs select 'email_' || r.ref, u.email from refs r join auth.users u on u.id = r.valeur::uuid
 where r.ref in ('expert_a', 'expert_b', 'cdi', 'client_a', 'client_b', 'cabinet', 'esn', 'admin');

select 'REFERENCES:' || json_object_agg(ref, valeur)::text from refs;
