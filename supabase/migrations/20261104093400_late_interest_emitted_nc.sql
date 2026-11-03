SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W1 · S2 F9: the late-interest proration added back NCs that the
-- open balance never subtracted. late_interest_candidates computes
-- balance_days = days × v_aging_documents.open_amount + the reductions in the
-- period, and v_aging_documents subtracts only emitted NCs, while the
-- reductions counted draft and emitting NCs too: a draft NC of 300 in the
-- middle of the period charged interest on 300 × (days before it) that was
-- never off the balance.
--
-- late_interest_reductions_after (same signature): an NC counts only once
-- emitted, the same set v_aging_documents subtracts. Receipts unchanged.
--
-- Rollback: older code calls the same function.

create or replace function public.late_interest_reductions_after(
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
       and n.status = 'emitted'
  )
  select coalesce(sum(
           r.amount * least(greatest(r.reduced_on - p_from, 0), greatest(p_to - p_from + 1, 0))
         ), 0)
    from r
$$;

comment on function public.late_interest_reductions_after(uuid, date, date) is
  'Pagos y NC emitidas del comprobante ponderados por los días de [from, to] anteriores a cada uno: lo que suma al saldo de hoy para obtener el saldo diario del período (las mismas que resta v_aging_documents).';

revoke all on function public.late_interest_reductions_after(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.late_interest_reductions_after(uuid, date, date)
  to service_role;
