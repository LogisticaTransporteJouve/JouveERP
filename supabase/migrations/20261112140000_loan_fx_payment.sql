SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A USD cuota paid from a peso account at the day's rate, and the columns of
-- open-ended (interest-only) loans (20261112140100 adds their functions).
--
-- 1. Columns: loans.is_open_ended + monthly_rate (% per month);
--    loan_installments.kind ('cuota' | 'devolucion_capital'),
--    paid_amount_ars + paid_rate. amount, the split and paid_amount stay in
--    the loan's currency; the movement is in its account's currency;
--    paid_amount_ars / paid_rate are set only when the two differ.
-- 2. guard_loan_installment_paid (20261112110000): a paid cuota also freezes
--    kind, paid_amount_ars and paid_rate. relink_loan_installment_payment
--    (service_role only, a data step) may link a cuota paid before the loan
--    was loaded: it sets its movement, split and rate, never its amount.
-- 3. pay_loan_installment: the 4-arg signature becomes a wrapper of a new
--    5-arg one (p_account_amount). Same currency: as before (the 5th
--    argument is null). USD loan + ARS account: the whole cuota in dollars,
--    the movement in pesos for p_account_amount, the implied rate within
--    ±20 % of the official one when it is loaded. ARS loan + USD account:
--    refused. An open-ended loan never closes by paying a cuota: it extends.
-- 4. adopt_loan_installment_payment: its body moves to an internal core
--    (no grant) that also takes a peso expense for a USD cuota, and that
--    relink calls for a cuota paid before the loan was loaded.
-- 5. build_transaction_journal_lines (20261112110000, every case kept): the
--    cuota branch converts the cuota at its own paid_rate when the movement
--    is in pesos and the cuota in dollars, and compares the cuota with
--    paid_amount; the capital lines take the loan's currency. A same-currency
--    cuota posts exactly as before.
-- 6. guard_loan_installment_payment / guard_loan (20261107210000): the new
--    writers are whitelisted; paid_outside changes only under relink; a loan
--    is closed by repay_loan_capital too.
--
-- Rollback: older code calls the unchanged 4-arg signature and ignores the
-- new columns (all nullable or defaulted).

-- 1. Columns ----------------------------------------------------------------------

alter table public.loans
  add column is_open_ended boolean not null default false,
  add column monthly_rate numeric(7, 4);

alter table public.loans
  add constraint loans_monthly_rate_check
    check (monthly_rate is null or monthly_rate between 0 and 100) not valid;
alter table public.loans validate constraint loans_monthly_rate_check;

alter table public.loans
  add constraint loans_open_ended_check
    check (not is_open_ended or (monthly_rate is not null and kind = 'prestamo')) not valid;
alter table public.loans validate constraint loans_open_ended_check;

comment on column public.loans.is_open_ended is
  'Préstamo sin vencimiento: solo se pagan intereses mensuales (siempre hay 3 cuotas próximas) y el capital vuelve con «Devolución de capital».';
comment on column public.loans.monthly_rate is
  'Interés mensual en % de un préstamo sin vencimiento, sobre el capital que se sigue debiendo.';

alter table public.loan_installments
  add column kind text not null default 'cuota',
  add column paid_amount_ars numeric(14, 2),
  add column paid_rate numeric(14, 6);

alter table public.loan_installments
  add constraint loan_installments_kind_check
    check (kind in ('cuota', 'devolucion_capital')) not valid;
alter table public.loan_installments validate constraint loan_installments_kind_check;

alter table public.loan_installments
  add constraint loan_installments_paid_ars_check
    check ((paid_amount_ars is null) = (paid_rate is null)) not valid;
alter table public.loan_installments validate constraint loan_installments_paid_ars_check;

alter table public.loan_installments
  add constraint loan_installments_paid_rate_check
    check (paid_rate is null or paid_rate > 0) not valid;
alter table public.loan_installments validate constraint loan_installments_paid_rate_check;

comment on column public.loan_installments.kind is
  'cuota (la del cronograma o el interés de un préstamo sin vencimiento) o devolucion_capital (capital devuelto de un préstamo sin vencimiento).';
comment on column public.loan_installments.paid_amount_ars is
  'Pesos que salieron de la cuenta cuando una cuota en dólares se pagó desde una cuenta en pesos; null si la cuenta está en la moneda del préstamo.';
