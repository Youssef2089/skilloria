-- =============================================================================
-- Migration : 11G — renommage cosmétique du provider IA
-- Sprint 11G — Vérification cohérence systématique
-- Date : 2026-05-21
-- =============================================================================
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  À EXÉCUTER MANUELLEMENT DANS SUPABASE SQL EDITOR ⚠️                  ║
-- ║                                                                           ║
-- ║  ⚠️  ORDRE OBLIGATOIRE : exécuter CETTE migration AVANT le déploiement   ║
-- ║      du code 11G, sinon décalage code/BDD.                                ║
-- ║                                                                           ║
-- ║  NE PAS APPLIQUER VIA `supabase db push`.                                 ║
-- ║                                                                           ║
-- ║  Étapes :                                                                 ║
-- ║    1. Ouvrir Supabase Dashboard → Project → SQL Editor                    ║
-- ║    2. New query → coller TOUT le contenu ci-dessous                       ║
-- ║    3. Run → vérifier "Success. No rows returned"                          ║
-- ║                                                                           ║
-- ║  Migration IDEMPOTENTE — ré-exécution safe (UPDATE conditionnel).         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- CONTEXTE :
--   Sprint 11G refacto le flow runVerification : l'IA n'est PLUS un fallback,
--   c'est le décideur systématique de cohérence (Sirene devient un simple
--   fournisseur de données). Le row historique 'claude_web_fallback' porte
--   donc un nom trompeur en BDD.
--
--   Cette migration renomme `claude_web_fallback` → `ai_coherence_check`
--   pour aligner la sémantique BDD sur la nouvelle réalité métier.
--
--   La logique applicative ne dépend PAS du nom — elle lit le threshold
--   du row de `provider_type='ai_web_search'` (sémantique par type, pas
--   par nom). Mais on aligne le nom pour ne pas laisser un "mensonge
--   sémantique" en base (règle d'or projet : pas de naming trompeur).
--
-- ALIGNEMENT CODE :
--   Le commit 11G met à jour PROVIDER_REGISTRY dans lib/verification/index.ts
--   pour utiliser la clé `ai_coherence_check`. Sans cette migration appliquée
--   AVANT le déploiement, le code ne trouverait plus le row à `provider_name`
--   correspondant dans la table `verification_attempts.provider_used` (juste
--   un mismatch de label de log — pas de crash, mais incohérence d'audit).
-- =============================================================================

UPDATE public.verification_providers
SET provider_name = 'ai_coherence_check',
    updated_at = now()
WHERE provider_name = 'claude_web_fallback'
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
-- → Le row 'ai_web_search' doit avoir provider_name = 'ai_coherence_check'.
-- → Aucun row 'claude_web_fallback' ne doit subsister.
-- =============================================================================
