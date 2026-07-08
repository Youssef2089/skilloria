-- Limiteur de debit generique, atomique, stocke en DB. Reutilisable (M1 OTP, M2 matching...).
-- La cle est hachee par l'appelant (jamais de donnee personnelle en clair ici).
-- RLS activee sans policy : seul le service-role (qui bypass RLS) accede a cette table.

-- pg_cron : necessaire a la purge planifiee ci-dessous. Idempotent.
create extension if not exists pg_cron;

create table if not exists public.rate_limit_hits (
  bucket      text        not null,
  key_hash    text        not null,
  hit_at      timestamptz not null default now()
);

create index if not exists rate_limit_hits_lookup
  on public.rate_limit_hits (bucket, key_hash, hit_at);

alter table public.rate_limit_hits enable row level security;

-- Verifie ET enregistre atomiquement une tentative.
-- Retourne true si AUTORISE (sous la limite), false si REFUSE (limite atteinte).
-- p_window_seconds : fenetre glissante. p_max : nb max d'evenements dans la fenetre.
create or replace function public.rate_limit_check(
  p_bucket text,
  p_key_hash text,
  p_window_seconds integer,
  p_max integer
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_count integer;
begin
  -- purge opportuniste des vieux hits de ce bucket/cle (borne la table)
  delete from public.rate_limit_hits
    where bucket = p_bucket and key_hash = p_key_hash
      and hit_at < now() - make_interval(secs => p_window_seconds);

  select count(*) into v_count
    from public.rate_limit_hits
    where bucket = p_bucket and key_hash = p_key_hash
      and hit_at >= now() - make_interval(secs => p_window_seconds);

  if v_count >= p_max then
    return false;  -- refuse : ne PAS enregistrer ce hit
  end if;

  insert into public.rate_limit_hits (bucket, key_hash) values (p_bucket, p_key_hash);
  return true;     -- autorise
end;
$$;

revoke all on function public.rate_limit_check(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.rate_limit_check(text,text,integer,integer) to service_role;

-- Purge globale quotidienne : filet de securite pour les cles jamais re-sollicitees
-- (la purge dans la fonction ne nettoie que les cles reactivees). Tout hit de plus
-- de 24h est efface (fenetre max utilisee = 1h, marge tres large). Idempotent via unschedule prealable.
do $$
begin
  perform cron.unschedule('rate_limit_hits_purge');
exception when others then
  null; -- le job n'existait pas encore : ignore
end
$$;

select cron.schedule(
  'rate_limit_hits_purge',
  '0 4 * * *',
  $$delete from public.rate_limit_hits where hit_at < now() - interval '24 hours'$$
);