comment on column public.loan_installments.paid_rate is
  'Cotización implícita de ese pago (paid_amount_ars / paid_amount); null si la cuenta está en la moneda del préstamo.';

-- 2. A paid cuota keeps its amounts; relink sets a pre-loaded one's link ------------

create or replace function public.guard_loan_installment_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if old.status = 'pagada'
     and (new.amount                  is distinct from old.amount
       or new.capital_amount          is distinct from old.capital_amount
       or new.interest_amount         is distinct from old.interest_amount
       or new.iva_amount              is distinct from old.iva_amount
       or new.perception_amount       is distinct from old.perception_amount
       or new.iva_perception_amount   is distinct from old.iva_perception_amount
       or new.other_charges_amount    is distinct from old.other_charges_amount
       or new.transaction_id          is distinct from old.transaction_id
       or new.kind                    is distinct from old.kind
       or new.paid_amount_ars         is distinct from old.paid_amount_ars
       or new.paid_rate               is distinct from old.paid_rate) then
    -- Linking the movement of a cuota paid before the loan was loaded (a
    -- data step, service_role only) sets its movement, split and rate; its
    -- amount never changes.
    if new.amount is not distinct from old.amount
       and new.kind is not distinct from old.kind then
      get diagnostics v_stack = pg_context;
      if v_stack ~ 'function (public\.)?relink_loan_installment_payment\(' then
        return new;
      end if;
    end if;
    raise exception 'No se puede cambiar el importe, el desglose ni el movimiento de una cuota pagada'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_loan_installment_paid() from public, anon, authenticated;

-- 3. Paying a cuota, possibly from an account in another currency --------------------

