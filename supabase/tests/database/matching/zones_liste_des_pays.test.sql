-- LA LISTE DES PAYS DES ZONES DE TRAVAIL, SUR UNE BASE CONSTRUITE DEPUIS ZÉRO (lot finitions et pays, 02/10/2026 —
-- décisions de Youssef, points 3 à 6) — migration `zones_liste_des_pays`.
--
--  Ce test tourne sur la base que `npx supabase db reset --local` vient de construire depuis zéro : la future
--  production. Les 64 pays de départ y arrivent par `parametrage_de_production` et `zones_pays_rattaches`, puis la
--  migration ajoute les autres, remplace le Royaume-Uni par ses quatre pays et retire Israël.
--
--   1-3. LA LISTE EXACTE : 197 pays actifs — les États membres et observateurs de l'ONU, Israël excepté, le
--        Royaume-Uni remplacé par ses quatre pays — et leur nombre par continent ;
--   4-5. chaque pays actif a son CONTINENT (actif) et ses QUATRE noms (français, anglais, espagnol, allemand) ;
--   6-7. Israël et le Royaume-Uni ne sont plus des zones actives, et « Partout dans le monde » ne les couvre plus ;
--        ils restent des pays de `countries` (adresse, organisation et sa vérification, téléphone) ;
--   8-11. les quatre pays du Royaume-Uni sont présents, en Europe ; « Angleterre » et « Écosse » ne se recoupent
--        pas (le chemin du moteur, `work_zone_countries && …`), et l'Angleterre recoupe l'Angleterre (témoin) ;
--        l'Europe et le monde les couvrent ;
--   12-15. un profil et une annonce qui avaient le Royaume-Uni couvrent les quatre, sans rien perdre d'autre ; le
--        rejeu ne touche rien ;
--   16-18. le remplacement refuse ce qu'il ne connaît pas (ZN001, ZN002), et le navigateur ne peut pas l'appeler ;
--   19. la forme d'un code pays est tenue en base (un code en minuscules est refusé) ;
--   20-21. LA TABLE `countries` EST INTACTE EN ENTIER (relecture de l'ARRÊT 28, point 16) : ses 64 lignes, colonne par
--        colonne, sont EXACTEMENT celles que `parametrage_de_production` a semées (recopiées ci-dessous telles quelles), dans
--        les deux sens — aucun pays ajouté, retiré, désactivé ou renommé par la liste des zones.
--
--  LE CHEMIN NORMAL : comptes, profils, organisation et annonce naissent par les fabriques (inscription réelle). Le
--  profil « qui avait le Royaume-Uni » est écrit comme la route l'écrivait AVANT la migration (`update … set
--  work_zone_ids`) — la zone est inactive depuis, c'est exactement l'état que la reprise a trouvé sur staging.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(21);

-- Les 64 pays SEMÉS par parametrage_de_production, recopiés tels quels (code, quatre noms, drapeau, indicatif, région,
-- actif, ordre). Aucune migration ultérieure ne change ces colonnes (format_numero_identification n'en AJOUTE que d'autres).
create or replace function pg_temp.pays_semes()
returns table (code text, name_fr text, name_en text, name_es text, name_de text, flag_emoji text, phone_code text,
               region text, active boolean, sort_order integer)
language sql as $$ values
  ('FR', 'France', 'France', 'Francia', 'Frankreich', '🇫🇷', '+33', 'europe', true, 10),
  ('BE', 'Belgique', 'Belgium', 'Bélgica', 'Belgien', '🇧🇪', '+32', 'europe', true, 20),
  ('CH', 'Suisse', 'Switzerland', 'Suiza', 'Schweiz', '🇨🇭', '+41', 'europe', true, 30),
  ('LU', 'Luxembourg', 'Luxembourg', 'Luxemburgo', 'Luxemburg', '🇱🇺', '+352', 'europe', true, 40),
  ('MC', 'Monaco', 'Monaco', 'Mónaco', 'Monaco', '🇲🇨', '+377', 'europe', true, 50),
  ('GB', 'Royaume-Uni', 'United Kingdom', 'Reino Unido', 'Vereinigtes Königreich', '🇬🇧', '+44', 'europe', true, 60),
  ('IE', 'Irlande', 'Ireland', 'Irlanda', 'Irland', '🇮🇪', '+353', 'europe', true, 70),
  ('DE', 'Allemagne', 'Germany', 'Alemania', 'Deutschland', '🇩🇪', '+49', 'europe', true, 80),
  ('AT', 'Autriche', 'Austria', 'Austria', 'Österreich', '🇦🇹', '+43', 'europe', true, 90),
  ('IT', 'Italie', 'Italy', 'Italia', 'Italien', '🇮🇹', '+39', 'europe', true, 100),
  ('ES', 'Espagne', 'Spain', 'España', 'Spanien', '🇪🇸', '+34', 'europe', true, 110),
  ('PT', 'Portugal', 'Portugal', 'Portugal', 'Portugal', '🇵🇹', '+351', 'europe', true, 120),
  ('NL', 'Pays-Bas', 'Netherlands', 'Países Bajos', 'Niederlande', '🇳🇱', '+31', 'europe', true, 130),
  ('DK', 'Danemark', 'Denmark', 'Dinamarca', 'Dänemark', '🇩🇰', '+45', 'europe', true, 140),
  ('SE', 'Suède', 'Sweden', 'Suecia', 'Schweden', '🇸🇪', '+46', 'europe', true, 150),
  ('NO', 'Norvège', 'Norway', 'Noruega', 'Norwegen', '🇳🇴', '+47', 'europe', true, 160),
  ('FI', 'Finlande', 'Finland', 'Finlandia', 'Finnland', '🇫🇮', '+358', 'europe', true, 170),
  ('IS', 'Islande', 'Iceland', 'Islandia', 'Island', '🇮🇸', '+354', 'europe', true, 180),
  ('PL', 'Pologne', 'Poland', 'Polonia', 'Polen', '🇵🇱', '+48', 'europe', true, 190),
  ('CZ', 'République tchèque', 'Czech Republic', 'República Checa', 'Tschechien', '🇨🇿', '+420', 'europe', true, 200),
  ('SK', 'Slovaquie', 'Slovakia', 'Eslovaquia', 'Slowakei', '🇸🇰', '+421', 'europe', true, 210),
  ('HU', 'Hongrie', 'Hungary', 'Hungría', 'Ungarn', '🇭🇺', '+36', 'europe', true, 220),
  ('RO', 'Roumanie', 'Romania', 'Rumania', 'Rumänien', '🇷🇴', '+40', 'europe', true, 230),
  ('BG', 'Bulgarie', 'Bulgaria', 'Bulgaria', 'Bulgarien', '🇧🇬', '+359', 'europe', true, 240),
  ('GR', 'Grèce', 'Greece', 'Grecia', 'Griechenland', '🇬🇷', '+30', 'europe', true, 250),
  ('HR', 'Croatie', 'Croatia', 'Croacia', 'Kroatien', '🇭🇷', '+385', 'europe', true, 260),
  ('SI', 'Slovénie', 'Slovenia', 'Eslovenia', 'Slowenien', '🇸🇮', '+386', 'europe', true, 270),
  ('EE', 'Estonie', 'Estonia', 'Estonia', 'Estland', '🇪🇪', '+372', 'europe', true, 280),
  ('LV', 'Lettonie', 'Latvia', 'Letonia', 'Lettland', '🇱🇻', '+371', 'europe', true, 290),
  ('LT', 'Lituanie', 'Lithuania', 'Lituania', 'Litauen', '🇱🇹', '+370', 'europe', true, 300),
  ('CY', 'Chypre', 'Cyprus', 'Chipre', 'Zypern', '🇨🇾', '+357', 'europe', true, 310),
  ('MT', 'Malte', 'Malta', 'Malta', 'Malta', '🇲🇹', '+356', 'europe', true, 320),
  ('AD', 'Andorre', 'Andorra', 'Andorra', 'Andorra', '🇦🇩', '+376', 'europe', true, 330),
  ('LI', 'Liechtenstein', 'Liechtenstein', 'Liechtenstein', 'Liechtenstein', '🇱🇮', '+423', 'europe', true, 340),
  ('SM', 'Saint-Marin', 'San Marino', 'San Marino', 'San Marino', '🇸🇲', '+378', 'europe', true, 350),
  ('VA', 'Vatican', 'Vatican City', 'Ciudad del Vaticano', 'Vatikanstadt', '🇻🇦', '+379', 'europe', true, 360),
  ('AL', 'Albanie', 'Albania', 'Albania', 'Albanien', '🇦🇱', '+355', 'europe', true, 370),
  ('BA', 'Bosnie-Herzégovine', 'Bosnia and Herzegovina', 'Bosnia y Herzegovina', 'Bosnien und Herzegowina', '🇧🇦', '+387', 'europe', true, 380),
  ('ME', 'Monténégro', 'Montenegro', 'Montenegro', 'Montenegro', '🇲🇪', '+382', 'europe', true, 390),
  ('MK', 'Macédoine du Nord', 'North Macedonia', 'Macedonia del Norte', 'Nordmazedonien', '🇲🇰', '+389', 'europe', true, 400),
  ('RS', 'Serbie', 'Serbia', 'Serbia', 'Serbien', '🇷🇸', '+381', 'europe', true, 410),
  ('MD', 'Moldavie', 'Moldova', 'Moldavia', 'Moldau', '🇲🇩', '+373', 'europe', true, 420),
  ('UA', 'Ukraine', 'Ukraine', 'Ucrania', 'Ukraine', '🇺🇦', '+380', 'europe', true, 430),
  ('US', 'États-Unis', 'United States', 'Estados Unidos', 'Vereinigte Staaten', '🇺🇸', '+1', 'americas', true, 500),
  ('CA', 'Canada', 'Canada', 'Canadá', 'Kanada', '🇨🇦', '+1', 'americas', true, 510),
  ('MX', 'Mexique', 'Mexico', 'México', 'Mexiko', '🇲🇽', '+52', 'americas', true, 520),
  ('BR', 'Brésil', 'Brazil', 'Brasil', 'Brasilien', '🇧🇷', '+55', 'americas', true, 530),
  ('AR', 'Argentine', 'Argentina', 'Argentina', 'Argentinien', '🇦🇷', '+54', 'americas', true, 540),
  ('CL', 'Chili', 'Chile', 'Chile', 'Chile', '🇨🇱', '+56', 'americas', true, 550),
  ('AU', 'Australie', 'Australia', 'Australia', 'Australien', '🇦🇺', '+61', 'oceania', true, 600),
  ('NZ', 'Nouvelle-Zélande', 'New Zealand', 'Nueva Zelanda', 'Neuseeland', '🇳🇿', '+64', 'oceania', true, 610),
  ('MA', 'Maroc', 'Morocco', 'Marruecos', 'Marokko', '🇲🇦', '+212', 'africa', true, 700),
  ('DZ', 'Algérie', 'Algeria', 'Argelia', 'Algerien', '🇩🇿', '+213', 'africa', true, 710),
  ('TN', 'Tunisie', 'Tunisia', 'Túnez', 'Tunesien', '🇹🇳', '+216', 'africa', true, 720),
  ('EG', 'Égypte', 'Egypt', 'Egipto', 'Ägypten', '🇪🇬', '+20', 'africa', true, 730),
  ('IL', 'Israël', 'Israel', 'Israel', 'Israel', '🇮🇱', '+972', 'asia', true, 740),
  ('AE', 'Émirats arabes unis', 'United Arab Emirates', 'Emiratos Árabes Unidos', 'Vereinigte Arabische Emirate', '🇦🇪', '+971', 'asia', true, 800),
  ('IN', 'Inde', 'India', 'India', 'Indien', '🇮🇳', '+91', 'asia', true, 810),
  ('SG', 'Singapour', 'Singapore', 'Singapur', 'Singapur', '🇸🇬', '+65', 'asia', true, 820),
  ('JP', 'Japon', 'Japan', 'Japón', 'Japan', '🇯🇵', '+81', 'asia', true, 830),
  ('SN', 'Sénégal', 'Senegal', 'Senegal', 'Senegal', '🇸🇳', '+221', 'africa', true, 900),
  ('CI', 'Côte d''Ivoire', 'Ivory Coast', 'Costa de Marfil', 'Elfenbeinküste', '🇨🇮', '+225', 'africa', true, 910),
  ('CM', 'Cameroun', 'Cameroon', 'Camerún', 'Kamerun', '🇨🇲', '+237', 'africa', true, 920),
  ('MU', 'Maurice', 'Mauritius', 'Mauricio', 'Mauritius', '🇲🇺', '+230', 'africa', true, 930)
$$;
create or replace function pg_temp.pays_en_base()
returns table (code text, name_fr text, name_en text, name_es text, name_de text, flag_emoji text, phone_code text,
               region text, active boolean, sort_order integer)
language sql as $$
  select c.code::text, c.name_fr::text, c.name_en::text, c.name_es::text, c.name_de::text, c.flag_emoji::text,
         c.phone_code::text, c.region::text, c.active, c.sort_order::integer
    from public.countries c
$$;

create or replace function pg_temp.zone(p_code text) returns uuid
language sql as $$ select z.id from public.work_zones z where z.code = p_code $$;
-- Un ensemble de codes, trié octet par octet (indépendant de la collation de la base).
create or replace function pg_temp.trie(p text[]) returns text[]
language sql as $$ select coalesce(array_agg(x order by x collate "C"), '{}') from unnest(p) x $$;

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_attendus text[] := pg_temp.trie(string_to_array(
    'AD,AE,AF,AG,AL,AM,AO,AR,AT,AU,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BN,BO,BR,BS,BT,BW,BY,BZ,CA,CD,CF,CG,CH,CI,CL,CM,CN,'
    'CO,CR,CU,CV,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,ER,ES,ET,FI,FJ,FM,FR,GA,GB-ENG,GB-NIR,GB-SCT,GB-WLS,GD,GE,GH,GM,GN,'
    'GQ,GR,GT,GW,GY,HN,HR,HT,HU,ID,IE,IN,IQ,IR,IS,IT,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,'
    'LV,LY,MA,MC,MD,ME,MG,MH,MK,ML,MM,MN,MR,MT,MU,MV,MW,MX,MY,MZ,NA,NE,NG,NI,NL,NO,NP,NR,NZ,OM,PA,PE,PG,PH,PK,PL,PS,PT,'
    'PW,PY,QA,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SI,SK,SL,SM,SN,SO,SR,SS,ST,SV,SY,SZ,TD,TG,TH,TJ,TL,TM,TN,TO,TR,TT,TV,TZ,UA,'
    'UG,US,UY,UZ,VA,VC,VE,VN,VU,WS,YE,ZA,ZM,ZW', ','));
  v_quatre   text[] := array['GB-ENG', 'GB-NIR', 'GB-SCT', 'GB-WLS'];
  v_monde    uuid := pg_temp.zone('WORLD');
  v_eu       uuid := pg_temp.zone('EU');
  v_gb       uuid := pg_temp.zone('C_GB');
  v_fr       uuid := pg_temp.zone('C_FR');
  v_eng      uuid := pg_temp.zone('C_GB-ENG');
  v_sct      uuid := pg_temp.zone('C_GB-SCT');
  v_actifs   text[];
  -- Un expert « Angleterre », un expert qui avait « Royaume-Uni + France » ; une annonce « Écosse », une annonce
  -- « Angleterre » (témoin), une annonce qui avait « Royaume-Uni ».
  v_anglais  uuid := pg_temp.fab_profil('expert');
  v_ancien   uuid := pg_temp.fab_profil('cdi');
  v_org      uuid := pg_temp.fab_organisation(pg_temp.fab_compte('entreprise'));
  a_ecosse   uuid := pg_temp.fab_brouillon(v_org, 'mission');
  a_angl     uuid := pg_temp.fab_brouillon(v_org, 'mission');
  a_ancienne uuid := pg_temp.fab_brouillon(v_org, 'offre');
begin
  select pg_temp.trie(array_agg(w.country_code)) into v_actifs
    from public.work_zones w where w.kind = 'country' and w.active;

  -- ── LA LISTE ──
  return next is(cardinality(v_actifs), 197, '1. 197 pays actifs dans la liste des zones');
  return next is(v_actifs, v_attendus,
    '2. la liste EXACTE : membres et observateurs de l''ONU, Israël excepté, le Royaume-Uni remplacé par ses quatre pays');
  return next is(
    (select jsonb_object_agg(c.code, n) from (
       select cont.code, count(*) as n from public.work_zones w
         join public.work_zones cont on cont.id = w.parent_id
        where w.kind = 'country' and w.active group by cont.code) c(code, n)),
    '{"EU": 49, "AF": 54, "AS": 45, "NA": 23, "SA": 12, "OC": 14}'::jsonb,
    '3. par continent : Europe 49 (la Turquie comprise, décision de Youssef), Afrique 54, Asie 45, Amérique du Nord 23, Amérique du Sud 12, Océanie 14');

  -- ── CONTINENT ET QUATRE NOMS ──
  return next is(
    (select count(*) from public.work_zones w
      where w.kind = 'country' and w.active
        and not exists (select 1 from public.work_zones cont
                         where cont.id = w.parent_id and cont.kind = 'continent' and cont.active)),
    0::bigint, '4. chaque pays actif est rattaché à un continent actif');
  -- Compté POSITIVEMENT : une liste vide rendrait vrai un « aucun pays sans nom ».
  return next is(
    (select count(*) from public.work_zones w
      where w.kind = 'country' and w.active and btrim(w.name) <> ''
        and (select count(*) from public.translations t
              where t.table_name = 'work_zones' and t.row_id = w.id and t.field = 'name'
                and t.locale in ('en', 'es', 'de') and btrim(t.value) <> '') = 3),
    197::bigint, '5. chaque pays actif a ses quatre noms : français (la zone), anglais, espagnol, allemand');

  -- ── ISRAËL ET LE ROYAUME-UNI SORTENT ──
  return next ok(
    not exists (select 1 from public.work_zones w where w.country_code = 'IL' and w.active)
    and not ('IL' = any (public.work_zone_country_codes(array[v_monde])))
    and exists (select 1 from public.countries c where c.code = 'IL' and c.active),
    '6. Israël n''est plus une zone active, « Partout dans le monde » ne le couvre plus — et il reste un pays de countries');
  return next ok(
    not exists (select 1 from public.work_zones w where w.country_code = 'GB' and w.active)
    and not ('GB' = any (public.work_zone_country_codes(array[v_monde])))
    and exists (select 1 from public.countries c where c.code = 'GB' and c.active),
    '7. le Royaume-Uni n''est plus une zone de la liste — et il reste UN pays partout ailleurs (countries : adresse, organisation, téléphone)');

  -- ── LES QUATRE PAYS DU ROYAUME-UNI ──
  return next is(
    (select pg_temp.trie(array_agg(w.country_code)) from public.work_zones w
       join public.work_zones cont on cont.id = w.parent_id and cont.code = 'EU'
      where w.country_code like 'GB-%' and w.active),
    v_quatre, '8. Angleterre, Écosse, Pays de Galles, Irlande du Nord : présents, actifs, en Europe');

  update public.profiles     set work_zone_ids = array[v_eng] where id = v_anglais;
  update public.publications set work_zone_ids = array[v_sct] where id = a_ecosse;
  update public.publications set work_zone_ids = array[v_eng] where id = a_angl;
  return next ok(
    not ((select p.work_zone_countries from public.profiles p where p.id = v_anglais)
         && (select a.work_zone_countries from public.publications a where a.id = a_ecosse)),
    '9. un expert « Angleterre » ne recoupe pas une mission « Écosse » (le prédicat du moteur)');
  return next ok(
    (select p.work_zone_countries from public.profiles p where p.id = v_anglais)
    && (select a.work_zone_countries from public.publications a where a.id = a_angl),
    '10. témoin : l''expert « Angleterre » recoupe une mission « Angleterre »');
  return next ok(
    public.work_zone_country_codes(array[v_eu]) @> v_quatre
    and pg_temp.trie(public.work_zone_country_codes(array[v_monde])) = v_attendus,
    '11. « Europe — tout le continent » couvre les quatre ; « Partout dans le monde » couvre exactement les 197');

  -- ── LE PROFIL ET L'ANNONCE QUI AVAIENT LE ROYAUME-UNI ──
  update public.profiles     set work_zone_ids = array[v_gb, v_fr] where id = v_ancien;
  update public.publications set work_zone_ids = array[v_gb]       where id = a_ancienne;
  return next is(public.remplacer_zone_de_travail('C_GB', array['C_GB-ENG', 'C_GB-SCT', 'C_GB-WLS', 'C_GB-NIR']),
    '{"profils": 1, "annonces": 1}'::jsonb, '12. le remplacement touche le profil et l''annonce qui avaient le Royaume-Uni');
  return next ok(
    (select not (v_gb = any (p.work_zone_ids)) and v_fr = any (p.work_zone_ids) and cardinality(p.work_zone_ids) = 5
       from public.profiles p where p.id = v_ancien)
    and pg_temp.trie((select p.work_zone_countries from public.profiles p where p.id = v_ancien)) = pg_temp.trie(v_quatre || 'FR'::text),
    '13. le profil couvre les quatre pays ET garde la France : rien n''est perdu');
  return next is(pg_temp.trie((select a.work_zone_countries from public.publications a where a.id = a_ancienne)), v_quatre,
    '14. l''annonce qui avait le Royaume-Uni couvre les quatre pays');
  return next is(public.remplacer_zone_de_travail('C_GB', array['C_GB-ENG', 'C_GB-SCT', 'C_GB-WLS', 'C_GB-NIR']),
    '{"profils": 0, "annonces": 0}'::jsonb, '15. rejoué, le remplacement ne touche rien');

  -- ── LES REFUS ──
  return next throws_ok($q$ select public.remplacer_zone_de_travail('C_INCONNUE', array['C_FR']) $q$, 'ZN001', null,
    '16. une zone à remplacer inconnue est refusée, nommément (ZN001)');
  return next throws_ok($q$ select public.remplacer_zone_de_travail('C_FR', array['C_IL']) $q$, 'ZN002', null,
    '17. une zone de remplacement inactive (Israël) est refusée, nommément (ZN002)');
  return next ok(not has_function_privilege('authenticated', 'public.remplacer_zone_de_travail(text, text[])', 'execute')
                 and not has_function_privilege('anon', 'public.remplacer_zone_de_travail(text, text[])', 'execute'),
    '18. le navigateur ne peut pas appeler le remplacement');
  return next throws_ok(
    format($q$ insert into public.work_zones (parent_id, kind, code, country_code, name, slug)
               values (%L, 'country', 'C_SONDE', 'gb-eng', 'Sonde', 'pays-sonde') $q$, v_eu),
    '23514', null, '19. la forme d''un code pays est tenue en base : « gb-eng » est refusé (work_zones_code_pays_forme)');

  -- ── LA TABLE countries, EN ENTIER (relecture de l'ARRÊT 28, point 16) ──
  return next is((select count(*) from (select * from pg_temp.pays_semes() except select * from pg_temp.pays_en_base()) d), 0::bigint,
    '20. chacun des 64 pays semés est dans countries, à l''identique (code, quatre noms, drapeau, indicatif, région, actif, ordre)');
  return next is((select count(*) from (select * from pg_temp.pays_en_base() except select * from pg_temp.pays_semes()) d), 0::bigint,
    '21. countries ne porte AUCUNE autre ligne ni valeur : ni pays ajouté, ni pays modifié par la liste des zones');
end $$;

select * from pg_temp.essai();

select * from finish();
rollback;
