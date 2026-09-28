-- LA CRÉATION DE COMPTE ÉCRIT SA LIGNE — UN TEST PAR VOIE, par le VRAI chemin : une ligne dans
-- auth.users, le trigger on_auth_user_created → handle_new_user → journaliser() (décision A, phase B).
-- Les voies telles que le code les déclare :
--   inscription_expert           register-expert  (freelance 'expert', CDI 'cdi')
--   preinscription_organisation  register-org     (client 'entreprise', cabinet et ESN 'cabinet')
--   invitation                   /invitation/[token], dans le navigateur (rôle de l'organisation)
--   administrateur               create-admin et le script du jour zéro (rôle de pont 'entreprise')
--   (aucune)                     l'appel DIRECT à l'API d'authentification, sans pièce
-- La collaboration entre experts n'a pas de voie propre : ses comptes sont des experts (freelance, CDI).
-- Puis ce qui est refusé (IN006) et ce qu'un refus laisse : rien. Puis la règle unique de taxonomie.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(22);

create or replace function pg_temp.inscrire(p_id uuid, p_meta jsonb) returns void
language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
          'sonde+' || p_id || '@exemple.invalid', '', null, '{}'::jsonb,
          p_meta || '{"firstname":"Sonde","lastname":"Essai"}'::jsonb, now(), now())
$$;

-- LA ligne compte_cree d'un compte, telle qu'elle doit être : sous la pièce, sur le compte, dans l'écosystème.
create or replace function pg_temp.ligne_ok(p_id uuid, p_piece uuid, p_origine text, p_acteur_type text,
                                            p_type_de_compte text, p_voie text, p_dom uuid) returns boolean
language sql as $$
  select pg_temp.lignes(p_piece) = 1 and exists (
    select 1 from public.grand_livre g
     where g.piece = p_piece and g.type_action = 'compte_cree' and g.statut = 'reussi'
       and g.origine = p_origine
       and g.acteur_type is not distinct from p_acteur_type
       and g.acteur_id is not distinct from case when p_acteur_type is null then null else p_id end
       and g.ecosysteme_id = p_dom and g.sujet_type = 'users' and g.sujet_id = p_id
       and g.detail ->> 'type_de_compte' = p_type_de_compte
       and coalesce(g.detail -> 'voie_declaree', 'null'::jsonb) = coalesce(to_jsonb(p_voie), 'null'::jsonb))
$$;

create or replace function pg_temp.rien(p_id uuid) returns boolean
language sql as $$
  select not exists (select 1 from auth.users a where a.id = p_id)
     and not exists (select 1 from public.users u where u.id = p_id)
     and not exists (select 1 from public.grand_livre g where g.sujet_id = p_id)
$$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_dom     uuid := pg_temp.fab_domaine();
  v_slug    text;
  v_branche uuid;
  v_spec    uuid;
  v_autre_b uuid;
  v_ids     uuid[] := array(select gen_random_uuid() from generate_series(1, 14));
  v_p       uuid[] := array(select gen_random_uuid() from generate_series(1, 14));
  v_piece   uuid;
  v_org     uuid;
