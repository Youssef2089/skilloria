-- ════════════════════════════════════════════════════════════════════════════
--  UN PROFIL MODIFIÉ S'ÉCRIT AU GRAND LIVRE — LES NOMS DES CHAMPS ET DES BLOCS
--  TOUCHÉS, JAMAIS LEUR CONTENU.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `profil_modifie` ; l'écrivain est TypeScript
--  (`lib/profil/journal-profil.ts`, appelé par la route de profil des DEUX
--  voies — motif « journal après écriture, même pièce », §C.21). Rejouable.
--
--  Le détail porte les NOMS des champs scalaires (identifiants de colonnes)
--  et des blocs (expériences, formations, langues) touchés. Un profil est fait
--  de données personnelles : rien de son contenu n'entre ici, et la sonde le
--  vérifie sur le résumé.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['champs', 'champs[]', 'blocs', 'blocs[]']::text[]
 where code = 'profil_modifie';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'profil_modifie';
  if v_cles is null or not (v_cles @> array['champs', 'champs[]', 'blocs', 'blocs[]']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de profil_modifie est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit est ACCEPTÉE, puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'profil_modifie', 'reussi', 'utilisateur',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               jsonb_build_object('champs', jsonb_build_array('title', 'skills'), 'blocs', jsonb_build_array('experiences')),
                               null::uuid, null::numeric, null::text);
    if v_id is null then
      raise exception 'postcondition NON TENUE : profil_modifie n a pas ete ecrite';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — le CONTENU d'un champ est REFUSÉ (la liste blanche tient) : seuls les noms passent.
  begin
    perform public.journaliser(gen_random_uuid(), 'profil_modifie', 'reussi', 'utilisateur',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               '{"champs":["summary"],"summary":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : le contenu d un champ est entre dans profil_modifie';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : profil_modifie — liste blanche posee, noms acceptes, contenu refuse';
end
$post$;
