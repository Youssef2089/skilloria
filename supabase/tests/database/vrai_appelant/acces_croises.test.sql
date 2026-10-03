-- LES ACCÈS CROISÉS, EN BASE — ce que chaque rôle peut lire et écrire DIRECTEMENT par l'API de données
-- (PostgREST), avec la clé publique et son propre jeton, et le refus pour tout le reste (lot DevOps CI, 03/10/2026).
--
-- POURQUOI : la clé publique et le jeton d'un compte sont DANS le navigateur. N'importe qui peut donc appeler
-- l'API de données sans passer par nos routes. Les routes appliquent les règles au serveur (clé de service) ;
-- ce fichier prouve que la porte d'à côté — la base, sous le rôle du navigateur — ne laisse passer, pour chaque
-- rôle, que ses propres lignes, et rien en écriture sur ce que les routes gardent.
--
-- LES RÔLES : expert freelance A et B, expert CDI, client A et B (deux organisations), cabinet, ESN (compte
-- « cabinet », organisation « esn »), administrateur, visiteur (anon). Chacun naît par l'inscription (fabriques :
-- auth.users → handle_new_user, avec sa preuve). Les données : une annonce publiée par chaque client, une
-- candidature croisée (A postule chez B, B chez A), un rapprochement et une notification par expert.
--
-- LE REFUS, EN BASE, A DEUX FORMES — et les deux disent « rien » : une lecture filtrée par la politique rend
-- ZÉRO ligne ; une écriture refusée lève (42501, droit retiré ou politique) ou ne touche AUCUNE ligne. Ce fichier
-- accepte l'une ou l'autre, et vérifie APRÈS COUP, en postgres, que rien n'a changé. Le code exact de chaque
-- refus est imprimé (diag) : c'est le « refus nommé » de la base. Le refus nommé des ROUTES (401, 403, 404 et
-- leur `code`) est prouvé par tests/integration/acces-routes.mjs.
--
-- LA FORME DE vrai_appelant/ : chaque changement d'identité est une INSTRUCTION de premier niveau (comme
-- PostgREST : `set local role`, les revendications du jeton, puis la requête) ; les deux fonctions d'aide ne
-- changent jamais de rôle — elles exécutent une requête et rendent un compte ou un verdict. Gardé par
-- diag-tests-grand-livre (J) : ce fichier passe après tous ceux qui ne changent pas de rôle.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(68);

-- ── Les deux aides : une lecture rend un compte (−1 si le droit manque), une écriture rend un verdict ──
create or replace function pg_temp.compte(p_sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') s' into n;
  return n;
exception when insufficient_privilege then return -1;
end $$;

create or replace function pg_temp.tente(p_sql text) returns text
language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return case when n = 0 then 'aucune_ligne' else 'ecrit:' || n end;
exception when others then
  return 'refus:' || sqlstate;
end $$;

-- Un compte ESN : la voie « organisation » avec le rôle cabinet et le type d'organisation « esn » (la règle
-- d'inscription l'admet : inscription_refus, `invalid_org_type`).
create or replace function pg_temp.fab_compte_esn() returns uuid
language plpgsql as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := pg_temp.fab_email(v_id);
begin
  perform pg_temp.fab_auth(v_id, v_email,
    pg_temp.fab_signer(v_email, pg_temp.fab_meta('cabinet', v_id) || jsonb_build_object('org_type', 'esn')));
  if not exists (select 1 from public.users u join public.organization_members m on m.user_id = u.id
                   join public.organizations o on o.id = m.organization_id
                  where u.id = v_id and u.user_type = 'cabinet' and o.org_type = 'esn') then
    raise exception 'fabrique : le compte ESN % n est pas ne avec son organisation esn', v_id;
  end if;
  return v_id;
end $$;

-- ── Les comptes, par l'inscription ──
select pg_temp.fab_domaine() as dom \gset
select pg_temp.fab_compte('expert') as expert_a \gset
select pg_temp.fab_compte('expert') as expert_b \gset
select pg_temp.fab_compte('cdi') as cdi \gset
select pg_temp.fab_compte('entreprise') as client_a \gset
select pg_temp.fab_compte('entreprise') as client_b \gset
select pg_temp.fab_compte('cabinet') as cabinet \gset
select pg_temp.fab_compte_esn() as esn \gset
select pg_temp.fab_admin() as admin \gset

