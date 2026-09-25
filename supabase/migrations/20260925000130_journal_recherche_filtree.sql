-- ════════════════════════════════════════════════════════════════════════════
--  LE FILTRAGE D'UNE RECHERCHE S'ÉCRIT AU GRAND LIVRE — DEUXIÈME ÉTAPE D'UN RUN.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `recherche_filtree` ; l'écrivain est TypeScript
--  (`lib/matching/journal-de-recherche.ts`). Rejouable.
--
--  Le détail porte des COMPTES, jamais un profil ni une annonce : éligibles,
--  sans matière, à noter ; côté annonce les écartés pour décision déjà prise
--  (décliné, déjà postulé) ; côté expert le nombre d'annonces chargées avant
--  le recoupement en mémoire. Une clé absente n'est pas envoyée.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['eligibles', 'sans_matiere', 'a_noter', 'ecartes_deja_decline', 'ecartes_deja_postule', 'chargees']::text[]
 where code = 'recherche_filtree';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
  v_id2  bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'recherche_filtree';
  if v_cles is null or not (v_cles @> array['eligibles', 'sans_matiere', 'a_noter', 'ecartes_deja_decline', 'ecartes_deja_postule', 'chargees']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de recherche_filtree est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit est ACCEPTÉE pour les DEUX
  -- sujets, avec les clés propres à chaque sens, puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'recherche_filtree', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('eligibles', 3, 'sans_matiere', 0, 'a_noter', 3, 'ecartes_deja_decline', 1, 'ecartes_deja_postule', 0),
                               null::uuid, null::numeric, null::text);
    v_id2 := public.journaliser(gen_random_uuid(), 'recherche_filtree', 'reussi', 'tache_planifiee',
                                null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                                jsonb_build_object('eligibles', 2, 'sans_matiere', 0, 'a_noter', 2, 'chargees', 5),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : recherche_filtree n a pas ete ecrite pour les deux sujets';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_filtree', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"eligibles":3,"message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans recherche_filtree';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : recherche_filtree — liste blanche posee, forme du module acceptee pour les deux sujets, texte libre refuse';
end
$post$;
