-- ════════════════════════════════════════════════════════════════════════════
--  LE GRAND LIVRE — LE SOCLE. Une table en AJOUT SEUL, une liste FERMÉE
--  d'actions, une FONCTION UNIQUE d'écriture, une PIÈCE par geste.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. La route /api/admin/durees
--  appelle `regler_durees_place()` dès ce commit ; déployée avant la fonction,
--  elle répondrait 500. N'efface rien, ne modifie aucune ligne existante ;
--  remplace `effacer_adresses_ip()` par une version qui journalise. Rejouable.
--
--  ┌─ CE QU'ON CONSTRUIT (§D.26) ────────────────────────────────────────────┐
--  │ Toute action métier laisse une écriture. Chaque écriture porte sa PIÈCE │
--  │ — le numéro qui relie toutes les écritures d'un même geste — et on      │
--  │ remonte la chaîne depuis n'importe quel bout. Le grand livre porte la    │
--  │ SYNTHÈSE ; les sous-journaux (audit_logs, ai_spend_events, stripe_events,│
--  │ cron_run_log, notifications) gardent le DÉTAIL et recevront une colonne  │
--  │ piece (étape 3). On ne recopie rien : on relie.                          │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  LA GARANTIE — UNE FONCTION UNIQUE, JAMAIS UN TRIGGER D'ÉCRITURE.
--    Le client Supabase n'ouvre aucune transaction multi-requêtes : chaque
--    appel PostgREST EST une transaction, et `set local` meurt avec elle. Un
--    trigger sur une table métier ne peut donc pas connaître la pièce du geste
--    — elle vit dans une autre requête. En revanche `set local` et la pièce
--    vivent très bien À L'INTÉRIEUR d'une RPC : une fonction SECURITY DEFINER
--    écrit la ligne métier ET la ligne de journal en un seul appel, et l'un
--    sans l'autre est impossible. `regler_durees_place()` en est le premier
--    exemple ; `journaliser()` seule sert aux actions qui n'insèrent rien (les
--    REFUS) et aux faits sans table. Le trigger ne sert qu'au VERROU.
--
--  LE VERROU — REVOKE ET TRIGGER, ET LE SEUL CHEMIN SE RECONNAÎT DE L'INTÉRIEUR.
--    Aucun rôle applicatif ne peut écrire, modifier ni supprimer directement :
--    seules les fonctions SECURITY DEFINER (propriété de postgres) insèrent.
--    Un UPDATE ou un DELETE lève (SQLSTATE GL001). Le SEUL chemin de suppression
--    sera le nettoyage de l'étape 4 — une RPC qui posera
--    `set local grand_livre.nettoyage = 'autorise'` avant de supprimer, et
--    c'est ce réglage local, mort à la fin de sa transaction, que le trigger
--    reconnaît. Modèle : `transactions_block_delete` (stripe_fondations).
--    Une erreur ne se corrige pas : elle se CONTREPASSE par une nouvelle ligne
--    qui référence la pièce d'origine (`piece_origine`). Un rejeu, de même.
--
--  LA PIÈCE EST GÉNÉRABLE DES DEUX CÔTÉS.
--    Code : `nouvellePiece()` (lib/journal/piece.ts), une par geste, créée à
--    l'entrée de la route, transmise en PARAMÈTRE — y compris dans la
--    fermeture d'un `after()`. SQL : `gen_random_uuid()` — `effacer_adresses_ip()`
--    génère la sienne ici même ; les tâches qui appellent une route la
--    transmettront dans le corps HTTP (étape 3).
--
--  LE PARTITIONNEMENT ATTEND, ET IL NE CHANGERA PAS LE MODÈLE.
--    127 lignes d'audit en cinq mois : partitionner le premier jour serait une
--    complexité sans mesure. La date est EN TÊTE de chaque index de filtre dès
--    aujourd'hui — un partitionnement par mois (range sur `horodatage`)
--    gardera les index locaux et élaguera par période sans toucher ni aux
--    colonnes, ni à `journaliser()`, ni à l'écran. Deux index n'ont pas la date
--    en tête, et c'est dit : la pièce et le sujet se cherchent SANS période.
--
--  RGPD : identifiants seulement. `journaliser()` passe chaque détail par
--  `audit_logs_detail_sans_pii()` — la même liste que le journal d'audit,
--  jamais recopiée — AVANT d'insérer. Une clé personnelle n'entre pas.
--
--  MESURÉ AVANT (lecture seule, 24/09/2026) : onze tables journalisent, aucune
--  ne porte de pièce ; le moteur n'a aucun identifiant de run ; 127 lignes
--  d'audit. Le grand livre ne relie pas l'histoire du moteur : il la CRÉE —
--  une ligne par ÉTAPE de run (étape 2).
-- ─────────────────────────────────────────────────────────────────────────────


