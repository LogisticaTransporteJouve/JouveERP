SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W13 · S4 F2 and F3: who sees a file nothing links, and who may
-- write a key a file already names.
--
-- F2. A fleet document's scan is hidden from the roles without
-- fleet_documents:read (finance, warehouse) only while a fleet document points
-- at it (is_fleet_document_file); an employee document's, from the roles
-- without hr:read (operations, warehouse), only while an employee document
-- does. Once the document is deleted or its scan replaced, the old file is
-- linked to nothing and "Roles with files:read can view files" showed it, and
-- its bytes through files_storage_select, to every files:read role until the
-- nightly orphan sweep. The app now deletes that file right away
-- (lib/files/remove-unlinked.ts); this is the database side: a file nothing
-- links (no file_attachments row, no Document Intelligence extraction, no
-- employee or fleet document, the same list find_orphan_files uses) is seen
-- only by its uploader and owner/admin.
--
-- Every path that uploads and then links, latest code, links as the user who
-- uploaded, so the uploader still sees the file in between:
--   * storeUploadedFile (uploadFileAction, uploadFleetDocumentFileAction):
--     blob, then the row (insert without RETURNING), then the link by the
--     same user; discardStoredFile deletes its own row.
--   * scanDocumentAction / startExtraction: blob, row, then reads the file
--     (uploader) and inserts the extraction; attachSourceFile links a file the
--     extraction already links.
--   * create/update of fleet and employee documents with an existing
--     attachment_file_id (linkableFileError): no screen picks a file another
--     user uploaded and nobody linked.
--   * chat attachments, the orphan sweep, the scan download and the document
--     removal above use the service role (no RLS); chat drafts were already
--     uploader-only.
-- A linked file is read as before; "Tax readers view tax document files"
-- (20261104050400) only matches linked files and is unchanged.
--
-- F3. files_storage_key_is_free (20261104194101) ignored the caller's own
-- rows, so the uploader of a linked file could delete its bytes and upload
-- others under the same key while the row and its links kept pointing at it.
-- Now a key any registry row names is taken. No app path writes such a key:
-- every user upload is a fresh random key with upsert: false, written before
-- its row exists, and the registry insert's own row is not visible to its
-- WITH CHECK. Avatars (`avatars` bucket, own policies) and backups
-- (`backups-daily`, service role, upsert) do not use this helper.
--
-- No data changes. Rollback: older code uploads to a fresh key, links as the
-- uploader and leaves replaced scans to the sweep, which now stay hidden from
-- other roles until it runs.

-- True when something keeps the file: an attachment, a Document Intelligence
-- extraction, an employee document or a fleet document (the exclusions of
-- find_orphan_files). SECURITY DEFINER so the files policy can ask without
-- the caller's RLS on those tables.
create function public.is_linked_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.file_attachments fa where fa.file_id = p_file_id)
      or exists (select 1 from public.ai_document_extractions e where e.file_id = p_file_id)
      or exists (select 1 from public.employee_documents d where d.attachment_file_id = p_file_id)
      or exists (select 1 from public.fleet_documents d where d.attachment_file_id = p_file_id);
$$;

revoke all on function public.is_linked_file(uuid) from public, anon, authenticated;
grant execute on function public.is_linked_file(uuid) to authenticated;

-- Latest definition: 20261031204119. Adds the last clause.
-- files:read roles: owner, admin, finance, operations, warehouse.
-- hr:read: owner, admin, finance. fleet_documents:read: owner, admin, operations.
alter policy "Roles with files:read can view files" on public.files
  using (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'operations', 'warehouse']))
    and (
      source <> 'chat_attachment'
      or uploaded_by = (select auth.uid())
      or (select public.user_has_role(array['owner', 'admin']))
    )
    and (
      (select public.user_has_role(array['owner', 'admin', 'finance']))
      or not public.is_employee_document_file(id)
    )
    and (
      (select public.user_has_role(array['owner', 'admin', 'operations']))
      or not public.is_fleet_document_file(id)
    )
    and (
      uploaded_by = (select auth.uid())
      or (select public.user_has_role(array['owner', 'admin']))
      or public.is_linked_file(id)
    )
  );

-- Any registry row now takes the key, the caller's own included. Same ACL as
-- 20261104194101: revoked, then granted to authenticated, because it runs
-- inside the storage and files policies.
create or replace function public.files_storage_key_is_free(p_name text)
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
  );
$$;

revoke all on function public.files_storage_key_is_free(text) from public, anon, authenticated;
grant execute on function public.files_storage_key_is_free(text) to authenticated;
