-- LES RATTACHEMENTS DE LA PHASE B (2.2) — des routes qui écrivaient sans ligne au grand livre, rattachées à
-- une action de la liste fermée. Écrites par le TypeScript à travers journaliser() (journal après écriture,
-- §C.21) : ce test rejoue EXACTEMENT les formes des écrivains, sur des objets FABRIQUÉS par les chemins
-- normaux, pour chaque population concernée, et prouve que la base refuse ce qui n'a rien à y faire.
--   taxonomie_modifiee : l'administrateur — branche et spécialité, créée / modifiée / supprimée
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(6);

-- Une ligne telle que l'écrivain l'écrit : acteur l'administrateur (origine administrateur).
create or replace function pg_temp.ecrire(p_piece uuid, p_code text, p_admin uuid, p_dom uuid, p_sujet_type text, p_sujet uuid, p_detail jsonb)
returns void language plpgsql as $$
begin
  perform public.journaliser(p_piece, p_code, 'reussi', 'administrateur', p_admin, 'admin', p_dom,
                             p_sujet_type, p_sujet, p_detail, null::uuid, null::numeric, null::text);
end $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin uuid := pg_temp.fab_admin();
  v_dom   uuid := pg_temp.fab_domaine();
  v_br    uuid;
  v_sp    uuid;
  v_p     uuid[] := array(select gen_random_uuid() from generate_series(1, 8));
begin
  -- ── taxonomie_modifiee : une branche, puis une spécialité, créées comme les routes les créent ──
  insert into public.branches (domain_id, name, slug) values (v_dom, 'Sonde', 'sonde-' || left(md5(random()::text), 8))
  returning id into v_br;
  perform pg_temp.ecrire(v_p[1], 'taxonomie_modifiee', v_admin, v_dom, 'branches', v_br,
    jsonb_build_object('objet', 'branche', 'operation', 'creee', 'branch_id', null,
                       'champs', jsonb_build_array('name', 'slug', 'active', 'sort_order'), 'traductions', jsonb_build_array('en', 'de')));
  return next ok(pg_temp.lignes(v_p[1]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[1]
                   and g.type_action = 'taxonomie_modifiee' and g.sujet_type = 'branches' and g.sujet_id = v_br
                   and g.ecosysteme_id = v_dom and g.detail ->> 'operation' = 'creee' and g.acteur_type = 'admin'),
                 'branche créée : UNE ligne, sujet la branche, dans SON écosystème');
  insert into public.specialities (branch_id, domain_id, name, slug) values (v_br, v_dom, 'Sonde', 'sonde-' || left(md5(random()::text), 8))
  returning id into v_sp;
  perform pg_temp.ecrire(v_p[2], 'taxonomie_modifiee', v_admin, v_dom, 'specialities', v_sp,
    jsonb_build_object('objet', 'specialite', 'operation', 'creee', 'branch_id', v_br,
                       'champs', jsonb_build_array('name', 'slug', 'active', 'sort_order'), 'traductions', jsonb_build_array()));
  update public.specialities set active = false where id = v_sp;
  perform pg_temp.ecrire(v_p[3], 'taxonomie_modifiee', v_admin, v_dom, 'specialities', v_sp,
    jsonb_build_object('objet', 'specialite', 'operation', 'modifiee', 'branch_id', v_br,
                       'champs', jsonb_build_array('active'), 'traductions', jsonb_build_array('es')));
  delete from public.specialities where id = v_sp;
  perform pg_temp.ecrire(v_p[4], 'taxonomie_modifiee', v_admin, v_dom, 'specialities', v_sp,
    jsonb_build_object('objet', 'specialite', 'operation', 'supprimee', 'branch_id', v_br, 'champs', jsonb_build_array(), 'traductions', jsonb_build_array()));
  return next ok(pg_temp.lignes(v_p[2]) = 1 and pg_temp.lignes(v_p[3]) = 1 and pg_temp.lignes(v_p[4]) = 1
                 and (select count(*) from public.grand_livre g where g.sujet_id = v_sp and g.type_action = 'taxonomie_modifiee') = 3,
                 'spécialité créée, modifiée, supprimée : trois gestes, trois pièces, trois lignes sur le même sujet');
  update public.branches set sort_order = 9 where id = v_br;
  perform pg_temp.ecrire(v_p[5], 'taxonomie_modifiee', v_admin, v_dom, 'branches', v_br,
    jsonb_build_object('objet', 'branche', 'operation', 'modifiee', 'branch_id', null, 'champs', jsonb_build_array('sort_order'), 'traductions', jsonb_build_array()));
  delete from public.branches where id = v_br;
  perform pg_temp.ecrire(v_p[6], 'taxonomie_modifiee', v_admin, v_dom, 'branches', v_br,
    jsonb_build_object('objet', 'branche', 'operation', 'supprimee', 'branch_id', null, 'champs', jsonb_build_array(), 'traductions', jsonb_build_array()));
  return next ok((select count(*) from public.grand_livre g where g.sujet_id = v_br and g.type_action = 'taxonomie_modifiee') = 3
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[6] and g.detail ->> 'operation' = 'supprimee'),
                 'branche modifiée puis supprimée : la trace survit à l''objet');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p[3] and g.detail -> 'champs' = '["active"]'::jsonb
                           and g.detail -> 'traductions' = '["es"]'::jsonb),
                 'les NOMS des champs et les LANGUES — pas les valeurs');
  -- ── le libellé n'entre pas ──
  return next throws_ok(format($q$select pg_temp.ecrire(%L, 'taxonomie_modifiee', %L, %L, 'branches', %L, '{"objet":"branche","operation":"creee","name":"Sonde"}'::jsonb)$q$,
                               v_p[7], v_admin, v_dom, v_br),
                        'GL004', null, 'taxonomie_modifiee : un libellé (texte libre) est refusé');
  return next throws_ok(format($q$select pg_temp.ecrire(%L, 'taxonomie_modifiee', %L, %L, 'branches', %L, '{"objet":"branche","operation":"creee"}'::jsonb)$q$,
                               v_p[1], v_admin, v_dom, v_br),
                        'GL005', null, 'taxonomie_modifiee : une fois par geste');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
