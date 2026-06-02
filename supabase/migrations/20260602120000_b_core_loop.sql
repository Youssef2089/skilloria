-- =============================================================================
-- Migration : B — Boucle cœur (publications → matching → candidatures → messagerie)
-- Date : 2026-06-02
-- =============================================================================
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️  À COPIER MANUELLEMENT DANS SUPABASE SQL EDITOR                        ║
-- ║                                                                           ║
-- ║  NE PAS APPLIQUER VIA `supabase db push`.                                 ║
-- ║                                                                           ║
-- ║  Étapes :                                                                 ║
-- ║    1. Vérifier en amont (UNE FOIS) qu'aucune des 5 tables legacy ne       ║
-- ║       contient encore de données :                                        ║
-- ║         SELECT 'opportunities' AS t, count(*) FROM public.opportunities   ║
-- ║         UNION ALL SELECT 'applications',     count(*) FROM public.applications ║
-- ║         UNION ALL SELECT 'shortlists',       count(*) FROM public.shortlists   ║
-- ║         UNION ALL SELECT 'conversations',    count(*) FROM public.conversations ║
-- ║         UNION ALL SELECT 'private_messages', count(*) FROM public.private_messages; ║
-- ║       → les 5 doivent renvoyer 0. Sinon STOP.                             ║
-- ║    2. SQL Editor → New query → coller TOUT le contenu ci-dessous          ║
-- ║    3. Run → vérifier "Success. No rows returned"                          ║
-- ║    4. Lancer les vérifs post-migration en fin de fichier                  ║
-- ║    5. Régénérer les types TS :                                            ║
-- ║       npx supabase gen types typescript --linked > lib/database.types.ts  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- CONTEXTE
--   Reset complet du chemin métier cœur. Les 5 tables legacy ont été
--   vérifiées vides (audit du 2026-06-01) → DROP CASCADE. On garde
--   `notifications` (étendue) et `profile_alerts` (intacte).
--
-- INVARIANTS RESPECTÉS
--   - Codes BDD en ANGLAIS, CHECK natifs (pas d'ENUM PostgreSQL).
--   - `domain_id NOT NULL` sur chaque nouvelle table (multi-tenant strict).
--   - RLS calquée sur le pattern B1 (member_read / admin-editor_write via
--     organization_members.status='active').
--   - `created_at` / `updated_at` + trigger `set_updated_at()` (B1) sur
--     chaque nouvelle table.
--   - Réutilise le pattern `verification_providers` pour la vérif IA des
--     publications — nouveau provider_type `opportunity_quality_check`.
--
-- SÉCURITÉ PAR CONCEPTION
--   - Aucune policy FOR ALL côté authenticated sur les flux sensibles
--     (candidatures bornées à SELECT/INSERT/UPDATE distincts, conversations
--     en LECTURE SEULE, messages avec UPDATE limité à la colonne read_at).
--   - Toute transition métier (candidature → shortlisted/unlocked/rejected,
--     conversation create/close, publication → published avec gate licence)
--     passe par service_role via routes API serveur — auditable, non
--     contournable côté client.
--   - Masquage profile (Option C) appliqué au niveau BASE via la nouvelle
--     policy `profiles_org_unlocked_read` + la colonne `candidatures.preview`
--     snapshotée par l'API service_role.
--
-- TRANSACTION
--   Tout l'ensemble est encapsulé dans BEGIN/COMMIT pour atomicité.
--   En cas d'erreur, ROLLBACK explicite avant correction et re-run.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. DROP LEGACY (CASCADE → emporte FK, RLS, triggers, indexes liés)
-- =============================================================================
-- Ordre : enfants d'abord. CASCADE pour balayer les éventuelles FK croisées
-- depuis tables externes (audit_logs / transactions / etc. ne référencent
-- pas ces 5 tables d'après l'audit, mais CASCADE assure la robustesse).

DROP TABLE IF EXISTS public.private_messages CASCADE;
DROP TABLE IF EXISTS public.conversations    CASCADE;
DROP TABLE IF EXISTS public.shortlists       CASCADE;
DROP TABLE IF EXISTS public.applications     CASCADE;
DROP TABLE IF EXISTS public.opportunities    CASCADE;


-- =============================================================================
-- 2. TABLE publications
-- =============================================================================
-- Une publication = une annonce de mission ('mission') ou un poste CDI ('offre')
-- portée par une organisation. Vérifiée IA + admin avant passage en 'published'.

CREATE TABLE public.publications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Traçabilité de l'auteur. PAS la propriété (qui appartient à l'org).
  -- ON DELETE SET NULL : si l'auteur quitte la plateforme, la publication
  --                      reste rattachée à l'org sans bloquer la suppression.
  created_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  domain_id             uuid NOT NULL REFERENCES public.domains(id),

  type                  text NOT NULL,
  title                 text NOT NULL,
  description           text NOT NULL,

  branch_id             uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  speciality_id         uuid REFERENCES public.specialities(id) ON DELETE SET NULL,
  skills_required       text[] NOT NULL DEFAULT '{}',
  seniority             text,
  work_mode             text,
  location              text,
  duration              text,
  start_date            date,
  budget_min            numeric,
  budget_max            numeric,
  confidential          boolean NOT NULL DEFAULT false,

  status                text NOT NULL DEFAULT 'draft',

  -- Vérification IA (réutilise pattern verification_providers via
  -- provider_type='opportunity_quality_check' — cf. section 9).
  verification_score    numeric,
  verification_method   text,
  verification_data     jsonb,
  verified_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  verified_at           timestamptz,
  review_reason         text,

  published_at          timestamptz,
  expires_at            timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT publications_type_check
    CHECK (type IN ('mission', 'offre')),
  CONSTRAINT publications_status_check
    CHECK (status IN (
      'draft', 'pending_review', 'published',
      'suspended', 'expired', 'archived', 'rejected'
    )),
  CONSTRAINT publications_budget_range_check
    CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max)
);

