-- Lot 1 moteur commerce — COMPTEURS d'usage (couche Compteurs).
--
-- Materialise la consommation par organisation et par periode : package_features
-- declare une limite + un reset_period, mais rien ne comptait la conso reelle.
-- Modele calque sur 20260708000005_rate_limiter.sql : table accessible au seul
-- service-role (RLS activee, AUCUNE policy => les clients ne lisent/ecrivent
-- jamais directement), mutation via fonction atomique SECURITY DEFINER.
--
-- period_start : 1er jour de la periode courante (mois civil) pour les compteurs
-- a reset ('monthly'...), ou '1970-01-01' (epoch) pour les compteurs 'never'.
-- Le CALCUL de period_start et le choix de la limite vivent dans la couche
-- Droits (Lot 2) ; ici on ne fait que stocker et incrementer atomiquement.

create table if not exists public.usage_counters (
  organization_id uuid    not null,
  counter_key     text    not null,   -- ex. 'publications', 'manual_unlocks'
  period_start    date    not null,   -- 1er jour de la periode ; '1970-01-01' si never
  used            integer not null default 0,
  primary key (organization_id, counter_key, period_start)
);

-- RLS activee sans policy : seul le service-role (qui bypass RLS) accede a la table.
alter table public.usage_counters enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- usage_increment : consomme atomiquement 1 unite du compteur, sous garde de limite.
--   Retourne true si consomme (AUTORISE), false si limite atteinte (REFUSE).
--   p_limit NULL = illimite : incremente toujours et retourne true (on garde la
--   trace de conso meme sans plafond).
--
-- Atomicite : un SEUL statement INSERT ... ON CONFLICT DO UPDATE. Le lock de
-- ligne pose par ON CONFLICT serialise les appels concurrents sur la meme cle ;
-- aucun SELECT-puis-UPDATE separe (pas de race). La garde WHERE ne s'applique
-- qu'au chemin UPDATE : le chemin INSERT (premiere conso de la periode) pose
-- used=1, ce qui est licite des lors que p_limit >= 1 — d'ou le court-circuit
-- prealable sur p_limit <= 0.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.usage_increment(
  p_org uuid,
  p_key text,
  p_period date,
  p_limit integer
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $$
begin
  -- Limite explicite a 0 (ou moins) : aucune conso possible, refuse sans ecrire.
  if p_limit is not null and p_limit <= 0 then
    return false;
  end if;

  insert into public.usage_counters as uc (organization_id, counter_key, period_start, used)
  values (p_org, p_key, p_period, 1)
  on conflict (organization_id, counter_key, period_start) do update
    set used = uc.used + 1
    where p_limit is null or uc.used < p_limit;

  -- FOUND = true si une ligne a ete inseree OU mise a jour ; false si la garde
  -- ON CONFLICT a bloque l'increment (limite deja atteinte).
  return found;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- usage_peek : lecture seule de la conso courante (UI "2/2 utilisees").
--   Retourne 0 si le compteur n'existe pas encore.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.usage_peek(
  p_org uuid,
  p_key text,
  p_period date
) returns integer
  language sql
  security definer
  set search_path to 'public'
  stable
as $$
  select coalesce(
    (select used from public.usage_counters
      where organization_id = p_org
        and counter_key = p_key
        and period_start = p_period),
    0);
$$;

-- Acces service-role uniquement (jamais expose au client).
revoke all on function public.usage_increment(uuid, text, date, integer) from public, anon, authenticated;
grant execute on function public.usage_increment(uuid, text, date, integer) to service_role;

revoke all on function public.usage_peek(uuid, text, date) from public, anon, authenticated;
grant execute on function public.usage_peek(uuid, text, date) to service_role;
