SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Supplier side of a bounced check and of the credit notes with no origin
-- (audit w2-s2 F2 and F3).
--
-- F2. A check paid to a supplier that bounces (a third-party check endorsed
-- by a payment order, or an own check issued by one) gives the debt back in
-- the ledger (Cr proveedores), but the supplier's statement and aging kept
-- reading the order as paid, and the order can be neither cancelled nor
-- edited (20261104093000), so nothing could put the debt back. Mirror of
-- the client side (20261031205518):
--
--   1. payment_order_rejected_check_allocations: what a later issued payment
--      order applies to a bounced check of its supplier (the a cuenta flow,
--      allocate_payment_order). Written only by the RPCs.
--   2. v_supplier_rejected_check_open: every bounced check of an issued
--      payment order (endorsed check 'rechazado', own check 'rejected'), dated
--      on the rejection, numbered with the order that delivered it, with what
--      later orders settled and what is still open.
--   3. v_supplier_account_movements gains a 'rejected_check' row (+amount on
--      the rejection date): Σ statement = ledger proveedores again.
--   4. v_supplier_aging_documents gains the open bounced checks as documents
--      (document_type 'rejected_check', no purchase_invoice_id; appended:
--      document_type, document_id, check_number), so the aging, the cash
--      flow and the AI tools see them. sync_automatic_tasks keeps creating
--      payment tasks for purchase invoices only.
--   5. allocate_payment_order takes rejected-check lines
--      ({check_kind, check_id, amount_applied}); v_payment_order_unapplied
--      and update_payment_order count them; guard_payment_order_rejected_check_allocation
--      checks supplier, channel, currency and the open amount.
--   6. The cancel and edit guards no longer promise a flow that did not
--      exist: they point to the new one (pay it with a new order and apply
--      it to the bounced check). Their predicates are unchanged; the
--      own-check edit refusal now carries hint jouve_guard.
--
-- F3. v_supplier_aging_documents spreads the received purchase NCs with no
-- origin of a supplier over its open documents of the same channel and
-- currency, from the most overdue forward (the window 20261104094200 uses
-- for clients; appended amount_credited_unlinked). v_supplier_aging and
-- v_supplier_aging_by_scope stop subtracting those NCs themselves
-- (aging_apply_credit), so they are counted once; the cash flow and the AI
-- tools that read the documents now see the same figure as the totals. The
-- credit now stays in its own channel (before, the totals netted it across
-- channels).
--
-- With the UNION PostgREST no longer traces supplier_id back to
-- purchase_invoices: suppliers(v_supplier_aging) and
-- suppliers(v_supplier_aging_by_scope) restore the suppliers!inner embed,
-- as clients(...) did.
--
-- Not covered: the opening balance's real open (apply_supplier_opening_balance)
-- does not count bounced checks, and a USD bounced check settled by an order
-- at another rate leaves the rate difference in proveedores
-- (docs/pendientes.md).
--
-- Rollback: older code reads the same columns of every view (the new ones
-- are appended), calls allocate_payment_order and update_payment_order with
-- the same arguments, and never writes the new table; a statement row with
-- an unknown source_type is shown with no link.

------------------------------------------------------------------------------
-- 1. Settlement of a bounced check by a later payment order
------------------------------------------------------------------------------

