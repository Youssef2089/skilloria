-- L'ANALYSE D'UN CV S'ÉCRIT EN UNE FOIS, OU PAS DU TOUT — et elle n'écrit jamais l'identité du compte (§E.87).
--   A. une analyse complète : les champs du profil, les trois listes REMPLACÉES, le statut `done` ;
--   B. le CV AU NOM D'UNE AUTRE PERSONNE : un prénom, un nom, un e-mail dans l'analyse ne touchent PAS le compte ;
--      les colonnes de gouvernance du profil (visible, verification_status, user_id) non plus ;
--   C. une analyse qui échoue EN COURS DE ROUTE (une expérience sans intitulé, refusée par la table) : RIEN n'est
--      écrit — ni les champs, ni les listes, ni le statut ; le profil est celui d'avant ;
--   E. une liste VIDE ne remplace rien (la liste réinsérée est testée avant la suppression) ;
--   D. la fonction est fermée au navigateur.
-- Comptes fabriqués par le vrai chemin (auth.users → handle_new_user), adresses en .invalid, tout est annulé.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(13);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil   uuid := pg_temp.fab_profil('expert');
  v_user     uuid;
  v_prenom   text;
  v_nom      text;
  v_email    text;
  v_visible  boolean;
  v_verif    text;
  v_exp      jsonb := jsonb_build_array(
                jsonb_build_object('experience_type', 'mission', 'role', 'Architecte', 'employer', 'Sonde', 'client_name', null,
                                   'sector', null, 'start_date', '2020-01-01', 'end_date', null, 'is_current', true, 'description', null));
  v_form     jsonb := jsonb_build_array(jsonb_build_object('school', 'Sonde', 'degree', 'Master', 'field', null,
                                                           'start_year', 2010, 'end_year', 2012, 'location', null));
  v_lang     jsonb := jsonb_build_array(jsonb_build_object('language', 'Français', 'level', 'C2', 'is_primary', true));
begin
  select p.user_id, p.visible, p.verification_status into v_user, v_visible, v_verif from public.profiles p where p.id = v_profil;
  select u.first_name, u.last_name, u.email into v_prenom, v_nom, v_email from public.users u where u.id = v_user;

  -- ── A + B : une analyse complète, d'un CV au nom de QUELQU'UN D'AUTRE ──
  perform public.appliquer_analyse_cv(v_profil,
    jsonb_build_object('title', 'Architecte Sonde', 'summary', 'Résumé sonde', 'skills', jsonb_build_array('Azure'),
                       'first_name', 'Autre', 'last_name', 'Personne', 'email', 'autre@sonde.invalid',
                       'visible', true, 'verification_status', 'approved', 'user_id', gen_random_uuid()),
    v_exp, v_form, v_lang);
  return next ok((select p.title = 'Architecte Sonde' and p.summary = 'Résumé sonde' and p.skills = array['Azure']
                    and p.cv_parsing_status = 'done' and p.cv_parsed_at is not null from public.profiles p where p.id = v_profil),
                 'A. analyse complète : les champs du profil sont écrits, et le statut done en dernier');
  return next ok((select count(*) = 1 from public.profile_experiences e where e.profile_id = v_profil and e.role = 'Architecte')
                 and (select count(*) = 1 from public.profile_educations e where e.profile_id = v_profil)
                 and (select count(*) = 1 from public.profile_languages l where l.profile_id = v_profil and l.is_primary),
                 'A. les trois listes sont remplacées');
  return next ok((select u.first_name = v_prenom and u.last_name = v_nom and u.email = v_email from public.users u where u.id = v_user),
                 'B. le prénom, le nom et l''e-mail lus dans le CV d''une AUTRE personne ne touchent pas le compte');
  return next ok((select p.user_id = v_user and p.visible = v_visible and p.verification_status is not distinct from v_verif
                    from public.profiles p where p.id = v_profil),
                 'B. ni le propriétaire, ni la visibilité, ni la vérification du profil ne s''écrivent par une analyse');

  -- ── C : une analyse qui échoue EN COURS DE ROUTE n'écrit RIEN ──
  update public.profiles set cv_parsing_status = 'processing' where id = v_profil;
  return next throws_ok(
    format($q$select public.appliquer_analyse_cv(%L, %L::jsonb, %L::jsonb, null, %L::jsonb)$q$,
           v_profil,
           jsonb_build_object('title', 'Titre qui ne doit PAS rester', 'summary', 'Résumé qui ne doit PAS rester'),
           jsonb_build_array(jsonb_build_object('experience_type', 'mission', 'role', null, 'start_date', '2021-01-01')),
           jsonb_build_array(jsonb_build_object('language', 'Anglais', 'level', 'B2', 'is_primary', false))),
    '23502', null, 'C. une expérience sans intitulé : la table la refuse, l''appel échoue');
  return next ok((select p.title = 'Architecte Sonde' and p.summary = 'Résumé sonde' from public.profiles p where p.id = v_profil),
                 'C. les champs du profil sont ceux d''AVANT : rien n''est resté de l''analyse échouée');
  return next ok((select count(*) = 1 from public.profile_experiences e where e.profile_id = v_profil and e.role = 'Architecte'),
                 'C. les expériences d''avant sont intactes (la suppression a été annulée avec le reste)');
  return next ok((select count(*) = 1 from public.profile_languages l where l.profile_id = v_profil and l.language = 'Français'),
                 'C. les langues d''avant sont intactes : l''analyse échouée ne les a pas remplacées');
  return next ok((select p.cv_parsing_status = 'processing' from public.profiles p where p.id = v_profil),
                 'C. le statut n''est PAS passé à done : « analysé » n''est vrai que si tout est écrit');

  -- ── E : une liste VIDE ne remplace rien — un CV sans expérience n'efface pas celles du profil ──
  perform public.appliquer_analyse_cv(v_profil, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
  return next ok((select count(*) = 1 from public.profile_experiences e where e.profile_id = v_profil)
                 and (select count(*) = 1 from public.profile_educations e where e.profile_id = v_profil)
                 and (select count(*) = 1 from public.profile_languages l where l.profile_id = v_profil),
                 'E. trois listes vides : rien n''est effacé (la liste réinsérée est testée avant la suppression)');

  -- ── Un profil inconnu, un paramètre malformé : refus nommés ──
  return next throws_ok(format($q$select public.appliquer_analyse_cv(%L, '{}'::jsonb, null, null, null)$q$, gen_random_uuid()),
                        'P0002', null, 'un profil inconnu est refusé (P0002)');

  -- ── D : fermée au navigateur ──
  return next ok(not has_function_privilege('anon', 'public.appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'public.appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb)', 'execute'),
                 'D. appliquer_analyse_cv est fermée à anon et authenticated');
  return next ok(has_function_privilege('service_role', 'public.appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb)', 'execute'),
                 'D. la clé de service (la route) l''appelle');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
