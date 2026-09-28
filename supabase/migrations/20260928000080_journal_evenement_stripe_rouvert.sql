-- ════════════════════════════════════════════════════════════════════════════
--  UN ÉVÉNEMENT STRIPE ROUVERT À LA MAIN S'ÉCRIT AU GRAND LIVRE — LA
--  RÉOUVERTURE ET SA LIGNE DANS UNE SEULE FONCTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/admin/facturation` (POST)
--  appelle `rouvrir_evenement_stripe` dès ce commit. Ajoute : une action, une
--  fonction. Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.1) : un administrateur qui rouvre un
--  événement de paiement COINCÉ (resté `received` au-delà du plafond de durée du
--  webhook) le fait passer `failed`, pour que Stripe le relivre — un geste
--  d'ARGENT, tracé par l'audit seul.
--
--  LA FONCTION : la garde est DANS le `WHERE` (§E.31) — la ligne est encore
--  `received`, et depuis avant la limite ; lire puis écrire laisserait rouvrir un
--  événement que le processus d'origine vient de clore. Zéro ligne : 'non_coince'
--  (déjà clos, ou trop récent), rien n'est écrit. Une ligne : réouverture + ligne,
--  même transaction. Le MOTIF (exigé par la route, texte libre) va dans
--  `stripe_events.error` et dans l'audit — JAMAIS au grand livre, qui ne porte que
--  des identifiants (§D.26).
--
--  LE SUJET : `stripe_events.id` est un texte (l'identifiant Stripe), le sujet du
--  grand livre un uuid. Il est DÉRIVÉ : `identifiant_derive('stripe_event', id)` —
--  le même dériveur que les réglages, stable, recalculable depuis le détail, qui
--  porte l'identifiant Stripe lui-même. Écosystème : aucun (le commerce vit sur
--  l'organisation, qui en rejoint plusieurs). Famille `commerce`.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('evenement_stripe_rouvert',   'commerce',       null,     'journal.actions.evenement_stripe_rouvert')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['stripe_event_id', 'type_evenement', 'recu_le', 'organization_id']::text[]
 where code = 'evenement_stripe_rouvert';


create or replace function public.rouvrir_evenement_stripe(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_evenement_id  text,
  p_motif         text,
  p_limite        timestamptz
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_e record;
begin
  update public.stripe_events e
     set status = 'failed',
         error  = 'rouvert manuellement — ' || p_motif
   where e.id = p_evenement_id
     and e.status = 'received'
     and e.received_at < p_limite
  returning e.id, e.type, e.received_at, e.organization_id into v_e;
  if not found then
    return jsonb_build_object('issue', 'non_coince');
  end if;
  perform public.journaliser(
    p_piece, 'evenement_stripe_rouvert', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, null::uuid,
    'stripe_events', public.identifiant_derive('stripe_event', v_e.id),
    jsonb_build_object('stripe_event_id', v_e.id, 'type_evenement', v_e.type,
                       'recu_le', v_e.received_at, 'organization_id', v_e.organization_id),
    p_piece_origine, null::numeric, null::text);
  return jsonb_build_object('issue', 'rouvert', 'type', v_e.type, 'recu_le', v_e.received_at);
end;
$fn$;

revoke all on function public.rouvrir_evenement_stripe(uuid, uuid, text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.rouvrir_evenement_stripe(uuid, uuid, text, uuid, text, text, text, timestamptz) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'evenement_stripe_rouvert';
  if not found then
    raise exception 'postcondition NON TENUE : evenement_stripe_rouvert absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'commerce' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['stripe_event_id', 'type_evenement', 'recu_le', 'organization_id']::text[] then
    raise exception 'postcondition NON TENUE : evenement_stripe_rouvert [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  if to_regprocedure('public.rouvrir_evenement_stripe(uuid, uuid, text, uuid, text, text, text, timestamptz)') is null then
    raise exception 'postcondition NON TENUE : rouvrir_evenement_stripe absente';
  end if;
  if has_function_privilege('authenticated', 'public.rouvrir_evenement_stripe(uuid, uuid, text, uuid, text, text, text, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.rouvrir_evenement_stripe(uuid, uuid, text, uuid, text, text, text, timestamptz)', 'execute') then
    raise exception 'postcondition NON TENUE : rouvrir_evenement_stripe executable depuis le navigateur';
  end if;
  raise notice 'postcondition tenue : evenement_stripe_rouvert dans la liste fermee (famille commerce), rouvrir_evenement_stripe presente et fermee au navigateur ; la reouverture, le refus d un evenement non coince et l absence du motif au grand livre sont prouves par tests/database/grand_livre/evenement_stripe_rouvert.test.sql';
end
$post$;
