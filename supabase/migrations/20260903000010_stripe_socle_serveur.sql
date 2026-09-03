-- ═══════════════════════════════════════════════════════════════════════════
-- LOT 1 STRIPE — CE QUE LE SOCLE SERVEUR EXIGE EN PLUS DES FONDATIONS
--
-- Deux familles d'ajustements, toutes deux imposées par l'écriture du webhook.
-- Aucun encaissement n'est ouvert ici : les deux verrous (clé scopée par
-- environnement + ENABLE_BILLING) vivent dans le code, pas en base.
--
-- ┌─ CETTE MIGRATION NE TOUCHE PAS À organization_domains ──────────────────┐
-- │ L'abonnement est un attribut de l'ORGANISATION, unique et partagé entre │
-- │ tous les écosystèmes. `organization_domains` est une TRACE HISTORIQUE   │
-- │ qui n'alimente plus aucune décision — son propre commentaire de table   │
-- │ l'énonce. Rien ici ne l'écrit, ne la lit, ni ne lui ajoute de colonne.  │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ NUMÉROTATION ──────────────────────────────────────────────────────────┐
-- │ Horodatage pris STRICTEMENT AU-DESSUS du dernier existant tous          │
-- │ worktrees confondus, et volontairement DÉCALÉ plutôt qu'incrémenté de   │
-- │ un : trois worktrees qui incrémentent en même temps retombent sur la    │
-- │ même valeur — c'est exactement la collision qui a bloqué les push.      │
-- │ Aucune autre migration n'est référencée ici par son numéro : le         │
-- │ renumérotage est une opération normale, un numéro cité vieillit mal.    │
-- └────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 0. GARDE DE PRÉREQUIS
--
-- Le webhook écrit l'abonnement sur `organizations`. Si cette migration était
-- appliquée sur une base où l'abonnement n'y a pas encore été remonté, le socle
-- serveur écrirait dans des colonnes inexistantes — et le ferait EN SILENCE,
-- puisque les clients Supabase du projet ne sont pas typés. On refuse tôt, avec
-- un message qui dit quoi faire.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_manque text[] := '{}';
  c text;
begin
  foreach c in array array[
    'package_id', 'package_valid_until', 'package_source_event_at',
    'stripe_customer_id', 'stripe_subscription_id', 'stripe_subscription_status'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'organizations' and column_name = c
    ) then
      v_manque := v_manque || c;
    end if;
  end loop;

  if array_length(v_manque, 1) is not null then
    raise exception
      'organizations ne porte pas encore l''abonnement (colonnes manquantes : %). '
      'Appliquer d''abord la migration qui remonte l''abonnement sur l''organisation, '
      'puis rejouer celle-ci.',
      array_to_string(v_manque, ', ');
  end if;
end
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. transactions — CE QUI EST OBLIGATOIRE, ET CE QUI NE L'EST PAS
--
-- ┌─ LE DÉBITEUR EST L'ORGANISATION. LE RESTE EST DU CONTEXTE. ─────────────┐
-- │ Une pièce comptable doit répondre à trois questions : QUI doit,         │
-- │ COMBIEN, et QUAND. `organization_id`, `amount` et les dates y           │
-- │ répondent. Tout le reste est du contexte utile — et un contexte utile   │
-- │ qu'on rend OBLIGATOIRE devient un contexte qu'on doit INVENTER.         │
-- │                                                                          │
-- │ Deux colonnes tombaient dans ce piège, pour la même raison.             │
-- └────────────────────────────────────────────────────────────────────────┘

-- ── 1.a user_id — la TRAÇABILITÉ, pas le débiteur ────────────────────────
--
-- Cas où elle manque légitimement :
--   · un abonnement créé À LA MAIN dans le tableau de bord Stripe pour un
--     grand compte pilote ne porte aucune métadonnée Skilloria ;
--   · un renouvellement automatique survient des mois après la souscription,
--     sans aucun utilisateur à l'origine de l'appel.
--
-- Avec NOT NULL, le webhook n'avait que de mauvais choix : refuser
-- d'enregistrer un paiement RÉEL (on perd une pièce comptable) ou inventer un
-- utilisateur (on falsifie une attribution). Les deux sont pires qu'un NULL.
--
-- Rien n'est affaibli côté conservation : le verrou est le trigger qui interdit
-- la SUPPRESSION d'une transaction livemode, et il ne bouge pas. La clé
-- étrangère reste en ON DELETE RESTRICT, et la purge RGPD anonymise en place
-- sans jamais supprimer.
alter table public.transactions
  alter column user_id drop not null;

comment on column public.transactions.user_id is
  'Personne ayant ENGAGÉ la dépense — TRAÇABILITÉ, pas le débiteur. Le débiteur '
  'est organization_id. NULL admis : un abonnement créé à la main dans le tableau '
  'de bord Stripe, ou un renouvellement automatique, n''ont légitimement aucun '
  'utilisateur à l''origine. Refuser d''enregistrer un paiement réel, ou inventer '
  'un utilisateur, serait pire. ON DELETE RESTRICT conservé : une ligne users '
  'désignée par une transaction ne peut pas être supprimée, et la purge RGPD '
  'anonymise en place sans jamais supprimer.';

