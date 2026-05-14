-- K.2 — Facturas de compra (header-only).
--
-- Diferencias clave con `invoices` (sales):
--   * No emitimos: el CAE viene del proveedor, lo guardamos como dato pero
--     no llamamos a AFIP ni validamos. Es información, no flow.
--   * Sin items / IVA discriminado en esta fase. Header con imp_neto +
--     imp_iva + imp_trib + imp_total alcanza para libro IVA Compras y para
--     que las OPs (K.3) sepan cuánto pagar.
--   * Channel sigue siendo nullable-aware: el comprobante puede entrar al
--     circuito fiscal (Jouve fiscal / DZ fiscal) o al interno.
--   * Numeración la pone el proveedor: no enforce de correlativo nuestro,
--     pero unique por (supplier_id, kind, letter, punto_venta, numero) para
--     evitar cargar dos veces el mismo comprobante.

set row_security = off;

create table public.purchase_invoices (
  id                       uuid primary key default gen_random_uuid(),

  -- Routing
  channel_id               text        not null references public.invoicing_channels (id) on delete restrict,
  supplier_id              uuid        not null references public.suppliers (id)          on delete restrict,
  kind                     text        not null check (kind in ('factura', 'nc', 'nd')),
  letter                   char(1)              check (letter in ('A', 'B', 'C')),
  punto_venta              int         not null check (punto_venta between 1 and 99999),
  numero                   int         not null check (numero >= 1),

  -- Dates
  fecha                    date        not null,
  fch_vto_pago             date,

  -- Amounts (header only en esta fase)
  imp_neto                 numeric(15,2) not null default 0,
  imp_iva                  numeric(15,2) not null default 0,
  imp_trib                 numeric(15,2) not null default 0,
  imp_total                numeric(15,2) not null,

  -- Currency
  moneda                   text        not null default 'PES',
  cotizacion               numeric(10,4) not null default 1,

  -- Provider-side AFIP info (informativo, no validamos)
  cae_proveedor            text,
  cae_vto_proveedor        date,

  -- Workflow
  status                   text        not null default 'received'
                                       check (status in ('received', 'cancelled')),

  -- NC/ND: opcionalmente apunta al comprobante origen del proveedor
  invoice_origin_id        uuid        references public.purchase_invoices (id) on delete restrict,
  motivo_nc_nd             text,

  notes                    text,

  -- Auditing
  created_by               uuid        references auth.users (id) on delete set null,
  cancelled_at             timestamptz,
  cancelled_by             uuid        references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- No cargar dos veces el mismo comprobante del proveedor. letter va
  -- coalescido a '' por la misma razón que en sales (NULL distinct semantics).
  constraint purchase_invoices_unique_supplier_numero unique
    (supplier_id, kind, letter, punto_venta, numero),

  -- Estado consistencia: si está cancelled, debe tener fecha + actor.
  constraint purchase_invoices_cancel_consistency check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status <> 'cancelled' and cancelled_at is null)
  )
);

comment on table public.purchase_invoices is
  'Purchase invoices received from suppliers. Header-only en esta fase. No AFIP emission — we record what the supplier sent us.';

create index purchase_invoices_supplier_idx     on public.purchase_invoices (supplier_id);
create index purchase_invoices_channel_idx      on public.purchase_invoices (channel_id);
create index purchase_invoices_fecha_idx        on public.purchase_invoices (fecha desc);
create index purchase_invoices_status_idx       on public.purchase_invoices (status);
create index purchase_invoices_invoice_origin_idx on public.purchase_invoices (invoice_origin_id) where invoice_origin_id is not null;

------------------------------------------------------------------------------
-- 2. RLS
------------------------------------------------------------------------------
alter table public.purchase_invoices enable row level security;

create policy "Authenticated users can view purchase invoices"
  on public.purchase_invoices for select
  to authenticated
  using (true);

create policy "Owners, admins and finance can insert purchase invoices"
  on public.purchase_invoices for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "Owners, admins and finance can update purchase invoices"
  on public.purchase_invoices for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

-- Hard delete bloqueado por RLS. Cancelar = update con status=cancelled.

------------------------------------------------------------------------------
-- 3. updated_at trigger
------------------------------------------------------------------------------
create trigger purchase_invoices_set_updated_at
  before update on public.purchase_invoices
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 4. search_purchase_invoices RPC
------------------------------------------------------------------------------
create or replace function public.search_purchase_invoices(
  p_query        text default '',
  p_supplier_id  uuid default null,
  p_channel_id   text default null,
  p_status       text default null,
  p_fecha_from   date default null,
  p_fecha_to     date default null,
  p_offset       int  default 0,
  p_limit        int  default 50
)
returns table (
  id                uuid,
  channel_id        text,
  supplier_id       uuid,
  supplier_legal_name text,
  supplier_cuit     text,
  kind              text,
  letter            char(1),
  punto_venta       int,
  numero            int,
  fecha             date,
  fch_vto_pago      date,
  imp_neto          numeric,
  imp_iva           numeric,
  imp_trib          numeric,
  imp_total         numeric,
  moneda            text,
  cotizacion        numeric,
  cae_proveedor     text,
  cae_vto_proveedor date,
  status            text,
  invoice_origin_id uuid,
  motivo_nc_nd      text,
  notes             text,
  created_by        uuid,
  cancelled_at      timestamptz,
  cancelled_by      uuid,
  created_at        timestamptz,
  updated_at        timestamptz
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

comment on function public.search_purchase_invoices(text, uuid, text, text, date, date, int, int) is
  'Listado paginado de facturas de compra con filtros. Honra RLS via security invoker.';

set row_security = on;
