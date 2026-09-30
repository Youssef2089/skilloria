-- travail_ia_echoue / travail_ia_relance — `journaliser_travail_ia()`, l'écrivain UNIQUE des deux codes (§D.30),
-- appelé EN DIRECT : le code dérive du geste (abandon ou relance), le statut aussi ; UNE ligne sous la pièce ;
-- le détail passe la liste blanche ; une clé hors liste est refusée (GL004). Le cycle complet des travaux —
-- qui appelle cet écrivain depuis `clore_travail_ia_en_echec` et `relancer_travail_ia` — est prouvé par
-- tests/database/profil/travaux_ia.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(4);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_admin();
  v_profil uuid := pg_temp.fab_profil('expert');
  v_p1     uuid := gen_random_uuid();
  v_p2     uuid := gen_random_uuid();
begin
  perform public.journaliser_travail_ia(v_p1, null, 'systeme', null, null, pg_temp.fab_domaine(), v_profil, false,
                                        jsonb_build_object('nature', 'analyse_cv', 'code', 'delai_depasse', 'tentatives', 3));
  return next ok(pg_temp.lignes(v_p1) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p1
                  and g.type_action = 'travail_ia_echoue' and g.statut = 'echoue' and g.sujet_id = v_profil),
                 'abandon : UNE ligne travail_ia_echoue, au statut échoué, sujet le profil');
  perform public.journaliser_travail_ia(v_p2, null, 'administrateur', v_admin, 'admin', pg_temp.fab_domaine(), v_profil, true,
                                        jsonb_build_object('nature', 'verification_expert', 'travail_origine', gen_random_uuid(), 'code_origine', 'non_execute'));
  return next ok(pg_temp.lignes(v_p2) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p2
                  and g.type_action = 'travail_ia_relance' and g.statut = 'reussi' and g.acteur_id = v_admin),
                 'relance : UNE ligne travail_ia_relance, réussie, l administrateur pour acteur');
  return next throws_ok(format($q$select public.journaliser_travail_ia(gen_random_uuid(), null, 'systeme', null, null, null, %L, false,
                                    '{"nature":"analyse_cv","email":"sonde@exemple.invalid"}'::jsonb)$q$, v_profil),
                        'GL004', null, 'une clé hors liste blanche est refusée, nommément');
  return next ok(not has_function_privilege('authenticated', 'public.journaliser_travail_ia(uuid, uuid, text, uuid, text, uuid, uuid, boolean, jsonb)', 'execute'),
                 'l écrivain est fermé au navigateur');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
