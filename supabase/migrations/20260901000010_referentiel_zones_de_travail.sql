-- ─────────────────────────────────────────────────────────────────────────────
-- RÉFÉRENTIEL DES ZONES DE TRAVAIL — continents et pays, hiérarchique
--
-- ⚠️ ORDRE D'EXÉCUTION — CETTE MIGRATION PASSE **AVANT** LE DÉPLOIEMENT DU CODE.
--    Elle n'ajoute que du nouveau (une table, une fonction) et ne touche à
--    aucune colonne lue par le code en ligne. Elle est donc sans effet tant que
--    rien ne la lit, et elle doit exister avant la migration `profil_annonce_multivalues` qui s'y
--    réfère.
--
-- POURQUOI
--   « Zones de travail » remplace « Localisation » des deux côtés du marché :
--   c'est là où un expert ACCEPTE de travailler, et là où une annonce a besoin
--   de quelqu'un. Ce n'est ni son domicile, ni le siège de l'entreprise. Un
--   expert à Tunis qui déclare l'Europe doit apparaître sur les missions
--   européennes ; la résidence ne filtre plus rien.
--
-- POURQUOI PAS DE domain_id, contrairement à branches/specialities
--   La géographie n'appartient à aucun écosystème. Une branche « Dynamics 365 »
--   n'existe que dans l'écosystème qui la déclare ; la France existe pour tout
--   le monde. Ajouter un domain_id imposerait de dupliquer 200 pays par
--   écosystème, sans qu'aucun ne puisse jamais différer. Même posture que
--   `countries`, qui n'en a pas non plus.
--
-- LA HIÉRARCHIE, ET COMMENT ELLE EST EXPLOITÉE
--   monde > continent > pays. Une annonce « Europe » doit recouper un expert
--   « France », ET un expert « Europe » doit recouper une annonce « France ».
--   Comparer des identifiants de zone ne le permet pas : les deux ensembles ne
--   se recoupent pas au même niveau.
--
--   La solution est l'APLATISSEMENT VERS LES FEUILLES. Chaque côté stocke, en
--   plus de ce qu'il a déclaré, l'ensemble des CODES PAYS que sa déclaration
--   recouvre (cf. migration `profil_annonce_multivalues`, colonnes `work_zone_countries`). Le
--   recoupement redevient alors un simple `&&` entre deux ensembles de pays,
--   symétrique par construction, et indexable en GIN.
--
--     annonce  « Europe »  ->  {AD,AL,AT,BE,...,FR,...}
--     expert   « France »  ->  {FR}
--     &&                   ->  vrai, dans les deux sens
--
--   `work_zone_country_codes()` ci-dessous est la SOURCE UNIQUE de cet
--   aplatissement. Aucun appelant ne doit reconstruire la descente à la main.
--
-- LIMITE CONNUE, ASSUMÉE
--   L'aplatissement est calculé à l'écriture. Si un pays est rattaché plus tard
--   à un continent, les lignes déjà écrites ne le connaissent pas. Le
--   référentiel étant versionné ici, toute migration qui ajoute un pays doit
--   recalculer les colonnes dérivées — une seule instruction, rappelée en fin
--   de la migration `profil_annonce_multivalues`.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── LA TABLE ────────────────────────────────────────────────────────────────
create table if not exists public.work_zones (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references public.work_zones(id) on delete restrict,
  kind         text           not null,
  -- Code stable et lisible ('WORLD', 'EU', 'FR'). Sert de clé d'idempotence au
  -- seed et de référence dans les migrations futures : jamais un uuid en dur.
  code         text           not null,
  -- Renseigné UNIQUEMENT pour kind='country'. C'est ce code qui alimente
  -- l'aplatissement, et le FK garantit qu'on ne peut pas inventer un pays.
  country_code varchar(2) references public.countries(code),
  -- Libellé FR canonique. en/es/de vivent dans `translations` (tBDD), comme
  -- branches et specialities — le FR est le repli automatique.
  name         varchar(100)   not null,
  slug         varchar(50)    not null,
  active       boolean        not null default true,
  sort_order   integer        not null default 0,
  created_at   timestamptz    not null default now(),
  updated_at   timestamptz    not null default now(),

  constraint work_zones_kind_check
    check (kind in ('world', 'continent', 'country')),

  -- Un pays porte un code pays ; rien d'autre n'en porte. Sans cette
  -- contrainte, un continent avec un country_code ferait mentir
  -- l'aplatissement en silence.
  constraint work_zones_country_code_coherence_check
    check (
      (kind =  'country' and country_code is not null)
      or
      (kind <> 'country' and country_code is null)
    ),

  -- 'world' est l'unique racine ; tout le reste est rattaché. Un orphelin
  -- serait invisible à la descente récursive.
  constraint work_zones_racine_check
    check (
      (kind =  'world' and parent_id is null)
      or
      (kind <> 'world' and parent_id is not null)
    )
);

