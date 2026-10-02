-- ════════════════════════════════════════════════════════════════════════════
--  LA LISTE DES PAYS DES ZONES DE TRAVAIL : TOUS LES PAYS, LES QUATRE DU ROYAUME-UNI, SANS ISRAËL
--  (lot finitions et pays, 02/10/2026 — décisions de Youssef, points 3 à 5 ; pas de régions).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Le code en ligne ne change pas pour ce lot : il lit `work_zones` par
--  code et par `active` (/api/taxonomy, /api/profile, /api/publications), et lit `work_zone_countries` comme une liste
--  de chaînes (lib/matching). Rien de ce qu'il ÉCRIT n'est refusé par une contrainte nouvelle : `work_zones` n'est
--  écrite par aucun code (le référentiel ne s'écrit que par migration — `diag-deux-temps` le PROUVE, exceptions
--  raisonnées), et les deux colonnes `work_zone_countries` sont ÉLARGIES (varchar(2)[] → text[]), jamais restreintes.
--  Un seul refus nouveau, et il est NOMMÉ : une page chargée AVANT le push qui renverrait « Royaume-Uni » ou « Israël »
--  reçoit 400 `bad_work_zone` (« zone inconnue ») — la règle des zones inactives, en place, que l'écran rend par son
--  message ; rien n'est écrit à moitié. Le séparer en un second temps ne l'éviterait pas (le code du lot est le même).
--
--  CE QUI CHANGE, ET POURQUOI
--   1. LA LISTE DES ZONES SE DÉTACHE DE `countries`. `countries` (64 pays) sert l'ADRESSE, le pays de l'ORGANISATION
--      et sa VÉRIFICATION, le TÉLÉPHONE et les réglages par pays de l'admin : y ajouter 130 pays aurait changé toutes
--      ces listes, et le Royaume-Uni doit y rester UN pays. Les zones portent déjà leurs noms (`work_zones.name` et
--      `translations`) : seule la clé étrangère `work_zones.country_code → countries` les y liait. Elle est retirée,
--      et remplacée par une contrainte de FORME (`work_zones_code_pays_forme`) : un code ISO 3166-1 (`FR`), ou ISO
--      3166-2 pour une nation (`GB-ENG`). Aucune ligne de `countries` n'est lue, écrite ni changée.
--   2. LE ROYAUME-UNI DEVIENT SES QUATRE PAYS, dans la liste des zones SEULEMENT : Angleterre (GB-ENG), Écosse (GB-SCT),
--      Pays de Galles (GB-WLS), Irlande du Nord (GB-NIR), en Europe, nommés dans les quatre langues. Chacun a son code :
--      un expert « Angleterre » ne recoupe pas une mission « Écosse ». Les codes ont plus de deux caractères : la
--      colonne `country_code`, les deux listes aplaties `work_zone_countries` et l'aplatissement
--      `work_zone_country_codes()` passent au type `text` (la fonction change de type de retour : supprimée et recréée
--      ICI, même signature, dans la même transaction — aucun code ne l'appelle par `.rpc`). Profils et annonces qui
--      avaient le Royaume-Uni reçoivent les quatre, sans perte (`remplacer_zone_de_travail`) ; puis la zone
--      « Royaume-Uni » est désactivée.
--   3. ISRAËL QUITTE LA LISTE : sa zone est désactivée. Le déclencheur en place recalcule la couverture de ceux qui
--      l'avaient choisi (ou l'Asie, ou le monde) ; une liste devenue vide ne retient plus personne (règle en place,
--      lib/matching). La requête d'avant-push COMPTE, avant le push, les profils et annonces qui l'avaient choisi.
--   4. TOUS LES AUTRES PAYS : chaque État membre et observateur de l'ONU (Saint-Siège, Palestine), Israël excepté, a
--      sa zone. Les 64 rattachements existants NE CHANGENT PAS (Chypre reste en Europe) ; un pays nouveau va dans le
--      continent de la division géographique de l'ONU (M49), l'Amérique centrale et les Caraïbes avec l'Amérique du
--      Nord. Noms : CLDR (fr, en, es, de), corrigés là où il abrège (« Congo-Kinshasa », « St. Lucia ») ; le français
--      dans `work_zones.name`, les trois autres dans `translations`. Un pays déjà présent n'est pas touché (`not
--      exists` sur le code pays, puis `on conflict do nothing`) : staging (64 zones) et une base neuve (64, par
--      `zones_pays_rattaches`) aboutissent à la MÊME liste — 197 pays actifs. Les continents entiers et « Partout dans
--      le monde » les couvrent : le déclencheur `work_zones_couverture` recalcule à chaque insertion.
--
--  Colonnes et contraintes lues (§G.10) : work_zones (parent_id → work_zones ON DELETE RESTRICT ; kind world/continent/
--  country ; country_code varchar(2) → countries(code), unique quand non nul ; cohérence pays ⇔ code ; racine unique ;
--  code et slug uniques ; name varchar(100) et slug varchar(50) NOT NULL ; active NOT NULL ; déclencheurs
--  trg_work_zones_updated_at et work_zones_couverture — ce dernier cite `country_code` dans son UPDATE OF : PostgreSQL
--  refuse de changer le type d'une colonne citée par un déclencheur, il est retiré puis reposé À L'IDENTIQUE) ;
--  profiles et publications (work_zone_ids uuid[] NOT NULL ; work_zone_countries varchar(2)[] NOT NULL défaut '{}',
--  index GIN, DÉRIVÉE par trg_*_work_zones ; contraintes profiles_visible_requiert_criteres_check et
--  publications_publiee_requiert_zones_check — sur work_zone_ids, jamais vidé ici) ; translations (clé table_name,
--  row_id, field, locale ; value NOT NULL ; garde translations_specialite_autre — table_name = 'specialities'
--  seulement). Aucune vue ne lit ces colonnes.
--
--  Prouvée par tests/database/matching/zones_liste_des_pays.test.sql, sur une base construite depuis zéro.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. LE CODE PAYS D'UNE ZONE : détaché de `countries`, une forme tenue en base ────────────────────────────────────
drop trigger if exists work_zones_couverture on public.work_zones;

alter table public.work_zones drop constraint if exists work_zones_country_code_fkey;
alter table public.work_zones alter column country_code type text;

alter table public.work_zones
  add constraint work_zones_code_pays_forme
  check (country_code is null or country_code ~ '^[A-Z]{2}(-[A-Z]{3})?$');

comment on column public.work_zones.country_code is
  'Le code qui alimente l''aplatissement des zones (work_zone_countries) : ISO 3166-1 (FR) ou ISO 3166-2 pour une nation (GB-ENG). Détaché de countries (adresse, organisation, téléphone) depuis la migration zones_liste_des_pays.';

-- Le déclencheur de couverture, reposé À L'IDENTIQUE (migration zones_couverture_suit_le_referentiel).
create trigger work_zones_couverture
  after insert or update of parent_id, active, country_code or delete on public.work_zones
  for each row execute function public.work_zones_couverture();

-- ── 2. LES LISTES APLATIES ET L'APLATISSEMENT, EN `text` ────────────────────────────────────────────────────────────
alter table public.profiles     alter column work_zone_countries type text[] using work_zone_countries::text[];
alter table public.profiles     alter column work_zone_countries set default '{}'::text[];
alter table public.publications alter column work_zone_countries type text[] using work_zone_countries::text[];
alter table public.publications alter column work_zone_countries set default '{}'::text[];

-- Le type de retour change : `create or replace` le refuse. Même signature, même corps, recréée dans la transaction.
drop function public.work_zone_country_codes(uuid[]);

create function public.work_zone_country_codes(p_zone_ids uuid[])
  returns text[]
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
           '{}'::text[]
         )
    from descente;
$fn$;

comment on function public.work_zone_country_codes(uuid[]) is
  'Aplatit des zones de travail déclarées vers l''ensemble des codes pays couverts (ISO 3166-1, ou 3166-2 pour une nation). '
  'SOURCE UNIQUE du recoupement géographique : ne jamais réécrire la descente ailleurs. '
  'Un pays ajouté, déplacé, activé ou désactivé recalcule les couvertures (déclencheur work_zones_couverture).';

-- ── 3. TOUS LES PAYS : chaque État membre et observateur de l'ONU, Israël excepté, et les quatre du Royaume-Uni ──────
do $liste$
declare
  v_pays  integer;
  v_trad  integer;
begin
  with liste(country_code, continent_code, fr, en, es, de) as (values
    -- Les 131 pays NOUVEAUX : membres et observateurs de l'ONU absents des 64 de départ (Israël excepté).
    ('BY', 'EU', 'Biélorussie', 'Belarus', 'Bielorrusia', 'Belarus'),
    ('RU', 'EU', 'Russie', 'Russia', 'Rusia', 'Russland'),
    ('AO', 'AF', 'Angola', 'Angola', 'Angola', 'Angola'),
    ('BJ', 'AF', 'Bénin', 'Benin', 'Benín', 'Benin'),
    ('BW', 'AF', 'Botswana', 'Botswana', 'Botsuana', 'Botsuana'),
    ('BF', 'AF', 'Burkina Faso', 'Burkina Faso', 'Burkina Faso', 'Burkina Faso'),
    ('BI', 'AF', 'Burundi', 'Burundi', 'Burundi', 'Burundi'),
    ('CV', 'AF', 'Cap-Vert', 'Cape Verde', 'Cabo Verde', 'Cabo Verde'),
    ('CF', 'AF', 'République centrafricaine', 'Central African Republic', 'República Centroafricana', 'Zentralafrikanische Republik'),
    ('TD', 'AF', 'Tchad', 'Chad', 'Chad', 'Tschad'),
    ('KM', 'AF', 'Comores', 'Comoros', 'Comoras', 'Komoren'),
    ('CG', 'AF', 'République du Congo', 'Republic of the Congo', 'República del Congo', 'Republik Kongo'),
    ('CD', 'AF', 'République démocratique du Congo', 'Democratic Republic of the Congo', 'República Democrática del Congo', 'Demokratische Republik Kongo'),
    ('DJ', 'AF', 'Djibouti', 'Djibouti', 'Yibuti', 'Dschibuti'),
    ('GQ', 'AF', 'Guinée équatoriale', 'Equatorial Guinea', 'Guinea Ecuatorial', 'Äquatorialguinea'),
    ('ER', 'AF', 'Érythrée', 'Eritrea', 'Eritrea', 'Eritrea'),
    ('SZ', 'AF', 'Eswatini', 'Eswatini', 'Esuatini', 'Eswatini'),
    ('ET', 'AF', 'Éthiopie', 'Ethiopia', 'Etiopía', 'Äthiopien'),
    ('GA', 'AF', 'Gabon', 'Gabon', 'Gabón', 'Gabun'),
    ('GM', 'AF', 'Gambie', 'Gambia', 'Gambia', 'Gambia'),
    ('GH', 'AF', 'Ghana', 'Ghana', 'Ghana', 'Ghana'),
    ('GN', 'AF', 'Guinée', 'Guinea', 'Guinea', 'Guinea'),
    ('GW', 'AF', 'Guinée-Bissau', 'Guinea-Bissau', 'Guinea-Bisáu', 'Guinea-Bissau'),
    ('KE', 'AF', 'Kenya', 'Kenya', 'Kenia', 'Kenia'),
    ('LS', 'AF', 'Lesotho', 'Lesotho', 'Lesoto', 'Lesotho'),
    ('LR', 'AF', 'Liberia', 'Liberia', 'Liberia', 'Liberia'),
    ('LY', 'AF', 'Libye', 'Libya', 'Libia', 'Libyen'),
    ('MG', 'AF', 'Madagascar', 'Madagascar', 'Madagascar', 'Madagaskar'),
    ('MW', 'AF', 'Malawi', 'Malawi', 'Malaui', 'Malawi'),
    ('ML', 'AF', 'Mali', 'Mali', 'Mali', 'Mali'),
    ('MR', 'AF', 'Mauritanie', 'Mauritania', 'Mauritania', 'Mauretanien'),
    ('MZ', 'AF', 'Mozambique', 'Mozambique', 'Mozambique', 'Mosambik'),
    ('NA', 'AF', 'Namibie', 'Namibia', 'Namibia', 'Namibia'),
    ('NE', 'AF', 'Niger', 'Niger', 'Níger', 'Niger'),
    ('NG', 'AF', 'Nigeria', 'Nigeria', 'Nigeria', 'Nigeria'),
    ('RW', 'AF', 'Rwanda', 'Rwanda', 'Ruanda', 'Ruanda'),
    ('ST', 'AF', 'Sao Tomé-et-Principe', 'São Tomé and Príncipe', 'Santo Tomé y Príncipe', 'São Tomé und Príncipe'),
    ('SC', 'AF', 'Seychelles', 'Seychelles', 'Seychelles', 'Seychellen'),
    ('SL', 'AF', 'Sierra Leone', 'Sierra Leone', 'Sierra Leona', 'Sierra Leone'),
    ('SO', 'AF', 'Somalie', 'Somalia', 'Somalia', 'Somalia'),
    ('ZA', 'AF', 'Afrique du Sud', 'South Africa', 'Sudáfrica', 'Südafrika'),
    ('SS', 'AF', 'Soudan du Sud', 'South Sudan', 'Sudán del Sur', 'Südsudan'),
    ('SD', 'AF', 'Soudan', 'Sudan', 'Sudán', 'Sudan'),
    ('TZ', 'AF', 'Tanzanie', 'Tanzania', 'Tanzania', 'Tansania'),
    ('TG', 'AF', 'Togo', 'Togo', 'Togo', 'Togo'),
    ('UG', 'AF', 'Ouganda', 'Uganda', 'Uganda', 'Uganda'),
    ('ZM', 'AF', 'Zambie', 'Zambia', 'Zambia', 'Sambia'),
    ('ZW', 'AF', 'Zimbabwe', 'Zimbabwe', 'Zimbabue', 'Simbabwe'),
    ('KZ', 'AS', 'Kazakhstan', 'Kazakhstan', 'Kazajistán', 'Kasachstan'),
    ('KG', 'AS', 'Kirghizstan', 'Kyrgyzstan', 'Kirguistán', 'Kirgisistan'),
    ('TJ', 'AS', 'Tadjikistan', 'Tajikistan', 'Tayikistán', 'Tadschikistan'),
    ('TM', 'AS', 'Turkménistan', 'Turkmenistan', 'Turkmenistán', 'Turkmenistan'),
    ('UZ', 'AS', 'Ouzbékistan', 'Uzbekistan', 'Uzbekistán', 'Usbekistan'),
    ('CN', 'AS', 'Chine', 'China', 'China', 'China'),
    ('KP', 'AS', 'Corée du Nord', 'North Korea', 'Corea del Norte', 'Nordkorea'),
    ('KR', 'AS', 'Corée du Sud', 'South Korea', 'Corea del Sur', 'Südkorea'),
    ('MN', 'AS', 'Mongolie', 'Mongolia', 'Mongolia', 'Mongolei'),
    ('BN', 'AS', 'Brunei', 'Brunei', 'Brunéi', 'Brunei'),
    ('KH', 'AS', 'Cambodge', 'Cambodia', 'Camboya', 'Kambodscha'),
    ('ID', 'AS', 'Indonésie', 'Indonesia', 'Indonesia', 'Indonesien'),
    ('LA', 'AS', 'Laos', 'Laos', 'Laos', 'Laos'),
    ('MY', 'AS', 'Malaisie', 'Malaysia', 'Malasia', 'Malaysia'),
    ('MM', 'AS', 'Myanmar', 'Myanmar', 'Myanmar', 'Myanmar'),
    ('PH', 'AS', 'Philippines', 'Philippines', 'Filipinas', 'Philippinen'),
    ('TH', 'AS', 'Thaïlande', 'Thailand', 'Tailandia', 'Thailand'),
    ('TL', 'AS', 'Timor oriental', 'Timor-Leste', 'Timor-Leste', 'Timor-Leste'),
    ('VN', 'AS', 'Viêt Nam', 'Vietnam', 'Vietnam', 'Vietnam'),
    ('AF', 'AS', 'Afghanistan', 'Afghanistan', 'Afganistán', 'Afghanistan'),
    ('BD', 'AS', 'Bangladesh', 'Bangladesh', 'Bangladés', 'Bangladesch'),
    ('BT', 'AS', 'Bhoutan', 'Bhutan', 'Bután', 'Bhutan'),
    ('IR', 'AS', 'Iran', 'Iran', 'Irán', 'Iran'),
    ('MV', 'AS', 'Maldives', 'Maldives', 'Maldivas', 'Malediven'),
    ('NP', 'AS', 'Népal', 'Nepal', 'Nepal', 'Nepal'),
    ('PK', 'AS', 'Pakistan', 'Pakistan', 'Pakistán', 'Pakistan'),
    ('LK', 'AS', 'Sri Lanka', 'Sri Lanka', 'Sri Lanka', 'Sri Lanka'),
    ('AM', 'AS', 'Arménie', 'Armenia', 'Armenia', 'Armenien'),
    ('AZ', 'AS', 'Azerbaïdjan', 'Azerbaijan', 'Azerbaiyán', 'Aserbaidschan'),
    ('BH', 'AS', 'Bahreïn', 'Bahrain', 'Baréin', 'Bahrain'),
    ('GE', 'AS', 'Géorgie', 'Georgia', 'Georgia', 'Georgien'),
    ('IQ', 'AS', 'Irak', 'Iraq', 'Irak', 'Irak'),
    ('JO', 'AS', 'Jordanie', 'Jordan', 'Jordania', 'Jordanien'),
    ('KW', 'AS', 'Koweït', 'Kuwait', 'Kuwait', 'Kuwait'),
    ('LB', 'AS', 'Liban', 'Lebanon', 'Líbano', 'Libanon'),
    ('OM', 'AS', 'Oman', 'Oman', 'Omán', 'Oman'),
    ('QA', 'AS', 'Qatar', 'Qatar', 'Catar', 'Katar'),
    ('SA', 'AS', 'Arabie saoudite', 'Saudi Arabia', 'Arabia Saudí', 'Saudi-Arabien'),
    ('SY', 'AS', 'Syrie', 'Syria', 'Siria', 'Syrien'),
    ('TR', 'AS', 'Turquie', 'Türkiye', 'Turquía', 'Türkei'),
    ('YE', 'AS', 'Yémen', 'Yemen', 'Yemen', 'Jemen'),
    ('PS', 'AS', 'Palestine', 'Palestine', 'Palestina', 'Palästina'),
    ('BZ', 'NA', 'Belize', 'Belize', 'Belice', 'Belize'),
    ('CR', 'NA', 'Costa Rica', 'Costa Rica', 'Costa Rica', 'Costa Rica'),
    ('SV', 'NA', 'Salvador', 'El Salvador', 'El Salvador', 'El Salvador'),
    ('GT', 'NA', 'Guatemala', 'Guatemala', 'Guatemala', 'Guatemala'),
    ('HN', 'NA', 'Honduras', 'Honduras', 'Honduras', 'Honduras'),
    ('NI', 'NA', 'Nicaragua', 'Nicaragua', 'Nicaragua', 'Nicaragua'),
    ('PA', 'NA', 'Panama', 'Panama', 'Panamá', 'Panama'),
    ('AG', 'NA', 'Antigua-et-Barbuda', 'Antigua and Barbuda', 'Antigua y Barbuda', 'Antigua und Barbuda'),
    ('BS', 'NA', 'Bahamas', 'Bahamas', 'Bahamas', 'Bahamas'),
    ('BB', 'NA', 'Barbade', 'Barbados', 'Barbados', 'Barbados'),
    ('CU', 'NA', 'Cuba', 'Cuba', 'Cuba', 'Kuba'),
    ('DM', 'NA', 'Dominique', 'Dominica', 'Dominica', 'Dominica'),
    ('DO', 'NA', 'République dominicaine', 'Dominican Republic', 'República Dominicana', 'Dominikanische Republik'),
    ('GD', 'NA', 'Grenade', 'Grenada', 'Granada', 'Grenada'),
    ('HT', 'NA', 'Haïti', 'Haiti', 'Haití', 'Haiti'),
    ('JM', 'NA', 'Jamaïque', 'Jamaica', 'Jamaica', 'Jamaika'),
    ('KN', 'NA', 'Saint-Christophe-et-Niévès', 'Saint Kitts and Nevis', 'San Cristóbal y Nieves', 'St. Kitts und Nevis'),
    ('LC', 'NA', 'Sainte-Lucie', 'Saint Lucia', 'Santa Lucía', 'St. Lucia'),
    ('VC', 'NA', 'Saint-Vincent-et-les-Grenadines', 'Saint Vincent and the Grenadines', 'San Vicente y las Granadinas', 'St. Vincent und die Grenadinen'),
    ('TT', 'NA', 'Trinité-et-Tobago', 'Trinidad and Tobago', 'Trinidad y Tobago', 'Trinidad und Tobago'),
    ('BO', 'SA', 'Bolivie', 'Bolivia', 'Bolivia', 'Bolivien'),
    ('CO', 'SA', 'Colombie', 'Colombia', 'Colombia', 'Kolumbien'),
    ('EC', 'SA', 'Équateur', 'Ecuador', 'Ecuador', 'Ecuador'),
    ('GY', 'SA', 'Guyana', 'Guyana', 'Guyana', 'Guyana'),
    ('PY', 'SA', 'Paraguay', 'Paraguay', 'Paraguay', 'Paraguay'),
    ('PE', 'SA', 'Pérou', 'Peru', 'Perú', 'Peru'),
    ('SR', 'SA', 'Suriname', 'Suriname', 'Surinam', 'Suriname'),
    ('UY', 'SA', 'Uruguay', 'Uruguay', 'Uruguay', 'Uruguay'),
    ('VE', 'SA', 'Venezuela', 'Venezuela', 'Venezuela', 'Venezuela'),
    ('FJ', 'OC', 'Fidji', 'Fiji', 'Fiyi', 'Fidschi'),
    ('KI', 'OC', 'Kiribati', 'Kiribati', 'Kiribati', 'Kiribati'),
    ('MH', 'OC', 'Îles Marshall', 'Marshall Islands', 'Islas Marshall', 'Marshallinseln'),
    ('FM', 'OC', 'Micronésie', 'Micronesia', 'Micronesia', 'Mikronesien'),
    ('NR', 'OC', 'Nauru', 'Nauru', 'Nauru', 'Nauru'),
    ('PW', 'OC', 'Palaos', 'Palau', 'Palaos', 'Palau'),
    ('PG', 'OC', 'Papouasie-Nouvelle-Guinée', 'Papua New Guinea', 'Papúa Nueva Guinea', 'Papua-Neuguinea'),
    ('WS', 'OC', 'Samoa', 'Samoa', 'Samoa', 'Samoa'),
    ('SB', 'OC', 'Îles Salomon', 'Solomon Islands', 'Islas Salomón', 'Salomonen'),
    ('TO', 'OC', 'Tonga', 'Tonga', 'Tonga', 'Tonga'),
    ('TV', 'OC', 'Tuvalu', 'Tuvalu', 'Tuvalu', 'Tuvalu'),
    ('VU', 'OC', 'Vanuatu', 'Vanuatu', 'Vanuatu', 'Vanuatu'),
    -- Les quatre pays du Royaume-Uni (ISO 3166-2), en Europe.
    ('GB-ENG', 'EU', 'Angleterre', 'England', 'Inglaterra', 'England'),
    ('GB-SCT', 'EU', 'Écosse', 'Scotland', 'Escocia', 'Schottland'),
    ('GB-WLS', 'EU', 'Pays de Galles', 'Wales', 'Gales', 'Wales'),
    ('GB-NIR', 'EU', 'Irlande du Nord', 'Northern Ireland', 'Irlanda del Norte', 'Nordirland')
  ),
  ajoutes as (
    insert into public.work_zones (parent_id, kind, code, country_code, name, slug, sort_order)
    select cont.id, 'country', 'C_' || l.country_code, l.country_code, l.fr, 'pays-' || lower(l.country_code), 1000
      from liste l
      join public.work_zones cont on cont.code = l.continent_code and cont.kind = 'continent'
     where not exists (select 1 from public.work_zones w where w.country_code = l.country_code)
    on conflict (code) do nothing
    returning id, country_code
  ),
  traduites as (
    insert into public.translations (table_name, row_id, field, locale, value)
    select 'work_zones', a.id, 'name', t.locale, t.value
      from ajoutes a
      join liste l on l.country_code = a.country_code
      cross join lateral (values ('en', l.en), ('es', l.es), ('de', l.de)) as t(locale, value)
    on conflict do nothing
    returning 1
  )
  select (select count(*) from ajoutes), (select count(*) from traduites) into v_pays, v_trad;

  raise notice 'zones de travail : % pays ajouté(s) à la liste, % traduction(s) posée(s)', v_pays, v_trad;
end
$liste$;

-- ── 4. REMPLACER UNE ZONE PAR D'AUTRES DANS LES PROFILS ET LES ANNONCES — une fonction, appelée par la reprise ──────
--  Le Royaume-Uni → ses quatre pays : chaque profil et chaque annonce qui citait l'ancienne zone cite les nouvelles,
--  sans rien perdre d'autre (l'ordre des zones est gardé, une zone déjà présente n'est pas doublée). La réécriture de
--  `work_zone_ids` déclenche `sync_work_zone_countries()` : la liste aplatie suit, par la source unique.
create or replace function public.remplacer_zone_de_travail(p_ancienne text, p_nouvelles text[])
  returns jsonb
  language plpgsql
  set search_path to 'public'
as $fn$
declare
  v_ancienne  uuid;
  v_nouvelles uuid[];
  v_profils   integer;
  v_annonces  integer;
begin
  select z.id into v_ancienne from public.work_zones z where z.code = p_ancienne;
  if v_ancienne is null then
    raise exception using errcode = 'ZN001', message = format('zone à remplacer introuvable : %s', p_ancienne);
  end if;

  select coalesce(array_agg(z.id order by z.code), '{}'::uuid[]) into v_nouvelles
    from public.work_zones z
   where z.code = any (coalesce(p_nouvelles, '{}'::text[])) and z.kind = 'country' and z.active;
  if cardinality(v_nouvelles) = 0 or cardinality(v_nouvelles) <> cardinality(array(select distinct unnest(p_nouvelles))) then
    raise exception using errcode = 'ZN002', message = format('zones de remplacement introuvables ou inactives : %s', p_nouvelles);
  end if;

  update public.profiles p
     set work_zone_ids = array_remove(p.work_zone_ids, v_ancienne)
                         || array(select n from unnest(v_nouvelles) n where n <> all (p.work_zone_ids))
   where v_ancienne = any (p.work_zone_ids);
  get diagnostics v_profils = row_count;

  update public.publications u
     set work_zone_ids = array_remove(u.work_zone_ids, v_ancienne)
                         || array(select n from unnest(v_nouvelles) n where n <> all (u.work_zone_ids))
   where v_ancienne = any (u.work_zone_ids);
  get diagnostics v_annonces = row_count;

  return jsonb_build_object('profils', v_profils, 'annonces', v_annonces);
end
$fn$;

revoke all on function public.remplacer_zone_de_travail(text, text[]) from public, anon, authenticated;

comment on function public.remplacer_zone_de_travail(text, text[]) is
  'Remplace, dans les work_zone_ids des profils et des annonces, une zone (par son code) par d''autres zones pays actives, sans rien perdre d''autre ; la liste aplatie suit par sync_work_zone_countries. ZN001 : zone à remplacer introuvable. ZN002 : une zone de remplacement introuvable ou inactive. Appelée par la reprise de la migration zones_liste_des_pays (Royaume-Uni → ses quatre pays).';

-- ── 5. LA REPRISE — son propre bloc (§G.4 ter) : le Royaume-Uni devient ses quatre pays, puis Israël et lui sortent ──
do $reprise$
declare
  v_bilan jsonb;
begin
  if exists (select 1 from public.work_zones z where z.code = 'C_GB') then
    v_bilan := public.remplacer_zone_de_travail('C_GB', array['C_GB-ENG', 'C_GB-SCT', 'C_GB-WLS', 'C_GB-NIR']);
    raise notice 'Royaume-Uni → ses quatre pays : % profil(s) et % annonce(s) les reçoivent',
      v_bilan ->> 'profils', v_bilan ->> 'annonces';
  else
    raise notice 'Royaume-Uni : aucune zone à remplacer';
  end if;

  -- La désactivation passe par le déclencheur : la couverture de qui avait choisi ces zones, ou un ancêtre, suit.
  update public.work_zones set active = false where code in ('C_GB', 'C_IL') and active;
end
$reprise$;

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if exists (select 1 from pg_constraint k
              where k.conrelid = 'public.work_zones'::regclass and k.contype = 'f'
                and k.confrelid = 'public.countries'::regclass) then
    raise exception 'postcondition NON TENUE : work_zones est encore liée à countries';
  end if;
  if not exists (select 1 from pg_constraint k
                  where k.conrelid = 'public.work_zones'::regclass and k.conname = 'work_zones_code_pays_forme' and k.convalidated) then
    raise exception 'postcondition NON TENUE : la contrainte work_zones_code_pays_forme manque ou n''est pas validée';
  end if;
  if (select a.atttypid from pg_attribute a where a.attrelid = 'public.work_zones'::regclass and a.attname = 'country_code') <> 'text'::regtype
     or (select a.atttypid from pg_attribute a where a.attrelid = 'public.profiles'::regclass and a.attname = 'work_zone_countries') <> 'text[]'::regtype
     or (select a.atttypid from pg_attribute a where a.attrelid = 'public.publications'::regclass and a.attname = 'work_zone_countries') <> 'text[]'::regtype then
    raise exception 'postcondition NON TENUE : un code pays de zone n''est pas en text';
  end if;
  if (select p.prorettype from pg_proc p where p.oid = to_regprocedure('public.work_zone_country_codes(uuid[])')) is distinct from 'text[]'::regtype then
    raise exception 'postcondition NON TENUE : work_zone_country_codes(uuid[]) ne rend pas text[]';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.work_zones'::regclass
                  and t.tgname = 'work_zones_couverture' and not t.tgisinternal) then
    raise exception 'postcondition NON TENUE : le déclencheur work_zones_couverture n''a pas été reposé';
  end if;
  if to_regprocedure('public.remplacer_zone_de_travail(text, text[])') is null
     or has_function_privilege('authenticated', 'public.remplacer_zone_de_travail(text, text[])', 'execute') then
    raise exception 'postcondition NON TENUE : remplacer_zone_de_travail manque, ou est ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : la liste des zones est détachée de countries, en text ; la liste et le remplacement sont prouvés par tests/database/matching/zones_liste_des_pays.test.sql';
end
$post$;
