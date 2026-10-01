-- verification_conclue — `poser_verdict_verification()`, l'écrivain UNIQUE du verdict automatique (§D.30) :
-- approuvé → profil approuvé, drapeau du compte, état du compte (en revue → actif), UNE ligne ; déféré → revue
-- humaine, drapeau retombé, UNE ligne ; le motif est un CODE ; la pièce est obligatoire. Et l'arbitrage HUMAIN
-- (`statuer_sur_expert`) remet lui aussi le compte « actif ».
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(8);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin   uuid := pg_temp.fab_admin();
  v_profil  uuid := pg_temp.fab_profil('expert');
  v_profil2 uuid := pg_temp.fab_profil('expert');
  v_user    uuid;
  v_user2   uuid;
  v_p1      uuid := gen_random_uuid();
  v_p2      uuid := gen_random_uuid();
  v_p3      uuid := gen_random_uuid();
begin
  select p.user_id into v_user from public.profiles p where p.id = v_profil;
  select p.user_id into v_user2 from public.profiles p where p.id = v_profil2;
  update public.users set status = 'in_review' where id in (v_user, v_user2);

  perform public.poser_verdict_verification(v_p1, v_profil, true, 'ai_web_search', 9, 'note_suffisante');
  return next ok((select p.verification_status = 'approved' and p.verified_by is null and p.verification_score = 9 from public.profiles p where p.id = v_profil)
                 and (select u.is_verified and u.status = 'active' from public.users u where u.id = v_user),
                 'approuvé : profil, drapeau ET état du compte, ensemble');
  return next ok(pg_temp.lignes(v_p1) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p1
                  and g.type_action = 'verification_conclue' and (g.detail ->> 'approuve')::boolean and g.origine = 'systeme'
                  and g.acteur_id is null and g.sujet_id = v_profil and (g.detail ->> 'note')::numeric = 9),
                 'exactement UNE ligne verification_conclue, origine système, sans acteur, avec la note (ARRÊT 22)');

  perform public.poser_verdict_verification(v_p2, v_profil, false, 'manual_only', null, 'drapeau_bloquant');
  return next ok((select p.verification_status = 'pending_admin_review' from public.profiles p where p.id = v_profil)
                 and (select not u.is_verified from public.users u where u.id = v_user),
                 'déféré : revue humaine, et le drapeau du compte RETOMBE dans la même transaction');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p2 and g.type_action = 'verification_conclue'
                          and (g.detail ->> 'approuve')::boolean = false and g.detail ->> 'motif' = 'drapeau_bloquant' and g.detail ->> 'de' = 'approved'
                          and g.detail ->> 'note' is null),
                 'la ligne dit le motif et l état d avant ; sans note, la note est nulle');
  return next throws_ok(format($q$select public.poser_verdict_verification(gen_random_uuid(), %L, false, 'manual_only', null, 'Un texte libre')$q$, v_profil),
                        '22023', null, 'le motif est un CODE nommé, jamais une phrase');
  return next throws_ok(format($q$select public.poser_verdict_verification(null, %L, true, 'ai_web_search', 9, 'note_suffisante')$q$, v_profil),
                        'GL002', null, 'la pièce est obligatoire');

  -- L'arbitrage humain remet aussi le compte « actif » (il restait « en revue » pour toujours).
  update public.profiles set verification_status = 'pending_admin_review' where id = v_profil2;
  perform public.statuer_sur_expert(v_p3, null, 'administrateur', v_admin, 'admin', v_profil2, 'pending_admin_review', true, null);
  return next ok((select u.is_verified and u.status = 'active' from public.users u where u.id = v_user2),
                 'statuer_sur_expert : approuvé → compte actif');
  return next ok(not has_function_privilege('authenticated', 'public.poser_verdict_verification(uuid, uuid, boolean, text, numeric, text)', 'execute'),
                 'poser_verdict_verification est fermée au navigateur');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
