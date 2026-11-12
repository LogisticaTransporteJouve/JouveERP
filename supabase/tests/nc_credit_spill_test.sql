-- The credit of an NC beyond what its origin owes cancels the same party's
-- other open documents, oldest first, per channel and currency
-- (20261111215000). Guards keep reading what each document owes by itself.
-- NCs are inserted already emitted/received, as the ARCA import stores them.
-- One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(32);

-- The fixtures insert receipt and payment-order headers by hand; in the app
-- only the RPCs do (guard_document_insert).
alter table public.receipts disable trigger receipts_guard_insert_rpc;
alter table public.payment_orders disable trigger payment_orders_guard_insert_rpc;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c5f1', 'owner@nc-credit-spill.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000c5f1', 'owner');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c501', true, '20555555551', 'FLORES', 'responsable_inscripto'),
  ('00000000-0000-0000-0000-00000000c502', false, null, 'UNGARO CARLOS', null),
  ('00000000-0000-0000-0000-00000000c503', false, null, 'Cliente Orden', null),
  ('00000000-0000-0000-0000-00000000c504', false, null, 'Cliente Cobro Primero', null),
  ('00000000-0000-0000-0000-00000000c505', false, null, 'Cliente Particiones', null),
  ('00000000-0000-0000-0000-00000000c506', false, null, 'Cliente NC Anulada', null),
  ('00000000-0000-0000-0000-00000000c507', false, null, 'Cliente Guarda', null),
  ('00000000-0000-0000-0000-00000000c508', false, null, 'Cliente Apertura Previa', null),
  ('00000000-0000-0000-0000-00000000c509', false, null, 'Cliente Corte A', null),
  ('00000000-0000-0000-0000-00000000c50a', false, null, 'Cliente Corte B', null),
  ('00000000-0000-0000-0000-00000000c50b', false, null, 'Cliente Remito', null),
  ('00000000-0000-0000-0000-00000000c50c', true, '20555555553', 'Cliente Remito Ventas', 'responsable_inscripto');

-- 1. FLORES ----------------------------------------------------------------------
-- 226, 227, 7619, ND 2 and ND 40 of 200.000; five NCs of 200.000 linked to 227.

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id, origin_unlinked)
values
  ('00000000-0000-0000-0000-00000000e101', 'jouve_fiscal', '00000000-0000-0000-0000-00000000c501',
   'factura', 'A', 3, 226, '2026-07-01', 2, 80, '20555555551', 200000, 0, 200000, 1, 1, 'emitted', 'spill-226', null, false),
  ('00000000-0000-0000-0000-00000000e102', 'jouve_fiscal', '00000000-0000-0000-0000-00000000c501',
   'factura', 'A', 3, 227, '2026-07-02', 2, 80, '20555555551', 200000, 0, 200000, 1, 1, 'emitted', 'spill-227', null, false),
  ('00000000-0000-0000-0000-00000000e103', 'jouve_fiscal', '00000000-0000-0000-0000-00000000c501',
   'factura', 'A', 3, 7619, '2026-07-03', 2, 80, '20555555551', 200000, 0, 200000, 1, 1, 'emitted', 'spill-7619', null, false),
  ('00000000-0000-0000-0000-00000000e104', 'jouve_fiscal', '00000000-0000-0000-0000-00000000c501',
   'nd', 'A', 3, 2, '2026-07-04', 2, 80, '20555555551', 200000, 0, 200000, 2, 1, 'emitted', 'spill-nd2', null, true),
  ('00000000-0000-0000-0000-00000000e105', 'jouve_fiscal', '00000000-0000-0000-0000-00000000c501',
   'nd', 'A', 3, 40, '2026-07-05', 2, 80, '20555555551', 200000, 0, 200000, 2, 1, 'emitted', 'spill-nd40', null, true);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
select ('00000000-0000-0000-0000-00000000e1a' || g)::uuid, 'jouve_fiscal', '00000000-0000-0000-0000-00000000c501',
       'nc', 'A', 3, 900 + g, '2026-07-10', 2, 80, '20555555551', 200000, 0, 200000, 3, 1, 'emitted',
       'spill-nc-' || g, '00000000-0000-0000-0000-00000000e102'::uuid
  from generate_series(1, 5) g;

