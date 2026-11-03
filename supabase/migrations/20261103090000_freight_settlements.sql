SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Liquidación de fletes (roadmap 4.3): several delivered cargas of one client
-- in a period are grouped into a liquidación (draft → confirmed → invoiced),
-- printed as the internal "R" document (not valid as an invoice) and billed
-- with ONE invoice through the normal issuance path.
--
--   1. client_tariffs takes the concept 'freight' (unit 'shipment', ARS only):
--      a carga without its own flete is priced at the client's freight tariff
--      in force on its delivery (or scheduled) day (freight_price).
--   2. freight_settlements + freight_settlement_items. A carga is in at most
--      one live liquidación: freight_settlement_items_live_shipment (unique
--      over the unreleased items) and guard_freight_settlement_item, which
--      also requires a delivered carga of the liquidación's client that is
--      not invoiced on its own.
--   3. guard_freight_settlement: the allowed transitions. A confirmed
--      liquidación is frozen; an invoiced one is cancelled only once its
--      invoice is void (cancelled, failed, or fully credited by emitted NCs).
--   4. guard_shipment_freight_settlement: a carga in a live liquidación is not
--      invoiced alone, deleted, cancelled or moved to another client, and its
--      flete is frozen once the liquidación is confirmed.
--   5. invoices_release_freight_settlement: a failed or cancelled invoice puts
--      its liquidación back to confirmed, as release_invoice_billing_links
--      does for the cargas.
--   6. RPCs for the app (service role only; the action gates on
--      invoices:read / invoices:issue): freight_settlement_candidates,
--      save_freight_settlement, confirm_freight_settlement,
--      link_freight_settlement_invoice and cancel_freight_settlement.
--
-- RLS: billing data, like storage_billing_runs -> owner/admin/finance read;
-- every write goes through the RPCs.

------------------------------------------------------------------------------
-- 1. Freight in the client tariff
------------------------------------------------------------------------------

-- client_tariffs is days old (20261103080100) and holds no freight rows, so
-- the swapped checks validate against a small table.
-- Each check is replaced by a wider one in the next statement.
-- squawk-ignore ban-drop-constraint
alter table public.client_tariffs drop constraint client_tariffs_concept_check;
-- squawk-ignore ban-drop-constraint
alter table public.client_tariffs drop constraint client_tariffs_unit_check;
-- squawk-ignore ban-drop-constraint
alter table public.client_tariffs drop constraint client_tariffs_concept_unit;

alter table public.client_tariffs
  add constraint client_tariffs_concept_check
    check (concept in ('storage', 'handling_in', 'handling_out', 'freight')) not valid,
  add constraint client_tariffs_unit_check
    check (unit in ('pallet_day', 'pallet_month', 'pallet', 'shipment')) not valid,
  -- Flete is priced once per carga and in pesos: the liquidación and its
  -- invoice are in ARS.
  add constraint client_tariffs_concept_unit check (
    (concept = 'storage' and unit in ('pallet_day', 'pallet_month'))
    or (concept in ('handling_in', 'handling_out') and unit = 'pallet')
    or (concept = 'freight' and unit = 'shipment' and currency = 'ARS')
  ) not valid;

-- squawk-ignore constraint-missing-not-valid
alter table public.client_tariffs validate constraint client_tariffs_concept_check;
-- squawk-ignore constraint-missing-not-valid
alter table public.client_tariffs validate constraint client_tariffs_unit_check;
-- squawk-ignore constraint-missing-not-valid
alter table public.client_tariffs validate constraint client_tariffs_concept_unit;

comment on table public.client_tariffs is
  'Tarifario por cliente: precio por concepto (almacenaje, carga, descarga, flete), unidad, moneda y vigencia, sin superposición por cliente y concepto. Pisa a storage_tariffs en la facturación de almacenaje; el flete (por carga, en pesos) precia las cargas sin flete propio en la liquidación.';

------------------------------------------------------------------------------
-- 2. Tables
------------------------------------------------------------------------------

