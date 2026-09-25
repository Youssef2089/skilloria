-- ════════════════════════════════════════════════════════════════════════════
--  UN PAIEMENT REÇU S'ÉCRIT AU GRAND LIVRE — LA PIÈCE COMPTABLE ET SA LIGNE
--  NAISSENT DANS LA MÊME TRANSACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. `lib/billing/events.ts` appelle
--  `enregistrer_paiement()` dès ce commit sur `invoice.paid` ; déployé avant,
--  chaque facture payée ferait échouer le webhook (Stripe rejouerait — sans
--  rien perdre, mais sans rien enregistrer). Rejouable.
--
--  ┌─ POURQUOI UNE RPC, ET PAS « JOURNAL APRÈS ÉCRITURE » ──────────────────┐
--  │ La pièce comptable est un `insert … on conflict do nothing` sur la     │
--  │ facture : un rejeu Stripe n'écrit rien. Si la ligne du grand livre     │
--  │ était écrite APRÈS, depuis le code, une panne du journal entre les     │
--  │ deux laisserait une transaction SANS ligne — et le rejeu, qui ne       │
--  │ réinsère pas, ne l'écrirait JAMAIS. Dans la même transaction SQL, une  │
--  │ panne du journal annule l'insertion ; Stripe rejoue ; les deux         │
--  │ naissent ensemble ou pas du tout (§D.26, motif « RPC métier +          │
--  │ journal »).                                                            │
--  └──────────────────────────────────────────────────────────────────────────┘
--
--  LE SUJET EST L'ORGANISATION DÉBITRICE — c'est son histoire qu'on relit —
--  et la transaction, la facture et l'événement Stripe sont dans le détail
--  (identifiants seulement). L'origine est `systeme` : l'événement vient de
--  Stripe, authentifié par signature ; aucun compte n'agit. L'écosystème de
--  la ligne est celui de la souscription quand il est connu (`domain_id`,
--  nul pour un renouvellement automatique — c'est le cas normal).
-- ─────────────────────────────────────────────────────────────────────────────


-- ── ① LA RPC MÉTIER ─────────────────────────────────────────────────────────
--  `p_transaction` porte les colonnes de `public.transactions` telles que le
--  webhook les construit ; `jsonb_populate_record` les typographie. La liste
--  des colonnes insérées est écrite UNE fois, ici — une colonne ajoutée à la
--  table n'est pas insérée par oubli, elle est absente par décision.
create or replace function public.enregistrer_paiement(
  p_piece            uuid,
  p_transaction      jsonb,
  p_stripe_event_id  text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_t  public.transactions;
  v_id uuid;
begin
  if p_piece is null then
    raise exception 'enregistrer_paiement : la piece est obligatoire' using errcode = 'GL002';
  end if;
  v_t := jsonb_populate_record(null::public.transactions, p_transaction);
  if v_t.organization_id is null or v_t.stripe_invoice_id is null then
    raise exception 'enregistrer_paiement : organisation et facture sont obligatoires' using errcode = '22023';
  end if;

  -- LA PIÈCE COMPTABLE. Idempotence par l'index unique sur la facture : un
  -- rejeu ne s'arbitre pas par une lecture, il se heurte à la base. Le
  -- prédicat est celui de l'index partiel — sans lui, Postgres ne l'infère pas.
  insert into public.transactions (
    organization_id, user_id, domain_id, package_id,
    stripe_invoice_id, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id,
    amount, amount_excl_tax, tax_amount, tax_status, currency,
    status, billing_period, period_start, period_end, invoice_url, livemode
  ) values (
    v_t.organization_id, v_t.user_id, v_t.domain_id, v_t.package_id,
    v_t.stripe_invoice_id, v_t.stripe_customer_id, v_t.stripe_subscription_id, v_t.stripe_payment_intent_id,
    v_t.amount, v_t.amount_excl_tax, v_t.tax_amount, v_t.tax_status, v_t.currency,
    v_t.status, v_t.billing_period, v_t.period_start, v_t.period_end, v_t.invoice_url, v_t.livemode
  )
  on conflict (stripe_invoice_id) where stripe_invoice_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    -- Rejeu Stripe : la pièce existe déjà, sa ligne aussi. Rien à écrire.
    return null;
  end if;

  perform public.journaliser(
    p_piece, 'paiement_recu', 'reussi', 'systeme',
    null::uuid, null::text, v_t.domain_id,
    'organizations', v_t.organization_id,
    jsonb_build_object(
      'transaction_id', v_id,
      'organization_id', v_t.organization_id,
      'package_id', v_t.package_id,
      'stripe_invoice_id', v_t.stripe_invoice_id,
      'stripe_event_id', p_stripe_event_id,
      'montant', v_t.amount,
      'montant_ht', v_t.amount_excl_tax,
      'taxe', v_t.tax_amount,
      'devise', v_t.currency,
      'periode', v_t.billing_period,
      'periode_debut', v_t.period_start,
      'periode_fin', v_t.period_end));
  return v_id;
end;
$fn$;
revoke all on function public.enregistrer_paiement(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.enregistrer_paiement(uuid, jsonb, text) to service_role;


-- ── ② LA LISTE BLANCHE DE `paiement_recu` ───────────────────────────────────
update public.grand_livre_actions
   set cles_detail = array[
     'transaction_id', 'organization_id', 'package_id',
     'stripe_invoice_id', 'stripe_event_id',
     'montant', 'montant_ht', 'taxe', 'devise',
     'periode', 'periode_debut', 'periode_fin'
   ]::text[]
 where code = 'paiement_recu';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles    text[];
  v_org     uuid;
  v_facture text := 'in_sonde_' || replace(gen_random_uuid()::text, '-', '');
  v_id      uuid;
  v_id2     uuid;
  v_lignes  integer;
begin
  if to_regprocedure('public.enregistrer_paiement(uuid, jsonb, text)') is null then
    raise exception 'postcondition NON TENUE : enregistrer_paiement(uuid, jsonb, text) manque ou a change de signature';
  end if;
  select cles_detail into v_cles from public.grand_livre_actions where code = 'paiement_recu';
  if v_cles is null or not (v_cles @> array['transaction_id', 'stripe_invoice_id', 'stripe_event_id', 'montant', 'devise', 'periode_fin']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de paiement_recu est incomplete [vu : %]', v_cles;
  end if;

  -- SONDE — la pièce et sa ligne naissent ensemble ; le doublon n'écrit rien.
  -- Il faut une organisation réelle (clé étrangère) : base vierge, sautée et dite.
  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then
    raise notice 'postcondition : sonde enregistrer_paiement SAUTEE — aucune organisation en base (base vierge)';
  else
    begin
      v_id := public.enregistrer_paiement(gen_random_uuid(),
        jsonb_build_object('organization_id', v_org, 'stripe_invoice_id', v_facture,
                           'amount', 12.5, 'amount_excl_tax', 12.5, 'tax_amount', 0, 'tax_status', 'none',
                           'currency', 'EUR', 'status', 'success', 'billing_period', 'one_time', 'livemode', false),
        'evt_sonde');
      if v_id is null then
        raise exception 'postcondition NON TENUE : enregistrer_paiement n a rien insere';
      end if;
      if not exists (select 1 from public.grand_livre
                      where type_action = 'paiement_recu' and statut = 'reussi' and origine = 'systeme'
                        and sujet_type = 'organizations' and sujet_id = v_org
                        and detail ->> 'transaction_id' = v_id::text and detail ->> 'stripe_event_id' = 'evt_sonde') then
        raise exception 'postcondition NON TENUE : la ligne paiement_recu manque ou ne porte pas la transaction';
      end if;
      -- LE DOUBLON : même facture, autre pièce — rien n'est inséré, rien n'est journalisé.
      v_id2 := public.enregistrer_paiement(gen_random_uuid(),
        jsonb_build_object('organization_id', v_org, 'stripe_invoice_id', v_facture,
                           'amount', 12.5, 'amount_excl_tax', 12.5, 'tax_amount', 0, 'tax_status', 'none',
                           'currency', 'EUR', 'status', 'success', 'billing_period', 'one_time', 'livemode', false),
        'evt_sonde_rejeu');
      select count(*) into v_lignes from public.grand_livre where type_action = 'paiement_recu' and detail ->> 'stripe_invoice_id' = v_facture;
      if v_id2 is not null or v_lignes <> 1 then
        raise exception 'postcondition NON TENUE : un rejeu a insere (%) ou journalise deux fois (% ligne(s))', v_id2, v_lignes;
      end if;
      -- LE PIÈGE QUE CETTE RPC FERME, ÉPROUVÉ SUR LE SCHÉMA RÉEL (§E.69) : sans
      -- le prédicat de l'index partiel, Postgres n'infère AUCUN index et lève
      -- 42P10 — c'est la forme que l'ancien `upsert` PostgREST envoyait.
      begin
        insert into public.transactions (organization_id, stripe_invoice_id, amount, tax_amount, tax_status, currency, status, livemode)
        values (v_org, 'in_sonde_sans_predicat_' || replace(gen_random_uuid()::text, '-', ''), 1, 0, 'none', 'EUR', 'success', false)
        on conflict (stripe_invoice_id) do nothing;
        raise exception 'postcondition NON TENUE : la forme SANS predicat est acceptee par ce schema — le piege §E.69 n est pas celui qui est ecrit';
      exception when sqlstate '42P10' then
        null;
      end;
      raise exception 'SONDE_ANNULEE';
    exception when others then
      if sqlerrm <> 'SONDE_ANNULEE' then
        raise;
      end if;
    end;
  end if;
  raise notice 'postcondition tenue : paiement_recu — la piece comptable et sa ligne naissent ensemble, le rejeu n ecrit rien';
end
$post$;
