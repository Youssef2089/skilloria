-- UNE VALEUR FAUTIVE D'UN CV NE REJETTE PLUS L'ANALYSE ENTIÈRE (§E.88) — `ecrire_analyse_cv` :
--   A. les champs du profil un par un : une valeur refusée (année de naissance 1800, pays « France ») est écartée
--      et SIGNALÉE, un titre trop long est TRONQUÉ, le reste s'écrit ; l'identité du compte n'est pas touchée ;
--   B. les expériences ligne par ligne : fin avant début → fin retirée, ligne gardée ; date illisible → ligne
--      écartée ; type hors liste → écartée ; poste trop long → tronqué ;
--   C. une formation hors bornes → années retirées, formation gardée ; une langue au niveau hors liste ou en
--      double → écartée ;
--   D. une liste ENTIÈREMENT refusée n'efface rien : la liste d'avant reste ;
--   E. le quota compte les analyses ABOUTIES, dans la même transaction ; le statut `done` en dernier ;
--   F. une fenêtre de quota absente est refusée ; la fonction est fermée au navigateur ;
--   G. un profil PROPRE : les 28 colonnes de la liste fermée passent par l'update dynamique, aucun écart.
-- Les deux fonctions d'appui (`longueur_max_colonne`, `borner_textes`) sont appelées en direct.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(19);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil  uuid := pg_temp.fab_profil('expert');
  v_user    uuid;
  v_prenom  text;
  v_res     jsonb;
  v_ecarts  jsonb;
  v_long    text := repeat('x', 260);
  v_complet jsonb;
