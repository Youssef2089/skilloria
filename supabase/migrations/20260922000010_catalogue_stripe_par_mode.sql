-- 20260922000010_catalogue_stripe_par_mode.sql
--
-- TEST ET PRODUCTION SONT DEUX CATALOGUES. LE MODE ENTRE DANS LA CLE.
--
-- ORDRE DE PASSAGE : AVANT le deploiement, ET LE CODE PART DANS LA FOULEE.
--   Elle SUPPRIME trois colonnes que le code en ligne lit encore (§G.4, cas 1).
--   Entre les deux, une lecture de `packages.stripe_price_id_monthly` echoue
--   avec 42703 : `resolvePackageByPrice` rendrait alors « lecture packages: … »,
--   c'est-a-dire un REFUS, jamais un faux droit. Le mur est de toute facon
--   ferme (ENABLE_BILLING absent) et rien n'encaisse : la fenetre est sans
--   consequence, mais elle doit etre courte.
--
-- ═══ CE QUE LA PLAGE DE NUMEROTATION DIT ════════════════════════════════════
--   Suffixe 0xxxxx = tronc (§G.2). La consigne orale « 1xxxxx » est precisement
--   celle que §G.2 declare FAUSSE et corrigee ; quatre migrations du tronc l'ont
--   enfreinte les 16 et 17/09, elles sont gelees nommement dans
--   diag-migration-donnees. On n'en ajoute pas une cinquieme.
--
-- ═══ LE DEFAUT QU'ELLE FERME ════════════════════════════════════════════════
--
--   Un identifiant de prix cree avec sk_test N'EXISTE PAS en mode live. Une
--   seule colonne par periode rendait donc le passage en production faux EN
--   SILENCE : le catalogue aurait paru relie, et le premier paiement reel
--   serait sorti « prix hors catalogue » — un paiement encaisse que rien dans
--   le produit ne sait rattacher a une offre.
--
--   Et il n'y avait AUCUN moyen de le voir : une colonne qui porte un
--   `price_...` ne dit pas dans quel mode il a ete cree.
--
-- ═══ POURQUOI UNE TABLE, ET PAS DEUX JEUX DE COLONNES ═══════════════════════
--
--   Les deux formes stockent la meme chose. Elles ne se trompent pas pareil.
--
--   · DEUX JEUX DE COLONNES (`..._test` / `..._live`) : un lecteur qui oublie
--     le suffixe compile, tourne, et lit L'AUTRE MODE. En silence. Les clients
--     Supabase ne sont pas types (§E.1) : la colonne est une CHAINE, personne
--     ne verifie rien.
--
--   · UNE TABLE CLEE (package_id, mode) : un lecteur qui oublie le mode ne lit
--     pas « l'autre », il en obtient DEUX. Le code doit trancher, donc il doit
--     savoir. Le mode cesse d'etre une discipline pour devenir une CLE (E.31).
--
--   C'est le meme arbitrage que celui du 22/09 sur l'empreinte des notes
--   (§D.15) : une garde qui est une cle ne depend d'aucune discipline.
--
-- ═══ POURQUOI ON SUPPRIME LES ANCIENNES COLONNES ════════════════════════════
--
--   Les garder ferait DEUX sources pour la meme chose, dont une sans mode.
--   C'est la double source de verite que tout le socle commerce evite.
--
--   ⚠️ ET ON NE LES SUPPRIME PAS EN CROYANT QU'ELLES SONT VIDES : ON VERIFIE.
--   La memoire dit « NULL sur les quatre offres », mesure par une lecture
--   HUMAINE le 20/09/2026 (§E.12 : aucun controle du depot ne peut la refaire).
--   Une mesure datee n'est pas une garantie. Le bloc ① ci-dessous LEVE si une
--   seule valeur existe, en nommant les offres : on ne peut pas deduire le mode
--   d'un identifiant deja pose, donc le reprendre serait deviner, et le jeter
--   serait perdre. Dans ce cas la migration s'arrete et demande un arbitrage.

begin;

-- ═══ ① LA VERIFICATION QUI CONDITIONNE TOUT LE RESTE ════════════════════════
do $$
declare
  v_offres text;
