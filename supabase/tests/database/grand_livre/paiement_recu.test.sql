-- paiement_recu — enregistrer_paiement() : la pièce comptable et sa ligne, ensemble ; le rejeu Stripe n'écrit rien.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(6);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_org     uuid := pg_temp.fab_organisation(pg_temp.fab_compte('entreprise'));
  v_facture text := 'in_sonde_' || replace(gen_random_uuid()::text, '-', '');
  v_p1      uuid := gen_random_uuid();
  v_p2      uuid := gen_random_uuid();
  v_tx      jsonb;
  v_id      uuid;
  v_id2     uuid;
begin
  v_tx := jsonb_build_object('organization_id', v_org, 'stripe_invoice_id', v_facture,
                             'amount', 12.5, 'amount_excl_tax', 12.5, 'tax_amount', 0, 'tax_status', 'none',
                             'currency', 'EUR', 'status', 'success', 'billing_period', 'one_time', 'livemode', false);
  v_id := public.enregistrer_paiement(v_p1, v_tx, 'evt_sonde_1');
  return next ok(v_id is not null and exists (select 1 from public.transactions t where t.id = v_id and t.stripe_invoice_id = v_facture),
                 'la pièce comptable est écrite');
  return next is(pg_temp.lignes(v_p1), 1::bigint, 'exactement UNE ligne sous la pièce du paiement');
  return next ok(exists (select 1 from public.grand_livre g where g.piece = v_p1 and g.type_action = 'paiement_recu'
                          and g.sujet_type = 'organizations' and g.sujet_id = v_org
                          and g.detail ->> 'transaction_id' = v_id::text and g.detail ->> 'stripe_event_id' = 'evt_sonde_1'),
                 'la ligne paiement_recu porte la transaction et l''événement, sujet l''organisation');
  -- LE REJEU STRIPE : même facture, autre pièce — rien.
  v_id2 := public.enregistrer_paiement(v_p2, v_tx, 'evt_sonde_2');
  return next ok(v_id2 is null, 'le rejeu de la même facture n''insère rien');
  return next is(pg_temp.lignes(v_p2), 0::bigint, 'le rejeu n''écrit aucune ligne');
  return next is((select count(*) from public.transactions t where t.stripe_invoice_id = v_facture), 1::bigint,
                 'une seule pièce comptable pour la facture');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
