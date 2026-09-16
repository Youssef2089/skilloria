-- ═══════════════════════════════════════════════════════════════════════════
-- LA GRILLE TARIFAIRE QUITTE LE CODE
--
-- ⚠️ ORDRE D'EXÉCUTION — AVANT le déploiement du code. N'ajoute que du nouveau.
--    Sans cette table, `enregistrerDepenseIA` ne trouve aucun tarif : il
--    journalise la consommation BRUTE avec un coût nul et le DIT bruyamment.
--    Rien ne casse, mais le plafond cesse de compter — d'où l'ordre.
--
-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ POURQUOI EN BASE, ET PAS EN DUR AVEC LE MODÈLE                          ║
-- ║                                                                         ║
-- ║ Un tarif change quand LE FOURNISSEUR change ses prix — jamais quand on  ║
-- ║ déploie. Le laisser en constante imposerait un déploiement pour suivre  ║
-- ║ une décision qui n'est pas la nôtre, et la journée où il faudrait le    ║
-- ║ faire vite serait la journée où l'on ne peut pas.                       ║
-- ║                                                                         ║
-- ║ C'est le raisonnement déjà écrit, mot pour mot, pour `ai_spend_caps` :  ║
-- ║   « Rangés en base et non dans le code : un plafond qu'il faut          ║
-- ║     redéployer pour relever n'est pas un plafond, c'est un incident. »  ║
-- ║ Un tarif faux fausse le plafond ; il relève donc du même régime.        ║
-- ║ Même famille que `ai_quotas`, pour la même raison.                      ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
--
-- ═══ CE QUE LA GRILLE A CORRIGÉ EN ARRIVANT ═════════════════════════════════
--   Le code appliquait 3 $ / 15 $ par million de jetons à TOUS les appels
--   Claude. Ce sont les prix de **Sonnet 4.6**.
--
--     · `claude-sonnet-5` (jugement de candidature, pitch) coûte 2 $ / 10 $ :
--       la dépense était SURÉVALUÉE DE 50 % sur le seul point qui comptait.
--     · `claude-haiku-4-5-*` (analyse de CV, vérifications) coûte 1 $ / 5 $ :
--       en le branchant sur l'ancienne grille, il aurait été surévalué d'un
--       facteur 3.
--
--   Un tarif unique pour plusieurs modèles n'est pas une approximation : c'est
--   un chiffre faux, que l'on croit vrai parce qu'il est affiché.
--
-- ═══ CE QU'ON NE STOCKE PAS, ET POURQUOI ════════════════════════════════════
--   Aucun coût figé. On journalise les UNITÉS BRUTES (jetons, documents) et on
--   recalcule. Un coût figé sur l'ancienne grille resterait faux pour toujours ;
--   des jetons bruts ne le sont jamais.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ai_model_tarifs (
  -- L'identifiant EXACT passé à l'API, tel qu'il est écrit dans le code.
  -- Pas une famille, pas un alias : deux variantes datées d'un même modèle
  -- peuvent avoir deux prix, et deviner laquelle s'applique serait inventer.
  model             text primary key,
  provider          text not null,

  -- Claude : par million de jetons. Les deux, ou aucun.
  usd_par_1m_entree numeric,
  usd_par_1m_sortie numeric,

  -- Cohere : par document noté.
  usd_par_unite     numeric,

  -- D'où vient ce prix. Un tarif sans source est un tarif qu'on n'ose pas
  -- corriger, faute de savoir sur quoi il reposait.
  source            text,

  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.users(id) on delete set null,

  constraint ai_model_tarifs_provider_check
    check (provider in ('rerank', 'claude')),

  -- UNE FORME OU L'AUTRE, JAMAIS LES DEUX, JAMAIS AUCUNE.
  -- Une ligne à moitié remplie produirait un coût nul silencieux — le défaut
  -- exact que cette table existe pour fermer.
  constraint ai_model_tarifs_forme_check check (
    (usd_par_1m_entree is not null and usd_par_1m_sortie is not null and usd_par_unite is null)
    or
    (usd_par_unite is not null and usd_par_1m_entree is null and usd_par_1m_sortie is null)
  ),

  constraint ai_model_tarifs_positifs_check check (
    coalesce(usd_par_1m_entree, 0) >= 0
    and coalesce(usd_par_1m_sortie, 0) >= 0
    and coalesce(usd_par_unite, 0) >= 0
  )
);

comment on table public.ai_model_tarifs is
  'Grille tarifaire par modele. En base et non dans le code : un tarif change '
  'quand le fournisseur change ses prix, pas quand on deploie. Les unites '
  'brutes sont journalisees dans ai_spend_events, donc le cout reste '
  'recalculable quand cette grille change.';

comment on column public.ai_model_tarifs.model is
  'Identifiant EXACT passe a l''API, tel qu''ecrit dans le code. Une ligne '
  'manquante ne fait rien echouer : la depense est journalisee avec un cout '
  'NUL et un drapeau tarif_manquant, et le plafond cesse de la compter. '
  'C''est visible, jamais silencieux.';

alter table public.ai_model_tarifs enable row level security;
revoke all on table public.ai_model_tarifs from public, anon, authenticated;
grant all on table public.ai_model_tarifs to service_role;


-- ═══ LA GRILLE ══════════════════════════════════════════════════════════════
-- `DO NOTHING`, jamais `DO UPDATE` : ces lignes sont la configuration
-- initiale, corrigeable ensuite. Un redeploiement ne doit pas ecraser un prix
-- ajuste le jour ou le fournisseur l'a change.
insert into public.ai_model_tarifs
  (model, provider, usd_par_1m_entree, usd_par_1m_sortie, usd_par_unite, source)
values
  ('claude-sonnet-5',              'claude', 2,    10,   null, 'Grille Anthropic — Sonnet 5'),
  ('claude-sonnet-4-6',            'claude', 3,    15,   null, 'Grille Anthropic — Sonnet 4.6'),
  ('claude-haiku-4-5-20251001',    'claude', 1,    5,    null, 'Grille Anthropic — Haiku 4.5'),
  ('rerank-v4.0-fast',             'rerank', null, null, 0.000002, 'Valeur retenue par le code depuis lib/matching/rerank.ts')
on conflict do nothing;


-- ═══ LA MIGRATION SE CONTRÔLE ELLE-MÊME ═════════════════════════════════════
-- Une grille à moitié posée donne un plafond qui compte à moitié — c'est-à-dire
-- un plafond faux, et personne ne le verrait.
do $$
declare
  v_total   integer;
  v_sonnet5 numeric;
begin
  select count(*) into v_total from public.ai_model_tarifs;
  if v_total < 4 then
    raise exception 'TARIFS — seulement % ligne(s). Le plafond compterait a moitie.', v_total;
  end if;

  select usd_par_1m_entree into v_sonnet5
    from public.ai_model_tarifs where model = 'claude-sonnet-5';
  if v_sonnet5 is null then
    raise exception 'TARIFS — claude-sonnet-5 sans tarif d entree.';
  end if;

  raise notice 'TARIFS — % modele(s). claude-sonnet-5 a % USD/1M en entree (le code disait 3).',
    v_total, v_sonnet5;
end
$$;
