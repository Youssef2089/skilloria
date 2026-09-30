-- ════════════════════════════════════════════════════════════════════════════
--  LE VERDICT AUTOMATIQUE D'UNE VÉRIFICATION D'EXPERT : le profil, le drapeau du
--  compte, son état et la ligne du grand livre — dans UNE transaction (§D.30).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Ajoute une action et deux
--  fonctions ; remplace `statuer_sur_expert` À SIGNATURE IDENTIQUE. Rejouable.
--
--  LES DÉFAUTS (audit du 30/09/2026 sur aac5f79) :
--   ① une AUTO-APPROBATION n'était écrite nulle part au grand livre : seule la
--     décision d'un administrateur l'était (`compte_valide`), et le commentaire de
--     `lib/profil/journal-profil.ts` affirmait le contraire ;
--   ② le verdict s'écrivait en DEUX appels (le profil, puis `users.is_verified`),
--     le second seulement journalisé s'il échouait — un expert approuvé pouvait
--     garder un drapeau faux ;
--   ③ `users.status` restait `in_review` après l'approbation, automatique ou
--     humaine : jamais remis à `active`.
--
--  POURQUOI UNE ACTION NOUVELLE ET PAS `compte_valide` : `compte_valide` est un
--  ARBITRAGE, et « un arbitrage a toujours un auteur » est une règle écrite et
--  testée (journaliser_verification, GL002). La machine ne tranche pas : elle
--  approuve quand la note le permet, sinon elle DÉFÈRE à un humain. Les deux
--  issues sont `verification_conclue`, avec `approuve` et le `motif` nommé.
--
--  UN ÉCRIVAIN : `poser_verdict_verification()` porte seule le littéral. Elle est
--  appelée par `conclure_verification_expert()` (l'exécutant, sous son travail) et
--  par le repli des travaux d'IA (migration travaux_ia, un travail perdu).
--
--  LES DONNÉES DU VERDICT NE PASSENT PAS PAR ELLE : les notes et les écarts relevés
--  par l'IA peuvent citer la personne. L'écrivain du grand livre ne les reçoit pas ;
--  ses appelants écrivent `verification_data` eux-mêmes, dans la même transaction.
--  Une donnée personnelle qui n'entre pas dans l'écrivain ne peut pas en sortir.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('verification_conclue', 'compte', null, 'journal.actions.verification_conclue')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['approuve', 'motif', 'de']::text[]
 where code = 'verification_conclue';


-- ── ① L'ÉCRIVAIN UNIQUE DU VERDICT AUTOMATIQUE ─────────────────────────────
create or replace function public.poser_verdict_verification(
  p_piece      uuid,
  p_profile_id uuid,
  p_approuve   boolean,
  p_methode    text,
  p_score      numeric,
  p_motif      text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_p record;
  v_n integer;
begin
  if p_piece is null then
    raise exception 'poser_verdict_verification : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_motif is null or p_motif !~ '^[a-z][a-z0-9_]{2,60}$' then
    raise exception 'poser_verdict_verification : le motif est un CODE nommé (vu : %)', p_motif using errcode = '22023';
  end if;

  select p.id, p.user_id, p.domain_id, p.verification_status
    into v_p
    from public.profiles p
   where p.id = p_profile_id
   for update;
  if not found then
    raise exception 'poser_verdict_verification : profil % inconnu', p_profile_id using errcode = 'P0002';
  end if;

  update public.profiles p
     set verification_status = case when p_approuve then 'approved' else 'pending_admin_review' end,
         verification_method = p_methode,
         verification_score  = p_score,
         verified_at         = case when p_approuve then now() else p.verified_at end,
         -- Automatique : aucun administrateur n'a tranché.
         verified_by         = case when p_approuve then null else p.verified_by end,
         review_reason       = case when p_approuve then null else p.review_reason end
   where p.id = p_profile_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'poser_verdict_verification : profiles');

  -- Le drapeau du compte suit le verdict DANS LA MÊME TRANSACTION, et l'état du
  -- compte quitte « en revue » quand il est approuvé — jamais un compte suspendu.
  update public.users u
     set is_verified = p_approuve,
         status      = case when p_approuve and u.status = 'in_review' then 'active' else u.status end
   where u.id = v_p.user_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'poser_verdict_verification : users');

  perform public.journaliser(
    p_piece, 'verification_conclue', 'reussi', 'systeme',
    null::uuid, null::text, v_p.domain_id,
    'profiles', p_profile_id,
    jsonb_build_object('approuve', p_approuve, 'motif', p_motif, 'de', v_p.verification_status),
    null::uuid, null::numeric, null::text);

  return jsonb_build_object('user_id', v_p.user_id, 'domain_id', v_p.domain_id, 'de', v_p.verification_status);
end;
$fn$;

revoke all on function public.poser_verdict_verification(uuid, uuid, boolean, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.poser_verdict_verification(uuid, uuid, boolean, text, numeric, text)
  to service_role;


-- ── ② L'ARBITRAGE HUMAIN : le compte quitte aussi « en revue » à l'approbation ──
--  Corps repris de journal_compte_valide À L'IDENTIQUE, plus la ligne `status`.
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
  v_n     integer;
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
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'statuer_sur_expert : profiles');

  update public.users u
     set is_verified = p_approuve,
         status      = case when p_approuve and u.status = 'in_review' then 'active' else u.status end
   where u.id = v_p.user_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'statuer_sur_expert : users');

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


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'verification_conclue';
  if not found or v_a.famille is distinct from 'compte' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['approuve', 'motif', 'de']::text[] then
    raise exception 'postcondition NON TENUE : verification_conclue mal declaree';
  end if;
  if to_regprocedure('public.poser_verdict_verification(uuid, uuid, boolean, text, numeric, text)') is null
     or to_regprocedure('public.statuer_sur_expert(uuid, uuid, text, uuid, text, uuid, text, boolean, text)') is null then
    raise exception 'postcondition NON TENUE : une fonction du verdict manque ou a change de signature';
  end if;
  if has_function_privilege('authenticated', 'public.poser_verdict_verification(uuid, uuid, boolean, text, numeric, text)', 'execute') then
    raise exception 'postcondition NON TENUE : poser_verdict_verification ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : verification_conclue declaree, poser_verdict_verification fermee au navigateur ; le verdict atomique, le drapeau et l etat du compte sont prouves par tests/database/grand_livre/verification_conclue.test.sql';
end
$post$;
