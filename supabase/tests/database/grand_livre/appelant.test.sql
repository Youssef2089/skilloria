-- LE VRAI APPELANT — après la fermeture des portes latérales (portes_laterales_fermees), les RPC de
-- gouvernance et d'annonce marchent-elles encore pour CELUI QUI LES APPELLE ? Les routes les appellent
-- avec le client serveur, donc en `service_role` ; le navigateur, en `authenticated`, ne les atteint pas.
-- Hypothèse du 28/09/2026 écartée ici par la preuve : chaque RPC qui journalise porte ses propres droits
-- (SECURITY DEFINER, search_path fixe) ; appelée en service_role, elle écrit et journalise ; en
-- authenticated, elle est refusée (42501), et l'écriture directe de la table ne touche rien.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(9);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_compte('entreprise');
  v_org    uuid := pg_temp.fab_organisation(v_admin);
  v_pub    uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_dom    uuid := pg_temp.fab_domaine();
  v_inv    uuid;
  v_inv2   uuid;
  v_membre uuid;
  v_ligne  uuid;
  v_p      uuid[] := array(select gen_random_uuid() from generate_series(1, 8));
  v_b      boolean;
  v_t      text;
  v_n      integer;
  v_refus  boolean := false;
begin
  -- Les fonctions qui journalisent portent leurs droits : lu dans pg_proc, pas dans les fichiers.
  return next is(
    array(select p.oid::regprocedure::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.prosrc ~ '\mjournaliser(_reglage|_verification)?\s*\('
             and p.proname <> 'journaliser'
             and (not p.prosecdef or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
           order by 1),
    array[]::text[],
    'toute fonction qui journalise est SECURITY DEFINER avec un search_path fixe');

  -- Données, par les chemins normaux (en postgres, comme le fait la fabrique).
  v_inv := (public.creer_invitation(v_p[1], null, 'utilisateur', v_admin, 'client', v_dom,
             jsonb_build_object('organization_id', v_org, 'email', 'appel+' || gen_random_uuid() || '@exemple.invalid', 'token', 'hash_a',
                                'role_in_org', 'viewer', 'expires_at', now() + interval '7 days', 'status', 'pending',
                                'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id')::uuid;
  v_inv2 := (public.creer_invitation(v_p[2], null, 'utilisateur', v_admin, 'client', v_dom,
             jsonb_build_object('organization_id', v_org, 'email', 'appel2+' || gen_random_uuid() || '@exemple.invalid', 'token', 'hash_b',
                                'role_in_org', 'viewer', 'expires_at', now() + interval '7 days', 'status', 'pending',
                                'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id')::uuid;
  v_membre := pg_temp.fab_compte('entreprise');
  v_t := (public.creer_invitation(gen_random_uuid(), null, 'utilisateur', v_admin, 'client', v_dom,
           jsonb_build_object('organization_id', v_org, 'email', (select email from public.users where id = v_membre), 'token', 'hash_c',
                              'role_in_org', 'viewer', 'expires_at', now() + interval '7 days', 'status', 'pending',
                              'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id');
  perform public.accepter_invitation(gen_random_uuid(), null, 'utilisateur', v_membre, 'client', v_dom, v_t::uuid, array['pending']);
  select m.id into v_ligne from public.organization_members m where m.organization_id = v_org and m.user_id = v_membre;

  -- ── EN service_role : ce que font les routes ──
  set local role service_role;
  execute format('select public.renvoyer_invitation(%L, null, %L, %L, %L, %L, %L, %L, array[%L], %L, now() + interval %L)',
                 v_p[3], 'utilisateur', v_admin, 'client', v_dom, v_inv, v_org, 'pending', 'jeton_appelant', '8 days') into v_b;
  reset role;
  return next ok(v_b and exists (select 1 from public.organization_invitations i where i.id = v_inv and i.token = 'jeton_appelant')
                 and pg_temp.lignes(v_p[3]) = 1,
                 'service_role : renvoyer_invitation pose le jeton et journalise');

  set local role service_role;
  execute format('select public.revoquer_invitation(%L, null, %L, %L, %L, %L, %L, %L, array[%L])',
                 v_p[4], 'utilisateur', v_admin, 'client', v_dom, v_inv2, v_org, 'pending') into v_b;
  reset role;
  return next ok(v_b and exists (select 1 from public.organization_invitations i where i.id = v_inv2 and i.status = 'revoked')
                 and pg_temp.lignes(v_p[4]) = 1,
                 'service_role : revoquer_invitation révoque et journalise');

  set local role service_role;
  execute format('select public.maj_membre_organisation(%L, null, %L, %L, %L, %L, %L, %L, null, false)',
                 v_p[5], 'utilisateur', v_admin, 'client', v_dom, v_ligne, 'editor') into v_t;
  reset role;
  return next ok(v_t = 'ok' and exists (select 1 from public.organization_members m where m.id = v_ligne and m.role_in_org = 'editor')
                 and pg_temp.lignes(v_p[5]) = 1,
                 'service_role : maj_membre_organisation change le rôle et journalise');

  set local role service_role;
  execute format('select public.maj_membre_organisation(%L, null, %L, %L, %L, %L, %L, null, %L, false)',
                 v_p[6], 'utilisateur', v_membre, 'client', v_dom, v_ligne, 'removed') into v_t;
  reset role;
  return next ok(v_t = 'ok' and exists (select 1 from public.organization_members m where m.id = v_ligne and m.status = 'removed')
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[6] and g.type_action = 'membre_parti'),
                 'service_role : quitter l''organisation (sa propre ligne) écrit membre_parti');

  set local role service_role;
  execute format('select public.cloturer_annonce(%L, null, %L, %L, %L, %L, %L, %L, array[%L])',
                 v_p[7], 'utilisateur', v_admin, 'client', v_pub, v_dom, v_org, 'published') into v_b;
  reset role;
  return next ok(v_b and exists (select 1 from public.publications p where p.id = v_pub and p.status = 'archived')
                 and pg_temp.lignes(v_p[7]) = 1,
                 'service_role : cloturer_annonce clôture et journalise');

  -- ── EN authenticated : le navigateur n'atteint ni la RPC, ni la table ──
  set local role authenticated;
  begin
    execute format('select public.renvoyer_invitation(%L, null, %L, %L, %L, %L, %L, %L, array[%L], %L, now())',
                   v_p[8], 'utilisateur', v_admin, 'client', v_dom, v_inv, v_org, 'pending', 'jeton_navigateur');
  exception when insufficient_privilege then
    v_refus := true;
  end;
  reset role;
  return next ok(v_refus and pg_temp.lignes(v_p[8]) = 0, 'authenticated : la RPC est refusée (42501), rien n''est écrit');

  v_refus := false;
  v_n := -1;
  set local role authenticated;
  begin
    execute format('update public.organization_invitations set token = %L where id = %L', 'porte_laterale', v_inv);
    get diagnostics v_n = row_count;
  exception when insufficient_privilege then
    v_refus := true;
  end;
  reset role;
  return next ok((v_refus or v_n = 0)
                 and exists (select 1 from public.organization_invitations i where i.id = v_inv and i.token = 'jeton_appelant'),
                 'authenticated : l''écriture directe de la table ne touche rien — la porte latérale est fermée');

  return next ok(pg_temp.lignes(v_p[1]) = 1, 'la création d''invitation a sa ligne (témoin de la fabrique)');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
