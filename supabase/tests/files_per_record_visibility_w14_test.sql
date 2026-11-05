-- Auditoría W14 · S4 F1 (20261105100100): a stored file, its attachment rows
-- and its bytes are read only by the roles that read a record it hangs off
-- (a purchase invoice: finance; a supplier: finance and operations; a fuel
-- load: operations; a scan: whoever scanned it; a chat message: the session
-- owner), plus its uploader and owner/admin. Warehouse reads none of them.
-- Each step runs as `authenticated` with a user of one role. One
-- transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001401a1', 'finance@files-record-w14.test'),
  ('00000000-0000-0000-0000-0000001401a2', 'operations@files-record-w14.test'),
  ('00000000-0000-0000-0000-0000001401a3', 'warehouse@files-record-w14.test'),
  ('00000000-0000-0000-0000-0000001401a4', 'admin@files-record-w14.test'),
  ('00000000-0000-0000-0000-0000001401a5', 'finance2@files-record-w14.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001401a1', 'finance'),
  ('00000000-0000-0000-0000-0000001401a2', 'operations'),
  ('00000000-0000-0000-0000-0000001401a3', 'warehouse'),
  ('00000000-0000-0000-0000-0000001401a4', 'admin'),
  ('00000000-0000-0000-0000-0000001401a5', 'finance');

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000001401b1', 'FW14AA1', 'camion');
insert into public.fuel_loads (id, vehicle_id, load_date, liters, amount) values
  ('00000000-0000-0000-0000-0000001401b2', '00000000-0000-0000-0000-0000001401b1',
   current_date, 100, 150000);
insert into public.ai_chat_sessions (id, user_id) values
  ('00000000-0000-0000-0000-0000001401b5', '00000000-0000-0000-0000-0000001401a2');
insert into public.ai_chat_messages (id, session_id, role, content) values
  ('00000000-0000-0000-0000-0000001401b6', '00000000-0000-0000-0000-0000001401b5',
   'user', '"hola"'::jsonb);

-- The purchase invoice (and its journal entry) is created as finance.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001401a1","role":"authenticated"}', true);
insert into public.suppliers (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000001401b3', '30999999987', 'Proveedor Archivos W14',
   'responsable_inscripto');
insert into public.purchase_invoices
  (id, channel_id, supplier_id, kind, letter, punto_venta, numero, fecha, imp_neto, imp_iva, imp_total, status)
values
  ('00000000-0000-0000-0000-0000001401b4', 'jouve_fiscal', '00000000-0000-0000-0000-0000001401b3',
   'factura', 'A', 14, 1401, current_date, 100, 21, 121, 'received');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- c1 the supplier's invoice PDF (purchase invoice); c2 the supplier's
-- constancia (supplier); c3 a fuel ticket (fuel load, uploaded by operations);
-- c4 finance's scanned bank statement (extraction only); c5 finance's scan
-- turned into the purchase invoice (extraction + purchase invoice); c6 a chat
-- attachment in operations' session.
insert into public.files (id, uploaded_by, original_filename, bucket, bucket_path, source) values
  ('00000000-0000-0000-0000-0000001401c1', '00000000-0000-0000-0000-0000001401a1',
   'factura.pdf', 'files', '00000000-0000-4000-8000-0000001401d1.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001401c2', '00000000-0000-0000-0000-0000001401a1',
   'constancia.pdf', 'files', '00000000-0000-4000-8000-0000001401d2.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001401c3', '00000000-0000-0000-0000-0000001401a2',
   'ticket.jpg', 'files', '00000000-0000-4000-8000-0000001401d3.jpg', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001401c4', '00000000-0000-0000-0000-0000001401a1',
   'extracto.pdf', 'files', '00000000-0000-4000-8000-0000001401d4.pdf', 'document_scan'),
  ('00000000-0000-0000-0000-0000001401c5', '00000000-0000-0000-0000-0000001401a1',
   'compra.pdf', 'files', '00000000-0000-4000-8000-0000001401d5.pdf', 'document_scan'),
  ('00000000-0000-0000-0000-0000001401c6', '00000000-0000-0000-0000-0000001401a2',
   'foto.png', 'files', '00000000-0000-4000-8000-0000001401d6.png', 'chat_attachment');
insert into public.file_attachments (file_id, kind, purchase_invoice_id, supplier_id, fuel_load_id, ai_chat_message_id) values
  ('00000000-0000-0000-0000-0000001401c1', 'comprobante', '00000000-0000-0000-0000-0000001401b4', null, null, null),
  ('00000000-0000-0000-0000-0000001401c2', 'otro', null, '00000000-0000-0000-0000-0000001401b3', null, null),
  ('00000000-0000-0000-0000-0000001401c3', 'remito', null, null, '00000000-0000-0000-0000-0000001401b2', null),
  ('00000000-0000-0000-0000-0000001401c5', 'comprobante', '00000000-0000-0000-0000-0000001401b4', null, null, null),
  ('00000000-0000-0000-0000-0000001401c6', 'chat_attachment', null, null, null, '00000000-0000-0000-0000-0000001401b6');
