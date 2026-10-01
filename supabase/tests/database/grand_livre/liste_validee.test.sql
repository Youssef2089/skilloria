-- La liste validée par Youssef (01/10/2026, ARRÊT 22, §D.33) :
--   · les onze actions RETIRÉES : le code ne les écrit plus, mais la base les ACCEPTE encore — entre le db push et le
--     git push, le code en ligne les écrit, et aucun geste ne doit échouer (§E.72) ; le refus (GL006) part au lot
--     suivant, et ce test le dira alors ;
--   · desabonnement_email — se_desabonner_email() : la préférence coupée ET sa ligne, ensemble, une fois ; un second
--     clic ne change rien et n'écrit rien ; un compte inconnu n'écrit rien ; un code invalide est refusé ;
--   · la ligne de fin d'une recherche porte ses compteurs (les étapes fondues en une ligne) ;
--   · appliquer_proposition_conservation() : la proposition EN BASE, posée par l'écrivain unique du réglage, une
--     ligne ; appliquée deux fois, aucune seconde ligne ; le journal n'a pas de proposition ;
--   · libelles_journal() : les noms relus à l'affichage — réservée à l'administrateur (AD002), bornée (22023), un
--     compte effacé n'a plus de nom (NULL), un compte qui vit SANS nom rend '' (relecture du 01/10/2026, point 18) ;
--     les TREIZE types d'objet sont nommés (point 21 : neuf ne l'étaient par aucun test).
--   · relecture du 01/10/2026, point 21 : un compte EFFACÉ n'a rien à désabonner (aucune ligne) ; la proposition de
--     conservation est refusée à qui n'est pas administrateur (AD002) et REMONTÉE au minimum légal quand la durée
--     déjà saisie est en dessous.
-- Colonnes et contraintes lues dans les migrations (§G.10) : notification_preferences (PK user_id + event_type +
-- channel, channel email|sms), grand_livre_conservation (conservation >= plancher, 1..1200), la proposition (12
-- familles ; conservation >= plancher), users (first_name, last_name varchar(100) NULLABLES), matches (unique
-- publication + profil, status pending|notified|viewed|dismissed), packages (target_role, scope organization,
-- gratuité cohérente), branches et specialities (domain_id, name, slug).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(30);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin   uuid := pg_temp.fab_admin();
  v_expert  uuid := pg_temp.fab_compte('expert');
  v_patron  uuid := pg_temp.fab_compte('entreprise');
  v_efface  uuid := pg_temp.fab_compte('expert');
  v_org     uuid;
  v_pub     uuid;
  v_profil  uuid;
  v_cand    uuid;
  v_profil2 uuid := pg_temp.fab_profil('expert');
  v_sans    uuid := pg_temp.fab_compte('expert');
  v_inv     uuid;
  v_match   uuid;
  v_depot   uuid;
  v_membre  uuid;
  v_br      uuid;
  v_sp      uuid;
  v_pkg     uuid;
  v_dom     uuid := pg_temp.fab_domaine();
  v_l       record;
  v_p       uuid[] := array(select gen_random_uuid() from generate_series(1, 16));
  v_code    text;
  v_acceptees integer := 0;
  v_r       jsonb;
  v_n       record;
