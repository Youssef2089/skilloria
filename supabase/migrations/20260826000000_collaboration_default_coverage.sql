-- ─────────────────────────────────────────────────────────────────────────────
-- COLLABORATION — LA CIBLE 'collaboration' DEVIENT UNE CIBLE DE COUVERTURE
--
-- CONTEXTE
--   Le back-office doit pouvoir gérer PLUSIEURS offres de collaboration entre
--   experts (en créer, les paramétrer, en désigner une par défaut), exactement
--   comme il le fait pour les offres client et cabinet. Deux verrous en base
--   l'empêchaient :
--
--   1. La RPC set_default_package (20260709000005) ne connaît QUE les cibles
--      'client' et 'cabinet'. Désigner une offre 'collaboration' par défaut
--      n'aurait PAS retiré le statut à l'offre collaboration précédente : deux
--      offres seraient restées is_default=true en même temps, et la résolution
--      du repli (lib/entitlements.ts) serait devenue non déterministe. Aucun
--      index unique ne l'empêche côté base — l'invariant vit dans cette RPC.
--
--   2. Aucune offre collaboration n'était marquée par défaut (le seed de
--      20260709000008 pose volontairement is_default=false). Or l'applicatif
--      exige désormais EXACTEMENT UNE offre par défaut active par cible, les
--      trois cibles comprises.
--
-- CETTE MIGRATION (fichier ; poussée par Youssef — AUCUNE commande DB ici)
--   a. Remplace set_default_package : invariant étendu à trois cibles
--      (client, cabinet, collaboration).
--   b. Marque l'offre 'collaboration' seedée comme offre par défaut de sa
--      cible, si et seulement si aucune ne l'est déjà.
--
-- ⚠ RÈGLE CENTRALE — 'all' NE COUVRE PAS 'collaboration'
--   'all' signifie « une offre unique pour les clients ET les cabinets » :
--   deux publics ENTREPRISE. La collaboration entre experts est un monde
--   commercial disjoint (organisation PERSONNELLE, pas d'entreprise vérifiée,
--   quotas propres). Une offre 'all' ne doit donc jamais absorber le statut par
--   défaut de la collaboration, ni le lui fournir.
--   Cette règle est écrite à l'identique dans lib/package-default.ts (fonction
--   `covers`, constante COVERAGE_TARGETS). Les deux implémentations sont
--   volontairement jumelles : le TS sert la prévisualisation côté back-office,
--   le SQL garantit l'atomicité. Toute évolution de l'une DOIT être répercutée
--   dans l'autre.
--
-- ORDRE DE DÉPLOIEMENT — IMPÉRATIF
--   Cette migration doit être poussée AVANT la mise en ligne du code applicatif
--   du lot. Le code exige une offre collaboration par défaut ; si le code part
--   en premier, tout transfert d'offre par défaut (y compris client et cabinet)
--   est refusé avec 'target_uncovered' jusqu'à ce que la migration passe.
--   Refus propre et réversible — aucune donnée perdue — mais bloquant.
--
-- IDEMPOTENCE : create or replace pour la fonction ; le marquage du défaut est
--   sous WHERE NOT EXISTS. Rejouée, la migration ne change rien.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── a. RPC set_default_package — invariant à TROIS cibles ──────────────────
create or replace function public.set_default_package(p_package_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target   text;
  v_active   boolean;
  v_default  boolean;
  v_client   integer;
  v_cabinet  integer;
  v_collab   integer;
begin
  -- ── 1. Existence + état, avec verrou de ligne pour sérialiser deux
  --       transferts concurrents sur la même offre.
  select target_role, active, is_default
    into v_target, v_active, v_default
  from public.packages
  where id = p_package_id
  for update;

  if not found then
    raise exception 'package_not_found' using errcode = 'P0002';
  end if;

  -- Déjà le défaut : no-op silencieux (geste idempotent côté appelant).
  if v_default then
    return;
  end if;

  -- Un défaut DOIT être actif, sinon les nouvelles inscriptions (ou les espaces
  -- de collaboration créés à la volée) seraient rattachés à une offre retirée
  -- de la vente.
  if not v_active then
    raise exception 'package_inactive' using errcode = 'P0001';
  end if;

  -- ── 2. Couverture RÉSULTANTE, calculée AVANT toute écriture.
  --       Une ligne est retirée si elle couvre une cible que la nouvelle offre
  --       couvre désormais ; les autres défauts sont conservés.
  --       Couverture : R couvre T  ⇔  R = T  OU  (R = 'all' ET T <> 'collaboration').
  with defaults as (
    select id, target_role
    from public.packages
    where is_default and active and id <> p_package_id
  ),
  kept as (
    select d.id, d.target_role
    from defaults d
    -- Conservée seulement si elle ne partage AUCUNE cible avec la nouvelle offre.
    where not (
      (d.target_role in ('client', 'all')  and v_target in ('client', 'all'))
      or
      (d.target_role in ('cabinet', 'all') and v_target in ('cabinet', 'all'))
      or
      (d.target_role = 'collaboration'     and v_target = 'collaboration')
    )
  ),
  resulting as (
    select target_role from kept
    union all
    select v_target
  )
  select
    count(*) filter (where target_role in ('client', 'all')),
    count(*) filter (where target_role in ('cabinet', 'all')),
    count(*) filter (where target_role = 'collaboration')
    into v_client, v_cabinet, v_collab
  from resulting;

  if v_client <> 1 or v_cabinet <> 1 or v_collab <> 1 then
    -- L'opération laisserait une cible sans offre par défaut (ou en
    -- doublerait une) : on refuse AVANT d'écrire quoi que ce soit.
    raise exception 'target_uncovered' using errcode = 'P0001';
  end if;

  -- ── 3. Application — même transaction, aucune fenêtre sans défaut.
  update public.packages
     set is_default = false,
         updated_at = now()
   where is_default
     and id <> p_package_id
     and (
       (target_role in ('client', 'all')  and v_target in ('client', 'all'))
       or
       (target_role in ('cabinet', 'all') and v_target in ('cabinet', 'all'))
       or
       (target_role = 'collaboration'     and v_target = 'collaboration')
     );

  update public.packages
     set is_default = true,
         updated_at = now()
   where id = p_package_id;

  -- ── 4. Contrôle final sur l'état réel : ceinture et bretelles. Toute
  --       incohérence annule la transaction entière.
  select
    count(*) filter (where target_role in ('client', 'all')),
    count(*) filter (where target_role in ('cabinet', 'all')),
    count(*) filter (where target_role = 'collaboration')
    into v_client, v_cabinet, v_collab
  from public.packages
  where is_default and active;

  if v_client <> 1 or v_cabinet <> 1 or v_collab <> 1 then
    raise exception 'invariant_broken (client=%, cabinet=%, collaboration=%)',
      v_client, v_cabinet, v_collab using errcode = 'P0001';
  end if;