create table public.payment_order_rejected_check_allocations (
  id                uuid primary key default gen_random_uuid(),
  payment_order_id  uuid not null references public.payment_orders (id) on delete cascade,
  endorsed_check_id uuid references public.checks (id) on delete restrict,
  issued_check_id   uuid references public.issued_checks (id) on delete restrict,
  amount_applied    numeric(18,2) not null check (amount_applied > 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint payment_order_rejected_check_allocations_one_check
    check (num_nonnulls(endorsed_check_id, issued_check_id) = 1),
  unique (payment_order_id, endorsed_check_id),
  unique (payment_order_id, issued_check_id)
);

comment on table public.payment_order_rejected_check_allocations is
  'Imputación de una orden de pago a un cheque que se le entregó al proveedor y fue rechazado (cheque de terceros endosado o cheque propio): ese tramo de la OP paga la deuda que el rechazo hizo volver.';

create index payment_order_rejected_check_allocations_endorsed_idx
  on public.payment_order_rejected_check_allocations (endorsed_check_id) where endorsed_check_id is not null;
create index payment_order_rejected_check_allocations_issued_idx
  on public.payment_order_rejected_check_allocations (issued_check_id) where issued_check_id is not null;

alter table public.payment_order_rejected_check_allocations enable row level security;

create policy "Owner, admin and finance view po rejected check allocations"
  on public.payment_order_rejected_check_allocations for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

-- Written only by allocate_payment_order / update_payment_order (definer).
revoke all on table public.payment_order_rejected_check_allocations from public, anon;
revoke insert, update, delete on table public.payment_order_rejected_check_allocations from authenticated;
grant select on table public.payment_order_rejected_check_allocations to authenticated;
grant all on table public.payment_order_rejected_check_allocations to service_role;

------------------------------------------------------------------------------
-- 2. What each bounced check delivered to a supplier still owes
------------------------------------------------------------------------------

create view public.v_supplier_rejected_check_open with (security_invoker = on) as
  with bounced as (
    -- A third-party check endorsed by an order: the order that holds it
    -- (an order with a bounced endorsed check cannot be cancelled).
    select
      'endorsed'::text                      as check_kind,
      k.id                                  as check_id,
      po.supplier_id,
      po.channel_id,
      k.currency,
      k.check_number,
      po.id                                 as payment_order_id,
      po.punto_venta,
      po.numero,
      coalesce(rej.event_date, k.updated_at::date) as rejected_on,
      coalesce(rej.created_at, k.updated_at)       as rejected_recorded_at,
      k.amount
    from public.checks k
    join lateral (
      select pl.payment_order_id
        from public.payment_order_payment_lines pl
        join public.payment_orders p on p.id = pl.payment_order_id
       where pl.endorsed_check_id = k.id
         and p.status <> 'canceled'
       order by p.created_at desc, p.id desc
       limit 1
    ) holder on true
    join public.payment_orders po on po.id = holder.payment_order_id
    left join lateral (
      select m.event_date, m.created_at
        from public.check_movements m
       where m.check_id = k.id and m.event = 'rejected'
       order by m.created_at desc, m.id desc
       limit 1
    ) rej on true
    where k.status = 'rechazado'
      and po.status = 'issued'
    union all
    -- An own check issued by an order.
    select
      'issued'::text,
      ic.id,
      po.supplier_id,
      po.channel_id,
      ic.currency,
      ic.check_number,
      po.id,
      po.punto_venta,
      po.numero,
      coalesce(ic.rejected_at, ic.updated_at::date),
      ic.updated_at,
      ic.amount
    from public.issued_checks ic
    join public.payment_orders po on po.id = ic.payment_order_id
    where ic.status = 'rejected'
      and po.status = 'issued'
  )
  select
    b.check_kind,
    b.check_id,
    b.supplier_id,
    b.channel_id,
    b.currency,
    b.check_number,
    b.payment_order_id,
    b.punto_venta,
    b.numero,
    b.rejected_on,
    b.rejected_recorded_at,
    b.amount,
    coalesce(settled.applied, 0)            as amount_settled,
    b.amount - coalesce(settled.applied, 0) as open_amount
  from bounced b
  left join (
    select coalesce(a.endorsed_check_id, a.issued_check_id) as check_id,
           sum(a.amount_applied) as applied
      from public.payment_order_rejected_check_allocations a
      join public.payment_orders p on p.id = a.payment_order_id
     where p.status = 'issued'
     group by coalesce(a.endorsed_check_id, a.issued_check_id)
  ) settled on settled.check_id = b.check_id;

comment on view public.v_supplier_rejected_check_open is
  'Cheques entregados a proveedores por una OP emitida y rechazados (endosados o propios): importe, cancelado por OPs posteriores y saldo abierto. Permiso: payment_orders:read.';

revoke all on table public.v_supplier_rejected_check_open from public, anon;
grant select on table public.v_supplier_rejected_check_open to authenticated;
grant all on table public.v_supplier_rejected_check_open to service_role;

------------------------------------------------------------------------------
-- 5a. Guard on the new allocations
------------------------------------------------------------------------------

create function public.guard_payment_order_rejected_check_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po    public.payment_orders%rowtype;
  v_check public.v_supplier_rejected_check_open%rowtype;
  v_open  numeric;
begin
  -- Serializes two orders settling the same check.
  if new.endorsed_check_id is not null then
    perform 1 from public.checks where id = new.endorsed_check_id for update;
  else
    perform 1 from public.issued_checks where id = new.issued_check_id for update;
  end if;

  select * into v_check
    from public.v_supplier_rejected_check_open o
   where o.check_kind = case when new.endorsed_check_id is not null then 'endorsed' else 'issued' end
     and o.check_id = coalesce(new.endorsed_check_id, new.issued_check_id);
  if v_check.check_id is null then
    raise exception 'El cheque no figura como rechazado en una orden de pago emitida'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_po from public.payment_orders where id = new.payment_order_id;
  if v_po.supplier_id is distinct from v_check.supplier_id then
    raise exception 'El cheque rechazado no es del proveedor de la orden de pago'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_po.channel_id is distinct from v_check.channel_id then
    raise exception 'El cheque rechazado es de otro canal que la orden de pago'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_po.currency is distinct from v_check.currency then
    raise exception 'El cheque rechazado está en otra moneda que la orden de pago'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  v_open := v_check.open_amount;
  -- On update the view still counts this row's previous amount.
  if tg_op = 'UPDATE' and v_po.status = 'issued' then
    v_open := v_open + old.amount_applied;
  end if;
  if new.amount_applied > v_open + 0.01 then
    raise exception 'La imputación excede el saldo abierto del cheque rechazado (% > %)',
      new.amount_applied, v_open using errcode = '23514', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_payment_order_rejected_check_allocation() from public, anon, authenticated;

create trigger payment_order_rejected_check_allocations_guard
  before insert or update on public.payment_order_rejected_check_allocations
  for each row execute function public.guard_payment_order_rejected_check_allocation();

------------------------------------------------------------------------------
-- 5b. allocate_payment_order takes rejected-check lines
------------------------------------------------------------------------------

-- Same as 20261103040200 plus the lines {check_kind, check_id,
-- amount_applied}: they settle a bounced check of the supplier
-- (payment_order_rejected_check_allocations) and count against what the
-- order holds a cuenta, as invoice lines do.
create or replace function public.allocate_payment_order(p_payment_order_id uuid, p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  text;
  v_total   numeric;
  v_applied numeric;
  v_new     numeric := 0;
  v_line    jsonb;
begin
  -- Role guard (payment_orders:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para imputar órdenes de pago'
      using errcode = '42501';
  end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Elegí al menos una factura para imputar'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select status, total_amount into v_status, v_total
    from public.payment_orders where id = p_payment_order_id
     for update;
  if v_status is null then
    raise exception 'La orden de pago no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_status <> 'issued' then
    raise exception 'La orden de pago está anulada: no se puede imputar'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select coalesce((select sum(amount_applied) from public.payment_order_allocations
                    where payment_order_id = p_payment_order_id), 0)
       + coalesce((select sum(amount_applied) from public.payment_order_rejected_check_allocations
                    where payment_order_id = p_payment_order_id), 0)
    into v_applied;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    if coalesce((v_line ->> 'amount_applied')::numeric, 0) <= 0 then
      raise exception 'Cada imputación tiene que ser mayor a cero'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if v_line ? 'check_id'
       and coalesce(v_line ->> 'check_kind', '') not in ('endorsed', 'issued') then
      raise exception 'Imputación a un cheque rechazado sin tipo de cheque'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_new := v_new + (v_line ->> 'amount_applied')::numeric;
  end loop;

  if round(v_applied + v_new, 2) > round(v_total, 2) then
    raise exception 'La imputación excede el saldo a cuenta de la orden de pago (%)', round(v_total - v_applied, 2)
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    if v_line ->> 'check_kind' = 'endorsed' then
      insert into public.payment_order_rejected_check_allocations (payment_order_id, endorsed_check_id, amount_applied)
      values (p_payment_order_id, (v_line ->> 'check_id')::uuid, (v_line ->> 'amount_applied')::numeric)
      on conflict (payment_order_id, endorsed_check_id)
        do update set amount_applied = public.payment_order_rejected_check_allocations.amount_applied + excluded.amount_applied,
                      updated_at = now();
    elsif v_line ->> 'check_kind' = 'issued' then
      insert into public.payment_order_rejected_check_allocations (payment_order_id, issued_check_id, amount_applied)
      values (p_payment_order_id, (v_line ->> 'check_id')::uuid, (v_line ->> 'amount_applied')::numeric)
      on conflict (payment_order_id, issued_check_id)
        do update set amount_applied = public.payment_order_rejected_check_allocations.amount_applied + excluded.amount_applied,
                      updated_at = now();
    else
      insert into public.payment_order_allocations (payment_order_id, purchase_invoice_id, amount_applied)
      values (p_payment_order_id, (v_line ->> 'purchase_invoice_id')::uuid, (v_line ->> 'amount_applied')::numeric)
      on conflict (payment_order_id, purchase_invoice_id)
        do update set amount_applied = public.payment_order_allocations.amount_applied + excluded.amount_applied;
    end if;
  end loop;
end;
$$;

revoke all on function public.allocate_payment_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.allocate_payment_order(uuid, jsonb) to authenticated, service_role;

-- Same columns; what is applied to bounced checks is not a cuenta either.
create or replace view public.v_payment_order_unapplied with (security_invoker = on) as
  select po.id as payment_order_id,
         po.supplier_id,
         po.channel_id,
         c.is_fiscal as channel_is_fiscal,
         po.currency,
         po.payment_date,
         po.total_amount
           - coalesce((select sum(pa.amount_applied) from public.payment_order_allocations pa
                        where pa.payment_order_id = po.id), 0)
           - coalesce((select sum(rc.amount_applied) from public.payment_order_rejected_check_allocations rc
                        where rc.payment_order_id = po.id), 0) as unapplied_amount
    from public.payment_orders po
    join public.invoicing_channels c on c.id = po.channel_id
   where po.status = 'issued'
     and po.total_amount
           - coalesce((select sum(pa.amount_applied) from public.payment_order_allocations pa
                        where pa.payment_order_id = po.id), 0)
           - coalesce((select sum(rc.amount_applied) from public.payment_order_rejected_check_allocations rc
                        where rc.payment_order_id = po.id), 0) > 0.005;

comment on view public.v_payment_order_unapplied is
  'Órdenes de pago emitidas con saldo a cuenta (total menos lo imputado a facturas y a cheques rechazados).';

------------------------------------------------------------------------------
-- 6. Cancel and edit guards point to the real flow
------------------------------------------------------------------------------

-- Same as 20261104093000 (same predicates and lock); only the messages.
create or replace function public.guard_payment_order_cancel_cashed_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'issued' and new.status = 'canceled' then
    if exists (
      select 1 from public.issued_checks ic
       where ic.payment_order_id = old.id
         and ic.status = 'cashed'
    ) then
      raise exception
        'No se puede anular la orden de pago: tiene un cheque propio ya cobrado.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if exists (
      select 1 from public.issued_checks ic
       where ic.payment_order_id = old.id
         and ic.status = 'rejected'
    ) then
      raise exception
        'No se puede anular la orden de pago: un cheque propio que entregó fue rechazado y la deuda ya volvió a la cuenta del proveedor. Pagala con una OP nueva e imputala al cheque rechazado.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    -- Locked first: reject_check locks the check too, so a bounce registered
    -- while the order is cancelled either lands before this read or waits
    -- for the cancel (and then finds the check back in cartera).
    perform 1
       from public.payment_order_payment_lines pl
       join public.checks c on c.id = pl.endorsed_check_id
      where pl.payment_order_id = old.id
        for update of c;
    if exists (
      select 1
        from public.payment_order_payment_lines pl
        join public.checks c on c.id = pl.endorsed_check_id
       where pl.payment_order_id = old.id
         and c.status <> 'endosado'
    ) then
      raise exception
        'No se puede anular la orden de pago: un cheque de terceros que endosó fue rechazado y la deuda ya volvió a la cuenta del proveedor. Pagala con una OP nueva e imputala al cheque rechazado.'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_payment_order_cancel_cashed_check() from public, anon, authenticated;

-- Same as 20261104093000 (every case kept) except: the own-check refusal
-- carries hint jouve_guard, both refusals point to the real flow, and the
-- allocations cap counts what the order applied to bounced checks (those
-- rows are kept across the edit).
create or replace function public.update_payment_order(p_id uuid, p_payment_date date, p_total_amount numeric, p_notes text, p_payment_lines jsonb, p_allocations jsonb, p_cotizacion numeric default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status            text;
  v_channel_id        text;
  v_pos               int;
  v_numero            int;
  v_supplier_id       uuid;
  v_currency          text;
  v_payment_sum       numeric := 0;
  v_alloc_sum         numeric := 0;
  v_line              jsonb;
  v_account_id        uuid;
  v_amount            numeric;
  v_ref               text;
  v_line_kind         text;
  v_check             public.checks%rowtype;
  v_check_id          uuid;
  v_issued_check_id   uuid;
  v_issued_data       jsonb;
  v_blocking_count    int;
  v_old_check_id      uuid;
  v_old_issued_id     uuid;
begin
  -- Role guard (payment_orders:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para editar órdenes de pago'
      using errcode = '42501';
  end if;

  select status, channel_id, punto_venta, numero, supplier_id, currency
    into v_status, v_channel_id, v_pos, v_numero, v_supplier_id, v_currency
  from public.payment_orders where id = p_id
   for update;

  if v_status is null then
    raise exception 'payment_order % not found', p_id;
  end if;
  if v_status = 'canceled' then
    raise exception 'cannot edit a canceled payment_order (%)', p_id;
  end if;

  -- Si hay issued_checks linkeados ya cobrados/rechazados, no podemos
  -- reescribir historia: bloqueamos el edit.
  select count(*) into v_blocking_count
    from public.payment_order_payment_lines pl
    join public.issued_checks ic on ic.id = pl.issued_check_id
    where pl.payment_order_id = p_id
      and ic.status in ('cashed', 'rejected');
  if v_blocking_count > 0 then
    raise exception 'No se puede editar la OP: tiene cheques propios ya cobrados o rechazados. Si uno se rechazó, la deuda ya volvió a la cuenta del proveedor: pagala con una OP nueva e imputala al cheque rechazado.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- Same for an endorsed check the bank rejected after the endorsement: its
  -- debt is back on the client and it must not return to cartera. Locked
  -- first, as in guard_payment_order_cancel_cashed_check.
  perform 1
     from public.payment_order_payment_lines pl
     join public.checks c on c.id = pl.endorsed_check_id
    where pl.payment_order_id = p_id
      for update of c;
  if exists (
    select 1
      from public.payment_order_payment_lines pl
      join public.checks c on c.id = pl.endorsed_check_id
     where pl.payment_order_id = p_id
       and c.status <> 'endosado'
  ) then
    raise exception 'No se puede editar la OP: un cheque de terceros que endosó fue rechazado y la deuda ya volvió a la cuenta del proveedor. Pagala con una OP nueva e imputala al cheque rechazado.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- Cleanup de cheques de la versión anterior antes de borrar las líneas.
  -- Endorsed: vuelven a en_cartera + se borra la fila 'endorsed' del
  -- historial. Si se vuelve a endosar el mismo cheque más abajo, el RPC
  -- inserta una nueva fila 'endorsed' fresh.
  for v_old_check_id in
    select pl.endorsed_check_id
      from public.payment_order_payment_lines pl
      join public.checks c on c.id = pl.endorsed_check_id
     where pl.payment_order_id = p_id
       and c.status = 'endosado'
  loop
    update public.checks set status = 'en_cartera'
     where id = v_old_check_id and status = 'endosado';
    delete from public.check_movements
     where check_id = v_old_check_id and event = 'endorsed';
  end loop;

  -- Issued checks emitted: hard delete. Los creó esta OP, son safe to
  -- delete. Si el form reenvía el mismo cheque con otros datos, se
  -- inserta uno nuevo más abajo.
  for v_old_issued_id in
    select issued_check_id
    from public.payment_order_payment_lines
    where payment_order_id = p_id
      and issued_check_id is not null
  loop
    delete from public.issued_checks
      where id = v_old_issued_id and status = 'emitted';
  end loop;

  -- An edit that sends no rate keeps the stored one.
  update public.payment_orders set
    payment_date = p_payment_date,
    total_amount = p_total_amount,
    cotizacion   = case when v_currency = 'USD' then coalesce(p_cotizacion, cotizacion) end,
    notes        = nullif(trim(p_notes), '')
  where id = p_id;

  -- Wipe lo viejo. Las issued_checks no-emitidas que sobrevivieron al
  -- delete de arriba ya están desligadas (FK on delete set null).
  delete from public.transactions                  where payment_order_id = p_id;
  delete from public.payment_order_payment_lines   where payment_order_id = p_id;
  delete from public.payment_order_allocations     where payment_order_id = p_id;

  -- Reaplicar líneas (mismo flow que create_payment_order).
  for v_line in select * from jsonb_array_elements(p_payment_lines)
  loop
    v_line_kind := coalesce(v_line->>'line_kind', 'account');
    v_ref       := v_line->>'reference';
    v_issued_check_id := null;
    v_check_id  := null;

    if v_line_kind = 'endorse_check' then
      v_check_id := (v_line->>'endorsed_check_id')::uuid;
      select * into v_check from public.checks where id = v_check_id for update;
      if v_check.id is null then
        raise exception 'endorse_check: cheque % no encontrado', v_check_id;
      end if;
      if v_check.status <> 'en_cartera' then
        raise exception 'endorse_check: cheque % está en estado %, no en_cartera',
          v_check_id, v_check.status;
      end if;
      if v_check.currency <> v_currency then
        raise exception 'endorse_check: moneda del cheque (%) no coincide con OP (%)',
          v_check.currency, v_currency;
      end if;

      v_account_id := v_check.cartera_account_id;
      v_amount := v_check.amount;

      update public.checks set status = 'endosado' where id = v_check_id;

      insert into public.check_movements (
        check_id, event, event_date, endorsed_to_name, endorsed_to_cuit,
        notes, created_by
      ) values (
        v_check_id, 'endorsed', p_payment_date,
        coalesce(
          (select legal_name from public.suppliers where id = v_supplier_id),
          'OP'),
        (select cuit from public.suppliers where id = v_supplier_id),
        'OP ' || lpad(v_pos::text, 4, '0') || '-' || lpad(v_numero::text, 8, '0'),
        auth.uid()
      );

    elsif v_line_kind = 'issue_check' then
      v_account_id := (v_line->>'account_id')::uuid;
      v_amount     := (v_line->>'amount')::numeric;
      v_issued_data := v_line->'issued_check';
      if v_issued_data is null then
        raise exception 'issue_check: falta objeto issued_check en la línea';
      end if;

      insert into public.issued_checks (
        kind, check_number, bank_name, beneficiary_name, beneficiary_cuit,
        issue_date, due_date, amount, currency, bank_account_id,
        payment_order_id, supplier_id, notes, created_by
      ) values (
        v_issued_data->>'kind',
        v_issued_data->>'check_number',
        v_issued_data->>'bank_name',
        coalesce(v_issued_data->>'beneficiary_name',
          (select legal_name from public.suppliers where id = v_supplier_id)),
        coalesce(v_issued_data->>'beneficiary_cuit',
          (select cuit from public.suppliers where id = v_supplier_id)),
        coalesce((v_issued_data->>'issue_date')::date, p_payment_date),
        (v_issued_data->>'due_date')::date,
        v_amount,
        v_currency,
        v_account_id,
        p_id,
        v_supplier_id,
        nullif(trim(v_issued_data->>'notes'), ''),
        auth.uid()
      )
      returning id into v_issued_check_id;

    else
      v_account_id := (v_line->>'account_id')::uuid;
      v_amount     := (v_line->>'amount')::numeric;
    end if;

    insert into public.payment_order_payment_lines (
      payment_order_id, account_id, amount, reference,
      endorsed_check_id, issued_check_id
    ) values (
      p_id, v_account_id, v_amount, v_ref,
      v_check_id, v_issued_check_id
    );

    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, counterparty_supplier_id,
      payment_order_id, created_by
    ) values (
      v_account_id, v_channel_id, 'expense', v_amount, v_currency,
      p_payment_date, date_trunc('month', p_payment_date)::date,
      coalesce(v_ref, 'OP ' || lpad(v_pos::text, 4, '0') || '-' || lpad(v_numero::text, 8, '0')),
      v_supplier_id, p_id, auth.uid()
    );

    v_payment_sum := v_payment_sum + v_amount;
  end loop;

  for v_line in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.payment_order_allocations (
      payment_order_id, purchase_invoice_id, amount_applied
    ) values (
      p_id,
      (v_line->>'purchase_invoice_id')::uuid,
      (v_line->>'amount_applied')::numeric
    );
    v_alloc_sum := v_alloc_sum + (v_line->>'amount_applied')::numeric;
  end loop;

  if round(v_payment_sum, 2) <> round(p_total_amount, 2) then
    raise exception 'payment_lines sum (%) does not match total_amount (%)',
      v_payment_sum, p_total_amount;
  end if;

  -- What the order already applied to bounced checks stays applied.
  v_alloc_sum := v_alloc_sum + coalesce((
    select sum(rc.amount_applied) from public.payment_order_rejected_check_allocations rc
     where rc.payment_order_id = p_id), 0);

  if round(v_alloc_sum, 2) > round(p_total_amount, 2) then
    raise exception 'allocations sum (%) exceeds total_amount (%)',
      v_alloc_sum, p_total_amount;
  end if;
end;
$$;

revoke all on function public.update_payment_order(uuid, date, numeric, text, jsonb, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.update_payment_order(uuid, date, numeric, text, jsonb, jsonb, numeric) to authenticated, service_role;

------------------------------------------------------------------------------
-- 3. Supplier statement: the bounced check puts the debt back
------------------------------------------------------------------------------

-- Same columns (20261031205518) plus the rejected_check rows. The order's
-- allocations stay (its invoices read paid); this row puts the debt back in
-- the running balance, and a later order that settles it debits the balance
-- like any order.
create or replace view public.v_supplier_account_movements with (security_invoker = on) as
  select
    'purchase_invoice'::text as source_type,
    pi.id as source_id,
    pi.supplier_id,
    pi.fecha as movement_date,
    pi.created_at,
    pi.kind,
    pi.letter,
    pi.punto_venta,
    pi.numero,
    case when pi.kind = 'nc' then -1::numeric * pi.imp_total else pi.imp_total end as signed_amount,
    pi.imp_total as gross_amount,
    pi.channel_id,
    ch.is_fiscal as channel_is_fiscal,
    ch.name as channel_name,
    pi.status,
    case when coalesce(pi.moneda, 'PES') in ('DOL', 'USD') then 'USD' else 'ARS' end as currency
  from public.purchase_invoices pi
  join public.invoicing_channels ch on ch.id = pi.channel_id
  where pi.status = 'received'
  union all
  select
    'payment_order'::text as source_type,
    po.id as source_id,
    po.supplier_id,
    po.payment_date as movement_date,
    po.created_at,
    'payment_order'::text as kind,
    null::text as letter,
    po.punto_venta,
    po.numero,
    -1::numeric * po.total_amount as signed_amount,
    po.total_amount as gross_amount,
    po.channel_id,
    ch.is_fiscal as channel_is_fiscal,
    ch.name as channel_name,
    po.status,
    po.currency
  from public.payment_orders po
  join public.invoicing_channels ch on ch.id = po.channel_id
  where po.status = 'issued'
  union all
  -- The opening balance has no currency column: it is in pesos.
  select
    'opening_balance'::text as source_type,
    null::uuid as source_id,
    ob.supplier_id,
    ob.opening_date as movement_date,
    ob.created_at,
    'opening_balance'::text as kind,
    null::text as letter,
    null::integer as punto_venta,
    null::integer as numero,
    ob.target_balance as signed_amount,
    ob.target_balance as gross_amount,
    null::text as channel_id,
    null::boolean as channel_is_fiscal,
    null::text as channel_name,
    'issued'::text as status,
    'ARS'::text as currency
  from public.supplier_opening_balances ob
  union all
  -- A check delivered by an issued order that bounced: we owe it again.
  -- Numbered with the order that delivered it.
  select
    'rejected_check'::text as source_type,
    o.check_id as source_id,
    o.supplier_id,
    o.rejected_on as movement_date,
    o.rejected_recorded_at as created_at,
    'rejected_check'::text as kind,
    null::text as letter,
    o.punto_venta,
    o.numero,
    o.amount as signed_amount,
    o.amount as gross_amount,
    o.channel_id,
    ch.is_fiscal as channel_is_fiscal,
    ch.name as channel_name,
    'issued'::text as status,
    o.currency
  from public.v_supplier_rejected_check_open o
  join public.invoicing_channels ch on ch.id = o.channel_id;

------------------------------------------------------------------------------
-- 4 and F3. Supplier aging documents
------------------------------------------------------------------------------

-- Same columns in the same order (20261031205518); document_type,
-- document_id, check_number and amount_credited_unlinked are appended. A
-- bounced check has no purchase_invoice_id: its id is document_id, and it
-- ages from the rejection. The NCs with no origin are spread as in
-- v_aging_documents (20261104094200).
create or replace view public.v_supplier_aging_documents with (security_invoker = on) as
  with docs as (
  select
    pi.id as purchase_invoice_id,
    pi.supplier_id,
    pi.fecha,
    pi.kind,
    pi.letter,
    pi.punto_venta,
    pi.numero,
    pi.imp_total,
    o.amount_paid + o.amount_opening_applied as amount_applied,
    o.amount_credited_by_nc,
    o.open_amount,
    current_date - coalesce(pi.fch_vto_pago, pi.fecha) as days_overdue,
    case
      when (current_date - coalesce(pi.fch_vto_pago, pi.fecha)) <= 30 then '0_30'
      when (current_date - coalesce(pi.fch_vto_pago, pi.fecha)) <= 60 then '30_60'
      when (current_date - coalesce(pi.fch_vto_pago, pi.fecha)) <= 90 then '60_90'
      else '90_plus'
    end as bucket,
    pi.channel_id,
    ch.name as channel_name,
    ch.is_fiscal as channel_is_fiscal,
    pi.fch_vto_pago,
    pi.moneda,
    'purchase_invoice'::text as document_type,
    pi.id as document_id,
    null::text as check_number
  from public.purchase_invoices pi
  join public.v_purchase_invoice_open o on o.purchase_invoice_id = pi.id
  join public.invoicing_channels ch on ch.id = pi.channel_id
  where pi.status = 'received'
    and pi.kind in ('factura', 'nd')
    and o.open_amount > 0
  union all
  select
    null::uuid as purchase_invoice_id,
    r.supplier_id,
    r.rejected_on as fecha,
    'rejected_check'::text as kind,
    null::character(1) as letter,
    r.punto_venta,
    r.numero,
    r.amount::numeric(15,2) as imp_total,
    r.amount_settled as amount_applied,
    0::numeric as amount_credited_by_nc,
    r.open_amount,
    current_date - r.rejected_on as days_overdue,
    case
      when (current_date - r.rejected_on) <= 30 then '0_30'
      when (current_date - r.rejected_on) <= 60 then '30_60'
      when (current_date - r.rejected_on) <= 90 then '60_90'
      else '90_plus'
    end as bucket,
    r.channel_id,
    ch.name as channel_name,
    ch.is_fiscal as channel_is_fiscal,
    r.rejected_on as fch_vto_pago,
    case when r.currency = 'USD' then 'DOL'::text else 'PES'::text end as moneda,
    'rejected_check'::text as document_type,
    r.check_id as document_id,
    r.check_number
  from public.v_supplier_rejected_check_open r
  join public.invoicing_channels ch on ch.id = r.channel_id
  where r.open_amount > 0
  ),
  unlinked as (
  select n.supplier_id,
    n.channel_id,
    case when coalesce(n.moneda, 'PES') in ('DOL', 'USD') then 'USD'::text else 'ARS'::text end as currency,
    sum(n.imp_total) as credit
  from public.purchase_invoices n
  where n.kind = 'nc' and n.status = 'received' and n.invoice_origin_id is null
  group by n.supplier_id, n.channel_id, (case when coalesce(n.moneda, 'PES') in ('DOL', 'USD') then 'USD'::text else 'ARS'::text end)
  ),
  spread as (
  select d.*,
    least(d.open_amount, greatest(coalesce(u.credit, 0::numeric) - coalesce(sum(d.open_amount) over (
      partition by d.supplier_id, d.channel_id, (case when coalesce(d.moneda, 'PES') in ('DOL', 'USD') then 'USD'::text else 'ARS'::text end)
      order by d.days_overdue desc, d.fecha, d.document_id
      rows between unbounded preceding and 1 preceding), 0::numeric), 0::numeric)) as credited_unlinked
  from docs d
  left join unlinked u on u.supplier_id = d.supplier_id and u.channel_id = d.channel_id
    and u.currency = (case when coalesce(d.moneda, 'PES') in ('DOL', 'USD') then 'USD'::text else 'ARS'::text end)
  )
  select s.purchase_invoice_id,
    s.supplier_id,
    s.fecha,
    s.kind,
    s.letter,
    s.punto_venta,
    s.numero,
    s.imp_total,
    s.amount_applied,
    s.amount_credited_by_nc,
    s.open_amount - s.credited_unlinked as open_amount,
    s.days_overdue,
    s.bucket,
    s.channel_id,
    s.channel_name,
    s.channel_is_fiscal,
    s.fch_vto_pago,
    s.moneda,
    s.document_type,
    s.document_id,
    s.check_number,
    s.credited_unlinked as amount_credited_unlinked
  from spread s
  where s.open_amount - s.credited_unlinked > 0::numeric;

comment on view public.v_supplier_aging_documents is
  'Facturas/ND de compra y cheques entregados rechazados con saldo abierto. open_amount = lo abierto (OPs, NC con origen, saldo inicial; en un cheque, lo que no cancelaron OPs posteriores) − la parte del crédito de las NC sin origen del proveedor (mismo canal y moneda, de la más vencida a la más nueva) que tomó el documento (amount_credited_unlinked).';

-- The totals: the NCs with no origin are already in the documents.
create or replace view public.v_supplier_aging with (security_invoker = on) as
  select
    d.supplier_id as supplier_id,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '0_30'), 0) as ars_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '30_60'), 0) as ars_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '60_90'), 0) as ars_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as ars_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_total_open,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '0_30'), 0) as usd_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '30_60'), 0) as usd_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '60_90'), 0) as usd_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as usd_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_total_open,
    count(*) as document_count,
    max(d.days_overdue) as oldest_days
  from public.v_supplier_aging_documents d
  group by d.supplier_id;

