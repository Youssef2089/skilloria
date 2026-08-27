-- ─────────────────────────────────────────────────────────────────────────────
-- PRÉFÉRENCES DE NOTIFICATION PAR ÉVÉNEMENT ET PAR CANAL
--
-- CONTEXTE
--   Jusqu'ici, deux booléens sur `users` (notify_match_email / notify_match_sms)
--   couvraient UN seul événement : la nouvelle opportunité de mission. La cible
--   produit en compte désormais trois, avec des canaux différents selon le côté :
--
--     Événement                        | EXPERT        | ORGANISATION
--     nouvelle opportunité             | email + SMS   | —
--     nouvelle candidature reçue       | —             | email + SMS
--     nouveau message                  | email         | email
--
--   Soit cinq réglages exposés, et d'autres viendront (annonce expirée,
--   candidature retenue, invitation…).
--
-- POURQUOI UNE TABLE ET NON DES COLONNES
--   La migration 20260711000001 posait elle-même la règle de bascule :
--     « Si le périmètre dépassait 4-5 préférences, il faudrait basculer sur une
--       TABLE DÉDIÉE plutôt que de multiplier les colonnes sur users. »
--   Le seuil est franchi. Avec des colonnes, chaque nouvel événement exigerait
--   une migration ; avec la table, aucune.
--
-- SÉMANTIQUE DÉCISIVE : L'ABSENCE DE LIGNE VAUT « ACTIVÉ »
--   Seules les DÉSACTIVATIONS sont stockées. Conséquences voulues :
--     - aucun backfill pour les utilisateurs existants ni pour les futurs ;
--     - aucun backfill pour les événements ajoutés plus tard ;
--     - la table reste minuscule (une ligne par refus explicite).
--   C'est ce qui rend le modèle extensible SANS migration, ce que des colonnes
--   ne peuvent pas offrir.
--
-- PRÉSERVATION DES CHOIX DÉJÀ EXPRIMÉS
--   Les anciennes colonnes étaient NOT NULL DEFAULT true. Un utilisateur qui a
--   coupé un canal a donc `false` en base : on insère une ligne de refus pour
--   lui, et LUI SEUL. Les `true` ne produisent rien — ils sont déjà le défaut.
--   Aucun choix n'est réinitialisé.
--
-- RENOMMAGE DES COLONNES DE DISPATCH
--   `match_email_dispatch_at` / `match_sms_dispatch_at` n'étaient spécifiques au
--   matching que par leur NOM : leur sémantique (« cette notification a-t-elle
--   été dépêchée sur ce canal ») est universelle. On RENOMME plutôt que
--   d'ajouter une paire par événement — l'alternative polluerait le schéma à
--   chaque nouvel événement, exactement la maladie soignée ci-dessus.
--   Un RENAME PRÉSERVE LES DONNÉES : l'anti-spam rétroactif posé par la
--   migration 20260711000001 reste valide, aucune notification déjà dépêchée ne
--   repart.
--
-- ⚠️ ORDRE DE DÉPLOIEMENT — cette migration D'ABORD, le code ENSUITE.
--   Elle supprime deux colonnes et en renomme deux autres : le code de la
--   version précédente ne sait pas les lire. Protocole identique au lot
--   collaboration.
--
-- IDEMPOTENCE : IF NOT EXISTS / IF EXISTS partout, insert ON CONFLICT DO NOTHING,
--   renommages gardés par un test de présence. Rejouable sans effet de bord.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Table des préférences ────────────────────────────────────────────────
create table if not exists public.notification_preferences (
  user_id    uuid        not null references public.users(id) on delete cascade,
  -- Type d'événement, aligné sur `notifications.type`. Volontairement TEXT et
  -- non enum : ajouter un événement ne doit demander aucune migration.
  event_type text        not null,
  channel    text        not null check (channel in ('email', 'sms')),
  -- En pratique toujours `false` (l'absence vaut « activé »). La colonne existe
  -- pour rendre l'intention lisible et permettre un « réactivé explicitement »
  -- sans supprimer la ligne.
  enabled    boolean     not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_type, channel)
);

