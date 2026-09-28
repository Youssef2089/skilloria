-- LES RATTACHEMENTS DE LA PHASE B (2.2) — des routes qui écrivaient sans ligne au grand livre, rattachées à
-- une action de la liste fermée. Écrites par le TypeScript à travers journaliser() (journal après écriture,
-- §C.21) : ce test rejoue EXACTEMENT les formes des écrivains, sur des objets FABRIQUÉS par les chemins
-- normaux, pour chaque population concernée, et prouve que la base refuse ce qui n'a rien à y faire.
--   taxonomie_modifiee : l'administrateur — branche et spécialité, créée / modifiée / supprimée
--   ecosysteme_cree    : l'administrateur — l'écosystème et sa configuration
--   ecosysteme_modifie : l'administrateur — les champs, l'activation, le visuel déposé et retiré
--   organisation_modifiee : l'administrateur d'organisation — client, cabinet, ESN, et l'organisation personnelle d'un expert
--   identite_modifiee  : toutes les populations — expert freelance, CDI, client, cabinet, administrateur
--   cv_reinitialise    : expert freelance, expert CDI
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(19);

-- Une ligne telle que l'écrivain l'écrit : acteur l'administrateur (origine administrateur).
create or replace function pg_temp.ecrire(p_piece uuid, p_code text, p_admin uuid, p_dom uuid, p_sujet_type text, p_sujet uuid, p_detail jsonb)
returns void language plpgsql as $$
begin
  perform public.journaliser(p_piece, p_code, 'reussi', 'administrateur', p_admin, 'admin', p_dom,
                             p_sujet_type, p_sujet, p_detail, null::uuid, null::numeric, null::text);
end $$;

-- La fiche d'organisation, telle que l'écrivain l'écrit : acteur l'administrateur de l'organisation, AUCUN écosystème.
create or replace function pg_temp.ecrire_org(p_piece uuid, p_acteur uuid, p_type_acteur text, p_org uuid, p_detail jsonb)
returns void language plpgsql as $$
begin
  perform public.journaliser(p_piece, 'organisation_modifiee', 'reussi', 'utilisateur', p_acteur, p_type_acteur, null::uuid,
                             'organizations', p_org, p_detail, null::uuid, null::numeric, null::text);
