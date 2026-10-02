-- « AUTRE » EST UNE SPÉCIALITÉ PUBLIABLE (B4) — la contrainte `profiles_visible_requiert_criteres_check` accepte
-- une précision « Autre » non vide à la place d'une spécialité du référentiel ; sans l'une ni l'autre, elle refuse.
-- Le profil fabriqué naît EXACTEMENT dans ce cas : inscrit avec « Autre » (speciality_other = 'Sonde'), aucune
-- spécialité du référentiel — celui qu'aucun écran ne pouvait publier.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(3);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil uuid := pg_temp.fab_profil('expert');
  v_zone   uuid;
begin
  select z.id into v_zone from public.work_zones z where z.active order by z.id limit 1;
  return next ok((select coalesce(array_length(p.speciality_ids, 1), 0) = 0 and p.speciality_other = 'Sonde' from public.profiles p where p.id = v_profil),
                 'le profil fabriqué est « Autre », sans spécialité du référentiel');
  return next lives_ok(format($q$update public.profiles set
      visible = true, seniorities = array['senior'], work_zone_ids = array[%L::uuid], availability_status = 'available',
      summary = %L
    where id = %L$q$, v_zone, repeat('Résumé de sonde. ', 20), v_profil),
    'avec « Autre » et les autres critères, le profil est PUBLIABLE');
  return next throws_ok(format($q$update public.profiles set speciality_other = null where id = %L$q$, v_profil),
                        '23514', null, 'sans spécialité ni « Autre », la contrainte refuse un profil visible');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
