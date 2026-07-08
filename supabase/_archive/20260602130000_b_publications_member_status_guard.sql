-- =============================================================================
-- Migration : B — Patch sécurité publications_member_write (status guard)
-- Date : 2026-06-02
-- =============================================================================
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  À COPIER MANUELLEMENT DANS SUPABASE SQL EDITOR                        ║
-- ║                                                                           ║
-- ║  NE PAS APPLIQUER VIA `supabase db push`.                                 ║
-- ║                                                                           ║
-- ║  Étapes :                                                                 ║
-- ║    1. SQL Editor → New query → coller TOUT le contenu ci-dessous          ║
-- ║    2. Run → vérifier "Success. No rows returned"                          ║
-- ║    3. Lancer les vérifs post-migration en fin de fichier                  ║
-- ║    4. Régénérer les types TS (pas de changement structurel attendu, mais  ║
-- ║       reste idempotent et sans coût) :                                    ║
-- ║       npx supabase gen types typescript --linked > lib/database.types.ts  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- CONTEXTE
--   La policy `publications_member_write` posée par la migration cœur
--   (20260602120000_b_core_loop.sql §8) autorise un membre actif à ÉCRIRE
--   les publications de son org sans CONTRAINDRE LE STATUT.
--
--   → Trou : un membre pouvait poser status='published' directement depuis
--     le client (Supabase JS UPDATE par exemple) et publier en CONTOURNANT
--     le contrôle IA obligatoire (gate qualité, vérification, audit).
--     Même classe de trou que candidatures avant le patch de la même
--     migration cœur (FOR ALL trop large → bornage SELECT/INSERT/UPDATE).
--
-- INVARIANT IMPOSÉ AU NIVEAU BASE
--   La transition vers 'published' (visible des experts via
--   `publications_published_expert_read`) doit être IMPOSSIBLE côté client.
--   Idem pour 'pending_review', 'rejected', 'expired' — ces transitions
--   passent EXCLUSIVEMENT par service_role :
--     - 'pending_review' : route API publier déclenche le scoring IA
--     - 'published'      : verdict IA OK ⇒ service_role pose 'published'
--     - 'rejected'       : décision admin via route /api/admin/...
--     - 'expired'        : cron service_role
--
--   Statuts CLIENT-WRITABLE par un membre actif :
--     - 'draft'     : nouvelle publi en cours d'édition
--     - 'suspended' : pause manuelle d'une publi déjà publiée
--     - 'archived'  : retrait d'une publi (terminée, plus pertinente, …)
--
-- TECHNIQUE
--   Réutilise EXACTEMENT la condition d'appartenance org active de la
--   policy existante. On ajoute UNIQUEMENT la contrainte de statut au
--   WITH CHECK (USING reste inchangée : on lit/édite/supprime les lignes
--   de SON org quel que soit le statut courant — l'invariant cible joue
--   sur le statut APRÈS écriture).
--
--   FOR ALL conservé (le périmètre cross-org reste fermé par l'EXISTS).
--   La protection DELETE n'est pas couverte par WITH CHECK (par design
--   Postgres) — DELETE par un membre reste autorisé (idem comportement
--   pré-patch) ; supprimer une publi est équivalent à l'archiver côté UX.
--
-- TRANSACTION : BEGIN/COMMIT pour atomicité.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. REMPLACEMENT publications_member_write — ajout du status guard
-- =============================================================================

DROP POLICY IF EXISTS publications_member_write ON public.publications;

CREATE POLICY publications_member_write
  ON public.publications
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.publications.organization_id
        AND me.user_id = auth.uid()
        AND me.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.publications.organization_id
        AND me.user_id = auth.uid()
        AND me.status = 'active'
    )
    -- Status guard : un membre ne peut écrire QUE vers ces 3 valeurs.
    -- 'published'/'pending_review'/'rejected'/'expired' = service_role
    -- uniquement (route API publier après gate IA ; cron pour expired ;
    -- admin pour rejected).
    AND status IN ('draft', 'suspended', 'archived')
  );


COMMIT;


-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION (manuelles, après COMMIT)
-- =============================================================================
--
-- 1. La policy existe avec USING + WITH CHECK posant le status guard :
--    SELECT policyname, cmd, qual, with_check
--      FROM pg_policies
--     WHERE schemaname='public'
--       AND tablename='publications'
--       AND policyname='publications_member_write';
--    → 1 ligne. `with_check` doit contenir
--      "status = ANY (ARRAY['draft', 'suspended', 'archived'])"
--      (formatage Postgres équivalent au `status IN (...)` SQL).
--
-- 2. Test fonctionnel (depuis le SQL Editor, en session authenticated d'un
--    membre actif d'une org — adapter `<ORG_UUID>` et le user de test) :
--
--    -- INSERT 'draft' : doit passer
--    INSERT INTO public.publications (organization_id, domain_id, type, title, description, status)
--    VALUES ('<ORG_UUID>', '<DOMAIN_UUID>', 'mission', 'Test', 'desc', 'draft');
--
--    -- UPDATE vers 'published' : DOIT échouer avec
--    --   "new row violates row-level security policy"
--    UPDATE public.publications SET status='published' WHERE id='<NEW_ID>';
--
--    -- UPDATE vers 'pending_review' : DOIT échouer (idem)
--    UPDATE public.publications SET status='pending_review' WHERE id='<NEW_ID>';
--
--    -- UPDATE vers 'suspended' : doit passer
--    UPDATE public.publications SET status='suspended' WHERE id='<NEW_ID>';
--
--    -- UPDATE vers 'archived' : doit passer
--    UPDATE public.publications SET status='archived' WHERE id='<NEW_ID>';
--
-- 3. Cleanup test (depuis service_role pour bypasser le guard) :
--    DELETE FROM public.publications WHERE id='<NEW_ID>';
--
-- =============================================================================
