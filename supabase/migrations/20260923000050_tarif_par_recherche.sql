-- ════════════════════════════════════════════════════════════════════════════
--  LE COMPTEUR COMPTE CE QU'ON PAIE : UNE RECHERCHE, PAS UN DOCUMENT.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement.
--    Elle n'ajoute que des colonnes et corrige des prix. Le code EN LIGNE ne
--    lit pas encore les nouvelles colonnes : il continue de compter au
--    document — donc de SOUS-ESTIMER, exactement comme aujourd'hui. Aucune
--    régression pendant le déploiement ; le correctif prend effet avec le code.
--
--    ⚠️ ET ELLE RETIRE LE PRIX PAR DOCUMENT DU RERANKER. Entre cette migration
--       et le déploiement, `coutUsd` ne trouve plus de tarif pour la forme
--       `unites` de ce modèle et rend `null` — l'appelant a déjà le chemin
--       « TARIF INCONNU », qui journalise la dépense en unités brutes sans
--       coût. C'est une sous-estimation VISIBLE pendant quelques minutes,
--       préférable à un prix faux qui, lui, ne se voit jamais.
--
--  ┌─ LE DÉFAUT, MESURÉ LE 23/09/2026 SUR LA BASE ───────────────────────────┐
--  │ `ai_model_tarifs` : rerank-v4.0-fast, usd_par_unite = 0,000002          │
--  │ `matching_settings` : rerank_batch_size = 200                            │
--  │                                                                          │
--  │ Un lot de 200 documents était donc compté 200 × 0,000002 = 0,0004 USD    │
--  │ — là où le fournisseur facture à la RECHERCHE.                           │
--  │                                                                          │
--  │ ET L'ÉCART DÉPEND D'UN RÉGLAGE, ce qui le rend insaisissable : il vaut   │
--  │ environ 10 pour des lots pleins, et dépasse 60 pour des lots d'une       │
--  │ quinzaine. Un facteur qui bouge avec un réglage n'est pas une erreur de  │
--  │ VALEUR, c'est une erreur d'UNITÉ — et aucune correction de chiffre ne    │
--  │ l'aurait fermée.                                                         │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  ═══ DEUX COLONNES, ET PAS UNE SEULE RÉINTERPRÉTÉE ══════════════════════
--    Réutiliser `usd_par_unite` en lui donnant le sens « par recherche » aurait
--    laissé toutes les lignes DÉJÀ ÉCRITES sous une étiquette devenue fausse :
--    un chiffre juste sous un mauvais label (§E.24). `usd_par_unite` garde donc
--    son sens — par DOCUMENT — et passe à NULL pour le reranker, qui ne produit
--    plus cette forme.
--
--  ═══ LES DEUX PRIX, ET D'OÙ ILS VIENNENT ════════════════════════════════
--    · `rerank-v4.0-fast` → 0,002 USD par unité de recherche. Valeur relevée
--      sur la grille Cohere par Youssef, le 23/09/2026.
--    · recherche WEB (outil natif Anthropic `web_search_20250305`) →
--      0,01 USD par recherche (grille Anthropic : 10 USD pour 1 000 recherches),
--      EN PLUS des jetons du même appel. Elles n'étaient comptées NULLE PART.
--
--    ⚠️ CES DEUX VALEURS SONT DES RELEVÉS DE GRILLE, pas des mesures de
--       facture. Elles vivent en base précisément pour ça : un tarif se corrige
--       depuis `/admin/tarifs-ia`, sans déploiement (§D.7). Et le code, lui, ne
--       les estime jamais — il lit ce que le fournisseur renvoie.
-- ─────────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════════
--  ① LES DEUX COLONNES
-- ════════════════════════════════════════════════════════════════════════════
alter table public.ai_model_tarifs
  add column if not exists usd_par_recherche numeric(12, 6),
  add column if not exists usd_par_recherche_web numeric(12, 6);