select p.id as profil_a from public.profiles p where p.user_id = :'expert_a' \gset
select p.id as profil_b from public.profiles p where p.user_id = :'expert_b' \gset
select p.id as profil_cdi from public.profiles p where p.user_id = :'cdi' \gset
select m.organization_id as org_a from public.organization_members m where m.user_id = :'client_a' and m.status = 'active' limit 1 \gset
select m.organization_id as org_b from public.organization_members m where m.user_id = :'client_b' and m.status = 'active' limit 1 \gset
select m.organization_id as org_cab from public.organization_members m where m.user_id = :'cabinet' and m.status = 'active' limit 1 \gset
select m.organization_id as org_esn from public.organization_members m where m.user_id = :'esn' and m.status = 'active' limit 1 \gset

-- ── Les données : une annonce par client, deux candidatures croisées, un rapprochement et une notification par expert ──
select pg_temp.fab_annonce_publiee(:'org_a', :'client_a') as pub_a \gset
select pg_temp.fab_annonce_publiee(:'org_b', :'client_b') as pub_b \gset
select pg_temp.fab_candidature(:'pub_b', :'profil_a') as cand_a \gset
select pg_temp.fab_candidature(:'pub_a', :'profil_b') as cand_b \gset
insert into public.matches (publication_id, profile_id, domain_id, status) values (:'pub_a', :'profil_a', :'dom', 'notified') returning id as match_a \gset
insert into public.matches (publication_id, profile_id, domain_id, status) values (:'pub_b', :'profil_b', :'dom', 'notified') returning id as match_b \gset
insert into public.notifications (user_id, domain_id, type) values (:'expert_a', :'dom', 'new_match_opportunity') returning id as notif_a \gset
insert into public.notifications (user_id, domain_id, type) values (:'expert_b', :'dom', 'new_match_opportunity') returning id as notif_b \gset

-- ── L'invariant du catalogue : la RLS est active sur CHAQUE table du schéma public (dérivé, aucune liste) ──
select coalesce(string_agg(c.relname, ', ' order by c.relname), '') as sans_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity \gset
select is(:'sans_rls'::text, ''::text, 'catalogue : la RLS est active sur chaque table du schéma public (aucune porte ouverte par défaut)');

-- ════════════════════════════════════════════════════════════════════════════
-- VISITEUR (anon, sans jeton)
-- ════════════════════════════════════════════════════════════════════════════
set local role anon;
select pg_temp.compte('select 1 from public.users') as v_users,
       pg_temp.compte('select 1 from public.profiles') as v_profils,
       pg_temp.compte('select 1 from public.publications') as v_pubs,
       pg_temp.compte('select 1 from public.candidatures') as v_cands,
       pg_temp.compte('select 1 from public.organizations') as v_orgs,
       pg_temp.compte('select 1 from public.notifications') as v_notifs,
       pg_temp.compte('select 1 from public.grand_livre') as v_journal \gset
select pg_temp.tente(format('update public.users set first_name = %L where id = %L', 'Pirate', :'expert_a')) as v_maj_user,
       pg_temp.tente(format('insert into public.candidatures (publication_id, profile_id, domain_id, status, ai_match_score, ai_assessment, ai_model) values (%L, %L, %L, %L, 9, %L::jsonb, %L)',
                            :'pub_a', :'profil_cdi', :'dom', 'received', '{"reason":"x","pitch_org":"x","model":"x"}', 'x')) as v_ins_cand \gset
reset role;
select ok(:v_users <= 0 and :v_profils <= 0, 'visiteur : aucun compte, aucun profil ne se lit');
select ok(:v_pubs <= 0 and :v_cands <= 0, 'visiteur : aucune annonce, aucune candidature ne se lit');
select ok(:v_orgs <= 0 and :v_notifs <= 0, 'visiteur : aucune organisation, aucune notification ne se lit');
select ok(:v_journal <= 0, 'visiteur : le grand livre ne se lit pas');
select ok(:'v_maj_user' not like 'ecrit%', 'visiteur : modifier un compte est refusé (' || :'v_maj_user' || ')');
select ok(:'v_ins_cand' not like 'ecrit%', 'visiteur : écrire une candidature est refusé (' || :'v_ins_cand' || ')');

