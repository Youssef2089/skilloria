-- ════════════════════════════════════════════════════════════════════════════
--  L'ABANDON D'UNE RECHERCHE S'ÉCRIT AU GRAND LIVRE — HUITIÈME ET DERNIÈRE
--  ÉTAPE D'UN RUN : APRÈS LA DERNIÈRE TENTATIVE, PLUS RIEN NE REJOUERA.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `recherche_abandonnee` ; l'écrivain est TypeScript
--  (`lib/matching/journal-de-recherche.ts`), qui décide l'abandon dans
--  l'écrivain de l'échec : tentative consommée ≥ plafond du sens. Rejouable.
--
--  Le détail porte les tentatives consommées, le plafond en vigueur (écrit
--  avec la ligne : un plafond qui change ne réécrit pas l'histoire) et la
--  cause du dernier échec. Le statut `echoue` est imposé par la liste fermée.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['tentatives', 'plafond', 'cause']::text[]
 where code = 'recherche_abandonnee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles  text[];
  v_id    bigint;
  v_id2   bigint;
  v_piece uuid := gen_random_uuid();
  v_sujet uuid := gen_random_uuid();
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'recherche_abandonnee';
  if v_cles is null or not (v_cles @> array['tentatives', 'plafond', 'cause']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de recherche_abandonnee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit est ACCEPTÉE pour les DEUX
  -- sujets ; et l'échec et l'abandon d'un MÊME run tiennent sous UNE pièce
  -- (deux types, un sujet : l'index d'unicité ne les confond pas) — puis annulé.
  begin
    perform public.journaliser(v_piece, 'recherche_echouee', 'echoue', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', v_sujet,
                               jsonb_build_object('etape', 'notation', 'cause', 'lots_en_echec', 'tentative', 5, 'arret', null, 'lots_en_echec', 1),
                               null::uuid, null::numeric, null::text);
    v_id := public.journaliser(v_piece, 'recherche_abandonnee', 'echoue', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', v_sujet,
                               jsonb_build_object('tentatives', 5, 'plafond', 5, 'cause', 'lots_en_echec'),
                               null::uuid, null::numeric, null::text);
    v_id2 := public.journaliser(gen_random_uuid(), 'recherche_abandonnee', 'echoue', 'tache_planifiee',
                                null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                                jsonb_build_object('tentatives', 5, 'plafond', 5, 'cause', 'reglages_absents'),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : recherche_abandonnee n a pas ete ecrite pour les deux sujets';
    end if;
    if (select count(*) from public.grand_livre g where g.piece = v_piece) <> 2 then
      raise exception 'postcondition NON TENUE : l echec et l abandon d un meme run ne tiennent pas sous une piece';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_abandonnee', 'echoue', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"tentatives":5,"plafond":5,"message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans recherche_abandonnee';
  exception when sqlstate 'GL004' then
    null;
  end;
  -- SONDE — un abandon n'est pas une réussite : le statut « reussi » est REFUSÉ (GL003).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_abandonnee', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('tentatives', 5, 'plafond', 5, 'cause', 'lots_en_echec'),
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : recherche_abandonnee a accepte le statut reussi';
  exception when sqlstate 'GL003' then
    null;
  end;
  raise notice 'postcondition tenue : recherche_abandonnee — liste blanche posee, forme du module acceptee pour les deux sujets sous la piece de l echec, texte libre refuse, statut reussi refuse';
end
$post$;
