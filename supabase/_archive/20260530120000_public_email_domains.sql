-- =============================================================================
-- À EXÉCUTER MANUELLEMENT DANS SUPABASE SQL EDITOR
-- =============================================================================
-- Objet : créer la table public.public_email_domains (liste back-office des
-- domaines e-mail GRAND PUBLIC / partagés autorisés à l'inscription org).
--
-- Pourquoi : register-org applique une unicité stricte sur
-- organizations.email_domain (index unique partiel + pré-check applicatif).
-- Cette unicité est correcte pour un domaine PRO (acme.fr → une seule
-- entreprise Acme) mais bloque les domaines publics partagés (gmail.com,
-- outlook.com, …) : un seul gmailer peut s'inscrire sur toute la plateforme.
--
-- Décision produit : les domaines publics sont AUTORISÉS pour l'inscription
-- org (déjà consigné dans lib/verification/ai-fallback.ts). On les liste
-- dans cette table (gérable back-office), et register-org enregistrera
-- email_domain = NULL pour ces orgs. L'index unique partiel
-- (WHERE email_domain IS NOT NULL) ignore les NULL → cohabitation possible.
--
-- Aucun changement d'index, aucun changement du flux OTP, aucun impact B4
-- (NULL ne match jamais NULL, donc invitation par domaine reste sûre).
--
-- Structure CALQUÉE sur public.blocked_email_domains (B1).
-- =============================================================================


-- =============================================================================
-- 1. TABLE public.public_email_domains
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.public_email_domains (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_domain  varchar NOT NULL,
  reason        text,
  added_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS public_email_domains_domain_unique_idx
  ON public.public_email_domains (lower(email_domain));

CREATE INDEX IF NOT EXISTS public_email_domains_active_idx
  ON public.public_email_domains (active)
  WHERE active = true;

DROP TRIGGER IF EXISTS trg_public_email_domains_updated_at ON public.public_email_domains;
CREATE TRIGGER trg_public_email_domains_updated_at
  BEFORE UPDATE ON public.public_email_domains
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 2. RLS — accès service_role uniquement (calqué sur blocked_email_domains)
-- =============================================================================

ALTER TABLE public.public_email_domains ENABLE ROW LEVEL SECURITY;

-- Pas de policy authenticated : table accédée uniquement via service_role
-- (route /api/auth/register-org).


-- =============================================================================
-- 3. SEED idempotent — 20 domaines publics FR/international
-- =============================================================================

INSERT INTO public.public_email_domains (email_domain, reason) VALUES
  ('gmail.com',      'Google Mail'),
  ('outlook.com',    'Outlook'),
  ('outlook.fr',     'Outlook FR'),
  ('hotmail.com',    'Hotmail'),
  ('hotmail.fr',     'Hotmail FR'),
  ('live.fr',        'Live FR'),
  ('yahoo.com',      'Yahoo'),
  ('yahoo.fr',       'Yahoo FR'),
  ('icloud.com',     'iCloud'),
  ('me.com',         'Apple Me'),
  ('free.fr',        'Free'),
  ('orange.fr',      'Orange'),
  ('wanadoo.fr',     'Wanadoo (Orange)'),
  ('sfr.fr',         'SFR'),
  ('laposte.net',    'La Poste'),
  ('bbox.fr',        'Bouygues Telecom'),
  ('gmx.com',        'GMX'),
  ('aol.com',        'AOL'),
  ('proton.me',      'Proton'),
  ('protonmail.com', 'ProtonMail')
ON CONFLICT (lower(email_domain)) DO NOTHING;


-- =============================================================================
-- 4. NORMALISATION DES ORGS EXISTANTES (active)
-- =============================================================================
-- Aligne les enregistrements historiques : toute org dont l'email_domain
-- correspond à un domaine public listé ci-dessus passe à NULL. Idempotent.
--
-- Effet : si un compte de test "gmail.com" existe déjà, il cesse de "réserver"
-- gmail.com pour toute la plateforme. Les futurs gmailers s'inscrivent
-- côte-à-côte sans collision.

UPDATE public.organizations
   SET email_domain = NULL
 WHERE email_domain IS NOT NULL
   AND lower(email_domain) IN (
     SELECT lower(email_domain) FROM public.public_email_domains WHERE active = true
   );


-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION (à exécuter manuellement après run)
-- =============================================================================
--
-- 1. La table existe et le seed a bien 20 lignes :
--    SELECT count(*) FROM public.public_email_domains WHERE active = true;
--
-- 2. Aucune org ne pointe plus sur un domaine public :
--    SELECT id, company_name, email_domain
--      FROM public.organizations
--     WHERE lower(email_domain) IN (
--       SELECT lower(email_domain) FROM public.public_email_domains WHERE active = true
--     );
--    -> doit renvoyer 0 lignes.
--
-- 3. L'index unique partiel sur organizations.email_domain est intact :
--    SELECT indexname, indexdef
--      FROM pg_indexes
--     WHERE schemaname='public' AND tablename='organizations'
--       AND indexname='organizations_email_domain_unique_idx';
-- =============================================================================
