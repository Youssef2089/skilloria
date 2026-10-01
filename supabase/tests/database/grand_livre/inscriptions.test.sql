-- LES LIGNES SŒURS DE L'INSCRIPTION — expert_inscrit, organisation_preinscrite — écrites par handle_new_user,
-- dans la transaction du compte, sous la pièce de compte_cree (§D.27). Elles étaient écrites par les ROUTES,
-- après coup, avec une forme « échouée » (compte nettoyé) : cette forme n'existe plus — une inscription
-- refusée n'écrit rien. Sur des comptes FABRIQUÉS par le vrai chemin (preuve signée), pour chaque population :
--   expert_inscrit : expert freelance, expert CDI
--   organisation_preinscrite : client, cabinet, ESN (sujet l'organisation née avec le compte)
-- Puis les listes blanches : les anciennes clés d'échec, le téléphone, l'identifiant d'entreprise — refusés.
-- DEUX LIGNES D'UN GESTE NE SE RESSEMBLENT PAS (recette staging, 30/09/2026) : `compte_cree` dit le COMPTE (type,
-- voie, CGU, téléphone), la ligne sœur dit l'OBJET que la voie crée — le profil, l'organisation. `paire()` exige
-- deux SUJETS différents : deux lignes sur le même sujet, c'est le cas que Youssef a vu à l'écran.
-- AUCUN NUMÉRO DE TÉLÉPHONE AU GRAND LIVRE, MÊME PARTIEL (décision de Youssef, 01/10/2026) : le grand livre ne
-- s'efface jamais ; il porte le FAIT (téléphone vérifié, booléen), jamais le numéro — vérifié sur chaque ligne de
-- chaque inscription, et les clés `telephone` / `phone` refusées par la liste blanche des deux écritures.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(14);

-- Une inscription prouvée, et sa pièce.
create or replace function pg_temp.inscrire(p_id uuid, p_role text, p_remplace jsonb default '{}'::jsonb) returns uuid
language plpgsql as $$
declare v jsonb := pg_temp.fab_signer(pg_temp.fab_email(p_id), pg_temp.fab_meta(p_role, p_id) || p_remplace);
begin
  perform pg_temp.fab_auth(p_id, pg_temp.fab_email(p_id), v, false);
  return (v ->> 'piece')::uuid;
end $$;

-- La paire sous une pièce : compte_cree ET la ligne sœur (un code), rien d'autre — sur DEUX sujets différents.
create or replace function pg_temp.paire(p_piece uuid, p_soeur text) returns boolean
language sql as $$
  select pg_temp.lignes(p_piece) = 2
     and (select count(distinct (g.sujet_type, g.sujet_id)) from public.grand_livre g where g.piece = p_piece) = 2
     and exists (select 1 from public.grand_livre g where g.piece = p_piece and g.type_action = 'compte_cree')
     and exists (select 1 from public.grand_livre g where g.piece = p_piece and g.type_action = p_soeur and g.statut = 'reussi')
$$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_dom uuid := pg_temp.fab_domaine();
  v_ids uuid[] := array(select gen_random_uuid() from generate_series(1, 5));
  v_p   uuid[] := array[]::uuid[];
  v_branche uuid;
