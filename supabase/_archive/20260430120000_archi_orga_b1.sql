-- =============================================================================
-- Migration : Architecture organisations multi-membres / multi-domaines
-- Sprint 11E — Phase 2 — Lot B1
-- Date : 2026-04-30
-- =============================================================================
--
-- ⚠️ NE PAS APPLIQUER VIA `supabase db push` SANS VALIDATION.
-- À copier/coller manuellement dans le SQL Editor Supabase, puis exécuter.
--
-- 100 % IDEMPOTENT :
--   - ENUMS via DO blocks (CREATE TYPE IF NOT EXISTS n'existe pas en PG)
--   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   - CREATE TABLE IF NOT EXISTS
--   - CREATE INDEX IF NOT EXISTS
--   - DO blocks pour CHECK constraints et FK conditionnelles
--   - DROP POLICY IF EXISTS + CREATE POLICY pour les RLS
-- AUCUN DROP destructeur. AUCUN renommage.
--
-- ⚠️ NE PAS DROP `organizations.user_id` ni `organizations.domain_id` ICI.
-- Ces colonnes seront retirées dans une migration B6_MIGRATION_2 dédiée
-- une fois le code applicatif refacto pour utiliser organization_members
-- et organization_domains.
-- =============================================================================


-- =============================================================================
-- 1. ENUMS POSTGRES
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_role') THEN
    CREATE TYPE public.organization_role AS ENUM ('admin', 'editor', 'viewer');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'package_scope') THEN
    CREATE TYPE public.package_scope AS ENUM ('organization', 'user', 'organization_per_seat');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status_enum') THEN
    CREATE TYPE public.verification_status_enum AS ENUM (
      'pending_provider_check',
      'pending_admin_review',
      'approved',
      'rejected',
      'requires_more_info'
    );
  END IF;
END$$;


-- =============================================================================
-- 2. HELPER : trigger set_updated_at()
-- =============================================================================
-- Réutilisé par toutes les nouvelles tables. Créé seulement s'il n'existe pas.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


-- =============================================================================
-- 3. ALTER organizations — vérification entreprise + email domain
-- =============================================================================
-- ⚠️ user_id et domain_id NON DROPPÉS (à supprimer en B6_MIGRATION_2)

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS email_domain        varchar,
  ADD COLUMN IF NOT EXISTS verification_status varchar,
  ADD COLUMN IF NOT EXISTS verification_method varchar,
  ADD COLUMN IF NOT EXISTS verification_data   jsonb,
  ADD COLUMN IF NOT EXISTS verified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by         uuid,
  ADD COLUMN IF NOT EXISTS verification_notes  text;

-- Default applicatif : pending_provider_check à la création.
-- On ne pose pas de DEFAULT en BDD pour rester explicite côté API.

