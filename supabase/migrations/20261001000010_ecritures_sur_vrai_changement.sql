-- ════════════════════════════════════════════════════════════════════════════
--  UNE ÉCRITURE POUR UN VRAI CHANGEMENT — les écrivains SQL de la liste validée (ARRÊT 22, 01/10/2026, §D.33).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement (§G.4). Toutes les fonctions sont remplacées À SIGNATURE IDENTIQUE —
--  le code en ligne les appelle comme avant — et une fonction est AJOUTÉE (se_desabonner_email), que seul le code
--  nouveau appelle.
--
--   ① envoyer_message — le message n'écrit plus au grand livre (action retirée).
--   ② verifier_telephone — une ligne seulement si le numéro change ou n'était pas vérifié.
--   ③ effacer_adresses_ip — une ligne seulement s'il y a eu quelque chose à effacer ; un échec toujours.
--   ④ constater_avertissement_inactivite — un échec d'envoi s'écrit UNE fois par période d'inactivité.
--   ⑤ poser_verdict_verification — la ligne porte la note.
--   ⑥ se_desabonner_email — L'AJOUT DE YOUSSEF : le lien de désabonnement d'un e-mail est un changement de
--     consentement. Il coupe la préférence ET l'écrit, dans la même transaction, une fois — un second clic sur le
--     même lien ne change rien et n'écrit rien.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.envoyer_message(
  p_piece           uuid,
  p_piece_origine   uuid,
  p_origine         text,
  p_acteur_id       uuid,
  p_acteur_type     text,
  p_conversation_id uuid,
  p_statuts_admis   text[],
  p_contenu         text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_c record;
  v_m record;
  v_n integer;
begin
  if p_piece is null then
    raise exception 'envoyer_message : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_acteur_id is null then
    raise exception 'envoyer_message : un message a toujours un auteur' using errcode = 'GL002';
  end if;

  select c.id, c.status, c.candidature_id, c.domain_id
    into v_c
    from public.conversations c
   where c.id = p_conversation_id
   for update;
  if not found then
    return jsonb_build_object('issue', 'introuvable');
  end if;
  if not (v_c.status = any (p_statuts_admis)) then
    return jsonb_build_object('issue', 'fermee');
  end if;

  insert into public.messages (conversation_id, sender_id, domain_id, content)
  values (p_conversation_id, p_acteur_id, v_c.domain_id, p_contenu)
  returning id, sender_id, content, read_at, created_at into v_m;

  update public.conversations c
     set last_message_at = v_m.created_at
   where c.id = p_conversation_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'envoyer_message : conversations');

  -- PLUS DE LIGNE AU GRAND LIVRE (décision de Youssef, 01/10/2026) : la messagerie garde déjà chaque message,
  -- daté et attribué ; le fait métier est l'ouverture de l'échange (« Coordonnées dévoilées »). La pièce reste
  -- un paramètre : la signature est celle que le code en ligne appelle (§E.72).

  return jsonb_build_object(
    'issue', 'envoye', 'id', v_m.id, 'sender_id', v_m.sender_id, 'content', v_m.content,
    'read_at', v_m.read_at, 'created_at', v_m.created_at);
end;
$fn$;


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
  v_avant   record;
begin
  if p_piece is null then
    raise exception 'verifier_telephone : la piece est obligatoire' using errcode = 'GL002';
  end if;

  -- L'ÉTAT D'AVANT, lu sous verrou : une vérification du MÊME numéro, déjà vérifié, n'est pas un changement
  -- (décision de Youssef, 01/10/2026) — le compte est mis à jour, rien ne s'écrit au grand livre.
  select u.phone, u.phone_verified into v_avant from public.users u where u.id = p_user_id for update;

  update public.users u
     set phone_verified = true,
         phone          = p_phone
   where u.id = p_user_id
  returning u.domain_id into v_domaine;
  if not found then
    return false;
  end if;

  if coalesce(v_avant.phone_verified, false) and v_avant.phone is not distinct from p_phone then
    return true;
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


create or replace function public.effacer_adresses_ip()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_piece    uuid := gen_random_uuid();
  v_sujet    uuid := public.identifiant_derive('cron_job', 'ip_retention_purge');
  v_log_id   bigint;
  v_mois     integer;
  v_limite   timestamptz;
  v_audit    integer;
  v_sessions integer;
  v_resume   jsonb;
begin
  insert into public.cron_run_log (job_name)
  values ('ip_retention_purge')
  returning id into v_log_id;

  begin
    select conservation_ip_mois into v_mois
      from public.duree_reglages
     where ligne_unique = true;
    if v_mois is null then
      raise exception 'conservation_ip_mois absent de duree_reglages — aucune valeur de repli';
    end if;
    v_limite := public.ip_limite_de_conservation(v_mois);

    update public.audit_logs
       set ip_address = null, user_agent = null
     where created_at < v_limite
       and (ip_address is not null or user_agent is not null);
    get diagnostics v_audit = row_count;

    update public.session_logs
       set ip_address = null, user_agent = null
     where created_at < v_limite
       and (ip_address is not null or user_agent is not null);
    get diagnostics v_sessions = row_count;

    v_resume := jsonb_build_object(
      'piece',        v_piece,
      'mois',         v_mois,
      'limite',       v_limite,
      'audit_logs',   v_audit,
      'session_logs', v_sessions
    );
    -- RIEN D'EFFACÉ, RIEN D'ÉCRIT (décision de Youssef, 01/10/2026) : une ligne chaque nuit, vide, ne disait rien.
    -- Le passage, lui, reste dans le journal des tâches (cron_run_log) ; un échec s'écrit toujours.
    if v_audit + v_sessions > 0 then
      perform public.journaliser(
        v_piece, 'ip_effacees', 'reussi', 'tache_planifiee',
        null::uuid, null::text, null::uuid,
        'cron_job', v_sujet,
        v_resume - 'piece');
    end if;
    perform public.cloturer_run_cron(v_log_id, 200, v_resume, null);
    return v_resume;
  exception when others then
    -- Le sous-bloc est annulé (rien d'effacé à moitié, aucune ligne de journal
    -- du succès) ; la ligne de run survit et reçoit la panne, et le grand
    -- livre aussi — avec la CLASSE de la panne, pas son texte entier.
    perform public.journaliser(
      v_piece, 'ip_effacees', 'echoue', 'tache_planifiee',
      null::uuid, null::text, null::uuid,
      'cron_job', v_sujet,
      jsonb_build_object('cause', left(sqlerrm, 200), 'sqlstate', sqlstate));
    perform public.cloturer_run_cron(v_log_id, 500, null, sqlerrm);
    return jsonb_build_object('erreur', sqlerrm, 'piece', v_piece);
  end;
