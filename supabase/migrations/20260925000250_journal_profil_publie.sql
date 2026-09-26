-- ════════════════════════════════════════════════════════════════════════════
--  UN PROFIL PUBLIÉ S'ÉCRIT AU GRAND LIVRE — PREMIÈRE PUBLICATION OU
--  REPUBLICATION, AVEC L'ÉTAT DE VÉRIFICATION D'AVANT.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `profil_publie` ; l'écrivain est TypeScript
--  (`lib/profil/journal-profil.ts`, appelé par la route de profil des DEUX
--  voies — motif « journal après écriture, même pièce », §C.21). Rejouable.
--
--  Le détail porte deux faits : le profil était-il déjà visible (republication)
--  et quel était son état de vérification avant la re-vérification que toute
--  (re)publication relance. JAMAIS un champ du profil : la sonde le vérifie.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['deja_visible', 'verification_avant']::text[]
 where code = 'profil_publie';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
  v_id2  bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'profil_publie';
  if v_cles is null or not (v_cles @> array['deja_visible', 'verification_avant']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de profil_publie est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la première publication (jamais vérifié) et la republication d'un
  -- profil approuvé sont ACCEPTÉES, puis annulées.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'profil_publie', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               jsonb_build_object('deja_visible', false, 'verification_avant', null),
                               null::uuid, null::numeric, null::text);
    v_id2 := public.journaliser(gen_random_uuid(), 'profil_publie', 'reussi', 'systeme',
                                null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                                jsonb_build_object('deja_visible', true, 'verification_avant', 'approved'),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : profil_publie n a pas ete ecrite pour les deux cas';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un champ du profil est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'profil_publie', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               '{"deja_visible":false,"title":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un champ du profil est entre dans profil_publie';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : profil_publie — liste blanche posee, premiere publication et republication acceptees, champ du profil refuse';
end
$post$;
