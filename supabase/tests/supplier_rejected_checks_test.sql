-- Audit w2-s2 F2 and F3: a check delivered to a supplier that bounces puts
-- the debt back in the supplier's statement and aging, and a later payment
-- order settles it through "Imputar"; the purchase NCs with no origin are
-- netted in the per-document aging once, and the totals agree with it. One
-- transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(14);

-- Otras compras suppliers: the documents below are in the internal channel.
insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b141', false, null, 'Proveedor Rechazos', null),
  ('00000000-0000-0000-0000-00000000b142', false, null, 'Proveedor NC sin origen', null);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a141', 'Cartera rechazos proveedor', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-00000000a142', 'Banco rechazos proveedor', 'bank', 'ARS');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000014a1', 'jouve_internal', '00000000-0000-0000-0000-00000000b141',
   'factura', null, 1, 14101, current_date - 10, 100, 0, 100, 'received'),
  ('00000000-0000-0000-0000-0000000014a2', 'jouve_internal', '00000000-0000-0000-0000-00000000b142',
   'factura', null, 1, 14102, current_date - 10, 1000, 0, 1000, 'received');

-- An NC loaded with no origin (legacy rows; new ones need it).
alter table public.purchase_invoices disable trigger purchase_invoices_nc_nd_origin;
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000014a3', 'jouve_internal', '00000000-0000-0000-0000-00000000b142',
   'nc', null, 1, 14103, current_date - 5, 300, 0, 300, 'received');
alter table public.purchase_invoices enable trigger purchase_invoices_nc_nd_origin;

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, cartera_account_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000014c1', 'fisico', 'SRC-1', 'Banco X', 'Firmante', current_date, current_date, 100, 'ARS',
   'manual', '00000000-0000-0000-0000-00000000a141', 'jouve_internal');

-- Order 1 pays the factura with the endorsed check; the bank rejects it.
select public.create_payment_order(
  'jouve_internal', 1, 14111, '00000000-0000-0000-0000-00000000b141', current_date - 8, 100, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'endorse_check', 'endorsed_check_id', '00000000-0000-0000-0000-0000000014c1')),
  jsonb_build_array(jsonb_build_object(
    'purchase_invoice_id', '00000000-0000-0000-0000-0000000014a1', 'amount_applied', 100)));
-- Orders 2 and 3 pay a cuenta from the bank.
select public.create_payment_order(
  'jouve_internal', 1, 14112, '00000000-0000-0000-0000-00000000b141', current_date, 60, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-00000000a142', 'amount', 60)),
  '[]'::jsonb);
select public.create_payment_order(
  'jouve_internal', 1, 14113, '00000000-0000-0000-0000-00000000b141', current_date, 50, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-00000000a142', 'amount', 50)),
  '[]'::jsonb);

set constraints all immediate;
set constraints all deferred;

select public.reject_check('00000000-0000-0000-0000-0000000014c1', null, current_date - 2, null, null);

create temp table t_op on commit drop as
  select id, numero from public.payment_orders
   where channel_id = 'jouve_internal' and punto_venta = 1 and numero in (14111, 14112, 14113);

-- F2 -------------------------------------------------------------------------

select is(
  (select sum(signed_amount) from public.v_supplier_account_movements
    where supplier_id = '00000000-0000-0000-0000-00000000b141'
      and (source_type in ('purchase_invoice', 'rejected_check')
           or source_id = (select id from t_op where numero = 14111))),
  100::numeric,
  'the bounced check puts the debt back in the supplier statement'
);

select is(
  (select movement_date from public.v_supplier_account_movements
    where source_type = 'rejected_check' and source_id = '00000000-0000-0000-0000-0000000014c1'),
  current_date - 2,
  'dated on the rejection'
);

select is(
  (select open_amount from public.v_supplier_aging_documents
    where document_type = 'rejected_check' and document_id = '00000000-0000-0000-0000-0000000014c1'),
  100::numeric,
  'the bounced check is an open document of the supplier aging'
);

select is(
  (select ars_total_open from public.v_supplier_aging
    where supplier_id = '00000000-0000-0000-0000-00000000b141'),
  100::numeric,
  'and the aging total owes it'
);

select throws_ok(
  $$update public.payment_orders set status = 'canceled'
     where id = (select id from t_op where numero = 14111)$$,
  '55006',
  'No se puede anular la orden de pago: un cheque de terceros que endosó fue rechazado y la deuda ya volvió a la cuenta del proveedor. Pagala con una OP nueva e imputala al cheque rechazado.',
  'the order with the bounced check still cannot be cancelled, and says what to do'
);

select lives_ok(
  $$select public.allocate_payment_order(
      (select id from t_op where numero = 14112),
      jsonb_build_array(jsonb_build_object(
        'check_kind', 'endorsed', 'check_id', '00000000-0000-0000-0000-0000000014c1', 'amount_applied', 60)))$$,
  'a later order a cuenta is applied to the bounced check'
);

select is(
  (select open_amount from public.v_supplier_rejected_check_open
    where check_id = '00000000-0000-0000-0000-0000000014c1'),
  40::numeric,
  'what is left of the bounced check'
);

select is(
  (select count(*)::int from public.v_payment_order_unapplied
    where payment_order_id = (select id from t_op where numero = 14112)),
  0,
  'the order applied to the check holds nothing a cuenta'
);

select throws_ok(
  $$select public.allocate_payment_order(
      (select id from t_op where numero = 14113),
      jsonb_build_array(jsonb_build_object(
        'check_kind', 'endorsed', 'check_id', '00000000-0000-0000-0000-0000000014c1', 'amount_applied', 50)))$$,
  '23514',
  'La imputación excede el saldo abierto del cheque rechazado (50.00 > 40.00)',
  'an order cannot apply more than the check still owes'
);

select throws_ok(
  $$select public.update_payment_order(
      (select id from t_op where numero = 14112), current_date, 30, null,
      jsonb_build_array(jsonb_build_object(
        'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-00000000a142', 'amount', 30)),
      '[]'::jsonb)$$,
  '23514',
  'Lo imputado (0.00 a facturas y 60.00 a cheques rechazados) supera el total de la OP (30.00). Lo imputado a cheques rechazados se mantiene al editar.',
  'an edit cannot drop the order below what it applied to the check'
);

create temp table t_tasks on commit drop as
  select * from public.sync_automatic_tasks(current_date);

select is(
  (select count(*)::int from public.tasks
    where origin = 'automatic' and kind = 'supplier_payment'
      and source_id = '00000000-0000-0000-0000-0000000014a2'),
  1,
  'the task sync runs past the bounced check (it has no purchase invoice) and still tasks the invoices'
);

-- F3 -------------------------------------------------------------------------

select is(
  (select open_amount from public.v_supplier_aging_documents
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000014a2'),
  700::numeric,
  'the per-document aging nets the NC with no origin'
);

select is(
  (select amount_credited_unlinked from public.v_supplier_aging_documents
    where purchase_invoice_id = '00000000-0000-0000-0000-0000000014a2'),
  300::numeric,
  'and says how much it took'
);

select is(
  (select ars_total_open from public.v_supplier_aging
    where supplier_id = '00000000-0000-0000-0000-00000000b142'),
  700::numeric,
  'the aging total subtracts it once'
);

select * from finish();
rollback;