-- FK verified_by -> users(id), conditionnelle (si pas déjà créée)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_verified_by_fkey'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_verified_by_fkey
      FOREIGN KEY (verified_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END$$;

-- CHECK sur verification_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_verification_status_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_verification_status_check
      CHECK (
        verification_status IS NULL OR verification_status IN (
          'pending_provider_check',
          'pending_admin_review',
          'approved',
          'rejected',
          'requires_more_info'
        )
      );
  END IF;
END$$;

-- CHECK sur verification_method
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_verification_method_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_verification_method_check
      CHECK (
        verification_method IS NULL OR verification_method IN (
          'official_api',
          'ai_web_search',
          'manual_admin'
        )
      );
  END IF;
END$$;

-- UNIQUE partiel sur siren (la colonne siren existe déjà, il manque l'unicité)
CREATE UNIQUE INDEX IF NOT EXISTS organizations_siren_unique_idx
  ON public.organizations (siren)
  WHERE siren IS NOT NULL;

-- UNIQUE partiel sur email_domain
CREATE UNIQUE INDEX IF NOT EXISTS organizations_email_domain_unique_idx
  ON public.organizations (lower(email_domain))
  WHERE email_domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS organizations_verification_status_idx
  ON public.organizations (verification_status);


-- =============================================================================
-- 4. ALTER users — phone_verified
-- =============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;


-- =============================================================================
-- 5. ALTER packages — scope, included_domain_ids, max_seats
-- =============================================================================

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS scope               varchar NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS included_domain_ids uuid[],
  ADD COLUMN IF NOT EXISTS max_seats           int;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'packages_scope_check'
  ) THEN
    ALTER TABLE public.packages
      ADD CONSTRAINT packages_scope_check
      CHECK (scope IN ('organization', 'user', 'organization_per_seat'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'packages_max_seats_positive_check'
  ) THEN
    ALTER TABLE public.packages
      ADD CONSTRAINT packages_max_seats_positive_check
      CHECK (max_seats IS NULL OR max_seats > 0);
  END IF;
END$$;


-- =============================================================================
-- 6. NOUVELLE TABLE : organization_members
-- =============================================================================
-- Liaison user <-> organization avec rôle interne (admin|editor|viewer).

CREATE TABLE IF NOT EXISTS public.organization_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_in_org     varchar NOT NULL DEFAULT 'viewer',
  status          varchar NOT NULL DEFAULT 'active',
  joined_at       timestamptz NOT NULL DEFAULT now(),
  invited_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_members_user_org_unique'
  ) THEN
    ALTER TABLE public.organization_members
      ADD CONSTRAINT organization_members_user_org_unique
      UNIQUE (user_id, organization_id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_members_role_check'
  ) THEN
    ALTER TABLE public.organization_members
      ADD CONSTRAINT organization_members_role_check
      CHECK (role_in_org IN ('admin', 'editor', 'viewer'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_members_status_check'
  ) THEN
    ALTER TABLE public.organization_members
      ADD CONSTRAINT organization_members_status_check
      CHECK (status IN ('active', 'pending', 'suspended', 'removed'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS organization_members_org_idx
  ON public.organization_members (organization_id);

CREATE INDEX IF NOT EXISTS organization_members_user_idx
  ON public.organization_members (user_id);

DROP TRIGGER IF EXISTS trg_organization_members_updated_at ON public.organization_members;
CREATE TRIGGER trg_organization_members_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 7. NOUVELLE TABLE : organization_invitations
-- =============================================================================
-- Tokens d'invitation par email avec validation domaine.

CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email                     varchar NOT NULL,
  token                     varchar NOT NULL,
  role_in_org               varchar NOT NULL DEFAULT 'viewer',
  invited_by                uuid REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at                timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at               timestamptz,
  status                    varchar NOT NULL DEFAULT 'pending',
  domain_validation_passed  boolean NOT NULL DEFAULT false,
  email_already_exists      boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_invitations_token_unique'
  ) THEN
    ALTER TABLE public.organization_invitations
      ADD CONSTRAINT organization_invitations_token_unique
      UNIQUE (token);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_invitations_role_check'
  ) THEN
    ALTER TABLE public.organization_invitations
      ADD CONSTRAINT organization_invitations_role_check
      CHECK (role_in_org IN ('admin', 'editor', 'viewer'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_invitations_status_check'
  ) THEN
    ALTER TABLE public.organization_invitations
      ADD CONSTRAINT organization_invitations_status_check
      CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS organization_invitations_org_idx
  ON public.organization_invitations (organization_id);

CREATE INDEX IF NOT EXISTS organization_invitations_email_idx
  ON public.organization_invitations (lower(email));

CREATE INDEX IF NOT EXISTS organization_invitations_status_idx
  ON public.organization_invitations (status, expires_at);

DROP TRIGGER IF EXISTS trg_organization_invitations_updated_at ON public.organization_invitations;
CREATE TRIGGER trg_organization_invitations_updated_at
  BEFORE UPDATE ON public.organization_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 8. NOUVELLE TABLE : organization_domains
-- =============================================================================
-- Multi-domaines par org (Microsoft + SAP + Salesforce + …) avec package par domaine.

CREATE TABLE IF NOT EXISTS public.organization_domains (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain_id       uuid NOT NULL REFERENCES public.domains(id) ON DELETE RESTRICT,
  active          boolean NOT NULL DEFAULT true,
  activated_at    timestamptz NOT NULL DEFAULT now(),
  package_id      uuid REFERENCES public.packages(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_domains_org_domain_unique'
  ) THEN
    ALTER TABLE public.organization_domains
      ADD CONSTRAINT organization_domains_org_domain_unique
      UNIQUE (organization_id, domain_id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS organization_domains_org_idx
  ON public.organization_domains (organization_id);

CREATE INDEX IF NOT EXISTS organization_domains_domain_idx
  ON public.organization_domains (domain_id);

DROP TRIGGER IF EXISTS trg_organization_domains_updated_at ON public.organization_domains;
CREATE TRIGGER trg_organization_domains_updated_at
  BEFORE UPDATE ON public.organization_domains
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 9. NOUVELLE TABLE : verification_providers
-- =============================================================================
-- Fournisseurs de vérification entreprise par pays (API officielle / IA / manuel).

CREATE TABLE IF NOT EXISTS public.verification_providers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code          varchar(2) NOT NULL,
  provider_type         varchar NOT NULL,
  provider_name         varchar NOT NULL,
  api_endpoint          text,
  api_key_secret_ref    varchar,
  is_active             boolean NOT NULL DEFAULT true,
  priority              int NOT NULL DEFAULT 100,
  confidence_threshold  int NOT NULL DEFAULT 9,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verification_providers_country_name_unique'
  ) THEN
    ALTER TABLE public.verification_providers
      ADD CONSTRAINT verification_providers_country_name_unique
      UNIQUE (country_code, provider_name);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verification_providers_type_check'
  ) THEN
    ALTER TABLE public.verification_providers
      ADD CONSTRAINT verification_providers_type_check
      CHECK (provider_type IN ('official_api', 'ai_web_search', 'manual_only'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verification_providers_confidence_check'
  ) THEN
    ALTER TABLE public.verification_providers
      ADD CONSTRAINT verification_providers_confidence_check
      CHECK (confidence_threshold BETWEEN 0 AND 10);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS verification_providers_country_priority_idx
  ON public.verification_providers (country_code, priority)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_verification_providers_updated_at ON public.verification_providers;
CREATE TRIGGER trg_verification_providers_updated_at
  BEFORE UPDATE ON public.verification_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 10. NOUVELLE TABLE : verification_attempts
-- =============================================================================
-- Audit trail de chaque tentative de vérification entreprise.

CREATE TABLE IF NOT EXISTS public.verification_attempts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  attempt_at                timestamptz NOT NULL DEFAULT now(),
  provider_used             varchar NOT NULL,
  result                    varchar NOT NULL,
  confidence_score          int,
  raw_response              jsonb,
  triggered_admin_review    boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verification_attempts_result_check'
  ) THEN
    ALTER TABLE public.verification_attempts
      ADD CONSTRAINT verification_attempts_result_check
      CHECK (result IN ('approved', 'rejected', 'inconclusive', 'error'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verification_attempts_confidence_check'
  ) THEN
    ALTER TABLE public.verification_attempts
      ADD CONSTRAINT verification_attempts_confidence_check
      CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 10);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS verification_attempts_org_idx
  ON public.verification_attempts (organization_id, attempt_at DESC);


-- =============================================================================
-- 11. NOUVELLE TABLE : blocked_email_domains
-- =============================================================================
-- Liste noire de domaines email (jetables, frauduleux, etc.).

CREATE TABLE IF NOT EXISTS public.blocked_email_domains (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_domain  varchar NOT NULL,
  reason        text,
  added_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS blocked_email_domains_domain_unique_idx
  ON public.blocked_email_domains (lower(email_domain));

CREATE INDEX IF NOT EXISTS blocked_email_domains_active_idx
  ON public.blocked_email_domains (active)
  WHERE active = true;

DROP TRIGGER IF EXISTS trg_blocked_email_domains_updated_at ON public.blocked_email_domains;
CREATE TRIGGER trg_blocked_email_domains_updated_at
  BEFORE UPDATE ON public.blocked_email_domains
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 12. NOUVELLE TABLE : session_logs
-- =============================================================================
-- Logs IP + user-agent à chaque connexion (anti-partage / forensic).

CREATE TABLE IF NOT EXISTS public.session_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ip_address      inet,
  user_agent      text,
  login_at        timestamptz NOT NULL DEFAULT now(),
  session_token   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_logs_user_login_idx
  ON public.session_logs (user_id, login_at DESC);

CREATE INDEX IF NOT EXISTS session_logs_login_at_idx
  ON public.session_logs (login_at DESC);


-- =============================================================================
-- 13. RLS — Activation + policies
-- =============================================================================
-- Stratégie :
--   • service_role bypass automatique (les routes API utilisent supabaseAdmin)
--   • authenticated : un membre lit son org ; un admin écrit son org
--   • Toutes les policies sont (re)déclarées via DROP IF EXISTS + CREATE
--     pour rester idempotentes.

-- ----- organization_members --------------------------------------------------

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_members_select_self_or_org
  ON public.organization_members;
CREATE POLICY organization_members_select_self_or_org
  ON public.organization_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.organization_members.organization_id
        AND me.user_id = auth.uid()
        AND me.status = 'active'
    )
  );

DROP POLICY IF EXISTS organization_members_admin_write
  ON public.organization_members;
CREATE POLICY organization_members_admin_write
  ON public.organization_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members admin
      WHERE admin.organization_id = public.organization_members.organization_id
        AND admin.user_id = auth.uid()
        AND admin.role_in_org = 'admin'
        AND admin.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members admin
      WHERE admin.organization_id = public.organization_members.organization_id
        AND admin.user_id = auth.uid()
        AND admin.role_in_org = 'admin'
        AND admin.status = 'active'
    )
  );

