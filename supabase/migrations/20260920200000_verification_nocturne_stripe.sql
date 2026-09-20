-- ═══════════════════════════════════════════════════════════════════════════
-- LA VÉRIFICATION NOCTURNE DU RACCORDEMENT STRIPE
--
-- ORDRE DE PASSAGE : **INDIFFÉRENT**.
--   Elle n'ajoute que du nouveau — une table, une entrée de catalogue, une
--   planification. Elle ne supprime aucune colonne que le code en ligne lise,
--   et ne détruit aucune ligne qu'un ancien code recréerait. Elle peut donc
--   passer avant ou après le déploiement (§G.4).
--
-- ┌─ POURQUOI UNE TABLE, ALORS QUE LE LOT EN REFUSE TOUTES LES AUTRES ──────┐
-- │ Le module d'exploitation ne stocke RIEN de Stripe : ni facture, ni       │
-- │ montant, ni copie d'abonnement, ni écart. Une copie locale de Stripe     │
-- │ diverge de Stripe, et un écart devient FAUX à la seconde où le webhook   │
-- │ suivant arrive — il se recalcule à l'affichage, il ne se persiste pas.   │
-- │                                                                          │
-- │ Une seule chose mérite d'être écrite : LE FAIT QUE LA NUIT A ÉTÉ         │
-- │ VÉRIFIÉE. Ce n'est pas un constat périssable, c'est un ÉVÉNEMENT daté :  │
-- │ il n'est vrai qu'une fois, il ne se recalcule pas, et sans lui personne  │
-- │ ne peut dire le matin si la vérification a seulement tourné.             │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ `etat` EST DÉCLARÉ AVANT LES COMPTEURS, ET CE N'EST PAS COSMÉTIQUE ────┐
-- │ « 0 écart » et « je n'ai pas pu comparer » sont deux états, et l'un des  │
-- │ deux rassure à tort (§E.36). Un `manquants = 0` posé à côté d'un état    │
-- │ 'impossible' mentirait ; la contrainte ci-dessous l'INTERDIT en base.    │
-- │ Une garde qui est une contrainte de schéma ne dépend d'aucune            │
-- │ discipline (§E.31).                                                      │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- CONVENTIONS : `if not exists` partout, la migration se rejoue sans effet.
-- Aucune valeur commerciale, aucun tarif, aucun prix — le catalogue local fait
-- foi et rien ici ne le touche.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. stripe_reconciliation_runs — CE QUE LA NUIT A CONSTATÉ
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.stripe_reconciliation_runs (
  id                  uuid        primary key default gen_random_uuid(),

  -- ── L'ÉTAT D'ABORD. TOUT LE RESTE EN DÉPEND. ──────────────────────────────
  --  'compare'    : la comparaison a eu lieu, les compteurs ont un sens.
  --  'impossible' : on n'a PAS pu comparer. Les compteurs sont NULL, et la
  --                 contrainte plus bas garantit qu'ils le sont.
  etat                text        not null,
  -- Pourquoi on n'a pas pu. Union close côté application
  -- (lib/stripe-exploitation/etat.ts) ; texte ici, parce qu'un motif ajouté ne
  -- doit pas exiger une migration pour être journalisé.
  motif_impossible    text,

  -- La fenêtre réellement interrogée. JAMAIS déduite de `ran_at` à la lecture :
  -- un passage retardé ou rejoué n'interroge pas les dernières 24 h de sa
  -- propre exécution, et lire la fenêtre à l'envers ferait conclure à un écart.
  fenetre_debut       timestamptz not null,
  fenetre_fin         timestamptz not null,

  -- ── LES COMPTEURS. NULL quand `etat = 'impossible'`. ──────────────────────
  evenements_stripe   integer,
  evenements_locaux   integer,
  manquants           integer,
  -- Les identifiants des événements présents chez Stripe et absents chez nous.
  -- ON NE STOCKE QUE L'IDENTIFIANT : la charge utile vit chez Stripe, et l'y
  -- recopier serait exactement la copie locale que ce lot refuse.
  ids_manquants       text[]      not null default '{}'::text[],
  -- La pagination est bornée (PLAFOND_PAGINATION). Un résultat tronqué qui se
  -- présenterait comme complet serait un chiffre juste sous une étiquette
  -- fausse (§E.24).
  tronque             boolean     not null default false,

  duree_ms            integer,
  ran_at              timestamptz not null default now(),

  constraint stripe_reconciliation_runs_etat_check
    check (etat in ('compare', 'impossible')),

  -- UN MOTIF EST OBLIGATOIRE QUAND ON N'A PAS PU, ET INTERDIT QUAND ON A PU.
  -- Sans cette contrainte, une ligne 'impossible' sans motif dirait « quelque
  -- chose a raté » sans dire quoi — c'est-à-dire rien d'actionnable.
  constraint stripe_reconciliation_runs_motif_check
    check (
      (etat = 'impossible' and motif_impossible is not null)
      or (etat = 'compare' and motif_impossible is null)
    ),

  -- ⚠️ LA CONTRAINTE QUI PORTE TOUT LE LOT.
  --    Un `manquants = 0` écrit sur une ligne 'impossible' se lirait « zéro
  --    écart » — c'est-à-dire le mensonge exact que ce module existe pour
  --    empêcher. La base le refuse : sur 'impossible', les trois compteurs
  --    sont NULL ; sur 'compare', les trois sont renseignés.
  constraint stripe_reconciliation_runs_compteurs_check
    check (
      (etat = 'compare'
        and evenements_stripe is not null
        and evenements_locaux is not null
        and manquants is not null)
      or (etat = 'impossible'
        and evenements_stripe is null
        and evenements_locaux is null
        and manquants is null)
    ),

  constraint stripe_reconciliation_runs_fenetre_check
    check (fenetre_fin > fenetre_debut)
);

