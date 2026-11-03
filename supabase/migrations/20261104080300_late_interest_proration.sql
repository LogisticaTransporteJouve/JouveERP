SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Mora prorrateada (follow-up de 20261103100100_late_interest): a partial
-- payment in the middle of the charged period lowers the balance from its
-- date on, instead of charging the whole period on today's balance.
--
--   1. late_interest_reductions_after(invoice, from, to): what lowered the
--      comprobante's balance on or after `from`, weighted by the days of
--      [from, to] before it happened: Σ amount × clamp(date − from, 0, days).
--      The reductions are the ones invoice_open_amount subtracts, dated: an
--      issued receipt's allocation (receipt_date) and a live NC on it
--      (fecha). An opening-balance allocation predates every charge and
--      weighs nothing.
--   2. late_interest_candidates (same arguments, one column more):
--      balance_days = days × open balance + the reductions above, i.e. the
--      sum of the daily balance over the charged days. The interest is
--      balance_days × monthly % / 100 / 30 (features/late-interest/lib):
--      with no payment in the period it equals the old figure exactly.
--
-- Rollback: older code ignores balance_days and charges the whole period on
-- the open balance, as before.

create function public.late_interest_reductions_after(
  p_invoice_id uuid,
  p_from       date,
  p_to         date
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select ra.amount_applied as amount, rc.receipt_date as reduced_on
      from public.receipt_allocations ra
      join public.receipts rc on rc.id = ra.receipt_id
     where ra.invoice_id = p_invoice_id
       and rc.status = 'issued'
    union all
    select n.imp_total, n.fecha
      from public.invoices n
     where n.invoice_origin_id = p_invoice_id
       and n.kind = 'nc'
       and n.status in ('draft', 'emitting', 'emitted')
  )
  select coalesce(sum(
           r.amount * least(greatest(r.reduced_on - p_from, 0), greatest(p_to - p_from + 1, 0))
         ), 0)
    from r
$$;

comment on function public.late_interest_reductions_after(uuid, date, date) is
  'Pagos y NC del comprobante ponderados por los días de [from, to] anteriores a cada uno: lo que suma al saldo de hoy para obtener el saldo diario del período.';

revoke all on function public.late_interest_reductions_after(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.late_interest_reductions_after(uuid, date, date)
  to service_role;

-- Same as 20261103100100 plus balance_days. The result type changes, so it
-- is dropped and created again (and granted again) in this transaction, with
-- the same arguments and every old column: older callers keep working.
-- squawk-ignore ban-drop-function
drop function public.late_interest_candidates(date);

create function public.late_interest_candidates(p_as_of date)
returns table (
  invoice_id      uuid,
  client_id       uuid,
  client_name     text,
  channel_id      text,
  channel_is_fiscal boolean,
  kind            text,
  letter          text,
  punto_venta     integer,
  numero          integer,
  fecha           date,
  due_date        date,
  moneda          text,
  open_amount     numeric,
  charged_to      date,
  charge_from     date,
  client_rate     numeric,
  monthly_rate    numeric,
  balance_days    numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.invoice_id,
         d.client_id,
         cl.legal_name,
         d.channel_id,
         d.channel_is_fiscal,
         d.kind,
         d.letter::text,
         d.punto_venta,
         d.numero,
         d.fecha,
         coalesce(d.fch_vto_pago, d.fecha),
         d.moneda,
         d.open_amount,
         lc.charged_to,
         cf.charge_from,
         cl.late_interest_monthly_rate,
         coalesce(cl.late_interest_monthly_rate,
                  (select (s.value #>> '{}')::numeric
                     from public.finance_settings s
                    where s.key = 'late_interest_monthly_rate')),
         greatest(p_as_of - cf.charge_from + 1, 0) * d.open_amount
           + public.late_interest_reductions_after(d.invoice_id, cf.charge_from, p_as_of)
    from public.v_aging_documents d
    join public.clients cl on cl.id = d.client_id
    left join lateral (
      select max(c.period_to) as charged_to
        from public.late_interest_charges c
       where c.invoice_id = d.invoice_id
         and public.late_interest_charge_is_live(c)
    ) lc on true
    cross join lateral (
      select greatest(coalesce(d.fch_vto_pago, d.fecha), coalesce(lc.charged_to, d.fecha)) + 1
               as charge_from
    ) cf
   where d.document_type = 'invoice'
     and d.open_amount > 0
     and coalesce(d.fch_vto_pago, d.fecha) < p_as_of
     and not exists (select 1 from public.late_interest_charges x
                      where x.nd_invoice_id = d.invoice_id)
   order by cl.legal_name, coalesce(d.fch_vto_pago, d.fecha), d.invoice_id
$$;

revoke all on function public.late_interest_candidates(date) from public, anon, authenticated;
grant execute on function public.late_interest_candidates(date) to service_role;
