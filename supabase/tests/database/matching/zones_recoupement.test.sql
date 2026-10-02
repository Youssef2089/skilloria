-- LA PREUVE DU FILTRE DES ZONES, DANS LES DEUX SENS (lot zones de travail, 02/10/2026 — point 5).
--
--  LE FILTRE RÉEL : le moteur ne passe par aucune fonction SQL de filtre. Il demande à la base les lignes dont la liste
--  APLATIE des pays recoupe celle de l'autre côté — `.overlaps('work_zone_countries', …)` de PostgREST, soit
--  `work_zone_countries && …` en SQL :
--    · annonce → experts : lib/matching/pool.ts, `q.overlaps('work_zone_countries', annonce.work_zone_countries)` ;
--    · expert → annonces : lib/matching/run-for-expert.ts, `q.overlaps('work_zone_countries', p.work_zone_countries)`.
--  Les deux listes sont écrites par la base (`trg_*_work_zones` → `work_zone_country_codes()`), et recalculées quand le
--  référentiel change (`work_zones_couverture`, migration zones_couverture_suit_le_referentiel).
--  `diag-zones-recoupement` rougit si l'un des deux sens perd ce prédicat, ou si ce test cesse de l'employer.
--
--  LE CHEMIN NORMAL : les comptes et profils naissent par l'inscription (fabriques) ; les zones s'écrivent comme la route
--  les écrit (`update … set work_zone_ids`) ; la liste aplatie n'est JAMAIS écrite ici, elle est lue.
--
--  CHAQUE CAS ÉCHOUE SANS LE FILTRE : chaque assertion compare l'ENSEMBLE EXACT retenu parmi des candidats choisis,
--  dont au moins un TÉMOIN que seul le recoupement des zones écarte. Sans le prédicat, le témoin serait retenu et
--  l'ensemble différerait. (Éprouvé hors base par `diag-zones-recoupement`, qui rejoue chaque cas sans le filtre.)
--
--  LES PAYS : une base rejouée depuis zéro n'a AUCUN pays dans `work_zones` (les pays de `countries` arrivent par une
--  migration postérieure à celle qui les rattache — voir docs/pieges.md §E.92). Le test prend la zone du référentiel
--  quand elle existe, et sinon la CRÉE dans sa transaction annulée, sous son continent — le même geste qu'un pays
--  ajouté au référentiel.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(10);

