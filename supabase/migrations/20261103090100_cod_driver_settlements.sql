SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Cobranza contra entrega y rendición del chofer (roadmap 4.5).
--
--   1. shipments.cod_amount: what the driver collects from the client at
--      delivery (null = the carga is not cash-on-delivery).
--   2. driver_settlements (rendiciones) + items (one per carga, with the
--      amount expected) + lines (what the driver handed in for it: account,
--      amount, reference and, for a check account, the check). A carga is in
--      at most one live rendición (driver_settlement_items_live_shipment and
--      guard_driver_settlement_item, which also requires a delivered
--      cash-on-delivery carga with a client, on a trip of the rendición's
--      driver). The difference is Σ lines − expected, per carga.
--   3. confirm_driver_settlement posts what was handed in as receipts, one per
--      client and channel, through create_receipt: the receipt owns its
--      treasury movements and its checks (cartera) like any receipt, and is
--      applied to the carga's emitted invoice up to its open amount (the rest
--      stays on account). It runs under a row lock and returns the same
--      receipts on a second call, so nothing is posted twice.
--   4. A confirmed rendición is frozen; cancelling it requires its receipts
--      to be cancelled first (receipts module, with its own guards). A carga
--      in a live rendición keeps its client, amount, trip and status.
--
-- RLS: treasury data, like receipts -> owner/admin/finance read; every write
-- goes through the RPCs (service role; the action gates on receipts:write).

------------------------------------------------------------------------------
-- 1. Cash on delivery on the carga
------------------------------------------------------------------------------

alter table public.shipments
  add column cod_amount numeric(14, 2);

alter table public.shipments
  add constraint shipments_cod_amount_positive
    check (cod_amount is null or cod_amount > 0) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.shipments validate constraint shipments_cod_amount_positive;

comment on column public.shipments.cod_amount is
  'Cobranza contra entrega: lo que el chofer cobra al cliente al entregar (en pesos). Null = no es contra entrega.';

------------------------------------------------------------------------------
-- 2. Tables
------------------------------------------------------------------------------

create table public.driver_settlements (
  id               uuid primary key default gen_random_uuid(),
  -- Correlative given at confirmation (a draft has none).
  numero           bigint unique,
  driver_id        uuid not null references public.drivers (id) on delete restrict,
  settlement_date  date not null,
  status           text not null default 'draft'
                     check (status in ('draft', 'confirmed', 'cancelled')),
  notes            text check (length(notes) <= 1000),
  created_by       uuid references auth.users (id) on delete set null,
  confirmed_at     timestamptz,
  confirmed_by     uuid references auth.users (id) on delete set null,
  cancelled_at     timestamptz,
  cancelled_by     uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint driver_settlements_numbered
    check (status <> 'confirmed' or numero is not null)
);

comment on table public.driver_settlements is
  'Rendición de cobranza contra entrega: lo que un chofer entrega por las cargas que cobró. Confirmada genera los recibos (uno por cliente y canal).';

create index driver_settlements_driver_idx
  on public.driver_settlements (driver_id, settlement_date desc);

create trigger driver_settlements_set_updated_at
  before update on public.driver_settlements
  for each row execute function public.set_updated_at();

create table public.driver_settlement_items (
  id               uuid primary key default gen_random_uuid(),
  settlement_id    uuid not null references public.driver_settlements (id) on delete cascade,
  shipment_id      uuid not null references public.shipments (id) on delete restrict,
  -- The carga's cod_amount, refreshed at confirmation.
  expected_amount  numeric(14, 2) not null check (expected_amount > 0),
  note             text check (length(note) <= 500),
  -- True once the rendición is cancelled: the carga is pending again.
  released         boolean not null default false,
  created_at       timestamptz not null default now()
);

comment on table public.driver_settlement_items is
  'Cargas contra entrega de una rendición, con lo que el chofer tenía que cobrar.';

create index driver_settlement_items_settlement_idx
  on public.driver_settlement_items (settlement_id);
create unique index driver_settlement_items_live_shipment
  on public.driver_settlement_items (shipment_id) where not released;

