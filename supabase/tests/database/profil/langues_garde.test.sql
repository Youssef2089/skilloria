-- LES LANGUES : LA GARDE, AU SECOND TEMPS (relecture indépendante du 01/10/2026, point 1) — migration `langues_garde`,
-- déployée APRÈS le lot qui n'écrit plus que des codes (§E.72, §E.91) :
--   A. la garde est posée : un code de la liste ACTIVE passe ; un texte libre, un code inconnu ou un code désactivé est
--      refusé (LG001), à l'insertion comme au changement de `language` ;
--   B. `remplacer_listes_profil` nomme ce refus (LP001, cause `langue_hors_liste`) et n'écrit RIEN.
-- La reprise RELANCÉE avant la garde est la fonction du lot A, prouvée sur des lignes héritées par
-- profil/langues_liste_fermee.test.sql (C) ; ici, son ORDRE (avant le déclencheur) est lu par diag-recette-s1 3.
-- Colonnes et contraintes lues dans les migrations (§G.10) : profile_languages (profile_id, language text NOT NULL,
-- level A1–C2 ou native, is_primary, unique (profile_id, language)) ; langues (code PK, active NOT NULL).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(8);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil uuid := pg_temp.fab_profil('expert');
  v_id     uuid;
  v_etat   text;
  v_msg    text;
begin
  delete from public.profile_languages where profile_id = v_profil;

  -- A.
  return next ok(exists (select 1 from pg_trigger t where t.tgrelid = 'public.profile_languages'::regclass
                          and t.tgname = 'profile_languages_langue_de_la_liste' and not t.tgisinternal),
                 'A. la garde des langues est posée');
  return next lives_ok(format($q$insert into public.profile_languages (profile_id, language, level, is_primary) values (%L, 'en', 'B2', true)$q$, v_profil),
                       'A. un code de la liste passe');
  return next throws_ok(format($q$insert into public.profile_languages (profile_id, language, level, is_primary) values (%L, 'English', 'B2', false)$q$, v_profil),
                        'LG001', null, 'A. un nom en texte libre est refusé (LG001)');
  return next throws_ok(format($q$insert into public.profile_languages (profile_id, language, level, is_primary) values (%L, 'xx', 'B2', false)$q$, v_profil),
                        'LG001', null, 'A. un code hors de la liste est refusé (LG001)');
  select l.id into v_id from public.profile_languages l where l.profile_id = v_profil and l.language = 'en';
  return next throws_ok(format($q$update public.profile_languages set language = 'Klingon' where id = %L$q$, v_id),
                        'LG001', null, 'A. changer la langue pour un texte libre est refusé (LG001)');
  update public.langues set active = false where code = 'de';
  return next throws_ok(format($q$insert into public.profile_languages (profile_id, language, level, is_primary) values (%L, 'de', 'C1', false)$q$, v_profil),
                        'LG001', null, 'A. un code DÉSACTIVÉ de la liste est refusé (LG001)');

  -- B. le refus nommé, et rien d'écrit
  begin
    perform public.remplacer_listes_profil(v_profil, null, null, '[{"language":"English","level":"B2","is_primary":true}]'::jsonb);
    v_etat := 'aucune erreur';
  exception when others then
    get stacked diagnostics v_etat = returned_sqlstate, v_msg = message_text;
  end;
  return next ok(v_etat = 'LP001' and v_msg like '%"cause": "langue_hors_liste"%',
                 'B. remplacer_listes_profil nomme le refus : LP001, cause langue_hors_liste');
  return next ok((select count(*) = 1 from public.profile_languages l where l.profile_id = v_profil and l.language = 'en'),
                 'B. et AUCUNE liste n''est touchée : la ligne « en » reste seule');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