-- Une zone PAYS sous un continent : celle du référentiel, sinon créée ici (rien ne survit au rollback).
create or replace function pg_temp.zone_pays(p_pays text, p_continent text, p_nom text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  select z.id into v from public.work_zones z where z.country_code = p_pays;
  if v is not null then return v; end if;
  insert into public.countries (code, name_fr, name_en, name_es, name_de, flag_emoji)
  values (p_pays, p_nom, p_nom, p_nom, p_nom, '🏳') on conflict (code) do nothing;
  insert into public.work_zones (parent_id, kind, code, country_code, name, slug)
  select c.id, 'country', 'C_' || p_pays, p_pays, p_nom, 'pays-' || lower(p_pays)
    from public.work_zones c where c.code = p_continent
  returning id into v;
  if v is null then raise exception 'test : le continent % est introuvable', p_continent; end if;
  return v;
end $$;

create or replace function pg_temp.zone(p_code text) returns uuid
language sql as $$ select z.id from public.work_zones z where z.code = p_code $$;

-- LE PRÉDICAT DU MOTEUR, tel quel. Sens annonce → experts (pool.ts).
create or replace function pg_temp.experts_retenus(p_annonce uuid, p_parmi uuid[]) returns uuid[]
language sql as $$
  select coalesce(array_agg(p.id order by p.id), '{}')
    from public.profiles p
   where p.id = any (p_parmi)
     and p.work_zone_countries && (select a.work_zone_countries from public.publications a where a.id = p_annonce)
$$;
-- Sens expert → annonces (run-for-expert.ts).
create or replace function pg_temp.annonces_retenues(p_profil uuid, p_parmi uuid[]) returns uuid[]
language sql as $$
  select coalesce(array_agg(a.id order by a.id), '{}')
    from public.publications a
   where a.id = any (p_parmi)
     and a.work_zone_countries && (select p.work_zone_countries from public.profiles p where p.id = p_profil)
$$;
create or replace function pg_temp.trie(p uuid[]) returns uuid[]
language sql as $$ select coalesce(array_agg(x order by x), '{}') from unnest(p) x $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_fr     uuid := pg_temp.zone_pays('FR', 'EU', 'France');
  v_ma     uuid := pg_temp.zone_pays('MA', 'AF', 'Maroc');
  v_eu     uuid := pg_temp.zone('EU');
  v_monde  uuid := pg_temp.zone('WORLD');
  -- Les experts : « Europe — tout le continent », « Maroc » seul, « France », « Partout dans le monde ».
  v_europe uuid := pg_temp.fab_profil('expert');
  v_maroc  uuid := pg_temp.fab_profil('expert');
  v_france uuid := pg_temp.fab_profil('cdi');
  v_partout uuid := pg_temp.fab_profil('expert');
  v_org    uuid := pg_temp.fab_organisation(pg_temp.fab_compte('entreprise'));
  -- Les annonces : en France, « Europe — tout le continent », au Maroc.
  a_france uuid := pg_temp.fab_brouillon(v_org, 'mission');
  a_europe uuid := pg_temp.fab_brouillon(v_org, 'mission');
  a_maroc  uuid := pg_temp.fab_brouillon(v_org, 'offre');
  v_qz     uuid;
  a_qz     uuid := pg_temp.fab_brouillon(v_org, 'mission');
  v_expert_qz uuid := pg_temp.fab_profil('expert');
begin
  -- Les zones, comme la route les écrit.
  update public.profiles set work_zone_ids = array[v_eu]    where id = v_europe;
  update public.profiles set work_zone_ids = array[v_ma]    where id = v_maroc;
  update public.profiles set work_zone_ids = array[v_fr]    where id = v_france;
  update public.profiles set work_zone_ids = array[v_monde] where id = v_partout;
  update public.publications set work_zone_ids = array[v_fr] where id = a_france;
  update public.publications set work_zone_ids = array[v_eu] where id = a_europe;
  update public.publications set work_zone_ids = array[v_ma] where id = a_maroc;

  -- ① Expert « Europe — tout le continent », annonce en France : RETENU (témoin : l'expert « Maroc »).
  return next is(pg_temp.experts_retenus(a_france, array[v_europe, v_maroc]), pg_temp.trie(array[v_europe]),
    '1. annonce en France : l''expert « Europe — tout le continent » est retenu, l''expert « Maroc » écarté');

  -- ② Expert « Maroc » seul, annonce en France : ÉCARTÉ (témoin retenu : l'expert « France »).
  return next is(pg_temp.experts_retenus(a_france, array[v_maroc, v_france]), pg_temp.trie(array[v_france]),
    '2. annonce en France : l''expert « Maroc » seul est écarté (l''expert « France » retenu)');

  -- ③ Annonce « Europe — tout le continent », expert « France » : RETENU, dans les deux sens.
  return next is(pg_temp.experts_retenus(a_europe, array[v_france, v_maroc]), pg_temp.trie(array[v_france]),
    '3a. annonce « Europe — tout le continent » → l''expert « France » est retenu, « Maroc » écarté');
  return next is(pg_temp.annonces_retenues(v_france, array[a_europe, a_maroc]), pg_temp.trie(array[a_europe]),
    '3b. expert « France » → l''annonce « Europe — tout le continent » est retenue, l''annonce au Maroc écartée');

  -- ④ UN PAYS AJOUTÉ À L'EUROPE APRÈS COUP (code réservé à l'usage privé : aucun vrai pays) — le déclencheur du
  --    référentiel recalcule ceux qui ont choisi l'Europe ou le monde, et eux seuls.
  insert into public.countries (code, name_fr, name_en, name_es, name_de, flag_emoji)
  values ('QZ', 'Sondeland', 'Sondeland', 'Sondeland', 'Sondeland', '🏳') on conflict (code) do nothing;
  insert into public.work_zones (parent_id, kind, code, country_code, name, slug)
  values (v_eu, 'country', 'C_QZ', 'QZ', 'Sondeland', 'pays-qz')
  returning id into v_qz;

  return next ok((select 'QZ' = any (p.work_zone_countries) from public.profiles p where p.id = v_europe)
                 and (select 'QZ' = any (p.work_zone_countries) from public.profiles p where p.id = v_partout)
                 and (select 'QZ' = any (a.work_zone_countries) from public.publications a where a.id = a_europe)
                 and (select not ('QZ' = any (p.work_zone_countries)) from public.profiles p where p.id = v_france),
    '4a. le pays ajouté à l''Europe est COUVERT par « Europe — tout le continent » et « Partout dans le monde » (profil et annonce), pas par « France »');

  update public.publications set work_zone_ids = array[v_qz] where id = a_qz;
  update public.profiles set work_zone_ids = array[v_qz] where id = v_expert_qz;
  return next is(pg_temp.experts_retenus(a_qz, array[v_europe, v_partout, v_france, v_maroc]), pg_temp.trie(array[v_europe, v_partout]),
    '4b. une annonce dans le pays ajouté retient « Europe — tout le continent » et « Partout dans le monde », écarte « France » et « Maroc »');
  return next is(pg_temp.annonces_retenues(v_expert_qz, array[a_europe, a_maroc, a_france]), pg_temp.trie(array[a_europe]),
    '4c. un expert du pays ajouté voit l''annonce « Europe — tout le continent », pas celles en France ni au Maroc');

  -- ⑤ Le recalcul ne touche que ce qui change : rejoué sur une couverture à jour, il ne réécrit rien.
  return next is(public.recalculer_couverture_des_zones(array[v_eu, v_monde]), '{"profils": 0, "annonces": 0}'::jsonb,
    '5. le recalcul, rejoué sur une couverture à jour, ne réécrit aucune ligne');

  -- ⑥ Le pays DÉSACTIVÉ sort de la couverture du continent (même déclencheur).
  update public.work_zones set active = false where id = v_qz;
  return next ok((select not ('QZ' = any (p.work_zone_countries)) from public.profiles p where p.id = v_europe)
                 and (select not ('QZ' = any (a.work_zone_countries)) from public.publications a where a.id = a_europe),
    '6a. un pays désactivé sort de la couverture de « Europe — tout le continent »');
  return next is(pg_temp.experts_retenus(a_qz, array[v_europe, v_partout]), '{}'::uuid[],
    '6b. une annonce dont le seul pays est désactivé ne retient plus personne');
end $$;

select * from pg_temp.essai();

select * from finish();
rollback;
