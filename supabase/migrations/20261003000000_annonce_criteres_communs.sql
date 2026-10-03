-- ════════════════════════════════════════════════════════════════════════════
--  LES ANNONCES ONT LES MÊMES CRITÈRES QUE L'EXPERT (lot « critères des annonces », 03/10/2026 — §D.39).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Elle n'ajoute que du NOUVEAU : six colonnes sur `publications`, une sur
--  `profiles`, chacune NULLABLE ou avec un défaut vide ; les contraintes qui les gardent n'échouent que sur une valeur
--  NON VIDE de ces colonnes, que le code en ligne n'écrit pas (aucun de ses écrivains de `publications` ni de `profiles`
--  ne les nomme — prouvé par `diag-deux-temps`, preuve `colonnes_neuves`) ; une fonction de lecture des durées ; une
--  fonction de reprise, appelée une fois ici. Rien de ce que le code en ligne écrit ne peut échouer par elle.
--
--  CE QUE YOUSSEF A VU : le mode de travail était un choix UNIQUE sur l'annonce (`publications.work_mode`, texte libre)
--  et MULTIPLE sur le profil (`profiles.work_modes`) ; la durée était un texte libre, affiché « 6 » sans unité ; « temps
--  plein ou temps partiel » n'existait nulle part.
--
--  LA RÈGLE :
--   · `publications.work_modes` — la MÊME colonne, le même vocabulaire que `profiles.work_modes` (remote, onsite, hybrid),
--     choix multiples ; ne filtre pas la mise en relation (décision de septembre) ;
--   · `jours_sur_site` / `jours_teletravail` — la répartition d'un travail « Hybride », par semaine : chacun au moins un
--     jour, sept au plus à eux deux, et seulement avec « Hybride » ;
--   · `temps_travail` (annonce ET profil) — plein, partiel, choix multiples ; ne filtre pas la mise en relation ;
--   · `duree_valeur` + `duree_unite` — un nombre (1 à 999) et une unité (jours, semaines, mois, annees), ou rien ; une
--     offre CDI n'a PAS de durée.
--   Les colonnes `work_mode` et `duration` restent : le code en ligne les écrit encore. Elles ne sont plus lues par le
--   code du lot ; leur suppression est un lot à part, APRÈS ce déploiement (§E.72 ; dette §H).
--
--  LA REPRISE (`reprendre_criteres_annonces`, appelée une fois ci-dessous, idempotente) :
--   · le mode unique d'une annonce devient sa liste (`work_mode` connu → `work_modes`) ;
--   · une durée en texte libre est reprise quand elle SE LIT (`lire_duree` : un nombre, une unité connue en quatre
--     langues, « renouvelable » toléré) — « 6 » seul ne se lit pas : quelle unité ? Elle est LISTÉE, jamais devinée ;
--   · une offre CDI garde son texte et ne reçoit aucune durée.
--   Ce qui ne se reprend pas se NOMME dans les notices du push (identifiant, texte). Rejouable : elle ne touche que ce
--   qui n'a pas encore de valeur.
--
--  Colonnes et contraintes lues (§G.10) : publications (type ∈ mission/offre/sous_traitance NOT NULL ; work_mode text,
--  duration text, libres ; seniorities text[] NOT NULL default '{}' + publications_seniorities_check ; work_zone_ids +
--  publications_publiee_requiert_zones_check ; budget + publications_budget_range_check ; déclencheurs
--  trg_publications_updated_at (BEFORE UPDATE → updated_at = now()), trg_publications_work_zones (sur work_zone_ids
--  seulement)) ; profiles (work_modes text[] NOT NULL default '{}' + profiles_work_modes_valid ; seniorities +
--  profiles_seniorities_check ; profiles_visible_requiert_criteres_check, qui ne lit pas les colonnes neuves ;
--  déclencheurs sur work_zone_ids seulement).
--
--  Prouvée par tests/database/annonces/criteres_communs.test.sql (colonnes, contraintes, une écriture « à l'ancienne »
--  qui passe, `lire_duree`, la reprise sur des lignes fabriquées).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Les colonnes de l'annonce ─────────────────────────────────────────────
alter table public.publications
  add column if not exists work_modes        text[] not null default '{}',
  add column if not exists jours_sur_site    smallint,
  add column if not exists jours_teletravail smallint,
  add column if not exists temps_travail     text[] not null default '{}',
  add column if not exists duree_valeur      integer,
  add column if not exists duree_unite       text;

