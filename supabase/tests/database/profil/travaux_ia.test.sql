-- LES TRAVAUX D'IA (§D.30) — le cycle entier, par les fonctions de la base :
--   A. déposer une analyse : le profil passe « en cours » et le travail naît ; un second dépôt ANNULE le premier ;
--   B. prendre sous bail ; un échec REJOUABLE se rejoue avec un délai ; au plafond, le travail est ÉCHOUÉ, le
--      profil reçoit son repli (analyse « échouée, nommée ») et UNE ligne `travail_ia_echoue` sous la pièce ;
--   C. terminer : un travail annulé n'écrit rien ; un travail vivant écrit l'analyse et se clôt ;
--   D. le pilote : un bail expiré se remet en file, ou se clôt à la dernière tentative — une vérification perdue
--      part en revue HUMAINE (`verification_conclue`, motif `travail_echoue`) ; un travail que personne ne prend
--      depuis 30 minutes est clos (`non_execute`) ;
--   E. conclure une vérification : profil approuvé, drapeau et état du compte, UNE ligne `verification_conclue` ;
--   F. relancer un travail échoué : nouveau travail, profil « en cours », UNE ligne `travail_ia_relance` ; il
--      quitte la liste de ce qui attend un humain ; un travail qui n'est plus échoué ne se relance pas ;
--   G. les privilèges.
-- Le temps ne passe pas dans un test : les échéances sont RECULÉES par une écriture, et seulement elles.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(26);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin   uuid := pg_temp.fab_admin();
  v_p1      uuid := pg_temp.fab_profil('expert');
  v_p2      uuid := pg_temp.fab_profil('expert');
  v_p3      uuid := pg_temp.fab_profil('cdi');
  v_p4      uuid := pg_temp.fab_profil('expert');
  v_user1   uuid;
  v_user3   uuid;
  v_piece1  uuid := gen_random_uuid();
  v_piece2  uuid := gen_random_uuid();
  v_piece3  uuid := gen_random_uuid();
  v_piece4  uuid := gen_random_uuid();
  v_piece5  uuid := gen_random_uuid();
  v_piece6  uuid := gen_random_uuid();
  v_piece7  uuid := gen_random_uuid();
  v_t1      uuid;
  v_t2      uuid;
  v_t3      uuid;
  v_tv      uuid;
  v_tv3     uuid;
  v_t4      uuid;
  v_relance uuid;
  v_pris    public.travaux_ia;
  v_statut  text;
  v_res     jsonb;
