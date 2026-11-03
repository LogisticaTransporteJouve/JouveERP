SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The orphan sweep deletes only files that are still orphans (audit w1-s5
-- F13).
--
-- files-sweep-orphans found the orphans in one step and deleted them by id in
-- a later one, after removing their blobs. A file attached in between (an
-- unsent chat attachment sent near its 24 h edge) lost its bytes, and then
-- its row. delete_orphan_files re-applies the find_orphan_files predicates in
-- the delete itself and returns what it deleted; the job removes only those
-- blobs, after the rows are gone. An older job (rollback) keeps calling
-- find_orphan_files, which is unchanged.

create function public.delete_orphan_files(
  p_ids uuid[],
  p_max_age interval default '1 hour'
)
returns table (
  id          uuid,
  bucket      text,
  bucket_path text
)
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.files f
   where f.id = any (p_ids)
     and f.id in (select o.id from public.find_orphan_files(p_max_age) o)
  returning f.id, f.bucket, f.bucket_path;
$$;

revoke all on function public.delete_orphan_files(uuid[], interval) from public, anon, authenticated;
grant execute on function public.delete_orphan_files(uuid[], interval) to service_role;

comment on function public.delete_orphan_files(uuid[], interval) is
  'Deletes the given files that are still orphans (same rules as find_orphan_files) and returns their storage paths.';
