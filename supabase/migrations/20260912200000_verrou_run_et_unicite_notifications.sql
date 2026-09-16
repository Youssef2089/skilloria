-- DEUX RUNS CONCURRENTS, ET LA MEME NOTIFICATION DEUX FOIS
--
-- ═══ LE DEFAUT, ET IL EST ARITHMETIQUE ════════════════════════════════════
--   Le cron de rattrapage tourne toutes les 5 minutes ; un rejeu dispose de
--   300 s (maxDuration de la route). Le chevauchement n'est donc pas
--   hypothetique : au troisieme passage, deux runs peuvent traiter la MEME
--   annonce.
--
--   `next_unfinished_matching_run` ne posait ni verrou ni delai : une annonce
--   en cours de traitement etait immediatement re-selectionnable. Les deux runs
--   repaient alors les lots non encore memorises, et surtout l'expert recoit
--   DEUX FOIS la meme notification.
--
--   L'idempotence des notifications est un LIRE-PUIS-ECRIRE
--   (lib/matching/shared.ts) : entre la lecture de l'existant et l'insertion,
--   l'autre run peut inserer. Aucune qualite de code ne rattrape cela — seule
--   la base peut refuser le doublon.
--
-- ═══ DEUX CORRECTIONS, ET IL FAUT LES DEUX ════════════════════════════════
--   Le verrou empeche le travail en double. La contrainte empeche le DEGAT en
--   double. L'un sans l'autre laisse un trou : un verrou ne couvre pas les
--   chemins qui ne passent pas par lui, et une contrainte seule laisserait deux
--   runs payer deux fois la notation.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LE VERROU DE RUN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI PAS UN pg_try_advisory_xact_lock SEUL, comme ailleurs dans ce depot
--   (cf. cron_manual_run) : ce verrou-la meurt avec la TRANSACTION. Or le run
--   ne se deroule pas dans la transaction — il se deroule dans une requete HTTP
--   qui dure jusqu'a 300 s, longtemps apres que la fonction de selection a
--   rendu la main. Un verrou transactionnel ne couvrirait donc rien.
--
-- CE QU'ON POSE, ET POURQUOI LES DEUX ENSEMBLE :
--   • UN DELAI DE GRACE, porte par une donnee DEJA ECRITE
--     (`matching_attempted_at`, pose par le run au demarrage). Il survit a la
--     fin de la transaction, exactement ce qu'il faut ici, et n'a RIEN A
--     NETTOYER : aucun drapeau ne peut rester bloque si un processus tombe.
--     Dix minutes : le double de la duree maximale d'un rejeu (300 s), donc une
--     annonce redevient rejouable des que son run precedent ne peut plus etre
--     vivant. Plus court laisserait le chevauchement ; plus long retarderait le
--     rattrapage sans rien gagner.
--   • `for update skip locked` sur la ligne selectionnee : le delai de grace ne
--     protege pas de deux appels rigoureusement simultanes, avant que l'un des
--     deux n'ait ecrit son horodatage. `skip locked` ferme cette fenetre-la :
--     le second appel ne bloque pas, il passe a l'annonce suivante — ce qui est
--     exactement le comportement voulu pour une file.
-- L'ANCIENNE SIGNATURE EST SUPPRIMEE, PAS LAISSEE A COTE. `create or replace`
-- avec un parametre de plus cree une SURCHARGE : les deux versions
-- coexisteraient, l'appel nomme deviendrait ambigu, et la version sans garde
-- resterait joignable. Une fonction qu'on croit remplacee et qui survit est
-- exactement le genre de defaut qu'on ne trouve qu'en production.
drop function if exists public.next_unfinished_matching_run(integer);

create or replace function public.next_unfinished_matching_run(
  p_max_attempts integer default 5,
  p_grace interval default interval '10 minutes'
) returns uuid
  language sql
  volatile
  security definer
  set search_path to 'public'
