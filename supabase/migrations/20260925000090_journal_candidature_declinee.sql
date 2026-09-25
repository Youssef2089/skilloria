-- ════════════════════════════════════════════════════════════════════════════
--  UNE CANDIDATURE DÉCLINÉE S'ÉCRIT AU GRAND LIVRE — LA TRANSITION ET SA
--  LIGNE DANS LA MÊME TRANSACTION, LES GARDES REJOUÉES DANS L'INSTRUCTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `app/api/candidatures/[id]/reject`
--  appelle `decliner_candidature()` dès ce commit. Rejouable.
--
--  La route lisait la candidature (cloisonnée, propriété vérifiée), jugeait la
--  transition, puis écrivait `rejected` avec les mêmes conditions en filtre —
--  et répondait 200 même quand ZÉRO ligne était touchée : une transition
--  devenue invalide entre la lecture et l'écriture passait pour un succès
--  (§E.27). Ici la transition, le cloisonnement (§D.3) et la propriété sont
--  rejoués dans l'UPDATE ; zéro ligne rend `false`, et rien n'est journalisé.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.decliner_candidature(
  p_piece            uuid,
  p_piece_origine    uuid,
  p_origine          text,
  p_acteur_id        uuid,
  p_acteur_type      text,
  p_candidature_id   uuid,
  p_domain_id        uuid,
  p_organization_id  uuid,
  p_reason           text,
  p_statuts_admis    text[]
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_publication uuid;
begin
  if p_piece is null then
    raise exception 'decliner_candidature : la piece est obligatoire' using errcode = 'GL002';
  end if;

  update public.candidatures c
     set status        = 'rejected',
         status_reason = p_reason
   where c.id = p_candidature_id
     and c.domain_id = p_domain_id
     and c.status = any (p_statuts_admis)
     and exists (select 1 from public.publications p
                  where p.id = c.publication_id and p.organization_id = p_organization_id)
  returning c.publication_id into v_publication;

  if v_publication is null then
    -- Transition devenue invalide, candidature hors écosystème ou hors
    -- organisation : rien n'a changé, rien ne s'écrit.
    return false;
  end if;

  perform public.journaliser(
    p_piece, 'candidature_declinee', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, p_domain_id,
    'candidatures', p_candidature_id,
    jsonb_build_object('publication_id', v_publication, 'has_reason', p_reason is not null),
    p_piece_origine, null::numeric, null::text);
  return true;
end;
$fn$;

revoke all on function public.decliner_candidature(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.decliner_candidature(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text, text[])
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['publication_id', 'has_reason']::text[]
 where code = 'candidature_declinee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles    text[];
  v_cand    uuid;
  v_domaine uuid;
  v_org     uuid;
  v_piece   uuid := gen_random_uuid();
  v_ok      boolean;
  v_ok2     boolean;
  v_lignes  integer;
begin
  if to_regprocedure('public.decliner_candidature(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text, text[])') is null then
    raise exception 'postcondition NON TENUE : decliner_candidature manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'candidature_declinee';
  if v_cles is null or not (v_cles @> array['publication_id', 'has_reason']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de candidature_declinee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — sur une candidature réelle en transition admise : déclinée, relue,
  -- journalisée ; rejouée, elle rend false et n'écrit rien. Base vierge : sautée, et dite.
  select c.id, c.domain_id, p.organization_id
    into v_cand, v_domaine, v_org
    from public.candidatures c
    join public.publications p on p.id = c.publication_id
   where c.status in ('received', 'in_review', 'shortlisted')
   limit 1;
  if v_cand is null then
    raise notice 'postcondition : sonde decliner_candidature SAUTEE — aucune candidature en transition admise (base vierge)';
  else
    begin
      v_ok := public.decliner_candidature(v_piece, null::uuid, 'utilisateur', null::uuid, null::text,
                                          v_cand, v_domaine, v_org, 'sonde', array['received', 'in_review', 'shortlisted']);
      if v_ok is distinct from true
         or not exists (select 1 from public.candidatures c where c.id = v_cand and c.status = 'rejected' and c.status_reason = 'sonde') then
        raise exception 'postcondition NON TENUE : la candidature n est pas declinee';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'candidature_declinee' and g.statut = 'reussi'
                        and g.sujet_type = 'candidatures' and g.sujet_id = v_cand and (g.detail ->> 'has_reason')::boolean) then
        raise exception 'postcondition NON TENUE : la ligne candidature_declinee manque ou ne porte pas son detail';
      end if;
      -- LE REJEU : transition désormais invalide — false, et aucune seconde ligne.
      v_ok2 := public.decliner_candidature(gen_random_uuid(), null::uuid, 'utilisateur', null::uuid, null::text,
                                           v_cand, v_domaine, v_org, 'sonde', array['received', 'in_review', 'shortlisted']);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'candidature_declinee' and g.sujet_id = v_cand;
      if v_ok2 is distinct from false or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : un rejeu a decline (%) ou journalise deux fois (% ligne(s))', v_ok2, v_lignes;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  raise notice 'postcondition tenue : candidature_declinee — la transition et sa ligne naissent ensemble, le rejeu n ecrit rien';
end
$post$;
