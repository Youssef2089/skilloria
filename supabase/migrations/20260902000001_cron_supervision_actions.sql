-- ─────────────────────────────────────────────────────────────────────────────
-- SUPERVISION DES TACHES PLANIFIEES — ACTIVER / DESACTIVER (lot 2)
--
-- Premiere migration de ce chantier qui ECRIT dans `cron.job`. Les lots 0 et 1
-- etaient en lecture seule.
--
-- ⚠️ NE JAMAIS GRANTER LE SCHEMA `cron` A `service_role`. Le point d'exposition
--    reste une fonction SECURITY DEFINER, NOMMEE, dont la surface est exactement
--    « basculer le drapeau `active` d'une tache existante » — rien d'autre. Elle
--    ne peut ni planifier, ni desplanifier, ni changer une commande.
--
-- ═══ CE QUE CETTE FONCTION NE FAIT PAS, ET C'EST VOULU ═══════════════════════
--   Elle n'oppose AUCUN refus a la desactivation d'une tache legale. La decision
--   produit est explicite : Youssef DOIT pouvoir desactiver une purge legale —
--   une obligation qu'on ne peut pas suspendre en cas d'incident est une
--   obligation qu'on contournera en base, hors de toute trace.
--
--   Ce qui l'entoure, en revanche, est concu pour qu'il ne puisse pas le faire
--   par megarde ni l'oublier :
--     - re-authentification (route) ;
--     - saisie du NOM de la tache, revalidee au serveur (route) ;
--     - la modale NOMME l'obligation, depuis `legal_basis_key` (ecran) ;
--     - un bandeau rouge permanent sur TOUT le back-office tant qu'une tache
--       legale est desactivee (composant monte au layout, lot 1).
--   La garde n'est pas dans cette fonction parce que ce n'est pas une garde :
--   c'est une conscience.
--
-- ═══ PREREQUIS pg_cron ═══════════════════════════════════════════════════════
--   `cron.alter_job(jobid, active := …)` existe depuis pg_cron 1.4. Le projet
--   utilise deja `cron.schedule` / `cron.unschedule` (1.0+). Si l'appel echouait
--   sur une version anterieure, la fonction LEVERAIT — la route repond alors 500
--   avec un code lisible, jamais un succes silencieux.
--
-- Additif et idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_cron_set_active(
  p_job_name text,
  p_active   boolean
)
  returns table (
    previous_active boolean,
    new_active      boolean
  )
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_jobid    bigint;
  v_previous boolean;
  v_new      boolean;
begin
  if p_job_name is null or p_active is null then
    raise exception 'admin_cron_set_active: parametres manquants';
  end if;

  -- Le nom est resolu sur `cron.job`, jamais sur le catalogue : une tache non
  -- cataloguee doit pouvoir etre desactivee comme les autres.
  select j.jobid, j.active into v_jobid, v_previous
    from cron.job j
   where j.jobname = p_job_name;

  if v_jobid is null then
    -- Code stable, lu par la route pour repondre 404 plutot qu'un 500 opaque.
    raise exception 'cron_job_not_found: %', p_job_name
      using errcode = 'no_data_found';
  end if;

  perform cron.alter_job(v_jobid, active := p_active);

  -- RELECTURE : on ne renvoie pas ce qu'on a demande, on renvoie ce que la base
  -- a retenu. Un `alter_job` qui n'aurait pas pris effet doit se voir, pas se
  -- deduire — c'est toute la lecon de cet ecran.
  select j.active into v_new from cron.job j where j.jobid = v_jobid;

  return query select v_previous, v_new;
end;
$fn$;

revoke all on function public.admin_cron_set_active(text, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_cron_set_active(text, boolean)
  to service_role;

comment on function public.admin_cron_set_active(text, boolean) is
  'Bascule le drapeau active d''une tache pg_cron. Surface volontairement '
  'minimale : ne planifie rien, ne desplanifie rien, ne change aucune commande. '
  'Relit l''etat apres ecriture et le renvoie.';
