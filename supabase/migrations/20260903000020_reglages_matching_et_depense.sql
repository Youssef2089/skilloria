-- ─────────────────────────────────────────────────────────────────────────────
-- LES DEUX SEUILS, ET CE QUE LE MOTEUR COÛTE
--
-- ⚠️ ORDRE D'EXÉCUTION — AVANT le déploiement du code. N'ajoute que du nouveau ;
--    aucune colonne existante n'est touchée. Sans elle, le moteur ne trouve pas
--    ses réglages et refuse de tourner en le DISANT (jamais en devinant).
--
-- ═══ POURQUOI DEUX SEUILS ET PAS UN ═══════════════════════════════════════════
--   Il y en avait déjà deux, mais un seul était réglable :
--     • le premier vivait DANS LE PROMPT (« ne retourne que score >= 5 ») et
--       décidait ce qui entrait dans le flux de l'expert ;
--     • le second, `confidence_threshold`, décidait ce qui déclenchait une
--       notification.
--   Le premier n'était modifiable que par un développeur, et il était invisible.
--   Les deux sont désormais des RÉGLAGES, au même endroit, lisibles.
--
--   Ils portent un levier que personne ne veut perdre : montrer plus dans le
--   flux, notifier moins.
--
-- ═══ POURQUOI ON NE PEUT PAS LES DEVINER ══════════════════════════════════════
--   Le score d'un reranker n'est PAS calibré. Le fournisseur écrit noir sur
--   blanc qu'on ne peut pas supposer qu'un score de 0,91 vaut deux fois un score
--   de 0,44, ni comparer les scores de deux requêtes différentes. 7/10 sur
--   l'échelle de Claude ne vaut donc PAS 0,7 ici : il n'y a aucune traduction.
--
--   Les valeurs de départ sont choisies pour ne RIEN casser tant que personne
--   n'a lu la distribution réelle :
--     • feed_threshold = 0     → tout profil éligible entre dans le flux. Aucun
--                                expert n'est écarté par un nombre choisi au
--                                hasard, ce que la règle figée interdit.
--     • notify_enabled = false → personne n'est notifié. On collecte d'abord la
--                                distribution (matching_stats), puis on règle
--                                sur les faits via matching_threshold_health().
--
--   Un moteur qui notifie 12 000 personnes sur un seuil deviné est pire qu'un
--   moteur qui ne notifie pas encore.
--
-- ═══ POURQUOI UNE LIGNE PAR ÉCOSYSTÈME, ET AUCUN DÉFAUT CACHÉ ════════════════
--   Un repli codé en dur serait un SECOND réglage, invisible, qui prendrait la
--   main le jour où la ligne manque. Chaque domaine actif reçoit donc sa ligne
--   ici, et un déclencheur en crée une pour tout domaine créé ensuite. Le code
--   n'a aucune valeur de repli : ligne absente ⇒ il refuse et le dit.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ LES RÉGLAGES ═══════════════════════════════════════════════════════════
create table if not exists public.matching_settings (
  domain_id         uuid primary key references public.domains(id) on delete cascade,

  -- Ce qui ENTRE dans le flux de l'expert. 0 = tout le pool éligible.
  feed_threshold    numeric not null default 0,

  -- Ce qui DÉCLENCHE une notification. Sans effet tant que notify_enabled est
  -- faux — et il l'est jusqu'à ce que quelqu'un ait lu la distribution.
  notify_threshold  numeric not null default 1,
  notify_enabled    boolean not null default false,

  -- Modèle de reranking. Changer de modèle change l'échelle : les seuils
  -- deviennent faux, et les scores anciens ne sont plus comparables aux
  -- nouveaux. Il vit donc À CÔTÉ des seuils, pour qu'on ne change pas l'un sans
  -- voir l'autre.
  rerank_model      text not null default 'rerank-v4.0-fast',

  -- Taille des lots envoyés au reranker. Réglable sans redéploiement : c'est le
  -- levier qui compte le jour où le fournisseur change ses limites.
  rerank_batch_size integer not null default 200,

  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.users(id) on delete set null,

  constraint matching_settings_feed_range_check
    check (feed_threshold >= 0 and feed_threshold <= 1),
  constraint matching_settings_notify_range_check
    check (notify_threshold >= 0 and notify_threshold <= 1),
  -- Notifier plus large que le flux n'a aucun sens : on notifierait un expert
  -- pour une annonce qu'il ne verrait pas en se connectant.
  constraint matching_settings_ordre_check
    check (notify_threshold >= feed_threshold),
  constraint matching_settings_batch_check
    check (rerank_batch_size between 1 and 1000)
);

