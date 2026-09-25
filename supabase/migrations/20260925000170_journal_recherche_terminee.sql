-- ════════════════════════════════════════════════════════════════════════════
--  LA FIN D'UNE RECHERCHE S'ÉCRIT AU GRAND LIVRE — SIXIÈME ÉTAPE D'UN RUN :
--  L'ISSUE, FERMÉE, AU STATUT QUE LA BASE IMPOSE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `recherche_terminee` ; l'écrivain est TypeScript
--  (`lib/matching/journal-de-recherche.ts`). Rejouable.
--
--  Le détail porte l'issue (ok, vivier vide, annonce expirée, inéligible,
--  profil sans matière) et, pour l'inéligibilité seule, la raison en CODE.
--  Une recherche terminée sur un refus légitime s'est bien TERMINÉE : le
--  statut `reussi` est imposé par la liste fermée ; ce qui a échoué s'écrit
--  `recherche_echouee`.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['issue', 'raison']::text[]
 where code = 'recherche_terminee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
  v_id2  bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'recherche_terminee';
  if v_cles is null or not (v_cles @> array['issue', 'raison']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de recherche_terminee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit est ACCEPTÉE pour les DEUX
  -- sujets : une fin « ok » (annonce), une fin « inéligible » avec sa raison
  -- (expert) — puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'recherche_terminee', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('issue', 'ok', 'raison', null),
                               null::uuid, null::numeric, null::text);
    v_id2 := public.journaliser(gen_random_uuid(), 'recherche_terminee', 'reussi', 'tache_planifiee',
                                null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                                jsonb_build_object('issue', 'ineligible', 'raison', 'ne_pas_deranger'),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : recherche_terminee n a pas ete ecrite pour les deux sujets';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_terminee', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"issue":"ok","message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans recherche_terminee';
  exception when sqlstate 'GL004' then
    null;
  end;
  -- SONDE — une fin n'est pas un échec : le statut « echoue » est REFUSÉ (GL003).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_terminee', 'echoue', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('issue', 'ok', 'raison', null),
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : recherche_terminee a accepte le statut echoue';
  exception when sqlstate 'GL003' then
    null;
  end;
  raise notice 'postcondition tenue : recherche_terminee — liste blanche posee, forme du module acceptee pour les deux sujets, texte libre refuse, statut echoue refuse';
end
$post$;
