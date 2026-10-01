-- ════════════════════════════════════════════════════════════════════════════
--  LES LANGUES PARLÉES SE CHOISISSENT DANS UNE LISTE FERMÉE — un code en base,
--  un nom dans la langue de l'écran (recette staging du 01/10/2026, point 3 ;
--  décision de Youssef : jamais de saisie libre).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Le code qui suit envoie des codes ; le code
--  en ligne envoie du texte libre — tant qu'il tourne (la fenêtre entre db push et
--  git push, §G.4 ter), une langue TAPÉE à la main qui n'est pas un code serait refusée
--  par le déclencheur, nommément (LP001, cause `langue_hors_liste`). Rejouable.
--
--  LE DÉFAUT : `profile_languages.language` (varchar 50) recevait ce que l'expert tapait
--  ou ce que l'analyseur du CV écrivait. Un CV en anglais donnait « French, English,
--  Arabic », affichés tels quels sur un écran en français ; « Ajouter une langue »
--  montrait le texte d'exemple comme une langue, avec le niveau B2 coché d'office.
--
--  LA RÈGLE, EN BASE :
--    1. `langues` — la liste FERMÉE : un code ISO 639-1 par langue proposée. Les NOMS
--       ne sont pas ici : l'écran les dit dans sa langue (Intl.DisplayNames,
--       lib/profil/langues.ts) ;
--    2. `langues_noms` — les noms connus de chaque langue (français, anglais, espagnol,
--       allemand, et son nom natif ; avec et sans accents), qui servent à RATTACHER un
--       texte libre à son code : la reprise ci-dessous, et `code_de_langue()` ;
--    3. un DÉCLENCHEUR refuse, à l'insertion comme au changement de langue, tout code
--       hors de la liste active (LG001) — `remplacer_listes_profil` le rend sous la cause
--       `langue_hors_liste` ; `ecrire_analyse_cv` l'écarte et le dit, comme toute ligne
--       refusée ;
--    4. LA REPRISE rattache les lignes HÉRITÉES (« French », « Français ») à leur code.
--       Ce qu'aucun nom ne reconnaît RESTE tel quel, jamais effacé : l'écran de validation
--       le montre et demande de le choisir dans la liste. Deux lignes qui deviennent la
--       même langue pour un même profil n'en font plus qu'une (la principale d'abord).
--
--  Le contenu de la liste est un CHOIX PRODUIT (92 langues), réglable en base : ajouter
--  une langue, c'est une ligne dans `langues` et ses noms dans `langues_noms`.
--
--  ⚠️ LA REPRISE TOUCHE DES DONNÉES : c'est une reprise VOULUE, dans son propre bloc
--     (§G.4 ter), prouvée sur des données fabriquées par
--     tests/database/profil/langues_liste_fermee.test.sql.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.langues (
  code   text primary key check (code ~ '^[a-z]{2}$'),
  active boolean not null default true
);
comment on table public.langues is
  'La liste FERMÉE des langues proposées à l''expert : un code ISO 639-1. Le nom s''affiche dans la langue de l''écran (Intl.DisplayNames). Recette du 01/10/2026.';

create table if not exists public.langues_noms (
  nom  text primary key check (nom = lower(btrim(nom)) and nom <> ''),
  code text not null references public.langues (code) on delete cascade
);
comment on table public.langues_noms is
  'Les noms connus d''une langue (fr, en, es, de, natif ; avec et sans accents), en minuscules — pour RATTACHER un texte libre à son code (reprise, code_de_langue()).';

alter table public.langues enable row level security;
alter table public.langues_noms enable row level security;
-- Lues par le serveur seul (/api/taxonomy, clé de service) : aucune politique, aucun droit au navigateur.
revoke all on table public.langues from anon, authenticated;
revoke all on table public.langues_noms from anon, authenticated;

insert into public.langues (code)
values
  ('af'),
  ('am'),
  ('ar'),
  ('az'),
  ('be'),
  ('bg'),
  ('bn'),
  ('bs'),
  ('ca'),
  ('cs'),
  ('cy'),
  ('da'),
  ('de'),
  ('el'),
  ('en'),
  ('es'),
  ('et'),
  ('eu'),
  ('fa'),
  ('ff'),
  ('fi'),
  ('fr'),
  ('ga'),
  ('gl'),
  ('gu'),
  ('ha'),
  ('he'),
  ('hi'),
  ('hr'),
  ('ht'),
  ('hu'),
  ('hy'),
  ('id'),
  ('ig'),
  ('is'),
  ('it'),
  ('ja'),
  ('ka'),
  ('kk'),
  ('km'),
  ('kn'),
  ('ko'),
  ('ku'),
  ('ky'),
  ('lb'),
  ('ln'),
  ('lo'),
  ('lt'),
  ('lv'),
  ('mg'),
  ('mk'),
  ('ml'),
  ('mn'),
  ('mr'),
  ('ms'),
  ('mt'),
  ('my'),
  ('ne'),
  ('nl'),
  ('no'),
  ('pa'),
  ('pl'),
  ('ps'),
  ('pt'),
  ('ro'),
  ('ru'),
  ('rw'),
  ('si'),
  ('sk'),
  ('sl'),
  ('so'),
  ('sq'),
  ('sr'),
  ('sv'),
  ('sw'),
  ('ta'),
  ('te'),
  ('tg'),
  ('th'),
  ('ti'),
  ('tk'),
  ('tl'),
  ('tr'),
  ('uk'),
  ('ur'),
  ('uz'),
  ('vi'),
  ('wo'),
  ('xh'),
  ('yo'),
  ('zh'),
  ('zu')
on conflict (code) do nothing;

insert into public.langues_noms (nom, code)
values
  ('afrikaans', 'af'),
  ('afrikáans', 'af'),
  ('amarico', 'am'),
  ('amárico', 'am'),
  ('amharic', 'am'),
  ('amharique', 'am'),
  ('amharisch', 'am'),
  ('አማርኛ', 'am'),
  ('arabe', 'ar'),
  ('árabe', 'ar'),
  ('arabic', 'ar'),
  ('arabisch', 'ar'),
  ('العربية', 'ar'),
  ('aserbaidschanisch', 'az'),
  ('azerbaidjanais', 'az'),
  ('azerbaïdjanais', 'az'),
  ('azerbaijani', 'az'),
  ('azerbaiyano', 'az'),
  ('azərbaycan', 'az'),
  ('belarusian', 'be'),
  ('belarussisch', 'be'),
  ('bielorruso', 'be'),
  ('bielorusse', 'be'),
  ('biélorusse', 'be'),
  ('беларуская', 'be'),
  ('bulgare', 'bg'),
  ('bulgarian', 'bg'),
  ('bulgarisch', 'bg'),
  ('bulgaro', 'bg'),
  ('búlgaro', 'bg'),
  ('български', 'bg'),
  ('bangla', 'bn'),
  ('bengali', 'bn'),
  ('bengalí', 'bn'),
  ('bengalisch', 'bn'),
  ('বাংলা', 'bn'),
  ('bosanski', 'bs'),
  ('bosnian', 'bs'),
  ('bosniaque', 'bs'),
  ('bosnio', 'bs'),
  ('bosnisch', 'bs'),
  ('catala', 'ca'),
  ('català', 'ca'),
  ('catalan', 'ca'),
  ('catalán', 'ca'),
  ('katalanisch', 'ca'),
  ('cestina', 'cs'),
  ('čeština', 'cs'),
  ('checo', 'cs'),
  ('czech', 'cs'),
  ('tcheque', 'cs'),
  ('tchèque', 'cs'),
  ('tschechisch', 'cs'),
  ('cymraeg', 'cy'),
  ('gales', 'cy'),
  ('galés', 'cy'),
  ('gallois', 'cy'),
  ('walisisch', 'cy'),
  ('welsh', 'cy'),
  ('danes', 'da'),
  ('danés', 'da'),
  ('danisch', 'da'),
  ('dänisch', 'da'),
  ('danish', 'da'),
  ('danois', 'da'),
  ('dansk', 'da'),
  ('aleman', 'de'),
  ('alemán', 'de'),
  ('allemand', 'de'),
  ('deutsch', 'de'),
  ('german', 'de'),
  ('grec', 'el'),
  ('greek', 'el'),
  ('griechisch', 'el'),
  ('griego', 'el'),
  ('ελληνικα', 'el'),
  ('ελληνικά', 'el'),
  ('anglais', 'en'),
  ('englisch', 'en'),
  ('english', 'en'),
  ('ingles', 'en'),
  ('inglés', 'en'),
  ('espagnol', 'es'),
  ('espanol', 'es'),
  ('español', 'es'),
  ('spanisch', 'es'),
  ('spanish', 'es'),
  ('eesti', 'et'),
  ('estnisch', 'et'),
  ('estonian', 'et'),
  ('estonien', 'et'),
  ('estonio', 'et'),
  ('baskisch', 'eu'),
  ('basque', 'eu'),
  ('euskara', 'eu'),
  ('euskera', 'eu'),
  ('farsi', 'fa'),
  ('persa', 'fa'),
  ('persan', 'fa'),
  ('persian', 'fa'),
  ('persisch', 'fa'),
  ('فارسی', 'fa'),
  ('ful', 'ff'),
  ('fula', 'ff'),
  ('peul', 'ff'),
  ('pulaar', 'ff'),
  ('fines', 'fi'),
  ('finés', 'fi'),
  ('finnisch', 'fi'),
  ('finnish', 'fi'),
  ('finnois', 'fi'),
  ('suomi', 'fi'),
  ('francais', 'fr'),
  ('français', 'fr'),
  ('frances', 'fr'),
  ('francés', 'fr'),
  ('franzosisch', 'fr'),
  ('französisch', 'fr'),
  ('french', 'fr'),
  ('gaeilge', 'ga'),
  ('irisch', 'ga'),
  ('irish', 'ga'),
  ('irlandais', 'ga'),
  ('irlandes', 'ga'),
  ('irlandés', 'ga'),
  ('galego', 'gl'),
  ('galician', 'gl'),
  ('galicien', 'gl'),
  ('galicisch', 'gl'),
  ('gallego', 'gl'),
  ('goudjarati', 'gu'),
  ('gujarati', 'gu'),
  ('guyarati', 'gu'),
  ('guyaratí', 'gu'),
  ('ગુજરાતી', 'gu'),
  ('haoussa', 'ha'),
  ('hausa', 'ha'),
  ('haussa', 'ha'),
  ('hebraisch', 'he'),
  ('hebräisch', 'he'),
  ('hebreo', 'he'),
  ('hebreu', 'he'),
  ('hébreu', 'he'),
  ('hebrew', 'he'),
  ('עברית', 'he'),
  ('hindi', 'hi'),
  ('हिन्दी', 'hi'),
  ('croata', 'hr'),
  ('croate', 'hr'),
  ('croatian', 'hr'),
  ('hrvatski', 'hr'),
  ('kroatisch', 'hr'),
  ('creole haitien', 'ht'),
  ('créole haïtien', 'ht'),
  ('criollo haitiano', 'ht'),
  ('haiti-kreolisch', 'ht'),
  ('haitian creole', 'ht'),
  ('hongrois', 'hu'),
  ('hungarian', 'hu'),
  ('hungaro', 'hu'),
  ('húngaro', 'hu'),
  ('magyar', 'hu'),
  ('ungarisch', 'hu'),
  ('armenian', 'hy'),
  ('armenien', 'hy'),
  ('arménien', 'hy'),
  ('armenio', 'hy'),
  ('armenisch', 'hy'),
  ('հայերեն', 'hy'),
  ('indonesia', 'id'),
  ('indonesian', 'id'),
  ('indonesien', 'id'),
  ('indonésien', 'id'),
  ('indonesio', 'id'),
  ('indonesisch', 'id'),
  ('igbo', 'ig'),
  ('icelandic', 'is'),
  ('islandais', 'is'),
  ('islandes', 'is'),
  ('islandés', 'is'),
  ('islandisch', 'is'),
  ('isländisch', 'is'),
  ('islenska', 'is'),
  ('íslenska', 'is'),
  ('italian', 'it'),
  ('italiano', 'it'),
  ('italien', 'it'),
  ('italienisch', 'it'),
  ('japanese', 'ja'),
  ('japanisch', 'ja'),
  ('japonais', 'ja'),
  ('japones', 'ja'),
  ('japonés', 'ja'),
  ('日本語', 'ja'),
  ('georgian', 'ka'),
  ('georgiano', 'ka'),
  ('georgien', 'ka'),
  ('géorgien', 'ka'),
  ('georgisch', 'ka'),
  ('ქართული', 'ka'),
  ('kasachisch', 'kk'),
  ('kazajo', 'kk'),
  ('kazakh', 'kk'),
  ('қазақ тілі', 'kk'),
  ('jemer', 'km'),
  ('khmer', 'km'),
  ('ខ្មែរ', 'km'),
  ('canares', 'kn'),
  ('canarés', 'kn'),
  ('kannada', 'kn'),
  ('ಕನ್ನಡ', 'kn'),
  ('coreano', 'ko'),
  ('coreen', 'ko'),
  ('coréen', 'ko'),
  ('korean', 'ko'),
  ('koreanisch', 'ko'),
  ('한국어', 'ko'),
  ('한국어', 'ko'),
  ('kurde', 'ku'),
  ('kurdi (kurmanci)', 'ku'),
  ('kurdî (kurmancî)', 'ku'),
  ('kurdisch', 'ku'),
  ('kurdish', 'ku'),
  ('kurdo', 'ku'),
  ('kirghize', 'ky'),
  ('kirgisisch', 'ky'),
  ('kirguis', 'ky'),
  ('kirguís', 'ky'),
  ('kyrgyz', 'ky'),
  ('кыргызча', 'ky'),
  ('letzebuergesch', 'lb'),
  ('lëtzebuergesch', 'lb'),
  ('luxembourgeois', 'lb'),
  ('luxembourgish', 'lb'),
  ('luxemburgisch', 'lb'),
  ('luxemburgues', 'lb'),
  ('luxemburgués', 'lb'),
  ('lingala', 'ln'),
  ('lingála', 'ln'),
  ('lao', 'lo'),
  ('laotisch', 'lo'),
  ('ລາວ', 'lo'),
  ('lietuviu', 'lt'),
  ('lietuvių', 'lt'),
  ('litauisch', 'lt'),
  ('lithuanian', 'lt'),
  ('lituanien', 'lt'),
  ('lituano', 'lt'),
  ('latvian', 'lv'),
  ('latviesu', 'lv'),
  ('latviešu', 'lv'),
  ('leton', 'lv'),
  ('letón', 'lv'),
  ('lettisch', 'lv'),
  ('letton', 'lv'),
  ('malagasy', 'mg'),
  ('malgache', 'mg'),
  ('macedonian', 'mk'),
  ('macedonien', 'mk'),
  ('macédonien', 'mk'),
  ('macedonio', 'mk'),
  ('mazedonisch', 'mk'),
  ('македонски', 'mk'),
  ('malayalam', 'ml'),
  ('malayálam', 'ml'),
  ('മലയാളം', 'ml'),
  ('mongol', 'mn'),
  ('mongolian', 'mn'),
  ('mongolisch', 'mn'),
  ('монгол', 'mn'),
  ('marathi', 'mr'),
  ('marati', 'mr'),
  ('maratí', 'mr'),
  ('मराठी', 'mr'),
  ('malaiisch', 'ms'),
  ('malais', 'ms'),
  ('malay', 'ms'),
  ('malayo', 'ms'),
  ('melayu', 'ms'),
  ('maltais', 'mt'),
  ('maltes', 'mt'),
  ('maltés', 'mt'),
  ('maltese', 'mt'),
  ('maltesisch', 'mt'),
  ('malti', 'mt'),
  ('birman', 'my'),
  ('birmanisch', 'my'),
  ('birmano', 'my'),
  ('burmese', 'my'),
  ('မြန်မာ', 'my'),
  ('nepalais', 'ne'),
  ('népalais', 'ne'),
  ('nepalesisch', 'ne'),
  ('nepali', 'ne'),
  ('nepalí', 'ne'),
  ('नेपाली', 'ne'),
  ('dutch', 'nl'),
  ('nederlands', 'nl'),
  ('neerlandais', 'nl'),
  ('néerlandais', 'nl'),
  ('neerlandes', 'nl'),
  ('neerlandés', 'nl'),
  ('niederlandisch', 'nl'),
  ('niederländisch', 'nl'),
  ('norsk', 'no'),
  ('noruego', 'no'),
  ('norvegien', 'no'),
  ('norvégien', 'no'),
  ('norwegian', 'no'),
  ('norwegisch', 'no'),
  ('pendjabi', 'pa'),
  ('punjabi', 'pa'),
  ('punyabi', 'pa'),
  ('punyabí', 'pa'),
  ('ਪੰਜਾਬੀ', 'pa'),
  ('polaco', 'pl'),
  ('polish', 'pl'),
  ('polnisch', 'pl'),
  ('polonais', 'pl'),
  ('polski', 'pl'),
  ('pachto', 'ps'),
  ('paschtu', 'ps'),
  ('pashto', 'ps'),
  ('pastun', 'ps'),
  ('pastún', 'ps'),
  ('پښتو', 'ps'),
  ('portugais', 'pt'),
  ('portugiesisch', 'pt'),
  ('portugues', 'pt'),
  ('portugués', 'pt'),
  ('português', 'pt'),
  ('portuguese', 'pt'),
  ('romana', 'ro'),
  ('română', 'ro'),
  ('romanian', 'ro'),
  ('roumain', 'ro'),
  ('rumanisch', 'ro'),
  ('rumänisch', 'ro'),
  ('rumano', 'ro'),
  ('ruso', 'ru'),
  ('russe', 'ru'),
  ('russian', 'ru'),
  ('russisch', 'ru'),
  ('русскии', 'ru'),
  ('русский', 'ru'),
  ('ikinyarwanda', 'rw'),
  ('kinyarwanda', 'rw'),
  ('cingalais', 'si'),
  ('cingales', 'si'),
  ('cingalés', 'si'),
  ('singhalesisch', 'si'),
  ('sinhala', 'si'),
  ('සිංහල', 'si'),
  ('eslovaco', 'sk'),
  ('slovak', 'sk'),
  ('slovaque', 'sk'),
  ('slovencina', 'sk'),
  ('slovenčina', 'sk'),
  ('slowakisch', 'sk'),
  ('esloveno', 'sl'),
  ('slovene', 'sl'),
  ('slovène', 'sl'),
  ('slovenian', 'sl'),
  ('slovenscina', 'sl'),
  ('slovenščina', 'sl'),
  ('slowenisch', 'sl'),
  ('somali', 'so'),
  ('somalí', 'so'),
  ('soomaali', 'so'),
  ('albanais', 'sq'),
  ('albanes', 'sq'),
  ('albanés', 'sq'),
  ('albanian', 'sq'),
  ('albanisch', 'sq'),
  ('shqip', 'sq'),
  ('serbe', 'sr'),
  ('serbian', 'sr'),
  ('serbio', 'sr'),
  ('serbisch', 'sr'),
  ('српски', 'sr'),
  ('schwedisch', 'sv'),
  ('sueco', 'sv'),
  ('suedois', 'sv'),
  ('suédois', 'sv'),
  ('svenska', 'sv'),
  ('swedish', 'sv'),
  ('kiswahili', 'sw'),
  ('suaheli', 'sw'),
  ('suajili', 'sw'),
  ('swahili', 'sw'),
  ('tamil', 'ta'),
  ('tamoul', 'ta'),
  ('தமிழ்', 'ta'),
  ('telougou', 'te'),
  ('télougou', 'te'),
  ('telugu', 'te'),
  ('తెలుగు', 'te'),
  ('tadjik', 'tg'),
  ('tadschikisch', 'tg'),
  ('tajik', 'tg'),
  ('tayiko', 'tg'),
  ('тоҷики', 'tg'),
  ('тоҷикӣ', 'tg'),
  ('tailandes', 'th'),
  ('tailandés', 'th'),
  ('thai', 'th'),
  ('thaï', 'th'),
  ('thailandisch', 'th'),
  ('thailändisch', 'th'),
  ('ไทย', 'th'),
  ('tigrigna', 'ti'),
  ('tigrina', 'ti'),
  ('tigriña', 'ti'),
  ('tigrinya', 'ti'),
  ('ትግርኛ', 'ti'),
  ('turcomano', 'tk'),
  ('turkmen', 'tk'),
  ('turkmen dili', 'tk'),
  ('türkmen dili', 'tk'),
  ('turkmene', 'tk'),
  ('turkmène', 'tk'),
  ('turkmenisch', 'tk'),
  ('filipino', 'tl'),
  ('turc', 'tr'),
  ('turco', 'tr'),
  ('turkce', 'tr'),
  ('türkçe', 'tr'),
  ('turkisch', 'tr'),
  ('türkisch', 'tr'),
  ('turkish', 'tr'),
  ('ucraniano', 'uk'),
  ('ukrainian', 'uk'),
  ('ukrainien', 'uk'),
  ('ukrainisch', 'uk'),
  ('украінська', 'uk'),
  ('українська', 'uk'),
  ('ourdou', 'ur'),
  ('urdu', 'ur'),
  ('اردو', 'ur'),
  ('o‘zbek', 'uz'),
  ('ouzbek', 'uz'),
  ('usbekisch', 'uz'),
  ('uzbek', 'uz'),
  ('uzbeko', 'uz'),
  ('tieng viet', 'vi'),
  ('tiếng việt', 'vi'),
  ('vietnamese', 'vi'),
  ('vietnamesisch', 'vi'),
  ('vietnamien', 'vi'),
  ('vietnamita', 'vi'),
  ('wolof', 'wo'),
  ('wólof', 'wo'),
  ('isixhosa', 'xh'),
  ('xhosa', 'xh'),
  ('ede yoruba', 'yo'),
  ('èdè yorùbá', 'yo'),
  ('yoruba', 'yo'),
  ('chinese', 'zh'),
  ('chinesisch', 'zh'),
  ('chino', 'zh'),
  ('chinois', 'zh'),
  ('mandarin', 'zh'),
  ('中文', 'zh'),
  ('isizulu', 'zu'),
  ('zoulou', 'zu'),
  ('zulu', 'zu'),
  ('zulú', 'zu')
on conflict (nom) do nothing;

-- ── LE RATTACHEMENT D'UN TEXTE LIBRE ─────────────────────────────────────────
create or replace function public.code_de_langue(p_texte text)
  returns text
  language sql
  stable
  set search_path to 'public'
as $fn$
  select coalesce(
    (select l.code from public.langues l where l.code = lower(btrim(p_texte))),
    (select n.code from public.langues_noms n where n.nom = lower(btrim(p_texte)))
  )
$fn$;

comment on function public.code_de_langue(text) is
  'Le code de la liste fermée qu''un texte désigne (un code, ou un nom connu en fr/en/es/de/natif), ou null.';

-- ── LA GARDE ─────────────────────────────────────────────────────────────────
create or replace function public.profile_languages_langue_de_la_liste()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $fn$
begin
  if not exists (select 1 from public.langues l where l.code = new.language and l.active) then
    raise exception 'langue hors de la liste fermée : %', new.language using errcode = 'LG001';
  end if;
  return new;
end
$fn$;

drop trigger if exists profile_languages_langue_de_la_liste on public.profile_languages;
create trigger profile_languages_langue_de_la_liste
  before insert or update of language on public.profile_languages
  for each row execute function public.profile_languages_langue_de_la_liste();

-- ── LA REPRISE DES LIGNES HÉRITÉES ───────────────────────────────────────────
create or replace function public.rattacher_langues_heritees()
  returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_doublons   integer;
  v_rattachees integer;
  v_profils    integer;
  v_restantes  integer;
begin
  -- 1. Deux lignes d'un profil qui deviennent la MÊME langue n'en font plus qu'une : la
  --    principale d'abord, puis celle qui était déjà un code, puis la plus ancienne.
  with lu as (
    select pl.id, pl.profile_id, pl.is_primary, pl.created_at,
           (pl.language = public.code_de_langue(pl.language)) as deja_code,
           public.code_de_langue(pl.language) as code
      from public.profile_languages pl
  ), rangs as (
    select lu.id,
           row_number() over (partition by lu.profile_id, lu.code
                              order by lu.is_primary desc, lu.deja_code desc, lu.created_at, lu.id) as r
      from lu
     where lu.code is not null
  )
  delete from public.profile_languages pl
   using rangs
   where pl.id = rangs.id and rangs.r > 1;
  get diagnostics v_doublons = row_count;

  -- 2. Le rattachement : le texte libre reconnu devient son code.
  update public.profile_languages pl
     set language = public.code_de_langue(pl.language)
   where public.code_de_langue(pl.language) is not null
     and pl.language <> public.code_de_langue(pl.language);
  get diagnostics v_rattachees = row_count;

  -- 3. La liste plate du profil suit : chaque élément reconnu devient son code, le reste reste.
  update public.profiles p
     set languages = array(
           select distinct on (coalesce(public.code_de_langue(x), x)) coalesce(public.code_de_langue(x), x)
             from unnest(p.languages) as x
         )
   where exists (
           select 1 from unnest(p.languages) as x
            where public.code_de_langue(x) is not null and x <> public.code_de_langue(x)
         );
  get diagnostics v_profils = row_count;

  select count(*) into v_restantes
    from public.profile_languages pl
   where public.code_de_langue(pl.language) is distinct from pl.language;

  return jsonb_build_object('doublons', v_doublons, 'rattachees', v_rattachees,
                            'profils', v_profils, 'non_reconnues', v_restantes);
end
$fn$;

revoke all on function public.rattacher_langues_heritees() from public, anon, authenticated;

comment on function public.rattacher_langues_heritees() is
  'Reprise : rattache les langues saisies en texte libre à leur code de la liste fermée, fond les doublons ; ce qu''aucun nom ne reconnaît reste tel quel (l''écran demande de le choisir). Rend ce qu''elle a fait. Rejouable.';

do $reprise$
declare
  v_bilan jsonb;
begin
  v_bilan := public.rattacher_langues_heritees();
  raise notice 'reprise des langues : % rattachée(s), % doublon(s) fondu(s), % liste(s) plate(s) reprise(s), % non reconnue(s) laissée(s) telle(s) quelle(s)',
    v_bilan ->> 'rattachees', v_bilan ->> 'doublons', v_bilan ->> 'profils', v_bilan ->> 'non_reconnues';
end
$reprise$;

-- ── LE REFUS NOMMÉ DANS remplacer_listes_profil ──────────────────────────────
-- Même fonction, même signature (listes_profil_atomiques) ; une cause de plus : LG001 →
-- `langue_hors_liste`. Le reste du corps est inchangé.
create or replace function public.remplacer_listes_profil(
  p_profile_id  uuid,
  p_experiences jsonb,
  p_formations  jsonb,
  p_langues     jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_domaine    uuid;
  v_ligne      jsonb;
  v_rang       bigint;
  v_liste      text;
  v_colonne    text;
  v_contrainte text;
  v_etat       text;
  v_cause      text;
  v_comptes    jsonb := '{}'::jsonb;
  v_n          integer;
begin
  select p.domain_id into v_domaine from public.profiles p where p.id = p_profile_id for update;
  if v_domaine is null then
    raise exception 'remplacer_listes_profil : profil % inconnu', p_profile_id using errcode = 'P0002';
  end if;

  begin
    if p_experiences is not null then
      v_liste := 'experiences';
      delete from public.profile_experiences e where e.profile_id = p_profile_id;
      v_n := 0;
      for v_ligne, v_rang in select x.v, x.ord from jsonb_array_elements(p_experiences) with ordinality as x(v, ord) loop
        insert into public.profile_experiences
          (profile_id, domain_id, sort_order, experience_type, role, employer, client_name, sector, start_date, end_date, is_current, description)
        values (p_profile_id, v_domaine, v_rang - 1, v_ligne ->> 'experience_type', nullif(btrim(v_ligne ->> 'role'), ''),
                nullif(btrim(v_ligne ->> 'employer'), ''), nullif(btrim(v_ligne ->> 'client_name'), ''),
                nullif(btrim(v_ligne ->> 'sector'), ''), nullif(v_ligne ->> 'start_date', '')::date,
                case when coalesce((v_ligne ->> 'is_current')::boolean, false) then null else nullif(v_ligne ->> 'end_date', '')::date end,
                coalesce((v_ligne ->> 'is_current')::boolean, false), nullif(btrim(v_ligne ->> 'description'), ''));
        v_n := v_n + 1;
      end loop;
      v_comptes := v_comptes || jsonb_build_object('experiences', v_n);
    end if;

    if p_formations is not null then
      v_liste := 'formations';
      delete from public.profile_educations e where e.profile_id = p_profile_id;
      v_n := 0;
      for v_ligne, v_rang in select x.v, x.ord from jsonb_array_elements(p_formations) with ordinality as x(v, ord) loop
        insert into public.profile_educations (profile_id, domain_id, school, degree, field, start_year, end_year, location)
        values (p_profile_id, v_domaine, nullif(btrim(v_ligne ->> 'school'), ''), nullif(btrim(v_ligne ->> 'degree'), ''),
                nullif(btrim(v_ligne ->> 'field'), ''), (v_ligne ->> 'start_year')::integer,
                (v_ligne ->> 'end_year')::integer, nullif(btrim(v_ligne ->> 'location'), ''));
        v_n := v_n + 1;
      end loop;
      v_comptes := v_comptes || jsonb_build_object('formations', v_n);
    end if;

    if p_langues is not null then
      v_liste := 'langues';
      delete from public.profile_languages l where l.profile_id = p_profile_id;
      v_n := 0;
      for v_ligne, v_rang in select x.v, x.ord from jsonb_array_elements(p_langues) with ordinality as x(v, ord) loop
        insert into public.profile_languages (profile_id, language, level, is_primary)
        values (p_profile_id, nullif(btrim(v_ligne ->> 'language'), ''), v_ligne ->> 'level',
                coalesce((v_ligne ->> 'is_primary')::boolean, false));
        v_n := v_n + 1;
      end loop;
      v_comptes := v_comptes || jsonb_build_object('langues', v_n);
    end if;
  exception
    when sqlstate 'P0002' then raise;
    when others then
      -- Tout le bloc est annulé : AUCUNE liste n'est touchée. La cause est NOMMÉE.
      get stacked diagnostics v_etat = returned_sqlstate, v_colonne = column_name, v_contrainte = constraint_name;
      v_cause := case
        when v_etat = '23502' then 'champ_obligatoire'
        when v_etat = '23505' then 'doublon'
        when v_etat = '22001' then 'texte_trop_long'
        when v_etat in ('22007', '22008') then 'date_illisible'
        when v_etat in ('22P02', '22003') then 'nombre_illisible'
        when v_etat = 'LG001' then 'langue_hors_liste'
        when v_contrainte = 'profile_experiences_check' then 'fin_avant_debut'
        when v_contrainte like 'profile_educations%check' then 'annee_hors_bornes'
        when v_etat = '23514' then 'valeur_hors_liste'
        else 'ligne_refusee'
      end;
      raise exception using
        errcode = 'LP001',
        message = jsonb_build_object('liste', v_liste, 'rang', v_rang, 'colonne', nullif(v_colonne, ''),
                                     'cause', v_cause, 'sqlstate', v_etat)::text;
  end;

  return v_comptes;
end
$fn$;

revoke all on function public.remplacer_listes_profil(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.remplacer_listes_profil(uuid, jsonb, jsonb, jsonb) to service_role;

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regclass('public.langues') is null or to_regclass('public.langues_noms') is null then
    raise exception 'postcondition NON TENUE : la liste fermée des langues manque';
  end if;
  if to_regprocedure('public.code_de_langue(text)') is null
     or to_regprocedure('public.rattacher_langues_heritees()') is null
     or to_regprocedure('public.profile_languages_langue_de_la_liste()') is null then
    raise exception 'postcondition NON TENUE : une fonction de la liste fermée manque';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.profile_languages'::regclass
       and t.tgname = 'profile_languages_langue_de_la_liste'
       and not t.tgisinternal
  ) then
    raise exception 'postcondition NON TENUE : le déclencheur de la liste fermée manque';
  end if;
  -- Filet §E.37 : `pg_get_functiondef` est STRICTE — sans `coalesce`, une définition absente rendrait NULL,
  -- `position(… in NULL) = 0` vaudrait NULL et le `if` ne s'exécuterait pas.
  if position('langue_hors_liste' in coalesce(pg_get_functiondef('public.remplacer_listes_profil(uuid, jsonb, jsonb, jsonb)'::regprocedure), '')) = 0 then
    raise exception 'postcondition NON TENUE : remplacer_listes_profil ne nomme pas la langue hors liste';
  end if;
  if has_function_privilege('authenticated', 'public.rattacher_langues_heritees()', 'execute')
     or has_table_privilege('authenticated', 'public.langues', 'insert') then
    raise exception 'postcondition NON TENUE : la liste ou sa reprise est ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : liste fermée, garde et reprise en place ; le comportement est prouvé par tests/database/profil/langues_liste_fermee.test.sql';
end
$post$;
