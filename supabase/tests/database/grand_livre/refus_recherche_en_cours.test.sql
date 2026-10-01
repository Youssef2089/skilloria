-- refus_recherche_en_cours — RETIRÉE du grand livre (décision de Youssef, 01/10/2026, ARRÊT 22) : une recherche
-- écartée parce qu'une autre tient le bail n'est pas un fait métier ; la recherche qui tient le bail écrit sa ligne
-- de fin. Le bail, lui, tient toujours (§D.22) : la première prise réussit, la seconde est écartée. Pendant la fenêtre
-- db push → git push, le code en ligne écrit encore ce refus : la base l'ACCEPTE (le refus GL006 part au lot suivant).
-- Et la garde GL004 compare toujours les chemins des FEUILLES du détail.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(5);

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
  return next lives_ok(format($q$select public.journaliser(%L, 'refus_recherche_en_cours', 'refuse', 'utilisateur', %L, 'expert_freelance', null, 'profiles', %L, '{"tache":null}'::jsonb, null, null, null)$q$,
                              v_p, v_user, v_profil),
                       'pendant la fenêtre, le refus qu''écrit encore le code en ligne est ACCEPTÉ (le refus GL006 part au lot suivant)');
  return next is(pg_temp.lignes(v_p), 1::bigint, 'exactement UNE ligne sous la pièce — la forme du code en ligne passe');
  -- Ce que la garde GL004 compare : les chemins des FEUILLES du détail, lus EN DIRECT ([] pour un tableau,
  -- un objet vide est une feuille).
  return next is(array(select c from public.grand_livre_chemins('{"a":{"b":1},"t":[{"k":2},{"k":3}],"v":{}}'::jsonb) c),
                 array['a.b', 't[].k', 'v']::text[],
                 'grand_livre_chemins : les feuilles, une fois chacune, [] pour un tableau');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