begin
  select string_agg(slug, ', ' order by slug) into v_offres
  from public.packages
  where stripe_product_id is not null
     or stripe_price_id_monthly is not null
     or stripe_price_id_yearly is not null;

  if v_offres is not null then
    raise exception
      'MIGRATION ARRETEE : des identifiants Stripe existent deja sur : %. '
      'Leur MODE (test ou live) n''est pas deductible — le reprendre serait '
      'deviner, le jeter serait perdre. Reportez-les a la main dans '
      'public.packages_stripe avec leur mode, puis relancez cette migration.',
      v_offres;
  end if;
end
$$;

-- ═══ ② LE CATALOGUE STRIPE, PAR MODE ════════════════════════════════════════
create table if not exists public.packages_stripe (
  package_id       uuid         not null references public.packages(id) on delete cascade,
  -- 'test' | 'live' : le mode de la CLE qui a cree ces objets. Jamais deduit.
  mode             text         not null,
  product_id       varchar(200) not null,
  price_id_monthly varchar(200),
  price_id_yearly  varchar(200),
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now(),
  primary key (package_id, mode),
  constraint packages_stripe_mode_check check (mode in ('test', 'live'))
);

-- Un objet Stripe appartient a UNE offre, DANS SON MODE. Les index portent donc
-- le mode : le meme identifiant ne peut pas exister deux fois dans un mode, et
-- deux modes ne se genent pas (ils ne partagent jamais un identifiant, mais
-- l'index n'a pas a le supposer).
create unique index if not exists idx_packages_stripe_product
  on public.packages_stripe (mode, product_id);

create unique index if not exists idx_packages_stripe_price_monthly
  on public.packages_stripe (mode, price_id_monthly)
  where price_id_monthly is not null;

create unique index if not exists idx_packages_stripe_price_yearly
  on public.packages_stripe (mode, price_id_yearly)
  where price_id_yearly is not null;

-- Lecture par identifiant de prix : c'est le chemin du webhook, qui filtre sur
-- (mode, price). Les deux index uniques ci-dessus le servent deja.

alter table public.packages_stripe enable row level security;

comment on table public.packages_stripe is
  'Objets Stripe miroirs d''une offre, PAR MODE (test / live). Un identifiant '
  'cree avec sk_test n''existe pas en live : une seule ligne par offre rendrait '
  'le passage en production faux en silence. Le mode est dans la CLE PRIMAIRE — '
  'un lecteur qui l''oublie obtient deux lignes, il ne lit pas l''autre mode '
  '(§E.31). Ecrit par la synchronisation sortante ; JAMAIS lu comme source de '
  'prix : le catalogue local fait autorite.';

comment on column public.packages_stripe.mode is
  'Mode de la cle Stripe qui a cree ces objets : ''test'' (sk_test_/rk_test_) ou '
  '''live''. Pose par le code depuis le prefixe de la cle en usage, jamais devine. '
  'Le webhook, lui, choisit le mode d''apres `event.livemode` — pas d''apres sa cle.';

comment on column public.packages_stripe.price_id_monthly is
  'Price Stripe courant pour la cadence mensuelle, DANS CE MODE. Les Price Stripe '
  'sont IMMUABLES : un changement de tarif cree un NOUVEAU Price et archive '
  'l''ancien, les abonnements en cours restant sur l''ancien (grand-pere tarifaire).';

comment on column public.packages_stripe.price_id_yearly is
  'Cadence annuelle — DORMANTE (decision produit n°4) : la colonne existe, la '
  'synchronisation ne la pousse pas.';

-- ═══ ③ LES ANCIENNES COLONNES S'EN VONT ═════════════════════════════════════
--   Le bloc ① a prouve qu'elles sont vides. La suppression est donc sans perte,
--   et elle est necessaire : deux sources pour une meme chose, dont une sans
--   mode, est exactement ce que cette migration ferme.
alter table public.packages
  drop column if exists stripe_product_id,
  drop column if exists stripe_price_id_monthly,
  drop column if exists stripe_price_id_yearly;

commit;
