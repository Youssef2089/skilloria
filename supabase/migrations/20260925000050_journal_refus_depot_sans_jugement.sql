-- ════════════════════════════════════════════════════════════════════════════
--  UN DÉPÔT SANS JUGEMENT EST UN REFUS, ET IL S'ÉCRIT — AVEC LE JOURNAL DU
--  DÉPÔT SOLDÉ EN ÉCHEC, DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `lib/candidatures/depot.ts`
--  appelle `solder_depot_en_echec()` dès ce commit. Rejouable.
--
--  Le jugement n'a pas abouti (plafond, modèle indisponible, réponse
--  illisible) ou la base a refusé l'écriture : AUCUNE candidature n'existe
--  (§D.19), la ligne du dépôt passe en échec — l'écran des dépôts en échec la
--  montre, un administrateur la relance — et le grand livre porte le REFUS,
--  au statut `refuse` que la base impose à toute action de cette famille.
--  Le sujet est la ligne du dépôt ; l'acteur et l'origine sont ceux du geste
--  (l'expert, ou l'administrateur qui relance — avec sa pièce d'origine).
--  Le détail porte la CAUSE (une des trois valeurs fermées) et le rang de la
--  tentative — jamais le texte de la panne, qui reste dans `candidature_depots.detail`.
-- ─────────────────────────────────────────────────────────────────────────────


create or replace function public.solder_depot_en_echec(
  p_piece           uuid,
  p_piece_origine   uuid,
  p_origine         text,
  p_acteur_id       uuid,
  p_acteur_type     text,
  p_publication_id  uuid,
  p_profile_id      uuid,
  p_cause           text,
  p_detail          text
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_id         uuid;
  v_tentatives integer;
  v_domaine    uuid;
begin
  if p_piece is null then
    raise exception 'solder_depot_en_echec : la piece est obligatoire' using errcode = 'GL002';
  end if;

  update public.candidature_depots d
     set etat       = 'echec',
         cause      = p_cause,
         -- Une phrase de journal, jamais le texte produit : une panne n'a pas de contenu.
         detail     = p_detail,
         termine_at = now()
   where d.publication_id = p_publication_id and d.profile_id = p_profile_id
  returning d.id, d.tentatives, d.domain_id into v_id, v_tentatives, v_domaine;

  -- Le journal du dépôt peut ne pas avoir été ouvert (son ouverture est
  -- best-effort, cf. le dépôt) : le refus s'écrit quand même, sans sujet.
  perform public.journaliser(
    p_piece, 'refus_depot_sans_jugement', 'refuse', p_origine,
    p_acteur_id, p_acteur_type, v_domaine,
    case when v_id is null then null else 'candidature_depots' end, v_id,
    jsonb_build_object(
      'publication_id', p_publication_id,
      'profile_id', p_profile_id,
      'cause', p_cause,
      'tentative', v_tentatives),
    p_piece_origine, null::numeric, null::text);

  return v_id is not null;
end;
$fn$;

revoke all on function public.solder_depot_en_echec(uuid, uuid, text, uuid, text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.solder_depot_en_echec(uuid, uuid, text, uuid, text, uuid, uuid, text, text)
  to service_role;


update public.grand_livre_actions
   set cles_detail = array['publication_id', 'profile_id', 'cause', 'tentative']::text[]
 where code = 'refus_depot_sans_jugement';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles    text[];
  v_pub     uuid;
  v_prof    uuid;
  v_domaine uuid;
  v_piece   uuid := gen_random_uuid();
  v_solde   boolean;
  v_id      uuid;
begin
  if to_regprocedure('public.solder_depot_en_echec(uuid, uuid, text, uuid, text, uuid, uuid, text, text)') is null then
    raise exception 'postcondition NON TENUE : solder_depot_en_echec manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'refus_depot_sans_jugement';
  if v_cles is null or not (v_cles @> array['publication_id', 'profile_id', 'cause', 'tentative']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de refus_depot_sans_jugement est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — un statut autre que `refuse` est REFUSÉ par la base pour cette action (GL003).
  begin
    perform public.journaliser(gen_random_uuid(), 'refus_depot_sans_jugement', 'reussi', 'systeme',
                               null::uuid, null::text, null::uuid, null::text, null::uuid,
                               '{"cause":"plafond"}'::jsonb, null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : refus_depot_sans_jugement accepte le statut reussi';
  exception when sqlstate 'GL003' then
    null;
  end;
  -- SONDE — sur un couple mis en relation et libre : ouverture, solde en échec, ligne relue. Base vierge : sautée, et dite.
  select m.publication_id, m.profile_id, p.domain_id
    into v_pub, v_prof, v_domaine
    from public.matches m
    join public.profiles p on p.id = m.profile_id
   where not exists (select 1 from public.candidatures c where c.publication_id = m.publication_id and c.profile_id = m.profile_id)
     and not exists (select 1 from public.candidature_depots d where d.publication_id = m.publication_id and d.profile_id = m.profile_id)
   limit 1;
  if v_pub is null then
    raise notice 'postcondition : sonde solder_depot_en_echec SAUTEE — aucun couple libre en base (base vierge)';
  else
    begin
      perform public.ouvrir_depot_candidature(v_pub, v_prof, v_domaine, 'sonde', v_piece);
      v_solde := public.solder_depot_en_echec(v_piece, null::uuid, 'systeme', null::uuid, null::text,
                                              v_pub, v_prof, 'plafond', 'sonde : panne simulee');
      select d.id into v_id from public.candidature_depots d where d.publication_id = v_pub and d.profile_id = v_prof and d.etat = 'echec' and d.cause = 'plafond';
      if v_solde is distinct from true or v_id is null then
        raise exception 'postcondition NON TENUE : le journal du depot n est pas solde en echec';
      end if;
      if not exists (select 1 from public.grand_livre g
                      where g.piece = v_piece and g.type_action = 'refus_depot_sans_jugement' and g.statut = 'refuse'
                        and g.sujet_type = 'candidature_depots' and g.sujet_id = v_id
                        and g.detail ->> 'cause' = 'plafond' and g.detail ->> 'tentative' = '1') then
        raise exception 'postcondition NON TENUE : la ligne refus_depot_sans_jugement manque ou ne porte pas sa cause';
      end if;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  raise notice 'postcondition tenue : refus_depot_sans_jugement — le journal du depot et le refus naissent ensemble';
end
$post$;
