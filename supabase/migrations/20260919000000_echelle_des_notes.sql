-- ─────────────────────────────────────────────────────────────────────────────
-- UNE SEULE ECHELLE DANS TOUT LE PRODUIT : 0 A 10.
--
-- ORDRE DE PASSAGE : **AVANT** LE DEPLOIEMENT DU CODE, ET LE CODE SUIT DANS LA
-- FOULEE. Lisez le paragraphe « LA FENETRE » ci-dessous avant d'appliquer.
--
-- ═══ LE DEFAUT QU'ON FERME ═══════════════════════════════════════════════════
--
--   Les filtres de pertinence vivaient en 0-1, les notes de jugement en 0-10, et
--   RIEN ne le disait a l'ecran. « 1 » signifiait PARFAIT d'un cote et MEDIOCRE
--   de l'autre, sur la meme page. Le proprietaire du produit a ouvert
--   /admin/matching et n'a pas su quoi faire : c'est le seul verdict qui compte.
--
--   Trois worktrees ont pose trente-cinq reglages sur plusieurs semaines. Aucun
--   vocabulaire n'etait impose, aucune echelle non plus. Ce n'est pas un defaut
--   de code : c'est ce que produit l'absence de convention quand plusieurs mains
--   ecrivent en parallele.
--
-- ═══ LA CONCEPTION RETENUE : NORMALISER UNE FOIS, A LA FRONTIERE ═════════════
--
--   Le reranker produit du 0-1 par nature. ON NE CHANGE PAS CE QU'IL PRODUIT :
--   sa sortie est multipliee par 10 au SEUL point ou un score entre dans le
--   systeme (`lib/matching/rerank.ts`, la ou le fournisseur repond). A partir de
--   la, tout est en 0-10 — la colonne, les reglages, la comparaison, la trace,
--   l'ecran.
--
--   LES DEUX AUTRES CONCEPTIONS ONT ETE ECARTEES, ET IL FAUT SAVOIR POURQUOI :
--     · convertir A L'AFFICHAGE laisse DEUX representations (base en 0-1, ecran
--       en 0-10). La route porterait 0.7 et l'ecran 7 : c'est exactement la
--       confusion qu'on retire ;
--     · convertir AU MOMENT DE COMPARER met la conversion sur QUATRE sites
--       (index.ts x2, run-for-expert.ts x2). En oublier un transforme
--       `score < 0.7` en `score < 7` : tout passe, ou rien ne passe, EN SILENCE.
--
--   Une conversion d'unite se pose la ou l'on franchit la frontiere avec un
--   systeme externe. Nulle part ailleurs.
--
-- ═══ LA FENETRE — CE QUI SE PASSE ENTRE CETTE MIGRATION ET LE DEPLOIEMENT ════
--
--   Pendant cette fenetre, l'ANCIEN code lit des valeurs converties. Son propre
--   garde-fou le sauve, et c'est verifiable dans `lib/matching/settings.ts` :
--
--       if (feed < 0 || feed > 1 || notify < 0 || notify > 1) → 'illisible'
--
--   Un reglage hors [0,1] fait donc REFUSER le moteur, qui rend `no_config`
--   AVANT `marquerTentative` : `matching_completed_at` reste nul, et l'annonce
--   est reprise par la tache de rattrapage une fois le code deploye. C'est
--   fail-closed et rattrapable — la bonne facon d'echouer.
--
--   ⚠️ SAUF DANS UN CAS, ET CETTE MIGRATION REFUSE DE S'APPLIQUER DANS CE CAS.
--   Si `notify_threshold <= 0.1`, sa conversion reste dans [0,1] : l'ancien code
--   l'accepte et filtre alors DIX FOIS TROP LARGE, en silence, sur toute annonce
--   publiee pendant la fenetre. Le bloc de garde ci-dessous LEVE plutot que de
--   laisser passer ce cas. On ne remplace pas un defaut visible par un defaut
--   muet.
--
-- ═══ CE QUI N'EST PAS REECRIT, ET POURQUOI ══════════════════════════════════
--
--   `publications.matching_stats` garde son historique EN 0-1. Les runs anciens
--   ont ecrit `score_p50: 0.42` ; les nouveaux ecriront `4.2`. Moyenner les deux
--   melangerait deux echelles pendant un mois — un nombre juste sous une
--   etiquette fausse.
--   ON NE REECRIT PAS L'HISTORIQUE, ON LE DATE : les nouveaux runs estampillent
--   `echelle: 10`, et `matching_threshold_health()` ne lit QUE les runs
--   estampilles. La distribution repart au deploiement, et l'ecran le DIT comme
--   un etat. Maquiller une trace serait pire que la perdre.
--
-- Rejouable de bout en bout. Aucune donnee metier detruite — sauf le brouillon
-- de notes, dit plus bas.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LA CONVERSION — EN UN SEUL BLOC, ET SON IDEMPOTENCE NE REPOSE PAS SUR
--    LES VALEURS
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ⚠️ LE PIEGE QUE CE BLOC EVITE, ET JE SUIS TOMBE DEDANS EN L ECRIVANT.
--     Ma premiere version gardait la conversion par `where relevance_score <= 1`
--     — « ne convertis que ce qui est encore en 0-1 ». C'est FAUX : une note de
--     0.1 devient 1.0, et un rejeu la verrait `<= 1` et la multiplierait UNE
--     SECONDE FOIS, jusqu'a 10. Une garde batie sur les VALEURS ne peut pas
--     distinguer un avant d'un apres quand les deux domaines se chevauchent.
--
--     La garde porte donc sur un FAIT DE SCHEMA — l'existence de la contrainte
--     cible — et la conversion entiere tient dans UN bloc conditionne. Rejouer
--     la migration ne fait alors rien du tout, ce qui est la definition.
do $$
declare
  v_deja     boolean;
  v_muets    integer;
  v_matches  integer;
  v_reglages integer;
  v_hors     integer;
