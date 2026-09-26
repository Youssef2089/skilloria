-- devoilement_ferme — constater_devoilement_ferme() : le PASSIF (fin antérieure à la mise en service)
-- pose le marqueur sans ligne ; un constat pose le marqueur ET la ligne ; le rejeu est « déjà » ;
-- une fin future est refusée.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(7);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_compte('entreprise');
  v_org    uuid := pg_temp.fab_organisation(v_admin);
  v_pub    uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_cand   uuid := pg_temp.fab_candidature(v_pub, pg_temp.fab_profil('expert'));
  v_depuis timestamptz;
  v_p0     uuid := gen_random_uuid();
  v_p1     uuid := gen_random_uuid();
  v_p2     uuid := gen_random_uuid();
begin
  perform public.devoiler_candidature(gen_random_uuid(), null, 'utilisateur', v_admin, 'client', v_cand,
                                      array['received', 'in_review', 'shortlisted'], now() + interval '15 days', false);
  select m.depuis into v_depuis from public.constats_mise_en_service m where m.constat = 'devoilement_ferme';
  return next ok(v_depuis is not null, 'la date de mise en service du constat existe');
  -- LE PASSIF : refermé AVANT la mise en service → marqueur, AUCUNE ligne.
  return next ok(public.constater_devoilement_ferme(v_p0, v_cand, v_depuis - interval '1 day') = 'passif'
                 and exists (select 1 from public.candidatures c where c.id = v_cand and c.fermeture_constatee_at is not null)
                 and pg_temp.lignes(v_p0) = 0,
                 'le passif pose le marqueur, sans ligne au grand livre');
  update public.candidatures set fermeture_constatee_at = null where id = v_cand;
  -- LE CONSTAT : refermé après la mise en service → marqueur ET ligne.
  return next is(public.constater_devoilement_ferme(v_p1, v_cand, now()), 'constate', 'le constat aboutit');
  return next is(pg_temp.lignes(v_p1), 1::bigint, 'exactement UNE ligne sous la pièce du passage');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'devoilement_ferme'
                          and g.origine = 'tache_planifiee' and g.sujet_id = v_cand and g.detail ->> 'fin_echange' is not null),
                 'la ligne porte la fin d''échange');
  return next ok(public.constater_devoilement_ferme(v_p2, v_cand, now()) = 'deja' and pg_temp.lignes(v_p2) = 0,
                 'le rejeu est « déjà », sans ligne');
  return next throws_ok(format($q$select public.constater_devoilement_ferme(%L, %L, now() + interval '1 day')$q$, gen_random_uuid(), v_cand),
                        '22023', null, 'une fin d''échange FUTURE est refusée');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