-- ════════════════════════════════════════════════════════════════════════════
-- EXPERT FREELANCE A
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'expert_a', 'role', 'authenticated')::text, true) as _ \gset
select pg_temp.compte(format('select 1 from public.users where id = %L', :'expert_a')) as a_user_soi,
       pg_temp.compte(format('select 1 from public.users where id <> %L', :'expert_a')) as a_user_autres,
       pg_temp.compte(format('select 1 from public.profiles where id = %L', :'profil_a')) as a_profil_soi,
       pg_temp.compte(format('select 1 from public.profiles where id <> %L', :'profil_a')) as a_profil_autres,
       pg_temp.compte(format('select 1 from public.candidatures where id = %L', :'cand_a')) as a_cand_soi,
       pg_temp.compte(format('select 1 from public.candidatures where id = %L', :'cand_b')) as a_cand_b,
       pg_temp.compte(format('select 1 from public.matches where id = %L', :'match_a')) as a_match_soi,
       pg_temp.compte(format('select 1 from public.matches where id = %L', :'match_b')) as a_match_b,
       pg_temp.compte(format('select 1 from public.notifications where id = %L', :'notif_a')) as a_notif_soi,
       pg_temp.compte(format('select 1 from public.notifications where id = %L', :'notif_b')) as a_notif_b,
       pg_temp.compte('select 1 from public.publications') as a_pubs,
       pg_temp.compte('select 1 from public.organizations') as a_orgs,
       pg_temp.compte('select 1 from public.grand_livre') as a_journal \gset
select pg_temp.tente(format('update public.users set user_type = %L where id = %L', 'admin', :'expert_a')) as a_promotion,
       pg_temp.tente(format('update public.profiles set title = %L where id = %L', 'Pirate', :'profil_b')) as a_maj_profil_b,
       pg_temp.tente(format('update public.profiles set title = %L where id = %L', 'Pirate', :'profil_a')) as a_maj_profil_soi,
       pg_temp.tente(format('update public.notifications set status = %L where id = %L', 'read', :'notif_b')) as a_maj_notif_b,
       pg_temp.tente(format('update public.matches set status = %L where id = %L', 'dismissed', :'match_b')) as a_maj_match_b,
       pg_temp.tente(format('delete from public.candidatures where id = %L', :'cand_b')) as a_sup_cand_b,
       pg_temp.tente(format('insert into public.candidatures (publication_id, profile_id, domain_id, status, ai_match_score, ai_assessment, ai_model) values (%L, %L, %L, %L, 9, %L::jsonb, %L)',
                            :'pub_a', :'profil_a', :'dom', 'received', '{"reason":"x","pitch_org":"x","model":"x"}', 'x')) as a_ins_cand \gset
reset role;
select is(:a_user_soi::bigint, 1::bigint, 'expert A : lit SON compte');
select is(:a_user_autres::bigint, 0::bigint, 'expert A : ne lit AUCUN autre compte');
select is(:a_profil_soi::bigint, 1::bigint, 'expert A : lit SON profil');
select is(:a_profil_autres::bigint, 0::bigint, 'expert A : ne lit aucun autre profil (expert B, CDI)');
select is(:a_cand_soi::bigint, 1::bigint, 'expert A : lit SA candidature');
select is(:a_cand_b::bigint, 0::bigint, 'expert A : ne lit pas la candidature de l''expert B');
select is(:a_match_soi::bigint, 1::bigint, 'expert A : lit SON rapprochement');
select is(:a_match_b::bigint, 0::bigint, 'expert A : ne lit pas le rapprochement de l''expert B');
select is(:a_notif_soi::bigint, 1::bigint, 'expert A : lit SA notification');
select is(:a_notif_b::bigint, 0::bigint, 'expert A : ne lit pas la notification de l''expert B');
select ok(:a_pubs <= 0 and :a_orgs <= 0, 'expert A : ne lit directement ni annonce ni organisation (le serveur les sert)');
select ok(:a_journal <= 0, 'expert A : le grand livre ne se lit pas');
select ok(:'a_promotion' not like 'ecrit%', 'expert A : se promouvoir administrateur est refusé (' || :'a_promotion' || ')');
select ok(:'a_maj_profil_b' not like 'ecrit%', 'expert A : modifier le profil de B est refusé (' || :'a_maj_profil_b' || ')');
select ok(:'a_maj_profil_soi' not like 'ecrit%', 'expert A : modifier SON profil directement est refusé — la route le fait (' || :'a_maj_profil_soi' || ')');
select ok(:'a_maj_notif_b' not like 'ecrit%', 'expert A : modifier la notification de B est refusé (' || :'a_maj_notif_b' || ')');
select ok(:'a_maj_match_b' not like 'ecrit%', 'expert A : écarter le rapprochement de B est refusé (' || :'a_maj_match_b' || ')');
select ok(:'a_sup_cand_b' not like 'ecrit%', 'expert A : supprimer la candidature de B est refusé (' || :'a_sup_cand_b' || ')');
select ok(:'a_ins_cand' not like 'ecrit%', 'expert A : écrire une candidature sans la route est refusé (' || :'a_ins_cand' || ')');