begin
  select exists (
    select 1 from pg_constraint
     where conname = 'matching_settings_filtre_flux_check'
  ) into v_deja;

  if v_deja then
    raise notice 'ECHELLE — deja appliquee. Aucune conversion rejouee.';
    return;
  end if;

  -- ── LA GARDE DE FENETRE ────────────────────────────────────────────────
  --  Cf. « LA FENETRE » en tete de fichier : converti, un filtre de
  --  notification <= 0.1 reste dans [0,1], donc l ANCIEN code l accepte au lieu
  --  de refuser — et filtre dix fois trop large, en silence. On refuse.
  select count(*) into v_muets
    from public.matching_settings
   where notify_threshold <= 0.1;

  if v_muets > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = format('ECHELLE — REFUS : %s ecosysteme(s) ont un filtre de notification <= 0.1.', v_muets),
      detail  = 'Converti, il resterait dans [0,1] : l ancien code l accepterait et filtrerait DIX FOIS TROP LARGE, en silence, sur toute annonce publiee entre cette migration et le deploiement.',
      hint    = 'Deployez le code D ABORD dans ce cas, ou remontez ces filtres au-dessus de 0.1 depuis /admin/matching, puis reappliquez.';
  end if;

  -- ── LES NOTES DEJA CALCULEES ───────────────────────────────────────────
  --  `matches.relevance_score` n est JAMAIS compare a une constante ailleurs
  --  que contre les deux filtres — ses seuls autres usages sont un `.order()`
  --  et un passage de valeur. La multiplication est confinee.
  --  §D.6 tient : aucun score de pertinence chiffre n est servi a l expert.
  execute 'alter table public.matches drop constraint if exists matches_relevance_score_range_check';

  update public.matches
     set relevance_score = relevance_score * 10
   where relevance_score is not null;

  execute $c$alter table public.matches
    add constraint matches_relevance_score_range_check
    check (relevance_score is null or (relevance_score >= 0 and relevance_score <= 10))$c$;

  -- ── LES DEUX FILTRES ───────────────────────────────────────────────────
  execute 'alter table public.matching_settings drop constraint if exists matching_settings_feed_range_check';
  execute 'alter table public.matching_settings drop constraint if exists matching_settings_notify_range_check';
  execute 'alter table public.matching_settings drop constraint if exists matching_settings_ordre_check';

  update public.matching_settings
     set feed_threshold   = feed_threshold * 10,
         notify_threshold = notify_threshold * 10;

  execute $c$alter table public.matching_settings
    add constraint matching_settings_filtre_notification_check
    check (notify_threshold >= 0 and notify_threshold <= 10)$c$;
  -- Notifier plus large que le flux notifierait pour une annonce invisible.
  execute $c$alter table public.matching_settings
    add constraint matching_settings_ordre_des_filtres_check
    check (notify_threshold >= feed_threshold)$c$;
  -- POSEE EN DERNIER, ET C EST ELLE QUI SERT DE TEMOIN D IDEMPOTENCE : tant
  -- qu elle n existe pas, la conversion n a pas abouti.
  execute $c$alter table public.matching_settings
    add constraint matching_settings_filtre_flux_check
    check (feed_threshold >= 0 and feed_threshold <= 10)$c$;

  -- ── LE BROUILLON DE NOTES — vide, parce qu il ne porte AUCUNE echelle ───
  --  `matching_notes_partielles.score` est un `real` SANS contrainte : rien n y
  --  distingue un 0-1 d un 0-10. Une note ecrite avant la bascule et reprise
  --  apres melangerait les deux echelles DANS LE MEME RUN, en silence.
  --  Le cout est nul ou presque : c est un brouillon de 24 h, dont le
  --  commentaire de table dit lui-meme qu une note plus vieille « vaut mieux
  --  d etre recalculee ». Le pire qui arrive est un re-calcul.
  delete from public.matching_notes_partielles;

  -- ── CE QUE L OPERATEUR DOIT VOIR ───────────────────────────────────────
  select count(*) into v_matches  from public.matches where relevance_score is not null;
  select count(*) into v_reglages from public.matching_settings;
  select count(*) into v_hors
    from public.matches
   where relevance_score is not null
     and (relevance_score < 0 or relevance_score > 10);

  if v_hors > 0 then
    raise exception 'ECHELLE — % note(s) hors [0,10] apres conversion.', v_hors;
  end if;

  raise notice 'ECHELLE — % note(s) converties, % ecosysteme(s) sur la nouvelle echelle 0-10.',
    v_matches, v_reglages;
  raise notice 'ECHELLE — la repartition ne se remplira qu aux PROCHAINS runs : l historique n est pas reecrit, il est date.';
