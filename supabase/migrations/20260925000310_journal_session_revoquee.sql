-- ════════════════════════════════════════════════════════════════════════════
--  UNE RÉVOCATION DE SESSIONS S'ÉCRIT AU GRAND LIVRE — LE GESTE DU TITULAIRE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `session_revoquee` ; l'écrivain est TypeScript
--  (`lib/comptes/journal-compte.ts`, motif « journal après écriture, même
--  pièce », §C.21 : la rotation est un helper partagé, pas une table).
--  Rejouable.
--
--  AUCUN DÉTAIL, ET C'EST UN CHOIX : il n'y a rien à dire de plus que le fait.
--  Le nombre de sessions tombées n'est connu de personne — le mécanisme est
--  une rotation de jeton, pas une liste d'appareils —, et l'inventer serait un
--  chiffre juste sous une étiquette fausse (§E.24). Un JETON n'entre jamais
--  ici : la sonde le vérifie.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array[]::text[]
 where code = 'session_revoquee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'session_revoquee';
  if v_cles is null or array_length(v_cles, 1) is not null then
    raise exception 'postcondition NON TENUE : session_revoquee devrait avoir une liste blanche VIDE [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit (aucun détail) est ACCEPTÉE, puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'session_revoquee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'users', gen_random_uuid(),
                               '{}'::jsonb,
                               null::uuid, null::numeric, null::text);
    if v_id is null then
      raise exception 'postcondition NON TENUE : session_revoquee n a pas ete ecrite';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un JETON est REFUSÉ (la liste blanche est vide : tout est refusé).
  begin
    perform public.journaliser(gen_random_uuid(), 'session_revoquee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'users', gen_random_uuid(),
                               '{"token":"ss_9f86d081884c7d659a2feaa0c55ad015"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un jeton est entre dans session_revoquee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : session_revoquee — liste blanche VIDE, le fait seul est accepte, un jeton est refuse';
end
$post$;
