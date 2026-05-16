-- K.10a — Files registry (blob-only).
--
-- Pure blob registry. No business context lives here — that's
-- `file_attachments` (next migration). One row per uploaded blob,
-- referenced N:1 by attachments so the same file can be linked to
-- multiple business entities without duplicating bytes.
--
-- `quick_ocr` column is created now but stays NULL until Phase I.2 wires
-- the worker. The column lives here so I.2 doesn't need a migration —
-- only a server action that fills it.

set row_security = off;

------------------------------------------------------------------------------
-- 1. files table
------------------------------------------------------------------------------
create table public.files (
  id                 uuid primary key default gen_random_uuid(),
  uploaded_by        uuid references auth.users (id) on delete set null,
  original_filename  text not null,
  mime_type          text,
  file_size          bigint,
  bucket             text not null default 'files',
  bucket_path        text not null,
  source             text not null,
  quick_ocr          text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),

  -- Bucket whitelist. Tightens defense-in-depth: only buckets we control
  -- can be referenced from the registry.
  constraint files_bucket_whitelist
    check (bucket in ('files')),

  -- No path traversal, no absolute paths. Belt-and-braces alongside the
  -- TS-side `buildStorageKey` that already strips these.
  constraint files_bucket_path_shape
    check (
      bucket_path !~ '(^|/)\.\.(/|$)'
      and bucket_path not like '/%'
    )
);

comment on table public.files is
  'Blob registry. Business links live in public.file_attachments.';
comment on column public.files.source is
  'Origin tag: manual_upload | chat_attachment | ... . Free text by design — enums in PG are rigid to migrate.';
comment on column public.files.quick_ocr is
  'OCR insight (≤500 chars). Stays NULL until Phase I.2 wires the worker.';

create index files_uploaded_by_idx on public.files (uploaded_by);
-- Partial index so the I.2 worker can sweep pending OCR cheaply.
create index files_quick_ocr_null_idx on public.files (id)
  where quick_ocr is null;

------------------------------------------------------------------------------
-- 2. RLS
------------------------------------------------------------------------------
alter table public.files enable row level security;

create policy "Authenticated users can view files"
  on public.files for select
  to authenticated
  using (true);

create policy "Files write requires uploader = self"
  on public.files for insert
  to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse'])
  );

create policy "Uploader or admin can delete files"
  on public.files for delete
  to authenticated
  using (
    uploaded_by = (select auth.uid())
    or public.user_has_role(array['owner', 'admin'])
  );

-- No update policy: registry rows are immutable post-insert. Filename
-- changes happen at the attachment / source level if ever needed.

set row_security = on;