select results_eq(
  $$select own_open_amount, open_amount from public.v_invoice_open
     where client_id = '00000000-0000-0000-0000-00000000c501'
       and invoice_id = '00000000-0000-0000-0000-00000000e102'$$,
  $$values (-800000::numeric, 0::numeric)$$,
  'FLORES: 227 owes −800.000 by itself and 0 for real'
);

select results_eq(
  $$select open_amount, amount_credited_by_nc_spill from public.v_invoice_open
     where client_id = '00000000-0000-0000-0000-00000000c501' and kind in ('factura', 'nd')
       and invoice_id <> '00000000-0000-0000-0000-00000000e102'
     order by fecha$$,
  $$values (0::numeric, 200000::numeric), (0::numeric, 200000::numeric),
           (0::numeric, 200000::numeric), (0::numeric, 200000::numeric)$$,
  'FLORES: the excess cancels 226, 7619, ND 2 and ND 40'
);

select is(
  (select count(*)::int from public.v_aging_documents
    where client_id = '00000000-0000-0000-0000-00000000c501'),
  0,
  'FLORES leaves the aging'
);

select results_eq(
  $$select public.invoice_open_amount('00000000-0000-0000-0000-00000000e101'),
           public.invoice_own_open_amount('00000000-0000-0000-0000-00000000e101')$$,
  $$values (0::numeric, 200000::numeric)$$,
  'invoice_open_amount is the real figure; invoice_own_open_amount what 226 owes by itself'
);

-- 2. UNGARO CARLOS ---------------------------------------------------------------

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e201', 'jouve_internal', '00000000-0000-0000-0000-00000000c502',
   'factura', null, 9001, 21987, '2026-08-01', 2, 99, '0', 957369.86, 0, 957369.86, 'emitted', 'spill-21987', null),
  ('00000000-0000-0000-0000-00000000e202', 'jouve_internal', '00000000-0000-0000-0000-00000000c502',
   'factura', null, 9001, 22005, '2026-08-10', 2, 99, '0', 468383.12, 0, 468383.12, 'emitted', 'spill-22005', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e203', 'jouve_internal', '00000000-0000-0000-0000-00000000c502',
   'nc', null, 9001, 1005, '2026-08-15', 2, 99, '0', 1425752.98, 0, 1425752.98, 'emitted', 'spill-nc1005',
   '00000000-0000-0000-0000-00000000e201');

select results_eq(
  $$select open_amount from public.v_invoice_open
     where client_id = '00000000-0000-0000-0000-00000000c502' and kind = 'factura'
     order by fecha$$,
  $$values (0::numeric), (0::numeric)$$,
  'UNGARO: 21987 and 22005 end at 0'
);

select is(
  (select sum(own_open_amount) from public.v_invoice_open
    where client_id = '00000000-0000-0000-0000-00000000c502' and kind = 'factura'),
  0::numeric,
  'UNGARO: nothing is left over'
);

