-- Audit remediation T3 — two independent correctness fixes.
--
-- 1. search_index_mark_dirty: was language plpgsql WITHOUT security definer.
--    Its `update search_index_state set dirty = true` runs as the writing user;
--    search_index_state has RLS enabled with no policies (round 4), so the update
--    matched 0 rows and the dirty flag was never set. The 1-min refresh cron then
--    refreshed nothing, so new/edited entities were unfindable in global search
--    until some unrelated service-role write flipped the flag. Fix: SECURITY
--    DEFINER so the control-table update bypasses RLS.
--
-- 2. find_orphan_files: defined "orphan" as any file with no file_attachments row,
--    but ai_document_extractions.file_id (ON DELETE CASCADE) and
--    employee_documents.attachment_file_id (ON DELETE SET NULL) reference files
--    directly without an attachment. The nightly sweep therefore deleted scanned
--    expense documents (cascading away the extraction row) and HR document blobs.
--    Fix: exclude files referenced by either table.

set row_security = off;

-- 1 ---------------------------------------------------------------------------
create or replace function public.search_index_mark_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.search_index_state set dirty = true where id = 1;
  perform pg_notify('search_index_dirty', tg_table_name);
  return null;
end;
$$;

-- 2 ---------------------------------------------------------------------------
create or replace function public.find_orphan_files(
  p_max_age interval default '1 hour'
)
returns table (
  id          uuid,
  bucket      text,
  bucket_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.bucket, f.bucket_path
  from public.files f
  left join public.file_attachments fa on fa.file_id = f.id
  where fa.id is null
    and f.created_at < now() - p_max_age
    and not exists (
      select 1 from public.ai_document_extractions e where e.file_id = f.id
    )
    and not exists (
      select 1 from public.employee_documents d where d.attachment_file_id = f.id
    );
$$;

revoke all on function public.find_orphan_files(interval) from public, anon, authenticated;
grant execute on function public.find_orphan_files(interval) to service_role;

set row_security = on;
