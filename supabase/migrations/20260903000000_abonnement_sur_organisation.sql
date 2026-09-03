-- ═══════════════════════════════════════════════════════════════════════════
-- L'ABONNEMENT REMONTE SUR `organizations`
--
-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║  À LIRE PAR LE CHANTIER STRIPE — LA CIBLE DU WEBHOOK A CHANGÉ           ║
-- ╠═════════════════════════════════════════════════════════════════════════╣
-- ║ `20260901000000_stripe_fondations.sql` écrit, en toutes lettres :       ║
-- ║                                                                         ║
-- ║   « Décision d'archi FIGÉE en juillet (20260709000003) : l'état          ║
-- ║     d'abonnement vit sur organization_domains […] la Subscription est   ║
-- ║     par (organisation, domaine). »                                      ║
-- ║   « Le webhook écrira organization_domains.package_id et                ║
-- ║     package_valid_until, exactement les colonnes que le moteur lit. »   ║
-- ║                                                                         ║
-- ║ CETTE DÉCISION EST REMPLACÉE PAR CELLE-CI. Ce n'est pas un désaccord    ║
-- ║ technique : LE MODÈLE PRODUIT A CHANGÉ APRÈS coup.                     ║
-- ║                                                                         ║
-- ║ Le nouveau modèle, tranché :                                            ║
-- ║   • toute organisation a accès à TOUS les écosystèmes actifs — plus     ║
-- ║     aucun rattachement, plus aucune activation par écosystème ;         ║
-- ║   • UN SEUL abonnement, UN SEUL quota, PARTAGÉS entre tous ;            ║
-- ║   • seules les DONNÉES sont cloisonnées (annonces, candidatures,        ║
-- ║     messages) — cf. lib/ecosystem-scope.ts.                             ║
-- ║                                                                         ║
-- ║ Dans ce modèle, un abonnement porté par le COUPLE (organisation,        ║
-- ║ domaine) produit un défaut d'argent SILENCIEUX : une organisation qui   ║
-- ║ paie sur un écosystème et navigue sur un autre n'y trouve aucune ligne  ║
-- ║ de rattachement, et `getOrgEntitlements` la fait retomber sur l'offre   ║
-- ║ GRATUITE par défaut (lib/entitlements.ts, branche « fallback »). Elle   ║
-- ║ paie, et perd ses droits, sans qu'aucun écran ne le signale.            ║
-- ║                                                                         ║
-- ║ ═══ POURQUOI CE N'EST PAS UN REVIREMENT ═══                             ║
-- ║ Le lot 0 Stripe a lui-même posé `stripe_customer_id` sur                ║
-- ║ `organizations`, avec cette justification :                             ║
-- ║   « Le Customer est porté par l'ORGANISATION (entité juridique qui      ║
-- ║     détient le moyen de paiement et les factures). »                    ║
-- ║ Ce raisonnement vaut mot pour mot pour la Subscription dès lors que     ║
-- ║ l'abonnement est unique : une seule entité paie, un seul abonnement.    ║
-- ║ Cette migration ne contredit pas le lot 0 Stripe — elle FINIT           ║
-- ║ d'appliquer son propre raisonnement. Customer et Subscription           ║
-- ║ redeviennent cohérents, au même endroit.                                ║
-- ║                                                                         ║
-- ║ ═══ CE QUE LE WEBHOOK DOIT VISER DÉSORMAIS ═══                          ║
-- ║   organizations.stripe_customer_id        (inchangé, déjà là)           ║
-- ║   organizations.stripe_subscription_id                                  ║
-- ║   organizations.stripe_subscription_status                              ║
-- ║   organizations.package_id                                              ║
-- ║   organizations.package_started_at                                      ║
-- ║   organizations.package_valid_until                                     ║
-- ║   organizations.package_source_event_at                                 ║
-- ║ Les mêmes noms, la même sémantique, la même contrainte de statut. Seule ║
-- ║ la TABLE change. Aucun renommage, aucun changement de type.             ║
-- ║                                                                         ║
-- ║ Rien n'est perdu : au moment de cette migration, aucune colonne Stripe  ║
-- ║ n'a jamais été écrite (le lot 1 Stripe n'existe pas encore). La reprise ║
-- ║ ci-dessous ne déplace donc que `package_id` / dates, posés à la main    ║
-- ║ par le back-office.                                                     ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
--
-- Ce qui N'EST PAS touché, et c'est délibéré :
--   • `usage_counters`, `usage_increment`, `usage_peek` — le quota PARTAGÉ
--     entre écosystèmes est VOULU. La clé primaire reste sans `domain_id`.
--   • `packages`, `package_features`, l'invariant « offre par défaut = gratuite »
--     et toute la sémantique de prix du lot 0 Stripe.
--   • `billing_*` / tables de facturation du lot 0 Stripe.
--
-- Idempotence stricte, comme le lot 0 Stripe : `if not exists` partout, la
-- migration se rejoue sans effet.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. organizations — L'ABONNEMENT, AU MÊME ENDROIT QUE LE CLIENT STRIPE
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.organizations
  add column if not exists package_id                 uuid,
  add column if not exists package_started_at         timestamptz,
  add column if not exists package_valid_until        timestamptz,
  add column if not exists stripe_subscription_id     varchar(200),
  add column if not exists stripe_subscription_status varchar(30),
  add column if not exists package_source_event_at    timestamptz;

