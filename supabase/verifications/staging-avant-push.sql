-- ════════════════════════════════════════════════════════════════════════════
--  LA REQUÊTE DE STAGING, AVANT CHAQUE `db push` (étape 4 de §G.4 ter).
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
--
--  TROIS SORTES DE LIGNES, ET LEUR ÉTIQUETTE LE DIT :
--    état :          ⓪ — la requête est écrite pour UN état de staging : la dernière
--                    migration appliquée. Si staging est ailleurs, la requête est
--                    périmée : ÉCART, on la remet à jour AVANT de lire le reste.
--    prochain push : ce que les migrations EN ATTENTE retirent ou créent. Tout ce qui
--                    dépend du push vit dans les DEUX listes du `with` ci-dessous, et
--                    nulle part ailleurs.
--    invariant :     vrai avant et après chaque push, sans date.
--
--  POURQUOI (28/09/2026) : la version précédente décrivait l'état d'AVANT des
--  pushs déjà faits ; une fois la phase B déployée, quinze de ses lignes sortaient
--  en ÉCART alors que tout était normal. Une ligne périmée est une FAUSSE ALERTE —
--  et on apprend à ignorer une alerte fausse. La garde est dans le dépôt :
--  `node scripts/diag-requete-staging.mjs` rougit si les deux listes ne sont pas
--  EXACTEMENT ce que font les migrations qui suivent l'état déclaré en ⓪, si une
--  ligne n'est pas étiquetée, ou si la requête écrit.
--
--  ⚠️ NON VÉRIFIÉ : ⓪ lit la colonne `name` de `supabase_migrations.schema_migrations`
--  (tenue par la CLI). Si ⓪ observe une chaîne vide, la colonne n'existe pas sur
--  staging : lire `npx supabase migration list` à la place, et le dire.
--  Le secret du Vault est compté par son NOM ; sa valeur n'est pas lue.
-- ─────────────────────────────────────────────────────────────────────────────

