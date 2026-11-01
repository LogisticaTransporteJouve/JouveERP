SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Settling a billed remito interno (docs/otras-ventas.md §4–5). Once its fiscal
-- factura is emitted, the remito's recibos internos pass to the fiscal side and
-- a nota de crédito interna credits what is left open, so the sale is counted
-- once. Everything the move relies on is enforced here, in the DB:
--   * billed_remito_blocker: what keeps a remito from being billed (checked
--     when the factura is drafted and again when it is settled);
--   * guard_billed_remito_frozen: while a live factura bills a remito, the
--     remito takes no new cobro, ajuste de saldo or NC, and cannot be anulado;
--   * settle_billed_remito: one transaction that moves the recibos and drafts
--     the NC; the issue workflow then numbers the NC on the internal side.

-- 1. What keeps a remito from being billed ------------------------------------

-- A recibo moves whole to the fiscal side, so only one that pays this remito
-- alone, in pesos, without cheques or retentions, in an open accounting period.
create or replace function public.billed_remito_blocker(p_remito_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with recibos as (
    select r.id, r.currency, r.receipt_date, r.total_amount, ra.amount_applied
    from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
    where ra.invoice_id = p_remito_id and r.status = 'issued'
  )
  select case
    when exists (
      select 1 from public.invoices n
      where n.invoice_origin_id = p_remito_id
        and n.kind = 'nc'
        and n.status in ('draft', 'emitting', 'emitted')
    ) then 'El remito ya tiene una nota de crédito: no se puede facturar.'
    when exists (
      select 1 from public.client_opening_balance_allocations oba
      where oba.invoice_id = p_remito_id
    ) then 'El remito está saldado en parte por un ajuste de saldo: quitá el ajuste antes de facturarlo.'
    when exists (select 1 from recibos where currency <> 'ARS')
      then 'El remito tiene un cobro en otra moneda: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.'
    when exists (
      select 1 from recibos rc
      where exists (
              select 1 from public.receipt_allocations ra2
              where ra2.receipt_id = rc.id and ra2.invoice_id <> p_remito_id
            )
         or exists (
              select 1 from public.receipt_rejected_check_allocations rca
              where rca.receipt_id = rc.id
            )
    ) then 'Un recibo interno de este remito también paga otros comprobantes: anulalo, facturá el remito y cargá el cobro en Ventas.'
    when exists (select 1 from recibos where total_amount <> amount_applied)
      then 'Un recibo interno de este remito tiene saldo a cuenta: anulalo, facturá el remito y cargá el cobro en Ventas.'
    when exists (
      select 1 from public.checks c join recibos rc on rc.id = c.source_receipt_id
    ) then 'El remito se cobró con cheques: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.'
    when exists (
      select 1 from public.receipt_retentions rr join recibos rc on rc.id = rr.receipt_id
    ) then 'El cobro del remito tiene retenciones: anulá ese recibo interno, facturá el remito y cargá el cobro en Ventas.'
    when exists (
      select 1 from recibos rc
      join public.accounting_closed_periods p
        on p.period = to_char(rc.receipt_date, 'YYYY-MM')
    ) then 'El remito se cobró en un período contable cerrado: no se puede pasar el cobro a Ventas.'
  end;
$$;

revoke all on function public.billed_remito_blocker(uuid) from public, anon, authenticated;
grant execute on function public.billed_remito_blocker(uuid) to service_role;

-- The factura that bills a remito is refused while the remito is blocked,
-- whoever drafts it.
create or replace function public.guard_invoice_source_remito()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel_fiscal boolean;
  v_remito         record;
  v_blocker        text;
begin
  if new.source_remito_id is null then
    return new;
  end if;

  select c.is_fiscal into v_channel_fiscal
  from public.invoicing_channels c
  where c.id = new.channel_id;

  if new.kind <> 'factura' or not coalesce(v_channel_fiscal, false) then
    raise exception 'Solo una factura de Ventas puede facturar un remito interno.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select i.kind, i.status, ch.is_fiscal
    into v_remito
  from public.invoices i
  join public.invoicing_channels ch on ch.id = i.channel_id
  where i.id = new.source_remito_id;

  if v_remito is null
     or v_remito.kind <> 'factura'
     or v_remito.is_fiscal
     or v_remito.status <> 'emitted' then
    raise exception 'El origen tiene que ser un remito interno emitido.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if tg_op = 'INSERT' then
    v_blocker := public.billed_remito_blocker(new.source_remito_id);
    if v_blocker is not null then
      raise exception '%', v_blocker using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_invoice_source_remito() from public, anon, authenticated;

-- 2. A remito being billed is frozen ------------------------------------------

create or replace function public.guard_billed_remito_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remito_id uuid;
  v_factura   uuid;
begin
  if tg_table_name = 'invoices' then
    -- An NC (insert, or the settlement's own NC being anulada) points at its
    -- remito through invoice_origin_id; a remito being anulado is itself.
    v_remito_id := case
      when tg_op = 'INSERT' or new.kind = 'nc' then new.invoice_origin_id
      else new.id
    end;
  else
    v_remito_id := new.invoice_id;
  end if;
  if v_remito_id is null then
    return new;
  end if;

  select f.id into v_factura
  from public.invoices f
  where f.source_remito_id = v_remito_id
    and f.status not in ('failed', 'cancelled')
  limit 1;
  if v_factura is null then
    return new;
  end if;

  -- The settlement's own NC is the one change allowed. (Nested: plpgsql does
  -- not short-circuit, and only invoices has idempotency_key.)
  if tg_table_name = 'invoices' and tg_op = 'INSERT' then
    if new.idempotency_key::text = v_factura::text then
      return new;
    end if;
  end if;

  raise exception 'El remito se facturó en Ventas: no admite cobros, ajustes, notas de crédito ni anulación.'
    using errcode = '23514', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_billed_remito_frozen() from public, anon, authenticated;

create trigger receipt_allocations_billed_remito_frozen
  before insert on public.receipt_allocations
  for each row execute function public.guard_billed_remito_frozen();

create trigger opening_allocations_billed_remito_frozen
  before insert on public.client_opening_balance_allocations
  for each row execute function public.guard_billed_remito_frozen();

create trigger invoices_nc_billed_remito_frozen
  before insert on public.invoices
  for each row
  when (new.kind = 'nc' and new.invoice_origin_id is not null)
  execute function public.guard_billed_remito_frozen();

create trigger invoices_cancel_billed_remito_frozen
  before update of status on public.invoices
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function public.guard_billed_remito_frozen();

-- 3. Settling ---------------------------------------------------------------

-- Called by the credit-billed-remito Inngest job (service role) once the
-- factura is emitted. Returns the NC's id (null only for a remito with nothing
-- open, which the blocker makes unreachable). Idempotent: a second call finds
-- the NC it already drafted, and puts it back to draft if its issue failed so
-- the job issues it again.
create or replace function public.settle_billed_remito(p_factura_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factura record;
  v_remito  record;
  v_receipt record;
  v_pos     int;
  v_numero  int;
  v_lines   jsonb;
  v_blocker text;
  v_open    numeric;
  v_motivo  text;
  v_nc_id   uuid;
begin
  select i.id, i.client_id, i.channel_id, i.source_remito_id, i.status,
         i.letter, i.punto_venta, i.numero, i.created_by
    into v_factura
  from public.invoices i
  where i.id = p_factura_id;

  if v_factura is null or v_factura.source_remito_id is null then
    return null;
  end if;
  if v_factura.status <> 'emitted' then
    raise exception 'La factura todavía no está emitida.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select n.id into v_nc_id
  from public.invoices n
  where n.idempotency_key::text = p_factura_id::text;
  if v_nc_id is not null then
    update public.invoices
    set status = 'draft'
    where id = v_nc_id and status = 'failed';
    return v_nc_id;
  end if;

  select i.id, i.status, i.channel_id, i.client_id, i.punto_venta, i.concepto,
         i.doc_tipo, i.doc_nro, i.moneda, i.cotizacion
    into v_remito
  from public.invoices i
  where i.id = v_factura.source_remito_id
  for update;
  if v_remito.status <> 'emitted' then
    raise exception 'El remito ya no está emitido: no se puede acreditar.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  v_blocker := public.billed_remito_blocker(v_remito.id);
  if v_blocker is not null then
    raise exception '%', v_blocker using errcode = '23514', hint = 'jouve_guard';
  end if;

  select sp.numero into v_pos
  from public.sales_points sp
  where sp.channel_id = v_factura.channel_id and sp.is_enabled
  order by sp.numero
  limit 1;

  for v_receipt in
    select r.id, r.receipt_date, r.total_amount, r.currency, r.cotizacion,
           r.punto_venta, r.numero, ra.amount_applied
    from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
    where ra.invoice_id = v_remito.id
      and r.status = 'issued'
    order by r.receipt_date, r.numero
    for update of r
  loop
    if v_pos is null then
      raise exception 'El canal fiscal no tiene un punto de venta habilitado para recibos.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;

    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'account_id', l.account_id,
                 'amount', l.amount,
                 'reference', l.reference
               )
               order by l.created_at
             ),
             '[]'::jsonb
           )
      into v_lines
    from public.receipt_payment_lines l
    where l.receipt_id = v_receipt.id;

    -- Its treasury movements go with it (handle_receipt_cancellation).
    update public.receipts
    set status = 'canceled',
        canceled_at = now()
    where id = v_receipt.id;

    select coalesce(max(r.numero), 0) + 1 into v_numero
    from public.receipts r
    where r.channel_id = v_factura.channel_id and r.punto_venta = v_pos;

    perform public.create_receipt(
      v_factura.channel_id,
      v_pos,
      v_numero,
      v_factura.client_id,
      v_receipt.receipt_date,
      v_receipt.total_amount,
      v_receipt.currency,
      'Cobro pasado del recibo interno R'
        || lpad(v_receipt.punto_venta::text, 4, '0') || '-'
        || lpad(v_receipt.numero::text, 8, '0')
        || ' al facturar el remito.',
      v_lines,
      jsonb_build_array(
        jsonb_build_object(
          'invoice_id', v_factura.id,
          'amount_applied', v_receipt.amount_applied
        )
      ),
      '[]'::jsonb,
      v_receipt.cotizacion
    );
  end loop;

  v_open := public.invoice_open_amount(v_remito.id);
  if v_open <= 0 then
    return null;
  end if;

  v_motivo := 'Facturado como '
    || coalesce(v_factura.letter, '')
    || lpad(v_factura.punto_venta::text, 4, '0') || '-'
    || lpad(coalesce(v_factura.numero, 0)::text, 8, '0');

  insert into public.invoices (
    channel_id, client_id, kind, letter, punto_venta, fecha, concepto,
    doc_tipo, doc_nro, iva_condition_receptor, imp_neto, imp_iva, imp_trib,
    imp_tot_conc, imp_op_ex, imp_total, moneda, cotizacion, status,
    invoice_origin_id, motivo_nc_nd, idempotency_key, created_by
  ) values (
    v_remito.channel_id, v_remito.client_id, 'nc', null, v_remito.punto_venta,
    (now() at time zone 'America/Argentina/Buenos_Aires')::date,
    v_remito.concepto, v_remito.doc_tipo, v_remito.doc_nro, null,
    v_open, 0, 0, 0, 0, v_open, v_remito.moneda, v_remito.cotizacion, 'draft',
    v_remito.id, v_motivo, p_factura_id, v_factura.created_by
  )
  returning id into v_nc_id;

  insert into public.invoice_items (
    invoice_id, sort_order, description, quantity, unit_price, iva_rate_id,
    line_neto, line_iva, line_total
  ) values (
    v_nc_id, 0, v_motivo, 1, v_open, null, v_open, 0, v_open
  );

  return v_nc_id;
end;
$$;

revoke all on function public.settle_billed_remito(uuid) from public, anon, authenticated;
grant execute on function public.settle_billed_remito(uuid) to service_role;
