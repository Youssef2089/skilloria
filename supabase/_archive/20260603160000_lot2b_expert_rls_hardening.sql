-- =============================================================================
-- Migration : Lot 2b — durcissement RLS côté expert
-- Date : 2026-06-03
-- =============================================================================
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  À COPIER MANUELLEMENT DANS SUPABASE SQL EDITOR                        ║
-- ║                                                                           ║
-- ║  NE PAS APPLIQUER VIA `supabase db push`. Idempotent.                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- DEUX changements :
--
-- 1. DROP POLICY publications_published_expert_read
--    L'expert ne lit plus AUCUNE publication directement. Toutes les lectures
--    transitent par les routes serveur /api/me/missions/* (service_role) qui
--    ne renvoient QUE les opportunités matchées + masquent l'org confidentielle.
--    → Curation par matching ET masquage confidentiel deviennent NON
--      CONTOURNABLES (un appel direct supabase.from('publications') côté
--      expert retournera 0 ligne).
--    → Aucun consommateur existant : le côté expert n'est pas encore bâti ;
--      les routes serveur utilisent service_role qui bypasse les RLS.
--
-- 2. Renforcement candidatures_expert_insert
--    L'INSERT côté expert exige désormais qu'un MATCH existe pour le couple
--    (publication, expert courant). Fait via une fonction SECURITY DEFINER
--    bornée à auth.uid() (même pattern que org_has_unlocked_candidature) :
--      expert_has_match_for_publication(_publication_id) →
--        EXISTS(matches m JOIN profiles p ON p.id = m.profile_id
--               WHERE m.publication_id = _publication_id
--                 AND p.user_id = auth.uid())
--
--    Nouvelle policy WITH CHECK :
--      status='received'
--      AND profile.user_id = auth.uid()
--      AND public.expert_has_match_for_publication(publication_id)
--
--    → "Candidater-uniquement-aux-matchés" devient NON CONTOURNABLE au niveau
--      base. Un INSERT direct via supabase-js (Bearer expert) sur une publi
--      non matchée → refusé par la policy.
--
-- Aucun impact côté org / admin : leurs policies (publications_member_*,
-- candidatures_org_read) sont intactes. Les routes serveur en service_role
-- ne sont JAMAIS soumises aux RLS.
-- =============================================================================

BEGIN;


-- 1. DROP publications_published_expert_read ─────────────────────────────────

DROP POLICY IF EXISTS publications_published_expert_read ON public.publications;


-- 2. Fonction SECURITY DEFINER pour candidatures ─────────────────────────────
--    Bornée à auth.uid(). search_path verrouillé à public.

CREATE OR REPLACE FUNCTION public.expert_has_match_for_publication(_publication_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.matches m
      JOIN public.profiles p ON p.id = m.profile_id
     WHERE m.publication_id = _publication_id
       AND p.user_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.expert_has_match_for_publication(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.expert_has_match_for_publication(uuid) TO authenticated;


-- 3. Remplacement candidatures_expert_insert (exige match existant) ──────────

DROP POLICY IF EXISTS candidatures_expert_insert ON public.candidatures;

CREATE POLICY candidatures_expert_insert
  ON public.candidatures
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'received'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = candidatures.profile_id
        AND p.user_id = auth.uid()
    )
    AND public.expert_has_match_for_publication(candidatures.publication_id)
  );


COMMIT;


-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION (manuelles)
-- =============================================================================
--
-- 1. La policy publications_published_expert_read a disparu :
--    SELECT count(*) FROM pg_policies
--     WHERE schemaname='public' AND tablename='publications'
--       AND policyname='publications_published_expert_read';
--    → 0
--
-- 2. Les autres policies publications sont intactes :
--    SELECT policyname FROM pg_policies
--     WHERE schemaname='public' AND tablename='publications'
--     ORDER BY policyname;
--    → publications_member_read, publications_member_write (seulement les 2)
--
-- 3. La fonction expert_has_match_for_publication existe en SECURITY DEFINER :
--    SELECT proname, prosecdef, provolatile, proconfig
--      FROM pg_proc
--     WHERE proname = 'expert_has_match_for_publication';
--    → 1 ligne. prosecdef=t, provolatile='s', proconfig contient 'search_path=public'.
--
-- 4. La nouvelle policy candidatures_expert_insert exige un match :
--    SELECT with_check FROM pg_policies
--     WHERE schemaname='public' AND tablename='candidatures'
--       AND policyname='candidatures_expert_insert';
--    → renvoie une expression contenant `expert_has_match_for_publication(publication_id)`
--
-- 5. (preuve fonctionnelle) Un expert authentifié SANS match sur une publi
--    qui tente un INSERT → 23514 violates row-level security policy.
-- =============================================================================
