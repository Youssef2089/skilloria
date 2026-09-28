-- annonce_depubliee — cloturer_annonce() : la clôture et sa ligne, ensemble ; autre organisation et
-- rejeu rendent false sans ligne.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(5);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin uuid := pg_temp.fab_compte('entreprise');
  v_org   uuid := pg_temp.fab_organisation(v_admin);
  v_pub   uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_dom   uuid := pg_temp.fab_domaine();
  v_p0    uuid := gen_random_uuid();
  v_p1    uuid := gen_random_uuid();
  v_p2    uuid := gen_random_uuid();
  v_ok    boolean;
begin
  return next ok(not public.cloturer_annonce(v_p0, null, 'utilisateur', v_admin, 'client', v_pub, v_dom, gen_random_uuid(), array['published'])
                 and pg_temp.lignes(v_p0) = 0,
                 'une autre organisation ne clôture rien, et n''écrit rien');
  -- L'écriture D'ABORD, la relecture ENSUITE (§E.74) : dans une seule expression, la sous-requête
  -- lisait l'instantané d'avant la clôture — c'est l'échec du 28/09/2026, pas le produit.
  v_ok := public.cloturer_annonce(v_p1, null, 'utilisateur', v_admin, 'client', v_pub, v_dom, v_org, array['published']);
  return next ok(v_ok
                 and exists (select 1 from public.publications p where p.id = v_pub and p.status = 'archived'),
                 'l''annonce est clôturée, la transition est relue');
  return next is(pg_temp.lignes(v_p1), 1::bigint, 'exactement UNE ligne sous la pièce');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'annonce_depubliee'
                          and g.detail ->> 'de' = 'published' and g.detail ->> 'vers' = 'archived'),
                 'la ligne dit d''où et vers où');
  return next ok(not public.cloturer_annonce(v_p2, null, 'utilisateur', v_admin, 'client', v_pub, v_dom, v_org, array['published'])
                 and pg_temp.lignes(v_p2) = 0,
                 'le rejeu rend false et n''écrit rien');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
