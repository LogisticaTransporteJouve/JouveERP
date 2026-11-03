SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Who bears a rendición's difference: the driver or the client (follow-up
-- of 20261104080000_driver_settlement_differences; decision in
-- docs/decisions.md "Diferencia de la rendición: a cargo del chofer o del
-- cliente").
--
-- A shortfall posted to the driver left the carga's invoice open, so the
-- 100 the driver kept was owed twice (driver + client). Now the difference
-- is resolved one way:
--
--   1. driver_settlements.difference_charged_to: 'driver' | 'client' | null
--      (not resolved yet). Existing posted differences are 'driver'.
--   2. post_driver_settlement_difference(settlement, user, charged_to):
--      * 'client': records the choice and nothing else. The client's
--        invoice keeps its open balance (shortfall) or credit (overage);
--        the driver's account is untouched.
--      * 'driver' on a shortfall: per client, a receipt for the carga's
--        shortfall applied to its emitted invoice up to what it still owes
--        (the rest on account, as at confirmation), into a cash account of
--        the rendición; and from that same account an advance to the
--        driver (record_employee_account_cash) for the whole shortfall. The
--        account nets to zero, the client is settled (the client did pay:
--        the driver kept it), the driver owes it in his account, and the
--        fiscal journal books Dr anticipos al personal / Cr deudores. The
--        advance is the rendición's movement (driver_settlement_id).
--        Refused when the shortfall's cargas are in more than one channel,
--        or some carga is short and another over.
--      * 'driver' on an overage: refused. The overage is on account in the
--        client's receipt; no existing path moves it to the driver, and
--        crediting the driver too would credit it twice.
--      Idempotent under the rendición's row lock: the same choice returns
--      the same movement (or null for 'client'); the other choice is
--      refused until the first is removed.
--   3. driver_settlement_difference_receipts links those receipts to the
--      rendición. They are cancelled or edited only by unposting or
--      cancelling the rendición (guard_driver_settlement_difference_receipt).
--   4. unpost_driver_settlement_difference and cancel_driver_settlement take
--      it all back: they cancel the receipts (their treasury movements go
--      with them), delete the advance and its treasury movement (or a legacy
--      charge/payment) and clear the choice. Both take p_allow_driver: when
--      false (the caller lacks hr:write) and the driver's account holds the
--      difference, they refuse.
--
-- Rollback: older code calls post/unpost/cancel with their old arguments,
-- which resolve to these functions with the defaults ('driver', allowed):
-- the client side is settled too. An older page reads a posted shortfall's
-- kind 'advance' as unknown and shows it as not posted; posting again
-- returns the same movement.

------------------------------------------------------------------------------
-- 1. The choice
------------------------------------------------------------------------------

alter table public.driver_settlements
  add column difference_charged_to text;

-- The column is new and all null: the check validates at once.
alter table public.driver_settlements
  add constraint driver_settlements_difference_charged_to_known
    check (difference_charged_to in ('driver', 'client')) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.driver_settlements validate constraint driver_settlements_difference_charged_to_known;

comment on column public.driver_settlements.difference_charged_to is
  'A cargo de quién quedó la diferencia: driver (cuenta corriente del chofer; un faltante salda al cliente con un recibo) o client (queda en la cuenta del cliente). Null = sin resolver.';

update public.driver_settlements ds
   set difference_charged_to = 'driver'
 where exists (
   select 1 from public.employee_account_movements m
    where m.driver_settlement_id = ds.id
 );

-- A posted shortfall is now an advance with its treasury movement.
alter table public.employee_account_movements
  -- squawk-ignore ban-drop-constraint
  drop constraint employee_account_movements_driver_settlement;
alter table public.employee_account_movements
  add constraint employee_account_movements_driver_settlement check (
    driver_settlement_id is null
    or (currency = 'ARS'
        and plan_id is null
        and purchase_invoice_id is null
        and payroll_entry_id is null
        and ((kind in ('charge', 'payment') and transaction_id is null)
          or (kind = 'advance' and transaction_id is not null)))
  ) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.employee_account_movements validate constraint employee_account_movements_driver_settlement;

------------------------------------------------------------------------------
-- 2. Receipts that settle the client side
------------------------------------------------------------------------------

create table public.driver_settlement_difference_receipts (
  settlement_id uuid not null references public.driver_settlements (id) on delete restrict,
  receipt_id    uuid not null references public.receipts (id) on delete restrict,
  created_at    timestamptz not null default now(),
  primary key (settlement_id, receipt_id)
);

comment on table public.driver_settlement_difference_receipts is
  'Recibos con que un faltante a cargo del chofer saldó al cliente. Los escribe post_driver_settlement_difference; los anulan unpost_driver_settlement_difference y cancel_driver_settlement.';

create unique index driver_settlement_difference_receipts_receipt_key
  on public.driver_settlement_difference_receipts (receipt_id);

alter table public.driver_settlement_difference_receipts enable row level security;

create policy "driver_settlement_difference_receipts select"
  on public.driver_settlement_difference_receipts for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.driver_settlement_difference_receipts from public, anon;

