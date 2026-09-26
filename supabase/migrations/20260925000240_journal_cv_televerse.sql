-- ════════════════════════════════════════════════════════════════════════════
--  UN CV TÉLÉVERSÉ S'ÉCRIT AU GRAND LIVRE — LE GESTE ENTIER, À SON ISSUE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `cv_televerse` ; l'écrivain est TypeScript
--  (`lib/profil/journal-profil.ts`, appelé par les DEUX voies d'analyse de CV
--  aux DEUX issues — motif « journal après écriture, même pièce », §C.21).
--  Rejouable.
--
--  Le détail porte la taille, l'issue de l'analyse (done, failed), le fait du
--  PREMIER consentement à l'analyse, et des comptes. JAMAIS l'empreinte du
--  fichier (elle identifie un contenu) ni son nom : la sonde le vérifie.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['octets', 'analyse', 'premier_consentement', 'experiences', 'formations', 'langues']::text[]
 where code = 'cv_televerse';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
  v_id2  bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'cv_televerse';
  if v_cles is null or not (v_cles @> array['octets', 'analyse', 'premier_consentement', 'experiences', 'formations', 'langues']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de cv_televerse est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — les deux formes que le module écrit sont ACCEPTÉES : l'analyse
  -- faite (statut reussi, comptes), l'analyse en échec (statut echoue, sans
  -- comptes) — puis annulées.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'cv_televerse', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               jsonb_build_object('octets', 184320, 'analyse', 'done', 'premier_consentement', true, 'experiences', 4, 'formations', 2, 'langues', 3),
                               null::uuid, null::numeric, null::text);
    v_id2 := public.journaliser(gen_random_uuid(), 'cv_televerse', 'echoue', 'systeme',
                                null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                                jsonb_build_object('octets', 184320, 'analyse', 'failed', 'premier_consentement', false),
                                null::uuid, null::numeric, null::text);
    if v_id is null or v_id2 is null then
      raise exception 'postcondition NON TENUE : cv_televerse n a pas ete ecrite pour les deux issues';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — l'EMPREINTE du fichier est REFUSÉE (la liste blanche tient) : elle identifie un contenu.
  begin
    perform public.journaliser(gen_random_uuid(), 'cv_televerse', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               '{"octets":184320,"analyse":"done","cv_hash":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : l empreinte du fichier est entree dans cv_televerse';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : cv_televerse — liste blanche posee, deux issues acceptees, empreinte refusee';
end
$post$;