-- RLS activée SANS policy : seul le service-role (qui la contourne) y accède.
-- Même posture que `stripe_events`, `cron_run_log` et `usage_counters`.
alter table public.stripe_reconciliation_runs enable row level security;

create index if not exists idx_stripe_reconciliation_runs_date
  on public.stripe_reconciliation_runs (ran_at desc);

-- L'écran ouvre sur « la dernière nuit qui a trouvé quelque chose ». Sans cet
-- index, il faudrait balayer tout l'historique pour l'atteindre.
create index if not exists idx_stripe_reconciliation_runs_ecarts
  on public.stripe_reconciliation_runs (ran_at desc)
  where manquants is not null and manquants > 0;

comment on table public.stripe_reconciliation_runs is
  'Une ligne par passage de la vérification nocturne du raccordement Stripe. '
  'Elle ne stocke AUCUN écart de droits — ceux-là se recalculent à l''affichage, '
  'parce qu''un écart devient faux dès que le webhook suivant arrive. Elle '
  'enregistre un FAIT daté : cette nuit-là, a-t-on pu comparer, et qu''a-t-on vu.';

comment on column public.stripe_reconciliation_runs.etat is
  'compare : la comparaison a eu lieu. impossible : on n''a pas pu comparer. '
  'Les compteurs sont NULL dans le second cas, et une contrainte l''impose : '
  '« 0 manquant » sur une lecture en panne serait rassurant à tort.';

comment on column public.stripe_reconciliation_runs.ids_manquants is
  'Identifiants (evt_...) présents chez Stripe et absents du journal local. '
  'L''IDENTIFIANT SEUL : la charge utile reste chez Stripe, où elle est '
  'conservée 30 jours. La recopier ici ferait diverger une copie de sa source.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LE CATALOGUE — UNE TÂCHE QUI N'Y FIGURE PAS EST UNE TÂCHE QUE PERSONNE
--    NE SURVEILLE. Le catalogue en a déjà oublié trois (cf. duree_invitation).
--
--  `criticality = 'technical'` : aucune obligation légale ne la porte — ce que
--  `legal` désigne, et ce qui exigerait un `legal_basis_key` (contrainte en
--  base). La confondre avec une purge RGPD banaliserait les deux.
--
--  `writes_run_log = true` : elle passe par `trigger_purge_cron`, donc un
--  verdict HTTP arrive dans `public.cron_run_log`. À `false`, l'écran
--  l'afficherait éternellement « aucune réponse observée » — un FAUX ROUGE.
--
--  `depends_on` : AUCUNE. Elle ne lit rien que les purges produisent et ne
--  détruit rien qu'elles alimentent. Lui inventer une dépendance figerait un
--  ordre que rien n'exige.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.cron_job_catalog
  (job_name, label_key, description_key, criticality, writes_run_log, display_order)
values
  ('stripe_reconcile_trigger',
   'jobs.stripe_reconcile.label', 'jobs.stripe_reconcile.description',
   'technical', true, 70)
