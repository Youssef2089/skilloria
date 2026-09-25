-- ════════════════════════════════════════════════════════════════════════════
--  TOUT RÉGLAGE D'ADMINISTRATION S'ÉCRIT AU GRAND LIVRE — UN SEUL ÉCRIVAIN.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Les routes d'administration
--  (tarifs, plafonds, quotas, moteur, notes de jugement, offres) appellent dès
--  ce commit les RPC créées ici ; déployées avant, elles répondraient 500.
--  Remplace `regler_durees_place()` et `set_default_package()` à comportement
--  égal, plus la ligne de journal. Rejouable.
--
--  ┌─ CE QU'ON FERME ────────────────────────────────────────────────────────┐
--  │ Six familles de réglages — dont cinq réglages d'ARGENT — s'écrivaient   │
--  │ par le client, chacune avec sa trace d'audit best-effort (§E.68 : sept   │
--  │ de ces traces n'ont jamais existé). Le grand livre exige mieux : la     │
--  │ ligne métier et la ligne de journal dans la MÊME transaction, et UN     │
--  │ écrivain pour l'action `reglage_modifie`, quelle que soit la famille.   │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  L'ÉCRIVAIN UNIQUE : `journaliser_reglage()`. Il porte le seul littéral
--  'reglage_modifie' du dépôt (le contrôle le compte). Les RPC métier —
--  `regler_durees_place`, `regler_tarif_ia`, `regler_plafonds_ia`,
--  `regler_quota_ia`, `regler_matching`, `regler_note_jugement`,
--  `set_default_package` — écrivent leur table puis l'appellent, dans la même
--  transaction. Les gestes qu'une transaction ne peut pas contenir (créer ou
--  modifier une offre avec Stripe au milieu, attribuer ou migrer des offres,
--  synchroniser le catalogue) l'appellent depuis le code, après leur écriture,
--  sous la même pièce — motif « journal après écriture », dit en §C.21.
--
--  LE DÉTAIL, EN LISTE BLANCHE : `avant` et `apres` portent les colonnes de
--  la famille touchée (jamais un texte libre : la raison d'un changement
--  d'offre n'entre pas), et un complément nommé — le modèle, le quota, le
--  champ, la cible, le mode Stripe, les offres reliées.
--
--  LE DÉFAUT DU CATALOGUE EST UN OBJET À PART. Créer une offre par défaut est
--  UN geste qui touche DEUX objets : l'offre (créée) et le défaut de sa cible
--  (déplacé). Une action s'écrit une fois par pièce et par sujet (GL005) :
--  `set_default_package` journalise donc sur le sujet `packages_default:<cible>`
--  — identifiant dérivé, stable — et la création sur l'offre elle-même. Deux
--  lignes, deux sujets, une pièce.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── ① L'ÉCRIVAIN UNIQUE ─────────────────────────────────────────────────────
create or replace function public.journaliser_reglage(
  p_piece         uuid,
  p_acteur_id     uuid,
  p_ecosysteme_id uuid,
  p_sujet_type    text,
  p_sujet_id      uuid,
  p_avant         jsonb,
  p_apres         jsonb,
  p_complement    jsonb default '{}'::jsonb,
  p_statut        text  default 'reussi'
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if p_acteur_id is null then
    raise exception 'journaliser_reglage : un reglage a toujours un auteur' using errcode = 'GL002';
  end if;
  -- Un réglage aboutit ou échoue ; il n'est jamais « refusé » par ici — un
  -- refus de garde a ses propres actions, nommées.
  if p_statut not in ('reussi', 'echoue') then
    raise exception 'journaliser_reglage : statut « % » — un reglage est reussi ou echoue', p_statut using errcode = 'GL003';
  end if;
  return public.journaliser(
    p_piece, 'reglage_modifie', p_statut, 'administrateur',
    p_acteur_id, 'admin', p_ecosysteme_id,
    p_sujet_type, p_sujet_id,
    jsonb_build_object('avant', coalesce(p_avant, '{}'::jsonb), 'apres', coalesce(p_apres, '{}'::jsonb))
      || coalesce(p_complement, '{}'::jsonb));
end;
$fn$;
revoke all on function public.journaliser_reglage(uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.journaliser_reglage(uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, text) to service_role;


-- ── ② LES DURÉES — recréée pour passer par l'écrivain unique ────────────────
create or replace function public.regler_durees_place(
  p_piece            uuid,
  p_acteur_id        uuid,
  p_ecosysteme_id    uuid,
  p_sujet_id         uuid,
  p_vie              integer,
  p_fenetre          integer,
  p_invitation       integer,
  p_conservation_ip  integer,
  p_detail           jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  if p_piece is null then
    raise exception 'regler_durees_place : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_acteur_id is null then
    raise exception 'regler_durees_place : l acteur est obligatoire — un reglage a toujours un auteur' using errcode = 'GL002';
  end if;

  update public.duree_reglages
     set vie_annonce_jours     = p_vie,
         fenetre_echange_jours = p_fenetre,
         invitation_jours      = p_invitation,
         conservation_ip_mois  = p_conservation_ip,
         updated_at            = now(),
         updated_by            = p_acteur_id
   where ligne_unique = true;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'regler_durees_place : % ligne(s) de reglage touchee(s) — attendu exactement 1', v_n;
  end if;

  return public.journaliser_reglage(
    p_piece, p_acteur_id, p_ecosysteme_id, 'duree_reglages', p_sujet_id,
    p_detail -> 'avant', p_detail -> 'apres', (p_detail - 'avant') - 'apres');
end;
$fn$;


-- ── ③ LES TARIFS DES MODÈLES ────────────────────────────────────────────────
create or replace function public.regler_tarif_ia(
  p_piece         uuid,
  p_acteur_id     uuid,
  p_ecosysteme_id uuid,
  p_sujet_id      uuid,
  p_model         text,
  p_valeurs       jsonb,
  p_source        text,
  p_avant         jsonb
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  update public.ai_model_tarifs
     set usd_par_1m_entree     = (p_valeurs ->> 'usd_par_1m_entree')::numeric,
         usd_par_1m_sortie     = (p_valeurs ->> 'usd_par_1m_sortie')::numeric,
         usd_par_unite         = (p_valeurs ->> 'usd_par_unite')::numeric,
         usd_par_recherche     = (p_valeurs ->> 'usd_par_recherche')::numeric,
         usd_par_recherche_web = (p_valeurs ->> 'usd_par_recherche_web')::numeric,
         source                = coalesce(nullif(btrim(p_source), ''), source),
         updated_at            = now(),
         updated_by            = p_acteur_id
   where model = p_model;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    -- On ne CRÉE pas une ligne : un modèle inconnu de la grille est un modèle
    -- que le code n'appelle pas (cf. la route).
    raise exception 'regler_tarif_ia : modele inconnu « % »', p_model using errcode = 'P0002';
  end if;
  return public.journaliser_reglage(
    p_piece, p_acteur_id, p_ecosysteme_id, 'ai_model_tarifs', p_sujet_id,
    p_avant, p_valeurs, jsonb_build_object('model', p_model));
end;
$fn$;
revoke all on function public.regler_tarif_ia(uuid, uuid, uuid, uuid, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.regler_tarif_ia(uuid, uuid, uuid, uuid, text, jsonb, text, jsonb) to service_role;


-- ── ④ LES PLAFONDS ET LES ALERTES — trois tables, une ligne par famille touchée ─
create or replace function public.regler_plafonds_ia(
  p_piece                  uuid,
  p_acteur_id              uuid,
  p_ecosysteme_id          uuid,
  p_plafonds               jsonb,
  p_alertes                jsonb,
  p_plafonds_acteur        jsonb,
  p_avant_plafonds         jsonb,
  p_avant_alertes          jsonb,
  p_avant_plafonds_acteur  jsonb,
  p_sujet_plafonds         uuid,
  p_sujet_alertes          uuid,
  p_sujet_plafonds_acteur  uuid
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_k      text;
  v_v      text;
  v_n      integer;
  v_lignes integer := 0;
begin
  for v_k, v_v in select key, value from jsonb_each_text(coalesce(p_plafonds, '{}'::jsonb)) loop
    update public.ai_spend_caps set monthly_cap_usd = v_v::numeric, updated_at = now() where provider = v_k;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'regler_plafonds_ia : fournisseur inconnu « % »', v_k using errcode = 'P0002'; end if;
  end loop;
  for v_k, v_v in select key, value from jsonb_each_text(coalesce(p_alertes, '{}'::jsonb)) loop
    update public.ai_spend_seuils_acteur set seuil_mensuel_usd = v_v::numeric, updated_at = now() where acteur = v_k;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'regler_plafonds_ia : acteur inconnu « % »', v_k using errcode = 'P0002'; end if;
  end loop;
  for v_k, v_v in select key, value from jsonb_each_text(coalesce(p_plafonds_acteur, '{}'::jsonb)) loop
    update public.ai_spend_seuils_acteur set plafond_mensuel_usd = v_v::numeric, updated_at = now() where acteur = v_k;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'regler_plafonds_ia : acteur inconnu « % »', v_k using errcode = 'P0002'; end if;
  end loop;

  -- Une ligne par FAMILLE touchée, sous la même pièce : trois sujets distincts.
  if coalesce(p_plafonds, '{}'::jsonb) <> '{}'::jsonb then
    perform public.journaliser_reglage(p_piece, p_acteur_id, p_ecosysteme_id, 'ai_spend_caps', p_sujet_plafonds,
                                       p_avant_plafonds, p_plafonds, '{}'::jsonb);
    v_lignes := v_lignes + 1;
  end if;
  if coalesce(p_alertes, '{}'::jsonb) <> '{}'::jsonb then
    perform public.journaliser_reglage(p_piece, p_acteur_id, p_ecosysteme_id, 'ai_spend_seuils_acteur', p_sujet_alertes,
                                       p_avant_alertes, p_alertes, jsonb_build_object('champ', 'seuil_mensuel_usd'));
    v_lignes := v_lignes + 1;
  end if;
  if coalesce(p_plafonds_acteur, '{}'::jsonb) <> '{}'::jsonb then
    perform public.journaliser_reglage(p_piece, p_acteur_id, p_ecosysteme_id, 'ai_spend_seuils_acteur', p_sujet_plafonds_acteur,
                                       p_avant_plafonds_acteur, p_plafonds_acteur, jsonb_build_object('champ', 'plafond_mensuel_usd'));
    v_lignes := v_lignes + 1;
  end if;
  return v_lignes;
end;
$fn$;
revoke all on function public.regler_plafonds_ia(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.regler_plafonds_ia(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, uuid, uuid) to service_role;


-- ── ⑤ LES QUOTAS ────────────────────────────────────────────────────────────
create or replace function public.regler_quota_ia(
  p_piece         uuid,
  p_acteur_id     uuid,
  p_ecosysteme_id uuid,
  p_sujet_id      uuid,
  p_quota         text,
  p_max           integer,
  p_fenetre       integer,
  p_avant         jsonb
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  update public.ai_quotas
     set max_per_window = p_max,
         window_hours   = p_fenetre,
         updated_at     = now(),
         updated_by     = p_acteur_id
   where quota = p_quota;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'regler_quota_ia : quota inconnu « % »', p_quota using errcode = 'P0002';
  end if;
  return public.journaliser_reglage(
    p_piece, p_acteur_id, p_ecosysteme_id, 'ai_quotas', p_sujet_id,
    p_avant, jsonb_build_object('max_per_window', p_max, 'window_hours', p_fenetre),
    jsonb_build_object('quota', p_quota));
end;
$fn$;
revoke all on function public.regler_quota_ia(uuid, uuid, uuid, uuid, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.regler_quota_ia(uuid, uuid, uuid, uuid, text, integer, integer, jsonb) to service_role;


-- ── ⑥ LE MOTEUR — par écosystème ───────────────────────────────────────────
--  L'écosystème de la ligne est celui du RÉGLAGE (p_domain_id), pas celui du
--  compte administrateur : c'est lui que le filtre de l'écran doit retrouver.
create or replace function public.regler_matching(
  p_piece      uuid,
  p_acteur_id  uuid,
  p_domain_id  uuid,
  p_sujet_id   uuid,
  p_patch      jsonb,
  p_avant      jsonb
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  update public.matching_settings
     set feed_threshold    = coalesce((p_patch ->> 'feed_threshold')::numeric, feed_threshold),
         notify_threshold  = coalesce((p_patch ->> 'notify_threshold')::numeric, notify_threshold),
         notify_enabled    = coalesce((p_patch ->> 'notify_enabled')::boolean, notify_enabled),
         rerank_model      = coalesce(p_patch ->> 'rerank_model', rerank_model),
         rerank_batch_size = coalesce((p_patch ->> 'rerank_batch_size')::integer, rerank_batch_size),
         updated_at        = now(),
         updated_by        = p_acteur_id
   where domain_id = p_domain_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'regler_matching : aucun reglage pour l ecosysteme %', p_domain_id using errcode = 'P0002';
  end if;
  return public.journaliser_reglage(
    p_piece, p_acteur_id, p_domain_id, 'matching_settings', p_sujet_id,
    p_avant, p_patch, '{}'::jsonb);
end;
$fn$;
revoke all on function public.regler_matching(uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.regler_matching(uuid, uuid, uuid, uuid, jsonb, jsonb) to service_role;


-- ── ⑦ LES NOTES DE JUGEMENT (vérification) ─────────────────────────────────
create or replace function public.regler_note_jugement(
  p_piece                 uuid,
  p_acteur_id             uuid,
  p_ecosysteme_id         uuid,
  p_ligne_id              uuid,
  p_config                jsonb,
  p_confidence_threshold  integer,
  p_avant                 jsonb,
  p_apres                 jsonb,
  p_note_de               text
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  update public.verification_providers
     set config               = coalesce(p_config, config),
         confidence_threshold = coalesce(p_confidence_threshold, confidence_threshold),
         updated_at           = now()
   where id = p_ligne_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'regler_note_jugement : fournisseur de verification % introuvable', p_ligne_id using errcode = 'P0002';
  end if;
  return public.journaliser_reglage(
    p_piece, p_acteur_id, p_ecosysteme_id, 'verification_providers', p_ligne_id,
    p_avant, p_apres, jsonb_build_object('note_de', p_note_de));
end;
$fn$;
revoke all on function public.regler_note_jugement(uuid, uuid, uuid, uuid, jsonb, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.regler_note_jugement(uuid, uuid, uuid, uuid, jsonb, integer, jsonb, jsonb, text) to service_role;


-- ── ⑧ L'OFFRE PAR DÉFAUT — même transfert, plus la ligne ────────────────────
--  L'ancienne signature (un argument) disparaît : deux fonctions du même nom
--  laisseraient un appelant écrire SANS journaliser, en silence.
drop function if exists public.set_default_package(uuid);

create or replace function public.set_default_package(
  p_package_id    uuid,
  p_piece         uuid,
  p_acteur_id     uuid,
  p_ecosysteme_id uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target   text;
  v_active   boolean;
  v_default  boolean;
  v_client   integer;
  v_cabinet  integer;
  v_collab   integer;
  v_unset    uuid[];
begin
  -- ── 1. Existence + état, avec verrou de ligne pour sérialiser deux
  --       transferts concurrents sur la même offre.
  select target_role, active, is_default
    into v_target, v_active, v_default
  from public.packages
  where id = p_package_id
  for update;

  if not found then
    raise exception 'package_not_found' using errcode = 'P0002';
  end if;

  -- Déjà le défaut : no-op silencieux (geste idempotent côté appelant) — et
  -- rien à journaliser : rien n'a changé.
  if v_default then
    return;
  end if;

  if not v_active then
    raise exception 'package_inactive' using errcode = 'P0001';
  end if;

  -- ── 2. Couverture RÉSULTANTE, calculée AVANT toute écriture.
  --       Couverture : R couvre T  ⇔  R = T  OU  (R = 'all' ET T <> 'collaboration').
  with defaults as (
    select id, target_role
    from public.packages
    where is_default and active and id <> p_package_id
  ),
  kept as (
    select d.id, d.target_role
    from defaults d
    where not (
      (d.target_role in ('client', 'all')  and v_target in ('client', 'all'))
      or
      (d.target_role in ('cabinet', 'all') and v_target in ('cabinet', 'all'))
      or
      (d.target_role = 'collaboration'     and v_target = 'collaboration')
    )
  ),
  resulting as (
    select target_role from kept
    union all
    select v_target
  )
  select
    count(*) filter (where target_role in ('client', 'all')),
    count(*) filter (where target_role in ('cabinet', 'all')),
    count(*) filter (where target_role = 'collaboration')
    into v_client, v_cabinet, v_collab
  from resulting;

  if v_client <> 1 or v_cabinet <> 1 or v_collab <> 1 then
    raise exception 'target_uncovered' using errcode = 'P0001';
  end if;

  -- ── 3. Les défauts que le transfert DÉFAIT — l'« avant » de la ligne.
  select coalesce(array_agg(id), '{}'::uuid[]) into v_unset
    from public.packages
   where is_default
     and id <> p_package_id
     and (
       (target_role in ('client', 'all')  and v_target in ('client', 'all'))
       or
       (target_role in ('cabinet', 'all') and v_target in ('cabinet', 'all'))
       or
       (target_role = 'collaboration'     and v_target = 'collaboration')
     );

  -- ── 4. Application — même transaction, aucune fenêtre sans défaut.
  update public.packages
     set is_default = false,
         updated_at = now()
   where id = any (v_unset);

  update public.packages
     set is_default = true,
         updated_at = now()
   where id = p_package_id;

  -- ── 5. Contrôle final sur l'état RÉEL : toute incohérence annule la
  --       transaction entière — la ligne de journal comprise, écrite après.
  select
    count(*) filter (where target_role in ('client', 'all')),
    count(*) filter (where target_role in ('cabinet', 'all')),
    count(*) filter (where target_role = 'collaboration')
    into v_client, v_cabinet, v_collab
  from public.packages
  where is_default and active;

  if v_client <> 1 or v_cabinet <> 1 or v_collab <> 1 then
    raise exception 'invariant_broken (client=%, cabinet=%, collaboration=%)',
      v_client, v_cabinet, v_collab using errcode = 'P0001';
  end if;

  -- ── 6. La ligne du grand livre : le DÉFAUT DE LA CIBLE a changé de main.
  --       Sujet dérivé, distinct de l'offre — une création d'offre par défaut
  --       écrit sa propre ligne sur l'offre, sous la même pièce (cf. en-tête).
  perform public.journaliser_reglage(
    p_piece, p_acteur_id, p_ecosysteme_id,
    'packages_default', public.identifiant_derive('reglage', 'packages_default:' || v_target),
    jsonb_build_object('default_ids', to_jsonb(v_unset)),
    jsonb_build_object('default_ids', jsonb_build_array(p_package_id)),
    jsonb_build_object('target_role', v_target, 'package_id', p_package_id));
end;
$$;
revoke all on function public.set_default_package(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_default_package(uuid, uuid, uuid, uuid) to service_role;


-- ── ⑨ LA LISTE BLANCHE DE `reglage_modifie` — l'union des familles ───────────
update public.grand_livre_actions
   set cles_detail = array[
     'avant', 'apres',
     -- durées
     'avant.vie_annonce_jours', 'avant.fenetre_echange_jours', 'avant.invitation_jours', 'avant.conservation_ip_mois',
     'apres.vie_annonce_jours', 'apres.fenetre_echange_jours', 'apres.invitation_jours', 'apres.conservation_ip_mois',
     'retroactivite', 'retroactivite.basculent', 'retroactivite.dont_devoilees', 'retroactivite.confirmee',
     -- tarifs
     'model',
     'avant.usd_par_1m_entree', 'avant.usd_par_1m_sortie', 'avant.usd_par_unite', 'avant.usd_par_recherche', 'avant.usd_par_recherche_web',
     'apres.usd_par_1m_entree', 'apres.usd_par_1m_sortie', 'apres.usd_par_unite', 'apres.usd_par_recherche', 'apres.usd_par_recherche_web',
     -- plafonds et alertes
     'champ', 'avant.claude', 'avant.rerank', 'apres.claude', 'apres.rerank',
     'avant.organization', 'avant.profile', 'apres.organization', 'apres.profile',
     -- quotas
     'quota', 'avant.max_per_window', 'avant.window_hours', 'apres.max_per_window', 'apres.window_hours',
     -- moteur
     'avant.feed_threshold', 'avant.notify_threshold', 'avant.notify_enabled', 'avant.rerank_model', 'avant.rerank_batch_size',
     'apres.feed_threshold', 'apres.notify_threshold', 'apres.notify_enabled', 'apres.rerank_model', 'apres.rerank_batch_size',
     -- notes de jugement
     'note_de', 'avant.note', 'avant.drapeaux', 'avant.drapeaux[]', 'apres.note', 'apres.drapeaux', 'apres.drapeaux[]',
     -- offres
     'avant.name', 'avant.slug', 'avant.target_role', 'avant.price_monthly', 'avant.price_yearly', 'avant.currency',
     'avant.active', 'avant.is_free', 'avant.is_default', 'avant.scope',
     'apres.name', 'apres.slug', 'apres.target_role', 'apres.price_monthly', 'apres.price_yearly', 'apres.currency',
     'apres.active', 'apres.is_free', 'apres.is_default', 'apres.scope',
     'features', 'features[].feature_code', 'features[].value', 'features[].reset_period', 'features[].avant',
     'package_fields', 'package_fields[]',
     'default_requested', 'default_applied', 'default_refused_code',
     -- le défaut du catalogue
     'target_role', 'package_id', 'avant.default_ids', 'avant.default_ids[]', 'apres.default_ids', 'apres.default_ids[]',
     -- attribution et migration d'offres
     'avant.package_id', 'avant.package_started_at', 'avant.package_valid_until',
     'apres.package_id', 'apres.package_started_at', 'apres.package_valid_until',
     'count', 'skipped_subscribed',
     -- catalogue Stripe
     'mode', 'synchronisees', 'synchronisees[]', 'refusees', 'refusees[]', 'en_echec', 'en_echec[]', 'cause'
   ]::text[]
 where code = 'reglage_modifie';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_sig    text;
  v_id     bigint;
  v_cles   text[];
  v_acteur uuid;
  v_vie    integer;
  v_fen    integer;
  v_inv    integer;
  v_ip     integer;
begin
  for v_sig in
    select s from unnest(array[
      'public.journaliser_reglage(uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, text)',
      'public.regler_durees_place(uuid, uuid, uuid, uuid, integer, integer, integer, integer, jsonb)',
      'public.regler_tarif_ia(uuid, uuid, uuid, uuid, text, jsonb, text, jsonb)',
      'public.regler_plafonds_ia(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, uuid, uuid)',
      'public.regler_quota_ia(uuid, uuid, uuid, uuid, text, integer, integer, jsonb)',
      'public.regler_matching(uuid, uuid, uuid, uuid, jsonb, jsonb)',
      'public.regler_note_jugement(uuid, uuid, uuid, uuid, jsonb, integer, jsonb, jsonb, text)',
      'public.set_default_package(uuid, uuid, uuid, uuid)'
    ]) as s
    where to_regprocedure(s) is null
  loop
    raise exception
      'postcondition NON TENUE : % manque ou a change de signature [vu : %]',
      v_sig,
      coalesce(
        (select string_agg(p.oid::regprocedure::text, ' | ')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = split_part(split_part(v_sig, '.', 2), '(', 1)),
        'aucune fonction de ce nom');
  end loop;
  -- L'ANCIENNE porte sans journal a disparu.
  if to_regprocedure('public.set_default_package(uuid)') is not null then
    raise exception 'postcondition NON TENUE : set_default_package(uuid) existe encore — une porte sans journal';
  end if;
  -- La liste blanche couvre chaque famille (un témoin par famille).
  select cles_detail into v_cles from public.grand_livre_actions where code = 'reglage_modifie';
  if v_cles is null or not (v_cles @> array['avant.vie_annonce_jours', 'apres.usd_par_unite', 'apres.claude', 'apres.max_per_window',
                                            'apres.rerank_model', 'apres.note', 'apres.price_monthly', 'apres.package_id',
                                            'synchronisees[]', 'apres.default_ids[]', 'features[].feature_code', 'cause']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de reglage_modifie ne couvre pas toutes les familles [vu : %]', v_cles;
  end if;

  -- SONDE — l'écrivain unique écrit, sous la liste blanche, puis est annulé.
  begin
    v_id := public.journaliser_reglage(gen_random_uuid(), gen_random_uuid(), null::uuid, 'ai_quotas', gen_random_uuid(),
                                       '{"max_per_window":3,"window_hours":24}'::jsonb,
                                       '{"max_per_window":5,"window_hours":24}'::jsonb,
                                       '{"quota":"cv_parsing"}'::jsonb);
    if v_id is null then
      raise exception 'postcondition NON TENUE : journaliser_reglage n a rien ecrit';
    end if;
    if not exists (select 1 from public.grand_livre where id = v_id and type_action = 'reglage_modifie' and statut = 'reussi'
                      and detail -> 'apres' ->> 'max_per_window' = '5' and detail ->> 'quota' = 'cv_parsing') then
      raise exception 'postcondition NON TENUE : la ligne ecrite ne porte pas avant/apres et son complement';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un texte libre ne passe pas (la liste blanche tient aussi ici).
  begin
    perform public.journaliser_reglage(gen_random_uuid(), gen_random_uuid(), null::uuid, 'packages', gen_random_uuid(),
                                       '{}'::jsonb, '{"name":"x"}'::jsonb, '{"change_reason":"texte libre"}'::jsonb);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans reglage_modifie';
  exception when sqlstate 'GL004' then
    null;
  end;
  -- SONDE — un réglage n'est jamais « refusé » par cet écrivain.
  begin
    perform public.journaliser_reglage(gen_random_uuid(), gen_random_uuid(), null::uuid, 'packages', gen_random_uuid(),
                                       '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'refuse');
    raise exception 'postcondition NON TENUE : journaliser_reglage accepte le statut refuse';
  exception when sqlstate 'GL003' then
    null;
  end;
  -- SONDE — les durées passent toujours par la porte recréée (base vierge : sautée, et dite).
  select id into v_acteur from public.users order by created_at limit 1;
  if v_acteur is null then
    raise notice 'postcondition : sonde regler_durees_place SAUTEE — aucun compte en base (base vierge)';
  else
    begin
      select vie_annonce_jours, fenetre_echange_jours, invitation_jours, conservation_ip_mois
        into v_vie, v_fen, v_inv, v_ip from public.duree_reglages where ligne_unique = true;
      v_id := public.regler_durees_place(gen_random_uuid(), v_acteur, null::uuid, gen_random_uuid(), v_vie, v_fen, v_inv, v_ip,
                jsonb_build_object('avant', jsonb_build_object('vie_annonce_jours', v_vie), 'apres', jsonb_build_object('vie_annonce_jours', v_vie), 'retroactivite', null));
      if not exists (select 1 from public.grand_livre where id = v_id and type_action = 'reglage_modifie' and sujet_type = 'duree_reglages') then
        raise exception 'postcondition NON TENUE : regler_durees_place ne journalise plus par l ecrivain unique';
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  raise notice 'postcondition tenue : reglage_modifie a un ecrivain unique, sept RPC metier y passent';
end
$post$;