begin
  -- ══ LES ACTIONS RETIRÉES : ENCORE ACCEPTÉES PENDANT LA FENÊTRE ══
  for v_code in select a.code from public.grand_livre_actions a where a.retiree_le is not null loop
    perform public.journaliser(v_p[10], v_code,
                               coalesce((select a.statut_impose from public.grand_livre_actions a where a.code = v_code), 'reussi'),
                               'systeme', null, null, null, null, null, '{}'::jsonb, null::uuid, null::numeric, null::text);
    v_acceptees := v_acceptees + 1;
  end loop;
  return next ok(v_acceptees = 11 and pg_temp.lignes(v_p[10]) = 11,
                 'les onze actions retirées sont encore ACCEPTÉES : le code en ligne qui les écrit n''échoue pas pendant la fenêtre (le refus GL006 part au lot suivant)');
  return next is(array(select a.code::text from public.grand_livre_actions a where a.retiree_le is not null order by 1),
                 array['message_envoye', 'recherche_classee', 'recherche_correspondances', 'recherche_filtree', 'recherche_lancee',
                       'recherche_notifiee', 'refus_expert_inapte', 'refus_garde_eligibilite', 'refus_plafond_atteint', 'refus_quota_cv',
                       'refus_recherche_en_cours']::text[],
                 'les onze actions retirées, nommées, portent leur date de retrait ; leurs lignes passées restent');

  -- ══ LE DÉSABONNEMENT D'UN E-MAIL ══
  return next is(public.se_desabonner_email(v_p[1], v_expert, 'new_match_opportunity'), 'desabonne', 'le lien coupe la préférence');
  return next ok(exists (select 1 from public.notification_preferences n where n.user_id = v_expert
                          and n.event_type = 'new_match_opportunity' and n.channel = 'email' and not n.enabled),
                 'la préférence e-mail de l''événement est coupée');
  return next ok(pg_temp.lignes(v_p[1]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[1]
                   and g.type_action = 'desabonnement_email' and g.statut = 'reussi' and g.origine = 'utilisateur'
                   and g.acteur_id = v_expert and g.sujet_type = 'users' and g.sujet_id = v_expert
                   and g.detail = jsonb_build_object('evenement', 'new_match_opportunity', 'canal', 'email')),
                 'exactement UNE ligne : le titulaire, l''événement et le canal — rien d''autre');
  return next ok(public.se_desabonner_email(v_p[2], v_expert, 'new_match_opportunity') = 'deja' and pg_temp.lignes(v_p[2]) = 0,
                 'un second clic : « déjà », AUCUNE ligne');
  return next ok(public.se_desabonner_email(v_p[3], gen_random_uuid(), 'new_match_opportunity') = 'introuvable' and pg_temp.lignes(v_p[3]) = 0,
                 'un compte inconnu : « introuvable », AUCUNE ligne');
  return next throws_ok(format($q$select public.se_desabonner_email(%L, %L, 'Pas Un Code')$q$, gen_random_uuid(), v_expert),
                        '22023', null, 'un événement qui n''est pas un code est refusé');
  return next ok(not has_function_privilege('authenticated', 'public.se_desabonner_email(uuid, uuid, text)', 'execute'),
                 'se_desabonner_email est fermée au navigateur');

  -- ══ LA LIGNE DE FIN D'UNE RECHERCHE : ses compteurs ══
  select p.id into v_profil from public.profiles p where p.user_id = v_expert;
  perform public.journaliser(v_p[4], 'recherche_terminee', 'reussi', 'tache_planifiee', null, null, pg_temp.fab_domaine(),
                             'profiles', v_profil,
                             jsonb_build_object('issue', 'ok', 'tentative', 1, 'tache', 'expert_relance', 'eligibles', 40, 'examinees', 12,
                                                'notees', 12, 'reprises', 0, 'lots_en_echec', 0, 'retenues', 3, 'fortes', 1,
                                                'nouvelles', 2, 'notifiees', 1, 'notifications_manquees', 0,
                                                'recherches', 1, 'unites_source', 'plancher'),
                             null::uuid, 0.0042, 'recherches');
  return next ok(pg_temp.lignes(v_p[4]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[4]
                   and (g.detail ->> 'examinees')::int = 12 and (g.detail ->> 'retenues')::int = 3 and g.cout_usd = 0.0042
                   and (g.detail ->> 'recherches')::int = 1 and g.detail ->> 'unites_source' = 'plancher'),
                 'recherche terminée : UNE ligne, avec ce qui a été examiné, retenu, le coût — et s''il est MESURÉ ou estimé au plancher (point 15)');
  perform public.journaliser(v_p[5], 'recherche_abandonnee', 'echoue', 'tache_planifiee', null, null, pg_temp.fab_domaine(),
                             'profiles', v_profil,
                             jsonb_build_object('tentatives', 3, 'plafond', 3, 'etape', 'notation', 'cause', 'notation_arretee',
                                                'arret', 'interrupteur_ferme', 'examinees', 12, 'notees', 4),
                             null::uuid, null::numeric, null::text);
  return next is(pg_temp.lignes(v_p[5]), 1::bigint, 'recherche abandonnée : UNE ligne, avec les tentatives et l''étape');

  -- ══ LA PROPOSITION DE CONSERVATION ══
  v_r := public.appliquer_proposition_conservation(v_p[6], v_admin, 'commerce');
  return next ok(v_r ->> 'issue' = 'regle'
                 and exists (select 1 from public.grand_livre_conservation c, public.grand_livre_conservation_proposee p
                              where c.famille = 'commerce' and p.famille = 'commerce'
                                and c.conservation_mois = p.conservation_mois and c.plancher_mois = p.plancher_mois),
                 'commerce : la proposition EN BASE est appliquée telle quelle');
  return next ok(pg_temp.lignes(v_p[6]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[6]
                   and g.type_action = 'reglage_modifie' and g.sujet_type = 'grand_livre_conservation' and g.detail ->> 'famille' = 'commerce'),
                 'et sa ligne reglage_modifie, par l''écrivain unique du réglage');
  v_r := public.appliquer_proposition_conservation(v_p[7], v_admin, 'commerce');
  return next ok(v_r ->> 'issue' = 'inchange' and pg_temp.lignes(v_p[7]) = 0, 'appliquée deux fois : « inchangé », AUCUNE ligne');
  return next is(public.appliquer_proposition_conservation(v_p[8], v_admin, 'journal') ->> 'issue', 'sans_proposition',
                 'le journal (les traces des nettoyages) n''a pas de proposition');

  -- ══ LES NOMS, RELUS À L'AFFICHAGE ══
  v_org := (select o.id from public.organizations o join public.organization_members m on m.organization_id = o.id
             where m.user_id = v_patron limit 1);
  v_pub := pg_temp.fab_annonce_publiee(v_org, v_patron);
  v_cand := pg_temp.fab_candidature(v_pub, v_profil);
  perform public.anonymiser_compte(v_p[9], null, 'administrateur', v_admin, 'admin', v_efface,
                                   'purge+' || v_efface || '@deleted.invalid', 'admin', false, null, true, 0);
  select
    (select l.nom from public.libelles_journal(v_admin, jsonb_build_array(jsonb_build_object('type', 'profiles', 'id', v_profil))) l) as profil,
    (select l.nom || '|' || l.contexte from public.libelles_journal(v_admin, jsonb_build_array(jsonb_build_object('type', 'candidatures', 'id', v_cand))) l) as cand,
    (select l.nom || '|' || l.contexte from public.libelles_journal(v_admin, jsonb_build_array(jsonb_build_object('type', 'publications', 'id', v_pub))) l) as pub,
    (select l.nom from public.libelles_journal(v_admin, jsonb_build_array(jsonb_build_object('type', 'users', 'id', v_efface))) l) as efface
    into v_n;
  return next ok(v_n.profil = 'Sonde Essai' and v_n.cand = 'Sonde|Sonde Essai' and v_n.pub = 'Sonde|Sonde SAS',
                 'un profil se nomme par son titulaire, une candidature par son annonce et son expert, une annonce par son titre et son organisation');
  return next ok(v_n.efface is null, 'un compte effacé n''a plus de nom');

  -- ── Les neuf autres types d'objet (point 21) : chacun nommé par ce que l'écran affiche ──
  v_inv := (public.creer_invitation(v_p[11], null, 'utilisateur', v_patron, 'client', v_dom,
              jsonb_build_object('organization_id', v_org, 'email', 'invite+' || gen_random_uuid() || '@exemple.invalid',
                                 'token', 'hash_' || gen_random_uuid(), 'role_in_org', 'viewer', 'expires_at', now() + interval '7 days',
                                 'status', 'pending', 'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id')::uuid;
  insert into public.matches (publication_id, profile_id, domain_id, status) values (v_pub, v_profil2, v_dom, 'notified')
  returning id into v_match;
  select d.id into v_depot from public.candidature_depots d where d.publication_id = v_pub and d.profile_id = v_profil limit 1;
  select m.id into v_membre from public.organization_members m where m.organization_id = v_org and m.user_id = v_patron;
  insert into public.branches (domain_id, name, slug) values (v_dom, 'Sonde branche', 'sonde-' || left(md5(random()::text), 8))
  returning id into v_br;
  insert into public.specialities (branch_id, domain_id, name, slug) values (v_br, v_dom, 'Sonde specialite', 'sonde-' || left(md5(random()::text), 8))
  returning id into v_sp;
  insert into public.packages (name, slug, target_role, scope, is_free, price_monthly, price_yearly, active, is_default)
  values ('Sonde offre', 'sonde-' || replace(gen_random_uuid()::text, '-', ''), 'client', 'organization', true, null, null, false, false)
  returning id into v_pkg;
  create temp table noms_lus on commit drop as
    select l.sujet_type, l.sujet_id, l.nom, l.contexte
      from public.libelles_journal(v_admin, jsonb_build_array(
             jsonb_build_object('type', 'users', 'id', v_expert),
             jsonb_build_object('type', 'organizations', 'id', v_org),
             jsonb_build_object('type', 'matches', 'id', v_match),
             jsonb_build_object('type', 'candidature_depots', 'id', v_depot),
             jsonb_build_object('type', 'organization_invitations', 'id', v_inv),
             jsonb_build_object('type', 'organization_members', 'id', v_membre),
             jsonb_build_object('type', 'domains', 'id', v_dom),
             jsonb_build_object('type', 'packages', 'id', v_pkg),
             jsonb_build_object('type', 'branches', 'id', v_br),
             jsonb_build_object('type', 'specialities', 'id', v_sp))) l;
  return next is((select n.nom from noms_lus n where n.sujet_type = 'users'), 'Sonde Essai', 'un compte se nomme par son prénom et son nom');
  return next is((select n.nom from noms_lus n where n.sujet_type = 'organizations'), 'Sonde SAS', 'une organisation, par sa raison sociale');
  return next is((select n.nom || '|' || n.contexte from noms_lus n where n.sujet_type = 'matches'), 'Sonde|Sonde Essai',
                 'une mise en relation, par son annonce et son expert');
  return next is((select n.nom || '|' || n.contexte from noms_lus n where n.sujet_type = 'candidature_depots'), 'Sonde|Sonde Essai',
                 'un dépôt de candidature, par son annonce et son expert');
  return next is((select n.nom from noms_lus n where n.sujet_type = 'organization_invitations'), 'Sonde SAS', 'une invitation, par son organisation');
  return next is((select n.nom || '|' || n.contexte from noms_lus n where n.sujet_type = 'organization_members'), 'Sonde SAS|Sonde Essai',
                 'un membre, par son organisation et son nom');
  return next ok((select n.nom from noms_lus n where n.sujet_type = 'domains') = (select d.name::text from public.domains d where d.id = v_dom)
                 and (select n.nom from noms_lus n where n.sujet_type = 'packages') = 'Sonde offre'
                 and (select n.nom from noms_lus n where n.sujet_type = 'branches') = 'Sonde branche'
                 and (select n.nom from noms_lus n where n.sujet_type = 'specialities') = 'Sonde specialite',
                 'un écosystème, une offre, une branche, une spécialité : par leur nom');

  -- ── Un compte qui VIT sans nom : '' — l'écran dit « sans nom renseigné », pas « données effacées » (point 18) ──
  update public.users set first_name = null, last_name = null where id = v_sans;
  select
    (select l.nom from public.libelles_journal(v_admin, jsonb_build_array(jsonb_build_object('type', 'users', 'id', v_sans))) l) as compte,
    (select l.nom from public.libelles_journal(v_admin, jsonb_build_array(jsonb_build_object('type', 'profiles', 'id',
       (select p.id from public.profiles p where p.user_id = v_sans)))) l) as profil
    into v_l;
  return next ok(v_l.compte = '' and v_l.profil = '',
                 'un compte qui vit sans nom rend une chaîne VIDE (et son profil aussi) — distinct du compte effacé (NULL)');

  -- ── Le désabonnement d'un compte EFFACÉ : rien à couper, aucune ligne (point 21) ──
  v_code := public.se_desabonner_email(v_p[12], v_efface, 'new_match_opportunity');
  return next ok(v_code = 'introuvable' and pg_temp.lignes(v_p[12]) = 0
                 and not exists (select 1 from public.notification_preferences n where n.user_id = v_efface and n.event_type = 'new_match_opportunity'),
                 'un compte effacé : « introuvable », aucune préférence écrite, AUCUNE ligne');

  -- ── La proposition de conservation : réservée à l'administrateur, et jamais sous le minimum légal (point 21) ──
  return next throws_ok(format($q$select public.appliquer_proposition_conservation(%L, %L, 'compte')$q$, v_p[13], v_expert),
                        'AD002', null, 'appliquer une proposition est réservé à un administrateur actif');
  -- La proposition « compte » sans durée, une durée déjà saisie SOUS le minimum de la proposition (12 mois) : remontée.
  update public.grand_livre_conservation_proposee set conservation_mois = null where famille = 'compte';
  perform public.regler_conservation_journal(v_p[14], v_admin, 'compte', 6, 0);
  v_r := public.appliquer_proposition_conservation(v_p[15], v_admin, 'compte');
  return next ok(v_r ->> 'issue' = 'regle' and pg_temp.lignes(v_p[15]) = 1
                 and exists (select 1 from public.grand_livre_conservation c where c.famille = 'compte'
                              and c.conservation_mois = 12 and c.plancher_mois = 12),
                 'une durée saisie (6 mois) sous le minimum proposé (12) est REMONTÉE au minimum, et le geste s''écrit une fois');
  return next throws_ok(format($q$select * from public.libelles_journal(%L, '[]'::jsonb)$q$, v_expert),
                        'AD002', null, 'libelles_journal est réservée à un administrateur actif');
  return next throws_ok(format($q$select * from public.libelles_journal(%L, (select jsonb_agg(jsonb_build_object('type', 'users', 'id', gen_random_uuid())) from generate_series(1, 501)))$q$, v_admin),
                        '22023', null, 'plus de 500 sujets : refusé');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
