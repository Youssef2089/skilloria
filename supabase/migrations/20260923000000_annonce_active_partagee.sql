-- ════════════════════════════════════════════════════════════════════════════
--  UNE SEULE EXPRESSION DE « L'ANNONCE EST ENCORE ACTIVE », ET ELLE EST ICI.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : INDIFFÉRENT.
--    Cette migration ne touche AUCUNE donnée : elle ajoute une fonction pure et
--    remplace le corps de QUATRE fonctions de lecture. Le code applicatif du même
--    lot pose le filtre de son côté (lib/matching), sans dépendre de celui-ci.
--    Ni l'un ni l'autre n'a besoin de partir en premier.
--
--    ⚠️ DEUX D'ENTRE ELLES CHANGENT DE COMPORTEMENT SUR UNE CONFIGURATION
--       ABSENTE : `matching_runs_inacheves` et `matching_health` LÈVENT au lieu
--       de rendre un compte calculé sur une durée inventée. La ligne de
--       `duree_reglages` existe par construction (`ligne_unique` est la clé
--       primaire, et un `insert` de semis la pose) : ce chemin ne s'ouvre que
--       si quelqu'un la SUPPRIME, et il doit alors être bruyant.
--
-- ┌─ CE QU'ON FERME — CINQ COPIES, MESURÉES ─────────────────────────────────┐
-- │ La règle d'expiration était écrite CINQ FOIS en SQL :                     │
-- │   · matching_health              (matching_trace_et_reprise, 01/09)       │
-- │   · annonces_expirees_par_duree  (durees_reglables, 16/09)                │
-- │   · annonces_basculant_par_duree (durees_reglables, 16/09) — DEUX FOIS    │
-- │     dans la même CTE, une par durée comparée                              │
-- │   · matching_runs_inacheves      (inacheves_hors_annonces_expirees, 21/09)│
-- │ et une sixième s'apprêtait à naître dans next_unfinished_matching_run.    │
-- │                                                                           │
-- │ ⚠️ DEUX D'ENTRE ELLES PORTAIENT LA DURÉE EN DUR, ET C'EST PIRE QUE LA     │
-- │    RECOPIE. `matching_health` compare à `interval '30 days'` ; elle date  │
-- │    du 1er septembre, la durée est devenue réglable le 16, et personne     │
-- │    n'est revenu. Sa colonne s'appelle `total_actives`. Le jour où un      │
-- │    administrateur règle 20 jours depuis /admin/durees, cette fonction     │
-- │    continue de compter sur 30 : l'écran de supervision annonce un nombre  │
-- │    d'annonces actives que NI le moteur, NI le flux expert, NI             │
-- │    `matching_runs_inacheves` ne retrouvent. Rien ne casse, rien ne lève,  │
-- │    et le réglage a l'air de marcher (§E.24, §D.7).                        │
-- │    `matching_runs_inacheves` portait le sien sous un commentaire FAUX :   │
-- │    « la valeur par défaut de la colonne ». La colonne n'a pas de défaut,  │
-- │    le 30 est une valeur de SEMIS écrite une fois dans un `insert`.        │
-- │                                                                           │
-- │ Cinq copies d'une même règle sont cinq occasions de diverger, et une      │
-- │ divergence ici ne casse RIEN : elle produit simplement deux comptes que   │
-- │ personne ne sait réconcilier. C'est déjà ce que redoutaient les           │
-- │ commentaires des migrations précédentes, en toutes lettres — « une autre  │
-- │ expression ici annoncerait un nombre que l'écran ne retrouverait jamais ».│
-- │ Elles avaient raison, et elles recopiaient quand même.                    │
-- └───────────────────────────────────────────────────────────────────────────┘
--
--  LA FONCTION EST PURE, ET LE MOMENT EST UN PARAMÈTRE.
--    `p_maintenant timestamptz default now()` : le corps ne lit aucune horloge,
--    il compare deux instants. Il est donc réellement `immutable` — le
--    planificateur peut le replier — et il s'ÉPROUVE : on peut lui passer un
--    instant choisi et vérifier la règle, ce qu'un `now()` enfoui rend
--    impossible. Le défaut, lui, est évalué chez l'APPELANT, où `now()` est
--    stable comme il doit l'être.
--
--  MÊME RÈGLE QUE lib/publications/expiry.ts, ET C'EST VÉRIFIÉ PAR UN CONTRÔLE
--    active  ⇔  status = 'published'
--           ET  published_at IS NOT NULL
--           ET  coalesce(expires_at, published_at + vie) > maintenant
--    `expires_at` n'est JAMAIS écrit aujourd'hui ; le coalesce traite l'existant
--    et un éventuel override futur à l'identique.
--
--  ET « EXPIRÉE » EST LA NÉGATION D'« ACTIVE », PAS UNE SECONDE DÉFINITION.
--    annonces_expirees_par_duree compte donc `not annonce_active(…)` parmi les
--    annonces publiées. Deux expressions symétriques écrites séparément
--    finissent par ne plus être symétriques.

