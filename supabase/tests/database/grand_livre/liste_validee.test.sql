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
--     compte effacé n'a plus de nom.
-- Colonnes et contraintes lues dans les migrations (§G.10) : notification_preferences (PK user_id + event_type +
-- channel, channel email|sms), grand_livre_conservation (conservation >= plancher), la proposition (12 familles).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(19);

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
  v_p       uuid[] := array(select gen_random_uuid() from generate_series(1, 10));
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
                                                'nouvelles', 2, 'notifiees', 1, 'notifications_manquees', 0),
                             null::uuid, 0.0042, 'recherches');
  return next ok(pg_temp.lignes(v_p[4]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[4]
                   and (g.detail ->> 'examinees')::int = 12 and (g.detail ->> 'retenues')::int = 3 and g.cout_usd = 0.0042),
                 'recherche terminée : UNE ligne, avec ce qui a été examiné, retenu, et le coût');
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
  return next throws_ok(format($q$select * from public.libelles_journal(%L, '[]'::jsonb)$q$, v_expert),
                        'AD002', null, 'libelles_journal est réservée à un administrateur actif');
  return next throws_ok(format($q$select * from public.libelles_journal(%L, (select jsonb_agg(jsonb_build_object('type', 'users', 'id', gen_random_uuid())) from generate_series(1, 501)))$q$, v_admin),
                        '22023', null, 'plus de 500 sujets : refusé');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
