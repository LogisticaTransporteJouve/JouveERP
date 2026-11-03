SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Venta de cheques (descuento) a un banco o financiera (roadmap 4.6).
--
--   1. checks.status takes 'vendido' and check_movements.event 'sold'.
--   2. check_sales: one sale (buyer, date, destination account, channel,
--      face value, interest, commission, net), idempotent on its key.
--   3. transactions.check_sale_id: every movement of a sale. Per check a
--      transfer of its face value from its cartera to the destination account
--      (Dr banco / Cr cheques en cartera, as a deposit), and per sale an
--      expense for the interest and one for the commission on the destination
--      account, imputed to Intereses pagados (Dr intereses / Cr banco). The
--      account ends up with the net. guard_transaction_owned_by_document,
--      transaction_is_loose and v_transactions_tagged ('check_sale') treat
--      them as owned by the sale.
--   4. sell_checks (service role; the action gates on cheques:write): locks
--      the checks, refuses one not en cartera, of another currency or
--      channel, a cost of the whole face value, and returns the sale of the
--      same key on a retry.
--   5. reject_check also takes a sold check: the buyer debits it back (by
--      default from the sale's account, or from the account the buyer is
--      repaid from), posted as Deudores por cheques rechazados like a
--      deposited one. The client owes it again (v_client_account_movements
--      already lists every rejected check of a receipt).
--
-- Rollback: older code does not know 'vendido' and drops sold checks from
-- its check lists (logged, no crash); rejecting a sold check needs this code.
--
-- RLS: check_sales like checks (owner/admin/finance read); writes go through
-- sell_checks only.

------------------------------------------------------------------------------
-- 1. Status and event
------------------------------------------------------------------------------
-- Each check is replaced by a wider one in the next statement.
-- squawk-ignore ban-drop-constraint
alter table public.checks drop constraint checks_status_check;
alter table public.checks
  add constraint checks_status_check check (status in (
    'en_cartera', 'depositado', 'acreditado', 'endosado', 'rechazado', 'vendido'
  )) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.checks validate constraint checks_status_check;

-- squawk-ignore ban-drop-constraint
alter table public.check_movements drop constraint check_movements_event_check;
alter table public.check_movements
  add constraint check_movements_event_check check (event in (
    'received', 'deposited', 'credited', 'endorsed', 'rejected', 'sold'
  )) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.check_movements validate constraint check_movements_event_check;

------------------------------------------------------------------------------
-- 2. check_sales
------------------------------------------------------------------------------
create table public.check_sales (
  id                uuid primary key default gen_random_uuid(),
  sale_date         date not null,
  buyer_name        text not null check (length(trim(buyer_name)) between 1 and 120),
  buyer_cuit        text check (buyer_cuit is null or buyer_cuit ~ '^[0-9]{11}$'),
  account_id        uuid not null references public.accounts (id) on delete restrict,
  channel_id        text not null references public.invoicing_channels (id) on delete restrict,
  currency          text not null check (currency in ('ARS', 'USD')),
  gross_amount      numeric(18, 2) not null check (gross_amount > 0),
  interest_amount   numeric(18, 2) not null default 0 check (interest_amount >= 0),
  commission_amount numeric(18, 2) not null default 0 check (commission_amount >= 0),
  net_amount        numeric(18, 2) not null,
  notes             text check (length(notes) <= 2000),
  idempotency_key   uuid not null,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),

  constraint check_sales_idempotency_key_key unique (idempotency_key),
  constraint check_sales_net check (
    net_amount = gross_amount - interest_amount - commission_amount and net_amount > 0
  )
);

comment on table public.check_sales is
  'Venta (descuento) de cheques de terceros a un banco o financiera: comprador, cuenta donde entra el neto, valor nominal, intereses, comisiones y neto. Los cheques quedan vendido; los movimientos llevan check_sale_id.';

alter table public.check_sales enable row level security;

create policy "check_sales select"
  on public.check_sales for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.check_sales from public, anon;

------------------------------------------------------------------------------
-- 3. Movements of a sale
------------------------------------------------------------------------------
alter table public.transactions
  -- squawk-ignore adding-foreign-key-constraint
  add column check_sale_id uuid references public.check_sales (id) on delete restrict;