comment on column public.publications.work_modes is
  'Modes de travail acceptés (remote, onsite, hybrid) — le vocabulaire de profiles.work_modes (lib/criteres/communs.ts). Ne filtre pas la mise en relation.';
comment on column public.publications.jours_sur_site is
  'Hybride : jours sur site par semaine (au moins 1 ; avec jours_teletravail, 7 au plus).';
comment on column public.publications.jours_teletravail is
  'Hybride : jours en télétravail par semaine (au moins 1 ; avec jours_sur_site, 7 au plus).';
comment on column public.publications.temps_travail is
  'Temps plein (plein) et/ou temps partiel (partiel) — le vocabulaire de profiles.temps_travail. Ne filtre pas la mise en relation.';
comment on column public.publications.duree_valeur is
  'Durée de la mission : un nombre (1 à 999) d''unités duree_unite. Jamais pour une offre CDI.';
comment on column public.publications.duree_unite is
  'Unité de la durée : jours, semaines, mois, annees.';
comment on column public.publications.work_mode is
  'HÉRITÉE — remplacée par work_modes (03/10/2026). Le code en ligne avant ce lot l''écrit encore ; plus aucune lecture. À supprimer dans un lot suivant.';
comment on column public.publications.duration is
  'HÉRITÉE — remplacée par duree_valeur + duree_unite (03/10/2026). Le code en ligne avant ce lot l''écrit encore ; plus aucune lecture. À supprimer dans un lot suivant.';

alter table public.publications drop constraint if exists publications_work_modes_valid;
alter table public.publications
  add constraint publications_work_modes_valid
  check (work_modes <@ array['remote', 'onsite', 'hybrid']::text[]);

alter table public.publications drop constraint if exists publications_temps_travail_valid;
alter table public.publications
  add constraint publications_temps_travail_valid
  check (temps_travail <@ array['plein', 'partiel']::text[]);

alter table public.publications drop constraint if exists publications_repartition_hybride_check;
alter table public.publications
  add constraint publications_repartition_hybride_check
  check (
    (jours_sur_site is null and jours_teletravail is null)
    -- Les deux `is not null` : une répartition À MOITIÉ (des jours sur site, aucun en télétravail) rendait NULL, qu'un
    -- CHECK laisse passer — la même faute que la durée sans unité (rejeu local de la première livraison).
    or ('hybrid' = any (work_modes)
        and jours_sur_site is not null and jours_teletravail is not null
        and jours_sur_site between 1 and 7
        and jours_teletravail between 1 and 7
        and jours_sur_site + jours_teletravail <= 7)
  );

alter table public.publications drop constraint if exists publications_duree_check;
alter table public.publications
  add constraint publications_duree_check
  check (
    (duree_valeur is null and duree_unite is null)
    -- Une durée, c'est un nombre ET une unité (règle de Youssef). Les deux `is not null` sont NÉCESSAIRES : sans eux,
    -- « 6, aucune unité » rendait `true and null` = NULL, qu'un CHECK LAISSE PASSER (rejeu local de la première
    -- livraison : le test B7 n'était pas refusé).
    or (duree_valeur is not null and duree_unite is not null
        and duree_valeur between 1 and 999 and duree_unite in ('jours', 'semaines', 'mois', 'annees'))
  );

alter table public.publications drop constraint if exists publications_offre_sans_duree;
alter table public.publications
  add constraint publications_offre_sans_duree
  check (type <> 'offre' or duree_valeur is null);

-- ── 2. La colonne du profil ──────────────────────────────────────────────────
alter table public.profiles
  add column if not exists temps_travail text[] not null default '{}';

comment on column public.profiles.temps_travail is
  'Temps plein (plein) et/ou temps partiel (partiel) que l''expert accepte — le vocabulaire de publications.temps_travail. Ne filtre pas la mise en relation.';

