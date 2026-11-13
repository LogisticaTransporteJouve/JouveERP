SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The payroll grid no longer shows the «Vacaciones» column (always 0 in use).
-- The final settlement's unused vacations now land as a settlement extra
-- («<prefix> Vacaciones no gozadas», visible in Extras) instead of the hidden
-- payroll_entries.vacaciones_monto, which the settlement now zeroes. A «por
-- recibo» employee gets no vacation extra: the final recibo holds them.
-- Same signature as 20261106112001, so older code keeps calling it.
create or replace function public.apply_final_settlement(
  p_employee_id     uuid,
  p_year            int,
  p_month           int,
  p_sueldo_neto     numeric,
  p_vacaciones_monto numeric,
  p_extra_prefix    text,
  p_sac_amount      numeric,
  p_sac_description text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period_id uuid;
  v_entry_id  uuid;
  v_by_recibo boolean;
begin
  if coalesce(p_extra_prefix, '') = '' then
    raise exception 'p_extra_prefix is required';
  end if;

  v_period_id := public.seed_payroll_period(p_year, p_month);

  insert into public.payroll_entries (period_id, employee_id, sueldo_neto, vacaciones_monto)
  values (v_period_id, p_employee_id, p_sueldo_neto, 0)
  on conflict (period_id, employee_id) do update
    set sueldo_neto = excluded.sueldo_neto,
        vacaciones_monto = 0
  returning id into v_entry_id;

  delete from public.payroll_entry_extras
   where entry_id = v_entry_id
     and left(description, length(p_extra_prefix)) = p_extra_prefix;

  select e.pay_mode = 'recibo' into v_by_recibo
    from public.employees e where e.id = p_employee_id;

  if coalesce(p_vacaciones_monto, 0) > 0 and not coalesce(v_by_recibo, false) then
    insert into public.payroll_entry_extras (entry_id, amount, description, sort_order, created_by)
    values (v_entry_id, p_vacaciones_monto, p_extra_prefix || ' Vacaciones no gozadas', 899, auth.uid());
  end if;

  if p_sac_amount > 0 then
    insert into public.payroll_entry_extras (entry_id, amount, description, sort_order, created_by)
    values (v_entry_id, p_sac_amount, p_sac_description, 900, auth.uid());
  end if;

  return v_entry_id;
end;
$$;

revoke all on function public.apply_final_settlement(uuid, int, int, numeric, numeric, text, numeric, text) from public, anon, authenticated;
grant execute on function public.apply_final_settlement(uuid, int, int, numeric, numeric, text, numeric, text) to authenticated, service_role;
