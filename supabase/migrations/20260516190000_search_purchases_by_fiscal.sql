-- K.12 — Filter fiscal/internal en search_purchase_invoices.
--
-- Drop+recreate (cambio de firma). Symmetry con search_suppliers (K.12).

set row_security = off;

drop function if exists public.search_purchase_invoices(text, uuid, text, text, date, date, int, int, text, uuid);

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
  p_exclude_id   uuid default null,
  p_is_fiscal    boolean default null
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
  join public.invoicing_channels ch on ch.id = pi.channel_id
  cross join q
  where
    (p_supplier_id is null or pi.supplier_id = p_supplier_id)
    and (p_channel_id is null or pi.channel_id = p_channel_id)
    and (p_status is null or pi.status = p_status)
    and (p_kind is null or pi.kind = p_kind)
    and (p_exclude_id is null or pi.id <> p_exclude_id)
    and (p_is_fiscal is null or ch.is_fiscal = p_is_fiscal)
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

comment on function public.search_purchase_invoices(text, uuid, text, text, date, date, int, int, text, uuid, boolean) is
  'Buscador paginado. p_is_fiscal=true filtra solo fiscales; false solo internos; null ambos. K.12.';

set row_security = on;
