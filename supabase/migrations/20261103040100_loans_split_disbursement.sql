SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 2.3 (D3, "Préstamos conectados").
--
--   1. COA: an active liability account takes the role prestamos (a new
--      2.1.x "Préstamos financieros" unless one already holds it) and 5.4.1
--      "Intereses pagados" takes intereses_pagados when free.
--   2. loan_installments.capital_amount / interest_amount / iva_amount /
--      perception_amount / other_charges_amount: the optional split of a
--      cuota. All NULL (every existing row) = no split, posted exactly as
--      before; all set = they add up to `amount`. A paid cuota keeps its
--      amount and split (guard_loan_installment_paid): its entry reads them.
--   3. loans.disbursement_transaction_id: the income the loan put in the bank.
--      record_loan_disbursement writes it (or adopts a manual income already
--      loaded) and it is owned by the loan from then on.
--   4. build_transaction_journal_lines: the payment of a split cuota debits
--      prestamos (capital), intereses_pagados (interest + other charges;
--      gastos while no active account holds the role), iva_credito and
--      percepciones_iibb_pagadas; credits the bank. A disbursement credits
--      prestamos instead of ajustes_caja. An unsplit cuota posts as before.
--   5. pay_loan_installment (same signature): a split cuota is paid for its
--      amount, and the movement re-posts once linked (it was posted at
--      insert, before the cuota pointed at it).
--   6. adopt_loan_installment_payment: a manual expense already loaded
--      becomes the payment of a pending cuota (no second movement): the cuota
--      is paid with the expense's date and amount, the movement is owned by
--      the cuota and re-posts.
--   7. guard_transaction_owned_by_document and v_transactions_tagged know the
--      disbursement ('loan_disbursement').
--   8. get_management_pnl (same signature and result): in devengado the
--      capital of a split cuota is loan_principal and its interest goes to
--      the bucket of its account (5.4.1 = costo financiero); an unsplit cuota
--      is all loan_principal, as before.
--
-- Rollback: older code never writes the new columns, so every cuota it pays
-- is unsplit and posts as before; editing the amount of a split cuota from
-- older code fails the split check instead of leaving it inconsistent.

-- 1. Chart of accounts -------------------------------------------------------------

do $$
declare
  v_parent uuid;
  v_code   text;
begin
  if not exists (
    select 1 from public.chart_of_accounts where system_role = 'prestamos' and is_active
  ) then
    select id into v_parent from public.chart_of_accounts where code = '2.1';
    if v_parent is not null then
      select '2.1.' || (coalesce(max(substring(code from '^2\.1\.([0-9]+)$')::int), 0) + 1)
        into v_code
        from public.chart_of_accounts
       where code ~ '^2\.1\.[0-9]+$';
      insert into public.chart_of_accounts (parent_id, code, name, level, account_type, system_role)
      values (v_parent, v_code, 'Préstamos financieros', 3, 'pasivo', 'prestamos');
    end if;
  end if;
end;
$$;

update public.chart_of_accounts
   set system_role = 'intereses_pagados'
 where code = '5.4.1'
   and is_active
   and system_role is null
   and not exists (
     select 1 from public.chart_of_accounts c
      where c.system_role = 'intereses_pagados' and c.is_active
   );

-- 2. Installment split -------------------------------------------------------------

alter table public.loan_installments
  add column capital_amount numeric(14, 2),
  add column interest_amount numeric(14, 2),
  add column iva_amount numeric(14, 2),
  add column perception_amount numeric(14, 2),
  add column other_charges_amount numeric(14, 2);

comment on column public.loan_installments.capital_amount is
  'Capital de la cuota (desglose opcional). NULL = sin desglose: el pago se asienta entero como gasto.';
comment on column public.loan_installments.interest_amount is
  'Interés de la cuota (desglose). Va a intereses_pagados.';
comment on column public.loan_installments.iva_amount is
  'IVA sobre el interés (desglose). Va a iva_credito.';
comment on column public.loan_installments.perception_amount is
  'Percepción cobrada por el banco (desglose). Va a percepciones_iibb_pagadas.';
comment on column public.loan_installments.other_charges_amount is
  'Otros cargos: sellos, punitorios (desglose). Van a intereses_pagados.';

