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
  v_n            integer;
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
          get diagnostics v_n = row_count;
          perform public.exiger_ecriture(v_n, 'maj_membre_organisation : organizations (transfert du siege)');
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
        get diagnostics v_n = row_count;
        perform public.exiger_ecriture(v_n, 'maj_membre_organisation : organizations (liberation du siege)');
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
    get diagnostics v_n = row_count;
    perform public.exiger_ecriture(v_n, 'maj_membre_organisation : organization_members');
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


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui changeait le rôle d'un vrai membre, le retirait puis le faisait partir, dans une vraie
-- organisation, est retirée (28/09/2026). Le geste — changement sans action refusé avant d'écrire (22023),
-- geste sans changement sans ligne, rôle / retrait / départ dérivés du geste avec UNE ligne chacun, retrait
-- rejoué « inchangé » — est prouvé par supabase/tests/database/grand_livre/membres.test.sql (et
-- vrai_appelant/appelant.test.sql en service_role). Le membre inconnu reste sondé ici, sur des identifiants INVENTÉS.
declare
  v_n integer;
  v_r text;
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
  begin
    v_r := public.maj_membre_organisation(gen_random_uuid(), null::uuid, 'utilisateur', gen_random_uuid(), 'client', null::uuid,
                                          gen_random_uuid(), 'editor', null, false);
    if v_r is distinct from 'introuvable' then
      raise exception 'postcondition NON TENUE : un membre inconnu n est pas « introuvable » [%]', v_r;
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  raise notice 'postcondition tenue : maj_membre_organisation — nouvelle signature par types, ancienne absente, trois listes blanches, membre inconnu introuvable ; les trois gestes sont prouves par tests/database/grand_livre/membres.test.sql';
end
$post$;
