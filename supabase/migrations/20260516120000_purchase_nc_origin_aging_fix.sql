-- K.11 — NC del proveedor imputable a factura origen + fix de aging.
--
-- Contexto. El schema de `purchase_invoices` ya tenía `invoice_origin_id`
-- self-fk + `motivo_nc_nd`, pero la UI no exponía el `invoice_origin_id`
-- (sólo pedía el motivo en texto libre) y la vista de aging filtraba por
-- `kind in ('factura', 'nd')` descartando NCs por completo. Resultado:
-- la cuenta corriente (`v_supplier_account_movements`) sí descontaba la
-- NC del saldo total, pero el aging por buckets dejaba la factura origen
-- con saldo abierto inflado.
--
-- Este PR:
--   1. Reescribe `v_supplier_aging_documents` para descontar
--      Σ NC.imp_total con `invoice_origin_id = factura.id` del open_amount.
--   2. Extiende la RPC `search_purchase_invoices` con dos parámetros nuevos
--      (`p_kind` y `p_exclude_id`) para que el picker de origen pueda
--      filtrar candidatos.
--
-- Compat. Las NCs viejas que se cargaron antes de este PR sin
-- `invoice_origin_id` (porque la UI no lo exponía) quedan como movimiento
-- independiente — no las imputamos retroactivamente. La cuenta corriente
-- las sigue mostrando con signed_amount negativo.

set row_security = off;

------------------------------------------------------------------------------
-- 1. Drop dependent views + recreate aging documents with NC netting
------------------------------------------------------------------------------
drop view if exists public.v_supplier_aging;
drop view if exists public.v_supplier_aging_documents;

create view public.v_supplier_aging_documents with (security_invoker = on) as
  select
    pi.id                                    as purchase_invoice_id,
    pi.supplier_id                           as supplier_id,
    pi.fecha                                 as fecha,
    pi.kind                                  as kind,
    pi.letter                                as letter,
    pi.punto_venta                           as punto_venta,
    pi.numero                                as numero,
    pi.imp_total                             as imp_total,
    coalesce(alloc.applied, 0)               as amount_applied,
    coalesce(nc.credited, 0)                 as amount_credited_by_nc,
    (pi.imp_total
       - coalesce(alloc.applied, 0)
       - coalesce(nc.credited, 0))           as open_amount,
    (current_date - pi.fecha)                as days_overdue,
    case
      when (current_date - pi.fecha) <= 30 then '0_30'
      when (current_date - pi.fecha) <= 60 then '30_60'
      when (current_date - pi.fecha) <= 90 then '60_90'
      else '90_plus'
    end                                      as bucket,
    pi.channel_id                            as channel_id,
    ch.name                                  as channel_name,
    ch.is_fiscal                             as channel_is_fiscal
  from public.purchase_invoices pi
  join public.invoicing_channels ch on ch.id = pi.channel_id
  left join (
    select poa.purchase_invoice_id, sum(poa.amount_applied) as applied
    from public.payment_order_allocations poa
    join public.payment_orders po on po.id = poa.payment_order_id
    where po.status = 'issued'
    group by poa.purchase_invoice_id
  ) alloc on alloc.purchase_invoice_id = pi.id
  left join (
    select nc.invoice_origin_id, sum(nc.imp_total) as credited
    from public.purchase_invoices nc
    where nc.kind = 'nc'
      and nc.status = 'received'
      and nc.invoice_origin_id is not null
    group by nc.invoice_origin_id
  ) nc on nc.invoice_origin_id = pi.id
  where pi.status = 'received'
    and pi.kind in ('factura', 'nd')
    and (pi.imp_total
           - coalesce(alloc.applied, 0)
           - coalesce(nc.credited, 0)) > 0;

comment on view public.v_supplier_aging_documents is
  'Facturas + NDs de proveedor con saldo abierto. open_amount descuenta allocations de OPs issued y NCs imputadas vía invoice_origin_id.';

