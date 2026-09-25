-- ════════════════════════════════════════════════════════════════════════════
--  UN MOT DE PASSE CHANGÉ S'ÉCRIT AU GRAND LIVRE — LE FAIT, ET RIEN D'AUTRE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `mot_de_passe_change` ; l'écrivain est TypeScript
--  (`lib/comptes/journal-compte.ts`, motif « journal après écriture, même
--  pièce » : le mot de passe vit chez Supabase Auth). Rejouable.
--
--  LISTE BLANCHE VIDE, comme `session_revoquee` : il n'y a rien à dire de plus
--  que le fait. Contrairement au changement d'adresse, la bascule est
--  IMMÉDIATE — pas d'étape à distinguer. Et une liste vide refuse TOUT : c'est
--  ce qui garantit qu'aucun mot de passe, aucune empreinte, aucune longueur ne
--  pourra jamais entrer ici, même par une clé au nom innocent.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array[]::text[]
 where code = 'mot_de_passe_change';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'mot_de_passe_change';
  if v_cles is null or array_length(v_cles, 1) is not null then
    raise exception 'postcondition NON TENUE : mot_de_passe_change devrait avoir une liste blanche VIDE [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit (aucun détail) est ACCEPTÉE, puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'mot_de_passe_change', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'users', gen_random_uuid(),
                               '{}'::jsonb,
                               null::uuid, null::numeric, null::text);
    if v_id is null then
      raise exception 'postcondition NON TENUE : mot_de_passe_change n a pas ete ecrite';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — la LONGUEUR du mot de passe est REFUSÉE : elle n'a l'air de rien,
  -- et elle réduit l'espace de recherche. La liste vide refuse tout.
  begin
    perform public.journaliser(gen_random_uuid(), 'mot_de_passe_change', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'users', gen_random_uuid(),
                               '{"longueur":14}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : la longueur du mot de passe est entree dans mot_de_passe_change';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : mot_de_passe_change — liste blanche VIDE, le fait seul accepte, la longueur refusee';
end
$post$;
