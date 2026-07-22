-- ─────────────────────────────────────────────────────────────────────────────
-- Catalogue commerce — CIBLE 'all' + DEDUPLICATION des offres client/cabinet.
--
-- CONTEXTE
--   Le seed Lot 1 (20260709000001_commerce_seed.sql) duplique chaque offre
--   (free, business, elite) sur les DEUX cibles 'client' et 'cabinet' : 6 lignes
--   pour 3 offres reelles. L'admin voit donc chaque offre en double et doit
--   editer deux fois le meme prix.
--
--   Exigence : une offre applicable aux clients ET aux cabinets = UNE SEULE
--   ligne, portant target_role = 'all'. Objectif final : 3 offres.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. Garde : refuse de tourner si des lignes portent encore une cible expert_*
--      (le nouveau CHECK ne les accepte plus — on echoue AVANT de toucher aux
--      donnees plutot que de casser silencieusement).
--   2. Elargit le CHECK packages.target_role a ('client','cabinet','all').
--   3. Deduplique : pour chaque (domain_id, slug) dont les lignes 'client' et
--      'cabinet' sont IDENTIQUES (memes prix/devise/scope/sieges ET memes
--      package_features), conserve la ligne 'client' -> target_role = 'all',
--      repointe tous les rattachements du doublon vers elle, puis supprime le
--      doublon.
--   4. Normalise le defaut : chaque cible doit rester couverte par exactement
--      une offre par defaut active (une inscription DOIT recevoir une offre).
--
-- REPOINTAGE — les 4 tables qui referencent packages(id) :
--     organization_domains.package_id  (FK ON DELETE SET NULL)  -> repointee
--     package_history.package_id       (FK ON DELETE CASCADE)   -> repointee
--     transactions.package_id          (FK SANS ON DELETE)      -> repointee
--     package_features.package_id      (FK ON DELETE CASCADE)   -> supprimees
--   transactions est repointee AVANT le DELETE : sa FK n'a pas de ON DELETE,
--   la suppression du doublon leverait sinon une violation de cle etrangere.
--   Les tables _backup_*_20260422 sont des instantanes geles : NON touchees.
--
-- IDEMPOTENCE
--   Chaque etape est gardee par un test d'existence. Rejouee, la migration ne
--   trouve plus de paire client/cabinet et ne fait rien. Aucune donnee metier
--   (organisations, transactions, historique) n'est perdue : uniquement
--   repointee.
--
-- SECURITE
--   Les offres dont les deux cibles DIFFERENT (prix ou limites divergents) sont
--   volontairement laissees en place : les fusionner changerait les droits
--   d'organisations rattachees. Elles restent editables une par une au
--   back-office, et l'admin peut creer une offre 'all' de remplacement puis
--   migrer les organisations (migration de masse).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. GARDE — cibles expert_* encore utilisees ?
--    Le CHECK cible ('client','cabinet','all') les exclut. On echoue tot, avec
--    un message actionnable, plutot que de laisser l'ALTER echouer sur une
--    contrainte violee au milieu de la migration.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_legacy integer;
begin
  select count(*) into v_legacy
  from public.packages
  where target_role in ('expert_freelance', 'expert_cdi');

  if v_legacy > 0 then
    raise exception
      'Migration interrompue : % package(s) portent encore une cible expert_freelance/expert_cdi. '
      'Le catalogue commerce ne cible que les organisations (client/cabinet/all). '
      'Reaffectez ou desactivez ces lignes avant de rejouer.', v_legacy;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CHECK target_role — ajout de 'all', retrait des cibles expert_*.
--    Garde d'idempotence : on ne retouche pas la contrainte si elle accepte
--    deja 'all'.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.packages'::regclass
      and conname  = 'packages_target_role_check'
      and pg_get_constraintdef(oid) like '%all%'
  ) then
    alter table public.packages
      drop constraint if exists packages_target_role_check;

    alter table public.packages
      add constraint packages_target_role_check
      check (target_role::text = any (array['client', 'cabinet', 'all']::text[]));

    raise notice 'packages_target_role_check : cible ''all'' autorisee.';
  else
    raise notice 'packages_target_role_check : deja a jour, rien a faire.';
  end if;
end $$;