insert into public.ai_document_extractions (file_id, detected_type, status, created_by) values
  ('00000000-0000-0000-0000-0000001401c4', 'bank_statement', 'pending_review',
   '00000000-0000-0000-0000-0000001401a1'),
  ('00000000-0000-0000-0000-0000001401c5', 'purchase_invoice', 'confirmed',
   '00000000-0000-0000-0000-0000001401a1');
insert into storage.objects (bucket_id, name, owner_id) values
  ('files', '00000000-0000-4000-8000-0000001401d1.pdf', '00000000-0000-0000-0000-0000001401a1'),
  ('files', '00000000-0000-4000-8000-0000001401d4.pdf', '00000000-0000-0000-0000-0000001401a1');

-- What each user reads, materialized by the owner so the assertions only
-- compare names.
create temp table t_seen (who text, what text, name text);
grant select, insert on t_seen to authenticated;

create function pg_temp.snapshot(p_who text) returns void
language sql as $$
  insert into t_seen
    select p_who, 'file', f.original_filename
      from public.files f
     where f.id::text like '00000000-0000-0000-0000-0000001401c%'
    union all
    select p_who, 'link', f.original_filename
      from public.file_attachments fa
      join (values
        ('00000000-0000-0000-0000-0000001401c1'::uuid, 'factura.pdf'),
        ('00000000-0000-0000-0000-0000001401c2'::uuid, 'constancia.pdf'),
        ('00000000-0000-0000-0000-0000001401c3'::uuid, 'ticket.jpg'),
        ('00000000-0000-0000-0000-0000001401c5'::uuid, 'compra.pdf'),
        ('00000000-0000-0000-0000-0000001401c6'::uuid, 'foto.png')
      ) as f (id, original_filename) on f.id = fa.file_id
    union all
    select p_who, 'blob', o.name
      from storage.objects o
     where o.bucket_id = 'files'
       and o.name like '00000000-0000-4000-8000-0000001401d%'
    union all
    select p_who, 'hub', h.original_filename
      from public.v_files_hub h
     where h.file_id::text like '00000000-0000-0000-0000-0000001401c%';
$$;

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001401a1","role":"authenticated"}', true);
select pg_temp.snapshot('finance');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001401a5","role":"authenticated"}', true);
select pg_temp.snapshot('finance2');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001401a2","role":"authenticated"}', true);
select pg_temp.snapshot('operations');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001401a3","role":"authenticated"}', true);
select pg_temp.snapshot('warehouse');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001401a4","role":"authenticated"}', true);
select pg_temp.snapshot('admin');

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 1. Warehouse: files:read, but no record it may read ------------------------------

select is((select count(*)::int from t_seen where who = 'warehouse' and what = 'file'), 0,
  'warehouse sees none of the files');
select is((select count(*)::int from t_seen where who = 'warehouse' and what = 'link'), 0,
  'nor their attachment rows');
select is((select count(*)::int from t_seen where who = 'warehouse' and what = 'blob'), 0,
  'nor their bytes');
select is((select count(*)::int from t_seen where who = 'warehouse' and what = 'hub'), 0,
  'nor a files hub row');

-- 2. Operations: suppliers, fuel loads and its own chat ------------------------------

select results_eq(
  $$select name from t_seen where who = 'operations' and what = 'file' order by name$$,
  $$values ('constancia.pdf'::text), ('foto.png'), ('ticket.jpg')$$,
  'operations sees the supplier''s, the fuel load''s and its chat''s files'
);
select results_eq(
  $$select name from t_seen where who = 'operations' and what = 'link' order by name$$,
  $$values ('constancia.pdf'::text), ('foto.png'), ('ticket.jpg')$$,
  'and only those attachment rows'
);
select is((select count(*)::int from t_seen where who = 'operations' and what = 'blob'), 0,
  'operations cannot reach the purchase invoice''s or the scan''s bytes');
select ok(
  not exists (select 1 from t_seen where who = 'operations' and name in ('factura.pdf', 'extracto.pdf', 'compra.pdf')),
  'no purchase invoice file or finance scan reaches operations through any read'
);
select results_eq(
  $$select name from t_seen where who = 'operations' and what = 'hub' order by name$$,
  $$values ('constancia.pdf'::text), ('foto.png'), ('ticket.jpg')$$,
  'the files hub lists the same three'
);

