-- ════════════════════════════════════════════════════════════════════════════
--  LES DOMAINES D'ADRESSE SE RÈGLENT DANS L'ADMINISTRATION — bloqués et publics,
--  la huitième famille de réglages, avec sa ligne au grand livre (§D.27, décision 6).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. N'ajoute qu'une fonction et trois clés à
--  une liste blanche ; l'écran qui l'appelle arrive avec le déploiement. Rejouable.
--
--  LE MANQUE : les deux listes (`blocked_email_domains`, `public_email_domains`) vivaient
--  en base SANS écran — les régler demandait l'éditeur SQL, sans trace (§E.10). La règle
--  d'inscription les lit (`inscription_refus` : un domaine bloqué refuse la préinscription
--  d'une organisation ; un domaine public ne se réserve pas). Décision de Youssef : les
--  listes vivent en base, RÉGLABLES DANS L'ADMINISTRATION, aucune valeur dans le code.
--
--  L'ÉCRIVAIN UNIQUE : `regler_domaine_adresse(pièce, acteur, écosystème, liste, domaine,
--  actif, raison)`. AD002 : l'acteur est un administrateur ACTIF (la sécurité en base).
--  Ajouter un domaine l'active ; le désactiver le garde (sa raison, son auteur) — on ne
--  supprime pas une décision, on la retire. Issues nommées, rien d'écrit :
--  `liste_inconnue`, `domaine_invalide`, `dans_l_autre_liste` (un domaine ne peut être à
--  la fois bloqué et public — l'un refuse, l'autre accueille), `domaine_inconnu` (désactiver
--  ce qui n'existe pas), `inchange`. Sinon : la ligne `reglage_modifie` (sujet : la ligne de
--  la liste ; `liste` ; `avant.actif` / `apres.actif`), identifiants seulement — le domaine
--  se lit sur la ligne, pas dans le journal. Deux branches écrites, pas de SQL dynamique.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.regler_domaine_adresse(
  p_piece         uuid,
  p_acteur_id     uuid,
  p_ecosysteme_id uuid,
  p_liste         text,
  p_domaine       text,
  p_actif         boolean,
  p_raison        text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_domaine text := lower(btrim(coalesce(p_domaine, '')));
  v_raison  text := nullif(btrim(coalesce(p_raison, '')), '');
  v_id      uuid;
  v_actif   boolean;
  v_avant   jsonb;
  v_n       integer;
begin
  if not exists (select 1 from public.users a where a.id = p_acteur_id and a.user_type = 'admin' and a.status = 'active') then
    raise exception 'regler_domaine_adresse : % n est pas un administrateur actif', p_acteur_id using errcode = 'AD002';
  end if;
  if p_liste is null or p_liste not in ('bloques', 'publics') then
    return jsonb_build_object('issue', 'liste_inconnue');
  end if;
  if v_domaine !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' or length(v_domaine) > 253 then
    return jsonb_build_object('issue', 'domaine_invalide');
  end if;
  -- Un domaine n'est pas à la fois refusé et accueilli.
  if p_actif and (
       (p_liste = 'bloques' and exists (select 1 from public.public_email_domains p where lower(p.email_domain) = v_domaine and p.active))
    or (p_liste = 'publics' and exists (select 1 from public.blocked_email_domains b where lower(b.email_domain) = v_domaine and b.active))) then
    return jsonb_build_object('issue', 'dans_l_autre_liste');
  end if;

  if p_liste = 'bloques' then
    select b.id, b.active into v_id, v_actif from public.blocked_email_domains b where lower(b.email_domain) = v_domaine for update;
    if not found then
      if not p_actif then
        return jsonb_build_object('issue', 'domaine_inconnu');
      end if;
      insert into public.blocked_email_domains (email_domain, reason, added_by, active)
      values (v_domaine, v_raison, p_acteur_id, true)
      returning id into v_id;
      v_avant := '{}'::jsonb;
    else
      if v_actif = p_actif then
        return jsonb_build_object('issue', 'inchange', 'id', v_id);
      end if;
      update public.blocked_email_domains b
         set active = p_actif, reason = coalesce(v_raison, b.reason), updated_at = now()
       where b.id = v_id;
      get diagnostics v_n = row_count;
      perform public.exiger_ecriture(v_n, 'regler_domaine_adresse : blocked_email_domains');
      v_avant := jsonb_build_object('actif', v_actif);
    end if;
    perform public.journaliser_reglage(
      p_piece, p_acteur_id, p_ecosysteme_id, 'blocked_email_domains', v_id,
      v_avant, jsonb_build_object('actif', p_actif), jsonb_build_object('liste', p_liste));
  else
    select p.id, p.active into v_id, v_actif from public.public_email_domains p where lower(p.email_domain) = v_domaine for update;
    if not found then
      if not p_actif then
        return jsonb_build_object('issue', 'domaine_inconnu');
      end if;
      insert into public.public_email_domains (email_domain, reason, added_by, active)
      values (v_domaine, v_raison, p_acteur_id, true)
      returning id into v_id;
      v_avant := '{}'::jsonb;
    else
      if v_actif = p_actif then
        return jsonb_build_object('issue', 'inchange', 'id', v_id);
      end if;
      update public.public_email_domains p
         set active = p_actif, reason = coalesce(v_raison, p.reason), updated_at = now()
       where p.id = v_id;
      get diagnostics v_n = row_count;
      perform public.exiger_ecriture(v_n, 'regler_domaine_adresse : public_email_domains');
      v_avant := jsonb_build_object('actif', v_actif);
    end if;
    perform public.journaliser_reglage(
      p_piece, p_acteur_id, p_ecosysteme_id, 'public_email_domains', v_id,
      v_avant, jsonb_build_object('actif', p_actif), jsonb_build_object('liste', p_liste));
  end if;
  return jsonb_build_object('issue', 'regle', 'id', v_id);
end;
$fn$;

revoke all on function public.regler_domaine_adresse(uuid, uuid, uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.regler_domaine_adresse(uuid, uuid, uuid, text, text, boolean, text) to service_role;


-- ── LA LISTE BLANCHE DE reglage_modifie — reprise EN ENTIER (sa dernière définition), plus la huitième famille ──
update public.grand_livre_actions
   set cles_detail = array[
    'avant',
    'apres',
    'avant.vie_annonce_jours',
    'avant.fenetre_echange_jours',
    'avant.invitation_jours',
    'avant.conservation_ip_mois',
    'apres.vie_annonce_jours',
    'apres.fenetre_echange_jours',
    'apres.invitation_jours',
    'apres.conservation_ip_mois',
    'retroactivite',
    'retroactivite.basculent',
    'retroactivite.dont_devoilees',
    'retroactivite.confirmee',
    'model',
    'avant.usd_par_1m_entree',
    'avant.usd_par_1m_sortie',
    'avant.usd_par_unite',
    'avant.usd_par_recherche',
    'avant.usd_par_recherche_web',
    'apres.usd_par_1m_entree',
    'apres.usd_par_1m_sortie',
    'apres.usd_par_unite',
    'apres.usd_par_recherche',
    'apres.usd_par_recherche_web',
    'champ',
    'avant.claude',
    'avant.rerank',
    'apres.claude',
    'apres.rerank',
    'avant.organization',
    'avant.profile',
    'apres.organization',
    'apres.profile',
    'quota',
    'avant.max_per_window',
    'avant.window_hours',
    'apres.max_per_window',
    'apres.window_hours',
    'avant.feed_threshold',
    'avant.notify_threshold',
    'avant.notify_enabled',
    'avant.rerank_model',
    'avant.rerank_batch_size',
    'apres.feed_threshold',
    'apres.notify_threshold',
    'apres.notify_enabled',
    'apres.rerank_model',
    'apres.rerank_batch_size',
    'note_de',
    'avant.note',
    'avant.drapeaux',
    'avant.drapeaux[]',
    'apres.note',
    'apres.drapeaux',
    'apres.drapeaux[]',
    'avant.name',
    'avant.slug',
    'avant.target_role',
    'avant.price_monthly',
    'avant.price_yearly',
    'avant.currency',
    'avant.active',
    'avant.is_free',
    'avant.is_default',
    'avant.scope',
    'apres.name',
    'apres.slug',
    'apres.target_role',
    'apres.price_monthly',
    'apres.price_yearly',
    'apres.currency',
    'apres.active',
    'apres.is_free',
    'apres.is_default',
    'apres.scope',
    'features',
    'features[].feature_code',
    'features[].value',
    'features[].reset_period',
    'features[].avant',
    'package_fields',
    'package_fields[]',
    'default_requested',
    'default_applied',
    'default_refused_code',
    'target_role',
    'package_id',
    'avant.default_ids',
    'avant.default_ids[]',
    'apres.default_ids',
    'apres.default_ids[]',
    'avant.package_id',
    'avant.package_started_at',
    'avant.package_valid_until',
    'apres.package_id',
    'apres.package_started_at',
    'apres.package_valid_until',
    'count',
    'skipped_subscribed',
    'mode',
    'synchronisees',
    'synchronisees[]',
    'refusees',
    'refusees[]',
    'en_echec',
    'en_echec[]',
    'cause',
    'famille',
    'avant.conservation_mois',
    'apres.conservation_mois',
    'avant.plancher_mois',
    'apres.plancher_mois',
    'liste',
    'avant.actif',
    'apres.actif'
  ]::text[]
 where code = 'reglage_modifie';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_cles text[];
begin
  if to_regprocedure('public.regler_domaine_adresse(uuid, uuid, uuid, text, text, boolean, text)') is null then
    raise exception 'postcondition NON TENUE : regler_domaine_adresse absente';
  end if;
  if has_function_privilege('authenticated', 'public.regler_domaine_adresse(uuid, uuid, uuid, text, text, boolean, text)', 'execute')
     or has_function_privilege('anon', 'public.regler_domaine_adresse(uuid, uuid, uuid, text, text, boolean, text)', 'execute') then
    raise exception 'postcondition NON TENUE : regler_domaine_adresse executable depuis le navigateur';
  end if;
  select a.cles_detail into v_cles from public.grand_livre_actions a where a.code = 'reglage_modifie';
  if v_cles is null or not (v_cles @> array['liste', 'avant.actif', 'apres.actif', 'famille', 'avant.conservation_mois']::text[])
     or cardinality(v_cles) <> 116 then
    raise exception 'postcondition NON TENUE : liste blanche de reglage_modifie (% cles)', cardinality(v_cles);
  end if;
  raise notice 'postcondition tenue : regler_domaine_adresse presente et fermee au navigateur, reglage_modifie porte la huitieme famille (116 cles) ; ajouter, retirer, les refus nommes et AD002 sont prouves par tests/database/grand_livre/domaines_adresse.test.sql';
end
$post$;
