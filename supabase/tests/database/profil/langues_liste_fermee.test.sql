-- LES LANGUES SE CHOISISSENT DANS UNE LISTE FERMÉE (recette staging du 01/10/2026, point 3) — migration
-- `langues_liste_fermee`, SANS SA GARDE (relecture indépendante du 01/10/2026 : le déclencheur LG001 part au lot
-- suivant, `langues_garde`, déployé après — le code en ligne envoie du texte libre et ne doit pas échouer) :
--   A. la liste existe, ses noms rattachent un texte libre à son code (quatre langues, natif, sans accents) ;
--   B. le TEXTE LIBRE est encore ACCEPTÉ — à l'insertion, et par `remplacer_listes_profil` (le code en ligne) ;
--   C. la reprise des lignes HÉRITÉES de `profile_languages` : « French » et « Français » d'un même profil
--      deviennent UNE ligne `fr` (la principale d'abord), « Klingon » reste tel quel ; la liste PLATE suit ;
--      rejouée, elle ne fait plus rien ; elle est fermée au navigateur.
-- Ce que ce test prouve désormais et qu'il ne pouvait pas prouver avec la garde (§E.103) : la reprise sur des lignes
-- héritées fabriquées par le chemin NORMAL, celui qu'emprunte le code en ligne.
-- Colonnes lues dans les migrations (§G.10) : profile_languages (profile_id, language varchar 50, level, is_primary,
-- created_at), profiles.languages (text[]).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(11);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil uuid := pg_temp.fab_profil('expert');
  v_autre  uuid := pg_temp.fab_profil('expert');
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

  -- B. le texte libre du code en ligne passe encore
  delete from public.profile_languages where profile_id in (v_profil, v_autre);
  return next lives_ok(format($q$insert into public.profile_languages (profile_id, language, level, is_primary) values (%L, 'French', 'B2', false), (%L, 'Français', 'C1', true), (%L, 'Klingon', 'A1', false)$q$,
                              v_profil, v_profil, v_profil),
                       'B. un nom en texte libre est ACCEPTÉ à l''insertion (le code en ligne n''échoue pas)');
  return next lives_ok(format($q$select public.remplacer_listes_profil(%L, null, null, '[{"language":"English","level":"B2","is_primary":true}]'::jsonb)$q$, v_autre),
                       'B. remplacer_listes_profil accepte le texte libre que le code en ligne envoie');

  -- C. la reprise des lignes héritées
  v_bilan := public.rattacher_langues_heritees();
  return next ok((select count(*) = 1 from public.profile_languages l where l.profile_id = v_profil and l.language = 'fr')
                 and (select l.is_primary and l.level = 'C1' from public.profile_languages l where l.profile_id = v_profil and l.language = 'fr'),
                 'C. « French » et « Français » deviennent UNE ligne fr — la principale gardée');
  return next ok(exists (select 1 from public.profile_languages l where l.profile_id = v_profil and l.language = 'Klingon')
                 and exists (select 1 from public.profile_languages l where l.profile_id = v_autre and l.language = 'en'),
                 'C. « Klingon » reste tel quel ; « English » d''un autre profil devient en');
  update public.profiles set languages = array['French', 'fr', 'Klingon'] where id = v_profil;
  v_bilan := public.rattacher_langues_heritees();
  -- L'ENSEMBLE, pas l'ordre : `distinct on` trie selon la collation de la base, qui n'est pas la même partout.
  return next ok((select p.languages @> array['fr', 'Klingon'] and cardinality(p.languages) = 2 from public.profiles p where p.id = v_profil),
                 'C. la liste plate : « French » rejoint « fr » (une fois), l''inconnu reste tel quel');
  v_bilan := public.rattacher_langues_heritees();
  return next ok((v_bilan ->> 'rattachees')::int = 0 and (v_bilan ->> 'doublons')::int = 0 and (v_bilan ->> 'profils')::int = 0,
                 'C. rejouée, la reprise ne fait plus rien');
  return next ok((v_bilan ->> 'non_reconnues')::int >= 1,
                 'C. ce qu''elle ne reconnaît pas, elle le COMPTE (non_reconnues) au lieu de le taire');
  return next ok(not has_function_privilege('authenticated', 'public.rattacher_langues_heritees()', 'execute')
                 and not has_table_privilege('authenticated', 'public.langues', 'insert'),
                 'C. la reprise et la liste sont fermées au navigateur');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
