SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- «Adelanto a empleado»: choose the payroll month it is discounted in.
-- record_employee_account_cash (latest: 20261103060100) gains p_start_month:
-- the plan's start_month, from the month before the date's through two
-- months after; null keeps the date's month. The accounting is unchanged.
-- The old signature is dropped so positional callers
-- (post_driver_settlement_difference) resolve to this one; older code calls
-- it with named arguments and gets the default.

-- squawk-ignore ban-drop-function
drop function public.record_employee_account_cash(uuid, text, uuid, text, date, numeric, text, uuid, numeric);

create function public.record_employee_account_cash(p_employee_id uuid, p_kind text, p_account_id uuid, p_channel_id text, p_date date, p_amount numeric, p_description text DEFAULT NULL::text, p_plan_id uuid DEFAULT NULL::uuid, p_installment_amount numeric DEFAULT NULL::numeric, p_start_month date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name         text;
  v_account      public.accounts;
  v_plan         public.employee_debt_plans;
  v_plan_id      uuid := p_plan_id;
  v_description  text;
  v_tx_id        uuid;
  v_movement_id  uuid;
  v_start_month  date;
begin
  -- Role guard (hr:write holders in lib/auth/permissions.ts).
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar movimientos de la cuenta corriente de empleados'
      using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('advance', 'payment') then
    raise exception 'El movimiento de caja es un adelanto o un pago del empleado'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El importe tiene que ser mayor a cero'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if p_date is null then
    raise exception 'Indicá la fecha'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if p_kind = 'advance' and p_plan_id is not null then
    raise exception 'Un adelanto abre su propio plan en cuotas; un pago es el que se imputa a un plan'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if p_kind = 'payment' and p_installment_amount is not null then
    raise exception 'Solo un adelanto abre un plan en cuotas'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if p_start_month is not null and p_installment_amount is null then
    raise exception 'Solo un adelanto con plan elige el sueldo en que se descuenta'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- The payroll month the plan starts in: the date's, unless the caller picks
  -- one from the month before through two months after.
  v_start_month := date_trunc('month', coalesce(p_start_month, p_date))::date;
  if p_date is not null
     and (v_start_month < (date_trunc('month', p_date) - interval '1 month')::date
          or v_start_month > (date_trunc('month', p_date) + interval '2 months')::date) then
    raise exception 'El sueldo en que se descuenta va del mes anterior a la fecha hasta dos meses después'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select legal_name into v_name from public.employees where id = p_employee_id;
  if v_name is null then
    raise exception 'El empleado no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;

  select * into v_account from public.accounts where id = p_account_id;
  if v_account.id is null then
    raise exception 'La cuenta no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_account.type in ('checks', 'echeq') then
    raise exception 'Los movimientos en cuentas de cheques se manejan desde Cheques (cargar, depositar, endosar)'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if v_plan_id is not null then
    select * into v_plan from public.employee_debt_plans where id = v_plan_id for update;
    if v_plan.id is null
       or v_plan.employee_id <> p_employee_id
       or v_plan.currency <> v_account.currency then
      raise exception 'El plan no existe o es de otro empleado o de otra moneda que la cuenta'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;

  v_description := coalesce(
    nullif(btrim(p_description), ''),
    case when p_kind = 'advance' then 'Adelanto a ' || v_name
         else 'Pago de ' || v_name || ' (cuenta corriente)' end
  );

  if p_kind = 'advance' and p_installment_amount is not null then
    if p_installment_amount <= 0 or p_installment_amount > p_amount then
      raise exception 'La cuota del plan tiene que ser mayor a cero y no superar el adelanto'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    insert into public.employee_debt_plans (
      employee_id, description, currency, total, installment_amount, start_month, created_by
    ) values (
      p_employee_id, left(v_description, 200), v_account.currency, p_amount, p_installment_amount,
      v_start_month, auth.uid()
    )
    returning id into v_plan_id;
  end if;

  insert into public.transactions (
    account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, created_by
  ) values (
    p_account_id, p_channel_id,
    case when p_kind = 'advance' then 'expense' else 'income' end,
    p_amount, v_account.currency, p_date,
    date_trunc('month', p_date)::date, left(v_description, 500), auth.uid()
  )
  returning id into v_tx_id;

  insert into public.employee_account_movements (
    employee_id, kind, currency, amount, movement_date, description, plan_id, transaction_id, created_by
  ) values (
    p_employee_id, p_kind, v_account.currency, p_amount, p_date, left(v_description, 200),
    v_plan_id, v_tx_id, auth.uid()
  )
  returning id into v_movement_id;

  -- Posted at insert as a loose movement; now the builder sees the account.
  perform public.repost_journal('transactions', v_tx_id);
  return v_movement_id;
end;
$function$
;

revoke all on function public.record_employee_account_cash(uuid, text, uuid, text, date, numeric, text, uuid, numeric, date) from public, anon, authenticated;
grant execute on function public.record_employee_account_cash(uuid, text, uuid, text, date, numeric, text, uuid, numeric, date) to authenticated, service_role;