create unique index if not exists work_zones_code_key on public.work_zones (code);
create unique index if not exists work_zones_slug_key on public.work_zones (slug);
create unique index if not exists work_zones_country_code_key
  on public.work_zones (country_code) where country_code is not null;
create index if not exists work_zones_parent_idx on public.work_zones (parent_id);
create index if not exists work_zones_active_idx  on public.work_zones (active, sort_order);

create or replace trigger trg_work_zones_updated_at
  before update on public.work_zones
  for each row execute function public.set_updated_at();

-- Référentiel public en LECTURE, comme la taxonomie : le sélecteur de zones est
-- servi par /api/taxonomy et doit être lisible sans session. Écriture réservée
-- au service-role (admin), qui bypass la RLS.
--
-- Même politique, au mot près, que branches_public_read et specialities_public_read.
alter table public.work_zones enable row level security;

drop policy if exists work_zones_public_read on public.work_zones;
create policy work_zones_public_read
  on public.work_zones for select
  using (active = true);

-- Les droits explicites sont NÉCESSAIRES : sur ce projet, `branches` et
-- `specialities` en portent (baseline), et l'event trigger `ensure_rls` n'active
-- que la RLS — il n'accorde rien.
--
-- ÉCART ASSUMÉ avec la baseline, qui accorde `all` à anon et authenticated : ici
-- on n'accorde que `select`. Il n'existe aucune policy d'écriture, donc la RLS
-- refuserait de toute façon toute écriture ; un droit plus large serait un droit
-- sans usage. Le référentiel n'est écrit que par l'admin, via service_role.
grant select on table public.work_zones to anon, authenticated;
grant all    on table public.work_zones to service_role;


-- ─── SEED : la racine et les continents ──────────────────────────────────────
-- `on conflict (code) do nothing` : la migration est rejouable.
insert into public.work_zones (parent_id, kind, code, country_code, name, slug, sort_order)
values (null, 'world', 'WORLD', null, 'Monde entier', 'monde-entier', 0)
on conflict (code) do nothing;

insert into public.work_zones (parent_id, kind, code, country_code, name, slug, sort_order)
select w.id, 'continent', c.code, null, c.name, c.slug, c.sort_order
  from public.work_zones w
  cross join (values
    ('EU', 'Europe',            'europe',            10),
    ('AF', 'Afrique',           'afrique',           20),
    ('AS', 'Asie',              'asie',              30),
    ('NA', 'Amérique du Nord',  'amerique-du-nord',  40),
    ('SA', 'Amérique du Sud',   'amerique-du-sud',   50),
    ('OC', 'Océanie',           'oceanie',           60)
  ) as c(code, name, slug, sort_order)
 where w.code = 'WORLD'
on conflict (code) do nothing;


