SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The list and search RPCs leave segregated channels out unless they are
-- asked for one (20261111205000). Bodies copied from their latest
-- definitions; only the channel filter is new.
--
-- 1. search_purchase_invoices (20261103010000) and receipt_list_totals
--    (20261105100002): same signature; without p_channel_id the segregated
--    channels are left out.
-- 2. invoice_list_totals gains p_channel_id; search_clients gains
--    p_channel_id; search_suppliers gains p_channel_id and
--    p_channel_members_only. Without p_channel_id, a party that lives only
--    on a segregated channel (party_in_main_scope) is left out; with it,
--    nothing is hidden unless members-only (parties with a document on that
--    channel, or whose default channel it is).
--
-- Rollback: older code calls the new signatures with named arguments and
-- gets the defaults (the main scope).

create or replace function public.search_purchase_invoices(
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
  updated_at          timestamptz,
  account_id          uuid,
  cost_center_id      uuid
)
language sql
stable
security invoker
set search_path = ''
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
    pi.updated_at,
    pi.account_id,
    pi.cost_center_id
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
    and (p_channel_id is not null or not ch.is_segregated)
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
revoke all on function public.search_purchase_invoices(text, uuid, text, text, date, date, int, int, text, uuid, boolean) from public, anon;
grant execute on function public.search_purchase_invoices(text, uuid, text, text, date, date, int, int, text, uuid, boolean) to authenticated, service_role;

