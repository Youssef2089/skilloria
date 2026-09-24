-- ════════════════════════════════════════════════════════════════════════════
--  DEUX REQUÊTES, À JOUER SUR STAGING. LECTURE SEULE — aucun INSERT, aucun
--  UPDATE, aucun DELETE, aucun DDL.
-- ════════════════════════════════════════════════════════════════════════════
--
--  Contexte : le `db push` du 24/09/2026 s'est arrêté sur une postcondition
--  FAUSSE (§E.67). Ces deux requêtes répondent aux deux questions que le
--  correctif ne peut pas trancher tout seul :
--    ① l'échec a-t-il laissé staging propre ?
--    ② le mécanisme incriminé est-il bien celui qu'on a diagnostiqué ?
--
--  ⚠️ LA SECONDE EXISTE PARCE QUE JE N'AI PAS PU L'EXÉCUTER. Ni `psql`, ni
--     Docker, et PostgREST ne lit pas `pg_catalog`. Ce qui est MESURÉ dans le
--     dépôt : les neuf fonctions visées par le motif fautif ont toutes des
--     paramètres nommés, et la fonction déclarée absente venait d'être créée
--     six lignes plus haut dans la même transaction. Le reste est du
--     raisonnement. Cette requête le remplace par une mesure.
-- ─────────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════════
--  ① STAGING EST-IL PROPRE ? — les dix migrations du sprint, une par ligne
-- ════════════════════════════════════════════════════════════════════════════
--
--  Attendu : les SIX dernières en « ABSENTE ». Les quatre premières étaient
--  parties avant l'arrêt (chaque migration est sa propre transaction) : leur
--  état dit ce que le push a réellement appliqué, et c'est une information
--  utile qu'une requête sur les six seules aurait cachée.
select
  attendues.version,
  attendues.nom,
  case when m.version is null then 'ABSENTE' else 'APPLIQUEE' end as etat
from (values
  ('20260922000040', 'index_packages_stripe'),
  ('20260922000050', 'index_depense_par_mois'),
  ('20260923000000', 'annonce_active_partagee'),
  ('20260923000010', 'relance_rejouee'),
  ('20260923000020', 'verdict_ecrit_par_la_tache'),
  ('20260923000030', 'candidature_complete_ou_inexistante'),
  ('20260923000040', 'bail_par_portee'),
  ('20260923000050', 'tarif_par_recherche'),
  ('20260923000060', 'plafond_par_acteur'),
  ('20260924000000', 'depense_par_acteur_et_action')
) as attendues(version, nom)
left join supabase_migrations.schema_migrations m
  on m.version = attendues.version
order by attendues.version;


-- ── ET LA CONTRE-ÉPREUVE : rien ne s'est glissé en base ────────────────────
--  Une migration annulée ne doit avoir laissé NI table, NI fonction. Si l'une
--  de ces lignes rend autre chose que 0, la transaction n'a pas été défaite
--  et il faut regarder avant de repousser.
select 'baux'                          as objet, count(*) as present from pg_class  where relname = 'baux' and relkind = 'r'
union all
select 'candidature_depots',            count(*) from pg_class where relname = 'candidature_depots' and relkind = 'r'
union all
select 'cloturer_run_cron',             count(*) from pg_proc  where proname = 'cloturer_run_cron'
union all
select 'ai_spend_debut_du_mois',        count(*) from pg_proc  where proname = 'ai_spend_debut_du_mois'
union all
select 'ai_spend_par_acteur_et_action', count(*) from pg_proc  where proname = 'ai_spend_par_acteur_et_action'
union all
select 'ai_model_tarifs.usd_par_recherche', count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'ai_model_tarifs' and column_name = 'usd_par_recherche';


-- ════════════════════════════════════════════════════════════════════════════
--  ② LE MÉCANISME — ce que rendent les deux formes, côte à côte
-- ════════════════════════════════════════════════════════════════════════════
--
--  À jouer sur N'IMPORTE QUELLE fonction aux paramètres nommés DÉJÀ présente
--  sur staging. Celles retenues ci-dessous viennent de migrations appliquées
--  de longue date ; la requête n'exige aucune des six annulées.
--
--  CE QU'IL FAUT LIRE :
--    · `identity_arguments` porte-t-il les NOMS ? Si oui, la comparaison
--      d'origine ne pouvait jamais être vraie — et le diagnostic est établi.
--    · `types_seuls` et `signature_resolue` doivent, eux, ne porter QUE des
--      types. C'est sur eux que la correction s'appuie.
select
  p.proname                                        as fonction,
  pg_get_function_identity_arguments(p.oid)        as identity_arguments,
  oidvectortypes(p.proargtypes)                    as types_seuls,
  p.oid::regprocedure::text                        as signature_resolue,
  -- LA QUESTION, POSÉE DANS LES DEUX SENS, SUR LA MÊME LIGNE :
  (pg_get_function_identity_arguments(p.oid) = oidvectortypes(p.proargtypes))
                                                   as les_deux_formes_coincident
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'ai_spend_par_acteur',      -- p_limite integer
    'ai_depense_par_mois',      -- p_mois integer
    'ai_depense_operations',    -- p_limite integer, p_mois date
    'prendre_bail_run',         -- p_job_name text, p_grace interval
    'ai_spend_status'           -- aucun paramètre : témoin, les deux formes y sont vides
  )
order by p.proname;


-- ── ET LA PARADE, ÉPROUVÉE DANS LES DEUX SENS ──────────────────────────────
--  ⚠️ LA SECONDE LIGNE EST CELLE QUI COMPTE. Une résolution qui rendrait
--     toujours quelque chose ne prouverait rien : il faut voir une ABSENCE
--     rendre NULL. Sans elle, la première ligne se lit comme une chance.
select
  'fonction existante, parametres nommes' as cas,
  to_regprocedure('public.ai_spend_par_acteur(integer)')::text as resolue,
  (to_regprocedure('public.ai_spend_par_acteur(integer)') is not null) as trouvee
union all
select
  'fonction absente',
  to_regprocedure('public.fonction_qui_nexiste_pas(integer, text)')::text,
  (to_regprocedure('public.fonction_qui_nexiste_pas(integer, text)') is not null)
union all
select
  'bonne fonction, MAUVAISE arite',
  to_regprocedure('public.ai_spend_par_acteur(integer, integer)')::text,
  (to_regprocedure('public.ai_spend_par_acteur(integer, integer)') is not null);