-- ----- organization_invitations ---------------------------------------------

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_invitations_admin_all
  ON public.organization_invitations;
CREATE POLICY organization_invitations_admin_all
  ON public.organization_invitations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.organization_invitations.organization_id
        AND me.user_id = auth.uid()
        AND me.role_in_org = 'admin'
        AND me.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.organization_invitations.organization_id
        AND me.user_id = auth.uid()
        AND me.role_in_org = 'admin'
        AND me.status = 'active'
    )
  );

DROP POLICY IF EXISTS organization_invitations_member_read
  ON public.organization_invitations;
CREATE POLICY organization_invitations_member_read
  ON public.organization_invitations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.organization_invitations.organization_id
        AND me.user_id = auth.uid()
        AND me.status = 'active'
    )
  );

-- ----- organization_domains -------------------------------------------------

ALTER TABLE public.organization_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_domains_member_read
  ON public.organization_domains;
CREATE POLICY organization_domains_member_read
  ON public.organization_domains
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.organization_domains.organization_id
        AND me.user_id = auth.uid()
        AND me.status = 'active'
    )
  );

DROP POLICY IF EXISTS organization_domains_admin_write
  ON public.organization_domains;
CREATE POLICY organization_domains_admin_write
  ON public.organization_domains
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.organization_domains.organization_id
        AND me.user_id = auth.uid()
        AND me.role_in_org = 'admin'
        AND me.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.organization_domains.organization_id
        AND me.user_id = auth.uid()
        AND me.role_in_org = 'admin'
        AND me.status = 'active'
    )
  );

