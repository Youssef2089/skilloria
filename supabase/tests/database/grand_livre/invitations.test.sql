-- membre_invite / invitation_revoquee / invitation_renvoyee / invitation_acceptee — creer_invitation(),
-- revoquer_invitation(), renvoyer_invitation(), accepter_invitation() : chaque geste et sa ligne, ensemble ;
-- l'adresse invitée et le jeton restent sur l'invitation, jamais dans une ligne ; autre organisation,
-- statut non admis, adresse différente : refus sans ligne ; rejeu : sans seconde ligne.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(16);

create or replace function pg_temp.inviter(p_org uuid, p_admin uuid, p_email text, p_piece uuid) returns uuid
language sql as $$
  select (public.creer_invitation(p_piece, null, 'utilisateur', p_admin, 'client', pg_temp.fab_domaine(),
            jsonb_build_object('organization_id', p_org, 'email', p_email, 'token', 'hash_' || gen_random_uuid(),
                               'role_in_org', 'viewer', 'expires_at', now() + interval '7 days', 'status', 'pending',
                               'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id')::uuid
$$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_compte('entreprise');
  v_org    uuid := pg_temp.fab_organisation(v_admin);
  v_invite uuid := pg_temp.fab_compte('entreprise');
  v_email  text;
  v_dom    uuid := pg_temp.fab_domaine();
  v_inv    uuid;
  v_inv2   uuid;
  v_inv3   uuid;
  v_p      uuid[] := array(select gen_random_uuid() from generate_series(1, 12));
  v_r      jsonb;
begin
  select u.email into v_email from public.users u where u.id = v_invite;
  -- ── membre_invite ──
  v_inv := pg_temp.inviter(v_org, v_admin, v_email, v_p[1]);
  return next ok(exists (select 1 from public.organization_invitations i where i.id = v_inv and i.email = v_email and i.status = 'pending'),
                 'membre_invite : l''invitation est écrite, l''adresse est SUR l''invitation');
  return next ok(pg_temp.lignes(v_p[1]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[1]
                  and g.type_action = 'membre_invite' and g.detail::text not like '%' || v_email || '%' and g.detail::text not like '%hash_%'),
                 'membre_invite : UNE ligne, sans l''adresse ni le jeton');
  -- ── invitation_renvoyee ──
  return next ok(not public.renvoyer_invitation(v_p[2], null, 'utilisateur', v_admin, 'client', v_dom, v_inv, gen_random_uuid(),
                                                array['pending'], 'jeton_autre', now() + interval '7 days')
                 and pg_temp.lignes(v_p[2]) = 0,
                 'invitation_renvoyee : une autre organisation ne renvoie rien');
  return next ok(public.renvoyer_invitation(v_p[3], null, 'utilisateur', v_admin, 'client', v_dom, v_inv, v_org,
                                            array['pending'], 'jeton_neuf', now() + interval '8 days')
                 and exists (select 1 from public.organization_invitations i where i.id = v_inv and i.token = 'jeton_neuf'),
                 'invitation_renvoyee : le jeton neuf est posé');
  return next ok(pg_temp.lignes(v_p[3]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[3]
                  and g.type_action = 'invitation_renvoyee' and g.detail::text not like '%jeton_neuf%'),
                 'invitation_renvoyee : UNE ligne, sans le jeton');
  return next throws_ok(format($q$select public.renvoyer_invitation(%L, null, 'utilisateur', %L, 'client', %L, %L, %L, array['pending'], 'jeton_bis', now() + interval '9 days')$q$,
                               v_p[3], v_admin, v_dom, v_inv, v_org),
                        'GL005', null, 'invitation_renvoyee : le MÊME geste ne s''écrit pas deux fois (GL005)');
  -- ── invitation_acceptee ──
  v_inv2 := pg_temp.inviter(v_org, v_admin, 'autre+' || gen_random_uuid() || '@exemple.invalid', v_p[4]);
  v_r := public.accepter_invitation(v_p[5], null, 'utilisateur', v_invite, 'client', v_dom, v_inv2, array['pending']);
  return next ok(v_r ->> 'issue' = 'email_mismatch' and pg_temp.lignes(v_p[5]) = 0,
                 'invitation_acceptee : une adresse différente est refusée, sans ligne');
  v_r := public.accepter_invitation(v_p[6], null, 'utilisateur', v_invite, 'client', v_dom, v_inv, array['pending']);
  return next is(v_r ->> 'issue', 'acceptee', 'invitation_acceptee : l''invitation est acceptée');
  return next ok(exists (select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = v_invite and m.status = 'active')
                 and exists (select 1 from public.organization_invitations i where i.id = v_inv and i.status = 'accepted' and i.accepted_at is not null),
                 'invitation_acceptee : l''appartenance ET l''invitation soldée sont relues');
  return next ok(pg_temp.lignes(v_p[6]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[6]
                  and g.type_action = 'invitation_acceptee' and (g.detail ->> 'deja_membre')::boolean = false and g.detail::text not like '%' || v_email || '%'),
                 'invitation_acceptee : UNE ligne, sans l''adresse');
  v_r := public.accepter_invitation(v_p[7], null, 'utilisateur', v_invite, 'client', v_dom, v_inv, array['pending']);
  return next ok(v_r ->> 'issue' = 'not_pending' and pg_temp.lignes(v_p[7]) = 0, 'invitation_acceptee : le rejeu est refusé, sans ligne');
  -- ── invitation_revoquee ──
  v_inv3 := pg_temp.inviter(v_org, v_admin, 'tiers+' || gen_random_uuid() || '@exemple.invalid', v_p[8]);
  return next ok(not public.revoquer_invitation(v_p[9], null, 'utilisateur', v_admin, 'client', v_dom, v_inv3, gen_random_uuid(), array['pending'])
                 and exists (select 1 from public.organization_invitations i where i.id = v_inv3 and i.status = 'pending')
                 and pg_temp.lignes(v_p[9]) = 0,
                 'invitation_revoquee : une autre organisation ne révoque rien');
  return next ok(public.revoquer_invitation(v_p[10], null, 'utilisateur', v_admin, 'client', v_dom, v_inv3, v_org, array['pending'])
                 and exists (select 1 from public.organization_invitations i where i.id = v_inv3 and i.status = 'revoked'),
                 'invitation_revoquee : l''invitation est révoquée');
  return next ok(pg_temp.lignes(v_p[10]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[10]
                  and g.type_action = 'invitation_revoquee' and g.detail ->> 'de' = 'pending' and g.detail ->> 'vers' = 'revoked'),
                 'invitation_revoquee : UNE ligne, d''où et vers où');
  return next ok(not public.revoquer_invitation(v_p[11], null, 'utilisateur', v_admin, 'client', v_dom, v_inv3, v_org, array['pending'])
                 and pg_temp.lignes(v_p[11]) = 0,
                 'invitation_revoquee : le rejeu rend false, sans ligne');
  return next ok(not exists (select 1 from public.grand_livre g where g.piece = any (v_p) and g.detail::text like '%@exemple.invalid%'),
                 'aucune ligne de ces gestes ne porte une adresse');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
