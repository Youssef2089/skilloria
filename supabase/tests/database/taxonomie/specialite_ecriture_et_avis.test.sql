-- UNE SPÉCIALITÉ S'ÉCRIT EN UNE FOIS ; CHAQUE EXPERT EST PRÉVENU UNE SEULE FOIS PAR DÉSACTIVATION (relecture du lot zones
-- de travail, 02/10/2026, points 4 et 5) — migration `specialite_ecriture_et_avis_une_fois`.
--   A. tout ou rien : une réactivation refusée (une traduction « Other » qui RESTE) n'écrit pas non plus la traduction
--      espagnole du même geste ; un nom changé avec une traduction « Otra » sur une spécialité active n'écrit rien ;
--   B. la réactivation qui CORRIGE sa traduction dans le même geste passe ;
--   C. la pièce de la désactivation : posée au passage à inactive, GARDÉE par un rejeu, effacée à la réactivation ;
--      une spécialité inactive sans pièce (désactivée avant ce lot) la reçoit au premier rejeu ;
--   D. un avis par expert et par désactivation : un rejeu ne prévient que les nouveaux ; une NOUVELLE désactivation
--      prévient de nouveau ; un avis sans pièce est refusé.
-- Données FABRIQUÉES ; la branche et le domaine sont LUS en base.
-- Colonnes et contraintes lues (§G.10) : specialities, translations, notifications (cf. en-tête de la migration).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(11);

create or replace function pg_temp.avis(p_user uuid, p_spec uuid, p_piece uuid) returns jsonb
language sql as $$
  select jsonb_build_object('user_id', p_user, 'domain_id', pg_temp.fab_domaine(), 'piece', p_piece,
                            'title', 'Sonde', 'body', 'Sonde', 'link_url', '/dashboard/freelance/profil/valider', 'entity_id', p_spec)
$$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_branche uuid;
  v_domaine uuid;
  v_spec    uuid;
  v_active  uuid;
  v_piece1  uuid := gen_random_uuid();
  v_piece2  uuid := gen_random_uuid();
  v_rendu   uuid;
  v_u1      uuid := pg_temp.fab_compte('expert');
  v_u2      uuid := pg_temp.fab_compte('cdi');
begin
  select b.id, b.domain_id into v_branche, v_domaine from public.branches b order by b.id limit 1;
  insert into public.specialities (branch_id, domain_id, name, slug, active)
  values (v_branche, v_domaine, 'Sonde Divers', 'sonde-divers-ecriture', false) returning id into v_spec;
  insert into public.translations (table_name, row_id, field, locale, value)
  values ('specialities', v_spec, 'name', 'en', 'Other');
  insert into public.specialities (branch_id, domain_id, name, slug, active)
  values (v_branche, v_domaine, 'Sonde Data', 'sonde-data-ecriture', true) returning id into v_active;

  -- A. tout ou rien
  return next throws_ok(format($q$select public.modifier_specialite(%L, '{"active": true}', '[{"locale": "es", "value": "Varios"}]', null, %L)$q$, v_spec, v_piece1),
                        '23514', null, 'A. réactiver alors qu''une traduction « Other » RESTE est refusé');
  return next ok((select not s.active from public.specialities s where s.id = v_spec)
                 and not exists (select 1 from public.translations t where t.row_id = v_spec and t.locale = 'es'),
                 'A. rien n''est écrit : ni la réactivation, ni la traduction espagnole du même geste');
  return next throws_ok(format($q$select public.modifier_specialite(%L, '{"name": "Sonde Data 2"}', '[{"locale": "es", "value": "Otra"}]', null, %L)$q$, v_active, v_piece1),
                        '23514', null, 'A. une traduction « Otra » sur une spécialité active est refusée');
  return next is((select s.name::text from public.specialities s where s.id = v_active), 'Sonde Data',
                 'A. … et le nom changé dans le même geste n''est pas écrit');

  -- C. une spécialité inactive SANS pièce (désactivée avant ce lot) la reçoit au premier rejeu
  v_rendu := public.modifier_specialite(v_spec, '{}', '[]', null, v_piece1);
  return next is(v_rendu, v_piece1, 'C. une spécialité inactive sans pièce reçoit celle du premier rejeu');

  -- B. la réactivation qui corrige sa traduction dans le même geste
  v_rendu := public.modifier_specialite(v_spec, '{"active": true}', '[{"locale": "en", "value": "Miscellaneous"}]', null, v_piece2);
  return next ok(v_rendu is null and (select s.active from public.specialities s where s.id = v_spec)
                 and (select t.value from public.translations t where t.row_id = v_spec and t.locale = 'en') = 'Miscellaneous',
                 'B. la traduction corrigée et la réactivation passent ensemble ; la pièce de désactivation s''efface');

  -- C. désactivée : la pièce du geste ; un rejeu la garde
  v_rendu := public.modifier_specialite(v_spec, '{"active": false}', '[]', null, v_piece1);
  return next is(v_rendu, v_piece1, 'C. la désactivation pose la pièce de son geste');
  v_rendu := public.modifier_specialite(v_spec, '{"active": false}', '[]', null, v_piece2);
  return next is(v_rendu, v_piece1, 'C. un rejeu GARDE la pièce de la désactivation');

  -- D. un avis par expert et par désactivation
  perform public.prevenir_retrait_specialite(jsonb_build_array(pg_temp.avis(v_u1, v_spec, v_piece1)));
  return next is(public.prevenir_retrait_specialite(jsonb_build_array(pg_temp.avis(v_u1, v_spec, v_piece1), pg_temp.avis(v_u2, v_spec, v_piece1))), 1,
                 'D. un rejeu ne prévient que l''expert qui ne l''a pas encore été (1 nouvel avis sur 2)');
  return next is(public.prevenir_retrait_specialite(jsonb_build_array(pg_temp.avis(v_u1, v_spec, v_piece2), pg_temp.avis(v_u2, v_spec, v_piece2))), 2,
                 'D. une NOUVELLE désactivation (une autre pièce) prévient de nouveau');
  return next throws_ok($q$select public.prevenir_retrait_specialite('[{"user_id": null, "piece": null, "entity_id": null}]')$q$,
                        'SP003', null, 'D. un avis sans pièce est refusé (il ne se dédoublonnerait pas)');
end $$;

select * from pg_temp.essai();

select * from finish();
rollback;