create function public.guard_driver_settlement_difference_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if not exists (
    select 1 from public.driver_settlement_difference_receipts where receipt_id = old.id
  ) then
    return new;
  end if;
  get diagnostics v_stack = pg_context;
  if v_stack ~ 'function (public\.)?(post_driver_settlement_difference|unpost_driver_settlement_difference|cancel_driver_settlement)\(' then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.total_amount is distinct from old.total_amount
     or new.receipt_date is distinct from old.receipt_date
     or new.client_id is distinct from old.client_id
     or new.channel_id is distinct from old.channel_id
     or new.currency is distinct from old.currency
     or v_stack ~ 'function (public\.)?update_receipt\(' then
    raise exception 'Este recibo salda el faltante de una rendición a cargo del chofer: se anula quitando la diferencia de la rendición.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_driver_settlement_difference_receipt() from public, anon, authenticated;

create trigger receipts_guard_driver_settlement_difference
  before update on public.receipts
  for each row execute function public.guard_driver_settlement_difference_receipt();

------------------------------------------------------------------------------
-- 3. Removing it (unpost and cancel)
------------------------------------------------------------------------------

-- Takes the difference back: cancels the receipts that settled the client,
-- deletes the driver's movement and its treasury movement, clears the
-- choice. The caller holds the rendición's row lock.
create function public.remove_driver_settlement_difference(
  p_settlement_id uuid,
  p_user_id       uuid,
  p_allow_driver  boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.employee_account_movements;
begin
  select * into v_movement
    from public.employee_account_movements
   where driver_settlement_id = p_settlement_id;

  if not p_allow_driver and (
    v_movement.id is not null
    or exists (
      select 1 from public.driver_settlement_difference_receipts
       where settlement_id = p_settlement_id
    )
  ) then
    raise exception 'La diferencia de la rendición está en la cuenta corriente del chofer: quitarla requiere permiso de escritura en RRHH.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  update public.receipts r
     set status = 'canceled',
         canceled_at = now(),
         canceled_by = p_user_id
    from public.driver_settlement_difference_receipts d
   where d.settlement_id = p_settlement_id
     and r.id = d.receipt_id
     and r.status = 'issued';
  delete from public.driver_settlement_difference_receipts
   where settlement_id = p_settlement_id;

  if v_movement.id is not null then
    delete from public.employee_account_movements where id = v_movement.id;
    if v_movement.transaction_id is not null then
      delete from public.transactions where id = v_movement.transaction_id;
    end if;
  end if;

  update public.driver_settlements
     set difference_charged_to = null
   where id = p_settlement_id
     and difference_charged_to is not null;
end;
$$;

revoke all on function public.remove_driver_settlement_difference(uuid, uuid, boolean)
  from public, anon, authenticated;

-- Rollback-safe: the new signature keeps the old arguments (defaults).
-- squawk-ignore ban-drop-function
drop function public.unpost_driver_settlement_difference(uuid);

create function public.unpost_driver_settlement_difference(
  p_settlement_id uuid,
  p_user_id       uuid default null,
  p_allow_driver  boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
    from public.driver_settlements ds
   where ds.id = p_settlement_id
     for update;
  if not found then
    raise exception 'La rendición no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  perform public.remove_driver_settlement_difference(p_settlement_id, p_user_id, p_allow_driver);
end;
$$;

comment on function public.unpost_driver_settlement_difference(uuid, uuid, boolean) is
  'Deshace la diferencia de una rendición: anula los recibos que saldaron al cliente, borra el movimiento del chofer y su movimiento de caja, y limpia a cargo de quién quedó (no-op si no hay).';

revoke all on function public.unpost_driver_settlement_difference(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.unpost_driver_settlement_difference(uuid, uuid, boolean)
  to service_role;

-- Same as 20261104080000 plus undoing the difference (receipts and treasury
-- movement included) and p_allow_driver.
-- Rollback-safe: the new signature keeps the old arguments (defaults).
-- squawk-ignore ban-drop-function
drop function public.cancel_driver_settlement(uuid, uuid);

create function public.cancel_driver_settlement(
  p_settlement_id uuid,
  p_user_id       uuid,
  p_allow_driver  boolean default true
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

  perform public.remove_driver_settlement_difference(p_settlement_id, p_user_id, p_allow_driver);

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

revoke all on function public.cancel_driver_settlement(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.cancel_driver_settlement(uuid, uuid, boolean)
  to service_role;

------------------------------------------------------------------------------
-- 4. Posting it
------------------------------------------------------------------------------

-- Rollback-safe: the new signature keeps the old arguments (defaults).
-- squawk-ignore ban-drop-function
drop function public.post_driver_settlement_difference(uuid, uuid);

create function public.post_driver_settlement_difference(
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
    raise exception 'El chofer % no está vinculado a un empleado: vinculalo en Flota › Choferes.', v_s.full_name
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
    into v_channel, v_numero
    from jsonb_to_recordset(v_items) as t(channel_id text, shortfall numeric)
   where t.shortfall > 0;
  if v_numero <> 1 or v_channel is null then
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
