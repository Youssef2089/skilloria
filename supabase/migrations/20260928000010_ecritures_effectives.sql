-- ════════════════════════════════════════════════════════════════════════════
--  UNE ÉCRITURE QUI NE TOUCHE AUCUNE LIGNE NE PASSE JAMAIS EN SILENCE — les huit
--  fonctions déjà appliquées où zéro ligne est une anomalie.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : INDIFFÉRENT. Recrée huit fonctions à signature et droits
--  identiques (`create or replace` conserve les droits) ; seule la vérification
--  du nombre de lignes s'ajoute. Exige `exiger_ecriture()` (liste_blanche_par_
--  action, même `db push`). Rejouable.
--
--  POURQUOI UNE MIGRATION NOUVELLE : ces fonctions viennent de migrations déjà
--  appliquées sur staging ; on ne les touche pas (§G.2). Celles du lot du grand
--  livre, pas encore poussées, ont été corrigées EN PLACE (§E.74).
--
--  LE BALAYAGE DU 28/09/2026, fonctions antérieures au socle, lues une à une :
--   · ANOMALIE si zéro — corrigées ici :
--       handle_email_confirmed    le miroir du compte qui confirme son adresse
--       stripe_event_mark         l'événement que le webhook vient de réclamer
--       solder_relance_expert     la branche `else` : le profil, par identifiant
--       echouer_relance_expert    le profil, par identifiant (sql → plpgsql)
--       trigger_purge_cron        la ligne de journal qu'il vient d'insérer
--       liberer_siege_plateforme  la ligne unique de `plateforme` (×2)
--       programmer_relance_expert le profil, par identifiant (rendait null en silence)
--       marquer_tentative_relance le profil, par identifiant (rendait null en silence)
--   · ZÉRO LÉGITIME — au gel de diag-ecritures-effectives, chacune avec sa
--     raison : rate_limit_check, purge_cron_maintenance (×3), rendre_bail,
--     reserver_place_incluse, liberer_place_incluse, liberer_place_annonce,
--     pourvoir_siege_admin_si_vacant, pourvoir_siege_plateforme_si_vacant,
--     admin_cron_run_now, appliquer_scores_de_pertinence, audit_logs_nettoyer_
--     compte, cloturer_run_cron, purger_notes_partielles, reconcile_cron_run_log,
--     reserver_place_annonce (×2), et la première écriture de solder_relance_expert.
--     (Le premier balayage en voyait 14 ; la règle stricte — exiger le compte OU
--     écrire la raison — en a vu 24 : un `get diagnostics` qu'on RETOURNE n'est pas
--     une vérification, c'est une issue, et chaque issue a été lue.)
--
--  ET handle_email_confirmed N'AVALE PLUS SES ERREURS. Il faisait
--  `exception when others then raise warning … ; return new` : un miroir absent,
--  une panne, et le compte était confirmé côté auth, `draft` côté produit, sans
--  que rien ne le dise (§E.22, dans un trigger d'authentification). Il lève
--  désormais : la confirmation échoue, visiblement, et se rejoue.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.handle_email_confirmed()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.users
       set email_verified = true,
           status         = case when status = 'draft' then 'active' else status end
     where id = new.id;
    get diagnostics v_n = row_count;
    -- Aucun miroir : le compte confirme une adresse qu'aucun compte du produit ne porte.
    perform public.exiger_ecriture(v_n, 'handle_email_confirmed : users (miroir absent)');
  end if;
  return new;
end;
$fn$;


create or replace function public.stripe_event_mark(
  p_id              text,
  p_status          text,
  p_error           text default null,
  p_organization_id uuid default null
) returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  if p_status not in ('processed', 'ignored', 'failed') then
    raise exception 'stripe_event_mark: statut de clôture invalide (%)', p_status;
  end if;
  update public.stripe_events
     set status          = p_status,
         error           = p_error,
         organization_id = coalesce(p_organization_id, organization_id),
         processed_at    = case when p_status = 'failed' then processed_at else now() end
   where id = p_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'stripe_event_mark : stripe_events');
end;
$fn$;


create or replace function public.solder_relance_expert(
  p_profile_id uuid,
  p_debut_run  timestamptz
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_soldee boolean := false;
  v_n      integer;
begin
  -- La première écriture est CONDITIONNELLE : son WHERE est la garde (relance due
  -- avant le début du passage), zéro ligne y est l'issue « rien à solder ».
  update public.profiles
     set matching_relance_due_at     = null,
         matching_relance_first_at   = null,
         matching_relance_reported   = 0,
         matching_relance_reason     = null,
         matching_relance_tentatives = 0,
         matching_relance_echec_at   = null,
         matching_relance_echec_code = null,
         matching_last_run_at        = now()
   where id = p_profile_id
     and matching_relance_due_at is not null
     and matching_relance_due_at <= p_debut_run;
  if found then
    v_soldee := true;
  else
    update public.profiles
       set matching_last_run_at        = now(),
           matching_relance_tentatives = 0,
           matching_relance_echec_at   = null,
           matching_relance_echec_code = null
     where id = p_profile_id;
    get diagnostics v_n = row_count;
    perform public.exiger_ecriture(v_n, 'solder_relance_expert : profiles');
  end if;
  return v_soldee;
end
$fn$;


create or replace function public.echouer_relance_expert(
  p_profile_id uuid,
  p_code       text
) returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  update public.profiles
     set matching_relance_echec_at   = now(),
         matching_relance_echec_code = p_code
   where id = p_profile_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'echouer_relance_expert : profiles');
end
$fn$;


create or replace function public.trigger_purge_cron(
  p_job_name text,
  p_path     text
) returns bigint
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_secret text;
  v_base   text;
  v_req_id bigint;
  v_log_id bigint;
  v_n      integer;
begin
  if p_path is null or left(p_path, 1) <> '/' then
    raise exception 'trigger_purge_cron: chemin invalide (%) — attendu un chemin absolu', p_path;
  end if;

  -- Secret partage. Absent => on LEVE : jamais d'appel non authentifie.
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cron_secret';
  if v_secret is null or btrim(v_secret) = '' then
    raise exception
      'trigger_purge_cron(%): secret Vault "cron_secret" absent ou vide — appel annule', p_job_name;
  end if;

  -- Origine de l'application pour CET environnement. Absente => on LEVE.
  select decrypted_secret into v_base
    from vault.decrypted_secrets
   where name = 'purge_cron_base_url';
  if v_base is null or btrim(v_base) = '' then
    raise exception
      'trigger_purge_cron(%): secret Vault "purge_cron_base_url" absent ou vide — appel annule', p_job_name;
  end if;
  v_base := rtrim(btrim(v_base), '/');

  -- LA LIGNE D'ABORD : c'est son identifiant que la tache recevra.
  insert into public.cron_run_log (job_name)
  values (p_job_name)
  returning id into v_log_id;

  select net.http_post(
           url                  := v_base || p_path,
           body                 := jsonb_build_object('log_id', v_log_id),
           headers              := jsonb_build_object(
                                     'Content-Type',  'application/json',
                                     'Authorization', 'Bearer ' || v_secret
                                   ),
           timeout_milliseconds := 60000
         )
    into v_req_id;

  update public.cron_run_log set request_id = v_req_id where id = v_log_id;
  get diagnostics v_n = row_count;
  -- La ligne vient d'être insérée : zéro est une anomalie. La transaction est annulée,
  -- et la requête pg_net avec elle (la file ne part qu'à la validation).
  perform public.exiger_ecriture(v_n, 'trigger_purge_cron : cron_run_log');
  return v_req_id;
end;
$fn$;


create or replace function public.liberer_siege_plateforme(
  p_user_id uuid,
  p_forcer  boolean default false
) returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_au_siege  boolean;
  v_transfere boolean := false;
  v_cand      uuid;
  v_n         integer;
begin
  select (p.siege_admin_user_id = p_user_id) into v_au_siege
    from public.plateforme p where p.ligne_unique;
  if not coalesce(v_au_siege, false) then
    return 'ok';
  end if;

  for v_cand in
    select u.id
      from public.users u
     where u.admin_disponible
       and u.id <> p_user_id
     order by u.created_at asc, u.id asc
  loop
    begin
      update public.plateforme
         set siege_admin_user_id = v_cand
       where ligne_unique;
      get diagnostics v_n = row_count;
      perform public.exiger_ecriture(v_n, 'liberer_siege_plateforme : plateforme (transfert)');
      v_transfere := true;
      exit;
    exception when foreign_key_violation then
      null;
    end;
  end loop;

  if v_transfere then
    return 'ok';
  end if;
  if not p_forcer then
    return 'dernier_admin';
  end if;

  perform set_config('skilloria.liberation_siege_plateforme', 'oui', true);
  update public.plateforme set siege_admin_user_id = null where ligne_unique;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'liberer_siege_plateforme : plateforme (liberation)');
  perform set_config('skilloria.liberation_siege_plateforme', '', true);
  return 'ok';
end;
$fn$;


create or replace function public.programmer_relance_expert(
  p_profile_id uuid,
  p_delai      interval,
  p_raison     text default null
) returns timestamptz
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_due timestamptz;
  v_n   integer;
begin
  update public.profiles
     set matching_relance_due_at = now() + p_delai,
         -- Le PREMIER instant de la série ne bouge pas : c'est lui qui borne
         -- l'attente totale, et le report ne doit pas pouvoir le repousser.
         matching_relance_first_at = coalesce(matching_relance_first_at, now()),
         matching_relance_reported =
           case when matching_relance_due_at is null then 0
                else matching_relance_reported + 1 end,
         matching_relance_reason = coalesce(p_raison, matching_relance_reason)
   where id = p_profile_id
  returning matching_relance_due_at into v_due;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'programmer_relance_expert : profiles');

  return v_due;