comment on table public.notification_preferences is
  'Préférences de notification par (utilisateur, événement, canal). ABSENCE DE LIGNE = ACTIVÉ : seules les désactivations sont stockées. Remplace users.notify_match_email/sms.';

-- Lecture type du dispatcher : « les refus de cet utilisateur ». La clé primaire
-- (user_id, …) sert déjà de préfixe — aucun index supplémentaire nécessaire.

-- RLS activée SANS policy : seul le service-role (qui la bypasse) y accède,
-- même posture que rate_limit_hits et cron_run_log. La lecture et l'écriture
-- passent par /api/me/notification-preferences, gardé par requireAuth.
alter table public.notification_preferences enable row level security;


-- ─── 2. Reprise des choix déjà exprimés ──────────────────────────────────────
--  Uniquement les REFUS. Un `true` est déjà le défaut, il ne produit rien.
insert into public.notification_preferences (user_id, event_type, channel, enabled)
select id, 'new_match_opportunity', 'email', false
  from public.users
 where notify_match_email = false
on conflict (user_id, event_type, channel) do nothing;

insert into public.notification_preferences (user_id, event_type, channel, enabled)
select id, 'new_match_opportunity', 'sms', false
  from public.users
 where notify_match_sms = false
on conflict (user_id, event_type, channel) do nothing;


-- ─── 3. Renommage des colonnes de dispatch (données préservées) ──────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notifications'
       and column_name = 'match_email_dispatch_at'
  ) then
    alter table public.notifications rename column match_email_dispatch_at to email_dispatch_at;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notifications'
       and column_name = 'match_email_attempts'
  ) then
    alter table public.notifications rename column match_email_attempts to email_attempts;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notifications'
       and column_name = 'match_sms_dispatch_at'
  ) then
    alter table public.notifications rename column match_sms_dispatch_at to sms_dispatch_at;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notifications'
       and column_name = 'match_sms_attempts'
  ) then
    alter table public.notifications rename column match_sms_attempts to sms_attempts;
  end if;
end
$$;

comment on column public.notifications.email_dispatch_at is
  'Horodatage de traitement de l''envoi EMAIL, tous événements confondus (NULL = en attente). Réclamé atomiquement avant envoi → anti-doublon. Distinct de status/sent_at (état in-app).';
comment on column public.notifications.sms_dispatch_at is
  'Horodatage de traitement de l''envoi SMS, tous événements confondus (NULL = en attente). Indépendant du canal email.';
comment on column public.notifications.email_attempts is
  'Nombre de tentatives d''envoi email. Sans cron il n''y a pas de reprise : 1 = échec définitif, conservé pour la traçabilité.';
comment on column public.notifications.sms_attempts is
  'Nombre de tentatives d''envoi SMS. Même sémantique que email_attempts.';


-- ─── 4. Index partiels, désormais tous événements ────────────────────────────
--  Les anciens portaient `WHERE type = 'new_match_opportunity'` : ils
--  n'auraient plus servi dès le premier événement ajouté.
drop index if exists public.notifications_match_email_pending_idx;
drop index if exists public.notifications_match_sms_pending_idx;

create index if not exists notifications_email_pending_idx
  on public.notifications (user_id, created_at)
  where email_dispatch_at is null;

create index if not exists notifications_sms_pending_idx
  on public.notifications (user_id, created_at)
  where sms_dispatch_at is null;


-- ─── 5. Suppression des anciennes colonnes de préférence ─────────────────────
--  Faite ICI et pas plus tard : deux colonnes mortes finissent par être relues
--  par erreur, et un COMMENT ne protège de rien. Le risque est couvert par
--  l'ordre de déploiement (migration d'abord, code ensuite), pas par leur
--  conservation. Les refus qu'elles portaient ont été repris à l'étape 2.
alter table public.users drop column if exists notify_match_email;
alter table public.users drop column if exists notify_match_sms;