-- 3. Order and leftover ----------------------------------------------------------
-- O 100 with an NC of 250 (excess 150) over A, B, C of 100.

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e300', 'jouve_internal', '00000000-0000-0000-0000-00000000c503',
   'factura', null, 9001, 30000, '2026-08-20', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-o3', null),
  ('00000000-0000-0000-0000-00000000e301', 'jouve_internal', '00000000-0000-0000-0000-00000000c503',
   'factura', null, 9001, 30001, '2026-08-01', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-a3', null),
  ('00000000-0000-0000-0000-00000000e302', 'jouve_internal', '00000000-0000-0000-0000-00000000c503',
   'factura', null, 9001, 30002, '2026-08-02', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-b3', null),
  ('00000000-0000-0000-0000-00000000e303', 'jouve_internal', '00000000-0000-0000-0000-00000000c503',
   'factura', null, 9001, 30003, '2026-08-03', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-c3', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e304', 'jouve_internal', '00000000-0000-0000-0000-00000000c503',
   'nc', null, 9001, 30004, '2026-08-21', 2, 99, '0', 250, 0, 250, 'emitted', 'spill-nc3a',
   '00000000-0000-0000-0000-00000000e300');

select results_eq(
  $$select open_amount from public.v_invoice_open
     where client_id = '00000000-0000-0000-0000-00000000c503'
       and invoice_id in ('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000e302',
                          '00000000-0000-0000-0000-00000000e303')
     order by fecha$$,
  $$values (0::numeric), (50::numeric), (100::numeric)$$,
  'the excess cancels the oldest documents first'
);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e305', 'jouve_internal', '00000000-0000-0000-0000-00000000c503',
   'nc', null, 9001, 30005, '2026-08-22', 2, 99, '0', 250, 0, 250, 'emitted', 'spill-nc3b',
   '00000000-0000-0000-0000-00000000e300');

select is(
  (select sum(open_amount) from public.v_invoice_open
    where client_id = '00000000-0000-0000-0000-00000000c503' and kind = 'factura'),
  0::numeric,
  'an excess of 400 cancels every document'
);

select is(
  (select sum(signed_amount) from public.v_client_account_movements
    where client_id = '00000000-0000-0000-0000-00000000c503'),
  -100::numeric,
  'and the 100 left over stays as credit in the statement'
);

-- 4. Cash first ------------------------------------------------------------------
-- A 100 (oldest), B 100, O 100 with an NC of 150 (excess 50).

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e401', 'jouve_internal', '00000000-0000-0000-0000-00000000c504',
   'factura', null, 9001, 40001, '2026-08-01', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-a4', null),
  ('00000000-0000-0000-0000-00000000e402', 'jouve_internal', '00000000-0000-0000-0000-00000000c504',
   'factura', null, 9001, 40002, '2026-08-02', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-b4', null),
  ('00000000-0000-0000-0000-00000000e400', 'jouve_internal', '00000000-0000-0000-0000-00000000c504',
   'factura', null, 9001, 40000, '2026-08-03', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-o4', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e403', 'jouve_internal', '00000000-0000-0000-0000-00000000c504',
   'nc', null, 9001, 40003, '2026-08-04', 2, 99, '0', 150, 0, 150, 'emitted', 'spill-nc4',
   '00000000-0000-0000-0000-00000000e400');

insert into public.receipts (id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency) values
  ('00000000-0000-0000-0000-00000000d401', 'jouve_internal', 9001, 40001, '00000000-0000-0000-0000-00000000c504', '2026-08-05', 100, 'ARS'),
  ('00000000-0000-0000-0000-00000000d402', 'jouve_internal', 9001, 40002, '00000000-0000-0000-0000-00000000c504', '2026-08-06', 100, 'ARS');
insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
values ('00000000-0000-0000-0000-00000000d401', '00000000-0000-0000-0000-00000000e401', 100);

select results_eq(
  $$select open_amount from public.v_invoice_open
     where client_id = '00000000-0000-0000-0000-00000000c504'
       and invoice_id in ('00000000-0000-0000-0000-00000000e401', '00000000-0000-0000-0000-00000000e402')
     order by fecha$$,
  $$values (0::numeric), (50::numeric)$$,
  'a receipt on the oldest moves the spill to the next document'
);

select lives_ok(
  $q$do $x$ begin
      insert into public.receipt_allocations (receipt_id, invoice_id, amount_applied)
      values ('00000000-0000-0000-0000-00000000d402', '00000000-0000-0000-0000-00000000e402', 100);
      set constraints all immediate;
    end $x$ $q$,
  'a receipt for what a spilled invoice owes by itself is accepted'
);
set constraints all deferred;

-- 5. Partitions ------------------------------------------------------------------
-- Internal ARS excess of 100; an internal USD factura and a factura on a
-- second internal channel (a client is on one side, guard_document_side).

insert into public.invoicing_channels (id, business_unit_id, name, is_fiscal, is_active)
values ('test_internal_b', 'dz_sons', 'Interno B', false, true);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e500', 'jouve_internal', '00000000-0000-0000-0000-00000000c505',
   'factura', null, 9001, 50000, '2026-08-05', 2, 99, '0', 100, 0, 100, 'PES', 1, null, null, 'emitted', 'spill-o5', null),
  ('00000000-0000-0000-0000-00000000e501', 'jouve_internal', '00000000-0000-0000-0000-00000000c505',
   'factura', null, 9001, 50001, '2026-08-01', 2, 99, '0', 100, 0, 100, 'DOL', 1000, null, null, 'emitted', 'spill-u5', null),
  ('00000000-0000-0000-0000-00000000e502', 'test_internal_b', '00000000-0000-0000-0000-00000000c505',
   'factura', null, 9001, 50002, '2026-08-01', 2, 99, '0', 100, 0, 100, 'PES', 1, null, null, 'emitted', 'spill-f5', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e503', 'jouve_internal', '00000000-0000-0000-0000-00000000c505',
   'nc', null, 9001, 50003, '2026-08-06', 2, 99, '0', 200, 0, 200, 'PES', 1, 'emitted', 'spill-nc5',
   '00000000-0000-0000-0000-00000000e500');

select results_eq(
  $$select open_amount from public.v_invoice_open
     where client_id = '00000000-0000-0000-0000-00000000c505'
       and invoice_id in ('00000000-0000-0000-0000-00000000e501', '00000000-0000-0000-0000-00000000e502')
     order by channel_id$$,
  $$values (100::numeric), (100::numeric)$$,
  'credit does not cross to another channel, nor pesos to dollars'
);

-- 6. Cancelled NC ----------------------------------------------------------------

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e600', 'jouve_internal', '00000000-0000-0000-0000-00000000c506',
   'factura', null, 9001, 60000, '2026-08-01', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-o6', null),
  ('00000000-0000-0000-0000-00000000e601', 'jouve_internal', '00000000-0000-0000-0000-00000000c506',
   'factura', null, 9001, 60001, '2026-08-02', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-a6', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e602', 'jouve_internal', '00000000-0000-0000-0000-00000000c506',
   'nc', null, 9001, 60002, '2026-08-03', 2, 99, '0', 150, 0, 150, 'cancelled', 'spill-nc6',
   '00000000-0000-0000-0000-00000000e600');

select is(
  (select open_amount from public.v_invoice_open
    where client_id = '00000000-0000-0000-0000-00000000c506'
      and invoice_id = '00000000-0000-0000-0000-00000000e601'),
  100::numeric,
  'a cancelled NC does not spill'
);

-- 7. Guards on the own figure ----------------------------------------------------
-- O 100 with an emitted NC of 150 spills 50 on A 100 (A open 50).

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e700', 'jouve_internal', '00000000-0000-0000-0000-00000000c507',
   'factura', null, 9001, 70000, '2026-08-01', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-o7', null),
  ('00000000-0000-0000-0000-00000000e701', 'jouve_internal', '00000000-0000-0000-0000-00000000c507',
   'factura', null, 9001, 70001, '2026-08-02', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-a7', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e702', 'jouve_internal', '00000000-0000-0000-0000-00000000c507',
   'nc', null, 9001, 70002, '2026-08-03', 2, 99, '0', 150, 0, 150, 'emitted', 'spill-nc7',
   '00000000-0000-0000-0000-00000000e700');

select throws_ok(
  $q$do $x$ begin
      insert into public.invoices
        (channel_id, client_id, kind, punto_venta, fecha, concepto, doc_tipo, doc_nro,
         imp_neto, imp_total, invoice_origin_id, motivo_nc_nd, status, idempotency_key)
      values ('jouve_internal', '00000000-0000-0000-0000-00000000c507', 'nc', 9001, current_date, 2, 99,
         '0', 120, 120, '00000000-0000-0000-0000-00000000e701', 'Ajuste', 'draft', 'spill-nc7-over');
      set constraints all immediate;
    end $x$ $q$,
  '23514',
  'La nota de crédito supera el saldo abierto del comprobante de origen',
  'a draft NC above what its origin owes by itself is refused with the same message'
);
set constraints all deferred;

select lives_ok(
  $q$do $x$ begin
      insert into public.invoices
        (channel_id, client_id, kind, punto_venta, fecha, concepto, doc_tipo, doc_nro,
         imp_neto, imp_total, invoice_origin_id, motivo_nc_nd, status, idempotency_key)
      values ('jouve_internal', '00000000-0000-0000-0000-00000000c507', 'nc', 9001, current_date, 2, 99,
         '0', 80, 80, '00000000-0000-0000-0000-00000000e701', 'Ajuste', 'draft', 'spill-nc7-ok');
      set constraints all immediate;
    end $x$ $q$,
  'an NC above the spilled figure but within the own figure is accepted'
);
set constraints all deferred;

select is(
  public.invoice_own_open_amount('00000000-0000-0000-0000-00000000e701'),
  (select i.imp_total
     - coalesce((select sum(n.imp_total) from public.invoices n
                  where n.invoice_origin_id = i.id and n.kind = 'nc'
                    and n.status in ('draft', 'emitting', 'emitted')), 0)
     from public.invoices i where i.id = '00000000-0000-0000-0000-00000000e701'),
  'invoice_own_open_amount is the old body: total − its NCs, in-flight included (20)'
);

-- 8. Opening, pre-cut ------------------------------------------------------------
-- Target 50 at the cut; A 100 (origin of an NC of 150), B 100, C 100, all ≤ cut.

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e801', 'jouve_internal', '00000000-0000-0000-0000-00000000c508',
   'factura', null, 9001, 80001, '2026-01-05', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-a8', null),
  ('00000000-0000-0000-0000-00000000e802', 'jouve_internal', '00000000-0000-0000-0000-00000000c508',
   'factura', null, 9001, 80002, '2026-01-06', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-b8', null),
  ('00000000-0000-0000-0000-00000000e803', 'jouve_internal', '00000000-0000-0000-0000-00000000c508',
   'factura', null, 9001, 80003, '2026-01-07', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-c8', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e804', 'jouve_internal', '00000000-0000-0000-0000-00000000c508',
   'nc', null, 9001, 80004, '2026-01-10', 2, 99, '0', 150, 0, 150, 'emitted', 'spill-nc8',
   '00000000-0000-0000-0000-00000000e801');

select public.apply_client_opening_balance_core(
  '00000000-0000-0000-0000-00000000c508', '2026-01-31', 50, null, null, null);

select is(
  (select sum(open_amount) from public.v_aging_documents
    where client_id = '00000000-0000-0000-0000-00000000c508'),
  50::numeric,
  'opening: the aging equals the target when the excess is before the cut'
);

-- 9. Opening, NC excess across the cut (K1) --------------------------------------
-- Target 0. A 100 with an NC of 150, D 100 after the cut. Client A: the NC is
-- before the cut (its excess stays in the opening); client B: after it.

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e901', 'jouve_internal', '00000000-0000-0000-0000-00000000c509',
   'factura', null, 9001, 90001, '2026-01-05', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-a9', null),
  ('00000000-0000-0000-0000-00000000e902', 'jouve_internal', '00000000-0000-0000-0000-00000000c509',
   'factura', null, 9001, 90002, '2026-02-10', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-d9', null),
  ('00000000-0000-0000-0000-00000000e911', 'jouve_internal', '00000000-0000-0000-0000-00000000c50a',
   'factura', null, 9001, 90011, '2026-01-05', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-a9b', null),
  ('00000000-0000-0000-0000-00000000e912', 'jouve_internal', '00000000-0000-0000-0000-00000000c50a',
   'factura', null, 9001, 90012, '2026-02-10', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-d9b', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000e903', 'jouve_internal', '00000000-0000-0000-0000-00000000c509',
   'nc', null, 9001, 90003, '2026-01-10', 2, 99, '0', 150, 0, 150, 'emitted', 'spill-nc9',
   '00000000-0000-0000-0000-00000000e901'),
  ('00000000-0000-0000-0000-00000000e913', 'jouve_internal', '00000000-0000-0000-0000-00000000c50a',
   'nc', null, 9001, 90013, '2026-02-05', 2, 99, '0', 150, 0, 150, 'emitted', 'spill-nc9b',
   '00000000-0000-0000-0000-00000000e911');

select public.apply_client_opening_balance_core(
  '00000000-0000-0000-0000-00000000c509', '2026-01-31', 0, null, null, null);
select public.apply_client_opening_balance_core(
  '00000000-0000-0000-0000-00000000c50a', '2026-01-31', 0, null, null, null);

select is(
  (select open_amount from public.v_invoice_open
    where client_id = '00000000-0000-0000-0000-00000000c509'
      and invoice_id = '00000000-0000-0000-0000-00000000e902'),
  100::numeric,
  'opening: the excess of an NC before the cut never lowers a document after it'
);

select is(
  (select open_amount from public.v_invoice_open
    where client_id = '00000000-0000-0000-0000-00000000c50a'
      and invoice_id = '00000000-0000-0000-0000-00000000e912'),
  50::numeric,
  'opening: the excess of an NC after the cut does'
);

-- 10. Remito settlement ----------------------------------------------------------
-- Internal: O 100 with an NC of 400 (excess 300), remito R 1.000, then N 500.
-- R is billed by a fiscal factura of another client.

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000ea00', 'jouve_internal', '00000000-0000-0000-0000-00000000c50b',
   'factura', null, 9001, 100000, '2026-08-01', 2, 99, '0', 100, 0, 100, 'emitted', 'spill-o10', null),
  ('00000000-0000-0000-0000-00000000ea01', 'jouve_internal', '00000000-0000-0000-0000-00000000c50b',
   'factura', null, 9001, 100001, '2026-08-02', 2, 99, '0', 1000, 0, 1000, 'emitted', 'spill-r10', null),
  ('00000000-0000-0000-0000-00000000ea02', 'jouve_internal', '00000000-0000-0000-0000-00000000c50b',
   'factura', null, 9001, 100002, '2026-08-03', 2, 99, '0', 500, 0, 500, 'emitted', 'spill-n10', null);
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000ea03', 'jouve_internal', '00000000-0000-0000-0000-00000000c50b',
   'nc', null, 9001, 100003, '2026-08-04', 2, 99, '0', 400, 0, 400, 'emitted', 'spill-nc10',
   '00000000-0000-0000-0000-00000000ea00');
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, cbte_tipo_afip,
   iva_condition_receptor, status, idempotency_key, source_remito_id)
values
  ('00000000-0000-0000-0000-00000000eaf1', 'jouve_fiscal', '00000000-0000-0000-0000-00000000c50c',
   'factura', 'A', 3, null, current_date, 2, 80, '20555555553', 1000, 210, 1210, 1, 1,
   'draft', 'spill-f10', '00000000-0000-0000-0000-00000000ea01');
update public.invoices set status = 'emitted', numero = 100010
 where id = '00000000-0000-0000-0000-00000000eaf1';

select is(
  (select open_amount from public.v_invoice_open
    where client_id = '00000000-0000-0000-0000-00000000c50b'
      and invoice_id = '00000000-0000-0000-0000-00000000ea01'),
  700::numeric,
  'remito: before billing, the excess sits on the remito'
);

create temp table t_settle on commit drop as
select public.settle_billed_remito('00000000-0000-0000-0000-00000000eaf1') as nc;

select is(
  (select imp_total from public.invoices where id = (select nc from t_settle)),
  1000::numeric,
  'remito: the settlement NC cancels what the remito owes by itself'
);

update public.invoices set status = 'emitted', numero = 100011
 where id = (select nc from t_settle);

select results_eq(
  $$select open_amount from public.v_invoice_open
     where client_id = '00000000-0000-0000-0000-00000000c50b'
       and invoice_id in ('00000000-0000-0000-0000-00000000ea01', '00000000-0000-0000-0000-00000000ea02')
     order by fecha$$,
  $$values (0::numeric), (200::numeric)$$,
  'remito: afterwards the excess lands on the client''s next internal document'
);

-- 11. Purchases ------------------------------------------------------------------
-- The constraint guards stay deferred: an over-credited origin is refused at
-- commit (guard_purchase_invoice_open_after_edit), and this test never commits.

insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000b501', false, null, 'Proveedor FLORES', null),
  ('00000000-0000-0000-0000-00000000b502', false, null, 'Proveedor Corte A', null),
  ('00000000-0000-0000-0000-00000000b503', false, null, 'Proveedor Corte B', null),
  ('00000000-0000-0000-0000-00000000b504', false, null, 'Proveedor Remito', null),
  ('00000000-0000-0000-0000-00000000b505', true, '30555555554', 'Proveedor Compras', 'responsable_inscripto');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000ac51', 'Caja Spill Test', 'cash', 'ARS');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, moneda, cotizacion, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000f101', 'jouve_internal', '00000000-0000-0000-0000-00000000b501',
   'factura', null, 1, 226, '2026-07-01', 200000, 200000, 'PES', 1, 'received', null),
  ('00000000-0000-0000-0000-00000000f102', 'jouve_internal', '00000000-0000-0000-0000-00000000b501',
   'factura', null, 1, 227, '2026-07-02', 200000, 200000, 'PES', 1, 'received', null),
  ('00000000-0000-0000-0000-00000000f103', 'jouve_internal', '00000000-0000-0000-0000-00000000b501',
   'factura', null, 1, 7619, '2026-07-03', 200000, 200000, 'PES', 1, 'received', null);
