-- ════════════════════════════════════════════════════════════════════════════
--  UNE INVITATION ACCEPTÉE S'ÉCRIT AU GRAND LIVRE — L'APPARTENANCE,
--  L'INVITATION SOLDÉE ET LA LIGNE, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `lib/invitation-accept.ts` appelle
--  `accepter_invitation()` dès ce commit. Rejouable.
--
--  CE QUI ÉTAIT FAUX AVANT, ET QUE LA TRANSACTION FERME :
--   · TROIS écritures séparées — l'appartenance, puis l'invitation — et l'échec
--     de la seconde était AVALÉ (« le membre est déjà en place ») : un membre
--     entrait, l'invitation restait `pending`, donc acceptable une seconde fois ;
--   · les quatre gardes (statut, échéance, adresse, appartenance existante)
--     étaient jugées sur une lecture d'AVANT : deux clics simultanés les
--     franchissaient tous les deux.
--  Ici l'invitation est VERROUILLÉE, les gardes REJOUÉES dessous, et tout
--  s'écrit ou rien.
--
--  L'ADRESSE EST LUE EN BASE, SOUS LE VERROU : l'adresse VÉRIFIÉE du compte qui
--  accepte (`users.email`, `email_verified`) est comparée à celle de
--  l'invitation. Le code ne la transmet plus — une garde qui repose sur une
--  valeur reçue n'est qu'une promesse de l'appelant.
--
--  LES STATUTS ADMIS PARTENT EN PARAMÈTRE (`INVITATION_MODIFIABLE`, partagée
--  avec la révocation et le renvoi) : aucun littéral de statut lu ici. Les
--  statuts ÉCRITS (`accepted`, `active`) sont ceux du geste.
--
--  CE QUE LA LIGNE PORTE : l'organisation rejointe, le rôle, et deux faits —
--  le compte était-il déjà membre actif, et une ancienne appartenance a-t-elle
--  été réactivée. Jamais l'adresse (celle du compte, ni celle de l'invitation).
--
--  LES ISSUES SONT FERMÉES, et seule `acceptee` écrit : `introuvable`,
--  `not_pending`, `expired`, `email_mismatch` rendent SANS rien écrire — les
--  mêmes codes que la route répondait déjà.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.accepter_invitation(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_ecosysteme_id uuid,
  p_invitation_id uuid,
  p_statuts_admis text[]
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_i          record;
  v_u          record;
  v_m          record;
  v_deja       boolean := false;
  v_reintegre  boolean := false;
  v_n          integer;
begin
  if p_piece is null then
    raise exception 'accepter_invitation : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_acteur_id is null then
    raise exception 'accepter_invitation : l acteur est obligatoire — on accepte pour soi' using errcode = 'GL002';
  end if;

  select i.id, i.organization_id, i.email, i.role_in_org, i.status, i.expires_at, i.invited_by
    into v_i
    from public.organization_invitations i
   where i.id = p_invitation_id
   for update;
  if not found then
    return jsonb_build_object('issue', 'introuvable');
  end if;
  if not (v_i.status = any (p_statuts_admis)) then
    return jsonb_build_object('issue', 'not_pending');
  end if;
  if v_i.expires_at <= now() then
    return jsonb_build_object('issue', 'expired');
  end if;

  select u.email, u.email_verified into v_u from public.users u where u.id = p_acteur_id;
  if not found or v_u.email_verified is distinct from true or v_u.email is null
     or lower(btrim(v_u.email)) <> lower(btrim(v_i.email)) then
    return jsonb_build_object('issue', 'email_mismatch');
  end if;

  select m.id, m.status into v_m
    from public.organization_members m
   where m.organization_id = v_i.organization_id
     and m.user_id = p_acteur_id
   for update;
  if found then
    if v_m.status = 'active' then
      v_deja := true;
    else
      update public.organization_members m
         set role_in_org = v_i.role_in_org,
             status      = 'active',
             updated_at  = now()
       where m.id = v_m.id;
      get diagnostics v_n = row_count;
      perform public.exiger_ecriture(v_n, 'accepter_invitation : organization_members (reintegration)');
      v_reintegre := true;
    end if;
  else
    insert into public.organization_members (organization_id, user_id, role_in_org, status, invited_by)
    values (v_i.organization_id, p_acteur_id, v_i.role_in_org, 'active', v_i.invited_by);
  end if;

  update public.organization_invitations i
     set status      = 'accepted',
         accepted_at = now(),
         updated_at  = now()
   where i.id = v_i.id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'accepter_invitation : organization_invitations');

  perform public.journaliser(
    p_piece, 'invitation_acceptee', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, p_ecosysteme_id,
    'organization_invitations', v_i.id,
    jsonb_build_object(
      'organization_id', v_i.organization_id,
      'role_in_org', v_i.role_in_org,
      'deja_membre', v_deja,
      'reintegre', v_reintegre),
    p_piece_origine, null::numeric, null::text);

  return jsonb_build_object('issue', 'acceptee', 'organization_id', v_i.organization_id, 'deja_membre', v_deja);
end;
$fn$;

revoke all on function public.accepter_invitation(uuid, uuid, text, uuid, text, uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.accepter_invitation(uuid, uuid, text, uuid, text, uuid, uuid, text[])
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['organization_id', 'role_in_org', 'deja_membre', 'reintegre']::text[]
 where code = 'invitation_acceptee';


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui modifiait une vraie invitation en attente et la faisait accepter par un vrai compte est
-- retirée (28/09/2026). Le geste — adresse différente, statut non admis et invitation échue refusés sans
-- ligne ni appartenance, adresse comparée sans casse, appartenance et invitation soldée ensemble, ligne
-- sans l'adresse, rejeu refusé sans seconde ligne — est prouvé par
-- supabase/tests/database/grand_livre/invitations.test.sql. L'invitation inconnue reste sondée ici, sur des
-- identifiants INVENTÉS.
declare
  v_cles text[];
  v_r    jsonb;
begin
  if to_regprocedure('public.accepter_invitation(uuid, uuid, text, uuid, text, uuid, uuid, text[])') is null then
    raise exception 'postcondition NON TENUE : accepter_invitation manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'invitation_acceptee';
  if v_cles is null or array_length(v_cles, 1) <> 4
     or not (v_cles @> array['organization_id', 'role_in_org', 'deja_membre', 'reintegre']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de invitation_acceptee est fausse [vu : %]', v_cles;
  end if;
  begin
    v_r := public.accepter_invitation(gen_random_uuid(), null::uuid, 'utilisateur', gen_random_uuid(), 'client', null::uuid,
                                      gen_random_uuid(), array['pending']);
    if v_r ->> 'issue' is distinct from 'introuvable' then
      raise exception 'postcondition NON TENUE : une invitation inconnue n est pas « introuvable » [%]', v_r;
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  begin
    perform public.journaliser(gen_random_uuid(), 'invitation_acceptee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'organization_invitations', gen_random_uuid(),
                               '{"role_in_org":"viewer","email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : l adresse est entree dans invitation_acceptee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : invitation_acceptee — signature par types, liste blanche exacte, invitation inconnue introuvable, adresse refusee ; le geste est prouve par tests/database/grand_livre/invitations.test.sql';
end
$post$;
