-- ─────────────────────────────────────────────────────────────────────────────
-- CATALOGUE DES TACHES PLANIFIEES — ce que pg_cron ne sait pas dire de lui-meme
--
-- CONTEXTE
--   Cinq taches tournent dans pg_cron. L'une d'elles, `rate_limit_hits_purge`,
--   est INVISIBLE sur les trois plans : elle est planifiee en SQL inline (donc
--   n'ecrit rien dans public.cron_run_log), son nom n'est pas dans la liste
--   codee en dur de `cron_purge_health()`, et le script de diagnostic ne la
--   connait pas. Elle tourne. Personne ne sait ce qu'elle fait.
--
--   C'est exactement le scenario qui a permis a une purge de cesser de
--   fonctionner pendant des mois sans que personne ne puisse le voir.
--
-- CE QUE CETTE TABLE AJOUTE, ET CE QU'ELLE N'AJOUTE PAS
--   pg_cron sait dire : le nom, l'horaire, l'actif, la commande, l'historique
--   d'execution. Il ne sait RIEN dire de ce qui compte pour un humain :
--     - a quoi sert cette tache ?
--     - est-elle LEGALEMENT OBLIGATOIRE ou seulement technique ?
--     - doit-elle tourner APRES une autre ?
--     - son resultat HTTP est-il journalise, ou n'a-t-elle qu'une trace
--       d'ordonnanceur ?
--   Ce catalogue porte ces six informations, et rien d'autre.
--
-- ⚠️ LE CATALOGUE ENRICHIT, IL NE FAIT PAS AUTORITE SUR L'EXISTENCE
--   La liste des taches affichees vient de `cron.job`, JAMAIS de cette table.
--   Une tache planifiee mais absente du catalogue s'affiche quand meme, marquee
--   « non cataloguee ». C'est la seule facon d'eviter que l'ecran reproduise
--   l'angle mort qu'il est cense reveler. Voir l'avertissement en tete de
--   `admin_cron_jobs_overview()` (migration suivante).
--
-- POURQUOI UNE TABLE ET PAS UNE CONVENTION DE NOMMAGE
--   Un prefixe `legal_*` serait une regle non verifiable, invisible en base,
--   perdue au premier renommage — et il n'y aurait aucun endroit ou poser le
--   libelle, la description, l'enchainement. La convention porte UN bit ; il en
--   faut six. La criticite legale est une donnee metier, pas un detail
--   d'affichage : elle doit survivre a une reecriture de l'ecran.
--
-- LIBELLES = CLES i18n, JAMAIS DU TEXTE
--   Regle projet 14 : quatre langues, parite stricte. Ce catalogue est ecrit par
--   MIGRATION (outillage interne), pas edite par un administrateur — il n'a donc
--   rien a faire dans la table `translations`, qui sert ce que Youssef edite.
--   Les cles sont RELATIVES au namespace `admin_back_office.cron`.
--
-- Additif et idempotent. Aucune donnee metier touchee. Aucune planification
-- modifiee : cette migration ne fait que DECRIRE l'existant.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.cron_job_catalog (
  -- Cle = `cron.job.jobname`. PAS de cle etrangere : le schema `cron` appartient
  -- a l'extension, on ne pose pas de contrainte dessus. Une entree orpheline
  -- (tache desplanifiee) est un fait a montrer, pas une erreur d'integrite.
  job_name          text primary key,

  -- Cles i18n relatives a `admin_back_office.cron` (ex. 'jobs.purge_deletions.label').
  label_key         text        not null,
  description_key   text        not null,

  -- 'legal'     : execute une obligation (RGPD, CNIL). Desactivation = perte de
  --               conformite, l'ecran l'annonce en rouge et n'oublie jamais.
  -- 'technical' : outillage. Desactivable sans consequence juridique.
  criticality       text        not null,

  -- Cle i18n nommant l'obligation ('legal_basis.rgpd_art17'). Une tache legale
  -- DOIT la porter : « aucune tache n'est critique sans une raison NOMMABLE ».
  legal_basis_key   text,

  -- Taches qui doivent tourner AVANT celle-ci, et ecart minimal a respecter.
  -- Encode la chaine : la reconciliation lit ce que les purges ont produit ;
  -- inversee, elle ne verrait rien et fabriquerait un faux rouge permanent.
  depends_on        text[]      not null default '{}'::text[],
  min_gap_minutes   integer     not null default 0,

  -- La tache journalise-t-elle un verdict HTTP dans public.cron_run_log ?
  -- FAUX pour les taches SQL pures : sans ce drapeau, l'ecran les afficherait
  -- eternellement « aucune reponse observee », c'est-a-dire en FAUX ROUGE.
  writes_run_log    boolean     not null default false,

  -- Fonction de declenchement manuel (lot 4). NULL = non declenchable.
  manual_trigger_fn text,

  display_order     integer     not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint cron_job_catalog_criticality_check
    check (criticality in ('legal', 'technical')),

  -- INVARIANT : une tache legale nomme son obligation. L'ecran promet
  -- d'afficher POURQUOI une tache est critique ; sans cette contrainte, il
  -- pourrait afficher « LEGAL » sans pouvoir dire de quelle loi il s'agit.
  constraint cron_job_catalog_legal_basis_check
    check (criticality <> 'legal' or legal_basis_key is not null),

  constraint cron_job_catalog_gap_check
    check (min_gap_minutes >= 0)
);

