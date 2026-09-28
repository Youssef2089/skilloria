-- ════════════════════════════════════════════════════════════════════════════
--  UNE ANNONCE EXPIRÉE S'ÉCRIT AU GRAND LIVRE — PAR UN CONSTAT, UNE FOIS.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/cron/constats` appelle
--  `constater_annonces_expirees()` dès ce commit, et la planification l'appelle
--  chaque nuit. Rejouable.
--
--  L'EXPIRATION N'EST PAS UN GESTE : personne n'agit, l'annonce cesse d'être
--  active parce que sa durée de vie est écoulée — une règle appliquée À LA
--  LECTURE (`annonce_active()`, jumelle de lib/publications/expiry.ts). Rien
--  n'écrit `expires_at`, rien ne bascule le statut. Pour qu'elle laisse une
--  ligne, il faut la CONSTATER : une tâche passe, trouve ce qui n'est plus
--  actif et n'a pas encore été constaté, et l'écrit — UNE fois, tenue par une
--  colonne-marqueur (`expiration_constatee_at`) posée dans la même transaction
--  que la ligne. La date du constat n'est pas la date de l'expiration : la
--  ligne porte la durée de vie EN VIGUEUR au constat — les dates de l'annonce
--  restent sur sa ligne, immuables, et l'expiration se relit avec les deux.
--  Le détail ne RECOPIE pas les colonnes de la règle : le contrôle d'expiration
--  refuse toute composition de `published_at` et `expires_at` hors de
--  `annonce_active()`, et il a raison — une recopie finit par calculer. Un long
--  passé s'égrène par passages bornés : aucune reprise à la main.
--
--  LA PIÈCE est celle du passage (une par passage, née dans la route,
--  transmise en paramètre) ; l'origine est la tâche, sans acteur.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ① LA COLONNE-MARQUEUR ────────────────────────────────────────────────────
alter table public.publications
  add column if not exists expiration_constatee_at timestamptz;

comment on column public.publications.expiration_constatee_at is
  'Posé par constater_annonces_expirees() dans la transaction qui écrit la ligne annonce_expiree du grand livre : une expiration se constate UNE fois. Null tant que l''annonce est active ou que le constat n''est pas passé.';

-- L'index de la file à constater : ce qui est publié et pas encore constaté.
-- Le prédicat ne porte PAS le statut — la visibilité passe par annonce_active().
create index if not exists publications_expiration_a_constater_idx
  on public.publications (published_at)
  where expiration_constatee_at is null and published_at is not null;


-- ── ② LE CONSTAT — marqueur et ligne, dans la même transaction ──────────────
create or replace function public.constater_annonces_expirees(
  p_piece             uuid,
  p_vie_annonce_jours integer,
  p_limite            integer
) returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_n integer := 0;
  v_k integer;
  r   record;
begin
  if p_piece is null then
    raise exception 'constater_annonces_expirees : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_vie_annonce_jours is null or p_vie_annonce_jours <= 0 then
    raise exception 'constater_annonces_expirees : duree de vie invalide (%)', p_vie_annonce_jours using errcode = '22023';
  end if;

  -- Publiées, jamais constatées, et PLUS actives selon la SEULE règle du
  -- schéma. Un passage est borné ; un long passé s'égrène passage après passage.
  for r in
    select p.id, p.domain_id
      from public.publications p
     where p.expiration_constatee_at is null
       and p.published_at is not null
       and p.status = 'published'
       and not public.annonce_active(p.status, p.expires_at, p.published_at, p_vie_annonce_jours)
     order by p.published_at
     limit greatest(coalesce(p_limite, 1), 1)
       for update skip locked
  loop
    update public.publications
       set expiration_constatee_at = now()
     where id = r.id;
    get diagnostics v_k = row_count;
    perform public.exiger_ecriture(v_k, 'constater_annonces_expirees : publications');

    perform public.journaliser(
      p_piece, 'annonce_expiree', 'reussi', 'tache_planifiee',
      null::uuid, null::text, r.domain_id,
      'publications', r.id,
      jsonb_build_object('vie_annonce_jours', p_vie_annonce_jours),
      null::uuid, null::numeric, null::text);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$fn$;

