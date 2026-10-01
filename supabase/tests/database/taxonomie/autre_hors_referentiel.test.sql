-- « AUTRE » N'EST JAMAIS UNE LIGNE DU RÉFÉRENTIEL — LE SECOND TEMPS (recette S1 du 01/10/2026, point 1 ; relecture
-- indépendante du 01/10/2026, points 2 et 11) — migration `specialite_autre_garde`, déployée APRÈS le lot A :
--   B. la contrainte refuse une spécialité ACTIVE « Autre » — création, réactivation, renommage ; une ligne inactive
--      est admise (les clés étrangères héritées peuvent la citer) ;
--   C. la reprise sort « Autre » des profils et des annonces, garde « Autre » en précision quand elle était vide, ne
--      touche pas une précision déjà écrite, et se rejoue sans rien faire ;
--   D. la reprise est fermée au navigateur ;
--   E. la garde des TRADUCTIONS : le nom traduit d'une spécialité ACTIVE n'est jamais « Autre » (« Other », « Otra »),
--      à l'insertion comme au changement, refusé sous la contrainte NOMMÉE (23514, specialities_autre_hors_referentiel —
--      ce que l'administration rend specialite_autre_reservee) ; une traduction ordinaire, celle d'une ligne inactive ou
--      d'une autre table passent.
-- (A — la définition, est_specialite_autre — est au lot A : taxonomie/autre_definition.test.sql.)
-- Données FABRIQUÉES (fabriques du grand livre) ; la branche est LUE en base, jamais en dur.
-- Colonnes et contraintes lues (§G.10) : specialities (name, slug, active NOT NULL, branch_id, domain_id) ; translations
-- (table_name varchar 50, row_id uuid sans clé étrangère, field varchar 50, locale varchar 5, value text NOT NULL ; clé
-- (table_name, row_id, field, locale)).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(18);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_branche  uuid;
  v_domaine  uuid;
  v_autre    uuid;
  v_active   uuid;
  v_profil1  uuid := pg_temp.fab_profil('expert');
  v_profil2  uuid := pg_temp.fab_profil('expert');
  v_org      uuid;
  v_annonce  uuid;
  v_bilan    jsonb;
