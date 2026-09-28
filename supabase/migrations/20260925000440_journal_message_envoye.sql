-- ════════════════════════════════════════════════════════════════════════════
--  UN MESSAGE ENVOYÉ S'ÉCRIT AU GRAND LIVRE — LE MESSAGE, LA DATE DU FIL ET
--  LA LIGNE, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `app/api/conversations/[id]/messages`
--  appelle `envoyer_message()` dès ce commit. Rejouable.
--
--  CE QUI ÉTAIT FAUX AVANT : deux requêtes — l'insertion, puis
--  `conversations.last_message_at` en « best-effort » — et le statut du fil jugé
--  sur une lecture d'avant. Une conversation fermée entre la lecture et l'écriture
--  recevait le message quand même.
--  Ici : le fil est VERROUILLÉ, son statut rejoué contre les statuts admis REÇUS
--  (aucun littéral de statut lu), le message inséré, la date du fil posée, la
--  ligne écrite — tout, ou rien.
--
--  CE QUI RESTE DANS LE CODE, ET POURQUOI : l'EXPIRATION du fil. Elle est jugée
--  par `isConversationExpired()`, et la fin d'un échange a UNE source (§D.5) — la
--  recopier ici ferait un jumeau SQL de la règle, ce que §C.21 (`devoilement_ferme`)
--  refuse. Une expiration qui tombe entre la lecture et l'écriture laisse passer
--  un message écrit à la seconde près : l'effet est nul, et c'est assumé.
--
--  CE QUE LA LIGNE PORTE : la conversation et la candidature, des identifiants.
--  JAMAIS le contenu — ni sa longueur : la ligne vit en ajout seul, le message
--  vit dans sa table et suit sa propre durée de vie.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.envoyer_message(
  p_piece           uuid,
  p_piece_origine   uuid,
  p_origine         text,
  p_acteur_id       uuid,
  p_acteur_type     text,
  p_conversation_id uuid,
  p_statuts_admis   text[],
  p_contenu         text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_c record;
  v_m record;
  v_n integer;
begin
  if p_piece is null then
    raise exception 'envoyer_message : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_acteur_id is null then
    raise exception 'envoyer_message : un message a toujours un auteur' using errcode = 'GL002';
  end if;

  select c.id, c.status, c.candidature_id, c.domain_id
    into v_c
    from public.conversations c
   where c.id = p_conversation_id
   for update;
  if not found then
    return jsonb_build_object('issue', 'introuvable');
  end if;
  if not (v_c.status = any (p_statuts_admis)) then
    return jsonb_build_object('issue', 'fermee');
  end if;

  insert into public.messages (conversation_id, sender_id, domain_id, content)
  values (p_conversation_id, p_acteur_id, v_c.domain_id, p_contenu)
  returning id, sender_id, content, read_at, created_at into v_m;

  update public.conversations c
     set last_message_at = v_m.created_at
   where c.id = p_conversation_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'envoyer_message : conversations');

  perform public.journaliser(
    p_piece, 'message_envoye', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, v_c.domain_id,
    'messages', v_m.id,
    jsonb_build_object('conversation_id', p_conversation_id, 'candidature_id', v_c.candidature_id),
    p_piece_origine, null::numeric, null::text);

  return jsonb_build_object(
    'issue', 'envoye', 'id', v_m.id, 'sender_id', v_m.sender_id, 'content', v_m.content,
    'read_at', v_m.read_at, 'created_at', v_m.created_at);
end;
$fn$;

revoke all on function public.envoyer_message(uuid, uuid, text, uuid, text, uuid, text[], text)
  from public, anon, authenticated;
grant execute on function public.envoyer_message(uuid, uuid, text, uuid, text, uuid, text[], text)
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['conversation_id', 'candidature_id']::text[]
 where code = 'message_envoye';


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui envoyait un message dans une vraie conversation au nom d'un vrai compte est retirée
-- (28/09/2026). Le geste — fil hors des statuts admis sans rien, message, date du fil et ligne ensemble,
-- contenu ABSENT de la ligne — est prouvé par supabase/tests/database/grand_livre/message_envoye.test.sql.
-- Le fil inconnu reste sondé ici, sur des identifiants INVENTÉS.
declare
  v_cles text[];
  v_r    jsonb;
begin
  if to_regprocedure('public.envoyer_message(uuid, uuid, text, uuid, text, uuid, text[], text)') is null then
    raise exception 'postcondition NON TENUE : envoyer_message manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'message_envoye';
  if v_cles is null or array_length(v_cles, 1) <> 2 or not (v_cles @> array['conversation_id', 'candidature_id']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de message_envoye est fausse [vu : %]', v_cles;
  end if;
  begin
    v_r := public.envoyer_message(gen_random_uuid(), null::uuid, 'utilisateur', gen_random_uuid(), 'client',
                                  gen_random_uuid(), array['open'], 'sonde');
    if v_r ->> 'issue' is distinct from 'introuvable' then
      raise exception 'postcondition NON TENUE : un fil inconnu n est pas « introuvable » [%]', v_r;
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  begin
    perform public.journaliser(gen_random_uuid(), 'message_envoye', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'messages', gen_random_uuid(),
                               '{"conversation_id":"00000000-0000-0000-0000-000000000000","content_length":12}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : la longueur du contenu est entree dans message_envoye';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : message_envoye — signature par types, liste blanche exacte, fil inconnu introuvable, contenu refuse ; le geste est prouve par tests/database/grand_livre/message_envoye.test.sql';
end
$post$;