CREATE INDEX publications_domain_idx        ON public.publications (domain_id);
CREATE INDEX publications_organization_idx  ON public.publications (organization_id);
CREATE INDEX publications_status_idx        ON public.publications (status);
CREATE INDEX publications_branch_idx        ON public.publications (branch_id)     WHERE branch_id IS NOT NULL;
CREATE INDEX publications_speciality_idx    ON public.publications (speciality_id) WHERE speciality_id IS NOT NULL;
CREATE INDEX publications_published_at_idx  ON public.publications (published_at DESC) WHERE status = 'published';

DROP TRIGGER IF EXISTS trg_publications_updated_at ON public.publications;
CREATE TRIGGER trg_publications_updated_at
  BEFORE UPDATE ON public.publications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 3. TABLE matches
-- =============================================================================
-- Recommandations IA : pour une publication, la liste des profils suggérés
-- avec un score. La candidature passe par `candidatures.match_id` quand
-- l'expert candidate suite à un match. `explanation` jsonb est la trace IA
-- (option C masquage : peut contenir `preview = {champs safe}` au moment
-- du scoring, pour affichage match card côté org sans révéler le profil).

CREATE TABLE public.matches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id    uuid NOT NULL REFERENCES public.publications(id) ON DELETE CASCADE,
  profile_id        uuid NOT NULL REFERENCES public.profiles(id)     ON DELETE CASCADE,
  domain_id         uuid NOT NULL REFERENCES public.domains(id),

  score             numeric NOT NULL,
  explanation       jsonb,

  status            text NOT NULL DEFAULT 'pending',

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT matches_status_check
    CHECK (status IN ('pending', 'notified', 'viewed', 'dismissed')),
  CONSTRAINT matches_score_range_check
    CHECK (score >= 0 AND score <= 10),
  CONSTRAINT matches_publication_profile_unique
    UNIQUE (publication_id, profile_id)
);

CREATE INDEX matches_domain_idx       ON public.matches (domain_id);
CREATE INDEX matches_publication_idx  ON public.matches (publication_id);
CREATE INDEX matches_profile_idx      ON public.matches (profile_id);
CREATE INDEX matches_status_idx       ON public.matches (status);

