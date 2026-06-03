-- =============================================================================
-- Migration : Lot — Vérification expert (badge Vérifié) + provider IA
-- Date : 2026-06-03
-- =============================================================================
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  À COPIER MANUELLEMENT DANS SUPABASE SQL EDITOR                        ║
-- ║                                                                           ║
-- ║  Idempotent : ADD COLUMN IF NOT EXISTS / WHERE NOT EXISTS.                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- CONTEXTE
--   Pattern symétrique à B1 (organizations) + B5 (review_reason) + core_loop
--   (publications). L'expert (profiles) hérite des mêmes colonnes de vérif
--   pour stocker score IA + motif + auto-approve OU pending_admin_review.
--
--   `users.is_verified` reste le DRAPEAU AGRÉGÉ pour l'UI (déjà câblé sur la
--   nav freelance). Il sera flippé à true lors de l'auto-approve OU de
--   l'approbation admin (route serveur). Source granulaire = profiles.verification_status.
--
-- DÉCISIONS (Lot vérif expert) :
--   D1 — déclencheur auto à PATCH /api/profile visible=true
--   D2 — threshold=7 (pending_admin_review) + auto_approve_threshold=9 (approved)
--   D3 — DOMAIN_MISMATCH plafonne à 5 (incohérence orientation principale uniquement)
--   D4 — re-gate Missions sur is_verified
--   D5 — LinkedIn = signal corroboration NON décisif
--
-- LOGIQUE DE DÉCISION (gravée — pas d'auto-reject V1) :
--   • score ≥ auto_approve_threshold ET sans flag disqualifiant → approved
--   • sinon → pending_admin_review  (admin tranche approve/reject + motif)
--   • erreur IA → pending_admin_review (fail-safe, JAMAIS auto-approve)
-- =============================================================================

BEGIN;


-- =============================================================================
-- 1. ALTER profiles — colonnes de vérif (idempotent)
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_status varchar,
  ADD COLUMN IF NOT EXISTS verification_method varchar,
  ADD COLUMN IF NOT EXISTS verification_score  numeric,
  ADD COLUMN IF NOT EXISTS verification_data   jsonb,
  ADD COLUMN IF NOT EXISTS verified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_reason       text;

COMMENT ON COLUMN public.profiles.verification_status IS
  'État vérif expert : pending|pending_admin_review|approved|rejected|requires_more_info';
COMMENT ON COLUMN public.profiles.verification_method IS
  'ai_web_search (IA seule) | manual_only (admin sans IA)';
COMMENT ON COLUMN public.profiles.verification_score IS
  'Score IA 0..10 — confiance cohérence (3 axes : CV↔profil / domaine / LinkedIn)';
COMMENT ON COLUMN public.profiles.verification_data IS
  'Trace IA : { score, notes, discrepancies, flags, last_provider, attempts_count, web_search_used }';
COMMENT ON COLUMN public.profiles.verified_at IS
  'Moment de la décision (rempli même pour rejet)';
COMMENT ON COLUMN public.profiles.verified_by IS
  'Admin qui a tranché (NULL pour auto-approve par l''IA)';
COMMENT ON COLUMN public.profiles.review_reason IS
  'Motif admin (surtout pour les refus, visible dans la bannière dashboard expert)';

-- CHECK status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_verification_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_verification_status_check
      CHECK (
        verification_status IS NULL OR verification_status IN (
          'pending',
          'pending_admin_review',
          'approved',
          'rejected',
          'requires_more_info'
        )
      );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS profiles_verification_status_idx
  ON public.profiles (verification_status);


-- =============================================================================
-- 2. verification_providers — étendre CHECK + row 'profile_verification'
-- =============================================================================
--
-- 2.a Étendre verification_providers_type_check pour autoriser
--     'profile_verification'. Reprend EXACTEMENT les valeurs définies par
--     core_loop (20260602120000) + Lot 2a (20260603140000) :
--       official_api, ai_web_search, manual_only,
--       opportunity_quality_check, profile_matching
--     + ajoute : profile_verification.
--     Idempotent : DROP IF EXISTS + ADD.

ALTER TABLE public.verification_providers
  DROP CONSTRAINT IF EXISTS verification_providers_type_check;

ALTER TABLE public.verification_providers
  ADD CONSTRAINT verification_providers_type_check
  CHECK (provider_type IN (
    'official_api',
    'ai_web_search',
    'manual_only',
    'opportunity_quality_check',
    'profile_matching',
    'profile_verification'
  ));

-- 2.b Row 'profile_verification' (idempotent)
--
-- Config jsonb peuplé (modèle, fallback, tokens, seuils, web_search uses,
-- plafond domain_mismatch). Tous tunables depuis la BDD, jamais en dur.
--
-- Décision finale lue côté code :
--   • confidence_threshold (col)            : seuil sous lequel → pending_admin_review
--   • config.auto_approve_threshold         : seuil ≥ lequel → approved (sans flag disqualif)
--   • config.domain_mismatch_cap            : plafond imposé si DOMAIN_MISMATCH flag
--
-- (Sémantique : seul auto_approve_threshold est utilisé pour décider approved ;
--  confidence_threshold est conservé pour symétrie avec 11G et lecture admin.)

INSERT INTO public.verification_providers
  (country_code, provider_type, provider_name,
   api_endpoint, api_key_secret_ref,
   priority, confidence_threshold, is_active, config)
SELECT 'FR', 'profile_verification', 'claude_expert_coherence_check',
       NULL, 'ANTHROPIC_API_KEY',
       10, 7, true,
       jsonb_build_object(
         'model', 'claude-haiku-4-5-20251001',
         'fallback_model', 'claude-sonnet-4-6',
         'max_tokens', 2500,
         'request_timeout_ms', 45000,
         'auto_approve_threshold', 9,
         'web_search_max_uses', 4,
         'domain_mismatch_cap', 5
       )
WHERE NOT EXISTS (
  SELECT 1 FROM public.verification_providers
   WHERE provider_type = 'profile_verification'
     AND country_code  = 'FR'
);


COMMIT;


-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION (manuelles)
-- =============================================================================
--
-- 1. Colonnes ajoutées :
--    SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='profiles'
--       AND column_name IN ('verification_status','verification_method',
--           'verification_score','verification_data','verified_at',
--           'verified_by','review_reason');
--    → 7 lignes attendues.
--
-- 2. CHECK + index :
--    SELECT conname FROM pg_constraint WHERE conname='profiles_verification_status_check';
--    SELECT indexname FROM pg_indexes WHERE indexname='profiles_verification_status_idx';
--    → 1 ligne chacun.
--
-- 3. Provider row :
--    SELECT provider_type, provider_name, confidence_threshold, is_active, config
--      FROM public.verification_providers
--     WHERE provider_type='profile_verification' AND country_code='FR';
--    → 1 ligne, is_active=true, config.auto_approve_threshold=9, config.domain_mismatch_cap=5.
