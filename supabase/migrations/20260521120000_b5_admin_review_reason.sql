-- =============================================================================
-- Migration : B5 — review_reason pour la décision admin
-- Sprint 11E — Phase 5 — Lot B5a
-- Date : 2026-05-21
-- =============================================================================
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  À COPIER DANS SUPABASE SQL EDITOR MANUELLEMENT ⚠️                    ║
-- ║                                                                           ║
-- ║  NE PAS APPLIQUER VIA `supabase db push`.                                 ║
-- ║                                                                           ║
-- ║  Étapes :                                                                 ║
-- ║    1. Ouvrir Supabase Dashboard → Project → SQL Editor                    ║
-- ║    2. New query → coller TOUT le contenu ci-dessous                       ║
-- ║    3. Run → vérifier "Success. No rows returned"                          ║
-- ║    4. Régénérer les types TS :                                            ║
-- ║       npx supabase gen types typescript --linked > lib/database.types.ts  ║
-- ║                                                                           ║
-- ║  Migration IDEMPOTENTE — ré-exécution safe (ADD COLUMN IF NOT EXISTS +    ║
-- ║  COMMENT ON est idempotent).                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- CONTEXTE :
--   Back-office admin /admin/organisations pour valider/refuser les orgs en
--   verification_status='pending_admin_review'.
--
--   Décision d'architecture D1 : RÉUTILISER les colonnes existantes
--   `verified_by` et `verified_at` pour la décision admin (pas de
--   reviewed_by/reviewed_at dupliqués).
--
--   On ajoute UNIQUEMENT `review_reason` (texte du motif admin, surtout
--   utile pour les rejets).
--
-- RAPPEL :
--   - `organizations.verified_by` (uuid, FK users.id, nullable) existe déjà.
--   - `organizations.verified_at` (timestamptz, nullable) existe déjà.
--
-- CONVENTION B5 (documentée via COMMENT ON COLUMN) :
--   verified_by = NULL    → approval AUTOMATIQUE (verdict runVerification)
--   verified_by ≠ NULL    → décision MANUELLE admin (approuvé OU refusé)
--   verified_at           → moment de la décision (rempli même pour rejet)
--   review_reason         → motif admin, surtout pour les refus
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

COMMENT ON COLUMN public.organizations.review_reason IS
  'Motif optionnel de la décision admin (surtout utilisé pour les refus). NULL = aucun motif renseigné. Cf. B5 back-office admin.';

COMMENT ON COLUMN public.organizations.verified_by IS
  'Auteur de la décision de vérification. NULL = approval AUTOMATIQUE par runVerification. Non-null = décision MANUELLE admin (approuvée ou refusée). Cf. convention B5.';

COMMENT ON COLUMN public.organizations.verified_at IS
  'Timestamp de la décision de vérification — rempli pour approved ET rejected. Cf. convention B5.';

-- =============================================================================
-- VÉRIFICATION POST-EXÉCUTION
-- =============================================================================
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'organizations'
--   AND column_name IN ('review_reason', 'verified_by', 'verified_at');
-- → 3 lignes attendues, toutes is_nullable = YES
--
-- SELECT col_description(
--   'public.organizations'::regclass,
--   ordinal_position
-- ) AS comment
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'organizations'
--   AND column_name IN ('review_reason', 'verified_by', 'verified_at');
-- → 3 commentaires non vides
-- =============================================================================
