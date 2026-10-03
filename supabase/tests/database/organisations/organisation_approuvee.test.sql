-- organisation_approuvee — UNE ORGANISATION NON APPROUVÉE NE PUBLIE PAS, NE RETIENT PAS, NE DÉVOILE PAS (§D.52,
-- migration organisation_approuvee_en_base). Les deux déclencheurs, éprouvés par les fonctions que les routes appellent :
-- publier_annonce, retenir_candidature, devoiler_candidature — refus nommé OA001, rien d'écrit ; l'organisation approuvée
-- passe ; une approbation RETIRÉE (statuer_sur_organisation, approuvée → refusée) ferme les gestes suivants sans toucher
-- à ce qui est déjà en ligne, et une annonce en ligne se clôt toujours.
-- Le refus au SERVEUR (403 org_not_approved, avant la base) est éprouvé par tests/integration/acces-routes.mjs (R6).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(11);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin_plateforme uuid := pg_temp.fab_admin();
  v_client  uuid := pg_temp.fab_compte('entreprise');
  v_org     uuid := pg_temp.fab_organisation(v_client);
  v_dom     uuid := pg_temp.fab_domaine();
  v_brouillon uuid := pg_temp.fab_brouillon(v_org);
  v_pub     uuid;
  v_cand_a  uuid;
  v_cand_b  uuid;
  v_statut  text;
begin
  -- ① Non approuvée : la mise en ligne est refusée, nommée, et rien n'est écrit.
  select o.verification_status into v_statut from public.organizations o where o.id = v_org;
  return next ok(v_statut is distinct from 'approved' and not public.organisation_est_approuvee(v_org),
                 'une organisation née de l''inscription n''est pas approuvée (' || coalesce(v_statut, 'null') || ')');
  return next throws_ok(format($q$select public.publier_annonce(gen_random_uuid(), null, 'utilisateur', %L, 'client', %L, %L, %L,
                                    array['draft'], 'published', 8, 'sonde', '{}'::jsonb)$q$, v_client, v_brouillon, v_dom, v_org),
                        'OA001', null, 'non approuvée : publier_annonce est refusée (OA001)');
  return next is((select p.status from public.publications p where p.id = v_brouillon), 'draft',
                 'non approuvée : l''annonce est restée en brouillon');
  return next ok(not public.organisation_est_approuvee(gen_random_uuid()), 'une organisation inconnue n''est pas approuvée');

  -- ② Approuvée par l'administration : la mise en ligne passe.
  perform pg_temp.fab_approuver(v_org);
  v_pub := pg_temp.fab_annonce_publiee(v_org, v_client);
  return next is((select p.status from public.publications p where p.id = v_pub), 'published',
                 'approuvée : l''annonce est en ligne');
  v_cand_a := pg_temp.fab_candidature(v_pub, pg_temp.fab_profil('expert'));
  v_cand_b := pg_temp.fab_candidature(v_pub, pg_temp.fab_profil('cdi'));
  return next is((public.devoiler_candidature(gen_random_uuid(), null, 'utilisateur', v_client, 'client', v_cand_a,
                   array['received', 'in_review', 'shortlisted'], now() + interval '15 days', false)) ->> 'issue', 'devoilee',
                 'approuvée : le dévoilement passe');

  -- ③ L'approbation RETIRÉE (approuvée → refusée, par la même fonction que l'écran) : les gestes suivants sont fermés.
  perform public.statuer_sur_organisation(gen_random_uuid(), null, 'administrateur', v_admin_plateforme, 'admin',
                                          v_org, 'approved', false, 'retrait de sonde');
  return next throws_ok(format($q$select public.retenir_candidature(gen_random_uuid(), null, 'utilisateur', %L, 'client', %L, %L, %L, array['unlocked'])$q$,
                               v_client, v_cand_a, v_dom, v_org),
                        'OA001', null, 'approbation retirée : retenir un candidat est refusé (OA001)');
  return next throws_ok(format($q$select public.devoiler_candidature(gen_random_uuid(), null, 'utilisateur', %L, 'client', %L,
                                    array['received', 'in_review', 'shortlisted'], now() + interval '15 days', false)$q$, v_client, v_cand_b),
                        'OA001', null, 'approbation retirée : dévoiler un candidat est refusé (OA001)');
  return next ok((select c.status from public.candidatures c where c.id = v_cand_a) = 'unlocked'
                 and (select c.status from public.candidatures c where c.id = v_cand_b) is distinct from 'unlocked',
                 'approbation retirée : rien n''a changé — le dévoilé le reste, l''autre n''est pas dévoilé');

  -- ④ Seules les TRANSITIONS sont gardées : l'annonce déjà en ligne y reste, et elle se clôt toujours.
  return next is((select p.status from public.publications p where p.id = v_pub), 'published',
                 'approbation retirée : l''annonce déjà en ligne n''est pas retirée par la garde');
  update public.publications set status = 'archived' where id = v_pub;
  return next is((select p.status from public.publications p where p.id = v_pub), 'archived',
                 'approbation retirée : clôturer l''annonce passe toujours');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
