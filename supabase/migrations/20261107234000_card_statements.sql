SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Credit card statements (Banco Galicia's VISA Business): the company's
-- cards are paid from a bank account, and what each purchase was is decided
-- here, not when the bank debits the payment.
--
--   1. card_holders: each card of a card account (its last four digits), its
--      holder and what its purchases usually are: a company expense (a chart
--      account) or a salary advance to an employee (a partner who is also an
--      employee). Remembered from one statement to the next.
--   2. card_statements / card_statement_lines: one statement read from its
--      PDF, with every purchase and every charge of the bank, each with its
--      treatment: expense (chart account), advance (employee) or ignore.
--   3. bank_statement_codes takes 'card_payment' (Galicia: «Pago Visa
--      Empresa»), and settle_card_statement (service role; the action gates on
--      transactions:write): pays the statement with the bank's debits of the
--      payment ("Pago Visa Empresa"). On the bank account, on the payment
--      date, one expense per chart account and one advance per employee
--      (with its employee account movement), the USD purchases at the rate
--      the bank applied; then the debits are reconciled with them.
--
-- Cash basis on purpose: the card is not an account of the app; what was
-- bought is booked when it is paid, like any other bank debit.
--
-- Rollback: older code does not read these tables; a settled statement's
-- movements are ordinary expenses and advances.

------------------------------------------------------------------------------
-- 1. Holders
------------------------------------------------------------------------------
create table public.card_holders (
  id                uuid primary key default gen_random_uuid(),
  account_number    text not null check (char_length(account_number) between 1 and 40),
  last4             text not null check (last4 ~ '^[0-9]{4}$'),
  holder            text not null check (char_length(holder) between 1 and 120),
  treatment         text not null default 'expense'
                      check (treatment in ('expense', 'advance', 'ignore')),
  chart_account_id  uuid references public.chart_of_accounts (id) on delete set null,
  employee_id       uuid references public.employees (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (account_number, last4)
);

comment on table public.card_holders is
  'Cada tarjeta de una cuenta de tarjeta de crédito: su titular y qué son por defecto sus consumos (gasto de la empresa o adelanto de sueldo de un empleado).';

create index card_holders_employee_idx on public.card_holders (employee_id);
create index card_holders_chart_account_idx on public.card_holders (chart_account_id);

alter table public.card_holders enable row level security;

create policy "card_holders select"
  on public.card_holders for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.card_holders from public, anon;

------------------------------------------------------------------------------
-- 2. Statements
------------------------------------------------------------------------------
create table public.card_statements (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique check (char_length(number) between 1 and 60),
  brand            text not null default 'VISA' check (char_length(brand) between 1 and 40),
  account_number   text not null check (char_length(account_number) between 1 and 40),
  pay_account_id   uuid not null references public.accounts (id) on delete restrict,
  close_date       date not null,
  due_date         date not null,
  total_ars        numeric(18, 2) not null check (total_ars >= 0),
  total_usd        numeric(18, 2) not null default 0 check (total_usd >= 0),
  status           text not null default 'pendiente' check (status in ('pendiente', 'pagado')),
  -- The bank pays the pesos and the dollars with a debit each.
  paid_ars_on      date,
  paid_usd_on      date,
  usd_rate         numeric(18, 4) check (usd_rate is null or usd_rate > 0),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  check ((status = 'pagado') = (paid_ars_on is not null and (total_usd = 0 or paid_usd_on is not null)))
);

comment on table public.card_statements is
  'Resumen de tarjeta de crédito leído de su PDF. Se paga con los débitos del banco (settle_card_statement).';

create index card_statements_pay_account_idx on public.card_statements (pay_account_id);
create index card_statements_created_by_idx on public.card_statements (created_by);

alter table public.card_statements enable row level security;

create policy "card_statements select"
  on public.card_statements for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.card_statements from public, anon;

create table public.card_statement_lines (
  id                uuid primary key default gen_random_uuid(),
  statement_id      uuid not null references public.card_statements (id) on delete cascade,
  sort_order        integer not null,
  source            text not null check (source in ('purchase', 'charge')),
  card_last4        text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  line_date         date not null,
  description       text not null check (char_length(description) between 1 and 200),
  installment       text check (installment is null or char_length(installment) <= 10),
  currency          text not null check (currency in ('ARS', 'USD')),
  amount            numeric(18, 2) not null,
  treatment         text not null default 'expense'
                      check (treatment in ('expense', 'advance', 'ignore')),
  chart_account_id  uuid references public.chart_of_accounts (id) on delete restrict,
  employee_id       uuid references public.employees (id) on delete restrict,
  transaction_id    uuid references public.transactions (id) on delete restrict,
  check (source = 'purchase' or card_last4 is null),
  check (treatment <> 'advance' or source = 'purchase')
);

comment on table public.card_statement_lines is
  'Un consumo o un cargo del banco de un resumen de tarjeta, con qué es: gasto (cuenta contable), adelanto de sueldo (empleado) o no corresponde. transaction_id: el movimiento que lo pagó.';

create index card_statement_lines_statement_idx on public.card_statement_lines (statement_id, sort_order);
create index card_statement_lines_chart_account_idx on public.card_statement_lines (chart_account_id);
create index card_statement_lines_employee_idx on public.card_statement_lines (employee_id);
create index card_statement_lines_transaction_idx on public.card_statement_lines (transaction_id);

alter table public.card_statement_lines enable row level security;

create policy "card_statement_lines select"
  on public.card_statement_lines for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.card_statement_lines from public, anon;

------------------------------------------------------------------------------
-- 3. Paying a statement
------------------------------------------------------------------------------
-- A bank code for the debit that pays a card ("Pago Visa Empresa").
alter table public.bank_statement_codes
  -- squawk-ignore ban-drop-constraint
  drop constraint bank_statement_codes_kind_check,
  -- squawk-ignore constraint-missing-not-valid
  add constraint bank_statement_codes_kind_check check (kind in (
    'tax', 'bank_fee', 'receipt', 'payment', 'transfer', 'loan', 'ignore',
    'check_sale', 'card_payment'
  ));

create or replace function public.guard_transaction_expense_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if new.expense_account_id is null then
    return new;
  end if;
  if new.kind <> 'expense'
     or new.invoice_id is not null
     or new.receipt_id is not null
     or new.payment_order_id is not null
     or new.issued_check_id is not null
     or new.rejected_check_id is not null
     or new.manual_check_id is not null
     or new.transfer_pair_id is not null
     or new.is_payroll
     or exists (select 1 from public.payroll_payments where transaction_id = new.id)
     or exists (select 1 from public.loan_installments where transaction_id = new.id)
     or exists (select 1 from public.check_movements where transaction_id = new.id)
     or exists (select 1 from public.account_opening_balances where adjustment_transaction_id = new.id)
     or exists (select 1 from public.employee_account_movements where transaction_id = new.id)
     or exists (select 1 from public.tax_documents where payment_transaction_id = new.id) then
    raise exception 'Solo un egreso manual lleva cuenta de gasto: el de un documento se imputa desde el documento'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if public.is_bank_tax_account(new.expense_account_id) then
    if tg_op = 'INSERT' or new.expense_account_id is distinct from old.expense_account_id then
      get diagnostics v_stack = pg_context;
      if v_stack !~ 'function (public\.)?(create_bank_statement_line_transaction|settle_card_statement)\(' then
        raise exception 'Una cuenta de impuesto a favor solo se imputa desde una línea del extracto del banco'
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
    if new.currency <> 'ARS'
       or not exists (select 1 from public.invoicing_channels c where c.id = new.channel_id and c.is_fiscal) then
      raise exception 'Un impuesto a favor va en pesos y en el canal fiscal'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  if (tg_op = 'INSERT' or new.expense_account_id is distinct from old.expense_account_id)
     and not public.is_postable_expense_account(new.expense_account_id) then
    raise exception 'La cuenta de gasto debe ser una cuenta hoja de resultado (sin subcuentas) y activa'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_transaction_expense_account() from public, anon, authenticated;

-- A card statement's salary advances are written by settle_card_statement,
-- with their treasury movement, like record_employee_account_cash does.
create or replace function public.guard_employee_account_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_stack text;
  v_row   public.employee_account_movements;
  v_plan  public.employee_debt_plans;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_op <> 'DELETE' and new.plan_id is not null
     and (tg_op = 'INSERT' or new.plan_id is distinct from old.plan_id) then
    select * into v_plan from public.employee_debt_plans where id = new.plan_id;
    if v_plan.employee_id is distinct from new.employee_id
       or v_plan.currency is distinct from new.currency then
      raise exception 'El plan es de otro empleado o de otra moneda que el movimiento'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;

  -- The triggers that own movements (closed planilla, purchase, plan) and
  -- the RPCs write them; nothing else writes an owned one.
  get diagnostics v_stack = pg_context;
  if pg_trigger_depth() > 1
     or v_stack ~ 'function (public\.)?(record_employee_account_cash|delete_employee_account_movement|post_driver_settlement_difference|unpost_driver_settlement_difference|cancel_driver_settlement|settle_card_statement)\(' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'description' - 'updated_at') <> (to_jsonb(old) - 'description' - 'updated_at') then
      raise exception 'De un movimiento de la cuenta corriente solo se edita la descripción: borralo y cargalo de nuevo'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  if v_row.transaction_id is not null
     or v_row.purchase_invoice_id is not null
     or v_row.payroll_entry_id is not null
     or v_row.driver_settlement_id is not null
     or v_row.kind = 'forgiveness' then
    raise exception '%', case
        when v_row.payroll_entry_id is not null
          then 'El descuento de planilla lo escribe el cierre del período: reabrilo para cambiarlo'
        when v_row.purchase_invoice_id is not null
          then 'El cargo de una compra se maneja desde la compra (a cargo de empleado)'
        when v_row.driver_settlement_id is not null
          then 'La diferencia de una rendición se asienta o se quita desde la rendición'
        when v_row.kind = 'forgiveness'
          then 'La condonación la escribe el plan al marcarlo condonado'
        else 'Un adelanto o pago en caja se registra o se borra desde la cuenta corriente del empleado, junto con su movimiento de caja'
      end
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function public.guard_employee_account_movement() from public, anon, authenticated;

create or replace function public.settle_card_statement(
  p_statement_id uuid,
  p_line_id      uuid,
  p_currency     text,
  p_channel_id   text,
  p_user_id      uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_st      public.card_statements%rowtype;
  v_line    public.bank_statement_lines%rowtype;
  v_paid    numeric;
  v_rate    numeric;
  v_total   numeric;
  v_diff    numeric;
  v_tx      uuid;
  v_txs     uuid[] := '{}';
  v_label   text;
  r         record;
begin
  if p_currency is null or p_currency not in ('ARS', 'USD') then
    raise exception 'El débito paga los pesos o los dólares del resumen'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  select * into v_st from public.card_statements where id = p_statement_id for update;
  if v_st.id is null then
    raise exception 'El resumen no existe' using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if (p_currency = 'ARS' and v_st.paid_ars_on is not null)
     or (p_currency = 'USD' and (v_st.paid_usd_on is not null or v_st.total_usd = 0)) then
    raise exception 'Esa parte del resumen ya está pagada o no existe'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if not exists (select 1 from public.invoicing_channels c where c.id = p_channel_id and c.is_fiscal) then
    raise exception 'El pago de la tarjeta va en el canal fiscal'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_line from public.bank_statement_lines where id = p_line_id for update;
  if v_line.id is null or v_line.account_id <> v_st.pay_account_id
     or v_line.status <> 'open' or v_line.amount >= 0 then
    raise exception 'El débito no es de la cuenta que paga la tarjeta o ya no está pendiente'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  v_paid := -v_line.amount;

  if exists (
    select 1 from public.card_statement_lines
     where statement_id = v_st.id and currency = p_currency
       and ((treatment = 'expense' and chart_account_id is null)
            or (treatment = 'advance' and employee_id is null))
  ) then
    raise exception 'Hay consumos o cargos sin cuenta contable o adelantos sin empleado'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if p_currency = 'ARS' then
    v_total := v_st.total_ars;
    if round(v_paid, 2) <> round(v_total, 2) then
      raise exception 'El débito es de % y el resumen en pesos de %', v_paid, v_total
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  else
    -- What the bank took for the dollars is the rate it applied.
    v_rate := round(v_paid / v_st.total_usd, 4);
    v_total := v_paid;
  end if;

  v_label := v_st.brand || ' ' || v_st.account_number || ' cierre ' || to_char(v_st.close_date, 'DD/MM/YYYY');

  -- Pesos of each line; the cents of rounding the dollars go on the largest
  -- one, so the movements add up to the debit.
  drop table if exists card_amounts;
  create temporary table card_amounts on commit drop as
    select l.id, l.treatment, l.chart_account_id, l.employee_id,
           case when p_currency = 'USD' then round(l.amount * v_rate, 2) else l.amount end as ars,
           l.amount
      from public.card_statement_lines l
     where l.statement_id = v_st.id and l.currency = p_currency;
  select round(v_total - coalesce(sum(ars), 0), 2) into v_diff from card_amounts;
  if p_currency = 'USD' and v_diff <> 0 then
    update card_amounts set ars = ars + v_diff
     where id = (select id from card_amounts order by amount desc limit 1);
  end if;

  if exists (select 1 from card_amounts where treatment = 'ignore') then
    raise exception 'Hay consumos marcados como «no corresponde»: el banco los cobró igual, imputalos a una cuenta o a un empleado'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  for r in
    select chart_account_id, sum(ars) as total, count(*) as n
      from card_amounts
     where treatment = 'expense'
     group by chart_account_id
  loop
    if r.total <= 0 then
      continue;
    end if;
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, expense_account_id, created_by
    ) values (
      v_st.pay_account_id, p_channel_id, 'expense', r.total, 'ARS', v_line.line_date,
      date_trunc('month', v_st.close_date)::date,
      left('Tarjeta ' || v_label || ' · ' || r.n || case when r.n = 1 then ' consumo' else ' consumos' end, 500),
      r.chart_account_id, p_user_id
    )
    returning id into v_tx;
    update public.card_statement_lines l set transaction_id = v_tx
      from card_amounts a
     where a.id = l.id and a.treatment = 'expense' and a.chart_account_id = r.chart_account_id;
    v_txs := v_txs || v_tx;
  end loop;

  for r in
    select a.employee_id, sum(a.ars) as total, e.legal_name
      from card_amounts a
      join public.employees e on e.id = a.employee_id
     where a.treatment = 'advance'
     group by a.employee_id, e.legal_name
  loop
    if r.total <= 0 then
      continue;
    end if;
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, created_by
    ) values (
      v_st.pay_account_id, p_channel_id, 'expense', r.total, 'ARS', v_line.line_date,
      date_trunc('month', v_line.line_date)::date,
      left('Adelanto a ' || r.legal_name || ' (tarjeta ' || v_label || ')', 500), p_user_id
    )
    returning id into v_tx;
    insert into public.employee_account_movements (
      employee_id, kind, currency, amount, movement_date, description, transaction_id, created_by
    ) values (
      r.employee_id, 'advance', 'ARS', r.total, v_line.line_date,
      left('Consumos con tarjeta ' || v_label, 200), v_tx, p_user_id
    );
    -- Posted at insert as a loose movement; now the builder sees the employee.
    perform public.repost_journal('transactions', v_tx);
    update public.card_statement_lines l set transaction_id = v_tx
      from card_amounts a
     where a.id = l.id and a.treatment = 'advance' and a.employee_id = r.employee_id;
    v_txs := v_txs || v_tx;
  end loop;

  if (select coalesce(sum(t.amount), 0) from public.transactions t where t.id = any (v_txs)) <> round(v_paid, 2) then
    raise exception 'Los movimientos del resumen no suman el débito del banco: revisá que no haya consumos con importe negativo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  perform public.match_bank_statement_line(p_line_id, v_txs, p_user_id);

  update public.card_statements
     set paid_ars_on = case when p_currency = 'ARS' then v_line.line_date else paid_ars_on end,
         paid_usd_on = case when p_currency = 'USD' then v_line.line_date else paid_usd_on end,
         usd_rate    = coalesce(v_rate, usd_rate),
         status      = case
                         when (p_currency = 'ARS' or paid_ars_on is not null)
                          and (total_usd = 0 or p_currency = 'USD' or paid_usd_on is not null)
                         then 'pagado' else 'pendiente' end
   where id = v_st.id;

  return cardinality(v_txs);
end;
$$;

revoke all on function public.settle_card_statement(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.settle_card_statement(uuid, uuid, text, text, uuid)
  to service_role;
