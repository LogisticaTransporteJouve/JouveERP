SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Tarifarios por cliente con vigencia (roadmap 4.2). One row = the price a
-- client pays for one concept (almacenaje, carga, descarga) in a unit, a
-- currency and a date range. For the same client and concept the ranges
-- never overlap (guard_client_tariff_overlap), so a date has at most one
-- tariff in force (client_tariff_at).
--
-- Storage billing (features/storage-billing/lib/billing.ts) charges each day,
-- carga and descarga at the client's tariff in force that day and falls back
-- to storage_tariffs (the client's row there, then the general one) for what
-- this table does not cover. A USD tariff is converted at the official rate
-- on or before the end of the billed period. storage_tariffs is unchanged.
--
-- RLS: pricing, like storage_tariffs -> owner/admin/finance
-- (storage_billing:read / storage_billing:issue).

create table public.client_tariffs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  concept     text not null
                check (concept in ('storage', 'handling_in', 'handling_out')),
  unit        text not null
                check (unit in ('pallet_day', 'pallet_month', 'pallet')),
  price       numeric(14, 2) not null check (price >= 0),
  currency    text not null default 'ARS' check (currency in ('ARS', 'USD')),
  valid_from  date not null,
  valid_to    date,
  notes       text check (length(notes) <= 500),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint client_tariffs_valid_range
    check (valid_to is null or valid_to >= valid_from),
  -- Almacenaje is priced per pallet per day or month; carga and descarga
  -- once per pallet.
  constraint client_tariffs_concept_unit check (
    (concept = 'storage' and unit in ('pallet_day', 'pallet_month'))
    or (concept in ('handling_in', 'handling_out') and unit = 'pallet')
  )
);

comment on table public.client_tariffs is
  'Tarifario por cliente: precio por concepto (almacenaje, carga, descarga), unidad, moneda y vigencia, sin superposición por cliente y concepto. Pisa a storage_tariffs en la facturación de almacenaje.';
comment on column public.client_tariffs.valid_to is
  'Último día de vigencia (inclusive); null = sin fin.';

create index client_tariffs_client_concept_idx
  on public.client_tariffs (client_id, concept, valid_from);

create trigger client_tariffs_set_updated_at
  before update on public.client_tariffs
  for each row execute function public.set_updated_at();

-- No two tariffs of one client and concept in force on the same day. The
-- per-(client, concept) lock serializes concurrent writers, so two inserts
-- cannot both pass the check.
create function public.guard_client_tariff_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_other record;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('client_tariffs:' || new.client_id::text || ':' || new.concept, 0)
  );

  select t.valid_from, t.valid_to
    into v_other
    from public.client_tariffs t
   where t.client_id = new.client_id
     and t.concept = new.concept
     and t.id <> new.id
     and daterange(t.valid_from, t.valid_to, '[]')
         && daterange(new.valid_from, new.valid_to, '[]')
   order by t.valid_from
   limit 1;

  if found then
    raise exception 'Ya hay una tarifa de ese concepto vigente del % al %: cerrala antes o elegí otras fechas.',
        to_char(v_other.valid_from, 'DD/MM/YYYY'),
        coalesce(to_char(v_other.valid_to, 'DD/MM/YYYY'), 'sin fin')
      using errcode = '23P01', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_client_tariff_overlap() from public, anon, authenticated;

create trigger client_tariffs_guard_overlap
  before insert or update of client_id, concept, valid_from, valid_to
  on public.client_tariffs
  for each row execute function public.guard_client_tariff_overlap();

-- The client's tariff for a concept in force on a date: one row or none.
-- Invoker: the caller's RLS applies.
create function public.client_tariff_at(
  p_client_id uuid,
  p_concept   text,
  p_date      date
)
returns setof public.client_tariffs
language sql
stable
security invoker
set search_path = ''
as $$
  select t.*
    from public.client_tariffs t
   where t.client_id = p_client_id
     and t.concept = p_concept
     and t.valid_from <= p_date
     and (t.valid_to is null or t.valid_to >= p_date)
   order by t.valid_from desc
   limit 1
$$;

revoke all on function public.client_tariff_at(uuid, text, date)
  from public, anon, authenticated;
grant execute on function public.client_tariff_at(uuid, text, date)
  to authenticated, service_role;

------------------------------------------------------------------------------
-- RLS — pricing managed by owner/admin/finance
------------------------------------------------------------------------------
alter table public.client_tariffs enable row level security;

create policy "client_tariffs select"
  on public.client_tariffs for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));
create policy "client_tariffs insert"
  on public.client_tariffs for insert to authenticated
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
create policy "client_tariffs update"
  on public.client_tariffs for update to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
create policy "client_tariffs delete"
  on public.client_tariffs for delete to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.client_tariffs from public, anon;
