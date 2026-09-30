-- ════════════════════════════════════════════════════════════════════════════
--  LES TYPES D'EXPÉRIENCE : UNE SEULE LISTE, LUE PAR LA CONTRAINTE, PAR LES
--  FONCTIONS ET PAR LE CODE (§E.88, 30/09/2026).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Remplace une contrainte par une
--  contrainte ÉQUIVALENTE (mêmes valeurs) : aucune ligne existante ne la viole.
--  Rejouable.
--
--  LE DÉFAUT : la liste vivait à TROIS endroits qui ne se lisaient pas — la
--  contrainte `profile_experiences_experience_type_check` (baseline), le schéma
--  de l'analyseur (`lib/cv-parser.ts`) et le type des routes. Un test écrit de
--  mémoire a posé `'mission'`, que la table refuse : le test échouait, et rien
--  ne disait que la liste avait trois copies.
--
--  LA RÈGLE : `types_experience()` est LA liste. La contrainte l'appelle, la
--  fonction d'analyse la lit pour écarter un type inconnu au lieu d'échouer, et
--  le code TypeScript en porte le miroir (`lib/profil/types-experience.ts`),
--  comparé DANS LES DEUX SENS par `diag-parcours-expert` — qui rougit si l'un
--  des trois diverge.
--
--  `immutable` : une contrainte CHECK ne peut appeler qu'une fonction immuable,
--  et celle-ci l'est vraiment — changer la liste est une MIGRATION (elle
--  redéfinit la fonction ET revalide la contrainte), jamais un réglage.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.types_experience()
  returns text[]
  language sql
  immutable
  parallel safe
  set search_path to 'public'
as $fn$
  select array['career', 'project']::text[]
$fn$;

comment on function public.types_experience() is
$$LA liste des types d'expérience (profile_experiences.experience_type). Lue par la
contrainte profile_experiences_experience_type_check et par ecrire_analyse_cv ;
miroir TypeScript : lib/profil/types-experience.ts, comparé par diag-parcours-expert.$$;

-- La contrainte lit la fonction : une seule liste en base.
alter table public.profile_experiences
  drop constraint if exists profile_experiences_experience_type_check;
alter table public.profile_experiences
  add constraint profile_experiences_experience_type_check
  check (experience_type::text = any (public.types_experience()));

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_def text;
begin
  if to_regprocedure('public.types_experience()') is null then
    raise exception 'postcondition NON TENUE : types_experience() absente';
  end if;
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.profile_experiences'::regclass
     and c.conname = 'profile_experiences_experience_type_check';
  if v_def is null or v_def !~ 'types_experience\(\)' then
    raise exception 'postcondition NON TENUE : la contrainte ne lit pas types_experience() [vu : %]', v_def;
  end if;
  raise notice 'postcondition tenue : la contrainte des types lit types_experience() ; le refus du type inconnu est prouvé par tests/database/profil/types_experience.test.sql';
end
$post$;
