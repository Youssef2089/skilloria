-- ─────────────────────────────────────────────────────────────────────────────
-- LE SCORE CHANGE DE NATURE — pertinence au matching, jugement à la candidature
--
-- ⚠️ ORDRE D'EXÉCUTION — AVANT le déploiement du code, et le code doit partir
--    DANS LA FOULÉE. Cette migration SUPPRIME `matches.score`, que le feed
--    expert et le bloc « profils recommandés » lisent aujourd'hui.
--
-- POURQUOI SUPPRIMER `score` AU LIEU DE LE RÉUTILISER
--   `matches.score` porte aujourd'hui une note de 0 à 10 produite par Claude,
--   avec un barème écrit dans le prompt : 9-10 excellent, 7-8 bon, 5-6 moyen.
--   Elle est INTERPRÉTABLE et à peu près comparable d'une annonce à l'autre.
--
--   Le score d'un reranker n'a AUCUNE de ces propriétés. Il vit dans [0,1], il
--   est propre à une requête, et le fournisseur écrit noir sur blanc qu'on ne
--   peut ni le lire comme une proportion, ni comparer les scores de deux
--   requêtes différentes.
--
--   Ranger la seconde valeur dans la colonne de la première, c'est garantir
--   qu'un jour quelqu'un affichera « 0,4 / 10 » ou comparera deux annonces sur
--   une échelle qui ne le permet pas. Deux grandeurs différentes, deux colonnes
--   différentes, et un nom qui dit laquelle. La suppression est délibérément
--   cassante : elle force chaque lecteur à être revu.
--
--   Base de TEST : suppression sèche, aucune reprise de données.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ MATCHES — LE SCORE DE PERTINENCE ═══════════════════════════════════════
alter table public.matches
  -- Score brut du reranker, tel qu'il le rend. JAMAIS normalisé sur le pool :
  -- normaliser reviendrait à classer les experts les uns par rapport aux autres,
  -- c'est-à-dire à réintroduire la compétition que le produit interdit.
  add column if not exists relevance_score  numeric,
  -- Le modèle qui l'a produit. Changer de reranker change l'échelle : sans cette
  -- colonne, un score ancien est illisible et un seuil devient faux en silence.
  add column if not exists relevance_model  text,
  add column if not exists relevance_scored_at timestamptz;

alter table public.matches drop constraint if exists matches_relevance_score_range_check;
alter table public.matches add constraint matches_relevance_score_range_check
  check (relevance_score is null or (relevance_score >= 0 and relevance_score <= 1));

comment on column public.matches.relevance_score is
  'Score de pertinence brut du reranker, dans [0,1]. PROPRE À UNE ANNONCE : ne jamais '
  'comparer entre deux annonces, ne jamais afficher comme une note sur 10, ne jamais '
  'normaliser sur le pool. Sert à ordonner DANS une annonce et à appliquer le seuil '
  'ABSOLU de notification.';

-- ═══ LE PALIER AFFICHÉ ══════════════════════════════════════════════════════
-- Ce que l'expert VOIT. Pas un nombre : le score d'un reranker n'a aucune des
-- propriétés qui rendraient « 0,73 » lisible — il n'est ni une proportion, ni
-- comparable d'une annonce à l'autre. L'afficher inviterait à le comparer, donc
-- à se comparer aux autres, ce que le produit interdit.
--
-- Deux paliers, et rien d'autre : « Correspondance forte » quand le score
-- dépassait le seuil de notification EN VIGUEUR CE JOUR-LÀ, « Correspondance »
-- sinon.
--
-- POURQUOI L'ÉCRIRE PLUTÔT QUE LE RECALCULER À L'AFFICHAGE
--   Le seuil est réglable, et les scores ne sont pas comparables entre deux
--   runs. Recalculer le palier plus tard rebaptiserait en silence des matches
--   anciens : un expert verrait « forte » devenir « correspondance » sans que
--   rien n'ait changé pour lui. Le palier est un FAIT du jour où il a été noté,
--   il se fige avec lui.
alter table public.matches
  add column if not exists relevance_tier text;

