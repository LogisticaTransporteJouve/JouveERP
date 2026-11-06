-- HR writes made atomic (20261106112001): final settlement, vacation opening,
-- employee create/update/terminate with its driver record, and the guard that
-- keeps a manual attendance upsert off a synced day. One transaction, rolled
-- back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select plan(27);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000003a7001', 'finance@hr-atomic.test'),
  ('00000000-0000-0000-0000-0000003a7002', 'admin@hr-atomic.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000003a7001', 'finance'),
  ('00000000-0000-0000-0000-0000003a7002', 'admin');

insert into public.employees (id, legal_name, position, pay_frequency, hire_date, notes) values
  ('00000000-0000-0000-0000-0000003a7e01', 'Empleado Atómico', 'Chofer / Acompañante', 'mensual', '2020-01-01', 'Ingresó por recomendación.');
insert into public.drivers (id, employee_id, full_name, is_active, license_number) values
  ('00000000-0000-0000-0000-0000003a7d01', '00000000-0000-0000-0000-0000003a7e01', 'Empleado Atómico', true, 'L-1');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000003a7001","role":"authenticated"}', true);

-- 1. Final settlement -------------------------------------------------------------

create temp table fs on commit drop as
select public.apply_final_settlement(
  '00000000-0000-0000-0000-0000003a7e01', 2088, 5, 1000, 200,
  'Liquidación final:', 300, 'Liquidación final: SAC proporcional (1er SAC 2088)') as entry_id;

insert into public.payroll_entry_extras (entry_id, amount, description, sort_order)
select entry_id, 50, 'Adelanto', 1 from fs;

select lives_ok(
  $$ select public.apply_final_settlement(
       '00000000-0000-0000-0000-0000003a7e01', 2088, 5, 1100, 250,
       'Liquidación final:', 400, 'Liquidación final: SAC proporcional (1er SAC 2088)') $$,
  'applying again passes'
);

select is(
  (select array_agg(description || '=' || amount order by description)
     from public.payroll_entry_extras x join fs on fs.entry_id = x.entry_id),
  array['Adelanto=50.00', 'Liquidación final: SAC proporcional (1er SAC 2088)=400.00'],
  'it replaces the settlement extra and keeps the others'
);

-- A failed SAC insert (null description) undoes the whole call.
select throws_ok(
  $$ select public.apply_final_settlement(
       '00000000-0000-0000-0000-0000003a7e01', 2088, 5, 9999, 9999,
       'Liquidación final:', 500, null) $$,
  '23502',
  null,
  'a failing SAC insert fails the call'
);

select is(
  (select sueldo_neto || '/' || (select count(*) from public.payroll_entry_extras x
                                   where x.entry_id = e.id and x.description like 'Liquidación final:%')
     from public.payroll_entries e join fs on fs.entry_id = e.id),
  '1100.00/1',
  'and leaves the line and its SAC extra as they were'
);

-- 2. Vacation opening -------------------------------------------------------------

