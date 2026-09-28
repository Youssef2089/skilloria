-- ════════════════════════════════════════════════════════════════════════════
--  LE NETTOYAGE DU GRAND LIVRE — MANUEL, ANNONCÉ, CONFIRMÉ, SOUS UN PLANCHER
--  LÉGAL, ET LE SEUL CHEMIN DE SUPPRESSION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — l'écran /admin/journal et ses routes
--  appellent ces fonctions dès ce commit. Ajoute : une table de réglage, trois
--  fonctions ; élargit deux listes blanches. Rejouable.
--
--  LE MANDAT (phase B, 2.7) : un batch de nettoyage MANUEL ; une durée de
--  conservation RÉGLABLE depuis l'administration (son changement s'écrit
--  `reglage_modifie`) ; un PLANCHER LÉGAL pour l'argent et les comptes ; une
--  ANNONCE avant (combien de lignes, jusqu'à quelle date) ; une CONFIRMATION ; sa
--  propre ligne (`journal_nettoye`) ; le SEUL chemin de suppression reconnu, de
--  l'intérieur de sa fonction.
--
--  ┌─ LES PLANCHERS LÉGAUX SONT LA DÉCISION DE YOUSSEF ─────────────────────┐
--  │ Ils naissent NULS : « à arbitrer ». Une famille sans plancher arbitré  │
--  │ ne se RÈGLE pas (la conservation exige un plancher, contrainte) et ne  │
--  │ se NETTOIE donc pas. Tant que la décision n'est pas écrite, le         │
--  │ nettoyage n'efface RIEN — l'annonce le dit, famille par famille. Les   │
--  │ planchers ne sont PAS un réglage d'écran : ce sont des obligations,    │
--  │ posées par migration (0 = aucun plancher légal, décidé).               │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  LA FAMILLE `journal` N'EST JAMAIS NETTOYÉE : ses lignes sont les traces des
--  nettoyages eux-mêmes. Une contrainte l'interdit, pas une discipline (§E.31).
--
--  LE SEUL CHEMIN DE SUPPRESSION. Le verrou du socle (`grand_livre_ajout_seul`,
--  GL001) ne laisse passer un DELETE que sous le réglage de transaction
--  `grand_livre.nettoyage = 'autorise'` ; aucun rôle applicatif n'a le droit de
--  DELETE (socle). `nettoyer_journal()` — SECURITY DEFINER — est la seule fonction
--  qui pose ce réglage, le RETIRE aussitôt après ses suppressions, et écrit sa ligne.
--
--  LA CONFIRMATION EST UNE COMPARAISON, PAS UN BOUTON. L'administrateur voit
--  l'annonce (lignes par famille, date limite) ; la confirmation RENVOIE le total
--  annoncé, la fonction RECALCULE et REFUSE s'il a changé (`annonce_perimee`) :
--  on n'efface jamais autre chose que ce qui a été montré.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.grand_livre_conservation (
  famille           text primary key
                      check (famille in ('annonce', 'profil', 'recherche', 'candidature', 'devoilement', 'messagerie', 'compte', 'organisation', 'commerce', 'administration', 'rgpd', 'journal', 'refus')),
  -- La durée de conservation choisie par l'administrateur, en mois. NULL = on conserve tout.
  conservation_mois integer check (conservation_mois is null or conservation_mois between 1 and 1200),
  -- Le plancher LÉGAL, en mois : NULL = à arbitrer (bloque), 0 = aucun plancher légal (décidé).
  plancher_mois     integer check (plancher_mois is null or plancher_mois between 0 and 1200),
  updated_at        timestamptz not null default now(),
  constraint grand_livre_conservation_au_dessus_du_plancher
    check (conservation_mois is null or (plancher_mois is not null and conservation_mois >= plancher_mois)),
  constraint grand_livre_conservation_journal_conserve
    check (famille <> 'journal' or conservation_mois is null)
);

alter table public.grand_livre_conservation enable row level security;
revoke all on table public.grand_livre_conservation from public, anon, authenticated;
grant select on table public.grand_livre_conservation to service_role;

-- Une ligne par famille, planchers à arbitrer — jamais écrasée (§D.7 : on ne ré-impose pas un réglage).
insert into public.grand_livre_conservation (famille)
select f from unnest(array['annonce', 'profil', 'recherche', 'candidature', 'devoilement', 'messagerie', 'compte', 'organisation', 'commerce', 'administration', 'rgpd', 'journal', 'refus']) f
on conflict (famille) do nothing;


-- ── LES DEUX LISTES BLANCHES ─────────────────────────────────────────────────
--  `journal_nettoye` : le total, et par famille la date limite et le compte.
--  `reglage_modifie` : reprise EN ENTIER (sa dernière définition), plus la
--  septième famille de réglages — la conservation du journal.
update public.grand_livre_actions
   set cles_detail = array['lignes', 'familles', 'familles[]', 'familles[].famille', 'familles[].jusqu_au', 'familles[].lignes']::text[]
 where code = 'journal_nettoye';

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
    'apres.conservation_mois'
  ]::text[]
 where code = 'reglage_modifie';


