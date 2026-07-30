-- ─────────────────────────────────────────────────────────────────────────────
-- SOCLE LÉGAL TECHNIQUE — preuve d'acceptation des CGU + colonnes de conformité
-- (consentement horodaté, activité fiable, purge des comptes inactifs CNIL).
--
-- CONTEXTE
--   Trois lacunes de conformité relevées à l'audit du sprint « socle légal » :
--
--   1. CONSENTEMENT CGU NON PROUVABLE (RGPD / preuve du contrat)
--      La case « J'accepte les CGU » de l'inscription (expert ET organisation)
--      n'était qu'une garde CLIENT : la valeur n'était jamais transmise ni
--      stockée. Une case cochée non tracée n'a aucune valeur juridique. On ajoute
--      donc la PREUVE en base : l'horodatage de l'acceptation + la VERSION des CGU
--      acceptée (la version est une constante du code — lib/legal.ts CGU_VERSION —
--      posée côté serveur, jamais une valeur envoyée par le client).
--
--   2. « DERNIER CONTACT » NON FIABLE (base de la purge CNIL)
--      users.last_login_at existe au schéma mais n'était ÉCRITE nulle part
--      (aucun update, aucun trigger) → toujours NULL. La règle CNIL « recrutement :
--      2 ans max après le dernier contact » ne peut s'appuyer dessus tant que la
--      colonne est morte. Cette migration la RÉVEILLE côté données (backfill) ;
--      le code de login (/api/auth/init-session) la met désormais à jour à chaque
--      connexion — c'est le point de passage unique du login.
--      BACKFILL : last_login_at = COALESCE(last_login_at, created_at). Sans risque
--      de purge intempestive — le projet a démarré en 2026, aucun compte n'atteint
--      2 ans d'inactivité avant 2028.
--
--   3. PURGE DES COMPTES INACTIFS — information préalable
--      L'anonymisation à 2 ans doit être précédée d'un avertissement (~23 mois)
--      invitant à se reconnecter. On trace l'envoi de cet email pour ne pas le
--      relancer à chaque passage du cron. La reconnexion (qui met à jour
--      last_login_at) remet de facto le compteur à zéro ; on efface alors le
--      marqueur d'avertissement pour qu'un futur cycle d'inactivité puisse
--      ré-avertir.
--
-- CE QUE FAIT CETTE MIGRATION (uniquement des AJOUTS de colonnes + un backfill —
--   aucune policy RLS touchée, aucune donnée détruite)
--   • public.users.cgu_accepted_at            timestamptz  (preuve CGU — quand)
--   • public.users.cgu_version                text         (preuve CGU — quelle version)
--   • public.users.inactivity_warning_sent_at timestamptz  (anti-double-envoi de l'avertissement)
--   • BACKFILL last_login_at = COALESCE(last_login_at, created_at)
--
-- IDEMPOTENCE
--   ADD COLUMN IF NOT EXISTS partout ; le backfill ne touche que les lignes dont
--   last_login_at est encore NULL → rejouable sans effet de bord.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Preuve d'acceptation des CGU (horodatage + version acceptée).
ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "cgu_accepted_at" timestamp with time zone;

ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "cgu_version" text;

COMMENT ON COLUMN "public"."users"."cgu_accepted_at" IS
  'Horodatage de l''acceptation des CGU à l''inscription (preuve juridique). Posé côté serveur.';
COMMENT ON COLUMN "public"."users"."cgu_version" IS
  'Version des CGU acceptée (constante du code lib/legal.ts CGU_VERSION). Posée côté serveur, jamais fournie par le client.';

-- 2. Marqueur d'avertissement d'inactivité (email ~23 mois avant purge).
--    Anti-double-envoi ; remis à NULL à la reconnexion (last_login_at rafraîchi).
ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "inactivity_warning_sent_at" timestamp with time zone;

COMMENT ON COLUMN "public"."users"."inactivity_warning_sent_at" IS
  'Date d''envoi de l''email d''avertissement d''inactivité (purge CNIL). NULL = pas encore averti ; remis à NULL à la reconnexion.';

-- 3. Backfill : rend last_login_at exploitable pour la purge inactifs.
--    COALESCE → on ne réécrit jamais une valeur déjà posée (rejouable).
UPDATE "public"."users"
   SET "last_login_at" = COALESCE("last_login_at", "created_at")
 WHERE "last_login_at" IS NULL;
