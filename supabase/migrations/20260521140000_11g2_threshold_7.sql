-- =============================================================================
-- Migration : 11G.2 — seuil de décision IA passé à 7 (avec recherche web active)
-- Sprint 11G.2 — Verification web search + retrait plafond INSEE
-- Date : 2026-05-21
-- =============================================================================
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  À EXÉCUTER MANUELLEMENT DANS SUPABASE SQL EDITOR ⚠️                  ║
-- ║                                                                           ║
-- ║  ⚠️  ORDRE : exécuter CETTE migration AVANT le test runtime 11G.2.       ║
-- ║      Sinon le code applicatif (avec recherche web active) tournerait     ║
-- ║      contre l'ancien seuil 9, plafonnant des orgs cohérentes en          ║
-- ║      pending_admin_review à tort.                                         ║
-- ║                                                                           ║
-- ║  NE PAS APPLIQUER VIA `supabase db push`.                                 ║
-- ║                                                                           ║
-- ║  Étapes :                                                                 ║
-- ║    1. Supabase Dashboard → SQL Editor → New query                         ║
-- ║    2. Coller TOUT le contenu ci-dessous                                   ║
-- ║    3. Run → vérifier "Success. No rows returned"                          ║
-- ║                                                                           ║
-- ║  Migration IDEMPOTENTE — ré-exécution safe.                               ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- CONTEXTE :
--   11G.2 active la recherche web Claude (web_search_20250305) dans
--   l'analyseur de cohérence. L'IA n'évalue plus seulement le déclaratif :
--   elle recoupe activement avec des registres officiels en ligne.
--
--   La fiabilité du score étant beaucoup plus élevée (vérification web
--   citée + données INSEE comparées), on abaisse le seuil d'auto-approve
--   de 9 à 7 — décision produit D5.
--
--   Le code applicatif ne touche pas au seuil en dur : il lit toujours
--   `confidence_threshold` depuis le row provider_type='ai_web_search' via
--   `runVerification`. La constante de secours côté code (`FALLBACK_DECISION_THRESHOLD`)
--   est également alignée à 7 en parallèle (cas edge "aucun row trouvé").
-- =============================================================================

UPDATE public.verification_providers
SET confidence_threshold = 7,
    updated_at = now()
WHERE provider_name = 'ai_coherence_check'
  AND provider_type = 'ai_web_search';

-- =============================================================================
-- VÉRIFICATION POST-EXÉCUTION
-- =============================================================================
--
-- SELECT country_code, provider_type, provider_name, confidence_threshold,
--        is_active, priority
-- FROM public.verification_providers
-- ORDER BY country_code, priority;
--
-- → Le row 'ai_coherence_check' (provider_type='ai_web_search') doit avoir
--   confidence_threshold = 7.
-- =============================================================================
