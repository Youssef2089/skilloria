-- ════════════════════════════════════════════════════════════════════════════
--  UNE TÂCHE PLANIFIÉE LANCÉE À LA MAIN S'ÉCRIT AU GRAND LIVRE — LE LANCEMENT
--  ET SA LIGNE DANS UNE SEULE FONCTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/admin/cron-jobs/[name]/run`
--  appelle la NOUVELLE signature dès ce commit. Ajoute : une action, une surcharge.
--  Rejouable.
--
--  ⚠️ L'ANCIENNE SIGNATURE RESTE, ET C'EST VOULU (§E.72). `admin_cron_run_now(text,
--     uuid)` est appelée par le code EN LIGNE jusqu'au déploiement : la supprimer
--     ici casserait l'exécution manuelle entre le `db push` et le déploiement. Elle
--     se supprime par une migration du déploiement SUIVANT (docs/reprise.md le
--     tient). D'ici là elle n'est atteignable que par `service_role`, comme avant.
--
--  LE MANQUE (audit de la phase B, 2.1) : rejouer une tâche hors de son horaire —
--  y compris une tâche DÉSACTIVÉE, c'est le mécanisme de rattrapage — était tracé
--  par l'audit et par `cron_run_log.trigger_source = 'manual'`, pas au grand livre.
--
--  LA NOUVELLE SIGNATURE porte le contexte du journal (pièce, origine, acteur) au
--  lieu du seul `p_triggered_by`, et reprend À L'IDENTIQUE le corps d'avant :
--  verrou CONSULTATIF de transaction, commande rejouée telle quelle, provenance
--  marquée (ou ligne manuelle posée pour une tâche SQL pure). Elle ajoute :
--   · AD002 — l'acteur est un administrateur actif, vérifié EN BASE (levé, sans
--     ligne : l'appelant n'avait pas le droit) ;
--   · la commande rejouée dans un SOUS-BLOC : si elle lève, ses effets sont
--     annulés et la ligne est ÉCHOUÉE (cause = SQLSTATE), issue 'echoue' ;
--   · la ligne `tache_lancee_a_la_main`, sujet la tâche (identifiant DÉRIVÉ,
--     `identifiant_derive('cron_job', nom)` — le même que `ip_effacees`), détail
--     la tâche et si elle était ACTIVE (déclencher une tâche désactivée est
--     permis, et c'est un fait à garder).
--  La pièce du geste ira jusqu'au passage lui-même (corps HTTP) à l'étape 2.5.
--  Famille `administration`.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('tache_lancee_a_la_main',     'administration', null,     'journal.actions.tache_lancee_a_la_main')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['tache', 'etait_active', 'cause']::text[]
 where code = 'tache_lancee_a_la_main';


create or replace function public.admin_cron_run_now(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_job_name      text
)
  returns table (
    started_at   timestamptz,
    logged_rows  integer,
    issue        text
  )
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_jobid   bigint;
  v_command text;
  v_active  boolean;
  v_started timestamptz := now();
  v_rows    integer;
  v_sujet   uuid := public.identifiant_derive('cron_job', p_job_name);
  v_cause   text;
begin
  if p_origine is distinct from 'administrateur' or not exists (
       select 1 from public.users a where a.id = p_acteur_id and a.user_type = 'admin' and a.status = 'active') then
    raise exception 'admin_cron_run_now : l acteur % n est pas un administrateur actif', p_acteur_id
      using errcode = 'AD002';
  end if;

  select j.jobid, j.command::text, j.active into v_jobid, v_command, v_active
    from cron.job j where j.jobname = p_job_name;
  if v_jobid is null then
    raise exception 'cron_job_not_found: %', p_job_name using errcode = 'no_data_found';
  end if;

  -- Verrou CONSULTATIF, porté par la transaction. Non obtenu = une autre
  -- exécution manuelle de CETTE tâche est déjà en cours.
  if not pg_try_advisory_xact_lock(hashtext('cron_manual:' || p_job_name)) then
    raise exception 'cron_already_running: %', p_job_name using errcode = 'lock_not_available';
  end if;

  -- On rejoue la commande du job, telle quelle — dans un SOUS-BLOC : si elle lève,
  -- ses effets sont annulés, et l'échec s'écrit au lieu de disparaître.
  begin
    execute v_command;
  exception when others then
    v_cause := sqlstate;
    perform public.journaliser(
      p_piece, 'tache_lancee_a_la_main', 'echoue', p_origine,
      p_acteur_id, p_acteur_type, null::uuid, 'cron_job', v_sujet,
      jsonb_build_object('tache', p_job_name, 'etait_active', v_active, 'cause', v_cause),
      p_piece_origine, null::numeric, null::text);
    return query select v_started, 0, 'echoue'::text;
    return;
  end;

  -- PROVENANCE. Les tâches HTTP viennent d'insérer leur propre ligne via
  -- `trigger_purge_cron` : on la marque. Les tâches SQL pures n'en créent
  -- aucune — on en pose une.
  update public.cron_run_log
     set trigger_source = 'manual',
         triggered_by   = p_acteur_id
   where job_name = p_job_name
     and requested_at >= v_started
     and trigger_source = 'schedule';
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    insert into public.cron_run_log (job_name, requested_at, trigger_source, triggered_by)
    values (p_job_name, v_started, 'manual', p_acteur_id);
    v_rows := 1;
  end if;

  perform public.journaliser(
    p_piece, 'tache_lancee_a_la_main', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, null::uuid, 'cron_job', v_sujet,
    jsonb_build_object('tache', p_job_name, 'etait_active', v_active),
    p_piece_origine, null::numeric, null::text);
  return query select v_started, v_rows, 'reussi'::text;
end;
$fn$;

revoke all on function public.admin_cron_run_now(uuid, uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_cron_run_now(uuid, uuid, text, uuid, text, text) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'tache_lancee_a_la_main';
  if not found then
    raise exception 'postcondition NON TENUE : tache_lancee_a_la_main absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'administration' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['tache', 'etait_active', 'cause']::text[] then
    raise exception 'postcondition NON TENUE : tache_lancee_a_la_main [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  if to_regprocedure('public.admin_cron_run_now(uuid, uuid, text, uuid, text, text)') is null then
    raise exception 'postcondition NON TENUE : la nouvelle signature admin_cron_run_now(uuid, uuid, text, uuid, text, text) absente';
  end if;
  if has_function_privilege('authenticated', 'public.admin_cron_run_now(uuid, uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.admin_cron_run_now(uuid, uuid, text, uuid, text, text)', 'execute') then
    raise exception 'postcondition NON TENUE : admin_cron_run_now executable depuis le navigateur';
  end if;
  raise notice 'postcondition tenue : tache_lancee_a_la_main dans la liste fermee (famille administration), la nouvelle signature presente et fermee au navigateur ; le lancement, l echec ecrit et AD002 sont prouves par tests/database/grand_livre/tache_lancee_a_la_main.test.sql';
end
$post$;
