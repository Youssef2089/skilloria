-- ─────────────────────────────────────────────────────────────────────────────
-- PORTAGE DES PURGES RGPD : LE DECLENCHEUR PASSE DE VERCEL CRON A pg_cron
--
-- CONTEXTE
--   Deux purges LEGALEMENT OBLIGATOIRES tournaient sur Vercel Cron :
--     - /api/cron/purge-deletions  (RGPD art. 17, suppression volontaire echue)
--     - /api/cron/purge-inactive   (CNIL recrutement, 2 ans apres dernier contact)
--   Contrainte plateforme (aout 2026) : AUCUN batch, AUCUN cron heberge sur
--   Vercel. L'ordonnancement doit suivre la BASE si l'hebergeur change.
--
-- CE QUI BOUGE / CE QUI NE BOUGE PAS
--   Le DECLENCHEUR bouge (Vercel Cron -> pg_cron + pg_net).
--   Le TRAITEMENT ne bouge pas : les deux routes Next.js sont appelees en HTTP,
--   inchangees. Raison : elles envoient des emails (Resend) et suppriment des
--   fichiers de buckets Storage — deux choses que du SQL seul ne sait pas faire.
--
-- AUCUN SECRET, AUCUNE URL DANS CE FICHIER
--   Le secret partage (miroir de CRON_SECRET) et l'origine de l'application
--   different par environnement et ne doivent JAMAIS etre versionnes. Ils vivent
--   dans Supabase Vault sous deux noms stables, poses A LA MAIN par
--   environnement, hors migration :
--     - 'cron_secret'          : miroir exact de CRON_SECRET (Vercel)
--     - 'purge_cron_base_url'  : origine stable, sans slash final
--   Le job pg_cron n'appelle QUE la fonction ; la fonction lit le Vault A
--   L'EXECUTION. Consequence voulue : `cron.job.command` ne contient aucun
--   secret. Interpoler le secret dans la commande planifiee l'aurait stocke en
--   clair dans la table `cron.job`, lisible par tout role ayant acces au schema
--   `cron` — c'est le piege principal de ce montage.
--
--   Secret manquant => la fonction LEVE. Jamais d'appel en clair, jamais
--   d'echec silencieux.
--
-- OBSERVABILITE (pourquoi trois objets et pas un)
--   pg_net est ASYNCHRONE : `net.http_post` rend la main immediatement avec un
--   request_id et ne connait pas le resultat. Donc :
--     - `cron.job_run_details` (tenu par pg_cron) prouve seulement que l'appel a
--       ete MIS EN FILE. Un 401 ou un 500 y apparait `succeeded`.
--     - `net._http_response` porte le vrai status_code, mais est purgee par
--       pg_net (TTL court, ~6 h) : une panne du week-end serait effacee avant
--       constat.
--   D'ou `public.cron_run_log` (durable) + un job de RECONCILIATION qui recopie
--   la reponse avant expiration du TTL. Une purge legale ne doit pas pouvoir
--   cesser de tourner sans que personne ne le voie.
--
-- CONVENTION : reprise stricte de 20260708000005_rate_limiter.sql —
--   `unschedule` garde dans un bloc `do` avant chaque `schedule`, dollar-quoting,
--   migration REJOUABLE de bout en bout. Les etiquettes de dollar-quoting sont
--   nommees ($fn$ / $job$) pour lever toute ambiguite entre corps de fonction et
--   commande planifiee.
--
-- Additif et idempotent. Aucune donnee metier touchee.
-- ─────────────────────────────────────────────────────────────────────────────

-- pg_cron : deja actif (pose par 20260708000005_rate_limiter.sql). Repris ici
-- pour que cette migration soit lisible seule et rejouable dans n'importe quel
-- ordre de reconstruction.
create extension if not exists pg_cron;

-- pg_net : appels HTTP sortants depuis Postgres. Disponible mais NON INSTALLE
-- sur ce projet (verifie avant ecriture : pg_net 0.20.0). Son control file fixe
-- `schema = net` et `relocatable = false` : les fonctions atterrissent donc
-- toujours dans le schema `net`, non expose par PostgREST (seuls `public` et
-- `graphql_public` le sont sur ce projet).
create extension if not exists pg_net;


-- ─── JOURNAL DURABLE DES DECLENCHEMENTS ──────────────────────────────────────
-- RLS activee SANS policy : seul le service-role (qui bypass RLS) y accede,
-- meme posture que `rate_limit_hits`.
--
-- DONNEES PERSONNELLES : `response_body` recopie la reponse JSON de la route.
-- Pour purge-deletions/purge-inactive, le champ `errors` de cette reponse
-- contient les UUID des comptes dont la purge a ECHOUE. C'est un identifiant
-- pseudonyme, conserve ici comme piece d'accountability (RGPD art. 5.2) : sans
-- lui, un echec de purge est inexploitable. Retention bornee a 90 jours par
-- `purge_cron_maintenance()`, corps tronque a 2000 caracteres. Aucune autre PII.
create table if not exists public.cron_run_log (
  id            bigint generated always as identity primary key,
  job_name      text        not null,
  requested_at  timestamptz not null default now(),
  -- id pg_net. Non null des que l'appel a ete mis en file.
  request_id    bigint,
  -- Colonnes remplies par la reconciliation (null tant qu'elle n'a pas tourne).
  http_status   integer,
  timed_out     boolean,
  error_msg     text,
  response_body text,
  reconciled_at timestamptz
);

