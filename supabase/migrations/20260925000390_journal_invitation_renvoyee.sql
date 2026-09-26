-- ════════════════════════════════════════════════════════════════════════════
--  UNE INVITATION RENVOYÉE S'ÉCRIT AU GRAND LIVRE — LE NOUVEAU JETON, LA
--  NOUVELLE ÉCHÉANCE ET LA LIGNE, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `app/api/me/organisation/invitations/[id]`
--  appelle `renvoyer_invitation()` dès ce commit. Rejouable.
--
--  LA FORME EST CELLE DE LA RÉVOCATION (`revoquer_invitation`) : la transition
--  ET l'appartenance sont rejouées SOUS VERROU. La route lisait le statut avant
--  d'écrire ; une invitation révoquée entre-temps recevait un jeton neuf — une
--  invitation morte redevenait joignable par e-mail. Zéro ligne rend `false`
--  → 409. Les statuts admis partent EN PARAMÈTRE (`INVITATION_MODIFIABLE`,
--  partagée avec la révocation) : aucun littéral de statut ici.
--
--  UN RENVOI SE RÉPÈTE, ET C'EST LÉGITIME : chaque renvoi est un geste, avec sa
--  pièce. « Une fois » veut dire une fois PAR PIÈCE (GL005), pas une fois par
--  invitation — la postcondition prouve les deux : une seconde pièce écrit une
--  seconde ligne, la même pièce lève.
--
--  CE QUI NE SORT PAS : le jeton (haché ou non — il ouvre l'invitation) et
--  l'adresse invitée (celle d'un tiers, §C.21 `membre_invite`). La ligne porte
--  le rôle proposé et la NOUVELLE échéance, une date.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.renvoyer_invitation(
  p_piece           uuid,
  p_piece_origine   uuid,
  p_origine         text,
  p_acteur_id       uuid,
  p_acteur_type     text,
  p_ecosysteme_id   uuid,
  p_invitation_id   uuid,
  p_organization_id uuid,
  p_statuts_admis   text[],
  p_token           text,
  p_expires_at      timestamptz
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_i record;
begin
  if p_piece is null then
    raise exception 'renvoyer_invitation : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_token is null or p_expires_at is null then
    raise exception 'renvoyer_invitation : le jeton et l echeance sont obligatoires' using errcode = 'GL002';
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
     set token      = p_token,
         expires_at = p_expires_at,
         updated_at = now()
   where i.id = p_invitation_id;

  perform public.journaliser(
    p_piece, 'invitation_renvoyee', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, p_ecosysteme_id,
    'organization_invitations', p_invitation_id,
    jsonb_build_object('role_in_org', v_i.role_in_org, 'expires_at', p_expires_at),
    p_piece_origine, null::numeric, null::text);

  return true;
end;
$fn$;

revoke all on function public.renvoyer_invitation(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[], text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.renvoyer_invitation(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[], text, timestamptz)
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['role_in_org', 'expires_at']::text[]
 where code = 'invitation_renvoyee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_cles   text[];
  v_inv    record;
  v_acteur uuid;
  v_piece  uuid := gen_random_uuid();
  v_ech    timestamptz := timestamptz '2099-01-01 00:00:00+00';
  v_ok     boolean;
  v_lignes integer;
begin
  if to_regprocedure('public.renvoyer_invitation(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[], text, timestamp with time zone)') is null then
    raise exception 'postcondition NON TENUE : renvoyer_invitation manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'invitation_renvoyee';
  if v_cles is null or not (v_cles @> array['role_in_org', 'expires_at']::text[]) or array_length(v_cles, 1) <> 2 then
    raise exception 'postcondition NON TENUE : la liste blanche de invitation_renvoyee est fausse [vu : %]', v_cles;
  end if;

  select i.id, i.organization_id, i.token into v_inv
    from public.organization_invitations i
   where i.status = 'pending'
   limit 1;
  select u.id into v_acteur from public.users u limit 1;
  if v_inv.id is null or v_acteur is null then
    raise notice 'postcondition : sonde renvoyer_invitation SAUTEE — aucune invitation en attente (base vierge)';
    v_sautee := true;
  else
    begin
      -- UNE AUTRE ORGANISATION D'ABORD, sur l'invitation encore intacte (§E.37).
      v_ok := public.renvoyer_invitation(gen_random_uuid(), null::uuid, 'utilisateur', v_acteur, 'client', null::uuid,
                                         v_inv.id, gen_random_uuid(), array['pending'], 'sonde-autre', v_ech);
      if v_ok is distinct from false
         or exists (select 1 from public.organization_invitations i where i.id = v_inv.id and i.token = 'sonde-autre') then
        raise exception 'postcondition NON TENUE : une invitation d une AUTRE organisation a recu un jeton';
      end if;
      -- UN STATUT NON ADMIS : false, rien d'ecrit — la transition est jugee sur les statuts RECUS.
      v_ok := public.renvoyer_invitation(gen_random_uuid(), null::uuid, 'utilisateur', v_acteur, 'client', null::uuid,
                                         v_inv.id, v_inv.organization_id, array['sonde_statut_absent'], 'sonde-statut', v_ech);
      if v_ok is distinct from false
         or exists (select 1 from public.organization_invitations i where i.id = v_inv.id and i.token = 'sonde-statut') then
        raise exception 'postcondition NON TENUE : une invitation hors des statuts admis a ete renvoyee';
      end if;
      -- LE RENVOI : jeton et echeance ecrits, ligne relue — sans le jeton.
      v_ok := public.renvoyer_invitation(v_piece, null::uuid, 'utilisateur', v_acteur, 'client', null::uuid,
                                         v_inv.id, v_inv.organization_id, array['pending'], 'sonde-jeton', v_ech);
      if v_ok is distinct from true
         or not exists (select 1 from public.organization_invitations i
                         where i.id = v_inv.id and i.token = 'sonde-jeton' and i.expires_at = v_ech) then
        raise exception 'postcondition NON TENUE : le renvoi n a pas ecrit le jeton et l echeance';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'invitation_renvoyee' and g.statut = 'reussi'
                        and g.sujet_type = 'organization_invitations' and g.sujet_id = v_inv.id
                        and (g.detail ->> 'expires_at')::timestamptz = v_ech
                        and g.detail::text not like '%sonde-jeton%') then
        raise exception 'postcondition NON TENUE : la ligne invitation_renvoyee manque, ou porte le jeton';
      end if;
      -- LA MEME PIECE : GL005, jamais une seconde ligne.
      begin
        perform public.renvoyer_invitation(v_piece, null::uuid, 'utilisateur', v_acteur, 'client', null::uuid,
                                           v_inv.id, v_inv.organization_id, array['pending'], 'sonde-jeton-2', v_ech);
        raise exception 'postcondition NON TENUE : le meme geste a ete journalise deux fois';
      exception when sqlstate 'GL005' then
        null;
      end;
      -- UNE AUTRE PIECE : un second renvoi, une seconde ligne — c'est un autre geste.
      v_ok := public.renvoyer_invitation(gen_random_uuid(), null::uuid, 'utilisateur', v_acteur, 'client', null::uuid,
                                         v_inv.id, v_inv.organization_id, array['pending'], 'sonde-jeton-3', v_ech);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'invitation_renvoyee' and g.sujet_id = v_inv.id;
      if v_ok is distinct from true or v_lignes < 2 then
        raise exception 'postcondition NON TENUE : un second renvoi n a pas ecrit sa ligne [% / % ligne(s)]', v_ok, v_lignes;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — le jeton est REFUSE (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'invitation_renvoyee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'organization_invitations', gen_random_uuid(),
                               '{"role_in_org":"viewer","token":"abc"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : le jeton est entre dans invitation_renvoyee';
  exception when sqlstate 'GL004' then
    null;
  end;
  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : invitation_renvoyee — jeton, echeance et ligne ensemble, autre organisation et statut non admis refuses, une ligne par piece, jeton refuse';
  else
    raise notice 'postcondition tenue : invitation_renvoyee — jeton, echeance et ligne ensemble, autre organisation et statut non admis refuses, une ligne par piece, jeton refuse';
  end if;
end
$post$;
