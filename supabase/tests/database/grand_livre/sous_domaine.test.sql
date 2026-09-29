-- LE SOUS-DOMAINE D'UN ÉCOSYSTÈME EST UN RÉGLAGE (migration sous_domaine_reglable, 29/09/2026).
-- La base refuse ce que l'écran pourrait laisser passer — une forme qui n'est pas une étiquette DNS
-- (23514), un sous-domaine déjà pris (23505) ; un renommage garde l'identifiant technique et tout ce
-- qui s'y rattache ; la règle d'inscription lit le NOUVEAU sous-domaine et refuse l'ancien ; la trace
-- ecosysteme_modifie porte avant/après, et rien d'autre. Tout est fabriqué, et annulé.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(12);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin   uuid := pg_temp.fab_admin();
  v_dom     uuid := pg_temp.fab_domaine();
  v_avant   text;
  v_apres   text := 'sonde-' || left(md5(random()::text), 10);
  v_eco     uuid;
  v_autre   text := 'autre-' || left(md5(random()::text), 10);
  v_expert  uuid := pg_temp.fab_compte('expert');
  v_id      uuid := gen_random_uuid();
  v_meta    jsonb;
  v_p       uuid := gen_random_uuid();
begin
  select d.slug into v_avant from public.domains d where d.id = v_dom;
  insert into public.domains (name, slug, active) values ('Sonde', v_autre, false) returning id into v_eco;

  -- ── LA FORME, EN BASE ──
  return next throws_ok(format('update public.domains set slug = %L where id = %L', 'Sonde', v_eco),
                        '23514', null, 'forme : une majuscule est refusée par la base');
  return next throws_ok(format('update public.domains set slug = %L where id = %L', 'a.b', v_eco),
                        '23514', null, 'forme : un point (deux labels) est refusé par la base');
  return next throws_ok(format('update public.domains set slug = %L where id = %L', '-debut', v_eco),
                        '23514', null, 'forme : un tiret en tête est refusé par la base');
  return next throws_ok(format('update public.domains set slug = %L where id = %L', repeat('a', 64), v_eco),
                        '23514', null, 'forme : 64 caractères (au-delà d''une étiquette DNS) sont refusés par la base');
  return next throws_ok(format('insert into public.domains (name, slug, active) values (%L, %L, false)', 'Sonde', 'avec espace'),
                        '23514', null, 'forme : la création est tenue par la même règle');

  -- ── L'UNICITÉ ──
  return next throws_ok(format('update public.domains set slug = %L where id = %L', v_avant, v_eco),
                        '23505', null, 'unicité : un sous-domaine déjà pris est refusé par la base');

  -- ── LE RENOMMAGE : l'identifiant ne bouge pas, ce qui s'y rattache non plus ──
  update public.domains set slug = v_apres where id = v_dom;
  return next ok((select d.id from public.domains d where d.slug = v_apres) = v_dom
                 and not exists (select 1 from public.domains d where d.slug = v_avant)
                 and (select u.domain_id from public.users u where u.id = v_expert) = v_dom,
                 'renommage : même identifiant, l''ancien sous-domaine ne résout plus rien, le compte garde son écosystème');

  -- ── L'ÉCOSYSTÈME RÉELLEMENT RÉSOLU : la règle d'inscription lit le sous-domaine RÉGLÉ ──
  v_meta := pg_temp.fab_meta('expert', v_id) || jsonb_build_object('voie', 'inscription_expert');
  return next ok(public.inscription_refus(pg_temp.fab_email(v_id), v_meta || jsonb_build_object('domain_slug', v_avant)) = 'invalid_domain',
                 'inscription : l''ancien sous-domaine est refusé (invalid_domain)');
  return next ok(public.inscription_refus(pg_temp.fab_email(v_id), v_meta || jsonb_build_object('domain_slug', v_apres)) is distinct from 'invalid_domain',
                 'inscription : le nouveau sous-domaine résout l''écosystème');

  -- ── LA TRACE : ecosysteme_modifie, avant et après, et rien d'autre ──
  perform public.journaliser(v_p, 'ecosysteme_modifie', 'reussi', 'administrateur', v_admin, 'admin', v_dom,
                             'domains', v_dom,
                             jsonb_build_object('operation', 'sous_domaine', 'champs', jsonb_build_array('slug'),
                                                'traductions', jsonb_build_array(), 'visuel', null,
                                                'sous_domaine', jsonb_build_object('avant', v_avant, 'apres', v_apres)),
                             null::uuid, null::numeric, null::text);
  return next ok(pg_temp.lignes(v_p) = 1
                 and exists (select 1 from public.grand_livre g where g.piece = v_p and g.type_action = 'ecosysteme_modifie'
                               and g.sujet_id = v_dom and g.ecosysteme_id = v_dom
                               and g.detail #>> '{sous_domaine,avant}' = v_avant and g.detail #>> '{sous_domaine,apres}' = v_apres),
                 'trace : UNE ligne ecosysteme_modifie, sujet l''écosystème, avant et après');
  return next throws_ok(format($q$select public.journaliser(%L, 'ecosysteme_modifie', 'reussi', 'administrateur', %L, 'admin', %L,
                                 'domains', %L, '{"operation":"sous_domaine","sous_domaine":{"avant":"a","apres":"b","nom":"Sonde"}}'::jsonb,
                                 null::uuid, null::numeric, null::text)$q$,
                               gen_random_uuid(), v_admin, v_dom, v_dom),
                        'GL004', null, 'trace : une clé hors liste sous sous_domaine (le nom) est refusée');

  -- ── LA RÈGLE DE FORME EST CELLE DU CODE : la contrainte existe, validée ──
  return next ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.domains'::regclass
                           and c.conname = 'domains_sous_domaine_forme' and c.convalidated),
                 'la contrainte de forme est posée ET validée (jamais not valid, §E.64)');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