create index if not exists cron_run_log_job_time_idx
  on public.cron_run_log (job_name, requested_at desc);

-- Index partiel : la reconciliation ne balaie que les lignes en attente.
create index if not exists cron_run_log_pending_idx
  on public.cron_run_log (requested_at)
  where reconciled_at is null;

alter table public.cron_run_log enable row level security;


-- ─── DECLENCHEUR HTTP ────────────────────────────────────────────────────────
-- Appelee par pg_cron. Lit le Vault A L'EXECUTION, appelle la route, journalise.
--
-- TIMEOUT 60 s : aligne sur `maxDuration = 60` de la route purge-inactive. Le
-- defaut pg_net (5 000 ms) couperait la connexion des que le lot depasse
-- quelques comptes et produirait un FAUX ECHEC chaque nuit — ce qui detruirait
-- la valeur de l'observabilite construite juste au-dessus.
--
-- Un timeout n'annule PAS le traitement : la fonction serveur poursuit et
-- termine. Les routes etant idempotentes, un timeout est un compte-rendu perdu,
-- pas une purge perdue.
create or replace function public.trigger_purge_cron(
  p_job_name text,
  p_path     text
) returns bigint
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_secret text;
  v_base   text;
  v_req_id bigint;
begin
  if p_path is null or left(p_path, 1) <> '/' then
    raise exception 'trigger_purge_cron: chemin invalide (%) — attendu un chemin absolu', p_path;
  end if;

  -- Secret partage. Absent => on LEVE : jamais d'appel non authentifie.
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cron_secret';
  if v_secret is null or btrim(v_secret) = '' then
    raise exception
      'trigger_purge_cron(%): secret Vault "cron_secret" absent ou vide — appel annule', p_job_name;
  end if;

  -- Origine de l'application pour CET environnement. Absente => on LEVE :
  -- jamais d'appel vers une URL devinee.
  select decrypted_secret into v_base
    from vault.decrypted_secrets
   where name = 'purge_cron_base_url';
  if v_base is null or btrim(v_base) = '' then
    raise exception
      'trigger_purge_cron(%): secret Vault "purge_cron_base_url" absent ou vide — appel annule', p_job_name;
  end if;
  -- Defensif : un slash final stocke par megarde ne doit pas produire '//api'.
  v_base := rtrim(btrim(v_base), '/');

  select net.http_post(
           url                  := v_base || p_path,
           body                 := '{}'::jsonb,
           headers              := jsonb_build_object(
                                     'Content-Type',  'application/json',
                                     'Authorization', 'Bearer ' || v_secret
                                   ),
           timeout_milliseconds := 60000
         )
    into v_req_id;

  insert into public.cron_run_log (job_name, request_id)
  values (p_job_name, v_req_id);

  return v_req_id;
end;
$fn$;

-- Personne n'appelle cette fonction depuis l'application : seul pg_cron la
-- declenche, sous le role proprietaire. Aucun grant, meme pas service_role.
revoke all on function public.trigger_purge_cron(text, text) from public, anon, authenticated, service_role;


-- ─── RECONCILIATION ──────────────────────────────────────────────────────────
-- Recopie la reponse HTTP depuis `net._http_response` vers le journal durable,
-- AVANT que pg_net ne la purge (TTL ~6 h). Sans ce job, `cron_run_log` ne
-- contiendrait que des lignes sans verdict.
--
-- Fenetre de 24 h : au-dela, la reponse a de toute facon disparu ; la ligne
-- reste `reconciled_at IS NULL`, ce que le diagnostic interprete comme
-- « aucune reponse observee » — un echec, pas un silence.
create or replace function public.reconcile_cron_run_log()
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_count integer;
begin
  update public.cron_run_log l
     set http_status   = r.status_code,
         timed_out     = r.timed_out,
         error_msg     = r.error_msg,
         response_body = left(r.content, 2000),
         reconciled_at = now()
    from net._http_response r
   where r.id = l.request_id
     and l.reconciled_at is null
     and l.request_id is not null
     and l.requested_at > now() - interval '24 hours';

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function public.reconcile_cron_run_log() from public, anon, authenticated, service_role;


-- ─── MENAGE ──────────────────────────────────────────────────────────────────
-- Deux tables a borner, sinon on recree exactement le probleme que
-- `rate_limit_hits_purge` resout :
--   - `public.cron_run_log`     : notre journal (90 j — voir note PII plus haut).
--   - `cron.job_run_details`    : tenue par pg_cron et JAMAIS auto-purgee (30 j).
create or replace function public.purge_cron_maintenance()
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  delete from public.cron_run_log
   where requested_at < now() - interval '90 days';

  -- Isole dans son propre bloc : si le role proprietaire n'a pas le droit de
  -- supprimer dans le schema `cron`, le menage de notre journal a deja eu lieu
  -- et ne doit pas etre annule. L'avertissement remonte dans job_run_details.
  begin
    delete from cron.job_run_details
     where start_time < now() - interval '30 days';
  exception when insufficient_privilege then
    raise warning 'purge_cron_maintenance: suppression dans cron.job_run_details refusee (privileges)';
  end;
