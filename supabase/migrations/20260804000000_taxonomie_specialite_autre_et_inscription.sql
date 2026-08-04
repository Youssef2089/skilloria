-- ─────────────────────────────────────────────────────────────────────────────
-- TAXONOMIE — spécialité « Autre » + inscription structurée (lot D4/D5/D6)
--
-- CONTEXTE
--   Deux corrections structurantes issues du test réel :
--     • D5 : le formulaire d'inscription expert envoyait la spécialité en TEXTE
--       LIBRE (métadonnée `specialty`), que le trigger `handle_new_user` stockait
--       dans `profiles.title`. Résultat : `profiles.branch_id` / `speciality_id`
--       restaient NULL et n'alimentaient pas le matching. L'inscription passe
--       désormais par une sélection structurée BRANCHE + SPÉCIALITÉ (métadonnées
--       `branch_id` / `speciality_id`, validées côté route register-expert).
--     • D6 : quand la spécialité n'est pas au référentiel, l'expert (inscription +
--       profil) et l'organisation (publication) choisissent « Autre » et précisent
--       en texte libre. Cette précision doit être STOCKÉE, transmise au matching et
--       consultable par l'admin — d'où la colonne `speciality_other`.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. Ajoute `speciality_other TEXT` (nullable) sur `profiles` et `publications`.
--   2. BACKFILL prudent : recopie `profiles.title` dans `speciality_other` UNIQUEMENT
--      quand `branch_id` ET `speciality_id` sont NULL et que `title` est non vide.
--      Aucun rattachement automatique à la taxonomie n'est tenté (on ne devine pas
--      une branche/spécialité à partir d'un texte libre). But : les comptes existants
--      (dont la spécialité vit dans `title`) rejoignent le panneau admin « hors
--      référentiel » et le contexte du matching, au lieu de rester invisibles.
--      `title` N'EST PAS vidé : il reste une colonne légitime (titre professionnel).
--   3. Réécrit `handle_new_user` pour alimenter `branch_id` / `speciality_id` /
--      `speciality_other` depuis les métadonnées d'inscription.
--
-- PRÉSERVATION DU DURCISSEMENT `domain_slug` (migration 20260730000000)
--   Le corps ci-dessous REPREND À L'IDENTIQUE le durcissement précédent :
--   `domain_slug` OBLIGATOIRE (NULLIF/TRIM, plus de défaut 'microsoft'), ÉCHEC
--   explicite si absent ou si le domaine actif est introuvable, bloc « rôle inconnu »
--   inchangé placé AVANT le domaine, rôle « Gratuit » obligatoire. SEULE la partie
--   spécialité de l'insert `profiles` change (ajout des 3 colonnes structurées).
--
-- Aucune policy RLS touchée. `CREATE OR REPLACE` = nouvelle définition, la baseline
-- n'est pas modifiée. Effet sur les inscriptions futures + un backfill ponctuel.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colonnes de précision libre « Autre »
ALTER TABLE public.profiles     ADD COLUMN IF NOT EXISTS speciality_other TEXT;
ALTER TABLE public.publications ADD COLUMN IF NOT EXISTS speciality_other TEXT;

COMMENT ON COLUMN public.profiles.speciality_other IS
  'Spécialité saisie librement quand l''expert choisit « Autre » (speciality_id NULL). Alimente le contexte du matching et la veille taxonomie admin (panneau « hors référentiel »).';
COMMENT ON COLUMN public.publications.speciality_other IS
  'Spécialité saisie librement quand l''organisation choisit « Autre » (speciality_id NULL). Alimente le contexte du matching et la veille taxonomie admin.';

-- 2. Backfill prudent title -> speciality_other (comptes existants, aucun rattachement deviné)
UPDATE public.profiles
SET speciality_other = title
WHERE branch_id IS NULL
  AND speciality_id IS NULL
  AND title IS NOT NULL
  AND TRIM(title) <> ''
  AND speciality_other IS NULL;

-- 3. handle_new_user — durcissement domain_slug PRÉSERVÉ, spécialité désormais structurée
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_meta             JSONB;
  v_role_front       TEXT;
  v_user_type        TEXT;
  v_expert_type      TEXT;
  v_domain_slug      TEXT;
  v_domain_id        UUID;
  v_role_id          UUID;
  v_firstname        TEXT;
  v_lastname         TEXT;
  v_specialty        TEXT;
  v_branch_id        UUID;
  v_speciality_id    UUID;
  v_speciality_other TEXT;