on conflict (job_name) do nothing;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LA PLANIFICATION
--
--  ┌─ POURQUOI NOCTURNE, ET POURQUOI PAS PLUS ESPACÉ ──────────────────────┐
--  │ L'API Events de Stripe conserve les événements **30 jours**. Au-delà,  │
--  │ un événement manqué devient INTROUVABLE : il n'y a plus rien à         │
--  │ comparer, et le trou devient définitif sans que personne l'ait su.     │
--  │ Une cadence quotidienne laisse vingt-neuf jours de marge pour agir.    │
--  │                                                                        │
--  │ Une cadence plus SERRÉE n'apporterait rien : les réessais de Stripe    │
--  │ s'étalent sur trois jours, et une fenêtre de 24 h signalerait comme    │
--  │ « manquant » un événement simplement en cours de réessai.              │
--  └──────────────────────────────────────────────────────────────────────┘
--
--  ┌─ 02:40 UTC, ET L'HEURE N'EST PAS ESTHÉTIQUE : ELLE EST CONTRAINTE ────┐
--  │ `writes_run_log = true` promet qu'un verdict HTTP finira dans          │
--  │ `public.cron_run_log`. Ce verdict n'y arrive PAS tout seul : il est    │
--  │ recopié depuis `net._http_response` par `reconcile_cron_run_log()`,   │
--  │ planifiée à **03:15 et 03:45** — et pg_net purge sa réponse avec un    │
--  │ **TTL d'environ 6 h** (écrit dans `20260823000000_purges_rgpd_pg_cron`,│
--  │ lignes 38-42 et 175-176).                                             │
--  │                                                                        │
--  │ Une tâche planifiée APRÈS 03:45 ne serait donc réconciliée qu'au       │
--  │ passage du LENDEMAIN, ~23 h plus tard : sa réponse aurait expiré, et   │
--  │ `reconciled_at` resterait NULL pour toujours. L'écran des tâches       │
--  │ planifiées l'afficherait éternellement « aucune réponse observée » —   │
--  │ un FAUX ROUGE, exactement ce que le commentaire de `writes_run_log`    │
--  │ met en garde de produire.                                              │
--  │                                                                        │
--  │ 02:40 est donc réconciliée 35 minutes plus tard, très à l'intérieur du │
--  │ TTL. Vérifié : aucune autre tâche n'occupe cette minute (03:00, 03:15, │
--  │ 03:30, 03:45, 04:00, 04:10, 04:30, plus deux tâches en */5).           │
--  └──────────────────────────────────────────────────────────────────────┘
--
--  Elle passe AVANT les purges légales, et c'est sans conséquence : elle ne lit
--  rien qu'elles produisent et ne détruit rien qu'elles alimentent. Ce n'est PAS
--  une dépendance, et le catalogue n'en déclare aucune — en inventer une figerait
--  un ordre que rien n'exige (§E.34 : on ancre sur la propriété, pas sur l'usage).
--
--  ⚠️ `cron.schedule` reçoit des composants FIXES, jamais une expression
--     saisie : pg_cron valide la FORME d'une expression, pas sa
--     satisfaisabilité — `0 3 30 2 *` est acceptée et ne se déclenche jamais
--     (§E.9). Ici l'expression est littérale et relue.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  perform cron.unschedule('stripe_reconcile_trigger');
exception when others then
  -- La tâche n'existait pas : c'est le cas normal d'une première application.
  null;
end
$$;

select cron.schedule(
  'stripe_reconcile_trigger',
  '40 2 * * *',
  $job$select public.trigger_purge_cron('stripe_reconcile_trigger', '/api/cron/stripe-reconcile')$job$
);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. VÉRIFICATION FINALE — la migration se contrôle elle-même.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.stripe_reconciliation_runs') is null then
    v_missing := v_missing || 'table stripe_reconciliation_runs';
  end if;
  if not exists (
    select 1 from public.cron_job_catalog where job_name = 'stripe_reconcile_trigger'
  ) then
    v_missing := v_missing || 'entree de catalogue stripe_reconcile_trigger';
  end if;
  if not exists (select 1 from cron.job where jobname = 'stripe_reconcile_trigger') then
    v_missing := v_missing || 'planification stripe_reconcile_trigger';
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'verification_nocturne_stripe: incomplet — %', array_to_string(v_missing, ', ');
  end if;
end
$$;
