-- ════════════════════════════════════════════════════════════════════════════
--  LA NOTIFICATION D'UNE MISE EN RELATION S'ÉCRIT — l'écriture porte le
--  PRÉDICAT de l'index partiel (§E.69, recopié ; 30/09/2026).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Ajoute une fonction ; le moteur
--  l'appelle dès ce commit. Rejouable.
--
--  LE DÉFAUT (audit du 30/09/2026 sur aac5f79, M7) : `lib/matching/shared.ts`
--  écrivait par `upsert(…, { onConflict: 'user_id,entity_id', ignoreDuplicates })`,
--  que PostgREST traduit en `ON CONFLICT (user_id, entity_id) DO NOTHING` — SANS
--  prédicat. Le seul index unique est PARTIEL (`notifications_match_unique_idx …
--  where type = 'new_match_opportunity' and entity_id is not null`) : Postgres ne
--  l'infère pas, et chaque paquet échouait en 42P10. Aucune notification, aucun
--  e-mail — pendant que les correspondances passaient à « notifiées ». C'est
--  exactement §E.69, trouvé au paiement le 25/09/2026, et sa parade n'avait pas
--  été cherchée ailleurs.
--
--  LA RÈGLE : une RPC, qui écrit `on conflict (user_id, entity_id) where …` —
--  le prédicat de l'index, dans la clause — et REND ce qu'elle a posé. Les
--  lignes sont des notifications de correspondance, et seulement elles : le type
--  est posé ICI, pas reçu.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.poser_notifications_match(p_lignes jsonb)
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' then
    raise exception 'poser_notifications_match : un tableau est attendu' using errcode = '22023';
  end if;
  insert into public.notifications (user_id, domain_id, type, channel, title, body, link_url, status, entity_id, piece)
  select (x ->> 'user_id')::uuid, (x ->> 'domain_id')::uuid, 'new_match_opportunity',
         coalesce(x ->> 'channel', 'inapp'), x ->> 'title', x ->> 'body', x ->> 'link_url',
         coalesce(x ->> 'status', 'pending'), (x ->> 'entity_id')::uuid, (x ->> 'piece')::uuid
    from jsonb_array_elements(p_lignes) as x
  on conflict (user_id, entity_id) where type = 'new_match_opportunity' and entity_id is not null
  do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.poser_notifications_match(jsonb) from public, anon, authenticated;
grant execute on function public.poser_notifications_match(jsonb) to service_role;

-- ── POSTCONDITION — LA STRUCTURE, sur identifiants inventés, dans un bloc annulé (§E.77) ──
do $post$
begin
  if to_regprocedure('public.poser_notifications_match(jsonb)') is null then
    raise exception 'postcondition NON TENUE : poser_notifications_match manque';
  end if;
  if has_function_privilege('authenticated', 'public.poser_notifications_match(jsonb)', 'execute') then
    raise exception 'postcondition NON TENUE : poser_notifications_match ouverte au navigateur';
  end if;
  if to_regclass('public.notifications_match_unique_idx') is null then
    raise exception 'postcondition NON TENUE : l index partiel notifications_match_unique_idx manque — la clause ne s adosse a rien';
  end if;
  raise notice 'postcondition tenue : poser_notifications_match presente, fermee au navigateur, adossee a l index partiel ; l insertion, le doublon ignore et le refus 42P10 de la forme sans predicat sont prouves par tests/database/matching/notifications_match.test.sql';
end
$post$;
