-- ════════════════════════════════════════════════════════════════════════════
--  LA SOUS-TRAITANCE S'ÉCRIT SOUS SON NOM — PUBLIÉE, ET POSTULÉE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent. Les deux signatures sont INCHANGÉES : le code
--  en ligne continue d'appeler les mêmes fonctions. Rejouable.
--
--  LE DÉFAUT : une sous-traitance est une publication (`type = 'sous_traitance'`,
--  publiée par un expert pour d'autres experts), et on y postule par le même
--  dépôt. Les deux gestes passaient donc par `publier_annonce()` et
--  `inserer_candidature_jugee()`, qui écrivaient `annonce_publiee` et
--  `candidature_deposee`. Les actions `sous_traitance_publiee` et
--  `sous_traitance_candidature` de la liste fermée n'avaient AUCUN écrivain,
--  alors que le fait avait lieu — et le filtre par type d'action de l'écran les
--  aurait rangées avec les annonces d'organisation.
--
--  LA FORME : celle de `changer_statut_compte()` — MÊME écrivain, code DÉRIVÉ.
--  Le code n'est pas un paramètre (un appelant ne peut pas se tromper de nom) :
--  il se lit sur le TYPE de la publication, que la fonction lit elle-même —
--  dans l'UPDATE pour la publication (`returning p.type`), par une lecture pour
--  la candidature. Un seul littéral de type, ici, dans les deux fonctions.
--
--  CE QUI NE CHANGE PAS : le corps des deux fonctions, ligne à ligne ; le
--  détail (les listes blanches des deux faces sont les mêmes que leur jumelle) ;
--  les autres gestes d'une sous-traitance (modifiée, dépubliée, expirée,
--  déclinée, retenue, dévoilée), qui gardent les codes des annonces — la liste
--  fermée ne distingue que la publication et la candidature.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.publier_annonce(
  p_piece            uuid,
  p_piece_origine    uuid,
  p_origine          text,
  p_acteur_id        uuid,
  p_acteur_type      text,
  p_publication_id   uuid,
  p_domain_id        uuid,
  p_organization_id  uuid,
  p_statuts_admis    text[],
  p_verdict          text,
  p_score            numeric,
  p_method           text,
  p_data             jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_p record;
begin
  if p_piece is null then
    raise exception 'publier_annonce : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_verdict not in ('published', 'pending_review') then
    raise exception 'publier_annonce : verdict inconnu « % »', p_verdict using errcode = '22023';
  end if;

  update public.publications p
     set status              = p_verdict,
         verification_score  = p_score,
         verification_method = p_method,
         verification_data   = p_data,
         published_at        = case when p_verdict = 'published' then now() else p.published_at end
   where p.id = p_publication_id
     and p.domain_id = p_domain_id
     and p.organization_id = p_organization_id
     and p.status = any (p_statuts_admis)
  returning p.id, p.type, p.status, p.published_at into v_p;
  if not found then
    return null;
  end if;

  if p_verdict = 'published' then
    perform public.journaliser(
      p_piece,
      case when v_p.type = 'sous_traitance' then 'sous_traitance_publiee' else 'annonce_publiee' end,
      'reussi', p_origine,
      p_acteur_id, p_acteur_type, p_domain_id,
      'publications', v_p.id,
      jsonb_build_object(
        'type', v_p.type,
        'organization_id', p_organization_id,
        'verification_method', p_method,
        'verification_score', p_score,
        'published_at', v_p.published_at),
      p_piece_origine, null::numeric, null::text);
  end if;

  return jsonb_build_object('id', v_p.id, 'status', v_p.status, 'published_at', v_p.published_at);
end;
$fn$;


create or replace function public.inserer_candidature_jugee(
  p_piece          uuid,
  p_piece_origine  uuid,
  p_origine        text,
  p_acteur_id      uuid,
  p_acteur_type    text,
  p_candidature    jsonb,
  p_origine_depot  text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_c          public.candidatures;
  v_id         uuid;
  v_status     text;
  v_created    timestamptz;
  v_tentatives integer;
  v_type       text;
begin
  if p_piece is null then
    raise exception 'inserer_candidature_jugee : la piece est obligatoire' using errcode = 'GL002';
  end if;
  v_c := jsonb_populate_record(null::public.candidatures, p_candidature);
  if v_c.publication_id is null or v_c.profile_id is null then
    raise exception 'inserer_candidature_jugee : annonce et profil sont obligatoires' using errcode = '22023';
  end if;

  insert into public.candidatures (
    id, publication_id, profile_id, match_id, domain_id, cover_message,
    ai_match_score, ai_assessment, ai_model, status, preview
  ) values (
    coalesce(v_c.id, gen_random_uuid()), v_c.publication_id, v_c.profile_id, v_c.match_id, v_c.domain_id, v_c.cover_message,
    v_c.ai_match_score, v_c.ai_assessment, v_c.ai_model, coalesce(v_c.status, 'received'), v_c.preview
  )
  on conflict (publication_id, profile_id) do nothing
  returning candidatures.id, candidatures.status, candidatures.created_at
    into v_id, v_status, v_created;

  if v_id is null then
    delete from public.candidature_depots d
     where d.publication_id = v_c.publication_id and d.profile_id = v_c.profile_id;
    return null;
  end if;

  update public.candidature_depots d
     set etat           = 'depose',
         cause          = null,
         detail         = null,
         cover_message  = null,
         candidature_id = v_id,
         termine_at     = now()
   where d.publication_id = v_c.publication_id and d.profile_id = v_c.profile_id
  returning d.tentatives into v_tentatives;

  -- LE TYPE DE LA PUBLICATION décide du nom de la ligne — lu ici, jamais reçu.
  select p.type into v_type from public.publications p where p.id = v_c.publication_id;

  perform public.journaliser(
    p_piece,
    case when v_type = 'sous_traitance' then 'sous_traitance_candidature' else 'candidature_deposee' end,
    'reussi', p_origine,
    p_acteur_id, p_acteur_type, v_c.domain_id,
    'candidatures', v_id,
    jsonb_build_object(
      'publication_id', v_c.publication_id,
      'profile_id', v_c.profile_id,
      'match_id', v_c.match_id,
      'ai_match_score', v_c.ai_match_score,
      'origine_depot', p_origine_depot,
      'tentative', v_tentatives),
    p_piece_origine, null::numeric, null::text);

  return jsonb_build_object('id', v_id, 'status', v_status, 'created_at', v_created);
end;
$fn$;


update public.grand_livre_actions
   set cles_detail = array['type', 'organization_id', 'verification_method', 'verification_score', 'published_at']::text[]
 where code = 'sous_traitance_publiee';
update public.grand_livre_actions
   set cles_detail = array['publication_id', 'profile_id', 'match_id', 'ai_match_score', 'origine_depot', 'tentative']::text[]
 where code = 'sous_traitance_candidature';


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui retypait un vrai brouillon en sous-traitance, le publiait et y faisait postuler un vrai
-- profil est retirée (28/09/2026) — la même forme que celle qui a arrêté le push de staging. Le geste —
-- sous-traitance publiée et postulée chacune sous SON nom et pas sous l'autre, mission sous le sien — est
-- prouvé par supabase/tests/database/grand_livre/sous_traitance.test.sql.
declare
  v_cles text[];
begin
  if to_regprocedure('public.publier_annonce(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[], text, numeric, text, jsonb)') is null
     or to_regprocedure('public.inserer_candidature_jugee(uuid, uuid, text, uuid, text, jsonb, text)') is null then
    raise exception 'postcondition NON TENUE : une des deux signatures a change';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'sous_traitance_publiee';
  if v_cles is null or array_length(v_cles, 1) <> 5 or not (v_cles @> array['type', 'published_at']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de sous_traitance_publiee est fausse [vu : %]', v_cles;
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'sous_traitance_candidature';
  if v_cles is null or array_length(v_cles, 1) <> 6 or not (v_cles @> array['publication_id', 'origine_depot', 'tentative']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de sous_traitance_candidature est fausse [vu : %]', v_cles;
  end if;
  raise notice 'postcondition tenue : sous-traitance — deux signatures par types, deux listes blanches exactes ; les gestes sont prouves par tests/database/grand_livre/sous_traitance.test.sql';
end
$post$;