create or replace function public.annonce_active(
  p_status       text,
  p_expires_at   timestamptz,
  p_published_at timestamptz,
  p_vie_jours    integer,
  p_maintenant   timestamptz default now()
) returns boolean
  language sql
  immutable
  parallel safe
as $fn$
  select p_status = 'published'
     and p_published_at is not null
     and p_vie_jours is not null
     and coalesce(
           p_expires_at,
           p_published_at + make_interval(days => p_vie_jours)
         ) > p_maintenant;
$fn$;

comment on function public.annonce_active(text, timestamptz, timestamptz, integer, timestamptz) is
  'UNE annonce est-elle encore active a p_maintenant ? SEULE expression SQL de la '
  'regle ; meme regle que lib/publications/expiry.ts. Pure et immutable : le '
  'moment est un parametre, jamais une horloge lue dans le corps. La duree vient '
  'de duree_reglages, elle n''est JAMAIS ecrite ici (D.7).';

revoke all on function public.annonce_active(text, timestamptz, timestamptz, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.annonce_active(text, timestamptz, timestamptz, integer, timestamptz)
  to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LA REPRISE — elle rendait des annonces EXPIRÉES, et le moteur les payait
-- ═══════════════════════════════════════════════════════════════════════════
--
--  LE DÉFAUT, MESURÉ LE 22/09/2026 : douze lecteurs du filtre d'expiration dans
--  le produit, ZÉRO dans cette fonction. Elle choisit l'annonce que le cron va
--  rejouer, c'est-à-dire celle qu'on va PAYER au reranker — et une annonce
--  expirée ne peut plus apparaître dans le flux d'aucun expert, qui filtre à la
--  lecture. On payait pour des rapprochements que personne ne verrait.
--
--  La supervision, elle, excluait déjà les expirées depuis le 21/09
--  (matching_runs_inacheves). Les deux se contredisaient : l'écran disait « rien
--  à rejouer », et le cron rejouait. Deux fonctions voisines, deux réponses.
--
--  ⚠️ LA DURÉE N'A PLUS DE DÉFAUT, ET L'ABSENCE DE RÉGLAGE LÈVE.
--     La version précédente de matching_runs_inacheves écrivait
--     `coalesce(d.vie_annonce_jours, 30)`, en la présentant comme « la valeur
--     par défaut de la colonne ». LA COLONNE N'A PAS DE DÉFAUT : le 30 est une
--     valeur de semis, écrite une fois dans un `insert`. C'était donc une durée
--     EN DUR dans une fonction, que §D.7 interdit, sous un commentaire faux.
--     Sans ligne de réglage, ces deux fonctions LÈVENT désormais — un cron en
--     erreur se voit, un « rien à signaler » sur une configuration absente non
--     (§E.22). C'est déjà la doctrine de lib/durees.ts, mot pour mot.

create or replace function public.next_unfinished_matching_run(
  p_max_attempts integer default 5,
  p_grace interval default interval '10 minutes'
) returns uuid
  language plpgsql
  volatile
  security definer
  set search_path to 'public'
as $fn$
declare
  v_vie integer;
  v_id  uuid;
begin
  select d.vie_annonce_jours into v_vie
    from public.duree_reglages d
   where d.ligne_unique;

  if v_vie is null then
    -- Une seule chaine, sur une ligne : la concatenation de litteraux adjacents
    -- se comporte autrement selon le contexte, et un message d'erreur est le
    -- dernier endroit ou l'on veut une surprise de grammaire.
    raise exception 'duree_reglages illisible : aucune ligne de reglage des durees. La reprise ne DEVINE pas une duree de vie (D.7) : elle refuse, bruyamment.'
      using errcode = 'P0002';
  end if;

  select p.id into v_id
    from public.publications p
   where p.matching_attempted_at is not null
     and p.matching_completed_at is null
     and p.matching_attempts < p_max_attempts
     -- LE STATUT ET L'EXPIRATION, PAR LA MEME FONCTION QUE PARTOUT AILLEURS.
     -- `p.status = 'published'` est DEDANS : le sortir ici en ferait deux
     -- conditions a tenir accordees a la main.
     and public.annonce_active(p.status, p.expires_at, p.published_at, v_vie)
     -- LE DELAI DE GRACE : une annonce dont le run vient de demarrer n'est pas
     -- re-selectionnable. Sans lui, deux crons se marchent dessus par
     -- construction.
     and p.matching_attempted_at < now() - p_grace
   order by p.matching_attempted_at
   limit 1
     for update skip locked;

  return v_id;
end;
$fn$;

comment on function public.next_unfinished_matching_run(integer, interval) is
$$Prochaine annonce ACTIVE a rejouer, la plus ancienne d'abord.

Deux gardes contre le chevauchement, et elles sont complementaires :
  p_grace          : une annonce dont le run a demarre il y a moins de ce delai
                     n'est pas rendue. Le delai s'appuie sur matching_attempted_at,
                     une donnee deja ecrite : rien a nettoyer si un run tombe.
  for update skip locked : ferme la fenetre des appels rigoureusement simultanes,
                     avant que le premier n'ait ecrit son horodatage.

UNE ANNONCE EXPIREE N'EST PLUS RENDUE (22/09/2026). Elle ne peut apparaitre dans
le flux d'aucun expert, qui filtre a la lecture : la rejouer payait le reranker
pour des rapprochements que personne ne verrait. L'expression de l'activite est
annonce_active(), la SEULE du schema.

Au-dela de p_max_attempts, le run reste inacheve et donc VISIBLE
(cf. matching_runs_inacheves) : un trou qui reste ouvert vaut mieux qu'un trou
referme sur une erreur.$$;

revoke all on function public.next_unfinished_matching_run(integer, interval) from public, anon, authenticated;
grant execute on function public.next_unfinished_matching_run(integer, interval) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LA SUPERVISION — même règle, par la même fonction
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.matching_runs_inacheves(
  p_max_attempts integer default 5
) returns table (
  etat        text,
  publications bigint,
  plus_ancien timestamptz
)
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $fn$
declare
  v_vie integer;
begin
  select d.vie_annonce_jours into v_vie
    from public.duree_reglages d
   where d.ligne_unique;

  if v_vie is null then
    raise exception 'duree_reglages illisible : aucune ligne de reglage des durees. La supervision REFUSE plutot que de rendre un "rien a signaler" calcule sur une duree inventee (E.22).'
      using errcode = 'P0002';
  end if;

  return query
    select q.etat, count(*) as publications, min(q.depuis) as plus_ancien
      from (
        select case
                 when p.matching_attempted_at is null then 'jamais_tente'
                 when p.matching_attempts >= p_max_attempts then 'abandonne'
                 else 'en_cours'
               end as etat,
               coalesce(p.matching_attempted_at, p.published_at) as depuis
          from public.publications p
         where p.matching_completed_at is null
           -- ⚠️ UNE ANNONCE EXPIREE SORT D'ICI. Elle ne peut plus etre notee :
           --    la reclamer serait reclamer une action qui n'existe pas.
           --    MEME FONCTION que la reprise : les deux ne peuvent plus se
           --    contredire, ce qui etait le cas depuis le 21/09.
           and public.annonce_active(p.status, p.expires_at, p.published_at, v_vie)
      ) q
     group by q.etat
     order by count(*) desc;
end;
$fn$;

revoke all on function public.matching_runs_inacheves(integer) from public, anon, authenticated;
grant execute on function public.matching_runs_inacheves(integer) to service_role;

comment on function public.matching_runs_inacheves(integer) is
  'Mises en relation inachevees sur les annonces ENCORE ACTIVES. Une annonce '
  'expiree en sort : elle ne peut plus etre notee, et un signal bloquant '
  'qu''aucune action ne peut eteindre apprend a etre ignore. L''activite est '
  'decidee par annonce_active(), la SEULE expression du schema, et la duree est '
  'lue dans duree_reglages — plus aucun nombre en dur ici. Sans ligne de reglage, '
  'la fonction LEVE au lieu de rendre un « rien a signaler ».';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LA SIMULATION DE DURÉE — la négation, pas une seconde définition
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Celle-ci garde son PARAMÈTRE : elle répond « combien d'annonces seraient
--  expirées SI la vie valait p_jours ». C'est une simulation, la durée ne vient
--  donc pas du réglage — et c'est la seule des trois dans ce cas.

create or replace function public.annonces_expirees_par_duree(p_jours integer)
  returns table (
    annonces_expirees          integer,
    dont_candidatures_devoilees integer
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  with expirees as (
    select p.id
      from public.publications p
     where p.status = 'published'
       and p.published_at is not null
       -- « EXPIREE » EST LA NEGATION D'« ACTIVE ». Ecrire la seconde regle a la
       -- main, meme juste, rouvrirait la porte que cette migration ferme.
       and not public.annonce_active(p.status, p.expires_at, p.published_at, p_jours)
  )
  select
    (select count(*) from expirees)::integer,
    (select count(distinct c.publication_id)
       from public.candidatures c
      where c.publication_id in (select id from expirees)
        and c.unlocked_at is not null)::integer;
$fn$;

revoke all on function public.annonces_expirees_par_duree(integer) from public, anon, authenticated;
grant execute on function public.annonces_expirees_par_duree(integer) to service_role;

comment on function public.annonces_expirees_par_duree(integer) is
  'Combien d''annonces publiees seraient EXPIREES si la vie d''une annonce valait '
  'p_jours, et combien d''entre elles portent une candidature deverrouillee (payee). '
  'Expiree = NON active au sens de annonce_active(), jamais une seconde expression. '
  'Compte et rend ; ne bloque RIEN.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LA BASCULE DE DUREE — deux durees comparees, une seule regle
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Elle ecrivait la regle DEUX FOIS dans la meme CTE, une par duree. Avec
--  `annonce_active`, la question redevient ce qu'elle est : « active a
--  l'ancienne duree, et plus active a la nouvelle ». Les deux garde-fous
--  `status = 'published'` et `published_at is not null` disparaissent de la
--  clause : ils sont DANS la fonction, et les tenir accordes a la main etait
--  exactement le risque.

create or replace function public.annonces_basculant_par_duree(
  p_actuel  integer,
  p_nouveau integer
)
  returns table (
    basculent       integer,
    dont_devoilees  integer
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  with qui_basculent as (
    -- VISIBLES aujourd'hui, expirees demain. Les deja-expirees ne basculent
    -- pas : elles ont deja bascule, et les recompter ferait paniquer pour rien.
    select p.id
      from public.publications p
     where public.annonce_active(p.status, p.expires_at, p.published_at, p_actuel)
       and not public.annonce_active(p.status, p.expires_at, p.published_at, p_nouveau)
  )
  select
    (select count(*) from qui_basculent)::integer,
    (select count(distinct c.publication_id)
       from public.candidatures c
      where c.publication_id in (select id from qui_basculent)
        and c.unlocked_at is not null)::integer;
$fn$;

revoke all on function public.annonces_basculant_par_duree(integer, integer) from public, anon, authenticated;
grant execute on function public.annonces_basculant_par_duree(integer, integer) to service_role;

comment on function public.annonces_basculant_par_duree(integer, integer) is
  'Combien d''annonces VISIBLES aujourd''hui (a p_actuel jours) deviendraient EXPIREES '
  'a p_nouveau jours, et combien d''entre elles portent une candidature deverrouillee. '
  'C''est la phrase de l''ecran. Une SEULE expression de l''activite — annonce_active() — '
  'evaluee a deux durees. Compte et rend ; ne bloque RIEN.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. LA SANTE DU MOTEUR — elle comptait sur 30 JOURS EN DUR
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ⚠️ LE DEFAUT LE PLUS COUTEUX DES CINQ, ET LE PLUS DISCRET.
--     `total_actives` etait calcule sur `interval '30 days'`, ecrit le
--     01/09/2026 — quinze jours AVANT que la duree devienne reglable. Regler
--     20 jours depuis /admin/durees faisait donc diverger cette fonction de
--     tout le reste du produit, sans erreur, sans alerte, et sans qu'aucun
--     ecran ne puisse le montrer : c'est CETTE fonction qui alimente l'ecran.
--
--     Elle passe en plpgsql pour lire le reglage, et LEVE s'il manque — meme
--     doctrine que les deux precedentes, et que lib/durees.ts : on ne devine
--     pas une duree, on refuse bruyamment.

create or replace function public.matching_health()
  returns table (
    jamais_tentee           bigint,
    tentee_mais_inachevee   bigint,
    achevee_avec_zero_match bigint,
    achevee_avec_matches    bigint,
    total_actives           bigint
  )
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $fn$
declare
  v_vie integer;
begin
  select d.vie_annonce_jours into v_vie
    from public.duree_reglages d
   where d.ligne_unique;

  if v_vie is null then
    raise exception 'duree_reglages illisible : aucune ligne de reglage des durees. La sante du moteur REFUSE de compter des annonces actives sur une duree inventee (E.24).'
      using errcode = 'P0002';
  end if;

  return query
    select
      count(*) filter (where p.matching_attempted_at is null),
      count(*) filter (where p.matching_attempted_at is not null
                         and p.matching_completed_at is null),
      count(*) filter (where p.matching_completed_at is not null
                         and coalesce((p.matching_stats->>'matches_created')::int, 0) = 0),
      count(*) filter (where p.matching_completed_at is not null
                         and coalesce((p.matching_stats->>'matches_created')::int, 0) > 0),
      count(*)
    from public.publications p
    -- LA MEME FONCTION QUE PARTOUT. Le statut est dedans.
    where public.annonce_active(p.status, p.expires_at, p.published_at, v_vie);
end;
$fn$;

revoke all on function public.matching_health() from public, anon, authenticated;
grant execute on function public.matching_health() to service_role;

comment on function public.matching_health() is
  'Etat des mises en relation sur les annonces ACTIVES. La duree de vie est LUE '
  'dans duree_reglages depuis le 23/09/2026 — elle valait 30 jours EN DUR depuis '
  'le 01/09, soit quinze jours avant que la duree devienne reglable : regler une '
  'autre valeur faisait diverger cet ecran de tout le reste du produit, en '
  'silence. L''activite est decidee par annonce_active(), la SEULE expression du '
  'schema. Sans ligne de reglage, la fonction LEVE.';