comment on column public.transactions.check_sale_id is
  'Venta de cheques que generó este movimiento (transferencia cartera → cuenta por cheque, egreso de intereses y de comisiones). Lo escribe sell_checks.';

-- The column is new and all NULL: nothing to index, so the lock is momentary.
-- squawk-ignore require-concurrent-index-creation
create index transactions_check_sale_idx
  on public.transactions (check_sale_id) where check_sale_id is not null;

-- Same as 20261103060100 plus the check sale.
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
        or old.check_sale_id is not null
        or exists (select 1 from public.payroll_payments where transaction_id = old.id)
        or exists (select 1 from public.loan_installments where transaction_id = old.id)
        or exists (select 1 from public.loans where disbursement_transaction_id = old.id)
        or exists (select 1 from public.check_movements where transaction_id = old.id)
        or exists (select 1 from public.account_opening_balances where adjustment_transaction_id = old.id)
        or exists (select 1 from public.employee_account_movements where transaction_id = old.id))
       and (new.amount           is distinct from old.amount
         or new.transaction_date is distinct from old.transaction_date
         or new.accrual_month    is distinct from old.accrual_month
         or new.account_id       is distinct from old.account_id
         or new.kind             is distinct from old.kind
         or new.channel_id       is distinct from old.channel_id
         or new.check_sale_id    is distinct from old.check_sale_id) then
      raise exception
        'No se puede editar monto, fecha, cuenta, tipo o canal de un movimiento generado por un documento (sueldo, préstamo, cheque, saldo inicial o cuenta corriente de un empleado): editá el documento de origen'
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
    when old.check_sale_id is not null then 'una venta de cheques'
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
    when exists (select 1 from public.employee_account_movements where transaction_id = old.id)
      then 'la cuenta corriente de un empleado'
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

-- Same as 20261103060100 plus the check sale.
create or replace function public.transaction_is_loose(p_tx public.transactions)
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
     and p_tx.check_sale_id is null
     and p_tx.transfer_pair_id is null
     and not p_tx.is_payroll
     and not exists (select 1 from public.payroll_payments where transaction_id = p_tx.id)
     and not exists (select 1 from public.loan_installments where transaction_id = p_tx.id)
     and not exists (select 1 from public.loans where disbursement_transaction_id = p_tx.id)
     and not exists (select 1 from public.check_movements where transaction_id = p_tx.id)
     and not exists (select 1 from public.account_opening_balances where adjustment_transaction_id = p_tx.id)
     and not exists (select 1 from public.employee_account_movements where transaction_id = p_tx.id);
$$;
revoke all on function public.transaction_is_loose(public.transactions) from public, anon, authenticated;

-- Same as 20261103060100 plus 'check_sale'.
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
      when t.check_sale_id is not null then 'check_sale'
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
      when exists (select 1 from public.employee_account_movements eam where eam.transaction_id = t.id)
        then 'employee_account'
    end as source_document,
    t.cost_center_id,
    t.expense_account_id
  from public.transactions t
  join public.invoicing_channels c on c.id = t.channel_id
  join public.accounts a on a.id = t.account_id;

