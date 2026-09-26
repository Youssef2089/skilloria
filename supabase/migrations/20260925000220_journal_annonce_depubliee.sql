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
  if v_n = 0 then
    return false;
  end if;

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


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_sautee boolean := false;  -- une sonde sautée rend la ligne finale PARTIELLE (§E.67)
  v_cles   text[];
  v_pub    record;
  v_piece  uuid := gen_random_uuid();
  v_ok     boolean;
  v_ok2    boolean;
  v_lignes integer;
begin
  if to_regprocedure('public.cloturer_annonce(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[])') is null then
    raise exception 'postcondition NON TENUE : cloturer_annonce manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'annonce_depubliee';
  if v_cles is null or not (v_cles @> array['de', 'vers', 'organization_id']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de annonce_depubliee est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — une annonce publiée réelle : clôturée, ligne relue ; rejouée, false,
  -- aucune seconde ligne. Sans annonce publiée : sautée, et dite.
  select p.id, p.domain_id, p.organization_id into v_pub
    from public.publications p
   where p.status = 'published' and p.organization_id is not null
   limit 1;
  if v_pub.id is null then
    raise notice 'postcondition : sonde cloturer_annonce SAUTEE — aucune annonce publiee (base vierge)';
    v_sautee := true;
  else
    begin
      v_ok := public.cloturer_annonce(v_piece, null::uuid, 'systeme', null::uuid, null::text,
                                      v_pub.id, v_pub.domain_id, v_pub.organization_id, array['published']);
      if v_ok is distinct from true then
        raise exception 'postcondition NON TENUE : la cloture n a pas abouti';
      end if;
      if not exists (select 1 from public.publications p where p.id = v_pub.id and p.status = 'archived') then
        raise exception 'postcondition NON TENUE : la transition n est pas relue';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'annonce_depubliee' and g.statut = 'reussi'
                        and g.sujet_type = 'publications' and g.sujet_id = v_pub.id
                        and g.ecosysteme_id = v_pub.domain_id
                        and g.detail ->> 'de' = 'published' and g.detail ->> 'vers' = 'archived') then
        raise exception 'postcondition NON TENUE : la ligne annonce_depubliee manque ou ne porte pas son detail';
      end if;
      -- LE REJEU : false, aucune seconde ligne.
      v_ok2 := public.cloturer_annonce(gen_random_uuid(), null::uuid, 'systeme', null::uuid, null::text,
                                       v_pub.id, v_pub.domain_id, v_pub.organization_id, array['published']);
      select count(*) into v_lignes from public.grand_livre g where g.type_action = 'annonce_depubliee' and g.sujet_id = v_pub.id;
      if v_ok2 is distinct from false or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : le rejeu a cloture ou journalise une seconde fois [% / % ligne(s)]', v_ok2, v_lignes;
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  -- SONDE — un texte libre est REFUSÉ (la liste blanche tient).
  begin
    perform public.journaliser(gen_random_uuid(), 'annonce_depubliee', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, 'publications', gen_random_uuid(),
                               '{"de":"published","vers":"archived","reason":"texte libre"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : un texte libre est entre dans annonce_depubliee';
  exception when sqlstate 'GL004' then
    null;
  end;
  if v_sautee then
    raise notice 'postcondition PARTIELLE — une sonde SAUTEE faute de donnees, la fonction du geste n a PAS tourne ici ; seul le reste est verifie : annonce_depubliee — transition et ligne naissent ensemble, le rejeu est false, texte libre refuse';
  else
    raise notice 'postcondition tenue : annonce_depubliee — transition et ligne naissent ensemble, le rejeu est false, texte libre refuse';
  end if;
end
$post$;