-- Clé étrangère vers le catalogue. ON DELETE SET NULL : supprimer une offre du
-- catalogue ne doit pas supprimer l'organisation — elle retombe sur l'offre par
-- défaut, exactement comme une ligne sans package.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organizations_package_id_fkey'
  ) then
    alter table public.organizations
      add constraint organizations_package_id_fkey
      foreign key (package_id) references public.packages(id) on delete set null;
  end if;
end
$$;

-- Index UNIQUE PARTIEL — repris À L'IDENTIQUE du lot 0 Stripe, seule la table
-- change : une Subscription Stripe appartient à une seule organisation.
create unique index if not exists idx_organizations_stripe_subscription
  on public.organizations (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- Contrainte de statut — reprise À L'IDENTIQUE du lot 0 Stripe (mêmes valeurs,
-- celles de l'API Stripe). Ne pas la faire diverger.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organizations_subscription_status_check'
  ) then
    alter table public.organizations
      add constraint organizations_subscription_status_check
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

comment on column public.organizations.package_id is
  'Offre commerciale de l''organisation. UNIQUE et PARTAGÉE entre TOUS les '
  'écosystèmes (modèle produit). NULL = offre par défaut du catalogue.';
comment on column public.organizations.package_valid_until is
  'Échéance de l''offre. Dépassée => retour à l''offre par défaut, décidé À LA '
  'LECTURE par lib/entitlements.ts. Aucun batch, aucun cron.';
comment on column public.organizations.stripe_subscription_id is
  'Subscription Stripe portant les droits de cette organisation (sub_...). '
  'Unique. NULL = aucun abonnement (offre par défaut). '
  'Déplacée depuis organization_domains : l''abonnement est unique, il ne peut '
  'plus vivre sur un couple (organisation, domaine).';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. REPRISE DES DONNÉES — AUCUN ABONNEMENT PERDU
--
-- Les abonnements existants vivent sur `organization_domains`. On les remonte.
--
-- LE CAS « PLUSIEURS LIGNES, PACKAGES DIVERGENTS » NE PEUT PAS EXISTER
-- aujourd'hui : la seule instruction `insert into organization_domains` de tout
-- le dépôt est dans `register-org` (une ligne, une fois), et la table porte
-- `UNIQUE (organization_id, domain_id)`.
--
-- On le traite QUAND MÊME. Une migration ne doit pas supposer : elle doit se
-- comporter correctement même sur un état qu'on croit impossible, parce que
-- c'est précisément là qu'une reprise silencieuse perd des données.
--   • on retient la ligne la PLUS RÉCEMMENT ACTIVÉE ;
--   • toute organisation ayant plusieurs packages DIFFÉRENTS est NOMMÉE dans un
--     RAISE NOTICE — visible dans la sortie du push, pas enfouie.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  r record;
  v_divergent integer := 0;
  v_moved     integer := 0;
