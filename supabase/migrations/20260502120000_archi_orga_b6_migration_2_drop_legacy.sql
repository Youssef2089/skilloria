-- =============================================================================
-- Migration : DROP des colonnes legacy `organizations.user_id` et `organizations.domain_id`
-- Sprint 11E — Phase 4 — Lot B6 MIGRATION 2
-- Date : 2026-05-02
-- =============================================================================
--
-- ⚠️ NE PAS APPLIQUER VIA `supabase db push` SANS VALIDATION.
-- À copier/coller manuellement dans le SQL Editor Supabase, puis exécuter.
--
-- CONTEXTE :
--   La migration B1 (`20260430120000_archi_orga_b1.sql`) avait laissé
--   intactes les colonnes legacy `organizations.user_id` (uuid NOT NULL FK users)
--   et `organizations.domain_id` (uuid NOT NULL FK domains) avec un commentaire
--   explicite "TO DROP IN B6_MIGRATION_2", le temps que la nouvelle archi
--   (organization_members + organization_domains) soit en place et que le
--   code applicatif soit aligné.
--
--   Après vérification :
--     - `organization_members` (créée en B1) gère la relation user ↔ org
--     - `organization_domains` (créée en B1) gère la relation org ↔ domain
--     - `app/api/auth/register-org/route.ts` n'insère plus `user_id`/`domain_id`
--     - Audit code complet : aucune autre route, helper, ou page UI ne
--       consomme `organizations.user_id` ou `organizations.domain_id`
--
--   On peut donc maintenant DROP les colonnes legacy en toute sécurité.
--
-- ORDRE D'EXÉCUTION CRITIQUE :
--   Cette migration doit être exécutée APRÈS le déploiement du code refacto
--   (commit `Feat(11E B6 MIGRATION 2)`). Sinon, fenêtre temporaire où la
--   BDD a encore les colonnes mais le code ne les remplit plus → NOT NULL
--   violation. En staging (BDD vidée, seul testeur), la fenêtre est OK.
--
-- DETTE TECHNIQUE PROD :
--   Pour une exécution future en PROD avec données existantes, appliquer
--   le pattern en 2 temps :
--     1. ALTER TABLE organizations ALTER COLUMN user_id DROP NOT NULL ;
--        ALTER TABLE organizations ALTER COLUMN domain_id DROP NOT NULL ;
--     2. (Déployer le code refacto)
--     3. DROP des colonnes (ce script).
--   Pas requis ici car la BDD staging a été vidée avant le sprint.
--
-- IDEMPOTENT : DROP CONSTRAINT IF EXISTS + DROP COLUMN IF EXISTS.
-- Aucune autre table impactée (pas de FK entrante vers ces colonnes).
-- =============================================================================


-- =============================================================================
-- 1. DROP des contraintes FK legacy
-- =============================================================================
-- Postgres requiert le drop de la contrainte avant de pouvoir drop la colonne
-- si la FK n'est pas en CASCADE. On le fait explicitement pour rester clair.

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_user_id_fkey;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_domain_id_fkey;


-- =============================================================================
-- 2. DROP des colonnes legacy
-- =============================================================================

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS user_id;

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS domain_id;


-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION (à exécuter à la main pour confirmer)
-- =============================================================================
-- Confirmer que les colonnes ont disparu :
--   SELECT column_name
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'organizations'
--    ORDER BY ordinal_position;
--   -- Doit RETOURNER : id, org_type, company_name, country, sector, size,
--   --                  description, logo_url, website_url, siren, vat_number,
--   --                  is_verified, created_at, updated_at, email_domain,
--   --                  verification_status, verification_method,
--   --                  verification_data, verified_at, verified_by,
--   --                  verification_notes
--   -- Doit NE PAS contenir : user_id, domain_id
--
-- Confirmer qu'aucune contrainte legacy n'est restée :
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.organizations'::regclass
--    ORDER BY conname;
--   -- Doit NE PAS contenir : organizations_user_id_fkey, organizations_domain_id_fkey
-- =============================================================================
