-- UNE MISSION POSTULÉE SORT DES RECOMMANDATIONS (lot alertes) — `mission_postulee(matches)`, le champ calculé que lit le
-- flux de l'expert et son compteur (lib/missions/feed.ts) : faux avant la candidature, vrai après, propre à l'expert
-- qui a postulé (celle d'un autre ne compte pas), et fermé au navigateur.
-- Comptes, organisation, annonces et candidature naissent par les chemins normaux (fabriques) ; les correspondances
-- sont FABRIQUÉES (le moteur les pose en production), comme dans mission_ecartee.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(7);

create or replace function pg_temp.proposer(p_pub uuid, p_profil uuid) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.matches (publication_id, profile_id, domain_id, status)
  values (p_pub, p_profil, pg_temp.fab_domaine(), 'notified')
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.postulee(p_match uuid) returns boolean
language sql as $$ select public.mission_postulee(m) from public.matches m where m.id = p_match $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin   uuid := pg_temp.fab_compte('entreprise');
  v_org     uuid := pg_temp.fab_organisation(v_admin);
  v_pub1    uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_pub2    uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_profil  uuid := pg_temp.fab_profil('expert');
  v_autre   uuid := pg_temp.fab_profil('expert');
  v_m1      uuid := pg_temp.proposer(v_pub1, v_profil);
  v_m2      uuid := pg_temp.proposer(v_pub2, v_profil);
  v_m_autre uuid := pg_temp.proposer(v_pub1, v_autre);
begin
  return next is(pg_temp.postulee(v_m1), false, 'avant la candidature, la mission n''est pas postulée : elle reste recommandée');

  perform pg_temp.fab_candidature(v_pub1, v_profil);

  return next is(pg_temp.postulee(v_m1), true, 'après la candidature, la mission est postulée : elle sort des recommandations');
  return next is(pg_temp.postulee(v_m2), false, 'une autre annonce du même expert, sans candidature, reste recommandée');
  return next is(pg_temp.postulee(v_m_autre), false, 'la candidature d''un AUTRE expert sur la même annonce ne retire rien au sien');
  return next is((select count(*) from public.matches m where m.profile_id = v_profil and not public.mission_postulee(m)),
                 1::bigint, 'le filtre du flux (« non postulée ») ne garde que la mission sans candidature — et le compte suit');
  return next ok(not has_function_privilege('authenticated', 'public.mission_postulee(public.matches)', 'execute')
                 and not has_function_privilege('anon', 'public.mission_postulee(public.matches)', 'execute'),
                 'la fonction est fermée au navigateur');
  return next ok(has_function_privilege('service_role', 'public.mission_postulee(public.matches)', 'execute'),
                 'le serveur (service_role) la lit');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
