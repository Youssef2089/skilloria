-- ════════════════════════════════════════════════════════════════════════════
--  UNE ANNONCE CLÔTURÉE S'ÉCRIT AU GRAND LIVRE — LA TRANSITION ET LA LIGNE,
--  DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `app/api/publications/[id]/close`
--  appelle `cloturer_annonce()` dès ce commit. Rejouable.
--
--  Même forme que `decliner_candidature()` : la transition (`published` →
--  `archived`), le cloisonnement (écosystème) et la propriété (organisation)
--  sont REJOUÉS dans l'UPDATE ; zéro ligne touchée rend false, et la route
--  répond 409 au lieu d'un 200 muet (§E.27). La clôture par l'organisation
--  est la seule dépublication VOLONTAIRE ; l'expiration est un constat,
--  écrit par `annonce_expiree`.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cloturer_annonce(
  p_piece            uuid,
  p_piece_origine    uuid,
  p_origine          text,
  p_acteur_id        uuid,
  p_acteur_type      text,
  p_publication_id   uuid,
  p_domain_id        uuid,
  p_organization_id  uuid,
  p_statuts_admis    text[]
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_de text;
  v_n  integer;
begin
  if p_piece is null then
    raise exception 'cloturer_annonce : la piece est obligatoire' using errcode = 'GL002';
  end if;

  -- LE STATUT D'ORIGINE, LU SOUS VERROU : c'est lui que la ligne porte. Les
  -- statuts admis viennent de la ROUTE — cette fonction ne porte aucun
  -- littéral de statut, et ne décide donc de rien sur le statut seul (le
  -- contrôle d'expiration y veille : la visibilité passe par annonce_active()).
  select p.status into v_de
    from public.publications p
   where p.id = p_publication_id
     and p.domain_id = p_domain_id
     and p.organization_id = p_organization_id
   for update;
  if not found or not (v_de = any (p_statuts_admis)) then
    return false;
  end if;

  update public.publications p
     set status = 'archived'
   where p.id = p_publication_id
     and p.domain_id = p_domain_id
     and p.organization_id = p_organization_id
     and p.status = v_de;
  get diagnostics v_n = row_count;
  -- La ligne est verrouillée et son statut vient d'être relu : zéro ligne n'est pas
  -- un rejeu (celui-ci rend false plus haut), c'est une anomalie — elle se nomme.
  perform public.exiger_ecriture(v_n, 'cloturer_annonce : publications');

  perform public.journaliser(
    p_piece, 'annonce_depubliee', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, p_domain_id,
    'publications', p_publication_id,
    jsonb_build_object('de', v_de, 'vers', 'archived', 'organization_id', p_organization_id),
    p_piece_origine, null::numeric, null::text);
  return true;
end;
$fn$;

revoke all on function public.cloturer_annonce(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.cloturer_annonce(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[])
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['de', 'vers', 'organization_id']::text[]
 where code = 'annonce_depubliee';


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- LA STRUCTURE, ICI ; LE COMPORTEMENT, PAR LES TESTS (CLAUDE.md §G.4 ter, docs/pieges.md §E.77).
-- La sonde qui clôturait une vraie annonce publiée est retirée (28/09/2026). Le geste — clôture et ligne
-- ensemble, autre organisation refusée, rejeu false, de/vers dans la ligne — est prouvé par
-- supabase/tests/database/grand_livre/annonce_depubliee.test.sql (et vrai_appelant/appelant.test.sql en service_role).
declare
  v_cles text[];
begin
  if to_regprocedure('public.cloturer_annonce(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[])') is null then
    raise exception 'postcondition NON TENUE : cloturer_annonce manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'annonce_depubliee';
  if v_cles is null or not (v_cles @> array['de', 'vers', 'organization_id']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de annonce_depubliee est incomplete [vu : %]', v_cles;
  end if;
  begin
    perform public.journaliser(gen_random_uuid(), 'annonce_depubliee', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"de":"published","vers":"archived","reason":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans annonce_depubliee';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : annonce_depubliee — signature par types, liste blanche, texte libre refuse ; le geste est prouve par tests/database/grand_livre/annonce_depubliee.test.sql';
end
$post$;