comment on column public.ai_model_tarifs.usd_par_unite is
  'Par DOCUMENT note. HISTORIQUE : plus aucun appel ne produit cette forme depuis '
  'le 23/09/2026. Conservee pour que les lignes deja ecrites restent recalculables.';

comment on column public.ai_model_tarifs.usd_par_recherche is
  'Par RECHERCHE — l unite que le reranker facture reellement. Le compteur comptait '
  'au DOCUMENT, et l ecart dependait de la taille du lot, donc d un reglage.';

comment on column public.ai_model_tarifs.usd_par_recherche_web is
  'Par recherche WEB, EN PLUS des jetons du meme appel (outil natif du fournisseur). '
  'Supplement, pas une forme : seule la forme JETONS peut le porter.';


-- ════════════════════════════════════════════════════════════════════════════
--  ② LA CONTRAINTE DE FORME APPREND LA TROISIÈME FORME
-- ════════════════════════════════════════════════════════════════════════════
--  ⚠️ SANS CE BLOC, TOUT CE QUI SUIT EST REFUSÉ. `ai_model_tarifs_forme_check`
--     exigeait EXACTEMENT une forme parmi deux ; retirer le prix par document
--     du reranker sans lui en donner un autre laisse la ligne sans aucune
--     forme, et la contrainte rejette l'`update`.
--
--     C'est le bon comportement (§E.31 : une garde qui est une contrainte ne
--     dépend d'aucune discipline) — et c'est exactement pour ça qu'on la met à
--     jour au lieu de la contourner.
--
--  LA FORME EST UNE PARTITION — une et une seule, jamais deux, jamais aucune.
--  Un tarif à moitié rempli produirait un coût NUL silencieux : c'est le défaut
--  que cette table existe pour fermer, et la troisième forme ne l'y rouvre pas.
--
--  ET `usd_par_recherche_web` N'EST PAS UNE FORME : c'est un SUPPLÉMENT. Seul
--  un modèle facturé aux jetons peut aussi chercher sur le web ; le porter sur
--  une autre forme serait un prix que rien ne peut consommer — un réglage mort
--  (§D.11), et pire : un réglage mort qui a l'air vivant parce qu'il est chiffré.
alter table public.ai_model_tarifs
  drop constraint if exists ai_model_tarifs_forme_check;

alter table public.ai_model_tarifs
  drop constraint if exists ai_model_tarifs_positifs_check;

--  Les prix sont corrigés AVANT que la contrainte ne soit reposée : elle est
--  alors posée VALIDÉE, et non `not valid`.
--  ⚠️ `NOT VALID` aurait été le piège §E.64 : il ne dispense que la validation
--     initiale — les lignes tolérées deviennent IMMUABLES, parce que tout
--     `update` les revérifie. Ici les données sont rendues conformes par la
--     migration elle-même, donc rien à tolérer.
update public.ai_model_tarifs
   set usd_par_recherche = 0.002,
       -- Elle ne gouverne plus rien pour ce modèle : la laisser renseignée
       -- ferait croire que le document reste une unité facturable.
       usd_par_unite = null,
       source = 'Grille Cohere — rerank-v4.0-fast, 0,002 USD par unite de recherche (releve du 23/09/2026)',
       updated_at = now()
 where model = 'rerank-v4.0-fast';

--  LE PRIX D'UNE RECHERCHE WEB, sur les modèles qui peuvent en faire.
--  Il est porté par le MODÈLE et non par le fournisseur, comme le reste de
--  cette grille : une seconde table « par fournisseur » serait une seconde
--  source de vérité pour la même question.
--
--  ⚠️ UN `update` CIBLÉ, PAS UN `upsert`. Ces lignes existent (mesuré le
--     23/09/2026) ; les recréer écraserait un tarif qu'un administrateur aurait
--     ajusté depuis `/admin/tarifs-ia` — ce que §D.7 interdit au seed.
update public.ai_model_tarifs
   set usd_par_recherche_web = 0.01,
       updated_at = now()
 where provider = 'claude'
   and usd_par_1m_entree is not null;

