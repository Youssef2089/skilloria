-- reglage_modifie — les sept RPC de réglage et leur écrivain unique journaliser_reglage() : chaque
-- réglage et sa ligne, ensemble (aucune n'avait de sonde). Valeurs LUES en base et réécrites à
-- l'identique : le test prouve le chemin, il ne change aucun réglage (et tout est annulé).
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(10);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_admin uuid := pg_temp.fab_admin();
  v_dom   uuid := pg_temp.fab_domaine();
  v_p     uuid[] := array(select gen_random_uuid() from generate_series(1, 9));
  v_d     record;
  v_t     record;
  v_c     record;
  v_q     record;
  v_m     record;
  v_v     record;
  v_pkg   uuid;
  v_cible text;
  v_n     integer;
begin
  -- ── les durées ──
  select * into v_d from public.duree_reglages where ligne_unique;
  perform public.regler_durees_place(v_p[1], v_admin, v_dom, gen_random_uuid(), v_d.vie_annonce_jours, v_d.fenetre_echange_jours,
                                     v_d.invitation_jours, v_d.conservation_ip_mois,
                                     jsonb_build_object('avant', jsonb_build_object('vie_annonce_jours', v_d.vie_annonce_jours),
                                                        'apres', jsonb_build_object('vie_annonce_jours', v_d.vie_annonce_jours), 'retroactivite', null));
  return next ok(pg_temp.lignes(v_p[1]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[1] and g.type_action = 'reglage_modifie' and g.sujet_type = 'duree_reglages'),
                 'durées : UNE ligne reglage_modifie, sujet duree_reglages');
  -- ── un tarif ──
  select * into v_t from public.ai_model_tarifs order by model limit 1;
  perform public.regler_tarif_ia(v_p[2], v_admin, v_dom, gen_random_uuid(), v_t.model,
    jsonb_build_object('usd_par_1m_entree', v_t.usd_par_1m_entree, 'usd_par_1m_sortie', v_t.usd_par_1m_sortie, 'usd_par_unite', v_t.usd_par_unite,
                       'usd_par_recherche', v_t.usd_par_recherche, 'usd_par_recherche_web', v_t.usd_par_recherche_web),
    null,
    jsonb_build_object('usd_par_1m_entree', v_t.usd_par_1m_entree, 'usd_par_1m_sortie', v_t.usd_par_1m_sortie, 'usd_par_unite', v_t.usd_par_unite,
                       'usd_par_recherche', v_t.usd_par_recherche, 'usd_par_recherche_web', v_t.usd_par_recherche_web));
  return next ok(pg_temp.lignes(v_p[2]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[2] and g.detail ->> 'model' = v_t.model),
                 'tarif : UNE ligne, avec le modèle');
  return next throws_ok(format($q$select public.regler_tarif_ia(%L, %L, null, %L, 'modele_inconnu_sonde', '{}'::jsonb, null, '{}'::jsonb)$q$,
                               gen_random_uuid(), v_admin, gen_random_uuid()),
                        'P0002', null, 'tarif : un modèle inconnu est refusé');
  -- ── un plafond ──
  -- 'claude' nommé : la contrainte ai_spend_caps_provider_check n'admet que 'claude' et 'rerank', et la
  -- liste blanche porte ces deux clés — un fournisseur pris « au hasard » ne dirait rien de plus.
  select * into v_c from public.ai_spend_caps where provider = 'claude';
  v_n := public.regler_plafonds_ia(v_p[3], v_admin, v_dom,
                                   jsonb_build_object(v_c.provider, v_c.monthly_cap_usd), '{}'::jsonb, '{}'::jsonb,
                                   jsonb_build_object(v_c.provider, v_c.monthly_cap_usd), '{}'::jsonb, '{}'::jsonb,
                                   gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
  return next ok(v_n = 1 and pg_temp.lignes(v_p[3]) = 1, 'plafonds : une famille touchée, UNE ligne');
  -- ── un quota ──
  select * into v_q from public.ai_quotas where quota = 'cv_parsing';
  perform public.regler_quota_ia(v_p[4], v_admin, v_dom, gen_random_uuid(), 'cv_parsing', v_q.max_per_window, v_q.window_hours,
                                 jsonb_build_object('max_per_window', v_q.max_per_window, 'window_hours', v_q.window_hours));
  return next ok(pg_temp.lignes(v_p[4]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[4] and g.detail ->> 'quota' = 'cv_parsing'),
                 'quota : UNE ligne, avec le quota');
  -- ── le moteur, pour l'écosystème ──
  select * into v_m from public.matching_settings where domain_id = v_dom;
  perform public.regler_matching(v_p[5], v_admin, v_dom, v_dom,
                                 jsonb_build_object('feed_threshold', v_m.feed_threshold), jsonb_build_object('feed_threshold', v_m.feed_threshold));
  return next ok(pg_temp.lignes(v_p[5]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[5] and g.ecosysteme_id = v_dom),
                 'moteur : UNE ligne, sous l''écosystème du réglage');
  -- ── une note de jugement ──
  select * into v_v from public.verification_providers order by id limit 1;
  perform public.regler_note_jugement(v_p[6], v_admin, v_dom, v_v.id, null, v_v.confidence_threshold,
                                      jsonb_build_object('note', v_v.confidence_threshold), jsonb_build_object('note', v_v.confidence_threshold), 'sonde');
  return next ok(pg_temp.lignes(v_p[6]) = 1 and exists (select 1 from public.grand_livre g where g.piece = v_p[6] and g.detail ->> 'note_de' = 'sonde'),
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
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
