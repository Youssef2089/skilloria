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


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui vérifiait le téléphone d'un vrai compte est retirée (28/09/2026). Le geste — drapeau et
-- numéro sur le compte, ligne avec la méthode et SANS le numéro, compte inconnu false sans rien écrire —
-- est prouvé par supabase/tests/database/grand_livre/telephone_verifie.test.sql. Le compte inconnu reste
-- sondé ici : identifiants INVENTÉS, aucune ligne réelle touchée.
declare
  v_cles text[];
  v_ok   boolean;
begin
  if to_regprocedure('public.verifier_telephone(uuid, uuid, text, uuid, text, uuid, text, text)') is null then
    raise exception 'postcondition NON TENUE : verifier_telephone manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'telephone_verifie';
  if v_cles is null or not (v_cles @> array['methode']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de telephone_verifie est incomplete [vu : %]', v_cles;
  end if;
  begin
    v_ok := public.verifier_telephone(gen_random_uuid(), null::uuid, 'utilisateur', gen_random_uuid(), 'client',
                                      gen_random_uuid(), '+999' || lpad((floor(random() * 1e10))::bigint::text, 10, '0'), 'otp_sms');
    if v_ok is distinct from false then
      raise exception 'postcondition NON TENUE : un compte inconnu a ete verifie [%]', v_ok;
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  begin
    perform public.journaliser(gen_random_uuid(), 'telephone_verifie', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'users', gen_random_uuid(),
                               '{"methode":"otp_sms","phone":"+33600000000"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un numero est entre dans telephone_verifie';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : telephone_verifie — signature par types, liste blanche, compte inconnu false, numero refuse ; le geste est prouve par tests/database/grand_livre/telephone_verifie.test.sql';
end
$post$;
