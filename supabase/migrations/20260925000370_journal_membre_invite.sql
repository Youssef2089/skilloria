-- ════════════════════════════════════════════════════════════════════════════
--  UNE INVITATION CRÉÉE S'ÉCRIT AU GRAND LIVRE — LA LIGNE D'INVITATION ET LA
--  LIGNE DU JOURNAL, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `app/api/me/organisation/invitations`
--  appelle `creer_invitation()` dès ce commit. Rejouable.
--
--  L'ADRESSE INVITÉE EST CELLE D'UN TIERS, et c'est ce qui rend cette action
--  particulière : la personne invitée n'a peut-être aucun compte, n'a rien
--  accepté, et aucune purge ne viendra effacer son adresse d'un journal en
--  AJOUT SEUL. Elle va donc dans la ligne d'invitation — qui porte sa propre
--  durée de vie et se révoque — et JAMAIS dans le grand livre. La route le
--  disait déjà de son audit ; la liste blanche le rend inviolable.
--
--  CE QUE LA LIGNE PORTE : le rôle proposé, et les deux faits que
--  l'organisation a besoin de relire — le domaine de l'adresse correspondait-il
--  à celui de l'organisation, et le compte existait-il déjà. Trois valeurs
--  fermées, aucune donnée personnelle.
--
--  L'INVITATION EST PASSÉE EN PARAMÈTRE `jsonb` comme la candidature jugée
--  (§C.21) : c'est la LIGNE à écrire, pas le détail du journal. Elle contient
--  l'adresse et le JETON HACHÉ, qui ne ressortent ni l'un ni l'autre.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.creer_invitation(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_ecosysteme_id uuid,
  p_invitation    jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_i record;
begin
  if p_piece is null then
    raise exception 'creer_invitation : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_acteur_id is null then
    raise exception 'creer_invitation : l acteur est obligatoire — une invitation a toujours un auteur' using errcode = 'GL002';
  end if;

  insert into public.organization_invitations (
    organization_id, email, token, role_in_org, invited_by, expires_at,
    status, domain_validation_passed, email_already_exists
  ) values (
    (p_invitation ->> 'organization_id')::uuid,
    p_invitation ->> 'email',
    p_invitation ->> 'token',
    p_invitation ->> 'role_in_org',
    p_acteur_id,
    (p_invitation ->> 'expires_at')::timestamptz,
    p_invitation ->> 'status',
    (p_invitation ->> 'domain_validation_passed')::boolean,
    (p_invitation ->> 'email_already_exists')::boolean
  )
  returning id, email, role_in_org, status, expires_at,
            domain_validation_passed, email_already_exists, created_at
       into v_i;

  perform public.journaliser(
    p_piece, 'membre_invite', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, p_ecosysteme_id,
    'organization_invitations', v_i.id,
    jsonb_build_object(
      'role_in_org', v_i.role_in_org,
      'domain_validation_passed', v_i.domain_validation_passed,
      'email_already_exists', v_i.email_already_exists),
    p_piece_origine, null::numeric, null::text);

  return jsonb_build_object(
    'id', v_i.id, 'email', v_i.email, 'role_in_org', v_i.role_in_org, 'status', v_i.status,
    'expires_at', v_i.expires_at, 'domain_validation_passed', v_i.domain_validation_passed,
    'email_already_exists', v_i.email_already_exists, 'created_at', v_i.created_at);
end;
$fn$;

revoke all on function public.creer_invitation(uuid, uuid, text, uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.creer_invitation(uuid, uuid, text, uuid, text, uuid, jsonb)
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['role_in_org', 'domain_validation_passed', 'email_already_exists']::text[]
 where code = 'membre_invite';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_cles   text[];
  v_org    uuid;
  v_acteur uuid;
  v_piece  uuid := gen_random_uuid();
  v_res    jsonb;
begin
  if to_regprocedure('public.creer_invitation(uuid, uuid, text, uuid, text, uuid, jsonb)') is null then
    raise exception 'postcondition NON TENUE : creer_invitation manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'membre_invite';
  if v_cles is null or not (v_cles @> array['role_in_org', 'domain_validation_passed', 'email_already_exists']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de membre_invite est incomplete [vu : %]', v_cles;
  end if;

  -- SONDE — une organisation réelle : invitation créée, ligne relue, et
  -- l'ADRESSE vérifiée ABSENTE du journal alors qu'elle EST sur l'invitation.
  select o.id into v_org from public.organizations o limit 1;
  select u.id into v_acteur from public.users u limit 1;
  if v_org is null or v_acteur is null then
    raise notice 'postcondition : sonde creer_invitation SAUTEE — aucune organisation ou aucun compte (base vierge)';
    v_sautee := true;
  else
    begin
      v_res := public.creer_invitation(
        v_piece, null::uuid, 'utilisateur', v_acteur, 'client', null::uuid,
        jsonb_build_object(
          'organization_id', v_org, 'email', 'sonde@exemple.fr', 'token', 'sonde_hash',
          'role_in_org', 'viewer', 'expires_at', now() + interval '7 days',
          'status', 'pending', 'domain_validation_passed', false, 'email_already_exists', false));
      if v_res is null or (v_res ->> 'id') is null then
        raise exception 'postcondition NON TENUE : l invitation n a pas ete creee [%]', v_res;
      end if;
      if not exists (select 1 from public.organization_invitations i
                      where i.id = (v_res ->> 'id')::uuid and i.email = 'sonde@exemple.fr') then
        raise exception 'postcondition NON TENUE : l adresse n est pas sur la ligne d invitation — c est pourtant sa place';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'membre_invite' and g.statut = 'reussi'
                        and g.sujet_type = 'organization_invitations' and g.sujet_id = (v_res ->> 'id')::uuid
                        and g.detail ->> 'role_in_org' = 'viewer'
                        and g.detail::text not like '%sonde@exemple.fr%'
                        and g.detail::text not like '%sonde_hash%') then
        raise exception 'postcondition NON TENUE : la ligne manque, ou porte l ADRESSE ou le JETON';
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — l'adresse invitée est REFUSÉE (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'membre_invite', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'organization_invitations', gen_random_uuid(),
                               '{"role_in_org":"viewer","invitee_email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : l adresse invitee est entree dans membre_invite';
  exception when sqlstate 'GL004' then
    null;
  end;
  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : membre_invite — invitation et ligne naissent ensemble, l adresse est SUR l invitation et ABSENTE du journal';
  else
    raise notice 'postcondition tenue : membre_invite — invitation et ligne naissent ensemble, l adresse est SUR l invitation et ABSENTE du journal';
  end if;
end
$post$;
