-- ════════════════════════════════════════════════════════════════════════════
--  UNE ANNONCE PUBLIÉE S'ÉCRIT AU GRAND LIVRE — LA MISE EN LIGNE, LE VERDICT
--  DE VÉRIFICATION ET LA LIGNE, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `app/api/publications/[id]/publish`
--  appelle `publier_annonce()` dès ce commit. Rejouable.
--
--  Le code écrivait le statut et le verdict en trois lignes, puis l'audit ; la
--  fonction pouvait être tuée entre les deux (le commentaire de la route le
--  dit). Ici la transition est REJOUÉE dans l'UPDATE — statut admis,
--  écosystème, organisation — et `published_at` est posé par la BASE quand
--  le verdict publie (il pilote l'expiration, calculée à la lecture ;
--  `expires_at` n'est toujours pas écrit). Zéro ligne touchée rend null :
--  la route répond 409, plus un 200 muet (§E.27).
--
--  UN VERDICT `pending_review` ÉCRIT LE VERDICT, PAS DE LIGNE : l'annonce
--  n'est pas en ligne, rien n'a été publié. Sa mise en ligne ultérieure,
--  si elle existe un jour, passera par ici et écrira sa ligne alors.
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
      p_piece, 'annonce_publiee', 'reussi', p_origine,
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

revoke all on function public.publier_annonce(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[], text, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.publier_annonce(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[], text, numeric, text, jsonb)
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['type', 'organization_id', 'verification_method', 'verification_score', 'published_at']::text[]
 where code = 'annonce_publiee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles   text[];
  v_pub    record;
  v_piece  uuid := gen_random_uuid();
  v_res    jsonb;
  v_res2   jsonb;
  v_lignes integer;
begin
  if to_regprocedure('public.publier_annonce(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[], text, numeric, text, jsonb)') is null then
    raise exception 'postcondition NON TENUE : publier_annonce manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'annonce_publiee';
  if v_cles is null or not (v_cles @> array['type', 'organization_id', 'verification_method', 'verification_score', 'published_at']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de annonce_publiee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — un brouillon réel : publié, `published_at` posé par la base, ligne
  -- relue ; rejoué (le statut n'est plus admis), null et aucune seconde ligne ;
  -- puis, sur le même brouillon remis à zéro, un verdict `pending_review` :
  -- verdict écrit, AUCUNE ligne. Sans brouillon : sautée, et dite.
  select p.id, p.domain_id, p.organization_id into v_pub
    from public.publications p
   where p.status = 'draft' and p.organization_id is not null
   limit 1;
  if v_pub.id is null then
    raise notice 'postcondition : sonde publier_annonce SAUTEE — aucun brouillon (base vierge)';
  else
    begin
      v_res := public.publier_annonce(v_piece, null::uuid, 'utilisateur', null::uuid, null::text,
                                      v_pub.id, v_pub.domain_id, v_pub.organization_id, array['draft'],
                                      'published', 8.5, 'ai_publication_quality', '{"score":8.5,"notes":"sonde","flags":[]}'::jsonb);
      if v_res is null or v_res ->> 'status' <> 'published' or (v_res ->> 'published_at') is null then
        raise exception 'postcondition NON TENUE : la mise en ligne n a pas abouti [%]', v_res;
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'annonce_publiee' and g.statut = 'reussi'
                        and g.sujet_type = 'publications' and g.sujet_id = v_pub.id
                        and g.ecosysteme_id = v_pub.domain_id
                        and g.detail ->> 'organization_id' = v_pub.organization_id::text
                        and (g.detail ->> 'verification_score')::numeric = 8.5
                        and g.detail ->> 'published_at' is not null) then
        raise exception 'postcondition NON TENUE : la ligne annonce_publiee manque ou ne porte pas son detail';
      end if;
      -- LE REJEU : le statut n'est plus admis, null, aucune seconde ligne.
      v_res2 := public.publier_annonce(gen_random_uuid(), null::uuid, 'utilisateur', null::uuid, null::text,
                                       v_pub.id, v_pub.domain_id, v_pub.organization_id, array['draft'],
                                       'published', 8.5, 'ai_publication_quality', '{}'::jsonb);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'annonce_publiee' and g.sujet_id = v_pub.id;
      if v_res2 is not null or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : le rejeu a publie ou journalise une seconde fois [% / % ligne(s)]', v_res2, v_lignes;
      end if;
      -- LE VERDICT QUI NE PUBLIE PAS : verdict écrit, aucune ligne.
      update public.publications set status = 'draft', published_at = null where id = v_pub.id;
      v_res2 := public.publier_annonce(gen_random_uuid(), null::uuid, 'utilisateur', null::uuid, null::text,
                                       v_pub.id, v_pub.domain_id, v_pub.organization_id, array['draft'],
                                       'pending_review', 4.0, 'ai_publication_quality', '{}'::jsonb);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'annonce_publiee' and g.sujet_id = v_pub.id;
      if v_res2 is null or v_res2 ->> 'status' <> 'pending_review' or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : pending_review n a pas ecrit le verdict, ou a journalise une publication [% / % ligne(s)]', v_res2, v_lignes;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'annonce_publiee', 'reussi', 'utilisateur',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"type":"mission","title":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans annonce_publiee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : annonce_publiee — mise en ligne et ligne naissent ensemble, le rejeu est null, pending_review n ecrit pas de ligne, texte libre refuse';
end
$post$;
