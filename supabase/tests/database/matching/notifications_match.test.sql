-- LA NOTIFICATION D'UNE MISE EN RELATION S'ÉCRIT (§E.69 recopié, M7) — `poser_notifications_match` :
--   la clause porte le PRÉDICAT de l'index partiel ; une paire déjà notifiée est IGNORÉE (pas d'erreur, rien de
--   plus) ; la forme SANS prédicat — celle qu'écrivait `upsert(onConflict)` — est refusée par la base (42P10).
-- Comptes fabriqués par le chemin normal ; l'identifiant d'annonce est inventé (entity_id n'a pas de clé étrangère).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(5);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_user    uuid := pg_temp.fab_compte('expert');
  v_domaine uuid := pg_temp.fab_domaine();
  v_annonce uuid := gen_random_uuid();
  v_ligne   jsonb;
begin
  v_ligne := jsonb_build_array(jsonb_build_object(
    'user_id', v_user, 'domain_id', v_domaine, 'title', 'Sonde', 'body', 'Sonde',
    'link_url', '/dashboard/freelance/missions/' || v_annonce, 'entity_id', v_annonce, 'piece', gen_random_uuid()));

  return next is(public.poser_notifications_match(v_ligne), 1, 'la notification est POSÉE (1 ligne)');
  return next is(public.poser_notifications_match(v_ligne), 0, 'la même paire est IGNORÉE : 0 ligne, aucune erreur');
  return next ok((select count(*) = 1 from public.notifications n
                   where n.user_id = v_user and n.entity_id = v_annonce and n.type = 'new_match_opportunity'),
                 'une seule notification pour la paire, du type posé PAR LA FONCTION');
  return next throws_ok(
    format($q$insert into public.notifications (user_id, domain_id, type, entity_id) values (%L, %L, 'new_match_opportunity', %L)
              on conflict (user_id, entity_id) do nothing$q$, v_user, v_domaine, gen_random_uuid()),
    '42P10', null, 'la forme SANS prédicat (celle de l ancien upsert) est refusée : l index partiel ne s infère pas');
  return next throws_ok($q$select public.poser_notifications_match('{}'::jsonb)$q$, '22023', null, 'un objet au lieu d un tableau est refusé');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
