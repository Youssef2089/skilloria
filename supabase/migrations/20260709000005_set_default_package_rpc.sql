-- ─────────────────────────────────────────────────────────────────────────────
-- RPC set_default_package — TRANSFERT ATOMIQUE de l'offre par défaut.
--
-- POURQUOI
--   Côté applicatif (lib/package-default.ts) le transfert s'exécute en DEUX
--   updates successifs : retrait des anciens défauts, puis pose du nouveau. Le
--   client Supabase JS ne sait pas ouvrir de transaction multi-requêtes, il
--   existe donc une fenêtre de quelques millisecondes où une cible n'a AUCUNE
--   offre par défaut — une inscription tombant pile dedans ne recevrait pas
--   d'offre. Cette fonction ferme la fenêtre : tout se joue dans une seule
--   transaction serveur.
--
-- INVARIANT DE COUVERTURE (identique à lib/package-default.ts, qui reste la
-- source de vérité pour la prévisualisation côté UI) :
--   Chaque cible (client, cabinet) doit être couverte À TOUT MOMENT par
--   EXACTEMENT UNE offre par défaut ACTIVE — via sa ligne spécifique OU via une
--   ligne 'all' (offre unique couvrant les deux cibles).
--     - Désigner une offre 'all'      → absorbe les défauts des DEUX cibles.
--     - Désigner une offre spécifique → ne retire que la couverture de SA cible ;
--       si la ligne retirée était une 'all', l'autre cible deviendrait orpheline
--       → raise exception 'target_uncovered'.
--
-- CONTRAT
--   - package inexistant       → exception 'package_not_found'
--   - package inactif          → exception 'package_inactive'
--   - package déjà par défaut  → NO-OP silencieux (pas d'erreur)
--   - couverture rompue        → exception 'target_uncovered'
--   - incohérence post-état    → exception 'invariant_broken' (transaction annulée)
--
-- SÉCURITÉ
--   SECURITY DEFINER + search_path figé à public (aucune résolution de nom
--   détournable). Exécution réservée au service_role : les routes admin sont
--   déjà gardées par requireAdmin, aucun rôle client ne doit pouvoir déplacer
--   l'offre par défaut de la plateforme.
--
-- CE QUE LA FONCTION NE FAIT PAS
--   Ni snapshot package_history, ni audit : ils restent côté route (app/api/
--   admin/set-default-package + create-package), qui seules connaissent
--   l'utilisateur à l'origine du geste.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Un défaut DOIT être actif, sinon les nouvelles inscriptions seraient
  -- rattachées à une offre retirée de la vente.
  if not v_active then
    raise exception 'package_inactive' using errcode = 'P0001';
  end if;

  -- ── 2. Couverture RÉSULTANTE, calculée AVANT toute écriture.
  --       Une ligne est retirée si elle couvre une cible que la nouvelle offre
  --       couvre désormais ; les autres défauts sont conservés.
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
      (d.target_role in ('client', 'all') and v_target in ('client', 'all'))
      or
      (d.target_role in ('cabinet', 'all') and v_target in ('cabinet', 'all'))
    )
  ),
  resulting as (
    select target_role from kept
    union all
    select v_target
  )
  select
    count(*) filter (where target_role in ('client', 'all')),
    count(*) filter (where target_role in ('cabinet', 'all'))
    into v_client, v_cabinet
  from resulting;

  if v_client <> 1 or v_cabinet <> 1 then
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
     );

  update public.packages
     set is_default = true,
         updated_at = now()
   where id = p_package_id;

  -- ── 4. Contrôle final sur l'état réel : ceinture et bretelles. Toute
  --       incohérence annule la transaction entière.
  select
    count(*) filter (where target_role in ('client', 'all')),
    count(*) filter (where target_role in ('cabinet', 'all'))
    into v_client, v_cabinet
  from public.packages
  where is_default and active;

  if v_client <> 1 or v_cabinet <> 1 then
    raise exception 'invariant_broken (client=%, cabinet=%)', v_client, v_cabinet
      using errcode = 'P0001';
  end if;
end;
$$;

comment on function public.set_default_package(uuid) is
  'Transfert atomique de l''offre par défaut. Garantit qu''à tout moment chaque '
  'cible (client, cabinet) est couverte par exactement une offre par défaut active, '
  'via sa ligne spécifique ou une ligne ''all''. Lève target_uncovered si '
  'l''opération laisserait une cible orpheline. Réservée au service_role.';

-- ── Droits : aucun rôle client ne doit pouvoir déplacer l'offre par défaut ───
revoke all on function public.set_default_package(uuid) from public;
revoke all on function public.set_default_package(uuid) from anon;
revoke all on function public.set_default_package(uuid) from authenticated;
grant execute on function public.set_default_package(uuid) to service_role;
