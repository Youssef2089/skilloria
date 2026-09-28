-- LA LECTURE DU GRAND LIVRE — lire_grand_livre() et lire_piece(), réservées à l'administrateur EN BASE.
-- Sur des lignes FABRIQUÉES dans la transaction du test (toutes à `now()` : la période `p_du = now()` isole
-- le test de ce que la base contient déjà). Prouve : AD002 ; les filtres ; le nettoyage visible sous tout
-- filtre ; le curseur (pages disjointes, suite annoncée) ; le nom rejoint, ou le compte supprimé ; la période ;
-- la pièce complète, avec ce que ses sous-journaux portent.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(13);

create or replace function pg_temp.ecrire(p_piece uuid, p_code text, p_acteur uuid, p_type text, p_dom uuid, p_sujet uuid, p_detail jsonb)
returns void language plpgsql as $$
begin
  perform public.journaliser(p_piece, p_code, 'reussi', case when p_type = 'admin' then 'administrateur' else 'utilisateur' end,
                             p_acteur, p_type, p_dom, case when p_sujet is null then null else 'publications' end, p_sujet,
                             p_detail, null::uuid, null::numeric, null::text);
end $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_admin();
  v_client uuid := pg_temp.fab_compte('entreprise');
  v_dom    uuid := pg_temp.fab_domaine();
  v_fantome uuid := gen_random_uuid();
  v_p      uuid[] := array(select gen_random_uuid() from generate_series(1, 8));
  v_r      jsonb;
  v_r2     jsonb;
  v_debut  timestamptz := now();
