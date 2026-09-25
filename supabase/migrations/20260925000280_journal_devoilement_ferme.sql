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
--  DÉCIDÉ en TypeScript par cette source, et cette fonction ne juge rien
--  d'autre que ce qu'un marqueur exige : la candidature est encore dévoilée
--  (`unlocked` — `selected` reste active sans limite, §D.5) et jamais
--  constatée. Marqueur (`fermeture_constatee_at`) et ligne naissent dans la
--  même transaction, une fois. Pas de jumeau SQL de la règle : aucune
--  seconde expression de « refermé » n'existe dans le schéma.
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


-- ── ② LE CONSTAT — marqueur et ligne, dans la même transaction ──────────────
create or replace function public.constater_devoilement_ferme(
  p_piece          uuid,
  p_candidature_id uuid,
  p_fin_echange    timestamptz
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_c record;
begin
  if p_piece is null then
    raise exception 'constater_devoilement_ferme : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_fin_echange is null or p_fin_echange > now() then
    raise exception 'constater_devoilement_ferme : la fin d echange doit etre passee (%)', p_fin_echange using errcode = '22023';
  end if;

  update public.candidatures c
     set fermeture_constatee_at = now()
   where c.id = p_candidature_id
     and c.fermeture_constatee_at is null
     and c.status = 'unlocked'
  returning c.domain_id, c.publication_id, c.profile_id, c.unlocked_at into v_c;
  if not found then
    return false;
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
  return true;
end;
$fn$;

revoke all on function public.constater_devoilement_ferme(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.constater_devoilement_ferme(uuid, uuid, timestamptz) to service_role;


-- ── ③ LA LISTE BLANCHE ───────────────────────────────────────────────────────
update public.grand_livre_actions
   set cles_detail = array['publication_id', 'profile_id', 'unlocked_at', 'fin_echange']::text[]
 where code = 'devoilement_ferme';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles  text[];
  v_cand  uuid;
  v_piece uuid := gen_random_uuid();
  v_ok    boolean;
  v_ok2   boolean;
  v_n     integer;
begin
  if to_regprocedure('public.constater_devoilement_ferme(uuid, uuid, timestamptz)') is null then
    raise exception 'postcondition NON TENUE : constater_devoilement_ferme manque ou a change de signature';
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

  -- SONDE — une candidature dévoilée réelle, jamais constatée : constatée
  -- (marqueur posé, ligne relue), rejouée (false, aucune seconde ligne) ; une
  -- fin d'échange FUTURE est refusée. Sans candidature : sautée, et dite.
  select c.id into v_cand
    from public.candidatures c
   where c.status = 'unlocked' and c.fermeture_constatee_at is null
   limit 1;
  if v_cand is null then
    raise notice 'postcondition : sonde constater_devoilement_ferme SAUTEE — aucune candidature devoilee (base vierge)';
  else
    begin
      v_ok := public.constater_devoilement_ferme(v_piece, v_cand, now() - interval '1 day');
      if v_ok is distinct from true then
        raise exception 'postcondition NON TENUE : le constat n a pas abouti';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'devoilement_ferme' and g.statut = 'reussi'
                        and g.origine = 'tache_planifiee' and g.acteur_id is null
                        and g.sujet_type = 'candidatures' and g.sujet_id = v_cand
                        and g.detail ->> 'fin_echange' is not null and g.detail ->> 'publication_id' is not null) then
        raise exception 'postcondition NON TENUE : la ligne devoilement_ferme manque ou ne porte pas son detail';
      end if;
      v_ok2 := public.constater_devoilement_ferme(gen_random_uuid(), v_cand, now() - interval '1 day');
      select count(*) into v_n from public.grand_livre g where g.type_action = 'devoilement_ferme' and g.sujet_id = v_cand;
      if v_ok2 is distinct from false or v_n <> 1 then
        raise exception 'postcondition NON TENUE : le rejeu a constate ou journalise une seconde fois [% / % ligne(s)]', v_ok2, v_n;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — une fin d'échange FUTURE est REFUSÉE : on ne constate pas ce qui n'est pas arrivé.
  begin
    perform public.constater_devoilement_ferme(gen_random_uuid(), gen_random_uuid(), now() + interval '1 day');
    raise exception 'postcondition NON TENUE : une fin d echange future a ete acceptee';
  exception when sqlstate '22023' then
    null;
  end;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'devoilement_ferme', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'candidatures', gen_random_uuid(),
                               '{"publication_id":"00000000-0000-0000-0000-000000000000","message":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans devoilement_ferme';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : devoilement_ferme — colonne, index, constat relu une fois, fin future refusee, texte libre refuse';
end
$post$;
