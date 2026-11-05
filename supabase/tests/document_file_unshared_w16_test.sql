-- Auditoría W16 · S4 F1 (20261105130100): a fleet or employee document may
-- only point at a file nothing else links, so a document can no longer hide a
-- client's or supplier's file from the other role behind the fleet or HR
-- ceiling on files. Upload-then-link, replace, clear, editing a document that
-- already had a shared file and the expiry cron still pass. Steps run as
-- `authenticated` with an operations or a finance user, then as service_role
-- and as the owner. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001601a1', 'operations@doc-file-w16.test'),
  ('00000000-0000-0000-0000-0000001601a2', 'finance@doc-file-w16.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001601a1', 'operations'),
  ('00000000-0000-0000-0000-0000001601a2', 'finance');

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000001601b1', 'FW16AA1', 'camion');
insert into public.employees (id, legal_name, pay_frequency, hire_date) values
  ('00000000-0000-0000-0000-0000001601b2', 'Empleado Archivos W16', 'mensual', '2020-01-01');
insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001601b3', false, null, 'Cliente Archivos W16', null);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001601a2","role":"authenticated"}', true);
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001601b4', '30999991528', 'Proveedor Archivos W16',
   'responsable_inscripto');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- c1 finance's contract on the client; c2 finance's constancia on the
-- supplier; c3 operations' fresh upload; c4 finance's fresh upload; c5
-- operations' scan (an extraction reads it); c6 a fleet document's file that
-- a client attachment was added to afterwards (an existing shared file); c7
-- operations' fresh upload, used to replace.
insert into public.files (id, uploaded_by, original_filename, bucket, bucket_path, source) values
  ('00000000-0000-0000-0000-0000001601c1', '00000000-0000-0000-0000-0000001601a2',
   'contrato.pdf', 'files', '00000000-0000-4000-8000-0000001601d1.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001601c2', '00000000-0000-0000-0000-0000001601a2',
   'constancia.pdf', 'files', '00000000-0000-4000-8000-0000001601d2.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001601c3', '00000000-0000-0000-0000-0000001601a1',
   'vtv.pdf', 'files', '00000000-0000-4000-8000-0000001601d3.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001601c4', '00000000-0000-0000-0000-0000001601a2',
   'apto.pdf', 'files', '00000000-0000-4000-8000-0000001601d4.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001601c5', '00000000-0000-0000-0000-0000001601a1',
   'remito.pdf', 'files', '00000000-0000-4000-8000-0000001601d5.pdf', 'document_scan'),
  ('00000000-0000-0000-0000-0000001601c6', '00000000-0000-0000-0000-0000001601a1',
   'seguro.pdf', 'files', '00000000-0000-4000-8000-0000001601d6.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001601c7', '00000000-0000-0000-0000-0000001601a1',
   'vtv-nueva.pdf', 'files', '00000000-0000-4000-8000-0000001601d7.pdf', 'manual_upload');
insert into public.file_attachments (file_id, kind, client_id, created_by) values
  ('00000000-0000-0000-0000-0000001601c1', 'otro', '00000000-0000-0000-0000-0000001601b3',
   '00000000-0000-0000-0000-0000001601a2');
insert into public.file_attachments (file_id, kind, supplier_id, created_by) values
  ('00000000-0000-0000-0000-0000001601c2', 'otro', '00000000-0000-0000-0000-0000001601b4',
   '00000000-0000-0000-0000-0000001601a2');
insert into public.ai_document_extractions (file_id, created_by) values
  ('00000000-0000-0000-0000-0000001601c5', '00000000-0000-0000-0000-0000001601a1');
insert into public.fleet_documents (id, vehicle_id, kind, expires_at, attachment_file_id) values
  ('00000000-0000-0000-0000-0000001601e1', '00000000-0000-0000-0000-0000001601b1', 'seguro',
   current_date + 200, null),
  ('00000000-0000-0000-0000-0000001601e2', '00000000-0000-0000-0000-0000001601b1', 'vtv',
   current_date + 3, '00000000-0000-0000-0000-0000001601c6');
