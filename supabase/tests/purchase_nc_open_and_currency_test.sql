-- Audit w17 (20261105140000): a purchase NC larger than what its origin still
-- has open is refused on insert, not only on edit; an NC/ND is in its
-- origin's currency, and an origin with received notes keeps its currency.
-- One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(12);

insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001714b1', false, null, 'Proveedor NC w17', null);

-- F1 ARS 100, F2 ARS 500, F3 USD 1.000.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, punto_venta, numero, fecha,
   imp_neto, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000001714f1', 'jouve_internal', '00000000-0000-0000-0000-0000001714b1',
   'factura', 1, 171401, current_date, 100, 100, 'PES', 1, 'received'),
  ('00000000-0000-0000-0000-0000001714f2', 'jouve_internal', '00000000-0000-0000-0000-0000001714b1',
   'factura', 1, 171402, current_date, 500, 500, 'PES', 1, 'received'),
  ('00000000-0000-0000-0000-0000001714f3', 'jouve_internal', '00000000-0000-0000-0000-0000001714b1',
   'factura', 1, 171403, current_date, 1000, 1000, 'DOL', 1000, 'received');

-- Deferred guards run at the end of each statement from here on.
set constraints all immediate;

-- Open amount on insert ----------------------------------------------------------

select lives_ok(
  $$insert into public.purchase_invoices
      (id, channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_total,
       status, invoice_origin_id)
    values ('00000000-0000-0000-0000-0000001714a1', 'jouve_internal',
            '00000000-0000-0000-0000-0000001714b1', 'nc', 1, 171411, current_date, 80, 80,
            'received', '00000000-0000-0000-0000-0000001714f1')$$,
  'an NC within its origin''s open amount is loaded'
);

select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_total,
       status, invoice_origin_id)
    values ('jouve_internal', '00000000-0000-0000-0000-0000001714b1', 'nc', 1, 171412,
            current_date, 30, 30, 'received', '00000000-0000-0000-0000-0000001714f1')$$,
  '23514',
  'La edición deja un comprobante con más pagado o acreditado que su total',
  'a new NC larger than what its origin still has open is refused'
);

select lives_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_total,
       status, invoice_origin_id)
    values ('jouve_internal', '00000000-0000-0000-0000-0000001714b1', 'nc', 1, 171413,
            current_date, 20, 20, 'received', '00000000-0000-0000-0000-0000001714f1')$$,
  'an NC for exactly what is open is loaded'
);

select is(
  (select open_amount from public.v_purchase_invoice_open
    where purchase_invoice_id = '00000000-0000-0000-0000-0000001714f1'),
  0::numeric,
  'the origin is left with nothing open, never below zero'
);

-- Currency -----------------------------------------------------------------------

select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_total,
       moneda, cotizacion, status, invoice_origin_id)
    values ('jouve_internal', '00000000-0000-0000-0000-0000001714b1', 'nc', 1, 171414,
            current_date, 10, 10, 'DOL', 1000, 'received', '00000000-0000-0000-0000-0000001714f2')$$,
  '23514',
  'La factura de origen está en otra moneda: una NC/ND va en la misma moneda que su factura',
  'a USD NC over an ARS factura is refused'
);

select throws_ok(
  $$insert into public.purchase_invoices
      (channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_total,
       moneda, cotizacion, status, invoice_origin_id)
    values ('jouve_internal', '00000000-0000-0000-0000-0000001714b1', 'nd', 1, 171415,
            current_date, 100, 100, 'PES', 1, 'received', '00000000-0000-0000-0000-0000001714f3')$$,
  '23514',
  'La factura de origen está en otra moneda: una NC/ND va en la misma moneda que su factura',
  'an ARS ND over a USD factura is refused'
);

select lives_ok(
  $$insert into public.purchase_invoices
      (id, channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_total,
       moneda, cotizacion, status, invoice_origin_id)
    values ('00000000-0000-0000-0000-0000001714a3', 'jouve_internal',
            '00000000-0000-0000-0000-0000001714b1', 'nc', 1, 171416, current_date, 100, 100,
            'DOL', 1000, 'received', '00000000-0000-0000-0000-0000001714f3')$$,
  'a USD NC over a USD factura is loaded'
);

select throws_ok(
  $$update public.purchase_invoices set moneda = 'PES', cotizacion = 1
     where id = '00000000-0000-0000-0000-0000001714a3'$$,
  '23514',
  'La factura de origen está en otra moneda: una NC/ND va en la misma moneda que su factura',
  'an NC cannot move to another currency than its origin'
);

select throws_ok(
  $$update public.purchase_invoices set moneda = 'PES', cotizacion = 1
     where id = '00000000-0000-0000-0000-0000001714f3'$$,
  '23514',
  'Esta factura es origen de una NC/ND: no se le puede cambiar la moneda',
  'an origin with a received NC keeps its currency'
);

-- With its NC cancelled, the factura's currency can be corrected.
update public.purchase_invoices set status = 'cancelled', cancelled_at = now()
 where id = '00000000-0000-0000-0000-0000001714a3';

select lives_ok(
  $$update public.purchase_invoices set moneda = 'PES', cotizacion = 1
     where id = '00000000-0000-0000-0000-0000001714f3'$$,
  'an origin whose notes are cancelled can change currency'
);

-- A pair loaded before this guard still saves its other fields.
alter table public.purchase_invoices disable trigger guard_purchase_invoice_origin;
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, punto_venta, numero, fecha, imp_neto, imp_total,
   moneda, cotizacion, status, invoice_origin_id)
values ('00000000-0000-0000-0000-0000001714a4', 'jouve_internal',
        '00000000-0000-0000-0000-0000001714b1', 'nc', 1, 171417, current_date, 1, 1,
        'DOL', 1000, 'received', '00000000-0000-0000-0000-0000001714f2');
alter table public.purchase_invoices enable trigger guard_purchase_invoice_origin;

select lives_ok(
  $$update public.purchase_invoices
       set notes = 'solo notas', moneda = 'DOL', cotizacion = 1000,
           invoice_origin_id = '00000000-0000-0000-0000-0000001714f2'
     where id = '00000000-0000-0000-0000-0000001714a4'$$,
  'an existing NC in another currency still saves an edit that keeps both'
);

select lives_ok(
  $$update public.purchase_invoices set notes = 'origen', moneda = 'PES'
     where id = '00000000-0000-0000-0000-0000001714f2'$$,
  'and so does its origin'
);

select * from finish();
rollback;
