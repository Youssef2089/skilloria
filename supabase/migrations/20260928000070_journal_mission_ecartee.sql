-- ════════════════════════════════════════════════════════════════════════════
--  UNE MISSION ÉCARTÉE PAR L'EXPERT S'ÉCRIT AU GRAND LIVRE — L'ÉCART ET SA
--  LIGNE DANS UNE SEULE FONCTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/me/missions/[id]/dismiss`
--  appelle `ecarter_mission` dès ce commit. Ajoute : une action, une fonction.
--  Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.1) : la route faisait `matches.update
--  ({status: 'dismissed'})` — AUCUNE trace, pas même d'audit. Or un écart pèse :
--  le moteur ne repropose plus cette mission à cet expert (la réconciliation
--  préserve `dismissed`). Populations : expert freelance, expert CDI — et la
--  collaboration entre experts, dont les besoins arrivent par le même fil.
--
--  LA FONCTION : lit le match du couple (annonce, profil) SOUS VERROU, vérifie EN
--  BASE que le profil appartient à l'acteur (un identifiant de profil fourni ne
--  suffit pas), écarte, compte la ligne (EC001), journalise. Issues : 'ecartee',
--  'deja_ecartee' (idempotent, rien d'écrit — rien n'a changé), 'introuvable'
--  (pas de match pour ce profil, ou profil qui n'est pas celui de l'acteur).
--
--  CE QUE LA LIGNE PORTE : sujet le match ; l'annonce, son type (mission, offre,
--  sous_traitance — l'écart d'un besoin de collaboration se filtre par là), et le
--  statut d'AVANT (pending, notified, viewed). Écosystème : celui du match.
--  Famille `candidature` : c'est la réponse de l'expert à une proposition, le
--  pendant de `candidature_declinee`.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('mission_ecartee',            'candidature',    null,     'journal.actions.mission_ecartee')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['publication_id', 'publication_type', 'statut_de']::text[]
 where code = 'mission_ecartee';


create or replace function public.ecarter_mission(
  p_piece          uuid,
  p_piece_origine  uuid,
  p_origine        text,
  p_acteur_id      uuid,
  p_acteur_type    text,
  p_publication_id uuid,
  p_profile_id     uuid
) returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_m    record;
  v_type text;
  v_n    integer;
begin
  select m.id, m.status, m.domain_id into v_m
    from public.matches m
    join public.profiles p on p.id = m.profile_id
   where m.publication_id = p_publication_id
     and m.profile_id = p_profile_id
     and p.user_id = p_acteur_id
     for update of m;
  if not found then
    return 'introuvable';
  end if;
  if v_m.status = 'dismissed' then
    return 'deja_ecartee';
  end if;

  update public.matches m set status = 'dismissed' where m.id = v_m.id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'ecarter_mission : matches');

  select p.type into v_type from public.publications p where p.id = p_publication_id;
  perform public.journaliser(
    p_piece, 'mission_ecartee', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, v_m.domain_id, 'matches', v_m.id,
    jsonb_build_object('publication_id', p_publication_id, 'publication_type', v_type, 'statut_de', v_m.status),
    p_piece_origine, null::numeric, null::text);
  return 'ecartee';
end;
$fn$;

revoke all on function public.ecarter_mission(uuid, uuid, text, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ecarter_mission(uuid, uuid, text, uuid, text, uuid, uuid) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'mission_ecartee';
  if not found then
    raise exception 'postcondition NON TENUE : mission_ecartee absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'candidature' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['publication_id', 'publication_type', 'statut_de']::text[] then
    raise exception 'postcondition NON TENUE : mission_ecartee [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  if to_regprocedure('public.ecarter_mission(uuid, uuid, text, uuid, text, uuid, uuid)') is null then
    raise exception 'postcondition NON TENUE : ecarter_mission(uuid, uuid, text, uuid, text, uuid, uuid) absente';
  end if;
  if has_function_privilege('authenticated', 'public.ecarter_mission(uuid, uuid, text, uuid, text, uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.ecarter_mission(uuid, uuid, text, uuid, text, uuid, uuid)', 'execute') then
    raise exception 'postcondition NON TENUE : ecarter_mission executable depuis le navigateur';
  end if;
  raise notice 'postcondition tenue : mission_ecartee dans la liste fermee (famille candidature), ecarter_mission presente et fermee au navigateur ; l ecart (freelance, CDI, sous-traitance), l idempotence et le profil d autrui sont prouves par tests/database/grand_livre/mission_ecartee.test.sql';
end
$post$;