create table public.driver_settlement_lines (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references public.driver_settlement_items (id) on delete cascade,
  account_id        uuid not null references public.accounts (id) on delete restrict,
  amount            numeric(14, 2) not null check (amount > 0),
  reference         text check (length(reference) <= 120),
  -- The check received, when account_id is a check account.
  check_number      text check (length(check_number) <= 60),
  bank_name         text check (length(bank_name) <= 120),
  drawer_name       text check (length(drawer_name) <= 160),
  drawer_cuit       text check (length(drawer_cuit) <= 20),
  check_issue_date  date,
  check_due_date    date,
  -- The receipt that posted this line (set at confirmation).
  receipt_id        uuid references public.receipts (id) on delete restrict,
  created_at        timestamptz not null default now()
);

comment on table public.driver_settlement_lines is
  'Lo entregado por una carga de la rendición: cuenta (efectivo, banco, cheques), importe y cheque. receipt_id = el recibo que lo asentó.';

create index driver_settlement_lines_item_idx
  on public.driver_settlement_lines (item_id);
create index driver_settlement_lines_receipt_idx
  on public.driver_settlement_lines (receipt_id) where receipt_id is not null;
create index driver_settlement_lines_account_idx
  on public.driver_settlement_lines (account_id);

------------------------------------------------------------------------------
-- 3. Guards
------------------------------------------------------------------------------

create function public.guard_driver_settlement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Una rendición confirmada no se borra: cancelala.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return old;
  end if;

  if old.status = 'cancelled' then
    raise exception 'La rendición está cancelada.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.driver_id is distinct from old.driver_id then
    raise exception 'El chofer de una rendición no cambia: cancelala y armá otra.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if old.status = 'confirmed'
     and (new.settlement_date is distinct from old.settlement_date
       or new.numero is distinct from old.numero) then
    raise exception 'La rendición ya está confirmada: no cambia.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status = old.status
     or (old.status = 'draft' and new.status in ('confirmed', 'cancelled')) then
    return new;
  end if;

  if old.status = 'confirmed' and new.status = 'cancelled' then
    if exists (
      select 1
        from public.driver_settlement_lines l
        join public.driver_settlement_items i on i.id = l.item_id
        join public.receipts r on r.id = l.receipt_id
       where i.settlement_id = old.id
         and r.status <> 'canceled'
    ) then
      raise exception 'La rendición tiene recibos vigentes: anulalos antes de cancelarla.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  raise exception 'Una rendición % no pasa a %.', old.status, new.status
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_driver_settlement() from public, anon, authenticated;

create trigger driver_settlements_guard
  before update or delete on public.driver_settlements
  for each row execute function public.guard_driver_settlement();

create function public.guard_driver_settlement_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_settlement record;
  v_ship       record;
  v_other      bigint;
begin
  select ds.status, ds.driver_id
    into v_settlement
    from public.driver_settlements ds
   where ds.id = coalesce(new.settlement_id, old.settlement_id);

  if tg_op = 'DELETE' then
    -- Not found: the rendición itself is being deleted (a draft).
    if v_settlement.status is null or v_settlement.status = 'draft' then
      return old;
    end if;
    raise exception 'La rendición ya está confirmada: no se pueden sacar cargas.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if tg_op = 'UPDATE' then
    if new.settlement_id is distinct from old.settlement_id
       or new.shipment_id is distinct from old.shipment_id then
      raise exception 'Una carga no se pasa de una rendición a otra.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if old.released then
      raise exception 'La carga ya se liberó de esta rendición.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    -- Cancelling releases the cargas; a draft refreshes what was expected.
    if (new.released and v_settlement.status = 'cancelled'
        and new.expected_amount = old.expected_amount
        and new.note is not distinct from old.note)
       or (not new.released and v_settlement.status = 'draft') then
      return new;
    end if;
    raise exception 'La rendición ya está confirmada: no se pueden cambiar sus cargas.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- INSERT
  if v_settlement.status is distinct from 'draft' then
    raise exception 'Solo se agregan cargas a una rendición en borrador.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.released then
    raise exception 'Una carga nueva entra viva en la rendición.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select s.client_id, s.status, s.cod_amount, t.driver_id,
         coalesce(s.remito_number, left(s.id::text, 8)) as label
    into v_ship
    from public.shipments s
    left join public.trips t on t.id = s.trip_id
   where s.id = new.shipment_id
     for update of s;
  if not found then
    raise exception 'La carga no existe.'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_ship.cod_amount is null then
    raise exception 'La carga % no es contra entrega.', v_ship.label
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_ship.client_id is null then
    raise exception 'La carga % no tiene cliente: el recibo necesita uno.', v_ship.label
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_ship.status <> 'delivered' then
    raise exception 'La carga % no está entregada: se rinde lo cobrado al entregar.', v_ship.label
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_ship.driver_id is distinct from v_settlement.driver_id then
    raise exception 'La carga % no viajó con este chofer.', v_ship.label
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select ds.numero
    into v_other
    from public.driver_settlement_items i
    join public.driver_settlements ds on ds.id = i.settlement_id
   where i.shipment_id = new.shipment_id
     and not i.released
     and i.id <> new.id
   limit 1;
  if found then
    raise exception 'La carga % ya está en %.', v_ship.label,
        case when v_other is null then 'otra rendición en borrador'
             else 'la rendición N° ' || v_other end
      using errcode = '23505', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_driver_settlement_item() from public, anon, authenticated;

