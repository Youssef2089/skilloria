-- 20260922000040_index_packages_stripe.sql
--
-- LES TROIS GARDES DE `packages_stripe` N'ONT JAMAIS EXISTE.
--
-- ORDRE DE PASSAGE : INDIFFERENT. Elle n'ajoute que des index sur une table
-- EPHEMERE-vide au moment ou elle passe (le catalogue n'est pas encore relie).
-- Elle peut passer avant ou apres le deploiement.
--
-- ═══ CE QUI S'EST PASSE, ET POURQUOI PERSONNE NE L'A VU ═════════════════════
--
--   `20260922000010_catalogue_stripe_par_mode` creait trois index sur la table
--   neuve `packages_stripe` :
--
--     create unique index IF NOT EXISTS idx_packages_stripe_product       ...
--     create unique index IF NOT EXISTS idx_packages_stripe_price_monthly ...
--     create unique index IF NOT EXISTS idx_packages_stripe_price_yearly  ...
--
--   CES TROIS NOMS ETAIENT DEJA PRIS. Ils designaient les index poses sur
--   `packages.stripe_*` par `20260910300000_stripe_socle_serveur`.
--
--   UN NOM D'INDEX EST UNIQUE PAR SCHEMA, PAS PAR TABLE. `if not exists` a donc
--   vu le nom pris, n'a RIEN fait, et n'a RIEN dit — un simple « already
--   exists, skipping » dans la sortie de db push. Puis, quelques lignes plus
--   bas, le `drop column` des anciennes colonnes a emporte les anciens index.
--
--   RESULTAT : `packages_stripe` n'a que sa cle primaire. Les trois garanties
--   ont disparu ENTRE DEUX INSTRUCTIONS DE LA MEME MIGRATION, et la migration a
--   « reussi ». Cela se reproduit a l'identique sur toute base vierge,
--   PRODUCTION COMPRISE : ce n'est pas un accident de recette.
--
-- ═══ CE QUE CES INDEX GARDENT — ET DEUX SUR TROIS SONT DES GARDES ═══════════
--
--   · PRIX MENSUEL et PRIX ANNUEL : ce sont des GARDES, et elles sont NOMMEES
--     comme telles dans la memoire du projet (docs/architecture.md §F) :
--     « Deux offres pour un meme price Stripe : le webhook tirerait au sort des
--     droits payes ». Sans l'unicite, `resolvePackageByPrice` peut trouver DEUX
--     lignes ; il refuse alors proprement — mais un abonnement REEL devient
--     irresolvable, et l'argent est deja encaisse. Une garde qui est une
--     contrainte ne depend d'aucune discipline (E.31) ; ici elle avait
--     simplement disparu.
--
--   · PRODUIT : garde aussi, d'une autre nature. Deux offres partageant un meme
--     Product Stripe rendraient le catalogue Stripe illisible, et la
--     recuperation par metadonnee de `ensureProduct` ambigue. Elle n'accorde
--     aucun droit : elle empeche un etat qu'on ne saurait plus demeler.
--
--   AUCUN DES TROIS N'EST UN INDEX DE PERFORMANCE. La table compte une ligne
--   par offre et par mode — quelques dizaines au plus.
--
-- ═══ LES NOMS SONT DISTINCTS, ET LE PREFIXE DIT CE QU'ILS SONT ══════════════
--
--   `uq_` plutot que `idx_` : ce sont des garanties d'UNICITE, pas des aides de
--   lecture. Et aucun de ces noms n'existe ailleurs dans l'historique.
--
-- ═══ PAS DE `IF NOT EXISTS`, ET C'EST LE CŒUR DU CORRECTIF ══════════════════
--
--   C'est precisement `if not exists` qui a transforme une COLLISION en
--   SILENCE. On le retire : si l'un de ces noms etait pris, la migration
--   ECHOUE, bruyamment, au lieu de sauter la creation.
--
--   Ce qu'on perd : la migration n'est plus rejouable telle quelle. Ce n'est
--   pas un probleme — une migration passe UNE fois, et `schema_migrations` le
--   garantit. Ce qu'on gagne : une collision ne peut plus etre muette.
--
--   ⚠️ ET ON NE FAIT PAS `drop index if exists` AVANT. Un nom d'index etant
--      unique par SCHEMA, un `drop` sur un nom qui appartiendrait a une AUTRE
--      table supprimerait l'index de cette autre table — c'est-a-dire la faute
--      d'aujourd'hui, en pire et sans retour.

begin;

-- ═══ ① LES TROIS GARDES, AVEC DES NOMS QUI N'APPARTIENNENT QU'A ELLES ═══════

-- Un Product Stripe appartient a UNE offre, DANS SON MODE.
create unique index uq_packages_stripe_produit_par_mode
  on public.packages_stripe (mode, product_id);

-- Un identifiant de prix designe UNE offre, DANS SON MODE. C'est la garde de
-- §F : sans elle, un abonnement reel peut devenir irresolvable.
create unique index uq_packages_stripe_prix_mensuel_par_mode
  on public.packages_stripe (mode, price_id_monthly)
  where price_id_monthly is not null;

-- La cadence annuelle est DORMANTE, mais l'invariant est le meme et le poser
-- maintenant coute une ligne.
create unique index uq_packages_stripe_prix_annuel_par_mode
  on public.packages_stripe (mode, price_id_yearly)
  where price_id_yearly is not null;

-- ═══ ② LA MIGRATION VERIFIE CE QU'ELLE A CREE ══════════════════════════════
--
--   Le motif existait DEJA, dans `20260910300000` : « VERIFICATION FINALE — la
--   migration se controle elle-meme ». Je ne l'avais pas repris, et c'est ce
--   qui a laisse la collision muette.
--
--   ⚠️ ET CELUI DE 20260910300000 N'AURAIT PAS SUFFI ICI. Il interroge
--      `pg_class where relname = '...'` SANS dire sur quelle table : il aurait
--      trouve l'index de `packages` et conclu que tout allait bien. On verifie
--      donc TROIS choses : le nom existe, il porte sur `packages_stripe`, et il
--      est UNIQUE — un index non unique ne garde rien.
do $$
declare
  v_manque text[] := '{}';
  n text;
begin
  foreach n in array array[
    'uq_packages_stripe_produit_par_mode',
    'uq_packages_stripe_prix_mensuel_par_mode',
    'uq_packages_stripe_prix_annuel_par_mode'
  ] loop
    if not exists (
      select 1
        from pg_index i
        join pg_class ic on ic.oid = i.indexrelid
        join pg_class tc on tc.oid = i.indrelid
        join pg_namespace nc on nc.oid = tc.relnamespace
       where ic.relname = n
         and tc.relname = 'packages_stripe'
         and nc.nspname = 'public'
         and i.indisunique
    ) then
      v_manque := v_manque || n;
    end if;
  end loop;

  -- La cle primaire porte le mode : c'est elle qui rend impossible une lecture
  -- qui ignorerait le mode (§D.17). Si elle manquait, tout le reste serait vain.
  if not exists (
    select 1 from pg_constraint
     where conname = 'packages_stripe_pkey' and contype = 'p'
  ) then
    v_manque := v_manque || 'packages_stripe_pkey';
  end if;

  if array_length(v_manque, 1) is not null then
    raise exception
      'MIGRATION ARRETEE : garde(s) absente(s) sur packages_stripe apres creation : %. '
      'Un nom d''index est unique PAR SCHEMA : verifiez qu''aucun de ces noms '
      'n''est deja pris par une autre table.',
      array_to_string(v_manque, ', ');
  end if;
end
$$;

commit;