-- A purchase ND needs an origin (guard_purchase_nc_nd_origin); an ND adds to
-- the party's debt whatever its origin.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, moneda, cotizacion, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000f104', 'jouve_internal', '00000000-0000-0000-0000-00000000b501',
   'nd', null, 1, 2, '2026-07-04', 200000, 200000, 'PES', 1, 'received', '00000000-0000-0000-0000-00000000f101'),
  ('00000000-0000-0000-0000-00000000f105', 'jouve_internal', '00000000-0000-0000-0000-00000000b501',
   'nd', null, 1, 40, '2026-07-05', 200000, 200000, 'PES', 1, 'received', '00000000-0000-0000-0000-00000000f101');
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, moneda, cotizacion, status, invoice_origin_id)
select ('00000000-0000-0000-0000-00000000f1a' || g)::uuid, 'jouve_internal', '00000000-0000-0000-0000-00000000b501',
       'nc', null, 1, 900 + g, '2026-07-10', 200000, 200000, 'PES', 1, 'received',
       '00000000-0000-0000-0000-00000000f102'::uuid
  from generate_series(1, 5) g;

select results_eq(
  $$select own_open_amount, open_amount from public.v_purchase_invoice_open
     where supplier_id = '00000000-0000-0000-0000-00000000b501' and kind in ('factura', 'nd')
     order by purchase_invoice_id$$,
  $$values (200000::numeric, 0::numeric), (-800000::numeric, 0::numeric), (200000::numeric, 0::numeric),
           (200000::numeric, 0::numeric), (200000::numeric, 0::numeric)$$,
  'purchases: the excess of 227 cancels the supplier''s other documents'
);

