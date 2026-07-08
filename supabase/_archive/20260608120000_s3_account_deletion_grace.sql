-- =============================================================================
-- Migration : S3 — Suppression de compte expert (grâce 90 j + réactivation RGPD)
-- Date : 2026-06-08
-- =============================================================================
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  À COPIER MANUELLEMENT DANS SUPABASE SQL EDITOR                        ║
-- ║                                                                           ║
-- ║  100 % ADDITIVE — ADD COLUMN IF NOT EXISTS uniquement. AUCUN DROP,        ║
-- ║  AUCUN ALTER destructif. La base staging est partagée par 3 worktrees :   ║
-- ║  cette migration ne doit jamais casser l'existant.                        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- CONTEXTE (mission S3, section « Suppression du compte »)
--   À la demande de suppression (ré-auth + confirmation forte) on PROGRAMME
--   l'effacement à +90 jours au lieu de supprimer immédiatement :
--     • users.deletion_scheduled_at  = now() + 90 j  → la grâce court.
--     • profiles.visible             = false         → retrait IMMÉDIAT du
--       matching/feed (DRAPEAU EXISTANT lu par lib/matching/shared.ts, on ne
--       touche PAS la logique de matching).
--     • profiles.pre_deletion_visible= snapshot de visible AVANT le flip, pour
--       restaurer fidèlement à la réactivation (ne pas re-rendre visible un
--       profil qui ne l'était pas).
--   La connexion reste possible pour RÉACTIVER tant que anonymized_at IS NULL.
--
--   Purge (cron quotidien) — comptes dont deletion_scheduled_at <= now() et
--   anonymized_at IS NULL : anonymisation EN PLACE (jamais auth.admin.deleteUser,
--   car messages.sender_id est ON DELETE CASCADE → l'historique d'interactions
--   doit être PRÉSERVÉ sous forme anonymisée), puis blocage définitif du login
--   (ban via auth + email placeholder) et anonymized_at = now().
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. users — marqueurs de cycle de vie suppression (idempotent)
-- =============================================================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS anonymized_at         timestamptz;

COMMENT ON COLUMN public.users.deletion_scheduled_at IS
  'S3 — date d''effacement définitif programmé (now()+90j). NULL = compte actif. '
  'Pendant la grâce : login autorisé uniquement pour réactiver. Effacée à la réactivation.';
COMMENT ON COLUMN public.users.anonymized_at IS
  'S3 — horodatage de la purge effective (PII anonymisées + login banni). '
  'NULL tant que non purgé. Une fois posé, le login est définitivement bloqué.';

-- =============================================================================
-- 2. profiles — snapshot de visibilité pour réactivation fidèle (idempotent)
-- =============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS pre_deletion_visible   boolean;

COMMENT ON COLUMN public.profiles.deletion_scheduled_at IS
  'S3 — miroir de users.deletion_scheduled_at (marqueur ; la logique de matching '
  'ne le lit pas — elle continue de lire profiles.visible).';
COMMENT ON COLUMN public.profiles.pre_deletion_visible IS
  'S3 — valeur de profiles.visible AVANT le flip à false lors de la programmation '
  'de suppression. Sert à restaurer exactement le même état à la réactivation.';

-- =============================================================================
-- 3. Index partiel pour la requête du cron de purge (idempotent)
--    Le cron balaie les comptes échus non encore purgés.
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_users_deletion_due
  ON public.users (deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL AND anonymized_at IS NULL;

COMMIT;
