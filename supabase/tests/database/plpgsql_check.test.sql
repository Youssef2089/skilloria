-- PLPGSQL_CHECK SUR CHAQUE FONCTION DE TRIGGER, AVEC SA TABLE — et sur toutes les autres.
--
-- Pourquoi (§E.73) : `handle_new_user` a inséré une colonne supprimée pendant quatre semaines ; toute
-- inscription d'expert échouait, et `db lint` était vide. La CLI appelle
-- `plpgsql_check_function(p.oid, format:='json')` SANS table : une fonction de trigger ne se vérifie
-- qu'avec la relation qui la déclenche (NEW et OLD en dépendent), donc elle n'est pas vérifiée
-- — le filtre exact de la CLI n'a pas pu être lu (NON VÉRIFIÉ), le trou, lui, est mesuré.
-- Ce test passe CHAQUE couple (fonction de trigger, table) à `plpgsql_check_function_tb`, et rougit sur
-- toute erreur ; puis toutes les fonctions plpgsql non-trigger du schéma public, pour ne pas dépendre
-- du lint seul.
--
-- Périmètre : les triggers non internes dont la fonction est plpgsql et vit dans `public` — quelle que
-- soit la table (auth.users compris : c'est là que vit on_auth_user_created). Fonctions d'extension
-- exclues (pg_depend 'e'). Seul le niveau `error` rougit ; les avertissements ne sont pas des pannes.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists plpgsql_check with schema extensions;
set local search_path to public, extensions;
select plan(4);

create temp view couples_trigger as
  select distinct t.tgfoid::regprocedure as fonction, t.tgrelid::regclass as relation
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where not t.tgisinternal
     and n.nspname = 'public'
     and l.lanname = 'plpgsql'
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');

select cmp_ok((select count(*) from couples_trigger), '>', 0::bigint,
              'le périmètre n''est pas vide : des fonctions de trigger plpgsql sont vérifiées');

select ok(exists (select 1 from couples_trigger c
                   where c.fonction = 'public.handle_new_user()'::regprocedure and c.relation = 'auth.users'::regclass),
          'handle_new_user est vérifié AVEC auth.users — le cas qui a échappé au lint');

select is(
  array(select format('%s sur %s, ligne %s : %s', c.fonction, c.relation, e.lineno, e.message)
          from couples_trigger c
          cross join lateral plpgsql_check_function_tb(c.fonction, c.relation) e
         where e.level = 'error'
         order by 1),
  array[]::text[],
  'aucune erreur plpgsql_check sur les fonctions de trigger, chacune avec sa table');

select is(
  array(select format('%s, ligne %s : %s', p.oid::regprocedure, e.lineno, e.message)
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          join pg_language l on l.oid = p.prolang
          cross join lateral plpgsql_check_function_tb(p.oid::regprocedure) e
         where n.nspname = 'public'
           and l.lanname = 'plpgsql'
           and p.prorettype <> 'trigger'::regtype
           and p.prorettype <> 'event_trigger'::regtype
           and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
           and e.level = 'error'
         order by 1),
  array[]::text[],
  'aucune erreur plpgsql_check sur les autres fonctions plpgsql du schéma public');

select * from finish();
rollback;