create view public.v_supplier_aging with (security_invoker = on) as
  select
    d.supplier_id                                                        as supplier_id,
    sum(case when d.bucket = '0_30'    then d.open_amount else 0 end)    as bucket_0_30,
    sum(case when d.bucket = '30_60'   then d.open_amount else 0 end)    as bucket_30_60,
    sum(case when d.bucket = '60_90'   then d.open_amount else 0 end)    as bucket_60_90,
    sum(case when d.bucket = '90_plus' then d.open_amount else 0 end)    as bucket_90_plus,
    sum(d.open_amount)                                                   as total_open,
    count(*)                                                             as document_count,
    max(d.days_overdue)                                                  as oldest_days
  from public.v_supplier_aging_documents d
  group by d.supplier_id;

comment on view public.v_supplier_aging is
  'Aging agregado por proveedor. bucket_* > 0 implican deuda nuestra con el proveedor. Permission piggyback en suppliers:read.';

------------------------------------------------------------------------------
-- 2. Extend search_purchase_invoices with p_kind + p_exclude_id
------------------------------------------------------------------------------
-- Drop required: adding params changes the function signature, y
-- `create or replace function` exige firma idéntica.
drop function if exists public.search_purchase_invoices(text, uuid, text, text, date, date, int, int);

create function public.search_purchase_invoices(
  p_query        text default '',
  p_supplier_id  uuid default null,
  p_channel_id   text default null,
  p_status       text default null,
  p_fecha_from   date default null,
  p_fecha_to     date default null,
  p_offset       int  default 0,
  p_limit        int  default 50,
  p_kind         text default null,
  p_exclude_id   uuid default null
)
returns table (
  id                  uuid,
  channel_id          text,
  supplier_id         uuid,
  supplier_legal_name text,
  supplier_cuit       text,
  kind                text,
  letter              char(1),
  punto_venta         int,
  numero              int,
  fecha               date,
  fch_vto_pago        date,
  imp_neto            numeric,
  imp_iva             numeric,
  imp_trib            numeric,
  imp_total           numeric,
  moneda              text,
  cotizacion          numeric,
  cae_proveedor       text,
  cae_vto_proveedor   date,
  status              text,
  invoice_origin_id   uuid,
  motivo_nc_nd        text,
  notes               text,
  created_by          uuid,
  cancelled_at        timestamptz,
  cancelled_by        uuid,
  created_at          timestamptz,
  updated_at          timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select lower(coalesce(p_query, '')) as needle
  )
  select
    pi.id,
    pi.channel_id,
    pi.supplier_id,
    s.legal_name as supplier_legal_name,
    s.cuit as supplier_cuit,
    pi.kind,
    pi.letter,
    pi.punto_venta,
    pi.numero,
    pi.fecha,
    pi.fch_vto_pago,
    pi.imp_neto,
    pi.imp_iva,
    pi.imp_trib,
    pi.imp_total,
    pi.moneda,
    pi.cotizacion,
    pi.cae_proveedor,
    pi.cae_vto_proveedor,
    pi.status,
    pi.invoice_origin_id,
    pi.motivo_nc_nd,
    pi.notes,
    pi.created_by,
    pi.cancelled_at,
    pi.cancelled_by,
    pi.created_at,
    pi.updated_at
  from public.purchase_invoices pi
  join public.suppliers s on s.id = pi.supplier_id
  cross join q
  where
    (p_supplier_id is null or pi.supplier_id = p_supplier_id)
    and (p_channel_id is null or pi.channel_id = p_channel_id)
    and (p_status is null or pi.status = p_status)
    and (p_kind is null or pi.kind = p_kind)
    and (p_exclude_id is null or pi.id <> p_exclude_id)
    and (p_fecha_from is null or pi.fecha >= p_fecha_from)
    and (p_fecha_to is null or pi.fecha <= p_fecha_to)
    and (
      q.needle = ''
      or lower(s.legal_name) like '%' || q.needle || '%'
      or s.cuit like q.needle || '%'
      or cast(pi.numero as text) like '%' || q.needle || '%'
    )
  order by pi.fecha desc, pi.created_at desc
  offset greatest(0, coalesce(p_offset, 0))
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function public.search_purchase_invoices(text, uuid, text, text, date, date, int, int, text, uuid) is
  'Buscador paginado de facturas de compra. p_kind y p_exclude_id sumados en K.11 para el picker de NC origen.';

set row_security = on;
