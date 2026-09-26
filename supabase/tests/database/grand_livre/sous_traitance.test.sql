-- sous_traitance_publiee / sous_traitance_candidature — les faces « sous-traitance » de publier_annonce()
-- et inserer_candidature_jugee() : chaque type écrit SON code, et pas l'autre.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(5);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin   uuid := pg_temp.fab_compte('entreprise');
  v_org     uuid := pg_temp.fab_organisation(v_admin);
  v_st      uuid := pg_temp.fab_brouillon(v_org, 'sous_traitance');
  v_mission uuid := pg_temp.fab_brouillon(v_org, 'mission');
  v_dom     uuid := pg_temp.fab_domaine();
  v_p1      uuid := gen_random_uuid();
  v_p2      uuid := gen_random_uuid();
  v_cand    uuid;
begin
  perform public.publier_annonce(v_p1, null, 'utilisateur', v_admin, 'client', v_st, v_dom, v_org, array['draft'], 'published', 8, 'sonde', '{}'::jsonb);
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'sous_traitance_publiee' and g.sujet_id = v_st)
                 and pg_temp.lignes(v_p1) = 1,
                 'une sous-traitance publiée s''écrit sous SON nom, une ligne');
  return next ok(not exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'annonce_publiee'),
                 '… et pas sous celui d''une annonce');
  v_cand := pg_temp.fab_candidature(v_st, pg_temp.fab_profil('expert'));
  return next is((select count(*) from public.grand_livre g where g.sujet_id = v_cand and g.type_action = 'sous_traitance_candidature'), 1::bigint,
                 'une candidature à une sous-traitance s''écrit sous SON nom, une fois');
  return next ok(not exists (select 1 from public.grand_livre g where g.sujet_id = v_cand and g.type_action = 'candidature_deposee'),
                 '… et pas sous celui d''une candidature d''annonce');
  perform public.publier_annonce(v_p2, null, 'utilisateur', v_admin, 'client', v_mission, v_dom, v_org, array['draft'], 'published', 8, 'sonde', '{}'::jsonb);
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p2 and g.type_action = 'annonce_publiee')
                 and not exists (select 1 from public.grand_livre g where g.piece = v_p2 and g.type_action = 'sous_traitance_publiee'),
                 'une mission s''écrit sous le nom d''une annonce');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
