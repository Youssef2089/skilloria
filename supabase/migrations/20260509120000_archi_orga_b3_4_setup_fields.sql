-- =============================================================================
-- Migration : Champs setup post-login organisation (B3.4)
-- Sprint 11E — Phase 4 — Lot B3.4
-- Date : 2026-05-09
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
-- ║       npx supabase gen types typescript --project-id <ID> > lib/database.types.ts ║
-- ║                                                                           ║
-- ║  Migration IDEMPOTENTE — ré-exécution safe.                               ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- CONTEXTE :
--   Modale bloquante post-login (B3.4) qui collecte des champs nécessaires
--   à la finalisation de l'inscription organisation :
--     - users.civility    (M./Mme/Mx)
--     - users.job_title   (poste occupé)
--     - users.linkedin_url
--     - organizations.setup_completed_at (timestamp de complétion)
--
-- RAPPEL :
--   - `organizations.siren` existe déjà (B1) → UPDATE direct
--   - `organizations.org_type` existe déjà (B1) → UPDATE direct
--   - `organizations.website_url` existe déjà (B1) → UPDATE direct
--     (la modale envoie `website` côté UI mais la colonne réelle est website_url)
--
-- COLONNES NON TOUCHÉES :
--   - users.user_type reste FIGÉ à la création (routing dashboard inchangé)
--   - users.email_verified, phone_verified, etc.
-- =============================================================================

-- ── public.users : 3 nouvelles colonnes ──────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS civility TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS linkedin_url TEXT;

-- CHECK constraint sur civility (idempotente : on ne le crée que s'il n'existe pas)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_civility_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_civility_check
      CHECK (civility IS NULL OR civility IN ('mr', 'mrs', 'mx'));
  END IF;
END $$;

COMMENT ON COLUMN public.users.civility IS
  'M./Mme/Mx — collecté en modale post-login (B3.4). NULL = pas encore renseigné.';
COMMENT ON COLUMN public.users.job_title IS
  'Poste occupé par l''user dans l''organisation — modale post-login (B3.4).';
COMMENT ON COLUMN public.users.linkedin_url IS
  'URL profil LinkedIn (optionnelle) — modale post-login (B3.4).';

-- ── public.organizations : 1 nouvelle colonne ────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.organizations.setup_completed_at IS
  'Timestamp de complétion de la modale setup post-login (B3.4). NULL = setup à faire ; not null = setup OK.';

-- =============================================================================
-- VÉRIFICATIONS POST-EXÉCUTION (à lancer manuellement après pour confirmer)
-- =============================================================================
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'users'
--   AND column_name IN ('civility', 'job_title', 'linkedin_url');
-- → 3 lignes attendues, toutes is_nullable = YES
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'organizations'
--   AND column_name = 'setup_completed_at';
-- → 1 ligne attendue, data_type = 'timestamp with time zone'
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname = 'users_civility_check';
-- → 1 ligne attendue avec CHECK (civility = ANY (ARRAY['mr','mrs','mx']) OR civility IS NULL)
-- =============================================================================