alter table public.matches drop constraint if exists matches_relevance_tier_check;
alter table public.matches add constraint matches_relevance_tier_check
  check (relevance_tier is null or relevance_tier in ('strong', 'normal'));

comment on column public.matches.relevance_tier is
  'Palier AFFICHÉ, figé au moment de la notation : strong = au-dessus du seuil de '
  'notification en vigueur ce jour-là, normal = en dessous. Jamais recalculé à '
  'l affichage : le seuil est reglable et les scores ne sont pas comparables entre '
  'deux runs, un recalcul rebaptiserait des matches anciens en silence.';


-- L'ancienne note Claude n'a plus de producteur au matching.
alter table public.matches drop constraint if exists matches_score_range_check;
alter table public.matches drop column if exists score;

-- Feed expert : `where profile_id = ? and status <> 'dismissed' order by <score> desc`.
-- L'index de la migration `index_echelle` portait sur l'ancienne colonne ; il est
-- reconstruit ici sur la nouvelle.
drop index if exists public.matches_profile_score_idx;
create index if not exists matches_profile_relevance_idx
  on public.matches (profile_id, relevance_score desc);


-- ═══ CANDIDATURES — LE JUGEMENT DE CLAUDE ═══════════════════════════════════
-- Claude ne note plus le matching. Il n'intervient qu'au dépôt d'une
-- candidature, sur UN couple profil x annonce, pour l'organisation qui reçoit
-- le dossier. `ai_match_score` existait déjà et retrouve ici son sens plein :
-- c'est une note de 0 à 10, sur l'échelle Claude, adossée à un texte.
alter table public.candidatures
  -- { reason, pitch_org, model, evaluated_at }
  -- reason    : adressé à l'EXPERT.
  -- pitch_org : adressé à l'ORGANISATION, affiché AVANT le déverrouillage payant
  --             — d'où l'interdiction, dans le prompt, de nommer un employeur ou
  --             un client : ce texte doit rester compatible avec le masquage.
  add column if not exists ai_assessment jsonb,
  add column if not exists ai_model      text;

alter table public.candidatures drop constraint if exists candidatures_ai_match_score_range_check;
alter table public.candidatures add constraint candidatures_ai_match_score_range_check
  check (ai_match_score is null or (ai_match_score >= 0 and ai_match_score <= 10));

comment on column public.candidatures.ai_match_score is
  'Note de Claude sur 10, produite au DÉPÔT de la candidature. Distincte de '
  'matches.relevance_score, qui est un score de pertinence dans [0,1] propre à une '
  'annonce. Les deux ne doivent JAMAIS être affichés côte à côte : ils répondent à '
  'deux questions différentes (pourquoi ce profil apparaît / que vaut ce dossier) '
  'à deux moments différents.';


-- ═══ SUPERVISION — LE COÛT DE CLAUDE, VISIBLE ═══════════════════════════════
-- Claude n'est plus dans le matching, mais il est appelé une fois par
-- candidature. Ce volume est un coût direct, et rien ne le rend visible
-- aujourd'hui.
create or replace function public.candidature_ai_health(
  p_depuis interval default interval '30 days'
) returns table (
    candidatures_total   bigint,
    avec_jugement_ia     bigint,
    sans_jugement_ia     bigint,
    note_moyenne         numeric
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select
    count(*),
    count(*) filter (where ai_assessment is not null),
    count(*) filter (where ai_assessment is null),
    round(avg(ai_match_score), 2)
  from public.candidatures
  where created_at > now() - p_depuis;
$fn$;

revoke all on function public.candidature_ai_health(interval) from public, anon, authenticated;
grant execute on function public.candidature_ai_health(interval) to service_role;
