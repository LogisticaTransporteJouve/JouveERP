SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 0.7b + 0.8: a third-party check loaded by hand enters the cartera,
-- and every movement a document generated is changed from that document.
--
--   1. transactions.manual_check_id: the cartera inflow of a check loaded by
--      hand ("Nuevo cheque" or the AI document scan, source_kind 'manual').
--      Before, only a receipt booked the inflow, so depositing, endorsing or
--      rejecting a hand-loaded check drained a cartera it never entered.
--      checks_manual_inflow writes it once the check has a channel: at creation, or when a check loaded
--      without one gets it at its deposit, endorsement or rejection.
--      With a client it is a payment on account: build_transaction_journal_lines
--      posts Dr cartera / Cr clientes (Cr ajustes de caja without a client),
--      and v_client_account_movements lists it (and its bounce, which puts
--      the debt back) in the client's statement.
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
     or p_transaction.issued_check_id is not null
     or p_transaction.kind not in ('income', 'expense', 'transfer_in') then
    return null;
  end if;

  v_role := public.coa_role_for_account(p_transaction.account_id);
  if v_role is null then
    raise warning 'build_transaction_journal_lines: account % sin mapping COA, asiento omitido', p_transaction.account_id;
    return null;
  end if;

  if p_transaction.kind = 'income' then
    -- A check a client handed over without a receipt pays on account: it
    -- credits clientes, like a receipt with no allocation.
    return jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', p_transaction.amount, 'description', p_description),
      jsonb_build_object(
        'system_role',
        case when p_transaction.manual_check_id is not null
               and p_transaction.counterparty_client_id is not null
             then 'clientes' else 'ajustes_caja' end,
        'credit', p_transaction.amount, 'description', p_description)
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

create or replace view public.v_client_account_movements with (security_invoker = on) as
  select
    'invoice'::text                      as source_type,
    c.id                                 as source_id,
    c.client_id,
    c.fecha                              as movement_date,
    c.created_at,
    c.kind,
    c.letter,
    c.punto_venta,
    c.numero,
    case when c.kind = 'nc' then -1::numeric * c.imp_total else c.imp_total end as signed_amount,
    c.imp_total                          as gross_amount,
    c.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    c.status,
    case when coalesce(c.moneda, 'PES') in ('DOL', 'USD') then 'USD' else 'ARS' end as currency
  from public.invoices c
  join public.invoicing_channels ch on ch.id = c.channel_id
  where c.status = 'emitted'
  union all
  select
    'receipt'::text                      as source_type,
    r.id                                 as source_id,
    r.client_id,
    r.receipt_date                       as movement_date,
    r.created_at,
    'receipt'::text                      as kind,
    null::text                           as letter,
    r.punto_venta,
    r.numero,
    -1::numeric * r.total_amount         as signed_amount,
    r.total_amount                       as gross_amount,
    r.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    r.status,
    r.currency
  from public.receipts r
  join public.invoicing_channels ch on ch.id = r.channel_id
  where r.status = 'issued'
  union all
  -- The opening balance has no currency column: it is in pesos.
  select
    'opening_balance'::text              as source_type,
    null::uuid                           as source_id,
    ob.client_id,
    ob.opening_date                      as movement_date,
    ob.created_at,
    'opening_balance'::text              as kind,
    null::text                           as letter,
    null::integer                        as punto_venta,
    null::integer                        as numero,
    ob.target_balance                    as signed_amount,
    ob.target_balance                    as gross_amount,
    null::text                           as channel_id,
    null::boolean                        as channel_is_fiscal,
    null::text                           as channel_name,
    'issued'::text                       as status,
    'ARS'::text                          as currency
  from public.client_opening_balances ob
  union all
  -- A check of an issued receipt that bounced: the client owes it again. The
  -- receipt's allocations stay (the invoice reads paid); this row puts the
  -- debt back in the running balance. A receipt that settles it credits the
  -- balance like any receipt.
  select
    'rejected_check'::text               as source_type,
    k.id                                 as source_id,
    r.client_id,
    coalesce(rej.event_date, k.updated_at::date) as movement_date,
    coalesce(rej.created_at, k.updated_at)       as created_at,
    'rejected_check'::text               as kind,
    null::text                           as letter,
    r.punto_venta,
    r.numero,
    k.amount                             as signed_amount,
    k.amount                             as gross_amount,
    r.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    k.status,
    k.currency
  from public.checks k
  join public.receipts r on r.id = k.source_receipt_id
  join public.invoicing_channels ch on ch.id = r.channel_id
  left join lateral (
    select m.event_date, m.created_at
      from public.check_movements m
     where m.check_id = k.id and m.event = 'rejected'
     order by m.created_at desc, m.id desc
     limit 1
  ) rej on true
  where k.status = 'rechazado'
    and r.status = 'issued'
  union all
  -- A check the client handed over without a receipt (loaded by hand): a
  -- payment on account once it is in the cartera (it has a channel).
  select
    'manual_check'::text                 as source_type,
    k.id                                 as source_id,
    k.source_client_id                   as client_id,
    k.issue_date                         as movement_date,
    k.created_at,
    'manual_check'::text                 as kind,
    null::text                           as letter,
    null::integer                        as punto_venta,
    null::integer                        as numero,
    -1::numeric * k.amount               as signed_amount,
    k.amount                             as gross_amount,
    k.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    k.status,
    k.currency
  from public.checks k
  join public.invoicing_channels ch on ch.id = k.channel_id
  where k.source_kind = 'manual'
    and k.source_client_id is not null
  union all
  -- That check bounced: the client owes it again.
  select
    'rejected_check'::text               as source_type,
    k.id                                 as source_id,
    k.source_client_id                   as client_id,
    coalesce(rej.event_date, k.updated_at::date) as movement_date,
    coalesce(rej.created_at, k.updated_at)       as created_at,
    'rejected_check'::text               as kind,
    null::text                           as letter,
    null::integer                        as punto_venta,
    null::integer                        as numero,
    k.amount                             as signed_amount,
    k.amount                             as gross_amount,
    k.channel_id,
    ch.is_fiscal                         as channel_is_fiscal,
    ch.name                              as channel_name,
    k.status,
    k.currency
  from public.checks k
  join public.invoicing_channels ch on ch.id = k.channel_id
  left join lateral (
    select m.event_date, m.created_at
      from public.check_movements m
     where m.check_id = k.id and m.event = 'rejected'
     order by m.created_at desc, m.id desc
     limit 1
  ) rej on true
  where k.source_kind = 'manual'
    and k.source_client_id is not null
    and k.status = 'rechazado';
