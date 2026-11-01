SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The Recibos list search box now matches the receipt number (digits) or the
-- client's legal name, like Comprobantes: receipt_list_totals takes the name
-- too, so the day / week / month subtotals follow the same search.

-- The new parameter has a default and PostgREST matches named arguments, so a
-- caller that omits it (code from before this migration, or a rollback to it)
-- still resolves to the new function.
-- squawk-ignore ban-drop-function
drop function public.receipt_list_totals(text, boolean, text, uuid, date, date, integer);

create function public.receipt_list_totals(
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
    and (p_client_name is null or c.legal_name ilike '%' || p_client_name || '%')
  group by 1, 2
  order by 1 desc nulls first, 2
$$;

revoke all on function public.receipt_list_totals(text, boolean, text, uuid, date, date, integer, text) from public, anon;
grant execute on function public.receipt_list_totals(text, boolean, text, uuid, date, date, integer, text) to authenticated, service_role;
comment on function public.receipt_list_totals(text, boolean, text, uuid, date, date, integer, text) is
  'Totales del listado de Recibos por día, semana o mes (o total general) con los filtros del listado. Anulados no suman.';