create trigger driver_settlement_items_guard
  before insert or update or delete on public.driver_settlement_items
  for each row execute function public.guard_driver_settlement_item();

-- What the driver handed in changes only while the rendición is a draft
-- (confirm stamps receipt_id before it flips the status).
create function public.guard_driver_settlement_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select ds.status
    into v_status
    from public.driver_settlement_items i
    join public.driver_settlements ds on ds.id = i.settlement_id
   where i.id = coalesce(new.item_id, old.item_id);

  if v_status is null and tg_op = 'DELETE' then
    return old;
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'La rendición ya está confirmada: lo entregado no cambia.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if tg_op = 'UPDATE' and new.item_id is distinct from old.item_id then
    raise exception 'Un pago no se pasa de una carga a otra.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.guard_driver_settlement_line() from public, anon, authenticated;

create trigger driver_settlement_lines_guard
  before insert or update or delete on public.driver_settlement_lines
  for each row execute function public.guard_driver_settlement_line();

create function public.guard_shipment_driver_settlement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_label text;
begin
  select case when ds.numero is null then 'una rendición en borrador'
              else 'la rendición N° ' || ds.numero end
    into v_label
    from public.driver_settlement_items i
    join public.driver_settlements ds on ds.id = i.settlement_id
   where i.shipment_id = old.id
     and not i.released
   limit 1;
  if not found then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'La carga está en %: sacala o cancelá la rendición antes de borrarla.', v_label
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if new.cod_amount is distinct from old.cod_amount
     or new.client_id is distinct from old.client_id
     or new.trip_id is distinct from old.trip_id
     or new.status is distinct from old.status then
    raise exception 'La carga está en %: sacala o cancelá la rendición para cambiar su cobranza, cliente, viaje o estado.', v_label
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_shipment_driver_settlement() from public, anon, authenticated;

create trigger shipments_guard_driver_settlement
  before update or delete on public.shipments
  for each row execute function public.guard_shipment_driver_settlement();

-- The driver of a trip with cargas in a live rendición stays.
create function public.guard_trip_driver_settlement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.driver_id is distinct from old.driver_id
     and exists (
       select 1
         from public.shipments s
         join public.driver_settlement_items i
           on i.shipment_id = s.id and not i.released
        where s.trip_id = old.id
     ) then
    raise exception 'El viaje tiene cargas en una rendición: cancelala antes de cambiar el chofer.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_trip_driver_settlement() from public, anon, authenticated;

create trigger trips_guard_driver_settlement
  before update of driver_id on public.trips
  for each row execute function public.guard_trip_driver_settlement();

------------------------------------------------------------------------------
-- 4. RPCs (service role; the server action is the permission gate)
------------------------------------------------------------------------------

