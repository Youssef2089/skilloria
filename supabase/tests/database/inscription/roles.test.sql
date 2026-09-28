-- L'INSCRIPTION, UN TEST PAR RÔLE — par le VRAI chemin : une ligne dans auth.users, le trigger
-- on_auth_user_created → handle_new_user. Les rôles tels que le code les envoie :
--   expert freelance · expert CDI   (register-expert : 'expert' | 'cdi')
--   client · cabinet · ESN          (register-org : 'entreprise' | 'cabinet', l'ESN s'inscrit 'cabinet'
--                                    et son organisation porte org_type = 'esn')
-- Chacun dans son écosystème RÉEL (lu en base), et ce que l'inscription doit créer : le miroir
-- public.users, le profil pour un expert (sa spécialité dans speciality_ids), rien de plus pour une
-- organisation. Puis les refus : chacun lève son code, et AUCUN compte n'en reste — ni auth, ni miroir.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(21);

-- L'inscription telle que GoTrue l'écrit : auth.users, métadonnées dans raw_user_meta_data.
create or replace function pg_temp.inscrire(p_id uuid, p_meta jsonb) returns void
language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
          'sonde+' || p_id || '@exemple.invalid', '', null, '{}'::jsonb,
          p_meta || '{"firstname":"Sonde","lastname":"Essai"}'::jsonb, now(), now())
$$;

-- Rien n'existe pour cet identifiant, ni côté auth ni côté produit.
create or replace function pg_temp.rien(p_id uuid) returns boolean
language sql as $$
  select not exists (select 1 from auth.users a where a.id = p_id)
     and not exists (select 1 from public.users u where u.id = p_id)
     and not exists (select 1 from public.profiles p where p.user_id = p_id)
$$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_dom     uuid := pg_temp.fab_domaine();
  v_slug    text;
  v_gratuit uuid;
  v_branche uuid;
  v_spec    uuid;
  v_autre_b uuid;
  v_ids     uuid[] := array(select gen_random_uuid() from generate_series(1, 11));
  v_org     uuid;
