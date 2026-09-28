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
  v_n integer;
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
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'renvoyer_invitation : organization_invitations');

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


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui renvoyait une vraie invitation en attente est retirée (28/09/2026). Le geste — autre
-- organisation et statut non admis refusés sans rien écrire, jeton et échéance posés, ligne avec
-- l'échéance et SANS le jeton, GL005 sur la même pièce, une autre pièce écrit une seconde ligne — est
-- prouvé par supabase/tests/database/grand_livre/invitations.test.sql (et vrai_appelant/appelant.test.sql).
declare
  v_cles text[];
  v_ok   boolean;
begin
  if to_regprocedure('public.renvoyer_invitation(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[], text, timestamp with time zone)') is null then
    raise exception 'postcondition NON TENUE : renvoyer_invitation manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'invitation_renvoyee';
  if v_cles is null or not (v_cles @> array['role_in_org', 'expires_at']::text[]) or array_length(v_cles, 1) <> 2 then
    raise exception 'postcondition NON TENUE : la liste blanche de invitation_renvoyee est fausse [vu : %]', v_cles;
  end if;
  begin
    v_ok := public.renvoyer_invitation(gen_random_uuid(), null::uuid, 'utilisateur', gen_random_uuid(), 'client', null::uuid,
                                       gen_random_uuid(), gen_random_uuid(), array['pending'], 'sonde-jeton', now() + interval '7 days');
    if v_ok is distinct from false then
      raise exception 'postcondition NON TENUE : une invitation inconnue a ete renvoyee';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  begin
    perform public.journaliser(gen_random_uuid(), 'invitation_renvoyee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'organization_invitations', gen_random_uuid(),
                               '{"role_in_org":"viewer","token":"abc"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : le jeton est entre dans invitation_renvoyee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : invitation_renvoyee — signature par types (timestamp with time zone), liste blanche exacte, invitation inconnue false, jeton refuse ; le geste est prouve par tests/database/grand_livre/invitations.test.sql';
end
$post$;
