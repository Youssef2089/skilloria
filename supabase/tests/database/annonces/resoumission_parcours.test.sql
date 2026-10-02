-- LA RESOUMISSION D'UNE ANNONCE REFUSÉE, LE PARCOURS COMPLET (contre-relecture de l'ARRÊT 28, point A — règle tranchée
-- par Youssef : une annonce refusée se corrige, N'IMPORTE QUEL champ, tout ce que l'auteur modifie est enregistré, et dès
-- qu'un champ a changé elle repasse dans le flux normal).
--
--  LE CAS : l'administrateur refuse une annonce parce qu'il lui manque une SPÉCIALITÉ — un champ que l'IA ne lit pas, et
--  que la règle précédente ne laissait pas resoumettre. L'auteur l'ajoute, resoumet, l'IA la juge de nouveau :
--   1. en revue (note 4), puis REFUSÉE pour la spécialité manquante (`refuser_annonce`) ;
--   2. l'écriture du PATCH de l'auteur — la spécialité ajoutée ET `rejected` → `draft`, dans le même update — tient en
--      base ; le motif reste sur la ligne (il marque la resoumission, que /publish ne recompte pas dans le mois) ;
--   3. le NOUVEAU jugement, par la voie automatique de `publier_annonce` depuis le brouillon : note au minimum ⇒ en ligne,
--      spécialité comprise, sous la voie automatique, UNE ligne annonce_publiee ;
--   4. l'autre issue : note sous le minimum ⇒ de nouveau EN REVUE, chez l'administrateur — qui peut la valider.
--
--  CE QUI N'EST PAS ICI, ET OÙ IL EST : la route PATCH (le refus « inchangée » sur ZÉRO champ changé, l'écriture de tout
--  champ changé) et /publish (le compteur du mois non consommé pour une resoumission, l'appel à l'IA, la note minimale lue
--  dans `verification_providers`, réglée dans /admin/seuils) sont du code applicatif : `diag-resoumission` les vérifie,
--  par mutation. Le verdict passé à `publier_annonce` ici est celui que /publish lui passe après l'IA.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(9);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_admin();
  v_auteur uuid := pg_temp.fab_compte('entreprise');
  v_org    uuid := pg_temp.fab_organisation(v_auteur);
  v_dom    uuid := pg_temp.fab_domaine();
  v_sp     uuid;
  v_a      uuid := pg_temp.fab_brouillon(v_org);
  v_b      uuid := pg_temp.fab_brouillon(v_org);
  v_pub    uuid := gen_random_uuid();
  v_r      jsonb;
  v_ref    text := 'Ajoutez au moins une spécialité';
begin
  -- Une spécialité ACTIVE (§E.107 : jamais « la première ligne » sans filtre d'état).
  select s.id into v_sp from public.specialities s where s.active order by s.id limit 1;
  if v_sp is null then raise exception 'fabrique : aucune spécialité active en base'; end if;
  -- Les deux annonces : complètes sauf la spécialité (le temps de travail posé, aucune spécialité, aucune précision).
  update public.publications set temps_travail = array['plein'], speciality_ids = '{}', speciality_other = null
   where id in (v_a, v_b);

  -- ── 1. EN REVUE, puis REFUSÉES pour la spécialité manquante ──
  perform public.publier_annonce(gen_random_uuid(), null, 'utilisateur', v_auteur, 'client', x, v_dom, v_org,
                                 array['draft'], 'pending_review', 4, 'ai_publication_quality', '{"score":4}'::jsonb)
     from unnest(array[v_a, v_b]) x;
  perform public.refuser_annonce(gen_random_uuid(), null, 'administrateur', v_admin, 'admin', x, v_ref)
     from unnest(array[v_a, v_b]) x;
  return next ok((select count(*) from public.publications p where p.id in (v_a, v_b) and p.status = 'rejected'
                    and p.review_reason = v_ref and coalesce(array_length(p.speciality_ids, 1), 0) = 0) = 2,
                 '1. refusées pour la spécialité manquante : statut rejected, motif sur la ligne, aucune spécialité');

  -- ── 2. L'ÉCRITURE DU PATCH DE L'AUTEUR : la spécialité ajoutée ET le retour au brouillon, dans le même update ──
  update public.publications set speciality_ids = array[v_sp], status = 'draft'
   where id in (v_a, v_b) and status = 'rejected';
  return next ok((select count(*) from public.publications p where p.id in (v_a, v_b) and p.status = 'draft'
                    and p.speciality_ids = array[v_sp]) = 2,
                 '2. la spécialité ajoutée est ENREGISTRÉE, et l''annonce repasse au brouillon');
  return next ok((select count(*) from public.publications p where p.id in (v_a, v_b) and p.review_reason = v_ref) = 2,
                 '2. le motif reste sur la ligne : il marque la resoumission (/publish ne recompte pas le mois)');

  -- ── 3. LE NOUVEAU JUGEMENT — la note atteint le minimum : EN LIGNE, par la voie automatique ──
  v_r := public.publier_annonce(v_pub, null, 'utilisateur', v_auteur, 'client', v_a, v_dom, v_org,
                                array['draft'], 'published', 8, 'ai_publication_quality', '{"score":8}'::jsonb);
  return next ok(v_r ->> 'status' = 'published' and v_r ->> 'voie' = 'automatique',
                 '3. rejugée, note au minimum : en ligne, par la voie automatique');
  return next ok(exists (select 1 from public.publications p where p.id = v_a and p.status = 'published'
                          and p.speciality_ids = array[v_sp] and p.verification_score = 8 and p.published_at is not null),
                 '3. en ligne AVEC la spécialité ajoutée, sous le nouveau verdict (8)');
  return next ok(pg_temp.lignes(v_pub) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_pub
                  and g.type_action = 'annonce_publiee' and g.sujet_id = v_a and g.detail ->> 'voie' = 'automatique'),
                 '3. exactement UNE ligne annonce_publiee, voie automatique');

  -- ── 4. L'AUTRE ISSUE — la note reste sous le minimum : DE NOUVEAU EN REVUE, chez l'administrateur ──
  v_r := public.publier_annonce(gen_random_uuid(), null, 'utilisateur', v_auteur, 'client', v_b, v_dom, v_org,
                                array['draft'], 'pending_review', 5, 'ai_publication_quality', '{"score":5}'::jsonb);
  return next ok(v_r ->> 'status' = 'pending_review'
                 and exists (select 1 from public.publications p where p.id = v_b and p.status = 'pending_review'
                              and p.speciality_ids = array[v_sp] and p.verification_score = 5),
                 '4. rejugée, note sous le minimum : de nouveau en revue, la spécialité conservée');
  return next throws_ok(format($q$select public.publier_annonce(%L, null, 'utilisateur', %L, 'client', %L, %L, %L, array['pending_review'], 'published', null, null, null)$q$,
                               gen_random_uuid(), v_auteur, v_b, v_dom, v_org),
                        '42501', null, '4. l''auteur ne la sort pas lui-même de la revue (l''anti-relance tient)');
  v_r := public.publier_annonce(gen_random_uuid(), null, 'administrateur', v_admin, 'admin', v_b, v_dom, v_org,
                                array['pending_review'], 'published', null, null, null);
  return next ok(v_r ->> 'status' = 'published' and v_r ->> 'voie' = 'administrateur',
                 '4. l''administrateur la valide : en ligne, par la voie administrateur');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
