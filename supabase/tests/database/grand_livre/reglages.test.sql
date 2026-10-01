-- reglage_modifie — les sept RPC de réglage et leur écrivain unique journaliser_reglage() : chaque
-- réglage et sa ligne, ensemble. Depuis l'ARRÊT 22 (décision de Youssef, 01/10/2026), un réglage
-- réenregistré À L'IDENTIQUE n'écrit plus de ligne : chaque cas CHANGE donc une valeur, dans les bornes
-- réelles des tables (contraintes lues dans les migrations, §G.10) — duree_vie_annonce_check (1..365),
-- ai_quotas_max_check (>= 1), ai_spend_caps_cap_check (>= 0), verification_providers_confidence_check
-- (0..10) ; le moteur bascule `notify_enabled` (aucune borne). Puis le cas identique : aucune ligne, et le
-- réglage est pourtant écrit ; un ÉCHEC identique s'écrit toujours. Tout est annulé.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(14);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin uuid := pg_temp.fab_admin();
  v_dom   uuid := pg_temp.fab_domaine();
  v_p     uuid[] := array(select gen_random_uuid() from generate_series(1, 12));
  v_d     record;
  v_t     record;
  v_c     record;
  v_q     record;
  v_m     record;
  v_v     record;
  v_pkg   uuid;
  v_cible text;
  v_n     integer;
  v_vie   integer;
  v_avant jsonb;
  v_apres jsonb;
  v_cle   text;
  v_note  integer;
