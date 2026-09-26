-- ════════════════════════════════════════════════════════════════════════════
--  UNE CANDIDATURE RETENUE S'ÉCRIT AU GRAND LIVRE — LA TRANSITION ET SA
--  LIGNE DANS LA MÊME TRANSACTION, LES GARDES REJOUÉES DANS L'INSTRUCTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `app/api/candidatures/[id]/select`
--  appelle `retenir_candidature()` dès ce commit. Rejouable.
--
--  Même forme que `decliner_candidature()` (§C.21) : la transition, le
--  cloisonnement (§D.3) et la propriété sont rejoués dans l'UPDATE ; zéro
--  ligne rend NULL, rien n'est journalisé — la route répond 409 là où elle
--  disait 200 en silence (§E.27). `selected_at` est posé par la base, et rendu
--  à la route. `selected` est ACTIF sans limite de durée (§D.5) : c'est l'issue
--  positive du parcours, la relation commerciale existe.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.retenir_candidature(
  p_piece            uuid,
  p_piece_origine    uuid,
  p_origine          text,
  p_acteur_id        uuid,
  p_acteur_type      text,
  p_candidature_id   uuid,
  p_domain_id        uuid,
  p_organization_id  uuid,
  p_statuts_admis    text[]
) returns timestamptz
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_selected_at timestamptz;
  v_publication uuid;
  v_profile     uuid;
  v_type        text;
begin
  if p_piece is null then
    raise exception 'retenir_candidature : la piece est obligatoire' using errcode = 'GL002';
  end if;

  update public.candidatures c
     set status      = 'selected',
         selected_at = now()
   where c.id = p_candidature_id
     and c.domain_id = p_domain_id
     and c.status = any (p_statuts_admis)
     and exists (select 1 from public.publications p
                  where p.id = c.publication_id and p.organization_id = p_organization_id)
  returning c.selected_at, c.publication_id, c.profile_id into v_selected_at, v_publication, v_profile;

  if v_selected_at is null then
    -- Transition devenue invalide, candidature hors écosystème ou hors
    -- organisation : rien n'a changé, rien ne s'écrit.
    return null;
  end if;

  select p.type into v_type from public.publications p where p.id = v_publication;

  perform public.journaliser(
    p_piece, 'candidature_retenue', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, p_domain_id,
    'candidatures', p_candidature_id,
    jsonb_build_object('publication_id', v_publication, 'publication_type', v_type, 'profile_id', v_profile),
    p_piece_origine, null::numeric, null::text);
  return v_selected_at;
end;
$fn$;

revoke all on function public.retenir_candidature(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.retenir_candidature(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[])
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['publication_id', 'publication_type', 'profile_id']::text[]
 where code = 'candidature_retenue';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles    text[];
  v_cand    uuid;
  v_domaine uuid;
  v_org     uuid;
  v_piece   uuid := gen_random_uuid();
  v_quand   timestamptz;
  v_quand2  timestamptz;
  v_lignes  integer;
begin
  if to_regprocedure('public.retenir_candidature(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[])') is null then
    raise exception 'postcondition NON TENUE : retenir_candidature manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'candidature_retenue';
  if v_cles is null or not (v_cles @> array['publication_id', 'publication_type', 'profile_id']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de candidature_retenue est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — sur une candidature réelle dévoilée : retenue, relue, journalisée ;
  -- rejouée, elle rend null et n'écrit rien. Sans candidature dévoilée : sautée, et dite.
  select c.id, c.domain_id, p.organization_id
    into v_cand, v_domaine, v_org
    from public.candidatures c
    join public.publications p on p.id = c.publication_id
   where c.status = 'unlocked'
   limit 1;
  if v_cand is null then
    raise notice 'postcondition : sonde retenir_candidature SAUTEE — aucune candidature devoilee en base';
  else
    begin
      v_quand := public.retenir_candidature(v_piece, null::uuid, 'systeme', null::uuid, null::text,
                                            v_cand, v_domaine, v_org, array['unlocked']);
      if v_quand is null
         or not exists (select 1 from public.candidatures c where c.id = v_cand and c.status = 'selected' and c.selected_at = v_quand) then
        raise exception 'postcondition NON TENUE : la candidature n est pas retenue, ou selected_at n est pas celui rendu';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'candidature_retenue' and g.statut = 'reussi'
                        and g.sujet_type = 'candidatures' and g.sujet_id = v_cand
                        and g.detail ->> 'publication_type' is not null and g.detail ->> 'profile_id' is not null) then
        raise exception 'postcondition NON TENUE : la ligne candidature_retenue manque ou ne porte pas son detail';
      end if;
      -- LE REJEU : transition désormais invalide — null, et aucune seconde ligne.
      v_quand2 := public.retenir_candidature(gen_random_uuid(), null::uuid, 'systeme', null::uuid, null::text,
                                             v_cand, v_domaine, v_org, array['unlocked']);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'candidature_retenue' and g.sujet_id = v_cand;
      if v_quand2 is not null or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : un rejeu a retenu (%) ou journalise deux fois (% ligne(s))', v_quand2, v_lignes;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  raise notice 'postcondition tenue : candidature_retenue — la transition et sa ligne naissent ensemble, le rejeu n ecrit rien';
end
$post$;
