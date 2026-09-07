-- ─────────────────────────────────────────────────────────────────────────────
-- LA RELANCE D'UN EXPERT — REPORTÉE, JAMAIS ANNULÉE
--
-- ⚠️ ORDRE D'EXÉCUTION — AVANT le déploiement du code. N'ajoute que du nouveau.
--    La tâche pg_cron appelle /api/cron/expert-relance : tant que la route
--    n'existe pas, l'appel répond 404, il est journalisé, rien d'autre ne se
--    produit.
--
-- ═══ CE QUI CLOCHE AUJOURD'HUI ═══════════════════════════════════════════════
--   Un expert modifie son profil : le moteur tourne. Il le modifie à nouveau
--   dans l'heure : le garde-fou de débit REFUSE (429), et ce déclenchement est
--   PERDU. Ses dernières modifications ne sont jamais notées. Rien ne le
--   signale — ni à lui, ni à nous.
--
--   Le garde-fou avait raison de protéger le coût. Il avait tort d'ANNULER.
--
-- ═══ CE QUE FAIT CETTE MIGRATION ════════════════════════════════════════════
--   Un déclenchement pendant la temporisation ne disparaît plus : il REPORTE
--   l'échéance. On attend que l'expert ait fini de modifier son profil, puis on
--   note une seule fois, sur son état FINAL. Une note au lieu de cinq, et
--   surtout : aucune modification perdue.
--
-- ═══ LE PIÈGE DU REPORT, ET IL EST NOMMÉ ICI ════════════════════════════════
--   Reporter indéfiniment, c'est ne jamais exécuter. Un expert qui modifie son
--   profil toutes les cinquante minutes ne serait JAMAIS noté — et ce serait
--   exactement le défaut qu'on prétend corriger, déguisé en fonctionnalité.
--
--   Deux garde-fous, donc :
--     • `matching_relance_first_at` — l'instant du PREMIER déclenchement en
--       attente. L'exécution a lieu au plus tôt des deux : l'échéance reportée,
--       ou ce premier instant plus l'attente maximale. Le report ne peut pas
--       repousser au-delà.
--     • `matching_relance_reported` — le nombre de reports. Il ne bloque rien,
--       il RENSEIGNE : un profil reporté vingt fois est un signal, pas un
--       détail.
--
--   L'attente maximale vit dans le CODE et non ici : c'est un réglage de
--   comportement, pas une donnée. La base porte les faits, le code porte la
--   règle — et une seule des deux doit bouger quand on change d'avis.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ L'ÉTAT D'UNE RELANCE EN ATTENTE ════════════════════════════════════════
alter table public.profiles
  -- Échéance courante. NULL = rien en attente. Repoussée à chaque nouveau
  -- déclenchement pendant la temporisation.
  add column if not exists matching_relance_due_at    timestamptz,
  -- Instant du PREMIER déclenchement de la série en attente. Ne bouge pas
  -- pendant les reports : c'est lui qui borne l'attente totale.
  add column if not exists matching_relance_first_at  timestamptz,
  -- Combien de fois l'échéance a été repoussée. Remis à zéro à l'exécution.
  add column if not exists matching_relance_reported  integer not null default 0,
  -- Pourquoi. Écrit en clair pour qu'un run retrouvé dans six mois soit lisible
  -- sans ouvrir le code.
  add column if not exists matching_relance_reason    text,
  -- Dernière exécution RÉELLE, quelle que soit son origine.
  add column if not exists matching_last_run_at       timestamptz;

comment on column public.profiles.matching_relance_due_at is
  'Echeance de la relance en attente. Repoussee a chaque nouveau declenchement '
  'pendant la temporisation : un declenchement REPORTE, il n annule jamais. NULL '
  'quand rien n est en attente.';

comment on column public.profiles.matching_relance_reported is
  'Nombre de reports de la serie en attente. Ne bloque rien : il RENSEIGNE. Un '
  'profil reporte vingt fois signale quelqu un qui modifie sans arret, et donc '
  'une relance qui n arrive jamais.';

-- La file des relances dues. Index PARTIEL : il ne porte que les lignes en
-- attente, c'est-à-dire une poignée sur des dizaines de milliers de profils.
create index if not exists profiles_relance_due_idx
  on public.profiles (matching_relance_due_at)
  where matching_relance_due_at is not null;


-- ═══ LA PROCHAINE RELANCE À EXÉCUTER ════════════════════════════════════════
-- La PLUS ANCIENNE échéance d'abord : une relance oubliée ne doit pas être
-- doublée par une plus récente à chaque passage.
--
-- `p_attente_max` est passée par l'appelant — la règle vit dans le code. Une
-- relance dont le premier déclenchement remonte à plus longtemps que cela est
-- due, même si son échéance a été repoussée entre-temps.
create or replace function public.prochaine_relance_expert(
  p_attente_max interval default interval '6 hours'
) returns uuid
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select p.id
    from public.profiles p
   where p.matching_relance_due_at is not null
     and (
       p.matching_relance_due_at <= now()
       or coalesce(p.matching_relance_first_at, p.matching_relance_due_at) + p_attente_max <= now()
     )
   order by coalesce(p.matching_relance_first_at, p.matching_relance_due_at)
   limit 1;
