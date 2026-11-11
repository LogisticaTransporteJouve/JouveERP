SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The credit of an NC beyond what its origin owes cancels the same party's
-- other open documents, oldest first (decision 2026-11-11, docs/decisions/
-- 2026-11-11-credito-de-nc-cancela-comprobantes.md). Computed, never stored:
-- emitted NCs keep their CAE and their origin.
--
-- Two figures per document, in one read model per side:
--   * own_open_amount: what the document owes by itself (imp_total − payments
--     − opening − its own NCs; today's figure). The guards, the NC cap and
--     the settlement of remitos read it, so an allocation or an NC is never
--     refused because of credit another NC lent.
--   * open_amount: what it really owes. On eligible rows (factura/ND emitted
--     or received) greatest(own, 0) − amount_credited_by_nc_spill.
--
-- The spill runs per (party, channel, currency), ordered by fecha,
-- punto_venta, numero, id. The excess of an origin is split by NC date
-- against the party's opening cut (when it has an opening in that currency):
-- the part from NCs up to the cut only lowers documents up to the cut and the
-- rest is absorbed by the opening target (which already nets them); the part
-- from NCs after the cut flows over every document. With no over-credited
-- origin every figure is the same as before.
--
--   1. v_invoice_open (new): the sales read model.
--   2. invoice_own_open_amount (new) = the old invoice_open_amount body;
--      invoice_open_amount keeps its signature and returns the real figure.
--   3. guard_invoice_open_after_change and settle_billed_remito read the own
--      figure.
--   4. v_purchase_invoice_open spills (same columns, own_open_amount and
--      amount_credited_by_nc_spill appended).
--   5. guard_payment_order_allocation, guard_purchase_invoice_open_after_edit
--      and impute_purchase_remitos read the own figure, filtering the view by
--      supplier and channel.
--   6. v_aging_documents and v_supplier_aging_documents read the base views
--      (same columns; bodies copied from 20261111205100).
--   7. The opening FIFOs spread over the capacity after the spill.
--
-- Rollback: columns are only appended; older code reads a lower open_amount,
-- never a higher one, and invoice_open_amount keeps its signature.

-- 1. Sales base view ------------------------------------------------------------------

create view public.v_invoice_open with (security_invoker = on) as
  with base as (
    select
      i.id as invoice_id,
      i.client_id,
      i.channel_id,
      case when coalesce(i.moneda, 'PES') in ('DOL', 'USD') then 'USD'::text else 'ARS'::text end as currency,
      i.status,
      i.kind,
      i.fecha,
      i.punto_venta,
      i.numero,
      i.imp_total,
      coalesce(ra.applied, 0)::numeric as amount_paid,
      coalesce(oba.applied, 0)::numeric as amount_opening_applied,
      coalesce(nc.credited, 0)::numeric as amount_credited_by_nc,
      coalesce(nc.credited_after_cut, 0)::numeric as credited_after_cut,
      coalesce(nc.in_flight, 0)::numeric as amount_nc_in_flight,
      cut.opening_date as cut,
      (i.status = 'emitted' and i.kind in ('factura', 'nd')) as eligible
    from public.invoices i
    left join lateral (
      select sum(a.amount_applied) as applied
        from public.receipt_allocations a
        join public.receipts r on r.id = a.receipt_id
       where a.invoice_id = i.id and r.status = 'issued'
    ) ra on true
    left join lateral (
      select sum(b.amount_applied) as applied
        from public.client_opening_balance_allocations b
       where b.invoice_id = i.id
    ) oba on true
    left join lateral (
      select ob.opening_date
        from public.client_opening_balances ob
       where ob.client_id = i.client_id
         and (coalesce(i.moneda, 'PES') not in ('DOL', 'USD') or ob.target_balance_usd is not null)
    ) cut on true
    left join lateral (
      select
        sum(n.imp_total) filter (where n.status = 'emitted') as credited,
        sum(n.imp_total) filter (
          where n.status = 'emitted' and (cut.opening_date is null or n.fecha > cut.opening_date)
        ) as credited_after_cut,
        sum(n.imp_total) filter (where n.status in ('draft', 'emitting')) as in_flight
        from public.invoices n
       where n.invoice_origin_id = i.id and n.kind = 'nc'
    ) nc on true
  ),
  own as (
    select b.*,
      (b.imp_total - b.amount_paid - b.amount_opening_applied - b.amount_credited_by_nc)::numeric as own_open_amount
    from base b
  ),
  parts as (
    select o.*,
      case when o.eligible then greatest(o.own_open_amount, 0) else 0 end::numeric as residue,
      case when o.eligible then greatest(-o.own_open_amount, 0) else 0 end::numeric as excess,
      case when o.eligible and o.cut is not null
        then greatest(-(o.own_open_amount + o.credited_after_cut), 0) else 0 end::numeric as excess_pre
    from own o
  ),
  stage1 as (
    select p.*,
      case when p.eligible and p.cut is not null and p.fecha <= p.cut then
        least(p.residue, greatest(
          sum(p.excess_pre) over w_all
          - coalesce(sum(case when p.eligible and p.cut is not null and p.fecha <= p.cut then p.residue else 0 end) over w_prev, 0),
          0))
      else 0 end::numeric as spill_pre
    from parts p
    window
      w_all as (partition by p.client_id, p.channel_id, p.currency),
      w_prev as (partition by p.client_id, p.channel_id, p.currency
                 order by p.fecha, p.punto_venta, p.numero, p.invoice_id
                 rows between unbounded preceding and 1 preceding)
  ),
  stage2 as (
    select s.*,
      case when s.eligible then
        least(s.residue - s.spill_pre, greatest(
          sum(s.excess - s.excess_pre) over w_all
          - coalesce(sum(s.residue - s.spill_pre) over w_prev, 0),
          0))
      else 0 end::numeric as spill_post
    from stage1 s
    window
      w_all as (partition by s.client_id, s.channel_id, s.currency),
      w_prev as (partition by s.client_id, s.channel_id, s.currency
                 order by s.fecha, s.punto_venta, s.numero, s.invoice_id
                 rows between unbounded preceding and 1 preceding)
  )
  select
    s.invoice_id,
    s.client_id,
    s.channel_id,
    s.currency,
    s.status,
    s.kind,
    s.fecha,
    s.imp_total,
    s.amount_paid,
    s.amount_opening_applied,
    s.amount_credited_by_nc,
    s.amount_nc_in_flight,
    s.own_open_amount,
    (s.spill_pre + s.spill_post)::numeric as amount_credited_by_nc_spill,
    case when s.eligible then s.residue - s.spill_pre - s.spill_post else s.own_open_amount end::numeric as open_amount
  from stage2 s;

comment on view public.v_invoice_open is
  'Saldo de cada comprobante de venta. own_open_amount = lo que debe por sí solo: imp_total − recibos emitidos − saldo inicial − sus NC emitidas (lo que leen las guardas y el tope de una NC nueva). open_amount = lo que realmente debe: en facturas y ND emitidas, greatest(own_open_amount, 0) − amount_credited_by_nc_spill, donde el sobrante de una NC mayor que su origen cancela los otros comprobantes del mismo cliente, canal y moneda, del más viejo al más nuevo (fecha, punto de venta, número); el sobrante de NC hasta la fecha del saldo inicial solo baja comprobantes hasta esa fecha y el resto queda dentro del saldo inicial. Lo que sobra queda como crédito a favor. En NC, borradores y anulados open_amount = own_open_amount. amount_nc_in_flight = NC con origen aún en borrador o emitiéndose.';

revoke all on table public.v_invoice_open from public, anon;
grant select on table public.v_invoice_open to authenticated, service_role;

-- 2. Sales functions ------------------------------------------------------------------

create function public.invoice_own_open_amount(p_invoice_id uuid)
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

comment on function public.invoice_own_open_amount(uuid) is
  'Lo que un comprobante de venta debe por sí solo: imp_total − recibos emitidos − saldo inicial − sus NC (borrador, emitiéndose o emitidas). No cuenta el crédito que le pasan otras NC. La leen la guarda diferida, la cancelación de remitos facturados y el tope de una NC nueva.';

revoke all on function public.invoice_own_open_amount(uuid) from public, anon, authenticated;
grant execute on function public.invoice_own_open_amount(uuid) to service_role;

create or replace function public.invoice_open_amount(p_invoice_id uuid)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_client  uuid;
  v_channel text;
  v_open    numeric;
begin
  select i.client_id, i.channel_id into v_client, v_channel
    from public.invoices i
   where i.id = p_invoice_id;
  if not found then
    return null;
  end if;

  select o.open_amount - o.amount_nc_in_flight into v_open
    from public.v_invoice_open o
   where o.client_id = v_client
     and o.channel_id = v_channel
     and o.invoice_id = p_invoice_id;
  return v_open;
end;
$$;

comment on function public.invoice_open_amount(uuid) is
  'Lo que un comprobante de venta realmente debe (v_invoice_open.open_amount, con el crédito que le pasan otras NC) menos sus NC en borrador o emitiéndose. La app ya no la llama; queda para el código anterior tras un rollback. Para el tope de una NC usar invoice_own_open_amount.';

revoke all on function public.invoice_open_amount(uuid) from public, anon, authenticated;
grant execute on function public.invoice_open_amount(uuid) to service_role;

-- 3. Sales readers of the own figure ---------------------------------------------------

-- 20261031195000
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

  if public.invoice_own_open_amount(v_id) < -0.01 then
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

-- 20261103210000
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
  v_existing record;
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

  -- Only this function can draft an NC on a frozen remito, so an NC of the
  -- remito holding the factura's key is the settlement's own.
  select n.id, n.kind, n.invoice_origin_id into v_existing
  from public.invoices n
  where n.idempotency_key::text = p_factura_id::text;
  if v_existing is not null then
    if v_existing.kind <> 'nc'
       or v_existing.invoice_origin_id is distinct from v_factura.source_remito_id then
      raise exception 'Otro comprobante usa la clave de esta acreditación: revisalo antes de reintentar.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_nc_id := v_existing.id;
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
      'Cobro pasado del recibo interno X'
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

  -- What the remito owes by itself: the credit other NCs spill on it stays
  -- with the client (v_invoice_open), it is not cancelled by this NC.
  v_open := public.invoice_own_open_amount(v_remito.id);
  if v_open <= 0 then
    return null;
  end if;

  v_motivo := 'Facturado como '
    || coalesce(v_factura.letter, '')
    || lpad(v_factura.punto_venta::text, 4, '0') || '-'
    || lpad(coalesce(v_factura.numero, 0)::text, 8, '0');

  perform set_config('jouve.settling_remito', v_remito.id::text, true);
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
  perform set_config('jouve.settling_remito', '', true);

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

-- 4. Purchases base view --------------------------------------------------------------

-- Same columns in the same order as 20261031180534, two appended.
create or replace view public.v_purchase_invoice_open with (security_invoker = on) as
  with base as (
    select
      pi.id as purchase_invoice_id,
      pi.status,
      pi.kind,
      pi.imp_total,
      coalesce(alloc.applied, 0)::numeric as amount_paid,
      coalesce(nc.credited, 0)::numeric as amount_credited_by_nc,
      coalesce(opening.applied, 0)::numeric as amount_opening_applied,
      pi.supplier_id,
      pi.channel_id,
      pi.invoice_origin_id,
      pi.moneda,
      pi.fecha,
      pi.punto_venta,
      pi.numero,
      case when coalesce(pi.moneda, 'PES') in ('DOL', 'USD') then 'USD'::text else 'ARS'::text end as currency,
      coalesce(nc.credited_after_cut, 0)::numeric as credited_after_cut,
      cut.opening_date as cut,
      (pi.status = 'received' and pi.kind in ('factura', 'nd')) as eligible
    from public.purchase_invoices pi
    left join lateral (
      select sum(poa.amount_applied) as applied
        from public.payment_order_allocations poa
        join public.payment_orders po on po.id = poa.payment_order_id
       where poa.purchase_invoice_id = pi.id and po.status = 'issued'
    ) alloc on true
    left join lateral (
      select sum(soba.amount_applied) as applied
        from public.supplier_opening_balance_allocations soba
       where soba.purchase_invoice_id = pi.id
    ) opening on true
    left join lateral (
      select ob.opening_date
        from public.supplier_opening_balances ob
       where ob.supplier_id = pi.supplier_id
         and (coalesce(pi.moneda, 'PES') not in ('DOL', 'USD') or ob.target_balance_usd is not null)
    ) cut on true
    left join lateral (
      select
        sum(n.imp_total) as credited,
        sum(n.imp_total) filter (where cut.opening_date is null or n.fecha > cut.opening_date) as credited_after_cut
        from public.purchase_invoices n
       where n.invoice_origin_id = pi.id and n.kind = 'nc' and n.status = 'received'
    ) nc on true
  ),
  own as (
    select b.*,
      (b.imp_total - b.amount_paid - b.amount_credited_by_nc - b.amount_opening_applied)::numeric as own_open_amount
    from base b
  ),
  parts as (
    select o.*,
      case when o.eligible then greatest(o.own_open_amount, 0) else 0 end::numeric as residue,
      case when o.eligible then greatest(-o.own_open_amount, 0) else 0 end::numeric as excess,
      case when o.eligible and o.cut is not null
        then greatest(-(o.own_open_amount + o.credited_after_cut), 0) else 0 end::numeric as excess_pre
    from own o
  ),
  stage1 as (
    select p.*,
      case when p.eligible and p.cut is not null and p.fecha <= p.cut then
        least(p.residue, greatest(
          sum(p.excess_pre) over w_all
          - coalesce(sum(case when p.eligible and p.cut is not null and p.fecha <= p.cut then p.residue else 0 end) over w_prev, 0),
          0))
      else 0 end::numeric as spill_pre
    from parts p
    window
      w_all as (partition by p.supplier_id, p.channel_id, p.currency),
      w_prev as (partition by p.supplier_id, p.channel_id, p.currency
                 order by p.fecha, p.punto_venta, p.numero, p.purchase_invoice_id
                 rows between unbounded preceding and 1 preceding)
  ),
  stage2 as (
    select s.*,
      case when s.eligible then
        least(s.residue - s.spill_pre, greatest(
          sum(s.excess - s.excess_pre) over w_all
          - coalesce(sum(s.residue - s.spill_pre) over w_prev, 0),
          0))
      else 0 end::numeric as spill_post
    from stage1 s
    window
      w_all as (partition by s.supplier_id, s.channel_id, s.currency),
      w_prev as (partition by s.supplier_id, s.channel_id, s.currency
                 order by s.fecha, s.punto_venta, s.numero, s.purchase_invoice_id
                 rows between unbounded preceding and 1 preceding)
  )
  select
    s.purchase_invoice_id,
    s.status,
    s.kind,
    s.imp_total,
    s.amount_paid,
    s.amount_credited_by_nc,
    s.amount_opening_applied,
    case when s.eligible then s.residue - s.spill_pre - s.spill_post else s.own_open_amount end::numeric as open_amount,
    s.supplier_id,
    s.channel_id,
    s.invoice_origin_id,
    s.moneda,
    s.own_open_amount,
    (s.spill_pre + s.spill_post)::numeric as amount_credited_by_nc_spill
  from stage2 s;

comment on view public.v_purchase_invoice_open is
  'Saldo de cada comprobante de compra. own_open_amount = lo que debe por sí solo: imp_total − órdenes de pago emitidas − sus NC recibidas − saldo inicial (lo que leen las guardas y la imputación de remitos). open_amount = lo que realmente debe: en facturas y ND recibidas, greatest(own_open_amount, 0) − amount_credited_by_nc_spill, donde el sobrante de una NC mayor que su origen cancela los otros comprobantes del mismo proveedor, canal y moneda, del más viejo al más nuevo (fecha, punto de venta, número); el sobrante de NC hasta la fecha del saldo inicial solo baja comprobantes hasta esa fecha y el resto queda dentro del saldo inicial. Lo que sobra queda como crédito a favor. En NC y anulados open_amount = own_open_amount.';

grant select on table public.v_purchase_invoice_open to authenticated, service_role;

-- 5. Purchase readers of the own figure ------------------------------------------------

-- 20261031195001
create or replace function public.guard_payment_order_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier uuid;
  v_channel  text;
  v_status   text;
  v_kind     text;
  v_moneda   text;
  v_po_supplier uuid;
  v_po_channel  text;
  v_po_currency text;
  v_open     numeric;
begin
  select supplier_id, channel_id, status, kind, moneda
    into v_supplier, v_channel, v_status, v_kind, v_moneda
    from public.purchase_invoices where id = new.purchase_invoice_id for update;
  if not found then
    raise exception 'Factura de compra % no existe', new.purchase_invoice_id using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_status <> 'received' or v_kind not in ('factura', 'nd') then
    raise exception 'Solo se pueden imputar facturas y notas de débito de compra recibidas'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select supplier_id, channel_id, currency into v_po_supplier, v_po_channel, v_po_currency
    from public.payment_orders where id = new.payment_order_id;
  if v_po_supplier is distinct from v_supplier then
    raise exception 'La factura no pertenece al proveedor de la orden de pago'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_po_channel is distinct from v_channel then
    raise exception 'La factura es de otro canal que la orden de pago: una OP solo cancela facturas de su mismo canal'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_po_currency is distinct from
     (case when coalesce(v_moneda, 'PES') in ('DOL', 'USD') then 'USD' else 'ARS' end) then
    raise exception 'La factura está en otra moneda que la orden de pago: una OP solo cancela facturas de su misma moneda'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- The invoice's own figure: credit spilled from other NCs never blocks a
  -- payment (it moves to the next document instead).
  select o.own_open_amount into v_open
    from public.v_purchase_invoice_open o
   where o.supplier_id = v_supplier
     and o.channel_id = v_channel
     and o.purchase_invoice_id = new.purchase_invoice_id;
  -- On update the view still counts this row's previous amount.
  if tg_op = 'UPDATE'
     and old.purchase_invoice_id = new.purchase_invoice_id
     and exists (select 1 from public.payment_orders po
                  where po.id = old.payment_order_id and po.status = 'issued') then
    v_open := v_open + old.amount_applied;
  end if;

  if new.amount_applied > v_open + 0.01 then
    raise exception 'La imputación excede el saldo abierto de la factura (% > %)',
      new.amount_applied, v_open using errcode = '23514', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_payment_order_allocation() from public, anon, authenticated;

-- 20261105140000
create or replace function public.guard_purchase_invoice_open_after_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := array_remove(array[new.id, old.invoice_origin_id, new.invoice_origin_id], null);
begin
  perform 1 from public.purchase_invoices
   where id = any (v_ids)
   order by id
     for update;

  if exists (
    select 1 from public.v_purchase_invoice_open o
     where o.supplier_id = new.supplier_id
       and o.channel_id = new.channel_id
       and o.purchase_invoice_id = any (v_ids)
       and o.status = 'received'
       and o.kind in ('factura', 'nd')
       and o.own_open_amount < -0.01
  ) then
    raise exception 'La edición deja un comprobante con más pagado o acreditado que su total'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return null;
end;
$$;

revoke all on function public.guard_purchase_invoice_open_after_edit() from public, anon, authenticated;

-- 20261101210000
create or replace function public.impute_purchase_remitos(p_factura_id uuid, p_remito_ids uuid[], p_user_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factura   record;
  v_remito    record;
  v_op        record;
  v_pos       int;
  v_numero    int;
  v_lines     jsonb;
  v_blocker   text;
  v_open      numeric;
  v_total     numeric := 0;
  v_motivo    text;
  v_new_op    uuid;
  v_nc_id     uuid;
  v_nc_ids    uuid[] := '{}';
begin
  if coalesce(cardinality(p_remito_ids), 0) = 0 then
    raise exception 'Elegí al menos un remito.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select pi.id, pi.channel_id, pi.supplier_id, pi.kind, pi.status, pi.letter,
         pi.punto_venta, pi.numero, pi.imp_total, pi.moneda, ch.is_fiscal
    into v_factura
  from public.purchase_invoices pi
  join public.invoicing_channels ch on ch.id = pi.channel_id
  where pi.id = p_factura_id
  for update of pi;

  if v_factura is null
     or not v_factura.is_fiscal
     or v_factura.kind <> 'factura'
     or v_factura.status <> 'received' then
    raise exception 'Solo se imputan remitos a una factura de Compras recibida.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_factura.moneda <> 'PES' then
    raise exception 'La factura está en otra moneda: no se le pueden imputar remitos.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- Lock and check every remito before moving anything.
  for v_remito in
    select pi.id, pi.supplier_id, pi.channel_id, pi.status, pi.kind, ch.is_fiscal,
           public.purchase_remito_imputed_to(pi.id) as imputed_to
    from public.purchase_invoices pi
    join public.invoicing_channels ch on ch.id = pi.channel_id
    where pi.id = any (p_remito_ids)
    order by pi.id
    for update of pi
  loop
    if v_remito.is_fiscal or v_remito.kind <> 'factura' or v_remito.status <> 'received' then
      raise exception 'Solo se imputan remitos internos de compra recibidos.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if v_remito.imputed_to is not null then
      raise exception 'Un remito ya está imputado a otra factura.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_blocker := public.purchase_remito_blocker(v_remito.id);
    if v_blocker is not null then
      raise exception '%', v_blocker using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_total := v_total + (
      select o.own_open_amount + o.amount_paid
      from public.v_purchase_invoice_open o
      where o.supplier_id = v_remito.supplier_id
        and o.channel_id = v_remito.channel_id
        and o.purchase_invoice_id = v_remito.id
    );
  end loop;

  if (select count(*) from public.purchase_invoices where id = any (p_remito_ids))
     <> cardinality(array(select distinct unnest(p_remito_ids))) then
    raise exception 'Un remito elegido no existe.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  -- Counting the remitos already imputed to it.
  v_total := v_total + coalesce((
    select sum(n.imp_total)
    from public.purchase_invoices n
    where n.imputed_to_id = v_factura.id and n.status = 'received'
  ), 0);
  if v_total > v_factura.imp_total + 0.01 then
    raise exception 'Los remitos suman más que la factura: revisá cuáles imputar.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  v_motivo := 'Imputado a la factura '
    || coalesce(v_factura.letter, '')
    || lpad(v_factura.punto_venta::text, 5, '0') || '-'
    || lpad(v_factura.numero::text, 8, '0');

  select sp.numero into v_pos
  from public.sales_points sp
  where sp.channel_id = v_factura.channel_id and sp.is_enabled
  order by sp.numero
  limit 1;

  perform set_config('jouve.imputing_purchase', 'on', true);

  -- The remitos' payment orders pass to the factura, whole.
  for v_op in
    select po.id, po.payment_date, po.total_amount, po.currency, po.cotizacion,
           po.punto_venta, po.numero, poa.amount_applied
    from public.payment_order_allocations poa
    join public.payment_orders po on po.id = poa.payment_order_id
    where poa.purchase_invoice_id = any (p_remito_ids)
      and po.status = 'issued'
    order by po.payment_date, po.numero
    for update of po
  loop
    if v_pos is null then
      raise exception 'El canal fiscal no tiene un punto de venta habilitado para órdenes de pago.'
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
    from public.payment_order_payment_lines l
    where l.payment_order_id = v_op.id;

    -- Its treasury movements go with it (handle_payment_order_cancellation).
    update public.payment_orders
    set status = 'canceled',
        canceled_at = now(),
        canceled_by = p_user_id
    where id = v_op.id;

    perform pg_advisory_xact_lock(
      hashtext('payment_orders:' || v_factura.channel_id || ':' || v_pos));
    select coalesce(max(po.numero), 0) + 1 into v_numero
    from public.payment_orders po
    where po.channel_id = v_factura.channel_id and po.punto_venta = v_pos;

    v_new_op := public.create_payment_order(
      v_factura.channel_id,
      v_pos,
      v_numero,
      v_factura.supplier_id,
      v_op.payment_date,
      v_op.total_amount,
      v_op.currency,
      'Pago pasado de la OP '
        || lpad(v_op.punto_venta::text, 4, '0') || '-'
        || lpad(v_op.numero::text, 8, '0')
        || ' al imputar el remito.',
      v_lines,
      jsonb_build_array(
        jsonb_build_object(
          'purchase_invoice_id', v_factura.id,
          'amount_applied', v_op.amount_applied
        )
      ),
      v_op.cotizacion
    );
    update public.payment_orders set created_by = p_user_id where id = v_new_op;
  end loop;

  -- Each remito is credited for what it has open.
  for v_remito in
    select pi.id, pi.channel_id, pi.supplier_id, pi.punto_venta, pi.moneda,
           pi.cotizacion, pi.account_id, pi.cost_center_id
    from public.purchase_invoices pi
    where pi.id = any (p_remito_ids)
    order by pi.fecha, pi.numero
  loop
    -- The remito's own figure: credit other NCs spill on it stays with the
    -- supplier (v_purchase_invoice_open), it is not cancelled by this NC.
    select o.own_open_amount into v_open
    from public.v_purchase_invoice_open o
    where o.supplier_id = v_remito.supplier_id
      and o.channel_id = v_remito.channel_id
      and o.purchase_invoice_id = v_remito.id;
    if v_open <= 0 then
      continue;
    end if;

    perform pg_advisory_xact_lock(
      hashtext('purchase_nc:' || v_remito.supplier_id || ':' || v_remito.punto_venta));
    select coalesce(max(n.numero), 0) + 1 into v_numero
    from public.purchase_invoices n
    where n.supplier_id = v_remito.supplier_id
      and n.kind = 'nc'
      and n.letter is null
      and n.punto_venta = v_remito.punto_venta;

    insert into public.purchase_invoices (
      channel_id, supplier_id, kind, letter, punto_venta, numero, fecha,
      imp_neto, imp_iva, imp_trib, imp_total, moneda, cotizacion, status,
      invoice_origin_id, motivo_nc_nd, imputed_to_id, account_id,
      cost_center_id, created_by
    ) values (
      v_remito.channel_id, v_remito.supplier_id, 'nc', null,
      v_remito.punto_venta, v_numero,
      (now() at time zone 'America/Argentina/Buenos_Aires')::date,
      v_open, 0, 0, v_open, v_remito.moneda, v_remito.cotizacion, 'received',
      v_remito.id, v_motivo, v_factura.id, v_remito.account_id,
      v_remito.cost_center_id, p_user_id
    )
    returning id into v_nc_id;
    v_nc_ids := v_nc_ids || v_nc_id;
  end loop;

  perform set_config('jouve.imputing_purchase', '', true);
  return v_nc_ids;
end;
$$;

revoke all on function public.impute_purchase_remitos(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.impute_purchase_remitos(uuid, uuid[], uuid) to service_role;

-- 6. Aging over the base views ---------------------------------------------------------

-- 20261111205100
create or replace view public.v_aging_documents with (security_invoker = on) as
  with docs as (
  SELECT o.invoice_id,
    o.client_id,
    c.fecha,
    c.kind,
    c.letter,
    c.punto_venta,
    c.numero,
    c.imp_total,
    o.amount_paid + o.amount_opening_applied AS amount_applied,
    o.open_amount,
    CURRENT_DATE - due.due_date AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - due.due_date) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - due.due_date) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - due.due_date) <= 90 THEN '60_90'::text
            ELSE '90_plus'::text
        END AS bucket,
    o.channel_id,
    ch.name AS channel_name,
    ch.is_fiscal AS channel_is_fiscal,
    c.fch_vto_pago AS fch_vto_pago,
    c.moneda AS moneda,
    o.amount_credited_by_nc,
    'invoice'::text AS document_type,
    c.id AS document_id,
    NULL::text AS check_number,
    due.due_date,
    ch.is_segregated AS channel_is_segregated
   FROM public.v_invoice_open o
     JOIN public.invoices c ON c.id = o.invoice_id
     JOIN public.invoicing_channels ch ON ch.id = o.channel_id
     CROSS JOIN LATERAL ( SELECT public.invoice_effective_due_date(c.fecha, c.fch_vto_pago) AS due_date) due
  WHERE o.status = 'emitted'::text AND (o.kind = ANY (ARRAY['factura'::text, 'nd'::text])) AND o.open_amount > 0::numeric
  UNION ALL
  SELECT NULL::uuid AS invoice_id,
    o.client_id,
    o.rejected_on AS fecha,
    'rejected_check'::text AS kind,
    NULL::character(1) AS letter,
    o.punto_venta,
    o.numero,
    o.amount::numeric(15,2) AS imp_total,
    o.amount_settled AS amount_applied,
    o.open_amount,
    CURRENT_DATE - o.rejected_on AS days_overdue,
        CASE
            WHEN (CURRENT_DATE - o.rejected_on) <= 30 THEN '0_30'::text
            WHEN (CURRENT_DATE - o.rejected_on) <= 60 THEN '30_60'::text
            WHEN (CURRENT_DATE - o.rejected_on) <= 90 THEN '60_90'::text
            ELSE '90_plus'::text
        END AS bucket,
    o.channel_id,
    ch.name AS channel_name,
    ch.is_fiscal AS channel_is_fiscal,
    o.rejected_on AS fch_vto_pago,
    CASE WHEN o.currency = 'USD' THEN 'DOL'::text ELSE 'PES'::text END AS moneda,
    0::numeric AS amount_credited_by_nc,
    'rejected_check'::text AS document_type,
    o.check_id AS document_id,
    o.check_number,
    o.rejected_on AS due_date,
    ch.is_segregated AS channel_is_segregated
   FROM v_rejected_check_open o
     JOIN public.invoicing_channels ch ON ch.id = o.channel_id
  WHERE o.open_amount > 0::numeric
  ),
  unlinked AS (
  SELECT n.client_id,
    n.channel_id,
    CASE WHEN COALESCE(n.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END AS currency,
    sum(n.imp_total) AS credit
   FROM invoices n
  WHERE n.kind = 'nc'::text AND n.status = 'emitted'::text AND n.invoice_origin_id IS NULL
    -- An NC up to a client's opening date is inside its opening balance: in
    -- pesos always, in dollars when the opening has a dollar target.
    AND NOT EXISTS (
      SELECT 1 FROM client_opening_balances ob
       WHERE ob.client_id = n.client_id AND n.fecha <= ob.opening_date
         AND (COALESCE(n.moneda, 'PES') NOT IN ('DOL', 'USD') OR ob.target_balance_usd IS NOT NULL))
  GROUP BY n.client_id, n.channel_id, (CASE WHEN COALESCE(n.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END)
  ),
  spread AS (
  SELECT d.*,
    LEAST(d.open_amount, GREATEST(COALESCE(u.credit, 0::numeric) - COALESCE(sum(d.open_amount) OVER (
      PARTITION BY d.client_id, d.channel_id, (CASE WHEN COALESCE(d.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END)
      ORDER BY d.days_overdue DESC, d.fecha, d.document_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric), 0::numeric)) AS credited_unlinked
   FROM docs d
     LEFT JOIN unlinked u ON u.client_id = d.client_id AND u.channel_id = d.channel_id
       AND u.currency = (CASE WHEN COALESCE(d.moneda, 'PES') IN ('DOL', 'USD') THEN 'USD'::text ELSE 'ARS'::text END)
  )
  SELECT s.invoice_id,
    s.client_id,
    s.fecha,
    s.kind,
    s.letter,
    s.punto_venta,
    s.numero,
    s.imp_total,
    s.amount_applied,
    s.open_amount - s.credited_unlinked AS open_amount,
    s.days_overdue,
    s.bucket,
    s.channel_id,
    s.channel_name,
    s.channel_is_fiscal,
    s.fch_vto_pago,
    s.moneda,
    s.amount_credited_by_nc,
    s.document_type,
    s.document_id,
    s.check_number,
    s.credited_unlinked AS amount_credited_unlinked,
    s.due_date,
    s.channel_is_segregated
   FROM spread s
  WHERE s.open_amount - s.credited_unlinked > 0::numeric;


comment on view public.v_aging_documents is
  'Comprobantes (factura/ND) y cheques rechazados de clientes con saldo abierto. open_amount = v_invoice_open.open_amount (imp_total − recibos − saldo inicial − NC con origen − el crédito que le pasan las NC mayores que su origen) − la parte del crédito de las NC sin origen del cliente (mismo canal y moneda, de la más vencida a la más nueva; las NC hasta la fecha de su saldo inicial no, quedan dentro de ese saldo: en pesos siempre, en dólares si tiene objetivo en dólares) que tomó el documento (amount_credited_unlinked). due_date = invoice_effective_due_date (el rechazo para un cheque); days_overdue y bucket cuentan desde ahí.';

revoke all on table public.v_aging_documents from public, anon;
grant select on table public.v_aging_documents to authenticated, service_role;

-- 20261111205100
create or replace view public.v_supplier_aging_documents with (security_invoker = on) as
  with docs as (
  select
    o.purchase_invoice_id,
    o.supplier_id,
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
    o.channel_id,
    ch.name as channel_name,
    ch.is_fiscal as channel_is_fiscal,
    pi.fch_vto_pago,
    pi.moneda,
    'purchase_invoice'::text as document_type,
    pi.id as document_id,
    null::text as check_number,
    ch.is_segregated as channel_is_segregated
  from public.v_purchase_invoice_open o
  join public.purchase_invoices pi on pi.id = o.purchase_invoice_id
  join public.invoicing_channels ch on ch.id = o.channel_id
  where o.status = 'received'
    and o.kind in ('factura', 'nd')
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
    r.check_number,
    ch.is_segregated as channel_is_segregated
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
    s.credited_unlinked as amount_credited_unlinked,
    s.channel_is_segregated
  from spread s
  where s.open_amount - s.credited_unlinked > 0::numeric;


comment on view public.v_supplier_aging_documents is
  'Facturas/ND de compra y cheques entregados rechazados con saldo abierto. open_amount = lo abierto (v_purchase_invoice_open.open_amount: OPs, NC con origen, saldo inicial y el crédito que le pasan las NC mayores que su origen; en un cheque, lo que no cancelaron OPs posteriores) − la parte del crédito de las NC sin origen del proveedor (mismo canal y moneda, de la más vencida a la más nueva) que tomó el documento (amount_credited_unlinked).';

revoke all on table public.v_supplier_aging_documents from public, anon;
grant select on table public.v_supplier_aging_documents to authenticated, service_role;

-- 7. Opening FIFOs over the capacity after the spill -----------------------------------

-- 20261106222124
create or replace function public.apply_client_opening_balance_core(p_client_id uuid, p_opening_date date, p_target_balance numeric, p_notes text, p_user_id uuid, p_import_run_id uuid, p_target_balance_usd numeric DEFAULT NULL::numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum_invoices   numeric(15, 2);
  v_sum_ncs        numeric(15, 2);
  v_sum_receipts   numeric(15, 2);
  v_real_open      numeric(15, 2);
  v_to_settle      numeric(15, 2);
  v_remaining      numeric(15, 2);
  v_inv            record;
  v_capacity       numeric(15, 2);
  v_apply          numeric(15, 2);
  v_dollar         boolean;
  v_target_usd     numeric(15, 2);
  v_settled_usd    numeric(15, 2);
begin
  if p_target_balance is null or p_target_balance < 0 then
    raise exception 'El saldo de apertura no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_target_balance_usd < 0 then
    raise exception 'El saldo de apertura en dólares no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- Without a dollar target the one already set (if any) is applied again.
  select ob.target_balance_usd into v_target_usd
    from public.client_opening_balances ob
   where ob.client_id = p_client_id
     for update;
  v_target_usd := coalesce(p_target_balance_usd, v_target_usd);

  if v_target_usd is null then
    -- The dollars are not adjusted: their allocations up to the cut-off stay.
    delete from public.client_opening_balance_allocations a
     using public.invoices c
     where a.client_id = p_client_id
       and c.id = a.invoice_id
       and (coalesce(c.moneda, 'PES') not in ('DOL', 'USD') or c.fecha > p_opening_date);
    select sum(a.amount_applied) into v_settled_usd
      from public.client_opening_balance_allocations a
     where a.client_id = p_client_id;
  else
    v_settled_usd := 0;
    delete from public.client_opening_balance_allocations where client_id = p_client_id;
  end if;

  select coalesce(sum(c.imp_total), 0) into v_sum_invoices
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind in ('factura', 'nd')
    and coalesce(c.moneda, 'PES') not in ('DOL', 'USD')
    and c.fecha <= p_opening_date;

  select coalesce(sum(c.imp_total), 0) into v_sum_ncs
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind = 'nc'
    and c.invoice_origin_id is not null
    and coalesce(c.moneda, 'PES') not in ('DOL', 'USD')
    and c.fecha <= p_opening_date;

  select coalesce(sum(ra.amount_applied), 0) into v_sum_receipts
  from public.receipt_allocations ra
  join public.receipts r on r.id = ra.receipt_id
  join public.invoices  c on c.id = ra.invoice_id
  where r.status = 'issued'
    and r.receipt_date <= p_opening_date
    and c.client_id = p_client_id
    and coalesce(c.moneda, 'PES') not in ('DOL', 'USD')
    and c.fecha <= p_opening_date;

  v_real_open := v_sum_invoices - v_sum_ncs - v_sum_receipts;
  v_to_settle := greatest(v_real_open - p_target_balance, 0);

  insert into public.client_opening_balances (
    client_id, opening_date, target_balance, total_settled,
    target_balance_usd, total_settled_usd, notes, created_by, import_run_id
  ) values (
    p_client_id, p_opening_date, p_target_balance, v_to_settle,
    v_target_usd, v_settled_usd, p_notes, p_user_id, p_import_run_id
  )
  on conflict (client_id) do update set
    opening_date       = excluded.opening_date,
    target_balance     = excluded.target_balance,
    total_settled      = excluded.total_settled,
    target_balance_usd = excluded.target_balance_usd,
    total_settled_usd  = excluded.total_settled_usd,
    notes              = excluded.notes,
    created_by         = excluded.created_by,
    import_run_id      = excluded.import_run_id,
    created_at         = now();

  -- Pesos, then (with a dollar target) dollars: the same FIFO over what
  -- receipts and NCs leave open, after the credit other NCs spill
  -- (v_invoice_open; this side's allocations were deleted above).
  foreach v_dollar in array (
    case when v_target_usd is null then array[false] else array[false, true] end
  ) loop
    if v_dollar then
      select coalesce(sum(c.imp_total), 0) into v_sum_invoices
      from public.invoices c
      where c.client_id = p_client_id
        and c.status = 'emitted'
        and c.kind in ('factura', 'nd')
        and coalesce(c.moneda, 'PES') in ('DOL', 'USD')
        and c.fecha <= p_opening_date;

      select coalesce(sum(c.imp_total), 0) into v_sum_ncs
      from public.invoices c
      where c.client_id = p_client_id
        and c.status = 'emitted'
        and c.kind = 'nc'
        and c.invoice_origin_id is not null
        and coalesce(c.moneda, 'PES') in ('DOL', 'USD')
        and c.fecha <= p_opening_date;

      select coalesce(sum(ra.amount_applied), 0) into v_sum_receipts
      from public.receipt_allocations ra
      join public.receipts r on r.id = ra.receipt_id
      join public.invoices  c on c.id = ra.invoice_id
      where r.status = 'issued'
        and r.receipt_date <= p_opening_date
        and c.client_id = p_client_id
        and coalesce(c.moneda, 'PES') in ('DOL', 'USD')
        and c.fecha <= p_opening_date;

      v_real_open := v_sum_invoices - v_sum_ncs - v_sum_receipts;
      v_to_settle := greatest(v_real_open - v_target_usd, 0);
    end if;

    v_remaining := v_to_settle;
    for v_inv in
      select c.id, o.open_amount - o.amount_nc_in_flight as capacity
      from public.invoices c
      join public.v_invoice_open o on o.invoice_id = c.id
      where o.client_id = p_client_id
        and c.client_id = p_client_id
        and c.status = 'emitted'
        and c.kind in ('factura', 'nd')
        and (coalesce(c.moneda, 'PES') in ('DOL', 'USD')) = v_dollar
        and c.fecha <= p_opening_date
      order by c.fecha asc, c.numero asc, c.created_at asc
    loop
      exit when v_remaining <= 0;
      v_capacity := greatest(v_inv.capacity, 0);
      if v_capacity = 0 then
        continue;
      end if;
      v_apply := least(v_capacity, v_remaining);
      insert into public.client_opening_balance_allocations (
        client_id, invoice_id, amount_applied
      ) values (
        p_client_id, v_inv.id, v_apply
      );
      v_remaining := v_remaining - v_apply;
    end loop;

    if v_dollar then
      update public.client_opening_balances
         set total_settled_usd = v_to_settle - v_remaining
       where client_id = p_client_id;
    elsif v_remaining > 0 then
      update public.client_opening_balances
         set total_settled = v_to_settle - v_remaining
       where client_id = p_client_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.apply_client_opening_balance_core(uuid, date, numeric, text, uuid, uuid, numeric) from public, anon, authenticated;

-- 20261106222124
create or replace function public.apply_supplier_opening_balance(p_supplier_id uuid, p_opening_date date, p_target_balance numeric, p_notes text DEFAULT NULL::text, p_target_balance_usd numeric DEFAULT NULL::numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum_invoices   numeric(15, 2);
  v_sum_ncs        numeric(15, 2);
  v_sum_payments   numeric(15, 2);
  v_to_settle      numeric(15, 2);
  v_remaining      numeric(15, 2);
  v_inv            record;
  v_apply          numeric(15, 2);
  v_dollar         boolean;
  v_target         numeric(15, 2);
  v_target_usd     numeric(15, 2);
  v_settled_usd    numeric(15, 2);
begin
  if not public.user_has_role(array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_target_balance is null or p_target_balance < 0 then
    raise exception 'El saldo de apertura no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_target_balance_usd < 0 then
    raise exception 'El saldo de apertura en dólares no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- Without a dollar target the one already set (if any) is applied again.
  select ob.target_balance_usd into v_target_usd
    from public.supplier_opening_balances ob
   where ob.supplier_id = p_supplier_id
     for update;
  v_target_usd := coalesce(p_target_balance_usd, v_target_usd);

  if v_target_usd is null then
    -- The dollars are not adjusted: their allocations up to the cut-off stay
    -- (also the ones loaded by hand on 2026-11-06).
    delete from public.supplier_opening_balance_allocations a
     using public.purchase_invoices pi
     where a.supplier_id = p_supplier_id
       and pi.id = a.purchase_invoice_id
       and (coalesce(pi.moneda, 'PES') not in ('DOL', 'USD') or pi.fecha > p_opening_date);
    select sum(a.amount_applied) into v_settled_usd
      from public.supplier_opening_balance_allocations a
     where a.supplier_id = p_supplier_id;
  else
    v_settled_usd := 0;
    delete from public.supplier_opening_balance_allocations where supplier_id = p_supplier_id;
  end if;

  -- The header goes first: the allocations reference it
  -- (supplier_opening_balance_allocations_header_fk, not deferrable).
  -- total_settled is set by the peso pass below.
  insert into public.supplier_opening_balances (
    supplier_id, opening_date, target_balance, total_settled,
    target_balance_usd, total_settled_usd, notes, created_by
  ) values (
    p_supplier_id, p_opening_date, p_target_balance, 0,
    v_target_usd, v_settled_usd, p_notes, auth.uid()
  )
  on conflict (supplier_id) do update set
    opening_date       = excluded.opening_date,
    target_balance     = excluded.target_balance,
    total_settled      = excluded.total_settled,
    target_balance_usd = excluded.target_balance_usd,
    total_settled_usd  = excluded.total_settled_usd,
    notes              = excluded.notes,
    created_by         = excluded.created_by,
    created_at         = now();

  -- Pesos, then (with a dollar target) dollars. Real open = facturas and ND
  -- − NCs − issued payment orders, all up to the cut-off and in the pass's
  -- currency; real open − target is settled FIFO from the oldest invoice
  -- over what payment orders and NCs leave open (v_purchase_invoice_open;
  -- this side's allocations were deleted above).
  foreach v_dollar in array (
    case when v_target_usd is null then array[false] else array[false, true] end
  ) loop
    v_target := case when v_dollar then v_target_usd else p_target_balance end;

    select coalesce(sum(pi.imp_total), 0) into v_sum_invoices
    from public.purchase_invoices pi
    where pi.supplier_id = p_supplier_id
      and pi.status = 'received'
      and pi.kind in ('factura', 'nd')
      and (coalesce(pi.moneda, 'PES') in ('DOL', 'USD')) = v_dollar
      and pi.fecha <= p_opening_date;

    select coalesce(sum(pi.imp_total), 0) into v_sum_ncs
    from public.purchase_invoices pi
    where pi.supplier_id = p_supplier_id
      and pi.status = 'received'
      and pi.kind = 'nc'
      and (coalesce(pi.moneda, 'PES') in ('DOL', 'USD')) = v_dollar
      and pi.fecha <= p_opening_date;

    select coalesce(sum(poa.amount_applied), 0) into v_sum_payments
    from public.payment_order_allocations poa
    join public.payment_orders po on po.id = poa.payment_order_id
    join public.purchase_invoices pi on pi.id = poa.purchase_invoice_id
    where po.status = 'issued'
      and po.payment_date <= p_opening_date
      and pi.supplier_id = p_supplier_id
      and (coalesce(pi.moneda, 'PES') in ('DOL', 'USD')) = v_dollar
      and pi.fecha <= p_opening_date;

    v_to_settle := greatest(v_sum_invoices - v_sum_ncs - v_sum_payments - v_target, 0);

    v_remaining := v_to_settle;
    for v_inv in
      select pi.id, o.open_amount as outstanding
      from public.purchase_invoices pi
      join public.v_purchase_invoice_open o on o.purchase_invoice_id = pi.id
      where o.supplier_id = p_supplier_id
        and pi.supplier_id = p_supplier_id
        and pi.status = 'received'
        and pi.kind in ('factura', 'nd')
        and (coalesce(pi.moneda, 'PES') in ('DOL', 'USD')) = v_dollar
        and pi.fecha <= p_opening_date
        and o.open_amount > 0
      order by pi.fecha asc, pi.numero asc, pi.created_at asc
    loop
      exit when v_remaining <= 0;
      v_apply := least(v_inv.outstanding, v_remaining);
      insert into public.supplier_opening_balance_allocations (
        supplier_id, purchase_invoice_id, amount_applied
      ) values (
        p_supplier_id, v_inv.id, v_apply
      );
      v_remaining := v_remaining - v_apply;
    end loop;

    if v_dollar then
      update public.supplier_opening_balances
         set total_settled_usd = v_to_settle - v_remaining
       where supplier_id = p_supplier_id;
    else
      update public.supplier_opening_balances
         set total_settled = v_to_settle - v_remaining
       where supplier_id = p_supplier_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.apply_supplier_opening_balance(uuid, date, numeric, text, numeric) from public, anon, authenticated;
grant execute on function public.apply_supplier_opening_balance(uuid, date, numeric, text, numeric) to authenticated;