comment on column public.packages.target_role is
  'Cible commerciale de l''offre : client | cabinet | all. '
  '''all'' = offre unique applicable aux deux types d''organisation (une seule ligne, jamais un doublon).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DEDUPLICATION client + cabinet -> une ligne 'all'.
--
--    Test d'identite (strict) : meme nom, meme description, memes prix, meme
--    devise, meme scope, memes sieges max, ET jeu de package_features
--    rigoureusement identique (code, valeur, periode de reset).
--    NB : is_default et active NE font PAS partie du test — ce sont des etats
--    de pilotage, pas la definition commerciale de l'offre. Ils sont fusionnes
--    explicitement plus bas (OR logique : la ligne 'all' herite du statut le
--    plus permissif, puisqu'elle couvre desormais les deux cibles).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  r            record;
  v_merged     integer := 0;
  v_orgs       integer;
  v_orgs_total integer := 0;
begin
  for r in
    with feats as (
      -- Signature ordonnee des limites de chaque package.
      select
        pf.package_id,
        array_agg(
          pf.feature_code || '=' || pf.value || '/' || coalesce(pf.reset_period, '-')
          order by pf.feature_code
        ) as signature
      from public.package_features pf
      group by pf.package_id
    )
    select
      c.id            as keeper_id,
      k.id            as dup_id,
      c.slug          as slug,
      (c.is_default or k.is_default) as merged_default,
      (c.active      or k.active)    as merged_active
    from public.packages c
    join public.packages k
      on  k.domain_id is not distinct from c.domain_id
      and k.slug        = c.slug
      and k.target_role = 'cabinet'
    left join feats fc on fc.package_id = c.id
    left join feats fk on fk.package_id = k.id
    where c.target_role = 'client'
      -- Definition commerciale strictement identique des deux cotes.
      and k.name          is not distinct from c.name
      and k.description   is not distinct from c.description
      and k.price_monthly is not distinct from c.price_monthly
      and k.price_yearly  is not distinct from c.price_yearly
      and k.currency      is not distinct from c.currency
      and k.scope         is not distinct from c.scope
      and k.max_seats     is not distinct from c.max_seats
      and coalesce(fk.signature, '{}') = coalesce(fc.signature, '{}')
  loop
    -- (a) Rattachements d'organisations : repointes vers la ligne conservee.
    update public.organization_domains
       set package_id = r.keeper_id
     where package_id = r.dup_id;
    get diagnostics v_orgs = row_count;
    v_orgs_total := v_orgs_total + v_orgs;

    -- (b) Historique : conserve, rattache a la ligne survivante (sinon perdu
    --     par le CASCADE au DELETE).
    update public.package_history
       set package_id = r.keeper_id
     where package_id = r.dup_id;

    -- (c) Transactions : FK SANS ON DELETE -> repointage OBLIGATOIRE avant le
    --     DELETE, sous peine de violation de cle etrangere.
    update public.transactions
       set package_id = r.keeper_id
     where package_id = r.dup_id;

    -- (d) Limites du doublon puis le doublon lui-meme.
    delete from public.package_features where package_id = r.dup_id;
    delete from public.packages         where id         = r.dup_id;

    -- (e) La ligne conservee devient l'offre unique couvrant les deux cibles.
    update public.packages
       set target_role = 'all',
           is_default  = r.merged_default,
           active      = r.merged_active,
           updated_at  = now()
     where id = r.keeper_id;

    v_merged := v_merged + 1;
    raise notice 'Offre "%" fusionnee en cible ''all'' (% organisation(s) repointee(s)).', r.slug, v_orgs;
  end loop;

  if v_merged = 0 then
    raise notice 'Deduplication : aucune paire client/cabinet identique — rien a fusionner.';
  else
    raise notice 'Deduplication : % offre(s) fusionnee(s), % organisation(s) repointee(s).', v_merged, v_orgs_total;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. NORMALISATION DU DEFAUT — invariant de couverture.
--
--    Regle systeme : chaque cible (client, cabinet) doit etre couverte a tout
--    moment par exactement UNE offre par defaut ACTIVE, via sa ligne specifique
--    OU via une ligne 'all'. Sans cela, une inscription ne recevrait aucune
--    offre.
--
--    Cas nominal (catalogue issu du seed) : free est passee en 'all' avec
--    is_default = true -> les deux cibles sont couvertes, on ne touche a rien.
--    Cas degrade (defauts multiples ou cible orpheline apres fusion) : on
--    retombe sur free comme unique defaut, en le signalant.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_client  integer;
  v_cabinet integer;
  v_free    uuid;
begin
  select count(*) into v_client
  from public.packages
  where is_default and active and target_role in ('client', 'all');

  select count(*) into v_cabinet
  from public.packages
  where is_default and active and target_role in ('cabinet', 'all');

  if v_client = 1 and v_cabinet = 1 then
    raise notice 'Defaut : couverture correcte (client=1, cabinet=1).';
  else
    raise notice 'Defaut : couverture incorrecte (client=%, cabinet=%) — normalisation sur l''offre free.',
      v_client, v_cabinet;

    -- Offre free du catalogue global, priorite a la ligne 'all'.
    select id into v_free
    from public.packages
    where domain_id is null
      and slug = 'free'
      and target_role in ('client', 'cabinet', 'all')
    order by case target_role when 'all' then 0 else 1 end, created_at
    limit 1;

    if v_free is null then
      raise exception
        'Impossible de garantir une offre par defaut : aucune offre "free" au catalogue. '
        'Creez une offre par defaut au back-office avant de continuer.';
    end if;

    update public.packages set is_default = false, updated_at = now()
     where is_default and id <> v_free;

    update public.packages set is_default = true, active = true, updated_at = now()
     where id = v_free;

    raise notice 'Defaut : offre free (%) definie comme unique offre par defaut active.', v_free;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CONTROLE FINAL — echoue la transaction si l'invariant n'est pas tenu.
--    Une migration qui laisserait une cible sans offre par defaut casserait les
--    inscriptions : on prefere ne rien commiter.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_client  integer;
  v_cabinet integer;
begin
  select count(*) into v_client
  from public.packages
  where is_default and active and target_role in ('client', 'all');

  select count(*) into v_cabinet
  from public.packages
  where is_default and active and target_role in ('cabinet', 'all');

  if v_client <> 1 or v_cabinet <> 1 then
    raise exception
      'Invariant de couverture non tenu apres migration (client=%, cabinet=%). Transaction annulee.',
      v_client, v_cabinet;
  end if;

  raise notice 'Controle final OK — chaque cible est couverte par exactement une offre par defaut active.';
end $$;

commit;
