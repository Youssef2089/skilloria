-- ════════════════════════════════════════════════════════════════════════════
--  LES TROIS PURGES ET L'AVERTISSEMENT D'INACTIVITÉ S'ÉCRIVENT AU GRAND LIVRE
--  — LE JALON ET LA LIGNE, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `lib/account-purge.ts` et
--  `app/api/cron/purge-inactive` appellent ces fonctions dès ce commit.
--  Rejouable.
--
--  ═══ LES PURGES : UN ÉCRIVAIN, TROIS ACTIONS SÉPARÉES ════════════════════
--  `purgeAccount()` est la SEULE mécanique d'anonymisation, partagée par trois
--  appelants : la purge des suppressions demandées (tâche), la purge
--  d'inactivité (tâche, règle CNIL), la purge par un administrateur. Elle porte
--  déjà l'origine sous un type FERMÉ et obligatoire (`ContextePurge`). Les trois
--  ne se relisent pas de la même façon — une obligation légale (art. 17), une
--  règle de conservation, un geste d'administrateur — et la liste fermée les
--  sépare. `anonymiser_compte()` reçoit le MOTIF, le valide AVANT d'écrire, et
--  en DÉRIVE le code.
--
--  CE QUI ENTRE DANS LA TRANSACTION : l'étape 4 de la purge — l'anonymisation
--  de `users` et le JALON `anonymized_at` — et la ligne. Les étapes 1 à 3
--  (Auth, Storage, profil, journal d'audit) sont des appels que PostgREST ne
--  peut pas mettre dans une transaction (§C.20) ; elles LÈVENT sur échec
--  bloquant, et alors ni le jalon ni la ligne ne sont écrits : le compte est
--  repris au passage suivant. Une purge sans trace, ou une trace sans purge,
--  seraient deux moitiés du même défaut.
--
--  LE JALON EST SA PROPRE GARDE : `where anonymized_at is null`. Un compte déjà
--  purgé rend `false` et n'écrit RIEN — ni seconde anonymisation, ni seconde
--  ligne. La ligne ne porte que des faits sur ce qui a été effacé — jamais
--  l'adresse, qui disparaît à l'instant même.
--
--  ═══ L'AVERTISSEMENT D'INACTIVITÉ : LES DEUX ISSUES, UN ÉCRIVAIN ══════════
--  L'e-mail part (Resend), PUIS la base pose le marqueur et écrit la ligne
--  `reussi` ensemble — avant, un marqueur en échec était journalisé à part et
--  rien ne liait les deux. S'il ne part pas, la ligne dit `echoue` avec la
--  CAUSE (un code), et le marqueur n'est pas posé : l'avertissement sera
--  retenté, et la purge, qui l'exige, attendra.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.anonymiser_compte(
  p_piece             uuid,
  p_piece_origine     uuid,
  p_origine           text,
  p_acteur_id         uuid,
  p_acteur_type       text,
  p_user_id           uuid,
  p_email_substitut   text,
  p_motif             text,
  p_profil_anonymise  boolean,
  p_cv_supprime       boolean,
  p_avatar_supprime   boolean,
  p_audit_lignes      integer
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_domaine uuid;
begin
  if p_piece is null then
    raise exception 'anonymiser_compte : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_motif is null or p_motif not in ('inactivite', 'demande', 'admin') then
    raise exception 'anonymiser_compte : motif inconnu « % » — trois purges, pas une de plus', p_motif using errcode = '22023';
  end if;
  if p_email_substitut is null then
    raise exception 'anonymiser_compte : l adresse de substitution est obligatoire' using errcode = '22023';
  end if;

  update public.users u
     set email              = p_email_substitut,
         first_name         = null,
         last_name          = null,
         phone              = null,
         phone_verified     = false,
         linkedin_url       = null,
         civility           = null,
         job_title          = null,
         status             = 'archived',
         last_session_token = null,
         anonymized_at      = now()
   where u.id = p_user_id
     and u.anonymized_at is null
  returning u.domain_id into v_domaine;
  if not found then
    return false;
  end if;

  perform public.journaliser(
    p_piece,
    case p_motif when 'inactivite' then 'compte_purge_inactivite'
                 when 'demande'    then 'compte_purge_demande'
                 else                   'compte_purge_admin' end,
    'reussi', p_origine,
    p_acteur_id, p_acteur_type, v_domaine,
    'users', p_user_id,
    jsonb_build_object(
      'profil_anonymise', p_profil_anonymise,
      'cv_supprime', p_cv_supprime,
      'avatar_supprime', p_avatar_supprime,
      'audit_lignes_nettoyees', p_audit_lignes),
    p_piece_origine, null::numeric, null::text);

  return true;
end;
$fn$;

revoke all on function public.anonymiser_compte(uuid, uuid, text, uuid, text, uuid, text, text, boolean, boolean, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.anonymiser_compte(uuid, uuid, text, uuid, text, uuid, text, text, boolean, boolean, boolean, integer)
  to service_role;


create or replace function public.constater_avertissement_inactivite(
  p_piece            uuid,
  p_piece_origine    uuid,
  p_origine          text,
  p_acteur_id        uuid,
  p_acteur_type      text,
  p_user_id          uuid,
  p_echeance_purge   timestamptz,
  p_envoye           boolean,
  p_demande_email_id text,
  p_cause            text
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_domaine uuid;
begin
  if p_piece is null then
    raise exception 'constater_avertissement_inactivite : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_envoye is null or (not p_envoye and p_cause is null) then
    raise exception 'constater_avertissement_inactivite : un echec porte sa cause' using errcode = '22023';
  end if;

  if p_envoye then
    update public.users u
       set inactivity_warning_sent_at = now()
     where u.id = p_user_id
       and u.anonymized_at is null
    returning u.domain_id into v_domaine;
    if not found then
      return false;
    end if;
  else
    select u.domain_id into v_domaine from public.users u where u.id = p_user_id;
    if not found then
      return false;
    end if;
  end if;

  perform public.journaliser(
    p_piece, 'inactivite_avertie',
    case when p_envoye then 'reussi' else 'echoue' end,
    p_origine,
    p_acteur_id, p_acteur_type, v_domaine,
    'users', p_user_id,
    jsonb_build_object(
      'echeance_purge', p_echeance_purge,
      'demande_email_id', p_demande_email_id,
      'cause', case when p_envoye then null else left(p_cause, 60) end),
    p_piece_origine, null::numeric, null::text);

  return true;
end;
$fn$;

revoke all on function public.constater_avertissement_inactivite(uuid, uuid, text, uuid, text, uuid, timestamptz, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.constater_avertissement_inactivite(uuid, uuid, text, uuid, text, uuid, timestamptz, boolean, text, text)
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['profil_anonymise', 'cv_supprime', 'avatar_supprime', 'audit_lignes_nettoyees']::text[]
 where code = 'compte_purge_inactivite';
update public.grand_livre_actions
   set cles_detail = array['profil_anonymise', 'cv_supprime', 'avatar_supprime', 'audit_lignes_nettoyees']::text[]
 where code = 'compte_purge_demande';
update public.grand_livre_actions
   set cles_detail = array['profil_anonymise', 'cv_supprime', 'avatar_supprime', 'audit_lignes_nettoyees']::text[]
 where code = 'compte_purge_admin';
update public.grand_livre_actions
   set cles_detail = array['echeance_purge', 'demande_email_id', 'cause']::text[]
 where code = 'inactivite_avertie';


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui anonymisait un vrai compte sous chacun des trois motifs, puis avertissait un vrai compte,
-- est retirée (28/09/2026) — en production, elle aurait touché le compte d'une vraie personne. Le geste —
-- trois motifs, trois codes, UNE ligne chacun sans l'adresse, déjà purgé sans rien, acteur de la purge
-- d'administrateur, avertissement aux deux issues — est prouvé par
-- supabase/tests/database/grand_livre/purges.test.sql. Les deux REFUS restent sondés ici : ils lèvent
-- AVANT toute lecture, sur des identifiants INVENTÉS.
declare
  v_n  integer;
  v_ok boolean;
begin
  if to_regprocedure('public.anonymiser_compte(uuid, uuid, text, uuid, text, uuid, text, text, boolean, boolean, boolean, integer)') is null
     or to_regprocedure('public.constater_avertissement_inactivite(uuid, uuid, text, uuid, text, uuid, timestamp with time zone, boolean, text, text)') is null then
    raise exception 'postcondition NON TENUE : une des deux fonctions manque ou a change de signature';
  end if;
  select count(*) into v_n from public.grand_livre_actions
   where code in ('compte_purge_inactivite', 'compte_purge_demande', 'compte_purge_admin')
     and array_length(cles_detail, 1) = 4 and cles_detail @> array['profil_anonymise', 'audit_lignes_nettoyees']::text[];
  if v_n <> 3 then
    raise exception 'postcondition NON TENUE : les listes blanches des trois purges sont fausses [% sur 3]', v_n;
  end if;
  begin
    perform public.anonymiser_compte(gen_random_uuid(), null::uuid, 'tache_planifiee', null::uuid, null::text,
                                     gen_random_uuid(), 'sonde@deleted.invalid', 'autre', true, null, true, 0);
    raise exception 'postcondition NON TENUE : un motif inconnu a ete accepte';
  exception when sqlstate '22023' then
    null;
  end;
  begin
    perform public.constater_avertissement_inactivite(gen_random_uuid(), null::uuid, 'tache_planifiee', null::uuid, null::text,
                                                      gen_random_uuid(), now(), false, null, null);
    raise exception 'postcondition NON TENUE : un echec sans cause a ete accepte';
  exception when sqlstate '22023' then
    null;
  end;
  begin
    v_ok := public.anonymiser_compte(gen_random_uuid(), null::uuid, 'tache_planifiee', null::uuid, null::text,
                                     gen_random_uuid(), 'sonde@deleted.invalid', 'inactivite', true, null, true, 0);
    if v_ok is distinct from false then
      raise exception 'postcondition NON TENUE : un compte inconnu a ete purge';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  begin
    perform public.journaliser(gen_random_uuid(), 'compte_purge_demande', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'users', gen_random_uuid(),
                               '{"profil_anonymise":true,"email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : l adresse est entree dans une purge';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : purges — deux signatures par types, trois listes blanches, motif inconnu et echec sans cause refuses, compte inconnu sans rien, adresse refusee ; les gestes sont prouves par tests/database/grand_livre/purges.test.sql';
end
$post$;
