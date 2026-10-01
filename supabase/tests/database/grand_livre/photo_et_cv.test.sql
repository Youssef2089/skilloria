-- photo_deposee et cv_consulte — deux actions écrites par le TypeScript (lib/profil/journal-profil.ts) à travers
-- journaliser() (fusion de la recette S1, décisions de Youssef du 01/10/2026). Le test rejoue la forme EXACTE des deux
-- écrivains : la photo de l'expert sur son profil, avec le seul fait « remplacement » ; le CV ouvert par un
-- administrateur, détail vide. UNE ligne sous la pièce de chaque geste ; une clé hors liste (un chemin de fichier) est
-- refusée ; le statut est imposé.
-- Colonnes lues dans les migrations (§G.10) : grand_livre (acteur_si_humain, statut, origine), grand_livre_actions
-- (statut_impose, cles_detail).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(6);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_profil uuid := pg_temp.fab_profil('expert');
  v_admin  uuid := pg_temp.fab_admin();
  v_user   uuid;
  v_p1     uuid := gen_random_uuid();
  v_p2     uuid := gen_random_uuid();
begin
  select p.user_id into v_user from public.profiles p where p.id = v_profil;

  -- ── La photo : la forme de photoDeposee() ──
  perform public.journaliser(v_p1, 'photo_deposee', 'reussi', 'utilisateur', v_user, 'expert_freelance', pg_temp.fab_domaine(),
                             'profiles', v_profil, jsonb_build_object('remplacement', true), null::uuid, null::numeric, null::text);
  return next ok(pg_temp.lignes(v_p1) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p1
                   and g.type_action = 'photo_deposee' and g.sujet_id = v_profil and g.acteur_id = v_user
                   and g.detail = '{"remplacement": true}'::jsonb),
                 'photo déposée : UNE ligne, sujet le profil, le seul fait « remplacement »');
  return next throws_ok(format($q$select public.journaliser(%L, 'photo_deposee', 'reussi', 'utilisateur', %L, 'expert_freelance', null, 'profiles', %L, '{"chemin":"x/avatar.jpg"}'::jsonb, null, null, null)$q$,
                               gen_random_uuid(), v_user, v_profil),
                        'GL004', null, 'photo déposée : le chemin du fichier est refusé (hors liste)');
  return next throws_ok(format($q$select public.journaliser(%L, 'photo_deposee', 'echoue', 'utilisateur', %L, 'expert_freelance', null, 'profiles', %L, '{}'::jsonb, null, null, null)$q$,
                               gen_random_uuid(), v_user, v_profil),
                        'GL003', null, 'photo déposée : le statut est imposé (réussi)');

  -- ── Le CV consulté : la forme de cvConsulte() ──
  perform public.journaliser(v_p2, 'cv_consulte', 'reussi', 'administrateur', v_admin, 'admin', null,
                             'profiles', v_profil, '{}'::jsonb, null::uuid, null::numeric, null::text);
  return next ok(pg_temp.lignes(v_p2) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p2
                   and g.type_action = 'cv_consulte' and g.sujet_id = v_profil and g.acteur_id = v_admin
                   and g.origine = 'administrateur' and g.detail = '{}'::jsonb),
                 'CV consulté : UNE ligne, l''administrateur, le profil, aucun détail');
  return next throws_ok(format($q$select public.journaliser(%L, 'cv_consulte', 'reussi', 'administrateur', %L, 'admin', null, 'profiles', %L, '{"cv_file_path":"x.pdf"}'::jsonb, null, null, null)$q$,
                               gen_random_uuid(), v_admin, v_profil),
                        'GL004', null, 'CV consulté : aucun chemin de fichier au grand livre');
  return next is((select famille from public.grand_livre_actions where code = 'cv_consulte'), 'rgpd',
                 'CV consulté : rangé avec les données personnelles (famille rgpd)');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
