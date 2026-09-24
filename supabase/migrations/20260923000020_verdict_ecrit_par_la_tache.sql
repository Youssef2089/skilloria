-- ════════════════════════════════════════════════════════════════════════════
--  LA TÂCHE ÉCRIT SON RÉSULTAT ELLE-MÊME, AU MOMENT OÙ ELLE FINIT.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement.
--    Elle n'ajoute que du nouveau — deux colonnes avec un défaut, une fonction
--    neuve — et réordonne le corps d'une fonction existante. Le code EN LIGNE
--    continue de fonctionner : il ne lit rien de tout cela, et la route ignore
--    simplement l'identifiant qu'on lui passe désormais. Le code du même lot en
--    a besoin.
--
-- ┌─ LE DÉFAUT, MESURÉ LE 22/09/2026 ────────────────────────────────────────┐
-- │ 9 853 passages des pilotes depuis le 3 septembre. 7 201 — SOIXANTE-TREIZE │
-- │ POUR CENT — sans aucun verdict HTTP.                                      │
-- │                                                                           │
-- │ LA CAUSE N'EST PAS UNE PANNE, C'EST LE CHEMIN. La tâche pose sa réponse   │
-- │ chez `pg_net`, qui la garde environ SIX HEURES ; la réconciliation ne     │
-- │ passe qu'à 03 h 15 et 03 h 45. Un passage de 10 h du matin n'a donc plus  │
-- │ de réponse à recopier la nuit suivante. Seule la tranche 21 h – 4 h       │
-- │ arrive à temps.                                                           │
-- │                                                                           │
-- │ L'administrateur ne peut pas répondre à la question la plus simple —      │
-- │ « est-ce que ça tourne ? » — pendant les trois quarts de la journée. Et   │
-- │ c'est ce qui laisse une panne durer des semaines en plein jour.           │
-- └───────────────────────────────────────────────────────────────────────────┘
--
--  CE QU'ON REFUSE, ET POURQUOI
--    **Ramasser plus souvent** réduit la perte, il ne la supprime pas : il
--    restera toujours une fenêtre entre la fin d'un passage et le ramassage
--    suivant, et elle s'élargit dès qu'une tâche déborde. On déplacerait le
--    seuil, pas le mécanisme.
--
--  CE QU'ON FAIT — LA TÂCHE N'ATTEND PLUS QU'ON VIENNE LA CHERCHER
--    Elle reçoit l'identifiant de sa propre ligne de journal, et elle
--    l'écrit **elle-même** en terminant. Rien n'expire entre les deux : il n'y
--    a plus d'intervalle.
--
--  ⚠️ ET LA RÉCONCILIATION RESTE — DEUX COLLECTEURS, DEUX PANNES DIFFÉRENTES.
--     Ce n'est pas §E.36 (« deux gardes qui tombent sur la même panne n'en font
--     qu'une ») : elles ne tombent PAS sur la même panne.
--       · la tâche n'écrit pas → elle a été TUÉE avant la fin ;
--       · la réconciliation n'écrit pas → la réponse `pg_net` a EXPIRÉ.
--     Une tâche tuée à la trentième seconde laisse donc encore une trace, par
--     l'autre chemin, tant qu'on est dans les six heures. C'est la redondance
--     assumée de §E.17, pas un doublon.
--
--  ET L'HISTORIQUE PERDU SE DIT, IL NE SE DEVINE PAS
--    Les 7 201 lignes déjà vides ne se rattrapent pas : la réponse `pg_net`
--    qui les portait n'existe plus. `attendu_de_la_tache` les marque à `false` :
--    aucun verdict n'est attendu d'elles, et l'écran l'écrit — plutôt que de
--    laisser lire un trou d'activité là où il n'y a qu'un trou d'instrumentation
--    (c'est exactement §E.52, et il a déjà coûté un signal bloquant permanent).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LE JOURNAL — qui a écrit le verdict, et de qui on l'attend
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.cron_run_log
  -- `tache` ou `reconciliation`. Sans cette colonne, on ne peut pas savoir si
  -- le nouveau mécanisme fonctionne : les deux chemins remplissent les mêmes
  -- colonnes, et un verdict arrivé par l'ancien chemin se lirait comme un
  -- succès du nouveau.
  add column if not exists verdict_source text,
  -- `false` sur tout ce qui précède ce lot. Une ligne sans verdict n'a alors
  -- pas le même sens selon ce drapeau, et c'est toute la difference entre
  -- « la tâche n'a pas rendu compte » et « personne ne le lui demandait ».
  add column if not exists attendu_de_la_tache boolean not null default true;

-- ⚠️ LE `DEFAULT true` A REMPLI LES LIGNES EXISTANTES. On les remet à false :
--    elles datent d'avant le mécanisme, et les laisser à `true` ferait remonter
--    9 853 « tâches qui n'ont pas rendu compte » dès la première seconde.
--    Cet `update` REMPLIT une colonne neuve ; il n'insère aucune ligne, et
--    échappe donc par construction à la classe de §E.12.
update public.cron_run_log set attendu_de_la_tache = false;

-- Les lignes déjà réconciliées portent leur origine réelle.
update public.cron_run_log
   set verdict_source = 'reconciliation'
 where reconciled_at is not null
   and verdict_source is null;

alter table public.cron_run_log
  drop constraint if exists cron_run_log_verdict_source_check;
alter table public.cron_run_log
  add constraint cron_run_log_verdict_source_check
  check (verdict_source is null or verdict_source in ('tache', 'reconciliation'));

comment on column public.cron_run_log.verdict_source is
  'Qui a ecrit le verdict : `tache` (la route, en terminant) ou `reconciliation` '
  '(recopie depuis pg_net, l''ancien chemin). NULL = aucun verdict.';
comment on column public.cron_run_log.attendu_de_la_tache is
  'true des le 23/09/2026 : la tache recoit l''identifiant de sa ligne et doit '
  'ecrire son verdict. false sur les lignes anterieures, dont aucun verdict '
  'n''est attendu — l''ecran le dit au lieu de laisser lire un trou d''activite.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LA TÂCHE CLÔT SON PROPRE PASSAGE
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ELLE REND UN BOOLÉEN, ET L'APPELANT LE LIT. Une écriture qui ne dit pas si
--  elle a écrit est une écriture qui peut échouer en silence — c'est
--  exactement ce qu'on ferme, et on ne va pas le rouvrir d'un cran plus bas.
--  `false` veut dire : aucune ligne n'a bougé (identifiant inconnu, ou passage
--  déjà clos). L'appelant journalise bruyamment, et la reconciliation garde sa
--  chance de remplir la ligne par l'autre chemin.

