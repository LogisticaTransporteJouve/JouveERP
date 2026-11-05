-- Auditoría W15 · S4 F1 (20261105120000): a user writes a link to a file
-- (file_attachments, ai_document_extractions.file_id, a fleet or employee
-- document's attachment_file_id) only as itself, for a record its role
-- writes, and for a file it already sees. Each step runs as `authenticated`
-- with a user of one role (operations, finance, admin, warehouse); the chat
-- link runs as service_role. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(38);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001501a1', 'finance@file-link-w15.test'),
  ('00000000-0000-0000-0000-0000001501a2', 'operations@file-link-w15.test'),
  ('00000000-0000-0000-0000-0000001501a3', 'warehouse@file-link-w15.test'),
  ('00000000-0000-0000-0000-0000001501a4', 'admin@file-link-w15.test'),
  ('00000000-0000-0000-0000-0000001501a5', 'finance2@file-link-w15.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001501a1', 'finance'),
  ('00000000-0000-0000-0000-0000001501a2', 'operations'),
  ('00000000-0000-0000-0000-0000001501a3', 'warehouse'),
  ('00000000-0000-0000-0000-0000001501a4', 'admin'),
  ('00000000-0000-0000-0000-0000001501a5', 'finance');

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000001501b1', 'FW15AA1', 'camion');
insert into public.fuel_loads (id, vehicle_id, load_date, liters, amount) values
  ('00000000-0000-0000-0000-0000001501b2', '00000000-0000-0000-0000-0000001501b1',
   current_date, 100, 150000);
insert into public.employees (id, legal_name, pay_frequency, hire_date) values
  ('00000000-0000-0000-0000-0000001501b5', 'Empleado Archivos W15', 'mensual', '2020-01-01');
insert into public.ai_chat_sessions (id, user_id) values
  ('00000000-0000-0000-0000-0000001501b8', '00000000-0000-0000-0000-0000001501a2');
insert into public.ai_chat_messages (id, session_id, role, content) values
  ('00000000-0000-0000-0000-0000001501b9', '00000000-0000-0000-0000-0000001501b8',
   'user', '"hola"'::jsonb);

-- The purchase invoice (and its journal entry) is created as finance.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001501a1","role":"authenticated"}', true);
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001501b3', '30999991528', 'Proveedor Vínculos W15',
   'responsable_inscripto');
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000001501b4', 'jouve_fiscal', '00000000-0000-0000-0000-0000001501b3',
   'factura', 'A', 15, 1501, current_date, 100, 21, 121, 'received');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- c1 finance's own upload, linked to nothing; c2 an operations upload that an
-- existing fleet document and an existing employee document both point at
-- (written before this migration; the fleet ceiling hides it from finance);
-- c3 operations' own upload; c4 finance's scan; c5 finance2's own upload;
-- c6 operations' chat attachment; c7 warehouse's own upload.
insert into public.files (id, uploaded_by, original_filename, bucket, bucket_path, source) values
  ('00000000-0000-0000-0000-0000001501c1', '00000000-0000-0000-0000-0000001501a1',
   'finanzas.pdf', 'files', '00000000-0000-4000-8000-0000001501d1.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001501c2', '00000000-0000-0000-0000-0000001501a2',
   'vtv.pdf', 'files', '00000000-0000-4000-8000-0000001501d2.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001501c3', '00000000-0000-0000-0000-0000001501a2',
   'ticket.jpg', 'files', '00000000-0000-4000-8000-0000001501d3.jpg', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001501c4', '00000000-0000-0000-0000-0000001501a1',
   'compra.pdf', 'files', '00000000-0000-4000-8000-0000001501d4.pdf', 'document_scan'),
  ('00000000-0000-0000-0000-0000001501c5', '00000000-0000-0000-0000-0000001501a5',
   'extracto.pdf', 'files', '00000000-0000-4000-8000-0000001501d5.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001501c6', '00000000-0000-0000-0000-0000001501a2',
   'foto.png', 'files', '00000000-0000-4000-8000-0000001501d6.png', 'chat_attachment'),
  ('00000000-0000-0000-0000-0000001501c7', '00000000-0000-0000-0000-0000001501a3',
   'deposito.pdf', 'files', '00000000-0000-4000-8000-0000001501d7.pdf', 'manual_upload');
