SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Open-ended (interest-only) loans: always 3 upcoming interest cuotas, the
-- capital comes back only with «Devolución de capital».
--
-- 1. open_ended_loan_interest(loan): the monthly interest on the capital
--    still owed (principal − capital of paid rows). The one place that
--    computes it: generation, repayment and the cash-flow projection call it.
-- 2. extend_open_ended_loan(loan): inserts pending interest cuotas until the
--    loan has 3 due today or later (Argentina time). service_role only (the
--    daily cron) and the payment RPCs.
-- 3. create_loan_core (20261112110000, every case kept): an open-ended loan
--    stores its flag and rate, ignores the schedule and extends.
-- 4. open_ended_loan_projection(until): the interest cuotas not generated yet
--    up to a date, for the cash flow.
-- 5. repay_loan_capital: returns capital (partial or whole) from an account,
--    possibly in pesos for a USD loan; the later cuotas take the new
--    interest; the loan closes when nothing is owed nor pending.
-- 6. convert_loan_to_open_ended / relink_loan_installment_payment:
--    service_role only, for the data step that turns a loaded loan into an
--    open-ended one and links a cuota paid before it was loaded to its real
--    movement (an internal loan only: on a fiscal one it would post twice).
--
-- A loan with is_open_ended = false is never touched by these functions.

-- 1. Interest --------------------------------------------------------------------