-- ════════════════════════════════════════════════════════════════════════════
-- EXPERT CDI
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'cdi', 'role', 'authenticated')::text, true) as _ \gset
select pg_temp.compte(format('select 1 from public.profiles where id = %L', :'profil_cdi')) as c_profil_soi,
       pg_temp.compte(format('select 1 from public.profiles where id in (%L, %L)', :'profil_a', :'profil_b')) as c_profils_autres,
       pg_temp.compte('select 1 from public.candidatures') as c_cands,
       pg_temp.compte('select 1 from public.matches') as c_matches \gset
select pg_temp.tente(format('update public.users set status = %L where id = %L', 'suspended', :'expert_a')) as c_suspend_a \gset
reset role;
select is(:c_profil_soi::bigint, 1::bigint, 'expert CDI : lit SON profil');
select is(:c_profils_autres::bigint, 0::bigint, 'expert CDI : ne lit pas les profils des experts freelance');
select ok(:c_cands = 0 and :c_matches = 0, 'expert CDI : ne lit ni candidature ni rapprochement d''un autre');
select ok(:'c_suspend_a' not like 'ecrit%', 'expert CDI : suspendre un autre compte est refusé (' || :'c_suspend_a' || ')');

-- ════════════════════════════════════════════════════════════════════════════
-- CLIENT A (administrateur de l'organisation A)
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'client_a', 'role', 'authenticated')::text, true) as _ \gset
select pg_temp.compte(format('select 1 from public.organizations where id = %L', :'org_a')) as ca_org_soi,
       pg_temp.compte(format('select 1 from public.organizations where id <> %L', :'org_a')) as ca_orgs_autres,
       pg_temp.compte(format('select 1 from public.publications where id = %L', :'pub_a')) as ca_pub_soi,
       pg_temp.compte(format('select 1 from public.publications where id = %L', :'pub_b')) as ca_pub_b,
       pg_temp.compte(format('select 1 from public.candidatures where id = %L', :'cand_b')) as ca_cand_recue,
       pg_temp.compte(format('select 1 from public.candidatures where id = %L', :'cand_a')) as ca_cand_chez_b,
       pg_temp.compte(format('select 1 from public.profiles where id = %L', :'profil_b')) as ca_profil_candidat,
       pg_temp.compte(format('select 1 from public.users where id = %L', :'expert_b')) as ca_user_candidat,
       pg_temp.compte(format('select 1 from public.organization_members where organization_id = %L', :'org_b')) as ca_membres_b \gset
select pg_temp.tente(format('update public.publications set title = %L where id = %L', 'Pirate', :'pub_b')) as ca_maj_pub_b,
       pg_temp.tente(format('update public.publications set title = %L where id = %L', 'Directe', :'pub_a')) as ca_maj_pub_soi,
       pg_temp.tente(format('update public.organizations set company_name = %L where id = %L', 'Pirate', :'org_b')) as ca_maj_org_b,
       pg_temp.tente(format('insert into public.organization_members (organization_id, user_id, role_in_org, status) values (%L, %L, %L, %L)',
                            :'org_b', :'client_a', 'admin', 'active')) as ca_entree_org_b,
       pg_temp.tente(format('update public.candidatures set status = %L where id = %L', 'selected', :'cand_a')) as ca_maj_cand_b \gset