select is(
  (select count(*)::int from public.v_supplier_aging_documents
    where supplier_id = '00000000-0000-0000-0000-00000000b501'),
  0,
  'purchases: the supplier leaves the aging'
);

insert into public.payment_orders (id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency)
values ('00000000-0000-0000-0000-00000000d501', 'jouve_internal', 9001, 95001,
        '00000000-0000-0000-0000-00000000b501', '2026-07-20', 200000, 'ARS');

select lives_ok(
  $$insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
    values ('00000000-0000-0000-0000-00000000d501', '00000000-0000-0000-0000-00000000f101', 200000)$$,
  'purchases: an OP for what a spilled invoice owes by itself is accepted'
);

select is(
  (select open_amount from public.v_purchase_invoice_open
    where supplier_id = '00000000-0000-0000-0000-00000000b501'
      and purchase_invoice_id = '00000000-0000-0000-0000-00000000f101'),
  0::numeric,
  'purchases: and the paid invoice still shows 0'
);

-- Opening across the cut: the same two shapes as clients.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, moneda, cotizacion, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000f201', 'jouve_internal', '00000000-0000-0000-0000-00000000b502',
   'factura', null, 1, 2001, '2026-01-05', 100, 100, 'PES', 1, 'received', null),
  ('00000000-0000-0000-0000-00000000f202', 'jouve_internal', '00000000-0000-0000-0000-00000000b502',
   'factura', null, 1, 2002, '2026-02-10', 100, 100, 'PES', 1, 'received', null),
  ('00000000-0000-0000-0000-00000000f211', 'jouve_internal', '00000000-0000-0000-0000-00000000b503',
   'factura', null, 1, 2011, '2026-01-05', 100, 100, 'PES', 1, 'received', null),
  ('00000000-0000-0000-0000-00000000f212', 'jouve_internal', '00000000-0000-0000-0000-00000000b503',
   'factura', null, 1, 2012, '2026-02-10', 100, 100, 'PES', 1, 'received', null);
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, moneda, cotizacion, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000f203', 'jouve_internal', '00000000-0000-0000-0000-00000000b502',
   'nc', null, 1, 2003, '2026-01-10', 150, 150, 'PES', 1, 'received', '00000000-0000-0000-0000-00000000f201'),
  ('00000000-0000-0000-0000-00000000f213', 'jouve_internal', '00000000-0000-0000-0000-00000000b503',
   'nc', null, 1, 2013, '2026-02-05', 150, 150, 'PES', 1, 'received', '00000000-0000-0000-0000-00000000f211');