create table public.freight_settlements (
  id                    uuid primary key default gen_random_uuid(),
  -- The R number, given at confirmation (a draft has none).
  numero                bigint unique,
  client_id             uuid not null references public.clients (id) on delete restrict,
  period_start          date not null,
  period_end            date not null,
  status                text not null default 'draft'
                          check (status in ('draft', 'confirmed', 'invoiced', 'cancelled')),
  total                 numeric(14, 2) not null default 0 check (total >= 0),
  invoice_id            uuid references public.invoices (id) on delete restrict,
  invoicing_claimed_at  timestamptz,
  notes                 text check (length(notes) <= 1000),
  created_by            uuid references auth.users (id) on delete set null,
  confirmed_at          timestamptz,
  confirmed_by          uuid references auth.users (id) on delete set null,
  cancelled_at          timestamptz,
  cancelled_by          uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint freight_settlements_period check (period_end >= period_start),
  constraint freight_settlements_numbered
    check (status not in ('confirmed', 'invoiced') or numero is not null),
  constraint freight_settlements_invoiced
    check (status <> 'invoiced' or invoice_id is not null)
);

comment on table public.freight_settlements is
  'Liquidación de fletes (documento interno R): cargas entregadas de un cliente en un período, borrador → confirmada → facturada con una sola factura. Cancelada libera sus cargas.';
comment on column public.freight_settlements.invoice_id is
  'La factura agrupada. Una cancelada conserva la factura anulada o acreditada por NC.';
comment on column public.freight_settlements.invoicing_claimed_at is
  'Set while the grouped invoice is being issued; null once linked or released.';

create index freight_settlements_client_idx
  on public.freight_settlements (client_id, period_start desc);
create index freight_settlements_invoice_idx
  on public.freight_settlements (invoice_id) where invoice_id is not null;

create trigger freight_settlements_set_updated_at
  before update on public.freight_settlements
  for each row execute function public.set_updated_at();

create table public.freight_settlement_items (
  id                uuid primary key default gen_random_uuid(),
  settlement_id     uuid not null references public.freight_settlements (id) on delete cascade,
  shipment_id       uuid not null references public.shipments (id) on delete restrict,
  amount            numeric(14, 2) not null check (amount > 0),
  price_source      text not null check (price_source in ('freight', 'tariff')),
  client_tariff_id  uuid references public.client_tariffs (id) on delete set null,
  -- True once the liquidación is cancelled: the carga is free again.
  released          boolean not null default false,
  created_at        timestamptz not null default now()
);

comment on table public.freight_settlement_items is
  'Cargas de una liquidación con su precio: el flete de la carga o, sin flete, la tarifa de flete del cliente vigente el día de entrega.';

create index freight_settlement_items_settlement_idx
  on public.freight_settlement_items (settlement_id);
create unique index freight_settlement_items_live_shipment
  on public.freight_settlement_items (shipment_id) where not released;

------------------------------------------------------------------------------
-- 3. Pricing
------------------------------------------------------------------------------

-- A carga's price in a liquidación: its own flete, else the client's freight
-- tariff in force on its delivery (or scheduled) day. No row's amount is null
-- when there is neither.
create function public.freight_price(p_shipment_id uuid)
returns table (amount numeric, price_source text, client_tariff_id uuid)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(nullif(s.freight_amount, 0), t.price),
    case
      when nullif(s.freight_amount, 0) is not null then 'freight'
      when t.price is not null then 'tariff'
    end,
    case when nullif(s.freight_amount, 0) is null then t.id end
  from public.shipments s
  left join lateral public.client_tariff_at(
    s.client_id, 'freight', coalesce(s.delivery_date, s.scheduled_date)
  ) t on true
  where s.id = p_shipment_id
$$;

revoke all on function public.freight_price(uuid) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 4. Guards
------------------------------------------------------------------------------

create function public.guard_freight_settlement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_imp_total numeric;
  v_status    text;
  v_credited  numeric;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Una liquidación confirmada no se borra: cancelala.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return old;
  end if;

  if old.status = 'cancelled' then
    raise exception 'La liquidación está cancelada.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.client_id is distinct from old.client_id then
    raise exception 'El cliente de una liquidación no cambia: cancelala y armá otra.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if old.status <> 'draft'
     and (new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end
       or new.total is distinct from old.total
       or new.numero is distinct from old.numero) then
    raise exception 'La liquidación ya está confirmada: no se pueden cambiar su período, sus cargas ni su total.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if old.status = 'invoiced' and new.status = 'invoiced'
     and new.invoice_id is distinct from old.invoice_id then
    raise exception 'La liquidación ya tiene su factura.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if (old.status = 'draft' and new.status in ('confirmed', 'cancelled'))
     or (old.status = 'confirmed' and new.status in ('invoiced', 'cancelled'))
     or (old.status = 'invoiced' and new.status = 'confirmed' and new.invoice_id is null) then
    return new;
  end if;

  if old.status = 'invoiced' and new.status = 'cancelled' then
    select i.imp_total, i.status
      into v_imp_total, v_status
      from public.invoices i
     where i.id = old.invoice_id;
    select coalesce(sum(n.imp_total), 0)
      into v_credited
      from public.invoices n
     where n.invoice_origin_id = old.invoice_id
       and n.kind = 'nc'
       and n.status = 'emitted';
    if v_status in ('cancelled', 'failed') or v_credited >= v_imp_total - 0.01 then
      return new;
    end if;
    raise exception 'La liquidación está facturada: anulá la factura (o emití la nota de crédito por el total) antes de cancelarla.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  raise exception 'Una liquidación % no pasa a %.', old.status, new.status
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_freight_settlement() from public, anon, authenticated;

