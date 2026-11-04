-- Resultado de gestión, cash basis (20261104120201): a payment order that
-- pays a bounced check takes the shares of the order that delivered it. A
-- purchase on an account mapped to neutral, paid with a check that bounced
-- and then paid again, adds 0, for an own check and for an endorsed one.
-- Deltas against the current month, so seeds do not matter. One
-- transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(6);

create function pg_temp.pnl(p_basis text, p_bucket text)
returns numeric
language sql as $$
  select coalesce(sum(amount_ars), 0)
    from public.get_management_pnl(current_date, current_date, p_basis, false)
   where bucket = p_bucket;
$$;

create temp table before as
select b.basis, pg_temp.pnl(b.basis, 'operating_cost') as v
  from (values ('accrual'), ('cash')) as b (basis);

create function pg_temp.delta(p_basis text) returns numeric
language sql as $$
  select pg_temp.pnl(p_basis, 'operating_cost') - (select v from before where basis = p_basis)
$$;

-- A leaf "Gastos ajenos a la empresa" mapped to neutral, next to 5.3.4.
insert into public.chart_of_accounts (id, parent_id, code, name, level, account_type)
select '00000000-0000-0000-0000-0000000ab001', parent_id, '5.3.98', 'Gastos ajenos rechazos',
       level, account_type
  from public.chart_of_accounts where code = '5.3.4';
insert into public.management_buckets (chart_of_accounts_id, bucket)
values ('00000000-0000-0000-0000-0000000ab001', 'neutral');

insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000ab101', false, null, 'Proveedor Ajeno Rechazos', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000ab201', 'Banco ajeno rechazos', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-0000000ab202', 'Cartera ajena rechazos', 'checks', 'ARS');

insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, status, account_id)
values
  ('00000000-0000-0000-0000-0000000ab301', 'jouve_internal', '00000000-0000-0000-0000-0000000ab101',
   'factura', null, 1, 114511, current_date, 100, 100, 'received', '00000000-0000-0000-0000-0000000ab001'),
  ('00000000-0000-0000-0000-0000000ab302', 'jouve_internal', '00000000-0000-0000-0000-0000000ab101',
   'factura', null, 1, 114512, current_date, 40, 40, 'received', '00000000-0000-0000-0000-0000000ab001');

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, cartera_account_id, channel_id)
values
  ('00000000-0000-0000-0000-0000000ab401', 'fisico', 'GN-END', 'Banco GN', 'Firmante', current_date, current_date, 40, 'ARS',
   'manual', '00000000-0000-0000-0000-0000000ab202', 'jouve_internal');

-- Order 1 pays the first purchase with an own check; order 3 the second one
-- with the endorsed check.
select public.create_payment_order(
  'jouve_internal', 1, 114521, '00000000-0000-0000-0000-0000000ab101', current_date, 100, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'issue_check', 'account_id', '00000000-0000-0000-0000-0000000ab201', 'amount', 100,
    'issued_check', jsonb_build_object('kind', 'fisico', 'check_number', 'GN-OWN', 'bank_name', 'Banco GN',
                                       'due_date', current_date))),
  jsonb_build_array(jsonb_build_object(
    'purchase_invoice_id', '00000000-0000-0000-0000-0000000ab301', 'amount_applied', 100)));
select public.create_payment_order(
  'jouve_internal', 1, 114523, '00000000-0000-0000-0000-0000000ab101', current_date, 40, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'endorse_check', 'endorsed_check_id', '00000000-0000-0000-0000-0000000ab401')),
  jsonb_build_array(jsonb_build_object(
    'purchase_invoice_id', '00000000-0000-0000-0000-0000000ab302', 'amount_applied', 40)));

set constraints all immediate;
set constraints all deferred;

-- Both checks bounce.
update public.issued_checks set status = 'rejected', rejected_at = current_date
 where check_number = 'GN-OWN' and bank_name = 'Banco GN';
select public.reject_check('00000000-0000-0000-0000-0000000ab401', null, current_date, null, null);

-- Orders 2 and 4 pay the bounced checks by transfer.
select public.create_payment_order(
  'jouve_internal', 1, 114522, '00000000-0000-0000-0000-0000000ab101', current_date, 100, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-0000000ab201', 'amount', 100)),
  '[]'::jsonb);
select public.create_payment_order(
  'jouve_internal', 1, 114524, '00000000-0000-0000-0000-0000000ab101', current_date, 40, 'ARS', null,
  jsonb_build_array(jsonb_build_object(
    'line_kind', 'account', 'account_id', '00000000-0000-0000-0000-0000000ab201', 'amount', 40)),
  '[]'::jsonb);

create temp table t_op on commit drop as
  select id, numero from public.payment_orders
   where channel_id = 'jouve_internal' and punto_venta = 1 and numero between 114521 and 114524;

select public.allocate_payment_order(
  (select id from t_op where numero = 114522),
  jsonb_build_array(jsonb_build_object(
    'check_kind', 'issued',
    'check_id', (select ic.id from public.issued_checks ic
                  where ic.check_number = 'GN-OWN' and ic.bank_name = 'Banco GN'),
    'amount_applied', 100)));
select public.allocate_payment_order(
  (select id from t_op where numero = 114524),
  jsonb_build_array(jsonb_build_object(
    'check_kind', 'endorsed',
    'check_id', '00000000-0000-0000-0000-0000000ab401',
    'amount_applied', 40)));

set constraints all immediate;

select results_eq(
  $$select s.f_employee, s.f_fleet, s.f_neutral
      from public.management_payment_order_shares((select id from t_op where numero = 114522), 3) s$$,
  $$values (0::numeric, 0::numeric, 1::numeric)$$,
  'the order that pays the bounced own check takes the shares of the order that issued it'
);

select results_eq(
  $$select s.f_employee, s.f_fleet, s.f_neutral
      from public.management_payment_order_shares((select id from t_op where numero = 114524), 3) s$$,
  $$values (0::numeric, 0::numeric, 1::numeric)$$,
  'the order that pays the bounced endorsed check takes the shares of the order that endorsed it'
);

select results_eq(
  $$select s.f_employee, s.f_fleet, s.f_neutral
      from public.management_payment_order_shares((select id from t_op where numero = 114522), 0) s$$,
  $$values (0::numeric, 0::numeric, 0::numeric)$$,
  'past the depth a bounced check''s part stays in Proveedores'
);

select is(pg_temp.delta('cash'), 0::numeric,
  'cash: the neutral purchases add 0 after the bounces and the new orders');
select is(pg_temp.delta('accrual'), 0::numeric,
  'accrual: nor do they on the accrual side');

select set_eq(
  $$select bucket, sum(amount_ars) from public.get_management_pnl(current_date, current_date, 'cash', false)
     group by bucket$$,
  $$select bucket, sum(amount_ars) from public.get_management_pnl_documents(current_date, current_date, 'cash')
     group by bucket$$,
  'the cash drill-down adds up to the same figure per bucket'
);

select * from finish();
rollback;
