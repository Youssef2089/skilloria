-- ════════════════════════════════════════════════════════════════════════════
--  APPROUVER OU REFUSER UNE VÉRIFICATION S'ÉCRIT AU GRAND LIVRE — LA DÉCISION
--  ET LA LIGNE, DANS LA MÊME TRANSACTION, PAR UN SEUL ÉCRIVAIN.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Les QUATRE routes d'arbitrage
--  (`admin/approve-expert`, `admin/reject-expert`, `admin/approve-org`,
--  `admin/reject-org`) appellent ces fonctions dès ce commit. Rejouable.
--
--  DEUX ACTIONS, DEUX OBJETS, UN ÉCRIVAIN — et c'est la forme de
--  `journaliser_reglage()` (§D.26) : un expert et une organisation ne
--  s'approuvent pas dans la même table, mais la DÉCISION est la même action.
--  Deux fonctions métier (`statuer_sur_expert`, `statuer_sur_organisation`)
--  portent chacune leur transition ; toutes deux appellent
--  `journaliser_verification()`, qui porte SEUL les deux littéraux et les
--  DÉRIVE du verdict. Quatre routes, un endroit où le code s'écrit.
--
--  LA TRANSITION EST REJOUÉE : seul `pending_admin_review` s'arbitre, et le
--  statut est relu SOUS VERROU. Deux administrateurs qui arbitrent au même
--  instant se sérialisent ; le second lit « déjà traité » et rend `null` —
--  la route répond 409, comme elle le faisait déjà sur sa lecture d'avant,
--  mais cette fois la course est vraiment fermée.
--
--  LE MOTIF DE REFUS EST UN TEXTE LIBRE : il reste sur la ligne métier
--  (`review_reason`), jamais dans le grand livre. La ligne dit qu'il y en a
--  un, pas ce qu'il dit.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ① L'ÉCRIVAIN UNIQUE DES DEUX CODES ──────────────────────────────────────
create or replace function public.journaliser_verification(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_ecosysteme_id uuid,
  p_sujet_type    text,
  p_sujet_id      uuid,
  p_approuve      boolean,
  p_detail        jsonb
) returns bigint
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  if p_piece is null then
    raise exception 'journaliser_verification : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_acteur_id is null then
    raise exception 'journaliser_verification : l acteur est obligatoire — un arbitrage a toujours un auteur' using errcode = 'GL002';
  end if;
  return public.journaliser(
    p_piece,
    case when p_approuve then 'compte_valide' else 'compte_refuse' end,
    'reussi', p_origine,
    p_acteur_id, p_acteur_type, p_ecosysteme_id,
    p_sujet_type, p_sujet_id,
    coalesce(p_detail, '{}'::jsonb),
    p_piece_origine, null::numeric, null::text);
end;
$fn$;