-- RLS activee SANS policy : seul le service-role (qui la contourne) y accede.
-- Meme posture que `rate_limit_hits` et `cron_run_log`.
alter table public.cron_job_catalog enable row level security;

create index if not exists cron_job_catalog_order_idx
  on public.cron_job_catalog (display_order);


-- ─── SEED — LES CINQ TACHES EXISTANTES ───────────────────────────────────────
-- Etat verifie en base : les cinq tournent, `active = true`.
-- `on conflict do update` : rejouable, et une correction de libelle se propage.
insert into public.cron_job_catalog (
  job_name, label_key, description_key,
  criticality, legal_basis_key,
  depends_on, min_gap_minutes, writes_run_log, display_order
) values
  -- ── Obligations legales ────────────────────────────────────────────────────
  (
    'purge_deletions_trigger',
    'jobs.purge_deletions.label',
    'jobs.purge_deletions.description',
    'legal',
    'legal_basis.rgpd_art17',
    '{}'::text[], 0,
    true,        -- appelle /api/cron/purge-deletions via trigger_purge_cron
    10
  ),
  (
    'purge_inactive_trigger',
    'jobs.purge_inactive.label',
    'jobs.purge_inactive.description',
    'legal',
    'legal_basis.cnil_2y',
    '{}'::text[], 0,
    true,        -- appelle /api/cron/purge-inactive via trigger_purge_cron
    20
  ),
  -- ── Outillage ──────────────────────────────────────────────────────────────
  (
    'cron_run_reconcile',
    'jobs.reconcile.label',
    'jobs.reconcile.description',
    'technical',
    null,
    -- Elle RECOPIE la reponse HTTP des deux purges avant expiration du TTL
    -- pg_net (~6 h). Avancee avant elles, elle ne verrait rien : `cron_run_log`
    -- resterait `reconciled_at IS NULL`, ce que le diagnostic lit comme une
    -- PANNE. On casserait l'observabilite en croyant deplacer une heure.
    '{purge_deletions_trigger,purge_inactive_trigger}'::text[], 15,
    false,       -- SQL pur : trace d'ordonnanceur uniquement
    30
  ),
  (
    'cron_run_log_purge',
    'jobs.log_purge.label',
    'jobs.log_purge.description',
    'technical',
    null,
    -- Elle EFFACE le journal que la reconciliation alimente. Avancee avant
    -- elle, elle detruirait la trace du soir meme.
    '{cron_run_reconcile}'::text[], 15,
    false,
    40
  ),
  (
    -- LA TACHE QUI ETAIT INVISIBLE. Planifiee en SQL inline
    -- (20260708000005_rate_limiter.sql), elle n'ecrit dans aucun journal et son
    -- nom n'apparait pas dans `cron_purge_health()`. Elle entre au catalogue
    -- SANS ETRE MODIFIEE : on la rend visible, on ne la touche pas.
    'rate_limit_hits_purge',
    'jobs.rate_limit_purge.label',
    'jobs.rate_limit_purge.description',
    'technical',
    null,
    '{}'::text[], 0,
    false,
    50
  )
on conflict (job_name) do update set
  label_key       = excluded.label_key,
  description_key = excluded.description_key,
  criticality     = excluded.criticality,
  legal_basis_key = excluded.legal_basis_key,
  depends_on      = excluded.depends_on,
  min_gap_minutes = excluded.min_gap_minutes,
  writes_run_log  = excluded.writes_run_log,
  display_order   = excluded.display_order,
  updated_at      = now();


comment on table public.cron_job_catalog is
  'Description humaine des taches pg_cron : libelle, criticite legale, chainage. '
  'ENRICHIT cron.job, ne fait PAS autorite sur l''existence — la liste affichee '
  'vient toujours de cron.job.';