-- 11b. Remito imputation credits the remito's own figure.
-- Internal: O 100 with an NC of 300 (excess 200), remito R 500 after it.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000f300', 'jouve_internal', '00000000-0000-0000-0000-00000000b504',
   'factura', null, 1, 3000, '2026-08-01', 100, 0, 100, 'received', null),
  ('00000000-0000-0000-0000-00000000f301', 'jouve_internal', '00000000-0000-0000-0000-00000000b504',
   'factura', null, 1, 3001, '2026-08-02', 500, 0, 500, 'received', null),
  ('00000000-0000-0000-0000-00000000f3f1', 'jouve_fiscal', '00000000-0000-0000-0000-00000000b505',
   'factura', 'A', 7, 3101, '2026-08-05', 1000, 210, 1210, 'received', null);
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, status, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000f302', 'jouve_internal', '00000000-0000-0000-0000-00000000b504',
   'nc', null, 1, 3002, '2026-08-03', 300, 0, 300, 'received', '00000000-0000-0000-0000-00000000f300');

select is(
  (select open_amount from public.v_purchase_invoice_open
    where supplier_id = '00000000-0000-0000-0000-00000000b504'
      and purchase_invoice_id = '00000000-0000-0000-0000-00000000f301'),
  300::numeric,
  'purchases: before imputing, the excess sits on the remito'
);

