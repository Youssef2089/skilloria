-- ════════════════════════════════════════════════════════════════════════════
--  UNE RELANCE DONT LE RUN A ÉCHOUÉ NE SE SOLDE PLUS. ELLE SE REJOUE, BORNÉE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement.
--    Trois colonnes avec un défaut, deux fonctions neuves, deux corps
--    remplacés. Le code EN LIGNE continue de fonctionner : il appelle
--    `prochaine_relance_expert(p_attente_max)`, et la nouvelle signature porte
--    des défauts sur les deux autres paramètres — l'appel résout.
--
--    ⚠️ DEUX SUPPRESSIONS, ET ELLES SONT NÉCESSAIRES, PAS COSMÉTIQUES.
--       ① l'ancienne signature à DEUX arguments de `prochaine_relance_expert` :
--          `create or replace` ne remplace pas une fonction dont la liste
--          d'arguments change, les deux coexisteraient, et l'appel existant
--          résoudrait vers l'ANCIENNE — celle SANS plafond de tentatives. Le
--          correctif serait en place, inerte, et rien ne le dirait (§E.1).
--       ② `matching_relance_health()`, parce qu'un `returns table` EST un type
--          de retour et qu'on lui ajoute deux colonnes. Ses cinq colonnes
--          d'origine sont toutes conservées.
--
-- ┌─ LE DÉFAUT, MESURÉ LE 22/09/2026 — TROIS APPELANTS ──────────────────────┐
-- │ `cron/expert-relance`, `me/sync-matching` et `admin/approve-expert`       │
-- │ appelaient `solderRelance()`                                              │
-- │ APRÈS le run, **quel que soit le verdict**. Un run en échec — moteur      │
-- │ éteint, clé absente, plafond de dépense atteint, réglages illisibles —    │
-- │ effaçait donc l'échéance exactement comme un run réussi.                  │
-- │                                                                           │
-- │ LE JALON EST POSÉ, PLUS RIEN NE REPREND (§E.27 forme B). La modification  │
-- │ de profil qui avait déclenché la relance n'est JAMAIS notée. L'expert ne  │
-- │ le sait pas, nous non plus : aucune trace, aucun compteur, aucun signal.  │
-- │                                                                           │
-- │ LE TROISIÈME EST LE PIRE, ET IL A ÉTÉ TROUVÉ PAR LE CONTRÔLE DE CE LOT.  │
-- │ À l'APPROBATION, son propre commentaire dit pourquoi : « c'est le moment  │
-- │ qui compte pour l'expert […] son premier contact avec la plateforme ».    │
-- │ Un moteur éteint à cette seconde-là effaçait l'échéance, et cet écran     │
-- │ restait vide — pour toujours.                                             │
-- │                                                                           │
-- │ ET LE CÔTÉ ANNONCE FAISAIT L'INVERSE, DEPUIS LE DÉBUT. `acheverRun(…,     │
-- │ acheve)` laisse `matching_completed_at` à NULL quand le run a échoué ; le │
-- │ run reste donc rejouable, borné par `matching_attempts < 5`, et VISIBLE   │
-- │ dans la supervision au-delà. Deux comportements pour un même fait — et    │
-- │ c'est celui qui PERD qui était du côté de l'expert.                       │
-- └───────────────────────────────────────────────────────────────────────────┘
--
--  CE QUE CETTE MIGRATION POSE, ET C'EST LE SYMÉTRIQUE EXACT DE L'ANNONCE
--    · un COMPTEUR DE TENTATIVES — sans lui, « ne pas solder » est une boucle
--      infinie : le cron reprendrait le même expert toutes les cinq minutes,
--      et paierait le reranker à chaque fois. Le plafond existe déjà côté
--      annonce ; on le reprend, on n'en invente pas un second.
--    · l'ÉCHEC DATÉ ET NOMMÉ — `matching_relance_echec_at` / `_code`. C'est ce
--      que l'expert doit pouvoir lire : un run échoué ne se dit pas « aucune
--      mission pour l'instant ».
--    · l'ABANDON RESTE VISIBLE — au-delà du plafond, l'échéance n'est PAS
--      effacée : la relance sort de la file, et la supervision la compte. Un
--      trou qui reste ouvert vaut mieux qu'un trou refermé sur une erreur,
--      exactement comme pour les annonces.

alter table public.profiles
  -- Remis à zéro par `solder_relance_expert` : un run qui aboutit efface
  -- l'histoire de ses échecs, sinon le plafond finirait par se fermer sur un
  -- expert dont tout va bien.
  add column if not exists matching_relance_tentatives integer not null default 0,
  add column if not exists matching_relance_echec_at   timestamptz,
  add column if not exists matching_relance_echec_code text;

comment on column public.profiles.matching_relance_tentatives is
  'Tentatives de relance depuis le dernier run ABOUTI. Symetrique de '
  'publications.matching_attempts. Remis a zero par solder_relance_expert.';
comment on column public.profiles.matching_relance_echec_at is
  'Instant du dernier run de relance EN ECHEC, null si le dernier a abouti. '
  'C''est ce que l''ecran de l''expert lit pour ne pas ecrire « aucune mission » '
  'sur une recherche qui n''a pas eu lieu.';
comment on column public.profiles.matching_relance_echec_code is
  'Motif NOMME du dernier echec (moteur_indisponible, plafond_atteint, '
  'reglages_absents, lecture_en_panne). Jamais une phrase : une phrase se '
  'traduit a l''affichage, un code se compare.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. MARQUER LA TENTATIVE — avant le run, comme cote annonce
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Elle est posee AVANT le run, et jamais apres : un processus tue en plein
--  run laisserait sinon un compteur qui n'a pas bouge, et la meme relance
--  repartirait indefiniment sans jamais approcher son plafond. C'est le meme
--  raisonnement que `marquerTentative` cote annonce.

create or replace function public.marquer_tentative_relance(
  p_profile_id uuid
) returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  update public.profiles
     set matching_relance_tentatives = matching_relance_tentatives + 1
   where id = p_profile_id
  returning matching_relance_tentatives into v_n;
  return v_n;
end
$fn$;

revoke all on function public.marquer_tentative_relance(uuid) from public, anon, authenticated;
grant execute on function public.marquer_tentative_relance(uuid) to service_role;

comment on function public.marquer_tentative_relance(uuid) is
  'Compte une tentative de relance, AVANT le run. Sans ce compteur, ne pas '
  'solder un run en echec serait une boucle infinie : le cron reprendrait le '
  'meme expert a chaque passage. Symetrique de publications.matching_attempts.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. ECHOUER — l'echeance RESTE, l'echec est DATE et NOMME
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.echouer_relance_expert(
  p_profile_id uuid,
  p_code       text
) returns void
  language sql
  security definer
  set search_path to 'public'
as $fn$
  -- `matching_relance_due_at` n'est PAS touche : c'est tout le sujet. La
  -- relance reste due, donc rejouable, jusqu'au plafond de tentatives.
  -- `matching_last_run_at` non plus : un run qui a echoue n'est pas un run.
  update public.profiles
     set matching_relance_echec_at   = now(),
         matching_relance_echec_code = p_code
   where id = p_profile_id;
$fn$;

revoke all on function public.echouer_relance_expert(uuid, text) from public, anon, authenticated;
grant execute on function public.echouer_relance_expert(uuid, text) to service_role;

comment on function public.echouer_relance_expert(uuid, text) is
  'Enregistre qu''un run de relance a ECHOUE, sans solder l''echeance. La '
  'relance reste due et sera rejouee, bornee par le plafond de tentatives. '
  'Le code est NOMME pour que l''ecran de l''expert puisse dire ce qui s''est '
  'passe au lieu d''ecrire « aucune mission ».';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SOLDER — il efface aussi l'histoire des echecs
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Un run qui ABOUTIT remet le compteur a zero et efface le dernier echec.
--  Sans cela, un expert ayant connu quatre pannes successives en juin verrait
--  son plafond se fermer en septembre sur un cinquieme echec sans rapport —
--  et son ecran porterait un motif d'echec vieux de trois mois.

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
begin
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
    -- Un declenchement est arrive pendant le run : on garde l'attente, mais on
    -- enregistre quand meme que le moteur a tourne — ET qu'il a abouti, donc
    -- on efface l'echec et le compteur. Le run a reussi ; ce qui reste du est
    -- la modification arrivee ENSUITE, qui merite ses propres tentatives.
    update public.profiles
       set matching_last_run_at        = now(),
           matching_relance_tentatives = 0,
           matching_relance_echec_at   = null,
           matching_relance_echec_code = null
     where id = p_profile_id;
  end if;

  return v_soldee;
end
$fn$;

revoke all on function public.solder_relance_expert(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.solder_relance_expert(uuid, timestamptz) to service_role;

comment on function public.solder_relance_expert(uuid, timestamptz) is
  'Solde une relance APRES un run qui a ABOUTI — jamais apres un echec (c''est '
  'echouer_relance_expert qui s''en charge). Remet a zero le compteur de '
  'tentatives et efface le dernier echec : un expert qui a connu quatre pannes '
  'en juin ne doit pas voir son plafond se fermer en septembre.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LA FILE — elle saute les relances ABANDONNEES
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Au-dela du plafond, l'echeance n'est PAS effacee : la relance sort de la
--  file mais reste VISIBLE (cf. matching_relance_health). Un trou qui reste
--  ouvert vaut mieux qu'un trou referme sur une erreur — meme phrase que pour
--  les annonces, meme raison.

-- ⚠️ L'ANCIENNE SIGNATURE A DEUX ARGUMENTS EST SUPPRIMEE, ET CE N'EST PAS UN
--    DETAIL. `create or replace` ne remplace PAS une fonction dont la liste
--    d'arguments change : les deux coexisteraient, et un appel a deux
--    arguments resoudrait vers l'ANCIENNE — celle sans plafond de tentatives.
--    Le correctif serait en place, inerte, et rien ne le dirait (§E.1 : la
--    resolution se fait au runtime, aucun compilateur ne la voit).
drop function if exists public.prochaine_relance_expert(interval, interval);

create function public.prochaine_relance_expert(
  p_attente_max   interval default interval '6 hours',
  p_grace         interval default interval '10 minutes',
  p_max_tentatives integer default 5
) returns uuid
  language sql
  volatile
  security definer
  set search_path to 'public'
as $fn$
  select p.id
    from public.profiles p
   where p.matching_relance_due_at is not null
     -- LE PLAFOND DE TENTATIVES. Sans lui, « ne pas solder un run en echec »
     -- serait une boucle infinie, payante a chaque passage.
     and p.matching_relance_tentatives < p_max_tentatives
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

comment on function public.prochaine_relance_expert(interval, interval, integer) is
$$Prochaine relance d'expert a executer, la plus ancienne d'abord.

Trois gardes, et elles sont complementaires :
  p_max_tentatives : au-dela, la relance sort de la file. L'echeance RESTE,
            donc la supervision la voit (matching_relance_health.abandonnees).
            Sans ce plafond, ne pas solder un run en echec serait une boucle
            infinie, payante a chaque passage.
  p_grace : un profil dont la relance a demarre il y a moins de ce delai n'est
            pas rendu. Le delai s'adosse a matching_relance_first_at, une donnee
            deja ecrite par le declenchement : rien a nettoyer si un run tombe.
  for update skip locked : ferme la fenetre des appels rigoureusement
            simultanes, avant que le premier n'ait pu marquer quoi que ce soit.

VOLATILE et non STABLE : `for update` est interdit dans une fonction stable, et
le refus ne sortirait qu'a l'execution.$$;

revoke all on function public.prochaine_relance_expert(interval, interval, integer) from public, anon, authenticated;
grant execute on function public.prochaine_relance_expert(interval, interval, integer) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. LA SUPERVISION — les relances ABANDONNEES se comptent
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️ `CREATE OR REPLACE` NE PEUT PAS CHANGER UN TYPE DE RETOUR, ET UN
--    `returns table` EST UN TYPE DE RETOUR. Ajouter deux colonnes ferait
--    echouer la migration avec « cannot change return type of existing
--    function » — au milieu du fichier, donc apres les colonnes et avant le
--    reste. On supprime donc d'abord, explicitement.
--
--    ET LES CINQ COLONNES EXISTANTES SONT TOUTES CONSERVEES. `attente_max_minutes`
--    et `jamais_notes` — « un profil visible, approuve, jamais passe par le
--    moteur : un expert qui n'existe pour personne » — ne sont pas remplacees
--    par les nouvelles : retirer une mesure que personne n'a demande a retirer
--    est exactement la faute que §D.11 nomme, a l'envers.
drop function if exists public.matching_relance_health();

create function public.matching_relance_health()
  returns table (
    en_attente          bigint,
    dues_maintenant     bigint,
    reports_max         integer,
    attente_max_minutes numeric,
    jamais_notes        bigint,
    en_echec            bigint,
    abandonnees         bigint
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select
    count(*) filter (where matching_relance_due_at is not null),
    count(*) filter (where matching_relance_due_at <= now()),
    coalesce(max(matching_relance_reported), 0),
    round(max(
      extract(epoch from (now() - coalesce(matching_relance_first_at, now()))) / 60
    )::numeric, 1),
    -- Un profil visible, approuve, jamais passe par le moteur : c'est un expert
    -- qui n'existe pour personne. Le compter ici le rend visible.
    count(*) filter (
      where matching_last_run_at is null
        and visible = true
        and verification_status = 'approved'
    ),
    -- Le dernier run a ECHOUE et l'echeance est toujours la : elle sera rejouee.
    count(*) filter (where matching_relance_echec_at is not null
                       and matching_relance_due_at is not null),
    -- Au-dela du plafond : plus rien ne la reprendra. C'est le signal qui
    -- appelle une action humaine, et il ne s'eteint pas tout seul.
    count(*) filter (where matching_relance_due_at is not null
                       and matching_relance_tentatives >= 5)
  from public.profiles;
$fn$;

revoke all on function public.matching_relance_health() from public, anon, authenticated;
grant execute on function public.matching_relance_health() to service_role;

comment on function public.matching_relance_health() is
  'Sante des relances d''expert. en_echec : le dernier run a echoue et '
  'l''echeance tient — elle sera rejouee. abandonnees : le plafond de '
  'tentatives est atteint, plus rien ne la reprendra, une action humaine est '
  'requise. Les deux sont distinctes a dessein : un retard n''est pas un '
  'abandon. Les cinq colonnes d''origine sont conservees a l''identique.';
