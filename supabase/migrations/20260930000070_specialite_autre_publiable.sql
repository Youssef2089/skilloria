-- ════════════════════════════════════════════════════════════════════════════
--  « AUTRE » EST UNE SPÉCIALITÉ PUBLIABLE — la contrainte de visibilité
--  l'accepte, comme le prédicat du code (§E.88, B4, 30/09/2026).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Remplace une contrainte par une
--  contrainte PLUS LARGE : aucune ligne existante ne la viole. Rejouable.
--
--  LE DÉFAUT (audit du 30/09/2026 sur aac5f79, B4) : deux décisions se
--  contredisaient. La migration `taxonomie_specialite_autre_et_inscription` (D6)
--  fait choisir « Autre » à l'expert dont la spécialité n'est pas au référentiel,
--  et range sa précision dans `speciality_other`, `speciality_ids` VIDE. La
--  contrainte `profiles_visible_requiert_criteres_check` (profil_annonce_multivalues)
--  exige `speciality_ids` NON VIDE. Un expert inscrit avec « Autre » ne pouvait
--  donc JAMAIS être publié — l'écran le disait complet, le serveur répondait
--  « sélectionnez au moins une spécialité », et si sa branche n'en proposait
--  aucune, il n'avait aucune issue.
--
--  LA RÈGLE : le critère « spécialité » est tenu par une spécialité du référentiel
--  OU par une précision « Autre » non vide. Le moteur sait déjà le lire : un expert
--  sans spécialité du référentiel recoupe les annonces qui n'en exigent aucune, dans
--  sa branche, dans les deux sens (lib/matching/run-for-expert.ts, pool.ts).
--  Le prédicat TypeScript (lib/profile-visibility.ts) dit la même chose,
--  et `diag-parcours-expert` rougit si l'un des deux la perd.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  drop constraint if exists profiles_visible_requiert_criteres_check;
alter table public.profiles
  add constraint profiles_visible_requiert_criteres_check
  check (
    visible = false
    or (
          branch_id is not null
      and (coalesce(array_length(speciality_ids, 1), 0) > 0 or nullif(btrim(speciality_other), '') is not null)
      and coalesce(array_length(seniorities,    1), 0) > 0
      and coalesce(array_length(work_zone_ids,  1), 0) > 0
      and (availability_status is not null or cdi_status is not null)
      and summary is not null
      and char_length(btrim(summary)) between 200 and 800
    )
  );

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.profiles'::regclass
     and c.conname = 'profiles_visible_requiert_criteres_check';
  if v_def is null or v_def !~ 'speciality_other' then
    raise exception 'postcondition NON TENUE : la contrainte de visibilite ignore encore Autre [vu : %]', v_def;
  end if;
  raise notice 'postcondition tenue : la contrainte de visibilite accepte Autre ; la publication d un profil Autre est prouvee par tests/database/profil/specialite_autre.test.sql';
end
$post$;
