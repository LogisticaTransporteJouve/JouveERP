SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Purchases: one open amount and the guards around it
-- (audit 2026-10-31, compras S2, S3, S5 and minors).
--
--   * v_purchase_invoice_open gains supplier_id, channel_id, invoice_origin_id
--     and moneda (appended), so the pending list and the account statement
--     read open_amount from it instead of recomputing it.
--   * guard_payment_order_allocation checks against open_amount (OPs, NCs and
--     the opening balance), keeps the FOR UPDATE on the purchase, and rejects
--     an OP in another currency or a document that is not a received
--     factura/ND.
--   * A new NC/ND de compra needs its origin. A trigger, not a CHECK: existing
--     NCs loaded without origin stay valid and editable.
--   * v_supplier_aging / v_supplier_aging_by_scope subtract those NCs without
--     origin at supplier level, from the oldest bucket forward, per currency.
--   * A received purchase with OPs, opening-balance allocations or NC/ND
--     against it can't be cancelled.
--   * A purchase in a foreign currency needs a cotización > 1 on insert, or
--     when moneda/cotización change.

create or replace view public.v_purchase_invoice_open
with (security_invoker = on) as
select
  pi.id as purchase_invoice_id,
  pi.status,
  pi.kind,
  pi.imp_total,
  coalesce(alloc.applied, 0)   as amount_paid,
  coalesce(nc.credited, 0)     as amount_credited_by_nc,
  coalesce(opening.applied, 0) as amount_opening_applied,
  pi.imp_total - coalesce(alloc.applied, 0) - coalesce(nc.credited, 0) - coalesce(opening.applied, 0) as open_amount,
  pi.supplier_id,
  pi.channel_id,
  pi.invoice_origin_id,
  pi.moneda
from public.purchase_invoices pi
left join (
  select poa.purchase_invoice_id, sum(poa.amount_applied) as applied
    from public.payment_order_allocations poa
    join public.payment_orders po on po.id = poa.payment_order_id
   where po.status = 'issued'
   group by poa.purchase_invoice_id
) alloc on alloc.purchase_invoice_id = pi.id
left join (
  select nc_1.invoice_origin_id, sum(nc_1.imp_total) as credited
    from public.purchase_invoices nc_1
   where nc_1.kind = 'nc' and nc_1.status = 'received' and nc_1.invoice_origin_id is not null
   group by nc_1.invoice_origin_id
) nc on nc.invoice_origin_id = pi.id
left join (
  select soba.purchase_invoice_id, soba.amount_applied as applied
    from public.supplier_opening_balance_allocations soba
) opening on opening.purchase_invoice_id = pi.id;

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

  select o.open_amount into v_open
    from public.v_purchase_invoice_open o
   where o.purchase_invoice_id = new.purchase_invoice_id;
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

create or replace function public.guard_purchase_nc_nd_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind in ('nc', 'nd') and new.invoice_origin_id is null
     and (tg_op = 'INSERT'
          or old.kind is distinct from new.kind
          or old.invoice_origin_id is not null) then
    raise exception 'Una nota de crédito o débito de compra necesita el comprobante de origen'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_purchase_nc_nd_origin() from public, anon, authenticated;

create trigger purchase_invoices_nc_nd_origin
  before insert or update of kind, invoice_origin_id on public.purchase_invoices
  for each row execute function public.guard_purchase_nc_nd_origin();

create or replace function public.guard_purchase_invoice_cotizacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.moneda, 'PES') <> 'PES'
     and coalesce(new.cotizacion, 0) <= 1
     and (tg_op = 'INSERT'
          or new.moneda is distinct from old.moneda
          or new.cotizacion is distinct from old.cotizacion) then
    raise exception 'Cargá la cotización del dólar (tiene que ser mayor a 1)'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_purchase_invoice_cotizacion() from public, anon, authenticated;

create trigger purchase_invoices_cotizacion
  before insert or update of moneda, cotizacion on public.purchase_invoices
  for each row execute function public.guard_purchase_invoice_cotizacion();

create or replace function public.guard_cancel_purchase_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.payment_order_allocations poa
      join public.payment_orders po on po.id = poa.payment_order_id
     where poa.purchase_invoice_id = old.id
       and po.status = 'issued'
  ) then
    raise exception 'La factura tiene órdenes de pago imputadas. Anulá esas órdenes antes de anularla.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if exists (
    select 1 from public.supplier_opening_balance_allocations soba
     where soba.purchase_invoice_id = old.id
  ) then
    raise exception 'La factura está saldada por el saldo inicial del proveedor. Recalculá el saldo inicial antes de anularla.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if exists (
    select 1 from public.purchase_invoices n
     where n.invoice_origin_id = old.id
       and n.status = 'received'
  ) then
    raise exception 'La factura tiene notas de crédito o débito cargadas. Anulá esas notas antes de anularla.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_cancel_purchase_invoice() from public, anon, authenticated;

create trigger purchase_invoices_cancel_guard
  before update of status on public.purchase_invoices
  for each row
  when (old.status = 'received' and new.status = 'cancelled')
  execute function public.guard_cancel_purchase_invoice();