end;
$fn$;


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
    -- UN ÉCHEC, UNE FOIS (décision de Youssef, 01/10/2026) : l'envoi est retenté chaque nuit, mais un échec déjà écrit
    -- depuis la dernière connexion du compte ne s'écrit plus — la supervision suit la panne, le grand livre le fait.
    if exists (select 1 from public.grand_livre g join public.users u on u.id = p_user_id
                where g.type_action = 'inactivite_avertie' and g.statut = 'echoue'
                  and g.sujet_type = 'users' and g.sujet_id = p_user_id
                  and g.horodatage > coalesce(u.last_login_at, '-infinity'::timestamptz)) then
      return true;
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
    jsonb_build_object('approuve', p_approuve, 'motif', p_motif, 'de', v_p.verification_status, 'note', p_score),
    null::uuid, null::numeric, null::text);

  return jsonb_build_object('user_id', v_p.user_id, 'domain_id', v_p.domain_id, 'de', v_p.verification_status);
end;
$fn$;


-- ── ⑥ LE DÉSABONNEMENT D'UN E-MAIL ──
--  Colonnes lues dans les migrations (§G.10) : notification_preferences (user_id FK users, event_type text,
--  channel ∈ ('email','sms'), enabled boolean NOT NULL, updated_at ; clé (user_id, event_type, channel) ; une ligne
--  absente vaut « activé »). Le compte est celui du lien signé ; un compte effacé n'a rien à désabonner.
create or replace function public.se_desabonner_email(
  p_piece      uuid,
  p_user_id    uuid,
  p_evenement  text
) returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_u       record;
  v_active  boolean;
begin
  if p_piece is null then
    raise exception 'se_desabonner_email : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_evenement is null or p_evenement !~ '^[a-z][a-z0-9_]{2,60}$' then
    raise exception 'se_desabonner_email : evenement « % » — un CODE est attendu', p_evenement using errcode = '22023';
  end if;

  select u.user_type, u.domain_id into v_u
    from public.users u
   where u.id = p_user_id and u.anonymized_at is null;
  if not found then
    return 'introuvable';
  end if;

  select p.enabled into v_active
    from public.notification_preferences p
   where p.user_id = p_user_id and p.event_type = p_evenement and p.channel = 'email'
   for update;
  if found and v_active = false then
    return 'deja';
  end if;

  insert into public.notification_preferences (user_id, event_type, channel, enabled, updated_at)
  values (p_user_id, p_evenement, 'email', false, now())
  on conflict (user_id, event_type, channel) do update set enabled = false, updated_at = now();

  perform public.journaliser(
    p_piece, 'desabonnement_email', 'reussi', 'utilisateur',
    p_user_id, v_u.user_type, v_u.domain_id,
    'users', p_user_id,
    jsonb_build_object('evenement', p_evenement, 'canal', 'email'),
    null::uuid, null::numeric, null::text);

  return 'desabonne';
end;
$fn$;
revoke all on function public.se_desabonner_email(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.se_desabonner_email(uuid, uuid, text) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_fn text;
begin
  foreach v_fn in array array[
      'public.envoyer_message(uuid, uuid, text, uuid, text, uuid, text[], text)',
      'public.verifier_telephone(uuid, uuid, text, uuid, text, uuid, text, text)',
      'public.effacer_adresses_ip()',
      'public.constater_avertissement_inactivite(uuid, uuid, text, uuid, text, uuid, timestamp with time zone, boolean, text, text)',
      'public.poser_verdict_verification(uuid, uuid, boolean, text, numeric, text)',
      'public.se_desabonner_email(uuid, uuid, text)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'postcondition NON TENUE : % absente', v_fn;
    end if;
  end loop;
  if strpos((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.envoyer_message(uuid, uuid, text, uuid, text, uuid, text[], text)')), 'message_envoye') > 0 then
    raise exception 'postcondition NON TENUE : envoyer_message ecrit encore message_envoye';
  end if;
  if has_function_privilege('authenticated', 'public.se_desabonner_email(uuid, uuid, text)', 'execute') then
    raise exception 'postcondition NON TENUE : se_desabonner_email ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : six ecrivains en place, le message sans ligne, le desabonnement ferme au navigateur ; les gestes sont prouves par tests/database/grand_livre/message_envoye.test.sql (aucune ligne), tests/database/grand_livre/telephone_verifie.test.sql, tests/database/grand_livre/socle.test.sql (effacer_adresses_ip), tests/database/grand_livre/purges.test.sql (avertissement), tests/database/grand_livre/verification_conclue.test.sql (la note) et tests/database/grand_livre/liste_validee.test.sql (desabonnement)';
end
$post$;
