-- ════════════════════════════════════════════════════════════════════════════
--  LE GRAND LIVRE VOIT UN PLAFOND MORDRE — le fait, et chaque refus (§D.26).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : INDIFFÉRENT. Ne pose que les listes blanches de deux
--  actions déjà au catalogue ; le code qui les écrit (lib/ai-budget.ts) tolère
--  leur absence jusqu'au déploiement — un détail hors liste serait REFUSÉ
--  (GL004), jamais écrit à moitié. Rejouable.
--
--  · `refus_plafond_atteint` — statut imposé « refuse » : chaque fois que
--    `budgetDisponible()` refuse une dépense, par le plafond de l'acteur ou par
--    le plafond global. Le sujet est l'acteur imputé (organisation ou profil).
--  · `plafond_atteint` — le FAIT : un compte (ou un fournisseur) vient d'entrer
--    au plafond. Écrit UNE fois par acteur et par mois, au moment où la dépense
--    enregistrée franchit la ligne — c'est « où ça a cassé », avant le premier
--    refus.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['action', 'fournisseur', 'portee', 'depense_mois_usd', 'plafond_mensuel_usd']::text[]
 where code = 'refus_plafond_atteint';

update public.grand_livre_actions
   set cles_detail = array['action', 'fournisseur', 'portee', 'depense_mois_usd', 'plafond_mensuel_usd', 'mois']::text[]
 where code = 'plafond_atteint';

do $post$
declare
  v_cles text[];
  v_id   bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'refus_plafond_atteint';
  if v_cles is null or not (v_cles @> array['action', 'portee', 'plafond_mensuel_usd']::text[]) then
    raise exception 'postcondition NON TENUE : liste blanche de refus_plafond_atteint [vu : %]', v_cles;
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'plafond_atteint';
  if v_cles is null or not (v_cles @> array['mois', 'portee']::text[]) then
    raise exception 'postcondition NON TENUE : liste blanche de plafond_atteint [vu : %]', v_cles;
  end if;

  -- SONDE — un refus conforme s'écrit (statut impose), puis est annulé.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'refus_plafond_atteint', 'refuse', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'organizations', gen_random_uuid(),
                               '{"action":"matching_pool","fournisseur":"rerank","portee":"acteur","depense_mois_usd":25.1,"plafond_mensuel_usd":25}'::jsonb);
    if v_id is null then
      raise exception 'postcondition NON TENUE : refus_plafond_atteint non ecrit';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  raise notice 'postcondition tenue : refus_plafond_atteint et plafond_atteint ont leur liste blanche';
end
$post$;
