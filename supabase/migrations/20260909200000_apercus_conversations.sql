-- L'APERÇU D'UNE CONVERSATION, ET SON COMPTEUR DE NON-LUS
--
-- ═══ LE DEFAUT CORRIGE ════════════════════════════════════════════════════
--   /api/me/conversations derivait l'apercu de chaque fil en lisant les 500
--   derniers messages TOUTES CONVERSATIONS CONFONDUES, puis en gardant le
--   premier vu par conversation. Au-dela de 500 messages cumules, les
--   conversations les moins recentes n'apparaissaient dans AUCUNE ligne lue :
--   elles n'avaient donc aucun apercu.
--
--   Ce n'etait pas une troncature, c'etait un resultat FAUX. Une conversation
--   sans apercu se lit « personne n'a rien ecrit » — l'inverse de la verite.
--   Le compteur de non-lus, derive de la MEME lecture, sous-comptait pour la
--   meme raison : un fil pouvait afficher zero non-lu tout en en ayant.
--
-- ═══ POURQUOI UNE FONCTION, ET PAS UNE REQUETE ════════════════════════════
--   « Une ligne par groupe » ne s'exprime pas en PostgREST. Les seules issues
--   sans fonction etaient : une requete par conversation (jusqu'a 200
--   allers-retours sur une liste qu'on ouvre souvent), ou un plafond plus haut
--   — c'est-a-dire le meme defaut, plus tard, et toujours silencieux.
--
--   `distinct on` fait le travail en une passe indexee. Le cout devient
--   proportionnel au NOMBRE DE CONVERSATIONS, plus au nombre de messages :
--   c'est strictement moins de travail qu'aujourd'hui, ou 500 lignes etaient
--   lues et jetees a chaque ouverture.
--
--   On ne s'appuie deliberement PAS sur `conversations.last_message_at` : sa
--   mise a jour est best-effort a l'ecriture du message (elle journalise et
--   continue en cas d'echec). Deriver l'apercu d'un champ qui peut deriver,
--   c'est remplacer un apercu manquant par un apercu FAUX — strictement pire.
--   La verite reste dans `messages`.

-- Index composite : `distinct on (conversation_id) order by created_at desc`
-- lit alors directement l'index, sans trier chaque groupe. L'index existant
-- ne porte que `conversation_id`.
create index if not exists messages_conversation_recent_idx
  on public.messages (conversation_id, created_at desc, id desc);

-- Index partiel des non-lus : ils sont une petite minorite des messages, et
-- c'est le seul sous-ensemble que le compteur parcourt.
create index if not exists messages_non_lus_idx
  on public.messages (conversation_id)
  where read_at is null;

create or replace function public.conversation_apercus(
  p_conversation_ids uuid[],
  p_user_id uuid
)
returns table (
  conversation_id uuid,
  content text,
  sender_id uuid,
  created_at timestamptz,
  non_lus bigint
)
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  with dernier as (
    -- `id desc` departage deux messages de meme horodatage : sans lui, l'apercu
    -- pourrait changer d'une lecture a l'autre sans qu'aucun message n'ait ete
    -- ecrit.
    select distinct on (m.conversation_id)
           m.conversation_id,
           m.content,
           m.sender_id,
           m.created_at
      from public.messages m
     where m.conversation_id = any(p_conversation_ids)
     order by m.conversation_id, m.created_at desc, m.id desc
  ),
  restants as (
    -- Non-lus REÇUS uniquement : ses propres messages ne sont jamais « non lus »
    -- pour soi. Meme regle que le flip de lecture cote route.
    select m.conversation_id, count(*) as n
      from public.messages m
     where m.conversation_id = any(p_conversation_ids)
       and m.read_at is null
       and m.sender_id <> p_user_id
     group by m.conversation_id
  )
  select d.conversation_id,
         d.content,
         d.sender_id,
         d.created_at,
         coalesce(r.n, 0) as non_lus
    from dernier d
    left join restants r on r.conversation_id = d.conversation_id;
$$;

-- Une conversation SANS message ne renvoie aucune ligne : elle n'a pas
-- d'apercu parce que rien n'y a ete ecrit. C'est le seul cas ou « pas
-- d'apercu » dit la verite, et il reste distinguable du defaut corrige ici.

revoke all on function public.conversation_apercus(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.conversation_apercus(uuid[], uuid) to service_role;
