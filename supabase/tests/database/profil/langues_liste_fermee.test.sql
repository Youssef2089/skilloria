-- LES LANGUES SE CHOISISSENT DANS UNE LISTE FERMÉE (recette staging du 01/10/2026, point 3) — migration
-- `langues_liste_fermee` :
--   A. la liste existe, ses noms rattachent un texte libre à son code (quatre langues, natif, sans accents) ;
--   B. le déclencheur refuse un code hors liste — à l'insertion comme au changement (LG001) ; un code de
--      la liste passe ;
--   C. `remplacer_listes_profil` rend le refus NOMMÉ (LP001, cause `langue_hors_liste`) et ne touche à rien ;
--   D. la reprise rattache la liste PLATE du profil (le reste reconnu devient son code, l'inconnu reste) et
--      se rejoue sans rien faire ; elle est fermée au navigateur.
--
-- ⚠️ CE QUE CE TEST NE PEUT PAS PROUVER : la reprise des lignes HÉRITÉES de `profile_languages`. Le
--    déclencheur que cette migration pose rend une ligne en texte libre IMPOSSIBLE à fabriquer par un
--    chemin normal — et désactiver un déclencheur dans un test est interdit (§G.4 ter). La garde ferme
--    la porte par laquelle on fabriquerait le cas. Ce qui en est prouvé ici : le rattachement nom → code
--    (A, la même fonction que la reprise appelle) et l'idempotence sur des codes (D).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(12);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil uuid := pg_temp.fab_profil('expert');
  v_msg    text;
  v_bilan  jsonb;
begin
  -- A.
  return next ok((select count(*) >= 90 from public.langues l where l.active)
                 and exists (select 1 from public.langues l where l.code = 'fr')
                 and exists (select 1 from public.langues l where l.code = 'ar'),
                 'A. la liste fermée est semée');
  return next ok(public.code_de_langue('French') = 'fr' and public.code_de_langue('Français') = 'fr'
                 and public.code_de_langue('francais') = 'fr' and public.code_de_langue('Francés') = 'fr'
                 and public.code_de_langue('Französisch') = 'fr' and public.code_de_langue(' ARABIC ') = 'ar'
                 and public.code_de_langue('FR') = 'fr',
                 'A. un nom ou un code, dans les quatre langues, se rattache à son code');
  return next ok(public.code_de_langue('Klingon') is null and public.code_de_langue('') is null,
                 'A. ce qu''aucun nom ne reconnaît ne se rattache à rien');

  -- B. le déclencheur
  return next throws_ok(format($q$insert into public.profile_languages (profile_id, language, level) values (%L, 'French', 'B2')$q$, v_profil),
                        'LG001', null, 'B. un nom en texte libre est refusé à l''insertion (LG001)');
  return next lives_ok(format($q$insert into public.profile_languages (profile_id, language, level) values (%L, 'fr', 'B2')$q$, v_profil),
                       'B. un code de la liste passe');
  return next throws_ok(format($q$update public.profile_languages set language = 'xx' where profile_id = %L$q$, v_profil),
                        'LG001', null, 'B. un code hors liste est refusé au changement');
  return next lives_ok(format($q$update public.profile_languages set level = 'C1' where profile_id = %L$q$, v_profil),
                       'B. changer le niveau ne repasse pas par la garde de la langue');

  -- C. le refus nommé
  begin
    perform public.remplacer_listes_profil(v_profil, null, null,
      jsonb_build_array(jsonb_build_object('language', 'en', 'level', 'B2', 'is_primary', false),
                        jsonb_build_object('language', 'English', 'level', 'B2', 'is_primary', false)));
    v_msg := null;
  exception when sqlstate 'LP001' then
    v_msg := sqlerrm;
  end;
  return next ok(v_msg is not null and (v_msg::jsonb ->> 'cause') = 'langue_hors_liste' and (v_msg::jsonb ->> 'liste') = 'langues'
                 and (v_msg::jsonb ->> 'rang')::int = 2,
                 'C. la langue hors liste est NOMMÉE : liste, rang, cause');
  return next ok((select count(*) = 1 from public.profile_languages l where l.profile_id = v_profil and l.language = 'fr'),
                 'C. rien n''a été touché : la langue d''avant est intacte');

  -- D. la reprise
  update public.profiles set languages = array['French', 'fr', 'Klingon'] where id = v_profil;
  v_bilan := public.rattacher_langues_heritees();
  -- L'ENSEMBLE, pas l'ordre : `distinct on` trie selon la collation de la base, qui n'est pas la même partout.
  return next ok((select p.languages @> array['fr', 'Klingon'] and cardinality(p.languages) = 2 from public.profiles p where p.id = v_profil),
                 'D. la liste plate : « French » rejoint « fr » (une fois), l''inconnu reste tel quel');
  v_bilan := public.rattacher_langues_heritees();
  return next ok((v_bilan ->> 'rattachees')::int = 0 and (v_bilan ->> 'doublons')::int = 0 and (v_bilan ->> 'profils')::int = 0,
                 'D. rejouée, la reprise ne fait plus rien');
  return next ok(not has_function_privilege('authenticated', 'public.rattacher_langues_heritees()', 'execute')
                 and not has_table_privilege('authenticated', 'public.langues', 'insert'),
                 'D. la reprise et la liste sont fermées au navigateur');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
