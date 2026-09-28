-- L'INSCRIPTION, UN TEST PAR RÔLE — par le VRAI chemin : une ligne dans auth.users, le trigger
-- on_auth_user_created → handle_new_user, AVEC la preuve signée que la route pose (§D.27). Les rôles tels
-- que le code les envoie :
--   expert freelance · expert CDI   (register-expert : 'expert' | 'cdi')
--   client · cabinet · ESN          (register-org : 'entreprise' | 'cabinet', l'ESN s'inscrit 'cabinet'
--                                    et son organisation porte org_type = 'esn')
-- Chacun dans son écosystème RÉEL (lu en base), et ce que l'inscription doit créer : le miroir
-- public.users, le profil pour un expert (sa spécialité dans speciality_ids), l'organisation pour une
-- organisation — dans la même transaction. Puis les refus : chacun lève son code, et AUCUN compte n'en reste.
-- (IN002 « écosystème absent » n'existe plus : absent ou inconnu, c'est invalid_domain, IN003.)
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(18);

-- L'inscription telle que la route l'envoie : les métadonnées valides du rôle, des champs remplacés, signées.
create or replace function pg_temp.inscrire(p_id uuid, p_role text, p_remplace jsonb default '{}'::jsonb) returns void
language sql as $$
  select pg_temp.fab_auth(p_id, pg_temp.fab_email(p_id),
           pg_temp.fab_signer(pg_temp.fab_email(p_id), pg_temp.fab_meta(p_role, p_id) || p_remplace), false)
$$;

-- Rien n'existe pour cet identifiant, ni côté auth ni côté produit.
create or replace function pg_temp.rien(p_id uuid) returns boolean
language sql as $$
  select not exists (select 1 from auth.users a where a.id = p_id)
     and not exists (select 1 from public.users u where u.id = p_id)
     and not exists (select 1 from public.profiles p where p.user_id = p_id)
     and not exists (select 1 from public.organization_members m where m.user_id = p_id)
$$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_dom     uuid := pg_temp.fab_domaine();
  v_gratuit uuid;
  v_branche uuid;
  v_spec    uuid;
  v_autre_b uuid;
  v_ids     uuid[] := array(select gen_random_uuid() from generate_series(1, 11));
