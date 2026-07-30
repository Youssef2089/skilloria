-- ─────────────────────────────────────────────────────────────────────────────
-- CORRECTIF handle_new_user — domain_slug OBLIGATOIRE, plus de défaut 'microsoft'
--
-- CONTEXTE (audit conformité, axe multi-écosystème 1f)
--   La baseline (00000000000000_baseline.sql) rattachait tout nouvel utilisateur
--   au domaine 'microsoft' quand `domain_slug` était absent des métadonnées
--   d'inscription (COALESCE(..., 'microsoft')) ET refaisait un fallback vers
--   'microsoft' si le slug fourni était introuvable. Sur une plateforme
--   multi-écosystème, cela rattache SILENCIEUSEMENT un utilisateur au MAUVAIS
--   écosystème. Le domaine doit être dérivé de l'inscription, jamais d'un défaut.
--
-- PLANCHER VÉRIFIÉ AVANT CE DURCISSEMENT
--   Les 3 chemins de création de compte transmettent tous un domain_slug réel :
--     • POST /api/auth/public/register-expert — requis + validé (invalid_domain_slug)
--     • POST /api/auth/register-org           — requis + validé (invalid_domain_slug)
--     • Invitation (signUp client)            — domain_slug de l'org (repli : sous-domaine courant)
--   Aucun parcours ne dépend du défaut retiré ici.
--
-- COMPORTEMENT CORRIGÉ (seul le bloc domaine change ; tout le reste — mapping
--   rôle, rôle « Gratuit », insert users/profiles, idempotence — est IDENTIQUE
--   à la baseline) :
--     • domain_slug absent/vide (pour un vrai rôle Skilloria) → ÉCHEC explicite
--       (RAISE EXCEPTION actionnable), plutôt qu'un rattachement silencieux.
--     • slug fourni introuvable / domaine inactif → ÉCHEC explicite (pas de
--       fallback 'microsoft').
--   Les comptes à rôle inconnu (comptes techniques) continuent de RETURN NEW
--   sans miroir, exactement comme avant (bloc inchangé, placé AVANT le domaine).
--
-- Ne modifie PAS la baseline (CREATE OR REPLACE = nouvelle définition).
-- Aucune donnée touchée ; effet uniquement sur les inscriptions futures.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_meta        JSONB;
  v_role_front  TEXT;
  v_user_type   TEXT;
  v_expert_type TEXT;
  v_domain_slug TEXT;
  v_domain_id   UUID;
  v_role_id     UUID;
  v_firstname   TEXT;
  v_lastname    TEXT;
  v_specialty   TEXT;
BEGIN
  v_meta        := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_role_front  := v_meta->>'role';
  -- CORRECTIF : plus de défaut 'microsoft'. NULLIF(TRIM(...),'') → NULL si absent/vide.
  v_domain_slug := NULLIF(TRIM(v_meta->>'domain_slug'), '');
  v_firstname   := v_meta->>'firstname';
  v_lastname    := v_meta->>'lastname';
  v_specialty   := v_meta->>'specialty';

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

  -- CORRECTIF : domain_slug OBLIGATOIRE pour un vrai parcours Skilloria.
  -- Absent -> ECHEC explicite (inscription annulee), pas de rattachement silencieux.
  IF v_domain_slug IS NULL THEN
    RAISE EXCEPTION '[handle_new_user] domain_slug manquant dans les metadonnees d''inscription - inscription annulee pour %. Le client doit fournir le sous-domaine de l''ecosysteme.', NEW.id;
  END IF;

  -- Domaine derive du slug fourni UNIQUEMENT. Plus de fallback 'microsoft'.
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

  -- Profil expert (freelance + CDI) uniquement. INCHANGÉ.
  IF v_expert_type IS NOT NULL THEN
    INSERT INTO public.profiles (
      user_id, domain_id, expert_type, title, visible,
      profile_score, languages, skills, certifications
    ) VALUES (
      NEW.id, v_domain_id, v_expert_type, v_specialty, FALSE,
      0, ARRAY['fr']::TEXT[], '{}'::TEXT[], '[]'::jsonb
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
