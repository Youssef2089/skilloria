-- ════════════════════════════════════════════════════════════════════════════
--  L'INSCRIPTION D'UN EXPERT ÉCRIT LES COLONNES QUI EXISTENT — ET AUCUNE
--  INSCRIPTION NE LAISSE UN COMPTE À MOITIÉ CRÉÉ.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : INDIFFÉRENT — et le plus tôt possible. Elle ne remplace
--  qu'une fonction de trigger ; aucun code applicatif n'en dépend autrement
--  que par le résultat (une inscription qui réussit). Rejouable.
--
--  ┌─ LE BUG ────────────────────────────────────────────────────────────────┐
--  │ `handle_new_user` (dernière définition : taxonomie_specialite_autre_et_ │
--  │ inscription, 04/08/2026) insère `profiles.speciality_id`. La colonne a  │
--  │ été SUPPRIMÉE le 01/09/2026 par profil_annonce_multivalues, remplacée   │
--  │ par `profiles.speciality_ids uuid[]` — et la fonction n'a pas suivi.    │
--  │ Depuis, TOUTE inscription d'expert (freelance comme CDI) échoue :       │
--  │ « column "speciality_id" of relation "profiles" does not exist ».       │
--  │ Mesuré par les tests pgTAP le 28/09/2026 (15 fichiers sur 23 arrêtés    │
--  │ là) ; confirmé sur staging par Youssef : la colonne y est absente et la │
--  │ fonction la cite. Aucun contrôle ne l'a vu (§E.73).                     │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  CE QUI CHANGE, ET SEULEMENT ÇA
--   ① la spécialité choisie à l'inscription s'écrit dans `speciality_ids`
--     (un élément), là où l'écran du profil et le moteur la lisent ;
--   ② la taxonomie reçue est VÉRIFIÉE EN BASE, avec la règle exacte de la
--     route register-expert (branche ACTIVE de l'écosystème ; spécialité
--     ACTIVE de l'écosystème et de CETTE branche). La route n'est pas le seul
--     chemin : `auth.signUp` s'appelle avec la clé publique, métadonnées
--     comprises. Un `uuid[]` n'a pas de clé étrangère (profil_annonce_
--     multivalues le dit) : sans cette garde, un identifiant inventé entrait ;
--   ③ UN RÔLE INCONNU OU ABSENT LÈVE. Avant, il faisait `RAISE WARNING` puis
--     `RETURN NEW` : le compte auth était créé, `public.users` ne l'était pas,
--     et aucune erreur ne remontait — le compte fantôme de §E.23, fabriqué
--     par le trigger lui-même. `create-admin` s'en protégeait par une relecture
--     du miroir ; la relecture reste, elle n'est plus la seule barrière.
--     Conséquence voulue : un compte créé depuis le tableau de bord Supabase
--     sans métadonnée `role` est désormais REFUSÉ au lieu d'être fantôme ;
--   ④ chaque refus porte un SQLSTATE stable (IN001 à IN005, table ci-dessous).
--  Le reste est repris À L'IDENTIQUE (domain_slug obligatoire sans repli,
--  rôle « Gratuit » obligatoire, `ON CONFLICT DO NOTHING`, colonnes écrites).
--
--  CE QUE FAIT LE TRIGGER QUAND UNE ÉTAPE ÉCHOUE : IL LÈVE, et l'insertion dans
--  `auth.users` est annulée avec lui — même transaction. Aucun compte n'existe
--  à moitié : ni auth sans miroir, ni miroir sans profil d'expert.
--
--  LES CODES (docs/architecture.md §C, inscription) — GoTrue les rend en
--  « Database error saving new user » ; ils se lisent dans les journaux de la
--  base, et la route répond `create_user_failed`.
--    IN001  rôle d'inscription inconnu ou absent
--    IN002  domain_slug absent des métadonnées
--    IN003  aucun écosystème ACTIF pour ce slug
--    IN004  rôle commercial « Gratuit » actif introuvable
--    IN005  branche ou spécialité hors de l'écosystème (ou inactive, ou
--           spécialité hors de la branche, ou spécialité sans branche)
--
--  La ligne de journal de l'inscription est pour la phase B (décision de
--  Youssef, 28/09/2026) : elle n'est PAS ajoutée ici.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_meta             jsonb;
  v_role_front       text;
  v_user_type        text;
  v_expert_type      text;
  v_domain_slug      text;
  v_domain_id        uuid;
  v_role_id          uuid;
  v_firstname        text;
  v_lastname         text;
  v_specialty        text;
  v_branch_id        uuid;
  v_speciality_id    uuid;
  v_speciality_other text;
