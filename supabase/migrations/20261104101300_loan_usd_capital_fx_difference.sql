SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Diferencia de cambio on the capital of a USD loan cuota (audit w2-s2 F6).
--
-- A USD disbursement credits prestamos at the rate of its day; each cuota's
-- capital debited prestamos at the rate of its payment day, so a USD loan
-- repaid at another rate never brought prestamos to zero in pesos and the
-- difference never reached the result.
--
--   1. loan_capital_journal_lines: the lines of a cuota's capital, already
--      in pesos at the payment's rate. For a USD cuota of a loan whose
--      disbursement movement is in USD, prestamos goes down at the
--      disbursement's rate (what it was credited at) and the difference is
--      diferencia_cambio (debit = loss, credit = gain), only while an active
--      account holds the role (the rule of 20261104094300). With no
--      disbursement movement (an imported loan), an unknown rate, equal rates
--      or no such account, it is the old single prestamos line.
--   2. build_transaction_journal_lines (20261104093100, every case kept):
--      the split and the unsplit cuota take their capital lines from 1.
--
-- Existing rows are not touched: cuotas already paid keep their entry until
-- something re-posts them (docs/pendientes.md).
--
-- Rollback: older code calls the same function; older SQL posts as before.

create function public.loan_capital_journal_lines(
  p_loan_id     uuid,
  p_capital     numeric,
  p_rate        numeric,
  p_currency    text,
  p_description text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_disb_rate numeric;
  v_prestamos numeric := p_capital;
  v_fx        numeric := 0;
begin
  if p_capital <= 0 then
    return '[]'::jsonb;
  end if;
  if p_currency = 'USD'
     and exists (select 1 from public.chart_of_accounts
                  where system_role = 'diferencia_cambio' and is_active) then
    select public.get_exchange_rate('USD', d.transaction_date) into v_disb_rate
      from public.loans l
      join public.transactions d on d.id = l.disbursement_transaction_id
     where l.id = p_loan_id
       and d.currency = 'USD';
    if v_disb_rate is not null and v_disb_rate <> p_rate then
      v_prestamos := round(p_capital * v_disb_rate / p_rate, 2);
      v_fx := p_capital - v_prestamos;
    end if;
  end if;
  return jsonb_build_array(jsonb_build_object('system_role', 'prestamos', 'debit', v_prestamos,
           'description', p_description || ' — capital'))
    || case
         when v_fx > 0 then jsonb_build_array(jsonb_build_object('system_role', 'diferencia_cambio',
           'debit', v_fx, 'description', p_description || ' — diferencia de cambio'))
         when v_fx < 0 then jsonb_build_array(jsonb_build_object('system_role', 'diferencia_cambio',
           'credit', -v_fx, 'description', p_description || ' — diferencia de cambio'))
         else '[]'::jsonb
       end;
end;
$$;

comment on function public.loan_capital_journal_lines(uuid, numeric, numeric, text, text) is
  'Líneas del capital de una cuota de préstamo (en pesos al tipo del pago): préstamos al tipo del desembolso y la diferencia a diferencia de cambio, en un préstamo en dólares. Interna (build_transaction_journal_lines).';

revoke all on function public.loan_capital_journal_lines(uuid, numeric, numeric, text, text) from public, anon, authenticated;

-- Same as 20261104093100 except that the capital lines come from
-- loan_capital_journal_lines.
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

  if p_transaction.kind = 'income' then
    -- A check a client handed over without a receipt pays on account: it
    -- credits clientes, like a receipt with no allocation. A loan
    -- disbursement is a liability; an employee's payment settles what they owe.
    return jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', v_amount, 'description', p_description),
      jsonb_build_object(
        'system_role',
        case
          when p_transaction.manual_check_id is not null
               and p_transaction.counterparty_client_id is not null then 'clientes'
          when exists (select 1 from public.loans l where l.disbursement_transaction_id = p_transaction.id)
            then 'prestamos'
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
        v_interest := round((v_inst.interest_amount + v_inst.other_charges_amount) * v_rate, 2);
        v_iva := round(v_inst.iva_amount * v_rate, 2);
        v_perception := round(v_inst.perception_amount * v_rate, 2);
        v_capital := v_amount - v_interest - v_iva - v_perception;
        if v_capital < 0 then
          v_interest := v_interest + v_capital;
          v_capital := 0;
        end if;
        v_lines := public.loan_capital_journal_lines(
          v_inst.loan_id, v_capital, v_rate, p_transaction.currency, p_description);
        if v_interest > 0 then
          v_lines := v_lines || jsonb_build_object(
            'system_role',
            case when exists (select 1 from public.chart_of_accounts
                               where system_role = 'intereses_pagados' and is_active)
                 then 'intereses_pagados' else 'gastos' end,
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
        return v_lines || jsonb_build_object('system_role', v_role::text, 'credit', v_amount, 'description', p_description);
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
            v_lines := v_lines || jsonb_build_object(
              'system_role',
              case when exists (select 1 from public.chart_of_accounts
                                 where system_role = 'intereses_pagados' and is_active)
                   then 'intereses_pagados' else 'gastos' end,
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
