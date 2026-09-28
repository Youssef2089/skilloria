-- UNE FONCTION, UNE SIGNATURE — sur la base REJOUÉE, aucune fonction du schéma public n'a deux signatures,
-- sauf une exception ÉCRITE ci-dessous, avec sa raison.
--
-- Pourquoi : deux fonctions du même nom laissent un appelant écrire par l'ancienne, SANS journaliser, en
-- silence — PostgREST choisit la signature d'après les arguments nommés. Le lot en a supprimé quatre
-- (maj_membre_organisation, programmer_suppression_compte, ouvrir_depot_candidature, set_default_package).
-- Le balayage statique des migrations (docs/reprise.md §1.4) en compte 0 ; ce test le dit sur la base.
--
-- La règle de suppression d'une signature (docs/pieges.md §E.72) : ajouter, déployer, supprimer au
-- déploiement SUIVANT. Pendant l'étape 1, l'ancienne signature s'inscrit ici, avec sa raison ; elle en
-- sort à l'étape 3 — le second test rougit si elle y reste.
--
-- Fonctions d'extension exclues (pg_depend 'e') : elles ne sont pas à nous.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

create temp table exceptions_surcharge (nom name primary key, raison text not null check (raison <> ''));
-- LA PHASE B (28/09/2026), étape 1 de §E.72. La nouvelle signature (uuid, uuid, text, uuid, text, text) porte le
-- contexte du journal (migration journal_tache_lancee_a_la_main) ; l'ANCIENNE (text, uuid) reste parce que le code
-- EN LIGNE l'appelle jusqu'au déploiement de la phase B. Elle se retire par la migration du déploiement SUIVANT
-- (dette nommée, docs/reprise.md ARRÊT 8) — et alors cette ligne rougit (« n'est plus une surcharge ») : on la retire.
-- stripe_event_claim n'a pas d'exception : sa remplaçante porte un AUTRE nom (stripe_event_reclamer), pas une surcharge.
insert into exceptions_surcharge values ('admin_cron_run_now',
  'étape 1 de §E.72 : l''ancienne signature (text, uuid) est appelée par le code en ligne jusqu''au déploiement de la phase B ; retirée par la migration du déploiement suivant');
-- insert into exceptions_surcharge values ('nom_de_fonction', 'étape 1 de §E.72 : l''ancienne signature reste jusqu''au déploiement de <lot>');

create temp view surcharges as
  select p.proname as nom, count(*) as n,
         string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text) as signatures
    from pg_proc p
    join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
   group by p.proname
  having count(*) > 1;

select is(
  array(select v.signatures from surcharges v where v.nom not in (select e.nom from exceptions_surcharge e) order by 1),
  array[]::text[],
  'aucune fonction public n''a deux signatures hors exception écrite');

select is(
  array(select e.nom::text from exceptions_surcharge e where e.nom not in (select v.nom from surcharges v) order by 1),
  array[]::text[],
  'chaque exception est encore une surcharge — sinon, la retirer (étape 3 de §E.72)');

select * from finish();
rollback;
