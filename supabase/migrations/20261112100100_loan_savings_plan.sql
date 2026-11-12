SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A savings plan (loan kind plan_ahorro): its cuotas add up to «Rodados en
-- plan de ahorro» instead of paying down a debt.
--
-- 1. Account 1.2.1.<next free> «Rodados en plan de ahorro» (planes_ahorro),
--    only if no active account holds the role.
-- 2. loan_liability_role: a plan's capital goes to planes_ahorro (while an
--    active account holds the role); leasing and prestamo as before.
-- 3. build_transaction_journal_lines (20261109120100, every case kept): a
--    plan cuota paid for any amount other than its split, or with no split,
--    debits the plan for the whole payment, never gastos. A split plan cuota
--    paid for its amount keeps the split path (capital to the plan).
-- 4. record_loan_bank_payments (20261107220000): the capital of a receipt
--    lowers the loan's own role instead of always prestamos.
-- 5. record_loan_disbursement (20261103040100) and book_loan_opening
--    (20261109120100) refuse a plan: it has no disbursement and its account
--    starts at 0 with the first cuota loaded.
--
-- No plan exists yet, so no row is reposted. Rollback: older SQL is not
-- replayed on these rows; older TS shows an unknown kind as «Préstamo».

-- 1. Account -----------------------------------------------------------------

do $$
declare
  v_group uuid;
  v_code  text;
begin
  if not exists (select 1 from public.chart_of_accounts where system_role = 'planes_ahorro' and is_active) then
    select id into v_group from public.chart_of_accounts where code = '1.2.1';
    if v_group is not null then
      select '1.2.1.' || (coalesce(max(substring(code from '^1\.2\.1\.([0-9]+)$')::int), 0) + 1)
        into v_code
        from public.chart_of_accounts
       where code ~ '^1\.2\.1\.[0-9]+$';
      insert into public.chart_of_accounts (parent_id, code, name, level, account_type, system_role)
      values (v_group, v_code, 'Rodados en plan de ahorro', 4, 'activo', 'planes_ahorro');
    end if;
  end if;
end;
$$;

-- 2. The account a loan's capital goes to ------------------------------------

create or replace function public.loan_liability_role(p_loan_id uuid)
returns public.coa_system_role
language sql
stable
set search_path = ''
as $$
  select case
           when exists (select 1 from public.loans l
                         where l.id = p_loan_id and l.kind = 'leasing')
                and exists (select 1 from public.chart_of_accounts
                             where system_role = 'deudas_leasing' and is_active)
             then 'deudas_leasing'::public.coa_system_role
           when exists (select 1 from public.loans l
                         where l.id = p_loan_id and l.kind = 'plan_ahorro')
                and exists (select 1 from public.chart_of_accounts
                             where system_role = 'planes_ahorro' and is_active)
             then 'planes_ahorro'::public.coa_system_role
           else 'prestamos'::public.coa_system_role
         end
$$;

comment on function public.loan_liability_role(uuid) is
  'Rol de la cuenta del capital de un préstamo: deudas_leasing para un leasing, planes_ahorro (activo) para un plan de ahorro (si hay cuenta activa), prestamos para el resto. Interna.';

revoke all on function public.loan_liability_role(uuid) from public, anon, authenticated;

-- 3. build_transaction_journal_lines: same as 20261109120100 plus a plan's
--    cuota paid whole to the plan. ---------------------------------------------

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
  v_rate         numeric := 1;
  v_amount       numeric;
  v_inst         public.loan_installments;
  v_interest     numeric;
  v_iva          numeric;
  v_perception   numeric;
  v_capital      numeric;
  v_lines        jsonb;
  v_employee     boolean;
  v_tax_account  uuid;
  v_disb_loan    uuid;
  v_charge       record;
  v_charge_lines jsonb := '[]'::jsonb;
  v_charges      numeric := 0;
  v_charge_amt   numeric;
  v_charge_iva   numeric;
  v_charge_role  public.coa_system_role;
  v_interest_role text;
