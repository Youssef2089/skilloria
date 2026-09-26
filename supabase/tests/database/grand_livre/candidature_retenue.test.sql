-- candidature_retenue — retenir_candidature() : la transition et sa ligne, ensemble, selected_at posé par
-- la base ; le rejeu rend null sans seconde ligne.
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
  v_dom   uuid := pg_temp.fab_domaine();
  v_p1    uuid := gen_random_uuid();
  v_p2    uuid := gen_random_uuid();
  v_quand timestamptz;
begin
  perform public.devoiler_candidature(gen_random_uuid(), null, 'utilisateur', v_admin, 'client', v_cand,
                                      array['received', 'in_review', 'shortlisted'], now() + interval '15 days', false);
  v_quand := public.retenir_candidature(v_p1, null, 'utilisateur', v_admin, 'client', v_cand, v_dom, v_org, array['unlocked']);
  return next ok(v_quand is not null, 'la candidature est retenue, la base rend selected_at');
  return next ok(exists (select 1 from public.candidatures c where c.id = v_cand and c.status = 'selected' and c.selected_at = v_quand),
                 'la transition et la date sont relues');
  return next is(pg_temp.lignes(v_p1), 1::bigint, 'exactement UNE ligne sous la pièce');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'candidature_retenue'
                          and g.sujet_id = v_cand and g.detail ->> 'publication_type' = 'mission'),
                 'la ligne candidature_retenue porte le type de publication');
  return next ok(public.retenir_candidature(v_p2, null, 'utilisateur', v_admin, 'client', v_cand, v_dom, v_org, array['unlocked']) is null
                 and pg_temp.lignes(v_p2) = 0,
                 'le rejeu rend null et n''écrit rien');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