alter table public.profiles drop constraint if exists profiles_temps_travail_valid;
alter table public.profiles
  add constraint profiles_temps_travail_valid
  check (temps_travail <@ array['plein', 'partiel']::text[]);

-- ── 3. Lire une durée écrite en texte libre ──────────────────────────────────
--  Un nombre entier (1 à 999), une unité connue (français, anglais, espagnol, allemand ; singulier, pluriel, abrégée),
--  « renouvelable(s) » toléré à la fin. Rien d'autre ne se lit : « 6 » (quelle unité ?), « 3 à 6 mois », « CDI », « long
--  terme » rendent NULL — une durée qu'on ne sait pas lire ne se devine pas.
create or replace function public.lire_duree(p_texte text)
  returns table (valeur integer, unite text)
  language plpgsql
  immutable
  set search_path to 'public'
as $fn$
declare
  v_m     text[];
  v_n     integer;
  v_mot   text;
begin
  v_m := regexp_match(lower(btrim(coalesce(p_texte, ''))),
                      -- Les lettres sont ÉNUMÉRÉES : `[[:alpha:]]` dépend de la locale de la base et peut ignorer
                      -- les lettres accentuées (« años », « días », « années »).
                      '^(\d{1,3})\s*([a-zàâäéèêëíîïñóôöúûüß]+)\.?(\s+renouvelables?)?$');
  if v_m is null then return; end if;
  v_n := v_m[1]::integer;
  if v_n < 1 or v_n > 999 then return; end if;
  v_mot := v_m[2];
  unite := case
    when v_mot in ('j', 'jr', 'jrs', 'jour', 'jours', 'd', 'day', 'days', 'dia', 'dias', 'día', 'días', 'tag', 'tage')
      then 'jours'
    when v_mot in ('sem', 'semaine', 'semaines', 'w', 'wk', 'wks', 'week', 'weeks', 'semana', 'semanas', 'woche', 'wochen')
      then 'semaines'
    when v_mot in ('m', 'mois', 'month', 'months', 'mes', 'meses', 'monat', 'monate')
      then 'mois'
    when v_mot in ('an', 'ans', 'année', 'années', 'annee', 'annees', 'y', 'yr', 'yrs', 'year', 'years',
                   'año', 'años', 'ano', 'anos', 'jahr', 'jahre')
      then 'annees'
    else null
  end;
  if unite is null then return; end if;
  valeur := v_n;
  return next;
end
$fn$;

revoke all on function public.lire_duree(text) from public, anon, authenticated;

comment on function public.lire_duree(text) is
  'Lit une durée écrite en texte libre (« 6 mois », « 3 weeks », « 1 an renouvelable ») : un nombre de 1 à 999 et une unité connue (jours, semaines, mois, annees). Ne devine rien : « 6 », « 3 à 6 mois » rendent zéro ligne.';

-- ── 4. La reprise — idempotente, elle ne touche que ce qui n'a pas encore de valeur ──
--  Rend ce qu'elle a repris et ce qu'elle n'a PAS pu reprendre, NOMMÉ (identifiant, texte).
create or replace function public.reprendre_criteres_annonces()
  returns jsonb
  language plpgsql
  set search_path to 'public'
as $fn$
declare
  v_modes      integer;
  v_durees     integer;
  v_illisibles jsonb;
  v_modes_inc  jsonb;
  v_offres     integer;