end;
$fn$;

revoke all on function public.purge_cron_maintenance() from public, anon, authenticated, service_role;


-- ─── LECTURE DE SANTE (consommee par scripts/diag-cron-purges.mjs) ───────────
-- Le schema `cron` n'est pas expose par PostgREST : un script service-role ne
-- peut pas lire `cron.job_run_details` directement. Cette fonction est le SEUL
-- point d'exposition, en lecture, et joint les DEUX sources necessaires :
--   - l'ordonnanceur (le job s'est-il declenche ? la fonction a-t-elle leve ?)
--   - le resultat HTTP (la route a-t-elle repondu 200 ?)
-- C'est cette jointure qui distingue « le job n'a pas tourne » de « le job a
-- tourne mais la route a repondu 401 » — deux pannes qui se soignent
-- differemment.
create or replace function public.cron_purge_health()
  returns table (
    job_name           text,
    schedule           text,
    active             boolean,
    sched_status       text,
    sched_end          timestamptz,
    sched_message      text,
    http_requested_at  timestamptz,
    http_status        integer,
    http_timed_out     boolean,
    http_error         text,
    http_response      text,
    http_reconciled_at timestamptz
  )
  language sql
  security definer
  set search_path to 'public'
  stable
as $fn$
  with jobs(name) as (
    values ('purge_deletions_trigger'),
           ('purge_inactive_trigger'),
           ('cron_run_reconcile'),
           ('cron_run_log_purge')
  )
  select
    j.name::text,
    c.schedule::text,
    c.active,
    d.status::text,
    d.end_time,
    d.return_message::text,
    l.requested_at,
    l.http_status,
    l.timed_out,
    l.error_msg,
    l.response_body,
    l.reconciled_at
  from jobs j
  left join cron.job c
    on c.jobname = j.name
  left join lateral (
    select dd.status, dd.end_time, dd.return_message
      from cron.job_run_details dd
     where dd.jobid = c.jobid
     order by dd.start_time desc
     limit 1
  ) d on true
  left join lateral (
    select ll.requested_at, ll.http_status, ll.timed_out,
           ll.error_msg, ll.response_body, ll.reconciled_at
      from public.cron_run_log ll
     where ll.job_name = j.name
     order by ll.requested_at desc
     limit 1
  ) l on true;
$fn$;

revoke all on function public.cron_purge_health() from public, anon, authenticated;
grant execute on function public.cron_purge_health() to service_role;


-- ─── PLANIFICATION ───────────────────────────────────────────────────────────
-- Horaires conserves a l'identique de vercel.json (0 3 et 30 3). pg_cron et
-- Vercel Cron s'expriment tous deux en UTC : l'equivalence est directe, ce qui
-- rend les deux ordonnanceurs COMPARABLES pendant la periode de double
-- execution. Aucun croisement avec `rate_limit_hits_purge` (0 4).
--
-- Rappel de la regle de bascule : on porte, on verifie, on ne retire de
-- vercel.json qu'apres constat. Les deux ordonnanceurs tournent en parallele
-- entre-temps — les routes etant idempotentes, un double passage ne casse rien,
-- et cette redondance garantit zero jour sans purge.

do $$
begin
  perform cron.unschedule('purge_deletions_trigger');
exception when others then
  null; -- le job n'existait pas encore : ignore
end
$$;

select cron.schedule(
  'purge_deletions_trigger',
  '0 3 * * *',
  $job$select public.trigger_purge_cron('purge_deletions_trigger', '/api/cron/purge-deletions')$job$
);

do $$
begin
  perform cron.unschedule('purge_inactive_trigger');
exception when others then
  null;
end
$$;

select cron.schedule(
  'purge_inactive_trigger',
  '30 3 * * *',
  $job$select public.trigger_purge_cron('purge_inactive_trigger', '/api/cron/purge-inactive')$job$
);

-- Reconciliation 15 min apres CHAQUE purge, pas toutes les 15 min : deux
-- passages suffisent (timeout 60 s => la reponse est arrivee bien avant), et on
-- evite de gonfler job_run_details de 96 lignes/jour. Un passage manque est
-- rattrape le lendemain grace a la fenetre de 24 h de la fonction.
do $$
begin
  perform cron.unschedule('cron_run_reconcile');
exception when others then
  null;
end
$$;

select cron.schedule(
  'cron_run_reconcile',
  '15,45 3 * * *',
  $job$select public.reconcile_cron_run_log()$job$
);

-- Menage a 4 h 10, apres rate_limit_hits_purge (4 h 00) pour ne pas se croiser.
do $$
begin
  perform cron.unschedule('cron_run_log_purge');
exception when others then
  null;
end
$$;

select cron.schedule(
  'cron_run_log_purge',
  '10 4 * * *',
  $job$select public.purge_cron_maintenance()$job$
);
