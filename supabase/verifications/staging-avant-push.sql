-- ════════════════════════════════════════════════════════════════════════════
--  LA REQUÊTE DE STAGING, AVANT LE `db push` DU GRAND LIVRE (point 2.13).
-- ════════════════════════════════════════════════════════════════════════════
--
--  UNE requête, LECTURE SEULE : un SELECT, aucune écriture, aucun verrou pris
--  au-delà d'une lecture. À coller telle quelle dans l'éditeur SQL de staging
--  (Supabase → SQL Editor, projet wnayuerhakekxccgimeg), AVANT le push.
--  Une ligne par vérification : ce qu'on attend, ce qu'on observe, le verdict.
--
--  LECTURE DU VERDICT
--    OK      — l'observé est l'attendu.
--    ÉCART   — on S'ARRÊTE avant le push, et on lit la ligne.
--    À LIRE  — un volume, sans bonne ou mauvaise valeur : on le note.
--
--  Écrite pour l'état DU PUSH INTERROMPU (28/09/2026) : les migrations jusqu'à
--  journal_recherche_abandonnee sont appliquées, les 29 suivantes non. Elle ne
--  cite aucune colonne ni aucune table que le reste du lot crée (elle les cherche
--  dans le catalogue), sinon elle lèverait. Lignes mises à jour ce jour-là : ②, ⑦,
--  ⑨ ; ajoutées : ㉑, ㉒, ㉓.
--  Le secret du Vault est compté par son NOM ; sa valeur n'est pas lue.
-- ─────────────────────────────────────────────────────────────────────────────

select v.ordre,
       v.verification,
       v.attendu,
       v.observe,
       case when v.attendu like 'information%' then 'À LIRE'
            when v.observe = v.attendu          then 'OK'
            else 'ÉCART' end as verdict
