-- ════════════════════════════════════════════════════════════════════════════
--  UNE DISPONIBILITÉ BASCULÉE S'ÉCRIT AU GRAND LIVRE — LE CHAMP DE LA VOIE,
--  L'ÉTAT D'AVANT, L'ÉTAT D'APRÈS.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `disponibilite_basculee` ; l'écrivain est TypeScript
--  (`lib/profil/journal-profil.ts`, appelé par la route de profil des DEUX
--  voies — motif « journal après écriture, même pièce », §C.21). Rejouable.
--
--  Le détail porte le champ de la voie (`availability_status` en freelance,
--  `cdi_status` en CDI), l'état d'avant et l'état d'après — des codes. Jamais
--  une date de disponibilité ni un texte : la sonde le vérifie.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['champ', 'de', 'vers']::text[]
 where code = 'disponibilite_basculee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
  v_id2  bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'disponibilite_basculee';
  if v_cles is null or not (v_cles @> array['champ', 'de', 'vers']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de disponibilite_basculee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — les deux voies sont ACCEPTÉES sous leur champ (freelance : un état
  -- vers un autre ; CDI : depuis l'absence d'état), puis annulées.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'disponibilite_basculee', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               jsonb_build_object('champ', 'availability_status', 'de', 'available', 'vers', 'unavailable'),
                               null::uuid, null::numeric, null::text);
    v_id2 := public.journaliser(gen_random_uuid(), 'disponibilite_basculee', 'reussi', 'systeme',
                                null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                                jsonb_build_object('champ', 'cdi_status', 'de', null, 'vers', 'searching'),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : disponibilite_basculee n a pas ete ecrite pour les deux voies';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — une DATE de disponibilité est REFUSÉE (la liste blanche tient) : des codes, pas des dates.
  begin
    perform public.journaliser(gen_random_uuid(), 'disponibilite_basculee', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               '{"champ":"availability_status","de":"available","vers":"unavailable","availability_date":"2026-10-01"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : une date de disponibilite est entree dans disponibilite_basculee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : disponibilite_basculee — liste blanche posee, deux voies acceptees, date refusee ; le geste est ecrit par le TypeScript (lib/profil/journal-profil.ts) sous journaliser(), sa forme tenue par scripts/diag-grand-livre.mjs';
end
$post$;