-- ── ① LE DÉRIVEUR D'IDENTIFIANT, EN SQL — le même que lib/admin/identifiant-derive.ts ──
--  Un objet sans UUID (une tâche, une famille de réglages) reçoit un identifiant
--  DÉRIVÉ : md5('espace:clé') lu comme un uuid. Le TypeScript fait exactement
--  cela ; la postcondition ci-dessous prouve l'égalité sur un témoin calculé
--  par le TypeScript, et le contrôle recalcule ce témoin à chaque passage.
create or replace function public.identifiant_derive(p_espace text, p_cle text)
returns uuid
language sql
immutable
as $$
  select md5(p_espace || ':' || p_cle)::uuid
$$;


-- ── ② LA LISTE FERMÉE DES ACTIONS ───────────────────────────────────────────
--  Un type inconnu ne s'écrit pas (clé étrangère). On l'étend PAR MIGRATION,
--  jamais à la main : `on conflict do update` est voulu ici — ce n'est pas une
--  valeur qu'un administrateur ajuste (§D.7), c'est un référentiel, et une
--  correction de famille ou de libellé doit se propager.
create table if not exists public.grand_livre_actions (
  code          text primary key,
  famille       text not null,
  -- Un refus n'insère rien ; il faut le NOMMER pour qu'il existe — et une
  -- ligne « refus_… » au statut « reussi » serait un contresens : le statut
  -- est IMPOSÉ par le type, et journaliser() le tient.
  statut_impose text,
  -- Clé i18n (`journal.actions.<code>`) — l'écran de l'étape 4 la traduit.
  libelle_key   text not null,
  constraint grand_livre_actions_code_forme
    check (code ~ '^[a-z][a-z0-9_]{2,60}$'),
  constraint grand_livre_actions_famille_check
    check (famille in ('annonce','profil','recherche','candidature','devoilement','messagerie',
                       'compte','organisation','commerce','administration','rgpd','journal','refus')),
  constraint grand_livre_actions_statut_impose_check
    check (statut_impose is null or statut_impose in ('reussi','echoue','refuse')),
  constraint grand_livre_actions_refus_impose
    check (famille <> 'refus' or statut_impose = 'refuse')
);
alter table public.grand_livre_actions enable row level security;

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  -- annonce
  ('annonce_publiee',            'annonce',        null,     'journal.actions.annonce_publiee'),
  ('annonce_modifiee',           'annonce',        null,     'journal.actions.annonce_modifiee'),
  ('annonce_depubliee',          'annonce',        null,     'journal.actions.annonce_depubliee'),
  ('annonce_expiree',            'annonce',        null,     'journal.actions.annonce_expiree'),
  ('sous_traitance_publiee',     'annonce',        null,     'journal.actions.sous_traitance_publiee'),
  -- profil
  ('cv_televerse',               'profil',         null,     'journal.actions.cv_televerse'),
  ('profil_publie',              'profil',         null,     'journal.actions.profil_publie'),
  ('profil_modifie',             'profil',         null,     'journal.actions.profil_modifie'),
  ('disponibilite_basculee',     'profil',         null,     'journal.actions.disponibilite_basculee'),
  -- recherche — une ligne par ÉTAPE de run
  ('recherche_lancee',           'recherche',      null,     'journal.actions.recherche_lancee'),
  ('recherche_filtree',          'recherche',      null,     'journal.actions.recherche_filtree'),
  ('recherche_classee',          'recherche',      null,     'journal.actions.recherche_classee'),
  ('recherche_correspondances',  'recherche',      null,     'journal.actions.recherche_correspondances'),
  ('recherche_notifiee',         'recherche',      null,     'journal.actions.recherche_notifiee'),
  ('recherche_terminee',         'recherche',      'reussi', 'journal.actions.recherche_terminee'),
  ('recherche_echouee',          'recherche',      'echoue', 'journal.actions.recherche_echouee'),
  ('recherche_abandonnee',       'recherche',      'echoue', 'journal.actions.recherche_abandonnee'),
  -- candidature
  ('candidature_deposee',        'candidature',    null,     'journal.actions.candidature_deposee'),
  ('candidature_declinee',       'candidature',    null,     'journal.actions.candidature_declinee'),
  ('candidature_retenue',        'candidature',    null,     'journal.actions.candidature_retenue'),
  ('sous_traitance_candidature', 'candidature',    null,     'journal.actions.sous_traitance_candidature'),
  -- dévoilement
  ('devoilement_ouvert',         'devoilement',    null,     'journal.actions.devoilement_ouvert'),
  ('devoilement_ferme',          'devoilement',    null,     'journal.actions.devoilement_ferme'),
  -- messagerie
  ('message_envoye',             'messagerie',     null,     'journal.actions.message_envoye'),
  -- compte
  ('compte_valide',              'compte',         null,     'journal.actions.compte_valide'),
  ('compte_refuse',              'compte',         null,     'journal.actions.compte_refuse'),
  ('compte_suspendu',            'compte',         null,     'journal.actions.compte_suspendu'),
  ('compte_reactive',            'compte',         null,     'journal.actions.compte_reactive'),
  ('session_revoquee',           'compte',         null,     'journal.actions.session_revoquee'),
  ('suppression_programmee',     'compte',         null,     'journal.actions.suppression_programmee'),
  ('suppression_annulee',        'compte',         null,     'journal.actions.suppression_annulee'),
  ('email_change',               'compte',         null,     'journal.actions.email_change'),
  ('mot_de_passe_change',        'compte',         null,     'journal.actions.mot_de_passe_change'),
  ('telephone_verifie',          'compte',         null,     'journal.actions.telephone_verifie'),
  -- organisation
  ('membre_invite',              'organisation',   null,     'journal.actions.membre_invite'),
  ('invitation_renvoyee',        'organisation',   null,     'journal.actions.invitation_renvoyee'),
  ('invitation_acceptee',        'organisation',   null,     'journal.actions.invitation_acceptee'),
  ('invitation_revoquee',        'organisation',   null,     'journal.actions.invitation_revoquee'),
  ('membre_retire',              'organisation',   null,     'journal.actions.membre_retire'),
  ('membre_parti',               'organisation',   null,     'journal.actions.membre_parti'),
  ('role_membre_change',         'organisation',   null,     'journal.actions.role_membre_change'),
  -- commerce
  ('paiement_recu',              'commerce',       null,     'journal.actions.paiement_recu'),
  ('plafond_atteint',            'commerce',       null,     'journal.actions.plafond_atteint'),
  -- administration
  ('reglage_modifie',            'administration', null,     'journal.actions.reglage_modifie'),
  -- rgpd — les trois purges SÉPARÉES : elles ne se relisent pas de la même façon
  ('inactivite_avertie',         'rgpd',           null,     'journal.actions.inactivite_avertie'),
  ('compte_purge_inactivite',    'rgpd',           null,     'journal.actions.compte_purge_inactivite'),
  ('compte_purge_demande',       'rgpd',           null,     'journal.actions.compte_purge_demande'),
  ('compte_purge_admin',         'rgpd',           null,     'journal.actions.compte_purge_admin'),
  ('ip_effacees',                'rgpd',           null,     'journal.actions.ip_effacees'),
  -- journal — méta, à part : visible même quand on filtre l'administration
  ('journal_nettoye',            'journal',        null,     'journal.actions.journal_nettoye'),
  -- refus — nommés EXPLICITEMENT, statut imposé
  ('refus_plafond_atteint',      'refus',          'refuse', 'journal.actions.refus_plafond_atteint'),
  ('refus_expert_inapte',        'refus',          'refuse', 'journal.actions.refus_expert_inapte'),
  ('refus_garde_eligibilite',    'refus',          'refuse', 'journal.actions.refus_garde_eligibilite'),
  ('refus_quota_cv',             'refus',          'refuse', 'journal.actions.refus_quota_cv'),
  ('refus_depot_sans_jugement',  'refus',          'refuse', 'journal.actions.refus_depot_sans_jugement')
