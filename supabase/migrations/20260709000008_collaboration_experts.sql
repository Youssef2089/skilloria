-- ─────────────────────────────────────────────────────────────────────────────
-- COLLABORATION EXPERTS — « Besoin / Sous-traitance » (Option A : org perso lazy)
--
-- CONTEXTE
--   Un expert peut publier un BESOIN de sous-traitance, matché à d'autres
--   EXPERTS disponibles du domaine. Blocage structurel : publications.
--   organization_id est NOT NULL → un expert doit passer par une organisation.
--   Solution : une organisation PERSONNELLE créée à la demande (route lazy),
--   invisible côté entreprise, rattachée à un PACKAGE dédié « collaboration ».
--   L'expert hérite ainsi de 100 % du moteur commerce (quotas, masquage,
--   dévoilement, matching, messagerie 15j) SANS logique dupliquée.
--
-- CETTE MIGRATION (fichier ; poussée par Youssef — AUCUNE commande DB ici)
--   a. publications.type : ajoute 'sous_traitance' (distinct de mission/offre).
--   b. organizations.org_type : ajoute 'freelance' — l'org personnelle porte
--      ce type, qui sert AUSSI de marqueur d'invisibilité (les écrans
--      entreprise filtreront org_type <> 'freelance'). ⚠ 'freelance' n'était
--      PAS dans le CHECK (baseline = client/cabinet/esn) — on l'étend.
--   c. organizations.owner_user_id + index unique partiel → AU PLUS une org
--      personnelle par expert (idempotence de la création lazy).
--   d. packages.target_role : ajoute 'collaboration' + SEED du package dédié
--      (grille D5) + ses 4 features. Rejouable, jamais is_default.
--
-- CHOIX (b/c) — pourquoi owner_user_id plutôt que via organization_members
--   organization_members est many-to-many (un user peut être membre de
--   plusieurs orgs — sa perso ET une org cliente). Y adosser « une seule org
--   perso » imposerait un unique sur un sous-ensemble de jointure, fragile.
--   Une colonne owner_user_id sur organizations, avec un index UNIQUE PARTIEL
--   `where org_type='freelance'`, enferme la règle dans UNE table, en une ligne,
--   et donne à la route lazy une clé de lookup triviale
--   (owner_user_id = auth.uid() and org_type='freelance'). Les vraies
--   entreprises gardent owner_user_id NULL (hors index partiel).
--
-- IDEMPOTENCE : gardes d'existence sur chaque CHECK ; colonne/index IF NOT
--   EXISTS ; seed en WHERE NOT EXISTS (NULL-safe, domain_id IS NULL) + ON
--   CONFLICT DO NOTHING. Rejouée, la migration ne fait rien.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── a. publications.type ← + 'sous_traitance' ──────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.publications'::regclass
      and conname  = 'publications_type_check'
      and pg_get_constraintdef(oid) like '%sous_traitance%'
  ) then
    alter table public.publications drop constraint if exists publications_type_check;
    alter table public.publications
      add constraint publications_type_check
      check (type = any (array['mission', 'offre', 'sous_traitance']::text[]));
    raise notice 'publications.type : ''sous_traitance'' autorisé.';
  else
    raise notice 'publications.type : déjà à jour.';
  end if;
end $$;

comment on constraint publications_type_check on public.publications is
  'mission (client→freelance) | offre (client→CDI) | sous_traitance (expert→experts, org personnelle).';

-- ── b. organizations.org_type ← + 'freelance' (org personnelle) ────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.organizations'::regclass
      and conname  = 'organizations_org_type_check'
      and pg_get_constraintdef(oid) like '%freelance%'
  ) then
    alter table public.organizations drop constraint if exists organizations_org_type_check;
    alter table public.organizations
      add constraint organizations_org_type_check
      check ((org_type)::text = any (array['client', 'cabinet', 'esn', 'freelance']::text[]));
    raise notice 'organizations.org_type : ''freelance'' autorisé (org personnelle).';
  else
    raise notice 'organizations.org_type : déjà à jour.';
  end if;
end $$;

comment on column public.organizations.org_type is
  'client | cabinet | esn (vraies entreprises) | freelance (organisation PERSONNELLE '
  'd''un expert pour la sous-traitance — INVISIBLE côté entreprise : filtrer '
  'org_type <> ''freelance'' partout où les entreprises sont listées).';

-- ── c. organizations.owner_user_id + unicité de l'org personnelle ──────────
alter table public.organizations
  add column if not exists owner_user_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.organizations'::regclass
      and conname  = 'organizations_owner_user_id_fkey'
  ) then
    alter table public.organizations
      add constraint organizations_owner_user_id_fkey
      foreign key (owner_user_id) references public.users(id) on delete cascade;
  end if;
end $$;

comment on column public.organizations.owner_user_id is
  'Propriétaire d''une organisation PERSONNELLE (org_type=''freelance''). NULL pour '
  'les vraies entreprises (modèle organization_members). ON DELETE CASCADE : l''org '
  'personnelle disparaît avec son expert.';

-- AU PLUS une org personnelle par expert (D3). Partiel : n'indexe que les orgs
-- personnelles ; les vraies entreprises (owner_user_id NULL) sont ignorées.
create unique index if not exists organizations_personal_owner_unique_idx
  on public.organizations (owner_user_id)
  where (org_type = 'freelance' and owner_user_id is not null);

-- ── d. packages.target_role ← + 'collaboration' ────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.packages'::regclass
      and conname  = 'packages_target_role_check'
      and pg_get_constraintdef(oid) like '%collaboration%'
  ) then
    alter table public.packages drop constraint if exists packages_target_role_check;
    alter table public.packages
      add constraint packages_target_role_check
      check ((target_role)::text = any (array['client', 'cabinet', 'all', 'collaboration']::text[]));
    raise notice 'packages.target_role : ''collaboration'' autorisé.';
  else
    raise notice 'packages.target_role : déjà à jour.';
  end if;
end $$;

-- ── d bis. SEED du package « collaboration » (grille D5) ───────────────────
--    scope 'organization', domain_id NULL (tous domaines), is_default=false
--    (il ne concerne QUE les orgs personnelles, jamais un fallback de vraie org).
--    Rattaché explicitement via organization_domains par la route lazy →
--    getOrgEntitlements le lit en priorité (le target_role ne sert donc PAS à
--    la résolution ; il n'est qu'une étiquette de catalogue).
insert into public.packages
  (domain_id, name, slug, target_role, scope, price_monthly, currency, is_default, active)
select null, 'Collaboration', 'collaboration', 'collaboration', 'organization', null, 'EUR', false, true
where not exists (
  select 1 from public.packages p
  where p.domain_id is null and p.slug = 'collaboration' and p.target_role = 'collaboration'
);

-- Features (D5) : 1 publication/mois, 1 active max, 1 candidat dévoilé,
-- 0 déblocage manuel (mur payant construit mais neutralisé — pas de Stripe V0).
-- reset_period : *_per_month => monthly ; *_max / revealed_* => never.
insert into public.package_features (package_id, feature_code, value, reset_period)
select p.id, f.feature_code, f.value, f.reset_period
from public.packages p
cross join (values
  ('publications_per_month',              '1', 'monthly'),
  ('active_publications_max',             '1', 'never'),
  ('revealed_candidates_per_publication', '1', 'never'),
  ('manual_unlocks_per_month',            '0', 'monthly')
) as f(feature_code, value, reset_period)
where p.domain_id is null and p.slug = 'collaboration' and p.target_role = 'collaboration'
on conflict (package_id, feature_code) do nothing;

commit;
