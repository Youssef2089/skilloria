-- ════════════════════════════════════════════════════════════════════════════
--  UN CONTINENT ENTIER COUVRE AUSSI UN PAYS AJOUTÉ PLUS TARD AU RÉFÉRENTIEL
--  (lot zones de travail, 02/10/2026 — décision de Youssef, point 2).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Elle n'ajoute qu'une fonction et un déclencheur sur `work_zones`, une
--  table qu'AUCUN code de l'application n'écrit (le référentiel ne s'écrit que par migration) : rien de ce que le code
--  en ligne écrit ne peut échouer par elle. `diag-deux-temps` le PROUVE (exception raisonnée, avec la preuve « aucun
--  écrivain de work_zones » sur le code en ligne et sur celui du lot).
--
--  LE DÉFAUT : l'aplatissement des zones vers les codes pays (`work_zone_countries`) est calculé À L'ÉCRITURE du
--  profil ou de l'annonce (`trg_*_work_zones` → `work_zone_country_codes()`). La migration du référentiel le disait
--  (« LIMITE CONNUE, ASSUMÉE ») et confiait le recalcul à une instruction à lancer À LA MAIN après tout ajout de pays.
--  Un pays rattaché à l'Europe après coup n'était donc PAS couvert par un expert « Europe — tout le continent » ni par
--  une annonce « Partout dans le monde », tant que personne ne relançait l'instruction — et rien ne le disait.
--
--  LA RÈGLE, en base, par déclencheur — jamais dans une route : toute écriture du référentiel qui change ce qu'une
--  zone couvre (un pays ajouté, déplacé, activé, désactivé, supprimé) recalcule les profils et les annonces qui ont
--  choisi CETTE zone ou l'un de ses ANCÊTRES (un continent, le monde). Le recalcul passe par la source unique : il
--  ré-écrit `work_zone_ids` à l'identique, ce qui déclenche `sync_work_zone_countries()` ; il ne touche QUE les lignes
--  dont la couverture change vraiment (`is distinct from`).
--
--  LE RESTE NE BOUGE PAS : la saisie enregistre « Tout le continent » = le continent, des pays cochés = ces pays ; le
--  filtre du moteur reste `work_zone_countries && …` dans les deux sens (lib/matching/pool.ts, run-for-expert.ts).
--
--  Colonnes et contraintes lues (§G.10) : work_zones (parent_id → work_zones ON DELETE RESTRICT, kind world/continent/
--  country, country_code → countries, cohérence pays ⇔ code, racine unique, `active` NOT NULL) ; profiles et
--  publications (work_zone_ids uuid[] NOT NULL défaut '{}', work_zone_countries varchar(2)[] NOT NULL, DÉRIVÉE par
--  trg_profiles_work_zones / trg_publications_work_zones — BEFORE INSERT OR UPDATE OF work_zone_ids) ; contraintes
--  profiles_visible_requiert_criteres_check et publications_publiee_requiert_zones_check (sur work_zone_ids, que le
--  recalcul ne change pas). Aucun autre déclencheur sur ces deux tables que `updated_at` (baseline).
--
--  Prouvée par tests/database/matching/zones_recoupement.test.sql (le pays ajouté à l'Europe après coup est couvert,
--  dans les deux sens ; un témoin non concerné n'est pas touché).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. LE RECALCUL — une fonction, appelée par le déclencheur et par la reprise ──
--  `p_zones` : les zones dont la couverture a pu changer (et leurs ancêtres) ; NULL = toutes.
create or replace function public.recalculer_couverture_des_zones(p_zones uuid[])
  returns jsonb
  language plpgsql
  set search_path to 'public'
as $fn$
declare
  v_profils  integer;
  v_annonces integer;
begin
  update public.profiles p
     set work_zone_ids = p.work_zone_ids
   where (p_zones is null or p.work_zone_ids && p_zones)
     and p.work_zone_countries is distinct from public.work_zone_country_codes(p.work_zone_ids);
  get diagnostics v_profils = row_count;

  update public.publications u
     set work_zone_ids = u.work_zone_ids
   where (p_zones is null or u.work_zone_ids && p_zones)
     and u.work_zone_countries is distinct from public.work_zone_country_codes(u.work_zone_ids);
  get diagnostics v_annonces = row_count;

  return jsonb_build_object('profils', v_profils, 'annonces', v_annonces);
end
$fn$;

revoke all on function public.recalculer_couverture_des_zones(uuid[]) from public, anon, authenticated;

comment on function public.recalculer_couverture_des_zones(uuid[]) is
  'Recalcule work_zone_countries des profils et annonces qui ont choisi l''une des zones données (NULL = toutes), par la source unique (sync_work_zone_countries). Ne touche que les lignes dont la couverture change. Appelée par le déclencheur work_zones_couverture et par la reprise de la migration zones_couverture_suit_le_referentiel.';

-- ── 2. LE DÉCLENCHEUR — sur le référentiel, jamais dans une route ──────────────
create or replace function public.work_zones_couverture()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $fn$
declare
  v_depart uuid[];
  v_zones  uuid[];
begin
  -- La zone touchée, son parent d'avant et son parent d'après : la couverture de chacun, et de leurs ancêtres, a pu changer.
  if tg_op = 'INSERT' then
    v_depart := array[new.id, new.parent_id];
  elsif tg_op = 'UPDATE' then
    v_depart := array[new.id, new.parent_id, old.parent_id];
  else
    v_depart := array[old.id, old.parent_id];
  end if;
  v_depart := array_remove(v_depart, null);

  with recursive ancetres(id, parent_id) as (
    select z.id, z.parent_id from public.work_zones z where z.id = any (v_depart)
    union
    select z.id, z.parent_id from public.work_zones z join ancetres a on z.id = a.parent_id
  )
  select coalesce(array_agg(distinct a.id), '{}'::uuid[]) into v_zones from ancetres a;

  -- Une zone SUPPRIMÉE n'est plus dans la table : son identifiant est gardé tel quel (des profils le citent encore).
  perform public.recalculer_couverture_des_zones(v_zones || v_depart);
  return null;
end
$fn$;

revoke all on function public.work_zones_couverture() from public, anon, authenticated;

comment on function public.work_zones_couverture() is
  'Déclencheur du référentiel des zones : un pays ajouté, déplacé, activé, désactivé ou supprimé recalcule la couverture des profils et annonces qui ont choisi cette zone ou un de ses ancêtres (un continent entier, le monde).';

drop trigger if exists work_zones_couverture on public.work_zones;
create trigger work_zones_couverture
  after insert or update of parent_id, active, country_code or delete on public.work_zones
  for each row execute function public.work_zones_couverture();

-- ── 3. LA REPRISE — son propre bloc (§G.4 ter) : une couverture déjà en retard se rattrape ──
--  Aucune ligne n'est touchée si toutes les couvertures sont à jour (le cas attendu : le référentiel n'a pas changé
--  depuis la migration qui l'a semé). Elle ne lit que ce qu'elle reprend, et le dit en chiffres.
do $reprise$
declare
  v_bilan jsonb;
begin
  v_bilan := public.recalculer_couverture_des_zones(null);
  raise notice 'couverture des zones : % profil(s) et % annonce(s) recalculés',
    v_bilan ->> 'profils', v_bilan ->> 'annonces';
end
$reprise$;

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.recalculer_couverture_des_zones(uuid[])') is null
     or to_regprocedure('public.work_zones_couverture()') is null then
    raise exception 'postcondition NON TENUE : une fonction de couverture des zones manque';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.work_zones'::regclass
                  and t.tgname = 'work_zones_couverture' and not t.tgisinternal) then
    raise exception 'postcondition NON TENUE : le déclencheur work_zones_couverture manque';
  end if;
  if has_function_privilege('authenticated', 'public.recalculer_couverture_des_zones(uuid[])', 'execute') then
    raise exception 'postcondition NON TENUE : le recalcul est ouvert au navigateur';
  end if;
  raise notice 'postcondition tenue : la couverture suit le référentiel ; le geste est prouvé par tests/database/matching/zones_recoupement.test.sql';
end
$post$;
