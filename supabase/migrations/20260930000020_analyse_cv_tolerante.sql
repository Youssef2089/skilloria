-- ════════════════════════════════════════════════════════════════════════════
--  UNE VALEUR FAUTIVE DANS UN CV NE REJETTE PLUS L'ANALYSE ENTIÈRE : elle est
--  ramenée ou écartée, ET SIGNALÉE ; le reste s'écrit (§E.88, 30/09/2026).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. N'ajoute que des fonctions ; le code
--  de ce commit appelle `ecrire_analyse_cv` (l'exécutant des travaux d'IA).
--  `appliquer_analyse_cv` (migration analyse_cv_atomique) n'est plus appelée :
--  elle est peut-être déjà en production, elle ne se supprime qu'au déploiement
--  SUIVANT (§E.72) — dette nommée en architecture §H.
--
--  LE DÉFAUT (audit du 30/09/2026 sur aac5f79) : `appliquer_analyse_cv` écrivait
--  tout-ou-rien. C'était juste pour une PANNE — et faux pour une DONNÉE : une date
--  « 2020-01 », une fin avant le début, un secteur de 120 caractères, une année
--  hors bornes rejetaient TOUTE l'analyse. L'expert lisait « réessayez » et le même
--  CV échouait de nouveau, en consommant une analyse du quota à chaque fois.
--
--  LA RÈGLE, EN TROIS NIVEAUX :
--   ① le code (TypeScript, `lib/profil/normaliser-analyse.ts`) ramène les FORMES :
--     une date au mois, une décimale, un type inconnu, un code pays ;
--   ② ici, la base borne les TEXTES à la longueur RÉELLE de la colonne (lue dans
--     le catalogue, jamais recopiée) et écarte, champ par champ et ligne par ligne,
--     ce que ses contraintes refusent — une fin avant le début est retirée et la
--     ligne gardée, une année hors bornes est retirée et la formation gardée ;
--   ③ chaque écart est RENDU (`ecarts`) : l'écran le dit, le travail le garde.
--  Une liste dont TOUTES les lignes sont refusées n'efface rien : la liste
--  d'avant reste (la liste réinsérée est testée avant la suppression, §E.36).
--
--  CE QUI NE S'ÉCARTE PAS : une panne (verrou, colonne absente, droits). Elle lève,
--  la transaction est annulée, rien n'est écrit — et le travail est REJOUÉ.
--
--  LE QUOTA : il ne compte plus que les analyses ABOUTIES, et c'est ICI qu'il se
--  compte, dans la transaction qui écrit l'analyse. Une erreur de notre côté — le
--  modèle injoignable, l'écriture en panne, le délai dépassé — ne coûte plus une
--  analyse à l'expert.
--
--  L'IDENTITÉ N'EST TOUJOURS PAS UN CHAMP DE L'ANALYSE (§E.87) : ni `users`, ni
--  `user_id`, `domain_id`, `visible`, `verification_status`.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ① LA LONGUEUR RÉELLE D'UNE COLONNE — lue dans le catalogue, jamais recopiée ─
create or replace function public.longueur_max_colonne(p_table text, p_colonne text)
  returns integer
  language sql
  stable
  set search_path to 'public'
as $fn$
  -- varchar(n) : atttypmod = n + 4 ; un texte sans borne rend null.
  select case when a.atttypmod > 4 then a.atttypmod - 4 end
    from pg_attribute a
   where a.attrelid = to_regclass('public.' || p_table)
     and a.attname = p_colonne
     and not a.attisdropped
$fn$;

revoke all on function public.longueur_max_colonne(text, text) from public, anon, authenticated;
grant execute on function public.longueur_max_colonne(text, text) to service_role;


-- ── ② UNE LIGNE AUX LONGUEURS DE SA TABLE — rend la ligne et les champs tronqués ─
create or replace function public.borner_textes(p_ligne jsonb, p_table text, p_colonnes text[])
  returns jsonb
  language plpgsql
  stable
  set search_path to 'public'
