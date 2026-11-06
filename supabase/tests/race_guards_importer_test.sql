-- 20261106131000-131003: a supplier category or supplier in use is refused
-- by the database (not only by the app's count); bulk pallet codes continue
-- the prefix's numbering inside create_pallets_bulk; the importer writes
-- loans through create_loan_core and takes the driver position as an
-- argument (the 9-argument signature still works); creating a planilla says
-- whether it created it. One transaction, rolled back.

begin;

select plan(17);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000006a7e01', 'admin@race-guards.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000006a7e01', 'admin');

-- 1. Supplier category and supplier in use ---------------------------------------

insert into public.supplier_categories (id, name, slug) values
  ('00000000-0000-0000-0000-0000006a7e11', 'Categoría Carrera', 'categoria_carrera');
insert into public.suppliers (id, is_fiscal, cuit, legal_name, iva_condition, category_id) values
  ('00000000-0000-0000-0000-0000006a7e12', false, null, 'Proveedor Carrera', null,
   '00000000-0000-0000-0000-0000006a7e11');
insert into public.files (id, uploaded_by, original_filename, bucket, bucket_path, source) values
  ('00000000-0000-0000-0000-0000006a7e13', '00000000-0000-0000-0000-0000006a7e01',
   'constancia.pdf', 'files', '00000000-0000-4000-8000-0000006a7e13.pdf', 'manual_upload');
insert into public.file_attachments (file_id, kind, supplier_id, created_by) values
  ('00000000-0000-0000-0000-0000006a7e13', 'otro', '00000000-0000-0000-0000-0000006a7e12',
   '00000000-0000-0000-0000-0000006a7e01');

select throws_ok(
  $$delete from public.supplier_categories where id = '00000000-0000-0000-0000-0000006a7e11'$$,
  '23503',
  null,
  'a category with a supplier is not deleted (the supplier keeps it)'
);

select throws_ok(
  $$delete from public.suppliers where id = '00000000-0000-0000-0000-0000006a7e12'$$,
  '23503',
  null,
  'a supplier with an attached file is not deleted (the file is not wiped)'
);

-- 2. Bulk pallet codes ------------------------------------------------------------

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000006a7e21', false, null, 'Cliente Carrera', null);
insert into public.warehouses (id, name) values
  ('00000000-0000-0000-0000-0000006a7e22', 'Depósito Carrera');
insert into public.pallets (warehouse_id, client_id, code, entry_date) values
  ('00000000-0000-0000-0000-0000006a7e22', '00000000-0000-0000-0000-0000006a7e21', 'RGT-0007', '2026-11-01'),
  ('00000000-0000-0000-0000-0000006a7e22', '00000000-0000-0000-0000-0000006a7e21', 'RGT-X-0099', '2026-11-01');

select is(
  public.create_pallets_bulk(
    'RGT', 2, '00000000-0000-0000-0000-0000006a7e22',
    '00000000-0000-0000-0000-0000006a7e21', '2026-11-06'),
  2,
  'create_pallets_bulk creates the requested pallets'
);

select results_eq(
  $$select code, status from public.pallets
     where code like 'RGT-%' and entry_date = '2026-11-06' order by code$$,
  $$values ('RGT-0008'::text, 'en_deposito'::text), ('RGT-0009', 'en_deposito')$$,
  'the codes continue after the prefix''s highest number (other prefixes ignored)'
);

select throws_ok(
  $$select public.create_pallets_bulk(
      'RG T', 1, '00000000-0000-0000-0000-0000006a7e22',
      '00000000-0000-0000-0000-0000006a7e21', '2026-11-06')$$,
  '22023',
  'El prefijo lleva solo letras, números o guion (hasta 40).',
  'the prefix is letters, digits or dash'
);

select throws_ok(
  $$select public.create_pallets_bulk(
      'RGT', 501, '00000000-0000-0000-0000-0000006a7e22',
      '00000000-0000-0000-0000-0000006a7e21', '2026-11-06')$$,
  '22023',
  'Se cargan de 1 a 500 pallets por vez.',
  'a load is 1 to 500 pallets'
);

-- 3. Importer: loans and drivers -------------------------------------------------

create temporary table t_loans as
  select public.commit_import_run(
    'loans', 'prestamos-carrera.xlsx', repeat('6', 64), '{}'::jsonb, 1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'kind', 'prestamo', 'description', 'Préstamo carrera', 'lender', 'Banco carrera',
      'principal', 1000, 'currency', 'ARS', 'channel_id', 'jouve_internal',
      'installments_count', 2, 'first_due_date', '2026-12-10', 'notes', null,
      'installments', jsonb_build_array(
        jsonb_build_object('number', 1, 'due_date', '2026-12-10', 'amount', 500),
        jsonb_build_object('number', 2, 'due_date', '2027-01-10', 'amount', 500)))),
    '00000000-0000-0000-0000-0000006a7e01', 'Chofer / Acompañante') as id;

