-- L'ÉVÉNEMENT STRIPE ROUVERT — rouvrir_evenement_stripe(), l'écrivain unique, appelé par POST
-- /api/admin/facturation. Population : l'administrateur. Les événements sont FABRIQUÉS (Stripe les pose
-- en production, par le webhook) ; l'administrateur naît par le chemin de création d'administrateur.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(8);

create or replace function pg_temp.evenement(p_id text, p_statut text, p_recu timestamptz) returns void
language plpgsql as $$
begin
  insert into public.stripe_events (id, type, payload, livemode, status, received_at)
  values (p_id, 'invoice.paid', '{}'::jsonb, false, p_statut, p_recu);
end $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_admin();
  v_limite timestamptz := now() - interval '30 minutes';
  v_ids    text[] := array['evt_sonde_' || gen_random_uuid(), 'evt_sonde_' || gen_random_uuid(), 'evt_sonde_' || gen_random_uuid()];
  v_p      uuid[] := array(select gen_random_uuid() from generate_series(1, 4));
  v_r      jsonb;
begin
  perform pg_temp.evenement(v_ids[1], 'received', now() - interval '2 hours');
  perform pg_temp.evenement(v_ids[2], 'received', now() - interval '1 minute');
  perform pg_temp.evenement(v_ids[3], 'processed', now() - interval '2 hours');

  -- ── coincé : rouvert, et la ligne s'écrit ──
  v_r := public.rouvrir_evenement_stripe(v_p[1], null, 'administrateur', v_admin, 'admin', v_ids[1], 'MOTIF-LIBRE-7Q3Z relivraison demandée', v_limite);
  return next ok(v_r ->> 'issue' = 'rouvert' and exists (select 1 from public.stripe_events e where e.id = v_ids[1]
                   and e.status = 'failed' and e.error like 'rouvert manuellement — MOTIF-LIBRE-7Q3Z%'),
                 'coincé : l''événement passe failed, le motif est dans stripe_events.error');
  return next ok(pg_temp.lignes(v_p[1]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[1]
                   and g.type_action = 'evenement_stripe_rouvert' and g.acteur_id = v_admin and g.acteur_type = 'admin'
                   and g.sujet_type = 'stripe_events' and g.sujet_id = public.identifiant_derive('stripe_event', v_ids[1])
                   and g.detail ->> 'stripe_event_id' = v_ids[1] and g.detail ->> 'type_evenement' = 'invoice.paid'
                   and g.ecosysteme_id is null),
                 'coincé : UNE ligne, sujet DÉRIVÉ de l''identifiant Stripe, l''identifiant lui-même dans le détail');
  -- Le motif porte un marqueur qui n'existe nulle part ailleurs : l'identifiant fabriqué de l'événement
  -- (`evt_sonde_…`) figure légitimement au détail, et chercher « sonde » l'attrapait lui (échec du 28/09/2026).
  return next ok(not exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.detail::text like '%MOTIF-LIBRE-7Q3Z%')
                 and (select array_agg(k order by k) from public.grand_livre g, jsonb_object_keys(g.detail) k where g.piece = v_p[1])
                     = array['organization_id', 'recu_le', 'stripe_event_id', 'type_evenement'],
                 'le motif (texte libre) n''est PAS au grand livre : le détail porte exactement quatre clés, des identifiants');
  return next throws_ok(format($q$select public.journaliser(%L, 'evenement_stripe_rouvert', 'reussi', 'administrateur', %L, 'admin', null::uuid,
                                 'stripe_events', %L, '{"stripe_event_id":"x","motif":"texte libre"}'::jsonb, null::uuid, null::numeric, null::text)$q$,
                               gen_random_uuid(), v_admin, gen_random_uuid()),
                        'GL004', null, 'la liste blanche REFUSE une clé motif (GL004) — aucun texte libre ne peut entrer');
  -- ── trop récent, ou déjà clos : non coincé, rien ne change, rien ne s'écrit ──
  v_r := public.rouvrir_evenement_stripe(v_p[2], null, 'administrateur', v_admin, 'admin', v_ids[2], 'trop tot pour rouvrir', v_limite);
  return next ok(v_r ->> 'issue' = 'non_coince' and pg_temp.lignes(v_p[2]) = 0
                 and exists (select 1 from public.stripe_events e where e.id = v_ids[2] and e.status = 'received'),
                 'trop récent : non coincé, intact, aucune ligne');
  v_r := public.rouvrir_evenement_stripe(v_p[3], null, 'administrateur', v_admin, 'admin', v_ids[3], 'deja traite par le webhook', v_limite);
  return next ok(v_r ->> 'issue' = 'non_coince' and pg_temp.lignes(v_p[3]) = 0
                 and exists (select 1 from public.stripe_events e where e.id = v_ids[3] and e.status = 'processed'),
                 'déjà clos : non coincé, intact, aucune ligne');
  -- ── une seconde réouverture du même : il n'est plus coincé ──
  v_r := public.rouvrir_evenement_stripe(v_p[4], null, 'administrateur', v_admin, 'admin', v_ids[1], 'seconde tentative de la sonde', v_limite);
  return next ok(v_r ->> 'issue' = 'non_coince' and pg_temp.lignes(v_p[4]) = 0, 'rouvert deux fois : la seconde n''écrit rien');
  return next ok(not has_function_privilege('authenticated', 'public.rouvrir_evenement_stripe(uuid, uuid, text, uuid, text, text, text, timestamptz)', 'execute')
                 and not has_function_privilege('anon', 'public.rouvrir_evenement_stripe(uuid, uuid, text, uuid, text, text, text, timestamptz)', 'execute'),
                 'rouvrir_evenement_stripe : fermée au navigateur');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