revoke all on function public.journaliser_verification(uuid, uuid, text, uuid, text, uuid, text, uuid, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.journaliser_verification(uuid, uuid, text, uuid, text, uuid, text, uuid, boolean, jsonb)
  to service_role;


-- ── ② L'ARBITRAGE D'UN EXPERT — profil, drapeau du compte, ligne ────────────
create or replace function public.statuer_sur_expert(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_profile_id    uuid,
  p_statut_admis  text,
  p_approuve      boolean,
  p_motif         text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_p     record;
  v_quand timestamptz;
begin
  select p.id, p.user_id, p.domain_id, p.verification_status
    into v_p
    from public.profiles p
   where p.id = p_profile_id
   for update;
  if not found or v_p.verification_status is distinct from p_statut_admis then
    return null;
  end if;

  update public.profiles p
     set verification_status = case when p_approuve then 'approved' else 'rejected' end,
         verified_at         = now(),
         verified_by         = p_acteur_id,
         review_reason       = p_motif
   where p.id = p_profile_id
  returning p.verified_at into v_quand;

  -- Le drapeau agrégé du compte suit la décision, dans la MÊME transaction :
  -- il pilote des gardes, et le laisser dériver rendrait un expert approuvé
  -- invisible (ou l'inverse) sans que rien ne le dise.
  update public.users u
     set is_verified = p_approuve
   where u.id = v_p.user_id;

  perform public.journaliser_verification(
    p_piece, p_piece_origine, p_origine, p_acteur_id, p_acteur_type,
    v_p.domain_id, 'profiles', p_profile_id, p_approuve,
    jsonb_build_object('has_reason', p_motif is not null, 'de', v_p.verification_status));

  return jsonb_build_object('user_id', v_p.user_id, 'domain_id', v_p.domain_id, 'de', v_p.verification_status, 'verified_at', v_quand);
end;
$fn$;

revoke all on function public.statuer_sur_expert(uuid, uuid, text, uuid, text, uuid, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.statuer_sur_expert(uuid, uuid, text, uuid, text, uuid, text, boolean, text)
  to service_role;


-- ── ③ L'ARBITRAGE D'UNE ORGANISATION ───────────────────────────────────────
--  Une organisation n'appartient PAS à un écosystème (elle en rejoint
--  plusieurs, cf. organization_domains) : la ligne n'en porte donc aucun, et
--  c'est un fait, pas un oubli.
create or replace function public.statuer_sur_organisation(
  p_piece           uuid,
  p_piece_origine   uuid,
  p_origine         text,
  p_acteur_id       uuid,
  p_acteur_type     text,
  p_organization_id uuid,
  p_statut_admis    text,
  p_approuve        boolean,
  p_motif           text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_o     record;
  v_quand timestamptz;
begin
  select o.id, o.verification_status
    into v_o
    from public.organizations o
   where o.id = p_organization_id
   for update;
  if not found or v_o.verification_status is distinct from p_statut_admis then
    return null;
  end if;

  update public.organizations o
     set verification_status = case when p_approuve then 'approved' else 'rejected' end,
         -- Invariant : is_verified === (verification_status = 'approved').
         is_verified   = p_approuve,
         verified_at   = now(),
         verified_by   = p_acteur_id,
         review_reason = p_motif
   where o.id = p_organization_id
  returning o.verified_at into v_quand;

  perform public.journaliser_verification(
    p_piece, p_piece_origine, p_origine, p_acteur_id, p_acteur_type,
    null::uuid, 'organizations', p_organization_id, p_approuve,
    jsonb_build_object('has_reason', p_motif is not null, 'de', v_o.verification_status));

  return jsonb_build_object('de', v_o.verification_status, 'verified_at', v_quand);
end;
$fn$;

revoke all on function public.statuer_sur_organisation(uuid, uuid, text, uuid, text, uuid, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.statuer_sur_organisation(uuid, uuid, text, uuid, text, uuid, text, boolean, text)
  to service_role;


-- ── ④ LES LISTES BLANCHES ───────────────────────────────────────────────────
update public.grand_livre_actions
   set cles_detail = array['has_reason', 'de']::text[]
 where code = 'compte_valide';

update public.grand_livre_actions
   set cles_detail = array['has_reason', 'de']::text[]
 where code = 'compte_refuse';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_cles   text[];
  v_prof   record;
  v_org    uuid;
  v_acteur uuid;
  v_piece  uuid := gen_random_uuid();
  v_res    jsonb;
  v_res2   jsonb;
  v_lignes integer;
begin
  if to_regprocedure('public.journaliser_verification(uuid, uuid, text, uuid, text, uuid, text, uuid, boolean, jsonb)') is null
     or to_regprocedure('public.statuer_sur_expert(uuid, uuid, text, uuid, text, uuid, text, boolean, text)') is null
     or to_regprocedure('public.statuer_sur_organisation(uuid, uuid, text, uuid, text, uuid, text, boolean, text)') is null then
    raise exception 'postcondition NON TENUE : une des trois fonctions manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'compte_valide';
  if v_cles is null or not (v_cles @> array['has_reason', 'de']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de compte_valide est incomplete [vu : %]', v_cles;
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'compte_refuse';
  if v_cles is null or not (v_cles @> array['has_reason', 'de']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de compte_refuse est incomplete [vu : %]', v_cles;
  end if;

  select u.id into v_acteur from public.users u where u.user_type = 'admin' limit 1;
  select p.id, p.verification_status into v_prof from public.profiles p where p.verification_status is not null limit 1;
  select o.id into v_org from public.organizations o where o.verification_status is not null limit 1;
  if v_acteur is null or v_prof.id is null then
    raise notice 'postcondition : sonde statuer_sur_expert SAUTEE — aucun profil arbitrable ou aucun administrateur (base vierge)';
    v_sautee := true;
  else
    begin
      -- L'EXPERT : approuvé, ligne relue ; rejoué (le statut n'est plus admis),
      -- null, aucune seconde ligne.
      v_res := public.statuer_sur_expert(v_piece, null::uuid, 'administrateur', v_acteur, 'admin',
                                         v_prof.id, v_prof.verification_status, true, null::text);
      if v_res is null or (v_res ->> 'verified_at') is null then
        raise exception 'postcondition NON TENUE : l arbitrage de l expert n a pas abouti, ou n a pas rendu la date posee [%]', v_res;
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'compte_valide' and g.statut = 'reussi'
                        and g.sujet_type = 'profiles' and g.sujet_id = v_prof.id
                        and (g.detail ->> 'has_reason')::boolean = false) then
        raise exception 'postcondition NON TENUE : la ligne compte_valide manque ou ne porte pas son detail';
      end if;
      if not exists (select 1 from public.profiles p where p.id = v_prof.id and p.verification_status = 'approved')
         or not exists (select 1 from public.users u
                         join public.profiles p on p.user_id = u.id
                        where p.id = v_prof.id and u.is_verified) then
        raise exception 'postcondition NON TENUE : le profil ou le drapeau du compte n est pas relu';
      end if;
      v_res2 := public.statuer_sur_expert(gen_random_uuid(), null::uuid, 'administrateur', v_acteur, 'admin',
                                          v_prof.id, v_prof.verification_status, true, null::text);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'compte_valide' and g.sujet_id = v_prof.id;
      if v_res2 is not null or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : le rejeu a arbitre ou journalise une seconde fois [% / % ligne(s)]', v_res2, v_lignes;
      end if;
      -- LA SECONDE ACTION, par le MÊME écrivain : un refus, avec son motif.
      v_res2 := public.statuer_sur_expert(gen_random_uuid(), null::uuid, 'administrateur', v_acteur, 'admin',
                                          v_prof.id, 'approved', false, 'sonde');
      if v_res2 is null or not exists (select 1 from public.grand_livre g
                                        where g.type_action = 'compte_refuse' and g.sujet_id = v_prof.id
                                          and (g.detail ->> 'has_reason')::boolean = true
                                          and g.detail ->> 'de' = 'approved') then
        raise exception 'postcondition NON TENUE : le refus n a pas ecrit sa ligne [%]', v_res2;
      end if;
      -- L'ORGANISATION, s'il y en a une : même écrivain, autre sujet, sans écosystème.
      if v_org is not null then
        v_res2 := public.statuer_sur_organisation(gen_random_uuid(), null::uuid, 'administrateur', v_acteur, 'admin',
                                                  v_org, (select o.verification_status from public.organizations o where o.id = v_org),
                                                  true, null::text);
        if v_res2 is null or not exists (select 1 from public.grand_livre g
                                          where g.type_action = 'compte_valide' and g.sujet_type = 'organizations'
                                            and g.sujet_id = v_org and g.ecosysteme_id is null) then
          raise exception 'postcondition NON TENUE : l arbitrage d organisation n a pas ecrit sa ligne sans ecosysteme [%]', v_res2;
        end if;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — le MOTIF en texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'compte_refuse', 'reussi', 'administrateur',
                               gen_random_uuid(), 'admin', null::uuid, 'profiles', gen_random_uuid(),
                               '{"has_reason":true,"review_reason":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un motif en texte libre est entre dans compte_refuse';
  exception when sqlstate 'GL004' then
    null;
  end;
  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : compte_valide / compte_refuse — un ecrivain, deux objets, transition rejouee sous verrou, rejeu null, motif en texte libre refuse';
  else
    raise notice 'postcondition tenue : compte_valide / compte_refuse — un ecrivain, deux objets, transition rejouee sous verrou, rejeu null, motif en texte libre refuse';
  end if;
end
$post$;