alter table public.loan_installments
  add constraint loan_installments_split_check check (
    (capital_amount is null and interest_amount is null and iva_amount is null
     and perception_amount is null and other_charges_amount is null)
    or (capital_amount >= 0 and interest_amount >= 0 and iva_amount >= 0
        and perception_amount >= 0 and other_charges_amount >= 0
        and capital_amount + interest_amount + iva_amount + perception_amount
            + other_charges_amount = amount)
  ) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.loan_installments validate constraint loan_installments_split_check;

create function public.guard_loan_installment_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pagada'
     and (new.amount               is distinct from old.amount
       or new.capital_amount       is distinct from old.capital_amount
       or new.interest_amount      is distinct from old.interest_amount
       or new.iva_amount           is distinct from old.iva_amount
       or new.perception_amount    is distinct from old.perception_amount
       or new.other_charges_amount is distinct from old.other_charges_amount
       or new.transaction_id       is distinct from old.transaction_id) then
    raise exception 'No se puede cambiar el importe, el desglose ni el movimiento de una cuota pagada'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_loan_installment_paid() from public, anon, authenticated;

create trigger loan_installments_guard_paid
  before update on public.loan_installments
  for each row execute function public.guard_loan_installment_paid();

-- 3. Disbursement --------------------------------------------------------------------

alter table public.loans
  -- squawk-ignore adding-foreign-key-constraint
  add column disbursement_transaction_id uuid references public.transactions (id) on delete restrict;

comment on column public.loans.disbursement_transaction_id is
  'Ingreso del desembolso en el banco (record_loan_disbursement). Su asiento acredita el pasivo prestamos.';

-- squawk-ignore require-concurrent-index-creation
create unique index loans_disbursement_transaction_idx
  on public.loans (disbursement_transaction_id) where disbursement_transaction_id is not null;

-- 4. Journal lines --------------------------------------------------------------------

