-- K.10a — RPC for the orphan sweep cron.
--
-- A file is orphan when no attachment references it. This can happen if
-- the upload action crashes between `files.insert` and
-- `file_attachments.insert`, or if a parent row is deleted via cascade
-- after a manual SQL operation. The cron (lib/inngest/functions/
-- files-sweep-orphans.ts) calls this RPC nightly and removes the
-- storage object + the row.
--
-- The age filter (`p_max_age`, default 1 hour) prevents the cron from
-- killing uploads currently in flight.

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
    and f.created_at < now() - p_max_age;
$$;

comment on function public.find_orphan_files(interval) is
  'Files without any attachment older than p_max_age. Service role only.';

-- Service-role only. The Inngest cron uses the service client.
revoke all on function public.find_orphan_files(interval) from public;
grant execute on function public.find_orphan_files(interval) to service_role;
