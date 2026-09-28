-- compte_suspendu / compte_reactive — changer_statut_compte() : une fonction, deux faces ; la transition
-- rejouée sous verrou ; et LA COURSE du point 2.6 : une cible DEVENUE administrateur entre la lecture et
-- l'écriture reçoit le refus NOMMÉ target_is_admin, jamais une erreur brute — l'acteur lui-même, self_forbidden.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(9);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_admin();
  v_cible  uuid := pg_temp.fab_compte('expert');
  v_course uuid := pg_temp.fab_compte('entreprise');
  v_statut text;
  v_p1     uuid := gen_random_uuid();
  v_p2     uuid := gen_random_uuid();
  v_p3     uuid := gen_random_uuid();
  v_p4     uuid := gen_random_uuid();
  v_p5     uuid := gen_random_uuid();
  v_r      jsonb;
begin
  select u.status into v_statut from public.users u where u.id = v_cible;
  v_r := public.changer_statut_compte(v_p1, null, 'administrateur', v_admin, 'admin', v_cible, array[v_statut], 'suspended', true);
  return next ok(v_r ->> 'vers' = 'suspended' and exists (select 1 from public.users u where u.id = v_cible and u.status = 'suspended'),
                 'le compte est suspendu, relu');
  return next ok(pg_temp.lignes(v_p1) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p1
                  and g.type_action = 'compte_suspendu' and g.detail ->> 'vers' = 'suspended' and g.detail ->> 'type_de_compte' = 'expert_freelance'),
                 'exactement UNE ligne compte_suspendu, avec le type de compte');
  return next ok(public.changer_statut_compte(v_p2, null, 'administrateur', v_admin, 'admin', v_cible, array[v_statut], 'suspended', true) is null
                 and pg_temp.lignes(v_p2) = 0,
                 'le rejeu (statut plus admis) rend null et n''écrit rien');
  v_r := public.changer_statut_compte(v_p3, null, 'administrateur', v_admin, 'admin', v_cible, array['suspended'], 'active', false);
  return next ok(v_r ->> 'vers' = 'active' and exists (select 1 from public.grand_livre g where g.piece = v_p3 and g.type_action = 'compte_reactive'
                                                        and g.detail ->> 'de' = 'suspended' and g.detail ->> 'vers' = 'active'),
                 'la réactivation passe par la MÊME fonction et écrit compte_reactive, de suspended vers active');
  -- L'ACTEUR LUI-MÊME : refus nommé, rien d'écrit.
  v_r := public.changer_statut_compte(v_p4, null, 'administrateur', v_admin, 'admin', v_admin, array['active'], 'suspended', true);
  return next is(v_r ->> 'refus', 'self_forbidden', 'un administrateur qui se vise lui-même reçoit self_forbidden');
  return next ok(pg_temp.lignes(v_p4) = 0 and exists (select 1 from public.users u where u.id = v_admin and u.status = 'active'),
                 '… et rien n''est écrit');
  -- LA COURSE : la cible DEVIENT administrateur entre la lecture de la route et l'écriture.
  select u.status into v_statut from public.users u where u.id = v_course;
  update public.users set user_type = 'admin', status = 'active' where id = v_course;
  v_r := public.changer_statut_compte(v_p5, null, 'administrateur', v_admin, 'admin', v_course, array[v_statut, 'active'], 'suspended', true);
  return next is(v_r ->> 'refus', 'target_is_admin', 'une cible devenue administrateur reçoit target_is_admin — jamais une erreur brute');
  return next ok(exists (select 1 from public.users u where u.id = v_course and u.status = 'active'), 'la cible n''est pas suspendue');
  return next is(pg_temp.lignes(v_p5), 0::bigint, 'la course n''écrit aucune ligne');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
