SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- 1. post_driver_settlement_difference: the message for a driver with no
--    employee told the user to link him «en Flota › Choferes», a field that
--    does not exist (only an employee with position «Chofer / Acompañante»
--    has a driver tied to him). A driver with no employee is a hired one with
--    no current account, so the difference can only go to the client. The
--    body is 20261104095300_driver_settlement_difference_sides's with only
--    that message changed; security, search_path and grants are kept.
--
-- 2. invoices.notes: the internal «Observaciones» of a sales NC/ND. Shown on
--    the comprobante's detail only; never sent to AFIP nor printed.
--
-- Rollback: older code neither reads nor writes invoices.notes (nullable, no
-- default) and calls post_driver_settlement_difference with the same
-- signature.

------------------------------------------------------------------------------

alter table public.invoices add column notes text;

comment on column public.invoices.notes is
  'Observaciones internas del comprobante (NC/ND de venta). No se envían a AFIP ni van al PDF.';

------------------------------------------------------------------------------

create or replace function public.post_driver_settlement_difference(
  p_settlement_id uuid,
  p_user_id       uuid,
  p_charged_to    text default 'driver'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s          record;
  v_existing   uuid;
  v_expected   numeric;
  v_received   numeric;
  v_difference numeric;
  v_items      jsonb;
  v_channel    text;
  v_account    uuid;
  v_group      record;
  v_inv        record;
  v_allocs     jsonb;
  v_left       numeric;
  v_apply      numeric;
  v_pos        integer;
  v_channels   integer;
  v_numero     integer;
  v_receipt    uuid;
  v_label      text;
  v_id         uuid;
begin
  if p_charged_to is null or p_charged_to not in ('driver', 'client') then
    raise exception 'La diferencia queda a cargo del chofer o del cliente.'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  select ds.status, ds.numero, ds.settlement_date, ds.difference_charged_to,
         d.employee_id, d.full_name
    into v_s
    from public.driver_settlements ds
    join public.drivers d on d.id = ds.driver_id
   where ds.id = p_settlement_id
     for update of ds;
  if not found then
    raise exception 'La rendición no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  select m.id into v_existing
    from public.employee_account_movements m
   where m.driver_settlement_id = p_settlement_id;
  if v_s.difference_charged_to is not null or v_existing is not null then
    if coalesce(v_s.difference_charged_to, 'driver') = p_charged_to then
      return v_existing;
    end if;
    raise exception 'La diferencia ya quedó a cargo del %: quitala antes de cambiarla.',
        case when coalesce(v_s.difference_charged_to, 'driver') = 'driver' then 'chofer' else 'cliente' end
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if v_s.status <> 'confirmed' then
    raise exception 'Solo se asienta la diferencia de una rendición confirmada.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- A receipt cancelled or edited in Recibos makes the difference stale.
  if exists (
    select 1
      from public.driver_settlement_lines l
      join public.driver_settlement_items i on i.id = l.item_id
      join public.receipts r on r.id = l.receipt_id
     where i.settlement_id = p_settlement_id
     group by r.id, r.status, r.total_amount
    having r.status <> 'issued' or r.total_amount <> sum(l.amount)
  ) then
    raise exception 'Un recibo de la rendición se anuló o se editó en Recibos: revisala antes de asentar la diferencia.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  select coalesce(sum(i.expected_amount), 0)
    into v_expected
    from public.driver_settlement_items i
   where i.settlement_id = p_settlement_id
     and not i.released;
  select coalesce(sum(l.amount), 0)
    into v_received
    from public.driver_settlement_lines l
    join public.driver_settlement_items i on i.id = l.item_id
   where i.settlement_id = p_settlement_id
     and not i.released;
  v_difference := round(v_received - v_expected, 2);
  if v_difference = 0 then
    raise exception 'La rendición no tiene diferencia: no hay nada que asentar.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if p_charged_to = 'client' then
    update public.driver_settlements
       set difference_charged_to = 'client'
     where id = p_settlement_id;
    return null;
  end if;

  if v_s.employee_id is null then
    raise exception 'El chofer % es contratado, sin legajo: no tiene cuenta corriente donde cargarle la diferencia. Dejala a cargo del cliente.', v_s.full_name
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_difference > 0 then
    raise exception 'El sobrante quedó a cuenta del cliente en el recibo de la rendición: dejalo a cargo del cliente, o anulá el recibo, cancelá la rendición y cargá lo que cobró el chofer.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- Per carga: what it was short, its client, the channel its receipt went
  -- to (same rule as confirm_driver_settlement) and its invoice.
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    into v_items
    from (
      select i.id as item_id,
             s.client_id,
             s.invoice_id,
             coalesce(
               case when inv.status in ('draft', 'emitting', 'emitted')
                    then inv.channel_id end,
               s.channel_id,
               (select ch.id
                  from public.invoicing_channels ch
                 where ch.is_fiscal = c.is_fiscal and ch.is_active
                 order by ch.id
                 limit 1)
             ) as channel_id,
             round(i.expected_amount - coalesce((
               select sum(l.amount) from public.driver_settlement_lines l where l.item_id = i.id
             ), 0), 2) as shortfall
        from public.driver_settlement_items i
        join public.shipments s on s.id = i.shipment_id
        join public.clients c on c.id = s.client_id
        left join public.invoices inv on inv.id = s.invoice_id
       where i.settlement_id = p_settlement_id
         and not i.released
    ) x;

  if exists (
    select 1 from jsonb_to_recordset(v_items) as t(shortfall numeric) where t.shortfall < 0
  ) then
    raise exception 'La rendición tiene cargas con faltante y otras con sobrante: dejá la diferencia a cargo del cliente o corregí lo entregado.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select min(t.channel_id), count(distinct t.channel_id)
    into v_channel, v_channels
    from jsonb_to_recordset(v_items) as t(channel_id text, shortfall numeric)
   where t.shortfall > 0;
  if v_channels <> 1 or v_channel is null then
    raise exception 'El faltante es de cargas de distintos canales: dejá la diferencia a cargo del cliente.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- The cash account the shortfall passes through (in and out the same day):
  -- the rendición's own, else the first active ARS cash account.
  select l.account_id
    into v_account
    from public.driver_settlement_lines l
    join public.driver_settlement_items i on i.id = l.item_id
    join public.accounts a on a.id = l.account_id
   where i.settlement_id = p_settlement_id
     and not i.released
     and a.type = 'cash' and a.currency = 'ARS' and a.is_active
   order by l.created_at, l.id
   limit 1;
  if v_account is null then
    select a.id into v_account
      from public.accounts a
     where a.type = 'cash' and a.currency = 'ARS' and a.is_active
     order by a.name, a.id
     limit 1;
  end if;
  if v_account is null then
    raise exception 'No hay una cuenta de efectivo en pesos activa para registrar el faltante.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select sp.numero
    into v_pos
    from public.sales_points sp
   where sp.channel_id = v_channel and sp.is_enabled
   order by sp.numero
   limit 1;
  if v_pos is null then
    raise exception 'El canal % no tiene un punto de venta habilitado para recibos.', v_channel
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  v_label := 'Rendición N° ' || v_s.numero || ' — faltante de cobranza contra entrega';

  -- One receipt per client: the client paid it (the driver kept it).
  for v_group in
    select t.client_id, sum(t.shortfall) as total
      from jsonb_to_recordset(v_items) as t(client_id uuid, shortfall numeric)
     where t.shortfall > 0
     group by t.client_id
     order by t.client_id
  loop
    v_allocs := '[]'::jsonb;
    v_left := v_group.total;
    for v_inv in
      select t.invoice_id, sum(t.shortfall) as short
        from jsonb_to_recordset(v_items) as t(client_id uuid, invoice_id uuid, shortfall numeric)
        join public.invoices inv on inv.id = t.invoice_id
       where t.client_id = v_group.client_id
         and t.shortfall > 0
         and inv.status = 'emitted'
         and inv.kind in ('factura', 'nd')
         and inv.channel_id = v_channel
         and coalesce(inv.moneda, 'PES') not in ('DOL', 'USD')
       group by t.invoice_id
       order by min(inv.fecha), t.invoice_id
    loop
      v_apply := least(
        v_inv.short,
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

    perform pg_advisory_xact_lock(
      hashtextextended('receipts:numero:' || v_channel || ':' || v_pos, 0)
    );
    select coalesce(max(r.numero), 0) + 1
      into v_numero
      from public.receipts r
     where r.channel_id = v_channel and r.punto_venta = v_pos;

    v_receipt := public.create_receipt(
      v_channel,
      v_pos,
      v_numero,
      v_group.client_id,
      v_s.settlement_date,
      v_group.total,
      'ARS',
      v_label || ': lo cobró ' || v_s.full_name || ' y queda a su cargo.',
      jsonb_build_array(jsonb_build_object(
        'account_id', v_account,
        'amount', v_group.total,
        'reference', 'Rendición N° ' || v_s.numero
      )),
      v_allocs,
      '[]'::jsonb,
      null
    );
    update public.receipts set created_by = p_user_id where id = v_receipt;
    insert into public.driver_settlement_difference_receipts (settlement_id, receipt_id)
    values (p_settlement_id, v_receipt);
  end loop;

  -- The same money, out of the account to the driver: he owes it.
  v_id := public.record_employee_account_cash(
    v_s.employee_id,
    'advance',
    v_account,
    v_channel,
    v_s.settlement_date,
    -v_difference,
    v_label
  );
  update public.employee_account_movements
     set driver_settlement_id = p_settlement_id,
         created_by = p_user_id
   where id = v_id;

  update public.driver_settlements
     set difference_charged_to = 'driver'
   where id = p_settlement_id;

  return v_id;
end;
$$;

comment on function public.post_driver_settlement_difference(uuid, uuid, text) is
  'Resuelve la diferencia de una rendición confirmada. client: la deja en la cuenta del cliente. driver (faltante): salda al cliente con un recibo y la carga al chofer como adelanto desde la misma caja. Idempotente.';

revoke all on function public.post_driver_settlement_difference(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.post_driver_settlement_difference(uuid, uuid, text)
  to service_role;
