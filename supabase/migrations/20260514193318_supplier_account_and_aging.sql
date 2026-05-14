-- K.5 — Cuenta corriente + aging para proveedores (espejo F.7).
--
-- Tres vistas read-only:
--
--   * v_supplier_account_movements — UNION ALL de purchase_invoices y
--     payment_orders del proveedor. Convención de signo:
--       * signed_amount > 0 → NOSOTROS DEBEMOS (factura compra, ND).
--       * signed_amount < 0 → NOS DEBEN A NOSOTROS o LE PAGAMOS
--                              (NC del proveedor, payment_order).
--     Solo `received` para purchase_invoices y `issued` para payment_orders.
--
--   * v_supplier_aging_documents — un row por purchase_invoice (factura/ND)
--     con saldo abierto = imp_total - Σ allocations de OPs issued.
--
--   * v_supplier_aging — agregado por proveedor con buckets 0-30 / 30-60 /
--     60-90 / 90+ desde la fecha de la factura.

set row_security = off;

------------------------------------------------------------------------------
-- 1. Account movements (feed cronológico unificado)
------------------------------------------------------------------------------
create or replace view public.v_supplier_account_movements with (security_invoker = on) as
  select
    'purchase_invoice'::text             as source_type,
    pi.id                                as source_id,
    pi.supplier_id                       as supplier_id,
    pi.fecha                             as movement_date,
    pi.created_at                        as created_at,
    pi.kind                              as kind,
    pi.letter                            as letter,
    pi.punto_venta                       as punto_venta,
    pi.numero                            as numero,
    case
      when pi.kind = 'nc' then -1 * pi.imp_total
      else pi.imp_total
    end                                  as signed_amount,
    pi.imp_total                         as gross_amount,
    pi.channel_id                        as channel_id,
    ch.division                          as channel_division,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    pi.status                            as status
  from public.purchase_invoices pi
  join public.invoicing_channels ch on ch.id = pi.channel_id
  where pi.status = 'received'

  union all

  select
    'payment_order'::text                as source_type,
    po.id                                as source_id,
    po.supplier_id                       as supplier_id,
    po.payment_date                      as movement_date,
    po.created_at                        as created_at,
    'payment_order'::text                as kind,
    null::text                           as letter,
    po.punto_venta                       as punto_venta,
    po.numero                            as numero,
    -1 * po.total_amount                 as signed_amount,
    po.total_amount                      as gross_amount,
    po.channel_id                        as channel_id,
    ch.division                          as channel_division,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    po.status                            as status
  from public.payment_orders po
  join public.invoicing_channels ch on ch.id = po.channel_id
  where po.status = 'issued';

comment on view public.v_supplier_account_movements is
  'Feed cronológico de purchase_invoices y payment_orders por proveedor. signed_amount > 0 = les debemos; < 0 = NC del proveedor o pago nuestro.';

------------------------------------------------------------------------------
-- 2. Aging documents (un row por factura abierta)
------------------------------------------------------------------------------
create or replace view public.v_supplier_aging_documents with (security_invoker = on) as
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
    (pi.imp_total - coalesce(alloc.applied, 0)) as open_amount,
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
  where pi.status = 'received'
    and pi.kind in ('factura', 'nd')
    and (pi.imp_total - coalesce(alloc.applied, 0)) > 0;

comment on view public.v_supplier_aging_documents is
  'Facturas + NDs de proveedor con saldo abierto, clasificadas por antigüedad. open_amount = imp_total - allocations de OPs issued.';

------------------------------------------------------------------------------
-- 3. Aging agregado por proveedor
------------------------------------------------------------------------------
create or replace view public.v_supplier_aging with (security_invoker = on) as
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

set row_security = on;
