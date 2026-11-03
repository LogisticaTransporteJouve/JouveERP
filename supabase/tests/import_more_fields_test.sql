-- Importador, more fields (20261104070000): a supplier keeps its category,
-- expense account and cost center; an imported chofer keeps its license on
-- its driver record and its expiry as a 'licencia' fleet document of the run,
-- which the undo deletes with the driver (a document loaded by hand blocks
-- it); a client tariff takes an area, and the area and general lines are
-- separate natural keys. One transaction, rolled back.

begin;

select plan(10);

-- The posting triggers check the caller like the app's service client.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f601', 'admin@morefields.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000f601', 'admin');

insert into public.supplier_categories (id, name, slug) values
  ('00000000-0000-0000-0000-00000000f611', 'Categoría Import', 'categoria-import');
insert into public.cost_centers (id, code, name) values
  ('00000000-0000-0000-0000-00000000f612', 'CC-IMP', 'Centro Import');
insert into public.clients (id, legal_name, is_fiscal) values
  ('00000000-0000-0000-0000-00000000f613', 'Cliente Tarifas Área', false);
insert into public.warehouses (id, name) values
  ('00000000-0000-0000-0000-00000000f614', 'Depósito Import');
insert into public.storage_areas (id, warehouse_id, name) values
  ('00000000-0000-0000-0000-00000000f615', '00000000-0000-0000-0000-00000000f614', 'Frío');

create temporary table t_account as
  select id from public.expense_leaf_accounts order by code limit 1;

-- 1. Supplier defaults ---------------------------------------------------------------

create temporary table t_suppliers as
  select public.commit_import_run(
    'suppliers', 'proveedores.csv', repeat('5', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'legal_name', 'Proveedor Con Defaults', 'is_fiscal', false,
      'category_id', '00000000-0000-0000-0000-00000000f611',
      'default_expense_account_id', (select id from t_account),
      'default_cost_center_id', '00000000-0000-0000-0000-00000000f612')),
    '00000000-0000-0000-0000-00000000f601') as id;

select results_eq(
  $$select category_id, default_expense_account_id, default_cost_center_id
      from public.suppliers where import_run_id = (select id from t_suppliers)$$,
  $$select '00000000-0000-0000-0000-00000000f611'::uuid, (select id from t_account),
           '00000000-0000-0000-0000-00000000f612'::uuid$$,
  'an imported supplier keeps its category, expense account and cost center'
);

select throws_ok(
  $$select public.commit_import_run(
      'suppliers', 'proveedores2.csv', repeat('6', 64), '{}'::jsonb, 1, 0, 0,
      jsonb_build_array(jsonb_build_object(
        'legal_name', 'Proveedor Cuenta Mala', 'is_fiscal', false,
        'default_expense_account_id',
        (select id from public.chart_of_accounts where account_type <> 'resultado_negativo' limit 1))),
      '00000000-0000-0000-0000-00000000f601')$$,
  null,
  null,
  'an account that is not a postable expense is refused'
);

-- 2. Driver license ---------------------------------------------------------------------

create temporary table t_employees as
  select public.commit_import_run(
    'employees', 'choferes.csv', repeat('7', 64), '{}'::jsonb, 2, 0, 0,
    '[{"legal_name": "Chofer Con Licencia", "position": "Chofer / Acompañante", "cuil": "20999999982",
       "pay_frequency": "mensual", "hire_date": "2020-01-01", "viatico_monthly": 0, "is_monotributo": false,
       "license_number": "LIC-1", "license_category": "E1", "license_expires_at": "2027-06-30"},
      {"legal_name": "Chofer Sin Vencimiento", "position": "Chofer / Acompañante", "cuil": null,
       "pay_frequency": "mensual", "hire_date": "2020-01-01", "viatico_monthly": 0, "is_monotributo": false,
       "license_number": "LIC-2", "license_category": null, "license_expires_at": null}]'::jsonb,
    '00000000-0000-0000-0000-00000000f601') as id;

select results_eq(
  $$select d.full_name, d.license_number, d.license_category
      from public.drivers d where d.import_run_id = (select id from t_employees)
     order by d.full_name$$,
  $$values ('Chofer Con Licencia'::text, 'LIC-1'::text, 'E1'::text),
           ('Chofer Sin Vencimiento'::text, 'LIC-2'::text, null::text)$$,
  'an imported chofer keeps its license on its driver record'
);