begin
  select d.slug into v_slug from public.domains d where d.id = v_dom;
  select r.id into v_gratuit from public.roles r where r.name = 'Gratuit' and r.active;
  select s.branch_id, s.id into v_branche, v_spec
    from public.specialities s join public.branches b on b.id = s.branch_id
   where s.domain_id = v_dom and s.active and b.active and b.domain_id = v_dom order by s.slug limit 1;
  select b.id into v_autre_b from public.branches b
   where b.domain_id = v_dom and b.active and b.id <> v_branche order by b.slug limit 1;

  -- ── expert freelance ──
  perform pg_temp.inscrire(v_ids[1], jsonb_build_object('role', 'expert', 'domain_slug', v_slug,
            'branch_id', v_branche, 'speciality_id', v_spec, 'speciality_other', '', 'specialty', ''));
  return next ok(exists (select 1 from public.users u where u.id = v_ids[1] and u.user_type = 'expert_freelance'
                          and u.domain_id = v_dom and u.role_id = v_gratuit and u.status = 'draft' and u.locale = 'fr'
                          and u.first_name = 'Sonde' and u.email = 'sonde+' || v_ids[1] || '@exemple.invalid'),
                 'expert freelance : le miroir, dans son écosystème, rôle Gratuit, brouillon');
  return next ok(exists (select 1 from public.profiles p where p.user_id = v_ids[1] and p.expert_type = 'freelance'
                          and p.domain_id = v_dom and p.branch_id = v_branche and p.speciality_ids = array[v_spec]
                          and p.speciality_other is null and not p.visible),
                 'expert freelance : le profil porte sa branche et sa spécialité dans speciality_ids, invisible');
  -- ── expert CDI ──
  perform pg_temp.inscrire(v_ids[2], jsonb_build_object('role', 'cdi', 'domain_slug', v_slug,
            'branch_id', v_branche, 'speciality_id', v_spec));
  return next ok(exists (select 1 from public.users u where u.id = v_ids[2] and u.user_type = 'expert_cdi' and u.domain_id = v_dom),
                 'expert CDI : le miroir, dans son écosystème');
  return next ok(exists (select 1 from public.profiles p where p.user_id = v_ids[2] and p.expert_type = 'cdi'
                          and p.speciality_ids = array[v_spec] and p.domain_id = v_dom),
                 'expert CDI : le profil porte sa spécialité');
  -- ── expert, spécialité « Autre » ──
  perform pg_temp.inscrire(v_ids[3], jsonb_build_object('role', 'expert', 'domain_slug', v_slug,
            'branch_id', v_branche, 'speciality_id', '', 'speciality_other', 'Sonde hors référentiel'));
  return next ok(exists (select 1 from public.profiles p where p.user_id = v_ids[3] and p.speciality_ids = '{}'::uuid[]
                          and p.speciality_other = 'Sonde hors référentiel'),
                 'expert « Autre » : aucune spécialité au référentiel, la précision libre est gardée');
  -- ── client ──
  perform pg_temp.inscrire(v_ids[4], jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug));
  return next ok(exists (select 1 from public.users u where u.id = v_ids[4] and u.user_type = 'client' and u.domain_id = v_dom)
                 and not exists (select 1 from public.profiles p where p.user_id = v_ids[4]),
                 'client : le miroir, dans son écosystème, sans profil d''expert');
  -- ── cabinet ──
  perform pg_temp.inscrire(v_ids[5], jsonb_build_object('role', 'cabinet', 'domain_slug', v_slug));
  return next ok(exists (select 1 from public.users u where u.id = v_ids[5] and u.user_type = 'cabinet' and u.domain_id = v_dom)
                 and not exists (select 1 from public.profiles p where p.user_id = v_ids[5]),
                 'cabinet : le miroir, dans son écosystème, sans profil d''expert');
  -- ── ESN : 'cabinet' au trigger, puis l'organisation 'esn' avec son siège (register-org) ──
  perform pg_temp.inscrire(v_ids[6], jsonb_build_object('role', 'cabinet', 'domain_slug', v_slug));
  v_org := public.creer_organisation_avec_admin(v_ids[6], v_dom, 'esn', 'Sonde ESN', 'FR');
  return next ok(exists (select 1 from public.users u where u.id = v_ids[6] and u.user_type = 'cabinet' and u.domain_id = v_dom),
                 'ESN : le miroir est un cabinet, dans son écosystème');
  return next ok(exists (select 1 from public.organizations o where o.id = v_org and o.org_type = 'esn' and o.siege_admin_membre_id is not null)
                 and exists (select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = v_ids[6]
                              and m.role_in_org = 'admin' and m.status = 'active'),
                 'ESN : l''organisation esn naît avec son administrateur actif et son siège');
  -- ── une seule ligne par compte ──
  return next is((select count(*) from public.users u where u.id = any (v_ids[1:6])), 6::bigint, 'six inscriptions, six miroirs');
  return next is((select count(*) from public.profiles p where p.user_id = any (v_ids[1:6])), 3::bigint, 'trois experts, trois profils — aucun pour les organisations');

  -- ── LES REFUS : un code chacun, et aucun compte à moitié créé ──
  return next throws_ok(format('select pg_temp.inscrire(%L, %L::jsonb)', v_ids[7], jsonb_build_object('role', 'admin', 'domain_slug', v_slug)),
                        'IN001', null, 'rôle inconnu : IN001');
  return next ok(pg_temp.rien(v_ids[7]), 'rôle inconnu : ni compte auth, ni miroir — plus de compte fantôme');
  return next throws_ok(format('select pg_temp.inscrire(%L, %L::jsonb)', v_ids[8], '{"role":"expert"}'),
                        'IN002', null, 'domain_slug absent : IN002');
  return next throws_ok(format('select pg_temp.inscrire(%L, %L::jsonb)', v_ids[9], '{"role":"cabinet","domain_slug":"sonde-ecosysteme-inexistant"}'),
                        'IN003', null, 'écosystème inconnu : IN003');
  return next ok(pg_temp.rien(v_ids[8]) and pg_temp.rien(v_ids[9]), 'IN002, IN003 : rien n''en reste');
  return next throws_ok(format('select pg_temp.inscrire(%L, %L::jsonb)', v_ids[10],
                               jsonb_build_object('role', 'expert', 'domain_slug', v_slug, 'branch_id', gen_random_uuid(), 'speciality_id', v_spec)),
                        'IN005', null, 'branche inventée : IN005');
  return next throws_ok(format('select pg_temp.inscrire(%L, %L::jsonb)', v_ids[10],
                               jsonb_build_object('role', 'cdi', 'domain_slug', v_slug, 'speciality_id', gen_random_uuid())),
                        'IN005', null, 'spécialité inventée : IN005 (un uuid[] n''a pas de clé étrangère)');
  if v_autre_b is null then
    return next skip('une seule branche active dans l''écosystème : « spécialité d''une autre branche » ne se fabrique pas', 1);
  else
    return next throws_ok(format('select pg_temp.inscrire(%L, %L::jsonb)', v_ids[11],
                                 jsonb_build_object('role', 'expert', 'domain_slug', v_slug, 'branch_id', v_autre_b, 'speciality_id', v_spec)),
                          'IN005', null, 'spécialité d''une AUTRE branche : IN005');
  end if;
  return next ok(pg_temp.rien(v_ids[10]) and pg_temp.rien(v_ids[11]), 'IN005 : rien n''en reste');
  -- Un profil d'expert ne se crée pas SANS son miroir, ni l'inverse : même transaction (l'échec du profil annule tout).
  return next ok(not exists (select 1 from public.profiles p left join public.users u on u.id = p.user_id
                              where p.user_id = any (v_ids) and u.id is null),
                 'aucun profil sans miroir parmi les comptes du test');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
