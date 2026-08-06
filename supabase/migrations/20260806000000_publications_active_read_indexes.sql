-- ─────────────────────────────────────────────────────────────────────────────
-- INDEX DE LECTURE — expiration « active » des publications (Lot A)
--
-- CONTEXTE
--   L'expiration 30 jours est calculée À LA LECTURE (aucun job, aucun statut
--   basculé). En modèle PUR read-time, `expires_at` n'est JAMAIS écrit (toujours
--   NULL) : la règle « publication active » se réduit donc à
--     status = 'published' AND published_at > now() - interval '30 days'
--   (cf. lib/publications/expiry.ts — source unique de la règle).
--
-- CHEMINS CHAUDS filtrant status='published' + (organization_id | domain_id) +
-- published_at :
--   1) plafond d'annonces ACTIVES (POST publish + miroir /me/collaboration/quota)
--      → filtre organization_id + status='published' + fenêtre published_at ;
--   2) pool de matching expert→publications (run-for-expert)
--      → filtre domain_id + status='published' + tri published_at DESC.
--
-- Index PARTIELS sur `status='published'` : petits et sélectifs (les autres
-- statuts sont hors décompte). `expires_at` n'est PAS indexé — toujours NULL
-- dans ce modèle, donc non sélectif ; l'indexer serait inutile.
--
-- Additif et idempotent (IF NOT EXISTS). Aucune donnée touchée.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Plafond d'actives par organisation (résout le 402 sans compter les expirées).
create index if not exists publications_active_org_idx
  on public.publications (organization_id, published_at)
  where status = 'published';

-- 2) Pool de matching par écosystème, trié par fraîcheur.
create index if not exists publications_active_domain_idx
  on public.publications (domain_id, published_at desc)
  where status = 'published';
