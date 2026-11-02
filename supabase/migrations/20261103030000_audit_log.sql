SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría (roadmap 1.11, decision D13): Admin › Auditoría lists
-- audit_events (audit:read, owner and admin) and each record's detail page can
-- show its own history. The app reads through the service client after its
-- userCan gate; the table's select policy already stops at owner/admin.
--
--   audit_events_target_resource_idx  a record's history (target_resource_id)
--   audit_event_types()               the distinct event types, for the filter
--   purge_audit_events()              the 400-day retention, run by the daily
--                                     Inngest cron `audit-retention`

-- squawk-ignore require-concurrent-index-creation
create index audit_events_target_resource_idx
  on public.audit_events (target_resource_id, ts desc)
  where target_resource_id is not null;

-- Walks the event_type index one distinct value at a time (a loose index
-- scan), so the filter does not read the whole log.
create or replace function public.audit_event_types()
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive t(event_type) as (
    (select a.event_type from public.audit_events a order by a.event_type limit 1)
    union all
    select (
      select a.event_type
        from public.audit_events a
       where a.event_type > t.event_type
       order by a.event_type
       limit 1
    )
      from t
     where t.event_type is not null
  )
  select t.event_type from t where t.event_type is not null;
$$;

comment on function public.audit_event_types() is
  'Los event_type distintos de audit_events, en orden (filtro de Admin › Auditoría).';

revoke all on function public.audit_event_types() from public, anon, authenticated;
grant execute on function public.audit_event_types() to service_role;

-- The cutoff is fixed here, not passed in: no caller can shorten the
-- retention. Only audit_events is touched; accounting documents keep their
-- own rows whatever their age.
create or replace function public.purge_audit_events()
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with deleted as (
    delete from public.audit_events
     where ts < now() - interval '400 days'
    returning 1
  )
  select count(*)::int from deleted;
$$;

comment on function public.purge_audit_events() is
  'Borra los audit_events de más de 400 días (cron audit-retention). Devuelve cuántos borró.';

revoke all on function public.purge_audit_events() from public, anon, authenticated;
grant execute on function public.purge_audit_events() to service_role;
