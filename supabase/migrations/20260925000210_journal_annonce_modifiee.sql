-- ════════════════════════════════════════════════════════════════════════════
--  UNE ANNONCE MODIFIÉE S'ÉCRIT AU GRAND LIVRE — LES CHAMPS TOUCHÉS, PAS LEUR
--  CONTENU.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `annonce_modifiee` ; l'écrivain est TypeScript
--  (`app/api/publications/[id]`, motif « journal après écriture, même
--  pièce », §C.21) : l'édition est un UPDATE dynamique (les champs que le
--  corps de la requête porte), qu'une RPC figée ne peut pas rejouer sans
--  recopier la liste des colonnes éditables. Rejouable.
--
--  Le détail porte les NOMS des champs modifiés (identifiants de colonnes),
--  jamais leur contenu — un titre ou une description est un texte libre — et
--  le statut de l'annonce au moment de l'édition.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['champs', 'champs[]', 'statut_annonce', 'organization_id']::text[]
 where code = 'annonce_modifiee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'annonce_modifiee';
  if v_cles is null or not (v_cles @> array['champs', 'champs[]', 'statut_annonce', 'organization_id']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de annonce_modifiee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que la route envoie est ACCEPTÉE, puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'annonce_modifiee', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               jsonb_build_object('champs', jsonb_build_array('title', 'skills_required'), 'statut_annonce', 'draft', 'organization_id', gen_random_uuid()),
                               null::uuid, null::numeric, null::text);
    if v_id is null then
      raise exception 'postcondition NON TENUE : annonce_modifiee n a pas ete ecrite';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — le CONTENU d'un champ est REFUSÉ (la liste blanche tient) : seuls les noms passent.
  begin
    perform public.journaliser(gen_random_uuid(), 'annonce_modifiee', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"champs":["title"],"title":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : le contenu d un champ est entre dans annonce_modifiee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : annonce_modifiee — liste blanche posee, noms de champs acceptes, contenu refuse';
end
$post$;
