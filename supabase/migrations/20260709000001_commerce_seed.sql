-- Lot 1 moteur commerce — SEED versionne et rejouable de la config initiale.
--
-- Objectif : rendre la config commerce reproductible depuis git (base vierge
-- incluse). Corrige notamment le bug de rejouabilite : handle_new_user
-- (baseline) exige roles.name='Gratuit' actif et leve une exception si absent
-- -> toute inscription echouerait sur une base fraichement migree sans ce seed.
--
-- CONVENTIONS
--  - Idempotence : ON CONFLICT DO NOTHING sur cle naturelle PARTOUT ou une
--    contrainte UNIQUE existe. Choix DO NOTHING (et non DO UPDATE) volontaire :
--    ces lignes sont la CONFIG INITIALE, editable ensuite au back-office ; un
--    redeploiement ne doit JAMAIS ecraser une valeur ajustee par un admin.
--  - packages : la UNIQUE (domain_id, slug, target_role) est une UNIQUE simple
--    (pas NULLS NOT DISTINCT). Comme on seed domain_id = NULL (tous domaines),
--    deux NULL sont DISTINCTS pour Postgres : ON CONFLICT ne matcherait jamais
--    et rejouerait des doublons. On garde donc l'idempotence via WHERE NOT
--    EXISTS (... domain_id IS NULL ...), NULL-safe.
--  - Aucun libelle FR en DB (regle projet) : descriptions en anglais ; les
--    libelles affiches viendront de l'i18n applicative.
--  - Aucune valeur de prix/quota codee en dur ailleurs que dans CE seed : ces
--    donnees SONT la config, modifiable au back-office (Lot 3).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. roles (per-user, NON touche par le moteur ; seed pour la rejouabilite).
--    Les NOMS sont des identifiants (handle_new_user matche 'Gratuit') : NE PAS
--    traduire. Seules les descriptions sont en anglais.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.roles (name, description, active)
values
  ('Gratuit', 'Default free commercial plan, assigned on signup by handle_new_user.', true),
  ('Starter', 'Entry-level paid plan.', true),
  ('Premium', 'Mid-tier paid plan.', true),
  ('Elite',   'Top-tier plan with unlimited access.', true),
  ('Admin',   'Platform administrator role.', true)
on conflict (name) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. features — dictionnaire cible. value_type conforme au CHECK
--    (integer|boolean|unlimited|string). Toutes 'integer' : la valeur effective
--    vit dans package_features.value (varchar) ; la valeur speciale 'unlimited'
--    y est stockee comme chaine et interpretee par la couche Droits (Lot 2).
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.features (code, name, description, category, value_type, active)
values
  ('publications_per_month',
     'Publications per month', 'Number of publications an organization may create per reset period.',
     'publications', 'integer', true),
  ('active_publications_max',
     'Active publications', 'Maximum number of simultaneously active (published) publications.',
     'publications', 'integer', true),
  ('revealed_candidates_per_publication',
     'Revealed candidates per publication', 'Candidates automatically revealed per publication (best AI match first).',
     'disclosure', 'integer', true),
  ('manual_unlocks_per_month',
     'Manual unlocks per month', 'Manual identity reveals allowed per organization per month (anti-scraping safeguard).',
     'disclosure', 'integer', true),
  ('seats_max',
     'Seats', 'Maximum member seats. Present in the catalog but NOT activated in V1 packages (max_seats NULL).',
     'seats', 'integer', true)
on conflict (code) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. packages — 3 offres, scope 'organization', domain_id NULL (tous domaines),
--    dupliquees sur les deux org_types eligibles ('client' ET 'cabinet') qui
--    accedent aux memes offres en V1. max_seats NULL partout (sieges desactives).
--    Colonnes stripe_* laissees NULL (cablees au Lot 4).
--    Idempotence NULL-safe via NOT EXISTS (cf. entete).
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.packages
  (domain_id, name, slug, target_role, scope, price_monthly, currency, is_default, active)
select
  null, v.name, v.slug, tr.target_role, 'organization', v.price_monthly, 'EUR', v.is_default, true
from (values
  ('free',     'Free',     null::numeric, true),
  ('business', 'Business', 349::numeric,  false),
  ('elite',    'Elite',    899::numeric,  false)
) as v(slug, name, price_monthly, is_default)
cross join (values ('client'), ('cabinet')) as tr(target_role)
where not exists (
  select 1 from public.packages p
  where p.domain_id is null
    and p.slug = v.slug
    and p.target_role = tr.target_role
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. package_features — droits chiffres par package.
--    'unlimited' : chaine stockee telle quelle (value est varchar) ; la feature
--    reste typee 'integer'. reset_period lie a la NATURE de la feature (pas a la
--    valeur) : *_per_month => 'monthly', *_max / revealed_* => 'never'.
--    ON CONFLICT (package_id, feature_code) sur : cle sans NULL, fiable.
-- ─────────────────────────────────────────────────────────────────────────────

-- FREE : 2 publications/mois, 2 actives max, 1 candidat devoile, 2 unlocks/mois.
insert into public.package_features (package_id, feature_code, value, reset_period)
select p.id, f.feature_code, f.value, f.reset_period
from public.packages p
cross join (values
  ('publications_per_month',              '2', 'monthly'),
  ('active_publications_max',             '2', 'never'),
  ('revealed_candidates_per_publication', '1', 'never'),
  ('manual_unlocks_per_month',            '2', 'monthly')
) as f(feature_code, value, reset_period)
where p.domain_id is null and p.slug = 'free' and p.target_role in ('client', 'cabinet')
on conflict (package_id, feature_code) do nothing;

-- BUSINESS : publications illimitees, 5 actives max, tous devoiles, unlocks illimites.
insert into public.package_features (package_id, feature_code, value, reset_period)
select p.id, f.feature_code, f.value, f.reset_period
from public.packages p
cross join (values
  ('publications_per_month',              'unlimited', 'monthly'),
  ('active_publications_max',             '5',         'never'),
  ('revealed_candidates_per_publication', 'unlimited', 'never'),
  ('manual_unlocks_per_month',            'unlimited', 'monthly')
) as f(feature_code, value, reset_period)
where p.domain_id is null and p.slug = 'business' and p.target_role in ('client', 'cabinet')
on conflict (package_id, feature_code) do nothing;

-- ELITE : tout illimite.
insert into public.package_features (package_id, feature_code, value, reset_period)
select p.id, f.feature_code, f.value, f.reset_period
from public.packages p
cross join (values
  ('publications_per_month',              'unlimited', 'monthly'),
  ('active_publications_max',             'unlimited', 'never'),
  ('revealed_candidates_per_publication', 'unlimited', 'never'),
  ('manual_unlocks_per_month',            'unlimited', 'monthly')
) as f(feature_code, value, reset_period)
where p.domain_id is null and p.slug = 'elite' and p.target_role in ('client', 'cabinet')
on conflict (package_id, feature_code) do nothing;