begin
  if p_transaction.invoice_id is not null
     or p_transaction.receipt_id is not null
     or p_transaction.payment_order_id is not null
     or p_transaction.issued_check_id is not null
     or p_transaction.kind not in ('income', 'expense', 'transfer_in') then
    return null;
  end if;

  -- The journal is in pesos. No rate on or before the date: no entry, listed
  -- by journal_missing_entries as 'sin_cotizacion' (never posted at 1).
  if p_transaction.currency = 'USD' then
    v_rate := public.get_exchange_rate('USD', p_transaction.transaction_date);
    if v_rate is null then
      return null;
    end if;
  end if;
  v_amount := round(p_transaction.amount * v_rate, 2);

  v_role := public.coa_role_for_account(p_transaction.account_id);
  if v_role is null then
    raise warning 'build_transaction_journal_lines: account % sin mapping COA, asiento omitido', p_transaction.account_id;
    return null;
  end if;

  v_employee := exists (
      select 1 from public.employee_account_movements m where m.transaction_id = p_transaction.id
    ) and exists (
      select 1 from public.chart_of_accounts where system_role = 'anticipos_personal' and is_active
    );

  v_interest_role := case when exists (select 1 from public.chart_of_accounts
                                        where system_role = 'intereses_pagados' and is_active)
                          then 'intereses_pagados' else 'gastos' end;

  if p_transaction.kind = 'income' then
    -- A check a client handed over without a receipt pays on account: it
    -- credits clientes, like a receipt with no allocation. A loan
    -- disbursement is its liability; an employee's payment settles what they owe.
    select l.id into v_disb_loan from public.loans l
     where l.disbursement_transaction_id = p_transaction.id;
    return jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', v_amount, 'description', p_description),
      jsonb_build_object(
        'system_role',
        case
          when p_transaction.manual_check_id is not null
               and p_transaction.counterparty_client_id is not null then 'clientes'
          when v_disb_loan is not null then public.loan_liability_role(v_disb_loan)::text
          when v_employee then 'anticipos_personal'
          else 'ajustes_caja'
        end,
        'credit', v_amount, 'description', p_description)
    );
  elsif p_transaction.kind = 'expense' then
    if p_transaction.rejected_check_id is not null then
      v_expense_role := 'cheques_rechazados';
    elsif p_transaction.is_payroll and exists (
      select 1 from public.chart_of_accounts
       where system_role = 'sueldos' and is_active
    ) then
      v_expense_role := 'sueldos';
    elsif v_employee then
      v_expense_role := 'anticipos_personal';
    else
      -- A tax payment debits the tax document's account (the liability or
      -- the expense it settles).
      select td.account_id into v_tax_account
        from public.tax_documents td
       where td.payment_transaction_id = p_transaction.id;
      if v_tax_account is not null then
        return jsonb_build_array(
          jsonb_build_object('account_id', v_tax_account, 'debit', v_amount, 'description', p_description),
          jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description)
        );
      end if;

      select * into v_inst from public.loan_installments li
       where li.transaction_id = p_transaction.id;
      -- A split cuota paid for its amount: each component converted and
      -- rounded once, the capital takes the rounding so the entry balances.
      if v_inst.id is not null
         and v_inst.capital_amount is not null
         and v_inst.amount = p_transaction.amount then
        -- Its charges, each to its account and its IVA to iva_credito, while
        -- they fit in «otros»; what «otros» has beyond them is interest.
        if (select coalesce(sum(c.amount + c.iva_amount), 0)
              from public.loan_installment_charges c
             where c.installment_id = v_inst.id) <= v_inst.other_charges_amount then
          for v_charge in
            select c.* from public.loan_installment_charges c
             where c.installment_id = v_inst.id
             order by c.created_at, c.id
          loop
            v_charge_amt := round(v_charge.amount * v_rate, 2);
            v_charge_iva := round(v_charge.iva_amount * v_rate, 2);
            v_charges := v_charges + v_charge_amt + v_charge_iva;
            if v_charge_iva > 0 then
              v_charge_lines := v_charge_lines || jsonb_build_object('system_role', 'iva_credito',
                'debit', v_charge_iva,
                'description', p_description || ' — IVA ' || coalesce(v_charge.description, v_charge.concept));
            end if;
            if v_charge_amt <= 0 then
              continue;
            end if;
            if v_charge.chart_account_id is not null then
              v_charge_lines := v_charge_lines || jsonb_build_object('account_id', v_charge.chart_account_id,
                'debit', v_charge_amt,
                'description', p_description || ' — ' || coalesce(v_charge.description, v_charge.concept));
              continue;
            end if;
            v_charge_role := case v_charge.concept
                               when 'seguro' then 'seguros'::public.coa_system_role
                               when 'patentes' then 'patentes'::public.coa_system_role
                               when 'valor_residual' then public.loan_liability_role(v_inst.loan_id)
                               else null
                             end;
            if v_charge_role is null
               or not exists (select 1 from public.chart_of_accounts
                               where system_role = v_charge_role and is_active) then
              v_charge_role := case when v_charge.concept in ('mora', 'otro')
                                    then v_interest_role::public.coa_system_role
                                    else 'gastos'::public.coa_system_role end;
            end if;
            v_charge_lines := v_charge_lines || jsonb_build_object('system_role', v_charge_role::text,
              'debit', v_charge_amt,
              'description', p_description || ' — ' || coalesce(v_charge.description, v_charge.concept));
          end loop;
          v_interest := round(v_inst.interest_amount * v_rate, 2)
                      + greatest(0, round(v_inst.other_charges_amount * v_rate, 2) - v_charges);
        else
          v_interest := round((v_inst.interest_amount + v_inst.other_charges_amount) * v_rate, 2);
        end if;
        v_iva := round(v_inst.iva_amount * v_rate, 2);
        v_perception := round(v_inst.perception_amount * v_rate, 2);
        v_capital := v_amount - v_interest - v_iva - v_perception - v_charges;
        if v_capital < 0 then
          v_interest := v_interest + v_capital;
          v_capital := 0;
        end if;
        v_lines := public.loan_capital_journal_lines(
          v_inst.loan_id, v_capital, v_rate, p_transaction.currency, p_description);
        if v_interest > 0 then
          v_lines := v_lines || jsonb_build_object('system_role', v_interest_role,
            'debit', v_interest, 'description', p_description || ' — intereses y cargos');
        end if;
        if v_iva > 0 then
          v_lines := v_lines || jsonb_build_object('system_role', 'iva_credito', 'debit', v_iva,
            'description', p_description || ' — IVA');
        end if;
        if v_perception > 0 then
          v_lines := v_lines || jsonb_build_object('system_role', 'percepciones_iibb_pagadas', 'debit', v_perception,
            'description', p_description || ' — percepción');
        end if;
        return v_lines || v_charge_lines
          || jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description);
      end if;

      -- Any other cuota of a savings plan (no split, or paid for another
      -- amount) accumulates whole in the plan: a plan never reaches gastos.
      if v_inst.id is not null
         and exists (select 1 from public.loans l
                      where l.id = v_inst.loan_id and l.kind = 'plan_ahorro') then
        return public.loan_capital_journal_lines(
                 v_inst.loan_id, v_amount, v_rate, p_transaction.currency, p_description)
          || jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description);
      end if;

      -- An unsplit cuota of a loan whose liability is booked (disbursement
      -- recorded, or loaded by the importer): the schedule pays the capital
      -- first. Its capital is what the principal still has after the earlier
      -- cuotas (by number; a split cuota counts its capital, an unsplit one
      -- its amount), up to what was paid; the rest is interest. Any other
      -- unsplit cuota posts whole as an expense, as before.
      if v_inst.id is not null
         and v_inst.capital_amount is null
         and exists (
           select 1 from public.loans l
            where l.id = v_inst.loan_id
              and (l.disbursement_transaction_id is not null or l.import_run_id is not null)
         ) then
        select greatest(0, least(p_transaction.amount, l.principal - coalesce((
                 select sum(coalesce(o.capital_amount, o.amount))
                   from public.loan_installments o
                  where o.loan_id = v_inst.loan_id
                    and o.number < v_inst.number
               ), 0)))
          into v_capital
          from public.loans l
         where l.id = v_inst.loan_id;
        v_capital := least(round(v_capital * v_rate, 2), v_amount);
        v_interest := v_amount - v_capital;
        v_lines := public.loan_capital_journal_lines(
          v_inst.loan_id, v_capital, v_rate, p_transaction.currency, p_description);
        if v_interest > 0 then
          if p_transaction.expense_account_id is not null then
            v_lines := v_lines || jsonb_build_object('account_id', p_transaction.expense_account_id,
              'debit', v_interest, 'description', p_description || ' — intereses y cargos');
          else
            v_lines := v_lines || jsonb_build_object('system_role', v_interest_role,
              'debit', v_interest, 'description', p_description || ' — intereses y cargos');
          end if;
        end if;
        return v_lines || jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description);
      end if;

      if p_transaction.expense_account_id is not null then
        return jsonb_build_array(
          jsonb_build_object('account_id', p_transaction.expense_account_id, 'debit', v_amount, 'description', p_description),
          jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description)
        );
      end if;
    end if;
    return jsonb_build_array(
      jsonb_build_object('system_role', v_expense_role::text, 'debit', v_amount, 'description', p_description),
      jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description)
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
    jsonb_build_object('system_role', v_role::text, 'debit', v_amount, 'description', p_description || ' (entrada)'),
    jsonb_build_object('system_role', v_pair_role::text, 'credit', v_amount, 'description', p_description || ' (salida)')
  );
