SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W12 · S4 F1: removing or writing a stored file in the `files`
-- bucket needs what removing its registry row needs, not what reading it
-- needs.
--
-- files_storage_delete (20260516160200) let any role that can SELECT a
-- `files` row delete its bytes (operations, warehouse, and the read-only
-- fiscal_reader for tax-document files), and files_storage_insert checked only
-- the key's shape, for every authenticated user. So a reader could delete a
-- supplier's PDF and upload forged bytes under the same key, while the row
-- and its attachments kept pointing at it.
--
-- Buckets: `files` (this one), `avatars` (own policies, untouched),
-- `invoices` (legacy, read-only), `backups` (service role). Writers of
-- `files`, latest code:
--   * user client: storeUploadedFile (lib/files/store.ts: uploadFileAction,
--     uploadFleetDocumentFileAction; both gated by files:write) and
--     scanDocumentAction (files:write) upload a fresh random key with
--     upsert: false, and remove it again if the row insert fails;
--     discardStoredFile removes its own just-uploaded blob; detachFileAction
--     removes the blob of a file whose last link it removed.
--   * service role (bypasses RLS): chat attachments
--     (features/ai/attachments/store.ts), the orphan sweep
--     (files-sweep-orphans), the document scan download.
--   No path overwrites a key (no UPDATE policy on the bucket, upsert: false).
--
-- New rules:
--   * DELETE: the user who uploaded the bytes (storage.objects.owner_id), or
--     owner/admin for an object a registry row they can see names. The
--     storage side of "Uploader or admin can delete files". owner_id, not
--     files.uploaded_by: any files:write user may insert a files row naming
--     any key, so the row does not prove who wrote the bytes.
--   * INSERT: only the files:write roles (owner, admin, finance, operations,
--     warehouse), with the same key shape, and never a key that a registry
--     row of another user names (read without the caller's RLS, so a row
--     hidden from them still counts). A row whose blob is gone cannot be
--     refilled by someone else.
--   * files INSERT (user client): the same check on bucket_path, so a row
--     cannot claim another user's key (see below).
-- SELECT is unchanged, so every existing read and signed URL keeps working.
-- A storage DELETE filters by name, so Postgres also applies the SELECT
-- policy: a blob no visible row names stays out of reach, as before.
--
-- Effect on the app: the uploader and owner/admin keep removing blobs. A
-- finance user who detaches someone else's last link keeps the blob and the
-- row (its "Uploader or admin" delete already matched 0 rows); the orphan
-- sweep removes both. Before, that call deleted the blob and left the row
-- pointing at nothing.
--
-- Existing objects and rows are not touched. Rollback: older code uploads as
-- a files:write user to a fresh key, and removes blobs as their uploader or
-- as owner/admin (or keeps them where its row delete fails anyway), so it
-- still works.

-- True when no registry row of another user names the key. SECURITY DEFINER
-- so the storage policy sees rows the caller's RLS hides.
create function public.files_storage_key_is_free(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.files f
     where f.bucket = 'files'
       and f.bucket_path = p_name
       and f.uploaded_by is distinct from (select auth.uid())
  );
$$;

revoke all on function public.files_storage_key_is_free(text) from public, anon, authenticated;
grant execute on function public.files_storage_key_is_free(text) to authenticated;

-- files:write roles: owner, admin, finance, operations, warehouse.
alter policy "files_storage_insert" on storage.objects
  with check (
    bucket_id = 'files'
    and name ~ '^[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$'
    and (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and public.files_storage_key_is_free(name)
  );

-- The registry side of the same key: a files:write user could insert a row
-- naming another user's key (only its shape is checked). The row reads the
-- bytes, and once it is an hour old and unlinked the orphan sweep deletes it
-- and removes the blob with the service role, under the real file's feet.
-- The same holds for a row naming another bucket (backups, avatars). The app
-- inserts rows only in `files`, for the fresh key it just uploaded.
alter policy "Files write requires uploader = self" on public.files
  with check (
    uploaded_by = (select auth.uid())
    and public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse'])
    and bucket = 'files'
    and public.files_storage_key_is_free(bucket_path)
  );

alter policy "files_storage_delete" on storage.objects
  using (
    bucket_id = 'files'
    and (
      owner_id = (select auth.uid())::text
      or (
        (select public.user_has_role(array['owner', 'admin']))
        and exists (
          select 1 from public.files f
           where f.bucket = 'files' and f.bucket_path = storage.objects.name
        )
      )
    )
  );