-- Creates a draft (p_settlement_id null) or replaces a draft's date, notes,
-- cargas and lines. p_items: [{ shipment_id, note?, lines: [{ account_id,
-- amount, reference?, check_number?, bank_name?, drawer_name?, drawer_cuit?,
-- check_issue_date?, check_due_date? }] }]. A line goes to an active ARS
-- account; a check account needs the check's number, bank and due date.
create function public.save_driver_settlement(
  p_driver_id       uuid,
  p_settlement_date date,
  p_notes           text,
  p_items           jsonb,
  p_user_id         uuid,
  p_settlement_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid := p_settlement_id;
  v_current  record;
  v_item     jsonb;
  v_line     jsonb;
  v_item_id  uuid;
  v_expected numeric;
  v_account  record;
begin
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Elegí al menos una carga.'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  if v_id is null then
    insert into public.driver_settlements (
      driver_id, settlement_date, notes, created_by
    ) values (
      p_driver_id, p_settlement_date, nullif(trim(p_notes), ''), p_user_id
    )
    returning id into v_id;
  else
    select ds.status, ds.driver_id
      into v_current
      from public.driver_settlements ds
     where ds.id = v_id
       for update;
    if not found then
      raise exception 'La rendición no existe.'
        using errcode = 'P0002', hint = 'jouve_guard';
    end if;
    if v_current.status <> 'draft' then
      raise exception 'Solo se edita una rendición en borrador.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if v_current.driver_id <> p_driver_id then
      raise exception 'El chofer de una rendición no cambia: cancelala y armá otra.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    update public.driver_settlements
       set settlement_date = p_settlement_date,
           notes = nullif(trim(p_notes), '')
     where id = v_id;
    delete from public.driver_settlement_items where settlement_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select s.cod_amount
      into v_expected
      from public.shipments s
     where s.id = (v_item->>'shipment_id')::uuid;
    insert into public.driver_settlement_items (
      settlement_id, shipment_id, expected_amount, note
    ) values (
      v_id,
      (v_item->>'shipment_id')::uuid,
      v_expected,
      nullif(trim(v_item->>'note'), '')
    )
    returning id into v_item_id;

    for v_line in
      select * from jsonb_array_elements(coalesce(v_item->'lines', '[]'::jsonb))
    loop
      select a.type, a.currency, a.is_active
        into v_account
        from public.accounts a
       where a.id = (v_line->>'account_id')::uuid;
      if not found or not v_account.is_active then
        raise exception 'La cuenta elegida no existe o está inactiva.'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
      if v_account.currency <> 'ARS' then
        raise exception 'La rendición se asienta en pesos: elegí una cuenta en ARS.'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
      if v_account.type in ('checks', 'echeq')
         and (nullif(trim(v_line->>'check_number'), '') is null
           or nullif(trim(v_line->>'bank_name'), '') is null
           or nullif(v_line->>'check_due_date', '') is null) then
        raise exception 'Un cheque necesita número, banco y fecha de pago.'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
      insert into public.driver_settlement_lines (
        item_id, account_id, amount, reference, check_number, bank_name,
        drawer_name, drawer_cuit, check_issue_date, check_due_date
      ) values (
        v_item_id,
        (v_line->>'account_id')::uuid,
        (v_line->>'amount')::numeric,
        nullif(trim(v_line->>'reference'), ''),
        case when v_account.type in ('checks', 'echeq')
             then nullif(trim(v_line->>'check_number'), '') end,
        case when v_account.type in ('checks', 'echeq')
             then nullif(trim(v_line->>'bank_name'), '') end,
        case when v_account.type in ('checks', 'echeq')
             then nullif(trim(v_line->>'drawer_name'), '') end,
        case when v_account.type in ('checks', 'echeq')
             then nullif(trim(v_line->>'drawer_cuit'), '') end,
        case when v_account.type in ('checks', 'echeq')
             then nullif(v_line->>'check_issue_date', '')::date end,
        case when v_account.type in ('checks', 'echeq')
             then nullif(v_line->>'check_due_date', '')::date end
      );
    end loop;
  end loop;

  return v_id;
end;
$$;

revoke all on function public.save_driver_settlement(uuid, date, text, jsonb, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.save_driver_settlement(uuid, date, text, jsonb, uuid, uuid)
  to service_role;

-- Posts the rendición: one receipt per client and channel with what the
-- driver handed in for that client's cargas (create_receipt books each line
-- in its account and puts each check in cartera), applied to each carga's
-- emitted invoice up to what it still owes. The channel is the invoice's,
-- else the carga's, else the client's side. Returns the receipts; a
-- confirmed rendición returns the ones it already posted.
create function public.confirm_driver_settlement(
  p_settlement_id uuid,
  p_user_id       uuid
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s        record;
  v_item     record;
  v_group    record;
  v_inv      record;
  v_count    integer := 0;
  v_allocs   jsonb;
  v_left     numeric;
  v_apply    numeric;
  v_pos      integer;
  v_numero   integer;
  v_receipt  uuid;
  v_receipts uuid[] := '{}';
  v_driver   text;
  v_numero_s bigint;
begin
  select ds.status, ds.settlement_date, ds.numero, d.full_name
    into v_s
    from public.driver_settlements ds
    join public.drivers d on d.id = ds.driver_id
   where ds.id = p_settlement_id
     for update of ds;
  if not found then
    raise exception 'La rendición no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_s.status = 'confirmed' then
    select coalesce(array_agg(distinct l.receipt_id), '{}')
      into v_receipts
      from public.driver_settlement_lines l
      join public.driver_settlement_items i on i.id = l.item_id
     where i.settlement_id = p_settlement_id
       and l.receipt_id is not null;
    return v_receipts;
  end if;
  if v_s.status <> 'draft' then
    raise exception 'La rendición está cancelada.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  v_driver := v_s.full_name;

  -- What was expected is the carga's amount now.
  for v_item in
    select i.id, s.cod_amount,
           coalesce(s.remito_number, left(s.id::text, 8)) as label
      from public.driver_settlement_items i
      join public.shipments s on s.id = i.shipment_id
     where i.settlement_id = p_settlement_id
       and not i.released
       for update of i
  loop
    if v_item.cod_amount is null then
      raise exception 'La carga % ya no es contra entrega: sacala de la rendición.', v_item.label
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    update public.driver_settlement_items
       set expected_amount = v_item.cod_amount
     where id = v_item.id;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    raise exception 'La rendición no tiene cargas.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('driver_settlements:numero', 0));
  select coalesce(max(ds.numero), 0) + 1
    into v_numero_s
    from public.driver_settlements ds;

  for v_group in
    with lines as (
      select l.id, l.account_id, l.amount, l.reference, l.check_number,
             l.bank_name, l.drawer_name, l.drawer_cuit, l.check_issue_date,
             l.check_due_date, l.created_at, s.client_id, c.legal_name,
             coalesce(
               case when inv.status in ('draft', 'emitting', 'emitted')
                    then inv.channel_id end,
               s.channel_id,
               (select ch.id
                  from public.invoicing_channels ch
                 where ch.is_fiscal = c.is_fiscal and ch.is_active
                 order by ch.id
                 limit 1)
             ) as channel_id
        from public.driver_settlement_items i
        join public.driver_settlement_lines l on l.item_id = i.id
        join public.shipments s on s.id = i.shipment_id
        join public.clients c on c.id = s.client_id
        left join public.invoices inv on inv.id = s.invoice_id
       where i.settlement_id = p_settlement_id
         and not i.released
    )
    select client_id, channel_id, sum(amount) as total,
           array_agg(id) as line_ids,
           jsonb_agg(
             jsonb_build_object(
               'account_id', account_id,
               'amount', amount,
               'reference', coalesce(reference, check_number),
               'check', case when check_number is not null then
                 jsonb_build_object(
                   'check_number', check_number,
                   'bank_name', bank_name,
                   'drawer_name', coalesce(drawer_name, legal_name),
                   'drawer_cuit', drawer_cuit,
                   'issue_date', check_issue_date,
                   'due_date', check_due_date
                 ) end
             )
             order by created_at, id
           ) as payment_lines
      from lines
     group by client_id, channel_id
     order by client_id, channel_id
  loop
    if v_group.channel_id is null then
      raise exception 'No hay un canal activo para el recibo del cliente.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;

    -- Each carga's emitted invoice takes what was collected for it, up to
    -- what it still owes; the rest of the receipt stays on account.
    v_allocs := '[]'::jsonb;
    v_left := v_group.total;
    for v_inv in
      select s.invoice_id, sum(l.amount) as collected
        from public.driver_settlement_lines l
        join public.driver_settlement_items i on i.id = l.item_id
        join public.shipments s on s.id = i.shipment_id
        join public.invoices inv on inv.id = s.invoice_id
       where l.id = any (v_group.line_ids)
         and inv.status = 'emitted'
         and inv.kind in ('factura', 'nd')
         and inv.channel_id = v_group.channel_id
         and coalesce(inv.moneda, 'PES') not in ('DOL', 'USD')
       group by s.invoice_id
       order by min(inv.fecha), s.invoice_id
    loop
      v_apply := least(
        v_inv.collected,
        greatest(public.invoice_open_amount(v_inv.invoice_id), 0),
        v_left
      );
      if v_apply > 0 then
        v_allocs := v_allocs || jsonb_build_array(
          jsonb_build_object('invoice_id', v_inv.invoice_id, 'amount_applied', v_apply)
        );
        v_left := v_left - v_apply;
      end if;
    end loop;

    select sp.numero
      into v_pos
      from public.sales_points sp
     where sp.channel_id = v_group.channel_id and sp.is_enabled
     order by sp.numero
     limit 1;
    if v_pos is null then
      raise exception 'El canal % no tiene un punto de venta habilitado para recibos.', v_group.channel_id
        using errcode = '23514', hint = 'jouve_guard';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('receipts:numero:' || v_group.channel_id || ':' || v_pos, 0)
    );
    select coalesce(max(r.numero), 0) + 1
      into v_numero
      from public.receipts r
     where r.channel_id = v_group.channel_id and r.punto_venta = v_pos;

    v_receipt := public.create_receipt(
      v_group.channel_id,
      v_pos,
      v_numero,
      v_group.client_id,
      v_s.settlement_date,
      v_group.total,
      'ARS',
      'Rendición N° ' || v_numero_s || ' — cobranza contra entrega de ' || v_driver || '.',
      v_group.payment_lines,
      v_allocs,
      '[]'::jsonb,
      null
    );
    update public.receipts set created_by = p_user_id where id = v_receipt;
    update public.driver_settlement_lines
       set receipt_id = v_receipt
     where id = any (v_group.line_ids);
    v_receipts := v_receipts || v_receipt;
  end loop;

  update public.driver_settlements
     set status = 'confirmed',
         numero = v_numero_s,
         confirmed_at = now(),
         confirmed_by = p_user_id
   where id = p_settlement_id;

  return v_receipts;
end;
$$;

revoke all on function public.confirm_driver_settlement(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_driver_settlement(uuid, uuid)
  to service_role;

-- Cancels a rendición and frees its cargas. A confirmed one passes only once
-- every receipt it posted is cancelled (guard_driver_settlement). Cancelling
-- twice is a no-op.
create function public.cancel_driver_settlement(
  p_settlement_id uuid,
  p_user_id       uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select ds.status
    into v_status
    from public.driver_settlements ds
   where ds.id = p_settlement_id
     for update;
  if not found then
    raise exception 'La rendición no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_status = 'cancelled' then
    return;
  end if;

  update public.driver_settlements
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = p_user_id
   where id = p_settlement_id;

  update public.driver_settlement_items
     set released = true
   where settlement_id = p_settlement_id
     and not released;
end;
$$;

revoke all on function public.cancel_driver_settlement(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_driver_settlement(uuid, uuid)
  to service_role;

------------------------------------------------------------------------------
-- 5. RLS — treasury data, read by owner/admin/finance; writes through the RPCs
------------------------------------------------------------------------------

alter table public.driver_settlements enable row level security;
alter table public.driver_settlement_items enable row level security;
alter table public.driver_settlement_lines enable row level security;

create policy "driver_settlements select"
  on public.driver_settlements for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));
create policy "driver_settlement_items select"
  on public.driver_settlement_items for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));
create policy "driver_settlement_lines select"
  on public.driver_settlement_lines for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.driver_settlements from public, anon;
revoke all on table public.driver_settlement_items from public, anon;
revoke all on table public.driver_settlement_lines from public, anon;