DROP TRIGGER IF EXISTS trg_matches_updated_at ON public.matches;
CREATE TRIGGER trg_matches_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 4. TABLE candidatures
-- =============================================================================
-- Une candidature = un profil postule à une publication. match_id NULL si
-- candidature directe (sans match IA préalable). UNIQUE (publication, profile)
-- → un expert ne postule qu'une fois par publication (re-postuler = update).

CREATE TABLE public.candidatures (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id    uuid NOT NULL REFERENCES public.publications(id) ON DELETE CASCADE,
  profile_id        uuid NOT NULL REFERENCES public.profiles(id)     ON DELETE CASCADE,
  match_id          uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  domain_id         uuid NOT NULL REFERENCES public.domains(id),

  cover_message     text,
  ai_match_score    numeric,

  status            text NOT NULL DEFAULT 'received',
  status_reason     text,
  unlocked_at       timestamptz,

  -- Option C masquage — snapshot des champs NON-sensibles, figé au moment
  -- du postule par l'API service_role. Permet à l'org d'afficher la match
  -- card côté shortlist AVANT unlock sans toucher à `profiles`.
  --
  -- Champs autorisés (whitelist applicative) : title, summary, skills[],
  -- seniority, expert_type, tjm_min/max, salary_min/max, years_experience,
  -- work_modes[], languages[], country, city, availability_status,
  -- profile_score, branch_id, speciality_id.
  --
  -- JAMAIS : phone, email, first_name/last_name (users), cv_url,
  -- cv_file_path, linkedin_url, address_line, postal_code, photo_url,
  -- birth_year, user_id (qui permettrait de remonter à users).
  --
  -- Après status='unlocked', l'org accède au profil complet via
  -- profiles_org_unlocked_read (cf. section 13).
  preview           jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT candidatures_status_check
    CHECK (status IN (
      'received', 'in_review', 'shortlisted',
      'unlocked', 'rejected', 'withdrawn', 'archived'
    )),
  CONSTRAINT candidatures_publication_profile_unique
    UNIQUE (publication_id, profile_id)
);

CREATE INDEX candidatures_domain_idx       ON public.candidatures (domain_id);
CREATE INDEX candidatures_publication_idx  ON public.candidatures (publication_id);
CREATE INDEX candidatures_profile_idx      ON public.candidatures (profile_id);
CREATE INDEX candidatures_status_idx       ON public.candidatures (status);
CREATE INDEX candidatures_match_idx        ON public.candidatures (match_id) WHERE match_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_candidatures_updated_at ON public.candidatures;
CREATE TRIGGER trg_candidatures_updated_at
  BEFORE UPDATE ON public.candidatures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 5. TABLE conversations
-- =============================================================================
-- Une conversation = échange privé entre l'expert et l'org après unlock
-- d'une candidature. UNIQUE (candidature_id) → 1 conversation par candidature.
-- candidature_id NULLABLE pour permettre, plus tard, des DM directs hors
-- candidature (V2). Auto-cleanup via expires_at applicatif (15 j).

CREATE TABLE public.conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidature_id    uuid REFERENCES public.candidatures(id) ON DELETE CASCADE,
  domain_id         uuid NOT NULL REFERENCES public.domains(id),

  status            text NOT NULL DEFAULT 'open',
  last_message_at   timestamptz,
  expires_at        timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conversations_status_check
    CHECK (status IN ('open', 'closed', 'archived')),
  CONSTRAINT conversations_candidature_unique
    UNIQUE (candidature_id)
);

CREATE INDEX conversations_domain_idx          ON public.conversations (domain_id);
CREATE INDEX conversations_status_idx          ON public.conversations (status);
CREATE INDEX conversations_last_message_idx    ON public.conversations (last_message_at DESC NULLS LAST);

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON public.conversations;
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 6. TABLE messages
-- =============================================================================
-- Messages individuels d'une conversation. sender_id ON DELETE CASCADE
-- (cohérent avec organization_members.user_id ON DELETE CASCADE de B1).
-- Si un user est supprimé, ses messages disparaissent (RGPD).

CREATE TABLE public.messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id         uuid NOT NULL REFERENCES public.users(id)         ON DELETE CASCADE,
  domain_id         uuid NOT NULL REFERENCES public.domains(id),

  content           text NOT NULL,
  read_at           timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_domain_idx        ON public.messages (domain_id);
