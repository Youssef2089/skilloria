-- candidature_deposee — ouvrir_depot_candidature() puis inserer_candidature_jugee() : la candidature,
-- sa note, le journal du dépôt soldé et la ligne, ensemble ; une concurrente n'écrit rien.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(8);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_compte('entreprise');
  v_org    uuid := pg_temp.fab_organisation(v_admin);
  v_pub    uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_profil uuid := pg_temp.fab_profil('expert');
  v_p1     uuid := gen_random_uuid();
  v_p2     uuid := gen_random_uuid();
  v_cand   jsonb;
  v_r      jsonb;
  v_r2     jsonb;
begin
  return next ok(public.ouvrir_depot_candidature(v_pub, v_profil, pg_temp.fab_domaine(), 'sonde', v_p1),
                 'le journal du dépôt s''ouvre');
  return next ok(exists (select 1 from public.candidature_depots d where d.publication_id = v_pub and d.profile_id = v_profil
                          and d.piece = v_p1 and d.etat = 'en_cours' and d.tentatives = 1),
                 'le journal du dépôt porte la pièce du geste, en cours, tentative 1');
  v_cand := jsonb_build_object('publication_id', v_pub, 'profile_id', v_profil, 'domain_id', pg_temp.fab_domaine(),
                               'ai_match_score', 7, 'ai_assessment', jsonb_build_object('reason', 'sonde', 'pitch_org', 'sonde', 'model', 'sonde'),
                               'ai_model', 'sonde', 'status', 'received', 'preview', '{}'::jsonb);
  v_r := public.inserer_candidature_jugee(v_p1, null, 'utilisateur', (select user_id from public.profiles where id = v_profil), 'expert_freelance', v_cand, 'sonde');
  return next ok(v_r ->> 'id' is not null
                 and exists (select 1 from public.candidatures c where c.id = (v_r ->> 'id')::uuid and c.ai_match_score = 7),
                 'la candidature est écrite AVEC sa note');
  return next ok(exists (select 1 from public.candidature_depots d where d.publication_id = v_pub and d.profile_id = v_profil
                          and d.etat = 'depose' and d.candidature_id = (v_r ->> 'id')::uuid),
                 'le journal du dépôt est soldé par l''écriture');
  return next is(pg_temp.lignes(v_p1), 1::bigint, 'exactement UNE ligne sous la pièce du dépôt');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'candidature_deposee'
                          and g.sujet_id = (v_r ->> 'id')::uuid and g.detail ->> 'tentative' = '1'),
                 'la ligne candidature_deposee porte la tentative');
  -- LA CONCURRENTE : même couple, autre pièce — rien n'est écrit.
  v_r2 := public.inserer_candidature_jugee(v_p2, null, 'systeme', null, null, v_cand, 'sonde');
  return next ok(v_r2 is null, 'une concurrente du même couple n''insère rien');
  return next is(pg_temp.lignes(v_p2), 0::bigint, 'la concurrente n''écrit aucune ligne');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