-- ── RÉGLER LA CONSERVATION D'UNE FAMILLE ─────────────────────────────────────
--  Issues : 'regle' (et la ligne reglage_modifie), 'inchange', 'famille_inconnue',
--  'journal_conserve', 'plancher_a_arbitrer', 'sous_le_plancher'. Seule 'regle'
--  écrit ; les refus sont rendus à l'écran avec leur code, jamais tus.
create or replace function public.regler_conservation_journal(
  p_piece     uuid,
  p_acteur_id uuid,
  p_famille   text,
  p_mois      integer
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_c record;
  v_n integer;
begin
  if not exists (select 1 from public.users a where a.id = p_acteur_id and a.user_type = 'admin' and a.status = 'active') then
    raise exception 'regler_conservation_journal : % n est pas un administrateur actif', p_acteur_id using errcode = 'AD002';
  end if;
  select c.* into v_c from public.grand_livre_conservation c where c.famille = p_famille for update;
  if not found then
    return jsonb_build_object('issue', 'famille_inconnue');
  end if;
  if p_famille = 'journal' then
    return jsonb_build_object('issue', 'journal_conserve');
  end if;
  if p_mois is not null and v_c.plancher_mois is null then
    return jsonb_build_object('issue', 'plancher_a_arbitrer');
  end if;
  if p_mois is not null and p_mois < v_c.plancher_mois then
    return jsonb_build_object('issue', 'sous_le_plancher', 'plancher_mois', v_c.plancher_mois);
  end if;
  if v_c.conservation_mois is not distinct from p_mois then
    return jsonb_build_object('issue', 'inchange');
  end if;
  update public.grand_livre_conservation c
     set conservation_mois = p_mois, updated_at = now()
   where c.famille = p_famille;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'regler_conservation_journal : grand_livre_conservation');
  perform public.journaliser_reglage(
    p_piece, p_acteur_id, null::uuid,
    'grand_livre_conservation', public.identifiant_derive('reglage', 'grand_livre_conservation:' || p_famille),
    jsonb_build_object('conservation_mois', v_c.conservation_mois),
    jsonb_build_object('conservation_mois', p_mois),
    jsonb_build_object('famille', p_famille));
  return jsonb_build_object('issue', 'regle');
end;
$fn$;