end;
$$;

revoke all on function public.build_transaction_journal_lines(public.transactions, text) from public, anon, authenticated;

-- 4. record_loan_bank_payments: same as 20261107220000 with the loan's own
--    capital role. --------------------------------------------------------------

create or replace function public.record_loan_bank_payments(
  p_loan_id uuid,
  p_payments jsonb,
  p_book_from date,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan        public.loans%rowtype;
  v_fiscal      boolean;
  v_payment     record;
  v_id          uuid;
  v_entry       uuid;
  v_paid_out    boolean;
  v_inserted    int := 0;
  v_booked      int := 0;
  v_description text;
  v_lines       jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para cargar pagos de préstamos'
      using errcode = '42501';
  end if;

  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'El préstamo no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  select c.is_fiscal into v_fiscal
    from public.invoicing_channels c where c.id = v_loan.channel_id;

  for v_payment in
    select * from jsonb_to_recordset(p_payments) as p(
      receipt_number text, paid_date date, installment_number integer,
      total numeric, capital numeric, interest numeric, late_interest numeric,
      iva numeric, iva_perception numeric, iibb_perception numeric
    )
    order by paid_date, receipt_number
  loop
    insert into public.loan_bank_payments (
      loan_id, receipt_number, paid_date, installment_number, total,
      capital, interest, late_interest, iva, iva_perception, iibb_perception,
      created_by
    ) values (
      p_loan_id, v_payment.receipt_number, v_payment.paid_date,
      v_payment.installment_number, v_payment.total,
      coalesce(v_payment.capital, 0), coalesce(v_payment.interest, 0),
      coalesce(v_payment.late_interest, 0), coalesce(v_payment.iva, 0),
      coalesce(v_payment.iva_perception, 0),
      coalesce(v_payment.iibb_perception, 0),
      p_user_id
    )
    on conflict (loan_id, receipt_number) do nothing
    returning id into v_id;

    if v_id is null then
      continue;
    end if;
    v_inserted := v_inserted + 1;

    select i.paid_outside into v_paid_out
      from public.loan_installments i
     where i.loan_id = p_loan_id and i.number = v_payment.installment_number;

    if coalesce(v_fiscal, false)
       and coalesce(v_paid_out, false)
       and v_payment.paid_date >= p_book_from then
      v_description := 'Cuota ' || v_payment.installment_number || ' — '
        || v_loan.description
        || coalesce(' ' || v_loan.loan_number, '')
        || ' (comprobante ' || v_payment.receipt_number || ')';
      v_lines := jsonb_build_array(
        jsonb_build_object('system_role', 'banco',
          'credit', v_payment.total, 'description', v_description)
      );
      if coalesce(v_payment.capital, 0) > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'system_role', public.loan_liability_role(p_loan_id)::text, 'debit', v_payment.capital,
          'description', v_description || ' — capital'));
      end if;
      if coalesce(v_payment.interest, 0) + coalesce(v_payment.late_interest, 0) > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'system_role', 'intereses_pagados',
          'debit', coalesce(v_payment.interest, 0) + coalesce(v_payment.late_interest, 0),
          'description', v_description || ' — intereses'));
      end if;
      if coalesce(v_payment.iva, 0) > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'system_role', 'iva_credito', 'debit', v_payment.iva,
          'description', v_description || ' — IVA'));
      end if;
      if coalesce(v_payment.iva_perception, 0) > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'system_role', 'percepciones_iva_pagadas', 'debit', v_payment.iva_perception,
          'description', v_description || ' — percepción IVA'));
      end if;
      if coalesce(v_payment.iibb_perception, 0) > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'system_role', 'percepciones_iibb_pagadas', 'debit', v_payment.iibb_perception,
          'description', v_description || ' — percepción IIBB'));
      end if;

      v_entry := public.create_journal_entry(
        v_payment.paid_date,
        to_char(v_payment.paid_date, 'YYYY-MM'),
        v_description,
        v_lines,
        'loan_bank_payments',
        v_id,
        v_loan.channel_id
      );
      update public.loan_bank_payments set journal_entry_id = v_entry where id = v_id;
      v_booked := v_booked + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'booked', v_booked);
