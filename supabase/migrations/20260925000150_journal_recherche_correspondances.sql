-- ════════════════════════════════════════════════════════════════════════════
--  LES CORRESPONDANCES D'UNE RECHERCHE S'ÉCRIVENT AU GRAND LIVRE — QUATRIÈME
--  ÉTAPE D'UN RUN : CE QUE LE FILTRE A RETENU, CE QUE LA BASE A FAIT.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `recherche_correspondances` ; l'écrivain est TypeScript
--  (`lib/matching/journal-de-recherche.ts`). Rejouable.
--
--  Le détail porte des COMPTES et les deux valeurs de réglage qui ont trié
--  (le filtre du flux, le palier des fortes), écrites avec la ligne : un
--  réglage qui change ne réécrit pas l'histoire. Jamais une note (§D.6).
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['retenues', 'fortes', 'inserees', 'mises_a_jour', 'supprimees', 'filtre_flux', 'palier_fort']::text[]
 where code = 'recherche_correspondances';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
  v_id2  bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'recherche_correspondances';
  if v_cles is null or not (v_cles @> array['retenues', 'fortes', 'inserees', 'mises_a_jour', 'supprimees', 'filtre_flux', 'palier_fort']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de recherche_correspondances est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit est ACCEPTÉE pour les DEUX sujets, puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'recherche_correspondances', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('retenues', 4, 'fortes', 1, 'inserees', 2, 'mises_a_jour', 2, 'supprimees', 0, 'filtre_flux', 5, 'palier_fort', 7.5),
                               null::uuid, null::numeric, null::text);
    v_id2 := public.journaliser(gen_random_uuid(), 'recherche_correspondances', 'reussi', 'tache_planifiee',
                                null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                                jsonb_build_object('retenues', 1, 'fortes', 0, 'inserees', 1, 'mises_a_jour', 0, 'supprimees', 1, 'filtre_flux', 5, 'palier_fort', 7.5),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : recherche_correspondances n a pas ete ecrite pour les deux sujets';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient) — et une NOTE individuelle aussi (§D.6).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_correspondances', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"retenues":4,"message":"texte libre","scores":[8.2]}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans recherche_correspondances';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : recherche_correspondances — liste blanche posee, forme du module acceptee pour les deux sujets, texte libre et notes refuses';
end
$post$;
