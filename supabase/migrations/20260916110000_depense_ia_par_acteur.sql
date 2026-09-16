-- ═══════════════════════════════════════════════════════════════════════════
-- LA DÉPENSE IA, DÉCOUPÉE PAR ACTEUR — ET UNE ALERTE QUI NE BLOQUE PAS
--
-- ━━━ LE DÉFAUT QU'ON FERME ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--   `ai_spend_events` sait COMBIEN on a dépensé et CHEZ QUI. Elle ne sait pas
--   POUR QUI. Les identifiants d'acteur existaient déjà — mais dans le `context`
--   jsonb, c'est-à-dire nulle part où l'on puisse sommer, indexer ou comparer.
--
--   Conséquence concrète : au plafond mensuel, on savait qu'on y était et on
--   ignorait totalement qui l'avait rempli. Une seule organisation pouvait
--   consommer le budget de tout l'écosystème sans qu'aucune requête ne puisse
--   le montrer.
--
-- ━━━ UN ÉVÉNEMENT, UN ACTEUR — ET POURQUOI C'EST LA SEULE RÈGLE HONNÊTE ━━━━
--   Deux colonnes nullables, et une contrainte : JAMAIS LES DEUX À LA FOIS.
--
--   La tentation était de remplir les deux sur un jugement de candidature (un
--   expert postule à l'annonce d'une organisation). Elle est refusée : la somme
--   par organisation et la somme par profil compteraient alors deux fois la même
--   dépense, et leur total dépasserait la dépense réelle. Un tableau de bord qui
--   ne boucle pas ne se corrige pas — on cesse de le croire.
--
--   L'acteur retenu est donc CELUI QUI DÉCLENCHE la dépense, pas celui qui en
--   profite. C'est la question à laquelle ce découpage doit répondre : QUI FAIT
--   MONTER LA FACTURE.
--
--     cv_parsing             → l'expert dépose son CV               → profil
--     expert_verification    → l'expert demande sa vérification     → profil
--     candidature_assessment → l'expert dépose sa candidature       → profil
--     matching_pool (sens expert → annonces)                        → profil
--     org_verification       → l'organisation s'inscrit             → organisation
--     publication_quality    → l'organisation publie                → organisation
--     matching_pool (sens annonce → experts)                        → organisation
--     pitch                  → l'organisation demande le pitch      → organisation
--
--   AUCUNE PRORATION, NULLE PART. Découper 0,004 $ entre deux acteurs selon une
--   clé inventée produirait un chiffre que personne ne pourrait défendre.
--
-- ━━━ CE QU'ON NE FAIT PAS : REMPLIR LE PASSÉ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--   Aucune reprise des lignes existantes. On POURRAIT en déduire l'acteur de
--   certaines par jointure depuis `context` — et ce serait attribuer la dépense
--   d'hier selon une règle écrite aujourd'hui.
--
--   Les anciennes lignes restent donc SANS acteur, et l'écran les montre pour ce
--   qu'elles sont : une ligne « non imputable », visible, chiffrée, qui décroît
--   d'elle-même puisque la lecture est mensuelle. Un total honnête qui affiche
--   son angle mort vaut mieux qu'un total complet qui l'a deviné.
--
-- ━━━ ALERTER, PAS BLOQUER — ET LE NOM LE DIT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--   La table s'appelle `ai_spend_seuils_acteur` et sa colonne `seuil_mensuel_usd`.
--   PAS « plafond » : décision produit arbitrée, un dépassement par acteur ALERTE
--   et ne bloque JAMAIS. Un champ nommé « plafond » qui ne plafonne rien serait
--   la première ligne du prochain écart entre le code et ce qu'on en raconte.
--
--   Le seul vrai plafond reste le plafond GLOBAL (`ai_spend_caps`), et lui
--   bloque — c'est inchangé par ce fichier.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. LES DEUX COLONNES D'ACTEUR, ET L'ACTION ─────────────────────────────
--  `on delete set null` et non `cascade` : supprimer une organisation ne doit
--  pas effacer ce qu'elle a coûté. La dépense a eu lieu ; elle rejoint le
--  non-imputable, elle ne disparaît pas du total.
alter table public.ai_spend_events
  add column if not exists organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists profile_id      uuid references public.profiles(id)      on delete set null,
  add column if not exists action          text;

