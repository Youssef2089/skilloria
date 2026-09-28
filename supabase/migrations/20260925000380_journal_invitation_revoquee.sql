-- ════════════════════════════════════════════════════════════════════════════
--  UNE INVITATION RÉVOQUÉE S'ÉCRIT AU GRAND LIVRE — LA TRANSITION
--  ET LA LIGNE, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `app/api/me/organisation/invitations/[id]`
--  appelle `revoquer_invitation()` dès ce commit. Rejouable.
--
--  LA TRANSITION EST REJOUÉE : seule une invitation `pending` se révoque, et
--  le statut est relu SOUS VERROU. La route le vérifiait sur sa lecture
--  d'avant ; deux administrateurs qui révoquent au même instant la
--  franchissaient tous les deux. Zéro ligne rend `false` → 409.
--
--  L'APPARTENANCE EST REJOUÉE AUSSI (`organization_id`) : une invitation
--  d'une AUTRE organisation devient introuvable, jamais modifiable — le même
--  parti pris que le cloisonnement des annonces (§D.3, 404 plutôt que 403).
--
--  L'ADRESSE INVITÉE NE SORT PAS : elle est sur l'invitation (§C.21,
--  `membre_invite`). La ligne porte le statut d'avant et le rôle proposé.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.revoquer_invitation(
  p_piece           uuid,
  p_piece_origine   uuid,
  p_origine         text,
  p_acteur_id       uuid,
  p_acteur_type     text,
  p_ecosysteme_id   uuid,
  p_invitation_id   uuid,
  p_organization_id uuid,
  p_statuts_admis   text[]
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_i record;
  v_n integer;
begin
  if p_piece is null then
    raise exception 'revoquer_invitation : la piece est obligatoire' using errcode = 'GL002';
  end if;

  select i.id, i.status, i.role_in_org
    into v_i
    from public.organization_invitations i
   where i.id = p_invitation_id
     and i.organization_id = p_organization_id
   for update;
  if not found or not (v_i.status = any (p_statuts_admis)) then
    return false;
  end if;

  update public.organization_invitations i
     set status = 'revoked',
         updated_at = now()
   where i.id = p_invitation_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'revoquer_invitation : organization_invitations');

  perform public.journaliser(
    p_piece, 'invitation_revoquee', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, p_ecosysteme_id,
    'organization_invitations', p_invitation_id,
    jsonb_build_object('de', v_i.status, 'vers', 'revoked', 'role_in_org', v_i.role_in_org),
    p_piece_origine, null::numeric, null::text);

  return true;
end;
$fn$;

revoke all on function public.revoquer_invitation(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.revoquer_invitation(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[])
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['de', 'vers', 'role_in_org']::text[]
 where code = 'invitation_revoquee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_cles   text[];
  v_inv    record;
  v_acteur uuid;
  v_piece  uuid := gen_random_uuid();
  v_ok     boolean;
  v_ok2    boolean;
  v_lignes integer;
begin
  if to_regprocedure('public.revoquer_invitation(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[])') is null then
    raise exception 'postcondition NON TENUE : revoquer_invitation manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'invitation_revoquee';
  if v_cles is null or not (v_cles @> array['de', 'vers', 'role_in_org']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de invitation_revoquee est incomplete [vu : %]', v_cles;
  end if;

  select i.id, i.organization_id, i.status into v_inv
    from public.organization_invitations i
   where i.status = 'pending'
   limit 1;
  select u.id into v_acteur from public.users u limit 1;
  if v_inv.id is null or v_acteur is null then
    raise notice 'postcondition : sonde revoquer_invitation SAUTEE — aucune invitation en attente (base vierge)';
    v_sautee := true;
  else
    begin
      -- UNE AUTRE ORGANISATION D'ABORD, sur une invitation ENCORE en attente :
      -- sondee apres la revocation, elle rendrait false a cause du STATUT, et
      -- passerait meme sans le filtre d'appartenance (§E.37).
      v_ok2 := public.revoquer_invitation(gen_random_uuid(), null::uuid, 'utilisateur', v_acteur, 'client', null::uuid,
                                          v_inv.id, gen_random_uuid(), array['pending']);
      if v_ok2 is distinct from false then
        raise exception 'postcondition NON TENUE : une invitation d une AUTRE organisation a ete revoquee';
      end if;
      if not exists (select 1 from public.organization_invitations i where i.id = v_inv.id and i.status = 'pending')
         or exists (select 1 from public.grand_livre g where g.type_action = 'invitation_revoquee' and g.sujet_id = v_inv.id) then
        raise exception 'postcondition NON TENUE : la tentative d une autre organisation a ecrit quelque chose';
      end if;
      v_ok := public.revoquer_invitation(v_piece, null::uuid, 'utilisateur', v_acteur, 'client', null::uuid,
                                         v_inv.id, v_inv.organization_id, array['pending']);
      if v_ok is distinct from true then
        raise exception 'postcondition NON TENUE : la revocation n a pas abouti';
      end if;
      if not exists (select 1 from public.organization_invitations i where i.id = v_inv.id and i.status = 'revoked') then
        raise exception 'postcondition NON TENUE : la transition n est pas relue';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'invitation_revoquee' and g.statut = 'reussi'
                        and g.sujet_type = 'organization_invitations' and g.sujet_id = v_inv.id
                        and g.detail ->> 'de' = 'pending' and g.detail ->> 'vers' = 'revoked') then
        raise exception 'postcondition NON TENUE : la ligne invitation_revoquee manque ou ne porte pas son detail';
      end if;
      -- LE REJEU : false, aucune seconde ligne.
      v_ok2 := public.revoquer_invitation(gen_random_uuid(), null::uuid, 'utilisateur', v_acteur, 'client', null::uuid,
                                          v_inv.id, v_inv.organization_id, array['pending']);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'invitation_revoquee' and g.sujet_id = v_inv.id;
      if v_ok2 is distinct from false or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : le rejeu a revoque ou journalise une seconde fois [% / % ligne(s)]', v_ok2, v_lignes;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — l'adresse invitee est REFUSEE (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'invitation_revoquee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'organization_invitations', gen_random_uuid(),
                               '{"de":"pending","vers":"revoked","invitee_email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : l adresse invitee est entree dans invitation_revoquee';
  exception when sqlstate 'GL004' then
    null;
  end;
  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : invitation_revoquee — transition et ligne naissent ensemble, rejeu false, autre organisation introuvable, adresse refusee';
  else
    raise notice 'postcondition tenue : invitation_revoquee — transition et ligne naissent ensemble, rejeu false, autre organisation introuvable, adresse refusee';
  end if;
end
$post$;
