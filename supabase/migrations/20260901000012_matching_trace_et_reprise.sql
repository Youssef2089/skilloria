-- ─────────────────────────────────────────────────────────────────────────────
-- MATCHING — TRACE DURABLE, REPRISE, ET RÉGLAGE DU SEUIL SUR LES FAITS
--
-- ⚠️ ORDRE D'EXÉCUTION — AVANT le déploiement du code. N'ajoute que du nouveau.
--    La tâche pg_cron appelle /api/cron/match-retry : tant que la route n'existe
--    pas, l'appel répond 404, il est journalisé, rien d'autre ne se produit.
--
-- CE FICHIER A ÉTÉ RÉÉCRIT DEUX FOIS. Ce qui a disparu, et pourquoi :
--   • `matching_batches`, réclamation SKIP LOCKED, planification de tranches :
--     supprimés. Le reranking note chaque couple (annonce, profil) INDÉPENDAMMENT
--     des autres — il n'y a plus de prompt géant à découper.
--   • Échantillon de contrôle et taux de saturation : supprimés. Ils mesuraient
--     ce qu'une COUPE avant l'IA écartait. Il n'y a plus de coupe : tout le pool
--     éligible est noté. Le risque qu'ils surveillaient n'existe plus.
--
-- CE QUI RESTE, ET POURQUOI :
--   • LA TRACE. Distinguer « noté, personne ne correspond » de « jamais noté »
--     reste vital, et aucun changement d'architecture n'y touche.
--   • L'EXÉCUTION HORS REQUÊTE. Noter 12 000 profils prend des dizaines de
--     secondes : cela ne peut pas vivre dans la requête de publication sans
--     supposer un plafond de durée d'exécution.
--   • LE PILOTE DE DERNIER RECOURS. Un appel qui échoue doit être rejoué même si
--     personne ne se connecte.
--
-- CE QUI EST NOUVEAU, ET C'EST L'ESSENTIEL DE CE FICHIER :
--   LE RÉGLAGE DU SEUIL. Le score de pertinence d'un reranker vit dans [0,1],
--   mais il n'est PAS calibré : le fournisseur écrit noir sur blanc qu'on ne peut
--   pas supposer qu'un score de 0,91 vaut deux fois un score de 0,44, ni comparer
--   les scores de deux requêtes différentes. Le seuil de notification ne peut
--   donc PAS être deviné, ni traduit depuis l'échelle 0-10 de Claude (7/10 ne
--   vaut PAS 0,7). Il doit être LU SUR LES DONNÉES.
--   `matching_stats` porte donc la distribution des scores de chaque run, et
--   `matching_threshold_health()` la restitue : combien d'experts seraient
--   notifiés à tel ou tel seuil. C'est ce qui permet de régler sans développeur,
--   et sans deviner.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ LA TRACE ═══════════════════════════════════════════════════════════════
alter table public.publications
  add column if not exists matching_attempted_at timestamptz,
  add column if not exists matching_completed_at timestamptz,
  add column if not exists matching_stats        jsonb,
  -- Modèle de RERANKING ayant produit les scores de ce run. Deux runs ne sont
  -- comparables qu'à modèle égal ; changer de fournisseur change l'échelle.
  add column if not exists matching_model        text,
  add column if not exists matching_attempts     integer not null default 0;

comment on column public.publications.matching_stats is
$$Compteurs d'un run, lisibles sans développeur :
  eligible_after_filters : profils retenus par les filtres SQL (branche, spécialités,
                           séniorités, zones, disponibilité). Le PÉRIMÈTRE.
  reranked               : profils réellement notés. DOIT être égal au précédent :
                           tout écart signale une troncature accidentelle, donc
                           des experts écartés sans raison nommable.
  rerank_failed          : lots de reranking en échec. Non nul => le run n'est pas
                           achevé, des experts n'ont pas été notés.
  above_threshold        : profils au-dessus du seuil de notification.
  matches_created        : lignes réellement écrites dans matches.
  score_p50 / p90 / max  : distribution des scores de pertinence de CE run. C'est
                           la matière première du réglage du seuil : sans elle on
                           choisit un nombre au hasard.
  threshold_used         : le seuil appliqué, conservé avec le run. Sans lui, on ne
                           peut pas relire un résultat ancien.$$;

create index if not exists publications_matching_inacheve_idx
  on public.publications (matching_attempted_at)
  where matching_attempted_at is not null
    and matching_completed_at is null;


-- ═══ PROCHAIN RUN À REJOUER ═════════════════════════════════════════════════
-- Le plus ANCIEN d'abord. Au-delà du plafond de tentatives, le run reste
-- inachevé et donc VISIBLE dans matching_health() : un trou qui reste ouvert
-- vaut mieux qu'un trou refermé sur une erreur.
create or replace function public.next_unfinished_matching_run(
  p_max_attempts integer default 5
) returns uuid
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select p.id
    from public.publications p
   where p.matching_attempted_at is not null
     and p.matching_completed_at is null
     and p.matching_attempts < p_max_attempts
     and p.status = 'published'
   order by p.matching_attempted_at
   limit 1;
$fn$;

revoke all on function public.next_unfinished_matching_run(integer) from public, anon, authenticated;
grant execute on function public.next_unfinished_matching_run(integer) to service_role;


-- ═══ PILOTE DE DERNIER RECOURS ══════════════════════════════════════════════
-- Les deux pilotes applicatifs (navigateur après publication, rattrapage à la
-- lecture) suffisent quand quelqu'un est là. Personne ne l'est un vendredi soir.
-- Il vit dans la BASE, comme les purges légales, et ne dépend d'aucun
-- ordonnanceur d'hébergeur. UN SEUL run par passage : la route ne suppose ainsi
-- jamais de plafond de durée d'exécution.
do $$
begin
  perform cron.unschedule('matching_retry_trigger');
