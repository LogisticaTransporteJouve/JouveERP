SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A leasing (a truck under a financial lease) and the charges a cuota carries.
--
-- 1. Accounts, each only if no active account holds its role: 1.2 Activo no
--    corriente › 1.2.1 Bienes de uso › 1.2.1.1 Rodados (rodados), 2.1.5
--    Deudas por leasing (deudas_leasing), 5.2.5 Seguros de vehículos
--    (seguros) and 5.2.6 Patentes (patentes), at the next free code.
-- 2. loan_installment_charges: what a cuota charges besides capital, interest
--    and their IVA: seguro, patentes, mora (deuda anterior, punitorios and
--    compensatorios), valor residual, otro. Each with its IVA and, optionally,
--    the account it goes to. They add up to the cuota's other_charges_amount;
--    written only by set_loan_installment_charges, while the cuota is pending.
-- 3. set_loan_installment_charges: sets a pending cuota's split and charges at
--    once (the amount is their sum), as the lender's statement shows it.
-- 4. loan_liability_role: a leasing's debt is deudas_leasing (while an active
--    account holds the role), any other loan's prestamos.
-- 5. loan_capital_journal_lines: the capital lowers that liability.
-- 6. build_transaction_journal_lines (20261104101300, every case kept): a
--    split cuota with charges posts each charge to its account (seguro to
--    seguros, patentes to patentes, mora and otro to intereses_pagados, valor
--    residual to the liability) and its IVA to iva_credito; what «otros» has
--    beyond the charges is interest, as before. Charges that add up to more
--    than «otros» (the split was edited by older code) are ignored and
--    «otros» posts as interest, as before. A disbursement credits the loan's
--    liability.
-- 7. book_loan_opening: a leasing books the vehicle in Rodados for the amount
--    financed against Deudas por leasing (what was still owed) and Resultados
--    no asignados (the capital already paid before the date); granted within
--    the year, Rodados against Deudas por leasing on the date granted.
--
-- Existing rows are not touched: no leasing exists and no cuota has charges.
-- Rollback: older code reads the same split; older SQL posts «otros» as
-- interest and a leasing's capital to prestamos.

-- 1. Accounts -----------------------------------------------------------------

do $$
declare
  v_parent uuid;
  v_group  uuid;
  v_code   text;
begin
  -- 1.2 Activo no corriente › 1.2.1 Bienes de uso › Rodados
  if not exists (select 1 from public.chart_of_accounts where system_role = 'rodados' and is_active) then
    select id into v_parent from public.chart_of_accounts where code = '1';
    if v_parent is not null then
      select id into v_group from public.chart_of_accounts where code = '1.2';
      if v_group is null then
        insert into public.chart_of_accounts (parent_id, code, name, level, account_type)
        values (v_parent, '1.2', 'Activo no corriente', 2, 'activo')
        returning id into v_group;
      end if;
      v_parent := v_group;
      select id into v_group from public.chart_of_accounts where code = '1.2.1';
      if v_group is null then
        insert into public.chart_of_accounts (parent_id, code, name, level, account_type)
        values (v_parent, '1.2.1', 'Bienes de uso', 3, 'activo')
        returning id into v_group;
      end if;
      select '1.2.1.' || (coalesce(max(substring(code from '^1\.2\.1\.([0-9]+)$')::int), 0) + 1)
        into v_code
        from public.chart_of_accounts
       where code ~ '^1\.2\.1\.[0-9]+$';
      insert into public.chart_of_accounts (parent_id, code, name, level, account_type, system_role)
      values (v_group, v_code, 'Rodados', 4, 'activo', 'rodados');
    end if;
  end if;

  -- 2.1.x Deudas por leasing
  if not exists (select 1 from public.chart_of_accounts where system_role = 'deudas_leasing' and is_active) then
    select id into v_parent from public.chart_of_accounts where code = '2.1';
    if v_parent is not null then
      select '2.1.' || (coalesce(max(substring(code from '^2\.1\.([0-9]+)$')::int), 0) + 1)
        into v_code
        from public.chart_of_accounts
       where code ~ '^2\.1\.[0-9]+$';
      insert into public.chart_of_accounts (parent_id, code, name, level, account_type, system_role)
      values (v_parent, v_code, 'Deudas por leasing', 3, 'pasivo', 'deudas_leasing');
    end if;
  end if;

  -- 5.2.x Seguros de vehículos, Patentes
  select id into v_parent from public.chart_of_accounts where code = '5.2';
  if v_parent is not null then
    if not exists (select 1 from public.chart_of_accounts where system_role = 'seguros' and is_active) then
      select '5.2.' || (coalesce(max(substring(code from '^5\.2\.([0-9]+)$')::int), 0) + 1)
        into v_code
        from public.chart_of_accounts
       where code ~ '^5\.2\.[0-9]+$';
      insert into public.chart_of_accounts (parent_id, code, name, level, account_type, eerr_category, system_role)
      values (v_parent, v_code, 'Seguros de vehículos', 3, 'resultado_negativo', 'gastos_operativos', 'seguros');
    end if;
    if not exists (select 1 from public.chart_of_accounts where system_role = 'patentes' and is_active) then
      select '5.2.' || (coalesce(max(substring(code from '^5\.2\.([0-9]+)$')::int), 0) + 1)
        into v_code
        from public.chart_of_accounts
       where code ~ '^5\.2\.[0-9]+$';
      insert into public.chart_of_accounts (parent_id, code, name, level, account_type, eerr_category, system_role)
      values (v_parent, v_code, 'Patentes', 3, 'resultado_negativo', 'gastos_operativos', 'patentes');
    end if;
  end if;