alter table public.ai_model_tarifs
  add constraint ai_model_tarifs_forme_check check (
    -- ① JETONS — et elle SEULE peut porter un supplément de recherche web.
    (
      usd_par_1m_entree is not null
      and usd_par_1m_sortie is not null
      and usd_par_unite is null
      and usd_par_recherche is null
    )
    or
    -- ② PAR DOCUMENT — historique, conservée pour les lignes déjà écrites.
    (
      usd_par_unite is not null
      and usd_par_1m_entree is null
      and usd_par_1m_sortie is null
      and usd_par_recherche is null
      and usd_par_recherche_web is null
    )
    or
    -- ③ PAR RECHERCHE — ce que le reranker facture réellement.
    (
      usd_par_recherche is not null
      and usd_par_1m_entree is null
      and usd_par_1m_sortie is null
      and usd_par_unite is null
      and usd_par_recherche_web is null
    )
  );

alter table public.ai_model_tarifs
  add constraint ai_model_tarifs_positifs_check check (
    coalesce(usd_par_1m_entree, 0) >= 0
    and coalesce(usd_par_1m_sortie, 0) >= 0
    and coalesce(usd_par_unite, 0) >= 0
    and coalesce(usd_par_recherche, 0) >= 0
    and coalesce(usd_par_recherche_web, 0) >= 0
  );


-- ════════════════════════════════════════════════════════════════════════════
--  POSTCONDITION — une migration qui « réussit » n'a rien prouvé (§E.60)
-- ════════════════════════════════════════════════════════════════════════════
--  ⚠️ ELLE ÉPROUVE LA CONTRAINTE, ELLE NE LA LIT PAS. Vérifier qu'une ligne
--     existe dans `pg_constraint` prouve qu'un nom est pris, pas qu'une règle
--     mord — c'est la famille de §E.7, transposée au schéma. Les quatre sondes
--     ci-dessous ÉCRIVENT dans une sous-transaction qui est systématiquement
--     défaite : `exception` en plpgsql ouvre un point de reprise, et rien de ce
--     qui s'y écrit ne survit au bloc.
do $post$
declare
  v_n integer;
  v_prix numeric;
  -- Une sonde tente l'écriture et rend `true` si la contrainte l'a REFUSÉE.
  -- Elle ne peut rien laisser derrière elle : le succès est retiré par un
  -- `delete`, l'échec par le point de reprise qu'ouvre le bloc `exception`.
  v_mord boolean;
