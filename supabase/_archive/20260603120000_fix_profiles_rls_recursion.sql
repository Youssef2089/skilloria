-- =============================================================================
-- Migration : fix récursion RLS profiles ⇄ candidatures
-- Date : 2026-06-03
-- =============================================================================
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  À COPIER MANUELLEMENT DANS SUPABASE SQL EDITOR                        ║
-- ║                                                                           ║
-- ║  NE PAS APPLIQUER VIA `supabase db push`.                                 ║
-- ║                                                                           ║
-- ║  Idempotent : DROP IF EXISTS + CREATE OR REPLACE FUNCTION.                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- CONTEXTE
--   La migration boucle cœur (20260602120000_b_core_loop.sql, §13) a ajouté
--   la policy SELECT `profiles_org_unlocked_read` sur `profiles`. Cette
--   policy lit `candidatures` via EXISTS. Or `candidatures_expert_read`
--   (§10) lit `profiles` via EXISTS. → RÉCURSION RLS infinie.
--
--   Symptôme : TOUTE query `SELECT … FROM public.profiles` venant d'un user
--   authentifié 500 avec `42P17 infinite recursion detected in policy`.
--   PostgREST renvoie ça en 500 silencieux côté client.
--
-- FIX
--   Encapsuler le corps de `profiles_org_unlocked_read` dans une fonction
--   SECURITY DEFINER. Cette fonction s'exécute avec les droits de son owner
--   (postgres), bypasse les policies RLS des tables qu'elle consulte
--   (candidatures / publications / organization_members), ne re-déclenche
--   donc pas l'évaluation de `candidatures_expert_read` → CASSE LA BOUCLE.
--
--   Sécurité préservée :
--     - Le filtre `me.user_id = auth.uid()` reste DANS le corps : la
--       fonction est strictement bornée au user courant.
--     - search_path verrouillé à `public` (protection contre les schémas
--       malveillants en cas de POC d'élévation de privilège).
--     - STABLE : pas de side effect, optimiseur peut hoister.
--     - GRANT EXECUTE TO authenticated : seul authenticated peut l'appeler.
--
-- INVARIANT FONCTIONNEL
--   Le corps de la fonction est STRICTEMENT identique à la clause USING
--   actuelle (vérifié contre pg_policy avant écriture de cette migration).
--   Le comportement de masking candidature avant unlock est inchangé.
-- =============================================================================

BEGIN;


-- =============================================================================
-- 1. Fonction SECURITY DEFINER — corps identique à l'ancien USING
-- =============================================================================

CREATE OR REPLACE FUNCTION public.org_has_unlocked_candidature_for_profile(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.candidatures c
      JOIN public.publications pub
        ON pub.id = c.publication_id
      JOIN public.organization_members me
        ON me.organization_id = pub.organization_id
     WHERE c.profile_id = _profile_id
       AND c.status = 'unlocked'
       AND me.user_id = auth.uid()
       AND me.status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.org_has_unlocked_candidature_for_profile(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.org_has_unlocked_candidature_for_profile(uuid) TO authenticated;


-- =============================================================================
-- 2. Remplacement de la policy — appel de la fonction au lieu d'EXISTS inline
-- =============================================================================

DROP POLICY IF EXISTS profiles_org_unlocked_read ON public.profiles;
CREATE POLICY profiles_org_unlocked_read
  ON public.profiles
  FOR SELECT TO authenticated
  USING (public.org_has_unlocked_candidature_for_profile(profiles.id));


COMMIT;


-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION (manuelles)
-- =============================================================================
--
-- 1. La fonction existe avec les bons attributs :
--    SELECT proname, prosecdef AS security_definer, provolatile, proconfig
--      FROM pg_proc
--     WHERE proname = 'org_has_unlocked_candidature_for_profile';
--    → 1 ligne. security_definer=t, provolatile='s' (stable),
--      proconfig contient 'search_path=public'.
--
-- 2. La policy a bien été remplacée :
--    SELECT pg_get_expr(polqual, polrelid)
--      FROM pg_policy
--     WHERE polname = 'profiles_org_unlocked_read';
--    → renvoie `(org_has_unlocked_candidature_for_profile(profiles.id))`
--
-- 3. Test fonctionnel — un user authentifié peut maintenant lire son profile :
--    SET LOCAL role authenticated;
--    SET LOCAL request.jwt.claims TO '{"sub":"<un user_id>","role":"authenticated"}';
--    SELECT id FROM public.profiles WHERE user_id = '<un user_id>' LIMIT 1;
--    → 1 row, pas de 42P17.
-- =============================================================================
