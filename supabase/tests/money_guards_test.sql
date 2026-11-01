-- Money guards (audit 2026-10-31, ventas S2/S3/S5, compras S2/S3, S10, F1
-- pattern on edits): one open amount per document, kept >= 0; no
-- cross-currency allocations; NC/ND de compra with origin; edits by finance
-- replace the cash movements instead of piling them up. One transaction,
-- rolled back. Deferred guards are flushed with `set constraints all immediate`.

begin;

select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f7', 'finance@money-guards.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000f7', 'finance');

-- Every document below is internal, so are the counterparties
-- (guard_document_side).
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c701', false, null, 'Cliente Guardas', null);
insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b701', false, null, 'Proveedor Guardas', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a701', 'Caja Guardas', 'cash', 'ARS'),
  ('00000000-0000-0000-0000-00000000a702', 'Banco Guardas', 'bank', 'ARS');

-- Internal channel: no AFIP fields and no journal entries in the way.
insert into public.invoices
  (id, channel_id, client_id, kind, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_total, moneda, cotizacion, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000071a1', 'jouve_internal', '00000000-0000-0000-0000-00000000c701',
   'factura', 1, 7101, current_date, 2, 80, '20777777771', 1000, 1000, 'PES', 1, 'emitted', 'mg-fa'),
  ('00000000-0000-0000-0000-0000000071a2', 'jouve_internal', '00000000-0000-0000-0000-00000000c701',
   'factura', 1, 7102, current_date, 2, 80, '20777777771', 100, 100, 'DOL', 1000, 'emitted', 'mg-usd'),
  ('00000000-0000-0000-0000-0000000071a3', 'jouve_internal', '00000000-0000-0000-0000-00000000c701',
   'factura', 1, 7103, current_date, 2, 80, '20777777771', 500, 500, 'PES', 1, 'emitted', 'mg-fc');

insert into public.client_opening_balances (client_id, opening_date, target_balance, total_settled)
values ('00000000-0000-0000-0000-00000000c701', current_date, 0, 300);
insert into public.client_opening_balance_allocations (client_id, invoice_id, amount_applied)
values ('00000000-0000-0000-0000-00000000c701', '00000000-0000-0000-0000-0000000071a1', 300);

insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency) values
  ('00000000-0000-0000-0000-0000000072a1', 'jouve_internal', 1, 7201, '00000000-0000-0000-0000-00000000c701', current_date, 900, 'ARS');

-- Ventas S2: the opening balance counts against the open amount ---------------

select throws_ok(
  $$insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000072a1', '00000000-0000-0000-0000-0000000071a1', 800)$$,
  '23514',
  null,
  'a receipt cannot apply more than total − opening allocations'
);

select lives_ok(
  $$insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000072a1', '00000000-0000-0000-0000-0000000071a1', 700)$$,
  'a receipt applies up to the open amount'
);

-- Ventas S5: no cross-currency allocations ------------------------------------

select throws_ok(
  $$insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000072a1', '00000000-0000-0000-0000-0000000071a2', 50)$$,
  '23514',
  'El comprobante está en otra moneda que el recibo: un recibo solo cancela comprobantes de su misma moneda',
  'an ARS receipt cannot settle a USD invoice'
);

-- Flush the allocations above so each check below fires its own guard.
set constraints all immediate;
set constraints all deferred;

-- Ventas S2: an NC can't exceed its origin's open amount ----------------------

select throws_ok(
  $q$do $x$ begin
      insert into public.invoices
        (channel_id, client_id, kind, punto_venta, fecha, concepto, doc_tipo, doc_nro,
         imp_neto, imp_total, invoice_origin_id, motivo_nc_nd, status, idempotency_key)
      values ('jouve_internal', '00000000-0000-0000-0000-00000000c701', 'nc', 1, current_date, 2, 80,
         '20777777771', 10, 10, '00000000-0000-0000-0000-0000000071a1', 'Ajuste', 'draft', 'mg-nc-over');
      set constraints all immediate;
    end $x$ $q$,
  '23514',
  'La nota de crédito supera el saldo abierto del comprobante de origen',
  'an NC over a fully settled origin is refused at commit'
);