end
$fn$;


create or replace function public.marquer_tentative_relance(
  p_profile_id uuid
) returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_n integer;
  v_k integer;
begin
  update public.profiles
     set matching_relance_tentatives = matching_relance_tentatives + 1
   where id = p_profile_id
  returning matching_relance_tentatives into v_n;
  get diagnostics v_k = row_count;
  perform public.exiger_ecriture(v_k, 'marquer_tentative_relance : profiles');
  return v_n;
end
$fn$;


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
--  Trois sondes sans donnée : un identifiant inventé ne touche rien → EC001.
do $post$
declare
  v_nom text;
begin
  for v_nom in select unnest(array['handle_email_confirmed', 'stripe_event_mark', 'solder_relance_expert',
                                   'echouer_relance_expert', 'trigger_purge_cron', 'liberer_siege_plateforme',
                                   'programmer_relance_expert', 'marquer_tentative_relance'])
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = v_nom and p.prosrc ~ 'exiger_ecriture\(') then
      raise exception 'postcondition NON TENUE : % n exige pas son compte de lignes', v_nom;
    end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'handle_email_confirmed' and p.prosrc ~* 'when\s+others') then
    raise exception 'postcondition NON TENUE : handle_email_confirmed avale encore ses erreurs';
  end if;
  begin
    perform public.echouer_relance_expert(gen_random_uuid(), 'sonde');
    raise exception 'postcondition NON TENUE : echouer_relance_expert laisse passer un profil inexistant';
  exception when sqlstate 'EC001' then null;
  end;
  begin
    perform public.solder_relance_expert(gen_random_uuid(), now());
    raise exception 'postcondition NON TENUE : solder_relance_expert laisse passer un profil inexistant';
  exception when sqlstate 'EC001' then null;
  end;
  begin
    perform public.marquer_tentative_relance(gen_random_uuid());
    raise exception 'postcondition NON TENUE : marquer_tentative_relance laisse passer un profil inexistant';
  exception when sqlstate 'EC001' then null;
  end;
  begin
    perform public.programmer_relance_expert(gen_random_uuid(), interval '10 minutes');
    raise exception 'postcondition NON TENUE : programmer_relance_expert laisse passer un profil inexistant';
  exception when sqlstate 'EC001' then null;
  end;
  begin
    perform public.stripe_event_mark('evt_sonde_' || gen_random_uuid(), 'processed');
    raise exception 'postcondition NON TENUE : stripe_event_mark laisse passer un evenement inexistant';
  exception when sqlstate 'EC001' then null;
  end;
  raise notice 'postcondition tenue : huit fonctions exigent leur compte de lignes, handle_email_confirmed n avale plus ses erreurs, cinq sondes levent EC001 ; les huit fonctions sont prouvees par tests/database/ecritures_effectives.test.sql';
end
$post$;
