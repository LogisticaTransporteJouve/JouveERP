-- Follow-up of 4.6: the late interest is charged on the daily balance. A
-- credit dated in the middle of the period lowers the balance from its date
-- on (balance_days), and with nothing in the period balance_days is days ×
-- the open balance, as before. One transaction, rolled back.

begin;

select plan(4);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000048c1', false, null, 'Cliente Prorrateo', null);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000048d1', 'jouve_internal', '00000000-0000-0000-0000-0000000048c1',
   'factura', null, 9001, 99961, '2026-09-01', '2026-10-01', 2, 99, '0', 10000, 0, 10000, 'emitted',
   'prorrateo-test-1');

create temp table t_before on commit drop as
  select * from public.late_interest_candidates('2026-10-31')
   where invoice_id = '00000000-0000-0000-0000-0000000048d1';

select results_eq(
  $$select charge_from, open_amount, balance_days from t_before$$,
  $$values ('2026-10-02'::date, 10000::numeric, 300000::numeric)$$,
  'with nothing in the period the daily balance is days × the open balance'
);

-- A credit note of 4.000 on 12/10: 10 days at 10.000, 20 days at 6.000.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000048d2', 'jouve_internal', '00000000-0000-0000-0000-0000000048c1',
   'nc', null, 9001, 99962, '2026-10-12', 2, 99, '0', 4000, 0, 4000, 'emitted',
   'prorrateo-test-2', '00000000-0000-0000-0000-0000000048d1');

create temp table t_after on commit drop as
  select * from public.late_interest_candidates('2026-10-31')
   where invoice_id = '00000000-0000-0000-0000-0000000048d1';

select results_eq(
  $$select open_amount, balance_days from t_after$$,
  $$values (6000::numeric, 220000::numeric)$$,
  'a credit in the middle of the period lowers the balance from its date on'
);

select is(
  public.late_interest_reductions_after('00000000-0000-0000-0000-0000000048d1', '2026-10-15', '2026-10-31'),
  0::numeric,
  'a credit before the charged period weighs nothing'
);

select is(
  public.late_interest_reductions_after('00000000-0000-0000-0000-0000000048d1', '2026-09-01', '2026-09-30'),
  120000::numeric,
  'a credit after the charged period weighs all its days'
);

select * from finish();
rollback;
