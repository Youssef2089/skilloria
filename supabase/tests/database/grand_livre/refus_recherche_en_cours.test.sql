-- refus_recherche_en_cours — le refus est écrit par le module (lib/matching/journal-de-recherche.ts) à
-- travers journaliser(), quand prendre_bail('matching_expert', <profil>) rend false. Le test rejoue la
-- séquence du module : le bail tenu, la seconde prise refusée, le refus écrit sous la pièce du geste
-- qui a déclenché la recherche — UNE ligne ; réussi et clé hors liste refusés.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(7);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil uuid := pg_temp.fab_profil('expert');
  v_user   uuid;
  v_p      uuid := gen_random_uuid();
begin
  select p.user_id into v_user from public.profiles p where p.id = v_profil;
  return next ok(public.prendre_bail('matching_expert', v_profil::text, interval '5 minutes'),
                 'la première recherche prend le bail');
  return next ok(not public.prendre_bail('matching_expert', v_profil::text, interval '5 minutes'),
                 'la seconde est écartée : le bail est tenu');
  -- La forme exacte du module : le geste de l'expert, sujet le profil, la tâche (nulle hors tâche).
  perform public.journaliser(v_p, 'refus_recherche_en_cours', 'refuse', 'utilisateur',
                             v_user, 'expert_freelance', pg_temp.fab_domaine(), 'profiles', v_profil,
                             jsonb_build_object('tache', null), null::uuid, null::numeric, null::text);
  return next is(pg_temp.lignes(v_p), 1::bigint, 'exactement UNE ligne sous la pièce du geste');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p and g.type_action = 'refus_recherche_en_cours'
                          and g.statut = 'refuse' and g.sujet_id = v_profil),
                 'la ligne est un refus, sujet le profil');
  return next throws_ok(format($q$select public.journaliser(%L, 'refus_recherche_en_cours', 'reussi', 'tache_planifiee', null, null, null, 'profiles', %L, '{"tache":"expert_relance"}'::jsonb, null, null, null)$q$,
                               gen_random_uuid(), v_profil),
                        'GL003', null, 'un refus n''est jamais « réussi »');
  return next throws_ok(format($q$select public.journaliser(%L, 'refus_recherche_en_cours', 'refuse', 'tache_planifiee', null, null, null, 'profiles', %L, '{"tache":"expert_relance","bail_detenu_par":"x"}'::jsonb, null, null, null)$q$,
                               gen_random_uuid(), v_profil),
                        'GL004', null, 'une clé hors liste est refusée');
  -- Ce que la garde GL004 compare : les chemins des FEUILLES du détail, lus EN DIRECT ([] pour un tableau,
  -- un objet vide est une feuille).
  return next is(array(select c from public.grand_livre_chemins('{"a":{"b":1},"t":[{"k":2},{"k":3}],"v":{}}'::jsonb) c),
                 array['a.b', 't[].k', 'v']::text[],
                 'grand_livre_chemins : les feuilles, une fois chacune, [] pour un tableau');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
