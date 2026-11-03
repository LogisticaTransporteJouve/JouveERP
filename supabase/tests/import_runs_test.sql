-- Importador (20261103110000): commit_import_run inserts a run and its rows,
-- skips what already exists (re-importing adds nothing), gives an imported
-- chofer its driver record and keeps historic payroll and trips in their own
-- tables; undo_import_run deletes a run's rows unless one was edited or is
-- referenced from outside the run; the run and historic-row guards; the RPC
-- grants and RLS by role. One transaction, rolled back.

begin;

select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e501', 'admin@imports.test'),
  ('00000000-0000-0000-0000-00000000e502', 'finance@imports.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000e501', 'admin'),
  ('00000000-0000-0000-0000-00000000e502', 'finance');

-- 1. Grants ------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated',
        'public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid)', 'execute')
  and not has_function_privilege('anon',
        'public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid)', 'execute')
  and has_function_privilege('service_role',
        'public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid)', 'execute'),
  'only the service role runs commit_import_run'
);

select ok(
  not has_function_privilege('authenticated', 'public.undo_import_run(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.undo_import_run(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.undo_import_run(uuid, uuid)', 'execute'),
  'only the service role runs undo_import_run'
);

-- 2. Master data -----------------------------------------------------------------------

create temporary table t_clients as
  select public.commit_import_run(
    'clients', 'clientes.xlsx', repeat('a', 64), '{"legal_name": 0}'::jsonb, 4, 1, 1,
    '[{"legal_name": "Import Uno SA", "cuit": "30999999991", "iva_condition": "responsable_inscripto", "is_fiscal": true},
      {"legal_name": "Kiosco  Import", "cuit": null, "iva_condition": null, "is_fiscal": false},
      {"legal_name": "Import Uno bis", "cuit": "30999999991", "iva_condition": "monotributo", "is_fiscal": true}]'::jsonb,
    '00000000-0000-0000-0000-00000000e501') as id;

select results_eq(
  $$select kind, status, total_rows, inserted_rows, skipped_rows, invalid_rows, created_by
      from public.import_runs where id = (select id from t_clients)$$,
  $$values ('clients'::text, 'committed'::text, 4, 2, 2, 1,
            '00000000-0000-0000-0000-00000000e501'::uuid)$$,
  'the run records its counts: a CUIT repeated in the file is skipped with the preview''s duplicate'
);

select is(
  (select count(*)::int from public.clients where import_run_id = (select id from t_clients)),
  2,
  'the imported clients point at their run'
);

create temporary table t_clients_again as
  select public.commit_import_run(
    'clients', 'clientes.xlsx', repeat('a', 64), '{}'::jsonb, 2, 0, 0,
    '[{"legal_name": "Import Uno SA", "cuit": "30999999991", "iva_condition": "responsable_inscripto", "is_fiscal": true},
      {"legal_name": "kiosco import", "cuit": null, "iva_condition": null, "is_fiscal": false}]'::jsonb,
    '00000000-0000-0000-0000-00000000e501') as id;

select results_eq(
  $$select inserted_rows, skipped_rows from public.import_runs where id = (select id from t_clients_again)$$,
  $$values (0, 2)$$,
  're-importing the same rows adds nothing (CUIT, or name among internal clients)'
);

create temporary table t_employees as
  select public.commit_import_run(
    'employees', 'personal.csv', repeat('b', 64), '{}'::jsonb, 2, 0, 0,
    '[{"legal_name": "Chofer Importado", "position": "Chofer / Acompañante", "cuil": "20999999991",
       "pay_frequency": "mensual", "hire_date": "2020-01-01", "viatico_monthly": 0, "is_monotributo": false},
      {"legal_name": "Ex Empleado", "position": null, "cuil": null, "pay_frequency": "mensual",
       "hire_date": "2018-01-01", "termination_date": "2024-12-31", "viatico_monthly": 0, "is_monotributo": false}]'::jsonb,
    '00000000-0000-0000-0000-00000000e501') as id;

select results_eq(
  $$select d.full_name, d.cuit, d.is_active, d.import_run_id = (select id from t_employees)
      from public.drivers d join public.employees e on e.id = d.employee_id
     where e.import_run_id = (select id from t_employees)$$,
  $$values ('Chofer Importado'::text, '20999999991'::text, true, true)$$,
  'an imported chofer gets its driver record in the same run'
);

