-- ════════════════════════════════════════════════════════════════════════════
--  UNE SUPPRESSION ANNULÉE S'ÉCRIT AU GRAND LIVRE — LE COMPTE REVIENT, ET LA
--  VISIBILITÉ NE REVIENT PAS TOUJOURS AVEC LUI.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `suppression_annulee` ; l'écrivain est TypeScript
--  (`lib/comptes/journal-compte.ts`, motif « journal après écriture, même
--  pièce », §C.21 : la réactivation est un enchaînement — profil, instantané
--  de visibilité, compte — qu'aucune fonction figée ne rejouerait sans
--  recopier la règle de complétude). Rejouable.
--
--  LE DÉTAIL PORTE CE QUI SE DÉCIDE : le compte revient toujours ; la
--  visibilité du profil, elle, ne revient QUE si elle était acquise avant la
--  suppression ET que le profil est encore complet. Écrire l'un sans l'autre
--  laisserait croire qu'un expert réactivé est de nouveau visible alors qu'il
--  ne l'est pas — un chiffre juste sous une étiquette fausse (§E.24).
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['visibilite_restauree', 'avait_un_profil']::text[]
 where code = 'suppression_annulee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
  v_id2  bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'suppression_annulee';
  if v_cles is null or not (v_cles @> array['visibilite_restauree', 'avait_un_profil']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de suppression_annulee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — les deux formes que le module écrit : un expert dont la visibilité
  -- revient, et un compte sans profil (organisation) — puis annulées.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'suppression_annulee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'expert_freelance', null::uuid, 'users', gen_random_uuid(),
                               jsonb_build_object('visibilite_restauree', true, 'avait_un_profil', true),
                               null::uuid, null::numeric, null::text);
    v_id2 := public.journaliser(gen_random_uuid(), 'suppression_annulee', 'reussi', 'utilisateur',
                                gen_random_uuid(), 'client', null::uuid, 'users', gen_random_uuid(),
                                jsonb_build_object('visibilite_restauree', false, 'avait_un_profil', false),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : suppression_annulee n a pas ete ecrite pour les deux cas';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — la LISTE DES CHAMPS MANQUANTS est REFUSÉE : elle décrit un profil.
  begin
    perform public.journaliser(gen_random_uuid(), 'suppression_annulee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'expert_freelance', null::uuid, 'users', gen_random_uuid(),
                               '{"visibilite_restauree":false,"missing":["summary","skills"]}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : la liste des champs manquants est entree dans suppression_annulee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : suppression_annulee — liste blanche posee, les deux cas acceptes, la liste des champs manquants refusee ; le geste est ecrit par le TypeScript (lib/comptes/journal-compte.ts) sous journaliser(), sa forme tenue par scripts/diag-grand-livre.mjs';
end
$post$;
