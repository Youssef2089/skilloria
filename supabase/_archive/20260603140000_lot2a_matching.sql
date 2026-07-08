-- =============================================================================
-- Migration : Lot 2a — moteur de matching IA
-- Date : 2026-06-03
-- =============================================================================
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  À COPIER MANUELLEMENT DANS SUPABASE SQL EDITOR                        ║
-- ║                                                                           ║
-- ║  NE PAS APPLIQUER VIA `supabase db push`. Idempotent.                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- 3 changements :
--   1. ALTER verification_providers ADD COLUMN config jsonb (nullable, non-breaking)
--   2. Seed row provider_type='profile_matching' (model, max_candidates, max_tokens,
--      confidence_threshold = seuil de notification)
--   3. DROP POLICY matches_org_read — masquage strict : l'org NE VOIT JAMAIS le
--      pool de matches IA, seulement les candidatures que les experts envoient
--      (+ profil complet après unlock). matches_expert_read conservée (l'expert
--      lit SES propres matches).
--
-- Aucune autre modif. Aucun risque sur les 2 autres providers (org_verif et
-- publication-quality) : `config` est nullable et ils ne le lisent pas.
-- =============================================================================

BEGIN;


-- 1. ALTER verification_providers — ajout config jsonb ────────────────────────

ALTER TABLE public.verification_providers
  ADD COLUMN IF NOT EXISTS config jsonb;

COMMENT ON COLUMN public.verification_providers.config IS
  'Configuration spécifique au provider (jsonb extensible). Exemples : '
  '{ "model": "claude-haiku-4-5-20251001", "max_candidates": 100, "max_tokens": 3000 }';


-- 2. CHECK constraint — autoriser le nouveau provider_type ───────────────────
--    Le check existant inclut déjà 'opportunity_quality_check'. On l'étend
--    pour ajouter 'profile_matching'. Idempotent.

ALTER TABLE public.verification_providers
  DROP CONSTRAINT IF EXISTS verification_providers_type_check;

ALTER TABLE public.verification_providers
  ADD CONSTRAINT verification_providers_type_check
  CHECK (provider_type IN (
    'official_api',
    'ai_web_search',
    'manual_only',
    'opportunity_quality_check',
    'profile_matching'
  ));


-- 3. Seed row 'profile_matching' (FR, idempotent via WHERE NOT EXISTS) ───────

INSERT INTO public.verification_providers
  (country_code, provider_type, provider_name,
   api_endpoint, api_key_secret_ref,
   priority, confidence_threshold, is_active, config)
SELECT
  'FR',
  'profile_matching',
  'claude_profile_matching',
  NULL,
  'ANTHROPIC_API_KEY',
  10,
  7,        -- seuil de NOTIFICATION : on notifie un expert si score >= 7
  true,
  jsonb_build_object(
    'model',          'claude-haiku-4-5-20251001',
    'max_candidates', 100,        -- borne du pool présenté à l'IA en un appel
    'max_tokens',     3000        -- output JSON {matches: [...]} peut être verbeux
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.verification_providers
   WHERE provider_type = 'profile_matching'
     AND country_code  = 'FR'
);


-- 4. DROP matches_org_read — masquage strict ─────────────────────────────────
--    L'org ne peut plus lire la table matches. Elle ne verra les profils que :
--    - via candidatures soumises par les experts
--    - via profiles_org_unlocked_read (Option C) après unlock d'une candidature
--    Cohérent avec la directive "rien pour l'org tant que candidature + unlock".

DROP POLICY IF EXISTS matches_org_read ON public.matches;


COMMIT;


-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION (manuelles)
-- =============================================================================
--
-- 1. La colonne config existe et est nullable :
--    SELECT column_name, data_type, is_nullable
--      FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='verification_providers'
--       AND column_name='config';
--    → 1 ligne : config / jsonb / YES
--
-- 2. Le seed profile_matching est en place :
--    SELECT country_code, provider_type, provider_name, confidence_threshold,
--           is_active, config
--      FROM public.verification_providers
--     WHERE provider_type = 'profile_matching';
--    → 1 ligne : FR / profile_matching / claude_profile_matching / 7 / true /
--      { model, max_candidates, max_tokens }
--
-- 3. matches_org_read a bien disparu :
--    SELECT count(*) FROM pg_policies
--     WHERE schemaname='public' AND tablename='matches'
--       AND policyname='matches_org_read';
--    → 0
--
-- 4. matches_expert_read est toujours là :
--    SELECT policyname FROM pg_policies
--     WHERE schemaname='public' AND tablename='matches';
--    → 1 ligne : matches_expert_read
-- =============================================================================