------------------------------------------------------------------------------
-- 4. sell_checks
------------------------------------------------------------------------------
create function public.sell_checks(
  p_check_ids       uuid[],
  p_account_id      uuid,
  p_sale_date       date,
  p_channel_id      text,
  p_buyer_name      text,
  p_buyer_cuit      text,
  p_interest        numeric,
  p_commission      numeric,
  p_notes           text,
  p_idempotency_key uuid,
  p_user_id         uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_id    uuid;
  v_check      public.checks%rowtype;
  v_account    public.accounts%rowtype;
  v_currency   text;
  v_gross      numeric := 0;
  v_count      integer := 0;
  v_interest   numeric := round(coalesce(p_interest, 0), 2);
  v_commission numeric := round(coalesce(p_commission, 0), 2);
  v_buyer      text := trim(coalesce(p_buyer_name, ''));
  v_accrual    date;
  v_out_id     uuid;
  v_in_id      uuid;
  v_expense    uuid;
  v_desc       text;
begin
  -- A retry of the same request gets the sale it already made.
  select s.id into v_sale_id
    from public.check_sales s
   where s.idempotency_key = p_idempotency_key;
  if found then
    return v_sale_id;
  end if;

  if p_check_ids is null or cardinality(p_check_ids) = 0 then
    raise exception 'Elegí al menos un cheque.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if (select count(distinct x) from unnest(p_check_ids) x) <> cardinality(p_check_ids) then
    raise exception 'Un cheque está repetido en la venta.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_buyer = '' then
    raise exception 'Falta el comprador de los cheques.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_interest < 0 or v_commission < 0 then
    raise exception 'Los intereses y las comisiones no pueden ser negativos.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if p_sale_date is null or p_channel_id is null then
    raise exception 'Faltan la fecha o el canal de la venta.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_account from public.accounts where id = p_account_id;
  if v_account.id is null or not v_account.is_active then
    raise exception 'La cuenta destino no existe o está inactiva.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_account.type in ('checks', 'echeq') then
    raise exception 'El neto de la venta entra en un banco, caja o billetera, no en una cartera de cheques.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- In id order, so two sales over the same checks lock them the same way.
  for v_check in
    select * from public.checks where id = any (p_check_ids) order by id for update
  loop
    if v_check.status <> 'en_cartera' then
      raise exception 'El cheque % ya no está en cartera (%).', v_check.check_number, v_check.status
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if v_currency is null then
      v_currency := v_check.currency;
    elsif v_currency <> v_check.currency then
      raise exception 'Todos los cheques de una venta van en la misma moneda.'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if v_check.channel_id is not null and v_check.channel_id <> p_channel_id then
      raise exception 'El cheque % es de otro canal: vendelo en el canal del cheque.', v_check.check_number
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_gross := v_gross + v_check.amount;
    v_count := v_count + 1;
  end loop;

  if v_count <> cardinality(p_check_ids) then
    raise exception 'Algún cheque de la venta no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_account.currency <> v_currency then
    raise exception 'La cuenta destino tiene que estar en la moneda de los cheques (%).', v_currency
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_interest + v_commission >= v_gross then
    raise exception 'Los intereses y comisiones no pueden igualar ni superar el valor de los cheques.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  insert into public.check_sales (
    sale_date, buyer_name, buyer_cuit, account_id, channel_id, currency,
    gross_amount, interest_amount, commission_amount, net_amount, notes,
    idempotency_key, created_by
  ) values (
    p_sale_date, v_buyer, nullif(trim(p_buyer_cuit), ''), p_account_id, p_channel_id, v_currency,
    v_gross, v_interest, v_commission, v_gross - v_interest - v_commission,
    nullif(trim(p_notes), ''), p_idempotency_key, p_user_id
  )
  returning id into v_sale_id;

  v_accrual := date_trunc('month', p_sale_date)::date;

  for v_check in
    select * from public.checks where id = any (p_check_ids) order by id
  loop
    v_out_id := gen_random_uuid();
    v_in_id  := gen_random_uuid();
    v_desc   := 'Venta cheque ' || v_check.check_number || ' a ' || v_buyer;

    insert into public.transactions (
      id, account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, transfer_pair_id, check_sale_id, created_by
    ) values
      (v_out_id, v_check.cartera_account_id, p_channel_id, 'transfer_out',
       v_check.amount, v_check.currency, p_sale_date, v_accrual, v_desc,
       v_in_id, v_sale_id, p_user_id),
      (v_in_id, p_account_id, p_channel_id, 'transfer_in',
       v_check.amount, v_check.currency, p_sale_date, v_accrual, v_desc,
       v_out_id, v_sale_id, p_user_id);

    update public.checks
       set status = 'vendido',
           channel_id = p_channel_id
     where id = v_check.id;

    insert into public.check_movements (
      check_id, event, event_date, destination_account_id, endorsed_to_name,
      endorsed_to_cuit, transaction_id, notes, created_by
    ) values (
      v_check.id, 'sold', p_sale_date, p_account_id, v_buyer,
      nullif(trim(p_buyer_cuit), ''), v_out_id, nullif(trim(p_notes), ''), p_user_id
    );
  end loop;

  -- Intereses pagados when the chart has it as a postable leaf; else the
  -- expense posts to gastos, like any expense without an account.
  select c.id into v_expense
    from public.chart_of_accounts c
   where c.system_role = 'intereses_pagados' and c.is_active
     and public.is_postable_expense_account(c.id)
   limit 1;

  if v_interest > 0 then
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, expense_account_id, check_sale_id, created_by
    ) values (
      p_account_id, p_channel_id, 'expense', v_interest, v_currency, p_sale_date,
      v_accrual, 'Intereses venta de cheques a ' || v_buyer, v_expense, v_sale_id, p_user_id
    );
  end if;
  if v_commission > 0 then
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, expense_account_id, check_sale_id, created_by
    ) values (
      p_account_id, p_channel_id, 'expense', v_commission, v_currency, p_sale_date,
      v_accrual, 'Comisiones venta de cheques a ' || v_buyer, v_expense, v_sale_id, p_user_id
    );
  end if;

  return v_sale_id;