end;
$$;

-- 2. Charges of a cuota -------------------------------------------------------

create table public.loan_installment_charges (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references public.loan_installments (id) on delete cascade,
  concept text not null check (concept in ('seguro', 'patentes', 'mora', 'valor_residual', 'otro')),
  description text check (description is null or char_length(description) between 1 and 200),
  amount numeric(14, 2) not null check (amount >= 0),
  iva_amount numeric(14, 2) not null default 0 check (iva_amount >= 0),
  -- squawk-ignore adding-foreign-key-constraint
  chart_account_id uuid references public.chart_of_accounts (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint loan_installment_charges_positive check (amount + iva_amount > 0)
);

comment on table public.loan_installment_charges is
  'Cargos de una cuota además de capital, interés y su IVA (seguro, patentes, mora, valor residual): suman other_charges_amount. Solo set_loan_installment_charges los escribe, con la cuota pendiente.';
comment on column public.loan_installment_charges.amount is
  'Importe sin IVA. Va a la cuenta del cargo (chart_account_id, o la del rol de su concepto).';
comment on column public.loan_installment_charges.iva_amount is
  'IVA del cargo. Va a iva_credito.';

create index loan_installment_charges_installment_idx
  on public.loan_installment_charges (installment_id);
create index loan_installment_charges_account_idx
  on public.loan_installment_charges (chart_account_id)
  where chart_account_id is not null;

alter table public.loan_installment_charges enable row level security;

create policy "loan_installment_charges select" on public.loan_installment_charges
  for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

-- Written only through set_loan_installment_charges.
revoke insert, update, delete on public.loan_installment_charges from anon, authenticated;

-- The charges of a paid cuota are part of its entry: they change only while
-- the cuota is pending, and only through set_loan_installment_charges. A
-- cuota deleted takes its charges with it (its own guard decides).
create function public.guard_loan_installment_charges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_installment uuid := case when tg_op = 'DELETE' then old.installment_id else new.installment_id end;
  v_status      public.loan_installment_status;
  v_stack       text;
begin
  select i.status into v_status from public.loan_installments i where i.id = v_installment;
  if not found then
    -- The cuota is being deleted (cascade).
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_status <> 'pendiente' then
    raise exception 'No se pueden cambiar los cargos de una cuota pagada'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if tg_op = 'UPDATE' and new.installment_id is distinct from old.installment_id then
    raise exception 'Un cargo no se pasa a otra cuota'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  get diagnostics v_stack = pg_context;
  if v_stack !~ 'function (public\.)?set_loan_installment_charges\(' then
    raise exception 'Los cargos de una cuota se cargan solo con su desglose («Cargar resumen de cuota»)'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_loan_installment_charges() from public, anon, authenticated;

create trigger loan_installment_charges_guard
  before insert or update or delete on public.loan_installment_charges
  for each row execute function public.guard_loan_installment_charges();

-- 3. set_loan_installment_charges --------------------------------------------

create function public.set_loan_installment_charges(
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
         other_charges_amount = v_other
   where id = p_installment_id;

  return v_amount;
end;
$$;

comment on function public.set_loan_installment_charges(uuid, jsonb, jsonb) is
  'Desglose y cargos de una cuota pendiente, como los muestra el resumen del dador: el importe es su suma. La acción de la app (accounting:write) lo llama con el service role.';

revoke all on function public.set_loan_installment_charges(uuid, jsonb, jsonb)
  from public, anon, authenticated;

-- 4. The liability of a loan --------------------------------------------------

create function public.loan_liability_role(p_loan_id uuid)
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
           else 'prestamos'::public.coa_system_role
         end
$$;

comment on function public.loan_liability_role(uuid) is
  'Rol de la deuda de un préstamo: deudas_leasing para un leasing (si hay cuenta activa), prestamos para el resto. Interna.';

revoke all on function public.loan_liability_role(uuid) from public, anon, authenticated;

-- 5. Capital lines: same as 20261104101300 with the loan's liability. ---------

create or replace function public.loan_capital_journal_lines(
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
  v_liability numeric := p_capital;
  v_fx        numeric := 0;
  v_role      public.coa_system_role := public.loan_liability_role(p_loan_id);
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
      v_liability := round(p_capital * v_disb_rate / p_rate, 2);
      v_fx := p_capital - v_liability;
    end if;
  end if;
  return jsonb_build_array(jsonb_build_object('system_role', v_role::text, 'debit', v_liability,
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

revoke all on function public.loan_capital_journal_lines(uuid, numeric, numeric, text, text) from public, anon, authenticated;

-- 6. build_transaction_journal_lines: same as 20261104101300 plus the charges
--    of a split cuota and the liability role of a disbursement. ---------------

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

-- 7. book_loan_opening: same as 20261107220000 plus a leasing's vehicle. -----

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
