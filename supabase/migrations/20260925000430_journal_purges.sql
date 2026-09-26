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


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67, §E.70) ───────────────────────────
--  Sur un compte réel non anonymisé, dans la sous-transaction annulée : les
--  trois motifs écrivent chacun SON code (le jalon remis à nul entre deux), un
--  compte déjà purgé ne produit rien, un motif inconnu lève avant d'écrire ;
--  l'avertissement écrit ses deux issues.
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_n      integer;
  v_user   record;
  v_admin  uuid;
  v_p      uuid;
  v_ok     boolean;
  v_code   text;
  v_motif  text;
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

  select u.id, u.email into v_user from public.users u
   where u.anonymized_at is null and u.email is not null and u.user_type is distinct from 'admin' limit 1;
  select u.id into v_admin from public.users u where u.user_type = 'admin' limit 1;
  if v_user.id is null or v_admin is null then
    raise notice 'postcondition : sondes des purges SAUTEES — aucun compte ou aucun administrateur (base vierge)';
    v_sautee := true;
  else
    begin
      -- UN MOTIF INCONNU : refusé AVANT d'écrire.
      begin
        perform public.anonymiser_compte(gen_random_uuid(), null::uuid, 'tache_planifiee', null::uuid, null::text,
                                         v_user.id, 'sonde@deleted.invalid', 'autre', true, null, true, 0);
        raise exception 'postcondition NON TENUE : un motif inconnu a ete accepte';
      exception when sqlstate '22023' then
        null;
      end;
      if exists (select 1 from public.users u where u.id = v_user.id and u.anonymized_at is not null) then
        raise exception 'postcondition NON TENUE : un motif refuse a pose le jalon';
      end if;
      -- LES TROIS MOTIFS, CHACUN SOUS SON NOM.
      foreach v_motif in array array['inactivite', 'demande', 'admin'] loop
        v_p := gen_random_uuid();
        v_code := case v_motif when 'inactivite' then 'compte_purge_inactivite' when 'demande' then 'compte_purge_demande' else 'compte_purge_admin' end;
        if v_motif = 'admin' then
          v_ok := public.anonymiser_compte(v_p, null::uuid, 'administrateur', v_admin, 'admin',
                                           v_user.id, 'sonde@deleted.invalid', v_motif, true, null, true, 2);
        else
          v_ok := public.anonymiser_compte(v_p, null::uuid, 'tache_planifiee', null::uuid, null::text,
                                           v_user.id, 'sonde@deleted.invalid', v_motif, true, null, true, 2);
        end if;
        if v_ok is distinct from true
           or not exists (select 1 from public.users u where u.id = v_user.id and u.anonymized_at is not null
                            and u.email = 'sonde@deleted.invalid' and u.first_name is null and u.status = 'archived')
           or not exists (select 1 from public.grand_livre g where g.piece = v_p and g.type_action = v_code
                            and g.sujet_id = v_user.id and (g.detail ->> 'audit_lignes_nettoyees')::int = 2
                            and g.detail::text not ilike '%' || v_user.email || '%') then
          raise exception 'postcondition NON TENUE : la purge « % » n est pas relue sous % (jalon, anonymisation, ligne sans adresse)', v_motif, v_code;
        end if;
        select count(*) into v_n from public.grand_livre g where g.piece = v_p;
        if v_n <> 1 then
          raise exception 'postcondition NON TENUE : la purge « % » a ecrit % ligne(s), pas une', v_motif, v_n;
        end if;
        -- DÉJÀ PURGÉ : rien.
        v_ok := public.anonymiser_compte(gen_random_uuid(), null::uuid, 'tache_planifiee', null::uuid, null::text,
                                         v_user.id, 'sonde2@deleted.invalid', v_motif, true, null, true, 0);
        if v_ok is distinct from false or exists (select 1 from public.users u where u.id = v_user.id and u.email = 'sonde2@deleted.invalid') then
          raise exception 'postcondition NON TENUE : un compte deja purge a ete repurge';
        end if;
        update public.users set anonymized_at = null where id = v_user.id;
      end loop;
      -- L'AVERTISSEMENT : les deux issues.
      update public.users set inactivity_warning_sent_at = null where id = v_user.id;
      v_p := gen_random_uuid();
      v_ok := public.constater_avertissement_inactivite(v_p, null::uuid, 'tache_planifiee', null::uuid, null::text,
                                                        v_user.id, now() + interval '30 days', false, null, 'resend_refuse');
      if v_ok is distinct from true
         or exists (select 1 from public.users u where u.id = v_user.id and u.inactivity_warning_sent_at is not null)
         or not exists (select 1 from public.grand_livre g where g.piece = v_p and g.type_action = 'inactivite_avertie'
                          and g.statut = 'echoue' and g.detail ->> 'cause' = 'resend_refuse') then
        raise exception 'postcondition NON TENUE : l avertissement en echec n est pas relu (ligne echouee, marqueur NON pose)';
      end if;
      v_p := gen_random_uuid();
      v_ok := public.constater_avertissement_inactivite(v_p, null::uuid, 'tache_planifiee', null::uuid, null::text,
                                                        v_user.id, now() + interval '30 days', true, 'msg_sonde', null);
      if v_ok is distinct from true
         or not exists (select 1 from public.users u where u.id = v_user.id and u.inactivity_warning_sent_at is not null)
         or not exists (select 1 from public.grand_livre g where g.piece = v_p and g.type_action = 'inactivite_avertie'
                          and g.statut = 'reussi' and g.detail ->> 'cause' is null) then
        raise exception 'postcondition NON TENUE : l avertissement parti n est pas relu (marqueur ET ligne)';
      end if;
      begin
        perform public.constater_avertissement_inactivite(gen_random_uuid(), null::uuid, 'tache_planifiee', null::uuid, null::text,
                                                          v_user.id, now(), false, null, null);
        raise exception 'postcondition NON TENUE : un echec sans cause a ete accepte';
      exception when sqlstate '22023' then
        null;
      end;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — l'adresse est REFUSÉE dans une purge (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'compte_purge_demande', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'users', gen_random_uuid(),
                               '{"profil_anonymise":true,"email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : l adresse est entree dans une purge';
  exception when sqlstate 'GL004' then
    null;
  end;
  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : trois purges sous trois noms par un ecrivain, jalon et ligne ensemble, deja purge sans rien ; avertissement aux deux issues';
  else
    raise notice 'postcondition tenue : trois purges sous trois noms par un ecrivain, jalon et ligne ensemble, deja purge sans rien ; avertissement aux deux issues';
  end if;
end
$post$;