create or replace function public.receipt_list_totals(
  p_group text default null,
  p_is_fiscal boolean default null,
  p_status text default null,
  p_client_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_numero integer default null,
  p_client_name text default null
)
returns table(bucket date, currency text, documents integer, total numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case p_group
      when 'day' then r.receipt_date
      when 'week' then date_trunc('week', r.receipt_date::timestamp)::date
      when 'month' then date_trunc('month', r.receipt_date::timestamp)::date
    end as bucket,
    r.currency,
    count(*)::integer as documents,
    coalesce(sum(r.total_amount) filter (where r.status = 'issued'), 0) as total
  from public.receipts r
  join public.clients c on c.id = r.client_id
  where (p_is_fiscal is null or exists (
          select 1 from public.invoicing_channels ch
          where ch.id = r.channel_id and ch.is_fiscal = p_is_fiscal
        ))
    and public.channel_in_main_scope(r.channel_id)
    and (p_status is null or r.status = p_status)
    and (p_client_id is null or r.client_id = p_client_id)
    and (p_from is null or r.receipt_date >= p_from)
    and (p_to is null or r.receipt_date <= p_to)
    and (p_numero is null or r.numero = p_numero)
    and (p_client_name is null or c.legal_name ilike public.like_contains_pattern(p_client_name))
  group by 1, 2
  order by 1 desc nulls first, 2
$$;
revoke all on function public.receipt_list_totals(text, boolean, text, uuid, date, date, integer, text) from public, anon;
grant execute on function public.receipt_list_totals(text, boolean, text, uuid, date, date, integer, text) to authenticated, service_role;

-- squawk-ignore ban-drop-function
drop function public.invoice_list_totals(text, boolean, text, text[], integer, uuid, date, date, integer, text);

create function public.invoice_list_totals(
  p_group text default null,
  p_is_fiscal boolean default null,
  p_status text default null,
  p_types text[] default null,
  p_punto_venta integer default null,
  p_client_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_numero integer default null,
  p_client_name text default null,
  p_channel_id text default null
)
returns table(bucket date, moneda text, documents integer, total numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case p_group
      when 'day' then i.fecha
      when 'week' then date_trunc('week', i.fecha::timestamp)::date
      when 'month' then date_trunc('month', i.fecha::timestamp)::date
    end as bucket,
    i.moneda,
    count(*)::integer as documents,
    coalesce(
      sum(case when i.kind = 'nc' then -i.imp_total else i.imp_total end)
        filter (where i.status = 'emitted'),
      0
    ) as total
  from public.invoices i
  join public.clients c on c.id = i.client_id
  where (p_is_fiscal is null or exists (
          select 1 from public.invoicing_channels ch
          where ch.id = i.channel_id and ch.is_fiscal = p_is_fiscal
        ))
    and (case when p_channel_id is null then public.channel_in_main_scope(i.channel_id)
              else i.channel_id = p_channel_id end)
    and (p_status is null or i.status = p_status)
    and (p_types is null or (
          case when i.kind = 'factura' then 'factura_' || coalesce(i.letter, '') else i.kind end
        ) = any (p_types))
    and (p_punto_venta is null or i.punto_venta = p_punto_venta)
    and (p_client_id is null or i.client_id = p_client_id)
    and (p_from is null or i.fecha >= p_from)
    and (p_to is null or i.fecha <= p_to)
    and (p_numero is null or i.numero = p_numero)
    and (p_client_name is null or c.legal_name ilike public.like_contains_pattern(p_client_name))
  group by 1, 2
  order by 1 desc nulls first, 2
$$;

comment on function public.invoice_list_totals(text, boolean, text, text[], integer, uuid, date, date, integer, text, text) is
  'Totales del listado de Comprobantes por día, semana o mes (o total general) con los filtros del listado. Suman solo los emitidos (NC restan); la cantidad cuenta todas las filas listadas. El nombre del cliente se busca como en el listado (like_contains_pattern). Sin p_channel_id deja afuera los canales segregados; con él, solo ese canal.';

revoke all on function public.invoice_list_totals(text, boolean, text, text[], integer, uuid, date, date, integer, text, text) from public, anon;
grant execute on function public.invoice_list_totals(text, boolean, text, text[], integer, uuid, date, date, integer, text, text) to authenticated, service_role;

-- squawk-ignore ban-drop-function
drop function public.search_clients(text, boolean, int, int, boolean);

create function public.search_clients(
  p_query        text,
  p_only_active  boolean default true,
  p_offset       int     default 0,
  p_limit        int     default 50,
  p_is_fiscal    boolean default null,
  p_channel_id   text    default null
)
returns setof public.clients
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select lower(coalesce(p_query, '')) as needle
  )
  select c.*
  from public.clients c, q
  where (not p_only_active or c.is_active)
    and (p_is_fiscal is null or c.is_fiscal = p_is_fiscal)
    and (p_channel_id is not null or public.party_in_main_scope('client', c.id))
    and (
      q.needle = ''
      or lower(c.legal_name) like '%' || q.needle || '%'
      or lower(coalesce(c.display_name, '')) like '%' || q.needle || '%'
      or c.cuit like q.needle || '%'
      or lower(c.legal_name) % q.needle
      or lower(coalesce(c.display_name, '')) % q.needle
    )
  order by
    case when q.needle = '' then 0
         else greatest(
           similarity(lower(c.legal_name), q.needle),
           similarity(lower(coalesce(c.display_name, '')), q.needle)
         )
    end desc nulls last,
    c.legal_name asc
  offset greatest(0, coalesce(p_offset, 0))
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.search_clients(text, boolean, int, int, boolean, text) from public, anon;
grant execute on function public.search_clients(text, boolean, int, int, boolean, text) to authenticated, service_role;

-- squawk-ignore ban-drop-function
drop function public.search_suppliers(text, boolean, int, int, uuid, boolean);

create function public.search_suppliers(
  p_query        text,
  p_only_active  boolean default true,
  p_offset       int     default 0,
  p_limit        int     default 50,
  p_category_id  uuid    default null,
  p_is_fiscal    boolean default null,
  p_channel_id   text    default null,
  p_channel_members_only boolean default false
)
returns setof public.suppliers
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select lower(coalesce(p_query, '')) as needle
  )
  select s.*
  from public.suppliers s, q
  where (not p_only_active or s.is_active)
    and (p_category_id is null or s.category_id = p_category_id)
    and (p_is_fiscal is null or s.is_fiscal = p_is_fiscal)
    and (case
           when p_channel_id is null then public.party_in_main_scope('supplier', s.id)
           when coalesce(p_channel_members_only, false) then
             s.default_channel_id = p_channel_id
             or exists (select 1 from public.purchase_invoices pi
                         where pi.supplier_id = s.id and pi.channel_id = p_channel_id)
             or exists (select 1 from public.payment_orders po
                         where po.supplier_id = s.id and po.channel_id = p_channel_id)
           else true
         end)
    and (
      q.needle = ''
      or lower(s.legal_name) like '%' || q.needle || '%'
      or lower(coalesce(s.display_name, '')) like '%' || q.needle || '%'
      or s.cuit like q.needle || '%'
      or lower(s.legal_name) % q.needle
      or lower(coalesce(s.display_name, '')) % q.needle
    )
  order by
    case when q.needle = '' then 0
         else greatest(
           similarity(lower(s.legal_name), q.needle),
           similarity(lower(coalesce(s.display_name, '')), q.needle)
         )
    end desc nulls last,
    s.legal_name asc
  offset greatest(0, coalesce(p_offset, 0))
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.search_suppliers(text, boolean, int, int, uuid, boolean, text, boolean) from public, anon;
grant execute on function public.search_suppliers(text, boolean, int, int, uuid, boolean, text, boolean) to authenticated, service_role;