-- ── 1.b domain_id — L'ÉCOSYSTÈME N'EST PLUS UNE PROPRIÉTÉ DU PAIEMENT ────
--
-- Cette colonne était NOT NULL du temps où un abonnement valait POUR UN
-- ÉCOSYSTÈME. Ce n'est plus le modèle : l'abonnement est UNIQUE et PARTAGÉ
-- entre tous les écosystèmes actifs. Une transaction n'a donc plus d'écosystème
-- au sens propre — tout au plus SAIT-ON parfois depuis lequel l'organisation
-- naviguait au moment de souscrire.
--
-- Et cette information disparaît au premier renouvellement : douze mois plus
-- tard, un prélèvement automatique ne vient d'aucune page, d'aucun écosystème,
-- d'aucun clic.
--
-- La garder obligatoire imposerait de la fabriquer — soit en lisant
-- `organization_domains`, dont le commentaire de table interdit explicitement de
-- tirer une décision, soit en prenant « le premier écosystème trouvé ». Écrire
-- une valeur choisie au hasard sur une pièce comptable de conservation décennale
-- n'est pas un moindre mal : c'est une donnée fausse, et elle a l'air vraie.
--
-- Elle devient donc FACULTATIVE et purement descriptive : renseignée quand le
-- parcours d'achat la connaît, nulle sinon. Exactement le même raisonnement que
-- pour `user_id` ci-dessus.
alter table public.transactions
  alter column domain_id drop not null;

comment on column public.transactions.domain_id is
  'Écosystème depuis lequel la souscription a été faite — CONTEXTE DESCRIPTIF, '
  'jamais une règle. L''abonnement est UNIQUE et PARTAGÉ entre tous les '
  'écosystèmes : une transaction n''appartient à aucun. NULL est le cas NORMAL '
  'd''un renouvellement automatique, qui ne vient d''aucune page. Ne JAMAIS s''en '
  'servir pour filtrer, facturer ou accorder un droit, et ne jamais la remplir '
  'depuis organization_domains — cette table est une trace historique qui '
  'n''alimente aucune décision.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. UN OBJET STRIPE NE DÉSIGNE QU'UNE SEULE OFFRE
--
-- Le webhook traduit le `price` d'un abonnement en offre du catalogue : c'est
-- ainsi que le catalogue local garde l'autorité, sans jamais lire un montant
-- chez Stripe. Cette traduction n'a de sens que si elle est UNIVOQUE.
--
-- Sans ces index, deux offres pourraient porter le même identifiant de prix
-- (copier-coller au back-office, synchronisation interrompue et rejouée) et le
-- webhook accorderait alors les droits de l'une ou de l'autre selon l'ordre de
-- lecture. Un tirage au sort sur des droits payés.
--
-- Index PARTIELS : la quasi-totalité des offres n'aura jamais d'identifiant
-- Stripe, et plusieurs NULL doivent rester permis.
create unique index if not exists idx_packages_stripe_product
  on public.packages (stripe_product_id)
  where stripe_product_id is not null;

create unique index if not exists idx_packages_stripe_price_monthly
  on public.packages (stripe_price_id_monthly)
  where stripe_price_id_monthly is not null;

-- La cadence annuelle est dormante (aucune offre ne la renseigne), mais
-- l'invariant est le même et le poser maintenant coûte une ligne. Le jour où
-- l'annuel s'ouvre, la garantie est déjà là.
create unique index if not exists idx_packages_stripe_price_yearly
  on public.packages (stripe_price_id_yearly)
  where stripe_price_id_yearly is not null;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. VÉRIFICATION FINALE — la migration se contrôle elle-même.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_manque text[] := '{}';
  v_nullable boolean;
  c text;
begin
  foreach c in array array['user_id', 'domain_id'] loop
    select is_nullable = 'YES' into v_nullable
      from information_schema.columns
     where table_schema = 'public' and table_name = 'transactions' and column_name = c;
    if v_nullable is distinct from true then
      v_manque := v_manque || format('transactions.%s encore NOT NULL', c);
    end if;
  end loop;

  if not exists (select 1 from pg_class where relname = 'idx_packages_stripe_price_monthly') then
    v_manque := v_manque || 'idx_packages_stripe_price_monthly';
  end if;
  if not exists (select 1 from pg_class where relname = 'idx_packages_stripe_product') then
    v_manque := v_manque || 'idx_packages_stripe_product';
  end if;

  -- Les garanties des fondations doivent TOUJOURS tenir : cette migration ne
  -- doit rien avoir desserré au passage.
  if not exists (select 1 from pg_constraint where conname = 'packages_default_must_be_free') then
    v_manque := v_manque || 'packages_default_must_be_free (fondations)';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'transactions_block_delete') then
    v_manque := v_manque || 'trigger transactions_block_delete (fondations)';
  end if;

  -- Et l'abonnement doit rester là où le moteur de droits le lit.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'organizations' and column_name = 'package_id'
  ) then
    v_manque := v_manque || 'organizations.package_id';
  end if;

  if array_length(v_manque, 1) is not null then
    raise exception 'Socle serveur Stripe incomplet : %', array_to_string(v_manque, ', ');
  end if;

  raise notice 'Socle serveur Stripe OK. Aucun encaissement ouvert : les deux verrous vivent dans le code.';
end
$$;
