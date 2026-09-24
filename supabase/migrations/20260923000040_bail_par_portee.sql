-- ════════════════════════════════════════════════════════════════════════════
--  LE BAIL D'EXÉCUTION DEVIENT GÉNÉRIQUE — UNE PORTÉE, UNE CLÉ, UN MÉCANISME.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement.
--    Les deux fonctions du bail de cron sont CONSERVÉES sous leur nom et leur
--    signature : elles deviennent des enveloppes d'une ligne. Le code en ligne
--    continue donc de fonctionner à l'identique pendant le déploiement, et les
--    cinq routes de cron n'ont pas une ligne à changer.
--
--  ┌─ LE BESOIN, ET IL VIENT DU POINT 4 ─────────────────────────────────────┐
--  │ « Interdire DEUX RECHERCHES SIMULTANÉES sur le même expert — le          │
--  │   mécanisme des tâches de fond étendu au déclenchement direct. »         │
--  │                                                                          │
--  │ Le mécanisme existe et il est juste : `cron_run_leases` ferme un          │
--  │ chevauchement STRUCTUREL qui faisait repayer le même travail d'IA. Mais  │
--  │ il est clé sur un NOM DE TÂCHE, et ce qu'il faut verrouiller ici est un  │
--  │ EXPERT.                                                                  │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  ═══ POURQUOI GÉNÉRALISER PLUTÔT QUE DUPLIQUER ═══════════════════════════
--    Une seconde table `matching_baux_expert` avec la même fonction d'upsert
--    aurait été un JUMEAU (§E.20) — et un jumeau de VERROU est le pire de
--    tous : il ne sert que sous concurrence, c'est-à-dire précisément quand
--    personne ne regarde. Le jour où l'un des deux corrige sa fenêtre de
--    grâce, l'autre reste ouvert, et rien ne le dit.
--
--    MESURÉ AVANT DE TRANCHER : `cron_run_leases` n'est lue par AUCUNE ligne
--    de `app/`, `lib/` ou `components/`, et par aucune autre migration que
--    celle qui l'a créée. Ses seuls lecteurs sont ses deux fonctions, que
--    cette migration réécrit. La table peut donc être migrée puis retirée —
--    et une table morte qu'on garde « au cas où » est exactement ce que §M1
--    ⑥ recense (onze d'entre elles).
--
--  ⚠️ LA GARANTIE RESTE LA MÊME, ET C'EST ELLE QU'IL FAUT LIRE : **une seule
--     instruction**. Aucune fenêtre entre une lecture et une écriture, donc
--     rien à gagner à arriver en premier. Deux appels simultanés ne peuvent
--     pas obtenir `true` tous les deux (§F).
-- ─────────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════════
--  ① LA TABLE — une portée, une clé
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.baux (
  -- CE QU'ON VERROUILLE : 'cron' pour une tâche planifiée, 'matching_expert'
  -- pour un expert. Du texte plutôt qu'un type énuméré : ajouter une portée ne
  -- doit pas demander de migrer un type.
  portee      text        not null,
  -- L'IDENTIFIANT DANS CETTE PORTÉE : un nom de tâche, un identifiant de
  -- profil. Du texte, pour la même raison — et parce qu'un `uuid` interdirait
  -- la portée 'cron'.
  cle         text        not null,

  started_at  timestamptz not null default now(),
  -- NULL = le bail est TENU. Rendu, il porte sa date — et il expire de toute
  -- façon tout seul, cf. la fonction ci-dessous.
  finished_at timestamptz,

  constraint baux_pkey primary key (portee, cle)
);

alter table public.baux enable row level security;
revoke all on table public.baux from public, anon, authenticated;
grant all on table public.baux to service_role;

comment on table public.baux is
  'Baux d execution, par PORTEE et par CLE. Un seul mecanisme pour tout le depot : '
  'les taches planifiees (portee cron, cle = nom de tache) et les recherches de '
  'missions (portee matching_expert, cle = profile_id). Deux tables auraient ete '
  'deux verrous jumeaux, et un jumeau de verrou ne sert que sous concurrence — '
  'c est-a-dire quand personne ne regarde.';


-- ════════════════════════════════════════════════════════════════════════════
--  ② LA REPRISE DES BAUX DE CRON — avant de retirer leur table
-- ════════════════════════════════════════════════════════════════════════════
--  ⚠️ ELLE PRÉCÈDE LE `drop`, ET L'ORDRE EST LA GARANTIE. Retirer d'abord
--     aurait perdu l'état des baux en cours : une tâche qui tourne au moment
--     de la migration verrait son bail disparaître, et une seconde pourrait
--     partir en parallèle — le chevauchement qu'on ferme, rouvert par le
--     correctif lui-même.
do $reprise$
begin
  if to_regclass('public.cron_run_leases') is not null then
    insert into public.baux (portee, cle, started_at, finished_at)
    select 'cron', l.job_name, l.started_at, l.finished_at
      from public.cron_run_leases l
    on conflict (portee, cle) do nothing;
  end if;
end
$reprise$;


-- ════════════════════════════════════════════════════════════════════════════
--  ③ LE MÉCANISME — une seule instruction, et il n'y en a qu'une
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.prendre_bail(
  p_portee text,
  p_cle    text,
  p_grace  interval default interval '15 minutes'
) returns boolean
  language sql
  volatile
  security definer
  set search_path to 'public'
as $fn$
  with prise as (
    insert into public.baux (portee, cle, started_at, finished_at)
    values (p_portee, p_cle, now(), null)
    on conflict (portee, cle) do update
       set started_at  = now(),
           finished_at = null
     where public.baux.finished_at is not null
        or public.baux.started_at < now() - p_grace
    returning 1
  )
  select exists (select 1 from prise);
$fn$;

comment on function public.prendre_bail(text, text, interval) is
'Prend le bail d une portee et d une cle. Rend true si le bail est obtenu, false
si un autre detenteur le tient encore.

UNE SEULE INSTRUCTION : aucune fenetre entre une lecture et une ecriture, donc
rien a gagner a arriver en premier. Deux appels simultanes ne peuvent pas
obtenir true tous les deux.

p_grace doit valoir AU MOINS la duree maximale du travail protege. En dessous,
un travail encore vivant se ferait doubler ; au-dessus, un processus tue
attendrait plus longtemps que necessaire avant de repartir.

Un refus n est JAMAIS une panne : c est le cas normal quand un travail est deja
en cours.';

revoke all on function public.prendre_bail(text, text, interval) from public, anon, authenticated;
grant execute on function public.prendre_bail(text, text, interval) to service_role;


create or replace function public.rendre_bail(p_portee text, p_cle text)
  returns void
  language sql
  volatile
  security definer
  set search_path to 'public'
as $fn$
  update public.baux
     set finished_at = now()
   where portee = p_portee
     and cle = p_cle
     and finished_at is null;
$fn$;

comment on function public.rendre_bail(text, text) is
'Rend un bail plus tot que son delai de grace. PUREMENT FACULTATIF : le bail
expire tout seul. Un echec ici retarde le prochain travail, il ne bloque RIEN —
un processus tue ne peut pas coincer sa cle. C est l inverse exact d un drapeau
qu il faudrait baisser.';

revoke all on function public.rendre_bail(text, text) from public, anon, authenticated;
grant execute on function public.rendre_bail(text, text) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
--  ④ SAVOIR SI UN BAIL EST TENU, SANS LE PRENDRE
-- ════════════════════════════════════════════════════════════════════════════
--  ⚠️ CETTE LECTURE EST **CONSULTATIVE**, ET LE CODE LE DIT AUSSI. Entre elle
--     et l'action qui suit, un autre détenteur peut prendre le bail : elle ne
--     remplace PAS `prendre_bail`, elle permet seulement d'ATTENDRE avant de
--     dépenser. La garantie reste la prise, qui est atomique.
create or replace function public.bail_tenu(
  p_portee text,
  p_cle    text,
  p_grace  interval default interval '15 minutes'
) returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.baux
     where portee = p_portee
       and cle = p_cle
       and finished_at is null
       and started_at >= now() - p_grace
  );
