-- ═══════════════════════════════════════════════════════════════════════════
-- LOT 1 STRIPE — CE QUE LE SOCLE SERVEUR EXIGE EN PLUS DES FONDATIONS
--
-- Deux ajustements seulement, tous deux imposés par l'écriture du webhook.
-- Aucun encaissement n'est ouvert par cette migration : les deux verrous
-- (clé scopée par environnement + ENABLE_BILLING) vivent dans le code.
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
-- 1. transactions.user_id DEVIENT FACULTATIF
--
-- ┌─ POURQUOI JE REVIENS SUR UNE DÉCISION DES FONDATIONS ───────────────────┐
-- │ La migration des fondations posait `user_id` NOT NULL en écrivant que    │
-- │ « forcer l'attribution est ce qu'on veut pour une pièce comptable ».     │
-- │ L'écriture du webhook a montré que c'est FAUX, et voici pourquoi.        │
-- │                                                                          │
-- │ Le DÉBITEUR est l'ORGANISATION : c'est elle qui doit la somme, et        │
-- │ `organization_id` la porte (NOT NULL de fait sur toute ligne écrite par  │
-- │ le webhook). `user_id` n'est pas le débiteur, c'est la TRAÇABILITÉ de    │
-- │ qui a engagé la dépense — et cette traçabilité peut légitimement être    │
-- │ inconnue :                                                               │
-- │                                                                          │
-- │   · un abonnement créé À LA MAIN depuis le tableau de bord Stripe pour   │
-- │     un grand compte pilote ne porte aucune métadonnée Skilloria ;        │
-- │   · un renouvellement automatique survient des mois après la             │
-- │     souscription, sans aucun utilisateur à l'origine de l'appel.         │
-- │                                                                          │
-- │ Avec NOT NULL, le webhook n'aurait eu que de mauvais choix : refuser     │
-- │ d'enregistrer un paiement RÉEL (on perd une pièce comptable), ou         │
-- │ inventer un utilisateur (on falsifie une attribution). Les deux sont     │
-- │ pires qu'une colonne nulle.                                              │
-- │                                                                          │
-- │ Rien n'est affaibli côté conservation : le verrou est le trigger qui     │
-- │ interdit la SUPPRESSION d'une transaction livemode, et il ne bouge pas.  │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- La clé étrangère reste en ON DELETE RESTRICT : tant qu'une transaction
-- désigne une personne, cette ligne `users` ne peut pas disparaître. Et la
-- purge RGPD anonymise en place sans jamais supprimer — la pièce comptable
-- reste intacte, rattachée à une personne anonymisée.
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
  v_user_nullable boolean;
begin
  select is_nullable = 'YES' into v_user_nullable
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'transactions'
     and column_name = 'user_id';

  if v_user_nullable is distinct from true then
    v_manque := v_manque || 'transactions.user_id encore NOT NULL';
  end if;

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

  if array_length(v_manque, 1) is not null then
    raise exception 'Socle serveur Stripe incomplet : %', array_to_string(v_manque, ', ');
  end if;

  raise notice 'Socle serveur Stripe OK. Aucun encaissement ouvert : les deux verrous vivent dans le code.';
end
$$;
