-- ════════════════════════════════════════════════════════════════════════════
--  LES NOTIFICATIONS D'UNE RECHERCHE S'ÉCRIVENT AU GRAND LIVRE — CINQUIÈME
--  ÉTAPE D'UN RUN : CE QUE L'ENVOI A FAIT, PAS CE QU'ON LUI A DEMANDÉ.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `recherche_notifiee` ; l'écrivain est TypeScript
--  (`lib/matching/journal-de-recherche.ts`). Rejouable.
--
--  Le détail porte le bilan RENDU par l'envoi : demandées, déjà notifiées
--  (non renvoyées), posées (lignes écrites), paquets en échec, et le
--  renoncement (lecture de l'existant en échec : rien n'est parti). Le
--  statut est celui de l'étape : échoué dès que l'envoi a renoncé ou refusé.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['demandees', 'deja_notifiees', 'posees', 'paquets_en_echec', 'renonce']::text[]
 where code = 'recherche_notifiee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
  v_id2  bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'recherche_notifiee';
  if v_cles is null or not (v_cles @> array['demandees', 'deja_notifiees', 'posees', 'paquets_en_echec', 'renonce']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de recherche_notifiee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit est ACCEPTÉE pour les DEUX
  -- sujets : un envoi réussi (annonce), un envoi qui a RENONCÉ au statut
  -- échoué (expert) — puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'recherche_notifiee', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('demandees', 3, 'deja_notifiees', 1, 'posees', 2, 'paquets_en_echec', 0, 'renonce', false),
                               null::uuid, null::numeric, null::text);
    v_id2 := public.journaliser(gen_random_uuid(), 'recherche_notifiee', 'echoue', 'tache_planifiee',
                                null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                                jsonb_build_object('demandees', 2, 'deja_notifiees', 0, 'posees', 0, 'paquets_en_echec', 0, 'renonce', true),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : recherche_notifiee n a pas ete ecrite pour les deux sujets';
    end if;
    if not exists (select 1 from public.grand_livre g where g.id = v_id2 and g.statut = 'echoue' and (g.detail ->> 'renonce')::boolean = true and (g.detail ->> 'posees')::int = 0) then
      raise exception 'postcondition NON TENUE : le renoncement n est pas relu au statut echoue, zero posee';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'recherche_notifiee', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"demandees":3,"message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans recherche_notifiee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : recherche_notifiee — liste blanche posee, forme du module acceptee pour les deux sujets, renoncement relu, texte libre refuse';
end
$post$;