end;
$$;

comment on function public.set_default_package(uuid) is
  'Transfert atomique de l''offre par défaut. Garantit qu''à tout moment chaque '
  'cible (client, cabinet, collaboration) est couverte par exactement une offre '
  'par défaut active. ''all'' couvre client et cabinet, JAMAIS collaboration. '
  'Lève target_uncovered si l''opération laisserait une cible orpheline. '
  'Réservée au service_role.';

-- ── Droits : aucun rôle client ne doit pouvoir déplacer l'offre par défaut ───
revoke all on function public.set_default_package(uuid) from public;
revoke all on function public.set_default_package(uuid) from anon;
revoke all on function public.set_default_package(uuid) from authenticated;
grant execute on function public.set_default_package(uuid) to service_role;

-- ── b. L'offre collaboration seedée devient le défaut de SA cible ───────────
--    Écriture directe (pas via la RPC) : à cet instant la cible 'collaboration'
--    a ZÉRO défaut, état que la RPC refuse par construction puisqu'elle valide
--    l'invariant complet. C'est le seul geste d'amorçage, et il est borné par
--    le WHERE NOT EXISTS ci-dessous.
update public.packages p
   set is_default = true,
       updated_at = now()
 where p.domain_id is null
   and p.slug = 'collaboration'
   and p.target_role = 'collaboration'
   and p.active
   and not exists (
     select 1 from public.packages q
     where q.target_role = 'collaboration' and q.is_default and q.active
   );

-- ── c. Vérification : la base sort de cette migration conforme ──────────────
--    Si l'invariant n'est pas tenu, on ANNULE plutôt que de laisser une base
--    dans un état que l'applicatif refusera silencieusement ensuite.
do $$
declare
  v_client  integer;
  v_cabinet integer;
  v_collab  integer;
begin
  select
    count(*) filter (where target_role in ('client', 'all')),
    count(*) filter (where target_role in ('cabinet', 'all')),
    count(*) filter (where target_role = 'collaboration')
    into v_client, v_cabinet, v_collab
  from public.packages
  where is_default and active;

  if v_client <> 1 or v_cabinet <> 1 or v_collab <> 1 then
    raise exception
      'Invariant de couverture non tenu apres migration (client=%, cabinet=%, collaboration=%). '
      'Verifier que le seed 20260709000008 (offre collaboration) est bien applique.',
      v_client, v_cabinet, v_collab;
  end if;

  raise notice 'Couverture par defaut OK : client=1, cabinet=1, collaboration=1.';
end $$;

commit;
