SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Audit 2026-10-31, Módulos S1 and S7.
--
--   * S1: payroll payments posted to 5.3.5 "Otros gastos administrativos"
--     (role gastos). 5.3.1 "Sueldos y jornales" gets the role sueldos, the
--     movement a payroll payment creates is marked is_payroll, and
--     build_transaction_journal_lines debits sueldos for it (gastos while no
--     active account holds the role, so a payment never fails over the COA).
--     The rejected-check branch of 20261031192133 stays first.
--     Entries already posted keep 5.3.5; they re-post to 5.3.1 only when an
--     entry column of the movement changes.
--   * S7: grant_vacation_balances carried the previous period's remaining days
--     even after it expired, left the source consumable (an extended balance
--     counted twice) and had no cap. It now carries only from the previous
--     period when it is extended or still active and unexpired, at most a
--     third of its entitled days (LCT art. 164), only when both p_carryover
--     and hr_settings.vacation_carryover are on, and closes the source
--     (status expired) so its days are not consumed again.

update public.chart_of_accounts
   set system_role = 'sueldos'
 where code = '5.3.1'
   and is_active
   and system_role is null
   and not exists (
     select 1 from public.chart_of_accounts c
      where c.system_role = 'sueldos' and c.is_active
   );

alter table public.transactions
  add column is_payroll boolean not null default false;

comment on column public.transactions.is_payroll is
  'Created by a payroll payment (payroll_payment_sync_transaction); its entry debits the sueldos role.';

update public.transactions t
   set is_payroll = true
  from public.payroll_payments pp
 where pp.transaction_id = t.id
   and not t.is_payroll;

create or replace function public.build_transaction_journal_lines(
  p_transaction public.transactions,
  p_description text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role         public.coa_system_role;
  v_expense_role public.coa_system_role := 'gastos';
  v_pair         public.transactions;
  v_pair_role    public.coa_system_role;
begin
  if p_transaction.invoice_id is not null
     or p_transaction.receipt_id is not null
     or p_transaction.payment_order_id is not null
     or p_transaction.kind not in ('income', 'expense', 'transfer_in') then
    return null;
  end if;

  v_role := public.coa_role_for_account(p_transaction.account_id);
  if v_role is null then
    raise warning 'build_transaction_journal_lines: account % sin mapping COA, asiento omitido', p_transaction.account_id;
    return null;
  end if;

  if p_transaction.kind = 'income' then
    return jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', p_transaction.amount, 'description', p_description),
      jsonb_build_object('system_role', 'ajustes_caja', 'credit', p_transaction.amount, 'description', p_description)
    );
  elsif p_transaction.kind = 'expense' then
    if p_transaction.rejected_check_id is not null then
      v_expense_role := 'cheques_rechazados';
    elsif p_transaction.is_payroll and exists (
      select 1 from public.chart_of_accounts
       where system_role = 'sueldos' and is_active
    ) then
      v_expense_role := 'sueldos';
    end if;
    return jsonb_build_array(
      jsonb_build_object('system_role', v_expense_role::text, 'debit', p_transaction.amount, 'description', p_description),
      jsonb_build_object('system_role', v_role::text, 'credit', p_transaction.amount, 'description', p_description)
    );
  end if;

  select * into v_pair from public.transactions where id = p_transaction.transfer_pair_id;
  if v_pair.id is null then
    raise warning 'build_transaction_journal_lines: transfer_in % sin par, asiento omitido', p_transaction.id;
    return null;
  end if;
  v_pair_role := public.coa_role_for_account(v_pair.account_id);
  if v_pair_role is null then
    raise warning 'build_transaction_journal_lines: par % sin mapping COA, asiento omitido', v_pair.account_id;
    return null;
  end if;
  return jsonb_build_array(
    jsonb_build_object('system_role', v_role::text, 'debit', p_transaction.amount, 'description', p_description || ' (entrada)'),
    jsonb_build_object('system_role', v_pair_role::text, 'credit', p_transaction.amount, 'description', p_description || ' (salida)')
  );
end;
$$;

revoke all on function public.build_transaction_journal_lines(public.transactions, text) from public, anon, authenticated;

create or replace function public.payroll_payment_sync_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_year   int;
  v_period_month  int;
  v_employee_name text;
  v_accrual       date;
  v_description   text;