revoke all on function public.constater_annonces_expirees(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.constater_annonces_expirees(uuid, integer, integer) to service_role;


-- ── ③ LA LISTE BLANCHE ───────────────────────────────────────────────────────
update public.grand_livre_actions
   set cles_detail = array['vie_annonce_jours']::text[]
 where code = 'annonce_expiree';


-- ── ③bis LE PASSIF — marqué SANS ligne (point 2.11) ────────────────────────
--  Décision de Youssef (26/09/2026) : AUCUNE ligne rétroactive, pas de reprise de
--  l'historique. Sans ceci, le premier passage constaterait toute annonce DÉJÀ
--  expirée, avec une ligne datée d'aujourd'hui pour un fait ancien. La règle
--  « expirée » a sa source unique EN SQL (`annonce_active()`) : la migration pose
--  donc le marqueur elle-même sur le passif, sans écrire, et dit combien.
do $passif$
declare
  v_vie integer;
  v_n   integer;
begin
  select d.vie_annonce_jours into v_vie from public.duree_reglages d where d.ligne_unique;
  if v_vie is null then
    raise notice 'passif des annonces expirees : duree_reglages vide — rien a marquer (base vierge)';
    return;
  end if;
  update public.publications p
     set expiration_constatee_at = now()
   where p.expiration_constatee_at is null
     and p.published_at is not null
     and p.status = 'published'
     and not public.annonce_active(p.status, p.expires_at, p.published_at, v_vie);
  get diagnostics v_n = row_count;
  raise notice 'passif des annonces expirees : % annonce(s) marquee(s) SANS ligne au grand livre (pas de reprise de l historique)', v_n;
end
$passif$;


-- ── ④ LA PLANIFICATION — 04:50 UTC, après les purges et le ménage ───────────
do $$
begin
  perform cron.unschedule('constats_trigger');
exception when others then
  null; -- pas encore planifiée
end
$$;

select cron.schedule(
  'constats_trigger',
  '50 4 * * *',
  $job$select public.trigger_purge_cron('constats_trigger', '/api/cron/constats')$job$
);


-- ── ⑤ LE CATALOGUE — une tâche technique, qui écrit son verdict elle-même ───
insert into public.cron_job_catalog
  (job_name, label_key, description_key, criticality, writes_run_log, display_order)
values
  ('constats_trigger',
   'jobs.constats.label', 'jobs.constats.description',
   'technical', true, 80)
on conflict (job_name) do nothing;


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui constatait une vraie annonce expirée est retirée (28/09/2026). La REPRISE voulue — le passif
-- marqué sans ligne, bloc $passif$ plus haut — reste : c'est une migration de données décidée, pas une
-- sonde. Le geste — marqueur et ligne ensemble, durée en vigueur dans la ligne, annonce active non
-- constatée, second passage sans rien — est prouvé par supabase/tests/database/grand_livre/annonce_expiree.test.sql.
declare
  v_cles text[];
begin
  if to_regprocedure('public.constater_annonces_expirees(uuid, integer, integer)') is null then
    raise exception 'postcondition NON TENUE : constater_annonces_expirees manque ou a change de signature';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'publications' and column_name = 'expiration_constatee_at') then
    raise exception 'postcondition NON TENUE : publications.expiration_constatee_at manque';
  end if;
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                  where c.relname = 'publications_expiration_a_constater_idx' and i.indpred is not null) then
    raise exception 'postcondition NON TENUE : l index partiel de la file a constater manque (§E.60)';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'annonce_expiree';
  if v_cles is null or not (v_cles @> array['vie_annonce_jours']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de annonce_expiree est incomplete [vu : %]', v_cles;
  end if;
  if not exists (select 1 from public.cron_job_catalog where job_name = 'constats_trigger') then
    raise exception 'postcondition NON TENUE : constats_trigger absent du catalogue';
  end if;
  if not exists (select 1 from cron.job where jobname = 'constats_trigger') then
    raise exception 'postcondition NON TENUE : constats_trigger non planifiee';
  end if;
  begin
    perform public.journaliser(gen_random_uuid(), 'annonce_expiree', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"vie_annonce_jours":30,"title":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans annonce_expiree';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : annonce_expiree — signature par types, colonne, index partiel, tache planifiee et cataloguee, liste blanche, texte libre refuse ; le geste est prouve par tests/database/grand_livre/annonce_expiree.test.sql';
end
$post$;
