-- ════════════════════════════════════════════════════════════════════════════
--  LES LANGUES PARLÉES : LA GARDE — le second temps de la liste fermée (recette S1 du 01/10/2026, point 3 ;
--  relecture indépendante du 01/10/2026, point 1).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : APRÈS le déploiement du lot A (§E.72, §E.91). Le code d'AVANT le lot A (13d1524) écrit les
--  langues en TEXTE LIBRE ; posé dans le lot A, ce déclencheur aurait fait échouer chaque enregistrement de profil
--  portant une langue entre le `db push` et le `git push`. Le code du lot A n'écrit plus que des CODES de la liste
--  (l'écran les choisit dans la liste ; l'analyse d'un CV les rattache par la même liste, `rattacheurDeLangues`).
--
--  CE QUE FAIT CETTE MIGRATION, DANS CET ORDRE :
--    1. LA REPRISE, RELANCÉE — `rattacher_langues_heritees()` (lot A, `langues_liste_fermee`) : les lignes écrites en
--       texte libre ENTRE le push du lot A et son déploiement (le code d'avant, encore en ligne quelques minutes) sont
--       rattachées à leur code, exactement comme au premier passage. Rejouable : ce qui est déjà un code n'est pas touché.
--    2. LA GARDE — le déclencheur `profile_languages_langue_de_la_liste` refuse, à l'insertion comme au changement de
--       `language`, tout code hors de la liste ACTIVE (`LG001`). `remplacer_listes_profil` le nomme déjà
--       (`langue_hors_liste`, lot A). Une ligne héritée que rien ne reconnaît RESTE (le déclencheur ne relit pas
--       l'existant) : l'écran de validation la montre et demande de la choisir.
--
--  Colonnes et contraintes lues (§G.10) : profile_languages (language text NOT NULL, unique (profile_id, language),
--  level A1–C2 ou native) ; langues (code PK, active NOT NULL).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. LA REPRISE, RELANCÉE — son propre bloc (§G.4 ter), AVANT la garde ─────
do $reprise$
declare
  v_bilan jsonb;
begin
  v_bilan := public.rattacher_langues_heritees();
  raise notice 'reprise des langues (second passage) : % rattachée(s), % doublon(s) fondu(s), % liste(s) plate(s) reprise(s), % non reconnue(s) laissée(s) telle(s) quelle(s)',
    v_bilan ->> 'rattachees', v_bilan ->> 'doublons', v_bilan ->> 'profils', v_bilan ->> 'non_reconnues';
end
$reprise$;

-- ── 2. LA GARDE ──────────────────────────────────────────────────────────────
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

comment on function public.profile_languages_langue_de_la_liste() is
  'Garde de profile_languages : une langue est un CODE de la liste fermée active (LG001 sinon). Posée au second temps (après le déploiement du code qui n''écrit plus que des codes), après une reprise relancée.';

drop trigger if exists profile_languages_langue_de_la_liste on public.profile_languages;
create trigger profile_languages_langue_de_la_liste
  before insert or update of language on public.profile_languages
  for each row execute function public.profile_languages_langue_de_la_liste();


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.profile_languages'::regclass
       and t.tgname = 'profile_languages_langue_de_la_liste'
       and not t.tgisinternal
  ) then
    raise exception 'postcondition NON TENUE : la garde des langues manque';
  end if;
  raise notice 'postcondition tenue : la garde des langues est posée, après la reprise relancée ; prouvée par tests/database/profil/langues_garde.test.sql';
end
$post$;
