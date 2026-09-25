-- ════════════════════════════════════════════════════════════════════════════
--  UNE RECHERCHE LANCÉE S'ÉCRIT AU GRAND LIVRE — UNE LIGNE PAR ÉTAPE DE RUN,
--  JAMAIS PAR LOT NI PAR PROFIL. PREMIÈRE ÉTAPE : LE LANCEMENT.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `recherche_lancee` ; l'écrivain est TypeScript
--  (`lib/matching/journal-de-recherche.ts`, le SEUL module des huit littéraux
--  `recherche_*`, appelé par les deux sens du moteur). Rejouable.
--
--  Le sujet est l'objet cherché — l'annonce dans un sens, le profil dans
--  l'autre : le type du sujet dit le sens, le détail ne le répète pas. Le
--  détail porte la tentative consommée (le compteur LU, pas estimé) et le nom
--  de la tâche planifiée quand c'en est une (null sinon).
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['tentative', 'tache']::text[]
 where code = 'recherche_lancee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
  v_id2  bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'recherche_lancee';
  if v_cles is null or not (v_cles @> array['tentative', 'tache']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de recherche_lancee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit est ACCEPTÉE pour les DEUX
  -- sujets (annonce, profil), puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'recherche_lancee', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('tentative', 1, 'tache', 'match_retry'),
                               null::uuid, null::numeric, null::text);
    v_id2 := public.journaliser(gen_random_uuid(), 'recherche_lancee', 'reussi', 'tache_planifiee',
                                null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                                jsonb_build_object('tentative', 1, 'tache', 'expert_relance'),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : recherche_lancee n a pas ete ecrite pour les deux sujets';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_lancee', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"tentative":1,"message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans recherche_lancee';
  exception when sqlstate 'GL004' then
    null;
  end;
  -- SONDE — un lancement n'est pas un refus : le statut « refuse » est REFUSÉ (GL003).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_lancee', 'refuse', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('tentative', 1, 'tache', null),
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : recherche_lancee a accepte le statut refuse';
  exception when sqlstate 'GL003' then
    null;
  end;
  raise notice 'postcondition tenue : recherche_lancee — liste blanche posee, forme du module acceptee pour les deux sujets, texte libre refuse, statut refuse refuse';
end
$post$;