on conflict (code) do update
  set famille = excluded.famille,
      statut_impose = excluded.statut_impose,
      libelle_key = excluded.libelle_key;


-- ── ③ LE GRAND LIVRE ────────────────────────────────────────────────────────
create table if not exists public.grand_livre (
  id             bigint generated always as identity primary key,
  horodatage     timestamptz not null default now(),
  -- La pièce : un uuid par geste. `piece_origine` relie une contrepassation
  -- ou un rejeu à la pièce d'origine — une NOUVELLE pièce, jamais la même.
  piece          uuid not null,
  piece_origine  uuid,
  type_action    text not null references public.grand_livre_actions(code),
  statut         text not null,
  origine        text not null,
  -- L'acteur par IDENTIFIANT et par type (users.user_type) — jamais par nom.
  -- Pas de clé étrangère : la ligne survit à tout ce qui arrive au compte, et
  -- l'écran rejoint le nom à la lecture ou affiche « compte supprimé ».
  acteur_id      uuid,
  acteur_type    text,
  ecosysteme_id  uuid references public.domains(id),
  -- Le sujet : l'objet touché, identifiant + type (une table, ou un espace
  -- dérivé : 'cron_job', 'duree_reglages'…).
  sujet_type     text,
  sujet_id       uuid,
  -- SANS donnée personnelle — journaliser() y veille avant d'insérer.
  detail         jsonb not null default '{}'::jsonb,
  -- Ce que ça a coûté, dans l'unité FACTURÉE par le fournisseur (§D.24).
  cout_usd       numeric(12, 6),
  unite_facturee text,

  constraint grand_livre_statut_check
    check (statut in ('reussi', 'echoue', 'refuse')),
  constraint grand_livre_origine_check
    check (origine in ('utilisateur', 'tache_planifiee', 'administrateur', 'systeme')),
  constraint grand_livre_acteur_type_check
    check (acteur_type is null or acteur_type in ('expert_freelance', 'expert_cdi', 'client', 'cabinet', 'admin')),
  constraint grand_livre_acteur_coherent
    check ((acteur_id is null) = (acteur_type is null)),
  -- Un geste humain a toujours un acteur ; une tâche ou le système, pas forcément.
  constraint grand_livre_acteur_si_humain
    check (origine not in ('utilisateur', 'administrateur') or acteur_id is not null),
  constraint grand_livre_sujet_coherent
    check ((sujet_type is null) = (sujet_id is null)),
  constraint grand_livre_cout_coherent
    check ((cout_usd is null) = (unite_facturee is null)),
  constraint grand_livre_cout_positif
    check (cout_usd is null or cout_usd >= 0),
  constraint grand_livre_detail_objet
    check (jsonb_typeof(detail) = 'object')
);
alter table public.grand_livre enable row level security;

