-- =============================================================================
-- Migration : DROP des colonnes legacy `organizations.user_id` et `organizations.domain_id`
--             + REFACTO RLS organizations (legacy → multi-membres)
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
--   On peut donc maintenant DROP les colonnes legacy.
--
-- BLOQUEUR DÉTECTÉ AU 1ᵉʳ ESSAI :
--   3 policies RLS héritées de l'ancienne archi (1 user = propriétaire d'org)
--   référençaient `organizations.user_id` :
--     - organizations_self_read   (SELECT, qual: auth.uid() = user_id)
--     - organizations_self_update (UPDATE, qual: auth.uid() = user_id)
--     - organizations_self_insert (INSERT, with_check: auth.uid() = user_id)
--   Postgres refuse de DROP la colonne tant qu'elle est référencée.
--   On les remplace par des policies basées sur `organization_members`,
--   cohérentes avec l'archi multi-membres (admin/editor/viewer).
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
--     3. Cette migration (DROP des policies legacy + DROP des colonnes
--        + CREATE des nouvelles policies).
--   Pas requis ici car la BDD staging a été vidée avant le sprint.
--
-- IDEMPOTENT : DROP POLICY IF EXISTS, DROP CONSTRAINT IF EXISTS,
-- DROP COLUMN IF EXISTS, DROP POLICY IF EXISTS + CREATE POLICY pour les
-- nouvelles. Aucune autre table impactée (pas de FK entrante vers ces
-- colonnes droppées).
-- =============================================================================


-- =============================================================================
-- 1. DROP des policies legacy basées sur organizations.user_id
-- =============================================================================
-- Sans ce drop, le DROP COLUMN user_id échoue avec
-- "cannot drop column user_id of table organizations because other objects
-- depend on it".

DROP POLICY IF EXISTS organizations_self_read   ON public.organizations;
DROP POLICY IF EXISTS organizations_self_update ON public.organizations;
DROP POLICY IF EXISTS organizations_self_insert ON public.organizations;


-- =============================================================================
-- 2. DROP des contraintes FK legacy
-- =============================================================================
-- Postgres requiert le drop de la contrainte avant de pouvoir drop la colonne
-- si la FK n'est pas en CASCADE. On le fait explicitement pour rester clair.

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_user_id_fkey;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_domain_id_fkey;


-- =============================================================================
-- 3. DROP des colonnes legacy
-- =============================================================================

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS user_id;

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS domain_id;


-- =============================================================================
-- 4. CREATE des nouvelles policies (multi-membres via organization_members)
-- =============================================================================
-- Stratégie :
--   - SELECT : tout membre actif (admin/editor/viewer) lit son org
--   - UPDATE : seuls les admins actifs modifient l'org
--   - PAS de policy INSERT pour `authenticated` : les inscriptions org
--     passent obligatoirement par /api/auth/register-org (service_role
--     bypass RLS). Cela empêche un user authentifié de créer une org
--     arbitrairement sans passer par le flow officiel (vérification
--     entreprise, blocked_email_domains, etc.).
--   - PAS de policy DELETE : pas de cas d'usage user-side V1 (admin
--     back-office passera par service_role).
--
-- Pas de récursion infinie : ces policies interrogent organization_members,
-- dont les policies (créées en B1) ne dépendent QUE de organization_members
-- elle-même (pas d'aller-retour vers organizations).

DROP POLICY IF EXISTS organizations_member_read ON public.organizations;
CREATE POLICY organizations_member_read
  ON public.organizations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.organizations.id
        AND me.user_id = auth.uid()
        AND me.status = 'active'
    )
  );

DROP POLICY IF EXISTS organizations_admin_update ON public.organizations;
CREATE POLICY organizations_admin_update
  ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.organizations.id
        AND me.user_id = auth.uid()
        AND me.role_in_org = 'admin'
        AND me.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.organizations.id
        AND me.user_id = auth.uid()
        AND me.role_in_org = 'admin'
        AND me.status = 'active'
    )
  );


-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION (à exécuter à la main pour confirmer)
-- =============================================================================
-- Confirmer que les colonnes legacy ont disparu :
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
--
-- Confirmer les policies actives :
--   SELECT policyname, cmd, roles
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'organizations'
--    ORDER BY policyname;
--   -- Doit RETOURNER 2 lignes :
--   --   organizations_admin_update (UPDATE, {authenticated})
--   --   organizations_member_read  (SELECT, {authenticated})
--   -- Doit NE PAS contenir : organizations_self_read/update/insert
-- =============================================================================
