-- ════════════════════════════════════════════════════════════════════════════
--  UNE ANALYSE DE CV REFUSÉE PAR LE QUOTA EST UN REFUS, ET IL S'ÉCRIT.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `refus_quota_cv` ; l'écrivain est TypeScript (`lib/ai-quotas.ts`,
--  motif « fait, après refus », §C.21), appelé par les DEUX routes d'analyse
--  de CV avant leur 429. Rejouable.
--
--  Le sujet est le profil ; le détail porte le quota (valeur fermée), la
--  limite et la fenêtre LUES au moment du refus (un réglage qui change ne
--  réécrit pas l'histoire), la fin de fenêtre annoncée et le compte atteint.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['quota', 'limite', 'fenetre_heures', 'reset_at', 'compte']::text[]
 where code = 'refus_quota_cv';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'refus_quota_cv';
  if v_cles is null or not (v_cles @> array['quota', 'limite', 'fenetre_heures', 'reset_at', 'compte']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de refus_quota_cv est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le code envoie est ACCEPTÉE, au statut imposé, puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'refus_quota_cv', 'refuse', 'utilisateur',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               jsonb_build_object('quota', 'cv_parsing', 'limite', 3, 'fenetre_heures', 24, 'reset_at', now(), 'compte', 3),
                               null::uuid, null::numeric, null::text);
    if v_id is null then
      raise exception 'postcondition NON TENUE : refus_quota_cv n a pas ete ecrit';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'refus_quota_cv', 'refuse', 'utilisateur',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               '{"quota":"cv_parsing","message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans refus_quota_cv';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : refus_quota_cv — liste blanche posee, forme du code acceptee, texte libre refuse';
end
$post$;