select public.impute_purchase_remitos('00000000-0000-0000-0000-00000000f3f1',
  array['00000000-0000-0000-0000-00000000f301']::uuid[], null);

select is(
  (select imp_total from public.purchase_invoices
    where invoice_origin_id = '00000000-0000-0000-0000-00000000f301' and kind = 'nc'),
  500::numeric,
  'purchases: the imputation NC credits what the remito owes by itself'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000c5f1","role":"authenticated"}', true);

select public.apply_supplier_opening_balance(
  '00000000-0000-0000-0000-00000000b502', '2026-01-31', 0, null);
select public.apply_supplier_opening_balance(
  '00000000-0000-0000-0000-00000000b503', '2026-01-31', 0, null);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (select open_amount from public.v_purchase_invoice_open
    where supplier_id = '00000000-0000-0000-0000-00000000b502'
      and purchase_invoice_id = '00000000-0000-0000-0000-00000000f202'),
  100::numeric,
  'supplier opening: the excess of an NC before the cut never lowers a document after it'
);

select is(
  (select open_amount from public.v_purchase_invoice_open
    where supplier_id = '00000000-0000-0000-0000-00000000b503'
      and purchase_invoice_id = '00000000-0000-0000-0000-00000000f212'),
  50::numeric,
  'supplier opening: the excess of an NC after the cut does'
);