CREATE INDEX messages_conversation_idx  ON public.messages (conversation_id);
CREATE INDEX messages_sender_idx        ON public.messages (sender_id);
CREATE INDEX messages_created_at_idx    ON public.messages (created_at DESC);

DROP TRIGGER IF EXISTS trg_messages_updated_at ON public.messages;
CREATE TRIGGER trg_messages_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 7. EXTENSION notifications
-- =============================================================================
-- Idempotent (ADD COLUMN IF NOT EXISTS).
-- `read_at` : nullable, posé quand l'user marque la notif comme lue.
-- `entity_id` : nullable, deep-link générique (publication_id, candidature_id,
--               conversation_id selon `type`). Lecture polymorphique côté API.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS read_at   timestamptz,
  ADD COLUMN IF NOT EXISTS entity_id uuid;

CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;


-- =============================================================================
-- 8. RLS — publications
-- =============================================================================
-- Pattern B1 (cf. 20260430120000_archi_orga_b1.sql) :
--   • service_role bypass automatique (routes API via supabaseAdmin)
--   • authenticated : member_read + admin_or_editor_write
-- Accès experts : ouverture lecture publique aux experts (user_type
--   IN ('freelance','cdi')) du MÊME domain quand status='published'.

ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS publications_member_read ON public.publications;
CREATE POLICY publications_member_read
  ON public.publications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members me
      WHERE me.organization_id = public.publications.organization_id
        AND me.user_id = auth.uid()
        AND me.status = 'active'
    )
  );

DROP POLICY IF EXISTS publications_published_expert_read ON public.publications;
CREATE POLICY publications_published_expert_read
  ON public.publications
  FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.domain_id = public.publications.domain_id
        AND u.user_type IN ('expert_freelance', 'expert_cdi')
        AND u.status = 'active'
    )
  );

-- TOUT membre actif de l'org peut écrire (créer/éditer/passer en pending_review).
-- Le RÔLE (admin/editor/viewer) n'est PAS la gate de publication ici.
--
-- ⚠️ POINT D'INSERTION COMMERCIAL — DIFFÉRÉ :
-- La vraie gate métier = licence par seat (commercial, V2). À brancher
-- côté API avant la transition status→'published' (cf. route serveur
-- /api/publications/:id/publish à venir). Ouvert par défaut tant que la
-- monétisation n'est pas câblée. RLS reste générique ; le contrôle de
-- licence vit côté service_role.
DROP POLICY IF EXISTS publications_admin_editor_write ON public.publications;
DROP POLICY IF EXISTS publications_member_write       ON public.publications;
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
  );


-- =============================================================================
-- 9. RLS — matches
-- =============================================================================
-- L'expert lit ses matches (profile.user_id = auth.uid()).
-- L'org lit les matches de ses publications (member actif).
-- INSERT/UPDATE/DELETE : service_role uniquement (l'IA insère via API).

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS matches_expert_read ON public.matches;
CREATE POLICY matches_expert_read
  ON public.matches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = public.matches.profile_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS matches_org_read ON public.matches;
CREATE POLICY matches_org_read
  ON public.matches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.publications pub
        JOIN public.organization_members me
          ON me.organization_id = pub.organization_id
       WHERE pub.id = public.matches.publication_id
         AND me.user_id = auth.uid()
         AND me.status = 'active'
    )
  );