end;
$$;

revoke all on function public.sell_checks(uuid[], uuid, date, text, text, text, numeric, numeric, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sell_checks(uuid[], uuid, date, text, text, text, numeric, numeric, text, uuid, uuid)
  to service_role;

------------------------------------------------------------------------------
-- 5. reject_check takes a sold check
------------------------------------------------------------------------------
-- Same as 20261031192133 plus 'vendido': the outflow leaves the sale's
-- account, or p_account_id when the buyer is repaid from another one.
create or replace function public.reject_check(
  p_check_id   uuid,
  p_account_id uuid,
  p_event_date date,
  p_channel_id text,
  p_notes      text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_channel      text;
  v_account_id   uuid;
  v_tx_id        uuid;
  v_movement_id  uuid;
  v_accrual      date;
begin
  -- Role guard (cheques:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para rechazar cheques'
      using errcode = '42501';
  end if;

  select * into v_check from public.checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status not in ('depositado', 'en_cartera', 'endosado', 'vendido') then
    raise exception 'check % está en estado % — solo se puede rechazar desde depositado, en_cartera, endosado o vendido',
      p_check_id, v_check.status;
  end if;

  if v_check.channel_id is not null then
    if p_channel_id is not null and p_channel_id <> v_check.channel_id then
      raise exception 'El cheque ya tiene canal: el rechazo va en el canal del cheque'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_channel := v_check.channel_id;
  elsif p_channel_id is null then
    raise exception 'El cheque no tiene canal: elegí el canal del rechazo'
      using errcode = '23514', hint = 'jouve_guard';
  else
    v_channel := p_channel_id;
  end if;

  if v_check.status = 'depositado' then
    select m.destination_account_id into v_account_id
      from public.check_movements m
     where m.check_id = p_check_id and m.event = 'deposited'
     order by m.created_at desc, m.id desc
     limit 1;
    if v_account_id is null then
      v_account_id := p_account_id;
    elsif p_account_id is not null and p_account_id <> v_account_id then
      raise exception 'El rechazo sale de la cuenta donde se depositó el cheque'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if v_account_id is null then
      raise exception 'El cheque no tiene cuenta de depósito: elegí la cuenta del rechazo'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  elsif v_check.status = 'vendido' then
    select m.destination_account_id into v_account_id
      from public.check_movements m
     where m.check_id = p_check_id and m.event = 'sold'
     order by m.created_at desc, m.id desc
     limit 1;
    v_account_id := coalesce(p_account_id, v_account_id);
    if v_account_id is null then
      raise exception 'Elegí la cuenta de la que sale la devolución al comprador'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  elsif v_check.status = 'en_cartera' then
    v_account_id := v_check.cartera_account_id;
  end if;

  if v_account_id is not null then
    v_accrual := date_trunc('month', p_event_date)::date;
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, rejected_check_id, created_by
    ) values (
      v_account_id, v_channel, 'expense',
      v_check.amount, v_check.currency, p_event_date, v_accrual,
      'Cheque rechazado ' || v_check.check_number, p_check_id, auth.uid()
    )
    returning id into v_tx_id;
  end if;

  update public.checks
     set status = 'rechazado',
         channel_id = v_channel
   where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, destination_account_id, transaction_id, notes, created_by
  ) values (
    p_check_id, 'rejected', p_event_date, v_account_id, v_tx_id,
    nullif(trim(p_notes), ''), auth.uid()
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

revoke all on function public.reject_check(uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.reject_check(uuid, uuid, date, text, text) to authenticated, service_role;
