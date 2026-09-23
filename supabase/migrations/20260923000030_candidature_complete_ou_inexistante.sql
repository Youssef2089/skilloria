-- ════════════════════════════════════════════════════════════════════════════
--  UNE CANDIDATURE EXISTE AVEC SA NOTE ET SON RÉSUMÉ, OU ELLE N'EXISTE PAS.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement.
--    Elle n'ajoute que du nouveau — une contrainte et une table. Le code EN
--    LIGNE écrit des candidatures SANS `ai_assessment` : il serait REFUSÉ dès
--    l'application. C'est voulu, et c'est pourquoi le code doit partir dans la
--    foulée : entre les deux, un dépôt échoue en 500 plutôt que de livrer un
--    dossier nu. Le sens du refus est le bon ; sa forme, le temps du
--    déploiement, ne l'est pas.
--
--  ┌─ LA DÉCISION, ARBITRÉE PAR YOUSSEF ────────────────────────────────────┐
--  │ « Une candidature avec sa note et son résumé, ou pas de candidature.    │
--  │   Une candidature nue chez un client, c'est amateur. On ne la livre     │
--  │   pas. »                                                                │
--  │                                                                         │
--  │ ELLE REMPLACE LA RÈGLE PRÉCÉDENTE, qui disait l'inverse et qui est      │
--  │ écrite en toutes lettres en tête de `20260907200000_pannes_de_          │
--  │ redaction.sql` : « ET SURTOUT : RIEN DE TOUT CELA NE BLOQUE UNE         │
--  │ CANDIDATURE ». Cette phrase est désormais FAUSSE. Elle reste dans son   │
--  │ fichier — on ne réécrit pas une migration appliquée — et le commentaire │
--  │ de la table est repris ci-dessous pour qu'un lecteur de la BASE ne      │
--  │ tombe pas sur l'ancienne règle (§E.7 : un commentaire survit à sa       │
--  │ règle).                                                                 │
--  └─────────────────────────────────────────────────────────────────────────┘
--
--  ═══ POURQUOI UNE CONTRAINTE, ET PAS UN FILTRE À L'AFFICHAGE ═════════════
--    MESURÉ le 23/09/2026 : **17 fichiers** lisent `candidatures` —
--      app/api/candidatures/route.ts · candidatures/[id]/{pitch,reject,select,
--      unlock}/route.ts · me/badges · me/candidatures · me/candidatures/[id]/
--      view · me/conversations · me/missions/[id] · publications ·
--      lib/candidature-org-dto.ts · lib/matching/{pool,reconcile,run-for-
--      expert}.ts · lib/notifications/dispatch.ts · lib/unlock.ts
--    Cacher l'objet incomplet demanderait le même filtre dans chacun, plus
--    dans chaque compteur. Il suffirait d'en oublier UN. La garantie tenue ici
--    est que **l'objet incomplet n'existe pas**, pas qu'on le cache (§E.31).
--
--  ═══ POURQUOI UNE BORNE DE DATE, ET PAS `NOT VALID` ══════════════════════
--    MESURÉ le 23/09/2026 sur la base : **4 candidatures**, toutes des 4 et 5
--    juin 2026, toutes `unlocked`, toutes avec `ai_match_score = 9` (recopié
--    de l'ancien matching) et **toutes avec `ai_assessment` NULL**.
--
--    `NOT VALID` les aurait laissées entrer — mais une contrainte `NOT VALID`
--    est vérifiée sur **tout UPDATE**, y compris celui d'une ligne ancienne.
--    Ces quatre candidatures seraient devenues IMMUABLES : plus de sélection,
--    plus de refus, plus d'archivage. On aurait figé quatre dossiers réels
--    pour éviter d'écrire une date.
--
--    La borne, elle, est VALIDÉE sur toute la table (4 lignes, elles passent
--    toutes), elle laisse ces quatre lignes vivre leur vie, et elle refuse
--    **toute** écriture postérieure. Le passé est déclaré ; l'avenir est fermé.
--
--    ⚠️ Si une candidature incomplète était créée entre l'écriture de cette
--       migration et son application, l'ADD CONSTRAINT ÉCHOUERAIT, bruyamment.
--       C'est la bonne direction d'échec : on ne veut pas d'une contrainte qui
--       s'installe en fermant les yeux (§E.60).
--
--  ═══ CE QUE LA CONTRAINTE N'EXIGE PAS, ET POURQUOI ═══════════════════════
--    `ai_model` n'y est pas. La décision porte sur ce que le client REÇOIT —
--    une note et un résumé — pas sur la provenance, que `ai_assessment.model`
--    porte déjà. Ajouter une exigence que personne n'a demandée, c'est élargir
--    la règle tout seul.
-- ─────────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════════
--  ① LA CONTRAINTE — la base refuse une candidature nue
-- ════════════════════════════════════════════════════════════════════════════
alter table public.candidatures
  drop constraint if exists candidatures_complete_ou_inexistante;

alter table public.candidatures
  add constraint candidatures_complete_ou_inexistante check (
    -- LE PASSÉ, DÉCLARÉ. Quatre lignes de juin 2026, nommées ci-dessus.
    created_at < timestamptz '2026-09-23 00:00:00+00'
    or (
      ai_match_score is not null
      and ai_assessment is not null
      -- `->>` rend NULL quand la clé manque, quand la valeur est un `null`
      -- JSON, et quand `ai_assessment` n'est pas un objet. Les trois cas sont
      -- donc refusés par la même expression, sans les énumérer.
      and length(btrim(coalesce(ai_assessment ->> 'reason', ''))) > 0
      and length(btrim(coalesce(ai_assessment ->> 'pitch_org', ''))) > 0
    )
  );

comment on constraint candidatures_complete_ou_inexistante on public.candidatures is
  'Une candidature porte sa note ET son resume, ou elle n existe pas. La borne de '
  'date declare les 4 candidatures de juin 2026, anterieures a la regle : elles '
  'restent modifiables, aucune ecriture posterieure ne peut etre nue.';


-- ════════════════════════════════════════════════════════════════════════════
--  ② LE JOURNAL DES DÉPÔTS — ce qui n'a pas abouti se voit, et se rejoue
-- ════════════════════════════════════════════════════════════════════════════
--
--  ┌─ POURQUOI IL EXISTE, ET POURQUOI IL EST ÉCRIT **AVANT** LE JUGEMENT ────┐
--  │ Refuser d'écrire une candidature incomplète sans rien garder, c'est     │
--  │ perdre le dépôt : l'expert croit avoir postulé, l'organisation ignore   │
--  │ qu'elle devait recevoir quelque chose, et PERSONNE NE SE PLAINT.        │
--  │                                                                         │
--  │ La ligne naît AVANT l'appel au modèle, et c'est la moitié qui compte :  │
--  │ cet appel dure jusqu'à 30 s dans la requête, et c'est exactement là     │
--  │ qu'une fonction se fait tuer. Écrite APRÈS, elle n'existerait pas dans  │
--  │ le seul cas où elle est indispensable — la leçon de §E.63, payée huit   │
--  │ jours plus tôt sur les verdicts de cron.                                │
--  └─────────────────────────────────────────────────────────────────────────┘
--
--  ⚠️ CE N'EST PAS UNE CANDIDATURE FANTÔME. Aucune organisation ne la voit,
--     aucun compteur ne la compte, aucune surface produit ne la lit : la table
--     est `service_role` seul. Ce que la décision interdit, c'est de LIVRER un
--     dossier nu à un client — pas d'observer nos propres dépôts.
--
--  ⚠️ LE MESSAGE DE MOTIVATION N'Y RESTE QUE TANT QU'IL SERT À REJOUER.
--     Il est écrit par l'expert et peut contenir n'importe quoi de personnel.
--     Il est EFFACÉ à la seconde où le dépôt aboutit (`etat = 'depose'`), par
--     le code qui le solde. Le garder plus longtemps serait une conservation
--     sans finalité.
create table if not exists public.candidature_depots (
  id uuid primary key default gen_random_uuid(),

  publication_id uuid not null references public.publications(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id)     on delete cascade,
  domain_id      uuid references public.domains(id) on delete set null,

  -- 'en_cours' → l'appel au modèle est parti, rien n'est encore tranché
  -- 'echec'    → le jugement n'a pas abouti : AUCUNE candidature n'existe
  -- 'depose'   → la candidature existe, complète. `candidature_id` la nomme.
  etat text not null,

  -- La cause, EXACTEMENT celle que le jugement a rendue. Trois valeurs, les
  -- mêmes que `ai_redaction_failures` — les additionner en une seule dirait
  -- « il en manque beaucoup » là où trois disent quoi faire.
  cause  text,
  detail text,

  -- Ce qu'il faut pour rejouer EXACTEMENT le même dépôt. Rien de plus : le
  -- reste (le match, l'annonce, le profil) est relu au moment du rejeu, comme
  -- au premier passage — sinon le rejeu serait un chemin parallèle.
  cover_message text,

  tentatives integer not null default 1,

  -- SANS clé étrangère, volontairement : le journal doit survivre à la
  -- suppression de la candidature, sinon on perd la trace au moment précis où
  -- l'on cherche à comprendre. Même parti pris que `ai_redaction_failures`.
  candidature_id uuid,

  commence_at timestamptz not null default now(),
  termine_at  timestamptz,
  created_at  timestamptz not null default now(),

  -- MÊME CLÉ QUE `candidatures` : un couple (annonce, expert) a une
  -- candidature, ou une ligne de journal, jamais deux dépôts concurrents.
  constraint candidature_depots_couple_uniq unique (publication_id, profile_id),

  constraint candidature_depots_etat_check
    check (etat in ('en_cours', 'echec', 'depose')),

  constraint candidature_depots_cause_valeurs_check
    check (cause is null or cause in ('plafond', 'modele_indisponible', 'reponse_illisible')),

  -- UN ÉCHEC PORTE SA CAUSE, ET RIEN D'AUTRE N'EN PORTE. L'équivalence, et
  -- non deux implications : une ligne « déposée » qui garderait une cause se
  -- lirait comme un échec sur l'écran des erreurs (§E.24).
  constraint candidature_depots_cause_si_echec
    check ((etat = 'echec') = (cause is not null)),

  -- UNE LIGNE DÉPOSÉE NOMME SA CANDIDATURE. Sans ça, « déposé » serait une
  -- affirmation que rien ne peut vérifier.
  constraint candidature_depots_candidature_si_depose
    check (etat <> 'depose' or candidature_id is not null)
);

-- L'écran ne montre QUE ce qui n'a pas abouti : l'index partiel ne porte que
-- ces lignes-là, et il porte aussi leur ordre d'affichage.
create index if not exists candidature_depots_en_souffrance_idx
  on public.candidature_depots (commence_at desc)
  where etat <> 'depose';

-- Le filtre par écosystème de l'écran d'erreurs.
create index if not exists candidature_depots_domaine_idx
  on public.candidature_depots (domain_id, etat);

alter table public.candidature_depots enable row level security;
revoke all on table public.candidature_depots from public, anon, authenticated;
grant all on table public.candidature_depots to service_role;

comment on table public.candidature_depots is
  'Journal des DEPOTS de candidature : un par couple (annonce, expert). La ligne '
  'nait AVANT l appel au modele — un depot tue pendant l appel laisse donc une '
  'trace — et se solde en depose ou en echec. Un echec signifie qu AUCUNE '
  'candidature n existe : c est la file de rejeu de /admin/depots-en-echec. '
  'Le message de motivation y est efface des que le depot aboutit.';

comment on column public.candidature_depots.cover_message is
  'Conserve UNIQUEMENT tant qu il sert a rejouer. Efface au passage en depose.';


-- ════════════════════════════════════════════════════════════════════════════
--  ③ LE COMPTEUR DE PANNES NE COUVRE PLUS LES DÉPÔTS — et son commentaire le dit
-- ════════════════════════════════════════════════════════════════════════════
--  `ai_redaction_failures` reste le compteur des pitchs rédigés à la demande.
--  La surface `candidature` n'y est plus écrite : un dépôt en échec ne produit
--  plus de candidature, donc plus d'`entity_id` à désigner — la ligne y aurait
--  pointé vers un objet inexistant. Sa contrainte de valeurs est LAISSÉE
--  INTACTE : l'historique doit rester lisible, et un `check` rétréci refuserait
--  une réécriture de ligne ancienne.
comment on table public.ai_redaction_failures is
  'Journal des resumes qui n ont PAS pu etre ecrits, avec leur cause. Depuis le '
  '23/09/2026 il ne porte plus que la surface `pitch` : un depot de candidature '
  'qui echoue n ecrit AUCUNE candidature, et sa trace vit dans '
  'public.candidature_depots, qui elle se rejoue. Ce journal-ci ne se rejoue '
  'toujours pas : il compte.';


-- ════════════════════════════════════════════════════════════════════════════
--  ④ OUVRIR (OU ROUVRIR) LE JOURNAL D'UN DÉPÔT
-- ════════════════════════════════════════════════════════════════════════════
--  POURQUOI UNE FONCTION ET PAS UN `upsert` DEPUIS LE CODE.
--    La reprise doit INCRÉMENTER le compteur de tentatives, c'est-à-dire lire
--    la ligne existante pour écrire la suivante. PostgREST ne sait pas
--    exprimer `excluded` + la ligne d'origine dans un upsert : le code aurait
--    dû lire puis écrire, et deux relances simultanées auraient compté une
--    seule tentative (§F, « lire puis écrire »). Ici, une seule instruction.
--
--  ELLE REND `true` QUAND ELLE A ÉCRIT. Un `void` laisserait l'appelant
--  croire qu'il a un journal alors qu'il n'a rien — et c'est justement quand
--  rien n'a été écrit que le dépôt cesse d'être relançable (§E.22).
create or replace function public.ouvrir_depot_candidature(
  p_publication_id uuid,
  p_profile_id     uuid,
  p_domain_id      uuid,
  p_cover_message  text
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_rows integer;
begin
  insert into public.candidature_depots as d (
    publication_id, profile_id, domain_id,
    etat, cause, detail, cover_message,
    tentatives, candidature_id, commence_at, termine_at
  ) values (
    p_publication_id, p_profile_id, p_domain_id,
    'en_cours', null, null, p_cover_message,
    1, null, now(), null
  )
  on conflict (publication_id, profile_id) do update
    set etat           = 'en_cours',
        cause          = null,
        detail         = null,
        -- L'écosystème peut manquer à la relecture ; on ne l'efface pas pour
        -- autant : une ligne qui perdrait son domaine sortirait du filtre de
        -- l'écran au moment où on la relance.
        domain_id      = coalesce(excluded.domain_id, d.domain_id),
        cover_message  = excluded.cover_message,
        tentatives     = d.tentatives + 1,
        candidature_id = null,
        commence_at    = now(),
        termine_at     = null;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$fn$;

revoke all on function public.ouvrir_depot_candidature(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ouvrir_depot_candidature(uuid, uuid, uuid, text)
  to service_role;

comment on function public.ouvrir_depot_candidature(uuid, uuid, uuid, text) is
  'Ouvre ou rouvre la ligne de journal d un depot. Rend true si une ligne a ete '
  'ecrite. La reprise incremente tentatives dans la MEME instruction : deux '
  'relances simultanees ne peuvent pas en compter une seule.';


-- ════════════════════════════════════════════════════════════════════════════
--  POSTCONDITION — une migration qui « réussit » n'a rien prouvé (§E.60)
-- ════════════════════════════════════════════════════════════════════════════
do $post$
declare
  v_def  text;
  v_ok   boolean;
  v_n    integer;
begin
  -- ── La contrainte existe, par son NOM, sur la BONNE table, et elle est VALIDE
  select pg_get_constraintdef(c.oid), c.convalidated
    into v_def, v_ok
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'candidatures'
     and c.conname = 'candidatures_complete_ou_inexistante';

  if v_def is null then
    raise exception 'postcondition NON TENUE : candidatures_complete_ou_inexistante absente de public.candidatures';
  end if;
  if v_ok is not true then
    raise exception 'postcondition NON TENUE : la contrainte existe mais n est PAS validee — des lignes anterieures pourraient la violer';
  end if;
  -- Les quatre exigences, une par une. Un `like` global dirait seulement
  -- « il y a du texte » (§E.8 : on ancre sur ce qu'on défend).
  if v_def not like '%ai_match_score IS NOT NULL%' then
    raise exception 'postcondition NON TENUE : la contrainte n exige pas la NOTE — %', v_def;
  end if;
  if v_def not like '%ai_assessment IS NOT NULL%' then
    raise exception 'postcondition NON TENUE : la contrainte n exige pas le RESUME — %', v_def;
  end if;
  if v_def not like '%reason%' or v_def not like '%pitch_org%' then
    raise exception 'postcondition NON TENUE : la contrainte n exige pas les DEUX textes — %', v_def;
  end if;
  if v_def not like '%2026-09-23%' then
    raise exception 'postcondition NON TENUE : la borne de date a disparu — les lignes anterieures deviendraient immuables : %', v_def;
  end if;

  -- ── Et la borne ne couvre RIEN qui serait déjà nu après elle.
  select count(*) into v_n
    from public.candidatures
   where created_at >= timestamptz '2026-09-23 00:00:00+00'
     and (ai_match_score is null or ai_assessment is null);
  if v_n > 0 then
    raise exception 'postcondition NON TENUE : % candidature(s) posterieure(s) a la borne sont nues', v_n;
  end if;

  -- ── Le journal : la table, sa clé, ses trois règles, ses deux index
  if to_regclass('public.candidature_depots') is null then
    raise exception 'postcondition NON TENUE : public.candidature_depots absente';
  end if;

  select count(*) into v_n
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'candidature_depots'
     and c.conname in (
       'candidature_depots_couple_uniq',
       'candidature_depots_etat_check',
       'candidature_depots_cause_valeurs_check',
       'candidature_depots_cause_si_echec',
       'candidature_depots_candidature_si_depose'
     );
  if v_n <> 5 then
    raise exception 'postcondition NON TENUE : % contrainte(s) sur candidature_depots au lieu de 5', v_n;
  end if;

  -- ⚠️ L'UNICITÉ SE VÉRIFIE SUR SES COLONNES, PAS SUR SON NOM. `if not exists`
  --    sur un nom déjà pris saute la création EN SILENCE — c'est §E.60, et ça
  --    a déjà laissé `packages_stripe` sans aucune garde.
  select count(*) into v_n
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'candidature_depots'
     and c.conname = 'candidature_depots_couple_uniq'
     and c.contype = 'u'
     and c.conkey = (
       select array_agg(a.attnum order by k.ord)
         from unnest(array['publication_id', 'profile_id']) with ordinality as k(nom, ord)
         join pg_attribute a on a.attrelid = t.oid and a.attname = k.nom
     );
  if v_n <> 1 then
    raise exception 'postcondition NON TENUE : candidature_depots_couple_uniq n est pas l unicite (publication_id, profile_id)';
  end if;

  select count(*) into v_n
    from pg_indexes
   where schemaname = 'public' and tablename = 'candidature_depots'
     and indexname in ('candidature_depots_en_souffrance_idx', 'candidature_depots_domaine_idx');
  if v_n <> 2 then
    raise exception 'postcondition NON TENUE : % index sur candidature_depots au lieu de 2', v_n;
  end if;

  -- L'index de l'écran est PARTIEL : sans sa clause, il porterait aussi les
  -- lignes soldées, et l'écran paierait un balayage qui grossit sans fin.
  select count(*) into v_n
    from pg_indexes
   where schemaname = 'public' and tablename = 'candidature_depots'
     and indexname = 'candidature_depots_en_souffrance_idx'
     and indexdef like '%WHERE%';
  if v_n <> 1 then
    raise exception 'postcondition NON TENUE : candidature_depots_en_souffrance_idx n est pas partiel';
  end if;

  -- ── La fonction d'ouverture : son NOM **et** sa signature exacte. Une
  --    surcharge de plus et l'appel résoudrait vers l'autre, en silence.
  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'ouvrir_depot_candidature';
  if v_n <> 1 then
    raise exception 'postcondition NON TENUE : % version(s) de ouvrir_depot_candidature au lieu de 1', v_n;
  end if;

  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'ouvrir_depot_candidature'
     and pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, uuid, text';
  if v_n <> 1 then
    raise exception 'postcondition NON TENUE : ouvrir_depot_candidature n a pas la signature (uuid, uuid, uuid, text)';
  end if;

  -- Elle DOIT reprendre la ligne existante plutôt que d'en empiler une
  -- seconde : sans le `on conflict`, l'unicité ferait échouer toute relance.
  if pg_get_functiondef(
       (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'ouvrir_depot_candidature' limit 1)
     ) not like '%on conflict%' then
    raise exception 'postcondition NON TENUE : ouvrir_depot_candidature ne reprend pas la ligne existante';
  end if;

  raise notice 'postcondition tenue : contrainte validee, journal des depots en place';
end
$post$;