comment on table public.matching_settings is
  'Reglages du moteur de mise en relation, un par ecosysteme. AUCUN repli code en '
  'dur cote applicatif : une ligne absente fait REFUSER le moteur, qui le dit. Un '
  'repli invisible serait un second reglage prenant la main sans que personne le sache.';

comment on column public.matching_settings.notify_enabled is
  'Faux tant que personne n a lu la distribution reelle des scores. Le score d un '
  'reranker n est pas calibre : un seuil devine notifierait au hasard. On collecte '
  'via matching_stats, on lit via matching_threshold_health(), puis on active.';

-- Une ligne pour chaque écosystème DÉJÀ en base.
insert into public.matching_settings (domain_id)
select d.id from public.domains d
on conflict (domain_id) do nothing;

-- Et une pour chaque écosystème créé ensuite. Sans ce déclencheur, un nouveau
-- domaine aurait un moteur muet et personne ne saurait pourquoi.
create or replace function public.matching_settings_pour_nouveau_domaine()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  insert into public.matching_settings (domain_id)
  values (new.id)
  on conflict (domain_id) do nothing;
  return new;
end
$fn$;

drop trigger if exists domains_matching_settings_trg on public.domains;
create trigger domains_matching_settings_trg
  after insert on public.domains
  for each row execute function public.matching_settings_pour_nouveau_domaine();

alter table public.matching_settings enable row level security;
revoke all on table public.matching_settings from public, anon, authenticated;
grant all on table public.matching_settings to service_role;


-- ═══ CE QUE LE MOTEUR COÛTE ═════════════════════════════════════════════════
--
-- Deux fournisseurs, deux plafonds mensuels, et une règle de comportement :
-- AU PLAFOND, LA FONCTIONNALITÉ SE DÉGRADE ET LE DIT. Elle ne disparaît pas en
-- silence, et elle ne continue pas à dépenser.
--
-- On enregistre l'ÉVÉNEMENT, pas un compteur. Un compteur qu'on incrémente perd
-- l'historique au premier doute ; avec les événements, on peut toujours répondre
-- à « pourquoi ce mois-là ? » sans avoir prévu la question.
create table if not exists public.ai_spend_events (
  id           uuid primary key default gen_random_uuid(),
  -- 'rerank' | 'claude'. Volontairement du texte libre borné par une contrainte :
  -- un type enum obligerait une migration pour ajouter un fournisseur.
  provider     text not null,
  domain_id    uuid references public.domains(id) on delete set null,
  -- Unités facturées telles que le fournisseur les compte (documents notés,
  -- jetons). Conservées BRUTES : le coût se recalcule, l'unité non.
  units        integer not null default 0,
  cost_usd     numeric not null default 0,
  context      jsonb,
  created_at   timestamptz not null default now(),

  constraint ai_spend_provider_check check (provider in ('rerank', 'claude')),
  constraint ai_spend_cost_check     check (cost_usd >= 0),
  constraint ai_spend_units_check    check (units >= 0)
);

create index if not exists ai_spend_provider_mois_idx
  on public.ai_spend_events (provider, created_at desc);

alter table public.ai_spend_events enable row level security;
revoke all on table public.ai_spend_events from public, anon, authenticated;
grant all on table public.ai_spend_events to service_role;

