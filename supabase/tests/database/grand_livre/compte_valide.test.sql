-- compte_valide / compte_refuse — statuer_sur_expert(), statuer_sur_organisation() et leur écrivain unique
-- journaliser_verification() : le verdict, le drapeau du compte et la ligne, ensemble ; rejeu null ; le motif
-- n'entre pas dans la ligne ; l'organisation s'écrit sans écosystème.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(10);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_admin();
  v_profil uuid := pg_temp.fab_profil('expert');
  v_org    uuid := pg_temp.fab_organisation(pg_temp.fab_compte('entreprise'));
  v_statut text;
  v_p1     uuid := gen_random_uuid();
  v_p2     uuid := gen_random_uuid();
  v_p3     uuid := gen_random_uuid();
  v_p4     uuid := gen_random_uuid();
  v_p5     uuid := gen_random_uuid();
  v_id     bigint;
  v_r      jsonb;
begin
  select p.verification_status into v_statut from public.profiles p where p.id = v_profil;
  v_r := public.statuer_sur_expert(v_p1, null, 'administrateur', v_admin, 'admin', v_profil, v_statut, true, null);
  return next ok(v_r ->> 'verified_at' is not null, 'l''expert est approuvé, la base rend la date');
  return next ok(exists (select 1 from public.profiles p join public.users u on u.id = p.user_id
                          where p.id = v_profil and p.verification_status = 'approved' and u.is_verified),
                 'le profil ET le drapeau du compte sont relus');
  return next ok(pg_temp.lignes(v_p1) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p1
                  and g.type_action = 'compte_valide' and g.sujet_type = 'profiles' and (g.detail ->> 'has_reason')::boolean = false),
                 'exactement UNE ligne compte_valide, sujet le profil');
  return next ok(public.statuer_sur_expert(v_p2, null, 'administrateur', v_admin, 'admin', v_profil, v_statut, true, null) is null
                 and pg_temp.lignes(v_p2) = 0,
                 'le rejeu (statut plus admis) rend null et n''écrit rien');
  v_r := public.statuer_sur_expert(v_p3, null, 'administrateur', v_admin, 'admin', v_profil, 'approved', false, 'motif de sonde');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p3 and g.type_action = 'compte_refuse'
                          and (g.detail ->> 'has_reason')::boolean and g.detail ->> 'de' = 'approved'),
                 'le refus passe par le MÊME écrivain et écrit compte_refuse');
  return next ok(not exists (select 1 from public.grand_livre g where g.piece = v_p3 and g.detail::text like '%motif de sonde%'),
                 'le motif en texte libre n''entre pas dans la ligne');
  select o.verification_status into v_statut from public.organizations o where o.id = v_org;
  v_r := public.statuer_sur_organisation(v_p4, null, 'administrateur', v_admin, 'admin', v_org, v_statut, true, null);
  return next ok(v_r ->> 'verified_at' is not null and exists (select 1 from public.organizations o where o.id = v_org and o.verification_status = 'approved'),
                 'l''organisation est approuvée, relue');
  return next ok(pg_temp.lignes(v_p4) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p4
                  and g.type_action = 'compte_valide' and g.sujet_type = 'organizations' and g.ecosysteme_id is null),
                 'la ligne d''organisation n''a pas d''écosystème (une organisation en rejoint plusieurs)');
  -- L'écrivain unique, appelé EN DIRECT : le code dérive du verdict, un arbitrage sans auteur est refusé.
  v_id := public.journaliser_verification(v_p5, null, 'administrateur', v_admin, 'admin', null,
                                          'profiles', v_profil, false, '{"has_reason":false}'::jsonb);
  return next ok(exists (select 1 from public.grand_livre g
                          where g.id = v_id and g.type_action = 'compte_refuse' and g.piece = v_p5),
                 'journaliser_verification : approuve=false → compte_refuse, sous la pièce donnée');
  return next throws_ok(format($q$select public.journaliser_verification(%L, null, 'systeme', null, null, null, 'profiles', %L, true, '{}'::jsonb)$q$,
                               gen_random_uuid(), v_profil),
                        'GL002', null, 'journaliser_verification : un arbitrage sans auteur est refusé');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
