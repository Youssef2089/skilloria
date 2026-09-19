-- ─────────────────────────────────────────────────────────────────────────────
-- UN SUIVI DE CONSOMMATION, ET NON DEUX TOTAUX.
--
-- ORDRE DE PASSAGE : INDIFFERENT. N'ajoute que des fonctions de LECTURE ; ne
-- touche aucune donnee, aucune colonne, aucune contrainte.
--
-- ═══ LE DEFAUT QU'ON FERME ═══════════════════════════════════════════════════
--
--   `ai_spend_events` porte depuis le premier jour le MONTANT, l'ACTEUR,
--   l'ACTION et l'HORODATAGE de chaque appel payant. L'ecran n'en montrait que
--   LA SOMME DU MOIS, par fournisseur. Deux nombres.
--
--   Ce que ces deux nombres ne disent pas, et que la donnee sait deja :
--     · le mois precedent — donc aucune tendance, et aucun moyen de voir qu'une
--       depense a double ;
--     · la repartition PAR TYPE D'ACTION — sept points de depense existent
--       (analyse de CV, classement, jugement de candidature, pitch, verification
--       d'expert, verification d'organisation, qualite d'annonce) et l'ecran les
--       agregeait tous sous « claude » ;
--     · les operations les plus couteuses — celles qu'on irait regarder en
--       premier si on pouvait les voir.
--
--   Un compteur qui ne montre qu'un total ne permet de decider de RIEN. Il
--   rassure quand il est bas, et il ne dit pas quoi faire quand il est haut.
--
-- ═══ DEUX FONCTIONS, ET AUCUNE TABLE ════════════════════════════════════════
--
--   RIEN N'EST STOCKE, aucune tache planifiee. Un agregat ecrit quelque part
--   serait faux des la seconde suivante, et il faudrait ensuite le reparer.
--   La depense se recalcule quand on la regarde, ou elle n'existe pas — meme
--   parti pris que `ai_spend_par_acteur`.
--
--   ⚠️ LA FENETRE MENSUELLE EST CELLE DE `ai_spend_status`, AU CARACTERE PRES :
--      `date_trunc('month', now() at time zone 'utc')`. Deux expressions
--      differentes decaleraient les totaux d'une poignee d'heures en fin de
--      mois, et la somme cesserait de boucler — c'est-a-dire qu'on perdrait la
--      seule chose qui rend cet ecran croyable.
--
-- Additif et rejouable.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. L'HISTORIQUE PAR MOIS ET PAR ACTION
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Une ligne par (mois, fournisseur, action). L'ecran pivote comme il veut : on
--  rend la matiere, pas une mise en forme.
--
--  `action` peut etre NULL — les depenses d'avant la colonne `action`
--  (migration `depense_ia_par_acteur`) n'en portent aucune. On la rend telle
--  quelle plutot que de l'imputer a une action choisie au hasard : une categorie
--  inventee se lit comme une mesure.
create or replace function public.ai_depense_par_mois(
  p_mois integer default 12
) returns table (
    mois        date,
    provider    text,
    action      text,
    total_usd   numeric,
    operations  bigint,
    -- Combien de ces operations ont ete journalisees SANS tarif connu. Leur
    -- cout vaut 0 et le plafond ne les compte pas : le total est alors SOUS-
    -- estime, et l'ecran doit pouvoir le dire au lieu d'afficher un chiffre
    -- rassurant.
    sans_tarif  bigint
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select
    (date_trunc('month', e.created_at at time zone 'utc'))::date,
    e.provider,
    e.action,
    round(sum(e.cost_usd), 4),
    count(*),
    count(*) filter (where (e.context->>'tarif_manquant') = 'true')
  from public.ai_spend_events e
  where e.created_at >= date_trunc('month', now() at time zone 'utc')
                        - make_interval(months => greatest(0, p_mois - 1))
  group by 1, 2, 3
  order by 1 desc, 2, 3;
$fn$;

revoke all on function public.ai_depense_par_mois(integer) from public, anon, authenticated;
grant execute on function public.ai_depense_par_mois(integer) to service_role;

comment on function public.ai_depense_par_mois(integer) is
  'Depense d IA par mois, fournisseur et type d action, sur les N derniers mois '
  '(mois civils UTC, meme fenetre que ai_spend_status). `sans_tarif` compte les '
  'operations journalisees sans tarif connu : leur cout vaut 0, donc le total '
  'est SOUS-estime et l ecran doit le dire.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LES OPERATIONS LES PLUS COUTEUSES
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Le total dit COMBIEN ; la repartition dit DE QUOI ; celle-ci dit LAQUELLE.
--  C'est la seule des trois qu'on puisse aller regarder.
--
--  ⚠️ AUCUN CONTENU N'EST RENDU — ni CV, ni annonce, ni message. Seulement le
--     quoi, le quand, le combien, et l'acteur NOMME quand il est imputable.
--     Le detail d'une depense n'est pas une porte derobee vers la donnee
--     personnelle qui l'a declenchee (RGPD, et §D.4 pour les experts : on rend
--     l'identifiant du profil, jamais son nom ni son adresse).
create or replace function public.ai_depense_operations(
  p_limite integer default 20,
  p_mois   date    default null
) returns table (
    id             uuid,
    created_at     timestamptz,
    provider       text,
    action         text,
    cost_usd       numeric,
    units          integer,
    model          text,
    tarif_manquant boolean,
    acteur_type    text,
    acteur_id      uuid,
    -- Le NOM n'est rendu que pour une ORGANISATION. Un expert reste un
    -- identifiant : §D.4 interdit de projeter son identite vers une surface qui
    -- n a pas a la connaitre, et un ecran de depense n en a pas besoin.
    acteur_nom     text
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select
    e.id,
    e.created_at,
    e.provider,
    e.action,
    round(e.cost_usd, 6),
    e.units,
    e.context->>'model',
    coalesce((e.context->>'tarif_manquant') = 'true', false),
    case
      when e.organization_id is not null then 'organization'
      when e.profile_id is not null      then 'profile'
      else 'non_imputable'
    end,
    coalesce(e.organization_id, e.profile_id),
    o.company_name
  from public.ai_spend_events e
  left join public.organizations o on o.id = e.organization_id
  where (
      p_mois is null
      or (e.created_at >= p_mois
          and e.created_at < (p_mois + interval '1 month'))
    )
  order by e.cost_usd desc, e.created_at desc
  limit greatest(1, least(200, coalesce(p_limite, 20)));
$fn$;

revoke all on function public.ai_depense_operations(integer, date) from public, anon, authenticated;
grant execute on function public.ai_depense_operations(integer, date) to service_role;

comment on function public.ai_depense_operations(integer, date) is
  'Les operations d IA les plus couteuses, eventuellement bornees a un mois. '
  'AUCUN CONTENU n est rendu : ni CV, ni annonce, ni message. Le nom n est rendu '
  'que pour une organisation — un expert reste un identifiant (§D.4).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. INDEX — la lecture par mois deviendra la plus frequente
-- ═══════════════════════════════════════════════════════════════════════════
--  L'index existant porte (provider, created_at desc), ce qui sert le total du
--  mois par fournisseur. Le groupement par action s'appuiera sur celui-ci.
create index if not exists ai_spend_action_mois_idx
  on public.ai_spend_events (created_at desc, action);
