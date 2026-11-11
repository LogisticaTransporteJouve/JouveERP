SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The result of a segregated channel, for the «Resumen» of its menu section.
-- Resultado de gestión leaves segregated channels out (20261111205300), so
-- this is the only place their result shows outside the legal books.
--
-- channel_summary(channel, from, to): one row per month of the range, from
-- the journal entries of the channel: sales = net credit on result-positive
-- accounts, costs = net debit on result-negative accounts, margin = sales −
-- costs; payments = issued payment orders in pesos (dollars at the order's
-- rate, else the day's); pending_usd = dollar orders without a rate, never
-- summed into payments. Only the gated server action calls it, with the
-- service client.

create function public.channel_summary(p_channel_id text, p_from date, p_to date)
returns table (
  month       text,
  sales       numeric,
  costs       numeric,
  margin      numeric,
  payments    numeric,
  pending_usd numeric
)
language sql
stable
set search_path = ''
as $$
  with months as (
    select to_char(m, 'YYYY-MM') as month
      from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
  ),
  books as (
    select je.accrual_period as month,
           coalesce(sum(l.credit - l.debit) filter (where a.account_type = 'resultado_positivo'), 0) as sales,
           coalesce(sum(l.debit - l.credit) filter (where a.account_type = 'resultado_negativo'), 0) as costs
      from public.journal_entries je
      join public.journal_entry_lines l on l.journal_entry_id = je.id
      join public.chart_of_accounts a on a.id = l.chart_of_accounts_id
     where je.channel_id = p_channel_id
       and je.accrual_period between to_char(p_from, 'YYYY-MM') and to_char(p_to, 'YYYY-MM')
     group by je.accrual_period
  ),
  orders as (
    select to_char(po.payment_date, 'YYYY-MM') as month,
           po.total_amount,
           case when po.currency = 'USD'
                then coalesce(nullif(po.cotizacion, 0), public.get_exchange_rate('USD', po.payment_date))
                else 1 end as rate
      from public.payment_orders po
     where po.channel_id = p_channel_id
       and po.status = 'issued'
       and po.payment_date between p_from and p_to
  ),
  paid as (
    select o.month,
           coalesce(round(sum(o.total_amount * o.rate) filter (where o.rate is not null), 2), 0) as payments,
           coalesce(sum(o.total_amount) filter (where o.rate is null), 0) as pending_usd
      from orders o
     group by o.month
  )
  select m.month,
         coalesce(b.sales, 0),
         coalesce(b.costs, 0),
         coalesce(b.sales, 0) - coalesce(b.costs, 0),
         coalesce(p.payments, 0),
         coalesce(p.pending_usd, 0)
    from months m
    left join books b on b.month = m.month
    left join paid p on p.month = m.month
   order by m.month;
$$;

comment on function public.channel_summary(text, date, date) is
  'Resultado mensual de un canal desde sus asientos (ventas, costos, margen) y sus órdenes de pago emitidas en pesos (pending_usd: OP en dólares sin cotización). Lo llama solo la acción con permiso management:read.';

revoke all on function public.channel_summary(text, date, date) from public, anon, authenticated;
grant execute on function public.channel_summary(text, date, date) to service_role;
