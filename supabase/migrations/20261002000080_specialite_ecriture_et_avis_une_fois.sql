-- ════════════════════════════════════════════════════════════════════════════
--  UNE SPÉCIALITÉ S'ÉCRIT EN UNE FOIS, ET CHAQUE EXPERT EST PRÉVENU UNE SEULE FOIS PAR DÉSACTIVATION
--  (relecture du lot zones de travail, 02/10/2026 — points 4 et 5).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Elle n'ajoute que du nouveau : une colonne NULLABLE sur `specialities`, deux
--  fonctions, un index unique PARTIEL sur `notifications` restreint au type `specialite_retiree` — un type que le code en
--  ligne n'écrit pas (il est né avec ce lot). Rien de ce que le code en ligne écrit ne peut échouer par elle.
--
--  LES DEUX DÉFAUTS (relecteur) :
--   4. La route `update-speciality` écrivait les traductions PUIS la spécialité (ou l'inverse), en deux appels, et une
--      traduction refusée n'était que JOURNALISÉE : une réactivation pouvait laisser des traductions écrites sans la
--      réactivation, ou l'inverse, et l'administrateur ne lisait pas la cause.
--   5. Les experts étaient prévenus APRÈS la ligne du grand livre : une ligne refusée, et personne n'était prévenu, sans que
--      l'écran le dise ; et le rejeu conseillé (réactiver puis désactiver) prévenait une seconde fois ceux qui l'avaient
--      déjà été.
--
--  LA RÈGLE :
--   · `modifier_specialite()` écrit les traductions (d'ABORD : la garde de réactivation lit celles qui RESTERONT) puis la
--     spécialité, dans UNE transaction : un refus (« Autre », un slug pris, une traduction refusée) n'écrit RIEN, et
--     remonte tel quel — la route en rend la cause ;
--   · une spécialité inactive porte la PIÈCE de sa désactivation (`desactivation_piece`) : posée au passage d'active à
--     inactive, gardée tant qu'elle reste inactive (une spécialité désactivée AVANT ce lot la reçoit au premier rejeu),
--     effacée à la réactivation ;
--   · `prevenir_retrait_specialite()` pose les notifications sous cette pièce, et l'index unique
--     `notifications_retrait_specialite_une_fois` (destinataire, spécialité, pièce) refuse le doublon : un rejeu ne
--     prévient QUE ceux qui ne l'ont pas encore été, pour CETTE désactivation. Le conflit se résout EN SQL, avec le
--     prédicat de l'index partiel (§E.69 : PostgREST ne sait pas le dire).
--
--  Colonnes et contraintes lues (§G.10) : specialities (name varchar(100) NOT NULL, slug varchar(50) NOT NULL, unique
--  (branch_id, slug), active NOT NULL, sort_order integer NOT NULL ; contrainte specialities_autre_hors_referentiel ;
--  déclencheurs trg_specialities_updated_at, specialites_reactivation_hors_autre) ; translations (clé (table_name, row_id,
--  field, locale), value text NOT NULL ; déclencheur translations_specialite_autre) ; notifications (user_id, domain_id,
--  type varchar(50) NOT NULL, channel ∈ email/inapp/both, title varchar(200), body text, link_url varchar(500), status ∈
--  pending/sent/failed/read, entity_id uuid, piece uuid ; index notifications_match_unique_idx, sans rapport) ;
--  exiger_ecriture(bigint, text, bigint) lève EC001.
--
--  Prouvée par tests/database/taxonomie/specialite_ecriture_et_avis.test.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. La pièce de la désactivation ─────────────────────────────────────────
alter table public.specialities add column if not exists desactivation_piece uuid;

comment on column public.specialities.desactivation_piece is
  'La pièce du geste qui a désactivé la spécialité (posée par modifier_specialite, effacée à la réactivation). Les avis aux experts sont posés sous elle : un rejeu ne prévient que ceux qui ne l''ont pas été.';

-- ── 2. Un avis par expert et par désactivation ──────────────────────────────
create unique index if not exists notifications_retrait_specialite_une_fois
  on public.notifications (user_id, entity_id, piece)
  where type = 'specialite_retiree';

comment on index public.notifications_retrait_specialite_une_fois is
  'Un expert est prévenu UNE fois par désactivation d''une spécialité (entity_id = la spécialité, piece = la pièce de sa désactivation), rejeu compris.';

-- ── 3. L'écriture d'une spécialité, tout ou rien ─────────────────────────────
--  p_champs : les champs à écrire (name, slug, active, sort_order — une clé absente ne change rien) ;
--  p_traductions : [{locale, value}] à écrire ; p_effacer : les langues dont la traduction s'efface ;
--  p_piece : la pièce du geste. Rend la pièce de la désactivation EN COURS (null si la spécialité est active).
create or replace function public.modifier_specialite(
  p_id           uuid,
  p_champs       jsonb,
  p_traductions  jsonb,
  p_effacer      text[],
  p_piece        uuid
)
  returns uuid
  language plpgsql
  set search_path to 'public'
as $fn$
declare
  v_avant boolean;
  v_apres boolean;
  v_n     bigint;
  v_piece uuid;
begin
  if p_piece is null then
    raise exception 'modifier_specialite : la pièce du geste manque' using errcode = 'SP002';
  end if;
  select s.active into v_avant from public.specialities s where s.id = p_id for update;
  if not found then
    raise exception 'modifier_specialite : spécialité % introuvable', p_id using errcode = 'SP001';
  end if;
  v_apres := case when coalesce(p_champs, '{}'::jsonb) ? 'active' then (p_champs ->> 'active')::boolean else v_avant end;

  -- ① Les traductions D'ABORD : la garde de réactivation lit celles qui RESTERONT après le geste.
  if jsonb_typeof(p_traductions) = 'array' and jsonb_array_length(p_traductions) > 0 then
    insert into public.translations (table_name, row_id, field, locale, value, updated_at)
    select 'specialities', p_id, 'name', t.locale, t.value, now()
      from jsonb_to_recordset(p_traductions) as t(locale text, value text)
    on conflict (table_name, row_id, field, locale) do update set value = excluded.value, updated_at = excluded.updated_at;
  end if;
  if coalesce(cardinality(p_effacer), 0) > 0 then
    delete from public.translations t
     where t.table_name = 'specialities' and t.row_id = p_id and t.field = 'name' and t.locale = any (p_effacer);
  end if;

  -- ② La spécialité : la pièce de sa désactivation suit son état.
  if coalesce(p_champs, '{}'::jsonb) <> '{}'::jsonb then
    update public.specialities s
       set name                = case when p_champs ? 'name' then p_champs ->> 'name' else s.name end,
           slug                = case when p_champs ? 'slug' then p_champs ->> 'slug' else s.slug end,
           active              = v_apres,
           sort_order          = case when p_champs ? 'sort_order' then (p_champs ->> 'sort_order')::integer else s.sort_order end,
           desactivation_piece = case when v_apres then null when v_avant then p_piece else s.desactivation_piece end
     where s.id = p_id;
    get diagnostics v_n = row_count;
    perform public.exiger_ecriture(v_n, 'modifier_specialite : la spécialité');
  end if;

  -- ③ Une spécialité INACTIVE porte toujours la pièce d'une désactivation : celle désactivée avant ce lot la reçoit au
  --    premier geste (un rejeu « prévenir »), et la garde ensuite.
  if not v_apres then
    update public.specialities s set desactivation_piece = p_piece where s.id = p_id and s.desactivation_piece is null;
  end if;

  select s.desactivation_piece into v_piece from public.specialities s where s.id = p_id;
  return v_piece;
end
$fn$;

revoke all on function public.modifier_specialite(uuid, jsonb, jsonb, text[], uuid) from public, anon, authenticated;

comment on function public.modifier_specialite(uuid, jsonb, jsonb, text[], uuid) is
  'Écrit une spécialité et ses traductions en UNE transaction (traductions d''abord : la garde de réactivation lit celles qui restent). Un refus n''écrit rien. Rend la pièce de la désactivation en cours (null si active).';

-- ── 4. Les avis, une fois par désactivation ──────────────────────────────────
--  p_notifications : [{user_id, domain_id, piece, title, body, link_url, entity_id}] — les textes sont écrits par le serveur,
--  dans la langue de chaque expert. Rend le nombre d'avis NOUVEAUX (ceux déjà posés pour cette désactivation sont sautés).
create or replace function public.prevenir_retrait_specialite(p_notifications jsonb)
  returns integer
  language plpgsql
  set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  if exists (select 1 from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as n(piece uuid, entity_id uuid)
              where n.piece is null or n.entity_id is null) then
    raise exception 'prevenir_retrait_specialite : un avis sans pièce ou sans spécialité ne se dédoublonne pas' using errcode = 'SP003';
  end if;
  insert into public.notifications (user_id, domain_id, piece, type, channel, title, body, link_url, status, entity_id)
  select n.user_id, n.domain_id, n.piece, 'specialite_retiree', 'inapp', n.title, n.body, n.link_url, 'pending', n.entity_id
    from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb))
         as n(user_id uuid, domain_id uuid, piece uuid, title text, body text, link_url text, entity_id uuid)
  on conflict (user_id, entity_id, piece) where type = 'specialite_retiree' do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;

