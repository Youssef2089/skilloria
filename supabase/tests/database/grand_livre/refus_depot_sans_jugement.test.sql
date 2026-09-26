-- refus_depot_sans_jugement — solder_depot_en_echec() : le journal du dépôt soldé en échec et le refus,
-- ensemble ; une cause hors de la liste fermée est refusée par la base.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(5);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_compte('entreprise');
  v_org    uuid := pg_temp.fab_organisation(v_admin);
  v_pub    uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_profil uuid := pg_temp.fab_profil('expert');
  v_p1     uuid := gen_random_uuid();
begin
  perform public.ouvrir_depot_candidature(v_pub, v_profil, pg_temp.fab_domaine(), 'sonde', v_p1);
  return next ok(public.solder_depot_en_echec(v_p1, null, 'systeme', null, null, v_pub, v_profil, 'plafond', 'panne simulee'),
                 'le solde en échec aboutit');
  return next ok(exists (select 1 from public.candidature_depots d where d.publication_id = v_pub and d.profile_id = v_profil
                          and d.etat = 'echec' and d.cause = 'plafond'),
                 'le journal du dépôt est en échec, avec sa cause fermée');
  return next is(pg_temp.lignes(v_p1), 1::bigint, 'exactement UNE ligne sous la pièce');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'refus_depot_sans_jugement'
                          and g.statut = 'refuse' and g.detail ->> 'cause' = 'plafond'),
                 'le refus est écrit au statut imposé, avec la cause');
  -- LE REFUS : une cause hors de la liste fermée — la contrainte du dépôt la refuse (23514).
  return next throws_ok(format($q$select public.solder_depot_en_echec(%L, null, 'systeme', null, null, %L, %L, 'autre_cause', 'x')$q$,
                               gen_random_uuid(), v_pub, v_profil),
                        '23514', null, 'une cause hors de la liste fermée est refusée par la base');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