-- Written before this migration's rule existed; the guard skips attachments.
insert into public.file_attachments (file_id, kind, client_id, created_by) values
  ('00000000-0000-0000-0000-0000001601c6', 'otro', '00000000-0000-0000-0000-0000001601b3',
   '00000000-0000-0000-0000-0000001601a1');
insert into public.employee_documents (id, employee_id, kind, expires_at) values
  ('00000000-0000-0000-0000-0000001601e3', '00000000-0000-0000-0000-0000001601b2', 'otro',
   current_date + 200);

select ok(
  has_function_privilege('authenticated', 'public.is_linked_file(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.is_linked_file(uuid)', 'execute'),
  'the invoker guard''s callers can ask whether a file is linked'
);

set local role authenticated;

-- 1. Operations ----------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001601a1","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001601c1'),
  1,
  'operations sees the client''s contract'
);
select throws_ok(
  $$update public.fleet_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001601c1'
     where id = '00000000-0000-0000-0000-0000001601e1'$$,
  '55006', 'Ese archivo ya está vinculado a otro registro.',
  'but cannot point a fleet document at it'
);
select throws_ok(
  $$insert into public.fleet_documents (vehicle_id, kind, expires_at, attachment_file_id, created_by)
    values ('00000000-0000-0000-0000-0000001601b1', 'ruta', current_date + 100,
            '00000000-0000-0000-0000-0000001601c1', '00000000-0000-0000-0000-0000001601a1')$$,
  '55006', 'Ese archivo ya está vinculado a otro registro.',
  'nor create one that points at it'
);
select throws_ok(
  $$insert into public.fleet_documents (vehicle_id, kind, expires_at, attachment_file_id, created_by)
    values ('00000000-0000-0000-0000-0000001601b1', 'ruta', current_date + 100,
            '00000000-0000-0000-0000-0000001601c5', '00000000-0000-0000-0000-0000001601a1')$$,
  '55006', 'Ese archivo ya está vinculado a otro registro.',
  'nor at its own scan, which an extraction reads'
);
select lives_ok(
  $$insert into public.fleet_documents (id, vehicle_id, kind, expires_at, attachment_file_id, created_by)
    values ('00000000-0000-0000-0000-0000001601e4', '00000000-0000-0000-0000-0000001601b1',
            'ruta', current_date + 100,
            '00000000-0000-0000-0000-0000001601c3', '00000000-0000-0000-0000-0000001601a1')$$,
  'operations creates a fleet document with its fresh upload'
);
select throws_ok(
  $$update public.fleet_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001601c3'
     where id = '00000000-0000-0000-0000-0000001601e1'$$,
  '55006', 'Ese archivo ya está vinculado a otro registro.',
  'and cannot point a second fleet document at that file'
);
select lives_ok(
  $$update public.fleet_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001601c7'
     where id = '00000000-0000-0000-0000-0000001601e4'$$,
  'replaces the file with another fresh upload'
);
select lives_ok(
  $$update public.fleet_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001601c3'
     where id = '00000000-0000-0000-0000-0000001601e1'$$,
  'then links the file nothing points at any more to another document'
);
select lives_ok(
  $$update public.fleet_documents set attachment_file_id = null
     where id = '00000000-0000-0000-0000-0000001601e1'$$,
  'clears a document''s file'
);
select lives_ok(
  $$update public.fleet_documents set notes = 'renovada', expires_at = current_date + 400
     where id = '00000000-0000-0000-0000-0000001601e2'$$,
  'and edits a document whose file was already shared: existing links are not re-checked'
);

