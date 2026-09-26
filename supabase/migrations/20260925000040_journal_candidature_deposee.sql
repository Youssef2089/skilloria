-- ════════════════════════════════════════════════════════════════════════════
--  UNE CANDIDATURE DÉPOSÉE S'ÉCRIT AU GRAND LIVRE — AVEC SA NOTE, SON RÉSUMÉ,
--  LE JOURNAL DU DÉPÔT SOLDÉ ET SA LIGNE, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `lib/candidatures/depot.ts`
--  appelle `ouvrir_depot_candidature()` à cinq arguments et
--  `inserer_candidature_jugee()` dès ce commit. Rejouable.
--
--  ┌─ CE QU'ON FERME ────────────────────────────────────────────────────────┐
--  │ Le dépôt écrivait la candidature par le client, puis soldait le journal │
--  │ du dépôt par une seconde requête. Une ligne de grand livre écrite après │
--  │ (§C.21, « journal après écriture ») aurait le même trou que le          │
--  │ paiement : la candidature existe, le journal tombe, et le dépôt suivant │
--  │ est refusé « déjà postulé » — la ligne n'existerait JAMAIS. Ici les    │
--  │ trois écritures naissent ensemble, ou pas du tout (§D.26).              │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  LA PIÈCE DU DÉPÔT EST POSÉE SUR SON JOURNAL (`candidature_depots.piece`),
--  par `ouvrir_depot_candidature()`, AVANT l'appel au modèle — là où la
--  fonction peut se faire tuer (§E.63). Un rejeu d'administrateur lit cette
--  pièce et ouvre une pièce NEUVE qui la référence (`piece_origine`) ; de
--  proche en proche, on remonte à la tentative d'origine. La relance pose sa
--  propre pièce sur la ligne : la colonne porte toujours la DERNIÈRE tentative.
--
--  UNE CONCURRENTE PENDANT LE JUGEMENT : la base refuse la seconde (clé
--  unique du couple), la RPC rend NULL, retire la ligne du dépôt — elle ne
--  désignera jamais la candidature d'un autre passage — et n'écrit rien au
--  grand livre. Le code rend « déjà postulé », comme avant.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── ① LA PIÈCE DU DÉPÔT ─────────────────────────────────────────────────────
alter table public.candidature_depots
  add column if not exists piece uuid;

comment on column public.candidature_depots.piece is
  'La piece (§D.26) de la DERNIERE tentative de ce depot. Posee AVANT l appel au '
  'modele. Un rejeu la lit et ouvre une piece neuve qui la reference. Nulle pour '
  'les lignes anterieures au grand livre.';


-- ── ② OUVRIR LE JOURNAL — avec la pièce ─────────────────────────────────────
--  L'ancienne signature disparaît : deux fonctions du même nom laisseraient un
--  appelant ouvrir un dépôt SANS pièce, en silence.
drop function if exists public.ouvrir_depot_candidature(uuid, uuid, uuid, text);

