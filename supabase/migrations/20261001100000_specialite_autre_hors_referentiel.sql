-- ════════════════════════════════════════════════════════════════════════════
--  « AUTRE » N'EST JAMAIS UNE LIGNE DU RÉFÉRENTIEL — une seule notion « Autre »,
--  la précision `speciality_other` (recette staging du 01/10/2026, point 1).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Le code en ligne ne lit pas les lignes
--  retirées autrement que comme une spécialité de plus ; le code qui suit n'en a plus
--  besoin. Rejouable : la reprise ne trouve plus rien au second passage.
--
--  LE DÉFAUT : l'écran de validation montrait DEUX boutons « Autre ». L'un était
--  l'option de l'écran, « Autre (préciser) », qui range sa précision dans
--  `speciality_other` ; l'autre était une SPÉCIALITÉ du référentiel nommée « Autre »
--  (semée dans la branche Business Applications par `parametrage_de_production`),
--  servie par /api/taxonomy comme n'importe quelle autre, sans champ de précision.
--  Rien n'empêchait l'administration d'en créer d'autres.
--
--  LA RÈGLE, EN BASE :
--    1. `est_specialite_autre(nom, slug)` dit, une fois, ce qu'est une ligne « Autre »
--       (le mot, en français et dans les trois autres langues du produit, seul ou suivi
--       d'une parenthèse ; ou un slug de cette forme, suffixe numérique compris) ;
--    2. `retirer_specialites_autre()` reprend les profils et les annonces qui en portent
--       une : l'identifiant sort de `speciality_ids`, et la précision `speciality_other`
--       reçoit le NOM de la ligne quand elle est vide — la personne avait choisi
--       « Autre », c'est exactement ce qu'elle garde, et l'écran de validation l'invite
--       à préciser. Puis la ligne est DÉSACTIVÉE, jamais supprimée (les clés étrangères
--       héritées — `profile_alerts.speciality_id` — la citent encore) ;
--    3. la contrainte `specialities_autre_hors_referentiel` refuse qu'une spécialité
--       ACTIVE soit « Autre » : à la création, au renommage, à la réactivation.
--       L'administration rend le refus sous le code `specialite_autre_reservee`.
--
--  ⚠️ LA REPRISE TOUCHE DES DONNÉES : c'est une reprise VOULUE, dans son propre bloc
--     (§G.4 ter). Elle ne lit que ce qu'elle reprend, et elle le dit en chiffres.
--     Elle est prouvée sur des données fabriquées par
--     tests/database/taxonomie/autre_hors_referentiel.test.sql.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.est_specialite_autre(p_nom text, p_slug text)
  returns boolean
  language sql
  immutable
  set search_path to 'public'
as $fn$
  select coalesce(lower(btrim(p_nom)), '') ~ '^(autres?|others?|otr[oa]s?|anderes?|sonstiges?)( *\(.*\))?$'
      or coalesce(lower(btrim(p_slug)), '') ~ '^(autres?|others?|otr[oa]s?|anderes?|sonstiges?)(-[0-9]+)?$'
$fn$;

comment on function public.est_specialite_autre(text, text) is
  'Ce qu''est une spécialité « Autre » : le mot, seul ou suivi d''une parenthèse, ou un slug de cette forme. « Autre » n''est jamais une ligne du référentiel active — c''est la précision speciality_other (recette du 01/10/2026).';

create or replace function public.retirer_specialites_autre()
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_autres   uuid[];
  v_profils  integer;
  v_annonces integer;
  v_lignes   integer;
begin
  select coalesce(array_agg(s.id), '{}') into v_autres
    from public.specialities s
   where public.est_specialite_autre(s.name, s.slug);
  if cardinality(v_autres) = 0 then
    return jsonb_build_object('specialites', 0, 'profils', 0, 'annonces', 0);
  end if;

  -- Les profils : l'identifiant sort, la précision garde « Autre » si elle était vide.
  update public.profiles p
     set speciality_other = coalesce(
           nullif(btrim(p.speciality_other), ''),
           (select s.name from public.specialities s where s.id = any (p.speciality_ids) and s.id = any (v_autres) order by s.name limit 1)
         ),
         speciality_ids = array(select x from unnest(p.speciality_ids) as x where not (x = any (v_autres)))
   where p.speciality_ids && v_autres;
  get diagnostics v_profils = row_count;

  -- Les annonces : la même reprise, la même règle.
  update public.publications u
     set speciality_other = coalesce(
           nullif(btrim(u.speciality_other), ''),
           (select s.name from public.specialities s where s.id = any (u.speciality_ids) and s.id = any (v_autres) order by s.name limit 1)
         ),
         speciality_ids = array(select x from unnest(u.speciality_ids) as x where not (x = any (v_autres)))
   where u.speciality_ids && v_autres;
  get diagnostics v_annonces = row_count;

  -- Désactivée, jamais supprimée : `profile_alerts.speciality_id` peut encore la citer.
  update public.specialities s set active = false where s.id = any (v_autres) and s.active;
  get diagnostics v_lignes = row_count;

  return jsonb_build_object('specialites', v_lignes, 'profils', v_profils, 'annonces', v_annonces);
end
$fn$;

revoke all on function public.retirer_specialites_autre() from public, anon, authenticated;

comment on function public.retirer_specialites_autre() is
  'Reprise : sort les spécialités « Autre » du référentiel des profils et des annonces (la précision speciality_other garde « Autre »), puis les désactive. Rend ce qu''elle a repris. Appelée par la migration specialite_autre_hors_referentiel ; rejouable.';

-- ── LA REPRISE — son propre bloc (§G.4 ter) ──────────────────────────────────
do $reprise$
declare
  v_bilan jsonb;
begin
  v_bilan := public.retirer_specialites_autre();
  raise notice 'reprise « Autre » : % spécialité(s) désactivée(s), % profil(s) et % annonce(s) repris',
    v_bilan ->> 'specialites', v_bilan ->> 'profils', v_bilan ->> 'annonces';
end
$reprise$;

-- ── LA RÈGLE, POUR L'AVENIR ──────────────────────────────────────────────────
alter table public.specialities
  drop constraint if exists specialities_autre_hors_referentiel;
alter table public.specialities
  add constraint specialities_autre_hors_referentiel
  check (not active or not public.est_specialite_autre(name, slug));

comment on constraint specialities_autre_hors_referentiel on public.specialities is
  '« Autre » n''est jamais une spécialité active du référentiel : c''est la précision speciality_other. Refus rendu par l''administration sous specialite_autre_reservee.';

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.est_specialite_autre(text, text)') is null
     or to_regprocedure('public.retirer_specialites_autre()') is null then
    raise exception 'postcondition NON TENUE : une fonction « Autre » manque';
  end if;
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.specialities'::regclass
       and c.conname = 'specialities_autre_hors_referentiel'
       and c.convalidated
  ) then
    raise exception 'postcondition NON TENUE : la contrainte specialities_autre_hors_referentiel manque ou n''est pas validée';
  end if;
  if has_function_privilege('authenticated', 'public.retirer_specialites_autre()', 'execute') then
    raise exception 'postcondition NON TENUE : la reprise est ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : « Autre » hors du référentiel ; la règle et la reprise sont prouvées par tests/database/taxonomie/autre_hors_referentiel.test.sql';
end
$post$;
