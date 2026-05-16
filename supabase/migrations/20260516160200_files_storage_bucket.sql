-- K.10a — Storage bucket `files` for user uploads.
--
-- Private bucket. SELECT/DELETE policies join through public.files so a
-- caller can't read bytes by guessing a UUID — they need a registry row
-- they can see. INSERT validates path shape (the files row doesn't
-- exist yet at upload time; storage write happens first).
--
-- Auto-generated PDFs (comprobantes, receipts) do NOT live here. Those
-- are handled separately (and will be refactored to on-demand in M.0).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'files',
  'files',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public            = excluded.public,
  file_size_limit   = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- SELECT: only if a matching public.files row exists. RLS on `files`
-- itself gates who can see what; this storage policy makes sure the
-- bucket can't be accessed out-of-band.
create policy "files_storage_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'files'
    and exists (
      select 1 from public.files f
      where f.bucket = 'files' and f.bucket_path = storage.objects.name
    )
  );

-- INSERT: path shape only — the files row is inserted after the storage
-- write (the action layer rolls back storage if the DB insert fails).
-- Shape: {uuid} or {uuid}.{1-8 lowercase-alphanumeric chars}.
create policy "files_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'files'
    and name ~ '^[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$'
  );

-- DELETE: same predicate as SELECT — the registry row gates access.
create policy "files_storage_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'files'
    and exists (
      select 1 from public.files f
      where f.bucket = 'files' and f.bucket_path = storage.objects.name
    )
  );