$fn$;

comment on function public.bail_tenu(text, text, interval) is
'Dit si un bail est tenu, SANS le prendre. CONSULTATIF : entre cette lecture et
l action qui suit, un autre detenteur peut le prendre. Elle ne remplace pas
prendre_bail — elle permet d ATTENDRE avant de depenser.';

revoke all on function public.bail_tenu(text, text, interval) from public, anon, authenticated;
grant execute on function public.bail_tenu(text, text, interval) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
--  ⑤ LES DEUX FONCTIONS DE CRON DEVIENNENT DES ENVELOPPES
-- ════════════════════════════════════════════════════════════════════════════
--  Elles gardent leur NOM et leur SIGNATURE : les cinq routes de cron n'ont pas
--  une ligne à changer, et le déploiement peut se faire dans n'importe quel
--  ordre. Ce qui disparaît est la seconde IMPLÉMENTATION, pas l'API.
create or replace function public.prendre_bail_run(
  p_job_name text,
  p_grace    interval default interval '15 minutes'
) returns boolean
  language sql
  volatile
  security definer
  set search_path to 'public'
as $fn$
  select public.prendre_bail('cron', p_job_name, p_grace);
$fn$;

comment on function public.prendre_bail_run(text, interval) is
'Enveloppe de prendre_bail(''cron'', …). Conservee sous son nom et sa signature :
les cinq routes de cron l appellent telle quelle. La SEULE implementation du
mecanisme vit dans prendre_bail.';

create or replace function public.rendre_bail_run(p_job_name text)
  returns void
  language sql
  volatile
  security definer
  set search_path to 'public'
as $fn$
  select public.rendre_bail('cron', p_job_name);
$fn$;

comment on function public.rendre_bail_run(text) is
'Enveloppe de rendre_bail(''cron'', …). Cf. prendre_bail_run.';


