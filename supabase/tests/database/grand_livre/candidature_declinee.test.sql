-- candidature_declinee — decliner_candidature() : la transition et sa ligne, ensemble ; une autre
-- organisation ne décline rien ; le rejeu rend false sans seconde ligne.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(6);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin uuid := pg_temp.fab_compte('entreprise');
  v_org   uuid := pg_temp.fab_organisation(v_admin);
  v_pub   uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_cand  uuid := pg_temp.fab_candidature(v_pub, pg_temp.fab_profil('expert'));
  v_dom   uuid := pg_temp.fab_domaine();
  v_p0    uuid := gen_random_uuid();
  v_p1    uuid := gen_random_uuid();
  v_p2    uuid := gen_random_uuid();
  v_admis text[] := array['received', 'in_review', 'shortlisted'];
begin
  -- UNE AUTRE ORGANISATION D'ABORD, sur la candidature intacte (§E.37).
  return next ok(not public.decliner_candidature(v_p0, null, 'utilisateur', v_admin, 'client', v_cand, v_dom, gen_random_uuid(), 'x', v_admis)
                 and pg_temp.lignes(v_p0) = 0,
                 'une autre organisation ne décline rien, et n''écrit rien');
  return next ok(public.decliner_candidature(v_p1, null, 'utilisateur', v_admin, 'client', v_cand, v_dom, v_org, 'raison de sonde', v_admis),
                 'la candidature est déclinée');
  return next ok(exists (select 1 from public.candidatures c where c.id = v_cand and c.status = 'rejected'),
                 'la transition est relue');
  return next is(pg_temp.lignes(v_p1), 1::bigint, 'exactement UNE ligne sous la pièce');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'candidature_declinee'
                          and g.sujet_id = v_cand and (g.detail ->> 'has_reason')::boolean
                          and g.detail::text not like '%raison de sonde%'),
                 'la ligne dit qu''il y a une raison, jamais son texte');
  return next ok(not public.decliner_candidature(v_p2, null, 'utilisateur', v_admin, 'client', v_cand, v_dom, v_org, 'x', v_admis)
                 and pg_temp.lignes(v_p2) = 0,
                 'le rejeu rend false et n''écrit rien');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
