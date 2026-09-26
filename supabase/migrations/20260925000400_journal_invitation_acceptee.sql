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


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
--  La sonde FABRIQUE son cas dans la sous-transaction qu'elle annule : une
--  invitation en attente réelle reçoit l'adresse d'un compte vérifié qui n'est
--  membre de rien. Tout est défait par SONDE_ANNULEE.
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_cles   text[];
  v_inv    record;
  v_user   record;
  v_piece  uuid := gen_random_uuid();
  v_r      jsonb;
  v_lignes integer;
begin
  if to_regprocedure('public.accepter_invitation(uuid, uuid, text, uuid, text, uuid, uuid, text[])') is null then
    raise exception 'postcondition NON TENUE : accepter_invitation manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'invitation_acceptee';
  if v_cles is null or array_length(v_cles, 1) <> 4
     or not (v_cles @> array['organization_id', 'role_in_org', 'deja_membre', 'reintegre']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de invitation_acceptee est fausse [vu : %]', v_cles;
  end if;

  select i.id, i.organization_id into v_inv
    from public.organization_invitations i where i.status = 'pending' limit 1;
  select u.id, u.email, u.user_type into v_user
    from public.users u
   where u.email_verified and u.email is not null
     and not exists (select 1 from public.organization_members m where m.user_id = u.id)
   limit 1;
  if v_inv.id is null or v_user.id is null then
    raise notice 'postcondition : sonde accepter_invitation SAUTEE — aucune invitation en attente ou aucun compte verifie sans organisation (base vierge)';
    v_sautee := true;
  else
    begin
      update public.organization_invitations
         set email = 'sonde-autre@exemple.invalid', expires_at = now() + interval '1 day'
       where id = v_inv.id;
      -- UNE AUTRE ADRESSE : refus, rien d'ecrit.
      v_r := public.accepter_invitation(gen_random_uuid(), null::uuid, 'utilisateur', v_user.id, 'client', null::uuid,
                                        v_inv.id, array['pending']);
      if v_r ->> 'issue' is distinct from 'email_mismatch' then
        raise exception 'postcondition NON TENUE : une adresse differente a ete acceptee [%]', v_r;
      end if;
      update public.organization_invitations set email = upper(v_user.email) where id = v_inv.id;
      -- UN STATUT NON ADMIS : refus.
      v_r := public.accepter_invitation(gen_random_uuid(), null::uuid, 'utilisateur', v_user.id, 'client', null::uuid,
                                        v_inv.id, array['sonde_statut_absent']);
      if v_r ->> 'issue' is distinct from 'not_pending' then
        raise exception 'postcondition NON TENUE : une invitation hors des statuts admis a ete acceptee [%]', v_r;
      end if;
      -- UNE ECHEANCE PASSEE : refus.
      update public.organization_invitations set expires_at = now() - interval '1 second' where id = v_inv.id;
      v_r := public.accepter_invitation(gen_random_uuid(), null::uuid, 'utilisateur', v_user.id, 'client', null::uuid,
                                        v_inv.id, array['pending']);
      if v_r ->> 'issue' is distinct from 'expired' then
        raise exception 'postcondition NON TENUE : une invitation echue a ete acceptee [%]', v_r;
      end if;
      if exists (select 1 from public.organization_members m where m.user_id = v_user.id)
         or exists (select 1 from public.grand_livre g where g.type_action = 'invitation_acceptee' and g.sujet_id = v_inv.id) then
        raise exception 'postcondition NON TENUE : un refus a ecrit quelque chose';
      end if;
      -- L'ACCEPTATION : l'adresse compare sans casse ; membre, invitation et ligne RELUS.
      update public.organization_invitations set expires_at = now() + interval '1 day' where id = v_inv.id;
      v_r := public.accepter_invitation(v_piece, null::uuid, 'utilisateur', v_user.id, 'client', null::uuid,
                                        v_inv.id, array['pending']);
      if v_r ->> 'issue' is distinct from 'acceptee' or (v_r ->> 'deja_membre')::boolean is distinct from false then
        raise exception 'postcondition NON TENUE : l acceptation n a pas abouti [%]', v_r;
      end if;
      if not exists (select 1 from public.organization_members m
                      where m.user_id = v_user.id and m.organization_id = v_inv.organization_id and m.status = 'active')
         or not exists (select 1 from public.organization_invitations i
                         where i.id = v_inv.id and i.status = 'accepted' and i.accepted_at is not null) then
        raise exception 'postcondition NON TENUE : l appartenance ou l invitation soldee ne sont pas relues';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'invitation_acceptee' and g.statut = 'reussi'
                        and g.sujet_id = v_inv.id and g.acteur_id = v_user.id
                        and g.detail ->> 'organization_id' = v_inv.organization_id::text
                        and (g.detail ->> 'deja_membre')::boolean = false
                        and g.detail::text not ilike '%' || v_user.email || '%') then
        raise exception 'postcondition NON TENUE : la ligne invitation_acceptee manque, ou porte l adresse';
      end if;
      -- LE REJEU : l'invitation est soldee, rien de plus.
      v_r := public.accepter_invitation(gen_random_uuid(), null::uuid, 'utilisateur', v_user.id, 'client', null::uuid,
                                        v_inv.id, array['pending']);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'invitation_acceptee' and g.sujet_id = v_inv.id;
      if v_r ->> 'issue' is distinct from 'not_pending' or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : le rejeu a accepte ou journalise une seconde fois [% / % ligne(s)]', v_r, v_lignes;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — l'adresse est REFUSEE (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'invitation_acceptee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'organization_invitations', gen_random_uuid(),
                               '{"role_in_org":"viewer","email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : l adresse est entree dans invitation_acceptee';
  exception when sqlstate 'GL004' then
    null;
  end;
  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : invitation_acceptee — appartenance, invitation soldee et ligne ensemble ; adresse, statut et echeance rejoues sous verrou ; rejeu sans seconde ligne ; adresse refusee';
  else
    raise notice 'postcondition tenue : invitation_acceptee — appartenance, invitation soldee et ligne ensemble ; adresse, statut et echeance rejoues sous verrou ; rejeu sans seconde ligne ; adresse refusee';
  end if;
end
$post$;
