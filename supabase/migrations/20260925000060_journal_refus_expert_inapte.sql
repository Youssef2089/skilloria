-- ════════════════════════════════════════════════════════════════════════════
--  UN EXPERT QUI N'EST PAS EN ÉTAT DE POSTULER EST REFUSÉ, ET LE REFUS S'ÉCRIT.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `refus_expert_inapte` ; l'écrivain est TypeScript
--  (`lib/candidatures/depot.ts`, motif « fait, après refus », §C.21). Rejouable.
--
--  Le refus porte sur LUI (§D.21) : occupé, consentement retiré, profil non
--  visible ou non approuvé, compte suspendu. Il est posé AVANT toute dépense
--  et il se corrige d'un clic — le sujet est donc le profil, la raison est
--  l'une des valeurs fermées de `lib/matching/eligibilite.ts`, et l'annonce
--  visée est dans le détail. Aucune ligne métier n'est écrite : le refus
--  s'écrit seul, au statut que la base impose à sa famille.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['raison', 'publication_id']::text[]
 where code = 'refus_expert_inapte';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'refus_expert_inapte';
  if v_cles is null or not (v_cles @> array['raison', 'publication_id']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de refus_expert_inapte est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le code envoie est ACCEPTÉE, au statut imposé, puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'refus_expert_inapte', 'refuse', 'systeme',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               jsonb_build_object('raison', 'ne_pas_deranger', 'publication_id', gen_random_uuid()),
                               null::uuid, null::numeric, null::text);
    if v_id is null then
      raise exception 'postcondition NON TENUE : refus_expert_inapte n a pas ete ecrit';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'refus_expert_inapte', 'refuse', 'systeme',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               '{"raison":"ne_pas_deranger","message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans refus_expert_inapte';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : refus_expert_inapte — liste blanche posee, forme du code acceptee, texte libre refuse';
end
$post$;