as $fn$
  select p.id
    from public.publications p
   where p.matching_attempted_at is not null
     and p.matching_completed_at is null
     and p.matching_attempts < p_max_attempts
     and p.status = 'published'
     -- LE DELAI DE GRACE : une annonce dont le run vient de demarrer n'est pas
     -- re-selectionnable. Sans lui, deux crons se marchent dessus par
     -- construction.
     and p.matching_attempted_at < now() - p_grace
   order by p.matching_attempted_at
   limit 1
     for update skip locked;
$fn$;

comment on function public.next_unfinished_matching_run(integer, interval) is
$$Prochaine annonce a rejouer, la plus ancienne d'abord.

Deux gardes contre le chevauchement, et elles sont complementaires :
  p_grace          : une annonce dont le run a demarre il y a moins de ce delai
                     n'est pas rendue. Le delai s'appuie sur matching_attempted_at,
                     une donnee deja ecrite : rien a nettoyer si un run tombe.
  for update skip locked : ferme la fenetre des appels rigoureusement simultanes,
                     avant que le premier n'ait ecrit son horodatage.

Au-dela de p_max_attempts, le run reste inacheve et donc VISIBLE
(cf. matching_runs_inacheves) : un trou qui reste ouvert vaut mieux qu'un trou
referme sur une erreur.$$;

revoke all on function public.next_unfinished_matching_run(integer, interval) from public, anon, authenticated;
grant execute on function public.next_unfinished_matching_run(integer, interval) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. L'UNICITE, EN BASE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ETAT DES DONNEES VERIFIE AVANT D'ECRIRE CETTE MIGRATION (staging, lecture
-- seule) : 46 notifications, 42 cles distinctes (user_id, type, entity_id).
-- UN SEUL doublon, et il est LEGITIME : `verification_result` x5 pour un meme
-- compte, a des semaines d'ecart, avec entity_id NULL — un profil peut etre
-- reverifie plusieurs fois. AUCUN doublon parmi les notifications de matching.
-- L'index ci-dessous s'applique donc sans conflit.
--
-- ═══ POURQUOI UN INDEX PARTIEL, ET PAS UNE CONTRAINTE LARGE ═══════════════
--   Une unicite sur (user_id, type, entity_id) pour TOUS les types CASSERAIT
--   les notifications de message : `new_message` porte l'identifiant de la
--   CONVERSATION, pas du message. Deux messages dans le meme fil produisent
--   donc legitimement deux lignes de meme cle, et la deuxieme serait refusee —
--   l'utilisateur cesserait d'etre prevenu a partir du second message.
--
--   La regle qu'on grave est donc EXACTEMENT celle que le code pretend deja
--   tenir, et rien de plus : une paire (destinataire, annonce) n'est notifiee
--   qu'UNE FOIS pour une opportunite de mise en relation. C'est le contrat
--   d'idempotence de lib/matching/shared.ts, desormais impose par la base au
--   lieu d'etre espere d'un lire-puis-ecrire.
--
--   `entity_id is not null` est redondant pour ce type (il porte toujours une
--   annonce) mais explicite : en SQL, NULL n'est jamais egal a NULL, donc des
--   lignes a entity_id nul ne seraient de toute facon pas contraintes. On le
--   dit plutot que de laisser croire a une garantie qui n'existerait pas.
create unique index if not exists notifications_match_unique_idx
  on public.notifications (user_id, entity_id)
  where type = 'new_match_opportunity' and entity_id is not null;

comment on index public.notifications_match_unique_idx is
$$Une paire (destinataire, annonce) n'est notifiee qu'UNE FOIS pour une
opportunite de mise en relation.

Restreint a ce type A DESSEIN : `new_message` porte l'identifiant de la
CONVERSATION, donc deux messages d'un meme fil produisent legitimement deux
lignes de meme cle. Une unicite large couperait les notifications de message a
partir de la deuxieme.

Complete — et ne remplace pas — le lire-puis-ecrire de lib/matching/shared.ts :
sous concurrence, seul un index peut refuser le doublon.$$;