reset role;
select is(:ca_org_soi::bigint, 1::bigint, 'client A : lit SON organisation');
select is(:ca_orgs_autres::bigint, 0::bigint, 'client A : ne lit aucune autre organisation (client B, cabinet, ESN)');
select is(:ca_pub_soi::bigint, 1::bigint, 'client A : lit SON annonce');
select is(:ca_pub_b::bigint, 0::bigint, 'client A : ne lit pas l''annonce du client B');
select is(:ca_cand_recue::bigint, 1::bigint, 'client A : lit la candidature REÇUE sur son annonce');
select is(:ca_cand_chez_b::bigint, 0::bigint, 'client A : ne lit pas une candidature déposée chez le client B');
select is(:ca_profil_candidat::bigint, 0::bigint, 'client A : ne lit pas le profil du candidat avant le dévoilement (RGPD)');
select is(:ca_user_candidat::bigint, 0::bigint, 'client A : ne lit pas le compte du candidat (adresse, téléphone)');
select is(:ca_membres_b::bigint, 0::bigint, 'client A : ne lit pas les membres de l''organisation B');
select ok(:'ca_maj_pub_b' not like 'ecrit%', 'client A : modifier l''annonce de B est refusé (' || :'ca_maj_pub_b' || ')');
select ok(:'ca_maj_pub_soi' not like 'ecrit%', 'client A : modifier SON annonce sans la route est refusé (' || :'ca_maj_pub_soi' || ')');
select ok(:'ca_maj_org_b' not like 'ecrit%', 'client A : modifier l''organisation B est refusé (' || :'ca_maj_org_b' || ')');
select ok(:'ca_entree_org_b' not like 'ecrit%', 'client A : s''ajouter membre de l''organisation B est refusé (' || :'ca_entree_org_b' || ')');
select ok(:'ca_maj_cand_b' not like 'ecrit%', 'client A : retenir une candidature déposée chez B est refusé (' || :'ca_maj_cand_b' || ')');

-- ════════════════════════════════════════════════════════════════════════════
-- CLIENT B, CABINET, ESN — chacun dans SON organisation
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'client_b', 'role', 'authenticated')::text, true) as _ \gset
select pg_temp.compte(format('select 1 from public.publications where id = %L', :'pub_a')) as cb_pub_a,
       pg_temp.compte(format('select 1 from public.candidatures where id = %L', :'cand_a')) as cb_cand_recue,
       pg_temp.compte(format('select 1 from public.candidatures where id = %L', :'cand_b')) as cb_cand_chez_a \gset
reset role;
select is(:cb_pub_a::bigint, 0::bigint, 'client B : ne lit pas l''annonce du client A');
select is(:cb_cand_recue::bigint, 1::bigint, 'client B : lit la candidature reçue sur son annonce');
select is(:cb_cand_chez_a::bigint, 0::bigint, 'client B : ne lit pas une candidature déposée chez le client A');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'cabinet', 'role', 'authenticated')::text, true) as _ \gset
select pg_temp.compte(format('select 1 from public.organizations where id = %L', :'org_cab')) as cab_org_soi,
       pg_temp.compte(format('select 1 from public.organizations where id <> %L', :'org_cab')) as cab_orgs_autres,
       pg_temp.compte('select 1 from public.publications') as cab_pubs,
       pg_temp.compte('select 1 from public.candidatures') as cab_cands \gset
reset role;
select is(:cab_org_soi::bigint, 1::bigint, 'cabinet : lit SON organisation');
select is(:cab_orgs_autres::bigint, 0::bigint, 'cabinet : ne lit aucune autre organisation');
select ok(:cab_pubs = 0 and :cab_cands = 0, 'cabinet : ne lit ni les annonces ni les candidatures des clients');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'esn', 'role', 'authenticated')::text, true) as _ \gset
select pg_temp.compte(format('select 1 from public.organizations where id = %L', :'org_esn')) as esn_org_soi,
       pg_temp.compte(format('select 1 from public.organizations where id <> %L', :'org_esn')) as esn_orgs_autres,
       pg_temp.compte('select 1 from public.publications') as esn_pubs,
       pg_temp.compte('select 1 from public.candidatures') as esn_cands \gset
