SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Totals of the Comprobantes and Recibos lists, computed over every row the
-- list filters match (not only the page loaded by infinite scroll). Each
-- function takes the same filters as its list action and returns one row per
-- (bucket, currency): bucket is the day, the week (Monday) or the month of the
-- document date for p_group 'day' / 'week' / 'month', and null otherwise (the
-- grand total). p_types matches the list's "Tipo" filter: 'factura_A',
-- 'factura_B' (a factura of that letter), 'nc', 'nd'.
--
-- documents counts every matching row; total leaves out what never existed
-- economically (cancelled or failed comprobantes, canceled receipts), and a
-- credit note subtracts. Currencies never sum: one row per moneda / currency.
--
-- Security invoker: the comprobantes action calls through the service client
-- after its userCan gate and passes the fiscal scope; the receipts action
-- calls with the user's session, so RLS applies.

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
  p_client_name text default null
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
        filter (where i.status not in ('cancelled', 'failed')),
      0
    ) as total
  from public.invoices i
  join public.clients c on c.id = i.client_id
  where (p_is_fiscal is null or exists (
          select 1 from public.invoicing_channels ch
          where ch.id = i.channel_id and ch.is_fiscal = p_is_fiscal
        ))
    and (p_status is null or i.status = p_status)
    and (p_types is null or (
          case when i.kind = 'factura' then 'factura_' || coalesce(i.letter, '') else i.kind end
        ) = any (p_types))
    and (p_punto_venta is null or i.punto_venta = p_punto_venta)
    and (p_client_id is null or i.client_id = p_client_id)
    and (p_from is null or i.fecha >= p_from)
    and (p_to is null or i.fecha <= p_to)
    and (p_numero is null or i.numero = p_numero)
    and (p_client_name is null or c.legal_name ilike '%' || p_client_name || '%')
  group by 1, 2
  order by 1 desc nulls first, 2
$$;

revoke all on function public.invoice_list_totals(text, boolean, text, text[], integer, uuid, date, date, integer, text) from public, anon;
grant execute on function public.invoice_list_totals(text, boolean, text, text[], integer, uuid, date, date, integer, text) to authenticated, service_role;
comment on function public.invoice_list_totals(text, boolean, text, text[], integer, uuid, date, date, integer, text) is
  'Totales del listado de Comprobantes por día, semana o mes (o total general) con los filtros del listado. NC restan; anulados y fallidos no suman.';

create function public.receipt_list_totals(
  p_group text default null,
  p_is_fiscal boolean default null,
  p_status text default null,
  p_client_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_numero integer default null
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
  where (p_is_fiscal is null or exists (
          select 1 from public.invoicing_channels ch
          where ch.id = r.channel_id and ch.is_fiscal = p_is_fiscal
        ))
    and (p_status is null or r.status = p_status)
    and (p_client_id is null or r.client_id = p_client_id)
    and (p_from is null or r.receipt_date >= p_from)
    and (p_to is null or r.receipt_date <= p_to)
    and (p_numero is null or r.numero = p_numero)
  group by 1, 2
  order by 1 desc nulls first, 2
$$;

revoke all on function public.receipt_list_totals(text, boolean, text, uuid, date, date, integer) from public, anon;
grant execute on function public.receipt_list_totals(text, boolean, text, uuid, date, date, integer) to authenticated, service_role;
comment on function public.receipt_list_totals(text, boolean, text, uuid, date, date, integer) is
  'Totales del listado de Recibos por día, semana o mes (o total general) con los filtros del listado. Anulados no suman.';
