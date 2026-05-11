-- E.5 — Storage bucket for invoice PDFs.
--
-- The bucket holds one PDF per invoice keyed by its UUID. Read access
-- requires authentication; writes only happen through the service role
-- (the Inngest workflow). Authenticated users get a signed URL of limited
-- duration when they need the PDF — direct URLs aren't exposed.

set row_security = off;

-- Idempotent so re-applying migrations in dev is safe.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoices-pdf',
  'invoices-pdf',
  false,
  10 * 1024 * 1024, -- 10 MiB cap; a fiscal invoice rarely tops 100 KB
  array['application/pdf']
)
on conflict (id) do nothing;

-- Read: any authenticated user can pull a PDF *if* they have a signed URL.
-- (The bucket is non-public, so unsigned anon access is denied at the
-- transport layer regardless of policy.) The policy is here so that the
-- workflow can also use createSignedUrl from the service role.
create policy "Authenticated users can read invoices pdf"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'invoices-pdf');

-- Inserts and updates only via service role (no policy means RLS denies
-- authenticated writes; the service role bypasses RLS).

set row_security = on;
