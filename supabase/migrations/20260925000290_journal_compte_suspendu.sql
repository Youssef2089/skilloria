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


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui suspendait un vrai compte avec un vrai administrateur est retirée (28/09/2026). Le geste —
-- bascule et ligne ensemble avec le type de compte, rejeu null, réactivation par la même fonction (de/vers),
-- self_forbidden sans rien écrire, et la course qui rend target_is_admin — est prouvé par
-- supabase/tests/database/grand_livre/compte_suspendu.test.sql.
declare
  v_cles text[];
begin
  if to_regprocedure('public.changer_statut_compte(uuid, uuid, text, uuid, text, uuid, text[], text, boolean)') is null then
    raise exception 'postcondition NON TENUE : changer_statut_compte manque ou a change de signature';
  end if;
  for v_cles in select cles_detail from public.grand_livre_actions where code in ('compte_suspendu', 'compte_reactive') loop
    if v_cles is null or not (v_cles @> array['de', 'vers', 'type_de_compte']::text[]) then
      raise exception 'postcondition NON TENUE : une liste blanche de bascule de compte est incomplete [vu : %]', v_cles;
    end if;
  end loop;
  begin
    perform public.journaliser(gen_random_uuid(), 'compte_suspendu', 'reussi', 'administrateur',
                               gen_random_uuid(), 'admin', null::uuid, 'users', gen_random_uuid(),
                               '{"de":"active","vers":"suspended","email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : une adresse est entree dans compte_suspendu';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : compte_suspendu / compte_reactive — signature par types, deux listes blanches, donnee personnelle refusee ; le geste est prouve par tests/database/grand_livre/compte_suspendu.test.sql';
end
$post$;
