-- ════════════════════════════════════════════════════════════════════════════
--  CHAQUE PAYS DU RÉFÉRENTIEL EST RATTACHÉ À SON CONTINENT — y compris sur une base construite depuis zéro
--  (lot zones de travail, 02/10/2026 — §E.92, décision de Youssef : corrigé dans ce lot).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Elle n'AJOUTE que des lignes à `work_zones` (et leurs traductions), une table
--  qu'aucun code de l'application n'écrit ; elle ne modifie ni ne supprime rien. Horodatée après
--  `zones_couverture_suit_le_referentiel` : son déclencheur recalcule la couverture des continents et du monde pour chaque
--  pays ajouté.
--
--  LE DÉFAUT (§E.92) : la migration `referentiel_zones_de_travail` rattache les pays par
--  `insert … select … from public.countries where active` — or, sur une base VIERGE, `countries` est encore vide à ce
--  moment : les 64 pays arrivent par la migration `parametrage_de_production`, plus tard (§G.3 : citées par leur nom). Aucune migration ne les
--  rattachait ensuite. Une base construite depuis zéro (la production, mise-en-production.md ÉTAPE 1 ; `db reset`) avait
--  le monde et six continents, ZÉRO pays : aucun continent proposé, aucun pays trouvable, et « Partout dans le monde »
--  aplati vers un ensemble vide. Staging ne le montrait pas : sa base existait avant, `countries` y était rempli.
--
--  LA RÈGLE : chaque pays ACTIF de `countries` qui n'a pas de zone est rattaché à son continent, avec la MÊME
--  correspondance ISO que la migration d'origine (recopiée telle quelle — `diag-lot-zones` vérifie que les deux sont
--  ÉGALES), le même code (`C_<ISO>`), le même slug, le même ordre, et ses traductions (en, es, de) recopiées de
--  `countries`. Rien de ce qui est DÉJÀ rattaché n'est touché (`not exists` sur le code pays, puis `on conflict do
--  nothing`) : sur staging, elle ne change rien et le dit (« 0 pays rattaché(s) ») ; sur une base neuve, elle rattache
--  les 64. Rejouable.
--
--  Colonnes et contraintes lues (§G.10) : work_zones (kind country ⇔ country_code non nul, parent obligatoire hors
--  monde, code et slug uniques, country_code unique quand non nul, country_code → countries) ; countries (code clé,
--  name_fr/en/es/de NOT NULL, active, sort_order) ; translations (clé table_name, row_id, field, locale ; value NOT NULL ;
--  garde translations_specialite_autre — ne regarde que table_name = 'specialities').
--
--  Prouvée par tests/database/matching/zones_pays_rattaches.test.sql, après une construction depuis zéro.
-- ─────────────────────────────────────────────────────────────────────────────

do $rattachement$
declare
  v_pays       integer;
  v_trad       integer;
  v_orphelins  text;
begin
  -- ── 1. Les pays sans zone, rattachés à leur continent (la correspondance de la migration d'origine) ──
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
  ),
  ajoutes as (
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
      join public.work_zones cont on cont.code = ic.continent_code and cont.kind = 'continent'
     where co.active = true
       and not exists (select 1 from public.work_zones w where w.country_code = co.code)
    on conflict (code) do nothing
    returning id, country_code
  ),
  -- ── 2. Leurs traductions, recopiées de `countries` (le français est le repli de tBDD) ──
  traduites as (
    insert into public.translations (table_name, row_id, field, locale, value)
    select 'work_zones', a.id, 'name', l.locale,
           case l.locale when 'en' then co.name_en
                         when 'es' then co.name_es
                         when 'de' then co.name_de end
      from ajoutes a
      join public.countries co on co.code = a.country_code
      cross join (values ('en'), ('es'), ('de')) as l(locale)
    on conflict do nothing
    returning 1
  )
  select (select count(*) from ajoutes), (select count(*) from traduites) into v_pays, v_trad;

  raise notice 'zones de travail : % pays rattaché(s) à leur continent, % traduction(s) posée(s)', v_pays, v_trad;

  -- ── 3. Le filet : un pays actif qui reste sans zone est invisible au matching — il se NOMME ──
  select string_agg(co.code, ', ' order by co.code) into v_orphelins
    from public.countries co
   where co.active
     and not exists (select 1 from public.work_zones w where w.country_code = co.code);
  if v_orphelins is not null then
    raise notice 'zones de travail : pays actifs SANS continent dans la correspondance (invisibles au matching) : %', v_orphelins;
  end if;
end
$rattachement$;