-- LA DATE EN TÊTE de chaque index de filtre : l'écran filtre toujours par
-- période, et un partitionnement par mois gardera ces index locaux.
create index if not exists grand_livre_horodatage_idx      on public.grand_livre (horodatage desc);
create index if not exists grand_livre_date_type_idx       on public.grand_livre (horodatage desc, type_action);
create index if not exists grand_livre_date_acteur_idx     on public.grand_livre (horodatage desc, acteur_id);
create index if not exists grand_livre_date_ecosysteme_idx on public.grand_livre (horodatage desc, ecosysteme_id);
-- Les deux exceptions, nommées : la pièce et le sujet se cherchent SANS période.
create index if not exists grand_livre_piece_idx           on public.grand_livre (piece);
create index if not exists grand_livre_sujet_idx           on public.grand_livre (sujet_id, horodatage desc);

-- LE VERROU (1/2) — LES PRIVILÈGES. Les privilèges par défaut de Supabase
-- donnent tout aux rôles applicatifs sur toute table nouvelle : on les
-- REPREND. Seules les fonctions SECURITY DEFINER (propriété de postgres)
-- écrivent ; service_role garde la LECTURE, pour l'écran de l'étape 4.
revoke all on table public.grand_livre from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.grand_livre from service_role;
grant select on table public.grand_livre to service_role;
revoke all on table public.grand_livre_actions from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.grand_livre_actions from service_role;
grant select on table public.grand_livre_actions to service_role;

-- LE VERROU (2/2) — LE TRIGGER. Un UPDATE ou un DELETE lève, SQLSTATE GL001.
-- Le SEUL chemin de suppression est le nettoyage (étape 4) : sa RPC posera
-- `set local grand_livre.nettoyage = 'autorise'` — un réglage qui meurt avec
-- sa transaction — et c'est de l'intérieur de cette RPC, et de nulle part
-- ailleurs, que le DELETE est reconnu. Jamais l'UPDATE, jamais le TRUNCATE.
create or replace function public.grand_livre_ajout_seul()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('grand_livre.nettoyage', true), '') = 'autorise' then
    return old;
  end if;
  raise exception
    'grand_livre est en AJOUT SEUL : % interdit. Une erreur se contrepasse par une NOUVELLE ligne qui reference la piece d origine (piece_origine) ; seul le nettoyage (etape 4) supprime, de l interieur de sa propre fonction.',
    tg_op
    using errcode = 'GL001';