begin
  select d.slug into v_slug from public.domains d where d.id = v_dom;
  select s.branch_id, s.id into v_branche, v_spec
    from public.specialities s join public.branches b on b.id = s.branch_id
   where s.domain_id = v_dom and s.active and b.active and b.domain_id = v_dom order by s.slug limit 1;
  select b.id into v_autre_b from public.branches b
   where b.domain_id = v_dom and b.active and b.id <> v_branche order by b.slug limit 1;

  -- ── inscription_expert : freelance, puis CDI ──
  perform pg_temp.inscrire(v_ids[1], jsonb_build_object('role', 'expert', 'domain_slug', v_slug, 'branch_id', v_branche,
            'speciality_id', v_spec, 'piece', v_p[1], 'voie', 'inscription_expert'));
  return next ok(pg_temp.ligne_ok(v_ids[1], v_p[1], 'utilisateur', 'expert_freelance', 'expert_freelance', 'inscription_expert', v_dom),
                 'expert freelance : UNE ligne sous la pièce de la route, acteur le compte, voie déclarée');
  perform pg_temp.inscrire(v_ids[2], jsonb_build_object('role', 'cdi', 'domain_slug', v_slug, 'branch_id', v_branche,
            'speciality_id', v_spec, 'piece', v_p[2], 'voie', 'inscription_expert'));
  return next ok(pg_temp.ligne_ok(v_ids[2], v_p[2], 'utilisateur', 'expert_cdi', 'expert_cdi', 'inscription_expert', v_dom),
                 'expert CDI : UNE ligne sous la pièce de la route');
  -- ── preinscription_organisation : client, cabinet, ESN ──
  perform pg_temp.inscrire(v_ids[3], jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug,
            'piece', v_p[3], 'voie', 'preinscription_organisation'));
  return next ok(pg_temp.ligne_ok(v_ids[3], v_p[3], 'utilisateur', 'client', 'client', 'preinscription_organisation', v_dom),
                 'client : UNE ligne sous la pièce de la route');
  perform pg_temp.inscrire(v_ids[4], jsonb_build_object('role', 'cabinet', 'domain_slug', v_slug,
            'piece', v_p[4], 'voie', 'preinscription_organisation'));
  return next ok(pg_temp.ligne_ok(v_ids[4], v_p[4], 'utilisateur', 'cabinet', 'cabinet', 'preinscription_organisation', v_dom),
                 'cabinet : UNE ligne sous la pièce de la route');
  perform pg_temp.inscrire(v_ids[5], jsonb_build_object('role', 'cabinet', 'domain_slug', v_slug,
            'piece', v_p[5], 'voie', 'preinscription_organisation'));
  v_org := public.creer_organisation_avec_admin(v_ids[5], v_dom, 'esn', 'Sonde ESN', 'FR');
  return next ok(pg_temp.ligne_ok(v_ids[5], v_p[5], 'utilisateur', 'cabinet', 'cabinet', 'preinscription_organisation', v_dom)
                 and v_org is not null,
                 'ESN : le compte est un cabinet, UNE ligne sous la pièce — l''organisation esn n''en ajoute aucune ici');
  -- ── invitation : le navigateur met la pièce et la voie ──
  perform pg_temp.inscrire(v_ids[6], jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug,
            'piece', v_p[6], 'voie', 'invitation'));
  return next ok(pg_temp.ligne_ok(v_ids[6], v_p[6], 'utilisateur', 'client', 'client', 'invitation', v_dom),
                 'membre invité : UNE ligne, le compte né dans le navigateur n''échappe plus au journal');
  -- ── administrateur : rôle de pont, la personne qui agit n'est pas connue du trigger ──
  perform pg_temp.inscrire(v_ids[7], jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug,
            'piece', v_p[7], 'voie', 'administrateur'));
  return next ok(pg_temp.ligne_ok(v_ids[7], v_p[7], 'systeme', null, 'client', 'administrateur', v_dom),
                 'administrateur : UNE ligne sous la pièce, origine système, SANS acteur (il est sur la promotion)');
  -- ── l'appel DIRECT : ni pièce, ni voie ──
  perform pg_temp.inscrire(v_ids[8], jsonb_build_object('role', 'expert', 'domain_slug', v_slug));
  select g.piece into v_piece from public.grand_livre g where g.sujet_id = v_ids[8] and g.type_action = 'compte_cree';
  return next ok(v_piece is not null and pg_temp.ligne_ok(v_ids[8], v_piece, 'systeme', 'expert_freelance', 'expert_freelance', null, v_dom),
                 'appel direct : la pièce NAÎT dans la fonction, origine système, acteur le compte, voie nulle');
  return next ok(v_piece <> all (v_p), 'appel direct : la pièce née est neuve, elle ne reprend celle d''aucun geste');
  perform pg_temp.inscrire(v_ids[9], jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug));
  return next is((select count(*) from public.grand_livre g
                   where g.sujet_id = v_ids[9] and g.type_action = 'compte_cree' and g.origine = 'systeme' and g.acteur_type = 'client'),
                 1::bigint, 'appel direct d''une organisation : UNE ligne aussi');
  -- ── UNE ligne par compte, jamais deux ──
  return next is((select count(*) from public.grand_livre g where g.type_action = 'compte_cree' and g.sujet_id = any (v_ids[1:9])),
                 9::bigint, 'neuf comptes, neuf lignes compte_cree');

  -- ── IN006 : une étiquette fausse ne s'écrit pas, et le compte n'existe pas ──
  return next throws_ok(format('select pg_temp.inscrire(%L, %L::jsonb)', v_ids[10],
                               jsonb_build_object('role', 'expert', 'domain_slug', v_slug, 'voie', 'bricolee')),
                        'IN006', null, 'voie inconnue : IN006');
  return next throws_ok(format('select pg_temp.inscrire(%L, %L::jsonb)', v_ids[11],
                               jsonb_build_object('role', 'expert', 'domain_slug', v_slug, 'voie', 'invitation')),
                        'IN006', null, 'voie incohérente (un expert « invité » dans une organisation) : IN006');
  return next throws_ok(format('select pg_temp.inscrire(%L, %L::jsonb)', v_ids[12],
                               jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug, 'voie', 'inscription_expert')),
                        'IN006', null, 'voie incohérente (une organisation « inscription d''expert ») : IN006');
  return next throws_ok(format('select pg_temp.inscrire(%L, %L::jsonb)', v_ids[13],
                               jsonb_build_object('role', 'cabinet', 'domain_slug', v_slug, 'piece', 'pas-une-piece')),
                        'IN006', null, 'pièce illisible : IN006');
  return next ok(pg_temp.rien(v_ids[10]) and pg_temp.rien(v_ids[11]) and pg_temp.rien(v_ids[12]) and pg_temp.rien(v_ids[13]),
                 'IN006 : ni compte auth, ni miroir, ni ligne');
  -- ── un refus du trigger annule AUSSI la ligne ──
  return next throws_ok(format('select pg_temp.inscrire(%L, %L::jsonb)', v_ids[14],
                               jsonb_build_object('role', 'expert', 'domain_slug', v_slug, 'branch_id', gen_random_uuid(),
                                                  'piece', v_p[14], 'voie', 'inscription_expert')),
                        'IN005', null, 'branche inventée : IN005');
  return next ok(pg_temp.rien(v_ids[14]) and pg_temp.lignes(v_p[14]) = 0,
                 'IN005 : la ligne écrite dans la même transaction est annulée avec le compte');

  -- ── LA RÈGLE UNIQUE DE TAXONOMIE (la route et le trigger l'appellent) ──
  return next ok(public.taxonomie_inscription_refus(v_dom, v_branche, v_spec) is null
                 and public.taxonomie_inscription_refus(v_dom, v_branche, null) is null,
                 'taxonomie : une branche et une spécialité de l''écosystème sont admises (null)');
  return next is(public.taxonomie_inscription_refus(v_dom, gen_random_uuid(), v_spec), 'invalid_branch'::text,
                 'taxonomie : une branche inventée rend invalid_branch');
  return next is(public.taxonomie_inscription_refus(v_dom, v_branche, gen_random_uuid()), 'invalid_speciality'::text,
                 'taxonomie : une spécialité inventée rend invalid_speciality');
  if v_autre_b is null then
    return next skip('une seule branche active dans l''écosystème : « spécialité d''une autre branche » ne se fabrique pas', 1);
  else
    return next is(public.taxonomie_inscription_refus(v_dom, v_autre_b, v_spec), 'invalid_speciality'::text,
                   'taxonomie : une spécialité d''une AUTRE branche rend invalid_speciality');
  end if;
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