create or replace function public.cloturer_run_cron(
  p_log_id      bigint,
  p_http_status integer,
  p_summary     jsonb default null,
  p_error       text  default null
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  -- ⚠️ UN ENTIER, PAS UN BOOLÉEN. `get diagnostics … = row_count` rend un
  --    entier ; l'affecter à un booléen fait échouer la fonction à
  --    l'exécution, pas à la migration — elle se serait créée sans un mot et
  --    aurait levé au premier passage de cron (§E.1, en plpgsql).
  v_rows integer;
begin
  if p_log_id is null then
    return false;
  end if;

  update public.cron_run_log
     set http_status    = p_http_status,
         error_msg      = p_error,
         -- Le corps est BORNÉ ici comme il l'est dans la reconciliation : une
         -- reponse volumineuse ne doit pas faire grossir le journal sans fin.
         response_body  = left(coalesce(p_summary::text, ''), 2000),
         summary        = p_summary,
         timed_out      = false,
         reconciled_at  = now(),
         verdict_source = 'tache'
   where id = p_log_id
     -- On ne réécrit pas un verdict déjà posé : si la reconciliation est
     -- passée avant (elle ne devrait pas), sa lecture de pg_net fait foi, et
     -- deux écritures concurrentes ne se marchent pas dessus.
     and reconciled_at is null;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$fn$;

revoke all on function public.cloturer_run_cron(bigint, integer, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.cloturer_run_cron(bigint, integer, jsonb, text)
  to service_role;

comment on function public.cloturer_run_cron(bigint, integer, jsonb, text) is
  'La tache ecrit son propre verdict en terminant, au lieu de le poser chez '
  'pg_net et d''attendre qu''on vienne le chercher avant l''expiration (~6 h). '
  'Rend false si aucune ligne n''a bouge — l''appelant le journalise, et la '
  'reconciliation garde sa chance par l''autre chemin.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LE PILOTE — la ligne naît AVANT l'appel, et son identifiant part avec
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ⚠️ L'ORDRE CHANGE, ET C'EST LE SEUL CHANGEMENT DE FOND.
--     Avant : `http_post` puis `insert`. La ligne n'existait donc pas encore
--     quand la requête partait, et il n'y avait aucun identifiant à lui passer.
--     Maintenant : `insert … returning id`, puis `http_post` avec cet
--     identifiant dans le corps, puis on note le `request_id`.
--
--  CE QUE L'ORDRE NE CHANGE PAS : si `http_post` lève, toute la fonction lève
--  et la transaction annule aussi l'insertion. Aucune ligne orpheline — le
--  comportement est identique à celui d'avant sur ce point.

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

  -- Origine de l'application pour CET environnement. Absente => on LEVE :
  -- jamais d'appel vers une URL devinee.
  select decrypted_secret into v_base
    from vault.decrypted_secrets
   where name = 'purge_cron_base_url';
  if v_base is null or btrim(v_base) = '' then
    raise exception
      'trigger_purge_cron(%): secret Vault "purge_cron_base_url" absent ou vide — appel annule', p_job_name;
  end if;
  -- Defensif : un slash final stocke par megarde ne doit pas produire '//api'.
  v_base := rtrim(btrim(v_base), '/');

  -- LA LIGNE D'ABORD : c'est son identifiant que la tache recevra, et qu'elle
  -- ecrira en terminant.
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

  return v_req_id;
end;
$fn$;

revoke all on function public.trigger_purge_cron(text, text) from public, anon, authenticated, service_role;

comment on function public.trigger_purge_cron(text, text) is
  'Declenche une tache par HTTP. La ligne de journal naît AVANT l''appel et son '
  'identifiant part dans le corps : la tache ecrit son verdict elle-meme en '
  'terminant, au lieu de le poser chez pg_net ou il expire en ~6 h. La '
  'reconciliation reste, en second collecteur, pour les taches tuees avant la fin.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LA RÉCONCILIATION — inchangée dans son rôle, elle NOMME son origine
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.reconcile_cron_run_log()
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_count integer;
begin
  update public.cron_run_log l
     set http_status    = r.status_code,
         timed_out      = r.timed_out,
         error_msg      = r.error_msg,
         response_body  = left(r.content, 2000),
         reconciled_at  = now(),
         verdict_source = 'reconciliation'
    from net._http_response r
   where r.id = l.request_id
     -- Elle ne touche QUE ce que la tache n'a pas clos : le second collecteur
     -- ne repasse jamais sur le premier.
     and l.reconciled_at is null
     and l.request_id is not null
     and l.requested_at > now() - interval '24 hours';

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function public.reconcile_cron_run_log() from public, anon, authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. POSTCONDITION — la migration vérifie ce qu'elle a créé, et LÈVE sinon
-- ═══════════════════════════════════════════════════════════════════════════
--
--  §E.60 : une migration qui « reussit » n'a rien prouve. On verifie le NOM,
--  la TABLE et la FORME — et pas seulement qu'une chaine est prise quelque part
--  dans le schema.

do $$
declare
  v_manque text := '';
begin
  -- Les deux colonnes, SUR LA BONNE TABLE.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'cron_run_log'
       and column_name = 'verdict_source'
  ) then
    v_manque := v_manque || ' cron_run_log.verdict_source';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'cron_run_log'
       and column_name = 'attendu_de_la_tache' and is_nullable = 'NO'
  ) then
    v_manque := v_manque || ' cron_run_log.attendu_de_la_tache(not null)';
  end if;

  -- La contrainte, SUR LA BONNE TABLE.
  if not exists (
    select 1 from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public' and t.relname = 'cron_run_log'
       and c.conname = 'cron_run_log_verdict_source_check'
  ) then
    v_manque := v_manque || ' contrainte cron_run_log_verdict_source_check';
  end if;

  -- La fonction, AVEC SA SIGNATURE — une fonction du meme nom et d'une autre
  -- arite ne rendrait pas le service attendu, et l'appel resoudrait ailleurs.
  -- ⚠️ ON RÉSOUT LA FONCTION PAR SES TYPES, PAS PAR UNE CHAÎNE RENDUE.
  --    `pg_get_function_identity_arguments` rend AUSSI LES NOMS des
  --    paramètres — « p_log_id bigint, p_http_status integer, … ». La comparer
  --    à « bigint, integer, jsonb, text » ne pouvait donc JAMAIS être vraie sur
  --    une fonction aux paramètres nommés, c'est-à-dire sur toutes les nôtres.
  --    Cette postcondition a arrêté un `db push` sur staging en annonçant
  --    absente une fonction que la migration venait de créer six lignes plus
  --    haut.
  --
  --    `to_regprocedure` prend une signature en TYPES, la résout, et rend NULL
  --    si rien ne correspond. Aucun rendu, aucun nom, aucune mise en forme :
  --    la question posée est celle qu'on voulait poser.
  --
  --    ET LE REFUS DIT CE QU'IL A VU. Le message d'origine annonçait la
  --    fonction absente ; elle existait. Une postcondition qui se trompe doit
  --    au moins livrer de quoi la contredire.
  if to_regprocedure('public.cloturer_run_cron(bigint, integer, jsonb, text)') is null then
    v_manque := v_manque || ' cloturer_run_cron(bigint,integer,jsonb,text) [vu : '
      || coalesce(
           (select string_agg(p.oid::regprocedure::text, ' | ')
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'cloturer_run_cron'),
           'aucune fonction de ce nom')
      || ']';
  end if;

  -- Et la reprise en main du pilote : le corps doit porter le nouvel ordre.
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'trigger_purge_cron'
       and pg_get_functiondef(p.oid) like '%jsonb_build_object(''log_id''%'
  ) then
    v_manque := v_manque || ' trigger_purge_cron ne passe pas log_id';
  end if;

  -- Aucune ligne anterieure ne doit rester marquee comme attendue.
  if exists (
    select 1 from public.cron_run_log
     where attendu_de_la_tache and reconciled_at is null
       and requested_at < now() - interval '1 minute'
  ) then
    v_manque := v_manque || ' des lignes anterieures restent attendues de la tache';
  end if;

  if v_manque <> '' then
    raise exception 'verdict_ecrit_par_la_tache: postcondition NON TENUE —%', v_manque;
  end if;
