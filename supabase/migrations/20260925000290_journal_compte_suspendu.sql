-- ════════════════════════════════════════════════════════════════════════════
--  SUSPENDRE ET RÉACTIVER UN COMPTE S'ÉCRIVENT AU GRAND LIVRE — LA BASCULE ET
--  LA LIGNE, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `app/api/admin/user-status`
--  appelle `changer_statut_compte()` dès ce commit. Rejouable.
--
--  DEUX ACTIONS, UNE FONCTION, ET C'EST DÉLIBÉRÉ : ce sont les deux faces
--  d'une même bascule, écrites par la même instruction. Livrer l'une sans
--  l'autre laisserait la moitié d'un aller-retour dans le journal — le trou
--  exact que ce lot ferme. Le code n'est PAS un paramètre : la fonction le
--  DÉRIVE du geste (`p_suspend`), comme `publier_annonce` dérive d'un verdict.
--
--  La transition est REJOUÉE dans l'instruction (statuts admis passés par la
--  route) : zéro ligne rend `null`, et la route répond 409 au lieu d'un 200
--  muet (§E.27). L'écosystème de la ligne est celui de la CIBLE, pas de
--  l'administrateur — il est plateforme, elle ne l'est pas.
--
--  CE QUE LA LIGNE NE PORTE PAS : la rotation du jeton de session. Elle a lieu
--  APRÈS, hors transaction, et l'affirmer ici serait une promesse sur un futur
--  (§E.24). L'audit la porte déjà.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.changer_statut_compte(
  p_piece          uuid,
  p_piece_origine  uuid,
  p_origine        text,
  p_acteur_id      uuid,
  p_acteur_type    text,
  p_user_id        uuid,
  p_statuts_admis  text[],
  p_nouveau_statut text,
  p_suspend        boolean
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_u record;
  v_n integer;
begin
  if p_piece is null then
    raise exception 'changer_statut_compte : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_acteur_id is null then
    raise exception 'changer_statut_compte : l acteur est obligatoire — une suspension a toujours un auteur' using errcode = 'GL002';
  end if;

  -- LE VERROU : deux administrateurs qui agissent au même instant se
  -- sérialisent ici ; le second lit un statut qui n'est plus admis.
  select u.id, u.status, u.domain_id, u.user_type
    into v_u
    from public.users u
   where u.id = p_user_id
   for update;
  if not found then
    return null;
  end if;
  -- LES GARDES DE COMPTE, RELUES SOUS LE VERROU (point 2.6). La route les juge sur
  -- sa lecture d'avant (`refuseAdminActionOnTarget`) ; une cible DEVENUE
  -- administrateur entre-temps franchissait cette garde, et la clé étrangère du
  -- siège plateforme levait 23503 — une erreur brute, rendue `db_error`. Relue
  -- ici, elle devient le refus NOMMÉ que l'écran traduit déjà, avant toute écriture,
  -- sans ligne (un refus de garde de compte n'est pas une action de la liste fermée).
  if v_u.id = p_acteur_id then
    return jsonb_build_object('refus', 'self_forbidden');
  end if;
  if v_u.user_type = 'admin' then
    return jsonb_build_object('refus', 'target_is_admin');
  end if;
  if not (v_u.status = any (p_statuts_admis)) then
    return null;
  end if;

  update public.users u
     set status = p_nouveau_statut,
         updated_at = now()
   where u.id = p_user_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'changer_statut_compte : users');

  perform public.journaliser(
    p_piece,
    case when p_suspend then 'compte_suspendu' else 'compte_reactive' end,
    'reussi', p_origine,
    p_acteur_id, p_acteur_type, v_u.domain_id,
    'users', p_user_id,
    jsonb_build_object('de', v_u.status, 'vers', p_nouveau_statut, 'type_de_compte', v_u.user_type),
    p_piece_origine, null::numeric, null::text);

  return jsonb_build_object('de', v_u.status, 'vers', p_nouveau_statut);
end;
$fn$;

revoke all on function public.changer_statut_compte(uuid, uuid, text, uuid, text, uuid, text[], text, boolean)
  from public, anon, authenticated;
grant execute on function public.changer_statut_compte(uuid, uuid, text, uuid, text, uuid, text[], text, boolean)
  to service_role;


-- Les DEUX faces reçoivent la même liste, en deux instructions explicites :
-- une liste blanche se lit code par code, et le contrôle la relit ainsi.
update public.grand_livre_actions
   set cles_detail = array['de', 'vers', 'type_de_compte']::text[]
 where code = 'compte_suspendu';

update public.grand_livre_actions
   set cles_detail = array['de', 'vers', 'type_de_compte']::text[]
 where code = 'compte_reactive';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_cles   text[];
  v_user   record;
  v_piece  uuid := gen_random_uuid();
  v_acteur uuid;
  v_res    jsonb;
  v_res2   jsonb;
  v_lignes integer;