select results_eq(
  $$select f.kind, f.number, f.expires_at, f.import_run_id = (select id from t_employees)
      from public.fleet_documents f
      join public.drivers d on d.id = f.driver_id
     where d.import_run_id = (select id from t_employees)$$,
  $$values ('licencia'::text, 'LIC-1'::text, '2027-06-30'::date, true)$$,
  'a license expiry becomes a licencia document of the run'
);

insert into public.fleet_documents (driver_id, kind, expires_at)
select d.id, 'lnh', '2027-01-01'
  from public.drivers d
 where d.import_run_id = (select id from t_employees) and d.full_name = 'Chofer Sin Vencimiento';

select throws_ok(
  $$select public.undo_import_run((select id from t_employees), '00000000-0000-0000-0000-00000000f601')$$,
  '55006',
  null,
  'a document loaded by hand for an imported driver blocks the undo'
);

delete from public.fleet_documents where kind = 'lnh' and import_run_id is null
   and driver_id in (select id from public.drivers where import_run_id = (select id from t_employees));

select lives_ok(
  $$select public.undo_import_run((select id from t_employees), '00000000-0000-0000-0000-00000000f601')$$,
  'the run''s own license document does not block the undo'
);

select is(
  (select count(*)::int from public.fleet_documents where number = 'LIC-1'),
  0,
  'undoing the run deletes the license document with its driver'
);

-- 3. Tariffs per area ------------------------------------------------------------------

create temporary table t_tariffs as
  select public.commit_import_run(
    'client_tariffs', 'tarifas.csv', repeat('8', 64), '{}'::jsonb, 2, 0, 0,
    jsonb_build_array(
      jsonb_build_object('client_id', '00000000-0000-0000-0000-00000000f613', 'concept', 'storage',
        'unit', 'pallet_month', 'price', 100, 'currency', 'ARS', 'valid_from', '2026-01-01',
        'valid_to', null, 'notes', null, 'area_id', null),
      jsonb_build_object('client_id', '00000000-0000-0000-0000-00000000f613', 'concept', 'storage',
        'unit', 'pallet_month', 'price', 150, 'currency', 'ARS', 'valid_from', '2026-01-01',
        'valid_to', null, 'notes', null, 'area_id', '00000000-0000-0000-0000-00000000f615')),
    '00000000-0000-0000-0000-00000000f601') as id;

select results_eq(
  $$select price, area_id from public.client_tariffs
     where import_run_id = (select id from t_tariffs) order by price$$,
  $$values (100::numeric, null::uuid), (150::numeric, '00000000-0000-0000-0000-00000000f615'::uuid)$$,
  'the general and the area tariff with the same start are two lines'
);

create temporary table t_tariffs_again as
  select public.commit_import_run(
    'client_tariffs', 'tarifas.csv', repeat('8', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(
      jsonb_build_object('client_id', '00000000-0000-0000-0000-00000000f613', 'concept', 'storage',
        'unit', 'pallet_month', 'price', 150, 'currency', 'ARS', 'valid_from', '2026-01-01',
        'valid_to', null, 'notes', null, 'area_id', '00000000-0000-0000-0000-00000000f615')),
    '00000000-0000-0000-0000-00000000f601') as id;

select results_eq(
  $$select inserted_rows, skipped_rows from public.import_runs where id = (select id from t_tariffs_again)$$,
  $$values (0, 1)$$,
  're-importing the area tariff adds nothing'
);

select throws_ok(
  $$select public.commit_import_run(
      'client_tariffs', 'tarifas3.csv', repeat('9', 64), '{}'::jsonb, 1, 0, 0,
      jsonb_build_array(
        jsonb_build_object('client_id', '00000000-0000-0000-0000-00000000f613', 'concept', 'storage',
          'unit', 'pallet_month', 'price', 160, 'currency', 'ARS', 'valid_from', '2026-03-01',
          'valid_to', null, 'notes', null, 'area_id', '00000000-0000-0000-0000-00000000f615')),
      '00000000-0000-0000-0000-00000000f601')$$,
  '23P01',
  null,
  'an area tariff overlapping its own line is refused'
);

select * from finish();
rollback;