-- 2. Finance -------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001601a2","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001601c1'),
  1,
  'finance still reads the client''s contract'
);
select throws_ok(
  $$update public.employee_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001601c2'
     where id = '00000000-0000-0000-0000-0000001601e3'$$,
  '55006', 'Ese archivo ya está vinculado a otro registro.',
  'finance cannot point an employee document at the supplier''s file'
);
select throws_ok(
  $$insert into public.employee_documents (employee_id, kind, expires_at, attachment_file_id, created_by)
    values ('00000000-0000-0000-0000-0000001601b2', 'arn', current_date + 100,
            '00000000-0000-0000-0000-0000001601c2', '00000000-0000-0000-0000-0000001601a2')$$,
  '55006', 'Ese archivo ya está vinculado a otro registro.',
  'nor create one that points at it'
);
select throws_ok(
  $$insert into public.employee_documents (employee_id, kind, expires_at, attachment_file_id, created_by)
    values ('00000000-0000-0000-0000-0000001601b2', 'arn', current_date + 100,
            '00000000-0000-0000-0000-0000001601c7', '00000000-0000-0000-0000-0000001601a2')$$,
  '42501', 'No podés vincular un archivo que no podés ver.',
  'a file it does not see is refused as unseen, before the link check can tell it anything'
);
select lives_ok(
  $$insert into public.employee_documents (id, employee_id, kind, expires_at, attachment_file_id, created_by)
    values ('00000000-0000-0000-0000-0000001601e5', '00000000-0000-0000-0000-0000001601b2',
            'arn', current_date + 100,
            '00000000-0000-0000-0000-0000001601c4', '00000000-0000-0000-0000-0000001601a2')$$,
  'finance creates an employee document with its fresh upload'
);
select throws_ok(
  $$update public.employee_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001601c4'
     where id = '00000000-0000-0000-0000-0000001601e3'$$,
  '55006', 'Ese archivo ya está vinculado a otro registro.',
  'and cannot point a second employee document at that file'
);
select lives_ok(
  $$update public.employee_documents set notes = 'revisado', expires_at = current_date + 300
     where id = '00000000-0000-0000-0000-0000001601e5'$$,
  'edits that document without touching its file'
);

-- 3. Operations, after finance's writes ----------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001601a1","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001601c2'),
  1,
  'operations still reads the supplier''s constancia'
);

-- 4. The expiry crons and the importer (service role and SECURITY DEFINER) ------------

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $$update public.fleet_documents set notified_at = now()
     where id = '00000000-0000-0000-0000-0000001601e2'$$,
  'the fleet expiry cron marks a document whose file is shared'
);
select lives_ok(
  $$update public.employee_documents set notified_at = now()
     where id = '00000000-0000-0000-0000-0000001601e5'$$,
  'the HR expiry cron marks a document'
);
select throws_ok(
  $$update public.fleet_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001601c2'
     where id = '00000000-0000-0000-0000-0000001601e1'$$,
  '55006', 'Ese archivo ya está vinculado a otro registro.',
  'the service role, which sees every file, is held to the same rule'
);

reset role;

select lives_ok(
  $$insert into public.fleet_documents (vehicle_id, kind, expires_at)
    values ('00000000-0000-0000-0000-0000001601b1', 'ruta', current_date + 100)$$,
  'a document with no file (as the importer writes) passes'
);
select throws_ok(
  $$insert into public.employee_documents (employee_id, kind, expires_at, attachment_file_id)
    values ('00000000-0000-0000-0000-0000001601b2', 'otro', current_date + 100,
            '00000000-0000-0000-0000-0000001601c1')$$,
  '55006', 'Ese archivo ya está vinculado a otro registro.',
  'and so is the table owner'
);
select is(
  (select count(*)::int from public.fleet_documents
    where attachment_file_id in ('00000000-0000-0000-0000-0000001601c1',
                                 '00000000-0000-0000-0000-0000001601c2'))
  + (select count(*)::int from public.employee_documents
      where attachment_file_id in ('00000000-0000-0000-0000-0000001601c1',
                                   '00000000-0000-0000-0000-0000001601c2')),
  0,
  'no document points at the client''s or the supplier''s file'
);

select * from finish();
rollback;
