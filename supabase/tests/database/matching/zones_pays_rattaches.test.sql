-- CHAQUE PAYS DU RÉFÉRENTIEL EST RATTACHÉ À SON CONTINENT, APRÈS UNE CONSTRUCTION DEPUIS ZÉRO (lot zones de travail,
-- 02/10/2026 — §E.92) — migration `zones_pays_rattaches`, puis `zones_liste_des_pays`.
--
--  Ce test tourne sur la base que `npx supabase db reset --local` vient de construire depuis zéro : c'est EXACTEMENT le
--  cas que staging ne montrait pas (les 64 pays de `countries` arrivent après la migration d'origine qui les rattache).
--  SANS la migration, la base n'a AUCUNE zone pays : les assertions 2 à 5 échouent (et la 1 empêche qu'elles passent à
--  vide — « aucun pays sans continent » serait vrai sur une table de pays vide).
--
--  ÉTAT FINAL, DEPUIS LE LOT FINITIONS ET PAYS (02/10/2026) : la liste des zones n'est plus celle de `countries` — elle
--  porte tous les pays de l'ONU (Israël excepté) et les quatre pays du Royaume-Uni, quand `countries` garde ses 64 pays
--  pour l'adresse, l'organisation et le téléphone (Israël et le Royaume-Uni compris). Les assertions lisent donc les
--  ZONES PAYS ACTIVES, plus `countries` ; la liste exacte est prouvée par matching/zones_liste_des_pays.
--
--   1. le référentiel des pays n'est pas vide (garde : sans pays, tout le reste serait vrai pour rien) ;
--   2. chaque zone pays ACTIVE est rattachée à un CONTINENT (pas au monde, pas orpheline), actif ;
--   3. « Partout dans le monde » couvre TOUS les pays actifs — l'aplatissement réel (`work_zone_country_codes`) ;
--   4. un expert « Partout dans le monde » est couvert pour tous les pays actifs (le chemin normal : la route écrit
--      `work_zone_ids`, la base aplatit) ;
--   5. chaque zone pays active a ses traductions en, es, de (le sélecteur nomme les pays dans la langue de l'écran).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(5);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_actifs  text[];
  v_monde   uuid;
  v_profil  uuid := pg_temp.fab_profil('expert');
begin
  select coalesce(array_agg(w.country_code order by w.country_code), '{}') into v_actifs
    from public.work_zones w where w.kind = 'country' and w.active;
  select z.id into v_monde from public.work_zones z where z.code = 'WORLD';

  return next ok(cardinality(v_actifs) > 0, '1. le référentiel des pays n''est pas vide (sinon le reste serait vrai pour rien)');

  return next is(
    (select count(*) from public.work_zones w
      where w.kind = 'country' and w.active
        and not exists (select 1 from public.work_zones cont
                         where cont.id = w.parent_id and cont.kind = 'continent' and cont.active)),
    0::bigint,
    '2. chaque pays actif est rattaché à un continent');

  return next is(public.work_zone_country_codes(array[v_monde]), v_actifs,
    '3. « Partout dans le monde » couvre tous les pays actifs');

  update public.profiles set work_zone_ids = array[v_monde] where id = v_profil;
  return next is((select p.work_zone_countries from public.profiles p where p.id = v_profil), v_actifs,
    '4. un expert « Partout dans le monde » est couvert pour tous les pays actifs');

  -- Compté POSITIVEMENT (les pays actifs dont la zone a ses trois traductions) : sans la migration, zéro zone pays
  -- rendrait vrai un « aucune zone sans traduction ».
  return next is(
    (select count(*) from public.work_zones w
      where w.kind = 'country' and w.active
        and (select count(*) from public.translations t
              where t.table_name = 'work_zones' and t.row_id = w.id and t.field = 'name' and t.locale in ('en', 'es', 'de')) = 3),
    cardinality(v_actifs)::bigint,
    '5. chaque pays actif a sa zone traduite en en, es, de');
end $$;

select * from pg_temp.essai();

select * from finish();
rollback;
