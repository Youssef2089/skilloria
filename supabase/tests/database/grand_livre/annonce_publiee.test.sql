-- annonce_publiee — publier_annonce() : la mise en ligne, le verdict et la ligne, ensemble ; published_at
-- posé par la base ; rejeu et autre organisation rendent null ; un verdict qui ne publie pas n'écrit pas de ligne.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(7);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin uuid := pg_temp.fab_compte('entreprise');
  v_org   uuid := pg_temp.fab_organisation_approuvee(v_admin);
  v_pub   uuid := pg_temp.fab_brouillon(v_org);
  v_revue uuid := pg_temp.fab_brouillon(v_org);
  v_dom   uuid := pg_temp.fab_domaine();
  v_p0    uuid := gen_random_uuid();
  v_p1    uuid := gen_random_uuid();
  v_p2    uuid := gen_random_uuid();
  v_p3    uuid := gen_random_uuid();
  v_r     jsonb;
begin
  -- UNE AUTRE ORGANISATION D'ABORD, sur le brouillon intact.
  return next ok(public.publier_annonce(v_p0, null, 'utilisateur', v_admin, 'client', v_pub, v_dom, gen_random_uuid(),
                                        array['draft'], 'published', 8, 'sonde', '{}'::jsonb) is null
                 and pg_temp.lignes(v_p0) = 0,
                 'une autre organisation ne publie rien, et n''écrit rien');
  v_r := public.publier_annonce(v_p1, null, 'utilisateur', v_admin, 'client', v_pub, v_dom, v_org,
                                array['draft'], 'published', 8, 'sonde', '{}'::jsonb);
  return next ok(v_r ->> 'status' = 'published' and v_r ->> 'published_at' is not null, 'l''annonce est publiée, la base pose published_at');
  return next is(pg_temp.lignes(v_p1), 1::bigint, 'exactement UNE ligne sous la pièce');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'annonce_publiee'
                          and g.sujet_id = v_pub and g.ecosysteme_id = v_dom and g.detail ->> 'type' = 'mission'
                          and g.detail ->> 'organization_id' = v_org::text),
                 'la ligne annonce_publiee porte le type et l''organisation, sous l''écosystème de l''annonce');
  return next ok(public.publier_annonce(v_p2, null, 'utilisateur', v_admin, 'client', v_pub, v_dom, v_org,
                                        array['draft'], 'published', 8, 'sonde', '{}'::jsonb) is null
                 and pg_temp.lignes(v_p2) = 0,
                 'le rejeu rend null et n''écrit rien');
  -- UN VERDICT QUI NE PUBLIE PAS : le verdict est écrit, aucune ligne.
  v_r := public.publier_annonce(v_p3, null, 'utilisateur', v_admin, 'client', v_revue, v_dom, v_org,
                                array['draft'], 'pending_review', 4, 'sonde', '{}'::jsonb);
  return next is(v_r ->> 'status', 'pending_review', 'pending_review écrit le verdict');
  return next is(pg_temp.lignes(v_p3), 0::bigint, 'pending_review n''écrit aucune ligne');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