begin
  -- Signalement AVANT reprise : on nomme les anomalies pendant qu'elles sont
  -- encore lisibles dans leur forme d'origine.
  for r in
    select od.organization_id, count(distinct od.package_id) as n
      from public.organization_domains od
     where od.package_id is not null
     group by od.organization_id
    having count(distinct od.package_id) > 1
  loop
    v_divergent := v_divergent + 1;
    raise notice
      'REPRISE ABONNEMENT — organisation % porte % offres DIFFERENTES sur ses ecosystemes. '
      'La plus recemment activee est retenue. A verifier manuellement.',
      r.organization_id, r.n;
  end loop;

  if v_divergent = 0 then
    raise notice 'REPRISE ABONNEMENT — aucune organisation aux offres divergentes (attendu).';
  end if;

  -- Remontée. `distinct on` + `order by` : la ligne la plus récemment activée
  -- gagne. On n'écrase QUE si l'organisation n'a pas déjà un package (rejouabilité).
  update public.organizations o
     set package_id          = src.package_id,
         package_started_at  = src.package_started_at,
         package_valid_until = src.package_valid_until
    from (
      select distinct on (od.organization_id)
             od.organization_id, od.package_id, od.package_started_at, od.package_valid_until
        from public.organization_domains od
       where od.package_id is not null
       order by od.organization_id, od.activated_at desc, od.updated_at desc
    ) src
   where src.organization_id = o.id
     and o.package_id is null;

  get diagnostics v_moved = row_count;
  raise notice 'REPRISE ABONNEMENT — % organisation(s) remontee(s) sur organizations.', v_moved;
end
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. organization_domains — LES COLONNES D'ABONNEMENT PARTENT
--
-- Une colonne d'abonnement sur une table qui n'alimente plus AUCUNE décision
-- est exactement le piège que le commentaire de trace ci-dessous est censé
-- éviter : quelqu'un la relirait dans six mois et en tirerait une conclusion.
--
-- On retire donc les colonnes, l'index unique et la contrainte de statut posés
-- par le lot 0 Stripe. `if exists` partout : rejouable, et sans effet si le lot
-- 0 Stripe n'a pas encore été appliqué sur cet environnement.
-- ═══════════════════════════════════════════════════════════════════════════

drop index if exists public.idx_org_domains_stripe_subscription;

alter table public.organization_domains
  drop constraint if exists org_domains_subscription_status_check;

alter table public.organization_domains
  drop column if exists stripe_subscription_id,
  drop column if exists stripe_subscription_status,
  drop column if exists package_source_event_at,
  drop column if exists package_id,
  drop column if exists package_started_at,
  drop column if exists package_valid_until;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. CE QUE LA TABLE DEVIENT — À LIRE AVANT D'EN TIRER QUOI QUE CE SOIT
-- ═══════════════════════════════════════════════════════════════════════════

comment on table public.organization_domains is
  E'TRACE HISTORIQUE UNIQUEMENT — N''ALIMENTE PLUS AUCUNE DECISION.\n'
  '\n'
  'Elle conserve QUEL ecosysteme a servi a l''inscription d''une organisation, '
  'et QUAND. Rien d''autre.\n'
  '\n'
  'NE PAS s''en servir pour decider :\n'
  '  - l''ACCES : toute organisation a acces a TOUS les ecosystemes ACTIFS. '
  'Il n''y a plus de rattachement, plus d''activation, plus de souscription '
  'par ecosysteme. La garde vit dans lib/auth-guard.ts.\n'
  '  - l''ABONNEMENT : il est UNIQUE et PARTAGE entre tous les ecosystemes, '
  'et vit desormais sur organizations (package_id, package_valid_until, '
  'stripe_subscription_id). Voir 20260903000000_abonnement_sur_organisation.sql.\n'
  '  - le CLOISONNEMENT des donnees : il se fait sur publications.domain_id et '
  'candidatures.domain_id, jamais via cette table. Voir lib/ecosystem-scope.ts.\n'
  '\n'
  'Une absence de ligne pour un couple (organisation, ecosysteme) ne signifie '
  'RIEN : c''est le cas normal de tous les ecosystemes sauf celui d''inscription.';
