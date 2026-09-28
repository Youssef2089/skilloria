-- LE BROUILLON — annonce_creee (client, cabinet, ESN : mission, offre) et sous_traitance_creee (collaboration
-- entre experts, freelance ET CDI, dans l'organisation PERSONNELLE). Écrites par le TypeScript
-- (app/api/publications, POST) à travers journaliser() : ce test rejoue EXACTEMENT les formes de la route, sur
-- des brouillons FABRIQUÉS par le chemin normal, et prouve que chaque type écrit SON code, une fois, et que la
-- base refuse une clé hors liste — le titre n'entre pas.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(8);

-- L'organisation personnelle d'un expert, telle que ensurePersonalOrg la crée (org_type freelance, propriétaire).
create or replace function pg_temp.org_personnelle(p_user uuid) returns uuid
language sql as $$
  select public.creer_organisation_avec_admin(p_user_id => p_user, p_domain_id => pg_temp.fab_domaine(),
                                              p_org_type => 'freelance', p_company_name => 'Sonde perso',
                                              p_country => 'FR', p_owner_user_id => p_user)
$$;

-- Le brouillon s'écrit comme la route l'écrit : acteur le compte, sujet l'annonce.
create or replace function pg_temp.creee(p_piece uuid, p_code text, p_acteur uuid, p_type_acteur text, p_pub uuid, p_detail jsonb)
returns void language plpgsql as $$
begin
  perform public.journaliser(p_piece, p_code, 'reussi', 'utilisateur', p_acteur, p_type_acteur, pg_temp.fab_domaine(),
                             'publications', p_pub, p_detail, null::uuid, null::numeric, null::text);
end $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_client  uuid := pg_temp.fab_compte('entreprise');
  v_cabinet uuid := pg_temp.fab_compte('cabinet');
  v_esn     uuid := pg_temp.fab_compte('cabinet');
  v_free    uuid := pg_temp.fab_compte('expert');
  v_cdi     uuid := pg_temp.fab_compte('cdi');
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid;
  v_pub     uuid[] := array[]::uuid[];
  v_p       uuid[] := array(select gen_random_uuid() from generate_series(1, 7));
begin
  v_o1 := pg_temp.fab_organisation(v_client);
  v_o2 := public.creer_organisation_avec_admin(v_cabinet, pg_temp.fab_domaine(), 'cabinet', 'Sonde Cabinet', 'FR');
  v_o3 := public.creer_organisation_avec_admin(v_esn, pg_temp.fab_domaine(), 'esn', 'Sonde ESN', 'FR');
  v_o4 := pg_temp.org_personnelle(v_free);
  v_o5 := pg_temp.org_personnelle(v_cdi);
  v_pub := array[pg_temp.fab_brouillon(v_o1, 'mission'), pg_temp.fab_brouillon(v_o2, 'offre'), pg_temp.fab_brouillon(v_o3, 'mission'),
                 pg_temp.fab_brouillon(v_o4, 'sous_traitance'), pg_temp.fab_brouillon(v_o5, 'sous_traitance')];

  -- ── annonce_creee : client (mission), cabinet (offre), ESN (mission) ──
  perform pg_temp.creee(v_p[1], 'annonce_creee', v_client, 'client', v_pub[1], jsonb_build_object('type', 'mission', 'organization_id', v_o1));
  return next ok(pg_temp.lignes(v_p[1]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[1]
                   and g.type_action = 'annonce_creee' and g.sujet_id = v_pub[1] and g.acteur_type = 'client' and g.detail ->> 'type' = 'mission'),
                 'client : une mission en brouillon, UNE ligne annonce_creee');
  perform pg_temp.creee(v_p[2], 'annonce_creee', v_cabinet, 'cabinet', v_pub[2], jsonb_build_object('type', 'offre', 'organization_id', v_o2));
  return next ok(pg_temp.lignes(v_p[2]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[2]
                   and g.acteur_type = 'cabinet' and g.detail ->> 'type' = 'offre' and g.detail ->> 'organization_id' = v_o2::text),
                 'cabinet : une offre en brouillon, UNE ligne');
  perform pg_temp.creee(v_p[3], 'annonce_creee', v_esn, 'cabinet', v_pub[3], jsonb_build_object('type', 'mission', 'organization_id', v_o3));
  return next ok(pg_temp.lignes(v_p[3]) = 1 and exists (select 1 from public.organizations o where o.id = v_o3 and o.org_type = 'esn'),
                 'ESN : une mission en brouillon, UNE ligne (le compte est un cabinet, l''organisation esn)');
  -- ── sous_traitance_creee : collaboration entre experts, freelance ET CDI ──
  perform pg_temp.creee(v_p[4], 'sous_traitance_creee', v_free, 'expert_freelance', v_pub[4],
                        jsonb_build_object('organization_id', v_o4, 'organisation_personnelle_creee', true));
  return next ok(pg_temp.lignes(v_p[4]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[4]
                   and g.type_action = 'sous_traitance_creee' and g.acteur_type = 'expert_freelance'
                   and (g.detail ->> 'organisation_personnelle_creee')::boolean),
                 'expert freelance : son besoin s''écrit sous SON nom, l''organisation personnelle née avec lui');
  perform pg_temp.creee(v_p[5], 'sous_traitance_creee', v_cdi, 'expert_cdi', v_pub[5],
                        jsonb_build_object('organization_id', v_o5, 'organisation_personnelle_creee', false));
  return next ok(pg_temp.lignes(v_p[5]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[5]
                   and g.acteur_type = 'expert_cdi' and not (g.detail ->> 'organisation_personnelle_creee')::boolean),
                 'expert CDI : son besoin, dans une organisation personnelle déjà là');
  return next ok(not exists (select 1 from public.grand_livre g where g.piece in (v_p[4], v_p[5]) and g.type_action = 'annonce_creee'),
                 'un besoin de sous-traitance ne s''écrit jamais sous le nom d''une annonce');
  -- ── les clés : la liste blanche de chaque face ──
  return next throws_ok(format($q$select pg_temp.creee(%L, 'annonce_creee', %L, 'client', %L, '{"type":"mission","title":"Sonde"}'::jsonb)$q$,
                               v_p[6], v_client, v_pub[1]),
                        'GL004', null, 'annonce_creee : le titre n''entre pas (clé hors liste)');
  return next throws_ok(format($q$select pg_temp.creee(%L, 'sous_traitance_creee', %L, 'expert_freelance', %L, '{"type":"sous_traitance"}'::jsonb)$q$,
                               v_p[7], v_free, v_pub[4]),
                        'GL004', null, 'sous_traitance_creee : la clé de l''autre face n''entre pas');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