BEGIN
  v_meta        := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_role_front  := v_meta->>'role';
  -- Durcissement PRÉSERVÉ : plus de défaut 'microsoft'. NULLIF(TRIM(...),'') → NULL si absent/vide.
  v_domain_slug := NULLIF(TRIM(v_meta->>'domain_slug'), '');
  v_firstname   := v_meta->>'firstname';
  v_lastname    := v_meta->>'lastname';
  v_specialty   := v_meta->>'specialty';
  -- D5/D6 : spécialité structurée + précision libre « Autre » (validées côté route register-expert).
  v_branch_id        := NULLIF(TRIM(v_meta->>'branch_id'), '')::uuid;
  v_speciality_id    := NULLIF(TRIM(v_meta->>'speciality_id'), '')::uuid;
  v_speciality_other := NULLIF(TRIM(v_meta->>'speciality_other'), '');

  -- Mapping role front -> user_type BDD + expert_type
  CASE v_role_front
    WHEN 'expert'     THEN v_user_type := 'expert_freelance'; v_expert_type := 'freelance';
    WHEN 'cdi'        THEN v_user_type := 'expert_cdi';       v_expert_type := 'cdi';
    WHEN 'entreprise' THEN v_user_type := 'client';           v_expert_type := NULL;
    WHEN 'cabinet'    THEN v_user_type := 'cabinet';          v_expert_type := NULL;
    ELSE                   v_user_type := NULL;               v_expert_type := NULL;
  END CASE;

  -- Role inconnu/absent : compte hors parcours Skilloria. On ne cree pas de miroir,
  -- mais on n'echoue pas (ne pas bloquer un eventuel compte technique). INCHANGÉ.
  IF v_user_type IS NULL THEN
    RAISE WARNING '[handle_new_user] role inconnu: %, user % - aucun miroir cree', v_role_front, NEW.id;
    RETURN NEW;
  END IF;

  -- domain_slug OBLIGATOIRE pour un vrai parcours Skilloria. INCHANGÉ.
  IF v_domain_slug IS NULL THEN
    RAISE EXCEPTION '[handle_new_user] domain_slug manquant dans les metadonnees d''inscription - inscription annulee pour %. Le client doit fournir le sous-domaine de l''ecosysteme.', NEW.id;
  END IF;

  -- Domaine derive du slug fourni UNIQUEMENT. Plus de fallback 'microsoft'. INCHANGÉ.
  SELECT id INTO v_domain_id FROM public.domains
  WHERE slug = v_domain_slug AND active = TRUE LIMIT 1;

  IF v_domain_id IS NULL THEN
    RAISE EXCEPTION '[handle_new_user] domaine actif introuvable pour slug="%" - inscription annulee pour %.', v_domain_slug, NEW.id;
  END IF;

  -- Role commercial par defaut (Gratuit) obligatoire. Absent -> ECHEC. INCHANGÉ.
  SELECT id INTO v_role_id FROM public.roles
  WHERE name = 'Gratuit' AND active = TRUE LIMIT 1;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION '[handle_new_user] role "Gratuit" actif introuvable - inscription annulee pour %', NEW.id;
  END IF;

  -- Miroir public.users. Toute erreur ici remonte et annule l'inscription (atomique). INCHANGÉ.
  INSERT INTO public.users (
    id, email, role_id, domain_id, user_type,
    status, email_verified, is_verified,
    first_name, last_name, locale
  ) VALUES (
    NEW.id, NEW.email, v_role_id, v_domain_id, v_user_type,
    'draft', COALESCE(NEW.email_confirmed_at IS NOT NULL, FALSE), FALSE,
    v_firstname, v_lastname, 'fr'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Profil expert (freelance + CDI) uniquement.
  -- D5 : la spécialité est désormais structurée (branch_id/speciality_id) ou libre
  -- (speciality_other quand « Autre »). `title` conserve son sens de titre
  -- professionnel : on y retombe sur `v_specialty` par compatibilité ascendante
  -- (NULL pour les inscriptions structurées, l'expert le complétera à la validation).
  IF v_expert_type IS NOT NULL THEN
    INSERT INTO public.profiles (
      user_id, domain_id, expert_type, title, visible,
      profile_score, languages, skills, certifications,
      branch_id, speciality_id, speciality_other
    ) VALUES (
      NEW.id, v_domain_id, v_expert_type, v_specialty, FALSE,
      0, ARRAY['fr']::TEXT[], '{}'::TEXT[], '[]'::jsonb,
      v_branch_id, v_speciality_id, v_speciality_other
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