-- ─── SEED : les pays, rattachés à leur continent ─────────────────────────────
-- La source des pays est `public.countries` (déjà peuplée, déjà traduite en 4
-- langues). On n'en duplique QUE ce qui sert à la hiérarchie.
--
-- Le rattachement passe par une table de correspondance ISO explicite plutôt
-- que par `countries.region` : `region` est une donnée libre dont le contenu
-- n'est garanti par aucune contrainte, et une zone mal rattachée est une erreur
-- de matching invisible. Une correspondance écrite ici est vérifiable en
-- relecture.
with iso_continent(country_code, continent_code) as (values
  -- Europe
  ('AD','EU'),('AL','EU'),('AT','EU'),('BA','EU'),('BE','EU'),('BG','EU'),('BY','EU'),
  ('CH','EU'),('CY','EU'),('CZ','EU'),('DE','EU'),('DK','EU'),('EE','EU'),('ES','EU'),
  ('FI','EU'),('FR','EU'),('GB','EU'),('GR','EU'),('HR','EU'),('HU','EU'),('IE','EU'),
  ('IS','EU'),('IT','EU'),('LI','EU'),('LT','EU'),('LU','EU'),('LV','EU'),('MC','EU'),
  ('MD','EU'),('ME','EU'),('MK','EU'),('MT','EU'),('NL','EU'),('NO','EU'),('PL','EU'),
  ('PT','EU'),('RO','EU'),('RS','EU'),('RU','EU'),('SE','EU'),('SI','EU'),('SK','EU'),
  ('SM','EU'),('UA','EU'),('VA','EU'),('XK','EU'),
  -- Afrique
  ('AO','AF'),('BF','AF'),('BI','AF'),('BJ','AF'),('BW','AF'),('CD','AF'),('CF','AF'),
  ('CG','AF'),('CI','AF'),('CM','AF'),('CV','AF'),('DJ','AF'),('DZ','AF'),('EG','AF'),
  ('EH','AF'),('ER','AF'),('ET','AF'),('GA','AF'),('GH','AF'),('GM','AF'),('GN','AF'),
  ('GQ','AF'),('GW','AF'),('KE','AF'),('KM','AF'),('LR','AF'),('LS','AF'),('LY','AF'),
  ('MA','AF'),('MG','AF'),('ML','AF'),('MR','AF'),('MU','AF'),('MW','AF'),('MZ','AF'),
  ('NA','AF'),('NE','AF'),('NG','AF'),('RW','AF'),('SC','AF'),('SD','AF'),('SL','AF'),
  ('SN','AF'),('SO','AF'),('SS','AF'),('ST','AF'),('SZ','AF'),('TD','AF'),('TG','AF'),
  ('TN','AF'),('TZ','AF'),('UG','AF'),('ZA','AF'),('ZM','AF'),('ZW','AF'),
  -- Asie
  ('AE','AS'),('AF','AS'),('AM','AS'),('AZ','AS'),('BD','AS'),('BH','AS'),('BN','AS'),
  ('BT','AS'),('CN','AS'),('GE','AS'),('HK','AS'),('ID','AS'),('IL','AS'),('IN','AS'),
  ('IQ','AS'),('IR','AS'),('JO','AS'),('JP','AS'),('KG','AS'),('KH','AS'),('KP','AS'),
  ('KR','AS'),('KW','AS'),('KZ','AS'),('LA','AS'),('LB','AS'),('LK','AS'),('MM','AS'),
  ('MN','AS'),('MO','AS'),('MV','AS'),('MY','AS'),('NP','AS'),('OM','AS'),('PH','AS'),
  ('PK','AS'),('PS','AS'),('QA','AS'),('SA','AS'),('SG','AS'),('SY','AS'),('TH','AS'),
  ('TJ','AS'),('TM','AS'),('TR','AS'),('TW','AS'),('UZ','AS'),('VN','AS'),('YE','AS'),
  -- Amérique du Nord (Amérique centrale et Caraïbes incluses)
  ('AG','NA'),('BB','NA'),('BS','NA'),('BZ','NA'),('CA','NA'),('CR','NA'),('CU','NA'),
  ('DM','NA'),('DO','NA'),('GD','NA'),('GT','NA'),('HN','NA'),('HT','NA'),('JM','NA'),
  ('KN','NA'),('LC','NA'),('MX','NA'),('NI','NA'),('PA','NA'),('PR','NA'),('SV','NA'),
  ('TT','NA'),('US','NA'),('VC','NA'),
  -- Amérique du Sud
  ('AR','SA'),('BO','SA'),('BR','SA'),('CL','SA'),('CO','SA'),('EC','SA'),('GF','SA'),
  ('GY','SA'),('PE','SA'),('PY','SA'),('SR','SA'),('UY','SA'),('VE','SA'),
  -- Océanie
  ('AU','OC'),('FJ','OC'),('NC','OC'),('NZ','OC'),('PF','OC'),('PG','OC'),('SB','OC'),
  ('VU','OC'),('WS','OC')
)
insert into public.work_zones (parent_id, kind, code, country_code, name, slug, sort_order)
select cont.id,
       'country',
       'C_' || co.code,
       co.code,
       co.name_fr,
       'pays-' || lower(co.code),
       co.sort_order
  from public.countries  co
  join iso_continent     ic   on ic.country_code = co.code
  join public.work_zones cont on cont.code = ic.continent_code
 where co.active = true
on conflict (code) do nothing;