begin
  select b.id into v_branche from public.branches b where b.domain_id = v_dom and b.active order by b.slug limit 1;
  -- ── expert_inscrit ──
  v_p[1] := pg_temp.inscrire(v_ids[1], 'expert');
  return next ok(pg_temp.paire(v_p[1], 'expert_inscrit')
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.type_action = 'expert_inscrit'
                              and g.origine = 'utilisateur' and g.acteur_id = v_ids[1] and g.acteur_type = 'expert_freelance'
                              and g.sujet_type = 'profiles' and g.sujet_id = (select p.id from public.profiles p where p.user_id = v_ids[1])
                              and g.ecosysteme_id = v_dom
                              and g.detail = jsonb_build_object('branch_id', v_branche, 'nb_specialites', 0, 'specialite_autre', true)),
                 'expert freelance : expert_inscrit dit l''EXPERT — sur son profil : branche, spécialités, « Autre » (rien du compte)');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.type_action = 'compte_cree'
                          and g.sujet_type = 'users' and g.sujet_id = v_ids[1]
                          and g.detail = jsonb_build_object('type_de_compte', 'expert_freelance', 'voie_declaree', 'inscription_expert',
                                                            'cgu_version', 'sonde', 'telephone_verifie', true)),
                 'expert freelance : compte_cree dit le COMPTE — type, voie, version des CGU, téléphone vérifié');
  v_p[2] := pg_temp.inscrire(v_ids[2], 'cdi');
  return next ok(pg_temp.paire(v_p[2], 'expert_inscrit')
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[2] and g.type_action = 'expert_inscrit'
                              and g.acteur_type = 'expert_cdi' and g.sujet_type = 'profiles'
                              and g.sujet_id = (select p.id from public.profiles p where p.user_id = v_ids[2])),
                 'expert CDI : la paire sous la même pièce');
  -- ── organisation_preinscrite : le sujet est l'organisation née avec le compte ──
  v_p[3] := pg_temp.inscrire(v_ids[3], 'entreprise');
  return next ok(pg_temp.paire(v_p[3], 'organisation_preinscrite')
                 and exists (select 1 from public.grand_livre g join public.organization_members m on m.organization_id = g.sujet_id
                              where g.piece = v_p[3] and g.type_action = 'organisation_preinscrite' and g.sujet_type = 'organizations'
                                and m.user_id = v_ids[3] and g.acteur_type = 'client'
                                and g.detail = jsonb_build_object('org_type', 'client', 'domaine_public', false)),
                 'client : compte_cree ET organisation_preinscrite (sujet l''organisation du compte)');
  v_p[4] := pg_temp.inscrire(v_ids[4], 'cabinet');
  return next ok(pg_temp.paire(v_p[4], 'organisation_preinscrite')
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[4] and g.type_action = 'organisation_preinscrite'
                              and g.acteur_type = 'cabinet' and g.detail ->> 'org_type' = 'cabinet'),
                 'cabinet : la paire sous la même pièce');
  v_p[5] := pg_temp.inscrire(v_ids[5], 'cabinet', '{"org_type":"esn"}');
  return next ok(pg_temp.paire(v_p[5], 'organisation_preinscrite')
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[5] and g.type_action = 'organisation_preinscrite'
                              and g.acteur_type = 'cabinet' and g.detail ->> 'org_type' = 'esn'),
                 'ESN : le compte est un cabinet, l''organisation esn — la paire sous la même pièce');

  -- ── AUCUN NUMÉRO, MÊME PARTIEL : ni le numéro, ni sa forme nationale, ni ses huit derniers chiffres ──
  return next ok(not exists (
                   select 1
                     from unnest(v_p) with ordinality as p(piece, rang)
                     join public.grand_livre g on g.piece = p.piece
                    cross join lateral (select pg_temp.fab_telephone(v_ids[p.rang::int]) as num) t
                    where strpos(g.detail::text, t.num) > 0
                       or strpos(g.detail::text, '0' || substr(t.num, 4)) > 0
                       or strpos(g.detail::text, right(t.num, 8)) > 0)
                 and (select jsonb_typeof(g.detail -> 'telephone_verifie') = 'boolean' from public.grand_livre g
                       where g.piece = v_p[1] and g.type_action = 'compte_cree'),
                 'aucune ligne des cinq inscriptions ne porte le numéro, même partiel — seulement le FAIT, un booléen');
  return next throws_ok(format($q$select public.journaliser(%L, 'compte_cree', 'reussi', 'utilisateur', %L, 'expert_freelance', %L,
                                 'users', %L, '{"type_de_compte":"expert_freelance","telephone":"+33600000000"}'::jsonb,
                                 null::uuid, null::numeric, null::text)$q$, gen_random_uuid(), v_ids[1], v_dom, v_ids[1]),
                        'GL004', null, 'compte_cree : la clé « telephone » est refusée — le numéro n''entre pas');
  return next throws_ok(format($q$select public.journaliser(%L, 'compte_cree', 'reussi', 'utilisateur', %L, 'expert_freelance', %L,
                                 'users', %L, '{"type_de_compte":"expert_freelance","phone":"+33600000000"}'::jsonb,
                                 null::uuid, null::numeric, null::text)$q$, gen_random_uuid(), v_ids[1], v_dom, v_ids[1]),
                        'GL004', null, 'compte_cree : la clé « phone » est refusée');

  -- ── les listes blanches : la forme échouée n'existe plus ──
  return next throws_ok(format($q$select public.journaliser(%L, 'expert_inscrit', 'echoue', 'utilisateur', %L, 'expert_freelance', %L,
                                 'users', %L, '{"type_de_compte":"expert_freelance","cause":"phone_already_used"}'::jsonb,
                                 null::uuid, null::numeric, null::text)$q$, gen_random_uuid(), v_ids[1], v_dom, v_ids[1]),
                        'GL004', null, 'expert_inscrit : la clé « cause » de l''ancienne forme échouée est refusée');
  return next throws_ok(format($q$select public.journaliser(%L, 'expert_inscrit', 'reussi', 'utilisateur', %L, 'expert_freelance', %L,
                                 'users', %L, '{"type_de_compte":"expert_freelance","telephone":"+33600000000"}'::jsonb,
                                 null::uuid, null::numeric, null::text)$q$, gen_random_uuid(), v_ids[1], v_dom, v_ids[1]),
                        'GL004', null, 'expert_inscrit : le téléphone n''entre pas');
  return next throws_ok(format($q$select public.journaliser(%L, 'expert_inscrit', 'reussi', 'utilisateur', %L, 'expert_freelance', %L,
                                 'profiles', %L, '{"nb_specialites":0}'::jsonb,
                                 null::uuid, null::numeric, null::text)$q$, v_p[1], v_ids[1], v_dom,
                                 (select p.id from public.profiles p where p.user_id = v_ids[1])),
                        'GL005', null, 'expert_inscrit : une seconde ligne sous la même pièce est refusée (une fois par geste)');
  return next throws_ok(format($q$select public.journaliser(%L, 'organisation_preinscrite', 'echoue', 'utilisateur', %L, 'client', %L,
                                 'users', %L, '{"org_type":"client","organisation_nettoyee":true}'::jsonb,
                                 null::uuid, null::numeric, null::text)$q$, gen_random_uuid(), v_ids[3], v_dom, v_ids[3]),
                        'GL004', null, 'organisation_preinscrite : l''ancienne clé « organisation_nettoyee » est refusée');
  return next throws_ok(format($q$select public.journaliser(%L, 'organisation_preinscrite', 'reussi', 'utilisateur', %L, 'client', %L,
                                 'organizations', %L, '{"org_type":"client","siren":"123456789"}'::jsonb,
                                 null::uuid, null::numeric, null::text)$q$, gen_random_uuid(), v_ids[3], v_dom, gen_random_uuid()),
                        'GL004', null, 'organisation_preinscrite : l''identifiant d''entreprise n''entre pas');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
