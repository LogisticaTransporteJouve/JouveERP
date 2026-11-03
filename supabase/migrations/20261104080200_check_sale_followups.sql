SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Venta de cheques: anulación y deuda con la financiera (follow-up de
-- 20261103100200_check_sales).
--
--   1. check_sales.status ('active' | 'cancelled') + who, when and why.
--      cancel_check_sale anuls a sale entered by mistake: only while every
--      check of it is still vendido (none rejected since) and its month is
--      not a closed accounting period. Flipping the status runs the sale's
--      own trigger (check_sales_cancel_cascade), which deletes the 'sold'
--      movements and the sale's transactions (face-value transfers,
--      interest and commission) and puts the checks back en cartera. The
--      owner's trigger is what may delete owned movements
--      (guard_transaction_owned_by_document lets trigger depth > 1 through);
--      a reconciled movement or a closed period still refuses it
--      (guard_transaction_reconciled, guard_journal_period_closed).
--      guard_check_sale: a sale changes only from active to cancelled, and
--      is never deleted.
--   2. check_sale_debts: a sold check the buyer reports rejected but has not
--      debited yet. reject_sold_check_as_debt rejects it (the client owes it
--      again, as any rejected check) without a treasury movement and records
--      what is owed to the buyer; pay_check_sale_debt pays it later from an
--      account with the same movement reject_check posts when the buyer
--      debits at once (expense with rejected_check_id: Dr Deudores por
--      cheques rechazados / Cr the account). The fiscal journal therefore
--      books it at payment, like before; until then the debt is the
--      operational pasivo shown in Tesorería.
--
-- Rollback: older code ignores the new columns and table. It lists a
-- cancelled sale's checks as en cartera (true) and cannot pay a debt.
--
-- RLS: like check_sales (owner/admin/finance read); writes go through the
-- RPCs (service role; the actions gate on cheques:write).

------------------------------------------------------------------------------
-- 1. Cancelling a sale
------------------------------------------------------------------------------

alter table public.check_sales
  add column status text not null default 'active',
  -- squawk-ignore adding-foreign-key-constraint
  add column cancelled_by uuid references auth.users (id) on delete set null,
  add column cancelled_at timestamptz,
  add column cancel_reason text;

-- The columns are new (every row active, no reason): the checks validate at
-- once.
alter table public.check_sales
  add constraint check_sales_status_check
    check (status in ('active', 'cancelled')) not valid,
  add constraint check_sales_cancelled_consistent check (
    (status = 'active' and cancelled_at is null and cancel_reason is null)
    or (status = 'cancelled' and cancelled_at is not null
        and length(trim(cancel_reason)) between 1 and 500)
  ) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.check_sales validate constraint check_sales_status_check;
-- squawk-ignore constraint-missing-not-valid
alter table public.check_sales validate constraint check_sales_cancelled_consistent;

comment on column public.check_sales.status is
  'active = vigente; cancelled = anulada por error (cancel_check_sale): sus cheques volvieron a cartera y sus movimientos se borraron.';

create function public.guard_check_sale()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una venta de cheques no se borra: anulala.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if old.status = 'cancelled' then
    raise exception 'La venta de cheques ya está anulada.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if (to_jsonb(new) - 'status' - 'cancelled_by' - 'cancelled_at' - 'cancel_reason')
     <> (to_jsonb(old) - 'status' - 'cancelled_by' - 'cancelled_at' - 'cancel_reason') then
    raise exception 'Una venta de cheques no se edita: anulala y cargala de nuevo.'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_check_sale() from public, anon, authenticated;

create trigger check_sales_guard
  before update or delete on public.check_sales
  for each row execute function public.guard_check_sale();

-- The sale undoes what sell_checks wrote. Runs as the sale's own trigger, so
-- the owned movements it deletes pass guard_transaction_owned_by_document.
create function public.check_sale_cancel_cascade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  with sold as (
    delete from public.check_movements m
     using public.transactions t
     where t.id = m.transaction_id
       and t.check_sale_id = new.id
       and m.event = 'sold'
    returning m.check_id
  )
  update public.checks c
     set status = 'en_cartera'
   where c.id in (select check_id from sold);

  -- Both halves of each transfer in one statement (deferrable pair FK).
  delete from public.transactions t
   where t.check_sale_id = new.id;
  return new;