-- ════════════════════════════════════════════════════════════════════════════
--  ⑥ LA TABLE D'ORIGINE PART — ses lignes sont reprises, ses lecteurs réécrits
-- ════════════════════════════════════════════════════════════════════════════
--  MESURÉ avant de la retirer : aucune ligne de `app/`, `lib/` ou
--  `components/` ne la cite, et aucune autre migration que celle qui l'a
--  créée. La garder ferait une table morte de plus (§M1 ⑥ en recense onze).
drop table if exists public.cron_run_leases;


-- ════════════════════════════════════════════════════════════════════════════
--  POSTCONDITION — une migration qui « réussit » n'a rien prouvé (§E.60)
-- ════════════════════════════════════════════════════════════════════════════
do $post$
declare
  v_n integer;
  v_sig text;
begin
  if to_regclass('public.baux') is null then
    raise exception 'postcondition NON TENUE : public.baux absente';
  end if;

  -- LA CLÉ PRIMAIRE SE VÉRIFIE SUR SES COLONNES, PAS SUR SON NOM (§E.60).
  select count(*) into v_n
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'baux'
     and c.contype = 'p'
     and c.conkey = (
       select array_agg(a.attnum order by k.ord)
         from unnest(array['portee', 'cle']) with ordinality as k(nom, ord)
         join pg_attribute a on a.attrelid = t.oid and a.attname = k.nom
     );
  if v_n <> 1 then
    raise exception 'postcondition NON TENUE : la cle primaire de baux n est pas (portee, cle) — sans elle, l upsert n est plus atomique';
  end if;

  -- LES CINQ FONCTIONS, par leur signature exacte — RÉSOLUE PAR SES TYPES.
  -- ⚠️ ON RÉSOUT LA FONCTION PAR SES TYPES, PAS PAR UNE CHAÎNE RENDUE.
  --    `pg_get_function_identity_arguments` rend AUSSI LES NOMS des
  --    paramètres — « p_log_id bigint, p_http_status integer, … ». La comparer
  --    à « bigint, integer, jsonb, text » ne pouvait donc JAMAIS être vraie sur
  --    une fonction aux paramètres nommés, c'est-à-dire sur toutes les nôtres.
  --    Cette postcondition a arrêté un `db push` sur staging en annonçant
  --    absente une fonction que la migration venait de créer six lignes plus
  --    haut.
  --
  --    `to_regprocedure` prend une signature en TYPES, la résout, et rend NULL
  --    si rien ne correspond. Aucun rendu, aucun nom, aucune mise en forme :
  --    la question posée est celle qu'on voulait poser.
  --
  --    ET LE REFUS NOMME LAQUELLE. « une fonction de bail manque » sur cinq
  --    candidates envoyait chercher dans le noir.
  for v_sig in
    select s from unnest(array[
      'public.prendre_bail(text, text, interval)',
      'public.rendre_bail(text, text)',
      'public.bail_tenu(text, text, interval)',
      'public.prendre_bail_run(text, interval)',
      'public.rendre_bail_run(text)'
    ]) as s
    where to_regprocedure(s) is null
  loop
    -- ET LE REFUS DIT CE QU'IL A VU. Nommer la signature attendue ne suffit
    -- pas : c'est en lisant CE QUI EXISTE qu'on comprend si la fonction manque
    -- ou si elle a simplement changé d'arite. Le message d'origine du cas de
    -- staging annonçait une fonction absente qui était là ; quatre heures se
    -- perdent ainsi.
    raise exception
      'postcondition NON TENUE : % manque ou a change de signature [vu : %]',
      v_sig,
      coalesce(
        (select string_agg(p.oid::regprocedure::text, ' | ')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = split_part(split_part(v_sig, '.', 2), '(', 1)),
        'aucune fonction de ce nom');
  end loop;

  -- LES ENVELOPPES DÉLÈGUENT — si elles réimplémentaient, le jumeau serait
  -- revenu par la porte que cette migration ferme.
  -- ⚠️ `coalesce` OBLIGATOIRE : `pg_get_functiondef` est STRICT, et
  --    `NULL not like '%x%'` vaut NULL — le `if` ne s'exécute pas, et une
  --    fonction absente PASSE (§E.37).
  if coalesce(
       pg_get_functiondef(to_regprocedure('public.prendre_bail_run(text, interval)')),
       ''
     ) not like '%prendre_bail(%' then
    raise exception 'postcondition NON TENUE : prendre_bail_run ne delegue pas — deux implementations du meme verrou';
  end if;

  -- ET L'ANCIENNE TABLE A BIEN DISPARU : la laisser ferait deux verrous, dont
  -- un que plus rien ne tient à jour.
  if to_regclass('public.cron_run_leases') is not null then
    raise exception 'postcondition NON TENUE : cron_run_leases existe encore';
  end if;

  raise notice 'postcondition tenue : un seul mecanisme de bail, deux portees';
end
$post$;