select results_eq(
  $$select l.created_by, l.installments_count,
           (select count(*)::int from public.loan_installments i
             where i.loan_id = l.id and i.status = 'pendiente')
      from public.loans l where l.import_run_id = (select id from t_loans)$$,
  $$values ('00000000-0000-0000-0000-0000006a7e01'::uuid, 2, 2)$$,
  'an imported loan is written with its run and its pending schedule'
);

select is(
  (select inserted_rows from public.import_runs where id = (select id from t_loans)),
  1,
  'the run counts the loan'
);

select throws_ok(
  $$select public.commit_import_run(
      'loans', 'prestamos-rotos.xlsx', repeat('8', 64), '{}'::jsonb, 1, 0, 0,
      jsonb_build_array(jsonb_build_object(
        'kind', 'prestamo', 'description', 'Préstamo roto', 'lender', null,
        'principal', 1000, 'currency', 'ARS', 'channel_id', 'jouve_internal',
        'installments_count', 3, 'first_due_date', '2026-12-10', 'notes', null,
        'installments', jsonb_build_array(
          jsonb_build_object('number', 1, 'due_date', '2026-12-10', 'amount', 1000)))),
      '00000000-0000-0000-0000-0000006a7e01', 'Chofer / Acompañante')$$,
  '22023',
  'El cronograma no coincide con la cantidad de cuotas del préstamo',
  'a schedule of another length is refused, as the loan dialog refuses it'
);

create temporary table t_employees as
  select public.commit_import_run(
    'employees', 'personal-carrera.csv', repeat('3', 64), '{}'::jsonb, 1, 0, 0,
    '[{"legal_name": "Chofer Carrera", "position": "Chofer / Acompañante", "cuil": "20999999981",
       "pay_frequency": "mensual", "hire_date": "2020-01-01"}]'::jsonb,
    '00000000-0000-0000-0000-0000006a7e01', 'Chofer / Acompañante') as id;

select is(
  (select count(*)::int from public.drivers where import_run_id = (select id from t_employees)),
  1,
  'an employee with the passed driver position gets its driver record'
);

select throws_ok(
  $$select public.commit_import_run(
      'employees', 'personal-sin-puesto.csv', repeat('4', 64), '{}'::jsonb, 1, 0, 0,
      '[{"legal_name": "Sin Puesto", "position": "Otro", "cuil": "20999999973",
         "pay_frequency": "mensual", "hire_date": "2020-01-01"}]'::jsonb,
      '00000000-0000-0000-0000-0000006a7e01', null)$$,
  '22023',
  'Falta el puesto de chofer para importar empleados',
  'importing employees needs the driver position'
);

create temporary table t_employees_old as
  select public.commit_import_run(
    'employees', 'personal-viejo.csv', repeat('2', 64), '{}'::jsonb, 1, 0, 0,
    '[{"legal_name": "Chofer Viejo", "position": "Chofer / Acompañante", "cuil": "20999999965",
       "pay_frequency": "mensual", "hire_date": "2020-01-01"}]'::jsonb,
    '00000000-0000-0000-0000-0000006a7e01') as id;

select is(
  (select count(*)::int from public.drivers where import_run_id = (select id from t_employees_old)),
  1,
  'the 9-argument signature (older code) still gives a chofer its driver record'
);

-- 4. Planilla created or found ----------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000006a7e01","role":"authenticated"}', true);

create temporary table t_first as
  select * from public.create_payroll_period(2095, 3);

select is(
  (select created from t_first),
  true,
  'the first call creates the planilla'
);

select results_eq(
  $$select period_id, created from public.create_payroll_period(2095, 3)$$,
  $$select period_id, false from t_first$$,
  'a second call returns the same planilla, not created'
);

select is(
  public.seed_payroll_period(2095, 3),
  (select period_id from t_first),
  'seed_payroll_period still returns the planilla''s id'
);

-- 5. Grants -----------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.create_loan_core(jsonb, jsonb, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.create_loan_core(jsonb, jsonb, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated',
        'public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid, text)', 'execute')
  and has_function_privilege('service_role',
        'public.commit_import_run(text, text, text, jsonb, integer, integer, integer, jsonb, uuid, text)', 'execute'),
  'create_loan_core is internal; the new commit_import_run is the service role''s only'
);

select ok(
  has_function_privilege('authenticated',
    'public.create_pallets_bulk(text, integer, uuid, uuid, date, uuid, numeric, text, uuid, text, date)', 'execute')
  and not has_function_privilege('anon',
    'public.create_pallets_bulk(text, integer, uuid, uuid, date, uuid, numeric, text, uuid, text, date)', 'execute')
  and has_function_privilege('authenticated', 'public.create_payroll_period(integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.create_payroll_period(integer, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.create_sac_period(integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.create_sac_period(integer, integer)', 'execute'),
  'the new pallet and planilla functions reach authenticated, never anon'
);

select * from finish();
rollback;