create or replace view public.v_supplier_aging_by_scope with (security_invoker = on) as
  select
    d.supplier_id as supplier_id,
    d.channel_is_fiscal as channel_is_fiscal,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '0_30'), 0) as ars_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '30_60'), 0) as ars_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '60_90'), 0) as ars_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as ars_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars_total_open,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '0_30'), 0) as usd_bucket_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '30_60'), 0) as usd_bucket_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '60_90'), 0) as usd_bucket_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as usd_bucket_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD')), 0) as usd_total_open,
    count(*) as document_count,
    max(d.days_overdue) as oldest_days
  from public.v_supplier_aging_documents d
  group by d.supplier_id, d.channel_is_fiscal;

-- With the UNION, PostgREST no longer traces supplier_id back to
-- purchase_invoices.supplier_id, so the suppliers!inner embed of the aging
-- views lost its relationship. These computed relationships restore it;
-- security invoker, so suppliers' RLS still applies.
create function public.suppliers(public.v_supplier_aging)
returns setof public.suppliers
rows 1
language sql
stable
set search_path = ''
as $$
  select s.* from public.suppliers s where s.id = $1.supplier_id
$$;

create function public.suppliers(public.v_supplier_aging_by_scope)
returns setof public.suppliers
rows 1
language sql
stable
set search_path = ''
as $$
  select s.* from public.suppliers s where s.id = $1.supplier_id