-- ----- verification_providers (lecture authentifiée, écriture admin BO) -----

ALTER TABLE public.verification_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verification_providers_authenticated_read
  ON public.verification_providers;
CREATE POLICY verification_providers_authenticated_read
  ON public.verification_providers
  FOR SELECT TO authenticated
  USING (is_active = true);

-- Pas de policy d'écriture pour authenticated : seul service_role peut
-- modifier (back-office admin via /api/admin/verification-providers en B5).

-- ----- verification_attempts ------------------------------------------------

ALTER TABLE public.verification_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verification_attempts_admin_read
  ON public.verification_attempts;
CREATE POLICY verification_attempts_admin_read
  ON public.verification_attempts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.verification_attempts.organization_id
        AND me.user_id = auth.uid()
        AND me.role_in_org = 'admin'
        AND me.status = 'active'
    )
  );

-- Pas de policy d'écriture pour authenticated : seul service_role insère
-- (route /api/auth/register-org en B2).

-- ----- blocked_email_domains ------------------------------------------------

ALTER TABLE public.blocked_email_domains ENABLE ROW LEVEL SECURITY;

-- Pas de policy authenticated : table accédée uniquement via service_role
-- (vérification à l'inscription / au renvoi d'invitation).

-- ----- session_logs ---------------------------------------------------------

ALTER TABLE public.session_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS session_logs_self_read
  ON public.session_logs;
CREATE POLICY session_logs_self_read
  ON public.session_logs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Pas de policy d'écriture pour authenticated : seul service_role insère
-- (helper lib/session-log.ts depuis les routes API en B2).


-- =============================================================================
-- 14. SEED MINIMAL — verification_providers (FR uniquement, V1)
-- =============================================================================
-- Les tokens sont des références (variables d'env), pas les valeurs réelles.
-- Idempotent via ON CONFLICT.

INSERT INTO public.verification_providers
  (country_code, provider_type, provider_name, api_endpoint, api_key_secret_ref, priority, confidence_threshold, is_active)
VALUES
  ('FR', 'official_api', 'sirene_insee',
   'https://api.insee.fr/entreprises/sirene/V3.11',
   'SIRENE_API_TOKEN', 10, 9, true),
  ('FR', 'ai_web_search', 'claude_web_fallback',
   NULL, 'ANTHROPIC_API_KEY', 100, 9, true)
ON CONFLICT (country_code, provider_name) DO NOTHING;


-- =============================================================================
-- FIN MIGRATION B1
-- =============================================================================
-- Pour vérifier l'état post-migration :
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN (
--        'organization_members','organization_invitations','organization_domains',
--        'verification_providers','verification_attempts','blocked_email_domains',
--        'session_logs');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'organizations'
--      AND column_name IN ('email_domain','verification_status','verification_method',
--                          'verification_data','verified_at','verified_by','verification_notes');
-- =============================================================================
