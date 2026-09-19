-- ─────────────────────────────────────────────────────────────────────────────
-- LA REPARTITION SE LIT PAR ECOSYSTEME, PARCE QUE LE FILTRE SE REGLE PAR
-- ECOSYSTEME.
--
-- ORDRE DE PASSAGE : INDIFFERENT, mais APRES `echelle_des_notes` — elle
-- remplace la fonction que celle-ci pose. N'ajoute qu'une lecture.
--
-- ═══ LE DEFAUT, ET IL EST DE MA MAIN ════════════════════════════════════════
--
--   `matching_settings` porte UNE LIGNE PAR ECOSYSTEME : les deux filtres se
--   reglent ecosysteme par ecosysteme. Or `matching_threshold_health()`
--   agregeait TOUS les runs, tous ecosystemes confondus.
--
--   L'ecran aurait donc montre, a cote du filtre de l'ecosysteme A, la
--   repartition des notes de A + B + C. On aurait regle A en lisant une courbe
--   qui n'est pas la sienne — et ce serait pire que de ne rien montrer, parce
--   qu'on aurait cru savoir.
--
--   C'est exactement la classe §E.24 : un chiffre juste (la repartition existe
--   bien, elle est correcte) sous une etiquette fausse (« la repartition de cet
--   ecosysteme »).
--
-- ═══ CE QUI NE CHANGE PAS ═══════════════════════════════════════════════════
--   Sans argument, la fonction rend exactement ce qu'elle rendait : l'agregat
--   de tous les ecosystemes. Aucun appelant existant ne casse.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.matching_threshold_health(interval);

create or replace function public.matching_threshold_health(
  p_depuis    interval default interval '30 days',
  -- NULL = tous les ecosystemes. C'est le comportement historique, garde par
  -- defaut : un appelant qui ne passe rien obtient ce qu'il obtenait.
  p_domain_id uuid default null
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
       -- ici melangerait deux echelles dans la meme moyenne (§E.24).
       and (p.matching_stats->>'echelle') = '10'
       and (p_domain_id is null or p.domain_id = p_domain_id)
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

revoke all on function public.matching_threshold_health(interval, uuid) from public, anon, authenticated;
grant execute on function public.matching_threshold_health(interval, uuid) to service_role;

comment on function public.matching_threshold_health(interval, uuid) is
  'Sante des filtres de pertinence, ECHELLE 0-10, eventuellement bornee a UN '
  'ecosysteme. Les filtres se reglent par ecosysteme : montrer a cote d eux la '
  'repartition de tous les autres ferait regler sur une courbe qui n est pas la '
  'sienne. Sans p_domain_id, le comportement historique est conserve. '
  'Ne lit que les runs estampilles `echelle: 10`.';