begin
  if to_regprocedure('public.changer_statut_compte(uuid, uuid, text, uuid, text, uuid, text[], text, boolean)') is null then
    raise exception 'postcondition NON TENUE : changer_statut_compte manque ou a change de signature';
  end if;
  for v_cles in select cles_detail from public.grand_livre_actions where code in ('compte_suspendu', 'compte_reactive') loop
    if v_cles is null or not (v_cles @> array['de', 'vers', 'type_de_compte']::text[]) then
      raise exception 'postcondition NON TENUE : une liste blanche de bascule de compte est incomplete [vu : %]', v_cles;
    end if;
  end loop;

  -- SONDE — un compte réel non suspendu : suspendu (ligne relue), rejoué (le
  -- statut n'est plus admis : null, aucune seconde ligne), puis réactivé (la
  -- SECONDE action, sous la même fonction). Sans compte : sautée, et dite.
  -- JAMAIS un administrateur : l'occupant du siège plateforme est référencé par
  -- une clé étrangère sur `users (id, admin_disponible)` — le suspendre la
  -- violerait et arrêterait la migration ; et la cible ne doit pas être l'acteur.
  select u.id, u.status into v_user
    from public.users u
   where u.status is distinct from 'suspended'
     and u.user_type is distinct from 'admin'
   limit 1;
  select u.id into v_acteur from public.users u where u.user_type = 'admin' limit 1;
  if v_user.id is null or v_acteur is null then
    raise notice 'postcondition : sonde changer_statut_compte SAUTEE — aucun compte ou aucun administrateur (base vierge)';
    v_sautee := true;
  else
    begin
      v_res := public.changer_statut_compte(v_piece, null::uuid, 'administrateur', v_acteur, 'admin',
                                            v_user.id, array[v_user.status], 'suspended', true);
      if v_res is null or v_res ->> 'vers' <> 'suspended' then
        raise exception 'postcondition NON TENUE : la suspension n a pas abouti [%]', v_res;
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'compte_suspendu' and g.statut = 'reussi'
                        and g.sujet_type = 'users' and g.sujet_id = v_user.id
                        and g.detail ->> 'vers' = 'suspended' and g.detail ->> 'type_de_compte' is not null) then
        raise exception 'postcondition NON TENUE : la ligne compte_suspendu manque ou ne porte pas son detail';
      end if;
      -- LE REJEU : le statut n'est plus admis, null, aucune seconde ligne.
      v_res2 := public.changer_statut_compte(gen_random_uuid(), null::uuid, 'administrateur', v_acteur, 'admin',
                                             v_user.id, array[v_user.status], 'suspended', true);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'compte_suspendu' and g.sujet_id = v_user.id;
      if v_res2 is not null or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : le rejeu a bascule ou journalise une seconde fois [% / % ligne(s)]', v_res2, v_lignes;
      end if;
      -- LA SECONDE ACTION, par la MÊME fonction : réactivation.
      v_res2 := public.changer_statut_compte(gen_random_uuid(), null::uuid, 'administrateur', v_acteur, 'admin',
                                             v_user.id, array['suspended'], 'active', false);
      if v_res2 is null or not exists (select 1 from public.grand_livre g
                                        where g.type_action = 'compte_reactive' and g.sujet_id = v_user.id
                                          and g.detail ->> 'de' = 'suspended' and g.detail ->> 'vers' = 'active') then
        raise exception 'postcondition NON TENUE : la reactivation n a pas ecrit sa ligne [%]', v_res2;
      end if;
      -- LA GARDE DE COMPTE, RELUE SOUS VERROU : l'acteur se vise lui-même → refus NOMMÉ, rien d'écrit.
      select count(*) into v_lignes from public.grand_livre g where g.sujet_id = v_acteur;
      v_res2 := public.changer_statut_compte(gen_random_uuid(), null::uuid, 'administrateur', v_acteur, 'admin',
                                             v_acteur, array['active'], 'suspended', true);
      if v_res2 ->> 'refus' is distinct from 'self_forbidden'
         or exists (select 1 from public.users u where u.id = v_acteur and u.status = 'suspended')
         or (select count(*) from public.grand_livre g where g.sujet_id = v_acteur) <> v_lignes then
        raise exception 'postcondition NON TENUE : un administrateur a pu se suspendre lui-meme, ou le refus n est pas nomme [%]', v_res2;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — une donnée personnelle de la cible est REFUSÉE (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'compte_suspendu', 'reussi', 'administrateur',
                               gen_random_uuid(), 'admin', null::uuid, 'users', gen_random_uuid(),
                               '{"de":"active","vers":"suspended","email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : une adresse est entree dans compte_suspendu';
  exception when sqlstate 'GL004' then
    null;
  end;
  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : compte_suspendu / compte_reactive — bascule et ligne naissent ensemble, le rejeu est null, la seconde action passe par la meme fonction, donnee personnelle refusee';
  else
    raise notice 'postcondition tenue : compte_suspendu / compte_reactive — bascule et ligne naissent ensemble, le rejeu est null, la seconde action passe par la meme fonction, donnee personnelle refusee';
  end if;
end
$post$;
