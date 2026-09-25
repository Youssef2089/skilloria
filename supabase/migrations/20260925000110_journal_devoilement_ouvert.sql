-- ════════════════════════════════════════════════════════════════════════════
--  UN DÉVOILEMENT S'ÉCRIT AU GRAND LIVRE — LA CONVERSATION, LA BASCULE ET LA
--  LIGNE DANS LA MÊME TRANSACTION, SOUS VERROU DE LIGNE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `lib/unlock.ts` — le chemin
--  PARTAGÉ du dévoilement, manuel (route unlock, sous quota) et inclus (au
--  dépôt, sans quota) — appelle `devoiler_candidature()` dès ce commit. Rejouable.
--
--  Le code faisait trois requêtes : la conversation (idempotente par sa clé),
--  la bascule `unlocked` (anti-race par filtre), puis la trace. Une ligne de
--  grand livre écrite après aurait le trou du paiement (§C.21) : la bascule
--  faite, le journal tombé, et le rejeu — « déjà dévoilée » — n'écrirait
--  JAMAIS la ligne. Ici la candidature est verrouillée (`for update`), la
--  conversation posée, la bascule faite et la ligne écrite ensemble, ou rien.
--
--  QUATRE ISSUES, ET PAS UNE CINQUIÈME : `devoilee` (bascule faite, ligne
--  écrite), `deja` (déjà dévoilée — la conversation est RÉCONCILIÉE si elle
--  manquait, comme avant, rien n'est journalisé), `transition` (statut non
--  admis, rien n'est touché), `introuvable`. Un dévoilement NE SE REPREND PAS
--  (§D.5) : aucune rétrogradation n'est possible ici.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.devoiler_candidature(
  p_piece            uuid,
  p_piece_origine    uuid,
  p_origine          text,
  p_acteur_id        uuid,
  p_acteur_type      text,
  p_candidature_id   uuid,
  p_statuts_admis    text[],
  p_expires_at       timestamptz,
  p_auto             boolean
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_c        record;
  v_conv     uuid;
  v_unlocked timestamptz;
begin
  if p_piece is null then
    raise exception 'devoiler_candidature : la piece est obligatoire' using errcode = 'GL002';
  end if;

  -- LE VERROU : deux dévoilements simultanés de la même candidature se
  -- sérialisent ici ; le second lit « déjà dévoilée ».
  select c.id, c.publication_id, c.profile_id, c.domain_id, c.status, c.unlocked_at
    into v_c
    from public.candidatures c
   where c.id = p_candidature_id
   for update;
  if not found then
    return jsonb_build_object('issue', 'introuvable');
  end if;
  if v_c.status <> 'unlocked' and not (v_c.status = any (p_statuts_admis)) then
    return jsonb_build_object('issue', 'transition', 'current', v_c.status);
  end if;

  -- (1) LA CONVERSATION — idempotente par la clé unique sur la candidature.
  --     C'est ICI que la fin de l'échange est POSÉE : un changement de réglage
  --     ne raccourcit jamais un échange déjà ouvert.
  insert into public.conversations (candidature_id, domain_id, status, expires_at)
  values (p_candidature_id, v_c.domain_id, 'open', p_expires_at)
  on conflict (candidature_id) do nothing
  returning id into v_conv;
  if v_conv is null then
    select id into v_conv from public.conversations where candidature_id = p_candidature_id;
  end if;

  if v_c.status = 'unlocked' then
    -- Déjà dévoilée : la conversation est réconciliée ci-dessus, rien d'autre
    -- ne change, rien ne s'écrit au grand livre.
    return jsonb_build_object('issue', 'deja', 'conversation_id', v_conv, 'unlocked_at', v_c.unlocked_at);
  end if;

  -- (2) LA BASCULE.
  update public.candidatures c
     set status      = 'unlocked',
         unlocked_at = now()
   where c.id = p_candidature_id
  returning c.unlocked_at into v_unlocked;

  -- (3) LA LIGNE — sujet la candidature, l'origine du dévoilement dans le détail.
  perform public.journaliser(
    p_piece, 'devoilement_ouvert', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, v_c.domain_id,
    'candidatures', p_candidature_id,
    jsonb_build_object(
      'publication_id', v_c.publication_id,
      'profile_id', v_c.profile_id,
      'conversation_id', v_conv,
      'auto', p_auto,
      'expires_at', p_expires_at),
    p_piece_origine, null::numeric, null::text);

  return jsonb_build_object('issue', 'devoilee', 'conversation_id', v_conv, 'unlocked_at', v_unlocked);
end;
$fn$;

revoke all on function public.devoiler_candidature(uuid, uuid, text, uuid, text, uuid, text[], timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.devoiler_candidature(uuid, uuid, text, uuid, text, uuid, text[], timestamptz, boolean)
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['publication_id', 'profile_id', 'conversation_id', 'auto', 'expires_at']::text[]
 where code = 'devoilement_ouvert';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles   text[];
  v_cand   uuid;
  v_piece  uuid := gen_random_uuid();
  v_res    jsonb;
  v_res2   jsonb;
  v_lignes integer;
begin
  if to_regprocedure('public.devoiler_candidature(uuid, uuid, text, uuid, text, uuid, text[], timestamptz, boolean)') is null then
    raise exception 'postcondition NON TENUE : devoiler_candidature manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'devoilement_ouvert';
  if v_cles is null or not (v_cles @> array['publication_id', 'profile_id', 'conversation_id', 'auto', 'expires_at']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de devoilement_ouvert est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — une candidature réelle en transition admise, sans conversation :
  -- dévoilée, conversation posée, ligne relue ; rejouée, « déjà », même
  -- conversation, aucune seconde ligne. Sans candidature : sautée, et dite.
  select c.id into v_cand
    from public.candidatures c
   where c.status in ('received', 'in_review', 'shortlisted')
     and not exists (select 1 from public.conversations v where v.candidature_id = c.id)
   limit 1;
  if v_cand is null then
    raise notice 'postcondition : sonde devoiler_candidature SAUTEE — aucune candidature en transition admise (base vierge)';
  else
    begin
      v_res := public.devoiler_candidature(v_piece, null::uuid, 'utilisateur', null::uuid, null::text,
                                           v_cand, array['received', 'in_review', 'shortlisted'], now() + interval '15 days', false);
      if v_res ->> 'issue' <> 'devoilee' or (v_res ->> 'conversation_id') is null then
        raise exception 'postcondition NON TENUE : le devoilement n a pas abouti [%]', v_res;
      end if;
      if not exists (select 1 from public.candidatures c where c.id = v_cand and c.status = 'unlocked' and c.unlocked_at is not null)
         or not exists (select 1 from public.conversations v where v.candidature_id = v_cand and v.id = (v_res ->> 'conversation_id')::uuid and v.status = 'open') then
        raise exception 'postcondition NON TENUE : la bascule ou la conversation manque';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'devoilement_ouvert' and g.statut = 'reussi'
                        and g.sujet_type = 'candidatures' and g.sujet_id = v_cand
                        and g.detail ->> 'conversation_id' = v_res ->> 'conversation_id' and (g.detail ->> 'auto')::boolean = false) then
        raise exception 'postcondition NON TENUE : la ligne devoilement_ouvert manque ou ne porte pas son detail';
      end if;
      -- LE REJEU : « déjà », même conversation, aucune seconde ligne.
      v_res2 := public.devoiler_candidature(gen_random_uuid(), null::uuid, 'utilisateur', null::uuid, null::text,
                                            v_cand, array['received', 'in_review', 'shortlisted'], now() + interval '15 days', true);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'devoilement_ouvert' and g.sujet_id = v_cand;
      if v_res2 ->> 'issue' <> 'deja' or v_res2 ->> 'conversation_id' <> v_res ->> 'conversation_id' or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : le rejeu n est pas « deja » sur la meme conversation, ou a journalise deux fois [% / % ligne(s)]', v_res2, v_lignes;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  raise notice 'postcondition tenue : devoilement_ouvert — conversation, bascule et ligne naissent ensemble, le rejeu est « deja »';
end
$post$;
