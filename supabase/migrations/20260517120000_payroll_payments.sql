-- N.3 — Pagos de planilla con integración a caja.
--
-- Cada `payroll_payments` row es un tramo de pago a un empleado. Métodos
-- iniciales: transferencia | efectivo. Al insertar, un trigger crea una
-- `transactions` row tipo `expense` en `account_id` por `amount`, con
-- `accrual_month` = primer día del mes del período. El trigger setea
-- `payment.transaction_id` ANTES del insert para mantener la relación
-- 1-a-1 sin race. Update propaga al transaction; delete lo borra.
--
-- Para choferes (pay_frequency=semanal): se van registrando pagos
-- durante el mes (los "adelantos" del Excel viejo). El saldo del entry
-- se calcula en una vista nueva `v_payroll_entries_with_payments`.

set row_security = off;

------------------------------------------------------------------------------
-- 1. payroll_payments
------------------------------------------------------------------------------
create type public.payroll_payment_method as enum ('transferencia', 'efectivo');

create table public.payroll_payments (
  id              uuid primary key default gen_random_uuid(),
  entry_id        uuid not null references public.payroll_entries (id) on delete cascade,
  account_id      uuid not null references public.accounts (id) on delete restrict,
  channel_id      text not null references public.invoicing_channels (id) on delete restrict,
  amount          numeric(18, 2) not null check (amount > 0),
  method          public.payroll_payment_method not null,
  paid_at         date not null,
  transaction_id  uuid references public.transactions (id) on delete set null,
  notes           text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.payroll_payments is
  'Tramos de pago a empleados. Trigger sincroniza con public.transactions.';

create index payroll_payments_entry_idx on public.payroll_payments (entry_id);
create index payroll_payments_account_idx on public.payroll_payments (account_id);
create index payroll_payments_paid_at_idx on public.payroll_payments (paid_at desc);
create index payroll_payments_transaction_idx
  on public.payroll_payments (transaction_id) where transaction_id is not null;

create trigger payroll_payments_set_updated_at
  before update on public.payroll_payments
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- 2. Auto-link to transactions via trigger
------------------------------------------------------------------------------
create or replace function public.payroll_payment_sync_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_year   int;
  v_period_month  int;
  v_employee_name text;
  v_accrual       date;
  v_description   text;
begin
  if tg_op = 'INSERT' then
    select pp.year, pp.month, e.legal_name
      into v_period_year, v_period_month, v_employee_name
    from public.payroll_entries pe
    join public.payroll_periods pp on pp.id = pe.period_id
    join public.employees e on e.id = pe.employee_id
    where pe.id = new.entry_id;

    v_accrual := make_date(v_period_year, v_period_month, 1);
    v_description :=
      'Sueldo ' || v_employee_name
      || ' (' || lpad(v_period_month::text, 2, '0') || '/' || v_period_year::text || ')'
      || coalesce(' — ' || nullif(new.notes, ''), '');

    insert into public.transactions (
      account_id, channel_id, kind, amount, currency,
      transaction_date, accrual_month, description, created_by
    )
    values (
      new.account_id, new.channel_id, 'expense', new.amount, 'ARS',
      new.paid_at, v_accrual, v_description, new.created_by
    )
    returning id into new.transaction_id;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.transaction_id is not null then
      update public.transactions
         set account_id       = new.account_id,
             channel_id       = new.channel_id,
             amount           = new.amount,
             transaction_date = new.paid_at,
             updated_at       = now()
       where id = new.transaction_id;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.transaction_id is not null then
      delete from public.transactions where id = old.transaction_id;
    end if;
    return old;
  end if;

  return null;
end;
$$;

comment on function public.payroll_payment_sync_transaction() is
  'Mantiene 1-a-1 entre payroll_payments y transactions. expense en ARS, accrual_month = primer día del mes del período.';

create trigger payroll_payments_create_transaction
  before insert on public.payroll_payments
  for each row execute function public.payroll_payment_sync_transaction();

create trigger payroll_payments_update_transaction
  after update on public.payroll_payments
  for each row execute function public.payroll_payment_sync_transaction();

create trigger payroll_payments_delete_transaction
  before delete on public.payroll_payments
  for each row execute function public.payroll_payment_sync_transaction();

------------------------------------------------------------------------------
-- 3. v_payroll_entries_with_payments — entry + extras + payments aggregation
------------------------------------------------------------------------------
create or replace view public.v_payroll_entries_with_payments as
select
  r.id,
  r.period_id,
  r.employee_id,
  r.sueldo_neto,
  r.extras_total,
  r.vacaciones_monto,
  r.viaticos,
  r.deudas,
  r.telefono,
  r.total_a_pagar,
  coalesce(p.paid_total, 0)                  as paid_total,
  r.total_a_pagar - coalesce(p.paid_total, 0) as saldo,
  coalesce(p.payments_count, 0)              as payments_count,
  r.notes,
  r.created_at,
  r.updated_at
from public.v_payroll_entries_resolved r
left join lateral (
  select sum(amount) as paid_total, count(*)::int as payments_count
  from public.payroll_payments
  where entry_id = r.id
) p on true;

comment on view public.v_payroll_entries_with_payments is
  'Entry resolved + paid_total y saldo (total_a_pagar − paid_total).';

------------------------------------------------------------------------------
-- 4. RLS
------------------------------------------------------------------------------
alter table public.payroll_payments enable row level security;

create policy "hr can read payments"
  on public.payroll_payments for select
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can insert payments"
  on public.payroll_payments for insert
  to authenticated
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can update payments"
  on public.payroll_payments for update
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']))
  with check (public.user_has_role(array['owner', 'admin', 'finance']));

create policy "hr can delete payments"
  on public.payroll_payments for delete
  to authenticated
  using (public.user_has_role(array['owner', 'admin', 'finance']));

set row_security = on;
