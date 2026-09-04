-- ─────────────────────────────────────────────────────────────────────────────
-- INDEX D'ÉCHELLE — ce qui devient lent quand `matches` passe au million
--
-- ⚠️ ORDRE D'EXÉCUTION — indifférent. Cette migration n'ajoute que des index et
--    ne change aucun comportement. Elle peut passer avant ou après le
--    déploiement du code.
--
-- POURQUOI MAINTENANT, ALORS QUE TOUT EST RAPIDE AUJOURD'HUI
--   Les index existants (matches_profile_idx, matches_publication_idx) portent
--   sur UNE colonne. Ils suffisent tant que la table tient en mémoire. Le
--   nouveau moteur change l'ordre de grandeur : plus de plafond de pool, donc
--   potentiellement des dizaines de milliers de matches par annonce. À ce
--   volume, un index mono-colonne oblige Postgres à relire les lignes pour
--   trier ou pour filtrer sur la seconde colonne — le coût passe de constant à
--   linéaire, sans qu'aucune erreur ne le signale. Un index posé après coup se
--   pose sous incident.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ MATCHES ════════════════════════════════════════════════════════════════

-- Feed expert : `where profile_id = ? and status <> 'dismissed' order by <score> desc`.
-- L'index existant s'arrête à profile_id : le tri se fait ensuite en mémoire,
-- sur toutes les lignes de l'expert.
--
-- L'index composite qui corrige cela vit dans la migration `score_de_pertinence`, pas ici :
-- c'est elle qui remplace `matches.score` (note Claude sur 10) par
-- `matches.relevance_score` (pertinence du reranker dans [0,1]). Le poser ici
-- reviendrait à indexer une colonne que la migration suivante supprime.

-- Réconciliation par tranche : `where publication_id = ? and profile_id = any(?)`.
-- C'est LA requête du nouveau moteur, appelée une fois par tranche. L'index
-- composite évite de charger tous les matches de l'annonce pour n'en garder
-- qu'une tranche — exactement ce que `restrictToProfileIds` cherche à éviter
-- côté applicatif.
create index if not exists matches_publication_profile_idx
  on public.matches (publication_id, profile_id);


-- ═══ NOTIFICATIONS ══════════════════════════════════════════════════════════

-- RIEN À AJOUTER SUR LE BALAYAGE DU DISPATCHER — vérifié, et c'est une
-- correction à l'audit précédent. Sa requête est scopée aux destinataires
-- (`.in('user_id', …)`), pas globale, et la migration 20260827000000 a déjà posé
-- les deux index partiels qui lui correspondent exactement :
--   notifications_email_pending_idx (user_id, created_at) WHERE email_dispatch_at IS NULL
--   notifications_sms_pending_idx   (user_id, created_at) WHERE sms_dispatch_at   IS NULL
-- Ajouter ici des partiels menés par `type` ferait deux index redondants sur le
-- même prédicat, payés à chaque écriture pour rien.
--
-- Le vrai défaut de ce chemin n'est pas indexable : `SCAN_LIMIT = 2000` plafonne
-- le nombre de notifications traitées par appel. Appelé avec 12 000 destinataires
-- fraîchement matchés, le dispatcher n'en sert que 2 000 — les 10 000 autres ne
-- reçoivent jamais leur e-mail, et rien ne le signale. La correction est dans le
-- code du lot (découpage par paquets de 1 000 destinataires), pas ici.

-- Idempotence des notifications : avant d'insérer, `notifyAndFlip` vérifie
-- qu'il n'existe pas déjà une notification (type, user_id, entity_id). Cette
-- lecture-là n'a AUCUN index composite aujourd'hui — elle s'appuie sur
-- idx_notifications_type seul, qui ne discrimine rien puisque tout le trafic de
-- matching porte le même type. À 12 000 destinataires elle devient le point
-- chaud de l'envoi.
create index if not exists notifications_type_user_entity_idx
  on public.notifications (type, user_id, entity_id);


-- ═══ CANDIDATURES ═══════════════════════════════════════════════════════════

-- Le compteur de badges dérivait un état de vie en JavaScript sur 2 000 lignes
-- chargées sans tri : au-delà, le chiffre affiché était faux. Le lot de code
-- remplace ce chargement par un agrégat SQL. Ces deux index le rendent
-- constant, côté expert comme côté organisation.
create index if not exists candidatures_profile_status_idx
  on public.candidatures (profile_id, status);

create index if not exists candidatures_publication_status_idx
  on public.candidatures (publication_id, status);
