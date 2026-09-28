-- ════════════════════════════════════════════════════════════════════════════
--  UN DÉVOILEMENT REFERMÉ S'ÉCRIT AU GRAND LIVRE — PAR UN CONSTAT, UNE FOIS.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/cron/constats` appelle
--  `constater_devoilement_ferme()` dès ce commit. Rejouable.
--
--  LA FERMETURE N'EST PAS UN GESTE (§D.5) : la fenêtre d'échange s'écoule,
--  personne n'agit, aucune colonne ne bascule — l'état de vie d'une
--  candidature est DÉRIVÉ à la lecture (lib/candidatures/lifecycle.ts,
--  source unique, qui décide « échange refermé »). Le constat est donc
--  DÉCIDÉ en TypeScript par cette source, et cette fonction ne juge rien.
--  UNE RÈGLE, UNE DÉFINITION (T.5, 28/09/2026) : elle portait `status =
--  'unlocked'` — une SECONDE définition, partielle, de « quels statuts
--  referment » (§D.5 : `selected` reste actif). Si la règle TypeScript
--  changeait, le SQL aurait refusé en silence, en rendant « déjà ». Elle reçoit
--  désormais `p_statut_lu` — le statut que la tâche a LU puis JUGÉ par
--  `deriveCandidatureLifecycle` — et ne vérifie que ceci : rien n'a changé
--  depuis la lecture (comparer puis poser), et la candidature n'est pas déjà
--  constatée. La fin d'échange (`p_fin_echange`) vient aussi du TypeScript
--  (`effectiveConversationExpiry`) ; le SQL la LIT (refus d'une fin future,
--  comparaison à la mise en service), il ne la calcule jamais.
--  Marqueur (`fermeture_constatee_at`) et ligne naissent dans la même
--  transaction, une fois. Issues fermées : constate · passif · deja · change
--  (le statut a bougé depuis la lecture : la tâche relira) · introuvable.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ① LA COLONNE-MARQUEUR ────────────────────────────────────────────────────
alter table public.candidatures
  add column if not exists fermeture_constatee_at timestamptz;

comment on column public.candidatures.fermeture_constatee_at is
  'Posé par constater_devoilement_ferme() dans la transaction qui écrit la ligne devoilement_ferme du grand livre : une fermeture se constate UNE fois. Null tant que l''échange est ouvert ou que le constat n''est pas passé.';

-- L'index de la file à constater : dévoilées, pas encore constatées.
create index if not exists candidatures_fermeture_a_constater_idx
  on public.candidatures (unlocked_at)
  where fermeture_constatee_at is null and unlocked_at is not null;


