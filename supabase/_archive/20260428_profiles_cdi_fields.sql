-- =============================================================================
-- Migration : ajout des champs CDI à la table `profiles`
-- Voie 3 — Bloc 11D-2
-- Date : 2026-04-28
-- =============================================================================
--
-- ⚠️ NE PAS APPLIQUER VIA `supabase db push` SANS VALIDATION.
-- À copier/coller manuellement dans le SQL Editor Supabase, puis exécuter.
--
-- Idempotent : `ADD COLUMN IF NOT EXISTS` + `DO $$` pour les CHECK constraints.
-- Aucun DROP, aucun renommage, aucun default destructeur.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- NOTE SÉMANTIQUE — Coexistence `cdi_status` ↔ `availability_status`
-- -----------------------------------------------------------------------------
-- La colonne `availability_status` existante (utilisée par les Freelance) reste
-- inchangée. La colonne `cdi_status` ajoutée ci-dessous est volontairement
-- distincte car les concepts diffèrent :
--
--   • Freelance → `availability_status` : "disponible immédiate / occupé / etc."
--   • CDI       → `cdi_status`         : "en poste / à l'écoute / en recherche active"
--
-- Le front lit `cdi_status` quand `users.role = 'cdi'`, sinon
-- `availability_status`. Voir `lib/hooks/useCdiProfile.ts` (à venir).
--
-- De même, `cdi_availability_date` ≠ `availability_date` :
--   • Freelance → `availability_date`     : date de dispo immédiate
--   • CDI       → `cdi_availability_date` : date probable de prise de poste
--                                           (après préavis)
-- -----------------------------------------------------------------------------

ALTER TABLE public.profiles
  -- Statut écoute marché CDI (différent de availability_status freelance)
  ADD COLUMN IF NOT EXISTS cdi_status TEXT,

  -- Délai de préavis
  ADD COLUMN IF NOT EXISTS cdi_notice_period TEXT,

  -- Date probable de prise de poste (après préavis)
  ADD COLUMN IF NOT EXISTS cdi_availability_date DATE,

  -- Mode confidentiel (cacher de l'employeur actuel)
  ADD COLUMN IF NOT EXISTS cdi_confidential_mode BOOLEAN DEFAULT false,

  -- Salaire annuel brut min/max (en euros, entiers)
  ADD COLUMN IF NOT EXISTS cdi_salary_min INTEGER,
  ADD COLUMN IF NOT EXISTS cdi_salary_max INTEGER,

  -- Variable bonus (% du fixe)
  ADD COLUMN IF NOT EXISTS cdi_variable_pct INTEGER,

  -- Avantages recherchés (multi-select)
  ADD COLUMN IF NOT EXISTS cdi_benefits TEXT[],

  -- Taille entreprise préférée (multi-select)
  ADD COLUMN IF NOT EXISTS cdi_company_size TEXT[],

  -- Secteurs préférés (multi-select)
  ADD COLUMN IF NOT EXISTS cdi_sectors TEXT[],

  -- Mobilité géographique
  ADD COLUMN IF NOT EXISTS cdi_geo_mobility TEXT,

  -- Types de contrat acceptés (multi-select)
  ADD COLUMN IF NOT EXISTS cdi_contract_types TEXT[],

  -- Motivations privées (vu uniquement après candidature)
  ADD COLUMN IF NOT EXISTS cdi_motivations TEXT,

  -- Career goals publics (ce que je recherche)
  ADD COLUMN IF NOT EXISTS cdi_career_goals TEXT;

-- -----------------------------------------------------------------------------
-- CHECK constraints (idempotents : on droppe si déjà présents puis on recrée)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  -- cdi_status : 3 valeurs autorisées
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND constraint_name = 'profiles_cdi_status_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_cdi_status_check;
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_cdi_status_check
    CHECK (cdi_status IS NULL OR cdi_status IN ('employed','open_to_work','actively_searching'));

  -- cdi_notice_period : 5 valeurs autorisées
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND constraint_name = 'profiles_cdi_notice_period_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_cdi_notice_period_check;
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_cdi_notice_period_check
    CHECK (cdi_notice_period IS NULL OR cdi_notice_period IN ('immediate','1_month','2_months','3_months','negotiable'));

  -- cdi_geo_mobility : 4 valeurs autorisées
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND constraint_name = 'profiles_cdi_geo_mobility_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_cdi_geo_mobility_check;
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_cdi_geo_mobility_check
    CHECK (cdi_geo_mobility IS NULL OR cdi_geo_mobility IN ('local','regional','national','international'));

  -- cdi_salary_min / cdi_salary_max : positifs
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND constraint_name = 'profiles_cdi_salary_min_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_cdi_salary_min_check;
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_cdi_salary_min_check
    CHECK (cdi_salary_min IS NULL OR cdi_salary_min >= 0);

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND constraint_name = 'profiles_cdi_salary_max_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_cdi_salary_max_check;
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_cdi_salary_max_check
    CHECK (cdi_salary_max IS NULL OR cdi_salary_max >= 0);

  -- cdi_variable_pct : 0 .. 100
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND constraint_name = 'profiles_cdi_variable_pct_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_cdi_variable_pct_check;
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_cdi_variable_pct_check
    CHECK (cdi_variable_pct IS NULL OR (cdi_variable_pct BETWEEN 0 AND 100));

  -- cohérence min ≤ max si les deux sont présents
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND constraint_name = 'profiles_cdi_salary_range_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_cdi_salary_range_check;
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_cdi_salary_range_check
    CHECK (
      cdi_salary_min IS NULL
      OR cdi_salary_max IS NULL
      OR cdi_salary_min <= cdi_salary_max
    );
END $$;

-- -----------------------------------------------------------------------------
-- RLS — vérification (à exécuter pour s'assurer que les policies existent)
-- -----------------------------------------------------------------------------
-- Les policies SELECT/UPDATE sur `profiles` doivent restreindre à
-- `user_id = auth.uid()`. À vérifier MANUELLEMENT dans Supabase Studio
-- (Dashboard → Authentication → Policies → profiles). Si manquantes :
--
--   ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
--
--   CREATE POLICY "profiles_select_own" ON public.profiles
--     FOR SELECT USING (auth.uid() = user_id);
--
--   CREATE POLICY "profiles_update_own" ON public.profiles
--     FOR UPDATE USING (auth.uid() = user_id)
--                 WITH CHECK (auth.uid() = user_id);
--
-- =============================================================================
