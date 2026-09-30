-- LA CRÉATION DE COMPTE ÉCRIT SA LIGNE — UN TEST PAR VOIE, par le VRAI chemin : une ligne dans
-- auth.users, le trigger on_auth_user_created → handle_new_user → journaliser(), AVEC la preuve signée (§D.27).
-- Les voies, toutes PROUVÉES désormais (elles n'étaient que déclarées) :
--   inscription_expert           register-expert  (freelance 'expert', CDI 'cdi')
--   preinscription_organisation  register-org     (client 'entreprise', cabinet et ESN 'cabinet')
--   invitation                   /api/invitations/inscription (rôle de l'organisation, adresse confirmée)
--   administrateur               create-admin et le script du jour zéro (rôle de pont 'entreprise')
-- L'appel DIRECT à l'API d'authentification, sans preuve, n'écrit plus de ligne : il n'y a plus de compte (IN007).
-- La ligne sœur de chaque voie est prouvée par inscription/porte.test.sql ; ici, la ligne du COMPTE.
-- Puis ce qui est refusé (IN006, IN005) et ce qu'un refus laisse : rien. Puis la règle unique de taxonomie.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(19);

-- Une inscription prouvée : les métadonnées valides du rôle, des champs remplacés, signées ; adresse non confirmée.
create or replace function pg_temp.inscrire(p_id uuid, p_role text, p_remplace jsonb default '{}'::jsonb) returns uuid
language plpgsql as $$
declare v jsonb := pg_temp.fab_signer(pg_temp.fab_email(p_id), pg_temp.fab_meta(p_role, p_id) || p_remplace);
begin
  perform pg_temp.fab_auth(p_id, pg_temp.fab_email(p_id), v, false);
  return (v ->> 'piece')::uuid;
end $$;

-- LA ligne compte_cree d'un compte, telle qu'elle doit être : UNE sous la pièce, sur le compte, dans l'écosystème.
create or replace function pg_temp.ligne_ok(p_id uuid, p_piece uuid, p_origine text, p_acteur_type text,
                                            p_type_de_compte text, p_voie text, p_dom uuid) returns boolean
language sql as $$
  select (select count(*) from public.grand_livre g where g.piece = p_piece and g.type_action = 'compte_cree') = 1
     and exists (
    select 1 from public.grand_livre g
     where g.piece = p_piece and g.type_action = 'compte_cree' and g.statut = 'reussi'
       and g.origine = p_origine
       and g.acteur_type is not distinct from p_acteur_type
       and g.acteur_id is not distinct from case when p_acteur_type is null then null else p_id end
       and g.ecosysteme_id = p_dom and g.sujet_type = 'users' and g.sujet_id = p_id
       and g.detail ->> 'type_de_compte' = p_type_de_compte
       and g.detail ->> 'voie_declaree' = p_voie)
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
  v_client  uuid := pg_temp.fab_compte('entreprise');
  v_ids     uuid[] := array(select gen_random_uuid() from generate_series(1, 14));
  v_p       uuid[] := array[]::uuid[];
  v_email   text;
  v_inv     uuid;
  v_m       jsonb;
begin
  select d.slug into v_slug from public.domains d where d.id = v_dom;
  select s.branch_id, s.id into v_branche, v_spec
    from public.specialities s join public.branches b on b.id = s.branch_id
   where s.domain_id = v_dom and s.active and b.active and b.domain_id = v_dom order by s.slug limit 1;
  select b.id into v_autre_b from public.branches b
   where b.domain_id = v_dom and b.active and b.id <> v_branche order by b.slug limit 1;

  -- ── inscription_expert : freelance, puis CDI ──
  v_p[1] := pg_temp.inscrire(v_ids[1], 'expert');
  return next ok(pg_temp.ligne_ok(v_ids[1], v_p[1], 'utilisateur', 'expert_freelance', 'expert_freelance', 'inscription_expert', v_dom),
                 'expert freelance : UNE ligne compte_cree sous la pièce de la route, acteur le compte, voie prouvée');
  v_p[2] := pg_temp.inscrire(v_ids[2], 'cdi');
  return next ok(pg_temp.ligne_ok(v_ids[2], v_p[2], 'utilisateur', 'expert_cdi', 'expert_cdi', 'inscription_expert', v_dom),
                 'expert CDI : UNE ligne compte_cree');
  -- ── preinscription_organisation : client, cabinet, ESN ──
  v_p[3] := pg_temp.inscrire(v_ids[3], 'entreprise');
  return next ok(pg_temp.ligne_ok(v_ids[3], v_p[3], 'utilisateur', 'client', 'client', 'preinscription_organisation', v_dom),
                 'client : UNE ligne compte_cree');
  v_p[4] := pg_temp.inscrire(v_ids[4], 'cabinet');
  return next ok(pg_temp.ligne_ok(v_ids[4], v_p[4], 'utilisateur', 'cabinet', 'cabinet', 'preinscription_organisation', v_dom),
                 'cabinet : UNE ligne compte_cree');
  v_p[5] := pg_temp.inscrire(v_ids[5], 'cabinet', '{"org_type":"esn"}');
  return next ok(pg_temp.ligne_ok(v_ids[5], v_p[5], 'utilisateur', 'cabinet', 'cabinet', 'preinscription_organisation', v_dom),
                 'ESN : le compte est un cabinet, UNE ligne compte_cree');
  -- ── invitation : la route serveur, l'adresse de l'invitation, confirmée ──
  v_email := 'invite+' || v_ids[6] || '@' || v_ids[6] || '.invalid';
  v_inv := (public.creer_invitation(gen_random_uuid(), null, 'utilisateur', v_client, 'client', v_dom,
             jsonb_build_object('organization_id', (select m.organization_id from public.organization_members m where m.user_id = v_client limit 1),
                                'email', v_email, 'token', 'hash_' || gen_random_uuid(), 'role_in_org', 'viewer',
                                'expires_at', now() + interval '7 days', 'status', 'pending',
                                'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id')::uuid;
  v_m := pg_temp.fab_signer(v_email, jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug, 'firstname', 'Sonde', 'lastname', 'Invite',
           'voie', 'invitation', 'piece', gen_random_uuid()::text, 'cgu_version', 'sonde',
           'invitation_id', v_inv::text, 'invitation_statuts', 'pending'));
  perform pg_temp.fab_auth(v_ids[6], v_email, v_m, true);
  return next ok(pg_temp.ligne_ok(v_ids[6], (v_m ->> 'piece')::uuid, 'utilisateur', 'client', 'client', 'invitation', v_dom),
                 'membre invité : UNE ligne compte_cree — le compte naît au serveur, plus dans le navigateur');
  -- ── administrateur : rôle de pont, la ligne du compte en origine système, sans acteur ──
  v_email := pg_temp.fab_email(v_ids[7]);
  v_m := pg_temp.fab_signer(v_email, jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug, 'firstname', 'Sonde', 'lastname', 'Admin',
           'voie', 'administrateur', 'piece', gen_random_uuid()::text, 'acteur_id', ''));
  perform pg_temp.fab_auth(v_ids[7], v_email, v_m, true);
  return next ok(pg_temp.ligne_ok(v_ids[7], (v_m ->> 'piece')::uuid, 'systeme', null, 'admin', 'administrateur', v_dom),
                 'administrateur : UNE ligne compte_cree, origine système, SANS acteur (il est sur la promotion)');
  -- ── l'appel DIRECT : sans preuve, plus de compte, donc plus de ligne ──
  return next throws_ok(format('select pg_temp.fab_auth(%L, %L, %L::jsonb, false)', v_ids[8], pg_temp.fab_email(v_ids[8]),
                               pg_temp.fab_meta('expert', v_ids[8])),
                        'IN007', null, 'appel direct, sans preuve : IN007');
  return next ok(pg_temp.rien(v_ids[8]), 'appel direct : ni compte, ni miroir, ni ligne — la porte est fermée');
  return next is((select count(*) from public.grand_livre g where g.type_action = 'compte_cree' and g.sujet_id = any (v_ids[1:7])),
                 7::bigint, 'sept comptes, sept lignes compte_cree');

  -- ── IN006 : une voie fausse ne s'écrit pas, même signée, et le compte n'existe pas ──
  return next throws_ok(format('select pg_temp.inscrire(%L, %L, %L::jsonb)', v_ids[9], 'expert', '{"voie":"bricolee"}'),
                        'IN006', null, 'voie inconnue : IN006');
  return next throws_ok(format('select pg_temp.inscrire(%L, %L, %L::jsonb)', v_ids[10], 'entreprise', '{"voie":"inscription_expert"}'),
                        'IN006', null, 'voie incohérente (une organisation « inscription d''expert ») : IN006');
  return next throws_ok(format('select pg_temp.inscrire(%L, %L, %L::jsonb)', v_ids[11], 'cabinet', '{"piece":"pas-une-piece"}'),
                        'IN006', null, 'pièce illisible : IN006');
  return next ok(pg_temp.rien(v_ids[9]) and pg_temp.rien(v_ids[10]) and pg_temp.rien(v_ids[11]),
                 'IN006 : ni compte auth, ni miroir, ni ligne');
  -- ── un refus du trigger annule AUSSI la ligne ──
  return next throws_ok(format('select pg_temp.inscrire(%L, %L, %L::jsonb)', v_ids[12], 'expert',
                               jsonb_build_object('branch_id', gen_random_uuid()::text)),
                        'IN005', null, 'branche inventée : IN005');
  return next ok(pg_temp.rien(v_ids[12]), 'IN005 : la ligne écrite dans la même transaction est annulée avec le compte');

  -- ── LA RÈGLE UNIQUE DE TAXONOMIE (inscription_refus l'appelle, la route pose la question) ──
  return next ok(public.taxonomie_inscription_refus(v_dom, v_branche, v_spec) is null
                 and public.taxonomie_inscription_refus(v_dom, v_branche, null) is null,
                 'taxonomie : une branche et une spécialité de l''écosystème sont admises (null)');
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