as $fn$
declare
  v_col     text;
  v_val     text;
  v_max     integer;
  v_ligne   jsonb := coalesce(p_ligne, '{}'::jsonb);
  v_tronques text[] := '{}';
begin
  foreach v_col in array p_colonnes loop
    continue when not (v_ligne ? v_col) or jsonb_typeof(v_ligne -> v_col) <> 'string';
    v_val := btrim(v_ligne ->> v_col);
    v_max := public.longueur_max_colonne(p_table, v_col);
    if v_max is not null and char_length(v_val) > v_max then
      v_val := btrim(left(v_val, v_max));
      v_tronques := v_tronques || v_col;
    end if;
    v_ligne := jsonb_set(v_ligne, array[v_col], coalesce(to_jsonb(nullif(v_val, '')), 'null'::jsonb));
  end loop;
  return jsonb_build_object('ligne', v_ligne, 'tronques', to_jsonb(v_tronques));
end
$fn$;

revoke all on function public.borner_textes(jsonb, text, text[]) from public, anon, authenticated;
grant execute on function public.borner_textes(jsonb, text, text[]) to service_role;


-- ── ③ L'ANALYSE, ÉCRITE : ce qui passe s'écrit, ce qui est refusé est rendu ──
create or replace function public.ecrire_analyse_cv(
  p_profile_id    uuid,
  p_profil        jsonb,
  p_experiences   jsonb,
  p_formations    jsonb,
  p_langues       jsonb,
  p_fenetre_quota interval
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  -- LA LISTE FERMÉE des colonnes qu'une analyse écrit (freelance et CDI). Une clé
  -- hors liste — un prénom lu dans un CV — est ignorée (§E.87).
  -- `photo_url` N'Y EST PLUS : c'est un CHEMIN du stockage privé (avatars), et une
  -- adresse lue dans un document, servie à `<img src>`, est un mouchard (§E.17).
  c_colonnes constant text[] := array[
    'title', 'summary', 'seniorities', 'years_experience', 'skills', 'certifications',
    'branch_id', 'speciality_ids', 'languages', 'location', 'tjm_min', 'tjm_max',
    'linkedin_url', 'phone', 'address_line', 'postal_code', 'city', 'country',
    'birth_year', 'years_total_experience', 'work_modes',
    'cdi_status', 'cdi_notice_period', 'cdi_salary_min', 'cdi_salary_max',
    'cdi_variable_pct', 'cdi_career_goals', 'cdi_motivations'];
  -- Les textes libres qu'on peut RACCOURCIR sans les rendre faux ; un code, une
  -- adresse web ou un numéro trop longs ne se raccourcissent pas : ils sont écartés.
  c_tronquables constant text[] := array['title', 'location', 'address_line', 'city'];
  v_domaine  uuid;
  v_col      text;
  v_borne    jsonb;
  v_profil   jsonb;
  v_ligne    jsonb;
  v_rang     bigint;
  v_n        bigint;
  v_inseres  integer;
  v_ecarts   jsonb := '[]'::jsonb;
  v_comptes  jsonb := '{}'::jsonb;
  v_type     text;
  v_courant  boolean;
begin
  select p.domain_id into v_domaine from public.profiles p where p.id = p_profile_id for update;
  if v_domaine is null then
    raise exception 'ecrire_analyse_cv : profil % inconnu', p_profile_id using errcode = 'P0002';
  end if;
  if p_profil is null or jsonb_typeof(p_profil) <> 'object' then
    raise exception 'ecrire_analyse_cv : p_profil doit être un objet' using errcode = '22023';
  end if;
  if p_fenetre_quota is null or p_fenetre_quota <= interval '0' then
    raise exception 'ecrire_analyse_cv : la fenêtre du quota est obligatoire' using errcode = '22023';
  end if;

  -- ── LE PROFIL, CHAMP PAR CHAMP : un champ refusé n'emporte pas les autres ──
  v_borne := public.borner_textes(p_profil, 'profiles', c_tronquables);
  v_profil := v_borne -> 'ligne';
  for v_col in select jsonb_array_elements_text(v_borne -> 'tronques') loop
    v_ecarts := v_ecarts || jsonb_build_object('bloc', 'profil', 'champ', v_col, 'code', 'texte_tronque');
  end loop;
  foreach v_col in array c_colonnes loop
    continue when not (v_profil ? v_col);
    begin
      -- Un objet à UNE clé : une valeur illisible n'empêche pas de lire les autres.
      execute format(
        'update public.profiles p set %1$I = (jsonb_populate_record(null::public.profiles, $1)).%1$I where p.id = $2',
        v_col)
        using jsonb_build_object(v_col, v_profil -> v_col), p_profile_id;
      get diagnostics v_n = row_count;
      perform public.exiger_ecriture(v_n, 'ecrire_analyse_cv : profil');
    exception
      when sqlstate 'EC001' then raise;
      when others then
        v_ecarts := v_ecarts || jsonb_build_object('bloc', 'profil', 'champ', v_col, 'code', 'valeur_refusee', 'sqlstate', sqlstate);
    end;
  end loop;

  -- ── LES EXPÉRIENCES : ligne par ligne ; toutes refusées ⇒ rien n'est effacé ──
  if coalesce(jsonb_array_length(p_experiences), 0) > 0 then
    begin
      delete from public.profile_experiences e where e.profile_id = p_profile_id;
      v_inseres := 0;
      for v_ligne, v_rang in select x.v, x.ord from jsonb_array_elements(p_experiences) with ordinality as x(v, ord) loop
        v_borne := public.borner_textes(v_ligne, 'profile_experiences', array['role', 'employer', 'client_name', 'sector']);
        v_ligne := v_borne -> 'ligne';
        for v_col in select jsonb_array_elements_text(v_borne -> 'tronques') loop
          v_ecarts := v_ecarts || jsonb_build_object('bloc', 'experiences', 'rang', v_rang, 'champ', v_col, 'code', 'texte_tronque');
        end loop;
        v_type := v_ligne ->> 'experience_type';
        if v_type is null or not (v_type = any (public.types_experience())) then
          v_ecarts := v_ecarts || jsonb_build_object('bloc', 'experiences', 'rang', v_rang, 'champ', 'experience_type', 'code', 'ligne_refusee');
          continue;
        end if;
        v_courant := coalesce((v_ligne ->> 'is_current')::boolean, false);
        begin
          insert into public.profile_experiences
            (profile_id, domain_id, sort_order, experience_type, role, employer, client_name, sector, start_date, end_date, is_current, description)
          values (p_profile_id, v_domaine, v_rang - 1, v_type, v_ligne ->> 'role', v_ligne ->> 'employer',
                  v_ligne ->> 'client_name', v_ligne ->> 'sector', (v_ligne ->> 'start_date')::date,
                  case when v_courant then null else (v_ligne ->> 'end_date')::date end,
                  v_courant, v_ligne ->> 'description');
          v_inseres := v_inseres + 1;
        exception
          when check_violation then
            -- La seule contrainte d'une ligne valide par ailleurs : la fin avant le début.
            -- On retire la FIN, on garde l'expérience.
            begin
              insert into public.profile_experiences
                (profile_id, domain_id, sort_order, experience_type, role, employer, client_name, sector, start_date, end_date, is_current, description)
              values (p_profile_id, v_domaine, v_rang - 1, v_type, v_ligne ->> 'role', v_ligne ->> 'employer',
                      v_ligne ->> 'client_name', v_ligne ->> 'sector', (v_ligne ->> 'start_date')::date,
                      null, v_courant, v_ligne ->> 'description');
              v_inseres := v_inseres + 1;
              v_ecarts := v_ecarts || jsonb_build_object('bloc', 'experiences', 'rang', v_rang, 'champ', 'end_date', 'code', 'fin_avant_debut');
            exception when others then
              v_ecarts := v_ecarts || jsonb_build_object('bloc', 'experiences', 'rang', v_rang, 'code', 'ligne_refusee', 'sqlstate', sqlstate);
            end;
          when not_null_violation then
            v_ecarts := v_ecarts || jsonb_build_object('bloc', 'experiences', 'rang', v_rang, 'code', 'champ_obligatoire');
          when invalid_datetime_format or datetime_field_overflow then
            v_ecarts := v_ecarts || jsonb_build_object('bloc', 'experiences', 'rang', v_rang, 'code', 'date_illisible');
          when others then
            v_ecarts := v_ecarts || jsonb_build_object('bloc', 'experiences', 'rang', v_rang, 'code', 'ligne_refusee', 'sqlstate', sqlstate);
        end;
      end loop;
      if v_inseres = 0 then
        raise exception 'toutes les expériences sont refusées' using errcode = 'AC001';
      end if;
      v_comptes := v_comptes || jsonb_build_object('experiences', v_inseres);
    exception when sqlstate 'AC001' then
      -- L'effacement est annulé avec le reste du bloc : la liste d'avant reste.
      v_ecarts := v_ecarts || jsonb_build_object('bloc', 'experiences', 'code', 'liste_entierement_refusee');
    end;
  end if;

  -- ── LES FORMATIONS : une année hors bornes est retirée, la formation gardée ──
  if coalesce(jsonb_array_length(p_formations), 0) > 0 then
    begin
      delete from public.profile_educations e where e.profile_id = p_profile_id;
      v_inseres := 0;
      for v_ligne, v_rang in select x.v, x.ord from jsonb_array_elements(p_formations) with ordinality as x(v, ord) loop
        v_borne := public.borner_textes(v_ligne, 'profile_educations', array['school', 'degree', 'field', 'location']);
        v_ligne := v_borne -> 'ligne';
        for v_col in select jsonb_array_elements_text(v_borne -> 'tronques') loop
          v_ecarts := v_ecarts || jsonb_build_object('bloc', 'formations', 'rang', v_rang, 'champ', v_col, 'code', 'texte_tronque');
        end loop;
        begin
          insert into public.profile_educations (profile_id, domain_id, school, degree, field, start_year, end_year, location)
          values (p_profile_id, v_domaine, v_ligne ->> 'school', v_ligne ->> 'degree', v_ligne ->> 'field',
                  (v_ligne ->> 'start_year')::integer, (v_ligne ->> 'end_year')::integer, v_ligne ->> 'location');
          v_inseres := v_inseres + 1;
        exception
          when check_violation then
            begin
              insert into public.profile_educations (profile_id, domain_id, school, degree, field, start_year, end_year, location)
              values (p_profile_id, v_domaine, v_ligne ->> 'school', v_ligne ->> 'degree', v_ligne ->> 'field',
                      null, null, v_ligne ->> 'location');
              v_inseres := v_inseres + 1;
              v_ecarts := v_ecarts || jsonb_build_object('bloc', 'formations', 'rang', v_rang, 'champ', 'annees', 'code', 'annee_hors_bornes');
            exception when others then
              v_ecarts := v_ecarts || jsonb_build_object('bloc', 'formations', 'rang', v_rang, 'code', 'ligne_refusee', 'sqlstate', sqlstate);
            end;
          when not_null_violation then
            v_ecarts := v_ecarts || jsonb_build_object('bloc', 'formations', 'rang', v_rang, 'code', 'champ_obligatoire');
          when invalid_text_representation or numeric_value_out_of_range then
            v_ecarts := v_ecarts || jsonb_build_object('bloc', 'formations', 'rang', v_rang, 'code', 'nombre_illisible');
          when others then
            v_ecarts := v_ecarts || jsonb_build_object('bloc', 'formations', 'rang', v_rang, 'code', 'ligne_refusee', 'sqlstate', sqlstate);
        end;
      end loop;
      if v_inseres = 0 then
        raise exception 'toutes les formations sont refusées' using errcode = 'AC001';
      end if;
      v_comptes := v_comptes || jsonb_build_object('formations', v_inseres);
    exception when sqlstate 'AC001' then
      v_ecarts := v_ecarts || jsonb_build_object('bloc', 'formations', 'code', 'liste_entierement_refusee');
    end;
  end if;

  -- ── LES LANGUES : un niveau hors liste ou un doublon écartent la ligne ──────
  if coalesce(jsonb_array_length(p_langues), 0) > 0 then
    begin
      delete from public.profile_languages l where l.profile_id = p_profile_id;
      v_inseres := 0;
      for v_ligne, v_rang in select x.v, x.ord from jsonb_array_elements(p_langues) with ordinality as x(v, ord) loop
        begin
          insert into public.profile_languages (profile_id, language, level, is_primary)
          values (p_profile_id, btrim(v_ligne ->> 'language'), v_ligne ->> 'level',
                  coalesce((v_ligne ->> 'is_primary')::boolean, false));
          v_inseres := v_inseres + 1;
        exception
          when unique_violation then
            v_ecarts := v_ecarts || jsonb_build_object('bloc', 'langues', 'rang', v_rang, 'code', 'doublon');
          when check_violation then
            v_ecarts := v_ecarts || jsonb_build_object('bloc', 'langues', 'rang', v_rang, 'champ', 'level', 'code', 'valeur_hors_liste');
          when others then
            v_ecarts := v_ecarts || jsonb_build_object('bloc', 'langues', 'rang', v_rang, 'code', 'ligne_refusee', 'sqlstate', sqlstate);
        end;
      end loop;
      if v_inseres = 0 then
        raise exception 'toutes les langues sont refusées' using errcode = 'AC001';
      end if;
      v_comptes := v_comptes || jsonb_build_object('langues', v_inseres);
    exception when sqlstate 'AC001' then
      v_ecarts := v_ecarts || jsonb_build_object('bloc', 'langues', 'code', 'liste_entierement_refusee');
    end;
  end if;

  -- ── LE STATUT EN DERNIER, ET LE QUOTA AVEC LUI : une analyse ABOUTIE compte ──
  update public.profiles p set
    cv_parsing_status    = 'done',
    cv_parsed_at         = now(),
    cv_parsing_error     = null,
    cv_parsing_count_24h = case when p.cv_parsing_reset_at > now() then coalesce(p.cv_parsing_count_24h, 0) + 1 else 1 end,
    cv_parsing_reset_at  = case when p.cv_parsing_reset_at > now() then p.cv_parsing_reset_at else now() + p_fenetre_quota end
  where p.id = p_profile_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'ecrire_analyse_cv : statut du profil');

  return jsonb_build_object('ecarts', v_ecarts, 'comptes', v_comptes);
end
$fn$;

revoke all on function public.ecrire_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb, interval) from public, anon, authenticated;
grant execute on function public.ecrire_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb, interval) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.ecrire_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb, interval)') is null
     or to_regprocedure('public.borner_textes(jsonb, text, text[])') is null
     or to_regprocedure('public.longueur_max_colonne(text, text)') is null then
    raise exception 'postcondition NON TENUE : une des trois fonctions de l analyse manque';
  end if;
  if has_function_privilege('anon', 'public.ecrire_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb, interval)', 'execute')
     or has_function_privilege('authenticated', 'public.ecrire_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb, interval)', 'execute') then
    raise exception 'postcondition NON TENUE : ecrire_analyse_cv ouverte au navigateur';
  end if;
  if public.longueur_max_colonne('profile_experiences', 'role') is null then
    raise exception 'postcondition NON TENUE : la longueur de profile_experiences.role ne se lit pas dans le catalogue';
  end if;
  raise notice 'postcondition tenue : ecrire_analyse_cv, borner_textes et longueur_max_colonne presentes, fermees au navigateur ; les ecarts, la liste refusee qui n efface rien et le quota des analyses abouties sont prouves par tests/database/profil/analyse_cv_tolerante.test.sql';
end
$post$;
