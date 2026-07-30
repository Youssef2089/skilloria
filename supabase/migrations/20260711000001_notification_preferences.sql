-- ─────────────────────────────────────────────────────────────────────────────
-- NOTIFICATIONS EMAIL & SMS SUR NOUVELLE OPPORTUNITÉ — préférences + suivi d'envoi
--
-- CONTEXTE
--   Nouvelle fonctionnalité : quand une nouvelle opportunité correspond au profil
--   d'un expert (notification in-app type 'new_match_opportunity' déjà créée par
--   lib/matching), on lui envoie AUSSI un email et/ou un SMS, selon ses
--   préférences, en regroupant les matches d'une fenêtre de 15 minutes en un seul
--   envoi agrégé. Aucun autre flux (message, validation, invitation…) ne déclenche
--   d'envoi externe.
--
-- CE QUE FAIT CETTE MIGRATION (uniquement des AJOUTS — rien de destructif)
--
--   1. PRÉFÉRENCES (public.users) — deux interrupteurs, ACTIFS par défaut côté
--      base (DEFAULT true NOT NULL) → tous les comptes EXISTANTS sont couverts
--      immédiatement, SANS backfill (Postgres remplit le défaut à l'ADD COLUMN).
--        • notify_match_email  : recevoir un email sur nouvelle opportunité
--        • notify_match_sms    : recevoir un SMS  sur nouvelle opportunité
--      Portée : colonnes sur users (tous types), mais seuls les experts matchés
--      les consultent. Lues et appliquées CÔTÉ SERVEUR (le cron), jamais décidées
--      par le client.
--
--      NOTE D'ARCHITECTURE (validée) : deux colonnes booléennes conviennent pour
--      un périmètre FIGÉ à 2 préférences, et DEFAULT true couvre l'existant sans
--      backfill. Si le périmètre dépassait 4-5 préférences, il faudrait basculer
--      sur une TABLE DÉDIÉE (ex. notification_preferences(user_id, key, enabled))
--      plutôt que de multiplier les colonnes sur users.
--
--   2. SUIVI D'ENVOI EXTERNE — PAR CANAL (public.notifications)
--      On NE réutilise PAS `status` (couplé à l'état lu/non-lu de la cloche :
--      pending→read) ni `sent_at`. On ajoute un suivi DÉDIÉ, distinct PAR CANAL :
--
--        • match_email_dispatch_at  timestamptz  (NULL = email pas encore traité)
--        • match_email_attempts     int  NOT NULL DEFAULT 0
--        • match_sms_dispatch_at    timestamptz  (NULL = SMS pas encore traité)
--        • match_sms_attempts       int  NOT NULL DEFAULT 0
--
--      POURQUOI PAR CANAL (et pas un marqueur unique) : email (Resend) et SMS
--      (Vonage) sont deux prestataires indépendants. Avec UN seul marqueur, un
--      échec SMS forcerait un « remets à NULL → réessaie » qui RÉ-ENVERRAIT
--      l'email déjà parti (doublon), et une panne d'un prestataire provoquerait
--      une tempête d'envois sur l'autre canal. Le suivi par canal permet à chaque
--      canal de RÉCLAMER, ÉCHOUER et RÉESSAYER indépendamment, sans jamais
--      doubler le canal qui a réussi.
--
--      Le cron (/api/cron/dispatch-match-notifications), toutes les 5 min :
--        - par canal, balaye les 'new_match_opportunity' dont le dispatch de CE
--          canal est NULL, regroupe par utilisateur, et n'envoie que lorsque la
--          plus ancienne du lot a dépassé la fenêtre de 15 min (déclenchée par le
--          PREMIER match, décision D3) ;
--        - RÉCLAME atomiquement (UPDATE … WHERE <canal>_dispatch_at IS NULL …
--          RETURNING) AVANT d'envoyer → un rejeu / cron concurrent ne double pas
--          (D4 + point 4) ;
--        - en cas d'ÉCHEC d'envoi : remet <canal>_dispatch_at à NULL et incrémente
--          <canal>_attempts → réessai au prochain passage. Au-delà de 3 tentatives,
--          la ligne reste marquée (dispatch_at posé) et l'échec est journalisé
--          (transforme une perte définitive en un retard de quelques minutes, sans
--          jamais boucler — ajout A1).
--
--      La liste des envois dérive donc EXCLUSIVEMENT des notifications RÉELLEMENT
--      CRÉÉES (le suivi vit sur `notifications`). Si le dédoublonnage de
--      notifyAndFlip a écarté une insertion, aucune ligne n'existe → rien ne sort
--      (décision D4).
--
--      BACKFILL ANTI-SPAM RÉTROACTIF : les notifications de match DÉJÀ en base
--      (créées avant cette fonctionnalité) sont marquées comme déjà dispatchées
--      sur LES DEUX canaux (dispatch_at = created_at) → le premier passage du cron
--      ne renvoie pas tout l'historique. Seuls les NOUVEAUX matches
--      (post-déploiement, colonnes NULL par défaut) seront envoyés.
--
--   3. INDEX PARTIELS (un par canal) pour le balayage du cron.
--
-- IDEMPOTENCE : ADD COLUMN IF NOT EXISTS partout ; le backfill ne touche que les
--   lignes encore NULL ; les index sont IF NOT EXISTS. Rejouable sans effet de bord.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Préférences utilisateur (actives par défaut, sans backfill nécessaire).
ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "notify_match_email" boolean NOT NULL DEFAULT true;

ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "notify_match_sms" boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN "public"."users"."notify_match_email" IS
  'Préférence : recevoir un email lors d''une nouvelle opportunité correspondant au profil. Défaut actif.';
COMMENT ON COLUMN "public"."users"."notify_match_sms" IS
  'Préférence : recevoir un SMS lors d''une nouvelle opportunité correspondant au profil (si téléphone vérifié). Défaut actif.';

-- 2. Suivi du dispatch externe, PAR CANAL (NULL = en attente).
ALTER TABLE "public"."notifications"
  ADD COLUMN IF NOT EXISTS "match_email_dispatch_at" timestamp with time zone;
ALTER TABLE "public"."notifications"
  ADD COLUMN IF NOT EXISTS "match_email_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "public"."notifications"
  ADD COLUMN IF NOT EXISTS "match_sms_dispatch_at" timestamp with time zone;
ALTER TABLE "public"."notifications"
  ADD COLUMN IF NOT EXISTS "match_sms_attempts" integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN "public"."notifications"."match_email_dispatch_at" IS
  'Horodatage de traitement de l''email agrégé de match (NULL = en attente). Réclamé atomiquement par le cron avant envoi → anti-doublon. Distinct de status/sent_at (état in-app).';
COMMENT ON COLUMN "public"."notifications"."match_email_attempts" IS
  'Nombre de tentatives d''envoi email (ajout A1). Au-delà de 3, on abandonne (dispatch_at reste posé, échec journalisé).';
COMMENT ON COLUMN "public"."notifications"."match_sms_dispatch_at" IS
  'Horodatage de traitement du SMS agrégé de match (NULL = en attente). Réclamé atomiquement avant envoi. Indépendant du canal email.';
COMMENT ON COLUMN "public"."notifications"."match_sms_attempts" IS
  'Nombre de tentatives d''envoi SMS (ajout A1). Au-delà de 3, on abandonne.';

-- 2.b Anti-spam rétroactif : l'historique de matches est considéré déjà dispatché
--     SUR LES DEUX CANAUX.
UPDATE "public"."notifications"
   SET "match_email_dispatch_at" = COALESCE("match_email_dispatch_at", "created_at"),
       "match_sms_dispatch_at"   = COALESCE("match_sms_dispatch_at", "created_at")
 WHERE "type" = 'new_match_opportunity'
   AND ("match_email_dispatch_at" IS NULL OR "match_sms_dispatch_at" IS NULL);

-- 3. Index partiels : le cron ne lit que les notifications de match EN ATTENTE,
--    par canal.
CREATE INDEX IF NOT EXISTS "notifications_match_email_pending_idx"
  ON "public"."notifications" ("user_id", "created_at")
  WHERE "type" = 'new_match_opportunity' AND "match_email_dispatch_at" IS NULL;

CREATE INDEX IF NOT EXISTS "notifications_match_sms_pending_idx"
  ON "public"."notifications" ("user_id", "created_at")
  WHERE "type" = 'new_match_opportunity' AND "match_sms_dispatch_at" IS NULL;