end
$$;

comment on column public.matches.relevance_score is
  'Note de pertinence du couple (annonce, profil), ECHELLE 0-10, propre a une '
  'annonce et JAMAIS normalisee sur le vivier. Le reranker produit du 0-1 ; la '
  'conversion se fait UNE FOIS, a la frontiere du fournisseur (lib/matching/'
  'rerank.ts). Aucune autre conversion n existe dans le produit.';

-- ⚠️ LES COLONNES NE SONT PAS RENOMMEES, ET C EST UNE DECISION, PAS UN OUBLI.
--    Les clients Supabase ne sont pas types (§E.1) : une colonne est lue par son
--    NOM, dans une chaine. Un renommage casse au RUNTIME, en silence, dans tout
--    code qui la cite. Le renommage de `feed_threshold`, `notify_threshold`,
--    `confidence_threshold`, `auto_approve_threshold` et `seuil_mensuel_usd`
--    fera l objet d un lot a lui seul, avec son propre controle.
--    Les CONTRAINTES, elles, prennent le vocabulaire des maintenant : elles
--    n ont aucun lecteur en chaine.
comment on column public.matching_settings.feed_threshold is
  'FILTRE DU FLUX, echelle 0-10. Sous cette note, l expert ne voit pas l annonce. '
  '0 = tout le vivier eligible passe. Ce reglage TRIE : il ne bloque rien et ne '
  'juge personne. Le mot « seuil » est retire du produit.';
comment on column public.matching_settings.notify_threshold is
  'FILTRE DE NOTIFICATION, echelle 0-10. Au-dessus, le palier vaut « strong » et '
  'une notification part — si notify_enabled est vrai.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LA REPARTITION — ce qui manquait pour regler un filtre autrement qu'au hasard