-- Invariant: per partition of a party with no opening, Σ open of eligible
-- rows = greatest(Σ own, 0).
select is(
  (select count(*)::int from (
     select o.client_id, o.channel_id, o.currency
       from public.v_invoice_open o
      where o.status = 'emitted' and o.kind in ('factura', 'nd')
        and o.client_id::text like '00000000-0000-0000-0000-00000000c5%'
        and not exists (select 1 from public.client_opening_balances b where b.client_id = o.client_id)
      group by 1, 2, 3
     having abs(sum(o.open_amount) - greatest(sum(o.own_open_amount), 0)) > 0.01) x),
  0,
  'sales: Σ open = greatest(Σ own, 0) per partition without opening'
);

select is(
  (select count(*)::int from (
     select o.supplier_id, o.channel_id, coalesce(o.moneda, 'PES')
       from public.v_purchase_invoice_open o
      where o.status = 'received' and o.kind in ('factura', 'nd')
        and o.supplier_id = '00000000-0000-0000-0000-00000000b504'
      group by 1, 2, 3
     having abs(sum(o.open_amount) - greatest(sum(o.own_open_amount), 0)) > 0.01) x),
  0,
  'purchases: Σ open = greatest(Σ own, 0) per partition without opening'
);

select * from finish();

rollback;
