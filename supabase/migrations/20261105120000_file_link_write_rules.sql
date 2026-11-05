SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W15 · S4 F1: writing a link to a file needs the same three things
-- the app asks for, now that a link the caller reads is what makes a file
-- readable (20261105100100).
--
-- Before, the link tables' write policies checked the role only. Any
-- files:read role that could insert a link (a file_attachments row to a
-- client, or an ai_document_extractions row) gave itself read of any file id
-- it knew; operations put files on finance records (purchase invoices,
-- receipts, cheques, ...) under another user's name; and pointing a
-- fleet_documents row at a finance file hid it from finance (the fleet
-- ceiling on files).
--
-- Now a link write, by a user (authenticated), requires:
--   1. the caller is who writes it: created_by = auth.uid() on the inserts
--      of file_attachments, ai_document_extractions (already),
--      fleet_documents and employee_documents;
--   2. the caller's role writes that record, per the matrix
--      (ATTACHMENT_WRITE_PERMISSION in lib/files/attachment-targets.ts, plus
--      files:write):
--        purchase_invoice, invoice, receipt,     owner, admin, finance
--        payment_order, check, issued_check,
--        transaction, tax_document, client,
--        supplier
--        fuel_load                               owner, admin, operations
--        ai_document_extractions (ai:read)       owner, admin, finance, operations
--        fleet_documents (fleet_documents:write) owner, admin, operations (unchanged)
--        employee_documents (hr:write)           owner, admin, finance (unchanged)
--      Chat links stay written only by the chat route (service role);
--   3. the caller already sees the file: guard_link_file_visible reads
--      public.files under the caller's own RLS (SECURITY INVOKER), so a link
--      can never grant read of a file the caller could not read before. A
--      trigger rather than a policy clause: a policy on file_attachments
--      that reads files would recurse (files' policy reads
--      file_attachments), and an update re-checks only when the file
--      changes, so editing a document's other fields never re-checks the
--      file it already had.
--
-- Writers, latest code; each passes:
--   * uploadFileAction: the caller's fresh upload (uploader sees it), as
--     itself, to a target its role writes (the action asks the same
--     permission first);
--   * attachSourceFile (scan confirmed into a purchase invoice, invoice,
--     receipt, payment order or cheques): finance roles, as the reviewer,
--     on the scan the reviewer reads (its creator, or owner/admin);
--   * startExtraction (Documentos tray and the chat's scan hand-off): the
--     caller's own upload, which it has just read through RLS; the claim and
--     status updates keep the file, so the guard does not fire;
--   * fleet and employee document create, edit, upload and replace: the
--     caller's own upload, or a file linkableFileError already read through
--     RLS;
--   * service role (chat links, the extraction pipeline, seeds) and SECURITY
--     DEFINER functions (commit_import_run inserts fleet_documents with no
--     file) bypass RLS: the policies do not apply and the guard sees every
--     file;
--   * ON DELETE SET NULL of a deleted file clears attachment_file_id: the
--     guard lets a null through.
--
-- Existing rows are not re-checked (no backfill); the control query for the
-- owner is in docs/pendientes/antes-de-promover.md. No data changes.
-- Rollback: older code writes only rows that pass these rules.

-- 1. file_attachments ---------------------------------------------------------

-- Latest definition: 20261016150000.
alter policy "Finance and ops can attach files" on public.file_attachments
  with check (
    ai_chat_message_id is null
    and created_by = (select auth.uid())
    and (
      (
        (
          purchase_invoice_id is not null
          or invoice_id is not null
          or receipt_id is not null
          or payment_order_id is not null
          or check_id is not null
          or issued_check_id is not null
          or transaction_id is not null
          or tax_document_id is not null
          or client_id is not null
          or supplier_id is not null
        )
        and (select public.user_has_role(array['owner', 'admin', 'finance']))
      )
      or (
        fuel_load_id is not null
        and (select public.user_has_role(array['owner', 'admin', 'operations']))
      )
    )
  );

-- 2. ai_document_extractions --------------------------------------------------

-- Latest definition: 20261031193400.
alter policy ai_extractions_insert on public.ai_document_extractions
  with check (
    created_by = (select auth.uid())
    and (select public.user_has_role(array['owner', 'admin', 'finance', 'operations']))
  );

-- 3. fleet_documents and employee_documents -----------------------------------

-- Latest definitions: 20260616220000 and 20260616120000.
alter policy "fleet_documents insert" on public.fleet_documents
  with check (
    (select public.user_has_role(array['owner', 'admin', 'operations']))
    and created_by = (select auth.uid())
  );

alter policy "hr_write_documents" on public.employee_documents
  with check (
    (select public.user_has_role(array['owner', 'admin', 'finance']))
    and created_by = (select auth.uid())
  );

-- 4. The file must already be visible to the writer ---------------------------

-- TG_ARGV[0] names the column that holds the file id.
create function public.guard_link_file_visible()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_file_id uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if v_file_id is not null
     and not exists (select 1 from public.files f where f.id = v_file_id) then
    raise exception 'No podés vincular un archivo que no podés ver.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_link_file_visible() from public, anon, authenticated;

create trigger file_attachments_file_visible
  before insert on public.file_attachments
  for each row execute function public.guard_link_file_visible('file_id');

create trigger ai_document_extractions_file_visible
  before insert on public.ai_document_extractions
  for each row execute function public.guard_link_file_visible('file_id');
create trigger ai_document_extractions_file_visible_update
  before update of file_id on public.ai_document_extractions
  for each row
  when (new.file_id is distinct from old.file_id)
  execute function public.guard_link_file_visible('file_id');

create trigger fleet_documents_file_visible
  before insert on public.fleet_documents
  for each row
  when (new.attachment_file_id is not null)
  execute function public.guard_link_file_visible('attachment_file_id');
create trigger fleet_documents_file_visible_update
  before update of attachment_file_id on public.fleet_documents
  for each row
  when (new.attachment_file_id is distinct from old.attachment_file_id)
  execute function public.guard_link_file_visible('attachment_file_id');

create trigger employee_documents_file_visible
  before insert on public.employee_documents
  for each row
  when (new.attachment_file_id is not null)
  execute function public.guard_link_file_visible('attachment_file_id');
create trigger employee_documents_file_visible_update
  before update of attachment_file_id on public.employee_documents
  for each row
  when (new.attachment_file_id is distinct from old.attachment_file_id)
  execute function public.guard_link_file_visible('attachment_file_id');
