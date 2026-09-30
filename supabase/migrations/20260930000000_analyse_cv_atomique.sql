-- ════════════════════════════════════════════════════════════════════════════
--  L'ANALYSE D'UN CV S'ÉCRIT EN UNE FOIS, OU PAS DU TOUT — et elle n'écrit
--  jamais l'identité du compte (§E.87, 30/09/2026).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. N'ajoute qu'une fonction ; la route
--  `POST /api/profile/upload-cv` l'appelle dès ce commit. Rejouable.
--
--  LE DÉFAUT (lu dans la route à `b7b5c68`) : après l'appel au modèle, la route
--  écrivait l'analyse en SEPT appels séparés — le profil (statut `done` compris),
--  puis supprimer + réinsérer les expériences, les formations, les langues. Une
--  erreur sur l'un n'était que JOURNALISÉE : un profil pouvait finir marqué
--  « analysé » avec ses expériences effacées et jamais réinsérées, et l'écran ne
--  le disait pas. Une analyse qui échoue en cours de route laissait un profil à
--  moitié écrit.
--
--  LA RÈGLE : `appliquer_analyse_cv()` écrit TOUT dans une seule transaction — les
--  champs du profil (une liste FERMÉE de colonnes), les listes remplacées, le statut
--  `done` en dernier. Une erreur, et rien n'est écrit : la route le dit
--  (`analyse_non_ecrite`), le profil reste celui d'avant.
--
--  L'IDENTITÉ N'EST PAS UN CHAMP DE L'ANALYSE : la fonction ne touche ni `users`
--  (prénom, nom, e-mail, téléphone du compte), ni les colonnes de gouvernance du
--  profil (`user_id`, `domain_id`, `visible`, `verification_status`, `cv_*` de
--  dépôt). Une clé hors liste dans `p_profil` est IGNORÉE — le prénom lu dans un CV
--  n'a nulle part où aller.
--
--  Sécurité : `security definer`, fermée à `public`, `anon`, `authenticated` ;
--  seule la clé de service (la route) l'appelle.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.appliquer_analyse_cv(
  p_profile_id  uuid,
  p_profil      jsonb,
  p_experiences jsonb,
  p_formations  jsonb,
  p_langues     jsonb
) returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_domaine uuid;
  r         public.profiles%rowtype;
  v_n       bigint;