begin
  -- ① Le mode unique devient la liste, quand il est connu.
  update public.publications p
     set work_modes = array[p.work_mode]
   where p.work_modes = '{}'
     and p.work_mode in ('remote', 'onsite', 'hybrid');
  get diagnostics v_modes = row_count;

  -- ② La durée en texte devient un nombre et une unité, quand elle se lit — jamais pour une offre CDI.
  update public.publications p
     set duree_valeur = d.valeur,
         duree_unite  = d.unite
    from public.publications src
    cross join lateral public.lire_duree(src.duration) d
   where p.id = src.id
     and p.type <> 'offre'
     and p.duree_valeur is null
     and nullif(btrim(p.duration), '') is not null;
  get diagnostics v_durees = row_count;

  -- ③ Ce qui ne se reprend pas, NOMMÉ.
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'duree', p.duration) order by p.id), '[]'::jsonb)
    into v_illisibles
    from public.publications p
   where p.type <> 'offre'
     and p.duree_valeur is null
     and nullif(btrim(p.duration), '') is not null;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'mode', p.work_mode) order by p.id), '[]'::jsonb)
    into v_modes_inc
    from public.publications p
   where p.work_modes = '{}'
     and nullif(btrim(p.work_mode), '') is not null
     and p.work_mode not in ('remote', 'onsite', 'hybrid');

  select count(*) into v_offres
    from public.publications p
   where p.type = 'offre' and nullif(btrim(p.duration), '') is not null;

  return jsonb_build_object(
    'modes_repris', v_modes,
    'durees_reprises', v_durees,
    'durees_illisibles', v_illisibles,
    'modes_inconnus', v_modes_inc,
    'offres_avec_duree_texte', v_offres
  );
end
$fn$;

revoke all on function public.reprendre_criteres_annonces() from public, anon, authenticated;

comment on function public.reprendre_criteres_annonces() is
  'Reprise du lot « critères des annonces » : work_mode → work_modes, duration (texte) → duree_valeur + duree_unite quand elle se lit (jamais pour une offre CDI). Idempotente. Rend ce qui est repris et ce qui ne l''est pas, nommé.';

-- ── 5. La reprise, exécutée une fois — une reprise de données VOULUE, dans son propre bloc (§G.4 ter) ──
do $reprise$
declare
  v jsonb := public.reprendre_criteres_annonces();
begin
  raise notice 'critères des annonces : % mode(s) de travail repris, % durée(s) reprise(s)',
    v ->> 'modes_repris', v ->> 'durees_reprises';
  if jsonb_array_length(v -> 'durees_illisibles') > 0 then
    raise notice 'critères des annonces : % durée(s) en texte NON reprise(s) — elles ne se lisent pas (unité absente ou inconnue) ; à corriger dans l''annonce : %',
      jsonb_array_length(v -> 'durees_illisibles'), v -> 'durees_illisibles';
  end if;
  if jsonb_array_length(v -> 'modes_inconnus') > 0 then
    raise notice 'critères des annonces : % mode(s) de travail inconnu(s), non repris : %',
      jsonb_array_length(v -> 'modes_inconnus'), v -> 'modes_inconnus';
  end if;
  if (v ->> 'offres_avec_duree_texte')::integer > 0 then
    raise notice 'critères des annonces : % offre(s) CDI portent une durée en texte — une offre CDI n''a pas de durée, rien n''est repris',
      v ->> 'offres_avec_duree_texte';
  end if;
end
$reprise$;

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'publications'
         and c.column_name in ('work_modes', 'jours_sur_site', 'jours_teletravail', 'temps_travail', 'duree_valeur', 'duree_unite')) <> 6
     or not exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = 'profiles' and c.column_name = 'temps_travail') then
    raise exception 'postcondition NON TENUE : une colonne des critères manque';
  end if;
  if (select count(*) from pg_constraint k join pg_namespace n on n.oid = k.connamespace
       where n.nspname = 'public' and k.convalidated
         and k.conname in ('publications_work_modes_valid', 'publications_temps_travail_valid',
                           'publications_repartition_hybride_check', 'publications_duree_check',
                           'publications_offre_sans_duree', 'profiles_temps_travail_valid')) <> 6 then
    raise exception 'postcondition NON TENUE : une contrainte des critères manque, ou n''est pas validée';
  end if;
  if to_regprocedure('public.lire_duree(text)') is null
     or to_regprocedure('public.reprendre_criteres_annonces()') is null then
    raise exception 'postcondition NON TENUE : une fonction des critères manque';
  end if;
  if has_function_privilege('authenticated', 'public.lire_duree(text)', 'execute')
     or has_function_privilege('authenticated', 'public.reprendre_criteres_annonces()', 'execute') then
    raise exception 'postcondition NON TENUE : une fonction des critères est ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : colonnes, contraintes validées, fonctions fermées au navigateur ; prouvé par tests/database/annonces/criteres_communs.test.sql';
end
$post$;