insert into public.fleet_documents (id, vehicle_id, kind, expires_at, attachment_file_id) values
  ('00000000-0000-0000-0000-0000001501e1', '00000000-0000-0000-0000-0000001501b1', 'seguro',
   current_date + 200, null),
  ('00000000-0000-0000-0000-0000001501e2', '00000000-0000-0000-0000-0000001501b1', 'vtv',
   current_date + 200, '00000000-0000-0000-0000-0000001501c2');
insert into public.employee_documents (id, employee_id, kind, expires_at, attachment_file_id) values
  ('00000000-0000-0000-0000-0000001501e3', '00000000-0000-0000-0000-0000001501b5', 'otro',
   current_date + 200, '00000000-0000-0000-0000-0000001501c2');

select ok(
  not has_function_privilege('authenticated', 'public.guard_link_file_visible()', 'execute')
  and not has_function_privilege('anon', 'public.guard_link_file_visible()', 'execute'),
  'nobody calls the guard directly'
);

set local role authenticated;

-- 1. Operations ----------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001501a2","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001501c1'),
  0,
  'operations does not see finance''s file'
);
select throws_ok(
  $$insert into public.file_attachments (file_id, kind, fuel_load_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c1', 'otro',
            '00000000-0000-0000-0000-0000001501b2', '00000000-0000-0000-0000-0000001501a2')$$,
  '42501', 'No podés vincular un archivo que no podés ver.',
  'operations cannot link finance''s file, even to a fuel load it writes'
);
select throws_ok(
  $$insert into public.file_attachments (file_id, kind, supplier_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c1', 'otro',
            '00000000-0000-0000-0000-0000001501b3', '00000000-0000-0000-0000-0000001501a2')$$,
  '42501', null,
  'nor to a supplier'
);
select throws_ok(
  $$insert into public.ai_document_extractions (file_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c1', '00000000-0000-0000-0000-0000001501a2')$$,
  '42501', 'No podés vincular un archivo que no podés ver.',
  'nor point an extraction of its own at it'
);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001501c1'),
  0,
  'so finance''s file stays out of its reach'
);
select throws_ok(
  $$insert into public.file_attachments (file_id, kind, purchase_invoice_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c3', 'comprobante',
            '00000000-0000-0000-0000-0000001501b4', '00000000-0000-0000-0000-0000001501a2')$$,
  '42501', 'new row violates row-level security policy for table "file_attachments"',
  'operations cannot attach its own file to a purchase invoice (no purchase_invoices:write)'
);
select throws_ok(
  $$insert into public.file_attachments (file_id, kind, supplier_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c3', 'otro',
            '00000000-0000-0000-0000-0000001501b3', '00000000-0000-0000-0000-0000001501a2')$$,
  '42501', 'new row violates row-level security policy for table "file_attachments"',
  'nor to a supplier (no suppliers:write)'
);
select throws_ok(
  $$insert into public.file_attachments (file_id, kind, fuel_load_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c3', 'remito',
            '00000000-0000-0000-0000-0000001501b2', '00000000-0000-0000-0000-0000001501a1')$$,
  '42501', 'new row violates row-level security policy for table "file_attachments"',
  'nor write a link under another user''s name'
);
select throws_ok(
  $$insert into public.file_attachments (file_id, kind, ai_chat_message_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c6', 'chat_attachment',
            '00000000-0000-0000-0000-0000001501b9', '00000000-0000-0000-0000-0000001501a2')$$,
  '42501', 'new row violates row-level security policy for table "file_attachments"',
  'nor write a chat link (only the chat route does)'
);
select lives_ok(
  $$insert into public.file_attachments (file_id, kind, fuel_load_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c3', 'remito',
            '00000000-0000-0000-0000-0000001501b2', '00000000-0000-0000-0000-0000001501a2')$$,
  'operations attaches its own upload to a fuel load (upload-then-link)'
);
select lives_ok(
  $$insert into public.ai_document_extractions (file_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c3', '00000000-0000-0000-0000-0000001501a2')$$,
  'and scans its own upload'
);

select throws_ok(
  $$update public.fleet_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001501c1'
     where id = '00000000-0000-0000-0000-0000001501e1'$$,
  '42501', 'No podés vincular un archivo que no podés ver.',
  'operations cannot point a fleet document at finance''s file'
);
select throws_ok(
  $$insert into public.fleet_documents (vehicle_id, kind, expires_at, attachment_file_id, created_by)
    values ('00000000-0000-0000-0000-0000001501b1', 'ruta', current_date + 100,
            '00000000-0000-0000-0000-0000001501c1', '00000000-0000-0000-0000-0000001501a2')$$,
  '42501', 'No podés vincular un archivo que no podés ver.',
  'nor create one that points at it'
);
select throws_ok(
  $$insert into public.fleet_documents (vehicle_id, kind, expires_at, created_by)
    values ('00000000-0000-0000-0000-0000001501b1', 'ruta', current_date + 100,
            '00000000-0000-0000-0000-0000001501a1')$$,
  '42501', 'new row violates row-level security policy for table "fleet_documents"',
  'nor create a fleet document under another user''s name'
);
select lives_ok(
  $$insert into public.fleet_documents (vehicle_id, kind, expires_at, attachment_file_id, created_by)
    values ('00000000-0000-0000-0000-0000001501b1', 'ruta', current_date + 100,
            '00000000-0000-0000-0000-0000001501c3', '00000000-0000-0000-0000-0000001501a2')$$,
  'operations creates a fleet document with its own file'
);
select lives_ok(
  $$update public.fleet_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001501c3'
     where id = '00000000-0000-0000-0000-0000001501e1'$$,
  'and points another one at it (upload and replace)'
);
select lives_ok(
  $$update public.fleet_documents set notes = 'renovada'
     where id = '00000000-0000-0000-0000-0000001501e2'$$,
  'and edits a fleet document without touching its file'
);

-- 2. Finance -------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001501a1","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.file_attachments (file_id, kind, purchase_invoice_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c1', 'comprobante',
            '00000000-0000-0000-0000-0000001501b4', '00000000-0000-0000-0000-0000001501a1')$$,
  'finance attaches its own upload to a purchase invoice'
);
select throws_ok(
  $$insert into public.file_attachments (file_id, kind, purchase_invoice_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c3', 'comprobante',
            '00000000-0000-0000-0000-0000001501b4', '00000000-0000-0000-0000-0000001501a1')$$,
  '42501', 'No podés vincular un archivo que no podés ver.',
  'but not operations'' fuel ticket, which it does not see'
);
select throws_ok(
  $$insert into public.file_attachments (file_id, kind, fuel_load_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c1', 'remito',
            '00000000-0000-0000-0000-0000001501b2', '00000000-0000-0000-0000-0000001501a1')$$,
  '42501', 'new row violates row-level security policy for table "file_attachments"',
  'nor attach to a fuel load (no fuel:write)'
);