create trigger freight_settlements_guard
  before update or delete on public.freight_settlements
  for each row execute function public.guard_freight_settlement();

create function public.guard_freight_settlement_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_settlement record;
  v_ship       record;
  v_other      bigint;
begin
  select fs.status, fs.client_id
    into v_settlement
    from public.freight_settlements fs
   where fs.id = coalesce(new.settlement_id, old.settlement_id);

  if tg_op = 'DELETE' then
    -- Not found: the liquidación itself is being deleted (a draft).
    if v_settlement.status is null or v_settlement.status = 'draft' then
      return old;
    end if;
    raise exception 'La liquidación ya está confirmada: no se pueden sacar cargas.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if tg_op = 'UPDATE' then
    if new.settlement_id is distinct from old.settlement_id
       or new.shipment_id is distinct from old.shipment_id then
      raise exception 'Una carga no se pasa de una liquidación a otra.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if old.released then
      raise exception 'La carga ya se liberó de esta liquidación.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    -- Cancelling releases the cargas; a draft is repriced at confirmation.
    if (new.released and v_settlement.status = 'cancelled'
        and new.amount = old.amount
        and new.price_source = old.price_source
        and new.client_tariff_id is not distinct from old.client_tariff_id)
       or (not new.released and v_settlement.status = 'draft') then
      return new;
    end if;
    raise exception 'La liquidación ya está confirmada: no se pueden cambiar sus cargas.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- INSERT
  if v_settlement.status is distinct from 'draft' then
    raise exception 'Solo se agregan cargas a una liquidación en borrador.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.released then
    raise exception 'Una carga nueva entra viva en la liquidación.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select s.client_id, s.status, s.invoice_id, s.invoicing_claimed_at,
         coalesce(s.remito_number, left(s.id::text, 8)) as label
    into v_ship
    from public.shipments s
   where s.id = new.shipment_id
     for update;
  if not found then
    raise exception 'La carga no existe.'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_ship.client_id is distinct from v_settlement.client_id then
    raise exception 'La carga % es de otro cliente.', v_ship.label
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_ship.status <> 'delivered' then
    raise exception 'La carga % no está entregada: solo se liquidan cargas entregadas.', v_ship.label
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_ship.invoice_id is not null
     or coalesce(v_ship.invoicing_claimed_at > now() - interval '15 minutes', false) then
    raise exception 'La carga % ya está facturada (o se está facturando) por su cuenta.', v_ship.label
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select fs.numero
    into v_other
    from public.freight_settlement_items i
    join public.freight_settlements fs on fs.id = i.settlement_id
   where i.shipment_id = new.shipment_id
     and not i.released
     and i.id <> new.id
   limit 1;
  if found then
    raise exception 'La carga % ya está en %.', v_ship.label,
        case when v_other is null then 'otra liquidación en borrador'
             else 'la liquidación R-' || lpad(v_other::text, 8, '0') end
      using errcode = '23505', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_freight_settlement_item() from public, anon, authenticated;

create trigger freight_settlement_items_guard
  before insert or update or delete on public.freight_settlement_items
  for each row execute function public.guard_freight_settlement_item();