select pg_temp.tente(format('update public.organizations set company_name = %L where id = %L', 'Pirate', :'org_cab')) as esn_maj_cab \gset
reset role;
select is(:esn_org_soi::bigint, 1::bigint, 'ESN : lit SON organisation');
select is(:esn_orgs_autres::bigint, 0::bigint, 'ESN : ne lit aucune autre organisation (le cabinet compris)');
select ok(:esn_pubs = 0 and :esn_cands = 0, 'ESN : ne lit ni les annonces ni les candidatures des clients');
select ok(:'esn_maj_cab' not like 'ecrit%', 'ESN : modifier l''organisation du cabinet est refusé (' || :'esn_maj_cab' || ')');

-- ════════════════════════════════════════════════════════════════════════════
-- ADMINISTRATEUR — son pouvoir passe par le SERVEUR, jamais par l'API de données
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin', 'role', 'authenticated')::text, true) as _ \gset
select pg_temp.compte('select 1 from public.users') as ad_users,
       pg_temp.compte('select 1 from public.profiles') as ad_profils,
       pg_temp.compte('select 1 from public.candidatures') as ad_cands,
       pg_temp.compte('select 1 from public.publications') as ad_pubs,
       pg_temp.compte('select 1 from public.grand_livre') as ad_journal \gset
select pg_temp.tente(format('update public.users set status = %L where id = %L', 'suspended', :'expert_b')) as ad_suspend_b,
       pg_temp.tente(format('update public.organizations set verification_status = %L where id = %L', 'approved', :'org_cab')) as ad_approuve_cab \gset
reset role;
select is(:ad_users::bigint, 1::bigint, 'administrateur, par l''API de données : ne lit que SON compte');
select ok(:ad_profils = 0 and :ad_cands = 0 and :ad_pubs = 0, 'administrateur, par l''API de données : ni profil, ni candidature, ni annonce');
select ok(:ad_journal <= 0, 'administrateur, par l''API de données : le grand livre ne se lit pas (l''écran passe par le serveur)');
select ok(:'ad_suspend_b' not like 'ecrit%', 'administrateur, par l''API de données : suspendre est refusé — la route le fait (' || :'ad_suspend_b' || ')');
select ok(:'ad_approuve_cab' not like 'ecrit%', 'administrateur, par l''API de données : approuver une organisation est refusé (' || :'ad_approuve_cab' || ')');

-- ════════════════════════════════════════════════════════════════════════════
-- APRÈS COUP, en postgres : RIEN n'a changé
-- ════════════════════════════════════════════════════════════════════════════
select is((select u.user_type from public.users u where u.id = :'expert_a'), 'expert_freelance', 'après coup : l''expert A est toujours expert freelance');
select ok((select u.first_name is distinct from 'Pirate' and u.status is distinct from 'suspended' from public.users u where u.id = :'expert_a'),
          'après coup : le compte de l''expert A est intact');
select is((select u.status from public.users u where u.id = :'expert_b'), (select u.status from public.users u where u.id = :'expert_a'),
          'après coup : l''expert B n''est pas suspendu');
select ok(not exists (select 1 from public.profiles p where p.title = 'Pirate'), 'après coup : aucun profil n''a été réécrit');
select ok(not exists (select 1 from public.candidatures c where c.publication_id = :'pub_a' and c.profile_id in (:'profil_a', :'profil_cdi')),
          'après coup : aucune candidature n''a été écrite sans la route');
select ok(exists (select 1 from public.candidatures c where c.id = :'cand_b') and
          (select c.status from public.candidatures c where c.id = :'cand_a') is distinct from 'selected',
          'après coup : les candidatures sont intactes (ni supprimée, ni retenue)');
select ok((select n.status from public.notifications n where n.id = :'notif_b') is distinct from 'read'
          and (select m.status from public.matches m where m.id = :'match_b') = 'notified',
          'après coup : la notification et le rapprochement de B sont intacts');
select ok(not exists (select 1 from public.publications p where p.id in (:'pub_a', :'pub_b') and p.title in ('Pirate', 'Directe'))
          and not exists (select 1 from public.organizations o where o.company_name = 'Pirate'),
          'après coup : aucune annonce ni organisation n''a été réécrite');
select ok(not exists (select 1 from public.organization_members m where m.organization_id = :'org_b' and m.user_id = :'client_a')
          and (select o.verification_status from public.organizations o where o.id = :'org_cab') is distinct from 'approved',
          'après coup : le client A n''est pas entré dans l''organisation B, et l''organisation du cabinet n''a pas été approuvée');

select * from finish();
rollback;
