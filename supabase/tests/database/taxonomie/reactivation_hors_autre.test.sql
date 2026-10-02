-- UNE SPÉCIALITÉ RÉACTIVÉE NE REVIENT PAS SOUS « AUTRE » (relecteur, 02/10/2026 ; lot zones de travail, point 6) —
-- migration `specialite_reactivation_hors_autre` :
--   A. réactiver une spécialité dont une traduction EXISTANTE est « Other » (ou « Otra ») est refusé, sous la
--      contrainte NOMMÉE (23514, specialities_autre_hors_referentiel — ce que l'administration rend
--      specialite_autre_reservee), et la ligne reste inactive ;
--   B. la traduction remplacée D'ABORD (ce que fait la route quand le même geste la corrige), la réactivation passe ;
--   C. une spécialité sans traduction « Autre » se désactive et se réactive librement ; une mise à jour qui ne touche
--      pas `active` ne déclenche rien.
-- Données FABRIQUÉES ; la branche est LUE en base, jamais en dur.
-- Colonnes et contraintes lues (§G.10) : specialities (name, slug, active NOT NULL, branch_id, domain_id ; contrainte
-- specialities_autre_hors_referentiel) ; translations (table_name, row_id sans clé étrangère, field, locale, value NOT
-- NULL ; clé (table_name, row_id, field, locale) ; garde translations_specialite_autre, qui ne regarde qu'une spécialité
-- ACTIVE — d'où l'écriture de la traduction pendant que la ligne est inactive).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(6);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_branche uuid;
  v_domaine uuid;
  v_spec    uuid;
  v_libre   uuid;
begin
  select b.id, b.domain_id into v_branche, v_domaine from public.branches b order by b.id limit 1;
  -- Une spécialité ordinaire, INACTIVE, dont la traduction anglaise est « Other » (posée pendant qu'elle était inactive :
  -- la garde des traductions ne regarde que les spécialités actives — c'est le trou).
  insert into public.specialities (branch_id, domain_id, name, slug, active)
  values (v_branche, v_domaine, 'Sonde Divers', 'sonde-divers', false)
  returning id into v_spec;
  insert into public.translations (table_name, row_id, field, locale, value)
  values ('specialities', v_spec, 'name', 'en', 'Other'), ('specialities', v_spec, 'name', 'es', 'Varios');

  -- A.
  return next throws_like(format($q$update public.specialities set active = true where id = %L$q$, v_spec),
                          '%specialities_autre_hors_referentiel%',
                          'A. réactiver une spécialité dont une traduction est « Other » est refusé, sous la contrainte nommée');
  return next throws_ok(format($q$update public.specialities set active = true where id = %L$q$, v_spec),
                        '23514', null, 'A. le refus porte le code 23514 (ce que la route rend specialite_autre_reservee)');
  return next ok((select not s.active from public.specialities s where s.id = v_spec), 'A. la spécialité reste inactive');

  -- B. la traduction corrigée d'abord, comme la route le fait dans un même geste.
  update public.translations set value = 'Miscellaneous'
   where table_name = 'specialities' and row_id = v_spec and field = 'name' and locale = 'en';
  update public.specialities set active = true where id = v_spec;
  return next ok((select s.active from public.specialities s where s.id = v_spec),
                 'B. la traduction remplacée, la réactivation passe');

  -- C.
  insert into public.specialities (branch_id, domain_id, name, slug, active)
  values (v_branche, v_domaine, 'Sonde Data', 'sonde-data', true)
  returning id into v_libre;
  insert into public.translations (table_name, row_id, field, locale, value)
  values ('specialities', v_libre, 'name', 'en', 'Data probe');
  update public.specialities set active = false where id = v_libre;
  update public.specialities set active = true where id = v_libre;
  return next ok((select s.active from public.specialities s where s.id = v_libre),
                 'C. sans traduction « Autre », désactiver puis réactiver passe');
  return next lives_ok(format($q$update public.specialities set sort_order = sort_order + 1 where id = %L$q$, v_libre),
                       'C. une mise à jour qui ne touche pas « active » ne déclenche pas la garde');
end $$;

select * from pg_temp.essai();

select * from finish();
rollback;