end;
$$;

-- Called by the app's gated action with the service role.
revoke all on function public.record_loan_bank_payments(uuid, jsonb, date, uuid)
  from public, anon, authenticated;

-- 5. record_loan_disbursement: same as 20261103040100, refusing a plan. ------

create or replace function public.record_loan_disbursement(
  p_loan_id        uuid,
  p_account_id     uuid default null,
  p_date           date default null,
  p_transaction_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan         public.loans;
  v_tx           public.transactions;
  v_account_type text;
  v_tx_id        uuid;
begin
  -- Role guard (accounting:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar el desembolso de un préstamo'
      using errcode = '42501';
  end if;

  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.id is null then
    raise exception 'El préstamo no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_loan.status = 'cancelled' then
    raise exception 'El préstamo está anulado'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_loan.kind = 'plan_ahorro' then
    raise exception 'Un plan de ahorro no tiene desembolso'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_loan.disbursement_transaction_id is not null then
    raise exception 'El desembolso de este préstamo ya está registrado'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if p_transaction_id is null then
    if p_date is null then
      raise exception 'Indicá la fecha del desembolso'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    select a.type into v_account_type from public.accounts a where a.id = p_account_id;
    if not found then
      raise exception 'La cuenta del desembolso no existe'
        using errcode = '23503', hint = 'jouve_guard';
    end if;
    if v_account_type in ('checks', 'echeq') then
      raise exception 'Los movimientos en cuentas de cheques se manejan desde Cheques (cargar, depositar, endosar)'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, created_by
    ) values (
      p_account_id, v_loan.channel_id, 'income', v_loan.principal, v_loan.currency, p_date,
      date_trunc('month', p_date)::date,
      'Desembolso — ' || v_loan.description,
      auth.uid()
    )
    returning id into v_tx_id;
  else
    select * into v_tx from public.transactions where id = p_transaction_id for update;
    if v_tx.id is null then
      raise exception 'El movimiento no existe'
        using errcode = '23503', hint = 'jouve_guard';
    end if;
    if v_tx.kind <> 'income' or not public.transaction_is_loose(v_tx) then
      raise exception 'Solo se puede usar un ingreso manual de caja (no uno generado por otro documento)'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if v_tx.channel_id is distinct from v_loan.channel_id
       or v_tx.currency is distinct from v_loan.currency
       or v_tx.amount <> v_loan.principal then
      raise exception 'El ingreso tiene que ser del mismo canal, moneda e importe que el capital del préstamo (%)', v_loan.principal
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_tx_id := v_tx.id;
  end if;

  update public.loans set disbursement_transaction_id = v_tx_id where id = v_loan.id;

  -- Posted as a loose income; now the builder sees the loan.
  perform public.repost_journal('transactions', v_tx_id);
  return v_tx_id;
end;
$$;

revoke all on function public.record_loan_disbursement(uuid, uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.record_loan_disbursement(uuid, uuid, date, uuid) to authenticated, service_role;

-- book_loan_opening: same as 20261109120100, refusing a plan. ------------------

create or replace function public.book_loan_opening(
  p_loan_id uuid,
  p_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan      public.loans%rowtype;
  v_fiscal    boolean;
  v_owed      numeric;
  v_financed  numeric;
  v_equity    uuid;
  v_entry     uuid;
  v_desc      text;
  v_liability text;
  v_vehicle   boolean;
  v_lines     jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar la deuda de apertura'
      using errcode = '42501';
  end if;

  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'El préstamo no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_loan.kind = 'plan_ahorro' then
    raise exception 'Un plan de ahorro no tiene saldo de apertura: sus cuotas suman desde que se cargan'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_loan.opening_journal_entry_id is not null then
    raise exception 'La deuda de apertura de este préstamo ya está registrada'
      using errcode = '23505', hint = 'jouve_guard';
  end if;
  select c.is_fiscal into v_fiscal
    from public.invoicing_channels c where c.id = v_loan.channel_id;
  if not coalesce(v_fiscal, false) then
    raise exception 'Solo un préstamo del canal fiscal lleva asientos'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_loan.start_date is null then
    raise exception 'Cargá la fecha de alta del préstamo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_loan.disbursement_transaction_id is not null then
    raise exception 'El desembolso del préstamo ya está registrado en Caja'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  v_liability := public.loan_liability_role(p_loan_id)::text;
  v_financed := coalesce(v_loan.original_amount, v_loan.principal);
  -- A leasing brings the vehicle, not money: Rodados for the amount financed.
  v_vehicle := v_loan.kind = 'leasing'
    and exists (select 1 from public.chart_of_accounts where system_role = 'rodados' and is_active);

  -- Granted within the year: its disbursement (or the vehicle), on the date granted.
  if v_loan.start_date >= p_date then
    v_desc := case when v_vehicle then 'Alta del leasing — ' else 'Desembolso — ' end
      || v_loan.description || coalesce(' ' || v_loan.loan_number, '');
    v_entry := public.create_journal_entry(
      v_loan.start_date,
      to_char(v_loan.start_date, 'YYYY-MM'),
      v_desc,
      jsonb_build_array(
        jsonb_build_object('system_role', case when v_vehicle then 'rodados' else 'banco' end,
          'debit', v_financed, 'description', v_desc),
        jsonb_build_object('system_role', v_liability, 'credit', v_financed, 'description', v_desc)
      ),
      'loans',
      p_loan_id,
      v_loan.channel_id
    );
    update public.loans set opening_journal_entry_id = v_entry where id = p_loan_id;
    return v_entry;
  end if;

  -- What was still owed: the amount granted less the capital of the cuotas
  -- due before the date.
  select v_financed - coalesce(sum(coalesce(i.capital_amount, i.amount)), 0)
    into v_owed
    from public.loan_installments i
   where i.loan_id = p_loan_id and i.due_date < p_date;
  if v_owed <= 0 then
    raise exception 'El préstamo no tenía capital adeudado a esa fecha'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select a.id into v_equity
    from public.chart_of_accounts a
   where a.code = '3.2.1' and a.is_active;
  if v_equity is null then
    raise exception 'No hay una cuenta activa 3.2.1 Resultados no asignados en el plan de cuentas'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  v_desc := 'Deuda de apertura — ' || v_loan.description
    || coalesce(' ' || v_loan.loan_number, '');
  if v_vehicle then
    -- The vehicle at the amount financed; the capital already paid came out
    -- of earlier results.
    v_lines := jsonb_build_array(
      jsonb_build_object('system_role', 'rodados', 'debit', v_financed, 'description', v_desc),
      jsonb_build_object('system_role', v_liability, 'credit', v_owed, 'description', v_desc)
    );
    if v_financed > v_owed then
      v_lines := v_lines || jsonb_build_object('account_id', v_equity,
        'credit', v_financed - v_owed, 'description', v_desc);
    end if;
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_equity, 'debit', v_owed, 'description', v_desc),
      jsonb_build_object('system_role', v_liability, 'credit', v_owed, 'description', v_desc)
    );
  end if;
  v_entry := public.create_journal_entry(
    p_date,
    to_char(p_date, 'YYYY-MM'),
    v_desc,
    v_lines,
    'loans',
    p_loan_id,
    v_loan.channel_id
  );
  update public.loans set opening_journal_entry_id = v_entry where id = p_loan_id;
  return v_entry;
end;
$$;

revoke all on function public.book_loan_opening(uuid, date)
  from public, anon, authenticated;
