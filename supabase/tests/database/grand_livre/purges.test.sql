-- compte_purge_inactivite / _demande / _admin / inactivite_avertie — anonymiser_compte() : le jalon,
-- l'anonymisation et la ligne, ensemble, le code dérivé du motif ; déjà purgé → rien ; motif inconnu refusé.
-- constater_avertissement_inactivite() : parti → marqueur ET ligne ; pas parti → ligne échouée, sans marqueur.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(10);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin uuid := pg_temp.fab_admin();
  v_a     uuid := pg_temp.fab_compte('expert');
  v_b     uuid := pg_temp.fab_compte('cdi');
  v_c     uuid := pg_temp.fab_compte('entreprise');
  v_u     uuid := pg_temp.fab_compte('expert');
  v_email text;
  v_p     uuid[] := array(select gen_random_uuid() from generate_series(1, 7));
begin
  select u.email into v_email from public.users u where u.id = v_a;
  return next ok(public.anonymiser_compte(v_p[1], null, 'tache_planifiee', null, null, v_a, 'purge+' || v_a || '@deleted.invalid',
                                          'inactivite', true, null, true, 2)
                 and exists (select 1 from public.users u where u.id = v_a and u.anonymized_at is not null and u.status = 'archived'
                              and u.first_name is null and u.email = 'purge+' || v_a || '@deleted.invalid'),
                 'inactivité : le compte est anonymisé, le jalon posé');
  return next ok(pg_temp.lignes(v_p[1]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[1]
                  and g.type_action = 'compte_purge_inactivite' and g.detail::text not like '%' || v_email || '%'),
                 'inactivité : UNE ligne compte_purge_inactivite, sans l''ancienne adresse');
  return next ok(not public.anonymiser_compte(v_p[2], null, 'tache_planifiee', null, null, v_a, 'autre+' || v_a || '@deleted.invalid',
                                              'inactivite', true, null, true, 0)
                 and pg_temp.lignes(v_p[2]) = 0,
                 'un compte déjà purgé ne produit rien');
  perform public.anonymiser_compte(v_p[3], null, 'tache_planifiee', null, null, v_b, 'purge+' || v_b || '@deleted.invalid', 'demande', false, null, true, 0);
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p[3] and g.type_action = 'compte_purge_demande'),
                 'demande : la purge s''écrit compte_purge_demande');
  perform public.anonymiser_compte(v_p[4], null, 'administrateur', v_admin, 'admin', v_c, 'purge+' || v_c || '@deleted.invalid', 'admin', false, null, true, 0);
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p[4] and g.type_action = 'compte_purge_admin' and g.acteur_id = v_admin),
                 'administrateur : la purge s''écrit compte_purge_admin, avec son auteur');
  return next throws_ok(format($q$select public.anonymiser_compte(%L, null, 'tache_planifiee', null, null, %L, 'x@deleted.invalid', 'autre', true, null, true, 0)$q$,
                               gen_random_uuid(), v_u),
                        '22023', null, 'un motif inconnu est refusé AVANT d''écrire');
  -- L'AVERTISSEMENT D'INACTIVITÉ : les deux issues.
  return next ok(public.constater_avertissement_inactivite(v_p[5], null, 'tache_planifiee', null, null, v_u, now() + interval '30 days', false, null, 'resend_refuse')
                 and exists (select 1 from public.users u where u.id = v_u and u.inactivity_warning_sent_at is null)
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[5] and g.type_action = 'inactivite_avertie'
                              and g.statut = 'echoue' and g.detail ->> 'cause' = 'resend_refuse'),
                 'avertissement non parti : ligne échouée avec sa cause, AUCUN marqueur');
  return next ok(public.constater_avertissement_inactivite(v_p[6], null, 'tache_planifiee', null, null, v_u, now() + interval '30 days', true, 'msg_sonde', null)
                 and exists (select 1 from public.users u where u.id = v_u and u.inactivity_warning_sent_at is not null)
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[6] and g.type_action = 'inactivite_avertie' and g.statut = 'reussi'),
                 'avertissement parti : le marqueur ET la ligne réussie');
  return next is(pg_temp.lignes(v_p[6]), 1::bigint, 'exactement UNE ligne sous la pièce de l''avertissement');
  return next throws_ok(format($q$select public.constater_avertissement_inactivite(%L, null, 'tache_planifiee', null, null, %L, now(), false, null, null)$q$,
                               v_p[7], v_u),
                        '22023', null, 'un échec sans cause est refusé');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