-- Filet de relecture : signale les pays actifs qu'aucune ligne de la
-- correspondance ci-dessus ne rattache. Ils seraient INVISIBLES au sélecteur et
-- au matching, sans qu'aucune erreur ne le dise. Une notice, pas une exception :
-- un pays exotique manquant ne doit pas bloquer un déploiement.
do $$
declare v_orphelins text;
begin
  select string_agg(co.code, ', ' order by co.code) into v_orphelins
    from public.countries co
   where co.active = true
     and not exists (select 1 from public.work_zones w where w.country_code = co.code);
  if v_orphelins is not null then
    raise notice
      'work_zones: pays actifs NON rattachés à un continent (invisibles au matching) : %',
      v_orphelins;
  end if;
end
$$;


-- ─── TRADUCTIONS (en/es/de) — le FR est le repli automatique de tBDD ─────────
-- Continents : libellés écrits ici, seule source possible.
insert into public.translations (table_name, row_id, field, locale, value)
select 'work_zones', w.id, 'name', t.locale, t.value
  from public.work_zones w
  join (values
    ('EU','en','Europe'),        ('EU','es','Europa'),          ('EU','de','Europa'),
    ('AF','en','Africa'),        ('AF','es','África'),          ('AF','de','Afrika'),
    ('AS','en','Asia'),          ('AS','es','Asia'),            ('AS','de','Asien'),
    ('NA','en','North America'), ('NA','es','América del Norte'),('NA','de','Nordamerika'),
    ('SA','en','South America'), ('SA','es','América del Sur'), ('SA','de','Südamerika'),
    ('OC','en','Oceania'),       ('OC','es','Oceanía'),         ('OC','de','Ozeanien'),
    ('WORLD','en','Worldwide'),  ('WORLD','es','Todo el mundo'),('WORLD','de','Weltweit')
  ) as t(code, locale, value) on t.code = w.code
on conflict do nothing;

-- Pays : recopiés depuis `countries`, déjà traduit en 4 langues. On recopie au
-- lieu de lire `countries` à la volée pour que TOUTE la taxonomie ait UN SEUL
-- chemin de lecture (tBDD) — un second chemin réservé aux pays serait une
-- exception à maintenir pour toujours.
-- Contrepartie assumée : un renommage ultérieur dans `countries` ne se propage
-- pas seul. La commande de rattrapage est en fin de fichier.
insert into public.translations (table_name, row_id, field, locale, value)
select 'work_zones', w.id, 'name', l.locale,
       case l.locale when 'en' then co.name_en
                     when 'es' then co.name_es
                     when 'de' then co.name_de end
  from public.work_zones w
  join public.countries  co on co.code = w.country_code
  cross join (values ('en'), ('es'), ('de')) as l(locale)
 where w.kind = 'country'
on conflict do nothing;


-- ─── APLATISSEMENT VERS LES FEUILLES — source unique ─────────────────────────
-- Rend l'ensemble des codes pays couverts par des zones déclarées, à n'importe
-- quel niveau de la hiérarchie. C'est la fonction sur laquelle repose tout le
-- recoupement géographique du matching.
--
-- STABLE : le résultat ne dépend que des arguments et du contenu de la table
-- dans la transaction courante — utilisable dans un index d'expression futur et
-- dans un trigger sans surcoût de replanification.
--
-- Zones inactives ignorées : désactiver un pays le retire du matching à la
-- prochaine écriture, sans supprimer la ligne ni casser les FK.
create or replace function public.work_zone_country_codes(p_zone_ids uuid[])
  returns varchar(2)[]
  language sql
  stable
  set search_path to 'public'
as $fn$
  with recursive descente as (
    select z.id, z.country_code
      from public.work_zones z
     where z.id = any(coalesce(p_zone_ids, '{}'::uuid[]))
       and z.active
    union
    select enfant.id, enfant.country_code
      from public.work_zones enfant
      join descente d on enfant.parent_id = d.id
     where enfant.active
  )
  select coalesce(
           array_agg(distinct country_code order by country_code)
             filter (where country_code is not null),
           '{}'::varchar(2)[]
         )
    from descente;
$fn$;

comment on function public.work_zone_country_codes(uuid[]) is
  'Aplatit des zones de travail déclarées vers l''ensemble des codes pays couverts. '
  'SOURCE UNIQUE du recoupement géographique : ne jamais réécrire la descente ailleurs. '
  'Après tout ajout ou rattachement de pays, recalculer les colonnes dérivées : '
  'update public.profiles     set work_zone_ids = work_zone_ids; '
  'update public.publications set work_zone_ids = work_zone_ids;';
