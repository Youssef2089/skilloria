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


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui révoquait une vraie invitation en attente est retirée (28/09/2026). Le geste — autre
-- organisation d'abord (rien n'est touché), transition et ligne ensemble (de/vers), rejeu false sans
-- seconde ligne — est prouvé par supabase/tests/database/grand_livre/invitations.test.sql (et
-- vrai_appelant/appelant.test.sql en service_role). L'autre organisation reste sondée ici, sur des
-- identifiants INVENTÉS.
declare
  v_cles text[];
  v_ok   boolean;
begin
  if to_regprocedure('public.revoquer_invitation(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[])') is null then
    raise exception 'postcondition NON TENUE : revoquer_invitation manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'invitation_revoquee';
  if v_cles is null or not (v_cles @> array['de', 'vers', 'role_in_org']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de invitation_revoquee est incomplete [vu : %]', v_cles;
  end if;
  begin
    v_ok := public.revoquer_invitation(gen_random_uuid(), null::uuid, 'utilisateur', gen_random_uuid(), 'client', null::uuid,
                                       gen_random_uuid(), gen_random_uuid(), array['pending']);
    if v_ok is distinct from false then
      raise exception 'postcondition NON TENUE : une invitation inconnue a ete revoquee';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  begin
    perform public.journaliser(gen_random_uuid(), 'invitation_revoquee', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'organization_invitations', gen_random_uuid(),
                               '{"de":"pending","vers":"revoked","invitee_email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : l adresse invitee est entree dans invitation_revoquee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : invitation_revoquee — signature par types, liste blanche, invitation inconnue false, adresse refusee ; le geste est prouve par tests/database/grand_livre/invitations.test.sql';
end
$post$;
