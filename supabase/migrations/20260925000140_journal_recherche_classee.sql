-- ════════════════════════════════════════════════════════════════════════════
--  LE CLASSEMENT D'UNE RECHERCHE S'ÉCRIT AU GRAND LIVRE — AVEC CE QU'IL A PAYÉ,
--  DANS L'UNITÉ FACTURÉE, DANS LES COLONNES DE COÛT. TROISIÈME ÉTAPE D'UN RUN.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `recherche_classee` ; l'écrivain est TypeScript
--  (`lib/matching/journal-de-recherche.ts`). Rejouable.
--
--  Le détail porte le modèle, les comptes (notés, reprises, lots en échec),
--  l'arrêt en code, les unités facturées et leur source (§D.24 : lues chez le
--  fournisseur, ou comptées au plancher — et c'est DIT). Le coût, lui, va
--  dans `cout_usd` + `unite_facturee` : jamais dans le détail, et jamais à
--  zéro quand il est inconnu — la contrainte `grand_livre_cout_coherent`
--  tient les deux colonnes ensemble.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['model', 'notes', 'reprises', 'lots_en_echec', 'arret', 'recherches', 'unites_source']::text[]
 where code = 'recherche_classee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles  text[];
  v_id    bigint;
  v_id2   bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'recherche_classee';
  if v_cles is null or not (v_cles @> array['model', 'notes', 'reprises', 'lots_en_echec', 'arret', 'recherches', 'unites_source']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de recherche_classee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit est ACCEPTÉE pour les DEUX
  -- sujets : un coût connu avec son unité (annonce), un coût INCONNU sans coût
  -- ni unité (expert, un lot au plancher sans tarif) — les deux RELUS, puis annulés.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'recherche_classee', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('model', 'rerank-v3.5', 'notes', 3, 'reprises', 0, 'lots_en_echec', 0, 'arret', null, 'recherches', 1, 'unites_source', 'fournisseur'),
                               null::uuid, 0.0123::numeric, 'recherches');
    v_id2 := public.journaliser(gen_random_uuid(), 'recherche_classee', 'echoue', 'tache_planifiee',
                                null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                                jsonb_build_object('model', 'rerank-v3.5', 'notes', 2, 'reprises', 1, 'lots_en_echec', 1, 'arret', null, 'recherches', 1, 'unites_source', 'plancher'),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : recherche_classee n a pas ete ecrite pour les deux sujets';
    end if;
    if not exists (select 1 from public.grand_livre g where g.id = v_id and g.cout_usd = 0.0123 and g.unite_facturee = 'recherches' and g.detail ->> 'unites_source' = 'fournisseur') then
      raise exception 'postcondition NON TENUE : le cout et son unite ne sont pas relus sur la ligne du classement';
    end if;
    if not exists (select 1 from public.grand_livre g where g.id = v_id2 and g.cout_usd is null and g.unite_facturee is null and (g.detail ->> 'lots_en_echec')::int = 1) then
      raise exception 'postcondition NON TENUE : un cout inconnu doit s ecrire sans cout ni unite';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un coût SANS unité est REFUSÉ par la contrainte (23514) : les deux colonnes vont ensemble.
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_classee', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('model', 'rerank-v3.5', 'notes', 3, 'reprises', 0, 'lots_en_echec', 0, 'arret', null, 'recherches', 1, 'unites_source', 'fournisseur'),
                               null::uuid, 0.0123::numeric, null::text);
    raise exception 'postcondition NON TENUE : un cout sans unite est entre dans le grand livre';
  exception when sqlstate '23514' then
    null;
  end;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_classee', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"model":"rerank-v3.5","message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans recherche_classee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : recherche_classee — liste blanche posee, cout et unite relus, cout inconnu sans cout ni unite, cout sans unite refuse, texte libre refuse';
end
$post$;