begin
  select p.user_id into v_user1 from public.profiles p where p.id = v_p1;
  select p.user_id into v_user3 from public.profiles p where p.id = v_p3;

  -- ── A. déposer ──
  v_t1 := (public.deposer_analyse_cv(v_p1, v_user1 || '/a.pdf', 'aaaa', 100, v_piece1, v_user1, 'expert_freelance') ->> 'travail')::uuid;
  return next ok((select p.cv_parsing_status = 'processing' and p.ai_consent_at is not null and p.cv_file_path = v_user1 || '/a.pdf'
                    from public.profiles p where p.id = v_p1)
                 and exists (select 1 from public.travaux_ia t where t.id = v_t1 and t.statut = 'en_attente' and t.piece = v_piece1),
                 'A. le profil passe « en cours » ET le travail naît, sous la pièce du dépôt');
  v_t2 := (public.deposer_analyse_cv(v_p1, v_user1 || '/b.pdf', 'bbbb', 100, v_piece2, v_user1, 'expert_freelance') ->> 'travail')::uuid;
  return next ok((select t.statut = 'annule' from public.travaux_ia t where t.id = v_t1)
                 and (select t.statut = 'en_attente' from public.travaux_ia t where t.id = v_t2),
                 'A. un second dépôt ANNULE le premier : un seul travail actif par profil et par nature');

  -- ── B. prendre, rejouer, échouer ──
  select * into v_pris from public.prendre_travail_ia(interval '6 minutes');
  return next ok(v_pris.id = v_t2 and v_pris.statut = 'en_cours' and v_pris.tentatives = 1 and v_pris.bail_jusqu_a > now(),
                 'B. le travail dû est PRIS sous bail, tentative 1');
  v_statut := public.echouer_travail_ia(v_t2, 'modele_indisponible', true);
  return next ok(v_statut = 'en_attente' and (select t.prochaine_tentative_at > now() and t.erreur_code = 'modele_indisponible' from public.travaux_ia t where t.id = v_t2),
                 'B. un échec rejouable REPREND plus tard, avec son motif');
  update public.travaux_ia set prochaine_tentative_at = now() where id = v_t2;
  select * into v_pris from public.prendre_travail_ia(interval '6 minutes');
  perform public.echouer_travail_ia(v_t2, 'modele_indisponible', true);
  update public.travaux_ia set prochaine_tentative_at = now() where id = v_t2;
  select * into v_pris from public.prendre_travail_ia(interval '6 minutes');
  return next is(v_pris.tentatives, 3, 'B. troisième tentative');
  v_statut := public.echouer_travail_ia(v_t2, 'modele_indisponible', true);
  return next is(v_statut, 'echoue', 'B. au plafond, le travail est ÉCHOUÉ');
  return next ok((select p.cv_parsing_status = 'failed' and p.cv_parsing_error = 'modele_indisponible' from public.profiles p where p.id = v_p1),
                 'B. le profil reçoit son REPLI : analyse échouée, motif nommé — jamais « en cours » pour toujours');
  return next ok(pg_temp.lignes(v_piece2) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_piece2
                   and g.type_action = 'travail_ia_echoue' and g.statut = 'echoue' and g.detail ->> 'code' = 'modele_indisponible'),
                 'B. exactement UNE ligne travail_ia_echoue sous la pièce du dépôt');

  -- ── C. terminer ──
  v_res := public.terminer_analyse_cv(v_t1, '{"title":"Ne doit pas s écrire"}'::jsonb, null, null, null, interval '24 hours', '[]'::jsonb);
  return next ok((v_res ->> 'ecrit')::boolean = false and (select p.title is distinct from 'Ne doit pas s écrire' from public.profiles p where p.id = v_p1),
                 'C. un travail ANNULÉ n écrit pas son analyse');
  v_t3 := (public.deposer_analyse_cv(v_p1, v_user1 || '/c.pdf', 'cccc', 100, v_piece3, v_user1, 'expert_freelance') ->> 'travail')::uuid;
  select * into v_pris from public.prendre_travail_ia(interval '6 minutes');
  v_res := public.terminer_analyse_cv(v_t3, '{"title":"Architecte sonde"}'::jsonb, null, null, null, interval '24 hours',
                                      '[{"bloc":"profil","champ":"summary","code":"resume_trop_court"}]'::jsonb);
  return next ok((v_res ->> 'ecrit')::boolean
                 and (select p.cv_parsing_status = 'done' and p.title = 'Architecte sonde' from public.profiles p where p.id = v_p1)
                 and (select t.statut = 'reussi' and (t.resultat -> 'ecarts') @> '[{"code":"resume_trop_court"}]'::jsonb from public.travaux_ia t where t.id = v_t3),
                 'C. un travail vivant ÉCRIT l analyse et se clôt, avec les écarts d amont');
  return next ok(not exists (select 1 from public.travaux_ia_en_souffrance() s where s.profile_id = v_p1),
                 'C. l échec remplacé par un dépôt réussi n attend plus personne');

  -- ── D. le pilote : un bail expiré, puis la dernière tentative ──
  update public.profiles set verification_status = null where id = v_p2;
  v_tv := public.deposer_verification_expert(v_p2, v_piece4, null, null);
  return next ok((select p.verification_status = 'pending' from public.profiles p where p.id = v_p2),
                 'D. déposer une vérification : « en cours » à l écran');
  select * into v_pris from public.prendre_travail_ia(interval '6 minutes');
  update public.travaux_ia set bail_jusqu_a = now() - interval '1 minute' where id = v_tv;
  perform public.clore_travaux_ia_perdus();
  return next ok((select t.statut = 'en_attente' and t.erreur_code = 'delai_depasse' from public.travaux_ia t where t.id = v_tv),
                 'D. un bail expiré est REMIS en file (il reste des tentatives)');
  -- La DERNIÈRE tentative : le plafond ramené à 2 (la contrainte tient tentatives <= plafond ; la prochaine prise sera la 2e).
  update public.travaux_ia set max_tentatives = 2 where id = v_tv;
  select * into v_pris from public.prendre_travail_ia(interval '6 minutes');
  update public.travaux_ia set bail_jusqu_a = now() - interval '1 minute' where id = v_tv;
  perform public.piloter_travaux_ia();
  return next ok((select t.statut = 'echoue' and t.erreur_code = 'delai_depasse' from public.travaux_ia t where t.id = v_tv),
                 'D. à la dernière tentative, le pilote CLÔT le travail');
  return next ok((select p.verification_status = 'pending_admin_review' from public.profiles p where p.id = v_p2)
                 and exists (select 1 from public.grand_livre g where g.piece = v_piece4 and g.type_action = 'verification_conclue'
                              and (g.detail ->> 'approuve')::boolean = false and g.detail ->> 'motif' = 'travail_echoue')
                 and exists (select 1 from public.grand_livre g where g.piece = v_piece4 and g.type_action = 'travail_ia_echoue'),
                 'D. une vérification perdue part en revue HUMAINE, et les deux lignes le disent');
  return next ok(exists (select 1 from public.travaux_ia_en_souffrance() s where s.id = v_tv),
                 'D. elle attend un humain : la liste le montre');
  v_t4 := (public.deposer_analyse_cv(v_p4, 'x/d.pdf', 'dddd', 100, v_piece7, null, null) ->> 'travail')::uuid;
  update public.travaux_ia set prochaine_tentative_at = now() - interval '31 minutes' where id = v_t4;
  perform public.clore_travaux_ia_perdus();
  return next ok((select t.statut = 'echoue' and t.erreur_code = 'non_execute' from public.travaux_ia t where t.id = v_t4)
                 and (select p.cv_parsing_status = 'failed' and p.cv_parsing_error = 'non_execute' from public.profiles p where p.id = v_p4),
                 'D. un travail que personne ne prend depuis 30 minutes est CLOS, le profil en sort');

  -- ── E. conclure une vérification ──
  update public.users set status = 'in_review' where id = v_user3;
  v_tv3 := public.deposer_verification_expert(v_p3, v_piece5, v_user3, 'expert_cdi');
  select * into v_pris from public.prendre_travail_ia(interval '6 minutes');
  v_res := public.conclure_verification_expert(v_tv3, true, 'ai_web_search', 9, '{"notes":"sonde"}'::jsonb, 'note_suffisante');
  return next ok((v_res ->> 'conclu')::boolean
                 and (select p.verification_status = 'approved' and p.verified_at is not null and p.verified_by is null from public.profiles p where p.id = v_p3)
                 and (select u.is_verified and u.status = 'active' from public.users u where u.id = v_user3),
                 'E. approuvé : profil, drapeau du compte ET état du compte (en revue → actif), ensemble');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_piece5 and g.type_action = 'verification_conclue'
                          and (g.detail ->> 'approuve')::boolean and g.detail ->> 'motif' = 'note_suffisante' and g.origine = 'systeme'),
                 'E. UNE ligne verification_conclue, origine système, sous la pièce du dépôt');
  return next ok((public.conclure_verification_expert(v_tv3, true, 'ai_web_search', 9, '{}'::jsonb, 'note_suffisante') ->> 'conclu')::boolean = false,
                 'E. un travail déjà conclu ne conclut pas deux fois');

  -- ── F. relancer ──
  v_relance := public.relancer_travail_ia(v_piece6, null, 'administrateur', v_admin, 'admin', v_tv);
  return next ok(v_relance is not null
                 and (select t.statut = 'en_attente' and t.piece = v_piece6 from public.travaux_ia t where t.id = v_relance)
                 and (select p.verification_status = 'pending' from public.profiles p where p.id = v_p2),
                 'F. relancer : un NOUVEAU travail sous la pièce du geste, le profil repasse « en cours »');
  return next ok(pg_temp.lignes(v_piece6) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_piece6
                   and g.type_action = 'travail_ia_relance' and g.acteur_id = v_admin and (g.detail ->> 'travail_origine')::uuid = v_tv),
                 'F. exactement UNE ligne travail_ia_relance, l administrateur pour acteur');
  return next ok(not exists (select 1 from public.travaux_ia_en_souffrance() s where s.id = v_tv),
                 'F. le travail relancé quitte la liste de ce qui attend un humain');
  return next ok(public.relancer_travail_ia(gen_random_uuid(), null, 'administrateur', v_admin, 'admin', v_relance) is null,
                 'F. un travail qui n est pas échoué ne se relance pas (null)');

  -- ── G. les privilèges ──
  return next ok(not has_function_privilege('authenticated', 'public.deposer_analyse_cv(uuid, text, text, integer, uuid, uuid, text)', 'execute')
                 and not has_function_privilege('authenticated', 'public.prendre_travail_ia(interval)', 'execute')
                 and not has_function_privilege('anon', 'public.relancer_travail_ia(uuid, uuid, text, uuid, text, uuid)', 'execute'),
                 'G. les fonctions de la file sont fermées au navigateur');
  return next ok(not has_function_privilege('service_role', 'public.deposer_travail_ia(text, uuid, jsonb, uuid, uuid, text)', 'execute')
                 and not has_function_privilege('service_role', 'public.clore_travail_ia_en_echec(uuid, text)', 'execute')
                 and not has_function_privilege('service_role', 'public.reveiller_travaux_ia()', 'execute')
                 and not has_function_privilege('service_role', 'public.piloter_travaux_ia()', 'execute'),
                 'G. les fonctions internes ne sont appelables que par la base elle-même');
  return next ok(exists (select 1 from cron.job where jobname = 'travaux_ia_pilote'), 'G. le pilote pg_cron est planifié');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
