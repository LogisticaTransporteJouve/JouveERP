-- Diferencia de cambio on USD settlements (20261104094300): a USD factura
-- booked at one rate and collected by a USD receipt at another leaves
-- clientes at 0 in pesos, with the difference in diferencia_cambio; the
-- same for a USD purchase and its payment order. The entry is the
-- document's own: re-posting changes nothing, cancelling reverses it, a later
-- allocation re-posts it, and a closed period refuses that. Deferred
-- triggers run at `set constraints all immediate`. One transaction, rolled
-- back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(21);

-- The fixtures insert receipt and payment-order headers by hand; in the app only
-- create_receipt / create_payment_order do (guard_document_insert).
-- Disabled before any write, while no trigger event is pending.
alter table public.receipts disable trigger receipts_guard_insert_rpc;
alter table public.payment_orders disable trigger payment_orders_guard_insert_rpc;

-- Live (not reversed) amount of a role over the entries of some documents.
create function pg_temp.role_net(p_ids uuid[], p_role text) returns numeric
language sql as $$
  select coalesce(sum(l.debit - l.credit), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
    join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
   where je.source_id = any (p_ids)
     and c.system_role::text = p_role;
$$;

create function pg_temp.live_side(p_source text, p_id uuid, p_role text, p_side text)
returns numeric
language sql as $$
  select coalesce(sum(case when p_side = 'debit' then l.debit else l.credit end), 0)
    from public.journal_entries je
    join public.journal_entry_lines l on l.journal_entry_id = je.id
    join public.chart_of_accounts c on c.id = l.chart_of_accounts_id
   where je.source_table = p_source and je.source_id = p_id and not je.is_reversal
     and not exists (select 1 from public.journal_entries r where r.reversed_entry_id = je.id)
     and c.system_role::text = p_role;
$$;

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000096c1', '20966666662', 'Cliente Diferencia', 'responsable_inscripto');
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000096b1', '30966666663', 'Proveedor Diferencia', 'responsable_inscripto');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000096a1', 'Banco USD Diferencia', 'bank', 'USD');

select is(
  (select count(*)::int from public.chart_of_accounts
    where system_role = 'diferencia_cambio' and is_active),
  1,
  'one active result account holds diferencia_cambio'
);

-- Factura USD 1.210 (1.000 + IVA 210) at 1.000; factura USD 100 at 1.000.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000096e1', 'jouve_fiscal', '00000000-0000-0000-0000-0000000096c1',
   'factura', 'A', 3, 96001, current_date, 2, 80, '20966666662', 1000, 210, 1210, 'DOL', 1000, 1, 1,
   'emitted', 'fx-difference-1'),
  ('00000000-0000-0000-0000-0000000096e2', 'jouve_fiscal', '00000000-0000-0000-0000-0000000096c1',
   'factura', 'A', 3, 96002, current_date, 2, 80, '20966666662', 100, 0, 100, 'DOL', 1000, 1, 1,
   'emitted', 'fx-difference-2');

-- Receipt USD 1.210 at 1.100 that collects the first factura whole.
insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency, cotizacion)
values ('00000000-0000-0000-0000-0000000096d1', 'jouve_fiscal', 3, 96001,
        '00000000-0000-0000-0000-0000000096c1', current_date, 1210, 'USD', 1100);
-- The receipt was inserted by hand above, so its lines are too: only
-- create_receipt / update_receipt write them (guard_document_line).
alter table public.receipt_payment_lines disable trigger receipt_payment_lines_guard_rpc;
insert into public.receipt_payment_lines (receipt_id, account_id, amount)
values ('00000000-0000-0000-0000-0000000096d1', '00000000-0000-0000-0000-0000000096a1', 1210);
alter table public.receipt_payment_lines enable trigger receipt_payment_lines_guard_rpc;
insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
values ('00000000-0000-0000-0000-0000000096d1', '00000000-0000-0000-0000-0000000096e1', 1210);

select lives_ok('set constraints all immediate', 'the factura and the receipt post');

select is(
  pg_temp.live_side('receipts', '00000000-0000-0000-0000-0000000096d1', 'banco', 'debit'),
  1331000::numeric,
  'the bank takes the dollars at the receipt rate'
);

select is(
  pg_temp.live_side('receipts', '00000000-0000-0000-0000-0000000096d1', 'clientes', 'credit'),
  1210000::numeric,
  'clientes is credited at the rate the factura was booked at'
);

select is(
  pg_temp.live_side('receipts', '00000000-0000-0000-0000-0000000096d1', 'diferencia_cambio', 'credit'),
  121000::numeric,
  'the difference is a gain in diferencia_cambio'
);

select is(
  pg_temp.role_net(array['00000000-0000-0000-0000-0000000096e1', '00000000-0000-0000-0000-0000000096d1']::uuid[], 'clientes'),
  0::numeric,
  'clientes ends at 0 in pesos for the collected factura'
);

select is(
  public.journal_entry_status('receipts', '00000000-0000-0000-0000-0000000096d1'),
  'match',
  'the posted entry is the one the builder expects, so a re-post changes nothing'
);

