-- 20260922000030_offre_gratuite_explicite.sql
--
-- LA GRATUITE SE DIT, ELLE NE SE DEDUIT PLUS.
--
-- ORDRE DE PASSAGE : AVANT le deploiement, ET LE CODE PART DANS LA FOULEE.
--   Elle AJOUTE une colonne et DURCIT deux contraintes. Le code en ligne, qui
--   ne connait pas `is_free`, continue de lire et d'ecrire `packages` sans
--   erreur — sauf s'il tente d'ecrire un prix qui viole la nouvelle coherence,
--   ce qui est precisement ce qu'on veut interdire. La fenetre est donc sure
--   dans les deux ordres, mais courte vaut mieux que longue.
--
-- ═══ PLAGE DE NUMEROTATION : 0xxxxx, ET C'EST VOLONTAIRE ════════════════════
--   La consigne recue disait « 1xxxxx ». §G.2 declare cette plage FAUSSE et
--   corrigee : le tronc porte `0xxxxx`, et les quatre migrations qui ont
--   enfreint la regle les 16-17/09 sont gelees NOMMEMENT dans
--   diag-migration-donnees, qui rougit sur toute nouvelle occurrence. On n'en
--   ajoute pas une cinquieme.
--
-- ═══ LE DEFAUT QU'ELLE FERME ════════════════════════════════════════════════
--
--   La gratuite se DEDUISAIT du prix : « prix nul ou zero ⇒ gratuite ». C'est
--   exact, et c'est IMPLICITE — l'intention n'est ecrite nulle part.
--
--   Conséquence, et elle se paie en argent : UNE OFFRE PAYANTE SAISIE A 0 PAR
--   ERREUR SORTAIT DE LA VENTE EN SILENCE. Aucun refus, aucune alerte : elle
--   cessait simplement d'etre reliee a Stripe, et le premier client qui
--   voulait y souscrire ne pouvait plus. Dans l'autre sens, rien n'empechait
--   une offre declaree gratuite de porter un prix.
--
--   L'intention se DIT desormais, et la base garantit qu'elle et le prix ne se
--   contredisent jamais.
--
-- ═══ LES DEUX SENS, EN BASE ET PAS SEULEMENT A L'ECRAN ══════════════════════
--
--     gratuite      ⇒ prix mensuel ET annuel nuls
--     non gratuite  ⇒ au moins un prix strictement positif
--
--   Une offre payante a 0 et une offre gratuite avec un prix deviennent
--   IMPOSSIBLES A ECRIRE, quel que soit le chemin — l'ecran, une route, un
--   script, une main dans le tableau de bord Supabase. Une garde qui est une
--   contrainte ne depend d'aucune discipline (§E.31).
--
-- ═══ ET `packages_default_must_be_free` DEVIENT UN CAS DE CELLE-CI ══════════
--
--   Elle disait : « is_default ⇒ les deux prix sont nuls ». Elle dit desormais
--   « is_default ⇒ is_free », et la coherence ci-dessus se charge du reste.
--   Meme garantie, exprimee une seule fois. Le NOM est conserve : il est cite
--   dans la memoire du projet et dans les commentaires de colonnes, et le
--   renommer ferait mentir tout ce qui le cite (§E.16).

begin;

-- ═══ ① LA VERIFICATION QUI CONDITIONNE TOUT LE RESTE ════════════════════════
--   On derive l'intention du prix. Cette derivation n'est legitime que si le
--   prix est lui-meme coherent : sinon on inscrirait dans une colonne une
--   intention qu'on vient d'inventer.
--
--   DEUX ETATS SONT REFUSES, et nommement :
--     · une offre PAR DEFAUT qui porte un prix — elle contredit deja
--       `packages_default_must_be_free`, donc elle n'a pu naitre que par une
--       ecriture hors du produit ; la derivation ne saurait pas trancher entre
--       « gratuite comme son statut le dit » et « payante comme son prix le
--       dit » ;
--     · un prix NEGATIF — il viole deja la contrainte de positivite, et aucune
--       intention ne s'en deduit.
do $$
declare
  v_defaut_payante text;
  v_negatives      text;
begin
  select string_agg(slug, ', ' order by slug) into v_defaut_payante
  from public.packages
  where is_default
    and (coalesce(price_monthly, 0) > 0 or coalesce(price_yearly, 0) > 0);

  if v_defaut_payante is not null then
    raise exception
      'MIGRATION ARRETEE : offre(s) PAR DEFAUT portant un prix : %. Le statut dit '
      'gratuite, le prix dit payante — on ne peut pas deviner laquelle est '
      'l''intention. Corrigez le prix ou le statut, puis relancez.',
      v_defaut_payante;
  end if;

  select string_agg(slug, ', ' order by slug) into v_negatives
  from public.packages
  where coalesce(price_monthly, 0) < 0 or coalesce(price_yearly, 0) < 0;

  if v_negatives is not null then
    raise exception
      'MIGRATION ARRETEE : prix NEGATIF sur : %. Aucune intention ne se deduit '
      'd''un prix negatif.', v_negatives;
  end if;
end
$$;

-- ═══ ② LA COLONNE, ET SON REMPLISSAGE DEPUIS LE PRIX ════════════════════════
--   `default false` puis remplissage : une offre dont on n'a pas encore etabli
--   l'intention serait declaree PAYANTE, ce qui est le defaut le plus sur —
--   une offre payante ne peut pas etre souscrite sans prix Stripe, tandis
--   qu'une offre declaree gratuite par erreur s'offrirait a tout le monde.
alter table public.packages
  add column if not exists is_free boolean not null default false;

update public.packages
   set is_free = true
 where coalesce(price_monthly, 0) = 0
   and coalesce(price_yearly, 0) = 0;

comment on column public.packages.is_free is
  'L''offre est-elle GRATUITE ? C''est une INTENTION DECLAREE, pas une deduction '
  'du prix. Coche => les deux prix sont nuls ; decochee => au moins un prix '
  'strictement positif (contrainte packages_gratuite_coherente, dans les deux '
  'sens). C''est cette colonne, et non le prix, que lit lib/billing/vendabilite.ts : '
  'une offre payante saisie a 0 par erreur est desormais REFUSEE au lieu de sortir '
  'de la vente en silence. Une offre gratuite ne passe JAMAIS par Stripe — ni '
  'synchronisation, ni paiement.';

-- ═══ ③ LA COHERENCE, DANS LES DEUX SENS ════════════════════════════════════
alter table public.packages
  drop constraint if exists packages_gratuite_coherente;

alter table public.packages
  add constraint packages_gratuite_coherente check (
    (is_free
      and coalesce(price_monthly, 0) = 0
      and coalesce(price_yearly, 0) = 0)
    or
    (not is_free
      and (coalesce(price_monthly, 0) > 0 or coalesce(price_yearly, 0) > 0))
  );

-- ═══ ④ LE DEFAUT EST UN CAS DE GRATUITE ════════════════════════════════════
--   Meme garantie qu'avant, exprimee UNE fois : la coherence ci-dessus impose
--   deja les prix nuls a toute offre `is_free`.
alter table public.packages
  drop constraint if exists packages_default_must_be_free;

alter table public.packages
  add constraint packages_default_must_be_free check (
    is_default = false or is_free
  );

commit;