-- ═══════════════════════════════════════════════════════════════════════════
--
--  L'ecran ecrivait lui-meme que regler un filtre sans la distribution revient a
--  tirer au hasard — PUIS il demandait de le faire. La raison est mesurable :
--  `matching_stats` ne portait que p50, p90, max et un comptage au-dessus du
--  filtre EN VIGUEUR CE JOUR-LA. Impossible d'en deduire ce que donnerait une
--  AUTRE valeur.
--
--  Decision produit prise : chaque run enregistre desormais le NOMBRE D'EXPERTS
--  PAR TRANCHE DE NOTE — dix entiers, tranche i = [i, i+1), la derniere fermee
--  a 10. Jamais les notes individuelles : on veut regler un filtre, pas
--  constituer un classement nominatif (§D.6).
--
--  ⚠️ LA REPARTITION PORTE SUR TOUS LES PROFILS NOTES, PAS SUR CEUX QUI PASSENT.
--     Batie sur les seuls retenus, elle ne saurait dire ce qu'un filtre PLUS BAS
--     laisserait entrer — c'est-a-dire precisement la question qu'on pose en
--     reglant.
--
--  `matching_threshold_health()` ne lit QUE les runs estampilles `echelle: 10`.
--  Melanger deux echelles dans une moyenne produirait un nombre juste sous une
--  etiquette fausse.
drop function if exists public.matching_threshold_health(interval);

create or replace function public.matching_threshold_health(
  p_depuis interval default interval '30 days'
) returns table (
    runs_observes         bigint,
    seuil_median_applique numeric,
    notifies_moyen        numeric,
    notifies_median       numeric,
    part_notifiee_moyenne numeric,
    score_p50_moyen       numeric,
    score_p90_moyen       numeric,
    runs_zero_notifie     bigint,
    runs_tout_notifie     bigint,
    -- Dix entiers : le nombre de notes tombees dans chaque tranche, SOMME sur
    -- les runs observes. La tranche i couvre [i, i+1) ; la dixieme est fermee.
    repartition           bigint[],
    notes_totales         bigint
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  with runs as (
    select p.matching_stats as st
      from public.publications p
     where p.matching_completed_at is not null
       and p.matching_completed_at > now() - p_depuis
       and p.matching_stats ? 'above_threshold'
       -- L ESTAMPILLE. Les runs d avant la bascule sont en 0-1 : les compter
       -- ici melangerait deux echelles dans la meme moyenne.
       and (p.matching_stats->>'echelle') = '10'
  ),
  tranches as (
    select i,
           sum(coalesce((st->'repartition'->>(i - 1))::bigint, 0)) as n
      from runs, generate_series(1, 10) as g(i)
     group by i
  )
  select
    (select count(*) from runs),
    (select round(percentile_cont(0.5) within group (
       order by (st->>'threshold_used')::numeric)::numeric, 2) from runs),
    (select round(avg((st->>'above_threshold')::numeric), 1) from runs),
    (select round(percentile_cont(0.5) within group (
       order by (st->>'above_threshold')::numeric)::numeric, 1) from runs),
    (select round(avg(
       (st->>'above_threshold')::numeric
       / nullif((st->>'eligible_after_filters')::numeric, 0)), 3) from runs),
    (select round(avg((st->>'score_p50')::numeric), 2) from runs),
    (select round(avg((st->>'score_p90')::numeric), 2) from runs),
    (select count(*) filter (where (st->>'above_threshold')::int = 0) from runs),
    (select count(*) filter (where (st->>'above_threshold')::int
                                 = (st->>'eligible_after_filters')::int) from runs),
    (select array_agg(n order by i) from tranches),
    (select coalesce(sum(n), 0) from tranches);
$fn$;

revoke all on function public.matching_threshold_health(interval) from public, anon, authenticated;
grant execute on function public.matching_threshold_health(interval) to service_role;

comment on function public.matching_threshold_health(interval) is
  'Sante des filtres de pertinence, ECHELLE 0-10. Ne lit que les runs estampilles '
  '`echelle: 10` : l historique d avant la bascule est conserve mais pas melange. '
  '`repartition` donne le nombre de notes par tranche entiere, somme sur la '
  'fenetre — c est ce qui permet de dire, en reglant, combien d experts une '
  'valeur inclut et combien elle exclut.';

