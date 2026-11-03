SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The proportional SAC of a final settlement no longer compounds on every
-- re-apply (LCT art. 121: the SAC is not remuneration for the SAC).
--
-- applyFinalSettlementAction writes the SAC as an extra of the leaving
-- month ("Liquidación final: SAC proporcional …") and then reads
-- payroll_sac_suggestion again. The best month of the half took that extra
-- as remuneration, so each apply grew the SAC by the previous one. The
-- suggestion now leaves out the extras the final settlement wrote (the same
-- "Liquidación final:" prefix the action replaces on re-apply). Same
-- signature and result; everything else is as in 20261103050100.

create or replace function public.payroll_sac_suggestion(
  p_employee_id uuid,
  p_year int,
  p_half int
)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  with sem as (
    select make_date(p_year, case when p_half = 1 then 1 else 7 end, 1) as d_from,
           case when p_half = 1 then make_date(p_year, 6, 30) else make_date(p_year, 12, 31) end as d_to
  ),
  best as (
    select max(
             r.sueldo_neto + r.extras_total
             - coalesce((
                 select sum(x.amount)
                   from public.payroll_entry_extras x
                  where x.entry_id = r.id
                    and x.description like 'Liquidación final:%'
               ), 0)
           ) as amount
    from public.payroll_periods pp
    join public.v_payroll_entries_resolved r on r.period_id = pp.id
    where pp.kind = 'monthly'
      and pp.year = p_year
      and pp.month between (case when p_half = 1 then 1 else 7 end)
                       and (case when p_half = 1 then 6 else 12 end)
      and r.employee_id = p_employee_id
  ),
  span as (
    select greatest(e.hire_date, sem.d_from) as d_start,
           least(coalesce(e.termination_date, sem.d_to), sem.d_to) as d_end,
           sem.d_to - sem.d_from + 1 as days_total
    from public.employees e
    cross join sem
    where e.id = p_employee_id
  )
  select case
           when best.amount is null or span.d_end < span.d_start then 0
           else round(best.amount / 2 * (span.d_end - span.d_start + 1) / span.days_total, 2)
         end
  from best
  cross join span;
$$;

comment on function public.payroll_sac_suggestion(uuid, int, int) is
  'SAC sugerido: 50% de la mejor remuneración mensual (sueldo pactado + extras, sin los extras de la liquidación final) del semestre, proporcional a los días trabajados en él. Security invoker.';

revoke all on function public.payroll_sac_suggestion(uuid, int, int) from public, anon;
grant execute on function public.payroll_sac_suggestion(uuid, int, int) to authenticated, service_role;
