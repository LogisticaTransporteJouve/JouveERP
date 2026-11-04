-- ARCA sign-in attempts and linking (20261104120000): a result counts only
-- against the credentials the run read; two failures in a row stop the
-- account until the clave is saved again; a success resets the count; only
-- the service role records. A voucher links to a purchase only when the
-- totals agree too. One transaction, rolled back.

begin;

select plan(11);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000ae101', 'owner@arca-attempt.test');

select public.set_arca_web_credentials('30711111118', '00000000-0000-0000-0000-0000000ae101', 'clave-uno');

create temp table v as select updated_at as version from public.arca_web_account;

select ok(
  not has_function_privilege('authenticated', 'public.record_arca_web_attempt(boolean, text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.record_arca_web_attempt(boolean, text, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.record_arca_web_attempt(boolean, text, timestamptz)', 'execute'),
  'only the service role records an attempt'
);

select is(
  public.record_arca_web_attempt(false, 'SIGN_IN_FAILED', (select version from v)),
  true,
  'a failure against the current credentials is recorded'
);
select results_eq(
  $$ select status, consecutive_failures from public.arca_web_account $$,
  $$ values ('active'::text, 1::bigint) $$,
  'one failure keeps the account active'
);

select public.record_arca_web_attempt(false, 'NETWORK', (select version from v));
select results_eq(
  $$ select status, consecutive_failures, last_error_code from public.arca_web_account $$,
  $$ values ('sign_in_failing'::text, 2::bigint, 'NETWORK'::text) $$,
  'the second failure in a row stops the account'
);
select is(public.get_arca_web_password(), null::text, 'and the clave is not handed out');

-- A new clave is a new version: a late result of a run that read the old one
-- does not touch it.
select public.set_arca_web_credentials('30711111118', '00000000-0000-0000-0000-0000000ae101', 'clave-dos');
-- now() is fixed inside this one transaction; a later save moves it.
update public.arca_web_account set updated_at = updated_at + interval '1 second';
select is(
  public.record_arca_web_attempt(false, 'SIGN_IN_REJECTED', (select version from v)),
  false,
  'a result for older credentials is not recorded'
);
select results_eq(
  $$ select status, consecutive_failures from public.arca_web_account $$,
  $$ values ('active'::text, 0::bigint) $$,
  'so the new clave stays active'
);

select public.record_arca_web_attempt(false, 'SIGN_IN_FAILED', (select updated_at from public.arca_web_account));
select public.record_arca_web_attempt(true, null, (select updated_at from public.arca_web_account));
select results_eq(
  $$ select status, consecutive_failures, last_error_code is null from public.arca_web_account $$,
  $$ values ('active'::text, 0::bigint, true) $$,
  'a success resets the failures'
);

-- Linking compares totals ----------------------------------------------------

insert into public.suppliers (id, cuit, legal_name, iva_condition, is_fiscal) values
  ('00000000-0000-0000-0000-0000000ae201', '30766666662', 'Proveedor Total SA', 'responsable_inscripto', true);
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000ae301', 'jouve_fiscal', '00000000-0000-0000-0000-0000000ae201',
   'factura', 'A', 5, 1, '2026-09-01', 100, 21, 121, 'PES', 1, 'received');
insert into public.arca_received_vouchers
  (id, origin, issuer_cuit, issuer_name, cbte_tipo, kind, letter, punto_venta, numero, fecha,
   imp_neto_gravado, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000000ae401', 'upload', '30766666662', 'Proveedor Total SA', 1, 'factura', 'A', 5, 1, '2026-09-01', 1000, 210, 1210, 'pending_review'),
  ('00000000-0000-0000-0000-0000000ae402', 'upload', '30766666662', 'Proveedor Total SA', 1, 'factura', 'A', 5, 2, '2026-09-01', 100, 21, 121, 'pending_review');
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_iva, imp_no_gravado, imp_total, moneda, cotizacion, status)
values
  ('00000000-0000-0000-0000-0000000ae302', 'jouve_fiscal', '00000000-0000-0000-0000-0000000ae201',
   'factura', 'A', 5, 2, '2026-09-01', 100, 21, 0, 121, 'PES', 1, 'received');

select is(
  public.link_received_vouchers(array['00000000-0000-0000-0000-0000000ae401']::uuid[]),
  0,
  'linking a voucher whose total differs from the purchase links nothing'
);
select is(
  (select status from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000ae401'),
  'pending_review',
  'a purchase with the same number and another total does not take the voucher'
);
select is(
  (select purchase_invoice_id from public.arca_received_vouchers where id = '00000000-0000-0000-0000-0000000ae402'),
  '00000000-0000-0000-0000-0000000ae302'::uuid,
  'the same number and total does (the trigger links it on insert)'
);

select * from finish();
rollback;
