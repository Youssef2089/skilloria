-- DEUX RUNS DU MEME CRON NE PEUVENT PLUS SE CHEVAUCHER
--
-- ═══ LE DEFAUT, ET SON ARITHMETIQUE ═══════════════════════════════════════
--   Quatre routes vivent sous app/api/cron/. Une seule est gardee — celle du
--   rejeu de matching, fermee au lot 20260912200000. Les trois autres n'ont
--   AUCUNE garde de run.
--
--   Et l'une d'elles porte exactement le meme calcul que le defaut deja
--   corrige :
--       expert_relance_trigger   cadence */5 min   maxDuration 300 s
--   Toutes les cinq minutes, pour un run qui peut durer cinq minutes. Le
--   chevauchement n'est pas hypothetique : il est STRUCTUREL. Pire,
--   `prochaine_relance_expert` est `stable`, sans delai de grace ni
--   `skip locked` : deux runs simultanes recoivent LE MEME PROFIL et refont le
--   meme travail d'IA.
--
--   Les deux purges, elles, sont QUOTIDIENNES : un chevauchement exigerait un
--   run de vingt-quatre heures, ce que `maxDuration` rend impossible. Leur
--   exposition reelle est ailleurs, et elle est bien reelle : le bouton
--   « executer maintenant » du back-office, et tout appel porteur de
--   CRON_SECRET. Le `pg_try_advisory_xact_lock` de `cron_manual_run` ne couvre
--   QUE la mise en file — son propre commentaire le dit : ce verrou meurt avec
--   la transaction, alors que le run vit dans une requete HTTP qui commence
--   apres.
--
-- ═══ POURQUOI UN BAIL GENERIQUE, ET PAS TROIS CORRECTIFS ══════════════════
--   Les quatre routes ont le meme trou. Trois correctifs sur mesure laisseraient
--   la cinquieme route, celle qu'on ecrira dans six mois, sans rien — et
--   personne ne saurait qu'il faut y penser. Le bail est un geste unique, pose
--   une fois, que toute nouvelle route reprend en une ligne.
--
-- ═══ CE QU'ON NE POUVAIT PAS REUTILISER TEL QUEL ══════════════════════════
--   Le matching a resolu le meme probleme, mais son bail est PAR ITEM : il
--   s'adosse a `publications.matching_attempted_at`, une colonne que le run
--   ecrit DE TOUTE FACON pour faire son travail. Rien a poser, rien a nettoyer.
--
--   Un run de cron n'a pas d'equivalent : son unite n'est pas une ligne, c'est
--   LA TACHE. Aucune colonne existante ne dit « ce job a demarre a telle heure
--   cote HTTP » — `cron_run_log` enregistre la mise en file par pg_cron, pas
--   l'execution de la route, et une invocation manuelle n'y ecrit rien.
--
--   ON GARDE DONC L'ESPRIT, PAS LA COLONNE : un DELAI DE GRACE adosse a une
--   donnee ECRITE, qui survit a la fin de la transaction et n'a RIEN A
--   NETTOYER. Un run qui tombe — processus tue, timeout, deploiement — ne
--   laisse aucun drapeau bloque : son bail expire tout seul.
--
--   ⚠️ POURQUOI PAS pg_try_advisory_xact_lock. Meme raison qu'au lot du
--      matching, et elle n'a pas bouge : ce verrou meurt avec la TRANSACTION,
--      alors que le run se deroule dans une requete HTTP qui dure jusqu'a 300 s,
--      longtemps apres que la fonction a rendu la main. Il ne couvrirait rien.
--
--   ⚠️ POURQUOI PAS UN DRAPEAU « en cours » QU'ON LEVE ET QU'ON BAISSE. Un
--      processus tue ne baisse jamais son drapeau : la tache resterait bloquee
--      pour toujours, et il faudrait une intervention en base pour la relancer.
--      Le delai de grace ne peut pas se coincer.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LA TABLE DES BAUX — une ligne par tache, jamais plus
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.cron_run_leases (
  job_name    text primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.cron_run_leases is
'Bail d''execution d''une tache planifiee : au plus UN run a la fois.

Une ligne par tache, creee au premier run. La cle primaire sur job_name est ce
qui rend la prise atomique (insert ... on conflict).

Ce n''est PAS un journal — cron_run_log et cron.job_run_details jouent ce role.
Cette table ne porte que l''etat courant, et sa valeur d''usage est le delai de
grace : un run tue ne laisse rien a nettoyer, son bail expire seul.';

comment on column public.cron_run_leases.started_at is
'Debut du run EN COURS. C''est la donnee a laquelle le delai de grace s''adosse :
tant que now() - started_at < grace, la tache est consideree occupee.';

comment on column public.cron_run_leases.finished_at is
'Fin du dernier run. Non null = bail libre immediatement, sans attendre la fin
du delai de grace — une tache rapide peut donc repartir tout de suite.
Null pendant un run, et apres un run tue : c''est alors le delai de grace, et lui
seul, qui rend le bail.';

alter table public.cron_run_leases enable row level security;
-- Aucune policy : la table n'est jamais lue ni ecrite par un client. Les deux
-- fonctions ci-dessous sont SECURITY DEFINER et bornees au service_role — la
-- lecture de supervision passe par les ecrans admin existants, qui lisent
-- cron_run_log et cron.job_run_details, pas ceci.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. PRENDRE LE BAIL — UNE SEULE INSTRUCTION, DONC ATOMIQUE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI CA TIENT SOUS CONCURRENCE. Tout est dans une instruction unique :
-- il n'y a pas de lecture separee de l'ecriture, donc pas de fenetre entre les
-- deux. Deux appels simultanes :
--   · le premier INSERE (ou met a jour) et prend le bail ;
--   · le second entre en conflit sur la cle primaire, part sur le DO UPDATE,
--     attend le verrou de ligne, puis REEVALUE son `where` sur la ligne DEJA
--     mise a jour — `started_at` vaut maintenant, donc la condition est fausse,
--     aucune ligne n'est rendue, et il repart bredouille.
-- C'est la base qui tranche, pas l'ordre d'arrivee ni une relecture applicative.
create or replace function public.prendre_bail_run(
  p_job_name text,
  p_grace    interval default interval '15 minutes'
) returns boolean
  language sql
  volatile
  security definer
  set search_path to 'public'
as $fn$
  with prise as (
    insert into public.cron_run_leases (job_name, started_at, finished_at)
    values (p_job_name, now(), null)
    on conflict (job_name) do update
       set started_at  = now(),
           finished_at = null
     where public.cron_run_leases.finished_at is not null
        or public.cron_run_leases.started_at < now() - p_grace
    returning 1
  )
  select exists (select 1 from prise);
$fn$;

comment on function public.prendre_bail_run(text, interval) is
'Prend le bail d''execution d''une tache. Rend true si le bail est obtenu, false
si un autre run le detient encore.

UNE SEULE INSTRUCTION : aucune fenetre entre une lecture et une ecriture, donc
rien a gagner a arriver en premier. Deux appels simultanes ne peuvent pas
obtenir true tous les deux.

p_grace doit valoir AU MOINS la duree maximale du run (maxDuration de la route).
En dessous, un run encore vivant se ferait doubler ; au-dessus, une tache tuee
attendrait plus longtemps que necessaire avant de repartir.

Un refus n''est JAMAIS une panne : c''est le cas normal quand un run est deja en
cours. L''appelant rend 200 et s''arrete.';

revoke all on function public.prendre_bail_run(text, interval) from public, anon, authenticated;
grant execute on function public.prendre_bail_run(text, interval) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RENDRE LE BAIL — un empressement, pas une obligation
-- ═══════════════════════════════════════════════════════════════════════════
-- Le bail se libere TOUT SEUL au bout du delai de grace. Le rendre
-- explicitement ne fait qu'accelerer : une tache qui finit en deux secondes
-- peut repartir au passage suivant plutot que d'attendre la fin du delai.
--
-- C'est pourquoi un echec ici n'est pas grave, et pourquoi l'appelant ne doit
-- JAMAIS faire dependre sa reponse de cet appel : la garantie ne repose pas
-- dessus. C'est exactement l'inverse d'un drapeau qu'il faudrait baisser.
create or replace function public.rendre_bail_run(p_job_name text)
returns void
  language sql
  volatile
  security definer
  set search_path to 'public'
as $fn$
  update public.cron_run_leases
     set finished_at = now()
   where job_name = p_job_name
     and finished_at is null;
$fn$;

comment on function public.rendre_bail_run(text) is
'Rend le bail d''une tache plus tot que son delai de grace.

PUREMENT FACULTATIF : le bail expire seul. Un echec de cet appel retarde le
prochain run, il ne bloque rien — un run tue ne peut pas coincer sa tache.';

revoke all on function public.rendre_bail_run(text) from public, anon, authenticated;
grant execute on function public.rendre_bail_run(text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LE SECOND ETAGE : LA RELANCE NE REND PLUS DEUX FOIS LE MEME PROFIL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Le bail empeche le TRAVAIL en double ; cette garde-ci empeche le DEGAT en
-- double. L'un sans l'autre laisse un trou : un bail ne couvre pas les chemins
-- qui ne passent pas par lui, et la selection seule laisserait deux runs
-- legitimes (cadences differentes, rattrapage manuel) tomber sur le meme
-- profil.
--
-- Meme couple qu'au lot du matching, et pour les memes raisons :
--   · UN DELAI DE GRACE adosse a `matching_relance_first_at`, une donnee DEJA
--     ECRITE par le declenchement. Rien a nettoyer.
--   · `for update skip locked` : le delai de grace ne protege pas de deux
--     appels rigoureusement simultanes. `skip locked` ferme cette fenetre — le
--     second ne bloque pas, il passe au profil suivant, ce qui est exactement
--     le comportement voulu pour une file.
--
-- ⚠️ LA FONCTION PASSE DE `stable` A `volatile`. `for update` est interdit dans
--    une fonction `stable` : elle serait rejetee a l'execution, pas a la
--    creation. Ni tsc ni le build ne le verraient.
--
-- L'ANCIENNE SIGNATURE EST SUPPRIMEE, PAS LAISSEE A COTE. `create or replace`
-- avec un parametre de plus cree une SURCHARGE : les deux versions
-- coexisteraient, l'appel nomme deviendrait ambigu, et la version sans garde
-- resterait joignable. Meme piege qu'au lot precedent.
drop function if exists public.prochaine_relance_expert(interval);

create or replace function public.prochaine_relance_expert(
  p_attente_max interval default interval '6 hours',
  p_grace       interval default interval '10 minutes'
) returns uuid
  language sql
  volatile
  security definer
  set search_path to 'public'
as $fn$
  select p.id
    from public.profiles p
   where p.matching_relance_due_at is not null
     and (
       p.matching_relance_due_at <= now()
       or coalesce(p.matching_relance_first_at, p.matching_relance_due_at) + p_attente_max <= now()
     )
     -- LE DELAI DE GRACE : un profil dont la relance vient d'etre prise en
     -- charge n'est pas re-selectionnable. Sans lui, deux runs concurrents
     -- refont le meme travail d'IA sur le meme expert.
     and coalesce(p.matching_relance_first_at, p.matching_relance_due_at) < now() - p_grace
   order by coalesce(p.matching_relance_first_at, p.matching_relance_due_at)
   limit 1
     for update skip locked;
$fn$;

comment on function public.prochaine_relance_expert(interval, interval) is
$$Prochaine relance d'expert a executer, la plus ancienne d'abord.

Deux gardes contre le chevauchement, et elles sont complementaires :
  p_grace : un profil dont la relance a demarre il y a moins de ce delai n'est
            pas rendu. Le delai s'adosse a matching_relance_first_at, une donnee
            deja ecrite par le declenchement : rien a nettoyer si un run tombe.
  for update skip locked : ferme la fenetre des appels rigoureusement
            simultanes, avant que le premier n'ait pu marquer quoi que ce soit.

VOLATILE et non STABLE : `for update` est interdit dans une fonction stable, et
le refus ne sortirait qu'a l'execution.$$;

revoke all on function public.prochaine_relance_expert(interval, interval) from public, anon, authenticated;
grant execute on function public.prochaine_relance_expert(interval, interval) to service_role;