from (values

  -- ① L'index unique (pièce, action, sujet) se pose sur un grand livre DÉJÀ rempli par le socle :
  --    un doublon ferait échouer la migration à mi-chemin.
  (1, 'grand_livre : doublons (piece, type_action, sujet) — l''index unique du lot échouerait', '0',
   (select count(*)::text from (
      select 1 from public.grand_livre g
       group by g.piece, g.type_action, coalesce(g.sujet_id, '00000000-0000-0000-0000-000000000000'::uuid)
      having count(*) > 1) d)),

  -- ② L'index d'unicité EXISTE : posé par liste_blanche_par_action, APPLIQUÉE le 28/09/2026. Unique, et sur
  --    trois attributs — un nom pris par autre chose l'aurait fait sauter en silence (§E.60).
  (2, 'grand_livre_une_fois_idx existe, UNIQUE (appliqué avec liste_blanche_par_action)', '1',
   (select count(*)::text from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'grand_livre_une_fois_idx' and i.indisunique)),

  -- ③ §E.69 : le paiement fait `on conflict (stripe_invoice_id) where stripe_invoice_id is not null` —
  --    il exige un index unique PARTIEL, avec ce prédicat.
  (3, 'transactions.stripe_invoice_id : index unique PARTIEL (where stripe_invoice_id is not null)', '1',
   (select count(*)::text from pg_index i
      join pg_class t on t.oid = i.indrelid join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public' and t.relname = 'transactions' and i.indisunique
       and i.indpred is not null
       and pg_get_indexdef(i.indexrelid) ilike '%(stripe_invoice_id)%'
       and pg_get_expr(i.indpred, i.indrelid) ilike '%stripe_invoice_id is not null%')),

  -- ④ La tâche constats_trigger appelle trigger_purge_cron(), qui lève sans ces deux secrets.
  (4, 'Vault : secrets cron_secret et purge_cron_base_url présents (par leur nom)', '2',
   (select count(distinct s.name)::text from vault.secrets s where s.name in ('cron_secret', 'purge_cron_base_url'))),

  (5, 'extensions pg_cron et pg_net installées', '2',
   (select count(*)::text from pg_extension e where e.extname in ('pg_cron', 'pg_net'))),

  -- ⑥ Créée par le push ; présente avant, elle aurait été posée à la main.
  (6, 'tâche constats_trigger pas encore planifiée', '0',
   (select count(*)::text from cron.job j where j.jobname = 'constats_trigger')),

  -- ⑦ Ce que le RESTE du lot ajoute ne doit pas exister déjà (une colonne posée à la main aurait un autre type).
  --    `cles_detail` et `candidature_depots.piece` sont appliquées : voir ㉑.
  (7, 'colonnes du reste du lot absentes (expiration_constatee_at, fermeture_constatee_at)', '0',
   (select count(*)::text from information_schema.columns c
     where c.table_schema = 'public'
       and (c.table_name, c.column_name) in (('publications', 'expiration_constatee_at'), ('candidatures', 'fermeture_constatee_at')))),

  (8, 'table constats_mise_en_service absente', '0',
   (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'constats_mise_en_service')),

  -- ⑨ Les deux anciennes signatures que le RESTE du push supprime (§E.72) : présentes aujourd'hui, appelées
  --    par le code en ligne jusqu'au déploiement. Les deux autres sont déjà parties : voir ㉒.
  (9, 'anciennes signatures encore présentes (supprimées par le reste du push : programmer_suppression, maj_membre)', '2',
   (select count(*)::text from unnest(array[
      'public.programmer_suppression_compte(uuid, timestamptz)',
      'public.maj_membre_organisation(uuid, character varying, character varying, boolean)']) s
     where to_regprocedure(s) is not null)),

  -- ⑩ Une surcharge posée à la main, hors migration, échappe au balayage statique (reprise §1.4).
  (10, 'fonctions public à deux signatures ou plus (hors extensions)', '0',
   (select count(*)::text from (
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
       group by p.proname having count(*) > 1) d)),

  -- ⑪ Les portes latérales (2.8, T.4) : les TREIZE politiques que le push retire, dont
  --    `profiles_self_update` (les bascules passent par le geste serveur). Une absente est sans
  --    effet (`drop policy if exists`), mais alors l'écart se lit : quelqu'un l'a retirée à la main.
  (11, 'politiques retirées par le push, présentes aujourd''hui', '13',
   (select count(*)::text from pg_policies p
     where p.schemaname = 'public'
       and (p.tablename, p.policyname) in (
         ('organization_invitations', 'organization_invitations_admin_all'), ('candidatures', 'candidatures_expert_insert'),
         ('candidatures', 'candidatures_expert_update'), ('messages', 'messages_party_mark_read'),
         ('messages', 'messages_sender_insert'), ('organization_members', 'organization_members_admin_insert'),
         ('organization_members', 'organization_members_admin_update'), ('organization_members', 'organization_members_admin_delete'),
         ('organizations', 'organizations_admin_update'), ('profiles', 'profiles_self_insert'),
         ('publications', 'publications_member_write'), ('users', 'users_self_update'),
         ('profiles', 'profiles_self_update')))),

  -- ⑫ Une porte ouverte À LA MAIN : une politique d'écriture client sur une table journalisée qui
  --    n'est dans AUCUNE migration. Les treize connues sont exclues ; le reste doit être vide.
  (12, 'politiques d''écriture client hors migration sur une table journalisée', '0',
   (select count(*)::text from pg_policies p
     where p.schemaname = 'public'
       and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       and p.roles && array['anon', 'authenticated', 'public']::name[]
       and p.tablename in ('ai_model_tarifs', 'ai_quotas', 'ai_spend_caps', 'ai_spend_seuils_acteur', 'audit_logs',
                           'candidature_depots', 'candidatures', 'conversations', 'cron_run_log', 'duree_reglages',
                           'grand_livre_actions', 'matching_settings', 'messages', 'organization_invitations',
                           'organization_members', 'organizations', 'packages', 'profiles', 'publications',
                           'session_logs', 'transactions', 'users', 'verification_providers', 'grand_livre')
       and (p.tablename, p.policyname) not in (
         ('organization_invitations', 'organization_invitations_admin_all'), ('candidatures', 'candidatures_expert_insert'),
         ('candidatures', 'candidatures_expert_update'), ('messages', 'messages_party_mark_read'),
         ('messages', 'messages_sender_insert'), ('organization_members', 'organization_members_admin_insert'),
         ('organization_members', 'organization_members_admin_update'), ('organization_members', 'organization_members_admin_delete'),
         ('organizations', 'organizations_admin_update'), ('profiles', 'profiles_self_insert'),
         ('publications', 'publications_member_write'), ('users', 'users_self_update'),
         ('profiles', 'profiles_self_update')))),

  -- ⑬ Le passif des annonces : marqué par la migration, SANS ligne au grand livre (2.11).
  (13, 'annonces publiées DÉJÀ expirées (passif marqué sans ligne)', 'information : volume à noter',
   (select count(*)::text from public.publications p cross join public.duree_reglages d
     where d.ligne_unique and p.status = 'published'
       and not public.annonce_active(p.status, p.expires_at, p.published_at, d.vie_annonce_jours))),

  -- ⑭ Les lignes que le socle a déjà écrites : elles ne passeront pas par la liste blanche (elle ne
  --    vaut qu'à l'écriture) — leur nombre, pour mémoire.
  (14, 'lignes déjà au grand livre (socle)', 'information : volume à noter',
   (select count(*)::text from public.grand_livre)),

  (15, 'actions déjà dans la liste fermée (le push les porte à 56)', 'information : volume à noter',
   (select count(*)::text from public.grand_livre_actions)),

  -- ⑯ T.1 : chaque colonne que la NOUVELLE définition de handle_new_user écrit existe (11 sur users,
  --    12 sur profiles). Une seule absente et toute inscription échouerait encore.
  (16, 'colonnes écrites par le nouveau handle_new_user présentes (users 11 + profiles 12)', '23',
   (select count(*)::text from information_schema.columns c
     where c.table_schema = 'public'
       and ((c.table_name = 'users' and c.column_name in ('id', 'email', 'role_id', 'domain_id', 'user_type', 'status',
                                                         'email_verified', 'is_verified', 'first_name', 'last_name', 'locale'))
         or (c.table_name = 'profiles' and c.column_name in ('user_id', 'domain_id', 'expert_type', 'title', 'visible',
                                                            'profile_score', 'languages', 'skills', 'certifications',
                                                            'branch_id', 'speciality_ids', 'speciality_other'))))),

  -- ⑰ Le bug que le push corrige, lu sur la définition EN LIGNE : elle cite la colonne supprimée.
  (17, 'handle_new_user en ligne écrit profiles.speciality_id (le bug que T.1 corrige ; 0 après le push)', '1',
   (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'handle_new_user'
       and p.prosrc ~* '\mspeciality_id\M\s*[,)]')),

  -- ⑲ T.6 : les lignes DÉJÀ au grand livre sont-elles de vrais gestes, ou des restes de sonde ?
  --    Un vrai `ip_effacees` vient de la tâche ip_retention_purge (04:20 UTC) : origine tâche, sujet
  --    dérivé de la tâche, et SA ligne de journal de tâche à la même minute. Un vrai `reglage_modifie`
  --    a pour auteur un administrateur qui existe. Toute autre ligne serait un reste — attendu : aucune
  --    (les sondes du socle sont annulées ou attendent une erreur nommée, lu dans la migration).
  (19, 'lignes du grand livre qui ne sont NI un passage réel de ip_retention_purge NI un réglage d''un admin existant', '0',
   (select count(*)::text from public.grand_livre g
     where not (
             g.type_action = 'ip_effacees' and g.origine = 'tache_planifiee'
         and g.sujet_id = public.identifiant_derive('cron_job', 'ip_retention_purge')
         and exists (select 1 from public.cron_run_log l
                      where l.job_name = 'ip_retention_purge'
                        and l.requested_at between g.horodatage - interval '5 minutes' and g.horodatage + interval '5 minutes'))
       and not (
             g.type_action = 'reglage_modifie'
         and exists (select 1 from public.users u where u.id = g.acteur_id and u.user_type = 'admin')))),

  (20, 'les lignes du grand livre, par action et statut (lecture)', 'information : volume à noter',
   (select coalesce(string_agg(x.k || ' × ' || x.n, ' · ' order by x.k), 'aucune')
      from (select g.type_action || '/' || g.statut || ' (' || to_char(min(g.horodatage), 'DD/MM HH24:MI') || '→'
                   || to_char(max(g.horodatage), 'DD/MM HH24:MI') || ')' as k, count(*)::text as n
              from public.grand_livre g group by g.type_action, g.statut) x)),

  (18, 'profiles.speciality_id absente (supprimée le 01/09/2026)', '0',
   (select count(*)::text from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'profiles' and c.column_name = 'speciality_id')),

  -- ㉑ La moitié appliquée est bien là : les deux colonnes posées par les migrations appliquées.
  (21, 'colonnes déjà appliquées présentes (grand_livre_actions.cles_detail, candidature_depots.piece)', '2',
   (select count(*)::text from information_schema.columns c
     where c.table_schema = 'public'
       and (c.table_name, c.column_name) in (('grand_livre_actions', 'cles_detail'), ('candidature_depots', 'piece')))),

  -- ㉒ Les deux anciennes signatures retirées par les migrations appliquées sont ABSENTES. Tant que le code
  --    n'est pas déployé, les gestes qui les appelaient (offre par défaut, ouverture du dépôt) ÉCHOUENT sur
  --    staging — c'est la fenêtre de §E.72, ouverte depuis l'arrêt du push.
  (22, 'anciennes signatures déjà retirées (set_default_package(uuid), ouvrir_depot_candidature à 4 arguments) absentes', '0',
   (select count(*)::text from unnest(array[
      'public.set_default_package(uuid)',
      'public.ouvrir_depot_candidature(uuid, uuid, uuid, text)']) s
     where to_regprocedure(s) is not null)),

  -- ㉓ La fonction unique exiger_ecriture (EC001) est appliquée — les migrations suivantes l'appellent.
  (23, 'exiger_ecriture(bigint, text, bigint) présente (appliquée avec liste_blanche_par_action)', '1',
   (select count(*)::text from unnest(array['public.exiger_ecriture(bigint, text, bigint)']) s
     where to_regprocedure(s) is not null))

) as v(ordre, verification, attendu, observe)
order by v.ordre;