select lives_ok(
  $$select public.repost_journal('receipts', '00000000-0000-0000-0000-0000000096d1')$$,
  'an explicit re-post runs'
);

select is(
  (select count(*)::int from public.journal_entries
    where source_table = 'receipts' and source_id = '00000000-0000-0000-0000-0000000096d1'),
  1,
  'and keeps the single entry'
);

update public.receipts set status = 'canceled'
 where id = '00000000-0000-0000-0000-0000000096d1';

select is(
  pg_temp.role_net(array['00000000-0000-0000-0000-0000000096d1']::uuid[], 'diferencia_cambio'),
  0::numeric,
  'cancelling the receipt reverses its difference'
);

select is(
  pg_temp.role_net(array['00000000-0000-0000-0000-0000000096e1', '00000000-0000-0000-0000-0000000096d1']::uuid[], 'clientes'),
  1210000::numeric,
  'and the factura is owed again at its own rate'
);

-- A cuenta at 900, applied later to the second factura (booked at 1.000).
-- Back to deferred: the header posts once its lines exist.
set constraints all deferred;
insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency, cotizacion)
values ('00000000-0000-0000-0000-0000000096d2', 'jouve_fiscal', 3, 96002,
        '00000000-0000-0000-0000-0000000096c1', current_date, 100, 'USD', 900);
-- The receipt was inserted by hand above, so its lines are too: only
-- create_receipt / update_receipt write them (guard_document_line).
alter table public.receipt_payment_lines disable trigger receipt_payment_lines_guard_rpc;
insert into public.receipt_payment_lines (receipt_id, account_id, amount)
values ('00000000-0000-0000-0000-0000000096d2', '00000000-0000-0000-0000-0000000096a1', 100);
alter table public.receipt_payment_lines enable trigger receipt_payment_lines_guard_rpc;
set constraints all immediate;

insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
values ('00000000-0000-0000-0000-0000000096d2', '00000000-0000-0000-0000-0000000096e2', 100);
set constraints all immediate;

select results_eq(
  $$select pg_temp.live_side('receipts', '00000000-0000-0000-0000-0000000096d2', 'clientes', 'credit'),
           pg_temp.live_side('receipts', '00000000-0000-0000-0000-0000000096d2', 'diferencia_cambio', 'debit')$$,
  $$values (100000::numeric, 10000::numeric)$$,
  'applying a USD receipt later re-posts it with the difference (a loss)'
);

-- A cuenta in a period that is then closed: applying it would change a
-- closed entry, so the database refuses.
set constraints all deferred;
insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency, cotizacion)
values ('00000000-0000-0000-0000-0000000096d3', 'jouve_fiscal', 3, 96003,
        '00000000-0000-0000-0000-0000000096c1', '1999-01-15', 50, 'USD', 900);
-- The receipt was inserted by hand above, so its lines are too: only
-- create_receipt / update_receipt write them (guard_document_line).
alter table public.receipt_payment_lines disable trigger receipt_payment_lines_guard_rpc;
insert into public.receipt_payment_lines (receipt_id, account_id, amount)
values ('00000000-0000-0000-0000-0000000096d3', '00000000-0000-0000-0000-0000000096a1', 50);
alter table public.receipt_payment_lines enable trigger receipt_payment_lines_guard_rpc;
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000096e3', 'jouve_fiscal', '00000000-0000-0000-0000-0000000096c1',
   'factura', 'A', 3, 96003, current_date, 2, 80, '20966666662', 50, 0, 50, 'DOL', 1000, 1, 1,
   'emitted', 'fx-difference-3');
set constraints all immediate;
insert into public.accounting_closed_periods (period) values ('1999-01');

select throws_ok(
  $$insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
      values ('00000000-0000-0000-0000-0000000096d3', '00000000-0000-0000-0000-0000000096e3', 50)$$,
  '55006',
  'El período contable 1999-01 está cerrado y no admite movimientos',
  'a later allocation that changes an entry of a closed period is refused'
);

-- Payment order USD 1.000 at 1.100 paying a purchase booked at 1.000.
set constraints all deferred;
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva,
   imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000096f1', 'jouve_fiscal', '00000000-0000-0000-0000-0000000096b1',
   'factura', 'A', 7, 96001, current_date, 1000, 0, 1000, 'DOL', 1000, 'received');
insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency, cotizacion)
values ('00000000-0000-0000-0000-0000000096f9', 'jouve_fiscal', 3, 96001,
        '00000000-0000-0000-0000-0000000096b1', current_date, 1000, 'USD', 1100);
-- The payment order was inserted by hand above, so its lines are too: only
-- create_payment_order / update_payment_order write them (guard_document_line).
alter table public.payment_order_payment_lines disable trigger payment_order_payment_lines_guard_rpc;
insert into public.payment_order_payment_lines (payment_order_id, account_id, amount)
values ('00000000-0000-0000-0000-0000000096f9', '00000000-0000-0000-0000-0000000096a1', 1000);
alter table public.payment_order_payment_lines enable trigger payment_order_payment_lines_guard_rpc;
insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
values ('00000000-0000-0000-0000-0000000096f9', '00000000-0000-0000-0000-0000000096f1', 1000);
set constraints all immediate;