end $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin uuid := pg_temp.fab_admin();
  v_dom   uuid := pg_temp.fab_domaine();
  v_br    uuid;
  v_sp    uuid;
  v_eco   uuid;
  v_q     uuid[] := array(select gen_random_uuid() from generate_series(1, 8));
  v_r     uuid[] := array(select gen_random_uuid() from generate_series(1, 8));
  v_o     uuid[];
  v_org   uuid[];
  v_u     uuid[];
  v_t     text[];
  v_s     uuid[] := array(select gen_random_uuid() from generate_series(1, 8));
  v_pf    uuid[];
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

  -- ── ecosysteme_cree : l'écosystème naît désactivé, avec sa configuration ──
  insert into public.domains (name, slug, active) values ('Sonde', 'sonde-' || left(md5(random()::text), 8), false)
  returning id into v_eco;
  insert into public.domain_configs (domain_id, primary_color, secondary_color) values (v_eco, '#123456', '#123456');
  perform pg_temp.ecrire(v_p[8], 'ecosysteme_cree', v_admin, v_eco, 'domains', v_eco,
    jsonb_build_object('slug', (select d.slug from public.domains d where d.id = v_eco), 'configuration_creee', true));
  return next ok(pg_temp.lignes(v_p[8]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[8]
                   and g.type_action = 'ecosysteme_cree' and g.sujet_id = v_eco and g.ecosysteme_id = v_eco
                   and (g.detail ->> 'configuration_creee')::boolean),
                 'écosystème créé : UNE ligne, qui appartient à l''écosystème qu''elle crée');
  return next ok(not exists (select 1 from public.grand_livre g where g.piece = v_p[8] and g.type_action = 'ecosysteme_modifie'),
                 'une création ne s''écrit pas sous le nom d''une modification');
  return next throws_ok(format($q$select pg_temp.ecrire(%L, 'ecosysteme_cree', %L, %L, 'domains', %L, '{"slug":"x","name":"Sonde"}'::jsonb)$q$,
                               gen_random_uuid(), v_admin, v_eco, v_eco),
                        'GL004', null, 'ecosysteme_cree : le nom (texte libre) est refusé');

  -- ── ecosysteme_modifie : les champs, l'activation, le visuel déposé puis retiré ──
  update public.domains set tagline = 'Sonde' where id = v_eco;
  perform pg_temp.ecrire(v_q[1], 'ecosysteme_modifie', v_admin, v_eco, 'domains', v_eco,
    jsonb_build_object('operation', 'modification', 'champs', jsonb_build_array('tagline'),
                       'traductions', jsonb_build_array('domains.name.en'), 'visuel', null));
  update public.domains set active = true where id = v_eco;
  perform pg_temp.ecrire(v_q[2], 'ecosysteme_modifie', v_admin, v_eco, 'domains', v_eco,
    jsonb_build_object('operation', 'activation', 'champs', jsonb_build_array('active'), 'traductions', jsonb_build_array(), 'visuel', null));
  perform pg_temp.ecrire(v_q[3], 'ecosysteme_modifie', v_admin, v_eco, 'domains', v_eco,
    jsonb_build_object('operation', 'visuel_depose', 'champs', jsonb_build_array(), 'traductions', jsonb_build_array(), 'visuel', 'logo'));
  perform pg_temp.ecrire(v_q[4], 'ecosysteme_modifie', v_admin, v_eco, 'domains', v_eco,
    jsonb_build_object('operation', 'visuel_retire', 'champs', jsonb_build_array(), 'traductions', jsonb_build_array(), 'visuel', 'logo'));
  return next ok(pg_temp.lignes(v_q[1]) = 1 and pg_temp.lignes(v_q[2]) = 1 and pg_temp.lignes(v_q[3]) = 1 and pg_temp.lignes(v_q[4]) = 1
                 and (select count(*) from public.grand_livre g where g.sujet_id = v_eco and g.type_action = 'ecosysteme_modifie') = 4,
                 'écosystème modifié : quatre gestes (champs, activation, visuel déposé, retiré), quatre lignes');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_q[2] and g.detail ->> 'operation' = 'activation')
                 and exists (select 1 from public.grand_livre g where g.piece = v_q[3] and g.detail ->> 'visuel' = 'logo'),
                 'l''activation se lit comme telle ; le visuel dit son TYPE');
  return next throws_ok(format($q$select pg_temp.ecrire(%L, 'ecosysteme_modifie', %L, %L, 'domains', %L, '{"operation":"modification","tagline":"Sonde"}'::jsonb)$q$,
                               gen_random_uuid(), v_admin, v_eco, v_eco),
                        'GL004', null, 'ecosysteme_modifie : une valeur (l''accroche) est refusée');

  -- ── organisation_modifiee : client, cabinet, ESN (champs, logo) ; l'organisation personnelle d'un expert (champs) ──
  v_o := array[pg_temp.fab_compte('entreprise'), pg_temp.fab_compte('cabinet'), pg_temp.fab_compte('cabinet'), pg_temp.fab_compte('expert')];
  v_org := array[pg_temp.fab_organisation(v_o[1]),
                 public.creer_organisation_avec_admin(v_o[2], v_dom, 'cabinet', 'Sonde Cabinet', 'FR'),
                 public.creer_organisation_avec_admin(v_o[3], v_dom, 'esn', 'Sonde ESN', 'FR'),
                 public.creer_organisation_avec_admin(p_user_id => v_o[4], p_domain_id => v_dom, p_org_type => 'freelance',
                                                      p_company_name => 'Sonde perso', p_country => 'FR', p_owner_user_id => v_o[4])];
  perform pg_temp.ecrire_org(v_r[1], v_o[1], 'client', v_org[1], '{"operation":"modification","champs":["website","city"]}'::jsonb);
  perform pg_temp.ecrire_org(v_r[2], v_o[1], 'client', v_org[1], '{"operation":"logo_depose","champs":[]}'::jsonb);
  perform pg_temp.ecrire_org(v_r[3], v_o[2], 'cabinet', v_org[2], '{"operation":"logo_retire","champs":[]}'::jsonb);
  perform pg_temp.ecrire_org(v_r[4], v_o[3], 'cabinet', v_org[3], '{"operation":"modification","champs":["description"]}'::jsonb);
  perform pg_temp.ecrire_org(v_r[5], v_o[4], 'expert_freelance', v_org[4], '{"operation":"modification","champs":["name"]}'::jsonb);
  return next ok((select count(*) from public.grand_livre g where g.piece = any (v_r[1:5]) and g.type_action = 'organisation_modifiee'
                    and g.ecosysteme_id is null and g.sujet_type = 'organizations') = 5,
                 'organisation modifiée : client (champs, logo), cabinet (logo retiré), ESN, expert (organisation personnelle) — cinq lignes, sans écosystème');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_r[1] and g.detail -> 'champs' = '["website", "city"]'::jsonb)
                 and exists (select 1 from public.grand_livre g where g.piece = v_r[5] and g.acteur_type = 'expert_freelance' and g.sujet_id = v_org[4]),
                 'les NOMS des champs ; l''expert agit sur SON organisation personnelle');
  return next throws_ok(format($q$select pg_temp.ecrire_org(%L, %L, 'client', %L, '{"operation":"modification","website":"https://exemple.invalid"}'::jsonb)$q$,
                               v_r[6], v_o[1], v_org[1]),
                        'GL004', null, 'organisation_modifiee : une valeur (le site) est refusée');

  -- ── identite_modifiee : toutes les populations, les NOMS des champs ──
  v_u := array[pg_temp.fab_compte('expert'), pg_temp.fab_compte('cdi'), pg_temp.fab_compte('entreprise'), pg_temp.fab_compte('cabinet'), v_admin];
  v_t := array['expert_freelance', 'expert_cdi', 'client', 'cabinet', 'admin'];
  for i in 1 .. 5 loop
    update public.users set first_name = 'Sonde', last_name = 'Renommee' where id = v_u[i];
    perform public.journaliser(v_s[i], 'identite_modifiee', 'reussi', case when i = 5 then 'administrateur' else 'utilisateur' end,
                               v_u[i], v_t[i], v_dom, 'users', v_u[i], '{"champs":["first_name","last_name"]}'::jsonb,
                               null::uuid, null::numeric, null::text);
  end loop;
  return next ok((select count(distinct g.acteur_type) from public.grand_livre g where g.piece = any (v_s[1:5])
                    and g.type_action = 'identite_modifiee' and g.sujet_id = g.acteur_id) = 5,
                 'identité modifiée : freelance, CDI, client, cabinet, administrateur — cinq lignes, sujet le compte lui-même');
  return next throws_ok(format($q$select public.journaliser(%L, 'identite_modifiee', 'reussi', 'utilisateur', %L, 'client', %L, 'users', %L,
                                 '{"champs":["first_name"],"first_name":"Sonde"}'::jsonb, null::uuid, null::numeric, null::text)$q$,
                               v_s[6], v_u[3], v_dom, v_u[3]),
                        'GL004', null, 'identite_modifiee : la VALEUR du prénom est refusée');

  -- ── cv_reinitialise : un freelance qui quitte la vitrine ; un CDI qui n'y était pas (la route lit `visible` AVANT) ──
  v_pf := array[pg_temp.fab_profil('expert'), pg_temp.fab_profil('cdi')];
  perform public.journaliser(v_s[7], 'cv_reinitialise', 'reussi', 'utilisateur',
                             (select p.user_id from public.profiles p where p.id = v_pf[1]), 'expert_freelance', v_dom,
                             'profiles', v_pf[1], '{"retire_de_la_vitrine":true,"avait_un_fichier":true}'::jsonb,
                             null::uuid, null::numeric, null::text);
  perform public.journaliser(v_s[8], 'cv_reinitialise', 'reussi', 'utilisateur',
                             (select p.user_id from public.profiles p where p.id = v_pf[2]), 'expert_cdi', v_dom,
                             'profiles', v_pf[2], '{"retire_de_la_vitrine":false,"avait_un_fichier":false}'::jsonb,
                             null::uuid, null::numeric, null::text);
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_s[7] and g.type_action = 'cv_reinitialise'
                           and (g.detail ->> 'retire_de_la_vitrine')::boolean and g.acteur_type = 'expert_freelance')
                 and exists (select 1 from public.grand_livre g where g.piece = v_s[8] and g.acteur_type = 'expert_cdi'
                           and not (g.detail ->> 'retire_de_la_vitrine')::boolean),
                 'CV réinitialisé : le freelance quitte la vitrine, le CDI n''y était pas — la ligne le dit');
  return next throws_ok(format($q$select public.journaliser(%L, 'cv_reinitialise', 'reussi', 'systeme', null::uuid, null::text, %L,
                                 'profiles', %L, '{"retire_de_la_vitrine":true,"title":"Sonde"}'::jsonb, null::uuid, null::numeric, null::text)$q$,
                               gen_random_uuid(), v_dom, v_pf[1]),
                        'GL004', null, 'cv_reinitialise : une valeur du profil (le titre) est refusée');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