select lives_ok(
  $q$do $x$ begin
      insert into public.invoices
        (id, channel_id, client_id, kind, punto_venta, numero, fecha, concepto, doc_tipo, doc_nro,
         imp_neto, imp_total, invoice_origin_id, motivo_nc_nd, status, idempotency_key)
      values ('00000000-0000-0000-0000-0000000071c1', 'jouve_internal', '00000000-0000-0000-0000-00000000c701',
         'nc', 1, 7110, current_date, 2, 80, '20777777771', 200, 200,
         '00000000-0000-0000-0000-0000000071a3', 'Ajuste', 'draft', 'mg-nc-ok');
      set constraints all immediate;
    end $x$ $q$,
  'an NC within the open amount is accepted'
);

-- A receipt can't then take what the in-flight NC already reserved.
select throws_ok(
  $q$do $x$ begin
      insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
      values ('00000000-0000-0000-0000-0000000072a1', '00000000-0000-0000-0000-0000000071a3', 400);
      set constraints all immediate;
    end $x$ $q$,
  '23514',
  'La imputación deja el comprobante con más cobrado o acreditado que su total',
  'an allocation that overlaps a pending NC is refused at commit'
);

-- Ventas S3: no cancelling an invoice with NC/ND against it -------------------

select throws_ok(
  $$update public.invoices set status = 'cancelled'
     where id = '00000000-0000-0000-0000-0000000071a3'$$,
  '23514',
  'El comprobante tiene notas de crédito o débito emitidas. Anulá esas notas antes de anularlo.',
  'an invoice with an NC cannot be cancelled'
);

-- Compras ----------------------------------------------------------------------

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_total, moneda, cotizacion, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000073a1', 'jouve_internal', '00000000-0000-0000-0000-00000000b701',
   'factura', 1, 7301, current_date - 100, 1000, 1000, 'PES', 1, 'received', null),
  ('00000000-0000-0000-0000-0000000073a2', 'jouve_internal', '00000000-0000-0000-0000-00000000b701',
   'factura', 1, 7302, current_date, 500, 500, 'PES', 1, 'received', null),
  ('00000000-0000-0000-0000-0000000073a3', 'jouve_internal', '00000000-0000-0000-0000-00000000b701',
   'nc', 1, 7303, current_date, 400, 400, 'PES', 1, 'received', '00000000-0000-0000-0000-0000000073a2');

insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency, cotizacion) values
  ('00000000-0000-0000-0000-0000000074a1', 'jouve_internal', 1, 7401, '00000000-0000-0000-0000-00000000b701', current_date, 1000, 'ARS', null),
  ('00000000-0000-0000-0000-0000000074a2', 'jouve_internal', 1, 7402, '00000000-0000-0000-0000-00000000b701', current_date, 10, 'USD', 1000);

select throws_ok(
  $$insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000074a1', '00000000-0000-0000-0000-0000000073a2', 200)$$,
  '23514',
  null,
  'an OP cannot pay what the NC already credited (open = 500 − 400)'
);

select throws_ok(
  $$insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000074a2', '00000000-0000-0000-0000-0000000073a1', 5)$$,
  '23514',
  'La factura está en otra moneda que la orden de pago: una OP solo cancela facturas de su misma moneda',
  'a USD OP cannot settle an ARS purchase'
);

select lives_ok(
  $$insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-0000000074a1', '00000000-0000-0000-0000-0000000073a1', 100)$$,
  'an OP pays within the open amount'
);

select throws_ok(
  $$update public.purchase_invoices set status = 'cancelled', cancelled_at = now()
     where id = '00000000-0000-0000-0000-0000000073a1'$$,
  '23514',
  'La factura tiene órdenes de pago imputadas. Anulá esas órdenes antes de anularla.',
  'a purchase with OP allocations cannot be cancelled'
);

select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_total, status)
    values ('jouve_internal', '00000000-0000-0000-0000-00000000b701', 'nc', 1, 7304, current_date, 10, 10, 'received')$$,
  '23514',
  'Una nota de crédito o débito de compra necesita el comprobante de origen',
  'a new purchase NC needs its origin'
);

select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_total, moneda, cotizacion, status)
    values ('jouve_internal', '00000000-0000-0000-0000-00000000b701', 'factura', 1, 7305, current_date, 10, 10, 'DOL', 1, 'received')$$,
  '23514',
  'Cargá la cotización del dólar (tiene que ser mayor a 1)',
  'a new dollar purchase needs a cotización > 1'
);

