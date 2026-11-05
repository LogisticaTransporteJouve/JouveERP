SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W16 · S4 F1: a fleet or employee document may only point at a
-- file nothing else links.
--
-- The files SELECT policy hides any file a fleet document points at from the
-- roles outside owner/admin/operations, and any file an employee document
-- points at from the roles outside owner/admin/finance (20261105100100),
-- whatever else links it. guard_link_file_visible (20261105120000) only asks
-- whether the writer sees the file, and client and supplier attachments are
-- seen by finance and operations alike. So operations could point a fleet
-- document at a client's contract, or finance an employee document at a
-- supplier's file, and the other role, the uploader included, lost the file
-- for as long as the document existed.
--
-- Now, on fleet_documents and employee_documents, the guard also refuses a
-- file that something already links: an attachment (any record, chat
-- included), a Document Intelligence extraction, or another fleet or
-- employee document (is_linked_file, SECURITY DEFINER, sees every link). It
-- runs after the visibility check, so a file the writer cannot see is still
-- refused with 42501 and the link check tells it nothing. It applies to every
-- writer, owner and service role included: a document's file is its own.
-- The update triggers fire only when the file changes, so the document's own
-- previous row (holding the old file) never counts, and editing any other
-- field never re-checks a file it already had.
--
-- Writers of attachment_file_id, latest code; each passes:
--   * uploadFleetDocumentFileAction (upload, upload-and-replace): a fresh
--     upload, linked to nothing;
--   * the fleet dialog: creates or edits without a file, or clears it (null
--     never fires the triggers);
--   * no HR screen sends a file id;
--   * create/update actions given an existing id: refused first by
--     linkableFileError, which asks the same question (lib/files/store.ts);
--   * commit_import_run (the importer) inserts fleet_documents with no file;
--   * the expiry crons (Inngest, service role) update notified_at only;
--   * seeds insert employee_documents with no file.
-- Two concurrent writes of the same fresh id can both pass; no screen sends
-- an existing id, so the app never races itself here.
--
-- Existing rows are not re-checked (no backfill); the read-only control query
-- is in docs/pendientes/antes-de-promover.md. No data changes.
-- Rollback: older code links only fresh uploads to these documents, which
-- pass.

-- Latest definition: 20261105120000. Keeps the visibility check as it was.
create or replace function public.guard_link_file_visible()
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
  if v_file_id is not null
     and tg_table_name in ('fleet_documents', 'employee_documents')
     and public.is_linked_file(v_file_id) then
    raise exception 'Ese archivo ya está vinculado a otro registro.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_link_file_visible() from public, anon, authenticated;

-- The guard is SECURITY INVOKER: its callers must be able to ask. authenticated
-- already can (20261105090100); service_role through the default privileges,
-- made explicit here.
grant execute on function public.is_linked_file(uuid) to service_role;