create or replace function public.pay_loan_installment(
  p_installment_id uuid,
  p_paid_date      date,
  p_account_id     uuid,
  p_amount         numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Role guard (accounting:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar pagos de cuotas'
      using errcode = '42501';
  end if;

  return public.pay_loan_installment(p_installment_id, p_paid_date, p_account_id, p_amount, null);
end;
$$;

revoke all on function public.pay_loan_installment(uuid, date, uuid, numeric) from public, anon, authenticated;
grant execute on function public.pay_loan_installment(uuid, date, uuid, numeric) to authenticated, service_role;

-- 4. Adopting an expense already loaded as a cuota's payment ---------------------------

create function public.adopt_loan_installment_payment_core(
  p_installment_id     uuid,
  p_transaction_id     uuid,
  p_allow_paid_outside boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst     public.loan_installments;
  v_loan     public.loans;
  v_tx       public.transactions;
  v_paid     numeric;
  v_ars      numeric;
  v_rate     numeric;
  v_official numeric;
  v_relink   boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar pagos de cuotas'
      using errcode = '42501';
  end if;

  -- A pending cuota, or (relink only) one paid before the loan was loaded
  -- whose paid_outside flag relink has just cleared.
  select * into v_inst from public.loan_installments
   where id = p_installment_id
     and (status = 'pendiente'
          or (coalesce(p_allow_paid_outside, false)
              and status = 'pagada' and transaction_id is null and not paid_outside))
     for update;
  if v_inst.id is null then
    raise exception 'La cuota no existe o ya está pagada'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  v_relink := v_inst.status = 'pagada';

  select * into v_loan from public.loans where id = v_inst.loan_id for update;
  if v_loan.status = 'cancelled' then
    raise exception 'El préstamo está anulado: no se pueden pagar sus cuotas'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_tx from public.transactions where id = p_transaction_id for update;
  if v_tx.id is null then
    raise exception 'El movimiento no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_tx.kind <> 'expense' or not public.transaction_is_loose(v_tx) then
    raise exception 'Solo se puede usar un egreso manual de caja (no uno generado por otro documento)'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_tx.channel_id is distinct from v_loan.channel_id then
    raise exception 'El egreso es de otro canal que el préstamo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if v_tx.currency = v_loan.currency then
    if v_inst.capital_amount is not null and v_tx.amount <> v_inst.amount then
      raise exception 'La cuota tiene desglose: el egreso tiene que ser de su importe (%)', v_inst.amount
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_paid := v_tx.amount;
  elsif v_loan.currency = 'USD' and v_tx.currency = 'ARS' then
    -- A USD cuota paid in pesos: whole, at the rate the pesos imply.
    if v_inst.amount <= 0 then
      raise exception 'La cuota no tiene importe en dólares para calcular la cotización'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_paid := v_inst.amount;
    v_ars := v_tx.amount;
    v_rate := round(v_tx.amount / v_inst.amount, 6);
    v_official := public.get_exchange_rate('USD', v_tx.transaction_date);
    if v_official is not null and abs(v_rate - v_official) > v_official * 0.2 then
      raise exception 'La cotización implícita (%) está lejos de la oficial (%)', v_rate, v_official
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  else
    raise exception 'El egreso está en otra moneda que el préstamo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- The cuota decides the entry from now on, not the expense account.
  if v_tx.expense_account_id is not null then
    update public.transactions set expense_account_id = null where id = v_tx.id;
  end if;

  update public.loan_installments
     set status = 'pagada',
         paid_date = v_tx.transaction_date,
         paid_amount = v_paid,
         paid_amount_ars = v_ars,
         paid_rate = v_rate,
         transaction_id = v_tx.id,
         -- A pre-loaded cuota with no split is interest only (its loan's
         -- capital comes back with «Devolución de capital»).
         capital_amount = case when v_relink and v_inst.capital_amount is null
                               then 0 else capital_amount end,
         interest_amount = case when v_relink and v_inst.capital_amount is null
                                then amount else interest_amount end,
         iva_amount = case when v_relink and v_inst.capital_amount is null
                           then 0 else iva_amount end,
         perception_amount = case when v_relink and v_inst.capital_amount is null
                                  then 0 else perception_amount end,
         other_charges_amount = case when v_relink and v_inst.capital_amount is null
                                     then 0 else other_charges_amount end
   where id = v_inst.id;

  if v_loan.is_open_ended then
    if v_loan.principal - coalesce((
         select sum(i.capital_amount) from public.loan_installments i
          where i.loan_id = v_loan.id and i.status = 'pagada'), 0) > 0 then
      perform public.extend_open_ended_loan(v_loan.id);
    elsif not exists (
      select 1 from public.loan_installments
       where loan_id = v_loan.id and status = 'pendiente'
    ) then
      update public.loans set status = 'paid' where id = v_loan.id;
    end if;
  elsif not exists (
    select 1 from public.loan_installments
     where loan_id = v_loan.id and status = 'pendiente'
  ) then
    update public.loans set status = 'paid' where id = v_loan.id;
  end if;

  perform public.repost_journal('transactions', v_tx.id);
end;
$$;

comment on function public.adopt_loan_installment_payment_core(uuid, uuid, boolean) is
  'Interna: usa un egreso suelto como pago de una cuota (misma moneda, o pesos para una cuota en dólares). La llaman adopt_loan_installment_payment y relink_loan_installment_payment; sin grant.';

revoke all on function public.adopt_loan_installment_payment_core(uuid, uuid, boolean)
  from public, anon, authenticated;

create or replace function public.adopt_loan_installment_payment(
  p_installment_id uuid,
  p_transaction_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Role guard (accounting:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar pagos de cuotas'
      using errcode = '42501';
  end if;

  perform public.adopt_loan_installment_payment_core(p_installment_id, p_transaction_id, false);
end;
$$;

revoke all on function public.adopt_loan_installment_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.adopt_loan_installment_payment(uuid, uuid) to authenticated, service_role;

-- 5. build_transaction_journal_lines: same as 20261112110000, the cuota at its
--    own rate and amount. ----------------------------------------------------------

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
  v_inst_rate    numeric;
  v_paid         numeric;
  v_loan_currency text;
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
      -- A USD cuota paid in pesos converts at its own rate and is compared
      -- by what it paid in dollars; any other cuota, as the movement says.
      v_inst_rate := case when v_inst.paid_rate is not null and p_transaction.currency = 'ARS'
                          then v_inst.paid_rate else v_rate end;
      v_paid := case when v_inst.paid_rate is not null
                     then v_inst.paid_amount else p_transaction.amount end;
      select l.currency into v_loan_currency from public.loans l where l.id = v_inst.loan_id;
      v_loan_currency := coalesce(v_loan_currency, p_transaction.currency);
      -- A split cuota paid for its amount: each component converted and
      -- rounded once, the capital takes the rounding so the entry balances.
      if v_inst.id is not null
         and v_inst.capital_amount is not null
         and v_inst.amount = v_paid then
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
            v_charge_amt := round(v_charge.amount * v_inst_rate, 2);
            v_charge_iva := round(v_charge.iva_amount * v_inst_rate, 2);
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
          v_interest := round(v_inst.interest_amount * v_inst_rate, 2)
                      + greatest(0, round(v_inst.other_charges_amount * v_inst_rate, 2) - v_charges);
        else
          v_interest := round((v_inst.interest_amount + v_inst.other_charges_amount) * v_inst_rate, 2);
        end if;
        v_iva := round(v_inst.iva_amount * v_inst_rate, 2);
        v_perception := round(v_inst.perception_amount * v_inst_rate, 2);
        -- The IVA part of the perception, never more than the total (older
        -- code writes only the total). Without an active account for the
        -- role it stays with the IIBB part.
        v_perc_iva := case when exists (select 1 from public.chart_of_accounts
                                         where system_role = 'percepciones_iva_pagadas' and is_active)
                           then round(least(coalesce(v_inst.iva_perception_amount, 0),
                                            v_inst.perception_amount) * v_inst_rate, 2)
                           else 0 end;
        v_capital := v_amount - v_interest - v_iva - v_perception - v_charges;
        if v_capital < 0 then
          v_interest := v_interest + v_capital;
          v_capital := 0;
        end if;
        v_lines := public.loan_capital_journal_lines(
          v_inst.loan_id, v_capital, v_inst_rate, v_loan_currency, p_description);
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
                 v_inst.loan_id, v_amount, v_inst_rate, v_loan_currency, p_description)
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
        select greatest(0, least(v_paid, l.principal - coalesce((
                 select sum(coalesce(o.capital_amount, o.amount))
                   from public.loan_installments o
                  where o.loan_id = v_inst.loan_id
                    and o.number < v_inst.number
               ), 0)))
          into v_capital
          from public.loans l
         where l.id = v_inst.loan_id;
        v_capital := least(round(v_capital * v_inst_rate, 2), v_amount);
        v_interest := v_amount - v_capital;
        v_lines := public.loan_capital_journal_lines(
          v_inst.loan_id, v_capital, v_inst_rate, v_loan_currency, p_description);
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

-- 6. Guards: the new writers ------------------------------------------------------------

create or replace function public.guard_loan_installment_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    if (old.status <> 'pendiente'
        or old.paid_date is not null
        or old.paid_amount is not null
        or old.transaction_id is not null)
       and not old.paid_outside then
      raise exception 'No se puede borrar una cuota pagada: su pago queda en Caja y en el libro diario'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.paid_outside then
      get diagnostics v_stack = pg_context;
      if v_stack !~ 'function (public\.)?create_loan_core\(' then
        raise exception 'Una cuota pagada antes de cargar el préstamo se marca solo al crearlo'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
      return new;
    end if;
    if new.status <> 'pendiente'
       or new.paid_date is not null
       or new.paid_amount is not null
       or new.transaction_id is not null then
      raise exception 'Una cuota se carga pendiente: se paga después con «Pagar» o «Usar un egreso ya cargado»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  if new.loan_id is distinct from old.loan_id then
    raise exception 'Una cuota no se pasa a otro préstamo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- Only relink (service_role, a data step) turns a cuota paid before the
  -- loan was loaded into one paid with its real movement.
  if new.paid_outside is distinct from old.paid_outside then
    get diagnostics v_stack = pg_context;
    if not (old.paid_outside and not new.paid_outside
            and v_stack ~ 'function (public\.)?relink_loan_installment_payment\(') then
      raise exception 'Si una cuota se pagó antes de cargar el préstamo se decide solo al crearlo'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  end if;

  if new.number is distinct from old.number
     and (old.status <> 'pendiente'
          or old.paid_date is not null
          or old.paid_amount is not null
          or old.transaction_id is not null) then
    raise exception 'No se puede cambiar el número de una cuota pagada'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status         is not distinct from old.status
     and new.paid_date      is not distinct from old.paid_date
     and new.paid_amount    is not distinct from old.paid_amount
     and new.transaction_id is not distinct from old.transaction_id then
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;
  get diagnostics v_stack = pg_context;
  if v_stack ~ 'function (public\.)?(pay_loan_installment|adopt_loan_installment_payment|adopt_loan_installment_payment_core|relink_loan_installment_payment|repay_loan_capital)\(' then
    return new;
  end if;
  raise exception 'El estado, la fecha y el importe pagados y el movimiento de una cuota se cambian solo pagándola («Pagar» o «Usar un egreso ya cargado»)'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_loan_installment_payment()
  from public, anon, authenticated;

create or replace function public.guard_loan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'INSERT' then
    if new.disbursement_transaction_id is not null then
      raise exception 'El desembolso de un préstamo se registra solo con «Registrar desembolso»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if new.import_run_id is not null then
      get diagnostics v_stack = pg_context;
      if v_stack !~ 'function (public\.)?commit_import_run\(' then
        raise exception 'Un préstamo queda marcado como importado solo al importarlo desde «Importar datos»'
          using errcode = '55006', hint = 'jouve_guard';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.import_run_id is distinct from old.import_run_id then
    raise exception 'La importación de la que viene un préstamo no se cambia'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if tg_op = 'UPDATE'
     and old.disbursement_transaction_id is not null
     and new.disbursement_transaction_id is distinct from old.disbursement_transaction_id then
    raise exception 'El desembolso registrado de un préstamo no se puede cambiar'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if tg_op = 'UPDATE'
     and old.disbursement_transaction_id is null
     and new.disbursement_transaction_id is not null then
    get diagnostics v_stack = pg_context;
    if v_stack !~ 'function (public\.)?record_loan_disbursement\(' then
      raise exception 'El desembolso de un préstamo se registra solo con «Registrar desembolso»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  end if;

  -- A cuota paid before the loan was loaded left no movement: it does not
  -- hold the loan back.
  if (tg_op = 'DELETE'
      or (new.status = 'cancelled' and old.status is distinct from 'cancelled'))
     and (old.disbursement_transaction_id is not null
          or exists (select 1 from public.loan_installments i
                      where i.loan_id = old.id
                        and i.status = 'pagada'
                        and not i.paid_outside)) then
    raise exception 'No se puede anular el préstamo: tiene el desembolso registrado o cuotas pagadas, y sus movimientos quedarían en Caja y en el libro diario. Anulalo solo si se cargó por error y todavía no registró dinero.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if (new.principal   is distinct from old.principal
      or new.currency   is distinct from old.currency
      or new.channel_id is distinct from old.channel_id)
     and (old.disbursement_transaction_id is not null
          or old.import_run_id is not null
          or exists (select 1 from public.loan_installments i
                      where i.loan_id = old.id
                        and i.status = 'pagada'
                        and not i.paid_outside)) then
    raise exception 'El capital, la moneda y el canal de un préstamo no cambian una vez registrado su desembolso o pagada una cuota'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'active' and new.status = 'cancelled') then
    get diagnostics v_stack = pg_context;
    if not (old.status = 'active' and new.status = 'paid'
            and v_stack ~ 'function (public\.)?(pay_loan_installment|adopt_loan_installment_payment|adopt_loan_installment_payment_core|repay_loan_capital)\(') then
      raise exception 'Un préstamo queda pagado solo al pagar su última cuota, y anulado solo con «Anular»'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_loan()
  from public, anon, authenticated;

-- 3b. The 5-arg core (last, so the role-guard test reads it) -------------------------

create function public.pay_loan_installment(
  p_installment_id uuid,
  p_paid_date      date,
  p_account_id     uuid,
  p_amount         numeric,
  p_account_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number           int;
  v_loan_id          uuid;
  v_inst_amount      numeric;
  v_split            boolean;
  v_kind             text;
  v_description      text;
  v_currency         text;
  v_channel_id       text;
  v_count            int;
  v_loan_status      text;
  v_open_ended       boolean;
  v_principal        numeric;
  v_account_type     text;
  v_account_currency text;
  v_tx_amount        numeric;
  v_ars              numeric;
  v_rate             numeric;
  v_official         numeric;
  v_label            text;
  v_tx_id            uuid;
begin
  -- Role guard (accounting:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar pagos de cuotas'
      using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'El importe pagado tiene que ser mayor a cero'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select li.number, li.loan_id, li.amount, li.capital_amount is not null, li.kind
    into v_number, v_loan_id, v_inst_amount, v_split, v_kind
    from public.loan_installments li
   where li.id = p_installment_id
     and li.status = 'pendiente'
     for update;
  if not found then
    raise exception 'La cuota no existe o ya está pagada'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_split and p_amount <> v_inst_amount then
    raise exception 'La cuota tiene desglose: se paga por su importe (%). Corregí el desglose antes de pagar otro importe', v_inst_amount
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select l.description, l.currency, l.channel_id, l.installments_count, l.status::text,
         l.is_open_ended, l.principal
    into v_description, v_currency, v_channel_id, v_count, v_loan_status,
         v_open_ended, v_principal
    from public.loans l
   where l.id = v_loan_id
     for update;
  if v_loan_status = 'cancelled' then
    raise exception 'El préstamo está anulado: no se pueden pagar sus cuotas'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select a.type, a.currency into v_account_type, v_account_currency
    from public.accounts a where a.id = p_account_id;
  if not found then
    raise exception 'La cuenta de pago no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_account_type in ('checks', 'echeq') then
    raise exception 'Los movimientos en cuentas de cheques se manejan desde Cheques (cargar, depositar, endosar)'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if v_account_currency = v_currency then
    if p_account_amount is not null then
      raise exception 'La cuenta está en la moneda del préstamo: el pago no lleva monto en otra moneda'
        using errcode = '22023', hint = 'jouve_guard';
    end if;
    v_tx_amount := p_amount;
  elsif v_currency = 'USD' and v_account_currency = 'ARS' then
    if p_amount <> v_inst_amount then
      raise exception 'Una cuota en dólares pagada desde una cuenta en pesos se paga entera (USD %)', v_inst_amount
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if p_account_amount is null or p_account_amount <= 0 then
      raise exception 'Falta el monto en pesos que sale de la cuenta'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_rate := round(p_account_amount / p_amount, 6);
    v_official := public.get_exchange_rate('USD', p_paid_date);
    if v_official is not null and abs(v_rate - v_official) > v_official * 0.2 then
      raise exception 'La cotización implícita (%) está lejos de la oficial (%)', v_rate, v_official
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_tx_amount := p_account_amount;
    v_ars := p_account_amount;
  else
    raise exception 'Una cuota en pesos se paga desde una cuenta en pesos'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  v_label := case
               when v_kind = 'devolucion_capital' then 'Devolución de capital'
               when v_open_ended then 'Interés ' || v_number
               else 'Cuota ' || v_number || '/' || v_count
             end || ' — ' || v_description;

  insert into public.transactions (
    account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, created_by
  ) values (
    p_account_id, v_channel_id, 'expense', v_tx_amount, v_account_currency, p_paid_date,
    date_trunc('month', p_paid_date)::date,
    v_label,
    auth.uid()
  )
  returning id into v_tx_id;

  update public.loan_installments
     set status = 'pagada',
         paid_date = p_paid_date,
         paid_amount = p_amount,
         paid_amount_ars = v_ars,
         paid_rate = v_rate,
         transaction_id = v_tx_id
   where id = p_installment_id;

  -- An open-ended loan keeps its next cuotas while capital is owed; it
  -- closes only once its capital came back and nothing is pending.
  if v_open_ended then
    if v_principal - coalesce((
         select sum(i.capital_amount) from public.loan_installments i
          where i.loan_id = v_loan_id and i.status = 'pagada'), 0) > 0 then
      perform public.extend_open_ended_loan(v_loan_id);
    elsif not exists (
      select 1 from public.loan_installments
       where loan_id = v_loan_id and status = 'pendiente'
    ) then
      update public.loans set status = 'paid' where id = v_loan_id;
    end if;
  elsif not exists (
    select 1 from public.loan_installments
     where loan_id = v_loan_id and status = 'pendiente'
  ) then
    update public.loans set status = 'paid' where id = v_loan_id;
  end if;

  -- Posted at insert as a loose expense; now the builder sees the cuota.
  perform public.repost_journal('transactions', v_tx_id);

  return v_tx_id;
end;
$$;

comment on function public.pay_loan_installment(uuid, date, uuid, numeric, numeric) is
  'Paga una cuota pendiente. Misma moneda: p_account_amount null. Cuota en dólares desde una cuenta en pesos: la cuota entera (p_amount, USD) y los pesos que salen (p_account_amount); la cotización implícita queda en la cuota.';

revoke all on function public.pay_loan_installment(uuid, date, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.pay_loan_installment(uuid, date, uuid, numeric, numeric) to authenticated, service_role;