begin
  select r.id into v_gratuit from public.roles r where r.name = 'Gratuit' and r.active;
  select s.branch_id, s.id into v_branche, v_spec
    from public.specialities s join public.branches b on b.id = s.branch_id
   where s.domain_id = v_dom and s.active and b.active and b.domain_id = v_dom order by s.slug limit 1;
  select b.id into v_autre_b from public.branches b
   where b.domain_id = v_dom and b.active and b.id <> v_branche order by b.slug limit 1;

  -- ── expert freelance, spécialité du référentiel ──
  perform pg_temp.inscrire(v_ids[1], 'expert', jsonb_build_object('branch_id', v_branche::text, 'speciality_id', v_spec::text,
                                                                   'speciality_other', '', 'specialty', ''));
  return next ok(exists (select 1 from public.users u where u.id = v_ids[1] and u.user_type = 'expert_freelance'
                          and u.domain_id = v_dom and u.role_id = v_gratuit and u.status = 'draft' and u.locale = 'fr'
                          and u.first_name = 'Sonde' and u.email = pg_temp.fab_email(v_ids[1])),
                 'expert freelance : le miroir, dans son écosystème, rôle Gratuit, brouillon');
  return next ok(exists (select 1 from public.profiles p where p.user_id = v_ids[1] and p.expert_type = 'freelance'
                          and p.domain_id = v_dom and p.branch_id = v_branche and p.speciality_ids = array[v_spec]
                          and p.speciality_other is null and p.title is null and not p.visible),
                 'expert freelance : le profil porte sa branche et sa spécialité dans speciality_ids, invisible');
  -- ── expert CDI ──
  perform pg_temp.inscrire(v_ids[2], 'cdi', jsonb_build_object('branch_id', v_branche::text, 'speciality_id', v_spec::text));
  return next ok(exists (select 1 from public.users u where u.id = v_ids[2] and u.user_type = 'expert_cdi' and u.domain_id = v_dom)
                 and exists (select 1 from public.profiles p where p.user_id = v_ids[2] and p.expert_type = 'cdi'
                              and p.speciality_ids = array[v_spec] and p.domain_id = v_dom),
                 'expert CDI : le miroir et le profil, avec sa spécialité');
  -- ── expert, spécialité « Autre » ──
  perform pg_temp.inscrire(v_ids[3], 'expert', '{"speciality_other":"Sonde hors référentiel"}');
  return next ok(exists (select 1 from public.profiles p where p.user_id = v_ids[3] and p.speciality_ids = '{}'::uuid[]
                          and p.speciality_other = 'Sonde hors référentiel'),
                 'expert « Autre » : aucune spécialité au référentiel, la précision libre est gardée');
  -- ── client ──
  perform pg_temp.inscrire(v_ids[4], 'entreprise');
  return next ok(exists (select 1 from public.users u where u.id = v_ids[4] and u.user_type = 'client' and u.domain_id = v_dom)
                 and not exists (select 1 from public.profiles p where p.user_id = v_ids[4])
                 and exists (select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
                              where m.user_id = v_ids[4] and o.org_type = 'client'),
                 'client : le miroir, sans profil d''expert, AVEC son organisation client');
  -- ── cabinet ──
  perform pg_temp.inscrire(v_ids[5], 'cabinet');
  return next ok(exists (select 1 from public.users u where u.id = v_ids[5] and u.user_type = 'cabinet' and u.domain_id = v_dom)
                 and exists (select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
                              where m.user_id = v_ids[5] and o.org_type = 'cabinet'),
                 'cabinet : le miroir, AVEC son organisation cabinet');
  -- ── ESN : 'cabinet' au trigger, l'organisation 'esn' avec son siège ──
  perform pg_temp.inscrire(v_ids[6], 'cabinet', '{"org_type":"esn"}');
  return next ok(exists (select 1 from public.users u where u.id = v_ids[6] and u.user_type = 'cabinet' and u.domain_id = v_dom),
                 'ESN : le miroir est un cabinet, dans son écosystème');
  return next ok(exists (select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
                          where m.user_id = v_ids[6] and o.org_type = 'esn' and o.siege_admin_membre_id is not null
                            and m.role_in_org = 'admin' and m.status = 'active'),
                 'ESN : l''organisation esn naît avec son administrateur actif et son siège');
  -- ── une seule ligne par compte ──
  return next is((select count(*) from public.users u where u.id = any (v_ids[1:6])), 6::bigint, 'six inscriptions, six miroirs');
  return next is((select count(*) from public.profiles p where p.user_id = any (v_ids[1:6])), 3::bigint, 'trois experts, trois profils — aucun pour les organisations');
  return next is((select count(*) from public.organization_members m where m.user_id = any (v_ids[1:6])), 3::bigint,
                 'trois organisations, une par compte d''organisation — aucune pour les experts');

  -- ── LES REFUS : un code chacun, et aucun compte à moitié créé ──
  return next throws_ok(format('select pg_temp.inscrire(%L, %L)', v_ids[7], 'admin'),
                        'IN001', null, 'rôle inconnu, même signé : IN001');
  return next throws_ok(format('select pg_temp.inscrire(%L, %L, %L::jsonb)', v_ids[8], 'cabinet', '{"domain_slug":"sonde-ecosysteme-inexistant"}'),
                        'IN003', null, 'écosystème inconnu : IN003');
  return next ok(pg_temp.rien(v_ids[7]) and pg_temp.rien(v_ids[8]), 'IN001, IN003 : rien n''en reste — plus de compte fantôme');
  return next throws_ok(format('select pg_temp.inscrire(%L, %L, %L::jsonb)', v_ids[9], 'cdi',
                               jsonb_build_object('branch_id', v_branche::text, 'speciality_id', gen_random_uuid()::text)),
                        'IN005', null, 'spécialité inventée : IN005 (un uuid[] n''a pas de clé étrangère)');
  if v_autre_b is null then
    return next skip('une seule branche active dans l''écosystème : « spécialité d''une autre branche » ne se fabrique pas', 1);
  else
    return next throws_ok(format('select pg_temp.inscrire(%L, %L, %L::jsonb)', v_ids[10], 'expert',
                                 jsonb_build_object('branch_id', v_autre_b::text, 'speciality_id', v_spec::text)),
                          'IN005', null, 'spécialité d''une AUTRE branche : IN005');
  end if;
  return next ok(pg_temp.rien(v_ids[9]) and pg_temp.rien(v_ids[10]), 'IN005 : rien n''en reste');
  -- Un profil ne se crée pas SANS son miroir, ni l'inverse : même transaction.
  return next ok(not exists (select 1 from public.profiles p left join public.users u on u.id = p.user_id
                              where p.user_id = any (v_ids) and u.id is null),
                 'aucun profil sans miroir parmi les comptes du test');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
