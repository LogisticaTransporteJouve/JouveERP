SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Depósito: tarifas por área, lote y bloqueo (roadmap 4.4).
--
--   1. storage_areas: zones of a warehouse (cámara de frío, a granel, rack…).
--      A pallet may sit in one area of its own warehouse; the composite FK
--      (area_id, warehouse_id) keeps the area in the pallet's warehouse.
--   2. client_tariffs.area_id: a client tariff for one area. Storage billing
--      charges a pallet in an area at the client's tariff for that area in
--      force that day, then at the client's tariff with no area, then at
--      storage_tariffs, as before. Rows without an area (every existing one)
--      bill exactly as before. The overlap guard is per client, concept and
--      area (null = the client's general tariff); client_tariff_at keeps
--      returning the general one only. Flete has no area.
--   3. pallets.lot_number / lot_expiry: the merchandise lot and its expiry.
--   4. pallets.blocked_at / blocked_by / block_reason: a blocked pallet
--      cannot leave (status despachado or an exit date) nor be deleted
--      (guard_pallet_blocked); only a pallet en depósito is blocked.
--
-- Rollback: older code ignores the new columns. A client with area tariffs
-- would be billed by older code as if every tariff applied to every pallet
-- (overlapping rows), so do not load area tariffs until this deploy sticks.
--
-- RLS: storage_areas like warehouses (owner/admin/warehouse); the finance
-- role reads them through the service client behind storage_billing:read.

------------------------------------------------------------------------------
-- 1. storage_areas
------------------------------------------------------------------------------
create table public.storage_areas (
  id           uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 120),
  is_active    boolean not null default true,
  notes        text check (length(notes) <= 500),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Target of the pallets composite FK.
  constraint storage_areas_id_warehouse_key unique (id, warehouse_id)
);

comment on table public.storage_areas is
  'Áreas o zonas de un depósito (cámara de frío, a granel, rack). Un pallet puede estar en un área de su depósito y el tarifario del cliente puede tener precio por área.';

create unique index storage_areas_warehouse_name_key
  on public.storage_areas (warehouse_id, lower(trim(name)));

create trigger storage_areas_set_updated_at
  before update on public.storage_areas
  for each row execute function public.set_updated_at();

alter table public.storage_areas enable row level security;

create policy "storage_areas select"
  on public.storage_areas for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'warehouse'])));
create policy "storage_areas insert"
  on public.storage_areas for insert to authenticated
  with check ((select public.user_has_role(array['owner', 'admin', 'warehouse'])));
create policy "storage_areas update"
  on public.storage_areas for update to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'warehouse'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'warehouse'])));
create policy "storage_areas delete"
  on public.storage_areas for delete to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'warehouse'])));

revoke all on table public.storage_areas from public, anon;

------------------------------------------------------------------------------
-- 2. pallets: area, lot, block
------------------------------------------------------------------------------
alter table public.pallets
  add column area_id      uuid,
  add column lot_number   text,
  add column lot_expiry   date,
  add column blocked_at   timestamptz,
  -- squawk-ignore adding-foreign-key-constraint
  add column blocked_by   uuid references auth.users (id) on delete set null,
  add column block_reason text;

comment on column public.pallets.area_id is
  'Área del depósito donde está el pallet (storage_areas, del mismo depósito). Null = sin área.';
comment on column public.pallets.lot_number is 'Lote de la mercadería.';
comment on column public.pallets.lot_expiry is 'Vencimiento del lote.';
comment on column public.pallets.blocked_at is
  'Bloqueado desde: un pallet bloqueado no sale ni se borra (guard_pallet_blocked).';
comment on column public.pallets.blocked_by is 'Quién bloqueó el pallet.';
comment on column public.pallets.block_reason is 'Motivo del bloqueo.';