select results_eq(
  $$select is_active, termination_date from public.employees
     where import_run_id = (select id from t_employees) and legal_name = 'Ex Empleado'$$,
  $$values (false, '2024-12-31'::date)$$,
  'an employee with a termination date enters inactive'
);

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-00000000e5a1', 'IM 001 AA', 'camion');

create temporary table t_vehicles as
  select public.commit_import_run(
    'vehicles', 'flota.xlsx', repeat('c', 64), '{}'::jsonb, 2, 0, 0,
    '[{"patente": "IM001AA", "vehicle_type": "camion"},
      {"patente": "IM002AA", "vehicle_type": "acoplado"}]'::jsonb,
    '00000000-0000-0000-0000-00000000e501') as id;

select results_eq(
  $$select inserted_rows, skipped_rows from public.import_runs where id = (select id from t_vehicles)$$,
  $$values (1, 1)$$,
  'a patente written differently is still the same vehicle'
);

-- 3. Historic payroll and trips ---------------------------------------------------------

create temporary table t_emp as
  select id from public.employees where cuil = '20999999991';

create temporary table t_payroll as
  select public.commit_import_run(
    'historic_payroll', 'sueldos-2024.xlsx', repeat('d', 64), '{}'::jsonb, 2, 0, 0,
    jsonb_build_array(
      jsonb_build_object('employee_id', (select id from t_emp), 'period', '2024-06', 'kind', 'monthly',
                         'net_amount', 900000, 'paid_amount', 900000, 'paid_on', '2024-07-05'),
      jsonb_build_object('employee_id', (select id from t_emp), 'period', '2024-06', 'kind', 'sac',
                         'net_amount', 450000)),
    '00000000-0000-0000-0000-00000000e501') as id;

select is(
  (select count(*)::int from public.historic_payroll_entries
    where import_run_id = (select id from t_payroll)),
  2,
  'historic payroll lands in its own table, a salary and an aguinaldo of one month'
);

select is(
  (select count(*)::int from public.payroll_entries where employee_id = (select id from t_emp))
  + (select count(*)::int from public.employee_account_movements where employee_id = (select id from t_emp)),
  0,
  'historic payroll writes no payroll entry and no employee account movement'
);

