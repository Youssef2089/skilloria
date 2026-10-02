-- annonce_refusee, et la voie ADMINISTRATEUR de publier_annonce() — la validation des annonces (lot S3) :
--  · valider = publier_annonce() depuis pending_review : en ligne, verdict de la machine CONSERVÉ, qui et quand posés,
--    UNE ligne annonce_publiee (ou sous_traitance_publiee) avec voie = 'administrateur' ;
--  · la voie automatique écrit voie = 'automatique' ;
--  · seul un administrateur sort une annonce de la revue (42501) — l'anti-relance tenue en base ;
--  · refuser = refuser_annonce() : rejected, motif sur la ligne métier, UNE ligne annonce_refusee sans le motif ;
--    motif obligatoire, garde administrateur, rejeu et annonce hors revue rendent null.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(16);

-- Une annonce EN REVUE, par le chemin normal : brouillon, puis verdict qui ne publie pas (note 4).
create or replace function pg_temp.en_revue(p_org uuid, p_auteur uuid, p_type text default 'mission') returns uuid
language plpgsql as $$
declare
  v   uuid := pg_temp.fab_brouillon(p_org, p_type);
  v_r jsonb;
begin
  v_r := public.publier_annonce(gen_random_uuid(), null, 'utilisateur', p_auteur, 'client', v, pg_temp.fab_domaine(), p_org,
                                array['draft'], 'pending_review', 4, 'ai_publication_quality',
                                '{"score":4,"notes":"Sonde","flags":["incoherent"]}'::jsonb);
  if v_r ->> 'status' is distinct from 'pending_review' then raise exception 'fabrique : annonce non mise en revue [%]', v_r; end if;
  return v;
end $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin   uuid := pg_temp.fab_admin();
  v_auteur  uuid := pg_temp.fab_compte('entreprise');
  v_org     uuid := pg_temp.fab_organisation(v_auteur);
  v_dom     uuid := pg_temp.fab_domaine();
  v_valide  uuid := pg_temp.en_revue(v_org, v_auteur);
  v_refuse  uuid := pg_temp.en_revue(v_org, v_auteur);
  v_st      uuid := pg_temp.en_revue(v_org, v_auteur, 'sous_traitance');
  v_direct  uuid := pg_temp.fab_brouillon(v_org);
  v_p1      uuid := gen_random_uuid();
  v_p2      uuid := gen_random_uuid();
  v_p3      uuid := gen_random_uuid();
  v_p4      uuid := gen_random_uuid();
  v_p5      uuid := gen_random_uuid();
  v_p6      uuid := gen_random_uuid();
  v_p7      uuid := gen_random_uuid();
  v_r       jsonb;