begin
  -- ── Les deux colonnes existent, et elles sont NUMÉRIQUES ─────────────────
  --  Un texte se lirait en `Number('abc') = NaN`, et `NaN` traverse un calcul
  --  sans rien faire rougir.
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'ai_model_tarifs'
     and column_name in ('usd_par_recherche', 'usd_par_recherche_web')
     and data_type = 'numeric';
  if v_n <> 2 then
    raise exception 'postcondition NON TENUE : % colonne(s) numerique(s) au lieu de 2', v_n;
  end if;

  -- ── LE RERANKER A UN PRIX PAR RECHERCHE, et plus de prix par document ────
  select usd_par_recherche into v_prix
    from public.ai_model_tarifs where model = 'rerank-v4.0-fast';
  if v_prix is null then
    raise exception 'postcondition NON TENUE : le reranker n a pas de prix par recherche — son cout serait NULL, donc journalise sans montant';
  end if;
  if v_prix <> 0.002 then
    raise exception 'postcondition NON TENUE : prix par recherche du reranker = % au lieu de 0.002', v_prix;
  end if;

  select count(*) into v_n
    from public.ai_model_tarifs
   where model = 'rerank-v4.0-fast' and usd_par_unite is not null;
  if v_n <> 0 then
    raise exception 'postcondition NON TENUE : le reranker garde un prix par DOCUMENT — deux unites facturables pour un seul appel';
  end if;

  -- ── CHAQUE MODÈLE FACTURÉ AUX JETONS A UN PRIX DE RECHERCHE WEB ──────────
  --  Sans lui, un appel qui a cherché rend un cout NULL. C'est le bon
  --  comportement (un cout partiel est un cout FAUX), mais il signale une
  --  grille incomplete — autant la remplir maintenant.
  select count(*) into v_n
    from public.ai_model_tarifs
   where usd_par_1m_entree is not null and usd_par_recherche_web is null;
  if v_n <> 0 then
    raise exception 'postcondition NON TENUE : % modele(s) factures aux jetons sans prix de recherche web', v_n;
  end if;

  -- ══ LES QUATRE SONDES — LA CONTRAINTE MORD-ELLE ? ═══════════════════════

  -- ① Une ligne SANS AUCUNE forme doit être REFUSÉE.
  v_mord := false;
  begin
    insert into public.ai_model_tarifs (model, provider) values ('__sonde_sans_forme', 'claude');
  exception when check_violation then
    v_mord := true;
  end;
  if not v_mord then
    raise exception 'postcondition NON TENUE : une ligne SANS AUCUN prix est acceptee — elle produirait un cout nul silencieux';
  end if;

  -- ② Une ligne à DEUX formes doit être REFUSÉE.
  v_mord := false;
  begin
    insert into public.ai_model_tarifs (model, provider, usd_par_1m_entree, usd_par_1m_sortie, usd_par_recherche)
      values ('__sonde_deux_formes', 'claude', 1, 1, 0.002);
  exception when check_violation then
    v_mord := true;
  end;
  if not v_mord then
    raise exception 'postcondition NON TENUE : une ligne a DEUX formes est acceptee — le cout dependrait de l ordre de lecture';
  end if;

  -- ③ Un supplément de recherche WEB sur une forme qui n'est pas JETONS doit
  --    être REFUSÉ : rien ne pourrait le consommer.
  v_mord := false;
  begin
    insert into public.ai_model_tarifs (model, provider, usd_par_recherche, usd_par_recherche_web)
      values ('__sonde_web_hors_jetons', 'rerank', 0.002, 0.01);
  exception when check_violation then
    v_mord := true;
  end;
  if not v_mord then
    raise exception 'postcondition NON TENUE : un prix de recherche web est accepte hors de la forme JETONS — un reglage mort qui a l air vivant';
  end if;

  -- ④ ET LA TROISIÈME FORME EST BIEN ACCEPTÉE. Sans cette sonde, une
  --    contrainte qui refuse TOUT passerait les trois précédentes : elles ne
  --    testent qu'un sens (§E.34 — une assertion se retourne, elle ne se
  --    supprime pas).
  v_mord := false;
  begin
    insert into public.ai_model_tarifs (model, provider, usd_par_recherche)
      values ('__sonde_par_recherche', 'rerank', 0.002);
    -- Elle a été acceptée : on la retire tout de suite. Le point de reprise ne
    -- défait que les échecs, pas les succès.
    delete from public.ai_model_tarifs where model = '__sonde_par_recherche';
  exception when check_violation then
    v_mord := true;
  end;
  if v_mord then
    raise exception 'postcondition NON TENUE : la forme PAR RECHERCHE est refusee — la contrainte refuse tout, et les sondes precedentes ne le verraient pas';
  end if;

  -- Ceinture : aucune sonde ne survit. Les trois premières ont été défaites par
  -- leur point de reprise, la quatrieme par son `delete`.
  select count(*) into v_n
    from public.ai_model_tarifs
   where model in (
     '__sonde_sans_forme', '__sonde_deux_formes',
     '__sonde_web_hors_jetons', '__sonde_par_recherche'
   );
  if v_n <> 0 then
    raise exception 'postcondition NON TENUE : % ligne(s) de sonde survivent dans la grille tarifaire', v_n;
  end if;

  raise notice 'postcondition tenue : le compteur peut compter des recherches, et la contrainte mord dans les deux sens';
end
$post$;