create or replace function public.ouvrir_depot_candidature(
  p_publication_id uuid,
  p_profile_id     uuid,
  p_domain_id      uuid,
  p_cover_message  text,
  p_piece          uuid
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_rows integer;
begin
  if p_piece is null then
    raise exception 'ouvrir_depot_candidature : la piece est obligatoire' using errcode = 'GL002';
  end if;
  insert into public.candidature_depots as d (
    publication_id, profile_id, domain_id,
    etat, cause, detail, cover_message,
    tentatives, candidature_id, commence_at, termine_at, piece
  ) values (
    p_publication_id, p_profile_id, p_domain_id,
    'en_cours', null, null, p_cover_message,
    1, null, now(), null, p_piece
  )
  on conflict (publication_id, profile_id) do update
    set etat           = 'en_cours',
        cause          = null,
        detail         = null,
        domain_id      = coalesce(excluded.domain_id, d.domain_id),
        cover_message  = excluded.cover_message,
        tentatives     = d.tentatives + 1,
        candidature_id = null,
        commence_at    = now(),
        termine_at     = null,
        piece          = excluded.piece;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$fn$;

revoke all on function public.ouvrir_depot_candidature(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.ouvrir_depot_candidature(uuid, uuid, uuid, text, uuid)
  to service_role;

comment on function public.ouvrir_depot_candidature(uuid, uuid, uuid, text, uuid) is
  'Ouvre ou rouvre la ligne de journal d un depot, avec la piece du geste. Rend true '
  'si une ligne a ete ecrite. La reprise incremente tentatives dans la MEME '
  'instruction : deux relances simultanees ne peuvent pas en compter une seule.';


-- ── ③ L'ÉCRITURE — la candidature, le journal du dépôt soldé, la ligne ────────
--  `p_candidature` porte les colonnes de `public.candidatures` telles que le
--  dépôt les construit ; `jsonb_populate_record` les typographie. La liste des
--  colonnes insérées est écrite UNE fois, ici.
create or replace function public.inserer_candidature_jugee(
  p_piece          uuid,
  p_piece_origine  uuid,
  p_origine        text,
  p_acteur_id      uuid,
  p_acteur_type    text,
  p_candidature    jsonb,
  p_origine_depot  text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_c          public.candidatures;
  v_id         uuid;
  v_status     text;
  v_created    timestamptz;
  v_tentatives integer;
begin
  if p_piece is null then
    raise exception 'inserer_candidature_jugee : la piece est obligatoire' using errcode = 'GL002';
  end if;
  v_c := jsonb_populate_record(null::public.candidatures, p_candidature);
  if v_c.publication_id is null or v_c.profile_id is null then
    raise exception 'inserer_candidature_jugee : annonce et profil sont obligatoires' using errcode = '22023';
  end if;

  -- LA CANDIDATURE, AVEC SA NOTE ET SON RÉSUMÉ. La contrainte de complétude
  -- refuse toute autre forme (§E.31). Une concurrente est écartée par la clé
  -- unique du couple : la base tranche, pas une lecture.
  insert into public.candidatures (
    id, publication_id, profile_id, match_id, domain_id, cover_message,
    ai_match_score, ai_assessment, ai_model, status, preview
  ) values (
    coalesce(v_c.id, gen_random_uuid()), v_c.publication_id, v_c.profile_id, v_c.match_id, v_c.domain_id, v_c.cover_message,
    v_c.ai_match_score, v_c.ai_assessment, v_c.ai_model, coalesce(v_c.status, 'received'), v_c.preview
  )
  on conflict (publication_id, profile_id) do nothing
  returning candidatures.id, candidatures.status, candidatures.created_at
    into v_id, v_status, v_created;

  if v_id is null then
    -- Une candidature concurrente occupe déjà le couple : notre ligne de dépôt
    -- n'a plus d'objet. On la RETIRE plutôt que de la marquer « déposée » en
    -- désignant la candidature d'un autre passage — et rien n'est journalisé :
    -- rien n'a été écrit.
    delete from public.candidature_depots d
     where d.publication_id = v_c.publication_id and d.profile_id = v_c.profile_id;
    return null;
  end if;

  -- LE JOURNAL DU DÉPÔT, SOLDÉ. Le message de motivation part : il ne servait
  -- qu'à rejouer, et le dépôt a abouti — la candidature le porte.
  update public.candidature_depots d
     set etat           = 'depose',
         cause          = null,
         detail         = null,
         cover_message  = null,
         candidature_id = v_id,
         termine_at     = now()
   where d.publication_id = v_c.publication_id and d.profile_id = v_c.profile_id
  returning d.tentatives into v_tentatives;

  -- LA LIGNE DU GRAND LIVRE — sujet la candidature, écosystème le sien, et la
  -- pièce d'origine quand c'est un rejeu.
  perform public.journaliser(
    p_piece, 'candidature_deposee', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, v_c.domain_id,
    'candidatures', v_id,
    jsonb_build_object(
      'publication_id', v_c.publication_id,
      'profile_id', v_c.profile_id,
      'match_id', v_c.match_id,
      'ai_match_score', v_c.ai_match_score,
      'origine_depot', p_origine_depot,
      'tentative', v_tentatives),
    p_piece_origine, null::numeric, null::text);

  return jsonb_build_object('id', v_id, 'status', v_status, 'created_at', v_created);
end;
$fn$;

revoke all on function public.inserer_candidature_jugee(uuid, uuid, text, uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.inserer_candidature_jugee(uuid, uuid, text, uuid, text, jsonb, text)
  to service_role;


-- ── ④ LA LISTE BLANCHE DE `candidature_deposee` ─────────────────────────────
update public.grand_livre_actions
   set cles_detail = array['publication_id', 'profile_id', 'match_id', 'ai_match_score', 'origine_depot', 'tentative']::text[]
 where code = 'candidature_deposee';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_sig     text;
  v_cles    text[];
  v_pub     uuid;
  v_prof    uuid;
  v_match   uuid;
  v_domaine uuid;
  v_piece   uuid := gen_random_uuid();
  v_res     jsonb;
  v_res2    jsonb;
  v_ouvert  boolean;
  v_lignes  integer;
begin
  for v_sig in
    select s from unnest(array[
      'public.ouvrir_depot_candidature(uuid, uuid, uuid, text, uuid)',
      'public.inserer_candidature_jugee(uuid, uuid, text, uuid, text, jsonb, text)'
    ]) as s
    where to_regprocedure(s) is null
  loop
    raise exception 'postcondition NON TENUE : % manque ou a change de signature', v_sig;
  end loop;
  if to_regprocedure('public.ouvrir_depot_candidature(uuid, uuid, uuid, text)') is not null then
    raise exception 'postcondition NON TENUE : ouvrir_depot_candidature a quatre arguments existe encore — un depot sans piece';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'candidature_depots' and column_name = 'piece' and data_type = 'uuid') then
    raise exception 'postcondition NON TENUE : candidature_depots.piece manque';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'candidature_deposee';
  if v_cles is null or not (v_cles @> array['publication_id', 'ai_match_score', 'origine_depot', 'tentative']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de candidature_deposee est incomplete [vu : %]', v_cles;
  end if;

  -- SONDE — sur un couple (annonce, expert) mis en relation et sans candidature :
  -- le journal du dépôt s'ouvre avec la pièce, l'écriture solde le journal et
  -- écrit la ligne ; la seconde écriture du même couple n'écrit rien. Base
  -- vierge, ou sans couple libre : sautée, et dite.
  select m.publication_id, m.profile_id, m.id, p.domain_id
    into v_pub, v_prof, v_match, v_domaine
    from public.matches m
    join public.profiles p on p.id = m.profile_id
   where not exists (select 1 from public.candidatures c where c.publication_id = m.publication_id and c.profile_id = m.profile_id)
     and not exists (select 1 from public.candidature_depots d where d.publication_id = m.publication_id and d.profile_id = m.profile_id)
   limit 1;
  if v_pub is null then
    raise notice 'postcondition : sonde inserer_candidature_jugee SAUTEE — aucun couple libre en base (base vierge)';
  else
    begin
      v_ouvert := public.ouvrir_depot_candidature(v_pub, v_prof, v_domaine, 'sonde', v_piece);
      if v_ouvert is distinct from true
         or not exists (select 1 from public.candidature_depots d where d.publication_id = v_pub and d.profile_id = v_prof and d.piece = v_piece and d.etat = 'en_cours') then
        raise exception 'postcondition NON TENUE : le journal du depot ne porte pas la piece';
      end if;
      v_res := public.inserer_candidature_jugee(v_piece, null::uuid, 'systeme', null::uuid, null::text,
        jsonb_build_object('publication_id', v_pub, 'profile_id', v_prof, 'match_id', v_match, 'domain_id', v_domaine,
                           'ai_match_score', 7, 'ai_assessment', jsonb_build_object('reason', 'sonde', 'pitch_org', 'sonde', 'model', 'sonde'),
                           'ai_model', 'sonde', 'status', 'received', 'preview', '{}'::jsonb),
        'sonde');
      if v_res is null or (v_res ->> 'id') is null then
        raise exception 'postcondition NON TENUE : inserer_candidature_jugee n a rien insere';
      end if;
      if not exists (select 1 from public.candidature_depots d
                      where d.publication_id = v_pub and d.profile_id = v_prof and d.etat = 'depose' and d.candidature_id = (v_res ->> 'id')::uuid and d.cover_message is null) then
        raise exception 'postcondition NON TENUE : le journal du depot n est pas solde par l ecriture';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'candidature_deposee' and g.statut = 'reussi'
                        and g.sujet_type = 'candidatures' and g.sujet_id = (v_res ->> 'id')::uuid
                        and g.detail ->> 'origine_depot' = 'sonde' and g.detail ->> 'tentative' = '1') then
        raise exception 'postcondition NON TENUE : la ligne candidature_deposee manque ou ne porte pas son detail';
      end if;
      -- LA CONCURRENTE : même couple, autre pièce — rien n'est écrit, rien n'est journalisé.
      v_res2 := public.inserer_candidature_jugee(gen_random_uuid(), null::uuid, 'systeme', null::uuid, null::text,
        jsonb_build_object('publication_id', v_pub, 'profile_id', v_prof, 'match_id', v_match, 'domain_id', v_domaine,
                           'ai_match_score', 7, 'ai_assessment', jsonb_build_object('reason', 'sonde', 'pitch_org', 'sonde', 'model', 'sonde'),
                           'ai_model', 'sonde', 'status', 'received', 'preview', '{}'::jsonb),
        'sonde');
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'candidature_deposee' and g.sujet_id = (v_res ->> 'id')::uuid;
      if v_res2 is not null or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : une concurrente a ete inseree (%) ou journalisee (% ligne(s))', v_res2, v_lignes;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  raise notice 'postcondition tenue : candidature_deposee — la candidature, le journal du depot et la ligne naissent ensemble';
end
$post$;