end;
$$;

revoke all on function public.check_sale_cancel_cascade() from public, anon, authenticated;

create trigger check_sales_cancel_cascade
  after update of status on public.check_sales
  for each row
  when (old.status = 'active' and new.status = 'cancelled')
  execute function public.check_sale_cancel_cascade();

create function public.cancel_check_sale(
  p_sale_id uuid,
  p_reason  text,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale   public.check_sales%rowtype;
  v_check  record;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  select * into v_sale from public.check_sales where id = p_sale_id for update;
  if v_sale.id is null then
    raise exception 'La venta de cheques no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_sale.status = 'cancelled' then
    return;
  end if;
  if v_reason = '' then
    raise exception 'Contá por qué se anula la venta.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if exists (
    select 1 from public.accounting_closed_periods p
     where p.period = to_char(v_sale.sale_date, 'YYYY-MM')
  ) then
    raise exception 'El período contable % está cerrado: la venta ya no se anula.',
        to_char(v_sale.sale_date, 'YYYY-MM')
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- Every check of the sale is still sold by it: none rejected, deposited
  -- or moved since. In id order, as sell_checks locks them.
  for v_check in
    select c.id, c.check_number, c.status,
           (select m2.event
              from public.check_movements m2
             where m2.check_id = c.id
             order by m2.created_at desc, m2.id desc
             limit 1) as last_event
      from public.checks c
     where c.id in (
       select m.check_id
         from public.check_movements m
         join public.transactions t on t.id = m.transaction_id
        where t.check_sale_id = p_sale_id
          and m.event = 'sold'
     )
     order by c.id
       for update of c
  loop
    if v_check.status <> 'vendido' or v_check.last_event is distinct from 'sold' then
      raise exception 'El cheque % ya no está vendido (%): la venta no se anula.',
          v_check.check_number, v_check.status
        using errcode = '55006', hint = 'jouve_guard';
    end if;
  end loop;

  update public.check_sales
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = p_user_id,
         cancel_reason = v_reason
   where id = p_sale_id;
end;
$$;

comment on function public.cancel_check_sale(uuid, text, uuid) is
  'Anula una venta de cheques cargada por error: sus cheques vuelven a cartera y se borran sus movimientos. Solo si ningún cheque se movió después y el período está abierto.';

revoke all on function public.cancel_check_sale(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_check_sale(uuid, text, uuid)
  to service_role;

------------------------------------------------------------------------------
-- 2. Debt with the buyer of a rejected sold check
------------------------------------------------------------------------------

create table public.check_sale_debts (
  id                  uuid primary key default gen_random_uuid(),
  check_id            uuid not null references public.checks (id) on delete restrict,
  sale_id             uuid not null references public.check_sales (id) on delete restrict,
  amount              numeric(18, 2) not null check (amount > 0),
  currency            text not null check (currency in ('ARS', 'USD')),
  rejected_on         date not null,
  notes               text check (length(notes) <= 1000),
  paid_at             date,
  paid_transaction_id uuid unique references public.transactions (id) on delete restrict,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),

  constraint check_sale_debts_check_key unique (check_id),
  constraint check_sale_debts_paid_consistent check (
    (paid_at is null) = (paid_transaction_id is null)
  )
);

comment on table public.check_sale_debts is
  'Deuda con el comprador (banco o financiera) de un cheque vendido que rebotó y todavía no se debitó: se paga después (pay_check_sale_debt). Pendiente = paid_at null.';

create index check_sale_debts_sale_idx on public.check_sale_debts (sale_id);
create index check_sale_debts_pending_idx
  on public.check_sale_debts (rejected_on) where paid_at is null;

alter table public.check_sale_debts enable row level security;

create policy "check_sale_debts select"
  on public.check_sale_debts for select to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.check_sale_debts from public, anon;