begin
  -- ── LA GARDE D'ABORD, sur l'annonce intacte : l'auteur ne la sort pas de la revue (anti-relance). ──
  return next throws_ok(format($q$select public.publier_annonce(%L, null, 'utilisateur', %L, 'client', %L, %L, %L, array['pending_review'], 'published', null, null, null)$q$,
                               v_p6, v_auteur, v_valide, v_dom, v_org),
                        '42501', null, 'l''auteur ne sort pas son annonce de la revue, même en appelant la fonction');
  return next ok(pg_temp.lignes(v_p6) = 0 and exists (select 1 from public.publications p where p.id = v_valide and p.status = 'pending_review'),
                 '… rien n''est écrit, l''annonce reste en revue');
  return next throws_ok(format($q$select public.publier_annonce(%L, null, 'administrateur', %L, 'admin', %L, %L, %L, array['pending_review'], 'published', 9, 'sonde', '{}'::jsonb)$q$,
                               gen_random_uuid(), v_admin, v_valide, v_dom, v_org),
                        '22023', null, 'la voie administrateur ne réécrit pas le verdict de la machine');

  -- ── VALIDER ──
  v_r := public.publier_annonce(v_p1, null, 'administrateur', v_admin, 'admin', v_valide, v_dom, v_org,
                                array['pending_review'], 'published', null, null, null);
  return next ok(v_r ->> 'status' = 'published' and v_r ->> 'voie' = 'administrateur' and v_r ->> 'published_at' is not null,
                 'validée : l''annonce est en ligne, par la voie administrateur, la base pose published_at');
  return next ok(exists (select 1 from public.publications p where p.id = v_valide and p.verified_by = v_admin and p.verified_at is not null
                          and p.verification_score = 4 and p.verification_data -> 'flags' ? 'incoherent' and p.review_reason is null),
                 'le verdict de la machine est conservé, l''administrateur et la date sont posés');
  return next ok(pg_temp.lignes(v_p1) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p1
                  and g.type_action = 'annonce_publiee' and g.sujet_id = v_valide and g.ecosysteme_id = v_dom
                  and g.acteur_id = v_admin and g.detail ->> 'voie' = 'administrateur' and (g.detail ->> 'verification_score')::numeric = 4),
                 'exactement UNE ligne annonce_publiee, voie administrateur, sous l''administrateur');
  -- Appeler d'abord, relire ensuite : une sous-requête lit l'instantané du début de SON instruction (§E.74).
  v_r := public.publier_annonce(v_p2, null, 'administrateur', v_admin, 'admin', v_valide, v_dom, v_org,
                                array['pending_review'], 'published', null, null, null);
  return next ok(v_r is null and pg_temp.lignes(v_p2) = 0,
                 'le rejeu de la validation rend null et n''écrit rien');

  -- ── LA FACE SOUS-TRAITANCE, ET LA VOIE AUTOMATIQUE ──
  perform public.publier_annonce(v_p3, null, 'administrateur', v_admin, 'admin', v_st, v_dom, v_org,
                                 array['pending_review'], 'published', null, null, null);
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p3 and g.type_action = 'sous_traitance_publiee'
                          and g.detail ->> 'voie' = 'administrateur') and pg_temp.lignes(v_p3) = 1,
                 'un besoin de sous-traitance validé s''écrit sous SON nom, voie administrateur');
  v_r := public.publier_annonce(v_p7, null, 'utilisateur', v_auteur, 'client', v_direct, v_dom, v_org,
                                array['draft'], 'published', 8, 'sonde', '{}'::jsonb);
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p7 and g.detail ->> 'voie' = 'automatique')
                 and v_r ->> 'voie' = 'automatique',
                 'une publication directe écrit la voie automatique');

  -- ── REFUSER ──
  return next throws_ok(format($q$select public.refuser_annonce(%L, null, 'utilisateur', %L, 'client', %L, 'motif')$q$,
                               gen_random_uuid(), v_auteur, v_refuse),
                        '42501', null, 'seul un administrateur refuse une annonce');
  return next throws_ok(format($q$select public.refuser_annonce(%L, null, 'administrateur', %L, 'admin', %L, '   ')$q$,
                               gen_random_uuid(), v_admin, v_refuse),
                        '22023', null, 'un refus sans motif est refusé');
  v_r := public.refuser_annonce(v_p4, null, 'administrateur', v_admin, 'admin', v_refuse, '  Coordonnées en clair dans la description  ');
  return next ok(v_r ->> 'status' = 'rejected' and exists (select 1 from public.publications p where p.id = v_refuse
                  and p.status = 'rejected' and p.verified_by = v_admin and p.verified_at is not null
                  and p.review_reason = 'Coordonnées en clair dans la description' and p.published_at is null),
                 'refusée : statut, administrateur, date et motif (rogné) sur la ligne métier, rien en ligne');
  return next ok(pg_temp.lignes(v_p4) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p4
                  and g.type_action = 'annonce_refusee' and g.sujet_id = v_refuse and g.ecosysteme_id = v_dom
                  and g.detail ->> 'type' = 'mission' and g.detail ->> 'organization_id' = v_org::text),
                 'exactement UNE ligne annonce_refusee, avec le type et l''organisation');
  return next ok(not exists (select 1 from public.grand_livre g where g.piece = v_p4 and g.detail::text like '%Coordonnées%'),
                 'le motif en texte libre n''entre pas dans la ligne');
  v_r := public.refuser_annonce(v_p5, null, 'administrateur', v_admin, 'admin', v_refuse, 'encore');
  return next ok(v_r is null and pg_temp.lignes(v_p5) = 0,
                 'le rejeu du refus rend null et n''écrit rien');
  v_r := public.refuser_annonce(gen_random_uuid(), null, 'administrateur', v_admin, 'admin', v_valide, 'trop tard');
  return next ok(v_r is null and exists (select 1 from public.publications p where p.id = v_valide and p.status = 'published'),
                 'une annonce déjà validée ne se refuse plus : null, elle reste en ligne');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