begin
  -- Trois annonces créées par le client, une par un compte qui n'existe plus, un nettoyage du journal.
  perform pg_temp.ecrire(v_p[1], 'annonce_creee', v_client, 'client', v_dom, gen_random_uuid(), '{"type":"mission"}'::jsonb);
  perform pg_temp.ecrire(v_p[2], 'annonce_creee', v_client, 'client', v_dom, gen_random_uuid(), '{"type":"offre"}'::jsonb);
  perform pg_temp.ecrire(v_p[3], 'annonce_creee', v_client, 'client', v_dom, gen_random_uuid(), '{"type":"mission"}'::jsonb);
  perform pg_temp.ecrire(v_p[4], 'annonce_creee', v_fantome, 'client', v_dom, gen_random_uuid(), '{"type":"mission"}'::jsonb);
  perform public.journaliser(v_p[5], 'journal_nettoye', 'reussi', 'administrateur', v_admin, 'admin', null::uuid,
                             null::text, null::uuid, '{}'::jsonb, null::uuid, null::numeric, null::text);
  insert into public.audit_logs (user_id, domain_id, action, entity_type, entity_id, piece)
  values (v_client, v_dom, 'sonde', 'publication', v_client, v_p[1]);
  -- La MÊME pièce dans les quatre autres sous-journaux : c'est la raison d'être de la colonne (2.5).
  insert into public.ai_spend_events (provider, domain_id, units, cost_usd, action, piece)
  values ('claude', v_dom, 12, 0.0042, 'publication_quality', v_p[1]);
  insert into public.stripe_events (id, type, payload, livemode, status, piece)
  values ('evt_sonde_' || gen_random_uuid(), 'invoice.paid', '{}'::jsonb, false, 'processed', v_p[1]);
  insert into public.cron_run_log (job_name, piece) values ('sonde_lecture', v_p[1]);
  insert into public.notifications (user_id, domain_id, type, channel, status, piece)
  values (v_client, v_dom, 'sonde', 'inapp', 'pending', v_p[1]);

  -- ── AD002 : un non-administrateur ne lit pas ──
  return next throws_ok(format('select public.lire_grand_livre(%L)', v_client), 'AD002', null,
                        'lire_grand_livre : un client est refusé en base (AD002)');
  return next throws_ok(format('select public.lire_piece(%L, %L)', v_client, v_p[1]), 'AD002', null,
                        'lire_piece : un client est refusé en base (AD002)');

  -- ── le filtre de famille, et le nettoyage qui reste visible ──
  v_r := public.lire_grand_livre(v_admin, p_familles => array['administration'], p_du => v_debut);
  return next ok(exists (select 1 from jsonb_array_elements(v_r -> 'lignes') l where l ->> 'type_action' = 'journal_nettoye')
                 and not exists (select 1 from jsonb_array_elements(v_r -> 'lignes') l where l ->> 'type_action' = 'annonce_creee'),
                 'filtre « administration » : aucune annonce, mais le NETTOYAGE du journal reste visible');
  v_r := public.lire_grand_livre(v_admin, p_acteur_id => v_client, p_du => v_debut);
  return next is((select count(*) from jsonb_array_elements(v_r -> 'lignes') l where l ->> 'type_action' = 'annonce_creee'), 3::bigint,
                 'filtre d''acteur : les trois lignes du client, et elles seules parmi les annonces');
  return next ok(exists (select 1 from jsonb_array_elements(v_r -> 'lignes') l where l ->> 'type_action' = 'journal_nettoye'),
                 'filtre d''acteur : le nettoyage du journal reste visible (il n''est pas du client)');

  -- ── le curseur : deux pages disjointes, la suite annoncée puis close ──
  v_r := public.lire_grand_livre(v_admin, p_types => array['annonce_creee'], p_du => v_debut, p_limite => 2);
  v_r2 := public.lire_grand_livre(v_admin, p_types => array['annonce_creee'], p_du => v_debut, p_limite => 2,
                                  p_apres_horodatage => (v_r -> 'suivant' ->> 'horodatage')::timestamptz,
                                  p_apres_id => (v_r -> 'suivant' ->> 'id')::bigint);
  return next ok(jsonb_array_length(v_r -> 'lignes') = 2 and v_r -> 'suivant' is not null and v_r -> 'suivant' <> 'null'::jsonb,
                 'page 1 : deux lignes, et une suite ANNONCÉE');
  return next ok(jsonb_array_length(v_r2 -> 'lignes') >= 2
                 and not exists (select 1 from jsonb_array_elements(v_r -> 'lignes') a, jsonb_array_elements(v_r2 -> 'lignes') b
                                  where a ->> 'curseur_id' = b ->> 'curseur_id'),
                 'page 2 : les lignes suivantes, aucune reprise de la page 1');

  -- ── le nom rejoint à la lecture, ou le compte supprimé ──
  v_r := public.lire_grand_livre(v_admin, p_types => array['annonce_creee'], p_du => v_debut, p_limite => 10);
  return next ok(exists (select 1 from jsonb_array_elements(v_r -> 'lignes') l
                          where l ->> 'acteur_id' = v_client::text and l ->> 'acteur_nom' = 'Sonde Essai' and not (l ->> 'acteur_supprime')::boolean)
                 and exists (select 1 from jsonb_array_elements(v_r -> 'lignes') l
                          where l ->> 'acteur_id' = v_fantome::text and l -> 'acteur_nom' = 'null'::jsonb and (l ->> 'acteur_supprime')::boolean),
                 'le nom est rejoint à la lecture ; un compte disparu est dit supprimé, sans nom');
  return next ok(exists (select 1 from jsonb_array_elements(v_r -> 'lignes') l where l ->> 'ecosysteme_id' = v_dom::text
                          and l ->> 'ecosysteme_nom' is not null),
                 'l''écosystème est nommé à la lecture');

  -- ── la période : rien avant le début du test ──
  v_r := public.lire_grand_livre(v_admin, p_du => v_debut - interval '10 years', p_au => v_debut - interval '9 years');
  return next ok(not exists (select 1 from jsonb_array_elements(v_r -> 'lignes') l where l ->> 'piece' = any (array[v_p[1]::text, v_p[5]::text])),
                 'une période qui ne contient pas les lignes ne les rend pas — le nettoyage compris');

  -- ── la pièce complète, avec son sous-journal ──
  v_r := public.lire_piece(v_admin, v_p[1]);
  return next ok(jsonb_array_length(v_r -> 'lignes') = 1 and pg_temp.lignes(v_p[1]) = 1 and not (v_r ->> 'tronquee')::boolean,
                 'lire_piece : toutes les lignes de la pièce (ici une), non tronquée');
  return next ok(jsonb_array_length(v_r -> 'sous_journaux' -> 'audit_logs') = 1
                 and v_r -> 'sous_journaux' -> 'audit_logs' -> 0 ->> 'action' = 'sonde'
                 and not (v_r -> 'sous_journaux' -> 'audit_logs' -> 0 ? 'detail'),
                 'lire_piece : la ligne d''audit sous la même pièce — sans son détail');
  return next ok(jsonb_array_length(v_r -> 'sous_journaux' -> 'ai_spend_events') = 1
                 and jsonb_array_length(v_r -> 'sous_journaux' -> 'stripe_events') = 1
                 and jsonb_array_length(v_r -> 'sous_journaux' -> 'cron_run_log') = 1
                 and jsonb_array_length(v_r -> 'sous_journaux' -> 'notifications') = 1
                 and (v_r -> 'sous_journaux' -> 'ai_spend_events' -> 0 ->> 'cost_usd')::numeric = 0.0042,
                 'lire_piece : la PIÈCE COMPLÈTE — la ligne du grand livre ET ce que les cinq sous-journaux portent sous elle');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
