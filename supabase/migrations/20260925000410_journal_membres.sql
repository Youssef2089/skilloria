-- ════════════════════════════════════════════════════════════════════════════
--  UN MEMBRE QUI CHANGE DE RÔLE, QU'ON RETIRE OU QUI PART S'ÉCRIT AU GRAND
--  LIVRE — PAR LE SEUL CHEMIN D'ÉCRITURE SUR UN MEMBRE, DANS SA TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement, et le code part DANS LA FOULÉE.
--  L'ancienne signature (quatre arguments) est SUPPRIMÉE : le code en ligne qui
--  l'appelle encore échouerait jusqu'au déploiement de ce commit. Rejouable.
--
--  UNE FONCTION, TROIS FACES — la forme de `changer_statut_compte()`.
--  `maj_membre_organisation()` est déjà le SEUL chemin d'écriture sur le rôle ou
--  le statut d'une appartenance (migration `siege_administrateur` : c'est elle
--  qui tient « jamais zéro administrateur »). Elle devient l'écrivain unique de
--  `role_membre_change`, `membre_retire` et `membre_parti`, et le code n'est PAS
--  un paramètre : il se DÉRIVE du geste —
--    · statut qui passe à `removed`, sur la ligne de l'ACTEUR  → membre_parti ;
--    · statut qui passe à `removed`, sur la ligne d'un AUTRE   → membre_retire ;
--    · rôle qui change, statut inchangé                        → role_membre_change.
--  Tout autre changement (vers `suspended`, `pending`, une réactivation) n'a PAS
--  d'action dans la liste fermée : la fonction le REFUSE avant d'écrire, plutôt
--  que de changer un état sans trace. Aucun appelant ne le demande aujourd'hui.
--
--  L'ANCIENNE SIGNATURE DISPARAÎT (comme celle de `programmer_suppression_compte`) :
--  `create or replace` avec des paramètres en plus crée une SECONDE fonction, et
--  l'ancienne, sans journal, resterait appelable.
--
--  LA LIGNE DU MEMBRE EST VERROUILLÉE (`for update`). Deux administrateurs qui
--  retirent le même membre au même instant lisaient tous deux `active`, et le
--  second écrivait une seconde ligne pour un seul fait. Sous verrou, le second
--  relit `removed` et rend `inchange`. Le mécanisme du siège (clé étrangère
--  composite, entête de `siege_administrateur`) n'en dépend pas et n'est pas
--  touché : son verrou `FOR KEY SHARE` sur un AUTRE membre reste compatible.
--
--  LES TROIS REFUS NE S'ÉCRIVENT PAS : `introuvable`, `inchange`, `dernier_admin`
--  rendent sans ligne — rien n'a changé, et « dernier administrateur » n'est pas
--  un refus de la liste fermée (les cinq refus nommés, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.maj_membre_organisation(uuid, character varying, character varying, boolean);

create or replace function public.maj_membre_organisation(
  p_piece           uuid,
  p_piece_origine   uuid,
  p_origine         text,
  p_acteur_id       uuid,
  p_acteur_type     text,
  p_ecosysteme_id   uuid,
  p_membre_id       uuid,
  p_nouveau_role    character varying default null,
  p_nouveau_statut  character varying default null,
  p_forcer          boolean default false
) returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_org          uuid;
  v_user         uuid;
  v_role         character varying;
  v_statut       character varying;
  v_role_cible   character varying;
  v_statut_cible character varying;
  v_geste        text;
  v_au_siege     boolean;
  v_transfere    boolean := false;
  v_libere       boolean := false;
  v_cand         uuid;
begin
  if p_piece is null then
    raise exception 'maj_membre_organisation : la piece est obligatoire' using errcode = 'GL002';
  end if;

  select m.organization_id, m.user_id, m.role_in_org, m.status
    into v_org, v_user, v_role, v_statut
    from public.organization_members m
   where m.id = p_membre_id
   for update;
  if v_org is null then
    return 'introuvable';
  end if;

  v_role_cible   := coalesce(p_nouveau_role, v_role);
  v_statut_cible := coalesce(p_nouveau_statut, v_statut);
  if v_role_cible = v_role and v_statut_cible = v_statut then
    return 'inchange';
  end if;

  -- LE GESTE, DÉRIVÉ — avant toute écriture. Ce qui n'a pas d'action n'a pas lieu.
  if v_statut_cible = 'removed' and v_statut <> 'removed' then
    v_geste := case when v_user = p_acteur_id then 'parti' else 'retire' end;
  elsif v_statut_cible = v_statut and v_role_cible <> v_role then
    v_geste := 'role';
  else
    raise exception 'maj_membre_organisation : aucun geste du grand livre ne porte % -> % (statut)', v_statut, v_statut_cible
      using errcode = '22023';
  end if;

  -- Ne concerne que la PERTE du statut d'administrateur actif. Une promotion,
  -- ou un changement qui garde l'interesse administrateur actif, ne touche
  -- rien : le siege reste ou il est.
  if v_role = 'admin' and v_statut = 'active'
     and not (v_role_cible = 'admin' and v_statut_cible = 'active')
  then
    select (o.siege_admin_membre_id = p_membre_id) into v_au_siege
      from public.organizations o where o.id = v_org;

    if coalesce(v_au_siege, false) then
      -- ── TRANSFERT DU SIEGE (inchangé, cf. `siege_administrateur`) ─────────
      for v_cand in
        select m.id
          from public.organization_members m
         where m.organization_id = v_org
           and m.id <> p_membre_id
           and m.role_in_org = 'admin'
           and m.status = 'active'
         order by m.joined_at asc, m.id asc
      loop
        begin
          update public.organizations
             set siege_admin_membre_id = v_cand
           where id = v_org;
          v_transfere := true;
          exit;
        exception when foreign_key_violation then
          null;
        end;
      end loop;

      if not v_transfere then
        if not p_forcer then
          -- REFUS. Aucune ecriture n'a eu lieu, aucune ligne.
          return 'dernier_admin';
        end if;
        -- ── LA PORTE DU DEPANNAGE PLATEFORME (inchangée) ──────────────────
        perform set_config('skilloria.liberation_siege_admin', 'oui', true);
        update public.organizations set siege_admin_membre_id = null where id = v_org;
        perform set_config('skilloria.liberation_siege_admin', '', true);
        v_libere := true;
      end if;
    end if;
  end if;

  begin
    update public.organization_members
       set role_in_org = v_role_cible,
           status      = v_statut_cible,
           updated_at  = now()
     where id = p_membre_id;
  exception when foreign_key_violation then
    return 'dernier_admin';
  end;

  perform public.journaliser(
    p_piece,
    case v_geste when 'parti' then 'membre_parti' when 'retire' then 'membre_retire' else 'role_membre_change' end,
    'reussi', p_origine,
    p_acteur_id, p_acteur_type, p_ecosysteme_id,
    'organization_members', p_membre_id,
    jsonb_build_object(
      'organization_id', v_org,
      'membre_user_id', v_user,
      'role_de', v_role,
      'role_vers', v_role_cible,
      'statut_de', v_statut,
      'statut_vers', v_statut_cible,
      'siege_transfere', v_transfere,
      'siege_libere', v_libere),
    p_piece_origine, null::numeric, null::text);

  return 'ok';
end;
$fn$;

comment on function public.maj_membre_organisation(uuid, uuid, text, uuid, text, uuid, uuid, character varying, character varying, boolean) is
'Change le role et/ou le statut d''une ligne d''appartenance, en garantissant
qu''il reste au moins un administrateur actif dans l''organisation, ET ecrit la
ligne du grand livre dans la meme transaction (role_membre_change, membre_retire,
membre_parti — le code est DERIVE du geste).

Rend : ''ok'', ''dernier_admin'' (refus, aucune ecriture), ''introuvable'',
''inchange''. Leve 22023 sur un changement qui n''a pas d''action au grand livre.

p_forcer = depannage plateforme UNIQUEMENT (/api/admin/user-org-role).';

revoke all on function public.maj_membre_organisation(uuid, uuid, text, uuid, text, uuid, uuid, character varying, character varying, boolean)
  from public, anon, authenticated;
grant execute on function public.maj_membre_organisation(uuid, uuid, text, uuid, text, uuid, uuid, character varying, character varying, boolean)
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['organization_id', 'membre_user_id', 'role_de', 'role_vers', 'statut_de', 'statut_vers', 'siege_transfere', 'siege_libere']::text[]
 where code = 'role_membre_change';
update public.grand_livre_actions
   set cles_detail = array['organization_id', 'membre_user_id', 'role_de', 'role_vers', 'statut_de', 'statut_vers', 'siege_transfere', 'siege_libere']::text[]
 where code = 'membre_retire';
update public.grand_livre_actions
   set cles_detail = array['organization_id', 'membre_user_id', 'role_de', 'role_vers', 'statut_de', 'statut_vers', 'siege_transfere', 'siege_libere']::text[]
 where code = 'membre_parti';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
--  La sonde FABRIQUE un membre `viewer` dans une organisation réelle (un compte
--  qui n'y est pas), le fait changer de rôle, retirer, réintégrer, partir — puis
--  annule tout.
do $post$
declare
  v_org     uuid;
  v_user    uuid;
  v_autre   uuid;
  v_membre  uuid;
  v_p1      uuid := gen_random_uuid();
  v_p2      uuid := gen_random_uuid();
  v_p3      uuid := gen_random_uuid();
  v_r       text;
  v_n       integer;
begin
  if to_regprocedure('public.maj_membre_organisation(uuid, uuid, text, uuid, text, uuid, uuid, character varying, character varying, boolean)') is null then
    raise exception 'postcondition NON TENUE : maj_membre_organisation manque ou a change de signature';
  end if;
  if to_regprocedure('public.maj_membre_organisation(uuid, character varying, character varying, boolean)') is not null then
    raise exception 'postcondition NON TENUE : l ancienne signature, sans journal, est encore appelable';
  end if;
  select count(*) into v_n from public.grand_livre_actions
   where code in ('role_membre_change', 'membre_retire', 'membre_parti')
     and array_length(cles_detail, 1) = 8 and cles_detail @> array['organization_id', 'membre_user_id', 'siege_libere']::text[];
  if v_n <> 3 then
    raise exception 'postcondition NON TENUE : les listes blanches des trois actions de membre sont fausses [% sur 3]', v_n;
  end if;

  select o.id into v_org from public.organizations o limit 1;
  select u.id into v_user from public.users u
   where v_org is not null
     and not exists (select 1 from public.organization_members m where m.user_id = u.id and m.organization_id = v_org)
   limit 1;
  select u.id into v_autre from public.users u where u.id is distinct from v_user limit 1;
  if v_org is null or v_user is null or v_autre is null then
    raise notice 'postcondition : sonde maj_membre_organisation SAUTEE — aucune organisation ou pas deux comptes (base vierge)';
  else
    begin
      insert into public.organization_members (organization_id, user_id, role_in_org, status)
      values (v_org, v_user, 'viewer', 'active') returning id into v_membre;

      -- UN CHANGEMENT SANS ACTION : refusé AVANT d'écrire.
      begin
        perform public.maj_membre_organisation(gen_random_uuid(), null::uuid, 'utilisateur', v_autre, 'client', null::uuid,
                                               v_membre, null, 'suspended', false);
        raise exception 'postcondition NON TENUE : un changement sans action au grand livre a ete ecrit';
      exception when sqlstate '22023' then
        null;
      end;
      -- INCHANGÉ : rien.
      v_r := public.maj_membre_organisation(gen_random_uuid(), null::uuid, 'utilisateur', v_autre, 'client', null::uuid,
                                            v_membre, 'viewer', null, false);
      if v_r <> 'inchange' or exists (select 1 from public.grand_livre g where g.sujet_id = v_membre) then
        raise exception 'postcondition NON TENUE : un geste sans changement a ecrit [%]', v_r;
      end if;
      -- LE RÔLE, par un autre.
      v_r := public.maj_membre_organisation(v_p1, null::uuid, 'utilisateur', v_autre, 'client', null::uuid,
                                            v_membre, 'editor', null, false);
      if v_r <> 'ok' or not exists (select 1 from public.grand_livre g
                                     where g.piece = v_p1 and g.type_action = 'role_membre_change' and g.sujet_id = v_membre
                                       and g.detail ->> 'role_de' = 'viewer' and g.detail ->> 'role_vers' = 'editor'
                                       and g.detail ->> 'membre_user_id' = v_user::text) then
        raise exception 'postcondition NON TENUE : le changement de role n est pas relu [%]', v_r;
      end if;
      -- LE RETRAIT, par un autre.
      v_r := public.maj_membre_organisation(v_p2, null::uuid, 'utilisateur', v_autre, 'client', null::uuid,
                                            v_membre, null, 'removed', false);
      if v_r <> 'ok' or not exists (select 1 from public.grand_livre g
                                     where g.piece = v_p2 and g.type_action = 'membre_retire' and g.sujet_id = v_membre
                                       and g.detail ->> 'statut_vers' = 'removed') then
        raise exception 'postcondition NON TENUE : le retrait n est pas relu comme membre_retire [%]', v_r;
      end if;
      -- LE MÊME RETRAIT, REJOUÉ : inchangé, aucune seconde ligne.
      v_r := public.maj_membre_organisation(gen_random_uuid(), null::uuid, 'utilisateur', v_autre, 'client', null::uuid,
                                            v_membre, null, 'removed', false);
      select count(*) into v_n from public.grand_livre g where g.type_action = 'membre_retire' and g.sujet_id = v_membre;
      if v_r <> 'inchange' or v_n <> 1 then
        raise exception 'postcondition NON TENUE : le retrait rejoue a ecrit [% / % ligne(s)]', v_r, v_n;
      end if;
      -- LE DÉPART : la ligne de l'ACTEUR lui-même.
      update public.organization_members set status = 'active' where id = v_membre;
      v_r := public.maj_membre_organisation(v_p3, null::uuid, 'utilisateur', v_user, 'client', null::uuid,
                                            v_membre, null, 'removed', false);
      if v_r <> 'ok' or not exists (select 1 from public.grand_livre g
                                     where g.piece = v_p3 and g.type_action = 'membre_parti' and g.sujet_id = v_membre
                                       and g.acteur_id = v_user) then
        raise exception 'postcondition NON TENUE : le depart n est pas relu comme membre_parti [%]', v_r;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  raise notice 'postcondition tenue : maj_membre_organisation — trois actions derivees du geste, ancienne signature supprimee, refus sans ligne, retrait rejoue sans seconde ligne';
end
$post$;