comment on table public.ai_spend_events is
  'Journal des depenses IA, evenement par evenement. Sert au plafond mensuel : au '
  'plafond, la fonctionnalite se DEGRADE et le DIT — elle ne disparait pas en '
  'silence et ne continue pas a depenser.';


-- ═══ LES PLAFONDS ═══════════════════════════════════════════════════════════
-- Rangés en base et non dans le code : un plafond qu'il faut redéployer pour
-- relever n'est pas un plafond, c'est un incident.
create table if not exists public.ai_spend_caps (
  provider        text primary key,
  monthly_cap_usd numeric not null,
  updated_at      timestamptz not null default now(),

  constraint ai_spend_caps_provider_check check (provider in ('rerank', 'claude')),
  constraint ai_spend_caps_cap_check      check (monthly_cap_usd >= 0)
);

insert into public.ai_spend_caps (provider, monthly_cap_usd)
values ('rerank', 200), ('claude', 100)
on conflict (provider) do nothing;

alter table public.ai_spend_caps enable row level security;
revoke all on table public.ai_spend_caps from public, anon, authenticated;
grant all on table public.ai_spend_caps to service_role;


-- ═══ OÙ EN EST-ON DU PLAFOND ? ══════════════════════════════════════════════
-- Le mois est le mois CIVIL en UTC : le plafond est mensuel, il doit se remettre
-- à zéro à une date que tout le monde peut nommer.
create or replace function public.ai_spend_status()
  returns table (
    provider        text,
    monthly_cap_usd numeric,
    depense_mois    numeric,
    reste           numeric,
    part_consommee  numeric,
    au_plafond      boolean
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select
    c.provider,
    c.monthly_cap_usd,
    coalesce(d.total, 0),
    greatest(0, c.monthly_cap_usd - coalesce(d.total, 0)),
    case when c.monthly_cap_usd > 0
         then round(coalesce(d.total, 0) / c.monthly_cap_usd, 4)
         else null end,
    coalesce(d.total, 0) >= c.monthly_cap_usd
  from public.ai_spend_caps c
  left join (
    select e.provider, sum(e.cost_usd) as total
      from public.ai_spend_events e
     where e.created_at >= date_trunc('month', now() at time zone 'utc')
     group by e.provider
  ) d on d.provider = c.provider;
$fn$;

revoke all on function public.ai_spend_status() from public, anon, authenticated;
grant execute on function public.ai_spend_status() to service_role;


-- ═══ APPLIQUER LES SCORES EN UNE SEULE ÉCRITURE ═════════════════════════════
--
-- La réconciliation mettait à jour les matches UN PAR UN. Invisible à dix
-- profils, fatal à dix mille : c'est dix mille allers-retours réseau pour une
-- seule annonce, et le run n'a plus aucune chance de tenir dans un budget de
-- temps.
--
-- CE QUE CETTE FONCTION NE TOUCHE PAS, ET C'EST L'ESSENTIEL :
--   `status`. Le bug d'origine de la réconciliation était un upsert qui
--   remettait silencieusement le statut à 'pending' — un « vu » ou un « décliné »
--   effacé à chaque re-run. Cette fonction ne cite jamais la colonne : elle ne
--   peut pas la remettre à zéro, même par étourderie.
create or replace function public.appliquer_scores_de_pertinence(p_lignes jsonb)
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_touchees integer;
begin
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' then
    return 0;
  end if;

  update public.matches m
     set relevance_score = (x.relevance_score)::numeric,
         relevance_tier  = x.relevance_tier,
         relevance_model = x.relevance_model,
         relevance_scored_at = now(),
         explanation     = x.explanation
    from jsonb_to_recordset(p_lignes) as x(
           id uuid,
           relevance_score numeric,
           relevance_tier text,
           relevance_model text,
           explanation jsonb
         )
   where m.id = x.id;

  get diagnostics v_touchees = row_count;
  return v_touchees;
end
$fn$;

revoke all on function public.appliquer_scores_de_pertinence(jsonb) from public, anon, authenticated;
grant execute on function public.appliquer_scores_de_pertinence(jsonb) to service_role;
