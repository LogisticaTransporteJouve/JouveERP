SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W14 · S4 F1: a stored file is read only by whoever may read a
-- record it is attached to.
--
-- Before: every files:read role (owner, admin, finance, operations,
-- warehouse) saw every non-chat attachment link and every linked file, so
-- operations and warehouse listed and downloaded (files_storage_select
-- follows the files row) the supplier invoices, cheques, movements and every
-- Document Intelligence scan, records whose module their role cannot open.
-- Deferred as T6 in 20260704150000; only the HR and fleet parts were closed.
--
-- Now the database ceiling follows the permission matrix
-- (lib/auth/permissions.ts, ENTITY_READ_PERMISSION in
-- lib/auth/entity-permissions.ts), by role, through user_has_role:
--
--   link / owner                   read permission        roles (∩ files:read)
--   purchase_invoice, invoice,     purchase_invoices,     owner, admin, finance
--   receipt, payment_order,        invoices, receipts,
--   check, issued_check,           payment_orders,
--   transaction, tax_document      cheques, issued_checks,
--                                  transactions, taxes
--   client, supplier               clients, suppliers     owner, admin, finance, operations
--   fuel_load                      fuel                   owner, admin, operations
--   ai_chat_message                ai:chat + own session  owner, admin (any), finance, operations (own)
--   ai_document_extractions        ai:read + extraction   owner, admin (any), finance, operations (own)
--   employee_documents             hr                     owner, admin, finance
--   fleet_documents                fleet_documents        owner, admin, operations
--
-- file_attachments: a row is visible when its one target (the
-- file_attachments_exactly_one_target check) is readable per the table. The
-- accountant (fiscal_reader, taxes:read without files:read) keeps "Tax
-- readers view tax document attachments" (20261104050400), a separate
-- permissive policy that this one does not touch.
--
-- files: a file stays visible to its uploader and owner/admin, as before;
-- anyone else sees it while some record it hangs off is readable to them,
-- asked through the caller's own RLS on file_attachments (the policy above),
-- ai_document_extractions (creator or owner/admin), employee_documents (hr
-- roles) and fleet_documents (fleet roles). A file attached to several
-- records is visible when any one is. The chat, employee and fleet clauses
-- stay as narrower ceilings. No policy on those four tables reads
-- public.files, so the policies do not recurse.
--
-- storage.objects (files_storage_select) reads public.files under the
-- caller's RLS, so a signed URL follows the same rule.
--
-- Readers, latest code:
--   * user client: listAttachmentsAction and getSignedFileUrlAction (each
--     record page; they already require the record's read permission),
--     the files hub (v_files_hub, security_invoker; it already narrows to
--     the entity types the caller reads, and scans and chats to their
--     owner), attachSourceFile (finance roles, on the record they just
--     created), linkableFileError (fleet and employee documents, their own
--     roles), startExtraction (reads its own upload), the review sheet and
--     the purchase draft (own scan, through getSignedFileUrlAction);
--   * service role (no RLS): chat attachments (claim, link, list, sign,
--     download), the scan download in the extraction function, the orphan
--     sweep, removeReplacedFile, isFileStillReferenced (detach);
--   * avatars live in their own bucket with their own policies; invoice,
--     receipt and order PDFs are rendered per request, not read from here.
-- Warehouse holds no read permission of any attachable record, so it keeps
-- only its own uploads; no screen of warehouse lists files (hubScope gives
-- it no entity type).
--
-- No data changes. Rollback: older code reads through the same tables and
-- sees fewer rows. Its detach counts a file's remaining links with the
-- caller's client, which now hides the links the caller cannot read. That
-- does not delete a file still in use: a manual upload is a fresh file with
-- one link, and a file has several only when a scan became documents
-- (attachSourceFile: purchase invoice, invoice, receipt, payment order,
-- cheques, all finance records). Whoever may delete one of those links (its
-- creator, a finance user, or owner/admin) reads all of them, and the scan's
-- extraction is counted with the service role (isFileReferencedElsewhere).

-- file_attachments ------------------------------------------------------------

-- Latest definition: 20261016150000.
alter policy "Roles with files:read can view file_attachments" on public.file_attachments
  using (
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
      )
      and (select public.user_has_role(array['owner', 'admin', 'finance']))
    )
    or (
      (client_id is not null or supplier_id is not null)
      and (select public.user_has_role(array['owner', 'admin', 'finance', 'operations']))
    )
    or (
      fuel_load_id is not null
      and (select public.user_has_role(array['owner', 'admin', 'operations']))
    )
    or (
      ai_chat_message_id is not null
      and (select public.user_has_role(array['owner', 'admin', 'finance', 'operations']))
      and (
        (select public.user_has_role(array['owner', 'admin']))
        or exists (
          select 1
          from public.ai_chat_messages m
          join public.ai_chat_sessions s on s.id = m.session_id
          where m.id = file_attachments.ai_chat_message_id
            and s.user_id = (select auth.uid())
        )
      )
    )
  );

-- files -----------------------------------------------------------------------

-- Latest definition: 20261105090100. Only the last clause changes:
-- is_linked_file (any link, for any role) becomes a link the caller may read.
-- is_linked_file stays defined; no policy calls it any more.
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
      or exists (
        select 1 from public.file_attachments fa where fa.file_id = files.id
      )
      or (
        (select public.user_has_role(array['owner', 'admin', 'finance', 'operations']))
        and exists (
          select 1 from public.ai_document_extractions e where e.file_id = files.id
        )
      )
      or exists (
        select 1 from public.employee_documents d where d.attachment_file_id = files.id
      )
      or exists (
        select 1 from public.fleet_documents d where d.attachment_file_id = files.id
      )
    )
  );