revoke all on function public.regler_conservation_journal(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.regler_conservation_journal(uuid, uuid, text, integer) to service_role;


-- ── L'ANNONCE : CE QUE LE NETTOYAGE EFFACERAIT, FAMILLE PAR FAMILLE ──────────
--  Par famille : la conservation, le plancher, la date limite (début du jour,
--  moins la conservation) et le nombre de lignes plus anciennes — ou la RAISON
--  pour laquelle elle ne se nettoie pas. Lecture seule. Même calcul que le
--  nettoyage (une seule fonction interne), pour que l'annonce et l'acte ne
--  divergent jamais.
create or replace function public.nettoyage_journal_calcul()
  returns table (famille text, conservation_mois integer, plancher_mois integer, jusqu_au timestamptz, lignes bigint, raison text)
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select c.famille, c.conservation_mois, c.plancher_mois,
         case when c.conservation_mois is not null and c.plancher_mois is not null and c.famille <> 'journal'
              then date_trunc('day', now()) - make_interval(months => c.conservation_mois) end as jusqu_au,
         case when c.conservation_mois is not null and c.plancher_mois is not null and c.famille <> 'journal'
              then (select count(*) from public.grand_livre g
                      join public.grand_livre_actions a on a.code = g.type_action
                     where a.famille = c.famille
                       and g.horodatage < date_trunc('day', now()) - make_interval(months => c.conservation_mois))
              else 0 end as lignes,
         case when c.famille = 'journal' then 'journal_conserve'
              when c.plancher_mois is null then 'plancher_a_arbitrer'
              when c.conservation_mois is null then 'conservation_illimitee' end as raison
    from public.grand_livre_conservation c
   order by c.famille
$fn$;

revoke all on function public.nettoyage_journal_calcul() from public, anon, authenticated;

create or replace function public.annoncer_nettoyage_journal(p_admin_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $fn$
begin
  if not exists (select 1 from public.users a where a.id = p_admin_id and a.user_type = 'admin' and a.status = 'active') then
    raise exception 'annoncer_nettoyage_journal : % n est pas un administrateur actif', p_admin_id using errcode = 'AD002';
  end if;
  return (select jsonb_build_object(
            'familles', coalesce(jsonb_agg(jsonb_build_object(
                          'famille', x.famille, 'conservation_mois', x.conservation_mois, 'plancher_mois', x.plancher_mois,
                          'jusqu_au', x.jusqu_au, 'lignes', x.lignes, 'raison', x.raison) order by x.famille), '[]'::jsonb),
            'total', coalesce(sum(x.lignes), 0),
            'calcule_le', now())
            from public.nettoyage_journal_calcul() x);
end;
$fn$;

revoke all on function public.annoncer_nettoyage_journal(uuid) from public, anon, authenticated;
grant execute on function public.annoncer_nettoyage_journal(uuid) to service_role;


-- ── LE NETTOYAGE — LE SEUL CHEMIN DE SUPPRESSION ─────────────────────────────
--  Issues : 'nettoye' (et sa ligne journal_nettoye), 'rien_a_nettoyer',
--  'annonce_perimee' (le total recalculé n'est plus celui qui a été montré — rien
--  n'est effacé, l'écran réaffiche l'annonce). Les suppressions et la ligne :
--  une transaction ; le compte effacé est EXIGÉ égal à l'annonce (EC001).
create or replace function public.nettoyer_journal(
  p_piece         uuid,
  p_acteur_id     uuid,
  p_total_annonce bigint
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_f        record;
  v_total    bigint := 0;
  v_effacees bigint := 0;
  v_n        bigint;
  v_detail   jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.users a where a.id = p_acteur_id and a.user_type = 'admin' and a.status = 'active') then
    raise exception 'nettoyer_journal : % n est pas un administrateur actif', p_acteur_id using errcode = 'AD002';
  end if;
  -- Les réglages ne bougent pas pendant le nettoyage.
  perform 1 from public.grand_livre_conservation for update;
  select coalesce(sum(x.lignes), 0) into v_total from public.nettoyage_journal_calcul() x;
  if v_total is distinct from p_total_annonce then
    return jsonb_build_object('issue', 'annonce_perimee', 'total', v_total);
  end if;
  if v_total = 0 then
    return jsonb_build_object('issue', 'rien_a_nettoyer');
  end if;

  -- LE RÉGLAGE DE TRANSACTION : posé ici, retiré ici — nulle part ailleurs (§D.26).
  perform set_config('grand_livre.nettoyage', 'autorise', true);
  for v_f in select * from public.nettoyage_journal_calcul() x where x.lignes > 0 loop
    delete from public.grand_livre g
     using public.grand_livre_actions a
     where a.code = g.type_action
       and a.famille = v_f.famille
       and g.horodatage < v_f.jusqu_au;
    get diagnostics v_n = row_count;
    v_effacees := v_effacees + v_n;
    v_detail := v_detail || jsonb_build_array(jsonb_build_object('famille', v_f.famille, 'jusqu_au', v_f.jusqu_au, 'lignes', v_n));
  end loop;
  perform set_config('grand_livre.nettoyage', '', true);

  -- On a effacé EXACTEMENT ce qui a été annoncé, ou rien (la transaction est annulée).
  perform public.exiger_ecriture(v_effacees, 'nettoyer_journal : grand_livre', p_total_annonce);
  perform public.journaliser(
    p_piece, 'journal_nettoye', 'reussi', 'administrateur',
    p_acteur_id, 'admin', null::uuid, null::text, null::uuid,
    jsonb_build_object('lignes', v_effacees, 'familles', v_detail),
    null::uuid, null::numeric, null::text);
  return jsonb_build_object('issue', 'nettoye', 'lignes', v_effacees, 'familles', v_detail);
end;
$fn$;

revoke all on function public.nettoyer_journal(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.nettoyer_journal(uuid, uuid, bigint) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_f text;
begin
  if (select count(*) from public.grand_livre_conservation) <> 13 then
    raise exception 'postcondition NON TENUE : grand_livre_conservation ne porte pas une ligne par famille';
  end if;
  foreach v_f in array array[
    'public.regler_conservation_journal(uuid, uuid, text, integer)',
    'public.annoncer_nettoyage_journal(uuid)',
    'public.nettoyer_journal(uuid, uuid, bigint)'] loop
    if to_regprocedure(v_f) is null then
      raise exception 'postcondition NON TENUE : % absente', v_f;
    end if;
    if has_function_privilege('authenticated', v_f, 'execute') or has_function_privilege('anon', v_f, 'execute') then
      raise exception 'postcondition NON TENUE : % executable depuis le navigateur', v_f;
    end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosrc ~ 'set_config\(''grand_livre\.nettoyage'', ''autorise''') <> 1 then
    raise exception 'postcondition NON TENUE : une seule fonction doit poser le reglage de nettoyage';
  end if;
  if (select a.cles_detail from public.grand_livre_actions a where a.code = 'journal_nettoye')
       is distinct from array['lignes', 'familles', 'familles[]', 'familles[].famille', 'familles[].jusqu_au', 'familles[].lignes']::text[] then
    raise exception 'postcondition NON TENUE : liste blanche de journal_nettoye';
  end if;
  if not (select a.cles_detail @> array['famille', 'avant.conservation_mois', 'apres.conservation_mois']::text[]
            from public.grand_livre_actions a where a.code = 'reglage_modifie') then
    raise exception 'postcondition NON TENUE : reglage_modifie ne porte pas la conservation du journal';
  end if;
  raise notice 'postcondition tenue : grand_livre_conservation (une ligne par famille, planchers a arbitrer), trois fonctions fermees au navigateur, un seul poseur du reglage de nettoyage, listes blanches ; le reglage, l annonce, la confirmation perimee et le nettoyage sont prouves par tests/database/grand_livre/nettoyage.test.sql';
end
$post$;