begin
  select p.user_id into v_user from public.profiles p where p.id = v_profil;
  select u.first_name into v_prenom from public.users u where u.id = v_user;

  -- Les deux fonctions d'appui.
  return next is(public.longueur_max_colonne('profile_experiences', 'role'), 200, 'la longueur de la colonne est LUE dans le catalogue');
  return next ok((public.borner_textes(jsonb_build_object('role', v_long), 'profile_experiences', array['role']) -> 'tronques') ? 'role',
                 'borner_textes rend les champs tronqués');

  v_res := public.ecrire_analyse_cv(
    v_profil,
    jsonb_build_object('title', v_long, 'summary', 'Résumé de sonde', 'birth_year', 1800, 'country', 'France',
                       'skills', jsonb_build_array('Azure', 'Dynamics', 'Power BI'), 'first_name', 'Autre'),
    jsonb_build_array(
      jsonb_build_object('experience_type', 'career', 'role', 'Architecte', 'start_date', '2018-01-01', 'end_date', '2020-01-01'),
      jsonb_build_object('experience_type', 'project', 'role', 'Consultant', 'start_date', '2021-06-01', 'end_date', '2020-01-01'),
      jsonb_build_object('experience_type', 'project', 'role', 'Chef de projet', 'start_date', '2020-13-45'),
      jsonb_build_object('experience_type', 'mission', 'role', 'Hors liste', 'start_date', '2019-01-01'),
      jsonb_build_object('experience_type', 'career', 'role', v_long, 'start_date', '2015-01-01', 'end_date', '2017-01-01')),
    jsonb_build_array(
      jsonb_build_object('school', 'Sonde', 'degree', 'Master', 'start_year', 2008, 'end_year', 2010),
      jsonb_build_object('school', 'Sonde', 'degree', 'Licence', 'start_year', 1940, 'end_year', 2008)),
    jsonb_build_array(
      jsonb_build_object('language', 'Français', 'level', 'C2', 'is_primary', true),
      jsonb_build_object('language', 'Anglais', 'level', 'X9', 'is_primary', false),
      jsonb_build_object('language', 'Français', 'level', 'C1', 'is_primary', false)),
    interval '24 hours');
  v_ecarts := v_res -> 'ecarts';

  -- A. le profil
  return next ok((select char_length(p.title) = 200 and p.summary = 'Résumé de sonde' and p.skills = array['Azure', 'Dynamics', 'Power BI']
                    from public.profiles p where p.id = v_profil),
                 'A. le titre est TRONQUÉ à la colonne, le résumé et les compétences sont écrits');
  return next ok((select p.birth_year is null and p.country is distinct from 'France' from public.profiles p where p.id = v_profil),
                 'A. l année 1800 et le pays « France » ne sont PAS écrits');
  return next ok(v_ecarts @> '[{"bloc":"profil","champ":"birth_year","code":"valeur_refusee"}]'::jsonb
                 and v_ecarts @> '[{"bloc":"profil","champ":"country","code":"valeur_refusee"}]'::jsonb
                 and v_ecarts @> '[{"bloc":"profil","champ":"title","code":"texte_tronque"}]'::jsonb,
                 'A. les trois écarts du profil sont RENDUS');
  return next ok((select u.first_name = v_prenom from public.users u where u.id = v_user),
                 'A. le prénom lu dans le CV ne touche pas le compte (§E.87)');

  -- B. les expériences
  return next is((select count(*)::int from public.profile_experiences e where e.profile_id = v_profil), 3,
                 'B. trois expériences écrites sur cinq (date illisible et type hors liste écartés)');
  return next ok(exists (select 1 from public.profile_experiences e where e.profile_id = v_profil and e.role = 'Consultant' and e.end_date is null),
                 'B. fin avant début : la FIN est retirée, l expérience gardée');
  return next ok(v_ecarts @> '[{"bloc":"experiences","rang":2,"code":"fin_avant_debut"}]'::jsonb
                 and v_ecarts @> '[{"bloc":"experiences","rang":3,"code":"date_illisible"}]'::jsonb
                 and v_ecarts @> '[{"bloc":"experiences","rang":4,"code":"ligne_refusee"}]'::jsonb
                 and v_ecarts @> '[{"bloc":"experiences","rang":5,"code":"texte_tronque"}]'::jsonb,
                 'B. chaque écart d expérience est rendu, avec son RANG');

  -- C. formations et langues
  return next ok((select count(*) = 2 from public.profile_educations e where e.profile_id = v_profil)
                 and exists (select 1 from public.profile_educations e where e.profile_id = v_profil and e.degree = 'Licence' and e.start_year is null),
                 'C. année hors bornes : les années sont retirées, la formation gardée');
  return next ok((select count(*) = 1 from public.profile_languages l where l.profile_id = v_profil)
                 and v_ecarts @> '[{"bloc":"langues","rang":2,"code":"valeur_hors_liste"}]'::jsonb
                 and v_ecarts @> '[{"bloc":"langues","rang":3,"code":"doublon"}]'::jsonb,
                 'C. un niveau hors liste et un doublon sont écartés, et dits');

  -- E. quota et statut
  return next ok((select p.cv_parsing_status = 'done' and p.cv_parsing_count_24h = 1 and p.cv_parsing_reset_at > now()
                    from public.profiles p where p.id = v_profil),
                 'E. statut done ; le quota compte UNE analyse aboutie, fenêtre ouverte');

  -- D. une liste ENTIÈREMENT refusée n'efface rien
  v_res := public.ecrire_analyse_cv(v_profil, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('experience_type', 'mission', 'role', 'Refusée', 'start_date', '2019-01-01')),
    null, null, interval '24 hours');
  return next is((select count(*)::int from public.profile_experiences e where e.profile_id = v_profil), 3,
                 'D. toutes les lignes refusées : les trois expériences d avant RESTENT');
  return next ok((v_res -> 'ecarts') @> '[{"bloc":"experiences","code":"liste_entierement_refusee"}]'::jsonb,
                 'D. et c est DIT (liste_entierement_refusee)');
  return next ok((select p.cv_parsing_count_24h = 2 from public.profiles p where p.id = v_profil),
                 'E. une seconde analyse aboutie compte dans la même fenêtre');

  -- F. refus nommés, privilèges
  return next throws_ok(format($q$select public.ecrire_analyse_cv(%L, '{}'::jsonb, null, null, null, null)$q$, v_profil),
                        '22023', null, 'F. sans fenêtre de quota, l analyse est refusée');
  return next throws_ok(format($q$select public.ecrire_analyse_cv(%L, '{}'::jsonb, null, null, null, interval '1 hour')$q$, gen_random_uuid()),
                        'P0002', null, 'F. un profil inconnu est refusé');
  return next ok(not has_function_privilege('authenticated', 'public.ecrire_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb, interval)', 'execute')
                 and has_function_privilege('service_role', 'public.ecrire_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb, interval)', 'execute'),
                 'F. fermée au navigateur, ouverte à la clé de service');

  -- G. LA LIGNE DYNAMIQUE TOURNE POUR DE VRAI, SUR CHAQUE COLONNE DE LA LISTE FERMÉE (ARRÊT 19, rejeu local).
  --    Un profil PROPRE : chacune des 28 colonnes reçoit une valeur admise par ses contraintes (lues dans les
  --    migrations, §G.10) ; elle doit être écrite À L'IDENTIQUE, et AUCUN écart rendu. Si l'update dynamique
  --    ne s'exécutait pas, chaque champ tomberait dans « valeur_refusee » et le profil resterait vide — c'est
  --    précisément ce que ce test rend impossible à taire. Les clés sont celles de `c_colonnes`, une à une
  --    (diag-parcours-expert vérifie qu'elles coïncident).
  v_profil := pg_temp.fab_profil('expert');
  v_complet := jsonb_build_object(
    'title', 'Architecte Azure', 'summary', 'Résumé propre de sonde', 'seniorities', jsonb_build_array('senior', 'expert'),
    'years_experience', 12, 'skills', jsonb_build_array('Azure', 'Dynamics'), 'certifications', jsonb_build_array('AZ-305'),
    'branch_id', (select b.id from public.branches b order by b.id limit 1),
    'speciality_ids', to_jsonb(array(select s.id from public.specialities s order by s.id limit 1)),
    'languages', jsonb_build_array('Français', 'Anglais'), 'location', 'Paris', 'tjm_min', 500, 'tjm_max', 800,
    'linkedin_url', 'https://www.linkedin.com/in/sonde', 'phone', '+33600000000', 'address_line', '1 rue de la Sonde',
    'postal_code', '75001', 'city', 'Paris', 'country', 'FR', 'birth_year', 1985, 'years_total_experience', 15,
    'work_modes', jsonb_build_array('remote', 'hybrid'),
    'cdi_status', 'open_to_work', 'cdi_notice_period', '1_month', 'cdi_salary_min', 50000, 'cdi_salary_max', 60000,
    'cdi_variable_pct', 10, 'cdi_career_goals', 'Diriger une équipe', 'cdi_motivations', 'Des projets ambitieux');
  v_res := public.ecrire_analyse_cv(v_profil, v_complet, null, null, null, interval '24 hours');
  return next ok(jsonb_array_length(v_res -> 'ecarts') = 0
                 and not exists (select 1 from jsonb_each(v_complet) e, public.profiles p
                                  where p.id = v_profil and to_jsonb(p) -> e.key is distinct from e.value),
                 'G. un profil propre : les 28 colonnes écrites à l identique par l update dynamique, aucun écart');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
