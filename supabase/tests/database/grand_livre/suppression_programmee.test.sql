-- suppression_programmee — programmer_suppression_compte() : le jalon et la ligne, ensemble ; un compte
-- inconnu rend « introuvable » sans ligne.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(4);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_user uuid := pg_temp.fab_compte('expert');
  v_p1   uuid := gen_random_uuid();
  v_p2   uuid := gen_random_uuid();
begin
  return next is(public.programmer_suppression_compte(v_p1, null, 'utilisateur', v_user, 'expert_freelance', v_user, now() + interval '90 days', 90),
                 'ok', 'la suppression est programmée');
  return next ok(exists (select 1 from public.users u where u.id = v_user and u.deletion_scheduled_at is not null), 'le jalon est posé');
  return next ok(pg_temp.lignes(v_p1) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p1
                  and g.type_action = 'suppression_programmee' and (g.detail ->> 'grace_jours')::int = 90),
                 'exactement UNE ligne, avec la durée de grâce');
  return next ok(public.programmer_suppression_compte(v_p2, null, 'utilisateur', v_user, 'expert_freelance', gen_random_uuid(), now() + interval '90 days', 90) = 'introuvable'
                 and pg_temp.lignes(v_p2) = 0,
                 'un compte inconnu rend « introuvable » et n''écrit rien');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