begin
  v_meta             := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role_front       := v_meta ->> 'role';
  v_domain_slug      := nullif(trim(v_meta ->> 'domain_slug'), '');
  v_firstname        := v_meta ->> 'firstname';
  v_lastname         := v_meta ->> 'lastname';
  v_specialty        := v_meta ->> 'specialty';
  v_branch_id        := nullif(trim(v_meta ->> 'branch_id'), '')::uuid;
  v_speciality_id    := nullif(trim(v_meta ->> 'speciality_id'), '')::uuid;
  v_speciality_other := nullif(trim(v_meta ->> 'speciality_other'), '');

  -- Le rôle d'inscription (mot du front) → type de compte en base.
  case v_role_front
    when 'expert'     then v_user_type := 'expert_freelance'; v_expert_type := 'freelance';
    when 'cdi'        then v_user_type := 'expert_cdi';       v_expert_type := 'cdi';
    when 'entreprise' then v_user_type := 'client';           v_expert_type := null;
    when 'cabinet'    then v_user_type := 'cabinet';          v_expert_type := null;
    else                   v_user_type := null;               v_expert_type := null;
  end case;

  -- ③ Un rôle inconnu LÈVE : jamais de compte auth sans miroir (§E.23).
  if v_user_type is null then
    raise exception '[handle_new_user] role d inscription inconnu ou absent (« % ») - inscription annulee pour %', v_role_front, new.id
      using errcode = 'IN001';
  end if;

  if v_domain_slug is null then
    raise exception '[handle_new_user] domain_slug manquant dans les metadonnees d inscription - inscription annulee pour %', new.id
      using errcode = 'IN002';
  end if;

  select d.id into v_domain_id
    from public.domains d
   where d.slug = v_domain_slug and d.active
   limit 1;
  if v_domain_id is null then
    raise exception '[handle_new_user] ecosysteme actif introuvable pour slug="%" - inscription annulee pour %', v_domain_slug, new.id
      using errcode = 'IN003';
  end if;

  select r.id into v_role_id
    from public.roles r
   where r.name = 'Gratuit' and r.active
   limit 1;
  if v_role_id is null then
    raise exception '[handle_new_user] role "Gratuit" actif introuvable - inscription annulee pour %', new.id
      using errcode = 'IN004';
  end if;

  -- ② La taxonomie d'un expert, vérifiée EN BASE (règle de register-expert).
  if v_expert_type is not null then
    if v_branch_id is not null and not exists (
         select 1 from public.branches b
          where b.id = v_branch_id and b.domain_id = v_domain_id and b.active) then
      raise exception '[handle_new_user] branche % hors de l ecosysteme % ou inactive - inscription annulee pour %', v_branch_id, v_domain_slug, new.id
        using errcode = 'IN005';
    end if;
    if v_speciality_id is not null and not exists (
         select 1 from public.specialities s
          where s.id = v_speciality_id and s.domain_id = v_domain_id and s.active
            and (v_branch_id is null or s.branch_id = v_branch_id)) then
      raise exception '[handle_new_user] specialite % hors de l ecosysteme %, de la branche ou inactive - inscription annulee pour %', v_speciality_id, v_domain_slug, new.id
        using errcode = 'IN005';
    end if;
  end if;

  -- Le miroir public.users. Toute erreur remonte et annule l'inscription.
  insert into public.users (
    id, email, role_id, domain_id, user_type,
    status, email_verified, is_verified,
    first_name, last_name, locale
  ) values (
    new.id, new.email, v_role_id, v_domain_id, v_user_type,
    'draft', coalesce(new.email_confirmed_at is not null, false), false,
    v_firstname, v_lastname, 'fr'
  )
  on conflict (id) do nothing;

  -- Le profil d'un expert (freelance et CDI). ① la spécialité dans speciality_ids.
  if v_expert_type is not null then
    insert into public.profiles (
      user_id, domain_id, expert_type, title, visible,
      profile_score, languages, skills, certifications,
      branch_id, speciality_ids, speciality_other
    ) values (
      new.id, v_domain_id, v_expert_type, v_specialty, false,
      0, array['fr']::text[], '{}'::text[], '[]'::jsonb,
      v_branch_id,
      case when v_speciality_id is null then '{}'::uuid[] else array[v_speciality_id] end,
      v_speciality_other
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$fn$;


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
--  Une inscription d'expert, par le VRAI chemin (auth.users → trigger), dans un
--  bloc annulé : rien n'en reste. Puis un rôle inconnu, qui doit lever IN001.
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_slug   text;
  v_dom    uuid;
  v_branche uuid;
  v_spec   uuid;
  v_id     uuid := gen_random_uuid();
begin
  -- La colonne morte n'est plus citée par la définition EN BASE (pas par ce fichier : par pg_proc).
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'handle_new_user') ~* '\mspeciality_id\M\s*[,)]' then
    raise exception 'postcondition NON TENUE : handle_new_user ecrit encore une colonne speciality_id';
  end if;

  select d.slug, d.id into v_slug, v_dom from public.domains d where d.active order by d.slug limit 1;
  select s.branch_id, s.id into v_branche, v_spec
    from public.specialities s join public.branches b on b.id = s.branch_id
   where s.domain_id = v_dom and s.active and b.active and b.domain_id = v_dom
   order by s.slug limit 1;
  if v_spec is null or not exists (select 1 from public.roles r where r.name = 'Gratuit' and r.active) then
    raise notice 'postcondition : sonde d inscription SAUTEE — aucun ecosysteme actif avec une specialite, ou pas de role Gratuit (base vierge)';
    v_sautee := true;
  else
    begin
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
              'sonde+' || v_id || '@exemple.invalid', '', now(), '{}'::jsonb,
              jsonb_build_object('role', 'expert', 'domain_slug', v_slug, 'firstname', 'Sonde', 'lastname', 'Essai',
                                 'branch_id', v_branche, 'speciality_id', v_spec, 'speciality_other', ''),
              now(), now());
      if not exists (select 1 from public.users u where u.id = v_id and u.user_type = 'expert_freelance' and u.domain_id = v_dom) then
        raise exception 'postcondition NON TENUE : l inscription d un expert ne cree pas public.users';
      end if;
      if not exists (select 1 from public.profiles p where p.user_id = v_id and p.speciality_ids = array[v_spec]
                        and p.branch_id = v_branche and p.expert_type = 'freelance' and not p.visible) then
        raise exception 'postcondition NON TENUE : le profil de l expert ne porte pas sa specialite dans speciality_ids';
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;

  -- Un rôle inconnu LÈVE IN001 (plus de compte fantôme). Aucune donnée requise.
  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            'sonde+' || gen_random_uuid() || '@exemple.invalid', '', now(), now(), '{}'::jsonb,
            '{"role":"inconnu","domain_slug":"x"}'::jsonb);
    raise exception 'postcondition NON TENUE : un role inconnu cree encore un compte auth sans miroir';
  exception when sqlstate 'IN001' then
    null;
  end;

  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : handle_new_user ne cite plus speciality_id, un role inconnu leve IN001 ; les cinq roles et les refus sont prouves par tests/database/inscription/roles.test.sql';
  else
    raise notice 'postcondition tenue : une inscription d expert cree public.users et un profil portant speciality_ids ; un role inconnu leve IN001 ; les cinq roles et les refus sont prouves par tests/database/inscription/roles.test.sql';
  end if;
end
$post$;