-- ── ①bis LA MISE EN SERVICE — pas de ligne rétroactive (point 2.11) ─────────
--  Au premier passage, toute candidature dont l'échange s'est refermé AVANT ce
--  constat serait constatée, avec une ligne datée d'aujourd'hui pour un fait
--  ancien : une reprise de l'historique déguisée. Décision de Youssef : AUCUNE
--  ligne rétroactive. Mais « refermé » n'a qu'UNE source, en TypeScript (§D.5) —
--  la migration ne peut pas dresser le passif sans en écrire un jumeau SQL.
--  Donc : la base retient QUAND le constat entre en service, dans CET
--  environnement (l'heure de sa propre migration), et la fonction pose le
--  marqueur SANS ligne pour toute fin d'échange ANTÉRIEURE (issue `passif`).
--  Le TypeScript décide toujours SI et QUAND ; la base ne compare que deux dates.
create table if not exists public.constats_mise_en_service (
  constat text primary key,
  depuis  timestamptz not null default now()
);
comment on table public.constats_mise_en_service is
  'Date d''entrée en service d''un constat, par environnement : un fait antérieur pose le marqueur sans ligne au grand livre (aucune ligne rétroactive).';
revoke all on table public.constats_mise_en_service from public, anon, authenticated;
grant select on table public.constats_mise_en_service to service_role;
alter table public.constats_mise_en_service enable row level security;
insert into public.constats_mise_en_service (constat) values ('devoilement_ferme')
on conflict (constat) do nothing;


-- ── ② LE CONSTAT — marqueur et ligne, dans la même transaction ──────────────
-- L'ancienne signature (sans le statut lu) n'a jamais quitté ce lot ; la retirer
-- garantit une seule signature sur toute base qui l'aurait rejouée.
drop function if exists public.constater_devoilement_ferme(uuid, uuid, timestamptz);

create or replace function public.constater_devoilement_ferme(
  p_piece          uuid,
  p_candidature_id uuid,
  p_fin_echange    timestamptz,
  p_statut_lu      text
) returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
-- Rend une issue FERMÉE : 'constate' (marqueur + ligne), 'passif' (marqueur SANS
-- ligne — fin d'échange antérieure à la mise en service), 'deja' (rien : déjà
-- constatée, ou plus dévoilée).
declare
  v_c      record;
  v_depuis timestamptz;
  v_marque timestamptz;
begin
  if p_piece is null then
    raise exception 'constater_devoilement_ferme : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_fin_echange is null or p_fin_echange > now() then
    raise exception 'constater_devoilement_ferme : la fin d echange doit etre passee (%)', p_fin_echange using errcode = '22023';
  end if;
  if p_statut_lu is null then
    raise exception 'constater_devoilement_ferme : le statut lu et juge par la tache est obligatoire' using errcode = '22023';
  end if;
  select m.depuis into v_depuis from public.constats_mise_en_service m where m.constat = 'devoilement_ferme';
  if v_depuis is null then
    raise exception 'constater_devoilement_ferme : la date de mise en service manque' using errcode = '22023';
  end if;

  update public.candidatures c
     set fermeture_constatee_at = now()
   where c.id = p_candidature_id
     and c.fermeture_constatee_at is null
     and c.status = p_statut_lu
  returning c.domain_id, c.publication_id, c.profile_id, c.unlocked_at into v_c;
  if not found then
    -- Zéro ligne : on dit LAQUELLE des trois raisons, sans en inventer une.
    select c.fermeture_constatee_at into v_marque from public.candidatures c where c.id = p_candidature_id;
    if not found then
      return 'introuvable';
    end if;
    return case when v_marque is not null then 'deja' else 'change' end;
  end if;
  -- LE PASSIF : refermé AVANT la mise en service — marqueur, pas de ligne.
  if p_fin_echange < v_depuis then
    return 'passif';
  end if;

  perform public.journaliser(
    p_piece, 'devoilement_ferme', 'reussi', 'tache_planifiee',
    null::uuid, null::text, v_c.domain_id,
    'candidatures', p_candidature_id,
    jsonb_build_object(
      'publication_id', v_c.publication_id,
      'profile_id', v_c.profile_id,
      'unlocked_at', v_c.unlocked_at,
      'fin_echange', p_fin_echange),
    null::uuid, null::numeric, null::text);
  return 'constate';
end;
$fn$;

revoke all on function public.constater_devoilement_ferme(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.constater_devoilement_ferme(uuid, uuid, timestamptz, text) to service_role;


-- ── ③ LA LISTE BLANCHE ───────────────────────────────────────────────────────
update public.grand_livre_actions
   set cles_detail = array['publication_id', 'profile_id', 'unlocked_at', 'fin_echange']::text[]
 where code = 'devoilement_ferme';


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui constatait un vrai dévoilement est retirée (28/09/2026). Le geste — le passif marqué sans
-- ligne, le constat relu une fois, « deja », « change », « introuvable », statut lu obligatoire — est
-- prouvé par supabase/tests/database/grand_livre/devoilement_ferme.test.sql. La fin future refusée reste
-- sondée ici : sur des identifiants INVENTÉS, elle ne touche rien.
declare
  v_cles text[];
begin
  if to_regprocedure('public.constater_devoilement_ferme(uuid, uuid, timestamptz, text)') is null
     or to_regprocedure('public.constater_devoilement_ferme(uuid, uuid, timestamptz)') is not null then
    raise exception 'postcondition NON TENUE : constater_devoilement_ferme manque ou a change de signature';
  end if;
  if (select m.depuis from public.constats_mise_en_service m where m.constat = 'devoilement_ferme') is null then
    raise exception 'postcondition NON TENUE : la date de mise en service du constat manque — le passif serait journalise';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'candidatures' and column_name = 'fermeture_constatee_at') then
    raise exception 'postcondition NON TENUE : candidatures.fermeture_constatee_at manque';
  end if;
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                  where c.relname = 'candidatures_fermeture_a_constater_idx' and i.indpred is not null) then
    raise exception 'postcondition NON TENUE : l index partiel de la file a constater manque (§E.60)';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'devoilement_ferme';
  if v_cles is null or not (v_cles @> array['publication_id', 'profile_id', 'unlocked_at', 'fin_echange']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de devoilement_ferme est incomplete [vu : %]', v_cles;
  end if;
  begin
    perform public.constater_devoilement_ferme(gen_random_uuid(), gen_random_uuid(), now() + interval '1 day', 'unlocked');
    raise exception 'postcondition NON TENUE : une fin d echange future a ete acceptee';
  exception when sqlstate '22023' then
    null;
  end;
  begin
    perform public.journaliser(gen_random_uuid(), 'devoilement_ferme', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'candidatures', gen_random_uuid(),
                               '{"publication_id":"00000000-0000-0000-0000-000000000000","message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans devoilement_ferme';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : devoilement_ferme — signature par types (l ancienne absente), date de mise en service, colonne, index partiel, liste blanche, fin future refusee, texte libre refuse ; le geste est prouve par tests/database/grand_livre/devoilement_ferme.test.sql';
end
$post$;