select throws_ok(
  $$ select public.set_vacation_opening('00000000-0000-0000-0000-0000003a7e01', '2026-11-02', 14, 5) $$,
  '42501',
  null,
  'finance cannot load vacation days'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000003a7002","role":"authenticated"}', true);

select is(
  public.set_vacation_opening('00000000-0000-0000-0000-0000003a7e01', '2026-11-02', 14, 5),
  2026,
  'the period in course from October 1 is the current year'
);

select is(
  (select array_agg(period_year || ':' || entitled_days || ':' || status || ':' || granted_at || ':' || expires_at
                    order by period_year)
     from public.employee_vacation_balances where employee_id = '00000000-0000-0000-0000-0000003a7e01'),
  array['2025:5:extended:2025-10-01:2026-04-30', '2026:14:active:2026-10-01:2027-04-30'],
  'it creates both periods for an employee without balances'
);

update public.employee_vacation_balances set used_days = 3, status = 'expired'
 where employee_id = '00000000-0000-0000-0000-0000003a7e01' and period_year = 2025;

select lives_ok(
  $$ select public.set_vacation_opening('00000000-0000-0000-0000-0000003a7e01', '2026-11-02', null, 7) $$,
  'pending days on a period with days used'
);

select is(
  (select entitled_days || ':' || status from public.employee_vacation_balances
    where employee_id = '00000000-0000-0000-0000-0000003a7e01' and period_year = 2025),
  '10:extended',
  'leave the pending days equal to the figure entered, net of the days used'
);

update public.employee_vacation_balances set bonus_days = 20
 where employee_id = '00000000-0000-0000-0000-0000003a7e01' and period_year = 2025;

select throws_ok(
  $$ select public.set_vacation_opening('00000000-0000-0000-0000-0000003a7e01', '2026-11-02', 21, 2) $$,
  '23514',
  'El período 2025 ya tiene más días tomados o asignados que los que querés cargar.',
  'a figure below what the earlier period already has is refused'
);

select is(
  (select entitled_days from public.employee_vacation_balances
    where employee_id = '00000000-0000-0000-0000-0000003a7e01' and period_year = 2026),
  14,
  'and the period in course written before it is undone'
);

select is(
  public.set_vacation_opening('00000000-0000-0000-0000-0000003a7e01', '2026-09-30', p_previous_days => 0),
  2025,
  'before October 1 the period in course is the previous year'
);

-- 3. Create employee --------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000003a7001","role":"authenticated"}', true);

select throws_ok(
  $$ select public.create_employee(
       '{"legal_name":"Chofer Sin Vacaciones","position":"Chofer / Acompañante","pay_frequency":"mensual","hire_date":"2026-01-01"}'::jsonb,
       'Chofer / Acompañante', '{"license_number":"L-9"}'::jsonb, '2026-11-02', 14) $$,
  '42501',
  null,
  'finance cannot load the vacation days with the employee'
);

select is(
  (select count(*) from public.employees where legal_name = 'Chofer Sin Vacaciones'),
  0::bigint,
  'and the employee is not left half created'
);

create temp table ce on commit drop as
select public.create_employee(
  '{"legal_name":"Chofer Nuevo","position":"Chofer / Acompañante","cuil":"20123456786","pay_frequency":"mensual","hire_date":"2026-01-01","created_by":"00000000-0000-0000-0000-0000003a7001"}'::jsonb,
  'Chofer / Acompañante', '{"license_number":"L-9","phone":null}'::jsonb, '2026-11-02') as id;

select is(
  (select d.full_name || ':' || d.cuit || ':' || d.license_number || ':' || d.is_active || ':' || coalesce(d.phone, '-')
     from public.drivers d join ce on ce.id = d.employee_id),
  'Chofer Nuevo:20123456786:L-9:true:-',
  'a driver gets its driver record from the employee'
);

select throws_ok(
  $$ select public.create_employee('{"is_active":false}'::jsonb, 'Chofer / Acompañante', null, '2026-11-02') $$,
  'P0001',
  'p_employee has a field that is not editable',
  'a field outside the editable list is refused'
);

-- 4. Update employee --------------------------------------------------------------

select is(
  public.update_employee(
    (select id from ce), '{"legal_name":"Chofer Renombrado","position":"Administrativo"}'::jsonb,
    'Chofer / Acompañante', '{}'::jsonb) ->> 'legal_name',
  'Chofer Nuevo',
  'an update returns the previous name'
);

select is(
  (select d.full_name || ':' || d.is_active from public.drivers d join ce on ce.id = d.employee_id),
  'Chofer Renombrado:false',
  'leaving the driver position deactivates the driver record, renamed'
);

select lives_ok(
  format($$ select public.update_employee(%L, '{"notes":"Turno noche"}'::jsonb, 'Chofer / Acompañante', '{"phone":"1155"}'::jsonb) $$,
         (select id from ce)),
  'an edit of a former driver'
);

select is(
  (select coalesce(d.phone, '-') || ':' || d.is_active from public.drivers d join ce on ce.id = d.employee_id),
  '-:false',
  'leaves the inactive driver record as it is'
);

select is(
  public.update_employee('00000000-0000-0000-0000-0000003a7eff', '{"notes":"x"}'::jsonb, 'Chofer / Acompañante', null),
  null::jsonb,
  'an update of an employee that is not there returns null'
);

-- 5. Terminate employee -----------------------------------------------------------

select is(
  public.terminate_employee('00000000-0000-0000-0000-0000003a7e01', '2026-11-05', 'Renuncia.'),
  true,
  'terminating an employee'
);

select is(
  (select notes || '|' || is_active || '|' || termination_date from public.employees
    where id = '00000000-0000-0000-0000-0000003a7e01'),
  E'Ingresó por recomendación.\n\nRenuncia.|false|2026-11-05',
  'appends the reason to the notes it had'
);

select is(
  (select is_active from public.drivers where id = '00000000-0000-0000-0000-0000003a7d01'),
  false,
  'and deactivates its driver record'
);

select is(
  public.terminate_employee('00000000-0000-0000-0000-0000003a7eff', '2026-11-05', null),
  false,
  'terminating an employee that is not there returns false'
);

-- 6. Attendance -------------------------------------------------------------------

insert into public.employee_leaves (employee_id, start_date, end_date, kind) values
  ((select id from ce), '2026-11-10', '2026-11-10', 'vacaciones');

select throws_ok(
  format($$ insert into public.attendance_records (employee_id, date, kind, source)
            values (%L, '2026-11-10', 'late', 'manual')
            on conflict (employee_id, date) do update set kind = excluded.kind, source = excluded.source $$,
         (select id from ce)),
  '55000',
  'Ese día lo carga una licencia o un feriado: cambialo desde su origen, no desde la asistencia.',
  'a manual upsert does not overwrite a day synced from a leave'
);

select lives_ok(
  format($$ insert into public.attendance_records (employee_id, date, kind, source)
            values (%L, '2026-11-11', 'late', 'manual')
            on conflict (employee_id, date) do update set kind = 'absent_unjustified', source = excluded.source $$,
         (select id from ce)),
  'a manual day is still upserted'
);

select * from finish();
rollback;