create temporary table t_payroll_again as
  select public.commit_import_run(
    'historic_payroll', 'sueldos-2024.xlsx', repeat('d', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(
      jsonb_build_object('employee_id', (select id from t_emp), 'period', '2024-06', 'kind', 'monthly',
                         'net_amount', 1)),
    '00000000-0000-0000-0000-00000000e501') as id;

select results_eq(
  $$select inserted_rows, skipped_rows from public.import_runs where id = (select id from t_payroll_again)$$,
  $$values (0, 1)$$,
  'an employee''s month and kind is imported once'
);

create temporary table t_trips as
  select public.commit_import_run(
    'historic_trips', 'viajes.csv', repeat('e', 64), '{}'::jsonb, 2, 0, 0,
    jsonb_build_array(
      jsonb_build_object('trip_date', '2024-03-10', 'vehicle_id', '00000000-0000-0000-0000-00000000e5a1',
                         'vehicle_label', 'IM001AA', 'origin', 'Rosario', 'destination', 'Córdoba',
                         'km', 400, 'freight_amount', 350000, 'source_hash', repeat('1', 64)),
      jsonb_build_object('trip_date', '2024-03-11', 'client_id',
                         (select id from public.clients where cuit = '30999999991'),
                         'client_label', 'Import Uno SA', 'source_hash', repeat('2', 64))),
    '00000000-0000-0000-0000-00000000e501') as id;

select results_eq(
  $$select inserted_rows from public.import_runs where id = (select id from t_trips)$$,
  $$values (2)$$,
  'historic trips land in their own table'
);

select is(
  (select count(*)::int from public.trips where vehicle_id = '00000000-0000-0000-0000-00000000e5a1'),
  0,
  'historic trips are not trips: no driver extra, invoice or fleet margin sees them'
);

-- 4. Guards (as the table owner) -------------------------------------------------------------

reset role;

select throws_ok(
  $$update public.historic_trips set freight_amount = 1 where source_hash = repeat('1', 64)$$,
  '55006',
  'Un dato histórico importado no se edita: deshacé su importación y volvé a importar el archivo corregido',
  'a historic trip is not edited'
);

select throws_ok(
  $$delete from public.historic_payroll_entries where import_run_id = (select id from t_payroll)$$,
  '55006',
  'Un dato histórico importado no se borra suelto: deshacé su importación',
  'historic payroll is not deleted outside its undo'
);

select throws_ok(
  $$delete from public.import_runs where id = (select id from t_clients)$$,
  '55006',
  'Una importación no se borra: deshacela',
  'a run is never deleted'
);

select throws_ok(
  $$update public.import_runs set file_name = 'otro.xlsx' where id = (select id from t_clients)$$,
  '55006',
  'Los datos de una importación no se pueden cambiar',
  'a run''s identity does not change'
);

insert into public.import_runs (id, kind, file_name, file_sha256, total_rows, created_at)
values ('00000000-0000-0000-0000-00000000e5f1', 'vehicles', 'viejo.xlsx', repeat('f', 64), 1,
        now() - interval '1 day');

select throws_ok(
  $$update public.import_runs set inserted_rows = 99 where id = '00000000-0000-0000-0000-00000000e5f1'$$,
  '55006',
  'Los totales de una importación no se pueden cambiar',
  'only the transaction that created a run sets its counts'
);

-- A deleted vehicle clears its id from a historic trip; the label stays.
delete from public.vehicles where id = '00000000-0000-0000-0000-00000000e5a1';

select results_eq(
  $$select vehicle_id, vehicle_label from public.historic_trips where source_hash = repeat('1', 64)$$,
  $$values (null::uuid, 'IM001AA'::text)$$,
  'deleting a vehicle keeps the historic trip with its patente'
);

-- 5. Undo ----------------------------------------------------------------------------------------

select throws_ok(
  $$select public.undo_import_run((select id from t_clients), '00000000-0000-0000-0000-00000000e501')$$,
  '55006',
  'No se puede deshacer la importación: sus registros ya se usan en otros datos (historic_trips)',
  'a client a historic trip of another run points at blocks the undo'
);

select public.undo_import_run((select id from t_trips), '00000000-0000-0000-0000-00000000e501');

select results_eq(
  $$select status, undone_by, (select count(*)::int from public.historic_trips
                                 where import_run_id = (select id from t_trips))
      from public.import_runs where id = (select id from t_trips)$$,
  $$values ('undone'::text, '00000000-0000-0000-0000-00000000e501'::uuid, 0)$$,
  'undoing the trips deletes them and marks the run undone'
);

-- An edit in a later transaction stamps updated_at past created_at; this test
-- is one transaction (now() does not move), so the import is moved back.
update public.clients set created_at = created_at - interval '1 day', phone = '341-555'
 where cuit = '30999999991';

select throws_ok(
  $$select public.undo_import_run((select id from t_clients), '00000000-0000-0000-0000-00000000e501')$$,
  '55006',
  'No se puede deshacer la importación: algún registro se editó después de importarlo',
  'a client edited after the import blocks the undo'
);

select public.undo_import_run((select id from t_vehicles), '00000000-0000-0000-0000-00000000e501');

select lives_ok(
  $$select public.undo_import_run((select id from t_vehicles), '00000000-0000-0000-0000-00000000e501')$$,
  'undoing a run twice is a no-op the second time'
);

select throws_ok(
  $$select public.undo_import_run((select id from t_employees), '00000000-0000-0000-0000-00000000e501')$$,
  '55006',
  'No se puede deshacer la importación: sus registros ya se usan en otros datos (historic_payroll_entries)',
  'an employee with historic payroll from another run blocks the undo'
);

select public.undo_import_run((select id from t_payroll), '00000000-0000-0000-0000-00000000e501');
select public.undo_import_run((select id from t_employees), '00000000-0000-0000-0000-00000000e501');

select is(
  (select count(*)::int from public.employees where import_run_id = (select id from t_employees))
  + (select count(*)::int from public.drivers where import_run_id = (select id from t_employees)),
  0,
  'undoing the employees deletes their driver records first'
);

-- 6. RLS -------------------------------------------------------------------------------------------

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000e501","role":"authenticated"}', true);
select ok(
  (select count(*) from public.import_runs) >= 6,
  'an admin sees the runs'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000e502","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.import_runs)
  + (select count(*)::int from public.historic_payroll_entries)
  + (select count(*)::int from public.historic_trips),
  0,
  'finance sees no run and no historic row'
);

reset role;

select * from finish(true);

rollback;