exception when others then
  null;
end
$$;

select cron.schedule(
  'matching_retry_trigger',
  '*/5 * * * *',
  $job$select public.trigger_purge_cron('matching_retry_trigger', '/api/cron/match-retry')$job$
);


-- ═══ SUPERVISION 1 — L'ÉTAT DES RUNS ═══════════════════════════════════════
create or replace function public.matching_health()
  returns table (
    jamais_tentee           bigint,
    tentee_mais_inachevee   bigint,
    achevee_avec_zero_match bigint,
    achevee_avec_matches    bigint,
    total_actives           bigint
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select
    count(*) filter (where matching_attempted_at is null),
    count(*) filter (where matching_attempted_at is not null
                       and matching_completed_at is null),
    count(*) filter (where matching_completed_at is not null
                       and coalesce((matching_stats->>'matches_created')::int, 0) = 0),
    count(*) filter (where matching_completed_at is not null
                       and coalesce((matching_stats->>'matches_created')::int, 0) > 0),
    count(*)
  from public.publications
  where status = 'published'
    and coalesce(expires_at, published_at + interval '30 days') > now();
$fn$;

revoke all on function public.matching_health() from public, anon, authenticated;
grant execute on function public.matching_health() to service_role;


-- ═══ SUPERVISION 2 — LE PÉRIMÈTRE EST-IL INTÈGRE ? ═════════════════════════
-- `reranked` DOIT égaler `eligible_after_filters`. Tout écart veut dire que des
-- profils éligibles n'ont pas été notés : une coupe qu'aucune règle ne justifie,
-- exactement ce que la règle figée interdit. Cette fonction est l'alarme.
create or replace function public.matching_coverage_health(
  p_depuis interval default interval '30 days'
) returns table (
    runs_observes        bigint,
    runs_complets        bigint,
    runs_tronques        bigint,
    experts_non_notes    bigint,
    lots_rerank_en_echec bigint
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select
    count(*),
    count(*) filter (where (matching_stats->>'reranked')::int
                         = (matching_stats->>'eligible_after_filters')::int),
    count(*) filter (where (matching_stats->>'reranked')::int
                         < (matching_stats->>'eligible_after_filters')::int),
    coalesce(sum(greatest(0, (matching_stats->>'eligible_after_filters')::int
                           - (matching_stats->>'reranked')::int)), 0),
    coalesce(sum((matching_stats->>'rerank_failed')::int), 0)
  from public.publications
  where matching_completed_at is not null
    and matching_completed_at > now() - p_depuis
    and matching_stats ? 'eligible_after_filters';
$fn$;

revoke all on function public.matching_coverage_health(interval) from public, anon, authenticated;
grant execute on function public.matching_coverage_health(interval) to service_role;


-- ═══ SUPERVISION 3 — RÉGLER LE SEUIL SUR LES FAITS ═════════════════════════
-- Répond à la seule question qui compte pour ce réglage : « si je pose le seuil
-- à X, combien d'experts sont notifiés par annonce ? »
--
-- Le fournisseur recommande explicitement de calibrer sur 30 à 50 requêtes
-- représentatives plutôt que de supposer un seuil. Cette fonction est ce
-- calibrage, fait sur les vraies annonces plutôt que sur un jeu d'essai.
--
-- ⚠️ Elle ne peut répondre que pour les seuils déjà observés à travers la
--    distribution enregistrée (p50, p90, max). Pour une simulation fine, il
--    faudra conserver l'histogramme complet — décision de produit, car cela
--    alourdit matching_stats.
create or replace function public.matching_threshold_health(
  p_depuis interval default interval '30 days'
) returns table (
    runs_observes         bigint,
    seuil_median_applique numeric,
    notifies_moyen        numeric,
    notifies_median       numeric,
    part_notifiee_moyenne numeric,
    score_p50_moyen       numeric,
    score_p90_moyen       numeric,
    runs_zero_notifie     bigint,
    runs_tout_notifie     bigint
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select
    count(*),
    round(percentile_cont(0.5) within group (
      order by (matching_stats->>'threshold_used')::numeric)::numeric, 4),
    round(avg((matching_stats->>'above_threshold')::numeric), 1),
    round(percentile_cont(0.5) within group (
      order by (matching_stats->>'above_threshold')::numeric)::numeric, 1),
    -- Part du pool éligible réellement notifiée. Proche de 1 => le seuil ne
    -- filtre rien et l'expert reçoit tout. Proche de 0 => il ne reçoit rien.
    round(avg(
      (matching_stats->>'above_threshold')::numeric
      / nullif((matching_stats->>'eligible_after_filters')::numeric, 0)
    ), 3),
    round(avg((matching_stats->>'score_p50')::numeric), 4),
    round(avg((matching_stats->>'score_p90')::numeric), 4),
    count(*) filter (where (matching_stats->>'above_threshold')::int = 0),
    count(*) filter (where (matching_stats->>'above_threshold')::int
                         = (matching_stats->>'eligible_after_filters')::int)
  from public.publications
  where matching_completed_at is not null
    and matching_completed_at > now() - p_depuis
    and matching_stats ? 'above_threshold';
$fn$;

revoke all on function public.matching_threshold_health(interval) from public, anon, authenticated;
grant execute on function public.matching_threshold_health(interval) to service_role;
