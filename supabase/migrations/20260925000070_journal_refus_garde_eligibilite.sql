-- ════════════════════════════════════════════════════════════════════════════
--  UN DÉPÔT REFUSÉ PAR UNE GARDE EST UN REFUS, ET IL S'ÉCRIT.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `refus_garde_eligibilite` ; l'écrivain est TypeScript
--  (`lib/candidatures/depot.ts`, motif « fait, après refus », §C.21). Rejouable.
--
--  Le refus porte sur l'ANNONCE ou sur le couple : pas mis en relation, déjà
--  postulé, annonce fermée ou d'un type qui ne se candidate pas, son propre
--  besoin, profil ou annonce introuvables. Le sujet est l'annonce visée,
--  l'expert est dans le détail, et le CODE est l'une des valeurs fermées de
--  `REFUS_DEPOT`. Une panne de lecture (5xx) n'est PAS un refus et ne
--  s'écrit pas : elle se réessaie.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['code', 'profile_id']::text[]
 where code = 'refus_garde_eligibilite';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'refus_garde_eligibilite';
  if v_cles is null or not (v_cles @> array['code', 'profile_id']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de refus_garde_eligibilite est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le code envoie est ACCEPTÉE, au statut imposé, puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'refus_garde_eligibilite', 'refuse', 'utilisateur',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('code', 'already_applied', 'profile_id', gen_random_uuid()),
                               null::uuid, null::numeric, null::text);
    if v_id is null then
      raise exception 'postcondition NON TENUE : refus_garde_eligibilite n a pas ete ecrit';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'refus_garde_eligibilite', 'refuse', 'utilisateur',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"code":"already_applied","message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans refus_garde_eligibilite';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : refus_garde_eligibilite — liste blanche posee, forme du code acceptee, texte libre refuse';
end
$post$;
