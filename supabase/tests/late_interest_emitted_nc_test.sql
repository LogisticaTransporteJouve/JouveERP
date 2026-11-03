-- Auditoría W1 · S2 F9: a draft NC is not off the open balance, so the
-- late-interest proration does not add it back either. One transaction,
-- rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(2);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000094c1', false, null, 'Cliente NC borrador', null);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000094d1', 'jouve_internal', '00000000-0000-0000-0000-0000000094c1',
   'factura', null, 9001, 99971, '2026-09-01', '2026-10-01', 2, 99, '0', 10000, 0, 10000, 'emitted',
   'nc-borrador-test-1');

-- A draft NC of 4.000 dated 12/10: the open balance still reads 10.000.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000094d2', 'jouve_internal', '00000000-0000-0000-0000-0000000094c1',
   'nc', null, 9001, 99972, '2026-10-12', 2, 99, '0', 4000, 0, 4000, 'draft',
   'nc-borrador-test-2', '00000000-0000-0000-0000-0000000094d1');

create temp table t_draft on commit drop as
  select * from public.late_interest_candidates('2026-10-31')
   where invoice_id = '00000000-0000-0000-0000-0000000094d1';

select results_eq(
  $$select open_amount, balance_days from t_draft$$,
  $$values (10000::numeric, 300000::numeric)$$,
  'a draft NC lowers neither the open balance nor the daily balance'
);

select is(
  public.late_interest_reductions_after('00000000-0000-0000-0000-0000000094d1', '2026-10-02', '2026-10-31'),
  0::numeric,
  'a draft NC is not a reduction'
);

select * from finish();
rollback;
