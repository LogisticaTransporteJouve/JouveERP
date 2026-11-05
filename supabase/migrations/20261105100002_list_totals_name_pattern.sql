SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W14 · S1 F1: the Comprobantes and Recibos totals match a client
-- name the way their lists do.
--
-- The lists filter clients.legal_name with containsPattern
-- (lib/supabase/like-pattern.ts): the user's %, _ and \ are taken literally
-- and * matches any one character. invoice_list_totals and
-- receipt_list_totals put the raw term between % instead, so `100%` summed
-- every name with «100», and `Jouve*` summed nothing.
--
-- like_contains_pattern builds the lists' pattern from the raw term, so both
-- RPCs keep their signatures and every caller (this code, older code after a
-- rollback) keeps passing the term as typed. Bodies as their latest
-- definitions (invoice_list_totals 20261104100100, receipt_list_totals
-- 20261101083947) apart from the name filter.

-- Same rule as containsPattern: escape \, % and _, then * is one character.
create function public.like_contains_pattern(p_search text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%'
    || replace(
         replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_'),
         '*', '_')
    || '%';
$$;

comment on function public.like_contains_pattern(text) is
  'Patrón ilike «contiene» de una búsqueda, como containsPattern: %, _ y \ literales, * es un carácter cualquiera.';

revoke all on function public.like_contains_pattern(text) from public, anon, authenticated;
grant execute on function public.like_contains_pattern(text) to authenticated, service_role;

create or replace function public.invoice_list_totals(
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
        filter (where i.status = 'emitted'),
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
    and (p_client_name is null or c.legal_name ilike public.like_contains_pattern(p_client_name))
  group by 1, 2
  order by 1 desc nulls first, 2
$$;

comment on function public.invoice_list_totals(text, boolean, text, text[], integer, uuid, date, date, integer, text) is
  'Totales del listado de Comprobantes por día, semana o mes (o total general) con los filtros del listado. Suman solo los emitidos (NC restan); la cantidad cuenta todas las filas listadas. El nombre del cliente se busca como en el listado (like_contains_pattern).';

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
    and (p_status is null or r.status = p_status)
    and (p_client_id is null or r.client_id = p_client_id)
    and (p_from is null or r.receipt_date >= p_from)
    and (p_to is null or r.receipt_date <= p_to)
    and (p_numero is null or r.numero = p_numero)
    and (p_client_name is null or c.legal_name ilike public.like_contains_pattern(p_client_name))
  group by 1, 2
  order by 1 desc nulls first, 2
$$;

comment on function public.receipt_list_totals(text, boolean, text, uuid, date, date, integer, text) is
  'Totales del listado de Recibos por día, semana o mes (o total general) con los filtros del listado. Anulados no suman. El nombre del cliente se busca como en el listado (like_contains_pattern).';