$$;

revoke all on function public.suppliers(public.v_supplier_aging) from public, anon;
revoke all on function public.suppliers(public.v_supplier_aging_by_scope) from public, anon;
grant execute on function public.suppliers(public.v_supplier_aging) to authenticated, service_role;
grant execute on function public.suppliers(public.v_supplier_aging_by_scope) to authenticated, service_role;

------------------------------------------------------------------------------
-- 4b. Payment tasks stay on purchase invoices
------------------------------------------------------------------------------

-- Same as 20261103170000 except that the supplier_payment branch reads only
-- the purchase-invoice documents (a bounced check has no purchase_invoice_id).
create or replace function public.sync_automatic_tasks(p_today date)
returns table (task_id uuid, kind text, change text)
language sql
volatile
security invoker
set search_path = ''
as $$
  with desired as (
    select
      'purchase_invoices'::text as source_table,
      d.purchase_invoice_id as source_id,
      'supplier_payment'::text as kind,
      format('Pagar a %s: %s', s.legal_name, concat_ws(' ',
        case d.kind when 'nd' then 'ND' else 'Factura' end,
        d.letter,
        lpad(d.punto_venta::text, 4, '0') || '-' || lpad(d.numero::text, 8, '0'))) as title,
      coalesce(d.fch_vto_pago, d.fecha) as due_date
    from public.v_supplier_aging_documents d
    join public.suppliers s on s.id = d.supplier_id
    where d.document_type = 'purchase_invoice'
      and coalesce(d.fch_vto_pago, d.fecha) <= p_today + 7

    union all

    select
      'invoices',
      d.invoice_id,
      'collection',
      format('Cobrar a %s: %s', c.legal_name, concat_ws(' ',
        case d.kind when 'nd' then 'ND' else 'Factura' end,
        d.letter,
        lpad(d.punto_venta::text, 4, '0') || '-' || coalesce(lpad(d.numero::text, 8, '0'), 's/n'))),
      coalesce(d.fch_vto_pago, d.fecha)
    from public.v_aging_documents d
    join public.clients c on c.id = d.client_id
    where d.document_type = 'invoice'
      and coalesce(d.fch_vto_pago, d.fecha) < p_today

    union all

    select
      'loan_installments',
      li.id,
      'loan_installment',
      format('Pagar cuota %s de %s', li.number, l.description),
      li.due_date
    from public.loan_installments li
    join public.loans l on l.id = li.loan_id
    where li.status = 'pendiente'
      and l.status = 'active'
      and li.due_date <= p_today + 7

    union all

    select
      'issued_checks',
      ic.id,
      'issued_check',
      format('Cubrir cheque propio N° %s (%s)', ic.check_number, ic.bank_name),
      ic.due_date
    from public.issued_checks ic
    where ic.status = 'emitted'
      and ic.due_date <= p_today + 7

    union all

    select
      'fleet_documents',
      fd.id,
      'fleet_document',
      format('Renovar %s de %s', replace(fd.kind, '_', ' '), coalesce(v.patente, dr.full_name)),
      fd.expires_at
    from public.fleet_documents fd
    left join public.vehicles v on v.id = fd.vehicle_id
    left join public.drivers dr on dr.id = fd.driver_id
    where fd.expires_at <= p_today + 30
      and coalesce(v.is_active, dr.is_active, false)
      and not exists (
        select 1 from public.fleet_documents n
         where n.id <> fd.id
           and n.kind = fd.kind
           and n.vehicle_id is not distinct from fd.vehicle_id
           and n.driver_id is not distinct from fd.driver_id
           and n.expires_at > p_today + 30
      )

    union all

    select
      'employee_documents',
      ed.id,
      'employee_document',
      format('Renovar %s de %s', replace(ed.kind::text, '_', ' '), e.legal_name),
      ed.expires_at
    from public.employee_documents ed
    join public.employees e on e.id = ed.employee_id
    where ed.expires_at <= p_today + 30
      and e.is_active
      and not exists (
        select 1 from public.employee_documents n
         where n.id <> ed.id
           and n.employee_id = ed.employee_id
           and n.kind = ed.kind
           and n.expires_at > p_today + 30
      )

    union all

    select
      'vehicle_km_readings',
      md5('vehicle_km:' || m.period)::uuid,
      'vehicle_km',
      format('Cargar km de %s %s',
        (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'])
          [extract(month from p_today)::int],
        extract(year from p_today)::int),
      make_date(extract(year from p_today)::int, extract(month from p_today)::int, 5)
    from (select to_char(p_today, 'YYYY-MM') as period) m
    where exists (
      select 1 from public.vehicles v
       where v.is_active
         and v.vehicle_type not in ('acoplado', 'semi')
         and not exists (
           select 1 from public.vehicle_km_readings r
            where r.vehicle_id = v.id
              and r.period = m.period
         )
    )

    union all

    select
      'tax_documents',
      td.id,
      'tax_document',
      format('Pagar %s del período %s',
        public.tax_document_label(td.kind, td.title, td.jurisdiction),
        to_char(to_date(td.period, 'YYYY-MM'), 'MM/YYYY')),
      td.due_date
    from public.tax_documents td
    where td.status in ('pendiente', 'liquidado')
      and td.due_date <= p_today + 7
  ),
  upserted as (
    insert into public.tasks as t (title, due_date, origin, kind, source_table, source_id)
    select d.title, d.due_date, 'automatic', d.kind, d.source_table, d.source_id
      from desired d
    on conflict (source_table, source_id, kind) do update
      set title = excluded.title,
          due_date = case when t.due_date_locked then t.due_date else excluded.due_date end,
          notified_stage = case
            when t.due_date_locked or t.due_date = excluded.due_date then t.notified_stage
          end,
          status = case when t.auto_closed then 'open' else t.status end,
          completed_at = case when t.auto_closed then null else t.completed_at end,
          auto_closed = false
      where t.title is distinct from excluded.title
         or (not t.due_date_locked and t.due_date is distinct from excluded.due_date)
         or t.auto_closed
    returning t.id, t.kind, (t.xmax = 0) as inserted
  ),
  closed as (
    update public.tasks t
       set status = 'done',
           completed_at = now(),
           completed_by = null,
           auto_closed = true
     where t.origin = 'automatic'
       and t.status = 'open'
       and not exists (
         select 1 from desired d
          where d.source_table = t.source_table
            and d.source_id = t.source_id
            and d.kind = t.kind
       )
    returning t.id, t.kind
  )
  select u.id, u.kind, case when u.inserted then 'created' else 'updated' end
    from upserted u
  union all
  select c.id, c.kind, 'closed'
    from closed c;
$$;

revoke all on function public.sync_automatic_tasks(date) from public, anon, authenticated;
grant execute on function public.sync_automatic_tasks(date) to service_role;
