-- LA PORTE D'INSCRIPTION (§D.27) — par le VRAI chemin : une ligne dans auth.users, le trigger
-- on_auth_user_created → handle_new_user, sur des données FABRIQUÉES (adresses en .invalid, rien de réel).
--   A. le contrat avec lib/inscription/preuve.mjs : la chaîne signée et le HMAC (vecteur rejoué par
--      diag-porte-inscription côté Node) ;
--   B. la preuve : absente (l'appel direct), expirée, altérée, pour une autre adresse, forgée ; la rotation ;
--   C. chaque voie avec une preuve valide, et ce qu'elle écrit DANS LA MÊME TRANSACTION : téléphone vérifié,
--      CGU (version et date), l'organisation née avec son compte, l'invitation acceptée, l'administrateur promu,
--      et la ligne compte_cree accompagnée de sa ligne SŒUR sous la même pièce ;
--   D. les refus d'une voie ; E. les règles d'inscription, écrites une fois (inscription_refus) — un refus ne
--      laisse RIEN : ni compte auth, ni miroir, ni organisation, ni ligne.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(43);

-- Tente une création et rend son issue : 'cree', ou « SQLSTATE message ».
create or replace function pg_temp.tenter(p_id uuid, p_email text, p_meta jsonb, p_confirme boolean default false) returns text
language plpgsql as $$
begin
  perform pg_temp.fab_auth(p_id, p_email, p_meta, p_confirme);
  return 'cree';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- Rien n'existe pour cet identifiant : ni compte auth, ni miroir, ni organisation dont il serait membre, ni ligne.
create or replace function pg_temp.rien(p_id uuid) returns boolean
language sql as $$
  select not exists (select 1 from auth.users a where a.id = p_id)
     and not exists (select 1 from public.users u where u.id = p_id)
     and not exists (select 1 from public.organization_members m where m.user_id = p_id)
     and not exists (select 1 from public.grand_livre g where g.sujet_id = p_id or g.acteur_id = p_id)
$$;

-- Une inscription signée, pour un identifiant et un rôle, avec des champs remplacés AVANT la signature.
create or replace function pg_temp.signee(p_id uuid, p_role text, p_remplace jsonb default '{}'::jsonb) returns jsonb
language sql as $$
  select pg_temp.fab_signer(pg_temp.fab_email(p_id), pg_temp.fab_meta(p_role, p_id) || p_remplace)
$$;

-- L'organisation dont un compte est membre.
create or replace function pg_temp.org_de(p_user uuid) returns uuid
language sql as $$ select m.organization_id from public.organization_members m where m.user_id = p_user limit 1 $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  -- ── A. le vecteur du contrat (diag-porte-inscription relit ces quatre lignes) ──
  v_vecteur_email   text := 'Sonde@Exemple.INVALID';
  v_vecteur_meta    jsonb := '{"role":"expert","domain_slug":"eco-sonde","voie":"inscription_expert","piece":"00000000-0000-4000-8000-000000000001","preuve_expire_a":"2000000000","cgu_version":"2026-09","telephone":"+33600000000"}';
  v_vecteur_attendu text := E'v1\nsonde@exemple.invalid\nexpert\neco-sonde\ninscription_expert\n00000000-0000-4000-8000-000000000001\n2000000000\n2026-09\n+33600000000\n\n\n';
  v_vecteur_hmac    text := '51cd8d9784b66132fd9b3a2601bd79cefd1966054fa212658ee9e0e4bc2f458a';
  v_dom     uuid := pg_temp.fab_domaine();
  v_slug    text;
  v_admin   uuid := pg_temp.fab_admin();
  v_client  uuid := pg_temp.fab_compte('entreprise');
  v_ids     uuid[] := array(select gen_random_uuid() from generate_series(1, 40));
  v_m       jsonb;
  v_org     uuid;
  v_inv     uuid;
  v_email   text;
  v_pays    text;
  v_min     integer;
  v_max     integer;
  v_siren   text;
  v_piece   uuid;
  v_ancien  text;
begin
  select d.slug into v_slug from public.domains d where d.id = v_dom;

  -- ═══ A. LE CONTRAT ═══════════════════════════════════════════════════════
  return next is(public.preuve_inscription_canonique(v_vecteur_email, v_vecteur_meta), v_vecteur_attendu,
                 'contrat : la chaîne signée — v1, l''adresse en minuscules, dix champs dans l''ordre, les absents vides');
  return next is(encode(extensions.hmac(v_vecteur_attendu, 'cle-de-vecteur', 'sha256'), 'hex'), v_vecteur_hmac,
                 'contrat : le HMAC-SHA256 de la base est celui de Node (même vecteur)');

  -- ═══ B. LA PREUVE ════════════════════════════════════════════════════════
  v_m := pg_temp.fab_meta('expert', v_ids[1]);
  return next ok(pg_temp.tenter(v_ids[1], pg_temp.fab_email(v_ids[1]), v_m) = 'IN007 inscription refusee : preuve_absente'
                 and pg_temp.rien(v_ids[1]),
                 'l''appel DIRECT (métadonnées parfaites, sans preuve) : IN007, et rien n''existe');
  v_m := pg_temp.fab_signer(pg_temp.fab_email(v_ids[2]), pg_temp.fab_meta('expert', v_ids[2]), interval '-1 minute');
  return next ok(pg_temp.tenter(v_ids[2], pg_temp.fab_email(v_ids[2]), v_m) = 'IN009 inscription refusee : preuve_expiree'
                 and pg_temp.rien(v_ids[2]),
                 'une preuve EXPIRÉE : IN009, et rien n''existe');
  v_m := pg_temp.signee(v_ids[3], 'expert') || '{"role":"cdi"}'::jsonb;
  return next ok(pg_temp.tenter(v_ids[3], pg_temp.fab_email(v_ids[3]), v_m) = 'IN008 inscription refusee : preuve_invalide'
                 and pg_temp.rien(v_ids[3]),
                 'une preuve ALTÉRÉE (le rôle changé après signature) : IN008, et rien n''existe');
  v_m := pg_temp.signee(v_ids[4], 'expert');
  return next ok(pg_temp.tenter(v_ids[4], pg_temp.fab_email(v_ids[5]), v_m) = 'IN008 inscription refusee : preuve_invalide'
                 and pg_temp.rien(v_ids[4]),
                 'une preuve pour une AUTRE ADRESSE : IN008 — elle ne sert pas pour une autre boîte');
  v_m := pg_temp.signee(v_ids[6], 'expert') || jsonb_build_object('preuve', encode(extensions.gen_random_bytes(32), 'hex'));
  return next ok(pg_temp.tenter(v_ids[6], pg_temp.fab_email(v_ids[6]), v_m) = 'IN008 inscription refusee : preuve_invalide'
                 and pg_temp.rien(v_ids[6]),
                 'une preuve FORGÉE (sans le secret) : IN008');
  -- La rotation : l'ancien secret, gardé sous « _precedent », vaut encore le temps du déploiement.
  v_ancien := 'ancien-secret-de-sonde-0123456789abcdef-rotation';
  if not exists (select 1 from vault.secrets s where s.name = 'inscription_hmac_secret_precedent') then
    perform vault.create_secret(v_ancien, 'inscription_hmac_secret_precedent');
  else
    select s.decrypted_secret into v_ancien from vault.decrypted_secrets s where s.name = 'inscription_hmac_secret_precedent';
  end if;
  v_m := pg_temp.fab_meta('expert', v_ids[7]) || jsonb_build_object('preuve_expire_a', floor(extract(epoch from now() + interval '5 minutes'))::bigint::text);
  v_m := v_m || jsonb_build_object('preuve', encode(extensions.hmac(public.preuve_inscription_canonique(pg_temp.fab_email(v_ids[7]), v_m), v_ancien, 'sha256'), 'hex'));
  return next is(pg_temp.tenter(v_ids[7], pg_temp.fab_email(v_ids[7]), v_m), 'cree',
                 'rotation : une preuve signée par le secret PRÉCÉDENT est acceptée tant qu''il existe');
  return next ok(public.preuve_inscription_refus(pg_temp.fab_email(v_ids[8]), pg_temp.signee(v_ids[8], 'expert')) is null
                 and public.preuve_inscription_refus(pg_temp.fab_email(v_ids[8]), pg_temp.fab_meta('expert', v_ids[8])) = 'preuve_absente',
                 'preuve_inscription_refus : null sur une preuve valide, un code sinon');
  return next ok(not has_function_privilege('service_role', 'public.preuve_inscription_signature(text, boolean)', 'execute')
                 and not has_function_privilege('authenticated', 'public.preuve_inscription_signature(text, boolean)', 'execute')
                 and not has_function_privilege('service_role', 'public.preuve_inscription_refus(text, jsonb)', 'execute')
                 and not has_function_privilege('anon', 'public.preuve_inscription_canonique(text, jsonb)', 'execute')
                 and has_function_privilege('service_role', 'public.inscription_refus(text, jsonb)', 'execute')
                 and not has_function_privilege('anon', 'public.inscription_refus(text, jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'public.inscription_refus(text, jsonb)', 'execute')
                 and has_function_privilege('service_role', 'public.numero_identification_refus(text, text)', 'execute')
                 and not has_function_privilege('authenticated', 'public.numero_identification_refus(text, text)', 'execute'),
                 'droits : le secret ne se lit par personne (pas même la clé de service) ; la règle, par la clé de service seule');

  -- ═══ C. CHAQUE VOIE, AVEC SA PREUVE, ET CE QU'ELLE ÉCRIT ═══════════════════
  -- ── l'expert freelance ──
  v_m := pg_temp.signee(v_ids[9], 'expert');
  v_piece := (v_m ->> 'piece')::uuid;
  perform pg_temp.fab_auth(v_ids[9], pg_temp.fab_email(v_ids[9]), v_m, false);
  return next ok(exists (select 1 from public.users u where u.id = v_ids[9] and u.user_type = 'expert_freelance'
                          and u.status = 'draft' and not u.email_verified
                          and u.phone = pg_temp.fab_telephone(v_ids[9]) and u.phone_verified
                          and u.cgu_version = 'sonde' and u.cgu_accepted_at = now())
                 and exists (select 1 from public.profiles p where p.user_id = v_ids[9] and p.speciality_other = 'Sonde'
                              and p.branch_id = (v_m ->> 'branch_id')::uuid),
                 'expert : le compte (brouillon), le téléphone VÉRIFIÉ et les CGU (version, date) écrits avec lui ; le profil');
  return next ok(pg_temp.lignes(v_piece) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_piece and g.type_action = 'compte_cree'
                              and g.acteur_id = v_ids[9] and g.detail ->> 'voie_declaree' = 'inscription_expert')
                 and exists (select 1 from public.grand_livre g where g.piece = v_piece and g.type_action = 'expert_inscrit'
                              and g.statut = 'reussi' and g.acteur_type = 'expert_freelance' and g.detail ->> 'cgu_version' = 'sonde'),
                 'expert : compte_cree ET sa ligne sœur expert_inscrit, sous la MÊME pièce');
  -- ── l'expert CDI ──
  v_m := pg_temp.signee(v_ids[10], 'cdi');
  perform pg_temp.fab_auth(v_ids[10], pg_temp.fab_email(v_ids[10]), v_m, false);
  return next ok(exists (select 1 from public.users u where u.id = v_ids[10] and u.user_type = 'expert_cdi' and u.phone_verified)
                 and pg_temp.lignes((v_m ->> 'piece')::uuid) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = (v_m ->> 'piece')::uuid and g.type_action = 'expert_inscrit'
                              and g.detail ->> 'type_de_compte' = 'expert_cdi'),
                 'CDI : le compte, et la paire sous la même pièce');
  -- ── le client : l'organisation NAÎT avec son compte ──
  v_m := pg_temp.signee(v_ids[11], 'entreprise');
  v_piece := (v_m ->> 'piece')::uuid;
  perform pg_temp.fab_auth(v_ids[11], pg_temp.fab_email(v_ids[11]), v_m, false);
  v_org := pg_temp.org_de(v_ids[11]);
  return next ok(v_org is not null
                 and exists (select 1 from public.organizations o where o.id = v_org and o.org_type = 'client'
                              and o.company_name = 'Sonde SAS' and o.email_domain = v_ids[11] || '.invalid'
                              and o.verification_status = 'pending_provider_check')
                 and exists (select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = v_ids[11]
                              and m.role_in_org = 'admin' and m.status = 'active')
                 and exists (select 1 from public.organization_domains od where od.organization_id = v_org and od.domain_id = v_dom and od.active)
                 and exists (select 1 from public.users u where u.id = v_ids[11] and u.user_type = 'client' and u.phone_verified
                              and u.cgu_version = 'sonde'),
                 'client : l''organisation, son administrateur et son écosystème naissent AVEC le compte (téléphone, CGU)');
  return next ok(pg_temp.lignes(v_piece) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_piece and g.type_action = 'organisation_preinscrite'
                              and g.sujet_type = 'organizations' and g.sujet_id = v_org
                              and g.detail ->> 'org_type' = 'client' and not (g.detail ->> 'domaine_public')::boolean),
                 'client : compte_cree ET organisation_preinscrite (sujet l''organisation) sous la MÊME pièce');
  -- ── l'ESN : le compte est un cabinet, l'organisation esn ──
  v_m := pg_temp.signee(v_ids[12], 'cabinet', '{"org_type":"esn"}');
  perform pg_temp.fab_auth(v_ids[12], pg_temp.fab_email(v_ids[12]), v_m, false);
  return next ok(exists (select 1 from public.users u where u.id = v_ids[12] and u.user_type = 'cabinet')
                 and exists (select 1 from public.organizations o where o.id = pg_temp.org_de(v_ids[12]) and o.org_type = 'esn'),
                 'ESN : un compte cabinet, une organisation esn');
  -- ── un domaine PUBLIC ne se réserve pas ──
  v_email := 'sonde@public-' || v_ids[13] || '.invalid';
  perform public.regler_domaine_adresse(gen_random_uuid(), v_admin, v_dom, 'publics', 'public-' || v_ids[13] || '.invalid', true, 'sonde');
  perform pg_temp.fab_auth(v_ids[13], v_email, pg_temp.fab_signer(v_email, pg_temp.fab_meta('entreprise', v_ids[13])), false);
  return next ok(exists (select 1 from public.organizations o where o.id = pg_temp.org_de(v_ids[13]) and o.email_domain is null)
                 and exists (select 1 from public.grand_livre g where g.sujet_id = pg_temp.org_de(v_ids[13])
                              and g.type_action = 'organisation_preinscrite' and (g.detail ->> 'domaine_public')::boolean),
                 'domaine public : l''organisation naît SANS réserver le domaine, et la ligne le dit');
  -- ── l'invité : confirmé d'office, l'invitation acceptée dans la même transaction ──
  v_org := pg_temp.org_de(v_client);
  v_email := 'invite+' || v_ids[14] || '@' || v_ids[14] || '.invalid';
  v_inv := (public.creer_invitation(gen_random_uuid(), null, 'utilisateur', v_client, 'client', v_dom,
             jsonb_build_object('organization_id', v_org, 'email', v_email, 'token', 'hash_' || gen_random_uuid(),
                                'role_in_org', 'viewer', 'expires_at', now() + interval '7 days', 'status', 'pending',
                                'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id')::uuid;
  v_m := pg_temp.fab_signer(v_email, jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug, 'firstname', 'Sonde', 'lastname', 'Invite',
           'voie', 'invitation', 'piece', gen_random_uuid()::text, 'cgu_version', 'sonde',
           'invitation_id', v_inv::text, 'invitation_statuts', 'pending'));
  v_piece := (v_m ->> 'piece')::uuid;
  perform pg_temp.fab_auth(v_ids[14], v_email, v_m, true);
  return next ok(exists (select 1 from public.users u where u.id = v_ids[14] and u.user_type = 'client' and u.status = 'active'
                          and u.email_verified and u.cgu_version = 'sonde' and u.cgu_accepted_at is not null
                          and u.phone is null and not u.phone_verified)
                 and exists (select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = v_ids[14]
                              and m.role_in_org = 'viewer' and m.status = 'active')
                 and exists (select 1 from public.organization_invitations i where i.id = v_inv and i.status = 'accepted'),
                 'invité : actif, CGU enregistrées (le trou fermé), membre, invitation soldée — dans la transaction du compte');
  return next ok(pg_temp.lignes(v_piece) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_piece and g.type_action = 'compte_cree'
                              and g.detail ->> 'voie_declaree' = 'invitation')
                 and exists (select 1 from public.grand_livre g where g.piece = v_piece and g.type_action = 'invitation_acceptee'
                              and g.acteur_id = v_ids[14] and g.sujet_id = v_inv),
                 'invité : compte_cree ET invitation_acceptee sous la MÊME pièce');
  -- ── l'administrateur créé par un administrateur ──
  v_email := pg_temp.fab_email(v_ids[15]);
  v_m := pg_temp.fab_signer(v_email, jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug, 'firstname', 'Sonde', 'lastname', 'Admin',
           'voie', 'administrateur', 'piece', gen_random_uuid()::text, 'acteur_id', v_admin::text));
  v_piece := (v_m ->> 'piece')::uuid;
  perform pg_temp.fab_auth(v_ids[15], v_email, v_m, true);
  return next ok(exists (select 1 from public.users u join public.roles r on r.id = u.role_id
                          where u.id = v_ids[15] and u.user_type = 'admin' and u.status = 'active' and r.name = 'Admin'
                            and u.cgu_accepted_at is null)
                 and pg_temp.lignes(v_piece) = 2
                 and exists (select 1 from public.grand_livre g where g.piece = v_piece and g.type_action = 'administrateur_cree'
                              and g.origine = 'administrateur' and g.acteur_id = v_admin and not (g.detail ->> 'jour_zero')::boolean),
                 'administrateur : promu dans la transaction, compte_cree ET administrateur_cree sous la même pièce, AUCUN consentement inventé');
  return next ok(exists (select 1 from public.grand_livre g where g.sujet_id = v_admin and g.type_action = 'administrateur_cree'
                          and g.origine = 'systeme' and g.acteur_id is null and (g.detail ->> 'jour_zero')::boolean),
                 'le jour zéro (sans acteur) : administrateur_cree en origine système');

  -- ═══ D. LES REFUS D'UNE VOIE ══════════════════════════════════════════════
  v_email := 'invite+' || v_ids[16] || '@' || v_ids[16] || '.invalid';
  v_inv := (public.creer_invitation(gen_random_uuid(), null, 'utilisateur', v_client, 'client', v_dom,
             jsonb_build_object('organization_id', v_org, 'email', v_email, 'token', 'hash_' || gen_random_uuid(),
                                'role_in_org', 'viewer', 'expires_at', now() + interval '7 days', 'status', 'pending',
                                'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id')::uuid;
  v_m := pg_temp.fab_signer(v_email, jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug, 'firstname', 'Sonde', 'lastname', 'Invite',
           'voie', 'invitation', 'piece', gen_random_uuid()::text, 'cgu_version', 'sonde',
           'invitation_id', v_inv::text, 'invitation_statuts', 'pending'));
  return next ok(pg_temp.tenter(v_ids[16], v_email, v_m, false) = 'IN010 inscription refusee : invitation_non_confirmee'
                 and pg_temp.rien(v_ids[16])
                 and exists (select 1 from public.organization_invitations i where i.id = v_inv and i.status = 'pending'),
                 'invité NON confirmé : refusé (jamais « email_mismatch », un motif faux), l''invitation reste en attente');
  v_email := 'autre+' || v_ids[17] || '@' || v_ids[17] || '.invalid';
  v_m := pg_temp.fab_signer(v_email, (v_m - 'preuve' - 'preuve_expire_a') || jsonb_build_object('piece', gen_random_uuid()::text));
  return next ok(pg_temp.tenter(v_ids[17], v_email, v_m, true) = 'IN010 inscription refusee : invitation_email_mismatch'
                 and pg_temp.rien(v_ids[17]),
                 'invité à une AUTRE adresse que celle de l''invitation : refusé (comparaison sans casse)');
  update public.organization_invitations i set expires_at = now() - interval '1 hour' where i.id = v_inv;
  v_email := 'invite+' || v_ids[16] || '@' || v_ids[16] || '.invalid';
  v_m := pg_temp.fab_signer(v_email, (v_m - 'preuve' - 'preuve_expire_a') || jsonb_build_object('piece', gen_random_uuid()::text));
  return next ok(pg_temp.tenter(v_ids[18], v_email, v_m, true) = 'IN010 inscription refusee : invitation_expiree'
                 and pg_temp.rien(v_ids[18]),
                 'invitation EXPIRÉE : refusée, rien n''existe');
  v_email := pg_temp.fab_email(v_ids[19]);
  v_m := pg_temp.fab_signer(v_email, jsonb_build_object('role', 'entreprise', 'domain_slug', v_slug, 'firstname', 'Sonde', 'lastname', 'Admin',
           'voie', 'administrateur', 'piece', gen_random_uuid()::text, 'acteur_id', v_client::text));
  return next ok(pg_temp.tenter(v_ids[19], v_email, v_m, true) = 'IN010 inscription refusee : acteur_non_admin'
                 and pg_temp.rien(v_ids[19]),
                 'un client qui se dit administrateur ne crée pas d''administrateur : refusé, rien n''existe');
  v_m := pg_temp.signee(v_ids[20], 'expert', '{"voie":"invitation"}');
  return next ok(pg_temp.tenter(v_ids[20], pg_temp.fab_email(v_ids[20]), v_m) = 'IN006 inscription refusee : invalid_voie'
                 and pg_temp.rien(v_ids[20]),
                 'voie incohérente (un expert « invité »), même signée : IN006');

  -- ═══ E. LES RÈGLES — une définition, en base ══════════════════════════════
  v_m := pg_temp.signee(v_ids[21], 'expert', '{"cgu_version":""}');
  return next ok(pg_temp.tenter(v_ids[21], pg_temp.fab_email(v_ids[21]), v_m) = 'IN010 inscription refusee : cgu_required'
                 and pg_temp.rien(v_ids[21]),
                 'sans CGU : cgu_required');
  v_m := pg_temp.signee(v_ids[22], 'expert', '{"firstname":"  "}');
  return next is(pg_temp.tenter(v_ids[22], pg_temp.fab_email(v_ids[22]), v_m), 'IN010 inscription refusee : invalid_first_name',
                 'prénom vide : invalid_first_name');
  v_m := pg_temp.signee(v_ids[23], 'expert', '{"branch_id":""}');
  return next is(pg_temp.tenter(v_ids[23], pg_temp.fab_email(v_ids[23]), v_m), 'IN010 inscription refusee : branch_required',
                 'branche absente : branch_required');
  v_m := pg_temp.signee(v_ids[24], 'expert', '{"speciality_other":""}');
  return next is(pg_temp.tenter(v_ids[24], pg_temp.fab_email(v_ids[24]), v_m), 'IN010 inscription refusee : speciality_required',
                 'spécialité absente (ni référentiel, ni « Autre ») : speciality_required');
  v_m := pg_temp.signee(v_ids[25], 'expert', jsonb_build_object('branch_id', gen_random_uuid()::text));
  return next is(pg_temp.tenter(v_ids[25], pg_temp.fab_email(v_ids[25]), v_m), 'IN005 inscription refusee : invalid_branch',
                 'branche inventée : IN005');
  v_m := pg_temp.signee(v_ids[26], 'expert', jsonb_build_object('telephone', pg_temp.fab_telephone(v_ids[9])));
  return next ok(pg_temp.tenter(v_ids[26], pg_temp.fab_email(v_ids[26]), v_m) = 'IN010 inscription refusee : phone_already_used'
                 and pg_temp.rien(v_ids[26]),
                 'un téléphone déjà vérifié sur un autre compte : phone_already_used');
  v_m := pg_temp.signee(v_ids[27], 'expert', '{"telephone":"0600000000"}');
  return next is(pg_temp.tenter(v_ids[27], pg_temp.fab_email(v_ids[27]), v_m), 'IN010 inscription refusee : invalid_phone',
                 'un téléphone hors E.164 : invalid_phone');
  -- ── les domaines d'adresse ──
  perform public.regler_domaine_adresse(gen_random_uuid(), v_admin, v_dom, 'bloques', v_ids[28] || '.invalid', true, 'sonde');
  v_m := pg_temp.signee(v_ids[28], 'entreprise');
  return next ok(pg_temp.tenter(v_ids[28], pg_temp.fab_email(v_ids[28]), v_m) = 'IN010 inscription refusee : email_domain_blocked'
                 and pg_temp.rien(v_ids[28])
                 and not exists (select 1 from public.organizations o where o.email_domain = v_ids[28] || '.invalid'),
                 'domaine BLOQUÉ : refusé — ni compte, ni organisation');
  v_email := 'collegue@' || v_ids[11] || '.invalid';
  v_m := pg_temp.fab_signer(v_email, pg_temp.fab_meta('entreprise', v_ids[29]));
  return next ok(pg_temp.tenter(v_ids[29], v_email, v_m) = 'IN010 inscription refusee : email_domain_taken'
                 and pg_temp.rien(v_ids[29])
                 and (select count(*) from public.organizations o where o.email_domain = v_ids[11] || '.invalid') = 1,
                 'domaine déjà PRIS par une organisation : email_domain_taken — l''organisation naît avec son compte ou pas du tout');
  -- ── le numéro d'identification suit le pays (celui de la fabrique, lu en base) ──
  v_pays := pg_temp.fab_meta('entreprise', v_ids[30]) ->> 'country_code';
  select c.registre_numero_longueur_min, c.registre_numero_longueur_max into v_min, v_max
    from public.countries c where c.code = v_pays;
  v_siren := repeat('7', coalesce(v_min, 9));
  v_m := pg_temp.signee(v_ids[30], 'entreprise', jsonb_build_object('siren', v_siren));
  perform pg_temp.fab_auth(v_ids[30], pg_temp.fab_email(v_ids[30]), v_m, false);
  return next ok(exists (select 1 from public.organizations o where o.id = pg_temp.org_de(v_ids[30]) and o.siren = v_siren),
                 'un numéro au format du pays : accepté, écrit normalisé');
  v_m := pg_temp.signee(v_ids[31], 'entreprise', jsonb_build_object('siren', v_siren));
  return next ok(pg_temp.tenter(v_ids[31], pg_temp.fab_email(v_ids[31]), v_m) = 'IN010 inscription refusee : siren_taken'
                 and pg_temp.rien(v_ids[31]),
                 'le MÊME numéro pour une seconde organisation : siren_taken');
  v_m := pg_temp.signee(v_ids[32], 'entreprise', jsonb_build_object('siren', repeat('7', coalesce(v_max, 40) + 1)));
  return next is(pg_temp.tenter(v_ids[32], pg_temp.fab_email(v_ids[32]), v_m), 'IN010 inscription refusee : invalid_siren',
                 'un numéro trop long pour le pays : invalid_siren');
  return next ok(public.numero_identification_normalise(' 12.34-5 6/7 ') = '1234567'
                 and public.numero_identification_refus(v_pays, '') is null
                 and public.numero_identification_refus(v_pays, repeat('7', coalesce(v_max, 40) + 1)) = 'invalid_siren',
                 'numero_identification_refus : la forme imprimée se normalise, vide accepté, trop long refusé');
  v_m := pg_temp.signee(v_ids[33], 'entreprise', '{"company_name":"S"}');
  return next is(pg_temp.tenter(v_ids[33], pg_temp.fab_email(v_ids[33]), v_m), 'IN010 inscription refusee : invalid_company_name',
                 'un nom d''organisation d''une lettre : invalid_company_name');
  v_m := pg_temp.signee(v_ids[34], 'entreprise', '{"org_type":"esn"}');
  return next is(pg_temp.tenter(v_ids[34], pg_temp.fab_email(v_ids[34]), v_m), 'IN010 inscription refusee : invalid_org_type',
                 'un client qui se dit ESN : invalid_org_type');
  v_m := pg_temp.signee(v_ids[35], 'entreprise', '{"country_code":"ZZ"}');
  return next is(pg_temp.tenter(v_ids[35], pg_temp.fab_email(v_ids[35]), v_m), 'IN010 inscription refusee : invalid_country_code',
                 'un pays hors référentiel : invalid_country_code');
  -- ── LA QUESTION DE LA ROUTE : la même fonction, la même réponse ──
  return next ok(public.inscription_refus(pg_temp.fab_email(v_ids[36]), pg_temp.fab_meta('expert', v_ids[36])) is null
                 and public.inscription_refus(pg_temp.fab_email(v_ids[28]), pg_temp.fab_meta('entreprise', v_ids[28])) = 'email_domain_blocked'
                 and public.inscription_refus(pg_temp.fab_email(v_ids[9]), pg_temp.fab_meta('expert', v_ids[37])) = 'email_taken',
                 'inscription_refus (la question que la route pose AVANT de créer) : null si valide, le code du trigger sinon');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
