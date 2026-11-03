SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The liquidación follows its client's side (decisions 2026-11-03, supersedes
-- the 4.3 "R" document): R is the remito fiscal and X the remito interno.
--
--   * Fiscal client: confirming numbers the liquidación as a Remito R,
--     R<pos>-<numero>, on the remito point of sale 9002 with its own
--     correlativo; "Facturar" then issues the grouped Factura A/B.
--   * Internal client: confirming gives no number. The app issues the
--     remito interno X (the grouped invoice on the internal channel) right
--     away, and that is the liquidación's document.
--   * A liquidación confirmed before this change keeps its R-00000012
--     (numero, channel null). confirm_freight_settlement(uuid, uuid) still
--     numbers that way, so code rolled back to before this change keeps
--     working; the app now calls confirm_freight_settlement_document.
--
-- Why 9002: AFIP keys a point of sale to one emission system, so a remito R
-- (pre-printed / CAI) cannot share the WSFE points of sale of the facturas
-- (0003 today, and AFIP hands out the next low numbers). 9001 is the local
-- point of sale of Otras ventas; 9002 sits next to it, outside AFIP's range.
-- freight_remito_pos() is the one place that says it.

------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------

-- New, all-null columns: nothing to scan or rewrite.
alter table public.freight_settlements
  add column channel        text check (channel in ('fiscal', 'internal')),
  -- A point of sale is at most 5 digits, an int like invoices.punto_venta.
  -- squawk-ignore prefer-bigint-over-int
  add column remito_pos     integer check (remito_pos between 1 and 99999),
  add column remito_number  bigint check (remito_number > 0);

comment on column public.freight_settlements.numero is
  'Legacy R-00000012 number of a liquidación confirmed before the remito R (channel null). New ones leave it null.';
comment on column public.freight_settlements.channel is
  'Side the liquidación was confirmed on: fiscal (Remito R, then Factura A/B) or internal (remito interno X). Null on a draft or a legacy liquidación.';
comment on column public.freight_settlements.remito_pos is
  'Remito R point of sale (freight_remito_pos()), fiscal side only.';
comment on column public.freight_settlements.remito_number is
  'Remito R correlativo within remito_pos, given at confirmation.';

alter table public.freight_settlements
  add constraint freight_settlements_remito_pair
    check ((remito_pos is null) = (remito_number is null)) not valid,
  add constraint freight_settlements_remito_fiscal
    check (remito_number is null or channel = 'fiscal') not valid,
  add constraint freight_settlements_legacy_numero
    check (numero is null or channel is null) not valid,
  add constraint freight_settlements_documented check (
    status not in ('confirmed', 'invoiced')
    or numero is not null
    or (channel = 'fiscal' and remito_number is not null)
    or channel = 'internal'
  ) not valid;

-- squawk-ignore constraint-missing-not-valid
alter table public.freight_settlements validate constraint freight_settlements_remito_pair;
-- squawk-ignore constraint-missing-not-valid
alter table public.freight_settlements validate constraint freight_settlements_remito_fiscal;
-- squawk-ignore constraint-missing-not-valid
alter table public.freight_settlements validate constraint freight_settlements_legacy_numero;
-- squawk-ignore constraint-missing-not-valid
alter table public.freight_settlements validate constraint freight_settlements_documented;

-- freight_settlements_documented covers it and also lets the new rows
-- through.
-- squawk-ignore ban-drop-constraint
alter table public.freight_settlements drop constraint freight_settlements_numbered;

-- remito_number is new and all null: the index starts empty.
-- squawk-ignore require-concurrent-index-creation
create unique index freight_settlements_remito_number
  on public.freight_settlements (remito_pos, remito_number)
  where remito_number is not null;

------------------------------------------------------------------------------
-- 2. Helpers
------------------------------------------------------------------------------

create function public.freight_remito_pos()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 9002
$$;

revoke all on function public.freight_remito_pos() from public, anon, authenticated;

