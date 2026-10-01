-- ════════════════════════════════════════════════════════════════════════════
--  LE REFUS DES ACTIONS RETIRÉES (GL006) — LE SECOND TEMPS (ARRÊT 22 bis, 01/10/2026, §D.26, §D.33, §E.72).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : APRÈS le déploiement du lot qui a cessé d'écrire les onze actions retirées
--  (`grand_livre_liste_validee` et le code qui l'accompagne). JAMAIS dans le même déploiement : tant que ce code n'est
--  pas en ligne, l'ancien les écrit encore, et ce refus ferait échouer un message, une étape de recherche, un refus de
--  dépôt. Une valeur que le code en ligne écrit encore ne s'interdit qu'au déploiement suivant (décision de Youssef).
--  Horodatage : postérieur à toutes les migrations de la recette S1 et à `journal_photo_et_cv` — elle part après elles.
--
--  CE QUE CETTE MIGRATION FAIT, ET SEULEMENT CELA : `journaliser()` redéfinie à signature IDENTIQUE ; une action
--  marquée `retiree_le` est refusée, nommée (GL006) — un appelant oublié lève au lieu d'écrire en silence.
--  Rien n'est créé ni retiré d'autre.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── journaliser() : une action retirée est refusée, nommée (GL006) ──
create or replace function public.journaliser(
  p_piece          uuid,
  p_type_action    text,
  p_statut         text,
  p_origine        text,
  p_acteur_id      uuid    default null,
  p_acteur_type    text    default null,
  p_ecosysteme_id  uuid    default null,
  p_sujet_type     text    default null,
  p_sujet_id       uuid    default null,
  p_detail         jsonb   default '{}'::jsonb,
  p_piece_origine  uuid    default null,
  p_cout_usd       numeric default null,
  p_unite_facturee text    default null
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_impose text;
  v_retiree timestamptz;
  v_cles   text[];
  v_hors   text[];
  v_detail jsonb;
  v_id     bigint;
begin
  if p_piece is null then
    raise exception 'journaliser : la piece est obligatoire — une ecriture sans piece ne se relie a rien'
      using errcode = 'GL002';
  end if;
  if p_type_action is null then
    raise exception 'journaliser : le type d action est obligatoire'
      using errcode = 'GL002';
  end if;

  select statut_impose, cles_detail, retiree_le into v_impose, v_cles, v_retiree
    from public.grand_livre_actions
   where code = p_type_action;
  if not found then
    raise exception 'journaliser : type d action inconnu « % » — la liste est FERMEE (grand_livre_actions) et s etend par migration', p_type_action
      using errcode = 'GL003';
  end if;
  -- UNE ACTION RETIRÉE NE S'ÉCRIT PLUS (décision de Youssef, 01/10/2026) : ses lignes passées restent, la liste
  -- fermée la garde comme clé, mais plus aucun geste ne l'écrit — un appelant oublié lève, nommé.
  if v_retiree is not null then
    raise exception 'journaliser : « % » est RETIREE du grand livre depuis le % — elle ne s ecrit plus', p_type_action, v_retiree
      using errcode = 'GL006';
  end if;
  if v_impose is not null and p_statut is distinct from v_impose then
    raise exception 'journaliser : « % » impose le statut « % », recu « % »', p_type_action, v_impose, p_statut
      using errcode = 'GL003';
  end if;

  -- PREMIÈRE BARRIÈRE — la liste blanche de l'action. Toute clé hors liste
  -- est refusée et NOMMÉE ; une clé personnelle nouvelle n'a aucune chance
  -- d'y figurer.
  v_detail := coalesce(p_detail, '{}'::jsonb);
  select array_agg(c order by c) into v_hors
    from public.grand_livre_chemins(v_detail) as c
   where c <> all (v_cles);
  if v_hors is not null then
    raise exception 'journaliser : « % » n accepte pas les cles % — liste blanche : %', p_type_action, v_hors, v_cles
      using errcode = 'GL004';
  end if;
  -- SECONDE BARRIÈRE — la liste noire commune au journal d'audit. Elle ne
  -- décide plus de rien ici (une clé personnelle n'est jamais dans une liste
  -- blanche) ; elle reste, parce qu'une barrière qui coûte zéro se garde.
  v_detail := public.audit_logs_detail_sans_pii(v_detail);

  begin
    insert into public.grand_livre
      (piece, piece_origine, type_action, statut, origine,
       acteur_id, acteur_type, ecosysteme_id, sujet_type, sujet_id,
       detail, cout_usd, unite_facturee)
    values
      (p_piece, p_piece_origine, p_type_action, p_statut, p_origine,
       p_acteur_id, p_acteur_type, p_ecosysteme_id, p_sujet_type, p_sujet_id,
       v_detail, p_cout_usd, p_unite_facturee)
    returning id into v_id;
  exception when unique_violation then
    -- UNE FOIS. La seconde écriture du même geste pour la même action sur le
    -- même sujet est un défaut de l'appelant, jamais une ligne de plus.
    raise exception 'journaliser : « % » deja ecrite pour la piece % (sujet %) — une action s ecrit UNE fois par geste', p_type_action, p_piece, p_sujet_id
      using errcode = 'GL005';
  end;

  return v_id;
end;
$fn$;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if strpos((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.journaliser(uuid, text, text, text, uuid, text, uuid, text, uuid, jsonb, uuid, numeric, text)')), 'GL006') = 0 then
    raise exception 'postcondition NON TENUE : journaliser ne refuse pas une action retiree';
  end if;
  if (select count(*) from public.grand_livre_actions where retiree_le is not null) <> 11 then
    raise exception 'postcondition NON TENUE : onze actions retirees attendues';
  end if;
  raise notice 'postcondition tenue : journaliser refuse les onze actions retirees ; le refus est prouve par tests/database/grand_livre/liste_validee.test.sql';
end
$post$;