begin
  -- ── les durées : la durée de vie d'une annonce bouge d'un jour, dans 1..365 ──
  select * into v_d from public.duree_reglages where ligne_unique;
  v_vie := case when v_d.vie_annonce_jours < 365 then v_d.vie_annonce_jours + 1 else v_d.vie_annonce_jours - 1 end;
  perform public.regler_durees_place(v_p[1], v_admin, v_dom, gen_random_uuid(), v_vie, v_d.fenetre_echange_jours,
                                     v_d.invitation_jours, v_d.conservation_ip_mois,
                                     jsonb_build_object('avant', jsonb_build_object('vie_annonce_jours', v_d.vie_annonce_jours),
                                                        'apres', jsonb_build_object('vie_annonce_jours', v_vie), 'retroactivite', null));
  return next ok(pg_temp.lignes(v_p[1]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.type_action = 'reglage_modifie'
                   and g.sujet_type = 'duree_reglages' and (g.detail -> 'apres' ->> 'vie_annonce_jours')::integer = v_vie),
                 'durées : UNE ligne reglage_modifie, sujet duree_reglages, avec la nouvelle valeur');
  -- ── un tarif : le premier prix renseigné bouge d'un centime ──
  select * into v_t from public.ai_model_tarifs order by model limit 1;
  v_avant := jsonb_build_object('usd_par_1m_entree', v_t.usd_par_1m_entree, 'usd_par_1m_sortie', v_t.usd_par_1m_sortie, 'usd_par_unite', v_t.usd_par_unite,
                                'usd_par_recherche', v_t.usd_par_recherche, 'usd_par_recherche_web', v_t.usd_par_recherche_web);
  select k into v_cle from unnest(array['usd_par_1m_entree', 'usd_par_1m_sortie', 'usd_par_unite', 'usd_par_recherche', 'usd_par_recherche_web']) k
   where v_avant ->> k is not null limit 1;
  v_apres := jsonb_set(v_avant, array[v_cle], to_jsonb((v_avant ->> v_cle)::numeric + 0.01));
  perform public.regler_tarif_ia(v_p[2], v_admin, v_dom, gen_random_uuid(), v_t.model, v_apres, null, v_avant);
  return next ok(pg_temp.lignes(v_p[2]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[2] and g.detail ->> 'model' = v_t.model),
                 'tarif : UNE ligne, avec le modèle');
  return next throws_ok(format($q$select public.regler_tarif_ia(%L, %L, null, %L, 'modele_inconnu_sonde', '{}'::jsonb, null, '{}'::jsonb)$q$,
                               gen_random_uuid(), v_admin, gen_random_uuid()),
                        'P0002', null, 'tarif : un modèle inconnu est refusé');
  -- ── un plafond : 'claude' (ai_spend_caps_provider_check n'admet que 'claude' et 'rerank'), un dollar de plus ──
  select * into v_c from public.ai_spend_caps where provider = 'claude';
  v_n := public.regler_plafonds_ia(v_p[3], v_admin, v_dom,
                                   jsonb_build_object(v_c.provider, v_c.monthly_cap_usd + 1), '{}'::jsonb, '{}'::jsonb,
                                   jsonb_build_object(v_c.provider, v_c.monthly_cap_usd), '{}'::jsonb, '{}'::jsonb,
                                   gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
  return next ok(v_n = 1 and pg_temp.lignes(v_p[3]) = 1, 'plafonds : une famille touchée, UNE ligne');
  -- ── un quota : une analyse de plus (>= 1) ──
  select * into v_q from public.ai_quotas where quota = 'cv_parsing';
  perform public.regler_quota_ia(v_p[4], v_admin, v_dom, gen_random_uuid(), 'cv_parsing', v_q.max_per_window + 1, v_q.window_hours,
                                 jsonb_build_object('max_per_window', v_q.max_per_window, 'window_hours', v_q.window_hours));
  return next ok(pg_temp.lignes(v_p[4]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[4] and g.detail ->> 'quota' = 'cv_parsing'),
                 'quota : UNE ligne, avec le quota');
  -- ── le moteur, pour l'écosystème : les notifications basculent ──
  select * into v_m from public.matching_settings where domain_id = v_dom;
  perform public.regler_matching(v_p[5], v_admin, v_dom, v_dom,
                                 jsonb_build_object('notify_enabled', not v_m.notify_enabled), jsonb_build_object('notify_enabled', v_m.notify_enabled));
  return next ok(pg_temp.lignes(v_p[5]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[5] and g.ecosysteme_id = v_dom),
                 'moteur : UNE ligne, sous l''écosystème du réglage');
  -- ── une note de jugement : un point de plus ou de moins, dans 0..10 ──
  select * into v_v from public.verification_providers order by id limit 1;
  v_note := case when v_v.confidence_threshold < 10 then v_v.confidence_threshold + 1 else v_v.confidence_threshold - 1 end;
  perform public.regler_note_jugement(v_p[6], v_admin, v_dom, v_v.id, null, v_note,
                                      jsonb_build_object('note', v_v.confidence_threshold), jsonb_build_object('note', v_note), 'experts');
  return next ok(pg_temp.lignes(v_p[6]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[6] and g.detail ->> 'note_de' = 'experts'),
                 'note de jugement : UNE ligne');
  -- ── l'offre par défaut : une offre GRATUITE active prend le défaut de sa cible ──
  --  La cible est celle du défaut CLIENT en place ('client' ou 'all', selon l'amorçage) : remplacer
  --  un défaut 'all' par une offre 'client' laisserait le cabinet sans défaut (target_uncovered).
  select p.target_role into v_cible from public.packages p
   where p.is_default and p.active and p.target_role in ('client', 'all');
  insert into public.packages (name, slug, target_role, scope, is_free, price_monthly, price_yearly, active, is_default)
  values ('Sonde', 'sonde-' || replace(gen_random_uuid()::text, '-', ''), v_cible, 'organization', true, null, null, true, false)
  returning id into v_pkg;
  perform public.set_default_package(v_pkg, v_p[7], v_admin, v_dom);
  return next ok(exists (select 1 from public.packages p where p.id = v_pkg and p.is_default)
                 and (select count(*) from public.packages p where p.is_default and p.active and p.target_role in ('client', 'all')) = 1,
                 'défaut : l''offre prend le défaut de sa cible, et une seule le porte');
  return next ok(pg_temp.lignes(v_p[7]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[7] and g.sujet_type = 'packages_default'),
                 'défaut : UNE ligne, sujet le défaut de la cible');
  -- ── l'écrivain unique : un réglage n'est jamais « refusé » ──
  return next throws_ok(format($q$select public.journaliser_reglage(%L, %L, null, 'packages', %L, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'refuse')$q$,
                               v_p[8], v_admin, gen_random_uuid()),
                        'GL003', null, 'journaliser_reglage refuse le statut « refuse »');

  -- ══ À L'IDENTIQUE : AUCUNE LIGNE (ARRÊT 22) ══
  select * into v_d from public.duree_reglages where ligne_unique;
  perform public.regler_durees_place(v_p[9], v_admin, v_dom, gen_random_uuid(), v_d.vie_annonce_jours, v_d.fenetre_echange_jours,
                                     v_d.invitation_jours, v_d.conservation_ip_mois,
                                     jsonb_build_object('avant', jsonb_build_object('vie_annonce_jours', v_d.vie_annonce_jours),
                                                        'apres', jsonb_build_object('vie_annonce_jours', v_d.vie_annonce_jours), 'retroactivite', null));
  return next is(pg_temp.lignes(v_p[9]), 0::bigint, 'durées réenregistrées à l''identique : AUCUNE ligne');
  return next ok(exists (select 1 from public.duree_reglages d where d.ligne_unique and d.updated_by = v_admin),
                 'et le réglage est pourtant écrit (l''identique n''est pas un refus)');
  select * into v_q from public.ai_quotas where quota = 'cv_parsing';
  perform public.regler_quota_ia(v_p[10], v_admin, v_dom, gen_random_uuid(), 'cv_parsing', v_q.max_per_window, v_q.window_hours,
                                 jsonb_build_object('max_per_window', v_q.max_per_window, 'window_hours', v_q.window_hours));
  return next is(pg_temp.lignes(v_p[10]), 0::bigint, 'quota réenregistré à l''identique : AUCUNE ligne');
  -- Un ÉCHEC s'écrit toujours, même identique.
  perform public.journaliser_reglage(v_p[11], v_admin, null, 'packages_stripe', gen_random_uuid(), '{}'::jsonb, '{}'::jsonb,
                                     jsonb_build_object('mode', 'test', 'cause', 'sonde'), 'echoue');
  return next is(pg_temp.lignes(v_p[11]), 1::bigint, 'un échec identique s''écrit toujours : UNE ligne');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
