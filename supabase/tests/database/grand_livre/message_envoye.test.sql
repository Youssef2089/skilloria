-- message_envoye — RETIRÉE du grand livre (décision de Youssef, 01/10/2026, ARRÊT 22) : la messagerie garde chaque
-- message, daté et attribué ; le fait métier est l'ouverture de l'échange (« Coordonnées dévoilées »).
-- envoyer_message() : le message et la date du fil, ensemble, SANS ligne au grand livre ; un fil hors des statuts
-- admis ne reçoit rien ; écrire l'action retirée est refusé, nommément (GL006).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(5);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin uuid := pg_temp.fab_compte('entreprise');
  v_org   uuid := pg_temp.fab_organisation(v_admin);
  v_pub   uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_cand  uuid := pg_temp.fab_candidature(v_pub, pg_temp.fab_profil('expert'));
  v_conv  uuid;
  v_p1    uuid := gen_random_uuid();
  v_p2    uuid := gen_random_uuid();
  v_r     jsonb;
begin
  v_conv := (public.devoiler_candidature(gen_random_uuid(), null, 'utilisateur', v_admin, 'client', v_cand,
                                         array['received', 'in_review', 'shortlisted'], now() + interval '15 days', false) ->> 'conversation_id')::uuid;
  v_r := public.envoyer_message(v_p2, null, 'utilisateur', v_admin, 'client', v_conv, array['statut_absent'], 'message refuse');
  return next ok(v_r ->> 'issue' = 'fermee' and pg_temp.lignes(v_p2) = 0
                 and not exists (select 1 from public.messages m where m.conversation_id = v_conv),
                 'un fil hors des statuts admis ne reçoit rien, sans ligne');
  v_r := public.envoyer_message(v_p1, null, 'utilisateur', v_admin, 'client', v_conv, array['open'], 'contenu de sonde');
  return next is(v_r ->> 'issue', 'envoye', 'le message est envoyé');
  return next ok(exists (select 1 from public.messages m where m.id = (v_r ->> 'id')::uuid and m.sender_id = v_admin)
                 and exists (select 1 from public.conversations c where c.id = v_conv and c.last_message_at = (v_r ->> 'created_at')::timestamptz),
                 'le message ET la date du fil sont relus');
  return next is(pg_temp.lignes(v_p1), 0::bigint, 'AUCUNE ligne au grand livre : l''action est retirée');
  return next throws_ok(format($q$select public.journaliser(%L, 'message_envoye', 'reussi', 'utilisateur', %L, 'client', null, 'messages', %L, '{}'::jsonb, null, null, null)$q$,
                               gen_random_uuid(), v_admin, gen_random_uuid()),
                        'GL006', null, 'écrire message_envoye est refusé, nommément (GL006)');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
