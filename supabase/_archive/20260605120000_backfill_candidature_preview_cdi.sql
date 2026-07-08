-- ============================================================================
-- Backfill candidatures.preview avec les 6 signaux CDI non-PII
-- ============================================================================
-- Contexte : Lot synthèse candidat CDI (SC3). buildPreview() côté serveur
-- a été étendu pour inclure cdi_status, cdi_notice_period, cdi_geo_mobility,
-- cdi_contract_types, cdi_company_size, cdi_sectors dans le snapshot preview
-- au POST /api/candidatures.
--
-- Les candidatures CRÉÉES AVANT ce lot n'ont pas ces champs dans preview.
-- Ce backfill les ajoute en lisant les valeurs CURRENT du profil expert.
--
-- Garde-fous :
--   * Whitelist stricte : SEULEMENT les 6 champs CDI non-PII. AUCUNE PII
--     (phone/email/first_name/last_name/cv_url/etc.) n'est touchée.
--   * Idempotent : on n'écrase pas les clés déjà présentes (jsonb_strip_nulls
--     + jsonb concat où la nouvelle valeur prend la priorité uniquement si
--     la clé est absente). Re-run = no-op.
--   * Scope : UNIQUEMENT les candidatures dont la publication est de type
--     'offre' (les autres n'ont pas besoin des signaux CDI). On ne touche
--     pas les candidatures sur missions.
--   * RLS bypass via DDL/DML migration (service_role implicite).
-- ============================================================================

DO $$
DECLARE
  updated_count integer := 0;
BEGIN
  -- Mise à jour atomique : on enrichit preview avec les 6 champs CDI
  -- lus depuis profiles. jsonb || prend la priorité du membre de droite
  -- en cas de conflit de clé — on inverse l'ordre pour ne PAS écraser ce
  -- qui existe déjà : on construit (nouveaux signaux) || (preview existante).
  WITH affected AS (
    UPDATE public.candidatures c
    SET preview = (
      jsonb_build_object(
        'cdi_status', to_jsonb(p.cdi_status),
        'cdi_notice_period', to_jsonb(p.cdi_notice_period),
        'cdi_geo_mobility', to_jsonb(p.cdi_geo_mobility),
        'cdi_contract_types', to_jsonb(COALESCE(p.cdi_contract_types, ARRAY[]::text[])),
        'cdi_company_size', to_jsonb(COALESCE(p.cdi_company_size, ARRAY[]::text[])),
        'cdi_sectors', to_jsonb(COALESCE(p.cdi_sectors, ARRAY[]::text[]))
      ) || COALESCE(c.preview, '{}'::jsonb)
    )
    FROM public.profiles p,
         public.publications pub
    WHERE c.profile_id = p.id
      AND c.publication_id = pub.id
      AND pub.type = 'offre'
      -- Idempotence : on ne re-traite pas les candidatures qui ont DÉJÀ
      -- la clé cdi_status (signe qu'un POST récent a écrit le format complet).
      AND NOT (c.preview ? 'cdi_status')
    RETURNING c.id
  )
  SELECT count(*) INTO updated_count FROM affected;

  RAISE NOTICE '[backfill candidature preview CDI] % candidatures enrichies', updated_count;
END $$;

-- ============================================================================
-- DIAGNOSTIC POST-BACKFILL (optionnel — décommenter pour vérifier)
-- ============================================================================
--   SELECT count(*) AS total_offre_candidatures
--     FROM public.candidatures c
--     JOIN public.publications p ON p.id = c.publication_id
--    WHERE p.type = 'offre';
--
--   SELECT count(*) AS with_cdi_status_in_preview
--     FROM public.candidatures c
--     JOIN public.publications p ON p.id = c.publication_id
--    WHERE p.type = 'offre'
--      AND c.preview ? 'cdi_status';
-- ============================================================================