with
  -- Les signatures que les migrations EN ATTENTE suppriment (§E.72, étape 3) :
  -- présentes avant le push, absentes après. Tenue égale aux `drop function` en attente.
  -- CE PUSH, LA PREMIÈRE LIVRAISON DU REGROUPEMENT (03/10/2026, ARRÊT 28) : staging est à jour jusqu'à
  -- specialite_ecriture_et_avis_une_fois (lot « zones de travail » déployé, e27fa56). Quatre migrations, toutes AVANT,
  -- dans l'ordre des noms :
  --  · annonce_criteres_communs (principal) — six colonnes neuves sur publications et une sur profiles (nullables ou à
  --    défaut vide), six contraintes qui ne gardent qu'elles, deux fonctions (lire_duree, reprendre_criteres_annonces) et
  --    une reprise (work_mode → work_modes, duration lisible → duree_valeur + duree_unite) ;
  --  · zones_liste_des_pays (S1) — la liste des zones détachée de countries (clé étrangère retirée, une contrainte de
  --    forme posée), les codes pays des zones en text, 131 pays et les quatre du Royaume-Uni ajoutés, le Royaume-Uni
  --    remplacé par eux, Royaume-Uni et Israël désactivés. Elle SUPPRIME work_zone_country_codes(uuid[]) et la RECRÉE
  --    aussitôt, même signature, en text[] (le type de retour ne se change pas par « or replace ») : présente avant ET
  --    après le push — la ligne ① ne vérifie que l'avant ;
  --  · mission_postulee (S2) — un champ calculé de matches, fermé au navigateur ; deux commentaires de colonnes ;
  --  · validation_annonces (S3) — l'action annonce_refusee, la clé « voie » ajoutée à deux listes blanches,
  --    publier_annonce() redéfinie (signature inchangée : elle n'est pas « créée »), refuser_annonce() nouvelle.
  prochain_push_retire(signature) as (
    select unnest(array['public.work_zone_country_codes(uuid[])']::text[])
  ),
  -- Ce que les migrations EN ATTENTE créent : absent avant le push (§E.60 : un nom
  -- déjà pris fait sauter `if not exists` EN SILENCE). genre ∈ fonction, table, index, contrainte.
  -- Un déclencheur et des lignes reprises ne sont pas « créés » au sens de cette liste.
  prochain_push_cree(genre, nom) as (
    select v.genre, v.nom from (values
      -- annonce_criteres_communs (principal)
      ('fonction', 'lire_duree'),
      ('fonction', 'reprendre_criteres_annonces'),
      ('contrainte', 'publications_work_modes_valid'),
      ('contrainte', 'publications_temps_travail_valid'),
      ('contrainte', 'publications_repartition_hybride_check'),
      ('contrainte', 'publications_duree_check'),
      ('contrainte', 'publications_offre_sans_duree'),
      ('contrainte', 'profiles_temps_travail_valid'),
      -- zones_liste_des_pays (S1)
      ('fonction', 'remplacer_zone_de_travail'),
      ('contrainte', 'work_zones_code_pays_forme')
    ) v(genre, nom)
  )

select v.ordre,
       v.verification,
       v.attendu,
       v.observe,
       case when v.observe = v.attendu then 'OK' else 'ÉCART' end as verdict
from (values

  -- ⓪ L'état pour lequel cette requête est écrite : la dernière migration appliquée, par son NOM (§G.3).
  (0, 'état : dernière migration appliquée sur staging (sinon la requête est périmée — la remettre à jour d''abord)',
   'specialite_ecriture_et_avis_une_fois',
   (select regexp_replace(coalesce(to_jsonb(m) ->> 'name', ''), '^[0-9]+_', '')
      from supabase_migrations.schema_migrations m order by m.version desc limit 1)),

  -- ① Chaque signature que le push supprime est là. Une absente : quelqu'un l'a retirée à la main
  --    (`drop function if exists` resterait sans effet, mais l'état a divergé des migrations).
  (1, 'prochain push : signatures qu''il supprime, présentes aujourd''hui',
   (select count(*)::text from prochain_push_retire),
   (select count(*)::text from prochain_push_retire r where to_regprocedure(r.signature) is not null)),

  -- ② Rien de ce que le push crée n'existe déjà (§E.60).
  (2, 'prochain push : fonctions, tables, index et contraintes qu''il crée, absents aujourd''hui', '0',
   (select count(*)::text from prochain_push_cree c
     where (c.genre = 'fonction' and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                               where n.nspname = 'public' and p.proname = c.nom))
        or (c.genre in ('table', 'index') and to_regclass('public.' || c.nom) is not null)
        or (c.genre = 'contrainte' and exists (select 1 from pg_constraint k join pg_namespace n on n.oid = k.connamespace
                                                 where n.nspname = 'public' and k.conname = c.nom)))),

  -- ⑭ Le sous-domaine est un réglage (§D.28) : sa forme est tenue EN BASE par une contrainte posée VALIDÉE (§E.64).
  --    Absente ou non validée, l'écran accepterait ce que le résolveur refuse ensuite — un écosystème injoignable.
  (14, 'invariant : contrainte domains_sous_domaine_forme présente et validée', '1',
   (select count(*)::text from pg_constraint k join pg_namespace n on n.oid = k.connamespace
     where n.nspname = 'public' and k.conname = 'domains_sous_domaine_forme' and k.convalidated)),

  -- ③ Une surcharge posée à la main échappe au balayage statique des migrations. Les signatures que
  --    le push supprime sont retirées du compte : elles sont la seule surcharge ATTENDUE avant lui.
  --    ⚠️ ELLES SE COMPARENT PAR IDENTIFIANT, JAMAIS PAR TEXTE (push 3, 28/09/2026) : `p.oid::regprocedure::text`
  --    rend « admin_cron_run_now(text,uuid) » — sans `public.`, sans espace — et la liste écrit
  --    « public.admin_cron_run_now(text, uuid) ». L'exclusion ne reconnaissait RIEN : ÉCART à tort, alors que ce
  --    push supprimait bien la surcharge (vérifié à la main sur staging). `to_regprocedure()` résout la liste en
  --    identifiants, comme la ligne ① (§E.67 : une comparaison de chaînes rendues par Postgres parie sur un format).
  (3, 'invariant : fonctions public à deux signatures ou plus (hors extensions, hors ce que le push supprime)', '0',
   (select count(*)::text from (
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
         and p.oid not in (select to_regprocedure(r.signature)::oid from prochain_push_retire r
                            where to_regprocedure(r.signature) is not null)
       group by p.proname having count(*) > 1) d)),

  -- ④ Une fois par geste (§D.26, GL005) : l'index unique (pièce, action, sujet) existe, UNIQUE.
  (4, 'invariant : grand_livre_une_fois_idx existe, UNIQUE', '1',
   (select count(*)::text from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'grand_livre_une_fois_idx' and i.indisunique)),

  -- ⑤ §E.69 : le paiement fait `on conflict (stripe_invoice_id) where stripe_invoice_id is not null` —
  --    il exige un index unique PARTIEL, avec ce prédicat.
  (5, 'invariant : transactions.stripe_invoice_id, index unique PARTIEL (where stripe_invoice_id is not null)', '1',
   (select count(*)::text from pg_index i
      join pg_class t on t.oid = i.indrelid join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public' and t.relname = 'transactions' and i.indisunique
       and i.indpred is not null
       and pg_get_indexdef(i.indexrelid) ilike '%(stripe_invoice_id)%'
       and pg_get_expr(i.indpred, i.indrelid) ilike '%stripe_invoice_id is not null%')),

  -- ⑥ Les tâches planifiées appellent trigger_purge_cron(), qui lève sans ces deux secrets.
  (6, 'invariant : Vault, secrets cron_secret et purge_cron_base_url présents (par leur nom)', '2',
   (select count(distinct s.name)::text from vault.secrets s where s.name in ('cron_secret', 'purge_cron_base_url'))),

  -- ⑦ pgcrypto signe et vérifie la preuve d'inscription (§D.27). Supabase l'installe par défaut dans `extensions`
  --    (NON VÉRIFIÉ sur staging — c'est ce que cette ligne dit) ; absente, la migration la crée : lire la ligne.
  (7, 'invariant : extensions pg_cron, pg_net et pgcrypto installées', '3',
   (select count(*)::text from pg_extension e where e.extname in ('pg_cron', 'pg_net', 'pgcrypto'))),

  -- ⑧ AUCUNE PORTE LATÉRALE (§D.26) : aucune politique ne laisse un client écrire une table dont l'écriture
  --    est une action du grand livre. La liste couvre chaque table que `diag-portes-laterales` DÉRIVE des
  --    écrivains SQL (le contrôle rougit si une table dérivée y manque) ; une politique posée à la main,
  --    hors migration, n'est vue qu'ici.
  (8, 'invariant : politiques d''écriture client (anon, authenticated, public) sur une table journalisée', '0',
   (select count(*)::text from pg_policies p
     where p.schemaname = 'public'
       and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       and p.roles && array['anon', 'authenticated', 'public']::name[]
       and p.tablename in ('ai_model_tarifs', 'ai_quotas', 'ai_spend_caps', 'ai_spend_seuils_acteur', 'audit_logs', 'blocked_email_domains',
                           'candidature_depots', 'candidatures', 'conversations', 'cron_run_log', 'duree_reglages',
                           'grand_livre', 'grand_livre_actions', 'grand_livre_conservation', 'matches',
                           'matching_settings', 'messages', 'notification_preferences', 'organization_invitations', 'organization_members',
                           'organizations', 'packages', 'profiles', 'public_email_domains', 'publications', 'session_logs', 'stripe_events',
                           'transactions', 'travaux_ia', 'users', 'verification_providers'))),

  -- ⑨ Le grand livre se lit par `lire_grand_livre()` et `lire_piece()` seulement : AUCUNE politique sur la
  --    table, lecture comprise (une politique de lecture l'ouvrirait au navigateur).
  (9, 'invariant : politiques sur grand_livre (toutes commandes)', '0',
   (select count(*)::text from pg_policies p where p.schemaname = 'public' and p.tablename = 'grand_livre')),

  -- ⑩ Le verrou (§D.26) : le navigateur n'a aucun droit d'écriture sur le grand livre.
  (10, 'invariant : droits d''écriture d''anon ou authenticated sur grand_livre', '0',
   (select count(*)::text from unnest(array['anon', 'authenticated']) r(role)
      cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) d(droit)
     where has_table_privilege(r.role, 'public.grand_livre', d.droit))),

  -- ⑪ §E.73 : une fonction de trigger qui cite une colonne absente tue TOUTE inscription, et ni le lint ni un
  --    contrôle statique ne le voient. Chaque colonne que handle_new_user écrit existe (users 15 + profiles 12) ;
  --    la liste est tenue ÉGALE aux insertions de sa dernière définition par `diag-requete-staging`.
  (11, 'invariant : colonnes écrites par handle_new_user présentes (users 15 + profiles 12)', '27',
   (select count(*)::text from information_schema.columns c
     where c.table_schema = 'public'
       and ((c.table_name = 'users' and c.column_name in ('id', 'email', 'role_id', 'domain_id', 'user_type', 'status',
                                                         'email_verified', 'is_verified', 'first_name', 'last_name', 'locale',
                                                         'phone', 'phone_verified', 'cgu_accepted_at', 'cgu_version'))
         or (c.table_name = 'profiles' and c.column_name in ('user_id', 'domain_id', 'expert_type', 'title', 'visible',
                                                            'profile_score', 'languages', 'skills', 'certifications',
                                                            'branch_id', 'speciality_ids', 'speciality_other'))))),

  -- ⑫ La colonne que l'ancien handle_new_user citait (§E.73) : supprimée le 01/09/2026, elle ne revient pas.
  (12, 'invariant : profiles.speciality_id absente', '0',
   (select count(*)::text from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'profiles' and c.column_name = 'speciality_id')),

  -- ⑬ LA PORTE D'INSCRIPTION (§D.27) : `handle_new_user` vérifie chaque preuve avec ce secret. Absent, TOUTE
  --    inscription est refusée (IN011). Il se pose AVANT le push, à la MÊME valeur que INSCRIPTION_HMAC_SECRET
  --    sur Vercel (docs/reprise.md, les étapes de Youssef). Compté par son NOM ; sa valeur n'est pas lue.
  (13, 'invariant : Vault, secret inscription_hmac_secret présent (par son nom)', '1',
   (select count(*)::text from vault.secrets s where s.name = 'inscription_hmac_secret')),

  -- ⑮ à ⑱ LA LISTE DES PAYS DES ZONES (lot finitions et pays). ⑮ : staging part des 64 zones pays de départ — c'est ce
  --    qui fait aboutir staging et une base neuve à la MÊME liste après le push (197). Un autre nombre : quelqu'un a
  --    touché le référentiel hors migration — on s'arrête et on lit.
  (15, 'prochain push : zones pays actives aujourd''hui — 64, la liste de départ (après le push : 197, comme une base neuve)', '64',
   (select count(*)::text from public.work_zones w where w.kind = 'country' and w.active)),

  -- ⑯ Les deux zones que le push désactive existent, actives.
  (16, 'prochain push : zones Israël et Royaume-Uni présentes et actives (le push les retire de la liste)', '2',
   (select count(*)::text from public.work_zones w where w.code in ('C_IL', 'C_GB') and w.active)),

  -- ⑰ ⑱ LIGNES DE COMPTE (décision de Youssef) : le verdict est toujours OK, on LIT l'observé avant le push. Israël :
  --    ces profils et annonces le PERDENT, et une liste devenue vide ne retient plus personne (règle en place) — ceux qui
  --    « n'avaient que lui » ne recouperont plus rien. Royaume-Uni : ils reçoivent ses quatre pays, sans perte.
  (17, 'prochain push : profils et annonces qui ont choisi Israël — le compte, à lire (ils le perdent)',
   (select format('profils %s (dont %s n''avaient que lui) · annonces %s (dont %s publiées, %s n''avaient que lui)',
             (select count(*) from public.profiles p where z.id = any (p.work_zone_ids)),
             (select count(*) from public.profiles p where p.work_zone_ids = array[z.id]),
             (select count(*) from public.publications a where z.id = any (a.work_zone_ids)),
             (select count(*) from public.publications a where z.id = any (a.work_zone_ids) and a.status = 'published'),
             (select count(*) from public.publications a where a.work_zone_ids = array[z.id]))
      from public.work_zones z where z.code = 'C_IL'),
   (select format('profils %s (dont %s n''avaient que lui) · annonces %s (dont %s publiées, %s n''avaient que lui)',
             (select count(*) from public.profiles p where z.id = any (p.work_zone_ids)),
             (select count(*) from public.profiles p where p.work_zone_ids = array[z.id]),
             (select count(*) from public.publications a where z.id = any (a.work_zone_ids)),
             (select count(*) from public.publications a where z.id = any (a.work_zone_ids) and a.status = 'published'),
             (select count(*) from public.publications a where a.work_zone_ids = array[z.id]))
      from public.work_zones z where z.code = 'C_IL')),

  (18, 'prochain push : profils et annonces qui ont choisi le Royaume-Uni — le compte, à lire (ils reçoivent ses quatre pays)',
   (select format('profils %s (dont %s n''avaient que lui) · annonces %s (dont %s publiées, %s n''avaient que lui)',
             (select count(*) from public.profiles p where z.id = any (p.work_zone_ids)),
             (select count(*) from public.profiles p where p.work_zone_ids = array[z.id]),
             (select count(*) from public.publications a where z.id = any (a.work_zone_ids)),
             (select count(*) from public.publications a where z.id = any (a.work_zone_ids) and a.status = 'published'),
             (select count(*) from public.publications a where a.work_zone_ids = array[z.id]))
      from public.work_zones z where z.code = 'C_GB'),
   (select format('profils %s (dont %s n''avaient que lui) · annonces %s (dont %s publiées, %s n''avaient que lui)',
             (select count(*) from public.profiles p where z.id = any (p.work_zone_ids)),
             (select count(*) from public.profiles p where p.work_zone_ids = array[z.id]),
             (select count(*) from public.publications a where z.id = any (a.work_zone_ids)),
             (select count(*) from public.publications a where z.id = any (a.work_zone_ids) and a.status = 'published'),
             (select count(*) from public.publications a where a.work_zone_ids = array[z.id]))
      from public.work_zones z where z.code = 'C_GB'))

) as v(ordre, verification, attendu, observe)
order by v.ordre;
