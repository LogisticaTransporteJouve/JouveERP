SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Remitos únicos (roadmap 4.1): the client's remito number on a carga, unique
-- per client, compared trimmed and case-insensitive. A cancelled carga does
-- not hold its number, so the remito can go on the carga that replaces it;
-- taking a carga out of cancelled while another live carga has its number
-- fails on the index.
--
-- No existing row has a number (the column is new), so the unique index
-- cannot meet a duplicate here. The app asks shipment_remito_conflict before
-- saving to warn, and maps the index violation to a message.

alter table public.shipments
  add column remito_number text
    check (remito_number is null or length(btrim(remito_number)) between 1 and 60);

comment on column public.shipments.remito_number is
  'Número de remito del cliente. Único por cliente (sin distinguir mayúsculas) entre las cargas no canceladas.';

-- Every value is null right after the column is added, and shipments is a
-- small table: the build is short.
-- squawk-ignore require-concurrent-index-creation
create unique index shipments_client_remito_unique
  on public.shipments (client_id, lower(btrim(remito_number)))
  where remito_number is not null
    and client_id is not null
    and status <> 'cancelled';

-- The carga that already holds a remito number for the client, under the same
-- rule as the index (p_exclude_id: the carga being edited). Invoker: the
-- caller's shipments RLS applies.
create function public.shipment_remito_conflict(
  p_client_id     uuid,
  p_remito_number text,
  p_exclude_id    uuid default null
)
returns table (
  id             uuid,
  scheduled_date date,
  status         text,
  origin         text,
  destination    text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.scheduled_date, s.status, s.origin, s.destination
    from public.shipments s
   where s.client_id = p_client_id
     and s.remito_number is not null
     and lower(btrim(s.remito_number)) = lower(btrim(p_remito_number))
     and s.status <> 'cancelled'
     and (p_exclude_id is null or s.id <> p_exclude_id)
   limit 1
$$;

revoke all on function public.shipment_remito_conflict(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.shipment_remito_conflict(uuid, text, uuid)
  to authenticated, service_role;