create function public.guard_shipment_freight_settlement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_s record;
begin
  select fs.id, fs.status, fs.invoice_id,
         case when fs.numero is null then 'una liquidación en borrador'
              else 'la liquidación R-' || lpad(fs.numero::text, 8, '0') end as label
    into v_s
    from public.freight_settlement_items i
    join public.freight_settlements fs on fs.id = i.settlement_id
   where i.shipment_id = old.id
     and not i.released
   limit 1;
  if not found then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'La carga está en %: sacala o cancelá la liquidación antes de borrarla.', v_s.label
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- The liquidación links its grouped invoice and stamps the billed flete.
  if new.invoice_id is distinct from old.invoice_id
     and new.invoice_id is not null
     and new.invoice_id is not distinct from v_s.invoice_id then
    return new;
  end if;

  if (new.invoicing_claimed_at is not null
      and new.invoicing_claimed_at is distinct from old.invoicing_claimed_at)
     or (new.invoice_id is not null
      and new.invoice_id is distinct from old.invoice_id) then
    raise exception 'La carga está en %: se factura desde la liquidación.', v_s.label
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.client_id is distinct from old.client_id
     or new.status is distinct from old.status then
    raise exception 'La carga está en %: sacala o cancelá la liquidación para cambiar su cliente o su estado.', v_s.label
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_s.status <> 'draft'
     and new.freight_amount is distinct from old.freight_amount then
    raise exception 'La carga está en %, ya confirmada: su flete no cambia.', v_s.label
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_shipment_freight_settlement() from public, anon, authenticated;

create trigger shipments_guard_freight_settlement
  before update or delete on public.shipments
  for each row execute function public.guard_shipment_freight_settlement();

------------------------------------------------------------------------------
-- 5. A failed or cancelled invoice releases its liquidación
------------------------------------------------------------------------------

create function public.release_freight_settlement_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.freight_settlements
     set status = 'confirmed',
         invoice_id = null,
         invoicing_claimed_at = null
   where invoice_id = new.id
     and status = 'invoiced';
  return new;
end;
$$;

revoke all on function public.release_freight_settlement_invoice() from public, anon, authenticated;

create trigger invoices_release_freight_settlement
  after update of status on public.invoices
  for each row
  when ((new.status = 'failed' and old.status in ('draft', 'emitting'))
        or (new.status = 'cancelled' and old.status <> 'cancelled'))
  execute function public.release_freight_settlement_invoice();

------------------------------------------------------------------------------
-- 6. RPCs (service role; the server action is the permission gate)
------------------------------------------------------------------------------