-- Spreads a credit over the aging buckets from the oldest forward. What the
-- buckets can't absorb is dropped: the aging shows what is owed, never < 0.
create or replace function public.aging_apply_credit(
  p_b0 numeric, p_b30 numeric, p_b60 numeric, p_b90 numeric, p_credit numeric
)
returns table (b0 numeric, b30 numeric, b60 numeric, b90 numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_left numeric := greatest(coalesce(p_credit, 0), 0);
  v_used numeric;
begin
  v_used := least(p_b90, v_left); b90 := p_b90 - v_used; v_left := v_left - v_used;
  v_used := least(p_b60, v_left); b60 := p_b60 - v_used; v_left := v_left - v_used;
  v_used := least(p_b30, v_left); b30 := p_b30 - v_used; v_left := v_left - v_used;
  v_used := least(p_b0,  v_left); b0  := p_b0  - v_used;
  return next;
end;
$$;

revoke all on function public.aging_apply_credit(numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.aging_apply_credit(numeric, numeric, numeric, numeric, numeric) to authenticated, service_role;

create or replace view public.v_supplier_aging
with (security_invoker = on) as
with docs as (
  select
    d.supplier_id,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '0_30'), 0)    as ars_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '30_60'), 0)   as ars_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '60_90'), 0)   as ars_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as ars_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '0_30'), 0)        as usd_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '30_60'), 0)       as usd_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '60_90'), 0)       as usd_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '90_plus'), 0)     as usd_90_plus,
    count(*) as document_count,
    max(d.days_overdue) as oldest_days
  from public.v_supplier_aging_documents d
  group by d.supplier_id
), credits as (
  select
    pi.supplier_id,
    coalesce(sum(pi.imp_total) filter (where coalesce(pi.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars,
    coalesce(sum(pi.imp_total) filter (where coalesce(pi.moneda, 'PES') in ('DOL', 'USD')), 0)     as usd
  from public.purchase_invoices pi
  where pi.kind = 'nc' and pi.status = 'received' and pi.invoice_origin_id is null
  group by pi.supplier_id
)
select
  d.supplier_id,
  a.b0  as ars_bucket_0_30,
  a.b30 as ars_bucket_30_60,
  a.b60 as ars_bucket_60_90,
  a.b90 as ars_bucket_90_plus,
  a.b0 + a.b30 + a.b60 + a.b90 as ars_total_open,
  u.b0  as usd_bucket_0_30,
  u.b30 as usd_bucket_30_60,
  u.b60 as usd_bucket_60_90,
  u.b90 as usd_bucket_90_plus,
  u.b0 + u.b30 + u.b60 + u.b90 as usd_total_open,
  d.document_count,
  d.oldest_days
from docs d
left join credits c on c.supplier_id = d.supplier_id
cross join lateral public.aging_apply_credit(d.ars_0_30, d.ars_30_60, d.ars_60_90, d.ars_90_plus, c.ars) a
cross join lateral public.aging_apply_credit(d.usd_0_30, d.usd_30_60, d.usd_60_90, d.usd_90_plus, c.usd) u;

create or replace view public.v_supplier_aging_by_scope
with (security_invoker = on) as
with docs as (
  select
    d.supplier_id,
    d.channel_is_fiscal,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '0_30'), 0)    as ars_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '30_60'), 0)   as ars_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '60_90'), 0)   as ars_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') not in ('DOL', 'USD') and d.bucket = '90_plus'), 0) as ars_90_plus,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '0_30'), 0)        as usd_0_30,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '30_60'), 0)       as usd_30_60,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '60_90'), 0)       as usd_60_90,
    coalesce(sum(d.open_amount) filter (where coalesce(d.moneda, 'PES') in ('DOL', 'USD') and d.bucket = '90_plus'), 0)     as usd_90_plus,
    count(*) as document_count,
    max(d.days_overdue) as oldest_days
  from public.v_supplier_aging_documents d
  group by d.supplier_id, d.channel_is_fiscal
), credits as (
  select
    pi.supplier_id,
    ch.is_fiscal,
    coalesce(sum(pi.imp_total) filter (where coalesce(pi.moneda, 'PES') not in ('DOL', 'USD')), 0) as ars,
    coalesce(sum(pi.imp_total) filter (where coalesce(pi.moneda, 'PES') in ('DOL', 'USD')), 0)     as usd
  from public.purchase_invoices pi
  join public.invoicing_channels ch on ch.id = pi.channel_id
  where pi.kind = 'nc' and pi.status = 'received' and pi.invoice_origin_id is null
  group by pi.supplier_id, ch.is_fiscal
)
select
  d.supplier_id,
  d.channel_is_fiscal,
  a.b0  as ars_bucket_0_30,
  a.b30 as ars_bucket_30_60,
  a.b60 as ars_bucket_60_90,
  a.b90 as ars_bucket_90_plus,
  a.b0 + a.b30 + a.b60 + a.b90 as ars_total_open,
  u.b0  as usd_bucket_0_30,
  u.b30 as usd_bucket_30_60,
  u.b60 as usd_bucket_60_90,
  u.b90 as usd_bucket_90_plus,
  u.b0 + u.b30 + u.b60 + u.b90 as usd_total_open,
  d.document_count,
  d.oldest_days
from docs d
left join credits c on c.supplier_id = d.supplier_id and c.is_fiscal = d.channel_is_fiscal
cross join lateral public.aging_apply_credit(d.ars_0_30, d.ars_30_60, d.ars_60_90, d.ars_90_plus, c.ars) a
cross join lateral public.aging_apply_credit(d.usd_0_30, d.usd_30_60, d.usd_60_90, d.usd_90_plus, c.usd) u;