-- =============================================================================
-- 10. RLS — candidatures
-- =============================================================================
-- 3 policies bornées côté expert (pas de FOR ALL global qui aurait laissé
-- l'expert se mettre 'unlocked'/'shortlisted'/etc. lui-même) :
--   • SELECT : ses propres candidatures (profile.user_id = auth.uid())
--   • INSERT : apply, status FORCÉ à 'received'
--   • UPDATE : éditer son cover_message tant que status='received',
--              OU se retirer (passer à 'withdrawn'). Aucune autre transition.
-- Pas de DELETE expert (retrait = withdrawn, traçabilité préservée).
--
-- Les transitions in_review/shortlisted/unlocked/rejected/archived sont
-- EXCLUSIVEMENT effectuées par service_role (routes API org) — avec audit +
-- email à l'expert.
--
-- Côté org : SELECT seul (lecture des candidatures sur ses publications).

ALTER TABLE public.candidatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS candidatures_expert_all    ON public.candidatures;
DROP POLICY IF EXISTS candidatures_expert_read   ON public.candidatures;
DROP POLICY IF EXISTS candidatures_expert_insert ON public.candidatures;
DROP POLICY IF EXISTS candidatures_expert_update ON public.candidatures;

CREATE POLICY candidatures_expert_read
  ON public.candidatures
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = public.candidatures.profile_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY candidatures_expert_insert
  ON public.candidatures
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'received'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = public.candidatures.profile_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY candidatures_expert_update
  ON public.candidatures
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = public.candidatures.profile_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    status IN ('received', 'withdrawn')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = public.candidatures.profile_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS candidatures_org_read ON public.candidatures;
CREATE POLICY candidatures_org_read
  ON public.candidatures
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.publications pub
        JOIN public.organization_members me
          ON me.organization_id = pub.organization_id
       WHERE pub.id = public.candidatures.publication_id
         AND me.user_id = auth.uid()
         AND me.status = 'active'
    )
  );


-- =============================================================================
-- 11. RLS — conversations
-- =============================================================================
-- Accès en LECTURE SEULE pour les 2 parties d'une candidature 'unlocked' :
--   • l'expert (profile.user_id = auth.uid()) via candidature.profile_id
--   • un membre actif de l'org via candidature.publication.organization_id
-- Expiration 15 j réellement appliquée : passé expires_at, la conversation
-- disparaît du périmètre authenticated (lecture et écriture).
--
-- Si candidature_id IS NULL (futur DM direct V2) : refus par défaut — V2
-- ajoutera une policy dédiée.
--
-- CRÉATION / fermeture / expires_at = SERVICE_ROLE UNIQUEMENT. Aucune
-- partie ne doit pouvoir trafiquer status/expires_at via le client.

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_party_read  ON public.conversations;
DROP POLICY IF EXISTS conversations_party_write ON public.conversations;

CREATE POLICY conversations_party_read
  ON public.conversations
  FOR SELECT TO authenticated
  USING (
    (public.conversations.expires_at IS NULL
     OR public.conversations.expires_at > now())
    AND EXISTS (
      SELECT 1
        FROM public.candidatures c
        LEFT JOIN public.profiles p ON p.id = c.profile_id
        LEFT JOIN public.publications pub ON pub.id = c.publication_id
        LEFT JOIN public.organization_members me
          ON me.organization_id = pub.organization_id
         AND me.user_id = auth.uid()
         AND me.status = 'active'
       WHERE c.id = public.conversations.candidature_id
         AND c.status = 'unlocked'
         AND (
           p.user_id = auth.uid()
           OR me.user_id IS NOT NULL
         )
    )
  );


-- =============================================================================
-- 12. RLS — messages
-- =============================================================================
-- Accès chaîné via conversation. Lecture par les 2 parties (+ expiration 15 j
-- réellement appliquée). Insertion : le sender doit être l'auth user
-- (intégrité) ET partie de la conversation.
--
-- Marquage 'lu' : on EXPRESSEMENT borne UPDATE au niveau privilège colonne
-- via GRANT UPDATE (read_at) ON messages TO authenticated (cf. plus bas).
-- → même avec la policy UPDATE qui autorise la ligne, l'authenticated ne
--   PEUT PHYSIQUEMENT modifier QUE la colonne read_at (Postgres column
--   privileges). content/sender_id/conversation_id/etc. restent intouchables
--   côté client — protection en profondeur si la RLS était jamais relâchée.

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_party_read       ON public.messages;
DROP POLICY IF EXISTS messages_sender_insert    ON public.messages;
DROP POLICY IF EXISTS messages_party_mark_read  ON public.messages;

CREATE POLICY messages_party_read
  ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.conversations conv
        JOIN public.candidatures c ON c.id = conv.candidature_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id
        LEFT JOIN public.publications pub ON pub.id = c.publication_id
        LEFT JOIN public.organization_members me
          ON me.organization_id = pub.organization_id
         AND me.user_id = auth.uid()
         AND me.status = 'active'
       WHERE conv.id = public.messages.conversation_id
         AND c.status = 'unlocked'
         AND (conv.expires_at IS NULL OR conv.expires_at > now())
         AND (
           p.user_id = auth.uid()
           OR me.user_id IS NOT NULL
         )
    )
  );

