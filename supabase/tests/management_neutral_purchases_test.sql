-- Resultado de gestión (20261104104002): a purchase booked to an expense
-- account mapped to neutral ("not a company cost") adds 0 in both bases; a
-- payment order that pays it and an ordinary purchase counts only the
-- ordinary one. Deltas against the current month, so seeds do not matter.
-- One transaction, rolled back.

begin;

select plan(4);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

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
select '00000000-0000-0000-0000-0000000aa001', parent_id, '5.3.99', 'Gastos ajenos a la empresa',
       level, account_type
  from public.chart_of_accounts where code = '5.3.4';
insert into public.management_buckets (chart_of_accounts_id, bucket)
values ('00000000-0000-0000-0000-0000000aa001', 'neutral');

insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000aa101', false, null, 'Proveedor Ajeno', null);
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000aa201', 'Caja Ajena', 'cash', 'ARS');

-- 500 not a company cost, 300 an ordinary cost (alquileres), one OP for both.
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
   imp_neto, imp_total, status, account_id)
values
  ('00000000-0000-0000-0000-0000000aa301', 'jouve_internal', '00000000-0000-0000-0000-0000000aa101',
   'factura', null, 1, 97101, current_date, 500, 500, 'received', '00000000-0000-0000-0000-0000000aa001'),
  ('00000000-0000-0000-0000-0000000aa302', 'jouve_internal', '00000000-0000-0000-0000-0000000aa101',
   'factura', null, 1, 97102, current_date, 300, 300, 'received',
   (select id from public.chart_of_accounts where code = '5.3.4'));

select public.create_payment_order(
  'jouve_internal', 9001,
  (select coalesce(max(numero), 0) + 1 from public.payment_orders
    where channel_id = 'jouve_internal' and punto_venta = 9001),
  '00000000-0000-0000-0000-0000000aa101', current_date, 800, 'ARS', null,
  '[{"account_id":"00000000-0000-0000-0000-0000000aa201","amount":800}]'::jsonb,
  '[{"purchase_invoice_id":"00000000-0000-0000-0000-0000000aa301","amount_applied":500},
    {"purchase_invoice_id":"00000000-0000-0000-0000-0000000aa302","amount_applied":300}]'::jsonb,
  null);

set constraints all immediate;

select is(pg_temp.delta('cash'), -300::numeric,
  'cash: of an OP that pays both, only the ordinary purchase is a cost');
select is(pg_temp.delta('accrual'), -300::numeric,
  'accrual: the purchase on the neutral account is not a cost');

select ok(
  not exists (
    select 1 from public.get_management_pnl(current_date, current_date, 'cash', false)
     where bucket = 'neutral'),
  'cash: neutral is left out of the result, as before'
);

select set_eq(
  $$select bucket, sum(amount_ars) from public.get_management_pnl(current_date, current_date, 'cash', false)
     group by bucket$$,
  $$select bucket, sum(amount_ars) from public.get_management_pnl_documents(current_date, current_date, 'cash')
     group by bucket$$,
  'the cash drill-down adds up to the same figure per bucket'
);

select * from finish();
rollback;