revoke all on function public.prevenir_retrait_specialite(jsonb) from public, anon, authenticated;

comment on function public.prevenir_retrait_specialite(jsonb) is
  'Pose les avis de retrait d''une spécialité (type specialite_retiree, dans l''application) sous la pièce de sa désactivation ; un avis déjà posé pour cette désactivation est sauté (index notifications_retrait_specialite_une_fois). Rend le nombre d''avis nouveaux.';

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if to_regprocedure('public.modifier_specialite(uuid, jsonb, jsonb, text[], uuid)') is null
     or to_regprocedure('public.prevenir_retrait_specialite(jsonb)') is null then
    raise exception 'postcondition NON TENUE : une fonction de la spécialité manque';
  end if;
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                  where c.relname = 'notifications_retrait_specialite_une_fois' and i.indisunique and i.indpred is not null) then
    raise exception 'postcondition NON TENUE : l''index unique partiel notifications_retrait_specialite_une_fois manque';
  end if;
  if has_function_privilege('authenticated', 'public.modifier_specialite(uuid, jsonb, jsonb, text[], uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.prevenir_retrait_specialite(jsonb)', 'execute') then
    raise exception 'postcondition NON TENUE : une fonction de la spécialité est ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : écriture tout ou rien, un avis par désactivation ; prouvé par tests/database/taxonomie/specialite_ecriture_et_avis.test.sql';
end
$post$;