do $$
begin
  -- La contrainte qui rend les sommes ADDITIONNABLES. Sans elle, le tableau de
  -- bord peut afficher un total supérieur à la dépense réelle.
  if not exists (select 1 from pg_constraint where conname = 'ai_spend_un_seul_acteur') then
    alter table public.ai_spend_events
      add constraint ai_spend_un_seul_acteur
      check (organization_id is null or profile_id is null);
  end if;

  -- `action` reste NULLABLE : les lignes antérieures n'en ont pas et n'en
  -- auront jamais. Mais quand elle est renseignée, elle est dans la liste —
  -- une action inventée côté code casse l'insertion au lieu de créer une
  -- catégorie fantôme que personne ne remarquera dans un groupement.
  if not exists (select 1 from pg_constraint where conname = 'ai_spend_action_check') then
    alter table public.ai_spend_events
      add constraint ai_spend_action_check
      check (action is null or action in (
        'cv_parsing',
        'matching_pool',
        'candidature_assessment',
        'pitch',
        'expert_verification',
        'org_verification',
        'publication_quality'
      ));
  end if;
end
$$;

-- Index PARTIELS : la très grande majorité des lignes n'a qu'un acteur sur deux,
-- et un index plein indexerait surtout des NULL.
create index if not exists ai_spend_org_mois_idx
  on public.ai_spend_events (organization_id, created_at desc)
  where organization_id is not null;

create index if not exists ai_spend_profil_mois_idx
  on public.ai_spend_events (profile_id, created_at desc)
  where profile_id is not null;

create index if not exists ai_spend_action_mois_idx
  on public.ai_spend_events (action, created_at desc);

comment on column public.ai_spend_events.organization_id is
  'L''organisation qui a DECLENCHE la depense (pas celle qui en profite). '
  'Exclusif avec profile_id : contrainte ai_spend_un_seul_acteur. NULL = non imputable.';
comment on column public.ai_spend_events.profile_id is
  'L''expert qui a DECLENCHE la depense. Exclusif avec organization_id. NULL = non imputable.';
comment on column public.ai_spend_events.action is
  'Le point de depense, parmi les sept. NULL sur les lignes anterieures au decoupage par acteur.';


-- ── 2. LE SEUIL D'ALERTE PAR ACTEUR ────────────────────────────────────────
create table if not exists public.ai_spend_seuils_acteur (
  acteur            text primary key,
  seuil_mensuel_usd numeric not null,
  updated_at        timestamptz not null default now(),

  constraint ai_spend_seuils_acteur_check  check (acteur in ('organization', 'profile')),
  constraint ai_spend_seuils_montant_check check (seuil_mensuel_usd >= 0)
);

-- VALEURS DE DÉPART, ET LEUR RAISON — à réviser sur un mois de données réelles.
--   profil : 2 $. Le cycle complet d'un expert (analyse de CV, vérification,
--   quelques candidatures jugées) se compte en CENTIMES. 2 $ en un mois, c'est
--   deux ordres de grandeur au-dessus de l'usage normal : ce n'est plus un
--   profil actif, c'est une boucle ou un abus.
--
--   organisation : 10 $. Le plafond global Claude est de 100 $ par mois. Une
--   seule organisation à 10 $ consomme donc un DIXIÈME du budget de tout
--   l'écosystème — le seuil ne dit pas « trop cher », il dit « allez regarder ».
insert into public.ai_spend_seuils_acteur (acteur, seuil_mensuel_usd)
values ('organization', 10), ('profile', 2)
on conflict (acteur) do nothing;

alter table public.ai_spend_seuils_acteur enable row level security;
revoke all on table public.ai_spend_seuils_acteur from public, anon, authenticated;
grant all on table public.ai_spend_seuils_acteur to service_role;