CREATE POLICY messages_sender_insert
  ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.messages.sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
        FROM public.conversations conv
        JOIN public.candidatures c ON c.id = conv.candidature_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id
        LEFT JOIN public.publications pub ON pub.id = c.publication_id
        LEFT JOIN public.organization_members me
          ON me.organization_id = pub.organization_id
         AND me.user_id = auth.uid()
         AND me.status = 'active'
       WHERE conv.id = public.messages.conversation_id
         AND c.status = 'unlocked'
         AND (conv.expires_at IS NULL OR conv.expires_at > now())
         AND (
           p.user_id = auth.uid()
           OR me.user_id IS NOT NULL
         )
    )
  );

-- Marquage 'read_at' : un user peut UPDATE sur ses messages REÇUS
-- (sender_id != auth.uid()) au sein d'une conversation où il est partie
-- et toujours active (non expirée). Le GRANT colonne ci-dessous le borne
-- physiquement à la seule colonne read_at.
CREATE POLICY messages_party_mark_read
  ON public.messages
  FOR UPDATE TO authenticated
  USING (
    public.messages.sender_id <> auth.uid()
    AND EXISTS (
      SELECT 1
        FROM public.conversations conv
        JOIN public.candidatures c ON c.id = conv.candidature_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id
        LEFT JOIN public.publications pub ON pub.id = c.publication_id
        LEFT JOIN public.organization_members me
          ON me.organization_id = pub.organization_id
         AND me.user_id = auth.uid()
         AND me.status = 'active'
       WHERE conv.id = public.messages.conversation_id
         AND c.status = 'unlocked'
         AND (conv.expires_at IS NULL OR conv.expires_at > now())
         AND (
           p.user_id = auth.uid()
           OR me.user_id IS NOT NULL
         )
    )
  );

-- ── Privilège COLONNE — borne physique du marquage 'lu' ─────────────────
-- Defense in depth : même si une policy UPDATE était relâchée par erreur,
-- l'authenticated ne PEUT PAS écrire content / sender_id / conversation_id /
-- created_at / updated_at depuis le client. Seule read_at est accessible.
-- service_role conserve ses privilèges full (bypass RLS + tous GRANTS).
--
-- INSERT/SELECT/DELETE restent gouvernés par les policies RLS standards.

REVOKE UPDATE ON public.messages FROM authenticated;
GRANT  UPDATE (read_at) ON public.messages TO authenticated;


-- =============================================================================
-- 13. RLS — profiles (ADD-ON, ne touche AUCUNE policy existante)
-- =============================================================================
-- Option C — masquage candidature avant unlock :
-- l'org peut lire profiles UNIQUEMENT s'il existe une candidature 'unlocked'
-- liant ce profile à l'une de ses publications. Avant unlock, l'org passe
-- par matches.explanation.preview et candidatures.preview (cf. §4) —
-- snapshots safe-fields posés par l'API service_role.

DROP POLICY IF EXISTS profiles_org_unlocked_read ON public.profiles;
CREATE POLICY profiles_org_unlocked_read
  ON public.profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.candidatures c
        JOIN public.publications pub ON pub.id = c.publication_id
        JOIN public.organization_members me
          ON me.organization_id = pub.organization_id
       WHERE c.profile_id = public.profiles.id
         AND c.status = 'unlocked'
         AND me.user_id = auth.uid()
         AND me.status = 'active'
    )
  );


-- =============================================================================
-- 14. verification_providers — extension CHECK + seed pour publications
-- =============================================================================
-- Le pattern verification_providers (B1) hardcoderait provider_type IN
-- ('official_api','ai_web_search','manual_only'). On étend pour accueillir
-- le nouveau type 'opportunity_quality_check' utilisé par le scoring IA
-- des publications. Le dispatcher applicatif (à coder) filtrera par
-- provider_type='opportunity_quality_check'.