-- Compras S3: an old NC without origin nets the supplier's aging, oldest first.
alter table public.purchase_invoices disable trigger purchase_invoices_nc_nd_origin;
insert into public.purchase_invoices
  (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_total, status)
values ('jouve_internal', '00000000-0000-0000-0000-00000000b701', 'nc', 1, 7306, current_date, 950, 950, 'received');
alter table public.purchase_invoices enable trigger purchase_invoices_nc_nd_origin;

select results_eq(
  $$select ars_bucket_90_plus, ars_bucket_0_30, ars_total_open
      from public.v_supplier_aging where supplier_id = '00000000-0000-0000-0000-00000000b701'$$,
  -- 90+: 1000 − 100 paid = 900 → 0; 0-30: 500 − 400 NC = 100 → 50.
  $$values (0::numeric, 50::numeric, 50::numeric)$$,
  'the unlinked NC is applied to the oldest bucket first'
);

-- Edits by finance replace the cash movements (SECURITY DEFINER) ---------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f7","role":"authenticated"}', true);

select public.update_receipt(
  '00000000-0000-0000-0000-0000000072a1', current_date, 900, 'editado',
  '[{"account_id":"00000000-0000-0000-0000-00000000a702","amount":900}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-0000000071a1","amount_applied":700}]'::jsonb,
  '[]'::jsonb
);
select public.update_receipt(
  '00000000-0000-0000-0000-0000000072a1', current_date, 900, 'editado otra vez',
  '[{"account_id":"00000000-0000-0000-0000-00000000a701","amount":900}]'::jsonb,
  '[{"invoice_id":"00000000-0000-0000-0000-0000000071a1","amount_applied":700}]'::jsonb,
  '[]'::jsonb
);

select results_eq(
  $$select account_id, amount from public.transactions
     where receipt_id = '00000000-0000-0000-0000-0000000072a1'$$,
  $$values ('00000000-0000-0000-0000-00000000a701'::uuid, 900::numeric(18,2))$$,
  'editing a receipt as finance leaves exactly the new movement'
);

select public.update_payment_order(
  '00000000-0000-0000-0000-0000000074a1', current_date, 1000, 'editada',
  '[{"line_kind":"account","account_id":"00000000-0000-0000-0000-00000000a702","amount":1000}]'::jsonb,
  '[]'::jsonb
);
select public.update_payment_order(
  '00000000-0000-0000-0000-0000000074a1', current_date, 1000, 'editada otra vez',
  '[{"line_kind":"account","account_id":"00000000-0000-0000-0000-00000000a701","amount":1000}]'::jsonb,
  '[]'::jsonb
);

select results_eq(
  $$select account_id, amount from public.transactions
     where payment_order_id = '00000000-0000-0000-0000-0000000074a1'$$,
  $$values ('00000000-0000-0000-0000-00000000a701'::uuid, 1000::numeric(18,2))$$,
  'editing an OP as finance leaves exactly the new movement'
);

-- Compras S10: paying an installment is claimed once ----------------------------

reset role;
insert into public.loans (id, description, principal, currency, channel_id, installments_count, first_due_date)
values ('00000000-0000-0000-0000-0000000075a1', 'Préstamo guardas', 1000, 'ARS', 'jouve_internal', 1, current_date);
insert into public.loan_installments (id, loan_id, number, due_date, amount)
values ('00000000-0000-0000-0000-0000000075b1', '00000000-0000-0000-0000-0000000075a1', 1, current_date, 1000);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f7","role":"authenticated"}', true);

select lives_ok(
  $$select public.pay_loan_installment('00000000-0000-0000-0000-0000000075b1', current_date,
      '00000000-0000-0000-0000-00000000a701', 1000)$$,
  'finance pays a pending installment'
);

select throws_ok(
  $$select public.pay_loan_installment('00000000-0000-0000-0000-0000000075b1', current_date,
      '00000000-0000-0000-0000-00000000a701', 1000)$$,
  '23514',
  'La cuota no existe o ya está pagada',
  'a second payment of the same installment is refused'
);

reset role;

select results_eq(
  $$select (select count(*)::int from public.transactions t
             join public.loan_installments li on li.transaction_id = t.id
            where li.loan_id = '00000000-0000-0000-0000-0000000075a1'),
           (select status::text from public.loans where id = '00000000-0000-0000-0000-0000000075a1')$$,
  $$values (1, 'paid')$$,
  'one outflow, and the loan closes after its last installment'
);

select * from finish();

rollback;
