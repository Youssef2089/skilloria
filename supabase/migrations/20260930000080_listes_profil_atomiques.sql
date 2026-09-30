-- ════════════════════════════════════════════════════════════════════════════
--  LES LISTES DU PROFIL (expériences, formations, langues) SE REMPLACENT EN
--  UNE FOIS, OU PAS DU TOUT — et un refus dit QUELLE ligne et POURQUOI
--  (§E.88, M4, 30/09/2026).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Ajoute une fonction ; `PATCH
--  /api/profile` l'appelle dès ce commit. Rejouable.
--
--  LE DÉFAUT (audit du 30/09/2026 sur aac5f79, M4) : la route supprimait TOUTES
--  les lignes d'une liste, puis réinsérait ; une réinsertion refusée — une
--  expérience sans date de début, une fin avant le début, un poste de 210
--  caractères, une année de formation hors bornes — n'était que journalisée, et la
--  route répondait 200. « Brouillon enregistré » s'affichait pendant que la liste
--  disparaissait ; une publication partait avec zéro expérience en base.
--
--  LA RÈGLE : c'est une SAISIE, pas une extraction. Contrairement à l'analyse
--  d'un CV (ecrire_analyse_cv, qui écarte et signale), rien n'est écarté en
--  silence : la PREMIÈRE ligne refusée annule tout (aucune liste n'est touchée) et
--  lève LP001 avec, en JSON, la liste, le rang, la colonne et la cause — l'écran
--  nomme le champ. `null` = liste inchangée ; `[]` = liste vidée (la route exige
--  qu'un vidage de liste non vide ait été DÉCLARÉ, §E.22) ; un tableau = liste
--  remplacée.
--
--  Les contraintes sont celles de la base, et seulement elles : la fonction ne
--  recopie aucune borne — elle traduit le refus de la table en cause nommée.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.remplacer_listes_profil(
  p_profile_id  uuid,
  p_experiences jsonb,
  p_formations  jsonb,
  p_langues     jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_domaine    uuid;
  v_ligne      jsonb;
  v_rang       bigint;
  v_liste      text;
  v_colonne    text;
  v_contrainte text;
  v_etat       text;
  v_cause      text;
  v_comptes    jsonb := '{}'::jsonb;
  v_n          integer;
begin
  select p.domain_id into v_domaine from public.profiles p where p.id = p_profile_id for update;
  if v_domaine is null then
    raise exception 'remplacer_listes_profil : profil % inconnu', p_profile_id using errcode = 'P0002';
  end if;

  begin
    if p_experiences is not null then
      v_liste := 'experiences';
      delete from public.profile_experiences e where e.profile_id = p_profile_id;
      v_n := 0;
      for v_ligne, v_rang in select x.v, x.ord from jsonb_array_elements(p_experiences) with ordinality as x(v, ord) loop
        insert into public.profile_experiences
          (profile_id, domain_id, sort_order, experience_type, role, employer, client_name, sector, start_date, end_date, is_current, description)
        values (p_profile_id, v_domaine, v_rang - 1, v_ligne ->> 'experience_type', nullif(btrim(v_ligne ->> 'role'), ''),
                nullif(btrim(v_ligne ->> 'employer'), ''), nullif(btrim(v_ligne ->> 'client_name'), ''),
                nullif(btrim(v_ligne ->> 'sector'), ''), nullif(v_ligne ->> 'start_date', '')::date,
                case when coalesce((v_ligne ->> 'is_current')::boolean, false) then null else nullif(v_ligne ->> 'end_date', '')::date end,
                coalesce((v_ligne ->> 'is_current')::boolean, false), nullif(btrim(v_ligne ->> 'description'), ''));
        v_n := v_n + 1;
      end loop;
      v_comptes := v_comptes || jsonb_build_object('experiences', v_n);
    end if;

    if p_formations is not null then
      v_liste := 'formations';
      delete from public.profile_educations e where e.profile_id = p_profile_id;
      v_n := 0;
      for v_ligne, v_rang in select x.v, x.ord from jsonb_array_elements(p_formations) with ordinality as x(v, ord) loop
        insert into public.profile_educations (profile_id, domain_id, school, degree, field, start_year, end_year, location)
        values (p_profile_id, v_domaine, nullif(btrim(v_ligne ->> 'school'), ''), nullif(btrim(v_ligne ->> 'degree'), ''),
                nullif(btrim(v_ligne ->> 'field'), ''), (v_ligne ->> 'start_year')::integer,
                (v_ligne ->> 'end_year')::integer, nullif(btrim(v_ligne ->> 'location'), ''));
        v_n := v_n + 1;
      end loop;
      v_comptes := v_comptes || jsonb_build_object('formations', v_n);
    end if;

    if p_langues is not null then
      v_liste := 'langues';
      delete from public.profile_languages l where l.profile_id = p_profile_id;
      v_n := 0;
      for v_ligne, v_rang in select x.v, x.ord from jsonb_array_elements(p_langues) with ordinality as x(v, ord) loop
        insert into public.profile_languages (profile_id, language, level, is_primary)
        values (p_profile_id, nullif(btrim(v_ligne ->> 'language'), ''), v_ligne ->> 'level',
                coalesce((v_ligne ->> 'is_primary')::boolean, false));
        v_n := v_n + 1;
      end loop;
      v_comptes := v_comptes || jsonb_build_object('langues', v_n);
    end if;
  exception
    when sqlstate 'P0002' then raise;
    when others then
      -- Tout le bloc est annulé : AUCUNE liste n'est touchée. La cause est NOMMÉE.
      get stacked diagnostics v_etat = returned_sqlstate, v_colonne = column_name, v_contrainte = constraint_name;
      v_cause := case
        when v_etat = '23502' then 'champ_obligatoire'
        when v_etat = '23505' then 'doublon'
        when v_etat = '22001' then 'texte_trop_long'
        when v_etat in ('22007', '22008') then 'date_illisible'
        when v_etat in ('22P02', '22003') then 'nombre_illisible'
        when v_contrainte = 'profile_experiences_check' then 'fin_avant_debut'
        when v_contrainte like 'profile_educations%check' then 'annee_hors_bornes'
        when v_etat = '23514' then 'valeur_hors_liste'
        else 'ligne_refusee'
      end;
      raise exception using
        errcode = 'LP001',
        message = jsonb_build_object('liste', v_liste, 'rang', v_rang, 'colonne', nullif(v_colonne, ''),
                                     'cause', v_cause, 'sqlstate', v_etat)::text;
  end;

  return v_comptes;
end
$fn$;

revoke all on function public.remplacer_listes_profil(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.remplacer_listes_profil(uuid, jsonb, jsonb, jsonb) to service_role;

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.remplacer_listes_profil(uuid, jsonb, jsonb, jsonb)') is null then
    raise exception 'postcondition NON TENUE : remplacer_listes_profil manque';
  end if;
  if has_function_privilege('authenticated', 'public.remplacer_listes_profil(uuid, jsonb, jsonb, jsonb)', 'execute') then
    raise exception 'postcondition NON TENUE : remplacer_listes_profil ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : remplacer_listes_profil presente, fermee au navigateur ; le tout ou rien et la cause nommee sont prouves par tests/database/profil/listes_profil.test.sql';
end
$post$;