select is(
  pg_temp.live_side('payment_orders', '00000000-0000-0000-0000-0000000096f9', 'banco', 'credit'),
  1100000::numeric,
  'the bank pays the dollars at the payment order rate'
);

select is(
  pg_temp.live_side('payment_orders', '00000000-0000-0000-0000-0000000096f9', 'diferencia_cambio', 'debit'),
  100000::numeric,
  'paying more pesos than booked is a loss in diferencia_cambio'
);

select is(
  pg_temp.role_net(array['00000000-0000-0000-0000-0000000096f1', '00000000-0000-0000-0000-0000000096f9']::uuid[], 'proveedores'),
  0::numeric,
  'proveedores ends at 0 in pesos for the paid purchase'
);

select is(
  public.journal_entry_status('payment_orders', '00000000-0000-0000-0000-0000000096f9'),
  'match',
  'the payment order entry is the one the builder expects'
);

-- A USD payment order posted while no account held the role keeps the old
-- entry in a period that is then closed. Editing its purchase without
-- touching rate, currency or date (the form sends all three) must not try
-- to re-post it.
update public.chart_of_accounts set is_active = false
 where system_role = 'diferencia_cambio' and is_active;
set constraints all deferred;
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva,
   imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000096f2', 'jouve_fiscal', '00000000-0000-0000-0000-0000000096b1',
   'factura', 'A', 7, 96002, '1999-02-10', 100, 0, 100, 'DOL', 1000, 'received');
insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency, cotizacion)
values ('00000000-0000-0000-0000-0000000096f8', 'jouve_fiscal', 3, 96002,
        '00000000-0000-0000-0000-0000000096b1', '1999-02-10', 100, 'USD', 1100);
-- The payment order was inserted by hand above, so its lines are too: only
-- create_payment_order / update_payment_order write them (guard_document_line).
alter table public.payment_order_payment_lines disable trigger payment_order_payment_lines_guard_rpc;
insert into public.payment_order_payment_lines (payment_order_id, account_id, amount)
values ('00000000-0000-0000-0000-0000000096f8', '00000000-0000-0000-0000-0000000096a1', 100);
alter table public.payment_order_payment_lines enable trigger payment_order_payment_lines_guard_rpc;
insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
values ('00000000-0000-0000-0000-0000000096f8', '00000000-0000-0000-0000-0000000096f2', 100);
set constraints all immediate;
update public.chart_of_accounts set is_active = true
 where system_role = 'diferencia_cambio';
insert into public.accounting_closed_periods (period) values ('1999-02');

select lives_ok(
  $$update public.purchase_invoices
       set notes = 'nota', fecha = fecha, moneda = moneda, cotizacion = cotizacion
     where id = '00000000-0000-0000-0000-0000000096f2'$$,
  'an edit that keeps rate, currency and date does not re-post the payment orders'
);

-- NC USD 121 (100 + IVA 21) at 1.200 against a factura USD 121 booked at
-- 1.000: ventas and IVA are reversed at the NC's rate, clientes at the
-- factura's, and the 24.200 between them is a gain.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000096e4', 'jouve_fiscal', '00000000-0000-0000-0000-0000000096c1',
   'factura', 'A', 3, 96004, current_date, 2, 80, '20966666662', 100, 21, 121, 'DOL', 1000, 1, 1,
   'emitted', 'fx-difference-4');
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000096ec', 'jouve_fiscal', '00000000-0000-0000-0000-0000000096c1',
   'nc', 'A', 3, 96005, current_date, 2, 80, '20966666662', 100, 21, 121, 'DOL', 1200, 3, 1,
   'emitted', 'fx-difference-nc', '00000000-0000-0000-0000-0000000096e4');
set constraints all immediate;

select results_eq(
  $$select pg_temp.live_side('invoices', '00000000-0000-0000-0000-0000000096ec', 'ventas', 'debit'),
           pg_temp.live_side('invoices', '00000000-0000-0000-0000-0000000096ec', 'iva_debito', 'debit'),
           pg_temp.live_side('invoices', '00000000-0000-0000-0000-0000000096ec', 'clientes', 'credit'),
           pg_temp.live_side('invoices', '00000000-0000-0000-0000-0000000096ec', 'diferencia_cambio', 'credit')$$,
  $$values (120000::numeric, 25200::numeric, 121000::numeric, 24200::numeric)$$,
  'an NC reverses ventas and IVA at its rate and clientes at the origin''s'
);

select is(
  pg_temp.role_net(array['00000000-0000-0000-0000-0000000096e4', '00000000-0000-0000-0000-0000000096ec']::uuid[], 'clientes'),
  0::numeric,
  'clientes ends at 0 in pesos for the credited factura'
);

select is(
  public.journal_entry_status('invoices', '00000000-0000-0000-0000-0000000096ec'),
  'match',
  'the NC entry is the one the builder expects'
);

select * from finish();

rollback;