create function public.open_ended_loan_interest(p_loan_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select round(greatest(0, l.principal - coalesce((
           select sum(i.capital_amount) from public.loan_installments i
            where i.loan_id = l.id and i.status = 'pagada'), 0))
           * coalesce(l.monthly_rate, 0) / 100, 2)
    from public.loans l
   where l.id = p_loan_id;
$$;

comment on function public.open_ended_loan_interest(uuid) is
  'Interés mensual de un préstamo sin vencimiento: capital que se sigue debiendo × interés mensual %.';

revoke all on function public.open_ended_loan_interest(uuid) from public, anon;
grant execute on function public.open_ended_loan_interest(uuid) to authenticated, service_role;

-- 2. Keep 3 upcoming cuotas ---------------------------------------------------------

create function public.extend_open_ended_loan(p_loan_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_upcoming constant int := 3;
  v_loan     public.loans;
  v_today    date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_interest numeric;
  v_k        int;
  v_due      date;
  v_inserted int := 0;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.id is null or not v_loan.is_open_ended or v_loan.status <> 'active' then
    return 0;
  end if;
  v_interest := public.open_ended_loan_interest(p_loan_id);
  if v_interest <= 0 then
    return 0;
  end if;

  -- Bounded: a loan loaded years back still stops (600 is the schedule cap).
  while v_inserted < 600
        and (select count(*) from public.loan_installments i
              where i.loan_id = p_loan_id and i.kind = 'cuota'
                and i.status = 'pendiente' and i.due_date >= v_today) < c_upcoming loop
    select count(*) into v_k from public.loan_installments i
     where i.loan_id = p_loan_id and i.kind = 'cuota';
    -- From the first due date by whole months (no month-end drift), never on
    -- or before the last cuota.
    select greatest((v_loan.first_due_date + make_interval(months => v_k))::date,
                    coalesce(max(i.due_date) + 1, v_loan.first_due_date))
      into v_due
      from public.loan_installments i
     where i.loan_id = p_loan_id and i.kind = 'cuota';
    insert into public.loan_installments (
      loan_id, number, due_date, amount, kind,
      capital_amount, interest_amount, iva_amount, perception_amount, other_charges_amount
    ) values (
      p_loan_id,
      coalesce((select max(i.number) from public.loan_installments i where i.loan_id = p_loan_id), 0) + 1,
      v_due, v_interest, 'cuota',
      0, v_interest, 0, 0, 0
    );
    v_inserted := v_inserted + 1;
  end loop;

  if v_inserted > 0 then
    update public.loans
       set installments_count = least(600, (select count(*) from public.loan_installments i
                                             where i.loan_id = p_loan_id and i.kind = 'cuota'))
     where id = p_loan_id;
  end if;
  return v_inserted;
end;
$$;

comment on function public.extend_open_ended_loan(uuid) is
  'Préstamo sin vencimiento: agrega cuotas de interés pendientes hasta tener 3 que vencen hoy o después. Devuelve cuántas agregó. La llaman el cron diario (service role) y los pagos.';

revoke all on function public.extend_open_ended_loan(uuid) from public, anon, authenticated;
grant execute on function public.extend_open_ended_loan(uuid) to service_role;

-- 3. create_loan_core: same as 20261112110000 plus the open-ended branch. ------------

create or replace function public.create_loan_core(
  p_loan jsonb,
  p_installments jsonb,
  p_created_by uuid,
  p_import_run_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan_id uuid;
  v_count   int := (p_loan ->> 'installments_count')::int;
  v_open    boolean := coalesce((p_loan ->> 'is_open_ended')::boolean, false);
begin
  -- An open-ended loan has no schedule: its interest cuotas are generated.
  if v_open then
    if coalesce((p_loan ->> 'monthly_rate')::numeric, 0) <= 0
       or (p_loan ->> 'kind') is distinct from 'prestamo' then
      raise exception 'Un préstamo sin vencimiento es un préstamo (no leasing ni plan) con interés mensual mayor a 0'
        using errcode = '22023', hint = 'jouve_guard';
    end if;
    insert into public.loans (
      kind, description, lender, principal, currency, channel_id,
      installments_count, first_due_date, notes, created_by, import_run_id,
      loan_number, account_id, start_date, original_amount, tna, tea, cft,
      is_open_ended, monthly_rate
    ) values (
      'prestamo',
      p_loan ->> 'description',
      p_loan ->> 'lender',
      (p_loan ->> 'principal')::numeric,
      p_loan ->> 'currency',
      p_loan ->> 'channel_id',
      1,
      (p_loan ->> 'first_due_date')::date,
      p_loan ->> 'notes',
      p_created_by,
      p_import_run_id,
      p_loan ->> 'loan_number',
      (p_loan ->> 'account_id')::uuid,
      (p_loan ->> 'start_date')::date,
      (p_loan ->> 'original_amount')::numeric,
      (p_loan ->> 'tna')::numeric,
      (p_loan ->> 'tea')::numeric,
      (p_loan ->> 'cft')::numeric,
      true,
      (p_loan ->> 'monthly_rate')::numeric
    )
    returning id into v_loan_id;
    perform public.extend_open_ended_loan(v_loan_id);
    return v_loan_id;
  end if;

  if p_installments is null
     or jsonb_typeof(p_installments) <> 'array'
     or jsonb_array_length(p_installments) is distinct from v_count then
    raise exception 'El cronograma no coincide con la cantidad de cuotas del préstamo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_installments) as i(perception numeric, iva_perception numeric)
     where i.iva_perception < 0 or i.iva_perception > coalesce(i.perception, 0)
  ) then
    raise exception 'La percepción de IVA de una cuota no puede ser negativa ni mayor que el total de percepciones'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  insert into public.loans (
    kind, description, lender, principal, currency, channel_id,
    installments_count, first_due_date, notes, created_by, import_run_id,
    loan_number, account_id, start_date, original_amount, tna, tea, cft
  ) values (
    (p_loan ->> 'kind')::public.loan_kind,
    p_loan ->> 'description',
    p_loan ->> 'lender',
    (p_loan ->> 'principal')::numeric,
    p_loan ->> 'currency',
    p_loan ->> 'channel_id',
    v_count,
    (p_loan ->> 'first_due_date')::date,
    p_loan ->> 'notes',
    p_created_by,
    p_import_run_id,
    p_loan ->> 'loan_number',
    (p_loan ->> 'account_id')::uuid,
    (p_loan ->> 'start_date')::date,
    (p_loan ->> 'original_amount')::numeric,
    (p_loan ->> 'tna')::numeric,
    (p_loan ->> 'tea')::numeric,
    (p_loan ->> 'cft')::numeric
  )
  returning id into v_loan_id;

  insert into public.loan_installments (
    loan_id, number, due_date, amount,
    capital_amount, interest_amount, iva_amount, perception_amount,
    iva_perception_amount, other_charges_amount,
    status, paid_date, paid_amount, paid_outside
  )
  select v_loan_id, i.number, i.due_date, i.amount,
         i.capital, i.interest, i.iva, i.perception,
         nullif(i.iva_perception, 0), i.other,
         case when coalesce(i.paid_outside, false)
              then 'pagada'::public.loan_installment_status
              else 'pendiente'::public.loan_installment_status end,
         case when coalesce(i.paid_outside, false) then i.due_date end,
         case when coalesce(i.paid_outside, false) then i.amount end,
         coalesce(i.paid_outside, false)
    from jsonb_to_recordset(p_installments) as i(
           number integer, due_date date, amount numeric,
           capital numeric, interest numeric, iva numeric,
           perception numeric, iva_perception numeric, other numeric,
           paid_outside boolean
         );

  return v_loan_id;
end;
$$;

revoke all on function public.create_loan_core(jsonb, jsonb, uuid, uuid)
  from public, anon, authenticated;

-- 4. Projection for the cash flow ---------------------------------------------------

create function public.open_ended_loan_projection(p_until date)
returns table (loan_id uuid, due_date date, amount numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id, g.d::date, public.open_ended_loan_interest(l.id)
    from public.loans l
    cross join lateral (
      select coalesce(max(i.due_date), l.first_due_date) as last_due,
             count(*)::int as k
        from public.loan_installments i
       where i.loan_id = l.id and i.kind = 'cuota'
    ) c
    cross join lateral generate_series(1, 600) as s(n)
    cross join lateral (
      select greatest((l.first_due_date + make_interval(months => c.k + s.n - 1))::date,
                      c.last_due + s.n) as d
    ) g
   where l.is_open_ended
     and l.status = 'active'
     and g.d <= p_until
     and public.open_ended_loan_interest(l.id) > 0;
$$;

comment on function public.open_ended_loan_projection(date) is
  'Cuotas de interés de los préstamos sin vencimiento que todavía no se generaron, una por mes hasta p_until (para el flujo de fondos). Respeta RLS de loans.';

revoke all on function public.open_ended_loan_projection(date) from public, anon;
grant execute on function public.open_ended_loan_projection(date) to authenticated, service_role;

-- 5. «Devolución de capital» --------------------------------------------------------

create function public.repay_loan_capital(
  p_loan_id        uuid,
  p_date           date,
  p_account_id     uuid,
  p_amount         numeric,
  p_account_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan        public.loans;
  v_outstanding numeric;
  v_inst_id     uuid;
  v_tx_id       uuid;
  v_interest    numeric;
begin
  -- Role guard (accounting:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar devoluciones de capital'
      using errcode = '42501';
  end if;

  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.id is null or not v_loan.is_open_ended or v_loan.status <> 'active' then
    raise exception 'La devolución de capital es para un préstamo sin vencimiento activo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  v_outstanding := v_loan.principal - coalesce((
    select sum(i.capital_amount) from public.loan_installments i
     where i.loan_id = p_loan_id and i.status = 'pagada'), 0);
  if p_amount is null or p_amount <= 0 or p_amount > v_outstanding then
    raise exception 'El capital a devolver tiene que ser mayor a 0 y no más que lo que se debe (%)', v_outstanding
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  insert into public.loan_installments (
    loan_id, number, due_date, amount, kind,
    capital_amount, interest_amount, iva_amount, perception_amount, other_charges_amount
  ) values (
    p_loan_id,
    coalesce((select max(i.number) from public.loan_installments i where i.loan_id = p_loan_id), 0) + 1,
    p_date, p_amount, 'devolucion_capital',
    p_amount, 0, 0, 0, 0
  )
  returning id into v_inst_id;

  v_tx_id := public.pay_loan_installment(v_inst_id, p_date, p_account_id, p_amount, p_account_amount);

  -- The later cuotas take the interest on what is still owed; with nothing
  -- owed they go, and the loan closes when nothing else is pending.
  v_interest := public.open_ended_loan_interest(p_loan_id);
  if v_interest > 0 then
    update public.loan_installments
       set amount = v_interest, capital_amount = 0, interest_amount = v_interest,
           iva_amount = 0, perception_amount = 0, iva_perception_amount = null,
           other_charges_amount = 0
     where loan_id = p_loan_id and kind = 'cuota' and status = 'pendiente' and due_date > p_date;
  else
    delete from public.loan_installments
     where loan_id = p_loan_id and kind = 'cuota' and status = 'pendiente' and due_date > p_date;
    if not exists (select 1 from public.loan_installments
                    where loan_id = p_loan_id and status = 'pendiente') then
      update public.loans set status = 'paid' where id = p_loan_id;
    end if;
  end if;

  return v_tx_id;
end;
$$;

comment on function public.repay_loan_capital(uuid, date, uuid, numeric, numeric) is
  'Devolución de capital de un préstamo sin vencimiento (p_amount en la moneda del préstamo; p_account_amount, los pesos que salen si la cuenta está en pesos y el préstamo en dólares).';

revoke all on function public.repay_loan_capital(uuid, date, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.repay_loan_capital(uuid, date, uuid, numeric, numeric) to authenticated, service_role;

-- 6. Data step: conversion and relink (service_role only) -----------------------------

create function public.convert_loan_to_open_ended(p_loan_id uuid, p_monthly_rate numeric)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan  public.loans;
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Solo el service role convierte un préstamo en sin vencimiento'
      using errcode = '42501';
  end if;

  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.id is null or v_loan.kind <> 'prestamo' or v_loan.status <> 'active' then
    raise exception 'Solo un préstamo activo (no leasing ni plan) pasa a sin vencimiento'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_loan.is_open_ended then
    raise exception 'El préstamo ya es sin vencimiento'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if p_monthly_rate is null or p_monthly_rate <= 0 or p_monthly_rate > 100 then
    raise exception 'El interés mensual tiene que ser mayor a 0 y hasta 100'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- Pending cuotas with no split are interest only.
  update public.loan_installments
     set capital_amount = 0, interest_amount = amount, iva_amount = 0,
         perception_amount = 0, other_charges_amount = 0
   where loan_id = p_loan_id and status = 'pendiente' and capital_amount is null;

  -- Only the next 3 upcoming cuotas stay; the past-due ones are kept.
  delete from public.loan_installments
   where id in (
     select i.id from public.loan_installments i
      where i.loan_id = p_loan_id and i.status = 'pendiente' and i.due_date >= v_today
      order by i.due_date, i.number
     offset 3
   );

  update public.loans
     set is_open_ended = true,
         monthly_rate = p_monthly_rate,
         installments_count = greatest(1, (select count(*) from public.loan_installments i
                                            where i.loan_id = p_loan_id and i.kind = 'cuota'))
   where id = p_loan_id;

  return public.extend_open_ended_loan(p_loan_id);
end;
$$;

comment on function public.convert_loan_to_open_ended(uuid, numeric) is
  'Paso de datos (service role): pasa un préstamo a sin vencimiento con su interés mensual; deja 3 cuotas próximas.';

revoke all on function public.convert_loan_to_open_ended(uuid, numeric) from public, anon, authenticated;
grant execute on function public.convert_loan_to_open_ended(uuid, numeric) to service_role;

create function public.relink_loan_installment_payment(p_installment_id uuid, p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.loan_installments;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Solo el service role vincula el pago de una cuota pagada antes de cargar el préstamo'
      using errcode = '42501';
  end if;

  select * into v_inst from public.loan_installments where id = p_installment_id for update;
  if v_inst.id is null or not v_inst.paid_outside then
    raise exception 'La cuota no existe o no figura pagada antes de cargar el préstamo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if exists (select 1 from public.loans l
               join public.invoicing_channels c on c.id = l.channel_id
              where l.id = v_inst.loan_id and c.is_fiscal) then
    raise exception 'Solo se vincula el pago de un préstamo interno: en uno fiscal duplicaría el asiento'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  update public.loan_installments set paid_outside = false where id = p_installment_id;
  perform public.adopt_loan_installment_payment_core(p_installment_id, p_transaction_id, true);
end;
$$;

comment on function public.relink_loan_installment_payment(uuid, uuid) is
  'Paso de datos (service role): vincula una cuota marcada «pagada antes de cargar» de un préstamo interno con su egreso real.';

revoke all on function public.relink_loan_installment_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.relink_loan_installment_payment(uuid, uuid) to service_role;
