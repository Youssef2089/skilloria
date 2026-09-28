-- LE VRAI APPELANT — les RPC de gouvernance et d'annonce, appelées COMME PostgREST les appelle.
--
-- La propriété (inchangée depuis grand_livre/appelant.test.sql) : chaque RPC qui journalise porte ses
-- propres droits (SECURITY DEFINER, search_path fixe) ; appelée en `service_role` (les routes), elle écrit
-- et journalise ; en `authenticated` (le navigateur), la RPC est refusée (42501), l'écriture directe d'une
-- table journalisée ne touche rien, et écrire `profiles` est refusé (42501, droit retiré en T.4).
--
-- POURQUOI CETTE FORME (28/09/2026). La version précédente faisait tout DANS une fonction plpgsql
-- (`pg_temp.essai()`) : `set local role service_role` puis `authenticated`, `reset role`, des `execute` de
-- RPC SECURITY DEFINER, des blocs d'exception. Le serveur local a PLANTÉ (signal 11) sur
-- `select * from pg_temp.essai();` — un journal qui ne désigne rien. Ici :
--   · chaque changement d'identité est une INSTRUCTION de premier niveau, jamais dans une fonction —
--     exactement ce que fait PostgREST (`set local role …` puis l'appel, dans la transaction de la requête) ;
--   · chaque appel de RPC est UNE instruction : si le serveur plante, le journal (« Failed process was
--     running: … ») nomme l'appel fautif ;
--   · ce fichier vit dans `vrai_appelant/` pour passer EN DERNIER (ordre alphabétique des chemins, observé
--     le 28/09/2026) : un plantage ici ne prive plus les autres fichiers de leur verdict. Gardé par
--     diag-tests-grand-livre (J).
-- Ce que le prochain passage tranchera : si ce fichier passe, la cause était la FORME de l'ancien test
-- (le changement de rôle dans une fonction — voir supabase/verifications/repro-segfault-appelant.sql) ;
-- s'il plante, le journal nomme la RPC, et c'est un défaut du PRODUIT (docs/reprise.md, lot C).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(11);

-- ── Les données, en postgres, par les chemins normaux (fabriques) ──
select pg_temp.fab_compte('entreprise') as admin \gset
select pg_temp.fab_organisation(:'admin') as org \gset
select pg_temp.fab_annonce_publiee(:'org', :'admin') as pub \gset
select pg_temp.fab_domaine() as dom \gset
select pg_temp.fab_compte('entreprise') as membre \gset
select gen_random_uuid() as p1, gen_random_uuid() as p2, gen_random_uuid() as p3, gen_random_uuid() as p4,
       gen_random_uuid() as p5, gen_random_uuid() as p6, gen_random_uuid() as p7, gen_random_uuid() as p8,
       gen_random_uuid() as p9 \gset
select public.creer_invitation(:'p1', null, 'utilisateur', :'admin', 'client', :'dom',
         jsonb_build_object('organization_id', :'org'::uuid, 'email', 'appel+' || gen_random_uuid() || '@exemple.invalid',
                            'token', 'hash_a', 'role_in_org', 'viewer', 'expires_at', now() + interval '7 days',
                            'status', 'pending', 'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id' as inv \gset
select public.creer_invitation(:'p2', null, 'utilisateur', :'admin', 'client', :'dom',
         jsonb_build_object('organization_id', :'org'::uuid, 'email', 'appel2+' || gen_random_uuid() || '@exemple.invalid',
                            'token', 'hash_b', 'role_in_org', 'viewer', 'expires_at', now() + interval '7 days',
                            'status', 'pending', 'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id' as inv2 \gset
select public.creer_invitation(:'p9', null, 'utilisateur', :'admin', 'client', :'dom',
         jsonb_build_object('organization_id', :'org'::uuid, 'email', (select u.email from public.users u where u.id = :'membre'),
                            'token', 'hash_c', 'role_in_org', 'viewer', 'expires_at', now() + interval '7 days',
                            'status', 'pending', 'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id' as inv3 \gset
select public.accepter_invitation(gen_random_uuid(), null, 'utilisateur', :'membre', 'client', :'dom', :'inv3', array['pending']) ->> 'issue' as accepte \gset
select m.id as ligne from public.organization_members m where m.organization_id = :'org' and m.user_id = :'membre' \gset

-- ① Les fonctions qui journalisent portent leurs droits — lu dans pg_proc.
select is(
  array(select p.oid::regprocedure::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.prosrc ~ '\mjournaliser(_reglage|_verification)?\s*\('
           and p.proname <> 'journaliser'
           and (not p.prosecdef or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
         order by 1),
  array[]::text[],
  'toute fonction qui journalise est SECURITY DEFINER avec un search_path fixe');
select is(:'accepte', 'acceptee', 'témoin : le membre est entré par une invitation acceptée');

-- ── EN service_role : ce que font les routes. Une instruction par appel. ──
set local role service_role;
select public.renvoyer_invitation(:'p3', null, 'utilisateur', :'admin', 'client', :'dom', :'inv', :'org',
                                  array['pending'], 'jeton_appelant', now() + interval '8 days') as renvoi \gset
reset role;
select ok(:'renvoi'::boolean
          and exists (select 1 from public.organization_invitations i where i.id = :'inv' and i.token = 'jeton_appelant')
          and pg_temp.lignes(:'p3') = 1,
          'service_role : renvoyer_invitation pose le jeton et journalise');

set local role service_role;
select public.revoquer_invitation(:'p4', null, 'utilisateur', :'admin', 'client', :'dom', :'inv2', :'org', array['pending']) as revocation \gset
reset role;
select ok(:'revocation'::boolean
          and exists (select 1 from public.organization_invitations i where i.id = :'inv2' and i.status = 'revoked')
          and pg_temp.lignes(:'p4') = 1,
          'service_role : revoquer_invitation révoque et journalise');

set local role service_role;
select public.maj_membre_organisation(:'p5', null, 'utilisateur', :'admin', 'client', :'dom', :'ligne', 'editor', null, false) as role_change \gset
reset role;
select ok(:'role_change' = 'ok'
          and exists (select 1 from public.organization_members m where m.id = :'ligne' and m.role_in_org = 'editor')
          and pg_temp.lignes(:'p5') = 1,
          'service_role : maj_membre_organisation change le rôle et journalise');

set local role service_role;
select public.maj_membre_organisation(:'p6', null, 'utilisateur', :'membre', 'client', :'dom', :'ligne', null, 'removed', false) as depart \gset
reset role;
select ok(:'depart' = 'ok'
          and exists (select 1 from public.organization_members m where m.id = :'ligne' and m.status = 'removed')
          and exists (select 1 from public.grand_livre g where g.piece = :'p6' and g.type_action = 'membre_parti'),
          'service_role : quitter l''organisation (sa propre ligne) écrit membre_parti');

set local role service_role;
select public.cloturer_annonce(:'p7', null, 'utilisateur', :'admin', 'client', :'pub', :'dom', :'org', array['published']) as cloture \gset
reset role;
select ok(:'cloture'::boolean
          and exists (select 1 from public.publications p where p.id = :'pub' and p.status = 'archived')
          and pg_temp.lignes(:'p7') = 1,
          'service_role : cloturer_annonce clôture et journalise');

-- ── EN authenticated : le navigateur n'atteint ni la RPC, ni la table. Une instruction par tentative. ──
set local role authenticated;
select throws_ok(format('select public.renvoyer_invitation(%L, null, %L, %L, %L, %L, %L, %L, array[%L], %L, now())',
                        :'p8', 'utilisateur', :'admin', 'client', :'dom', :'inv', :'org', 'pending', 'jeton_navigateur'),
                 '42501', null, 'authenticated : la RPC est refusée (42501)');
with porte as (update public.organization_invitations set token = 'porte_laterale' where id = :'inv' returning 1)
select count(*) as porte from porte \gset
select throws_ok(format('update public.profiles set availability_status = %L where user_id = %L', 'available', :'admin'),
                 '42501', null, 'authenticated : écrire profiles est refusé (42501) — un onglet périmé échoue bruyamment');
reset role;
select is(pg_temp.lignes(:'p8'), 0::bigint, 'authenticated : la RPC refusée n''a rien journalisé');
select ok(:porte = 0
          and exists (select 1 from public.organization_invitations i where i.id = :'inv' and i.token = 'jeton_appelant'),
          'authenticated : l''écriture directe de la table ne touche rien — la porte latérale est fermée');

select * from finish();
rollback;
