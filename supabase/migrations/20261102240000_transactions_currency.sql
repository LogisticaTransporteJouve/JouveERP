SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 1.3 (Moneda y USD): a treasury movement carries its account's
-- currency, and a USD movement is never posted to the journal as pesos.
--
--   1. guard_transaction_account_currency: a movement's currency must be its
--      account's (BEFORE INSERT / UPDATE OF account_id, currency). Every writer
--      already copies one or the other (receipts and payment orders the
--      document's, checks the check's, loans the loan's, payroll 'ARS'), and
--      none means to mix them: a USD amount in a peso account inflates its
--      balance. guard_account_currency_change refuses changing an account's
--      currency once it has movements.
--   2. build_transaction_journal_lines: a USD movement posts its pesos at
--      get_exchange_rate('USD', transaction_date), rounded per line, the same
--      fallback a receipt or payment order without cotización uses. Without
--      any rate on or before that date it posts nothing, and
--      journal_missing_entries lists it as 'sin_cotizacion'. Before, it posted
--      the dollar amount as pesos.
--
-- Existing USD movements keep the entry they have: journal_missing_entries
-- reports them as 'differs' until someone edits them (which re-posts in an
-- open period). Existing rows whose currency differs from their account's are
-- not touched; the guard only checks writes that change account or currency.

-- 1. Currency of the movement = currency of the account --------------------------

create or replace function public.guard_transaction_account_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_currency text;
begin
  select a.currency into v_account_currency
    from public.accounts a where a.id = new.account_id;
  if v_account_currency is not null and new.currency is distinct from v_account_currency then
    raise exception 'La moneda del movimiento (%) no coincide con la de la cuenta (%): elegí una cuenta en %',
      new.currency, v_account_currency, new.currency
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_transaction_account_currency() from public, anon, authenticated;

create trigger transactions_guard_account_currency
  before insert or update of account_id, currency on public.transactions
  for each row execute function public.guard_transaction_account_currency();

create or replace function public.guard_account_currency_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency is distinct from old.currency
     and exists (select 1 from public.transactions t where t.account_id = old.id) then
    raise exception 'No se puede cambiar la moneda de una cuenta con movimientos: creá otra cuenta en %', new.currency
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_account_currency_change() from public, anon, authenticated;

create trigger accounts_guard_currency_change
  before update of currency on public.accounts
  for each row execute function public.guard_account_currency_change();

-- 2. USD movements post their pesos ----------------------------------------------

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
    -- credits clientes, like a receipt with no allocation.
    return jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', v_amount, 'description', p_description),
      jsonb_build_object(
        'system_role',
        case when p_transaction.manual_check_id is not null
               and p_transaction.counterparty_client_id is not null
             then 'clientes' else 'ajustes_caja' end,
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

create or replace function public.journal_missing_entries()
returns table (source_table text, source_id uuid, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doc record;
begin
  for v_doc in
    select 'invoices'::text as src, i.id, false as usd_without_rate
      from public.invoices i join public.invoicing_channels c on c.id = i.channel_id
     where c.is_fiscal and i.status = 'emitted'
    union all
    select 'purchase_invoices', p.id, false
      from public.purchase_invoices p join public.invoicing_channels c on c.id = p.channel_id
     where c.is_fiscal and p.status = 'received'
    union all
    select 'receipts', r.id, false
      from public.receipts r join public.invoicing_channels c on c.id = r.channel_id
     where c.is_fiscal and r.status = 'issued'
    union all
    select 'payment_orders', po.id, false
      from public.payment_orders po join public.invoicing_channels c on c.id = po.channel_id
     where c.is_fiscal and po.status = 'issued'
    union all
    select 'transactions', t.id,
           t.currency = 'USD' and public.get_exchange_rate('USD', t.transaction_date) is null
      from public.transactions t join public.invoicing_channels c on c.id = t.channel_id
     where c.is_fiscal
       and t.invoice_id is null and t.receipt_id is null and t.payment_order_id is null
       and t.kind in ('income', 'expense', 'transfer_in')
  loop
    source_table := v_doc.src;
    source_id := v_doc.id;
    begin
      status := public.journal_entry_status(v_doc.src, v_doc.id);
    exception when others then
      status := sqlerrm;
    end;
    if status = 'none' and v_doc.usd_without_rate then
      status := 'sin_cotizacion';
    end if;
    if status not in ('match', 'none', 'not_live') then
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.journal_missing_entries() from public, anon, authenticated;
