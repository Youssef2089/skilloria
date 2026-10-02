-- ════════════════════════════════════════════════════════════════════════════
--  UNE MISSION POSTULÉE SORT DES RECOMMANDATIONS — ET LE PALIER « FORT » NE DÉCIDE PLUS D'AUCUNE ALERTE
--  (lot alertes et recommandations, 02/10/2026).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Elle n'ajoute que du nouveau — une fonction, `mission_postulee(matches)`,
--  qu'aucune ligne du code en ligne n'appelle — et réécrit deux COMMENTAIRES de colonne. Rien de ce que le code en
--  ligne écrit ne peut échouer par elle. Le code du lot l'appelle (lib/missions/feed.ts) : il part APRÈS elle.
--
--  LE CAS (recette staging, compte d'essai freelance) : après sa candidature, la mission restait dans « Missions
--  recommandées » et dans « Missions ». La réconciliation GARDE le match d'une candidature — c'est un acte engagé
--  (lib/matching/reconcile.ts, `preserved_with_candidature`) — et le flux ne regardait que le statut du match.
--
--  LA RÈGLE : une mission à laquelle l'expert a postulé (une candidature, quel que soit son statut — la même règle que
--  le vivier, qui écarte « déjà postulé ») quitte le flux ET son compteur, freelance et CDI, à l'accueil comme dans
--  « Missions ». Elle vit désormais dans le suivi des candidatures.
--
--  POURQUOI UN CHAMP CALCULÉ EN BASE, ET PAS UNE LISTE DANS LA REQUÊTE : le flux et le badge passent par UNE fonction
--  (`expertMissionsQuery`), dont le badge lit un COMPTE exact (`head`). Exclure les annonces postulées par une liste
--  d'identifiants écrirait dans l'adresse un filtre qui grandit avec chaque candidature (le mur des longueurs d'URL que
--  le moteur découpe partout ailleurs) ; filtrer en mémoire fausserait le compte. PostgREST lit une fonction qui prend
--  la ligne en argument comme une colonne (`.eq('mission_postulee', false)`) : le filtre est posé dans la requête, et
--  le compte reste exact. La sonde suit l'index unique `candidatures_publication_profile_unique`.
--
--  ET LES DEUX COMMENTAIRES DE `matching_settings` MENTAIENT DÉSORMAIS : une annonce qui s'affiche dans les
--  recommandations prévient l'expert, toujours (décision de Youssef) — `notify_enabled` n'est plus lu par le moteur et
--  `notify_threshold` ne règle plus que le PALIER affiché. Les colonnes restent (un renommage casse au runtime, §E.1 ;
--  une suppression restreint et part au déploiement suivant, §E.72) ; leur commentaire dit la vérité.
--
--  Colonnes et contraintes lues (§G.10) : matches (publication_id uuid NOT NULL, profile_id uuid NOT NULL, domain_id
--  uuid NOT NULL, status ∈ pending/notified/viewed/dismissed — matches_status_check ; relevance_score nullable) ;
--  candidatures (publication_id, profile_id NOT NULL ; contrainte unique candidatures_publication_profile_unique) ;
--  matching_settings (feed_threshold, notify_threshold numeric NOT NULL, 0-10 ; matching_settings_ordre_check
--  notify_threshold >= feed_threshold ; notify_enabled boolean NOT NULL default false).
--
--  Prouvée par tests/database/matching/mission_postulee.test.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Le champ calculé ──────────────────────────────────────────────────────
create or replace function public.mission_postulee(m public.matches)
  returns boolean
  language sql
  stable
  set search_path to 'public'
as $fn$
  select exists (
    select 1
      from public.candidatures c
     where c.publication_id = m.publication_id
       and c.profile_id = m.profile_id
  );
$fn$;

revoke all on function public.mission_postulee(public.matches) from public, anon, authenticated;
grant execute on function public.mission_postulee(public.matches) to service_role;

comment on function public.mission_postulee(public.matches) is
  'Champ calculé de matches (PostgREST) : vrai si l''expert du match a une candidature sur son annonce, quel que soit '
  'son statut. Le flux des recommandations et son compteur (lib/missions/feed.ts) l''excluent : une mission postulée '
  'quitte les recommandations, elle vit dans le suivi des candidatures.';

-- ── 2. Les commentaires qui disent la vérité ────────────────────────────────
comment on column public.matching_settings.notify_threshold is
  'PALIER « Correspondance forte », échelle 0-10 : à partir de cette note, le match porte relevance_tier = strong '
  '(figé à la notation). Il ne décide d''AUCUNE alerte : toute annonce qui s''affiche dans les recommandations prévient '
  'l''expert (lot alertes, décision de Youssef).';

comment on column public.matching_settings.notify_enabled is
  'INERTE depuis le lot alertes : ni lu par le moteur, ni écrit par l''administration. Une annonce qui s''affiche dans '
  'les recommandations prévient toujours l''expert — aucun réglage ne doit pouvoir contredire cette règle. La colonne '
  'reste pour les lignes passées du journal des réglages ; sa suppression restreindrait, elle part dans un lot à part.';

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.mission_postulee(public.matches)') is null then
    raise exception 'postcondition NON TENUE : la fonction mission_postulee(matches) manque';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.mission_postulee(public.matches)')
                  and p.provolatile = 's' and p.prorettype = 'boolean'::regtype) then
    raise exception 'postcondition NON TENUE : mission_postulee doit être STABLE et rendre un booléen (PostgREST ne lit pas un champ volatil comme une colonne)';
  end if;
  if has_function_privilege('authenticated', 'public.mission_postulee(public.matches)', 'execute')
     or has_function_privilege('anon', 'public.mission_postulee(public.matches)', 'execute') then
    raise exception 'postcondition NON TENUE : mission_postulee est ouverte au navigateur';
  end if;
  if not has_function_privilege('service_role', 'public.mission_postulee(public.matches)', 'execute') then
    raise exception 'postcondition NON TENUE : le serveur (service_role) ne peut pas lire mission_postulee';
  end if;
  raise notice 'postcondition tenue : mission_postulee(matches), stable, fermée au navigateur ; prouvé par tests/database/matching/mission_postulee.test.sql';
end
$post$;