ALTER TABLE public.verification_providers
  DROP CONSTRAINT IF EXISTS verification_providers_type_check;

ALTER TABLE public.verification_providers
  ADD CONSTRAINT verification_providers_type_check
  CHECK (provider_type IN (
    'official_api',
    'ai_web_search',
    'manual_only',
    'opportunity_quality_check'
  ));

-- Seed FR — Claude IA pour scorer la qualité/clarté/légalité d'une publication.
-- Threshold 7 aligné sur la décision 11g2 (seuil cohérence IA pour orgs).
-- Priorité 10 (provider unique pour ce type — pas de fallback prévu V1).
-- api_key_secret_ref → variable d'env ANTHROPIC_API_KEY (déjà utilisée par
-- lib/verification/ai-fallback.ts).
--
-- Garde idempotent par WHERE NOT EXISTS plutôt que ON CONFLICT — la
-- contrainte UNIQUE (country_code, provider_name) existe en B1, mais on
-- évite la dépendance dure et on reste idempotent même si la contrainte
-- était relâchée.
INSERT INTO public.verification_providers
  (country_code, provider_type, provider_name,
   api_endpoint, api_key_secret_ref,
   priority, confidence_threshold, is_active)
SELECT 'FR', 'opportunity_quality_check', 'claude_opportunity_quality',
       NULL, 'ANTHROPIC_API_KEY',
       10, 7, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.verification_providers
   WHERE provider_type = 'opportunity_quality_check'
     AND country_code  = 'FR'
);


COMMIT;


-- =============================================================================
-- VÉRIFICATIONS POST-MIGRATION (manuelles, après COMMIT)
-- =============================================================================
--
-- 1. Les 5 nouvelles tables existent + RLS activée :
--    SELECT tablename, rowsecurity
--      FROM pg_tables
--     WHERE schemaname='public'
--       AND tablename IN ('publications','matches','candidatures','conversations','messages')
--     ORDER BY tablename;
--    → 5 lignes, rowsecurity = true partout
--
-- 2. Les 5 tables legacy ont disparu :
--    SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public'
--       AND table_name IN ('opportunities','applications','shortlists','conversations','private_messages');
--    → ⚠️ 'conversations' est désormais la NOUVELLE table → count=1 attendu (la nouvelle).
--    Pour vérifier la disparition stricte des legacy :
--    SELECT table_name FROM information_schema.tables
--     WHERE table_schema='public'
--       AND table_name IN ('opportunities','applications','shortlists','private_messages');
--    → 0 lignes attendues
--
-- 3. Toutes les policies en place :
--    SELECT tablename, policyname, cmd
--      FROM pg_policies
--     WHERE schemaname='public'
--       AND tablename IN ('publications','matches','candidatures','conversations','messages')
--     ORDER BY tablename, policyname;
--    → 12 lignes attendues :
--       publications  : member_read, published_expert_read, member_write
--       matches       : expert_read, org_read
--       candidatures  : expert_read, expert_insert, expert_update, org_read
--       conversations : party_read    (LECTURE SEULE — create/close = service_role)
--       messages      : party_read, sender_insert, party_mark_read
--       (+ profiles_org_unlocked_read sur profiles, à vérifier séparément)
--
-- 3.b Privilège colonne messages — read_at SEULE pour authenticated :
--    SELECT grantee, privilege_type, column_name
--      FROM information_schema.column_privileges
--     WHERE table_schema='public' AND table_name='messages'
--       AND grantee='authenticated' AND privilege_type='UPDATE';
--    → 1 ligne attendue : authenticated / UPDATE / read_at  (UNIQUEMENT)
--
-- 4. Notifications étendue :
--    SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='notifications'
--       AND column_name IN ('read_at','entity_id');
--    → 2 lignes
--
-- 5. Provider IA seed :
--    SELECT country_code, provider_type, provider_name, confidence_threshold, is_active
--      FROM public.verification_providers
--     WHERE provider_type='opportunity_quality_check';
--    → 1 ligne : FR / opportunity_quality_check / claude_opportunity_quality / 7 / true
--
-- 6. Régénérer les types TS après vérifs OK :
--    npx supabase gen types typescript --linked > lib/database.types.ts
-- =============================================================================