end
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. L'HISTORIQUE SE DIT — l'ecran distingue « pas attendu » de « pas rendu »
-- ═══════════════════════════════════════════════════════════════════════════
--
--  SANS CETTE DISTINCTION, LES 7 201 LIGNES DEJA VIDES SE LIRAIENT COMME UNE
--  PANNE. Elles n'en sont pas une : aucun verdict ne leur a jamais ete demande.
--  Une absence d'INSTRUMENTATION lue comme une absence de TRAVAIL, c'est §E.52
--  mot pour mot — et ca a deja coute un signal bloquant permanent sur cet ecran.
--
--  ⚠️ `create or replace` NE PEUT PAS AJOUTER UNE COLONNE A UN `returns table` :
--     c'est un changement de TYPE DE RETOUR. On supprime d'abord, comme pour
--     matching_relance_health (§B.2). Les quatorze colonnes d'origine sont
--     toutes conservees, a l'identique.

drop function if exists public.admin_cron_job_runs(text, integer, integer);

create function public.admin_cron_job_runs(
  p_job_name text,
  p_limit    integer default 25,
  p_offset   integer default 0
)
  returns table (
    run_started_at      timestamptz,
    run_ended_at        timestamptz,
    duration_ms         integer,
    status              text,
    return_message      text,
    http_requested_at   timestamptz,
    http_status         integer,
    http_timed_out      boolean,
    http_error          text,
    http_response       text,
    http_reconciled_at  timestamptz,
    trigger_source      text,
    triggered_by_email  text,
    verdict_source      text,
    verdict_attendu     boolean,
    total_count         bigint
  )
  language sql
  security definer
  set search_path to 'public'
  stable
