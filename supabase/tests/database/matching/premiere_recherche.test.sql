-- UNE PREMIÈRE MISE EN RELATION RATÉE EST REJOUÉE (M5, §C.14) :
--   A. `echouer_relance_expert` POSE une échéance quand il n'y en a pas — sans elle, ni la file ni l'écran ne
--      voyaient l'échec d'une recherche lancée directement (approbation, auto-approbation, bascule) ;
--   B. la file la reprend (délai de grâce négatif pour le test : `now()` est figé dans la transaction) ;
--   C. une échéance déjà posée n'est pas avancée ;
--   D. `programmer_relance_expert` rouvre le compteur de tentatives (une modification est une raison nouvelle).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(5);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil uuid := pg_temp.fab_profil('expert');
  v_due    timestamptz;
  v_i      integer;
begin
  perform public.echouer_relance_expert(v_profil, 'moteur_indisponible');
  return next ok((select p.matching_relance_due_at is not null and p.matching_relance_first_at is not null
                         and p.matching_relance_echec_code = 'moteur_indisponible'
                    from public.profiles p where p.id = v_profil),
                 'A. l échec POSE une échéance et le motif : l écran et la file le voient');
  -- `now()` est FIGÉ pour toute la transaction : l'échéance posée ici vaut exactement `now()`, et la garde
  -- stricte (`< now() - grâce`) demande une grâce NÉGATIVE pour la voir. Le temps ne passe pas dans un test.
  return next is(public.prochaine_relance_expert(interval '6 hours', interval '-1 second', 5), v_profil,
                 'B. la file la REPREND');
  update public.profiles set matching_relance_due_at = now() + interval '1 hour' where id = v_profil;
  select p.matching_relance_due_at into v_due from public.profiles p where p.id = v_profil;
  perform public.echouer_relance_expert(v_profil, 'lecture_en_panne');
  return next ok((select p.matching_relance_due_at = v_due from public.profiles p where p.id = v_profil),
                 'C. une échéance déjà posée n est pas avancée');
  for v_i in 1..5 loop
    perform public.marquer_tentative_relance(v_profil);
  end loop;
  return next ok((select p.matching_relance_tentatives >= 5 from public.profiles p where p.id = v_profil),
                 'D. cinq tentatives : le plafond est atteint');
  perform public.programmer_relance_expert(v_profil, interval '10 minutes', 'cv_reanalyse');
  return next ok((select p.matching_relance_tentatives = 0 from public.profiles p where p.id = v_profil),
                 'D. une modification ROUVRE le compteur : la relance sera de nouveau sélectionnée');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
