SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 0.7b + 0.8: a third-party check loaded by hand enters the cartera,
-- and every movement a document generated is changed from that document.
--
--   1. transactions.manual_check_id: the cartera inflow of a check loaded by
--      hand ("Nuevo cheque" or the AI document scan, source_kind 'manual').
--      Before, only a receipt booked the inflow, so depositing, endorsing or
--      rejecting a hand-loaded check drained a cartera it never entered.
--      checks_manual_inflow writes it (income, Dr cartera / Cr ajustes de
--      caja through build_transaction_journal_lines, like any hand income)
--      once the check has a channel: at creation, or when a check loaded
--      without one gets it at its deposit, endorsement or rejection.
--   2. guard_transaction_owned_by_document: editing amount, date, account,
--      kind or channel is refused for movements of a rejected check, a manual
--      check, a loan installment, a check movement or an opening balance (it
--      was refused only for payroll); deleting one of a rejected or manual
--      check is refused too. The owners' own RPCs still pass (stack bypass).
--   3. v_transactions_tagged.source_document names 'manual_check', so
--      Tesorería hides edit and delete for it.
--
-- Existing hand-loaded checks get no inflow here (one still without channel
-- gets it when it is assigned): the ones already deposited or endorsed
-- drained the cartera; how to correct them is listed in the PR.

alter table public.transactions
  -- squawk-ignore adding-foreign-key-constraint
  add column manual_check_id uuid references public.checks (id) on delete restrict;

comment on column public.transactions.manual_check_id is
  'Cheque de tercero cargado a mano (sin recibo) cuyo ingreso a cartera es este movimiento (lo escribe checks_manual_inflow).';

-- squawk-ignore require-concurrent-index-creation
create unique index transactions_manual_check_unique
  on public.transactions (manual_check_id) where manual_check_id is not null;

create or replace function public.checks_manual_inflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Booked once, when the check has a channel: at creation, or when a check
  -- loaded without one gets it (deposit, endorsement or rejection pick it).
  if exists (select 1 from public.transactions where manual_check_id = new.id) then
    return new;
  end if;
  insert into public.transactions (
    account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, counterparty_client_id, manual_check_id, created_by
  ) values (
    new.cartera_account_id, new.channel_id, 'income', new.amount, new.currency,
    current_date, date_trunc('month', current_date)::date,
    'Cheque recibido #' || new.check_number || ' ' || new.bank_name,
    new.source_client_id, new.id, coalesce(new.created_by, auth.uid())
  );
  return new;
end;
$$;

revoke all on function public.checks_manual_inflow() from public, anon, authenticated;

create trigger checks_manual_inflow
  after insert or update of channel_id on public.checks
  for each row
  when (new.source_kind = 'manual' and new.channel_id is not null)
  execute function public.checks_manual_inflow();

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
        or exists (select 1 from public.check_movements where transaction_id = old.id)
        or exists (select 1 from public.account_opening_balances where adjustment_transaction_id = old.id))
       and (new.amount           is distinct from old.amount
         or new.transaction_date is distinct from old.transaction_date
         or new.accrual_month    is distinct from old.accrual_month
         or new.account_id       is distinct from old.account_id
         or new.kind             is distinct from old.kind
         or new.channel_id       is distinct from old.channel_id) then
      raise exception
        'No se puede editar monto, fecha, cuenta, tipo o canal de un movimiento generado por un documento (sueldo, cuota, cheque o saldo inicial): editá el documento de origen'
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
      when exists (select 1 from public.check_movements cm where cm.transaction_id = t.id)
        then 'check_movement'
      when exists (select 1 from public.account_opening_balances aob where aob.adjustment_transaction_id = t.id)
        then 'account_opening_balance'
    end as source_document
  from public.transactions t
  join public.invoicing_channels c on c.id = t.channel_id
  join public.accounts a on a.id = t.account_id;