-- The client's delivered cargas in the period that a liquidación can take:
-- not invoiced alone and in no other live liquidación (the one being edited
-- aside), each with its price (amount null = neither flete nor tariff).
create function public.freight_settlement_candidates(
  p_client_id     uuid,
  p_period_start  date,
  p_period_end    date,
  p_settlement_id uuid default null
)
returns table (
  shipment_id    uuid,
  remito_number  text,
  service_date   date,
  origin         text,
  destination    text,
  description    text,
  amount         numeric,
  price_source   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.remito_number, coalesce(s.delivery_date, s.scheduled_date),
         s.origin, s.destination, s.description, p.amount, p.price_source
    from public.shipments s
    cross join lateral public.freight_price(s.id) p
   where s.client_id = p_client_id
     and s.status = 'delivered'
     and s.invoice_id is null
     and coalesce(s.delivery_date, s.scheduled_date) between p_period_start and p_period_end
     and not exists (
       select 1
         from public.freight_settlement_items i
        where i.shipment_id = s.id
          and not i.released
          and i.settlement_id is distinct from p_settlement_id
     )
   order by coalesce(s.delivery_date, s.scheduled_date), s.remito_number, s.id
$$;

revoke all on function public.freight_settlement_candidates(uuid, date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.freight_settlement_candidates(uuid, date, date, uuid)
  to service_role;

-- Creates a draft (p_settlement_id null) or replaces a draft's period, notes
-- and cargas. Each carga must fall in the period and have a price; the item
-- guard checks client, delivery and liveness.
create function public.save_freight_settlement(
  p_client_id     uuid,
  p_period_start  date,
  p_period_end    date,
  p_shipment_ids  uuid[],
  p_notes         text,
  p_user_id       uuid,
  p_settlement_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid := p_settlement_id;
  v_current record;
  v_ship    record;
  v_price   record;
  v_count   integer := 0;
begin
  if p_period_end < p_period_start then
    raise exception 'El período termina antes de empezar.'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if coalesce(cardinality(p_shipment_ids), 0) = 0 then
    raise exception 'Elegí al menos una carga.'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  if v_id is null then
    insert into public.freight_settlements (
      client_id, period_start, period_end, notes, created_by
    ) values (
      p_client_id, p_period_start, p_period_end, nullif(trim(p_notes), ''), p_user_id
    )
    returning id into v_id;
  else
    select fs.status, fs.client_id
      into v_current
      from public.freight_settlements fs
     where fs.id = v_id
       for update;
    if not found then
      raise exception 'La liquidación no existe.'
        using errcode = 'P0002', hint = 'jouve_guard';
    end if;
    if v_current.status <> 'draft' then
      raise exception 'Solo se edita una liquidación en borrador.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if v_current.client_id <> p_client_id then
      raise exception 'El cliente de una liquidación no cambia: cancelala y armá otra.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    update public.freight_settlements
       set period_start = p_period_start,
           period_end = p_period_end,
           notes = nullif(trim(p_notes), '')
     where id = v_id;
    delete from public.freight_settlement_items where settlement_id = v_id;
  end if;

  for v_ship in
    select s.id,
           coalesce(s.delivery_date, s.scheduled_date) as service_date,
           coalesce(s.remito_number, left(s.id::text, 8)) as label
      from public.shipments s
     where s.id = any (p_shipment_ids)
     order by coalesce(s.delivery_date, s.scheduled_date), s.id
  loop
    v_count := v_count + 1;
    if v_ship.service_date is null
       or v_ship.service_date not between p_period_start and p_period_end then
      raise exception 'La carga % está fuera del período.', v_ship.label
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    select * into v_price from public.freight_price(v_ship.id);
    if v_price.amount is null or v_price.amount <= 0 then
      raise exception 'La carga % no tiene flete ni tarifa de flete vigente: cargá uno de los dos.', v_ship.label
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    insert into public.freight_settlement_items (
      settlement_id, shipment_id, amount, price_source, client_tariff_id
    ) values (
      v_id, v_ship.id, v_price.amount, v_price.price_source, v_price.client_tariff_id
    );
  end loop;

  if v_count <> (select count(distinct x) from unnest(p_shipment_ids) x) then
    raise exception 'Una de las cargas elegidas no existe.'
      using errcode = '23503', hint = 'jouve_guard';
  end if;

  update public.freight_settlements
     set total = (select coalesce(sum(i.amount), 0)
                    from public.freight_settlement_items i
                   where i.settlement_id = v_id)
   where id = v_id;

  return v_id;
end;
$$;

revoke all on function public.save_freight_settlement(uuid, date, date, uuid[], text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.save_freight_settlement(uuid, date, date, uuid[], text, uuid, uuid)
  to service_role;

-- Reprices the draft's cargas from their current flete or tariff, numbers it
-- (R, correlative under a lock) and confirms it. A second call on a confirmed
-- or invoiced liquidación returns its number: nothing changes twice.
create function public.confirm_freight_settlement(
  p_settlement_id uuid,
  p_user_id       uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s      record;
  v_item   record;
  v_price  record;
  v_total  numeric := 0;
  v_count  integer := 0;
  v_numero bigint;
begin
  select fs.status, fs.numero
    into v_s
    from public.freight_settlements fs
   where fs.id = p_settlement_id
     for update;
  if not found then
    raise exception 'La liquidación no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_s.status in ('confirmed', 'invoiced') then
    return v_s.numero;
  end if;
  if v_s.status <> 'draft' then
    raise exception 'La liquidación está cancelada.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  for v_item in
    select i.id, i.shipment_id,
           coalesce(s.remito_number, left(s.id::text, 8)) as label
      from public.freight_settlement_items i
      join public.shipments s on s.id = i.shipment_id
     where i.settlement_id = p_settlement_id
       and not i.released
     order by i.created_at, i.id
       for update of i
  loop
    select * into v_price from public.freight_price(v_item.shipment_id);
    if v_price.amount is null or v_price.amount <= 0 then
      raise exception 'La carga % ya no tiene flete ni tarifa de flete vigente: cargá uno de los dos.', v_item.label
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    update public.freight_settlement_items
       set amount = v_price.amount,
           price_source = v_price.price_source,
           client_tariff_id = v_price.client_tariff_id
     where id = v_item.id;
    v_total := v_total + v_price.amount;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'La liquidación no tiene cargas.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('freight_settlements:numero', 0));
  select coalesce(max(fs.numero), 0) + 1
    into v_numero
    from public.freight_settlements fs;

  update public.freight_settlements
     set status = 'confirmed',
         numero = v_numero,
         total = v_total,
         confirmed_at = now(),
         confirmed_by = p_user_id
   where id = p_settlement_id;

  return v_numero;
end;
$$;

revoke all on function public.confirm_freight_settlement(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_freight_settlement(uuid, uuid)
  to service_role;

-- Links the grouped invoice the app just issued: the liquidación becomes
-- invoiced and each carga points at the invoice with the billed flete (a
-- tariff-priced carga gets its price as flete, so trip revenue counts it).
-- The invoice row is locked first, so a failure being recorded at the same
-- time either runs before (and this refuses) or after (and releases it).
create function public.link_freight_settlement_invoice(
  p_settlement_id uuid,
  p_invoice_id    uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv record;
  v_s   record;
begin
  select i.client_id, i.kind, i.status
    into v_inv
    from public.invoices i
   where i.id = p_invoice_id
     for update;
  if not found then
    raise exception 'La factura no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  select fs.status, fs.client_id, fs.invoice_id
    into v_s
    from public.freight_settlements fs
   where fs.id = p_settlement_id
     for update;
  if not found then
    raise exception 'La liquidación no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_s.status = 'invoiced' and v_s.invoice_id = p_invoice_id then
    return;
  end if;
  if v_s.status <> 'confirmed' or v_s.invoice_id is not null then
    raise exception 'La liquidación ya no está confirmada: revisala antes de facturar.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_inv.client_id <> v_s.client_id or v_inv.kind <> 'factura' then
    raise exception 'La factura no es del cliente de la liquidación.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_inv.status in ('failed', 'cancelled') then
    raise exception 'La factura falló o se anuló: volvé a facturar la liquidación.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  update public.freight_settlements
     set status = 'invoiced',
         invoice_id = p_invoice_id,
         invoicing_claimed_at = null
   where id = p_settlement_id;

  update public.shipments s
     set invoice_id = p_invoice_id,
         invoicing_claimed_at = null,
         freight_amount = i.amount
    from public.freight_settlement_items i
   where i.settlement_id = p_settlement_id
     and not i.released
     and s.id = i.shipment_id;
end;
$$;

revoke all on function public.link_freight_settlement_invoice(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.link_freight_settlement_invoice(uuid, uuid)
  to service_role;

-- Cancels a liquidación and frees its cargas. An invoiced one passes only once
-- its invoice is void (guard_freight_settlement); its cargas then drop the
-- invoice link so they can be billed again. Cancelling twice is a no-op.
create function public.cancel_freight_settlement(
  p_settlement_id uuid,
  p_user_id       uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s record;
begin
  select fs.status, fs.invoice_id, fs.invoicing_claimed_at
    into v_s
    from public.freight_settlements fs
   where fs.id = p_settlement_id
     for update;
  if not found then
    raise exception 'La liquidación no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_s.status = 'cancelled' then
    return;
  end if;
  -- Its invoice is being issued right now: cancelling would orphan it.
  if v_s.invoice_id is null
     and coalesce(v_s.invoicing_claimed_at > now() - interval '15 minutes', false) then
    raise exception 'La liquidación se está facturando: esperá a que termine y volvé a intentar.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  update public.freight_settlements
     set status = 'cancelled',
         invoicing_claimed_at = null,
         cancelled_at = now(),
         cancelled_by = p_user_id
   where id = p_settlement_id;

  update public.freight_settlement_items
     set released = true
   where settlement_id = p_settlement_id
     and not released;

  if v_s.invoice_id is not null then
    update public.shipments s
       set invoice_id = null
      from public.freight_settlement_items i
     where i.settlement_id = p_settlement_id
       and s.id = i.shipment_id
       and s.invoice_id = v_s.invoice_id;
  end if;
end;
$$;

revoke all on function public.cancel_freight_settlement(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_freight_settlement(uuid, uuid)
  to service_role;

------------------------------------------------------------------------------
-- 7. RLS — billing data, read by owner/admin/finance; writes through the RPCs
------------------------------------------------------------------------------

alter table public.freight_settlements enable row level security;
alter table public.freight_settlement_items enable row level security;

create policy "freight_settlements select"
  on public.freight_settlements for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));
create policy "freight_settlement_items select"
  on public.freight_settlement_items for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.freight_settlements from public, anon;
revoke all on table public.freight_settlement_items from public, anon;
