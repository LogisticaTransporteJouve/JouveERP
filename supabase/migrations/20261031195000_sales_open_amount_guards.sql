SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Sales: one open amount per comprobante and guards that keep it >= 0
-- (audit 2026-10-31, ventas S2, S3, S5).
--
--   * invoice_open_amount(id): imp_total − issued receipt allocations −
--     opening-balance allocations − NCs against it. Same terms as
--     v_aging_documents, except that an NC still being issued (draft or
--     emitting) already counts: it reserves the amount before AFIP answers.
--   * guard_receipt_allocation also subtracts the opening-balance allocations
--     and rejects a receipt in another currency than the comprobante.
--   * guard_invoice_open_after_change, deferred: at commit, an allocation or an
--     NC being issued must not leave its comprobante with a negative open
--     amount. It only fires on insert or on a change of the amounts it reads,
--     never on the draft → emitted stamp, so a CAE already granted is never
--     rejected.
--   * guard_cancel_invoice_with_allocations: a comprobante with NC/ND issued
--     against it can't be cancelled (they would be left without an origin).

create or replace function public.invoice_open_amount(p_invoice_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select i.imp_total
    - coalesce((select sum(ra.amount_applied)
                  from public.receipt_allocations ra
                  join public.receipts r on r.id = ra.receipt_id
                 where ra.invoice_id = i.id and r.status = 'issued'), 0)
    - coalesce((select sum(oba.amount_applied)
                  from public.client_opening_balance_allocations oba
                 where oba.invoice_id = i.id), 0)
    - coalesce((select sum(n.imp_total)
                  from public.invoices n
                 where n.invoice_origin_id = i.id
                   and n.kind = 'nc'
                   and n.status in ('draft', 'emitting', 'emitted')), 0)
    from public.invoices i
   where i.id = p_invoice_id;
$$;

revoke all on function public.invoice_open_amount(uuid) from public, anon, authenticated;

create or replace function public.guard_receipt_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client   uuid;
  v_channel  text;
  v_total    numeric;
  v_status   text;
  v_kind     text;
  v_moneda   text;
  v_receipt_client  uuid;
  v_receipt_channel text;
  v_receipt_created timestamptz;
  v_receipt_currency text;
  v_sum      numeric;
  v_credited numeric;
  v_opening  numeric;
begin
  select client_id, channel_id, imp_total, status, kind, moneda
    into v_client, v_channel, v_total, v_status, v_kind, v_moneda
    from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'Comprobante % no existe', new.invoice_id using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_status <> 'emitted' or v_kind not in ('factura', 'nd') then
    raise exception 'Solo se pueden imputar facturas y notas de débito emitidas'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select client_id, channel_id, created_at, currency
    into v_receipt_client, v_receipt_channel, v_receipt_created, v_receipt_currency
    from public.receipts where id = new.receipt_id;
  if v_receipt_client is distinct from v_client then
    raise exception 'El comprobante no pertenece al cliente del recibo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_receipt_channel is distinct from v_channel then
    raise exception 'El comprobante es de otro canal que el recibo: un recibo solo cancela comprobantes de su mismo canal'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_receipt_currency is distinct from
     (case when coalesce(v_moneda, 'PES') in ('DOL', 'USD') then 'USD' else 'ARS' end) then
    raise exception 'El comprobante está en otra moneda que el recibo: un recibo solo cancela comprobantes de su misma moneda'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select coalesce(sum(ra.amount_applied), 0) into v_sum
    from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
   where ra.invoice_id = new.invoice_id
     and ra.id <> new.id
     and r.status <> 'canceled';

  select coalesce(sum(n.imp_total), 0) into v_credited
    from public.invoices n
   where n.invoice_origin_id = new.invoice_id
     and n.kind = 'nc'
     and n.status = 'emitted'
     -- NCs issued after this receipt existed don't shrink what it may keep;
     -- guard_invoice_open_after_change still rejects a negative open amount.
     and coalesce(n.emitted_at, n.created_at) < v_receipt_created;

  select coalesce(sum(oba.amount_applied), 0) into v_opening
    from public.client_opening_balance_allocations oba
   where oba.invoice_id = new.invoice_id;

  if v_sum + v_credited + v_opening + new.amount_applied > v_total + 0.01 then
    raise exception 'La imputación excede el saldo del comprobante (% + % + % + % > %)',
      v_sum, v_credited, v_opening, new.amount_applied, v_total using errcode = '23514', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_receipt_allocation() from public, anon, authenticated;

create or replace function public.guard_invoice_open_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if tg_table_name = 'receipt_allocations' then
    v_id := new.invoice_id;
  elsif new.kind = 'nc' and new.status in ('draft', 'emitting') and new.invoice_origin_id is not null then
    v_id := new.invoice_origin_id;
  else
    return null;
  end if;

  perform 1 from public.invoices where id = v_id for update;

  if public.invoice_open_amount(v_id) < -0.01 then
    if tg_table_name = 'receipt_allocations' then
      raise exception 'La imputación deja el comprobante con más cobrado o acreditado que su total'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    raise exception 'La nota de crédito supera el saldo abierto del comprobante de origen'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return null;
end;
$$;

revoke all on function public.guard_invoice_open_after_change() from public, anon, authenticated;

create constraint trigger receipt_allocations_open_after_change
  after insert or update of invoice_id, amount_applied
  on public.receipt_allocations
  deferrable initially deferred
  for each row execute function public.guard_invoice_open_after_change();

create constraint trigger invoices_nc_open_after_change
  after insert or update of imp_total, invoice_origin_id, kind
  on public.invoices
  deferrable initially deferred
  for each row execute function public.guard_invoice_open_after_change();

create or replace function public.guard_cancel_invoice_with_allocations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'emitted' and new.status = 'cancelled' then
    if exists (
      select 1
        from public.receipt_allocations ra
        join public.receipts r on r.id = ra.receipt_id
       where ra.invoice_id = old.id
         and r.status = 'issued'
    ) then
      raise exception 'El comprobante tiene recibos imputados. Anulá esos recibos antes de anularlo.'
        using errcode = '22023', hint = 'jouve_guard';
    end if;
    if exists (
      select 1
        from public.client_opening_balance_allocations oba
       where oba.invoice_id = old.id
    ) then
      raise exception 'El comprobante está saldado por el saldo inicial del cliente. Recalculá el saldo inicial antes de anularlo.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if exists (
      select 1
        from public.invoices n
       where n.invoice_origin_id = old.id
         and n.status in ('draft', 'emitting', 'emitted')
    ) then
      raise exception 'El comprobante tiene notas de crédito o débito emitidas. Anulá esas notas antes de anularlo.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;
  return new;
end;
$$;
