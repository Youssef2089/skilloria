-- ════════════════════════════════════════════════════════════════════════════
--  LA BASE ATTEINT-ELLE LE SITE ? — le dernier appel de chaque tâche, avec sa CAUSE (recette staging, 30/09/2026).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement (§G.4) — elle n'ajoute qu'une fonction de LECTURE, que le code
--  déployé ensuite appelle ; le code en ligne ne l'appelle pas.
--
--  LE CAS : sur staging, le secret `purge_cron_base_url` vaut l'adresse RACINE, que la protection de Vercel
--  garde (401) ; seul `*.staging.skilloria.io` en est exempté. Chaque appel de la base au site est refusé
--  AVANT d'atteindre le code : aucune tâche ne tourne, et rien ne le disait —
--    · la route ne clôt pas son passage (elle n'a pas été atteinte) ;
--    · la réconciliation (`reconcile_cron_run_log`) ne recopie la réponse brute qu'à 03:15 et 03:45, alors
--      que pg_net ne la garde qu'environ SIX heures : un refus de la journée est perdu avant d'être lu ;
--    · /admin/supervision ne lisait aucun passage de tâche.
--
--  CE QU'ELLE REND : pour chaque tâche HTTP, son DERNIER appel des 24 dernières heures, avec le statut,
--  l'expiration, l'erreur de connexion, et d'où vient le verdict — la ligne close par la TÂCHE (le site a
--  été atteint), la RÉCONCILIATION, ou la RÉPONSE BRUTE encore gardée par pg_net (lue ici, sans attendre la
--  nuit). Un drapeau dit si un 401 est NOTRE refus (le corps porte `"code":"unauthorized"` : le secret de
--  tâche du Vault ne correspond pas à CRON_SECRET) plutôt qu'une protection posée devant le site.
--  La CAUSE est nommée en TypeScript (`lib/supervision/joignabilite.ts`, pur, exécuté par son contrôle).
--
--  AUCUN CORPS NE SORT : ni la réponse ni l'erreur au-delà de leur présence — le corps d'une page de
--  protection est du HTML d'hébergeur, il n'apprendrait rien à l'écran.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cron_joignabilite(p_depuis interval default interval '24 hours')
  returns table (
    job_name        text,
    requested_at    timestamptz,
    http_status     integer,
    timed_out       boolean,
    erreur_connexion boolean,
    secret_refuse   boolean,
    source          text
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select distinct on (l.job_name)
         l.job_name,
         l.requested_at,
         coalesce(l.http_status, r.status_code),
         coalesce(l.timed_out, r.timed_out, false),
         coalesce(l.error_msg, r.error_msg) is not null,
         coalesce(l.response_body, r.content, '') like '%"code":"unauthorized"%',
         case
           when l.verdict_source = 'tache'                     then 'tache'
           when l.reconciled_at is not null                    then 'reconciliation'
           when r.id is not null                               then 'reponse_brute'
           else 'aucune'
         end
    from public.cron_run_log l
    left join net._http_response r on r.id = l.request_id
   where l.request_id is not null
     and l.requested_at > now() - coalesce(p_depuis, interval '24 hours')
   order by l.job_name, l.requested_at desc;
$fn$;

revoke all on function public.cron_joignabilite(interval) from public, anon, authenticated;
grant execute on function public.cron_joignabilite(interval) to service_role;

comment on function public.cron_joignabilite(interval) is
  'Le dernier appel HTTP de chaque tache (24 h) : statut, expiration, erreur de connexion, 401 de notre '
  'secret, et la source du verdict (tache, reconciliation, reponse_brute, aucune). Lecture seule. La cause '
  'est nommee par lib/supervision/joignabilite.ts ; /admin/supervision la dit.';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.cron_joignabilite(interval)') is null then
    raise exception 'postcondition NON TENUE : cron_joignabilite absente';
  end if;
  if has_function_privilege('anon', 'public.cron_joignabilite(interval)', 'execute')
     or has_function_privilege('authenticated', 'public.cron_joignabilite(interval)', 'execute') then
    raise exception 'postcondition NON TENUE : cron_joignabilite ouverte au navigateur';
  end if;
  if not has_function_privilege('service_role', 'public.cron_joignabilite(interval)', 'execute') then
    raise exception 'postcondition NON TENUE : cron_joignabilite fermee a la cle de service (la supervision ne la lirait pas)';
  end if;
  raise notice 'postcondition tenue : cron_joignabilite presente, fermee au navigateur, ouverte a la cle de service ; chaque source et chaque cause sont prouvees par tests/database/taches_planifiees/joignabilite.test.sql';
end
$post$;
