SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Impuestos: who reads a tax document reads its attachments. Expand-only:
-- one helper and two SELECT policies that add to the existing ones (Postgres
-- ORs permissive policies); nothing is dropped.
--
-- The accountant (fiscal_reader) holds taxes:read but not files:read, so the
-- VEP, DDJJ and receipts attached to a tax document were invisible to them.
-- Now every taxes:read role (owner, admin, finance, fiscal_reader) sees:
--   file_attachments  the rows whose target is a tax document;
--   files             a file that such a row points at, unless it is also a
--                     chat attachment, an employee document or a fleet
--                     document (those keep their own, narrower ceilings).
-- storage.objects (files_storage_select) reads public.files under the
-- caller's RLS, so the signed URL follows. No other attachment, no files
-- hub and no upload: files:read and files:write stay as they are. The app
-- gate is taxes:read (features/files/actions/files-actions.ts).
--
-- Rollback: older code gates the tax attachments with files:read, so the
-- accountant still sees none; the policies only widen what RLS returns to
-- a role older code never asks with.

-- True when a tax document has the file attached. SECURITY DEFINER so the
-- files policy can ask without the caller's file_attachments RLS.
create function public.is_tax_document_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.file_attachments fa
     where fa.file_id = p_file_id
       and fa.tax_document_id is not null
  );
$$;

revoke all on function public.is_tax_document_file(uuid) from public, anon, authenticated;
grant execute on function public.is_tax_document_file(uuid) to authenticated;

-- taxes:read roles: owner, admin, finance, fiscal_reader.
create policy "Tax readers view tax document attachments"
  on public.file_attachments for select to authenticated
  using (
    tax_document_id is not null
    and (select public.user_has_role(array['owner', 'admin', 'finance', 'fiscal_reader']))
  );

create policy "Tax readers view tax document files"
  on public.files for select to authenticated
  using (
    (select public.user_has_role(array['owner', 'admin', 'finance', 'fiscal_reader']))
    and source <> 'chat_attachment'
    and public.is_tax_document_file(id)
    and not public.is_employee_document_file(id)
    and not public.is_fleet_document_file(id)
  );
