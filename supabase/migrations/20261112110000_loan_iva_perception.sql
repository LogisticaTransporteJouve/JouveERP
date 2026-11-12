SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A cuota's perception splits into IVA and IIBB, as the bank's statement
-- shows them: the IVA part goes to percepciones_iva_pagadas (a pago a cuenta
-- of IVA), the rest to percepciones_iibb_pagadas as before.
--
-- 1. loan_installments.iva_perception_amount: the IVA part of
--    perception_amount, which keeps meaning the total (the split check and
--    older code unchanged). No cross-column check: older code that clears the
--    split is not refused, and the builder clamps the IVA part to the total.
-- 2. guard_loan_installment_paid (20261103040100): freezes the new column of a
--    paid cuota too.
-- 3. build_transaction_journal_lines (20261112100100, every case kept): a split
--    cuota posts its IVA part to percepciones_iva_pagadas (while an active
--    account holds the role) and the rest to percepciones_iibb_pagadas. A
--    cuota without an IVA part posts as before.
-- 4. set_loan_installment_charges (20261109120100) and create_loan_core
--    (20261107210000): take the IVA part as key iva_perception, never more
--    than perception (the total).
-- 5. loan_iva_perceptions(from, to): the IVA perceptions loan cuotas and bank
--    receipts debited in a date range, for the IVA estimate.
--
-- Forward only: no cuota is reposted. Rollback: older code writes only
-- perception_amount; a stale IVA part is clamped to it.

-- 1. Column --------------------------------------------------------------------

alter table public.loan_installments
  add column iva_perception_amount numeric(14, 2)
    constraint loan_installments_iva_perception_check
    check (iva_perception_amount is null or iva_perception_amount >= 0);

comment on column public.loan_installments.iva_perception_amount is
  'Parte IVA de perception_amount (el total de percepciones de la cuota): va a percepciones IVA sufridas; el resto, a percepciones IIBB.';

-- 2. A paid cuota keeps its IVA part ---------------------------------------------

create or replace function public.guard_loan_installment_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pagada'
     and (new.amount                  is distinct from old.amount
       or new.capital_amount          is distinct from old.capital_amount
       or new.interest_amount         is distinct from old.interest_amount
       or new.iva_amount              is distinct from old.iva_amount
       or new.perception_amount       is distinct from old.perception_amount
       or new.iva_perception_amount   is distinct from old.iva_perception_amount
       or new.other_charges_amount    is distinct from old.other_charges_amount
       or new.transaction_id          is distinct from old.transaction_id) then
    raise exception 'No se puede cambiar el importe, el desglose ni el movimiento de una cuota pagada'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_loan_installment_paid() from public, anon, authenticated;

-- 3. build_transaction_journal_lines: same as 20261112100100 plus the IVA part
--    of a cuota's perception. -----------------------------------------------------

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
  v_perc_iva     numeric;
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
        -- The IVA part of the perception, never more than the total (older
        -- code writes only the total). Without an active account for the
        -- role it stays with the IIBB part.
        v_perc_iva := case when exists (select 1 from public.chart_of_accounts
                                         where system_role = 'percepciones_iva_pagadas' and is_active)
                           then round(least(coalesce(v_inst.iva_perception_amount, 0),
                                            v_inst.perception_amount) * v_rate, 2)
                           else 0 end;
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
        if v_perception - v_perc_iva > 0 then
          v_lines := v_lines || jsonb_build_object('system_role', 'percepciones_iibb_pagadas',
            'debit', v_perception - v_perc_iva, 'description', p_description || ' — percepción IIBB');
        end if;
        if v_perc_iva > 0 then
          v_lines := v_lines || jsonb_build_object('system_role', 'percepciones_iva_pagadas',
            'debit', v_perc_iva, 'description', p_description || ' — percepción IVA');
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

-- 4. The RPCs that write a cuota's split ------------------------------------------

