-- annonce_expiree — constater_annonces_expirees() : une annonce publiée qui n'est plus active est constatée
-- (marqueur + ligne, une fois, avec la durée de vie en vigueur) ; un second passage ne la reconstate pas ;
-- une annonce encore active n'est pas constatée.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(5);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_compte('entreprise');
  v_org    uuid := pg_temp.fab_organisation(v_admin);
  v_vieille uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_active uuid := pg_temp.fab_annonce_publiee(v_org, v_admin);
  v_vie    integer;
  v_p1     uuid := gen_random_uuid();
  v_p2     uuid := gen_random_uuid();
begin
  select d.vie_annonce_jours into v_vie from public.duree_reglages d where d.ligne_unique;
  -- L'annonce vieillit : publiée il y a plus que sa durée de vie (le temps passe, rien d'autre).
  update public.publications set published_at = now() - make_interval(days => v_vie + 2), expires_at = null where id = v_vieille;
  return next ok(not public.annonce_active('published', null, now() - make_interval(days => v_vie + 2), v_vie),
                 'témoin : la règle de la base la dit expirée');
  perform public.constater_annonces_expirees(v_p1, v_vie, 200);
  return next ok(exists (select 1 from public.publications p where p.id = v_vieille and p.expiration_constatee_at is not null),
                 'l''annonce expirée porte son marqueur');
  return next is((select count(*) from public.grand_livre g where g.piece = v_p1 and g.type_action = 'annonce_expiree'
                   and g.sujet_id = v_vieille and (g.detail ->> 'vie_annonce_jours')::int = v_vie), 1::bigint,
                 'exactement UNE ligne pour l''annonce, avec la durée de vie en vigueur');
  return next ok(not exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.sujet_id = v_active)
                 and exists (select 1 from public.publications p where p.id = v_active and p.expiration_constatee_at is null),
                 'une annonce encore active n''est pas constatée');
  perform public.constater_annonces_expirees(v_p2, v_vie, 200);
  return next ok(not exists (select 1 from public.grand_livre g where g.piece = v_p2 and g.sujet_id = v_vieille),
                 'un second passage ne reconstate pas l''annonce');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