-- The scan flow: start the extraction, claim it, link the scan to the record.
select lives_ok(
  $$insert into public.ai_document_extractions (id, file_id, created_by)
    values ('00000000-0000-0000-0000-0000001501f1', '00000000-0000-0000-0000-0000001501c4',
            '00000000-0000-0000-0000-0000001501a1')$$,
  'finance scans its own upload'
);
select lives_ok(
  $$update public.ai_document_extractions set status = 'confirmed'
     where id = '00000000-0000-0000-0000-0000001501f1'$$,
  'claims the draft'
);
select lives_ok(
  $$insert into public.file_attachments (file_id, kind, purchase_invoice_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c4', 'comprobante',
            '00000000-0000-0000-0000-0000001501b4', '00000000-0000-0000-0000-0000001501a1')$$,
  'and links the scan to the purchase invoice it became'
);
select throws_ok(
  $$update public.ai_document_extractions
       set file_id = '00000000-0000-0000-0000-0000001501c5'
     where id = '00000000-0000-0000-0000-0000001501f1'$$,
  '42501', 'No podés vincular un archivo que no podés ver.',
  'an extraction cannot be repointed at a colleague''s private file'
);

select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001501c2'),
  0,
  'finance does not see the fleet document''s file'
);
select lives_ok(
  $$update public.employee_documents set notes = 'revisado'
     where id = '00000000-0000-0000-0000-0000001501e3'$$,
  'yet edits the employee document that already pointed at it: existing links are not re-checked'
);
select throws_ok(
  $$update public.employee_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001501c3'
     where id = '00000000-0000-0000-0000-0000001501e3'$$,
  '42501', 'No podés vincular un archivo que no podés ver.',
  'finance cannot point an employee document at a file it does not see'
);
select lives_ok(
  $$insert into public.employee_documents (employee_id, kind, expires_at, attachment_file_id, created_by)
    values ('00000000-0000-0000-0000-0000001501b5', 'arn', current_date + 100,
            '00000000-0000-0000-0000-0000001501c1', '00000000-0000-0000-0000-0000001501a1')$$,
  'finance creates an employee document with its own file'
);
select throws_ok(
  $$insert into public.employee_documents (employee_id, kind, expires_at, created_by)
    values ('00000000-0000-0000-0000-0000001501b5', 'arn', current_date + 100,
            '00000000-0000-0000-0000-0000001501a5')$$,
  '42501', 'new row violates row-level security policy for table "employee_documents"',
  'but not under another user''s name'
);

