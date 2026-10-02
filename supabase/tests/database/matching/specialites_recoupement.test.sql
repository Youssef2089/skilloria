-- LA PREUVE DU FILTRE DES SPÉCIALITÉS, DANS LES DEUX SENS (lot « critères des annonces », 03/10/2026 — point 1, §D.39 ;
-- la méthode des zones, validée par Youssef le 02/10/2026).
--
--  LE FILTRE RÉEL : le moteur ne passe par aucune fonction SQL de filtre.
--    · annonce → experts : lib/matching/pool.ts demande à la base les profils dont les spécialités recoupent celles de
--      l'annonce — `if (annonce.speciality_ids.length > 0) q = q.overlaps('speciality_ids', annonce.speciality_ids)`,
--      soit, en SQL, `cardinality(annonce) = 0 or profiles.speciality_ids && annonce.speciality_ids` ;
--    · expert → annonces : lib/matching/run-for-expert.ts lit les annonces puis les retient EN MÉMOIRE par
--      `annonceRetenuePourExpert` (lib/matching/recoupement.ts) — vide côté annonce = aucune contrainte, sinon au moins
--      une spécialité en commun — soit `cardinality(annonce) = 0 or publications.speciality_ids && profiles.speciality_ids`.
--  Les deux fonctions ci-dessous suivent CE chemin. `diag-specialites-recoupement` rougit si l'un des deux sens perd son
--  prédicat, si ce test cesse de l'employer, et EXÉCUTE le prédicat en mémoire du moteur sur les mêmes cas.
--
--  LE CHEMIN NORMAL : les comptes et profils naissent par l'inscription (fabriques) ; les spécialités s'écrivent comme la
--  route les écrit (`update … set speciality_ids`, après résolution des slugs du référentiel de la branche). Les deux
--  spécialités sont des lignes du référentiel, créées dans la branche de l'écosystème du test (rien ne survit au rollback).
--
--  CHAQUE CAS ÉCHOUE SANS LE FILTRE : chaque assertion compare l'ENSEMBLE EXACT retenu parmi des candidats choisis, dont
--  au moins un TÉMOIN que seul le recoupement des spécialités écarte.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(8);

-- Une spécialité du référentiel, dans la branche active de l'écosystème du test.
create or replace function pg_temp.specialite(p_nom text) returns uuid
language plpgsql as $$
declare
  v_branche uuid;
  v         uuid;
begin
  select b.id into v_branche from public.branches b
   where b.domain_id = pg_temp.fab_domaine() and b.active order by b.slug limit 1;
  if v_branche is null then raise exception 'test : aucune branche active dans l''écosystème'; end if;
  insert into public.specialities (branch_id, domain_id, name, slug, active, sort_order)
  values (v_branche, pg_temp.fab_domaine(), p_nom, 'sonde-' || substr(md5(p_nom || clock_timestamp()::text), 1, 12), true, 0)
  returning id into v;
  return v;
end $$;

-- LE CHEMIN DU MOTEUR, tel quel. Sens annonce → experts (pool.ts) : le recoupement n'est posé que si l'annonce déclare.
create or replace function pg_temp.experts_retenus(p_annonce uuid, p_parmi uuid[]) returns uuid[]
language sql as $$
  select coalesce(array_agg(p.id order by p.id), '{}')
    from public.profiles p
   where p.id = any (p_parmi)
     and (cardinality((select a.speciality_ids from public.publications a where a.id = p_annonce)) = 0
          or p.speciality_ids && (select a.speciality_ids from public.publications a where a.id = p_annonce))
$$;
-- Sens expert → annonces (run-for-expert.ts → annonceRetenuePourExpert) : vide côté annonce = aucune contrainte.
create or replace function pg_temp.annonces_retenues(p_profil uuid, p_parmi uuid[]) returns uuid[]
language sql as $$
  select coalesce(array_agg(a.id order by a.id), '{}')
    from public.publications a
   where a.id = any (p_parmi)
     and (cardinality(a.speciality_ids) = 0
          or a.speciality_ids && (select p.speciality_ids from public.profiles p where p.id = p_profil))