-- Same as 20261103010000 plus the loan branches: a disbursement credits
-- prestamos; the payment of a split cuota debits each component.
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

  if p_transaction.kind = 'income' then
    -- A check a client handed over without a receipt pays on account: it
    -- credits clientes, like a receipt with no allocation. A loan
    -- disbursement is a liability.
    return jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', v_amount, 'description', p_description),
      jsonb_build_object(
        'system_role',
        case
          when p_transaction.manual_check_id is not null
               and p_transaction.counterparty_client_id is not null then 'clientes'
          when exists (select 1 from public.loans l where l.disbursement_transaction_id = p_transaction.id)
            then 'prestamos'
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
    else
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
        v_lines := '[]'::jsonb;
        if v_capital > 0 then
          v_lines := v_lines || jsonb_build_object('system_role', 'prestamos', 'debit', v_capital,
            'description', p_description || ' — capital');
        end if;
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

-- 5. Paying a cuota -------------------------------------------------------------------

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
declare
  v_number       int;
  v_loan_id      uuid;
  v_inst_amount  numeric;
  v_split        boolean;
  v_description  text;
  v_currency     text;
  v_channel_id   text;
  v_count        int;
  v_loan_status  text;
  v_account_type text;
  v_tx_id        uuid;
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

  select li.number, li.loan_id, li.amount, li.capital_amount is not null
    into v_number, v_loan_id, v_inst_amount, v_split
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

  select l.description, l.currency, l.channel_id, l.installments_count, l.status::text
    into v_description, v_currency, v_channel_id, v_count, v_loan_status
    from public.loans l
   where l.id = v_loan_id
     for update;
  if v_loan_status = 'cancelled' then
    raise exception 'El préstamo está anulado: no se pueden pagar sus cuotas'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select a.type into v_account_type from public.accounts a where a.id = p_account_id;
  if not found then
    raise exception 'La cuenta de pago no existe'
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
    p_account_id, v_channel_id, 'expense', p_amount, v_currency, p_paid_date,
    date_trunc('month', p_paid_date)::date,
    'Cuota ' || v_number || '/' || v_count || ' — ' || v_description,
    auth.uid()
  )
  returning id into v_tx_id;

  update public.loan_installments
     set status = 'pagada',
         paid_date = p_paid_date,
         paid_amount = p_amount,
         transaction_id = v_tx_id
   where id = p_installment_id;

  if not exists (
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

revoke all on function public.pay_loan_installment(uuid, date, uuid, numeric) from public, anon, authenticated;
grant execute on function public.pay_loan_installment(uuid, date, uuid, numeric) to authenticated, service_role;

-- A movement no document owns (the same list as guard_transaction_expense_account
-- plus the disbursement and the transfer pair).
create function public.transaction_is_loose(p_tx public.transactions)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tx.invoice_id is null
     and p_tx.receipt_id is null
     and p_tx.payment_order_id is null
     and p_tx.issued_check_id is null
     and p_tx.rejected_check_id is null
     and p_tx.manual_check_id is null
     and p_tx.transfer_pair_id is null
     and not p_tx.is_payroll
     and not exists (select 1 from public.payroll_payments where transaction_id = p_tx.id)
     and not exists (select 1 from public.loan_installments where transaction_id = p_tx.id)
     and not exists (select 1 from public.loans where disbursement_transaction_id = p_tx.id)
     and not exists (select 1 from public.check_movements where transaction_id = p_tx.id)
     and not exists (select 1 from public.account_opening_balances where adjustment_transaction_id = p_tx.id);
$$;

revoke all on function public.transaction_is_loose(public.transactions) from public, anon, authenticated;

-- 6. Adopting a manual expense as the payment of a cuota ------------------------------

create function public.adopt_loan_installment_payment(
  p_installment_id uuid,
  p_transaction_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst        public.loan_installments;
  v_loan        public.loans;
  v_tx          public.transactions;
begin
  -- Role guard (accounting:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar pagos de cuotas'
      using errcode = '42501';
  end if;

  select * into v_inst from public.loan_installments
   where id = p_installment_id and status = 'pendiente'
     for update;
  if v_inst.id is null then
    raise exception 'La cuota no existe o ya está pagada'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

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
  if v_tx.currency is distinct from v_loan.currency then
    raise exception 'El egreso está en otra moneda que el préstamo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_inst.capital_amount is not null and v_tx.amount <> v_inst.amount then
    raise exception 'La cuota tiene desglose: el egreso tiene que ser de su importe (%)', v_inst.amount
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- The cuota decides the entry from now on, not the expense account.
  if v_tx.expense_account_id is not null then
    update public.transactions set expense_account_id = null where id = v_tx.id;
  end if;

  update public.loan_installments
     set status = 'pagada',
         paid_date = v_tx.transaction_date,
         paid_amount = v_tx.amount,
         transaction_id = v_tx.id
   where id = v_inst.id;

  if not exists (
    select 1 from public.loan_installments
     where loan_id = v_loan.id and status = 'pendiente'
  ) then
    update public.loans set status = 'paid' where id = v_loan.id;
  end if;

  perform public.repost_journal('transactions', v_tx.id);
end;
$$;

revoke all on function public.adopt_loan_installment_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.adopt_loan_installment_payment(uuid, uuid) to authenticated, service_role;

-- 7. Recording the disbursement ---------------------------------------------------------

-- With p_transaction_id it adopts a manual income already loaded (same
-- channel, currency and amount as the loan); otherwise it writes the income
-- in p_account_id on p_date. Either way the movement is owned by the loan.
create function public.record_loan_disbursement(
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

-- 8. Ownership ----------------------------------------------------------------------------

-- Same as 20261102220000 plus the disbursement of a loan.
create or replace function public.guard_transaction_owned_by_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
  v_owner text;
begin
  get diagnostics v_stack = pg_context;
  if pg_trigger_depth() > 1
     or v_stack ~ 'function (public\.)?(update_receipt|update_payment_order|apply_account_opening_balance|clear_account_opening_balance)\(' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    if (old.rejected_check_id is not null
        or old.manual_check_id is not null
        or exists (select 1 from public.payroll_payments where transaction_id = old.id)
        or exists (select 1 from public.loan_installments where transaction_id = old.id)
        or exists (select 1 from public.loans where disbursement_transaction_id = old.id)
        or exists (select 1 from public.check_movements where transaction_id = old.id)
        or exists (select 1 from public.account_opening_balances where adjustment_transaction_id = old.id))
       and (new.amount           is distinct from old.amount
         or new.transaction_date is distinct from old.transaction_date
         or new.accrual_month    is distinct from old.accrual_month
         or new.account_id       is distinct from old.account_id
         or new.kind             is distinct from old.kind
         or new.channel_id       is distinct from old.channel_id) then
      raise exception
        'No se puede editar monto, fecha, cuenta, tipo o canal de un movimiento generado por un documento (sueldo, préstamo, cheque o saldo inicial): editá el documento de origen'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  v_owner := case
    when old.receipt_id is not null then 'un recibo'
    when old.payment_order_id is not null then 'una orden de pago'
    when old.invoice_id is not null then 'un comprobante'
    when old.issued_check_id is not null then 'el cobro de un cheque propio'
    when old.rejected_check_id is not null then 'un cheque rechazado'
    when old.manual_check_id is not null then 'un cheque cargado a mano'
    when exists (select 1 from public.loan_installments where transaction_id = old.id)
      then 'una cuota de préstamo'
    when exists (select 1 from public.loans where disbursement_transaction_id = old.id)
      then 'el desembolso de un préstamo'
    when exists (select 1 from public.payroll_payments where transaction_id = old.id)
      then 'un pago de sueldo'
    when exists (select 1 from public.check_movements where transaction_id = old.id)
      then 'un movimiento de cheque'
    when exists (select 1 from public.account_opening_balances where adjustment_transaction_id = old.id)
      then 'un saldo inicial de cuenta'
  end;
  if v_owner is not null then
    raise exception
      'No se puede borrar un movimiento generado por %: anulá o editá el documento de origen', v_owner
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_transaction_owned_by_document() from public, anon, authenticated;

-- Same as 20261103010000 plus 'loan_disbursement'.
create or replace view public.v_transactions_tagged with (security_invoker = on) as
  select
    t.id,
    t.account_id,
    t.channel_id,
    t.kind,
    t.amount,
    t.currency,
    t.transaction_date,
    t.accrual_month,
    t.description,
    t.invoice_id,
    t.counterparty_client_id,
    t.transfer_pair_id,
    t.created_by,
    t.created_at,
    t.updated_at,
    c.is_fiscal as channel_is_fiscal,
    c.name as channel_name,
    a.name as account_name,
    a.type as account_type,
    t.receipt_id,
    t.payment_order_id,
    t.rejected_check_id,
    t.issued_check_id,
    t.is_payroll,
    case
      when t.receipt_id is not null then 'receipt'
      when t.payment_order_id is not null then 'payment_order'
      when t.invoice_id is not null then 'invoice'
      when t.issued_check_id is not null then 'issued_check'
      when t.rejected_check_id is not null then 'rejected_check'
      when t.manual_check_id is not null then 'manual_check'
      when t.is_payroll
        or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
        then 'payroll'
      when exists (select 1 from public.loan_installments li where li.transaction_id = t.id)
        then 'loan_installment'
      when exists (select 1 from public.loans l where l.disbursement_transaction_id = t.id)
        then 'loan_disbursement'
      when exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
        then 'check_movement'
      when exists (select 1 from public.account_opening_balances aob where aob.adjustment_transaction_id = t.id)
        then 'account_opening_balance'
    end as source_document,
    t.cost_center_id,
    t.expense_account_id
  from public.transactions t
  join public.invoicing_channels c on c.id = t.channel_id
  join public.accounts a on a.id = t.account_id;

-- 9. Management P&L ---------------------------------------------------------------------

-- Same as 20261103010000 except the classification of a split cuota.
create or replace function public.get_management_pnl(
  p_from      date,
  p_to        date,
  p_basis     text default 'accrual',
  p_inflation boolean default false
)
returns table (
  month            text,
  bucket           text,
  subbucket        text,
  channel_side     text,
  chart_account_id uuid,
  amount_ars       numeric,
  pending_usd      numeric,
  cost_center_id   uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := date_trunc('month', p_from)::date;
  v_to   date := (date_trunc('month', p_to) + interval '1 month - 1 day')::date;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para ver el resultado de gestión'
      using errcode = '42501';
  end if;
  if p_basis is null or p_basis not in ('accrual', 'cash') then
    raise exception 'Base inválida: %', p_basis
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Período inválido'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  if p_basis = 'accrual' then
    return query
    with raw as (
      -- Fiscal: the journal as posted (reversals included).
      select je.accrual_period as month, 'fiscal'::text as side,
             je.source_table, je.source_id, je.cost_center_id,
             l.chart_of_accounts_id as account_id,
             l.credit - l.debit as amount
        from public.journal_entries je
        join public.journal_entry_lines l on l.journal_entry_id = je.id
       where je.accrual_period between to_char(v_from, 'YYYY-MM') and to_char(v_to, 'YYYY-MM')
      union all
      -- Internal: the entry each live document would post.
      select d.e ->> 'accrual_period', 'internal', x.src, x.id,
             (d.e ->> 'cost_center_id')::uuid,
             coalesce((ln ->> 'account_id')::uuid,
                      public.find_account_by_role((ln ->> 'system_role')::public.coa_system_role)),
             coalesce((ln ->> 'credit')::numeric, 0) - coalesce((ln ->> 'debit')::numeric, 0)
        from (
          select 'invoices'::text as src, i.id
            from public.invoices i
            join public.invoicing_channels c on c.id = i.channel_id
           where not c.is_fiscal and i.status = 'emitted' and i.fecha between v_from and v_to
          union all
          select 'purchase_invoices', p.id
            from public.purchase_invoices p
            join public.invoicing_channels c on c.id = p.channel_id
           where not c.is_fiscal and p.status = 'received' and p.fecha between v_from and v_to
          union all
          select 'transactions', t.id
            from public.transactions t
            join public.invoicing_channels c on c.id = t.channel_id
           where not c.is_fiscal and t.accrual_month between v_from and v_to
        ) x
        cross join lateral (select public.journal_document_entry(x.src, x.id) as e) d
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(d.e -> 'lines') = 'array' then d.e -> 'lines' else '[]'::jsonb end) ln
       where d.e is not null
    ),
    classified as (
      select r.month, r.side, r.cost_center_id, r.account_id, r.amount,
             case
               -- An unsplit loan installment is posted to an expense: in
               -- gestión it is principal paid, below the operating margin.
               -- A split one posts its capital to the loan liability
               -- (principal) and its interest to its own account's bucket.
               when r.source_table = 'transactions'
                    and coa.system_role = 'prestamos'
                    and exists (select 1 from public.loan_installments li where li.transaction_id = r.source_id)
                 then 'loan_principal'
               when r.source_table = 'transactions'
                    and coa.account_type in ('resultado_positivo', 'resultado_negativo')
                    and exists (select 1 from public.loan_installments li
                                 where li.transaction_id = r.source_id and li.capital_amount is null)
                 then 'loan_principal'
               when mb.bucket is not null then mb.bucket
               when coa.account_type in ('resultado_positivo', 'resultado_negativo') then 'unclassified'
             end as bucket,
             mb.subbucket,
             case when r.source_table = 'invoices' and coa.system_role = 'ventas'
                  then public.management_invoice_asset_share(r.source_id) else 0 end as asset_share
        from raw r
        left join public.chart_of_accounts coa on coa.id = r.account_id
        left join public.management_buckets mb on mb.chart_of_accounts_id = r.account_id
    ),
    split as (
      select c.month, c.side, c.cost_center_id, c.account_id, c.subbucket,
             case when s.is_asset then 'asset_sale' else c.bucket end as bucket,
             s.part as amount
        from classified c
        cross join lateral (values
          (false, c.amount - round(c.amount * c.asset_share, 2)),
          (true,  round(c.amount * c.asset_share, 2))
        ) as s (is_asset, part)
       where c.bucket is not null and c.bucket <> 'neutral'
         and (s.part <> 0 or (not s.is_asset and c.asset_share = 0))
    ),
    pending as (
      select to_char(t.accrual_month, 'YYYY-MM') as month,
             case when c.is_fiscal then 'fiscal' else 'internal' end as side,
             t.cost_center_id,
             sum(case when t.kind = 'income' then t.amount else -t.amount end) as usd
        from public.transactions t
        join public.invoicing_channels c on c.id = t.channel_id
       where t.currency = 'USD'
         and t.kind in ('income', 'expense')
         and t.invoice_id is null and t.receipt_id is null and t.payment_order_id is null
         and t.issued_check_id is null
         and t.accrual_month between v_from and v_to
         and public.get_exchange_rate('USD', t.transaction_date) is null
       group by 1, 2, 3
    )
    select s.month, s.bucket,
           case when s.subbucket = 'sueldos' and s.side = 'internal' then 'sueldos_internos'
                else s.subbucket end,
           s.side, s.account_id,
           round(sum(s.amount) * case when p_inflation then coalesce(max(ia.coefficient), 1) else 1 end, 2),
           0::numeric,
           s.cost_center_id
      from split s
      left join public.inflation_adjustments ia on ia.period = s.month
     group by s.month, s.bucket, s.subbucket, s.side, s.account_id, s.cost_center_id
    union all
    select p.month, 'pending_usd', null, p.side, null, 0::numeric, p.usd, p.cost_center_id
      from pending p;
    return;
  end if;

  -- Cash: every movement of every account and channel, by its source.
  return query
  with moves as (
    select to_char(t.transaction_date, 'YYYY-MM') as month,
           case when c.is_fiscal then 'fiscal' else 'internal' end as side,
           t.cost_center_id,
           t.currency, t.transaction_date,
           case when t.kind = 'income' then t.amount else -t.amount end as signed,
           case
             when t.receipt_id is not null or t.invoice_id is not null
                  or t.manual_check_id is not null then 'service_revenue'
             when t.payment_order_id is not null or t.issued_check_id is not null then 'operating_cost'
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then 'operating_cost'
             when exists (select 1 from public.loan_installments li where li.transaction_id = t.id)
               then 'loan_principal'
             when t.rejected_check_id is not null
                  or exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
                  or exists (select 1 from public.account_opening_balances aob
                              where aob.adjustment_transaction_id = t.id)
               then 'neutral'
             -- A loose movement goes where its journal counter-account goes.
             else coalesce(mb.bucket, 'unclassified')
           end as bucket,
           case
             when t.receipt_id is not null or t.invoice_id is not null
                  or t.manual_check_id is not null then null
             when t.payment_order_id is not null or t.issued_check_id is not null then 'proveedores'
             when t.is_payroll
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then case when c.is_fiscal then 'sueldos' else 'sueldos_internos' end
             else mb.subbucket
           end as subbucket,
           case when t.receipt_id is null and t.invoice_id is null and t.manual_check_id is null
                     and t.payment_order_id is null and t.issued_check_id is null and not t.is_payroll
                then cp.id end as account_id
      from public.transactions t
      join public.invoicing_channels c on c.id = t.channel_id
      left join public.chart_of_accounts cp
        on cp.id = coalesce(
             case when t.kind = 'expense' then t.expense_account_id end,
             public.find_account_by_role(
               case when t.kind = 'income' then 'ajustes_caja' else 'gastos' end::public.coa_system_role))
      left join public.management_buckets mb on mb.chart_of_accounts_id = cp.id
     where t.kind in ('income', 'expense')
       and t.transaction_date between v_from and v_to
  ),
  rated as (
    select m.*,
           case when m.currency = 'USD' then public.get_exchange_rate('USD', m.transaction_date) else 1 end as rate
      from moves m
     where m.bucket <> 'neutral'
  )
  select r.month, r.bucket, r.subbucket, r.side, r.account_id,
         round(coalesce(sum(r.signed * r.rate) filter (where r.rate is not null), 0)
               * case when p_inflation then coalesce(max(ia.coefficient), 1) else 1 end, 2),
         coalesce(sum(r.signed) filter (where r.rate is null), 0),
         r.cost_center_id
    from rated r
    left join public.inflation_adjustments ia on ia.period = r.month
   group by r.month, r.bucket, r.subbucket, r.side, r.account_id, r.cost_center_id;
end;
$$;

revoke all on function public.get_management_pnl(date, date, text, boolean) from public, anon, authenticated;
grant execute on function public.get_management_pnl(date, date, text, boolean) to service_role;