comment on table public.ai_spend_seuils_acteur is
  'Seuil mensuel PAR ACTEUR. ALERTE, ne bloque JAMAIS : decision produit arbitree. '
  'Le seul plafond bloquant est le plafond global (ai_spend_caps).';


-- ── 3. LA LECTURE, RECALCULÉE À CHAQUE AFFICHAGE ───────────────────────────
--
--  RIEN N'EST STOCKÉ, AUCUNE TÂCHE PLANIFIÉE. Un état « en dépassement » écrit
--  quelque part serait faux dès la seconde suivante, et il faudrait ensuite le
--  réparer. L'alerte se calcule quand on la regarde, ou elle n'existe pas.
--
--  ═══ LA SOMME BOUCLE, ET C'EST LA PROPRIÉTÉ QU'ON DÉFEND ═══════════════════
--    Σ(lignes rendues) = dépense totale du mois, à l'exact.
--    Trois familles de lignes, disjointes et exhaustives :
--      · un acteur nommé, parmi les `p_limite` plus gros ;
--      · `reste_non_detaille` — les acteurs suivants, agrégés et COMPTÉS (on
--        dit combien ils sont, on ne les cache pas) ;
--      · `non_imputable`      — les lignes sans acteur.
--
--    La fenêtre mensuelle est celle de `ai_spend_status`, AU CARACTÈRE PRÈS.
--    Deux expressions différentes décaleraient les deux totaux d'une poignée
--    d'heures en fin de mois, et la somme cesserait de boucler — c'est-à-dire
--    qu'on perdrait la seule chose qui rend cet écran croyable.
create or replace function public.ai_spend_par_acteur(p_limite integer default 25)
  returns table (
    acteur_type       text,
    acteur_id         uuid,
    acteur_nom        text,
    depense_mois      numeric,
    evenements        integer,
    acteurs_regroupes integer
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  with mois as (
    select e.organization_id, e.profile_id, e.cost_usd
      from public.ai_spend_events e
     where e.created_at >= date_trunc('month', now() at time zone 'utc')
  ),
  impute as (
    select
      case when m.organization_id is not null then 'organization' else 'profile' end as acteur_type,
      coalesce(m.organization_id, m.profile_id)                                      as acteur_id,
      sum(m.cost_usd)                                                                as depense,
      count(*)::integer                                                              as evenements
      from mois m
     where m.organization_id is not null or m.profile_id is not null
     group by 1, 2
  ),
  classe as (
    select i.*, row_number() over (order by i.depense desc, i.acteur_id) as rang
      from impute i
  )
  select
      c.acteur_type::text,
      c.acteur_id,
      (case c.acteur_type
         when 'organization' then o.company_name
         else coalesce(
                nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
                p.title)
       end)::text,
      round(c.depense, 6),
      c.evenements,
      1
    from classe c
    left join public.organizations o on c.acteur_type = 'organization' and o.id = c.acteur_id
    left join public.profiles      p on c.acteur_type = 'profile'      and p.id = c.acteur_id
    left join public.users         u on u.id = p.user_id
   where c.rang <= greatest(1, coalesce(p_limite, 25))
  union all
  select
      'reste_non_detaille'::text,
      null::uuid,
      null::text,
      round(coalesce(sum(c.depense), 0), 6),
      coalesce(sum(c.evenements), 0)::integer,
      count(*)::integer
    from classe c
   where c.rang > greatest(1, coalesce(p_limite, 25))
  union all
  select
      'non_imputable'::text,
      null::uuid,
      null::text,
      round(coalesce(sum(m.cost_usd), 0), 6),
      count(*)::integer,
      0
    from mois m
   where m.organization_id is null and m.profile_id is null
   order by 4 desc;
$fn$;

revoke all on function public.ai_spend_par_acteur(integer) from public, anon, authenticated;
grant execute on function public.ai_spend_par_acteur(integer) to service_role;

comment on function public.ai_spend_par_acteur(integer) is
  'Depense IA du mois par acteur declencheur. La somme des lignes rendues EGALE la '
  'depense totale du mois : acteurs detailles + reste_non_detaille + non_imputable. '
  'Rien n''est stocke — l''alerte se calcule a l''affichage.';
