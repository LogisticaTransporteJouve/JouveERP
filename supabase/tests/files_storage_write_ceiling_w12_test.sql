-- Auditoría W12 · S4 F1 (20261104194101): a stored file in the `files` bucket
-- is deleted only by whoever uploaded its bytes or by owner/admin, and is
-- written only by the files:write roles, never under a key another user's
-- registry row names. Run as `authenticated` (storage RLS). One transaction,
-- rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- Newer storage versions refuse a direct SQL delete unless this is set.
select set_config('storage.allow_delete_query', 'true', true);

select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001295a1', 'uploader@files-storage-w12.test'),
  ('00000000-0000-0000-0000-0000001295a2', 'warehouse@files-storage-w12.test'),
  ('00000000-0000-0000-0000-0000001295a3', 'accountant@files-storage-w12.test'),
  ('00000000-0000-0000-0000-0000001295a4', 'admin@files-storage-w12.test'),
  ('00000000-0000-0000-0000-0000001295a5', 'driver@files-storage-w12.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000001295a1', 'warehouse'),
  ('00000000-0000-0000-0000-0000001295a2', 'warehouse'),
  ('00000000-0000-0000-0000-0000001295a3', 'fiscal_reader'),
  ('00000000-0000-0000-0000-0000001295a4', 'admin'),
  ('00000000-0000-0000-0000-0000001295a5', 'driver');

insert into public.tax_documents (id, kind, period, due_date) values
  ('00000000-0000-0000-0000-0000001295b1', 'iva', '2097-03', current_date + 10);

-- k1: attached to a tax document (the accountant reads it); k2: its blob is
-- gone; k3: for the admin.
insert into public.files (id, uploaded_by, original_filename, bucket, bucket_path, source) values
  ('00000000-0000-0000-0000-0000001295c1', '00000000-0000-0000-0000-0000001295a1',
   'vep.pdf', 'files', '00000000-0000-4000-8000-0000001295d1.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001295c2', '00000000-0000-0000-0000-0000001295a1',
   'perdido.pdf', 'files', '00000000-0000-4000-8000-0000001295d2.pdf', 'manual_upload'),
  ('00000000-0000-0000-0000-0000001295c3', '00000000-0000-0000-0000-0000001295a1',
   'otro.pdf', 'files', '00000000-0000-4000-8000-0000001295d3.pdf', 'manual_upload');
insert into public.file_attachments (file_id, kind, tax_document_id) values
  ('00000000-0000-0000-0000-0000001295c1', 'vep', '00000000-0000-0000-0000-0000001295b1');
insert into storage.objects (bucket_id, name, owner_id) values
  ('files', '00000000-0000-4000-8000-0000001295d1.pdf', '00000000-0000-0000-0000-0000001295a1'),
  ('files', '00000000-0000-4000-8000-0000001295d3.pdf', '00000000-0000-0000-0000-0000001295a1');

-- 1. Readers who did not upload the bytes cannot delete them -------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001295a2","role":"authenticated"}', true);
delete from storage.objects
 where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001295d1.pdf';

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001295a3","role":"authenticated"}', true);
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001295d1.pdf'),
  1,
  'the accountant still reads the tax document file'
);
delete from storage.objects
 where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001295d1.pdf';

reset role;
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001295d1.pdf'),
  1,
  'neither another warehouse user nor the accountant deleted the blob'
);

-- 2. Uploads: files:write roles only, never another user's key ----------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001295a2","role":"authenticated"}', true);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('files', '00000000-0000-4000-8000-0000001295d2.pdf',
            '00000000-0000-0000-0000-0000001295a2')$$,
  '42501', null,
  'another user cannot refill a key whose row is not theirs'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('files', '00000000-0000-4000-8000-0000001295d4.pdf',
            '00000000-0000-0000-0000-0000001295a2')$$,
  'a files:write role uploads to a fresh key'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001295a3","role":"authenticated"}', true);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('files', '00000000-0000-4000-8000-0000001295d5.pdf',
            '00000000-0000-0000-0000-0000001295a3')$$,
  '42501', null,
  'the accountant (no files:write) cannot upload'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001295a5","role":"authenticated"}', true);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('files', '00000000-0000-4000-8000-0000001295d6.pdf',
            '00000000-0000-0000-0000-0000001295a5')$$,
  '42501', null,
  'a driver cannot upload'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001295a1","role":"authenticated"}', true);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('files', '00000000-0000-4000-8000-0000001295d2.pdf',
            '00000000-0000-0000-0000-0000001295a1')$$,
  'the row''s own uploader may write its key'
);

-- 3. The uploader and the admin delete -----------------------------------------------

delete from storage.objects
 where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001295d1.pdf';

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001295a4","role":"authenticated"}', true);
delete from storage.objects
 where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001295d3.pdf';

reset role;
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001295d1.pdf'),
  0,
  'the uploader deletes the blob of their file'
);
select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'files' and name = '00000000-0000-4000-8000-0000001295d3.pdf'),
  0,
  'an admin deletes the blob of a file they see'
);

-- 4. A registry row cannot claim another user's key or another bucket ---------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001295a2","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.files (uploaded_by, original_filename, bucket, bucket_path, source)
    values ('00000000-0000-0000-0000-0000001295a2', 'falso.pdf', 'files',
            '00000000-0000-4000-8000-0000001295d1.pdf', 'manual_upload')$$,
  '42501', null,
  'a row cannot name a key another user''s row names (the sweep would remove its blob)'
);
select throws_ok(
  $$insert into public.files (uploaded_by, original_filename, bucket, bucket_path, source)
    values ('00000000-0000-0000-0000-0000001295a2', 'falso.pdf', 'avatars',
            '00000000-0000-0000-0000-0000001295a1/avatar.png', 'manual_upload')$$,
  '42501', null,
  'a row cannot name another bucket'
);
select lives_ok(
  $$insert into public.files (uploaded_by, original_filename, bucket, bucket_path, source)
    values ('00000000-0000-0000-0000-0000001295a2', 'nuevo.pdf', 'files',
            '00000000-0000-4000-8000-0000001295d4.pdf', 'manual_upload')$$,
  'the row of a fresh upload is registered'
);

-- 5. The key helper reads rows the caller's RLS hides --------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000001295a5","role":"authenticated"}', true);
select is(
  public.files_storage_key_is_free('00000000-0000-4000-8000-0000001295d2.pdf'),
  false,
  'a key named by another user''s row is taken, even for a role that cannot see it'
);
select is(
  public.files_storage_key_is_free('00000000-0000-4000-8000-0000001295d9.pdf'),
  true,
  'a key no row names is free'
);

reset role;
select * from finish();
rollback;