begin
  if tg_op = 'INSERT' then
    select pp.year, pp.month, e.legal_name
      into v_period_year, v_period_month, v_employee_name
    from public.payroll_entries pe
    join public.payroll_periods pp on pp.id = pe.period_id
    join public.employees e on e.id = pe.employee_id
    where pe.id = new.entry_id;

    v_accrual := make_date(v_period_year, v_period_month, 1);
    v_description :=
      'Sueldo ' || v_employee_name
      || ' (' || lpad(v_period_month::text, 2, '0') || '/' || v_period_year::text || ')'
      || coalesce(' — ' || nullif(new.notes, ''), '');

    insert into public.transactions (
      account_id, channel_id, kind, amount, currency,
      transaction_date, accrual_month, description, created_by, is_payroll
    )
    values (
      new.account_id, new.channel_id, 'expense', new.amount, 'ARS',
      new.paid_at, v_accrual, v_description, new.created_by, true
    )
    returning id into new.transaction_id;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.transaction_id is not null then
      update public.transactions
         set account_id       = new.account_id,
             channel_id       = new.channel_id,
             amount           = new.amount,
             transaction_date = new.paid_at,
             updated_at       = now()
       where id = new.transaction_id;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.transaction_id is not null then
      delete from public.transactions where id = old.transaction_id;
    end if;
    return old;
  end if;

  return null;
end;
$$;

revoke all on function public.payroll_payment_sync_transaction() from public, anon, authenticated;

create or replace function public.grant_vacation_balances(
  p_target_year int default extract(year from now())::int,
  p_carryover boolean default true
)
returns table (employee_id uuid, balance_id uuid, entitled_days int, carryover_days int)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_emp        record;
  v_anios      int;
  v_entitled   int;
  v_source     record;
  v_carry      int;
  v_balance_id uuid;
  v_carry_on   boolean;
  v_granted_at date := make_date(p_target_year, 10, 1);
  v_expires_at date := make_date(p_target_year + 1, 4, 30);
  v_dec31      date := make_date(p_target_year, 12, 31);
begin
  -- The service-role cron and authenticated owner/admin (the HR admin action).
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin']) then
    raise exception 'No autorizado para otorgar balances de vacaciones'
      using errcode = '42501';
  end if;

  v_carry_on := coalesce(p_carryover, false) and coalesce((
    select s.value = 'true'::jsonb from public.hr_settings s
     where s.key = 'vacation_carryover'
  ), false);

  update public.employee_vacation_balances
     set status = 'expired'
   where status = 'active'
     and expires_at < current_date;

  for v_emp in
    select id, hire_date
    from public.employees
    where is_active = true
  loop
    if exists (
      select 1 from public.employee_vacation_balances
      where employee_id = v_emp.id and period_year = p_target_year
    ) then
      continue;
    end if;

    v_anios := extract(year from age(v_dec31, v_emp.hire_date))::int;

    if v_emp.hire_date > make_date(p_target_year, 7, 1) then
      v_entitled := greatest(0, ((v_dec31 - v_emp.hire_date) / 20)::int);
    elsif v_anios < 5 then
      v_entitled := 14;
    elsif v_anios < 10 then
      v_entitled := 21;
    elsif v_anios < 20 then
      v_entitled := 28;
    else
      v_entitled := 35;
    end if;

    v_carry := 0;
    if v_carry_on then
      select b.id,
             b.entitled_days,
             (b.entitled_days + b.bonus_days + b.carryover_days - b.used_days) as remaining
        into v_source
      from public.employee_vacation_balances b
      where b.employee_id = v_emp.id
        and b.period_year = p_target_year - 1
        and (b.status = 'extended'
             or (b.status = 'active' and b.expires_at >= v_granted_at))
      for update;

      if found and v_source.remaining > 0 then
        v_carry := least(v_source.remaining, v_source.entitled_days / 3);
        update public.employee_vacation_balances
           set status = 'expired',
               notes  = concat_ws(' · ', nullif(notes, ''),
                          format('%s días arrastrados a %s', v_carry, p_target_year))
         where id = v_source.id;
      end if;
    end if;

    insert into public.employee_vacation_balances (
      employee_id, period_year, entitled_days, carryover_days,
      granted_at, expires_at, status, created_by
    )
    values (
      v_emp.id, p_target_year, v_entitled, v_carry,
      v_granted_at, v_expires_at, 'active', auth.uid()
    )
    returning id into v_balance_id;

    employee_id    := v_emp.id;
    balance_id     := v_balance_id;
    entitled_days  := v_entitled;
    carryover_days := v_carry;
    return next;
  end loop;
end;
$$;

-- The HR admin action calls it with the user's session; the body checks the role.
revoke all on function public.grant_vacation_balances(int, boolean) from public, anon, authenticated;
grant execute on function public.grant_vacation_balances(int, boolean) to authenticated, service_role;