create or replace function public.set_loan_installment_charges(
  p_installment_id uuid,
  p_split jsonb,
  p_charges jsonb
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capital    numeric := (p_split ->> 'capital')::numeric;
  v_interest   numeric := (p_split ->> 'interest')::numeric;
  v_iva        numeric := (p_split ->> 'iva')::numeric;
  v_perception numeric := coalesce((p_split ->> 'perception')::numeric, 0);
  v_perc_iva   numeric := coalesce((p_split ->> 'iva_perception')::numeric, 0);
  v_other      numeric;
  v_amount     numeric;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para cambiar cuotas de préstamos'
      using errcode = '42501';
  end if;

  if v_capital is null or v_interest is null or v_iva is null
     or v_capital < 0 or v_interest < 0 or v_iva < 0 or v_perception < 0 then
    raise exception 'El desglose de la cuota tiene que tener capital, interés e IVA, ninguno negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if v_perc_iva < 0 or v_perc_iva > v_perception then
    raise exception 'La percepción de IVA no puede ser negativa ni mayor que el total de percepciones'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_charges is null or jsonb_typeof(p_charges) <> 'array' then
    raise exception 'Los cargos de la cuota son una lista'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_charges) as c(chart_account_id uuid)
     where c.chart_account_id is not null
       and not exists (select 1 from public.chart_of_accounts a
                        where a.id = c.chart_account_id and a.is_active)
  ) then
    raise exception 'La cuenta de un cargo no existe o está inactiva'
      using errcode = '23503', hint = 'jouve_guard';
  end if;

  perform 1 from public.loan_installments i
   where i.id = p_installment_id and i.status = 'pendiente'
     for update;
  if not found then
    raise exception 'La cuota no existe o ya está pagada'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  delete from public.loan_installment_charges where installment_id = p_installment_id;
  insert into public.loan_installment_charges (
    installment_id, concept, description, amount, iva_amount, chart_account_id
  )
  select p_installment_id, c.concept, nullif(btrim(c.description), ''),
         round(c.amount, 2), round(coalesce(c.iva_amount, 0), 2), c.chart_account_id
    from jsonb_to_recordset(p_charges) as c(
           concept text, description text, amount numeric, iva_amount numeric,
           chart_account_id uuid
         );

  select coalesce(sum(amount + iva_amount), 0) into v_other
    from public.loan_installment_charges where installment_id = p_installment_id;
  v_amount := round(v_capital, 2) + round(v_interest, 2) + round(v_iva, 2)
            + round(v_perception, 2) + v_other;
  if v_amount <= 0 then
    raise exception 'El monto de la cuota tiene que ser mayor a 0'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  update public.loan_installments
     set amount = v_amount,
         capital_amount = round(v_capital, 2),
         interest_amount = round(v_interest, 2),
         iva_amount = round(v_iva, 2),
         perception_amount = round(v_perception, 2),
         iva_perception_amount = nullif(round(v_perc_iva, 2), 0),
         other_charges_amount = v_other
   where id = p_installment_id;

  return v_amount;
end;
$$;

comment on function public.set_loan_installment_charges(uuid, jsonb, jsonb) is
  'Desglose y cargos de una cuota pendiente, como los muestra el resumen del dador: el importe es su suma (perception es el total de percepciones; iva_perception, su parte IVA). La acción de la app (accounting:write) lo llama con el service role.';

revoke all on function public.set_loan_installment_charges(uuid, jsonb, jsonb)
  from public, anon, authenticated;

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
begin
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

-- 5. IVA perceptions of loans, for the IVA estimate --------------------------------

create or replace function public.loan_iva_perceptions(p_from date, p_to date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(l.debit - l.credit), 0)
    from public.journal_entry_lines l
    join public.journal_entries je on je.id = l.journal_entry_id
    join public.chart_of_accounts a on a.id = l.chart_of_accounts_id
   where a.system_role = 'percepciones_iva_pagadas'
     and je.entry_date between p_from and p_to
     and (je.source_table = 'loan_bank_payments'
          or (je.source_table = 'transactions'
              and exists (select 1 from public.loan_installments i
                           where i.transaction_id = je.source_id)));
$$;

comment on function public.loan_iva_perceptions(date, date) is
  'Percepciones de IVA que debitaron las cuotas de préstamos y los recibos del banco entre dos fechas (las anulaciones restan). La resta la estimación de IVA.';

revoke all on function public.loan_iva_perceptions(date, date) from public, anon;
grant execute on function public.loan_iva_perceptions(date, date) to authenticated, service_role;