begin
  -- B. la contrainte
  return next ok(not exists (select 1 from public.specialities s where public.est_specialite_autre(s.name, s.slug) and s.active),
                 'B. après la migration, aucune spécialité « Autre » n''est active');
  select b.id, b.domain_id into v_branche, v_domaine from public.branches b order by b.id limit 1;
  return next throws_ok(format($q$insert into public.specialities (branch_id, domain_id, name, slug, active)
                                  values (%L, %L, 'Autre', 'autre-sonde-1', true)$q$, v_branche, v_domaine),
                        '23514', null, 'B. créer une spécialité active « Autre » est refusé');
  insert into public.specialities (branch_id, domain_id, name, slug, active)
  values (v_branche, v_domaine, 'Autre', 'autre-sonde-2', false)
  returning id into v_autre;
  return next ok(v_autre is not null, 'B. une ligne « Autre » INACTIVE est admise');
  return next throws_ok(format($q$update public.specialities set active = true where id = %L$q$, v_autre),
                        '23514', null, 'B. la réactiver est refusé');
  return next throws_ok(format($q$update public.specialities set name = 'Other' where id = (
                                    select s.id from public.specialities s where s.active and not public.est_specialite_autre(s.name, s.slug)
                                     order by s.id limit 1)$q$),
                        '23514', null, 'B. renommer une spécialité active en « Other » est refusé');

  -- C. la reprise : un profil et une annonce portent la ligne « Autre » sans précision, un second profil
  --    la porte AVEC une précision.
  update public.profiles set speciality_ids = array[v_autre], speciality_other = null where id = v_profil1;
  update public.profiles set speciality_ids = array[v_autre], speciality_other = 'FinOps' where id = v_profil2;
  v_org := pg_temp.fab_organisation(pg_temp.fab_compte('entreprise'));
  v_annonce := pg_temp.fab_brouillon(v_org, 'mission');
  update public.publications set speciality_ids = array[v_autre], speciality_other = null where id = v_annonce;

  v_bilan := public.retirer_specialites_autre();
  return next ok((v_bilan ->> 'profils')::int = 2 and (v_bilan ->> 'annonces')::int = 1,
                 'C. la reprise compte ce qu''elle a repris : deux profils, une annonce');
  return next ok((select coalesce(array_length(p.speciality_ids, 1), 0) = 0 and p.speciality_other = 'Autre'
                    from public.profiles p where p.id = v_profil1),
                 'C. la ligne « Autre » sort du profil, la précision garde « Autre »');
  return next ok((select p.speciality_other = 'FinOps' from public.profiles p where p.id = v_profil2),
                 'C. une précision déjà écrite n''est pas touchée');
  return next ok((select coalesce(array_length(u.speciality_ids, 1), 0) = 0 and u.speciality_other = 'Autre'
                    from public.publications u where u.id = v_annonce),
                 'C. l''annonce suit la même règle');
  return next ok((select not s.active from public.specialities s where s.id = v_autre),
                 'C. la ligne reste désactivée, jamais supprimée');
  v_bilan := public.retirer_specialites_autre();
  return next ok((v_bilan ->> 'profils')::int = 0 and (v_bilan ->> 'annonces')::int = 0 and (v_bilan ->> 'specialites')::int = 0,
                 'C. rejouée, la reprise ne trouve plus rien');

  -- D.
  return next ok(not has_function_privilege('authenticated', 'public.retirer_specialites_autre()', 'execute'),
                 'D. la reprise est fermée au navigateur');

  -- E. la garde des traductions
  insert into public.specialities (branch_id, domain_id, name, slug, active)
  values (v_branche, v_domaine, 'Sonde active', 'sonde-active-' || left(md5(random()::text), 8), true)
  returning id into v_active;
  return next throws_ok(format($q$insert into public.translations (table_name, row_id, field, locale, value) values ('specialities', %L, 'name', 'en', 'Other')$q$, v_active),
                        '23514', null, 'E. une traduction « Other » d''une spécialité active est refusée');
  return next throws_like(format($q$insert into public.translations (table_name, row_id, field, locale, value) values ('specialities', %L, 'name', 'es', 'Otra')$q$, v_active),
                          '%specialities_autre_hors_referentiel%', 'E. le refus porte le NOM de la contrainte (l''administration le rend specialite_autre_reservee)');
  insert into public.translations (table_name, row_id, field, locale, value) values ('specialities', v_active, 'name', 'de', 'Sonde aktiv');
  return next ok(exists (select 1 from public.translations t where t.table_name = 'specialities' and t.row_id = v_active and t.locale = 'de'),
                 'E. une traduction ordinaire passe');
  return next throws_ok(format($q$update public.translations set value = 'Andere' where table_name = 'specialities' and row_id = %L and field = 'name' and locale = 'de'$q$, v_active),
                        '23514', null, 'E. changer une traduction en « Andere » est refusé');
  insert into public.translations (table_name, row_id, field, locale, value) values ('specialities', v_autre, 'name', 'en', 'Other');
  return next ok(exists (select 1 from public.translations t where t.table_name = 'specialities' and t.row_id = v_autre and t.locale = 'en'),
                 'E. la traduction « Other » d''une ligne INACTIVE passe (elle n''est proposée nulle part)');
  insert into public.translations (table_name, row_id, field, locale, value) values ('specialities', v_active, 'description', 'en', 'Other');
  insert into public.translations (table_name, row_id, field, locale, value) values ('branches', v_active, 'name', 'en', 'Other');
  return next ok(exists (select 1 from public.translations t where t.table_name = 'specialities' and t.row_id = v_active and t.field = 'description')
                 and exists (select 1 from public.translations t where t.table_name = 'branches' and t.row_id = v_active and t.field = 'name'),
                 'E. un autre champ (la description) et une autre table ne sont pas concernés');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