-- How a guard message names a liquidación that is not a draft.
create function public.freight_settlement_label(
  p_numero        bigint,
  p_remito_pos    integer,
  p_remito_number bigint
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_remito_number is not null then
      'el remito R' || lpad(p_remito_pos::text, 4, '0') || '-' || lpad(p_remito_number::text, 8, '0')
    when p_numero is not null then
      'la liquidación R-' || lpad(p_numero::text, 8, '0')
    else 'una liquidación de Otras ventas'
  end
$$;

revoke all on function public.freight_settlement_label(bigint, integer, bigint)
  from public, anon, authenticated;

-- Reprices a draft's live cargas from their current flete or tariff and
-- returns the total. Both confirm RPCs call it under the liquidación's lock.
create function public.reprice_freight_settlement(p_settlement_id uuid)
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  v_item  record;
  v_price record;
  v_total numeric := 0;
  v_count integer := 0;
begin
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
  return v_total;
end;
$$;

revoke all on function public.reprice_freight_settlement(uuid) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 3. Guards: the document freezes with the liquidación; messages name it
------------------------------------------------------------------------------

create or replace function public.guard_freight_settlement()
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
       or new.numero is distinct from old.numero
       or new.channel is distinct from old.channel
       or new.remito_pos is distinct from old.remito_pos
       or new.remito_number is distinct from old.remito_number) then
    raise exception 'La liquidación ya está confirmada: no se pueden cambiar su período, sus cargas, su total ni su número.'
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

create or replace function public.guard_freight_settlement_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_settlement record;
  v_ship       record;
  v_other      record;
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

  select fs.status, fs.numero, fs.remito_pos, fs.remito_number
    into v_other
    from public.freight_settlement_items i
    join public.freight_settlements fs on fs.id = i.settlement_id
   where i.shipment_id = new.shipment_id
     and not i.released
     and i.id <> new.id
   limit 1;
  if found then
    raise exception 'La carga % ya está en %.', v_ship.label,
        case when v_other.status = 'draft' then 'otra liquidación en borrador'
             else public.freight_settlement_label(v_other.numero, v_other.remito_pos, v_other.remito_number) end
      using errcode = '23505', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

create or replace function public.guard_shipment_freight_settlement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_s record;
begin
  select fs.id, fs.status, fs.invoice_id,
         case when fs.status = 'draft' then 'una liquidación en borrador'
              else public.freight_settlement_label(fs.numero, fs.remito_pos, fs.remito_number) end as label
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

------------------------------------------------------------------------------
-- 4. Confirming
------------------------------------------------------------------------------

-- Legacy numbering (R-00000012), kept with its signature and result for code
-- deployed before this change: same behaviour, repricing moved to the helper.
create or replace function public.confirm_freight_settlement(
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
  v_total  numeric;
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

  v_total := public.reprice_freight_settlement(p_settlement_id);

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

-- Reprices the draft and confirms it on its client's side: a fiscal one takes
-- the next Remito R number of freight_remito_pos() (correlative under a lock),
-- an internal one no number (its document is the remito interno X the app
-- issues next). A second call returns what the first one gave, legacy
-- liquidaciones included.
create function public.confirm_freight_settlement_document(
  p_settlement_id uuid,
  p_user_id       uuid
)
returns table (
  channel       text,
  numero        bigint,
  remito_pos    integer,
  remito_number bigint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_s       record;
  v_total   numeric;
  v_channel text;
  v_pos     integer;
  v_number  bigint;
begin
  select fs.status, fs.numero, fs.channel, fs.remito_pos, fs.remito_number,
         c.is_fiscal
    into v_s
    from public.freight_settlements fs
    join public.clients c on c.id = fs.client_id
   where fs.id = p_settlement_id
     for update of fs;
  if not found then
    raise exception 'La liquidación no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_s.status in ('confirmed', 'invoiced') then
    return query select v_s.channel, v_s.numero, v_s.remito_pos, v_s.remito_number;
    return;
  end if;
  if v_s.status <> 'draft' then
    raise exception 'La liquidación está cancelada.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  v_total := public.reprice_freight_settlement(p_settlement_id);

  if v_s.is_fiscal then
    v_channel := 'fiscal';
    v_pos := public.freight_remito_pos();
    perform pg_advisory_xact_lock(
      hashtextextended('freight_settlements:remito:' || v_pos::text, 0));
    select coalesce(max(fs.remito_number), 0) + 1
      into v_number
      from public.freight_settlements fs
     where fs.remito_pos = v_pos;
  else
    v_channel := 'internal';
  end if;

  update public.freight_settlements
     set status = 'confirmed',
         channel = v_channel,
         remito_pos = v_pos,
         remito_number = v_number,
         total = v_total,
         confirmed_at = now(),
         confirmed_by = p_user_id
   where id = p_settlement_id;

  return query select v_channel, null::bigint, v_pos, v_number;
end;
$$;

revoke all on function public.confirm_freight_settlement_document(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_freight_settlement_document(uuid, uuid)
  to service_role;
