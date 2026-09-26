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


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
--  Sur un brouillon réel, rendu tour à tour sous-traitance et mission dans la
--  sous-transaction annulée : chaque type écrit SON code, et pas l'autre.
do $post$
declare
  v_cles   text[];
  v_pub    record;
  v_prof   record;
  v_p1     uuid := gen_random_uuid();
  v_p2     uuid := gen_random_uuid();
  v_p3     uuid := gen_random_uuid();
  v_res    jsonb;
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

  select p.id, p.domain_id, p.organization_id into v_pub
    from public.publications p
   where p.status = 'draft' and p.organization_id is not null
   limit 1;
  select pr.id, pr.domain_id into v_prof
    from public.profiles pr
   where v_pub.id is not null
     and not exists (select 1 from public.candidatures c where c.publication_id = v_pub.id and c.profile_id = pr.id)
     and not exists (select 1 from public.candidature_depots d where d.publication_id = v_pub.id and d.profile_id = pr.id)
   limit 1;
  if v_pub.id is null or v_prof.id is null then
    raise notice 'postcondition : sonde sous-traitance SAUTEE — aucun brouillon ou aucun profil libre (base vierge)';
  else
    begin
      -- UNE SOUS-TRAITANCE PUBLIÉE : sous son nom.
      update public.publications set type = 'sous_traitance' where id = v_pub.id;
      v_res := public.publier_annonce(v_p1, null::uuid, 'systeme', null::uuid, null::text,
                                      v_pub.id, v_pub.domain_id, v_pub.organization_id, array['draft'],
                                      'published', 8.0, 'sonde', '{}'::jsonb);
      if v_res is null
         or not exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'sous_traitance_publiee'
                         and g.sujet_id = v_pub.id and g.detail ->> 'type' = 'sous_traitance')
         or exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'annonce_publiee') then
        raise exception 'postcondition NON TENUE : la sous-traitance publiee ne s ecrit pas sous son nom [%]', v_res;
      end if;
      -- UNE CANDIDATURE À CETTE SOUS-TRAITANCE : sous son nom.
      v_res := public.inserer_candidature_jugee(v_p2, null::uuid, 'systeme', null::uuid, null::text,
        jsonb_build_object('publication_id', v_pub.id, 'profile_id', v_prof.id, 'domain_id', v_prof.domain_id,
                           'ai_match_score', 7, 'ai_assessment', jsonb_build_object('reason', 'sonde', 'pitch_org', 'sonde', 'model', 'sonde'),
                           'ai_model', 'sonde', 'status', 'received', 'preview', '{}'::jsonb),
        'sonde');
      if v_res is null
         or not exists (select 1 from public.grand_livre g where g.piece = v_p2 and g.type_action = 'sous_traitance_candidature'
                         and g.sujet_id = (v_res ->> 'id')::uuid and g.detail ->> 'publication_id' = v_pub.id::text)
         or exists (select 1 from public.grand_livre g where g.piece = v_p2 and g.type_action = 'candidature_deposee') then
        raise exception 'postcondition NON TENUE : la candidature a une sous-traitance ne s ecrit pas sous son nom [%]', v_res;
      end if;
      -- UNE MISSION : le nom d'une annonce, pas celui d'une sous-traitance.
      update public.publications set type = 'mission', status = 'draft', published_at = null where id = v_pub.id;
      v_res := public.publier_annonce(v_p3, null::uuid, 'systeme', null::uuid, null::text,
                                      v_pub.id, v_pub.domain_id, v_pub.organization_id, array['draft'],
                                      'published', 8.0, 'sonde', '{}'::jsonb);
      if v_res is null
         or not exists (select 1 from public.grand_livre g where g.piece = v_p3 and g.type_action = 'annonce_publiee')
         or exists (select 1 from public.grand_livre g where g.piece = v_p3 and g.type_action = 'sous_traitance_publiee') then
        raise exception 'postcondition NON TENUE : une mission s ecrit sous le nom d une sous-traitance [%]', v_res;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  raise notice 'postcondition tenue : sous-traitance — publiee et postulee sous leur nom, une mission sous le sien';
end
$post$;