-- The columns are new and all null: the checks validate at once.
alter table public.pallets
  add constraint pallets_lot_number_length
    check (lot_number is null or length(trim(lot_number)) between 1 and 60) not valid,
  add constraint pallets_block_consistent check (
    (blocked_at is null and blocked_by is null and block_reason is null)
    or (blocked_at is not null and block_reason is not null
        and length(trim(block_reason)) between 1 and 500)
  ) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.pallets validate constraint pallets_lot_number_length;
-- squawk-ignore constraint-missing-not-valid
alter table public.pallets validate constraint pallets_block_consistent;

-- The area belongs to the pallet's warehouse. area_id is new and all null,
-- so the validation scans nothing.
alter table public.pallets
  -- squawk-ignore adding-foreign-key-constraint
  add constraint pallets_area_id_warehouse_id_fkey
    foreign key (area_id, warehouse_id)
    references public.storage_areas (id, warehouse_id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.pallets validate constraint pallets_area_id_warehouse_id_fkey;

-- squawk-ignore require-concurrent-index-creation
create index pallets_area_idx on public.pallets (area_id) where area_id is not null;
-- squawk-ignore require-concurrent-index-creation
create index pallets_lot_idx on public.pallets (lower(lot_number)) where lot_number is not null;

create function public.guard_pallet_blocked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.blocked_at is not null then
      raise exception 'El pallet % está bloqueado (%): desbloquealo antes de borrarlo.',
          old.code, old.block_reason
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return old;
  end if;

  if new.blocked_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.blocked_at is null
     and (old.status <> 'en_deposito' or old.exit_date is not null) then
    raise exception 'Solo se bloquea un pallet en depósito: el pallet % ya salió.', new.code
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.status <> 'en_deposito' or new.exit_date is not null then
    raise exception 'El pallet % está bloqueado (%): desbloquealo antes de darle salida.',
        new.code, new.block_reason
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_pallet_blocked() from public, anon, authenticated;

create trigger pallets_guard_blocked
  before insert or update or delete on public.pallets
  for each row execute function public.guard_pallet_blocked();

------------------------------------------------------------------------------
-- 3. client_tariffs: area
------------------------------------------------------------------------------
alter table public.client_tariffs
  -- squawk-ignore adding-foreign-key-constraint
  add column area_id uuid references public.storage_areas (id) on delete restrict;

comment on column public.client_tariffs.area_id is
  'Área del depósito a la que aplica la tarifa. Null = todas las áreas (la general del cliente); la del área pisa a la general.';

-- Flete prices cargas, not stored pallets.
alter table public.client_tariffs
  add constraint client_tariffs_area_concept
    check (area_id is null or concept <> 'freight') not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.client_tariffs validate constraint client_tariffs_area_concept;

-- Same as 20261103080100, per area: the client's general tariff (no area)
-- and each area's tariff are separate lines that may overlap each other.
create or replace function public.guard_client_tariff_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_other record;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      'client_tariffs:' || new.client_id::text || ':' || new.concept
        || ':' || coalesce(new.area_id::text, ''),
      0)
  );

  select t.valid_from, t.valid_to
    into v_other
    from public.client_tariffs t
   where t.client_id = new.client_id
     and t.concept = new.concept
     and t.area_id is not distinct from new.area_id
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

drop trigger client_tariffs_guard_overlap on public.client_tariffs;
create trigger client_tariffs_guard_overlap
  before insert or update of client_id, concept, valid_from, valid_to, area_id
  on public.client_tariffs
  for each row execute function public.guard_client_tariff_overlap();

-- Same as 20261103080100: the client's general tariff (no area) only, so the
-- flete price and any other caller keep one row per date.
create or replace function public.client_tariff_at(
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
     and t.area_id is null
     and t.valid_from <= p_date
     and (t.valid_to is null or t.valid_to >= p_date)
   order by t.valid_from desc
   limit 1
$$;

revoke all on function public.client_tariff_at(uuid, text, date)
  from public, anon, authenticated;
grant execute on function public.client_tariff_at(uuid, text, date)
  to authenticated, service_role;