-- 3. Finance: finance records and its own scans --------------------------------------

select results_eq(
  $$select name from t_seen where who = 'finance' and what = 'file' order by name$$,
  $$values ('compra.pdf'::text), ('constancia.pdf'), ('extracto.pdf'), ('factura.pdf')$$,
  'finance sees the purchase invoice''s, the supplier''s and its own scans'
);
select results_eq(
  $$select name from t_seen where who = 'finance' and what = 'link' order by name$$,
  $$values ('compra.pdf'::text), ('constancia.pdf'), ('factura.pdf')$$,
  'and the purchase invoice''s and supplier''s attachment rows, not fuel or chat'
);
select is((select count(*)::int from t_seen where who = 'finance' and what = 'blob'), 2,
  'finance reaches the invoice PDF''s and its scan''s bytes');
select ok(
  not exists (select 1 from t_seen where who = 'finance' and name in ('ticket.jpg', 'foto.png')),
  'finance does not see the fuel ticket or operations'' chat file'
);

-- 4. Another finance user: the records, not the colleague's unattached scan ------------

select results_eq(
  $$select name from t_seen where who = 'finance2' and what = 'file' order by name$$,
  $$values ('compra.pdf'::text), ('constancia.pdf'), ('factura.pdf')$$,
  'a scan attached to a purchase invoice is read through it; the bank statement scan is not'
);
select results_eq(
  $$select name from t_seen where who = 'finance2' and what = 'blob'$$,
  $$values ('00000000-0000-4000-8000-0000001401d1.pdf'::text)$$,
  'only the invoice PDF''s bytes'
);
select ok(
  not exists (select 1 from t_seen where who = 'finance2' and name = 'extracto.pdf'),
  'the colleague''s scan is not in the hub either'
);

-- 5. Admin: everything ---------------------------------------------------------------

select is((select count(*)::int from t_seen where who = 'admin' and what = 'file'), 6,
  'an admin sees every file');
select is((select count(*)::int from t_seen where who = 'admin' and what = 'link'), 5,
  'and every attachment row');
select is((select count(*)::int from t_seen where who = 'admin' and what = 'blob'), 2,
  'and every blob');

-- 6. The uploader keeps its file; writes are unchanged -------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001401a3","role":"authenticated"}', true);
select lives_ok(
  $$insert into public.files (id, uploaded_by, original_filename, bucket, bucket_path, source)
    values ('00000000-0000-0000-0000-0000001401c7', '00000000-0000-0000-0000-0000001401a3',
            'propio.pdf', 'files', '00000000-0000-4000-8000-0000001401d7.pdf', 'manual_upload')$$,
  'warehouse registers its own upload'
);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001401c7'),
  1,
  'and sees it'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001401a2","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001401c3'),
  1,
  'operations still reads the fuel ticket it uploaded'
);
select lives_ok(
  $$insert into public.file_attachments (file_id, kind, fuel_load_id, created_by)
    values ('00000000-0000-0000-0000-0000001401c3', 'otro',
            '00000000-0000-0000-0000-0000001401b2', '00000000-0000-0000-0000-0000001401a2')$$,
  'operations still attaches to a fuel load'
);
select is(
  (select count(*)::int from public.file_attachments
    where file_id = '00000000-0000-0000-0000-0000001401c3'),
  2,
  'and reads the new link'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001401a5","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.ai_document_extractions
    where file_id = '00000000-0000-0000-0000-0000001401c5'),
  0,
  'the scan''s extraction stays its creator''s (finance2 reads the file only through the invoice)'
);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001401c3'),
  0,
  'finance2 does not read the fuel ticket another role uploaded'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 7. A file attached to a record of each side is read by both -------------------------

insert into public.file_attachments (file_id, kind, supplier_id) values
  ('00000000-0000-0000-0000-0000001401c1', 'otro', '00000000-0000-0000-0000-0000001401b3');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001401a2","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001401c1'),
  1,
  'operations reads the invoice PDF once it is also attached to the supplier'
);
select is(
  (select count(*)::int from public.file_attachments
    where file_id = '00000000-0000-0000-0000-0000001401c1'),
  1,
  'but only the supplier''s link, not the purchase invoice''s'
);
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001401d1.pdf'),
  1,
  'and its bytes'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 8. The accountant's tax policy is untouched ----------------------------------------

select ok(
  exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'file_attachments'
             and policyname = 'Tax readers view tax document attachments')
  and exists (select 1 from pg_policies
           where schemaname = 'public' and tablename = 'files'
             and policyname = 'Tax readers view tax document files'),
  'the tax readers'' policies are still there'
);

select * from finish();
rollback;
