-- ═══════════════════════════════════════════════════════════════════════════
-- LOT 0 STRIPE — FONDATIONS EN BASE
--
-- AUCUN effet visible, AUCUN encaissement, AUCUN appel réseau. Cette migration
-- ne fait que POSER LES INVARIANTS et LES COLONNES que le webhook (Lot 1) et le
-- parcours d'achat (Lot 2) écriront. Elle est délibérément livrée seule pour
-- être relue avant qu'on construise par-dessus.
--
-- ┌─ CE QUI NE CHANGE PAS, ET C'EST L'ESSENTIEL ────────────────────────────┐
-- │ `lib/entitlements.ts` n'est PAS touché. `usage_counters`,               │
-- │ `usage_increment`, `usage_peek` ne sont PAS touchés. Les trois gates    │
-- │ 402 ne sont PAS touchées. Stripe se branche DERRIÈRE le moteur          │
-- │ commerce : le webhook écrira `organization_domains.package_id` et       │
-- │ `package_valid_until`, exactement les colonnes que le moteur lit déjà.  │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- CONVENTIONS
--  - Idempotence stricte : `if not exists` / `add column if not exists` /
--    `create index if not exists` partout. La migration se rejoue sans effet.
--  - Aucune valeur commerciale codée ici : les prix restent la config du
--    back-office. On ne pose que des INVARIANTS de forme.
--  - Nouvelles tables : RLS activée SANS policy (modèle `usage_counters`,
--    20260709000002) → seul le service-role, qui bypasse RLS, y accède.
--    Les fonctions sont SECURITY DEFINER et `grant execute to service_role`
--    uniquement.
--  - AUCUN batch, AUCUN cron : rien ici n'est ordonnancé. Les colonnes de
--    date sont lues À LA LECTURE par la couche Droits, comme aujourd'hui.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. packages — SÉMANTIQUE DU PRIX ET INVARIANT DE L'OFFRE PAR DÉFAUT
--
-- DÉCISION FIGÉE (décision produit n°1) :
--     price_monthly = 0     → GRATUIT et VENDABLE (offre réelle, à 0 €)
--     price_monthly IS NULL → PAS DE TARIF DÉFINI, donc NON VENDABLE
--
-- Avant ce lot, l'affichage confondait les deux (`app/[locale]/dashboard/
-- entreprise/offre/page.tsx`) : NULL et 0 affichaient tous deux « Gratuit ».
-- L'ambiguïté était sans conséquence tant que rien n'encaissait ; elle
-- deviendrait un bug d'argent dès qu'un `Price` Stripe doit être créé — on ne
-- peut pas créer un prix pour un tarif qui n'existe pas.
--
-- INVARIANT VERROUILLÉ EN BASE (et pas seulement en code) :
--     une offre PAR DÉFAUT est nécessairement GRATUITE.
--
-- Pourquoi c'est structurant : une organisation retombe sur l'offre `is_default`
-- quand son abonnement expire, échoue au renouvellement, ou est résilié
-- (cf. lib/entitlements.ts, branche de repli). Si cette offre était payante,
-- une organisation devrait de l'argent SANS avoir jamais souscrit. Le CHECK
-- rend ce scénario impossible, quel que soit le chemin d'écriture.
--
-- CONSÉQUENCE POUR LA COLLABORATION (décision produit n°8) — VOULUE :
--   L'offre 'collaboration' est aujourd'hui l'offre par défaut de sa cible
--   (20260826000000). Elle passe donc à 0 € et y reste TANT QU'ELLE EST LE
--   DÉFAUT. Vendre la collaboration ne demandera AUCUNE ligne de code : on
--   créera au back-office une offre 'collaboration' PAYANTE à côté de l'offre
--   gratuite par défaut — exactement le modèle déjà en place pour
--   client/cabinet (free par défaut + business + elite payantes).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1.a Normalisation : une offre par défaut sans tarif devient explicitement
--        gratuite. Sémantiquement neutre (NULL et 0 affichaient tous deux
--        « Gratuit ») ; ce qui change, c'est que l'intention est désormais
--        ÉCRITE. Concerne les offres seedées 'free' (20260709000001) et
--        'collaboration' (20260709000008 + 20260826000000).
update public.packages
   set price_monthly = 0
 where is_default = true
   and price_monthly is null;

update public.packages
   set price_yearly = 0
 where is_default = true
   and price_yearly is null;

-- ── 1.b Pré-contrôle ACTIONNABLE. Sans lui, une offre par défaut payante ferait
--        échouer le `add constraint` sur un message Postgres illisible. On
--        préfère nommer les lignes fautives.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s/%s (%s €)', slug, target_role, price_monthly), ', ')
    into v_bad
    from public.packages
   where is_default = true
     and (coalesce(price_monthly, 0) <> 0 or coalesce(price_yearly, 0) <> 0);

  if v_bad is not null then
    raise exception
      'Offre(s) par défaut PAYANTE(S) : %. Une organisation retombe sur l''offre par défaut '
      'quand son abonnement expire ou échoue — elle ne peut pas être payante. '
      'Corrigez au back-office (prix à 0, ou désignez une autre offre par défaut) puis rejouez.',
      v_bad;
  end if;
end
$$;

-- ── 1.c Les deux CHECK.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'packages_default_must_be_free'
  ) then
    alter table public.packages
      add constraint packages_default_must_be_free
      check (
        is_default = false
        or (coalesce(price_monthly, 0) = 0 and coalesce(price_yearly, 0) = 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'packages_price_non_negative'
  ) then
    alter table public.packages
      add constraint packages_price_non_negative
      check (
        coalesce(price_monthly, 0) >= 0
        and coalesce(price_yearly, 0) >= 0
      );
  end if;
end
$$;

comment on column public.packages.price_monthly is
  'Prix mensuel TTC-neutre, en UNITÉ MAJEURE (euros), 2 décimales. '
  '0 = offre GRATUITE et vendable. NULL = aucun tarif défini, offre NON VENDABLE '
  '(aucun Price Stripe ne peut en être dérivé). Une offre is_default est '
  'nécessairement gratuite (contrainte packages_default_must_be_free). '
  'Stripe raisonne en centimes : la conversion x100 vit dans lib/billing, à un seul endroit.';

comment on column public.packages.price_yearly is
  'Cadence annuelle — DORMANTE en V0 (décision produit n°4) : la colonne existe, '
  'aucune offre ne la renseigne, aucun code ne l''expose. Mêmes règles que price_monthly.';

comment on column public.packages.stripe_product_id is
  'Product Stripe miroir de cette offre. Écrit par la SYNCHRONISATION SORTANTE '
  '(catalogue Skilloria -> Stripe, Lot 4). JAMAIS lu comme source de prix : le '
  'catalogue local fait autorité, Stripe n''est qu''un moyen d''encaisser.';

comment on column public.packages.stripe_price_id_monthly is
  'Price Stripe courant pour la cadence mensuelle. Les Price Stripe sont IMMUABLES : '
  'un changement de price_monthly au back-office crée un NOUVEAU Price et archive '
  'l''ancien. Les abonnements en cours restent sur l''ancien Price (grand-père '
  'tarifaire, décision produit n°2) — d''où l''obligation d''afficher au back-office '
  'le prix RÉELLEMENT FACTURÉ (transactions), jamais le prix catalogue.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. organizations — LE CLIENT STRIPE
--
-- Le maillon qui manquait : `checkout.session.completed` donne un `customer`
-- Stripe, et rien en base ne permettait de retrouver l'organisation. Les
-- événements ULTÉRIEURS (invoice.paid, subscription.updated) ne portent souvent
-- que le customer : c'est cette colonne qui les résout.
--
-- Le Customer est porté par l'ORGANISATION (entité juridique qui détient le
-- moyen de paiement et les factures), pas par l'utilisateur : un administrateur
-- qui quitte l'entreprise n'emporte pas la facturation avec lui.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.organizations
  add column if not exists stripe_customer_id varchar(200);

-- Index UNIQUE PARTIEL : un Customer Stripe appartient à une seule organisation.
-- `where ... is not null` — la quasi-totalité des organisations n'en aura jamais.
create unique index if not exists idx_organizations_stripe_customer
  on public.organizations (stripe_customer_id)
  where stripe_customer_id is not null;

comment on column public.organizations.stripe_customer_id is
  'Customer Stripe de cette organisation (cus_...). Unique. Écrit par le webhook. '
  'Sert à résoudre l''organisation sur les événements qui ne portent que le customer. '
  'NULL tant que l''organisation n''a jamais ouvert de parcours de paiement.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. organization_domains — L'ABONNEMENT
--
-- Décision d'archi FIGÉE en juillet (20260709000003) : « l'etat d'abonnement vit
-- sur organization_domains, PAS dans une table organization_subscriptions ».
-- On la tient : l'identifiant d'abonnement rejoint package_id /
-- package_started_at / package_valid_until, sur la même ligne.
--
-- C'est cohérent avec le modèle de droits : un abonnement porte les droits d'une
-- organisation SUR UN DOMAINE. Le Customer est global à l'organisation (§2),
-- la Subscription est par (organisation, domaine).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.organization_domains
  add column if not exists stripe_subscription_id     varchar(200),
  add column if not exists stripe_subscription_status varchar(30),
  add column if not exists package_source_event_at    timestamptz;

create unique index if not exists idx_org_domains_stripe_subscription
  on public.organization_domains (stripe_subscription_id)
  where stripe_subscription_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'org_domains_subscription_status_check'
  ) then
    alter table public.organization_domains
      add constraint org_domains_subscription_status_check
      check (
        stripe_subscription_status is null
        or stripe_subscription_status in (
          'incomplete', 'incomplete_expired', 'trialing', 'active',
          'past_due', 'canceled', 'unpaid', 'paused'
        )
      );
  end if;
end
$$;

comment on column public.organization_domains.stripe_subscription_id is
  'Subscription Stripe portant les droits de cette organisation sur ce domaine (sub_...). '
  'Unique. NULL = aucun abonnement (l''organisation est sur l''offre par défaut).';

comment on column public.organization_domains.stripe_subscription_status is
  'Statut Stripe de l''abonnement — AFFICHAGE UNIQUEMENT. '
  '⚠ AUCUNE lecture de droits ne doit dépendre de cette colonne : la source de '
  'vérité des droits reste package_id + package_valid_until, lues par '
  'lib/entitlements.ts. Cette colonne n''existe que pour afficher le bandeau '
  '« votre dernier paiement a échoué » (past_due) sans interroger Stripe. '
  'Ajouter ici une règle de droit RECRÉERAIT la double source de vérité que tout '
  'ce lot évite.';

comment on column public.organization_domains.package_source_event_at is
  'Horodatage (Stripe `event.created`) du DERNIER événement ayant écrit package_id. '
  'GARDE ANTI-DÉSORDRE : Stripe ne garantit AUCUN ordre de livraison. Le webhook '
  'IGNORE tout événement dont `created` est <= à cette valeur — sans quoi un '
  'subscription.updated retardataire écraserait un subscription.deleted plus récent. '
  'Corollaire de la règle « ne jamais dériver d''un delta, toujours d''un état absolu ». '
  'NULL = aucun événement Stripe n''a encore écrit cette ligne (attribution manuelle '
  'back-office, ou offre par défaut).';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. transactions — LA PIÈCE COMPTABLE
--
-- La table existait depuis l'origine et n'a JAMAIS été écrite (aucun
-- `from('transactions')` dans le code). Elle est ici mise en état d'accueillir
-- la première ligne, avec trois corrections structurelles.
--
-- ┌─ (a) LE DÉBITEUR EST UNE ORGANISATION, PAS UNE PERSONNE ────────────────┐
-- │ `user_id` seul rendait la table inexploitable par organisation — c'est   │
-- │ écrit noir sur blanc dans app/api/me/organisation/offre/route.ts:26.     │
-- │ Sans `organization_id`, les factures d'une entreprise disparaîtraient de │
-- │ ses écrans au premier changement d'administrateur.                       │
-- │                                                                          │
-- │ `user_id` est CONSERVÉ (NOT NULL, ON DELETE RESTRICT) : il trace         │
-- │ l'initiateur de l'abonnement. Ce n'est pas une redondance — c'est la     │
-- │ traçabilité de qui a engagé la dépense.                                  │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ (b) CONSERVATION COMPTABLE 10 ANS vs PURGE RGPD ───────────────────────┐
-- │ VÉRIFIÉ SUR LE CODE, pas supposé :                                       │
-- │  · `purgeAccount` (lib/account-purge.ts) N'EFFACE PAS la ligne `users` : │
-- │    elle l'ANONYMISE sur place (status='archived', anonymized_at posé,    │
-- │    PII vidées) et bannit le compte ~100 ans. Le commentaire de tête      │
-- │    l'impose explicitement : « JAMAIS auth.admin.deleteUser ».            │
-- │  · Les DEUX chemins de suppression (self-service /api/me/account/delete  │
-- │    et back-office /api/admin/user-purge) appellent CETTE MÊME fonction.  │
-- │  · Le seul `delete` sur `users` du projet est lib/auth-signup.ts:112, un │
-- │    rollback d'inscription échouée — aucune transaction ne peut exister.  │
-- │  => Une transaction ne peut donc PAS être détruite par une purge, et     │
-- │     `transactions_user_id_fkey ON DELETE RESTRICT` (baseline:3278)       │
-- │     bloquerait de toute façon toute suppression future.                  │
-- │                                                                          │
-- │ Mais « ça se trouve être vrai aujourd'hui » n'est pas un verrou. On pose │
-- │ donc le verrou EN BASE : le trigger §4.d interdit la suppression d'une   │
-- │ transaction livemode. Un remboursement s'enregistre par une NOUVELLE     │
-- │ ligne (status='refunded'), jamais par une suppression.                   │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ (c) NI HT NI TTC PRÉSUMÉ (décision produit n°9) ───────────────────────┐
-- │ Stripe Tax n'est PAS tranché. Le schéma ne doit donc rien présumer : il  │
-- │ enregistre les TROIS montants séparément, plus la qualification fiscale. │
-- │ Aujourd'hui tax_status='none' et tax_amount=0 ; le jour où Stripe Tax    │
-- │ est activé, les mêmes colonnes se remplissent — AUCUNE migration, aucune │
-- │ refonte, aucun recalcul rétroactif d'un montant ambigu.                  │
-- └────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 4.a Le débiteur, et le mode Stripe.
alter table public.transactions
  add column if not exists organization_id   uuid,
  add column if not exists stripe_invoice_id varchar(200),
  add column if not exists livemode          boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_organization_id_fkey'
  ) then
    -- RESTRICT et non CASCADE : une organisation qui a des pièces comptables ne
    -- se supprime pas. Le nettoyage des organisations fantômes
    -- (20260828000000) ne vise que des organisations sans aucun usage.
    alter table public.transactions
      add constraint transactions_organization_id_fkey
      foreign key (organization_id) references public.organizations (id)
      on delete restrict;
  end if;
end
$$;

create index if not exists idx_transactions_organization_id
  on public.transactions (organization_id);

comment on column public.transactions.organization_id is
  'Organisation DÉBITRICE. C''est elle qui doit la somme, pas la personne. '
  'NULL uniquement pour d''éventuelles lignes historiques — toute ligne écrite '
  'par le webhook le renseigne.';

comment on column public.transactions.user_id is
  'Personne ayant ENGAGÉ la dépense (traçabilité). ON DELETE RESTRICT : cette '
  'ligne ne peut pas disparaître tant qu''une transaction la référence. Après une '
  'purge RGPD le compte est anonymisé en place, jamais supprimé — la pièce '
  'comptable reste donc intacte et rattachée à une personne anonymisée.';

comment on column public.transactions.livemode is
  'true = argent réel (Stripe en mode live). false = transaction de TEST. '
  'Sépare les jeux de données même si un environnement était mal câblé, et '
  'conditionne le verrou de suppression (trigger transactions_block_delete).';

-- ── 4.b Idempotence des écritures : les clés Stripe deviennent UNIQUES.
--        L'index existait (baseline:2573) mais n'était PAS unique : rien
--        n'empêchait deux lignes pour un même paiement. C'est la DEUXIÈME
--        barrière d'idempotence, indépendante du journal d'événements (§5) —
--        même si le journal était contourné, on ne crédite pas deux fois.
--
--        `stripe_invoice_id` est LA clé de dédoublonnage de l'abonnement : un
--        renouvellement produit une facture, donc une transaction, et l'événement
--        `invoice.paid` peut être livré plusieurs fois. Le PaymentIntent, lui,
--        peut être absent selon le mode de règlement.
drop index if exists public.idx_transactions_stripe_pi;

create unique index if not exists idx_transactions_stripe_pi
  on public.transactions (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create unique index if not exists idx_transactions_stripe_invoice
  on public.transactions (stripe_invoice_id)
  where stripe_invoice_id is not null;

comment on column public.transactions.stripe_invoice_id is
  'Facture Stripe (in_...) dont cette transaction est l''enregistrement. UNIQUE : '
  'c''est la clé de dédoublonnage des renouvellements d''abonnement.';

-- ── 4.c La fiscalité, enregistrée sans être présumée.
alter table public.transactions
  add column if not exists amount_excl_tax numeric(10,2),
  add column if not exists tax_amount      numeric(10,2)  not null default 0,
  add column if not exists tax_rate        numeric(5,2),
  add column if not exists tax_status      varchar(20)    not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_tax_status_check'
  ) then
    alter table public.transactions
      add constraint transactions_tax_status_check
      check (tax_status in ('none', 'taxable', 'reverse_charge', 'exempt'));
  end if;

  -- Cohérence arithmétique EXACTE (numeric, pas de flottant) : si le HT est
  -- renseigné, HT + TVA doit faire le montant réglé. Empêche silencieusement
  -- toute écriture incohérente le jour où Stripe Tax est activé.
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_amount_coherence_check'
  ) then
    alter table public.transactions
      add constraint transactions_amount_coherence_check
      check (amount_excl_tax is null or amount_excl_tax + tax_amount = amount);
  end if;
end
$$;

comment on column public.transactions.amount is
  'Montant RÉELLEMENT RÉGLÉ, toutes taxes comprises, en unité majeure (euros). '
  'Correspond à `amount_paid` de la facture Stripe. Le caractère TTC est ici '
  'EXPLICITE : rien dans le code ne doit présumer HT ou TTC (décision n°9).';

comment on column public.transactions.amount_excl_tax is
  'Montant HORS TAXES (subtotal Stripe). Tant que Stripe Tax n''est pas activé, '
  'égal à `amount` (tax_amount = 0). NULL admis pour une ligne dont le détail '
  'fiscal n''est pas connu.';

comment on column public.transactions.tax_amount is
  'Montant de TVA. 0 tant que Stripe Tax n''est pas activé — ce qui est un FAIT '
  'enregistré, pas une hypothèse.';

comment on column public.transactions.tax_rate is
  'Taux appliqué, en pourcentage (ex. 20.00). NULL si aucune taxe déterminée.';

comment on column public.transactions.tax_status is
  'Qualification fiscale de la ligne : none (aucune taxe déterminée — état actuel), '
  'taxable (TVA collectée), reverse_charge (autoliquidation intracommunautaire), '
  'exempt (exonéré). Activer Stripe Tax remplit ces colonnes SANS migration.';

-- ── 4.d LE VERROU DE CONSERVATION.
--        Une pièce comptable ne se supprime pas : conservation 10 ans en France.
--        Le service-role bypasse RLS mais PAS les triggers — ce verrou lie donc
--        réellement tous les chemins d'écriture de l'application.
--        Les lignes de TEST (livemode = false) restent supprimables : ce ne sont
--        pas des pièces comptables, et la campagne de test du Lot 6 doit pouvoir
--        nettoyer derrière elle.
create or replace function public.transactions_block_delete()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $$
begin
  if old.livemode then
    raise exception
      'Suppression interdite : une transaction livemode est une pièce comptable '
      '(conservation légale 10 ans). Un remboursement s''enregistre par une NOUVELLE '
      'ligne (status=''refunded''), jamais par une suppression.'
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists transactions_block_delete on public.transactions;
create trigger transactions_block_delete
  before delete on public.transactions
  for each row execute function public.transactions_block_delete();


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. stripe_events — LE JOURNAL D'ÉVÉNEMENTS ET L'IDEMPOTENCE
--
-- ┌─ CE N'EST PAS UN BATCH ─────────────────────────────────────────────────┐
-- │ Un webhook est une requête HTTP ENTRANTE déclenchée par un fait, au même │
-- │ titre qu'un POST utilisateur. Il traite UN événement, au moment où il    │
-- │ arrive. Il ne parcourt aucune ligne, n'est ordonnancé par rien. C'est    │
-- │ même ce qui ÉVITE d'avoir à balayer périodiquement les abonnements pour  │
-- │ savoir qui a payé. La contrainte « zéro batch, zéro cron » est tenue.    │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- IDEMPOTENCE PAR CONTRAINTE DE BASE, JAMAIS PAR LECTURE-PUIS-ÉCRITURE.
-- Stripe rejoue un événement quand la réponse tarde ou échoue, et selon sa
-- politique de réessai (jusqu'à 3 jours). Deux livraisons du même evt_... sont
-- NORMALES. La clé primaire EST l'identifiant Stripe : l'unicité est
-- STRUCTURELLE, et le verrou est posé par un unique INSERT ... ON CONFLICT —
-- donc aucune course possible entre deux livraisons simultanées. Un
-- `select` préalable suivi d'un `insert` aurait exactement le trou qu'on ferme.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.stripe_events (
  id              text        primary key,        -- evt_... : l'unicité est structurelle
  type            text        not null,           -- ex. 'invoice.paid'
  payload         jsonb       not null,
  livemode        boolean     not null,
  status          text        not null default 'received',
  attempts        integer     not null default 1,
  error           text,
  organization_id uuid,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  constraint stripe_events_status_check
    check (status in ('received', 'processed', 'ignored', 'failed'))
);

-- RLS activée SANS policy : seul le service-role (qui bypasse RLS) accède à la
-- table. Modèle usage_counters (20260709000002) / rate_limiter.
alter table public.stripe_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stripe_events_organization_id_fkey'
  ) then
    -- SET NULL et non RESTRICT : le journal d'événements survit à la disparition
    -- d'une organisation. C'est un journal technique, pas une pièce comptable.
    alter table public.stripe_events
      add constraint stripe_events_organization_id_fkey
      foreign key (organization_id) references public.organizations (id)
      on delete set null;
  end if;
end
$$;

create index if not exists idx_stripe_events_status
  on public.stripe_events (status, received_at desc);

create index if not exists idx_stripe_events_type
  on public.stripe_events (type, received_at desc);

create index if not exists idx_stripe_events_organization
  on public.stripe_events (organization_id, received_at desc)
  where organization_id is not null;

comment on table public.stripe_events is
  'Journal des événements Stripe reçus. La clé primaire EST l''identifiant '
  'Stripe (evt_...) : c''est le verrou d''idempotence, posé par une contrainte '
  'de base et non par une lecture-puis-écriture.';

comment on column public.stripe_events.status is
  'received : réclamé, traitement en cours ou interrompu. '
  'processed : effet métier appliqué. '
  'ignored : type non géré — on répond 200 quand même, sinon Stripe désactive '
  'l''endpoint et on perdrait les événements qu''on gère. '
  'failed : traitement en erreur, REJOUABLE (cf. stripe_event_claim).';

comment on column public.stripe_events.attempts is
  'Nombre de fois où l''événement a été réclamé. > 1 signale un rejeu après échec.';

-- ── 5.a stripe_event_claim — LE VERROU.
--
-- Retourne true si CET appel a le droit de traiter l'événement, false s'il a
-- déjà été traité (ou est en cours de traitement par une autre livraison).
-- L'appelant qui reçoit false répond 200 et NE FAIT RIEN.
--
-- Un seul statement INSERT ... ON CONFLICT DO UPDATE : le lock de ligne posé
-- par ON CONFLICT sérialise les livraisons concurrentes. La garde WHERE ne
-- laisse repasser QUE les événements en échec — un rejeu légitime.
--
-- ⚠ ÉVÉNEMENT BLOQUÉ EN 'received' : si le processus meurt avant d'avoir marqué
--   l'événement (crash, timeout de la fonction serverless), la ligne reste en
--   'received' et les réessais de Stripe seront refusés. C'est délibéré — mieux
--   vaut un événement non appliqué et VISIBLE qu'un double crédit. La route
--   doit marquer 'failed' dans son catch ; un 'received' ancien est un signal
--   d'incident, listable par `idx_stripe_events_status`, et se rejoue en
--   repassant la ligne à 'failed'.
create or replace function public.stripe_event_claim(
  p_id       text,
  p_type     text,
  p_payload  jsonb,
  p_livemode boolean
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_claimed boolean;
begin
  insert into public.stripe_events as se (id, type, payload, livemode, status, attempts)
  values (p_id, p_type, p_payload, p_livemode, 'received', 1)
  on conflict (id) do update
     set status   = 'received',
         attempts = se.attempts + 1,
         payload  = excluded.payload,
         error    = null
   where se.status = 'failed'
  returning true into v_claimed;

  -- Aucune ligne insérée ni mise à jour => déjà reçu et non rejouable.
  return coalesce(v_claimed, false);
end;
$$;

-- ── 5.b stripe_event_mark — clôture du traitement.
create or replace function public.stripe_event_mark(
  p_id              text,
  p_status          text,
  p_error           text default null,
  p_organization_id uuid default null
) returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $$
begin
  if p_status not in ('processed', 'ignored', 'failed') then
    raise exception 'stripe_event_mark: statut de clôture invalide (%)', p_status;
  end if;

  update public.stripe_events
     set status          = p_status,
         error           = p_error,
         organization_id = coalesce(p_organization_id, organization_id),
         processed_at    = case when p_status = 'failed' then processed_at else now() end
   where id = p_id;
end;
$$;

-- Accès service-role uniquement (jamais exposé au client), modèle usage_counters.
revoke all on function public.stripe_event_claim(text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.stripe_event_claim(text, text, jsonb, boolean)
  to service_role;

revoke all on function public.stripe_event_mark(text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.stripe_event_mark(text, text, text, uuid)
  to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. VÉRIFICATION FINALE — la migration se contrôle elle-même.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_paid_default int;
  v_missing      text[] := '{}';
begin
  select count(*) into v_paid_default
    from public.packages
   where is_default = true
     and (coalesce(price_monthly, 0) <> 0 or coalesce(price_yearly, 0) <> 0);
  if v_paid_default > 0 then
    raise exception 'Invariant rompu : % offre(s) par défaut payante(s).', v_paid_default;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'packages_default_must_be_free') then
    v_missing := v_missing || 'packages_default_must_be_free';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'transactions_block_delete') then
    v_missing := v_missing || 'trigger transactions_block_delete';
  end if;
  if to_regclass('public.stripe_events') is null then
    v_missing := v_missing || 'table stripe_events';
  end if;
  if not exists (select 1 from pg_proc where proname = 'stripe_event_claim') then
    v_missing := v_missing || 'fonction stripe_event_claim';
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'Fondations Stripe incomplètes : %', array_to_string(v_missing, ', ');
  end if;

  raise notice 'Fondations Stripe OK — invariant tarifaire, verrou comptable, journal d''événements. Aucun encaissement possible : ce lot ne branche rien.';
end
$$;
