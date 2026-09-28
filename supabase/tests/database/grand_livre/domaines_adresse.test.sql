-- LES DOMAINES D'ADRESSE (§D.27, décision 6) — regler_domaine_adresse(), l'écrivain UNIQUE des deux listes que
-- la règle d'inscription lit, et sa ligne reglage_modifie (la huitième famille) : ajouter, retirer, réactiver,
-- chacun avec UNE ligne sous la pièce ; rien d'écrit sur un refus nommé ; AD002 en base ; et la règle
-- d'inscription (inscription_refus) qui lit ce que l'écran règle. Domaines fabriqués en .invalid.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(14);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin  uuid := pg_temp.fab_admin();
  v_client uuid := pg_temp.fab_compte('entreprise');
  v_dom    uuid := pg_temp.fab_domaine();
  v_d      text := 'bloque-' || replace(gen_random_uuid()::text, '-', '') || '.invalid';
  v_pub    text := 'public-' || replace(gen_random_uuid()::text, '-', '') || '.invalid';
  v_p      uuid[] := array(select gen_random_uuid() from generate_series(1, 12));
  v_r      jsonb;
  v_id     uuid;
  v_signup uuid := gen_random_uuid();
begin
  -- ── ajouter un domaine bloqué ──
  v_r := public.regler_domaine_adresse(v_p[1], v_admin, v_dom, 'bloques', upper(v_d), true, 'sonde : messagerie jetable');
  v_id := (v_r ->> 'id')::uuid;
  return next ok(v_r ->> 'issue' = 'regle'
                 and exists (select 1 from public.blocked_email_domains b where b.id = v_id and b.email_domain = v_d
                              and b.active and b.added_by = v_admin and b.reason = 'sonde : messagerie jetable'),
                 'ajouter : le domaine est écrit en minuscules, actif, avec son auteur et sa raison');
  return next ok(pg_temp.lignes(v_p[1]) = 1
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.type_action = 'reglage_modifie'
                              and g.sujet_type = 'blocked_email_domains' and g.sujet_id = v_id and g.acteur_id = v_admin
                              and g.detail = jsonb_build_object('avant', '{}'::jsonb, 'apres', jsonb_build_object('actif', true), 'liste', 'bloques')),
                 'ajouter : UNE ligne reglage_modifie — la liste, avant/après actif, jamais le domaine');
  -- ── la règle d'inscription LIT la liste ──
  return next is(public.inscription_refus('sonde@' || v_d, pg_temp.fab_meta('entreprise', v_signup)), 'email_domain_blocked'::text,
                 'la règle d''inscription refuse une organisation sur le domaine bloqué');
  -- ── retirer : le domaine reste, désactivé, avec sa raison ──
  v_r := public.regler_domaine_adresse(v_p[2], v_admin, v_dom, 'bloques', v_d, false, '');
  return next ok(v_r ->> 'issue' = 'regle'
                 and exists (select 1 from public.blocked_email_domains b where b.id = v_id and not b.active and b.reason = 'sonde : messagerie jetable')
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[2] and g.type_action = 'reglage_modifie'
                              and g.detail -> 'avant' = '{"actif": true}'::jsonb and g.detail -> 'apres' = '{"actif": false}'::jsonb),
                 'retirer : désactivé, PAS effacé (sa raison reste) ; la ligne dit avant actif, après non');
  return next ok(public.inscription_refus('sonde@' || v_d, pg_temp.fab_meta('entreprise', v_signup)) is distinct from 'email_domain_blocked',
                 'retiré : la règle d''inscription ne le refuse plus');
  -- ── rien à changer : rien d'écrit ──
  v_r := public.regler_domaine_adresse(v_p[3], v_admin, v_dom, 'bloques', v_d, false, '');
  return next ok(v_r ->> 'issue' = 'inchange' and pg_temp.lignes(v_p[3]) = 0, 'déjà retiré : inchange, aucune ligne');
  -- ── réactiver ──
  v_r := public.regler_domaine_adresse(v_p[4], v_admin, v_dom, 'bloques', v_d, true, '');
  return next ok(v_r ->> 'issue' = 'regle' and pg_temp.lignes(v_p[4]) = 1
                 and exists (select 1 from public.blocked_email_domains b where b.id = v_id and b.active),
                 'réactiver : actif à nouveau, une ligne');
  -- ── un domaine public ──
  v_r := public.regler_domaine_adresse(v_p[5], v_admin, v_dom, 'publics', v_pub, true, 'sonde : messagerie grand public');
  return next ok(v_r ->> 'issue' = 'regle'
                 and exists (select 1 from public.public_email_domains p where p.email_domain = v_pub and p.active)
                 and exists (select 1 from public.grand_livre g where g.piece = v_p[5] and g.sujet_type = 'public_email_domains'
                              and g.detail ->> 'liste' = 'publics'),
                 'domaine public : écrit, sa ligne dit la liste « publics »');
  -- ── les refus nommés : rien d'écrit ──
  v_r := public.regler_domaine_adresse(v_p[6], v_admin, v_dom, 'bloques', v_pub, true, '');
  return next ok(v_r ->> 'issue' = 'dans_l_autre_liste' and pg_temp.lignes(v_p[6]) = 0
                 and not exists (select 1 from public.blocked_email_domains b where b.email_domain = v_pub),
                 'un domaine public actif ne se bloque pas : dans_l_autre_liste, rien d''écrit');
  return next ok(public.regler_domaine_adresse(v_p[7], v_admin, v_dom, 'bloques', 'sonde@exemple.invalid', true, '') ->> 'issue' = 'domaine_invalide'
                 and public.regler_domaine_adresse(v_p[7], v_admin, v_dom, 'bloques', 'https://exemple.invalid', true, '') ->> 'issue' = 'domaine_invalide'
                 and pg_temp.lignes(v_p[7]) = 0,
                 'une adresse, une URL ne sont pas des domaines : domaine_invalide, rien d''écrit');
  return next ok(public.regler_domaine_adresse(v_p[8], v_admin, v_dom, 'publics', 'absent-' || gen_random_uuid() || '.invalid', false, '') ->> 'issue' = 'domaine_inconnu'
                 and public.regler_domaine_adresse(v_p[8], v_admin, v_dom, 'autre', v_d, true, '') ->> 'issue' = 'liste_inconnue'
                 and pg_temp.lignes(v_p[8]) = 0,
                 'retirer ce qui n''existe pas : domaine_inconnu ; une liste inventée : liste_inconnue');
  -- ── AD002 : la sécurité en base ──
  return next throws_ok(format($q$select public.regler_domaine_adresse(%L, %L, %L, 'bloques', 'autre-%s.invalid', true, '')$q$,
                               v_p[9], v_client, v_dom, replace(gen_random_uuid()::text, '-', '')),
                        'AD002', null, 'un client ne règle pas les listes : AD002');
  return next ok(pg_temp.lignes(v_p[9]) = 0
                 and not has_function_privilege('authenticated', 'public.regler_domaine_adresse(uuid, uuid, uuid, text, text, boolean, text)', 'execute')
                 and not has_function_privilege('anon', 'public.regler_domaine_adresse(uuid, uuid, uuid, text, text, boolean, text)', 'execute'),
                 'AD002 n''a rien écrit ; la fonction est fermée au navigateur');
  -- ── la liste blanche : le domaine n'entre pas au grand livre (identifiants seulement) ──
  return next throws_ok(format($q$select public.journaliser_reglage(%L, %L, %L, 'blocked_email_domains', %L, '{}'::jsonb, '{"actif":true}'::jsonb, '{"liste":"bloques","domaine":"x.invalid"}'::jsonb)$q$,
                               v_p[10], v_admin, v_dom, v_id),
                        'GL004', null, 'le NOM du domaine n''entre pas au grand livre (GL004)');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