$$;
create or replace function pg_temp.trie(p uuid[]) returns uuid[]
language sql as $$ select coalesce(array_agg(x order by x), '{}') from unnest(p) x $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  s_a     uuid := pg_temp.specialite('Sonde Alpha');
  s_b     uuid := pg_temp.specialite('Sonde Bêta');
  s_c     uuid := pg_temp.specialite('Sonde Gamma');
  -- Les experts : spécialité A, spécialité B (le TÉMOIN), A et B, et « Autre (préciser) » seul (aucun identifiant).
  e_a     uuid := pg_temp.fab_profil('expert');
  e_b     uuid := pg_temp.fab_profil('expert');
  e_ab    uuid := pg_temp.fab_profil('cdi');
  e_autre uuid := pg_temp.fab_profil('expert');
  v_org   uuid := pg_temp.fab_organisation(pg_temp.fab_compte('entreprise'));
  -- Les annonces : spécialité A, spécialités A ou C, spécialité B, et « Autre » seul (aucun identifiant).
  a_a     uuid := pg_temp.fab_brouillon(v_org, 'mission');
  a_ac    uuid := pg_temp.fab_brouillon(v_org, 'sous_traitance');
  a_b     uuid := pg_temp.fab_brouillon(v_org, 'offre');
  a_autre uuid := pg_temp.fab_brouillon(v_org, 'mission');
begin
  -- Les spécialités, comme les routes les écrivent.
  update public.profiles set speciality_ids = array[s_a]      where id = e_a;
  update public.profiles set speciality_ids = array[s_b]      where id = e_b;
  update public.profiles set speciality_ids = array[s_a, s_b] where id = e_ab;
  update public.profiles set speciality_ids = '{}', speciality_other = 'Sonde libre' where id = e_autre;
  update public.publications set speciality_ids = array[s_a]      where id = a_a;
  update public.publications set speciality_ids = array[s_a, s_c] where id = a_ac;
  update public.publications set speciality_ids = array[s_b]      where id = a_b;
  update public.publications set speciality_ids = '{}', speciality_other = 'Sonde libre' where id = a_autre;

  -- ① Annonce « A » : l'expert A et l'expert A+B sont retenus ; l'expert B (TÉMOIN) et l'expert « Autre » écartés.
  return next is(pg_temp.experts_retenus(a_a, array[e_a, e_b, e_ab, e_autre]), pg_temp.trie(array[e_a, e_ab]),
    '1. annonce « A » : les experts A et A+B sont retenus, l''expert B (témoin) et l''expert « Autre » seul écartés');

  -- ② Annonce « A ou C » (sous-traitance) : une spécialité en commun suffit.
  return next is(pg_temp.experts_retenus(a_ac, array[e_a, e_b]), pg_temp.trie(array[e_a]),
    '2. besoin de sous-traitance « A ou C » : l''expert A est retenu, l''expert B (témoin) écarté');

  -- ③ Annonce « B » (offre CDI) : l'expert B et l'expert A+B, pas l'expert A.
  return next is(pg_temp.experts_retenus(a_b, array[e_a, e_b, e_ab]), pg_temp.trie(array[e_b, e_ab]),
    '3. offre « B » : les experts B et A+B sont retenus, l''expert A (témoin) écarté');

  -- ④ Annonce « Autre » seule : aucun identifiant, aucune contrainte de spécialité — tous les candidats.
  return next is(pg_temp.experts_retenus(a_autre, array[e_a, e_b, e_autre]), pg_temp.trie(array[e_a, e_b, e_autre]),
    '4. annonce « Autre » seule : aucune contrainte de spécialité, les trois experts sont retenus');

  -- ⑤ L'AUTRE SENS — expert A : les annonces « A » et « A ou C », et l'annonce « Autre » ; pas l'annonce « B » (témoin).
  return next is(pg_temp.annonces_retenues(e_a, array[a_a, a_ac, a_b, a_autre]), pg_temp.trie(array[a_a, a_ac, a_autre]),
    '5. expert A : les annonces « A », « A ou C » et « Autre » sont retenues, l''annonce « B » (témoin) écartée');

  -- ⑥ Expert B : l'annonce « B » et l'annonce « Autre » ; pas « A » ni « A ou C ».
  return next is(pg_temp.annonces_retenues(e_b, array[a_a, a_ac, a_b, a_autre]), pg_temp.trie(array[a_b, a_autre]),
    '6. expert B : les annonces « B » et « Autre » sont retenues, « A » et « A ou C » écartées');

  -- ⑦ Expert « Autre » seul : seules les annonces sans spécialité du référentiel.
  return next is(pg_temp.annonces_retenues(e_autre, array[a_a, a_b, a_autre]), pg_temp.trie(array[a_autre]),
    '7. expert « Autre » seul : seule l''annonce « Autre » est retenue, « A » et « B » écartées');

  -- ⑧ Les spécialités écrites sont des lignes du référentiel de la branche (le chemin normal des routes).
  return next ok((select count(*) from public.specialities s where s.id = any (array[s_a, s_b, s_c]) and s.active) = 3,
    '8. les trois spécialités sont des lignes ACTIVES du référentiel de la branche');
end $$;

select * from pg_temp.essai();

select * from finish();
rollback;
