-- LES LISTES DU PROFIL SE REMPLACENT EN UNE FOIS, OU PAS DU TOUT (M4) — `remplacer_listes_profil` :
--   A. une liste valide remplace l'ancienne ; `null` n'y touche pas ;
--   B. UNE ligne refusée (fin avant début) annule TOUT — aucune liste n'est touchée — et la cause est NOMMÉE
--      (LP001, JSON : liste, rang, cause) ; une année hors bornes, une date vide aussi ;
--   C. `[]` vide la liste (la route exige que ce vidage soit déclaré) ; privilèges.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(7);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil uuid := pg_temp.fab_profil('expert');
  v_msg    text;
begin
  perform public.remplacer_listes_profil(v_profil,
    jsonb_build_array(jsonb_build_object('experience_type', 'career', 'role', 'Architecte', 'start_date', '2018-01-01', 'end_date', '2020-01-01')),
    null,
    jsonb_build_array(jsonb_build_object('language', 'Français', 'level', 'C2', 'is_primary', true)));
  return next ok((select count(*) = 1 from public.profile_experiences e where e.profile_id = v_profil)
                 and (select count(*) = 1 from public.profile_languages l where l.profile_id = v_profil),
                 'A. les listes envoyées sont remplacées');

  begin
    perform public.remplacer_listes_profil(v_profil,
      jsonb_build_array(
        jsonb_build_object('experience_type', 'career', 'role', 'Valide', 'start_date', '2010-01-01'),
        jsonb_build_object('experience_type', 'project', 'role', 'Refusée', 'start_date', '2021-01-01', 'end_date', '2020-01-01')),
      null,
      jsonb_build_array(jsonb_build_object('language', 'Anglais', 'level', 'B2', 'is_primary', false)));
    v_msg := null;
  exception when sqlstate 'LP001' then
    v_msg := sqlerrm;
  end;
  return next ok(v_msg is not null and (v_msg::jsonb ->> 'cause') = 'fin_avant_debut' and (v_msg::jsonb ->> 'liste') = 'experiences'
                 and (v_msg::jsonb ->> 'rang')::int = 2,
                 'B. la ligne refusée est NOMMÉE : liste, rang, cause');
  return next ok((select count(*) = 1 from public.profile_experiences e where e.profile_id = v_profil and e.role = 'Architecte')
                 and (select count(*) = 1 from public.profile_languages l where l.profile_id = v_profil and l.language = 'Français'),
                 'B. RIEN n a été touché : les deux listes d avant sont intactes');
  return next throws_ok(format($q$select public.remplacer_listes_profil(%L, null,
      '[{"school":"Sonde","degree":"Master","start_year":1940}]'::jsonb, null)$q$, v_profil),
    'LP001', null, 'B. une année de formation hors bornes est refusée, nommée');
  return next throws_ok(format($q$select public.remplacer_listes_profil(%L,
      '[{"experience_type":"career","role":"Sans date","start_date":""}]'::jsonb, null, null)$q$, v_profil),
    'LP001', null, 'B. une expérience sans date de début est refusée, nommée');

  perform public.remplacer_listes_profil(v_profil, '[]'::jsonb, null, null);
  return next ok(not exists (select 1 from public.profile_experiences e where e.profile_id = v_profil)
                 and exists (select 1 from public.profile_languages l where l.profile_id = v_profil),
                 'C. [] vide la liste ; null laisse l autre intacte');
  return next ok(not has_function_privilege('authenticated', 'public.remplacer_listes_profil(uuid, jsonb, jsonb, jsonb)', 'execute'),
                 'C. fermée au navigateur');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
