-- ════════════════════════════════════════════════════════════════════════════
--  « AUTRE » N'EST JAMAIS UNE LIGNE DU RÉFÉRENTIEL — LE PREMIER TEMPS : LA DÉFINITION, SEULE
--  (recette staging du 01/10/2026, point 1 ; relecture indépendante du 01/10/2026, points 2 et 11).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. RIEN ICI NE REFUSE CE QUE LE CODE EN LIGNE ÉCRIT (§E.72) : une fonction
--  pure, que seul le code nouveau appelle.
--
--  LE DÉCOUPAGE (relecture du 01/10/2026). La version d'origine reprenait les profils et les annonces, DÉSACTIVAIT la
--  ligne « Autre » du référentiel et posait une contrainte — dans le lot passé AVANT le déploiement. Or le code en
--  ligne (13d1524) rend 400 `bad_speciality` sur une spécialité inactive : une page chargée avant le push, « Autre »
--  coché, n'aurait plus pu s'enregistrer. La reprise, la désactivation, la contrainte et la garde des traductions
--  partent dans le lot SUIVANT (`specialite_autre_garde`), déployé APRÈS. Ici reste la DÉFINITION — une seule, que
--  l'administration DEMANDE avant d'écrire un nom ou une traduction (§E.81 : une règle se demande, elle ne se devine
--  pas), et que la garde du lot suivant appliquera.
--
--  `est_specialite_autre(nom, slug)` dit ce qu'est une ligne « Autre » : le mot, en français et dans les trois autres
--  langues du produit, seul ou suivi d'une parenthèse ; ou un slug de cette forme, suffixe numérique compris.
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
  'Ce qu''est une spécialité « Autre » : le mot (fr, en, es, de), seul ou suivi d''une parenthèse, ou un slug de cette forme. « Autre » n''est jamais une ligne du référentiel active — c''est la précision speciality_other. L''administration la DEMANDE avant d''écrire un nom ou une traduction ; la garde (lot suivant) l''applique.';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.est_specialite_autre(text, text)') is null then
    raise exception 'postcondition NON TENUE : est_specialite_autre manque';
  end if;
  raise notice 'postcondition tenue : la définition de « Autre » est en place, sans reprise ni garde (lot suivant) ; elle est prouvée par tests/database/taxonomie/autre_definition.test.sql';
end
$post$;
