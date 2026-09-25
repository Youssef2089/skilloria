-- ════════════════════════════════════════════════════════════════════════════
--  L'ÉCHEC D'UNE RECHERCHE S'ÉCRIT AU GRAND LIVRE — SEPTIÈME ÉTAPE D'UN RUN :
--  L'ÉTAPE ET LA CAUSE, EN CODES, AU STATUT QUE LA BASE IMPOSE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `recherche_echouee` ; l'écrivain est TypeScript
--  (`lib/matching/journal-de-recherche.ts`). Rejouable.
--
--  Le détail porte l'étape (lecture, réglages, vivier, filtrage, notation,
--  correspondances), la cause (dix codes fermés — jamais le texte de la
--  panne), la tentative consommée (nulle avant le point de non-retour), et
--  pour la notation l'arrêt en code et les lots manqués. Le statut `echoue`
--  est imposé par la liste fermée.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['etape', 'cause', 'tentative', 'arret', 'lots_en_echec']::text[]
 where code = 'recherche_echouee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
  v_id2  bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'recherche_echouee';
  if v_cles is null or not (v_cles @> array['etape', 'cause', 'tentative', 'arret', 'lots_en_echec']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de recherche_echouee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit est ACCEPTÉE pour les DEUX
  -- sujets : une notation en échec avec sa tentative (annonce), une lecture en
  -- panne SANS tentative (expert) — puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'recherche_echouee', 'echoue', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('etape', 'notation', 'cause', 'lots_en_echec', 'tentative', 2, 'arret', null, 'lots_en_echec', 1),
                               null::uuid, null::numeric, null::text);
    v_id2 := public.journaliser(gen_random_uuid(), 'recherche_echouee', 'echoue', 'tache_planifiee',
                                null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                                jsonb_build_object('etape', 'lecture', 'cause', 'lecture_en_panne', 'tentative', null, 'arret', null, 'lots_en_echec', null),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : recherche_echouee n a pas ete ecrite pour les deux sujets';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un texte libre (le message de la panne) est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_echouee', 'echoue', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"etape":"lecture","cause":"lecture_en_panne","message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans recherche_echouee';
  exception when sqlstate 'GL004' then
    null;
  end;
  -- SONDE — un échec n'est pas une réussite : le statut « reussi » est REFUSÉ (GL003).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_echouee', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('etape', 'lecture', 'cause', 'introuvable', 'tentative', null, 'arret', null, 'lots_en_echec', null),
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : recherche_echouee a accepte le statut reussi';
  exception when sqlstate 'GL003' then
    null;
  end;
  raise notice 'postcondition tenue : recherche_echouee — liste blanche posee, forme du module acceptee pour les deux sujets, texte libre refuse, statut reussi refuse';
end
$post$;