-- 3. Admin ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001501a4","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.file_attachments (file_id, kind, supplier_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c5', 'otro',
            '00000000-0000-0000-0000-0000001501b3', '00000000-0000-0000-0000-0000001501a4')$$,
  'an admin, who sees every file, links any of them to a supplier'
);
select lives_ok(
  $$insert into public.file_attachments (file_id, kind, fuel_load_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c5', 'remito',
            '00000000-0000-0000-0000-0000001501b2', '00000000-0000-0000-0000-0000001501a4')$$,
  'and to a fuel load'
);
select throws_ok(
  $$insert into public.file_attachments (file_id, kind, supplier_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c5', 'otro',
            '00000000-0000-0000-0000-0000001501b3', '00000000-0000-0000-0000-0000001501a1')$$,
  '42501', 'new row violates row-level security policy for table "file_attachments"',
  'but as itself only'
);
select lives_ok(
  $$update public.fleet_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001501c1'
     where id = '00000000-0000-0000-0000-0000001501e1'$$,
  'an admin points a fleet document at any file'
);

-- 4. Warehouse -----------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001501a3","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.file_attachments (file_id, kind, supplier_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c7', 'otro',
            '00000000-0000-0000-0000-0000001501b3', '00000000-0000-0000-0000-0000001501a3')$$,
  '42501', 'new row violates row-level security policy for table "file_attachments"',
  'warehouse links no file, not even its own'
);
select throws_ok(
  $$insert into public.ai_document_extractions (file_id, created_by)
    values ('00000000-0000-0000-0000-0000001501c7', '00000000-0000-0000-0000-0000001501a3')$$,
  '42501', 'new row violates row-level security policy for table "ai_document_extractions"',
  'nor scans it (no ai:read)'
);

-- 5. The chat route (service role) ----------------------------------------------------

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $$insert into public.file_attachments (file_id, kind, ai_chat_message_id)
    values ('00000000-0000-0000-0000-0000001501c6', 'chat_attachment',
            '00000000-0000-0000-0000-0000001501b9')$$,
  'the chat route still links a chat attachment'
);

reset role;

select is(
  (select count(*)::int from public.file_attachments
    where file_id::text like '00000000-0000-0000-0000-0000001501c%'),
  6,
  'exactly the links the allowed steps wrote'
);

select * from finish();
rollback;
