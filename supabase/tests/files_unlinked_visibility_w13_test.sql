-- Auditoría W13 · S4 F2 and F3 (20261105090100): a file nothing links is seen
-- only by its uploader and owner/admin (a replaced or orphaned fleet document
-- scan stops reaching finance and warehouse), the upload-then-link flow keeps
-- working, and no one refills a key a registry row names. Run as
-- `authenticated`. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- Newer storage versions refuse a direct SQL delete unless this is set.
select set_config('storage.allow_delete_query', 'true', true);

select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001305a1', 'operations@files-unlinked-w13.test'),
  ('00000000-0000-0000-0000-0000001305a2', 'finance@files-unlinked-w13.test'),
  ('00000000-0000-0000-0000-0000001305a3', 'warehouse@files-unlinked-w13.test'),
  ('00000000-0000-0000-0000-0000001305a4', 'admin@files-unlinked-w13.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001305a1', 'operations'),
  ('00000000-0000-0000-0000-0000001305a2', 'finance'),
  ('00000000-0000-0000-0000-0000001305a3', 'warehouse'),
  ('00000000-0000-0000-0000-0000001305a4', 'admin');

insert into public.vehicles (id, patente, vehicle_type) values
  ('00000000-0000-0000-0000-0000001305b1', 'FW13AA1', 'camion');
insert into public.tax_documents (id, kind, period, due_date) values
  ('00000000-0000-0000-0000-0000001305b2', 'iva', '2097-04', current_date + 10);

-- c1: a fleet document's scan, about to be replaced; c2: attached to a tax
-- document (finance reads it). Both uploaded by operations.
insert into public.files (id, uploaded_by, original_filename, bucket, bucket_path, source) values
  ('00000000-0000-0000-0000-0000001305c1', '00000000-0000-0000-0000-0000001305a1',
   'licencia.pdf', 'files', '00000000-0000-4000-8000-0000001305d1.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001305c2', '00000000-0000-0000-0000-0000001305a1',
   'vep.pdf', 'files', '00000000-0000-4000-8000-0000001305d2.pdf', 'manual_upload');
insert into public.file_attachments (file_id, kind, tax_document_id) values
  ('00000000-0000-0000-0000-0000001305c2', 'vep', '00000000-0000-0000-0000-0000001305b2');
insert into public.fleet_documents (id, vehicle_id, kind, expires_at, attachment_file_id) values
  ('00000000-0000-0000-0000-0000001305e1', '00000000-0000-0000-0000-0000001305b1', 'vtv',
   current_date + 200, '00000000-0000-0000-0000-0000001305c1');
insert into storage.objects (bucket_id, name, owner_id) values
  ('files', '00000000-0000-4000-8000-0000001305d1.pdf', '00000000-0000-0000-0000-0000001305a1'),
  ('files', '00000000-0000-4000-8000-0000001305d2.pdf', '00000000-0000-0000-0000-0000001305a1');

select ok(
  public.is_linked_file('00000000-0000-0000-0000-0000001305c1')
  and public.is_linked_file('00000000-0000-0000-0000-0000001305c2'),
  'a fleet document scan and an attachment are linked'
);
select ok(
  not has_function_privilege('anon', 'public.is_linked_file(uuid)', 'execute'),
  'anon cannot call is_linked_file'
);

-- 1. Upload, then link, as operations ------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001305a1","role":"authenticated"}', true);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('files', '00000000-0000-4000-8000-0000001305d3.pdf',
            '00000000-0000-0000-0000-0000001305a1')$$,
  'operations uploads the new scan''s bytes to a fresh key'
);
select lives_ok(
  $$insert into public.files (id, uploaded_by, original_filename, bucket, bucket_path, source)
    values ('00000000-0000-0000-0000-0000001305c3', '00000000-0000-0000-0000-0000001305a1',
            'licencia-nueva.pdf', 'files', '00000000-0000-4000-8000-0000001305d3.pdf',
            'manual_upload')$$,
  'and registers it'
);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001305c3'),
  1,
  'the uploader sees the new file before it is linked'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001305a2","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001305c3'),
  0,
  'finance does not see another user''s file nothing links'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001305a1","role":"authenticated"}', true);
select lives_ok(
  $$update public.fleet_documents
       set attachment_file_id = '00000000-0000-0000-0000-0000001305c3'
     where id = '00000000-0000-0000-0000-0000001305e1'$$,
  'operations points the fleet document at the new scan'
);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001305c1'),
  1,
  'the uploader still sees the replaced scan'
);

-- 2. The replaced scan, now linked to nothing ---------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001305a2","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001305c1'),
  0,
  'finance does not see the replaced fleet scan'
);
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001305d1.pdf'),
  0,
  'nor its bytes'
);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001305c2'),
  1,
  'finance still reads a linked file another user uploaded'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001305a3","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001305c1'),
  0,
  'warehouse does not see the replaced fleet scan'
);
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001305d1.pdf'),
  0,
  'nor its bytes'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001305a4","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.files where id = '00000000-0000-0000-0000-0000001305c1'),
  1,
  'an admin still sees it'
);

-- 3. No one refills a key a registry row names (F3) ---------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001305a1","role":"authenticated"}', true);
delete from storage.objects
 where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001305d2.pdf';
select is(
  public.files_storage_key_is_free('00000000-0000-4000-8000-0000001305d2.pdf'),
  false,
  'the uploader''s own linked key is taken'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('files', '00000000-0000-4000-8000-0000001305d2.pdf',
            '00000000-0000-0000-0000-0000001305a1')$$,
  '42501', null,
  'the uploader cannot upload other bytes under their linked file''s key'
);
select is(
  public.files_storage_key_is_free('00000000-0000-4000-8000-0000001305d9.pdf'),
  true,
  'a key no row names is still free'
);

reset role;
select * from finish();
rollback;