-- Rejects a sold check whose buyer will debit it later: the check is
-- rechazado (the client owes it, v_client_account_movements) with no
-- treasury movement, and the debt to the buyer is recorded. Returns the
-- debt; a second call on the same check returns it.
create function public.reject_sold_check_as_debt(
  p_check_id   uuid,
  p_event_date date,
  p_notes      text,
  p_user_id    uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.checks%rowtype;
  v_sale  uuid;
  v_id    uuid;
begin
  select * into v_check from public.checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'El cheque no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  select d.id into v_id from public.check_sale_debts d where d.check_id = p_check_id;
  if found then
    return v_id;
  end if;

  if v_check.status <> 'vendido' then
    raise exception 'Solo un cheque vendido queda como deuda con el comprador (este está %).', v_check.status
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if p_event_date is null then
    raise exception 'Falta la fecha del rechazo.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select t.check_sale_id into v_sale
    from public.check_movements m
    join public.transactions t on t.id = m.transaction_id
   where m.check_id = p_check_id and m.event = 'sold'
   order by m.created_at desc, m.id desc
   limit 1;
  if v_sale is null then
    raise exception 'No se encontró la venta del cheque %.', v_check.check_number
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  update public.checks set status = 'rechazado' where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, destination_account_id, transaction_id, notes, created_by
  ) values (
    p_check_id, 'rejected', p_event_date, null, null,
    coalesce(nullif(trim(p_notes), ''), 'Rechazado: lo debe el comprador de la venta'), p_user_id
  );

  insert into public.check_sale_debts (
    check_id, sale_id, amount, currency, rejected_on, notes, created_by
  ) values (
    p_check_id, v_sale, v_check.amount, v_check.currency, p_event_date,
    nullif(trim(p_notes), ''), p_user_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.reject_sold_check_as_debt(uuid, date, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reject_sold_check_as_debt(uuid, date, text, uuid)
  to service_role;

-- Pays the debt from an account (the buyer debits it now): the same
-- movement as an immediate rejection of a sold check. Paying twice returns
-- the same movement.
create function public.pay_check_sale_debt(
  p_debt_id      uuid,
  p_account_id   uuid,
  p_payment_date date,
  p_user_id      uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_debt    public.check_sale_debts%rowtype;
  v_check   public.checks%rowtype;
  v_account public.accounts%rowtype;
  v_tx      uuid;
begin
  select * into v_debt from public.check_sale_debts where id = p_debt_id for update;
  if v_debt.id is null then
    raise exception 'La deuda no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_debt.paid_transaction_id is not null then
    return v_debt.paid_transaction_id;
  end if;
  if p_payment_date is null or p_payment_date < v_debt.rejected_on then
    raise exception 'El pago no puede ser anterior al rechazo (%).', to_char(v_debt.rejected_on, 'DD/MM/YYYY')
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_account from public.accounts where id = p_account_id;
  if v_account.id is null or not v_account.is_active then
    raise exception 'La cuenta elegida no existe o está inactiva.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_account.type in ('checks', 'echeq') then
    raise exception 'La deuda se paga desde un banco, caja o billetera, no desde una cartera de cheques.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if v_account.currency <> v_debt.currency then
    raise exception 'La cuenta tiene que estar en la moneda del cheque (%).', v_debt.currency
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_check from public.checks where id = v_debt.check_id;

  insert into public.transactions (
    account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, rejected_check_id, created_by
  ) values (
    p_account_id, v_check.channel_id, 'expense', v_debt.amount, v_debt.currency,
    p_payment_date, date_trunc('month', p_payment_date)::date,
    'Cheque rechazado ' || v_check.check_number || ' — pago al comprador',
    v_check.id, p_user_id
  )
  returning id into v_tx;

  update public.check_sale_debts
     set paid_at = p_payment_date,
         paid_transaction_id = v_tx
   where id = p_debt_id;

  return v_tx;
end;
$$;

revoke all on function public.pay_check_sale_debt(uuid, uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function public.pay_check_sale_debt(uuid, uuid, date, uuid)
  to service_role;
