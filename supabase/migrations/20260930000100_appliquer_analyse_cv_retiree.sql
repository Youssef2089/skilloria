-- ════════════════════════════════════════════════════════════════════════════
--  L'ANCIENNE ÉCRITURE DE L'ANALYSE D'UN CV EST RETIRÉE (§E.72, étape 3 ; §H.5).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent au déploiement — le code déployé sur staging depuis l'ARRÊT 19
--  (`dbd028e`) ne l'appelle plus : l'analyse s'écrit par `ecrire_analyse_cv` (migration
--  `analyse_cv_tolerante`), appelée par `terminer_analyse_cv`. C'est la troisième étape de §E.72 :
--  la fonction nouvelle a été ajoutée, le code qui l'appelle déployé, l'ancienne part maintenant.
--
--  CE QUI DISPARAÎT : `appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb)` (ARRÊT 18, tout
--  ou rien). Son test (`profil/analyse_cv.test.sql`) est retiré avec elle ; ce qu'il prouvait et
--  qui vaut pour la fonction qui la remplace — le prénom lu dans un CV ne touche pas le compte,
--  une liste vide n'efface rien, la fonction est fermée au navigateur — est prouvé par
--  `profil/analyse_cv_tolerante.test.sql`.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb);


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.appliquer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb)') is not null then
    raise exception 'postcondition NON TENUE : appliquer_analyse_cv existe encore';
  end if;
  if to_regprocedure('public.ecrire_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb, interval)') is null then
    raise exception 'postcondition NON TENUE : ecrire_analyse_cv, qui la remplace, est absente';
  end if;
  raise notice 'postcondition tenue : appliquer_analyse_cv retiree, ecrire_analyse_cv presente ; l ecriture de l analyse est prouvee par tests/database/profil/analyse_cv_tolerante.test.sql';
end
$post$;
