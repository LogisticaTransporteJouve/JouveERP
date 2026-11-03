-- Margen por camión (20261104092100): a cost loaded with a truck's cost
-- center whose expense account has no management bucket ("Sin clasificar")
-- is a cost of that truck. 1995 has no seed data. One transaction, rolled
-- back.

begin;

select plan(3);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000009210a1', 'VU95001', 'camion');
insert into public.cost_centers (id, code, name, vehicle_id) values
  ('00000000-0000-0000-0000-0000009210c1', 'VU-CAMION-1', 'Camión VU 1', '00000000-0000-0000-0000-0000009210a1');
insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000009210b1', 'Caja VU', 'cash', 'ARS');

-- A postable expense leaf with no management_buckets row: unclassified.
insert into public.chart_of_accounts (id, code, name, level, account_type) values
  ('00000000-0000-0000-0000-0000009210d1', '97', 'Gasto VU sin rubro', 1, 'resultado_negativo');
delete from public.management_buckets
 where chart_of_accounts_id = '00000000-0000-0000-0000-0000009210d1';
create temp table t_leaf as
  select '00000000-0000-0000-0000-0000009210d1'::uuid as id;

insert into public.transactions
  (account_id, channel_id, kind, amount, currency, transaction_date, accrual_month, description,
   cost_center_id, expense_account_id)
values
  ('00000000-0000-0000-0000-0000009210b1', 'jouve_internal', 'expense', 250, 'ARS', '1995-04-12', '1995-04-01',
   'Gasto sin clasificar del camión VU', '00000000-0000-0000-0000-0000009210c1', (select id from t_leaf)),
  ('00000000-0000-0000-0000-0000009210b1', 'jouve_internal', 'expense', 90, 'ARS', '1995-04-13', '1995-04-01',
   'Gasto sin clasificar sin centro VU', null, (select id from t_leaf));

set constraints all immediate;

create temp table vm as
select * from public.get_vehicle_margin('1995-04-01', '1995-04-30');

select is(
  (select count(*)::int from public.management_pnl_lines('1995-04-01', '1995-04-30', 'accrual')
    where bucket = 'unclassified' and cost_center_id = '00000000-0000-0000-0000-0000009210c1'),
  1,
  'the truck''s expense is "Sin clasificar" in gestión'
);

select results_eq(
  $$select center_cost, net from vm
     where row_kind = 'vehicle' and vehicle_id = '00000000-0000-0000-0000-0000009210a1'$$,
  $$values (250.00::numeric, -250.00::numeric)$$,
  'a "Sin clasificar" cost tagged with the truck''s center is a cost of the truck'
);

select is(
  (select coalesce(sum(center_cost), 0) from vm where row_kind = 'no_center'),
  90.00::numeric,
  'and one without a center comes apart, as the operating costs do'
);

select * from finish();
rollback;
