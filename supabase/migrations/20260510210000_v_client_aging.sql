-- F.7.b — Aging buckets per cliente.
--
-- Dos vistas de solo lectura sobre comprobantes + receipt_allocations:
--
--   * v_aging_documents — un row por factura/ND emitida con saldo abierto
--     (imp_total - Σ allocations de recibos issued). Incluye fiscal e
--     interno: el saldo del cliente es del cliente, no de un canal.
--
--   * v_client_aging   — agregado por cliente con totales por bucket
--     (0-30 / 30-60 / 60-90 / 90+ días desde fecha del comprobante).
--
-- Notas de diseño:
--   * Solo facturas y NDs entran al aging. Las NCs son crédito al cliente
--     y se manejan al nivel cuenta corriente, no en el aging report
--     (matching FIFO se delega al ojo del operador por ahora).
--   * Allocations de recibos canceled NO descuentan: solo `r.status = 'issued'`.
--   * `current_date - c.fecha` se evalúa en cada SELECT — la vista no se
--     materializa, así el aging "envejece" sin tocar nada.

set row_security = off;

create or replace view public.v_aging_documents as
  select
    c.id                                     as comprobante_id,
    c.client_id                              as client_id,
    c.fecha                                  as fecha,
    c.kind                                   as kind,
    c.letter                                 as letter,
    c.punto_venta                            as punto_venta,
    c.numero                                 as numero,
    c.imp_total                              as imp_total,
    coalesce(alloc.applied, 0)               as amount_applied,
    (c.imp_total - coalesce(alloc.applied, 0)) as open_amount,
    (current_date - c.fecha)                 as days_overdue,
    case
      when (current_date - c.fecha) <= 30 then '0_30'
      when (current_date - c.fecha) <= 60 then '30_60'
      when (current_date - c.fecha) <= 90 then '60_90'
      else '90_plus'
    end                                      as bucket,
    c.channel_id                             as channel_id,
    ch.name                                  as channel_name,
    ch.is_fiscal                             as channel_is_fiscal
  from public.comprobantes c
  join public.invoicing_channels ch on ch.id = c.channel_id
  left join (
    select ra.comprobante_id, sum(ra.amount_applied) as applied
    from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
    where r.status = 'issued'
    group by ra.comprobante_id
  ) alloc on alloc.comprobante_id = c.id
  where c.status = 'emitted'
    and c.kind in ('factura', 'nd')
    and (c.imp_total - coalesce(alloc.applied, 0)) > 0;

comment on view public.v_aging_documents is
  'Facturas + NDs emitidas con saldo abierto, clasificadas por antigüedad. open_amount = imp_total - allocations de recibos issued.';

create or replace view public.v_client_aging as
  select
    d.client_id                                                          as client_id,
    sum(case when d.bucket = '0_30'    then d.open_amount else 0 end)    as bucket_0_30,
    sum(case when d.bucket = '30_60'   then d.open_amount else 0 end)    as bucket_30_60,
    sum(case when d.bucket = '60_90'   then d.open_amount else 0 end)    as bucket_60_90,
    sum(case when d.bucket = '90_plus' then d.open_amount else 0 end)    as bucket_90_plus,
    sum(d.open_amount)                                                   as total_open,
    count(*)                                                             as document_count,
    max(d.days_overdue)                                                  as oldest_days
  from public.v_aging_documents d
  group by d.client_id;

comment on view public.v_client_aging is
  'Aging agregado por cliente. bucket_* > 0 implican saldo deudor. El owner lee aging:read (clients:read).';

set row_security = on;
