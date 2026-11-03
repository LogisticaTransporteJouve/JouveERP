-- The client aging nets the NCs with no origin (20261104094200): their credit
-- goes over the client's open documents of the same channel and currency
-- from the oldest due date on, so the aging, its totals and the late
-- interest agree with the statement. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(8);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000095c1', false, null, 'Cliente NC Sin Origen', null);

-- X 1.000 (due first), Y 500, Z USD 100, and an NC of 1.200 with no origin
-- (as the ARCA import stores one without CbtesAsoc).
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, status, idempotency_key,
   origin_unlinked)
values
  ('00000000-0000-0000-0000-0000000095e1', 'jouve_internal', '00000000-0000-0000-0000-0000000095c1',
   'factura', null, 9001, 95001, '2026-07-01', '2026-08-01', 2, 99, '0', 1000, 0, 1000, 'PES', 1,
   'emitted', 'unlinked-nc-x', false),
  ('00000000-0000-0000-0000-0000000095e2', 'jouve_internal', '00000000-0000-0000-0000-0000000095c1',
   'factura', null, 9001, 95002, '2026-09-01', '2026-10-01', 2, 99, '0', 500, 0, 500, 'PES', 1,
   'emitted', 'unlinked-nc-y', false),
  ('00000000-0000-0000-0000-0000000095e3', 'jouve_internal', '00000000-0000-0000-0000-0000000095c1',
   'factura', null, 9001, 95003, '2026-06-01', '2026-06-01', 2, 99, '0', 100, 0, 100, 'DOL', 1000,
   'emitted', 'unlinked-nc-z', false),
  ('00000000-0000-0000-0000-0000000095e4', 'jouve_internal', '00000000-0000-0000-0000-0000000095c1',
   'nc', null, 9001, 95004, '2026-09-15', null, 2, 99, '0', 1200, 0, 1200, 'PES', 1,
   'emitted', 'unlinked-nc-credit', true);

select is(
  (select count(*)::int from public.v_aging_documents
    where invoice_id = '00000000-0000-0000-0000-0000000095e1'),
  0,
  'the credit covers the oldest invoice whole, which leaves the aging'
);

select results_eq(
  $$select open_amount, amount_credited_unlinked from public.v_aging_documents
     where invoice_id = '00000000-0000-0000-0000-0000000095e2'$$,
  $$values (300::numeric, 200::numeric)$$,
  'what is left of the credit lowers the next invoice'
);

select results_eq(
  $$select open_amount, amount_credited_unlinked from public.v_aging_documents
     where invoice_id = '00000000-0000-0000-0000-0000000095e3'$$,
  $$values (100::numeric, 0::numeric)$$,
  'a peso credit does not touch a dollar invoice'
);

select results_eq(
  $$select ars_total_open, usd_total_open from public.v_client_aging
     where client_id = '00000000-0000-0000-0000-0000000095c1'$$,
  $$values (300::numeric, 100::numeric)$$,
  'the client aging nets the NC with no origin'
);

select is(
  (select ars_total_open from public.v_client_aging_by_scope
    where client_id = '00000000-0000-0000-0000-0000000095c1' and channel_is_fiscal = false),
  300::numeric,
  'and so does its scope'
);

select is(
  (select sum(signed_amount) from public.v_client_account_movements
    where client_id = '00000000-0000-0000-0000-0000000095c1' and currency = 'ARS'),
  300::numeric,
  'the aging equals the peso statement'
);

create temp table t_candidates on commit drop as
  select * from public.late_interest_candidates('2026-10-31')
   where client_id = '00000000-0000-0000-0000-0000000095c1';

select is(
  (select open_amount from t_candidates where invoice_id = '00000000-0000-0000-0000-0000000095e2'),
  300::numeric,
  'late interest is charged on what the NC left open'
);

select is(
  (select count(*)::int from t_candidates where invoice_id = '00000000-0000-0000-0000-0000000095e1'),
  0,
  'and not on the invoice it covered'
);

select * from finish();

rollback;