begin
  select p.domain_id into v_domaine from public.profiles p where p.id = p_profile_id for update;
  if v_domaine is null then
    raise exception 'appliquer_analyse_cv : profil % inconnu', p_profile_id using errcode = 'P0002';
  end if;
  if p_profil is null or jsonb_typeof(p_profil) <> 'object' then
    raise exception 'appliquer_analyse_cv : p_profil doit être un objet' using errcode = '22023';
  end if;

  -- Les valeurs, converties par le type de la colonne ; seules les clés de la liste fermée sont lues.
  r := jsonb_populate_record(null::public.profiles, p_profil);

  update public.profiles p set
    title                  = case when p_profil ? 'title' then r.title else p.title end,
    summary                = case when p_profil ? 'summary' then r.summary else p.summary end,
    seniorities            = case when p_profil ? 'seniorities' then coalesce(r.seniorities, '{}') else p.seniorities end,
    years_experience       = case when p_profil ? 'years_experience' then r.years_experience else p.years_experience end,
    skills                 = case when p_profil ? 'skills' then coalesce(r.skills, '{}') else p.skills end,
    certifications         = case when p_profil ? 'certifications' then coalesce(r.certifications, '[]'::jsonb) else p.certifications end,
    branch_id              = case when p_profil ? 'branch_id' then r.branch_id else p.branch_id end,
    speciality_ids         = case when p_profil ? 'speciality_ids' then coalesce(r.speciality_ids, '{}') else p.speciality_ids end,
    languages              = case when p_profil ? 'languages' then coalesce(r.languages, '{}') else p.languages end,
    location               = case when p_profil ? 'location' then r.location else p.location end,
    tjm_min                = case when p_profil ? 'tjm_min' then r.tjm_min else p.tjm_min end,
    tjm_max                = case when p_profil ? 'tjm_max' then r.tjm_max else p.tjm_max end,
    linkedin_url           = case when p_profil ? 'linkedin_url' then r.linkedin_url else p.linkedin_url end,
    phone                  = case when p_profil ? 'phone' then r.phone else p.phone end,
    address_line           = case when p_profil ? 'address_line' then r.address_line else p.address_line end,
    postal_code            = case when p_profil ? 'postal_code' then r.postal_code else p.postal_code end,
    city                   = case when p_profil ? 'city' then r.city else p.city end,
    country                = case when p_profil ? 'country' then r.country else p.country end,
    birth_year             = case when p_profil ? 'birth_year' then r.birth_year else p.birth_year end,
    photo_url              = case when p_profil ? 'photo_url' then r.photo_url else p.photo_url end,
    years_total_experience = case when p_profil ? 'years_total_experience' then r.years_total_experience else p.years_total_experience end,
    work_modes             = case when p_profil ? 'work_modes' then coalesce(r.work_modes, '{}') else p.work_modes end
  where p.id = p_profile_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'appliquer_analyse_cv : champs du profil');

  -- Les listes : `null` ou un tableau VIDE = on n'y touche pas (la liste réinsérée est testée AVANT la suppression :
  -- un CV sans expérience n'efface pas celles du profil) ; un tableau non vide = elle est REMPLACÉE, dans cette
  -- transaction. Un paramètre qui n'est pas un tableau est refusé (22023, par jsonb_array_length).
  if coalesce(jsonb_array_length(p_experiences), 0) > 0 then
    delete from public.profile_experiences e where e.profile_id = p_profile_id;
    insert into public.profile_experiences
      (profile_id, domain_id, sort_order, experience_type, role, employer, client_name, sector, start_date, end_date, is_current, description)
    select p_profile_id, v_domaine, x.ord - 1, x.v ->> 'experience_type', x.v ->> 'role', x.v ->> 'employer',
           x.v ->> 'client_name', x.v ->> 'sector', (x.v ->> 'start_date')::date,
           case when coalesce((x.v ->> 'is_current')::boolean, false) then null else (x.v ->> 'end_date')::date end,
           coalesce((x.v ->> 'is_current')::boolean, false), x.v ->> 'description'
      from jsonb_array_elements(p_experiences) with ordinality as x(v, ord);
  end if;

  if coalesce(jsonb_array_length(p_formations), 0) > 0 then
    delete from public.profile_educations e where e.profile_id = p_profile_id;
    insert into public.profile_educations (profile_id, domain_id, school, degree, field, start_year, end_year, location)
    select p_profile_id, v_domaine, x.v ->> 'school', x.v ->> 'degree', x.v ->> 'field',
           (x.v ->> 'start_year')::integer, (x.v ->> 'end_year')::integer, x.v ->> 'location'
      from jsonb_array_elements(p_formations) as x(v);
  end if;

  if coalesce(jsonb_array_length(p_langues), 0) > 0 then
    delete from public.profile_languages l where l.profile_id = p_profile_id;
    insert into public.profile_languages (profile_id, language, level, is_primary)
    select p_profile_id, btrim(x.v ->> 'language'), x.v ->> 'level', coalesce((x.v ->> 'is_primary')::boolean, false)
      from jsonb_array_elements(p_langues) as x(v);
  end if;

  -- LE STATUT EN DERNIER : « analysé » n'est vrai que si tout ce qui précède est écrit.
  update public.profiles p set
    cv_parsing_status = 'done',
    cv_parsed_at      = now(),
    cv_parsing_error  = null
  where p.id = p_profile_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'appliquer_analyse_cv : statut du profil');
end
$fn$;

revoke all on function public.appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb)') is null then
    raise exception 'postcondition NON TENUE : appliquer_analyse_cv absente';
  end if;
  if has_function_privilege('anon', 'public.appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb)', 'execute') then
    raise exception 'postcondition NON TENUE : appliquer_analyse_cv ouverte au navigateur';
  end if;
  if not has_function_privilege('service_role', 'public.appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb)', 'execute') then
    raise exception 'postcondition NON TENUE : appliquer_analyse_cv fermée à la clé de service';
  end if;
  raise notice 'postcondition tenue : appliquer_analyse_cv présente, fermée au navigateur, ouverte à la clé de service ; le tout-ou-rien et le compte intact sont prouvés par tests/database/profil/analyse_cv.test.sql';
end
$post$;
