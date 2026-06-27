-- Shipments (cargas/envíos): customer loads assigned to trips, with a status
-- lifecycle (create / edit / start / deliver / cancel / reprogram) and full
-- status traceability via an append-only history table. Operational layer on
-- top of the existing trips/clients/vehicles masters.

create table public.shipments (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references public.clients (id) on delete set null,
  trip_id         uuid references public.trips (id) on delete set null,
  channel_id      text references public.invoicing_channels (id) on delete set null,
  origin          text,
  destination     text,
  description     text,
  scheduled_date  date,
  status          text not null default 'not_started'
                    check (status in ('not_started', 'in_progress', 'delivered', 'cancelled', 'reprogrammed')),
  delivery_date   date,
  failure_reason  text,
  freight_amount  numeric(14, 2) check (freight_amount is null or freight_amount >= 0),
  notes           text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index shipments_status_idx on public.shipments (status, scheduled_date desc);
create index shipments_trip_idx on public.shipments (trip_id);
create index shipments_client_idx on public.shipments (client_id);

create trigger shipments_set_updated_at
  before update on public.shipments
  for each row execute function public.set_updated_at();

-- Append-only audit of every status transition (traceability).
create table public.shipment_status_history (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null references public.shipments (id) on delete cascade,
  old_status    text,
  new_status    text not null,
  comment       text,
  changed_by    uuid references auth.users (id) on delete set null,
  changed_at    timestamptz not null default now()
);

create index shipment_status_history_shipment_idx
  on public.shipment_status_history (shipment_id, changed_at desc);

alter table public.shipments enable row level security;
alter table public.shipment_status_history enable row level security;

create policy "shipments select"
  on public.shipments for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "shipments insert"
  on public.shipments for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "shipments update"
  on public.shipments for update to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']))
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "shipments delete"
  on public.shipments for delete to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));

-- History is append-only: select + insert only (no update/delete policies).
create policy "shipment_status_history select"
  on public.shipment_status_history for select to authenticated
  using (public.user_has_role(array['owner', 'admin', 'operations']));
create policy "shipment_status_history insert"
  on public.shipment_status_history for insert to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'operations']));
