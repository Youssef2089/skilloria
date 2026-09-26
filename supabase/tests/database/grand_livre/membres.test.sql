-- role_membre_change / membre_retire / membre_parti — maj_membre_organisation() : une fonction, trois faces,
-- le code DÉRIVÉ du geste ; un changement sans action est refusé avant d'écrire ; un geste sans changement
-- n'écrit rien ; l'ancienne signature n'existe plus. Le membre entre par le chemin normal (invitation acceptée).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(8);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_compte('entreprise');
  v_org    uuid := pg_temp.fab_organisation(v_admin);
  v_membre uuid := pg_temp.fab_compte('entreprise');
  v_dom    uuid := pg_temp.fab_domaine();
  v_inv    uuid;
  v_ligne  uuid;
  v_p      uuid[] := array(select gen_random_uuid() from generate_series(1, 8));
begin
  v_inv := (public.creer_invitation(v_p[1], null, 'utilisateur', v_admin, 'client', v_dom,
             jsonb_build_object('organization_id', v_org, 'email', (select email from public.users where id = v_membre), 'token', 'hash_m',
                                'role_in_org', 'viewer', 'expires_at', now() + interval '7 days', 'status', 'pending',
                                'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id')::uuid;
  perform public.accepter_invitation(v_p[2], null, 'utilisateur', v_membre, 'client', v_dom, v_inv, array['pending']);
  select m.id into v_ligne from public.organization_members m where m.organization_id = v_org and m.user_id = v_membre;

  return next ok(to_regprocedure('public.maj_membre_organisation(uuid, character varying, character varying, boolean)') is null,
                 'l''ancienne signature, sans journal, n''existe plus');
  return next throws_ok(format($q$select public.maj_membre_organisation(%L, null, 'utilisateur', %L, 'client', %L, %L, null, 'suspended', false)$q$,
                               v_p[3], v_admin, v_dom, v_ligne),
                        '22023', null, 'un changement sans action au grand livre est refusé avant d''écrire');
  return next ok(public.maj_membre_organisation(v_p[4], null, 'utilisateur', v_admin, 'client', v_dom, v_ligne, 'viewer', null, false) = 'inchange'
                 and pg_temp.lignes(v_p[4]) = 0,
                 'un geste sans changement n''écrit rien');
  return next ok(public.maj_membre_organisation(v_p[5], null, 'utilisateur', v_admin, 'client', v_dom, v_ligne, 'editor', null, false) = 'ok'
                 and pg_temp.lignes(v_p[5]) = 1
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[5] and g.type_action = 'role_membre_change'
                              and g.detail ->> 'role_de' = 'viewer' and g.detail ->> 'role_vers' = 'editor'),
                 'role_membre_change : le rôle change, UNE ligne, de/vers');
  return next ok(public.maj_membre_organisation(v_p[6], null, 'utilisateur', v_admin, 'client', v_dom, v_ligne, null, 'removed', false) = 'ok'
                 and pg_temp.lignes(v_p[6]) = 1
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[6] and g.type_action = 'membre_retire'),
                 'membre_retire : la ligne d''un AUTRE passe à removed → retrait, UNE ligne');
  return next ok(public.maj_membre_organisation(v_p[7], null, 'utilisateur', v_admin, 'client', v_dom, v_ligne, null, 'removed', false) = 'inchange'
                 and pg_temp.lignes(v_p[7]) = 0,
                 'le retrait rejoué rend « inchangé », sans seconde ligne');
  -- Le membre revient (chemin normal : une nouvelle invitation acceptée), puis PART de lui-même.
  v_inv := (public.creer_invitation(gen_random_uuid(), null, 'utilisateur', v_admin, 'client', v_dom,
             jsonb_build_object('organization_id', v_org, 'email', (select email from public.users where id = v_membre), 'token', 'hash_m2',
                                'role_in_org', 'viewer', 'expires_at', now() + interval '7 days', 'status', 'pending',
                                'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id')::uuid;
  perform public.accepter_invitation(gen_random_uuid(), null, 'utilisateur', v_membre, 'client', v_dom, v_inv, array['pending']);
  return next ok(exists (select 1 from public.organization_members m where m.id = v_ligne and m.status = 'active'),
                 'le membre est réintégré par l''acceptation');
  return next ok(public.maj_membre_organisation(v_p[8], null, 'utilisateur', v_membre, 'client', v_dom, v_ligne, null, 'removed', false) = 'ok'
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[8] and g.type_action = 'membre_parti' and g.acteur_id = v_membre)
                 and pg_temp.lignes(v_p[8]) = 1,
                 'membre_parti : sa PROPRE ligne passe à removed → départ, UNE ligne');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