as $fn$
  with target as (
    select j.jobid from cron.job j where j.jobname = p_job_name
  ),
  -- Branche A : les executions PLANIFIEES. Ossature = cron.job_run_details,
  -- seule source universelle ; verdict HTTP recoupe par la FENETRE d'execution
  -- (trigger_purge_cron insere sa ligne DANS la transaction du job).
  scheduled as (
    select
      d.start_time                          as run_started_at,
      d.end_time                            as run_ended_at,
      d.status::text                        as status,
      d.return_message::text                as return_message,
      l.requested_at, l.http_status, l.timed_out, l.error_msg,
      l.response_body, l.reconciled_at,
      coalesce(l.trigger_source, 'schedule') as trigger_source,
      l.triggered_by,
      l.verdict_source, l.attendu_de_la_tache
    from cron.job_run_details d
    join target t on t.jobid = d.jobid
    left join lateral (
      select ll.requested_at, ll.http_status, ll.timed_out, ll.error_msg,
             ll.response_body, ll.reconciled_at, ll.trigger_source, ll.triggered_by,
             ll.verdict_source, ll.attendu_de_la_tache
        from public.cron_run_log ll
       where ll.job_name = p_job_name
         and ll.requested_at >= d.start_time
         and ll.requested_at <= coalesce(d.end_time, d.start_time + interval '1 hour')
       order by ll.requested_at asc
       limit 1
    ) l on true
  ),
  -- Branche B : les declenchements MANUELS, qui n'existent que dans le journal.
  manual as (
    select
      ll.requested_at as run_started_at,
      ll.reconciled_at as run_ended_at,
      null::text      as status,
      null::text      as return_message,
      ll.requested_at, ll.http_status, ll.timed_out, ll.error_msg,
      ll.response_body, ll.reconciled_at,
      ll.trigger_source, ll.triggered_by,
      ll.verdict_source, ll.attendu_de_la_tache
    from public.cron_run_log ll
    where ll.job_name = p_job_name
      and ll.trigger_source = 'manual'
  ),
  merged as (
    select * from scheduled
    union all
    select * from manual
  ),
  counted as (
    select m.*, count(*) over () as total_count
    from merged m
    order by m.run_started_at desc
    limit greatest(1, least(coalesce(p_limit, 25), 200))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    c.run_started_at,
    c.run_ended_at,
    case when c.run_ended_at is null then null
         else (extract(epoch from (c.run_ended_at - c.run_started_at)) * 1000)::integer end,
    c.status,
    c.return_message,
    c.requested_at,
    c.http_status,
    c.timed_out,
    c.error_msg,
    c.response_body,
    c.reconciled_at,
    c.trigger_source,
    u.email::text,
    c.verdict_source,
    -- ⚠️ `false` QUAND LA LIGNE DE JOURNAL N'EXISTE PAS DU TOUT. Une execution
    --    planifiee sans ligne appariee ne doit pas se lire « la tache n'a pas
    --    rendu compte » : on ne lui a rien demande, il n'y a rien a rendre.
    coalesce(c.attendu_de_la_tache, false),
    c.total_count
  from counted c
  left join public.users u on u.id = c.triggered_by
  order by c.run_started_at desc;
$fn$;

revoke all on function public.admin_cron_job_runs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_cron_job_runs(text, integer, integer)
  to service_role;

comment on function public.admin_cron_job_runs(text, integer, integer) is
  'Historique d''une tache planifiee. `verdict_attendu` dit si la tache devait '
  'ecrire son verdict elle-meme : false sur tout ce qui precede le 23/09/2026, '
  'et l''ecran l''ecrit au lieu de laisser lire un trou d''activite (§E.52).';


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. POSTCONDITION DE LA SECONDE MOITIE
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  -- ⚠️ MÊME CORRECTIF QUE CI-DESSUS, ET C'EST LA SECONDE DE QUATRE : la
  --    signature se résout par ses TYPES.
  --    ⚠️ Le `pg_get_function_result`, LUI, RESTE — et c'est voulu : le type de
  --       retour d'une fonction qui rend une TABLE porte les NOMS de colonnes,
  --       et c'est précisément un nom de colonne qu'on veut ici. La même
  --       propriété qui cassait la ligne du dessus est celle qui fait marcher
  --       celle-ci. Il est simplement séparé, pour que son échec se distingue.
  if to_regprocedure('public.admin_cron_job_runs(text, integer, integer)') is null then
    raise exception
      'verdict_ecrit_par_la_tache: admin_cron_job_runs(text, integer, integer) introuvable [vu : %]',
      coalesce(
        (select string_agg(p.oid::regprocedure::text, ' | ')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'admin_cron_job_runs'),
        'aucune fonction de ce nom');
  end if;
  if coalesce(
       pg_get_function_result(to_regprocedure('public.admin_cron_job_runs(text, integer, integer)')),
       ''
     ) not like '%verdict_attendu boolean%' then
    raise exception
      'verdict_ecrit_par_la_tache: admin_cron_job_runs ne rend pas verdict_attendu [rendu : %]',
      pg_get_function_result(to_regprocedure('public.admin_cron_job_runs(text, integer, integer)'));
  end if;

  -- UNE SEULE surcharge : deux coexistantes feraient resoudre l'appel vers
  -- l'ancienne, et l'ecran perdrait la colonne sans que rien ne le dise (§E.1).
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_cron_job_runs') <> 1 then
    raise exception
      'verdict_ecrit_par_la_tache: admin_cron_job_runs existe en plusieurs surcharges';
  end if;
end
$$;
