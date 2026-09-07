-- PLAFOND HORAIRE DE PROGRAMMATION DES RELANCES (lot 7, point 2.4)
--
-- ═══ CE QUE CE PLAFOND EST, ET CE QU'IL N'EST PAS ═════════════════════════
--   Au lot 6, deux garde-fous de debit ont ete retires de sync-matching : ils
--   REFUSAIENT, et un refus PERDAIT le declenchement. La temporisation les a
--   remplaces — on repousse au lieu de refuser, plus rien n'est perdu.
--
--   Ce qui reste ici n'est pas un garde-fou de COUT : la temporisation borne
--   deja le cout, une rafale ne produit qu'un seul run. C'est un garde
--   d'ECRITURE. Programmer une relance ECRIT sur `profiles`, et rien ne bornait
--   le nombre d'ecritures qu'un client pouvait declencher a la seconde.
--
--   Le seuil (20/heure/expert) vit dans le CODE, en constante nommee. Il n'a
--   volontairement AUCUN champ dans /admin/matching : un seuil anti-abus n'est
--   pas un reglage commercial, et le rendre reglable invite a le desactiver le
--   jour ou il gene.
--
-- ═══ EN ECHANGE, LES DEPASSEMENTS SE VOIENT ═══════════════════════════════
--   Un plafond qu'on ne peut pas observer est un plafond qu'on decouvre par un
--   ticket. `rate_limit_check` n'enregistre PAS les hits refuses (c'est son
--   contrat : « refuse -> ne pas enregistrer »), donc les depassements ne sont
--   derivables de nulle part. On les compte ici, et l'ecran /admin/matching les
--   affiche a cote du compteur de pannes de redaction.
--
--   Ce n'est ni une file d'attente ni un rejeu : on compte, et c'est tout.

create table if not exists public.relance_overruns (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  domain_id   uuid        references public.domains(id) on delete set null,
  origine     text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists relance_overruns_recents
  on public.relance_overruns (created_at desc);

-- RLS active sans policy : seul le service-role (qui bypasse RLS) y accede.
-- Meme regime que rate_limit_hits.
alter table public.relance_overruns enable row level security;

-- Sante : combien de depassements, par origine, sur une fenetre.
-- JAMAIS additionnes en un seul nombre : « profil modifie » et « ouverture
-- croisee » ne racontent pas la meme histoire, et n'appellent pas la meme
-- action. Meme regle que redaction_failure_health.
create or replace function public.relance_overrun_health(p_interval interval default interval '30 days')
returns table (origine text, depassements bigint, experts bigint)
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  select o.origine,
         count(*)                     as depassements,
         count(distinct o.profile_id) as experts
    from public.relance_overruns o
   where o.created_at >= now() - p_interval
   group by o.origine
   order by count(*) desc;
$$;

revoke all on function public.relance_overrun_health(interval) from public, anon, authenticated;
grant execute on function public.relance_overrun_health(interval) to service_role;
