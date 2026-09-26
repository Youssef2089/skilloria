-- ════════════════════════════════════════════════════════════════════════════
--  UN TÉLÉPHONE VÉRIFIÉ S'ÉCRIT AU GRAND LIVRE — LE DRAPEAU, LE NUMÉRO ET LA
--  LIGNE, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `app/api/auth/verify-phone-otp`
--  appelle `verifier_telephone()` dès ce commit. Rejouable.
--
--  LA LIGNE NE PORTE QUE LA MÉTHODE. Le NUMÉRO est écrit sur le compte — c'est
--  sa place, et une purge l'y trouve — mais jamais dans le journal : il y
--  survivrait à la suppression du compte. C'est exactement ce que la route
--  disait déjà de son audit ; la liste blanche le rend inviolable.
--
--  L'UNICITÉ RESTE CELLE DE LA BASE : deux comptes ne peuvent pas porter le
--  même numéro. La violation remonte telle quelle (23505) et la route la
--  traduit déjà en 409 — aucune ligne n'est écrite, puisque la transaction
--  entière est annulée. C'est la garantie que la RPC ajoute : avant, le
--  drapeau pouvait être posé et la trace manquer.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.verifier_telephone(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_user_id       uuid,
  p_phone         text,
  p_methode       text
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_domaine uuid;
begin
  if p_piece is null then
    raise exception 'verifier_telephone : la piece est obligatoire' using errcode = 'GL002';
  end if;

  update public.users u
     set phone_verified = true,
         phone          = p_phone
   where u.id = p_user_id
  returning u.domain_id into v_domaine;
  if not found then
    return false;
  end if;

  perform public.journaliser(
    p_piece, 'telephone_verifie', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, v_domaine,
    'users', p_user_id,
    jsonb_build_object('methode', p_methode),
    p_piece_origine, null::numeric, null::text);

  return true;
end;
$fn$;

revoke all on function public.verifier_telephone(uuid, uuid, text, uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.verifier_telephone(uuid, uuid, text, uuid, text, uuid, text, text)
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['methode']::text[]
 where code = 'telephone_verifie';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_cles  text[];
  v_user  uuid;
  v_piece uuid := gen_random_uuid();
  v_ok    boolean;
  v_ok2   boolean;
  -- Un numéro qu'aucun compte réel ne peut porter : indicatif +999 NON attribué, tiré au
  -- hasard. Un numéro fixe de recette pouvait déjà être VÉRIFIÉ sur un compte, et l'index
  -- unique partiel aurait arrêté la migration (23505).
  v_tel   text := '+999' || lpad((floor(random() * 1e10))::bigint::text, 10, '0');
begin
  if to_regprocedure('public.verifier_telephone(uuid, uuid, text, uuid, text, uuid, text, text)') is null then
    raise exception 'postcondition NON TENUE : verifier_telephone manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'telephone_verifie';
  if v_cles is null or not (v_cles @> array['methode']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de telephone_verifie est incomplete [vu : %]', v_cles;
  end if;

  -- SONDE — un compte réel : drapeau posé, ligne relue (avec la méthode, SANS
  -- le numéro) ; un compte inconnu rend false SANS écrire.
  select u.id into v_user from public.users u limit 1;
  if v_user is null then
    raise notice 'postcondition : sonde verifier_telephone SAUTEE — aucun compte (base vierge)';
    v_sautee := true;
  else
    begin
      v_ok := public.verifier_telephone(v_piece, null::uuid, 'utilisateur', v_user, 'client',
                                        v_user, v_tel, 'otp_sms');
      if v_ok is distinct from true then
        raise exception 'postcondition NON TENUE : la verification n a pas abouti';
      end if;
      if not exists (select 1 from public.users u where u.id = v_user and u.phone_verified) then
        raise exception 'postcondition NON TENUE : le drapeau n est pas pose';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'telephone_verifie' and g.statut = 'reussi'
                        and g.sujet_type = 'users' and g.sujet_id = v_user
                        and g.detail ->> 'methode' = 'otp_sms'
                        and g.detail::text not like '%' || v_tel || '%') then
        raise exception 'postcondition NON TENUE : la ligne manque, ne porte pas la methode, ou porte le NUMERO';
      end if;
      v_ok2 := public.verifier_telephone(gen_random_uuid(), null::uuid, 'utilisateur', v_user, 'client',
                                         gen_random_uuid(), v_tel || '9', 'otp_sms');
      if v_ok2 is distinct from false then
        raise exception 'postcondition NON TENUE : un compte inconnu a ete verifie [%]', v_ok2;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — le NUMÉRO est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'telephone_verifie', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'users', gen_random_uuid(),
                               '{"methode":"otp_sms","phone":"+33600000000"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un numero est entre dans telephone_verifie';
  exception when sqlstate 'GL004' then
    null;
  end;
  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : telephone_verifie — drapeau et ligne naissent ensemble, la ligne porte la methode sans le numero, un compte inconnu n ecrit rien';
  else
    raise notice 'postcondition tenue : telephone_verifie — drapeau et ligne naissent ensemble, la ligne porte la methode sans le numero, un compte inconnu n ecrit rien';
  end if;
end
$post$;