$fn$;

revoke all on function public.prochaine_relance_expert(interval) from public, anon, authenticated;
grant execute on function public.prochaine_relance_expert(interval) to service_role;


-- ═══ PROGRAMMER OU REPORTER, EN UNE SEULE ÉCRITURE ══════════════════════════
-- Lire puis écrire depuis l'applicatif laisserait une fenêtre entre les deux :
-- deux modifications simultanées se marcheraient dessus, et l'une des deux
-- serait perdue — le défaut même que cette migration corrige.
--
-- Rend l'échéance retenue, pour que l'appelant puisse la journaliser.
create or replace function public.programmer_relance_expert(
  p_profile_id uuid,
  p_delai      interval,
  p_raison     text default null
) returns timestamptz
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_due timestamptz;
begin
  update public.profiles
     set matching_relance_due_at = now() + p_delai,
         -- Le PREMIER instant de la série ne bouge pas : c'est lui qui borne
         -- l'attente totale, et le report ne doit pas pouvoir le repousser.
         matching_relance_first_at = coalesce(matching_relance_first_at, now()),
         matching_relance_reported =
           case when matching_relance_due_at is null then 0
                else matching_relance_reported + 1 end,
         matching_relance_reason = coalesce(p_raison, matching_relance_reason)
   where id = p_profile_id
  returning matching_relance_due_at into v_due;

  return v_due;
end
$fn$;

revoke all on function public.programmer_relance_expert(uuid, interval, text) from public, anon, authenticated;
grant execute on function public.programmer_relance_expert(uuid, interval, text) to service_role;


-- ═══ SOLDER UNE RELANCE ═════════════════════════════════════════════════════
-- Appelée APRÈS l'exécution. Efface l'attente et enregistre l'instant réel.
--
-- ⚠️ ELLE NE SOLDE QUE CE QUI ÉTAIT DÛ. Si un nouveau déclenchement est arrivé
--    PENDANT l'exécution, son échéance est postérieure au moment où le run a
--    commencé : on ne l'efface pas, sinon cette modification-là serait perdue —
--    précisément ce que ce lot corrige.
create or replace function public.solder_relance_expert(
  p_profile_id uuid,
  p_debut_run  timestamptz
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_soldee boolean := false;
begin
  update public.profiles
     set matching_relance_due_at   = null,
         matching_relance_first_at = null,
         matching_relance_reported = 0,
         matching_relance_reason   = null,
         matching_last_run_at      = now()
   where id = p_profile_id
     and matching_relance_due_at is not null
     and matching_relance_due_at <= p_debut_run;

  if found then
    v_soldee := true;
  else
    -- Un déclenchement est arrivé pendant le run : on garde l'attente, mais on
    -- enregistre quand même que le moteur a tourné.
    update public.profiles set matching_last_run_at = now() where id = p_profile_id;
  end if;

  return v_soldee;
end
$fn$;

revoke all on function public.solder_relance_expert(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.solder_relance_expert(uuid, timestamptz) to service_role;


-- ═══ SUPERVISION — LES RELANCES QUI N'ARRIVENT JAMAIS ═══════════════════════
-- La question qui compte : y a-t-il des experts dont la relance est sans cesse
-- repoussée, et depuis combien de temps attendent-ils ?
create or replace function public.matching_relance_health()
  returns table (
    en_attente          bigint,
    dues_maintenant     bigint,
    reports_max         integer,
    attente_max_minutes numeric,
    jamais_notes        bigint
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select
    count(*) filter (where matching_relance_due_at is not null),
    count(*) filter (where matching_relance_due_at <= now()),
    coalesce(max(matching_relance_reported), 0),
    round(max(
      extract(epoch from (now() - coalesce(matching_relance_first_at, now()))) / 60
    )::numeric, 1),
    -- Un profil visible, approuvé, jamais passé par le moteur : c'est un expert
    -- qui n'existe pour personne. Le compter ici le rend visible.
    count(*) filter (
      where matching_last_run_at is null
        and visible = true
        and verification_status = 'approved'
    )
  from public.profiles;
$fn$;

revoke all on function public.matching_relance_health() from public, anon, authenticated;
grant execute on function public.matching_relance_health() to service_role;


-- ═══ LE PILOTE ═════════════════════════════════════════════════════════════
-- Il vit dans la BASE, comme les purges légales et le rattrapage des runs
-- d'annonce : aucune dépendance à un ordonnanceur d'hébergeur. UNE SEULE
-- relance par passage — la route ne suppose ainsi jamais de plafond de durée
-- d'exécution.
do $$
begin
  perform cron.unschedule('expert_relance_trigger');
exception when others then
  null;
end
$$;

select cron.schedule(
  'expert_relance_trigger',
  '*/5 * * * *',
  $job$select public.trigger_purge_cron('expert_relance_trigger', '/api/cron/expert-relance')$job$
);
