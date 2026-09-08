-- LA REPRISE D'UN RUN DE NOTATION — CE QUI EST NOTE NE SE RENOTE PAS
--
-- ═══ LE MUR QU'ON SUPPRIME ════════════════════════════════════════════════
--   La notation etait strictement sequentielle et la fonction est tuee a 60 s.
--   A l'echelle promise — aucun plafond de vivier, donc potentiellement des
--   milliers de profils — le run n'a pas le temps de finir. Il reste marque
--   INACHEVE, donc rejouable, ce qui etait le bon choix… sauf qu'il REPARTAIT
--   DE ZERO : les lots deja payes etaient repayes, a chaque tentative, jusqu'a
--   l'abandon silencieux au bout de cinq.
--
--   Paralleliser repousse le mur. Seule la reprise le supprime.
--
-- ═══ CE QUE CETTE TABLE EST, ET N'EST PAS ═════════════════════════════════
--   Un BROUILLON de run, rien d'autre. Elle ne remplace pas `matches` : la
--   reconciliation reste le seul endroit qui decide ce qui existe, ce qui est
--   notifie et ce qui est preserve. Ici on ne garde que « ce profil a deja ete
--   note, a telle valeur, par tel modele », pour ne pas le repayer.
--
--   Elle est donc EPHEMERE : soldee des que le run s'acheve, et purgee si un
--   run n'a jamais abouti. Une trace de travail qui survit a son travail
--   finirait par etre relue comme une source de verite.
--
-- ═══ POURQUOI UNE TABLE ET PAS LA MEMOIRE ═════════════════════════════════
--   Le couperet tue le processus : tout ce qui n'est pas ecrit est perdu. La
--   reprise doit donc survivre a la mort de la fonction, ce qu'aucune variable
--   ne fait.

create table if not exists public.matching_notes_partielles (
  publication_id uuid        not null references public.publications(id) on delete cascade,
  profile_id     uuid        not null references public.profiles(id) on delete cascade,
  score          real        not null,
  model          text        not null,
  created_at     timestamptz not null default now(),
  primary key (publication_id, profile_id)
);

-- La purge et la reprise lisent toutes deux par run.
create index if not exists matching_notes_partielles_age_idx
  on public.matching_notes_partielles (created_at);

-- RLS active sans policy : seul le service-role (qui bypasse RLS) y accede.
-- Meme regime que rate_limit_hits et relance_overruns.
alter table public.matching_notes_partielles enable row level security;

-- ═══ PURGE DES BROUILLONS ORPHELINS ═════════════════════════════════════════
-- Un run abandonne laisse ses notes partielles derriere lui. Sans purge, la
-- table grossit indefiniment et, pire, un run relance des semaines plus tard
-- reprendrait des notes calculees sur un profil qui a change depuis.
--
-- VINGT-QUATRE HEURES : tres au-dela de la duree d'un run (secondes) et de son
-- rattrapage (quelques heures), tres en deca du delai ou une note deviendrait
-- douteuse. Une note plus vieille que cela vaut mieux d'etre recalculee.
create or replace function public.purger_notes_partielles(p_age interval default interval '24 hours')
returns bigint
  language sql
  security definer
  set search_path to 'public'
as $fn$
  with supprimees as (
    delete from public.matching_notes_partielles
     where created_at < now() - p_age
    returning 1
  )
  select count(*) from supprimees;
$fn$;

revoke all on function public.purger_notes_partielles(interval) from public, anon, authenticated;
grant execute on function public.purger_notes_partielles(interval) to service_role;

do $$
begin
  perform cron.unschedule('matching_notes_partielles_purge');
exception when others then
  null; -- le job n'existait pas encore : ignore
end
$$;

select cron.schedule(
  'matching_notes_partielles_purge',
  '30 4 * * *',
  $$select public.purger_notes_partielles()$$
);

-- ═══ LES RUNS ABANDONNES DOIVENT SE VOIR ════════════════════════════════════
-- G1 — Au-dela du plafond de tentatives, `next_unfinished_matching_run` cesse
-- de rendre l'annonce : elle n'est plus rejouee, et RIEN ne le dit. Un run
-- abandonne en silence est un ecran vide sans explication, cote expert comme
-- cote organisation.
--
-- On ne change pas la regle de rejeu — on la rend LISIBLE. Trois etats
-- distincts, jamais additionnes : ils n'appellent pas la meme action.
--   en_cours   : tente, pas encore acheve, sous le plafond -> il sera rejoue
--   abandonne  : tente, pas acheve, au plafond            -> intervention
--   jamais_tente : publie et jamais tente                 -> pilote en panne
create or replace function public.matching_runs_inacheves(
  p_max_attempts integer default 5
) returns table (
  etat        text,
  publications bigint,
  plus_ancien timestamptz
)
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select etat, count(*) as publications, min(depuis) as plus_ancien
    from (
      select case
               when p.matching_attempted_at is null then 'jamais_tente'
               when p.matching_attempts >= p_max_attempts then 'abandonne'
               else 'en_cours'
             end as etat,
             coalesce(p.matching_attempted_at, p.published_at) as depuis
        from public.publications p
       where p.status = 'published'
         and p.matching_completed_at is null
    ) q
   group by etat
   order by count(*) desc;
$fn$;

revoke all on function public.matching_runs_inacheves(integer) from public, anon, authenticated;
grant execute on function public.matching_runs_inacheves(integer) to service_role;
