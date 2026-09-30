-- LES TYPES D'EXPÉRIENCE : UNE LISTE, LUE PAR LA CONTRAINTE (§E.88). Un type hors liste est refusé
-- par la table ; `types_experience()` rend la liste que le code TypeScript porte en miroir
-- (lib/profil/types-experience.ts, comparé par diag-parcours-expert).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(4);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil  uuid := pg_temp.fab_profil('expert');
  v_domaine uuid;
begin
  select p.domain_id into v_domaine from public.profiles p where p.id = v_profil;
  return next is(public.types_experience(), array['career', 'project']::text[], 'types_experience() rend la liste');
  return next ok(exists (select 1 from pg_constraint c
                          where c.conrelid = 'public.profile_experiences'::regclass
                            and c.conname = 'profile_experiences_experience_type_check'
                            and pg_get_constraintdef(c.oid) ~ 'types_experience\(\)'),
                 'la contrainte LIT la fonction : une seule liste en base');
  return next lives_ok(format($q$insert into public.profile_experiences (profile_id, domain_id, experience_type, role, start_date)
                                 values (%L, %L, 'career', 'Sonde', date '2020-01-01')$q$, v_profil, v_domaine),
                       'un type de la liste est accepté');
  return next throws_ok(format($q$insert into public.profile_experiences (profile_id, domain_id, experience_type, role, start_date)
                                  values (%L, %L, 'mission', 'Sonde', date '2020-01-01')$q$, v_profil, v_domaine),
                        '23514', null, 'un type HORS liste (« mission ») est refusé par la table');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