end;
$$;

drop trigger if exists grand_livre_ajout_seul on public.grand_livre;
create trigger grand_livre_ajout_seul
  before update or delete on public.grand_livre
  for each row execute function public.grand_livre_ajout_seul();

drop trigger if exists grand_livre_pas_de_truncate on public.grand_livre;
create trigger grand_livre_pas_de_truncate
  before truncate on public.grand_livre
  for each statement execute function public.grand_livre_ajout_seul();


-- ── ④ LA FONCTION UNIQUE D'ÉCRITURE ─────────────────────────────────────────
--  Exige la pièce (GL002) et le type (GL002) ; refuse un type hors liste
--  (GL003) et un statut contraire à celui que le type impose (GL003) ; retire
--  du détail toute clé personnelle. C'est la SEULE fonction qui insère dans
--  grand_livre — le contrôle compte les `insert into public.grand_livre` du
--  dépôt et n'en tolère qu'un.
create or replace function public.journaliser(
  p_piece          uuid,
  p_type_action    text,
  p_statut         text,
  p_origine        text,
  p_acteur_id      uuid    default null,
  p_acteur_type    text    default null,
  p_ecosysteme_id  uuid    default null,
  p_sujet_type     text    default null,
  p_sujet_id       uuid    default null,
  p_detail         jsonb   default '{}'::jsonb,
  p_piece_origine  uuid    default null,
  p_cout_usd       numeric default null,
  p_unite_facturee text    default null
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_impose text;
  v_id     bigint;
begin
  if p_piece is null then
    raise exception 'journaliser : la piece est obligatoire — une ecriture sans piece ne se relie a rien'
      using errcode = 'GL002';
  end if;
  if p_type_action is null then
    raise exception 'journaliser : le type d action est obligatoire'
      using errcode = 'GL002';
  end if;

  select statut_impose into v_impose
    from public.grand_livre_actions
   where code = p_type_action;
  if not found then
    raise exception 'journaliser : type d action inconnu « % » — la liste est FERMEE (grand_livre_actions) et s etend par migration', p_type_action
      using errcode = 'GL003';
  end if;
  if v_impose is not null and p_statut is distinct from v_impose then
    raise exception 'journaliser : « % » impose le statut « % », recu « % »', p_type_action, v_impose, p_statut
      using errcode = 'GL003';
  end if;

  insert into public.grand_livre
    (piece, piece_origine, type_action, statut, origine,
     acteur_id, acteur_type, ecosysteme_id, sujet_type, sujet_id,
     detail, cout_usd, unite_facturee)
  values
    (p_piece, p_piece_origine, p_type_action, p_statut, p_origine,
     p_acteur_id, p_acteur_type, p_ecosysteme_id, p_sujet_type, p_sujet_id,
     public.audit_logs_detail_sans_pii(coalesce(p_detail, '{}'::jsonb)),
     p_cout_usd, p_unite_facturee)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.journaliser(uuid, text, text, text, uuid, text, uuid, text, uuid, jsonb, uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.journaliser(uuid, text, text, text, uuid, text, uuid, text, uuid, jsonb, uuid, numeric, text)
  to service_role;


-- ── ⑤ LA PREMIÈRE ACTION RÉELLE : RPC MÉTIER + JOURNAL, EN UN APPEL ────────
--  Le réglage des durées de la place (/admin/durees). La ligne de réglage et
--  la ligne du grand livre sont écrites dans la MÊME transaction : l'une sans
--  l'autre est impossible. Les bornes (1–365 jours, 1–60 mois) sont tenues par
--  les contraintes de duree_reglages ; la route les a déjà expliquées en 400.
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

  return public.journaliser(
    p_piece, 'reglage_modifie', 'reussi', 'administrateur',
    p_acteur_id, 'admin', p_ecosysteme_id,
    'duree_reglages', p_sujet_id,
    p_detail);
end;
$fn$;

revoke all on function public.regler_durees_place(uuid, uuid, uuid, uuid, integer, integer, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.regler_durees_place(uuid, uuid, uuid, uuid, integer, integer, integer, integer, jsonb)
  to service_role;


-- ── ⑥ LA PIÈCE CÔTÉ SQL : la tâche d'effacement des IP journalise ───────────
--  Même corps que `conservation_ip`, plus la pièce (gen_random_uuid()) et une
--  ligne du grand livre sur CHAQUE sortie — succès dans le bloc, échec dans le
--  gestionnaire, après l'annulation du sous-bloc. Le sujet est la tâche, par
--  identifiant dérivé — le même que celui que le code calcule (§①).
create or replace function public.effacer_adresses_ip()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_piece    uuid := gen_random_uuid();
  v_sujet    uuid := public.identifiant_derive('cron_job', 'ip_retention_purge');
  v_log_id   bigint;
  v_mois     integer;
  v_limite   timestamptz;
  v_audit    integer;
  v_sessions integer;
  v_resume   jsonb;
begin
  insert into public.cron_run_log (job_name)
  values ('ip_retention_purge')
  returning id into v_log_id;

  begin
    select conservation_ip_mois into v_mois
      from public.duree_reglages
     where ligne_unique = true;
    if v_mois is null then
      raise exception 'conservation_ip_mois absent de duree_reglages — aucune valeur de repli';
    end if;
    v_limite := public.ip_limite_de_conservation(v_mois);

    update public.audit_logs
       set ip_address = null, user_agent = null
     where created_at < v_limite
       and (ip_address is not null or user_agent is not null);
    get diagnostics v_audit = row_count;

    update public.session_logs
       set ip_address = null, user_agent = null
     where created_at < v_limite
       and (ip_address is not null or user_agent is not null);
    get diagnostics v_sessions = row_count;

    v_resume := jsonb_build_object(
      'piece',        v_piece,
      'mois',         v_mois,
      'limite',       v_limite,
      'audit_logs',   v_audit,
      'session_logs', v_sessions
    );
    perform public.journaliser(
      v_piece, 'ip_effacees', 'reussi', 'tache_planifiee',
      null::uuid, null::text, null::uuid,
      'cron_job', v_sujet,
      v_resume - 'piece');
    perform public.cloturer_run_cron(v_log_id, 200, v_resume, null);
    return v_resume;
  exception when others then
    -- Le sous-bloc est annulé (rien d'effacé à moitié, aucune ligne de journal
    -- du succès) ; la ligne de run survit et reçoit la panne, et le grand
    -- livre aussi — avec la CLASSE de la panne, pas son texte entier.
    perform public.journaliser(
      v_piece, 'ip_effacees', 'echoue', 'tache_planifiee',
      null::uuid, null::text, null::uuid,
      'cron_job', v_sujet,
      jsonb_build_object('cause', left(sqlerrm, 200), 'sqlstate', sqlstate));
    perform public.cloturer_run_cron(v_log_id, 500, null, sqlerrm);
    return jsonb_build_object('erreur', sqlerrm, 'piece', v_piece);
  end;
end;
$fn$;


-- ── POSTCONDITION — ELLE S'EXÉCUTE, ELLE N'AFFIRME PAS (§E.67) ──────────────
--  Chaque sonde s'annule elle-même (SONDE_ANNULEE) : la migration ne laisse
--  ni ligne de journal, ni ligne de run, ni réglage modifié derrière elle.
do $post$
declare
  v_sig    text;
  v_n      integer;
  v_id     bigint;
  v_piece  uuid;
  v_detail jsonb;
  v_res    jsonb;
  v_col    text;
  v_vie    integer;
  v_fen    integer;
  v_inv    integer;
  v_ip     integer;
  v_acteur uuid;
  v_upd    uuid;
begin
  -- Les signatures, résolues par TYPES.
  for v_sig in
    select s from unnest(array[
      'public.identifiant_derive(text, text)',
      'public.journaliser(uuid, text, text, text, uuid, text, uuid, text, uuid, jsonb, uuid, numeric, text)',
      'public.regler_durees_place(uuid, uuid, uuid, uuid, integer, integer, integer, integer, jsonb)',
      'public.effacer_adresses_ip()',
      'public.grand_livre_ajout_seul()',
      'public.audit_logs_detail_sans_pii(jsonb)',
      'public.cloturer_run_cron(bigint, integer, jsonb, text)'
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

  -- La table, ses quatorze colonnes, ses contraintes nommées.
  if to_regclass('public.grand_livre') is null or to_regclass('public.grand_livre_actions') is null then
    raise exception 'postcondition NON TENUE : grand_livre ou grand_livre_actions absente';
  end if;
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'grand_livre'
     and column_name = any(array['horodatage','piece','piece_origine','type_action','statut','origine',
                                 'acteur_id','acteur_type','ecosysteme_id','sujet_type','sujet_id',
                                 'detail','cout_usd','unite_facturee']);
  if v_n <> 14 then
    raise exception 'postcondition NON TENUE : grand_livre a % des 14 colonnes attendues', v_n;
  end if;
  select count(*) into v_n
    from pg_constraint
   where conrelid = 'public.grand_livre'::regclass
     and conname = any(array['grand_livre_statut_check','grand_livre_origine_check','grand_livre_acteur_type_check',
                             'grand_livre_acteur_coherent','grand_livre_acteur_si_humain','grand_livre_sujet_coherent',
                             'grand_livre_cout_coherent','grand_livre_cout_positif','grand_livre_detail_objet']);
  if v_n <> 9 then
    raise exception 'postcondition NON TENUE : % des 9 contraintes de grand_livre sont posees', v_n;
  end if;

  -- LA DATE EN TÊTE de chaque index de filtre — lu dans pg_index, pas dans une chaîne rendue.
  for v_sig in select s from unnest(array['grand_livre_horodatage_idx','grand_livre_date_type_idx',
                                          'grand_livre_date_acteur_idx','grand_livre_date_ecosysteme_idx']) as s
  loop
    select a.attname into v_col
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
     where i.indexrelid = to_regclass('public.' || v_sig);
    if v_col is distinct from 'horodatage' then
      raise exception 'postcondition NON TENUE : l index % ne commence pas par horodatage (vu : %)', v_sig, coalesce(v_col, 'index absent');
    end if;
  end loop;
  if to_regclass('public.grand_livre_piece_idx') is null or to_regclass('public.grand_livre_sujet_idx') is null then
    raise exception 'postcondition NON TENUE : index piece ou sujet absent';
  end if;

  -- LES PRIVILÈGES, EXÉCUTÉS : aucun rôle applicatif n'écrit directement.
  if has_table_privilege('anon', 'public.grand_livre', 'SELECT')
     or has_table_privilege('authenticated', 'public.grand_livre', 'SELECT')
     or has_table_privilege('authenticated', 'public.grand_livre', 'INSERT')
     or has_table_privilege('service_role', 'public.grand_livre', 'INSERT')
     or has_table_privilege('service_role', 'public.grand_livre', 'UPDATE')
     or has_table_privilege('service_role', 'public.grand_livre', 'DELETE')
     or has_table_privilege('service_role', 'public.grand_livre', 'TRUNCATE') then
    raise exception 'postcondition NON TENUE : un role applicatif peut lire sans droit ou ecrire directement dans grand_livre';
  end if;
  if not has_table_privilege('service_role', 'public.grand_livre', 'SELECT') then
    raise exception 'postcondition NON TENUE : service_role ne peut plus LIRE grand_livre — l ecran de l etape 4 serait aveugle';
  end if;

  -- LA LISTE COUVRE LE MANDAT : les refus nommés, les trois purges, le journal, les manquantes.
  select count(*) into v_n
    from public.grand_livre_actions
   where code = any(array['refus_plafond_atteint','refus_expert_inapte','refus_garde_eligibilite','refus_quota_cv',
                          'refus_depot_sans_jugement','compte_purge_inactivite','compte_purge_demande','compte_purge_admin',
                          'journal_nettoye','reglage_modifie','ip_effacees','recherche_abandonnee','devoilement_ferme',
                          'annonce_expiree','plafond_atteint']);
  if v_n <> 15 then
    raise exception 'postcondition NON TENUE : % des 15 actions imposees par le mandat sont au catalogue', v_n;
  end if;
  if exists (select 1 from public.grand_livre_actions where code like 'refus\_%' and statut_impose is distinct from 'refuse') then
    raise exception 'postcondition NON TENUE : un refus n impose pas le statut refuse';
  end if;

  -- LE DÉRIVEUR SQL REND CE QUE REND LE TYPESCRIPT — témoin calculé par
  -- lib/admin/identifiant-derive.ts ; le contrôle le recalcule à chaque passage.
  if public.identifiant_derive('cron_job', 'ip_retention_purge') <> 'e0ffebb5-85d4-84d9-77a4-4e3018b3aaf9'::uuid then
    raise exception 'postcondition NON TENUE : identifiant_derive diverge du TypeScript (vu : %)',
      public.identifiant_derive('cron_job', 'ip_retention_purge');
  end if;

  -- SONDE ① — sans pièce : refus GL002.
  begin
    perform public.journaliser(null::uuid, 'reglage_modifie', 'reussi', 'systeme');
    raise exception 'postcondition NON TENUE : journaliser a ACCEPTE une ecriture sans piece';
  exception when sqlstate 'GL002' then
    null;
  end;
  -- SONDE ② — type inconnu : refus GL003.
  begin
    perform public.journaliser(gen_random_uuid(), 'action_inventee', 'reussi', 'systeme');
    raise exception 'postcondition NON TENUE : journaliser a ACCEPTE un type hors liste';
  exception when sqlstate 'GL003' then
    null;
  end;
  -- SONDE ③ — un refus au statut reussi : refus GL003.
  begin
    perform public.journaliser(gen_random_uuid(), 'refus_plafond_atteint', 'reussi', 'systeme');
    raise exception 'postcondition NON TENUE : journaliser a ACCEPTE un refus au statut reussi';
  exception when sqlstate 'GL003' then
    null;
  end;

  -- SONDE ④ — une écriture valide, la clé personnelle retirée, puis UPDATE et
  -- DELETE doivent LEVER (GL001). Tout est annulé à la fin.
  begin
    v_piece := gen_random_uuid();
    v_id := public.journaliser(v_piece, 'reglage_modifie', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid,
                               'sonde', gen_random_uuid(),
                               '{"email":"a@b.c","ok":1}'::jsonb);
    select detail into v_detail from public.grand_livre where id = v_id;
    if v_detail is distinct from '{"ok":1}'::jsonb then
      raise exception 'postcondition NON TENUE : le detail garde une donnee personnelle : %', v_detail;
    end if;
    begin
      update public.grand_livre set statut = 'echoue' where id = v_id;
      raise exception 'postcondition NON TENUE : UPDATE ACCEPTE sur grand_livre — le verrou ne tient pas';
    exception when sqlstate 'GL001' then
      null;
    end;
    begin
      delete from public.grand_livre where id = v_id;
      raise exception 'postcondition NON TENUE : DELETE ACCEPTE sur grand_livre — le verrou ne tient pas';
    exception when sqlstate 'GL001' then
      null;
    end;
    if not exists (select 1 from public.grand_livre where id = v_id and piece = v_piece) then
      raise exception 'postcondition NON TENUE : la ligne sonde a disparu apres les tentatives';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;

  -- SONDE ⑤ — regler_durees_place écrit le réglage ET journalise, en un appel.
  --   L'acteur doit exister (updated_by référence users) : on prend un compte
  --   réel. Sur une base VIERGE il n'y en a aucun — la sonde le dit et passe
  --   (§G.4 bis : une base vierge ne rejoue pas les cas de données).
  select id into v_acteur from public.users order by created_at limit 1;
  if v_acteur is null then
    raise notice 'postcondition : sonde regler_durees_place SAUTEE — aucun compte en base (base vierge)';
  else
    begin
      select vie_annonce_jours, fenetre_echange_jours, invitation_jours, conservation_ip_mois
        into v_vie, v_fen, v_inv, v_ip
        from public.duree_reglages where ligne_unique = true;
      v_piece := gen_random_uuid();
      v_id := public.regler_durees_place(v_piece, v_acteur, null::uuid, gen_random_uuid(),
                                         v_vie, v_fen, v_inv, v_ip, '{"sonde":true}'::jsonb);
      if not exists (select 1 from public.grand_livre
                      where id = v_id and piece = v_piece and type_action = 'reglage_modifie'
                        and statut = 'reussi' and origine = 'administrateur' and acteur_id = v_acteur) then
        raise exception 'postcondition NON TENUE : regler_durees_place n a pas journalise sa piece';
      end if;
      select updated_by into v_upd from public.duree_reglages where ligne_unique = true;
      if v_upd is distinct from v_acteur then
        raise exception 'postcondition NON TENUE : regler_durees_place n a pas ecrit le reglage';
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;

  -- SONDE ⑥ — effacer_adresses_ip génère sa pièce et journalise son succès.
  begin
    v_res := public.effacer_adresses_ip();
    if v_res ? 'erreur' then
      raise exception 'postcondition NON TENUE : effacer_adresses_ip a echoue : %', v_res->>'erreur';
    end if;
    if not exists (select 1 from public.grand_livre
                    where piece = (v_res->>'piece')::uuid and type_action = 'ip_effacees'
                      and statut = 'reussi' and origine = 'tache_planifiee'
                      and sujet_id = public.identifiant_derive('cron_job', 'ip_retention_purge')) then
      raise exception 'postcondition NON TENUE : effacer_adresses_ip n a pas journalise sa piece';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;

  select count(*) into v_n from public.grand_livre_actions;
  raise notice 'postcondition tenue : grand_livre en ajout seul (UPDATE et DELETE levent), % actions fermees, journaliser exige piece et type, deux actions reelles journalisent', v_n;
end
$post$;
