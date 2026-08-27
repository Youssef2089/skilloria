-- ─────────────────────────────────────────────────────────────────────────────
-- NETTOYAGE DES ORGANISATIONS PERSONNELLES FANTÔMES
--
-- ⚠️⚠️ ORDRE D'EXÉCUTION — CETTE MIGRATION PASSE **APRÈS** LE DÉPLOIEMENT DU
--      CODE, jamais avant.
--
--      Tant que l'ancien code est en ligne, les écrans de collaboration
--      recréent une organisation personnelle à chaque ouverture. Exécutée
--      avant le déploiement, cette migration supprimerait des lignes que les
--      écrans recréeraient dans la minute : on aurait fait le ménage devant la
--      porte pendant que la pièce se remplit.
--
--      Séquence correcte :
--        1. déployer le code (commit « l'organisation personnelle naît à la
--           publication ») ;
--        2. PUIS `supabase db push` pour cette migration.
--
-- CONTEXTE
--   `ensure-org` était appelé au CHARGEMENT des écrans de sous-traitance, pas à
--   la publication. Tout expert vérifié ayant ouvert une fois l'entrée
--   « Sous-traitance » — par simple curiosité — repartait avec une organisation
--   personnelle, une ligne `organization_members` et un rattachement à l'offre
--   de collaboration par défaut, sans avoir rien publié ni même rien saisi.
--
--   Conséquences mesurées : l'écran /admin/collaboration comptait ces
--   organisations comme des « experts rattachés » à 0 publication, la
--   répartition par offre était faussée, et — le plus grave — sa lecture étant
--   plafonnée et triée par `created_at DESC`, les organisations RÉELLEMENT
--   actives finissaient par sortir de la liste.
--
-- CRITÈRE DE SUPPRESSION — VOLONTAIREMENT STRICT
--   On ne supprime QUE ce dont on est certain qu'il n'a JAMAIS rien porté :
--     (a) org_type = 'freelance'                      (organisation personnelle)
--     (b) AUCUNE publication, quel que soit son statut (brouillon inclus)
--     (c) AUCUN compteur d'usage consommé (`used > 0`)
--
--   (c) est un filet délibéré : une organisation qui a consommé un quota a
--   servi à quelque chose, même si sa publication a depuis été supprimée. Dans
--   le doute, on garde.
--
-- DÉPENDANCES — POURQUOI usage_counters EST SUPPRIMÉ EXPLICITEMENT
--   Ces tables référencent `organizations` en ON DELETE CASCADE et sont donc
--   emportées automatiquement : organization_domains, organization_invitations,
--   organization_members, publications, verification_attempts.
--
--   `usage_counters` NON. Sa colonne `organization_id` n'a AUCUNE clé étrangère
--   (cf. migration 20260709000002, lignes 14-20) : supprimer l'organisation y
--   laisserait des lignes orphelines que plus rien ne relierait à quoi que ce
--   soit — invisibles, et impossibles à rattacher plus tard. On les supprime
--   donc À LA MAIN, AVANT la ligne `organizations`.
--
-- IDEMPOTENCE : rejouable sans effet de bord. Un second passage ne trouve plus
--   rien à supprimer et affiche des compteurs à zéro.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_ghosts   uuid[];
  v_counters integer;
  v_orgs     integer;
  v_total    integer;
begin
  -- ── 1. Identifier les fantômes (une seule fois, réutilisé ensuite) ────────
  select coalesce(array_agg(o.id), '{}')
    into v_ghosts
    from public.organizations o
   where o.org_type = 'freelance'
     and not exists (
       select 1 from public.publications p where p.organization_id = o.id
     )
     and not exists (
       select 1 from public.usage_counters u
        where u.organization_id = o.id and u.used > 0
     );

  select count(*) into v_total
    from public.organizations where org_type = 'freelance';

  if array_length(v_ghosts, 1) is null then
    raise notice 'Nettoyage organisations fantomes : AUCUNE a supprimer (% organisations personnelles au total).', v_total;
    return;
  end if;

  -- ── 2. Compteurs d'usage à zéro : AUCUNE cascade ne les emporterait ──────
  delete from public.usage_counters
   where organization_id = any(v_ghosts);
  get diagnostics v_counters = row_count;

  -- ── 3. L'organisation. La CASCADE emporte members, domains, invitations,
  --       publications (il n'y en a aucune par construction) et
  --       verification_attempts.
  delete from public.organizations
   where id = any(v_ghosts);
  get diagnostics v_orgs = row_count;

  raise notice 'Nettoyage organisations fantomes : % organisations supprimees sur % personnelles, % lignes usage_counters associees.',
    v_orgs, v_total, v_counters;
end
$$;
