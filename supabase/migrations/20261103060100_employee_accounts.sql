SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Cuenta corriente del empleado (decision D1, roadmap 3.3 + 3.4).
--
--   1. COA: "Anticipos al personal" (1.1.4.x, activo) takes the role
--      anticipos_personal unless an active account already holds it.
--   2. employee_debt_plans: how a debt is paid back (total, installment,
--      ARS/USD, activo/pausado/cancelado/condonado, creditor empresa or
--      socio). v_employee_debt_plans adds what was paid and what remains.
--   3. employee_account_movements: the account itself. Debits (the employee
--      owes more): advance, charge. Credits: payroll_discount, payment,
--      forgiveness. Amounts are positive; v_employee_account_balances signs
--      them and sums per employee and currency. Each movement is owned by its
--      source: an advance or a cash payment by its treasury movement
--      (record_employee_account_cash), a charge from a purchase by the
--      purchase, a payroll discount by the closed planilla, a forgiveness by
--      its plan. guard_employee_account_movement refuses writing an owned
--      movement from anywhere else; only the description is editable.
--   4. Planilla: payroll_entries.deudas comes from the employee's active ARS
--      plans (each plan's installment, capped at what remains) on insert and
--      whenever a plan or a plan credit changes, in draft monthly periods.
--      A hand edit sets deudas_override and keeps the typed amount; setting
--      deudas_override back to false recomputes it. Existing draft entries
--      with deudas keep them (deudas_override = true). Closing a period
--      writes its deudas to the account as payroll_discount movements (to
--      each active ARS plan up to its installment, or up to what remains
--      when overridden; any rest without a plan) and reopening deletes them.
--      Periods closed before this migration write nothing.
--   5. Purchases: purchase_invoices.charged_employee_id ("a cargo de
--      empleado"). A received factura or ND charged to an employee keeps its
--      Libro IVA and IVA lines; its neto posts to anticipos_personal instead
--      of the expense account (out of the operating cost in Gestión) and its
--      total is a charge movement in the employee's account, in its
--      currency. Cancelling it or clearing the field deletes the charge.
--   6. Treasury: record_employee_account_cash writes an advance (expense) or
--      an employee's cash payment (income) and the movement that owns it;
--      the treasury movement posts against anticipos_personal.
--      delete_employee_account_movement deletes a manual or cash movement
--      (and its treasury movement). guard_transaction_owned_by_document,
--      transaction_is_loose, guard_transaction_expense_account and
--      v_transactions_tagged ('employee_account') know the owner.
--   7. get_management_pnl (same signature and result): in devengado a
--      payroll discount, and the forgiveness of a company debt, count as
--      internal salaries of their month (the advance itself is an asset and
--      no longer a cost); in percibido an advance or an employee's payment
--      counts as salaries paid, by channel. A USD advance without a rate is
--      not "pending USD" cost.
--
-- The fiscal journal does not post the payroll discount: the liquidador's
-- salary entry cancels the advance. Older code keeps working: it ignores the
-- new columns, and a hand edit of deudas from it is marked as an override.

-- 1. Chart of accounts -------------------------------------------------------------

do $$
declare
  v_parent uuid;
  v_code   text;
begin
  if not exists (
    select 1 from public.chart_of_accounts where system_role = 'anticipos_personal' and is_active
  ) then
    select id into v_parent from public.chart_of_accounts where code = '1.1.4';
    if v_parent is not null then
      select '1.1.4.' || (coalesce(max(substring(code from '^1\.1\.4\.([0-9]+)$')::int), 0) + 1)
        into v_code
        from public.chart_of_accounts
       where code ~ '^1\.1\.4\.[0-9]+$';
      insert into public.chart_of_accounts (parent_id, code, name, level, account_type, system_role)
      values (v_parent, v_code, 'Anticipos al personal', 4, 'activo', 'anticipos_personal');
    end if;
  end if;
end;
$$;

-- 2. Plans ---------------------------------------------------------------------------

create table public.employee_debt_plans (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees (id) on delete restrict,
  description        text not null check (length(description) between 1 and 200),
  currency           text not null check (currency in ('ARS', 'USD')),
  total              numeric(15, 2) not null check (total > 0),
  installment_amount numeric(15, 2) not null check (installment_amount > 0),
  start_month        date not null,
  status             text not null default 'activo'
                       check (status in ('activo', 'pausado', 'cancelado', 'condonado')),
  creditor           text not null default 'empresa' check (creditor in ('empresa', 'socio')),
  creditor_name      text check (length(creditor_name) <= 120),
  notes              text check (length(notes) <= 500),
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint employee_debt_plans_installment_le_total check (installment_amount <= total),
  constraint employee_debt_plans_start_month check (start_month = date_trunc('month', start_month)::date)
);

comment on table public.employee_debt_plans is
  'Plan de devolución de una deuda del empleado: total, cuota, moneda, estado y acreedor (empresa o socio). La cuota es el descuento por defecto en la planilla (solo ARS).';
comment on column public.employee_debt_plans.start_month is
  'Primer mes (día 1) en que la planilla descuenta la cuota.';
comment on column public.employee_debt_plans.creditor_name is
  'Nombre del socio cuando el acreedor es un socio.';

create index employee_debt_plans_employee_idx on public.employee_debt_plans (employee_id, start_month);

create trigger employee_debt_plans_set_updated_at
  before update on public.employee_debt_plans
  for each row execute function public.set_updated_at();

alter table public.employee_debt_plans enable row level security;

create policy "hr can read debt plans"
  on public.employee_debt_plans for select
  to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "hr can insert debt plans"
  on public.employee_debt_plans for insert
  to authenticated
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "hr can update debt plans"
  on public.employee_debt_plans for update
  to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "hr can delete debt plans"
  on public.employee_debt_plans for delete
  to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.employee_debt_plans from public, anon;

-- 3. Movements -----------------------------------------------------------------------

create table public.employee_account_movements (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete restrict,
  kind                text not null
                        check (kind in ('advance', 'charge', 'payroll_discount', 'payment', 'forgiveness')),
  currency            text not null check (currency in ('ARS', 'USD')),
  amount              numeric(15, 2) not null check (amount > 0),
  movement_date       date not null,
  description         text not null check (length(description) between 1 and 200),
  creditor            text not null default 'empresa' check (creditor in ('empresa', 'socio')),
  plan_id             uuid references public.employee_debt_plans (id) on delete restrict,
  transaction_id      uuid references public.transactions (id) on delete restrict,
  purchase_invoice_id uuid references public.purchase_invoices (id) on delete cascade,
  payroll_entry_id    uuid references public.payroll_entries (id) on delete restrict,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint employee_account_movements_source check (
    (kind = 'advance' and transaction_id is not null
       and purchase_invoice_id is null and payroll_entry_id is null)
    or (kind = 'charge' and transaction_id is null and payroll_entry_id is null)
    or (kind = 'payroll_discount' and payroll_entry_id is not null
       and transaction_id is null and purchase_invoice_id is null)
    or (kind = 'payment' and purchase_invoice_id is null and payroll_entry_id is null)
    or (kind = 'forgiveness' and plan_id is not null and transaction_id is null
       and purchase_invoice_id is null and payroll_entry_id is null)
  )
);

comment on table public.employee_account_movements is
  'Cuenta corriente del empleado. Debe: advance (adelanto de caja), charge (compra a su cargo o deuda cargada a mano). Haber: payroll_discount (descuento de planilla cerrada), payment (pago del empleado), forgiveness (condonación de un plan). Importes positivos.';

create unique index employee_account_movements_transaction_key
  on public.employee_account_movements (transaction_id) where transaction_id is not null;
create unique index employee_account_movements_purchase_key
  on public.employee_account_movements (purchase_invoice_id) where purchase_invoice_id is not null;
create index employee_account_movements_employee_idx
  on public.employee_account_movements (employee_id, movement_date);
create index employee_account_movements_plan_idx
  on public.employee_account_movements (plan_id) where plan_id is not null;
create index employee_account_movements_entry_idx
  on public.employee_account_movements (payroll_entry_id) where payroll_entry_id is not null;

create trigger employee_account_movements_set_updated_at
  before update on public.employee_account_movements
  for each row execute function public.set_updated_at();

alter table public.employee_account_movements enable row level security;

create policy "hr can read employee account movements"
  on public.employee_account_movements for select
  to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "hr can insert employee account movements"
  on public.employee_account_movements for insert
  to authenticated
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "hr can update employee account movements"
  on public.employee_account_movements for update
  to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

create policy "hr can delete employee account movements"
  on public.employee_account_movements for delete
  to authenticated
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

revoke all on table public.employee_account_movements from public, anon;

create view public.v_employee_debt_plans
with (security_invoker = on) as
select
  p.id,
  p.employee_id,
  p.description,
  p.currency,
  p.total,
  p.installment_amount,
  p.start_month,
  p.status,
  p.creditor,
  p.creditor_name,
  p.notes,
  p.created_at,
  coalesce(x.paid, 0)           as paid,
  p.total - coalesce(x.paid, 0) as remaining
from public.employee_debt_plans p
left join lateral (
  select sum(m.amount) as paid
  from public.employee_account_movements m
  where m.plan_id = p.id
    and m.kind in ('payroll_discount', 'payment', 'forgiveness')
) x on true;

comment on view public.v_employee_debt_plans is
  'Plan + lo pagado (descuentos de planilla, pagos y condonación del plan) y lo que resta (total − pagado).';

create view public.v_employee_account_balances
with (security_invoker = on) as
select
  m.employee_id,
  m.currency,
  sum(case when m.kind in ('advance', 'charge') then m.amount else -m.amount end) as balance,
  sum(case when m.kind in ('advance', 'charge') then m.amount else -m.amount end)
    filter (where m.creditor = 'socio')                                          as balance_socio,
  count(*)::int                                                                  as movements
from public.employee_account_movements m
group by m.employee_id, m.currency;

comment on view public.v_employee_account_balances is
  'Saldo de la cuenta corriente por empleado y moneda (positivo = el empleado debe). balance_socio: la parte cuyo acreedor es un socio.';

-- What the planilla discounts for a plan-backed employee in a period: each
-- active ARS plan started by the period's month, its installment capped at
-- what remains. NULL when no plan applies (the entry keeps its deudas).
create function public.payroll_plan_installments(p_employee_id uuid, p_period_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case when count(*) = 0 then null
              else sum(least(p.installment_amount, p.remaining)) end
  from public.v_employee_debt_plans p
  join public.payroll_periods pp on pp.id = p_period_id
  where p.employee_id = p_employee_id
    and p.status = 'activo'
    and p.currency = 'ARS'
    and pp.kind = 'monthly'
    and p.start_month <= make_date(pp.year, pp.month, 1)
    and p.remaining > 0;
$$;

comment on function public.payroll_plan_installments(uuid, uuid) is
  'Cuotas de los planes activos en ARS del empleado para el mes del período (topeadas a lo que resta); NULL si no aplica ninguno. Security invoker.';

revoke all on function public.payroll_plan_installments(uuid, uuid) from public, anon;
grant execute on function public.payroll_plan_installments(uuid, uuid) to authenticated, service_role;

create function public.guard_employee_account_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  -- the two RPCs write them; nothing else writes an owned one.
  get diagnostics v_stack = pg_context;
  if pg_trigger_depth() > 1
     or v_stack ~ 'function (public\.)?(record_employee_account_cash|delete_employee_account_movement)\(' then
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
     or v_row.kind = 'forgiveness' then
    raise exception '%', case
        when v_row.payroll_entry_id is not null
          then 'El descuento de planilla lo escribe el cierre del período: reabrilo para cambiarlo'
        when v_row.purchase_invoice_id is not null
          then 'El cargo de una compra se maneja desde la compra (a cargo de empleado)'
        when v_row.kind = 'forgiveness'
          then 'La condonación la escribe el plan al marcarlo condonado'
        else 'Un adelanto o pago en caja se registra o se borra desde la cuenta corriente del empleado, junto con su movimiento de caja'
      end
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_employee_account_movement() from public, anon, authenticated;

create trigger employee_account_movements_guard
  before insert or update or delete on public.employee_account_movements
  for each row execute function public.guard_employee_account_movement();

-- 4. Planilla ------------------------------------------------------------------------

alter table public.payroll_entries
  add column deudas_override boolean not null default false;

comment on column public.payroll_entries.deudas_override is
  'true = deudas cargadas a mano para este período; false = la cuota de los planes activos del empleado (payroll_plan_installments).';

-- A draft entry that already has deudas keeps them: they were typed by hand.
update public.payroll_entries pe
   set deudas_override = true
  from public.payroll_periods pp
 where pp.id = pe.period_id
   and pp.status = 'draft'
   and pe.deudas > 0;

create function public.payroll_entry_apply_plans()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_amount numeric;
begin
  if tg_op = 'INSERT' then
    if not new.deudas_override then
      v_amount := public.payroll_plan_installments(new.employee_id, new.period_id);
      if v_amount is not null then
        new.deudas := v_amount;
      end if;
    end if;
    return new;
  end if;

  -- Typed by a user (not by a refresh fired from a plan or a movement).
  if pg_trigger_depth() = 1
     and new.deudas is distinct from old.deudas
     and new.deudas_override is not distinct from old.deudas_override then
    new.deudas_override := true;
  elsif old.deudas_override and not new.deudas_override then
    new.deudas := coalesce(public.payroll_plan_installments(new.employee_id, new.period_id), 0);
  end if;
  return new;
end;
$$;

revoke all on function public.payroll_entry_apply_plans() from public, anon;

create trigger payroll_entries_apply_plans
  before insert or update of deudas, deudas_override on public.payroll_entries
  for each row execute function public.payroll_entry_apply_plans();

create function public.employee_plans_refresh_entries(p_employee_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.payroll_entries pe
     set deudas = coalesce(public.payroll_plan_installments(pe.employee_id, pe.period_id), 0)
    from public.payroll_periods pp
   where pp.id = pe.period_id
     and pp.status = 'draft'
     and pp.kind = 'monthly'
     and pe.employee_id = p_employee_id
     and not pe.deudas_override
     and pe.deudas is distinct from coalesce(public.payroll_plan_installments(pe.employee_id, pe.period_id), 0);
$$;

revoke all on function public.employee_plans_refresh_entries(uuid) from public, anon, authenticated;

create function public.employee_debt_plan_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining numeric;
begin
  if tg_op = 'UPDATE' and new.status = 'condonado' and old.status <> 'condonado' then
    select remaining into v_remaining from public.v_employee_debt_plans where id = new.id;
    if v_remaining > 0 then
      insert into public.employee_account_movements (
        employee_id, kind, currency, amount, movement_date, description, creditor, plan_id, created_by
      ) values (
        new.employee_id, 'forgiveness', new.currency, v_remaining,
        (now() at time zone 'America/Argentina/Buenos_Aires')::date,
        left('Condonación — ' || new.description, 200), new.creditor, new.id, auth.uid()
      );
    end if;
  end if;

  perform public.employee_plans_refresh_entries(coalesce(new.employee_id, old.employee_id));
  if tg_op = 'UPDATE' and new.employee_id is distinct from old.employee_id then
    perform public.employee_plans_refresh_entries(old.employee_id);
  end if;
  return null;
end;
$$;

revoke all on function public.employee_debt_plan_after_write() from public, anon, authenticated;

create trigger employee_debt_plans_after_write
  after insert or update or delete on public.employee_debt_plans
  for each row execute function public.employee_debt_plan_after_write();

create function public.guard_employee_debt_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_movements boolean := exists (
    select 1 from public.employee_account_movements where plan_id = old.id
  );
begin
  if tg_op = 'DELETE' then
    if v_has_movements then
      raise exception 'El plan ya tiene descuentos, pagos o una condonación: cancelalo en vez de borrarlo'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return old;
  end if;
  if old.status = 'condonado' and new.status is distinct from old.status then
    raise exception 'Un plan condonado no cambia de estado'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_has_movements
     and (new.employee_id is distinct from old.employee_id
       or new.currency is distinct from old.currency) then
    raise exception 'El plan ya tiene movimientos: no se cambia de empleado ni de moneda'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_employee_debt_plan() from public, anon, authenticated;

create trigger employee_debt_plans_guard
  before update or delete on public.employee_debt_plans
  for each row execute function public.guard_employee_debt_plan();

create function public.employee_account_movement_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.plan_id, old.plan_id) is not null then
    perform public.employee_plans_refresh_entries(coalesce(new.employee_id, old.employee_id));
  end if;
  return null;
end;
$$;

revoke all on function public.employee_account_movement_after_write() from public, anon, authenticated;

create trigger employee_account_movements_after_write
  after insert or update or delete on public.employee_account_movements
  for each row execute function public.employee_account_movement_after_write();

-- Closing a period writes its deudas to the employees' accounts; reopening
-- takes them back.
create function public.payroll_period_sync_account_discounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry record;
  v_plan  record;
  v_left  numeric;
  v_part  numeric;
  v_date  date := (make_date(new.year, new.month, 1) + interval '1 month - 1 day')::date;
  v_label text := case when new.kind = 'sac'
                       then 'SAC ' || case when new.month = 6 then '1.er' else '2.º' end
                            || ' semestre ' || new.year::text
                       else lpad(new.month::text, 2, '0') || '/' || new.year::text end;
begin
  if old.status = 'closed' and new.status = 'draft' then
    delete from public.employee_account_movements m
     using public.payroll_entries pe
     where pe.id = m.payroll_entry_id
       and pe.period_id = new.id;
    return null;
  end if;
  if not (old.status = 'draft' and new.status = 'closed') then
    return null;
  end if;

  for v_entry in
    select pe.id, pe.employee_id, pe.deudas, pe.deudas_override
      from public.payroll_entries pe
     where pe.period_id = new.id
       and pe.deudas > 0
  loop
    v_left := v_entry.deudas;
    for v_plan in
      select p.id, p.description, p.installment_amount, p.remaining, p.creditor
        from public.v_employee_debt_plans p
       where p.employee_id = v_entry.employee_id
         and p.status = 'activo'
         and p.currency = 'ARS'
         and p.start_month <= make_date(new.year, new.month, 1)
         and p.remaining > 0
       order by p.start_month, p.created_at, p.id
    loop
      exit when v_left <= 0;
      v_part := least(
        v_left,
        case when v_entry.deudas_override then v_plan.remaining
             else least(v_plan.installment_amount, v_plan.remaining) end
      );
      insert into public.employee_account_movements (
        employee_id, kind, currency, amount, movement_date, description, creditor,
        plan_id, payroll_entry_id, created_by
      ) values (
        v_entry.employee_id, 'payroll_discount', 'ARS', v_part, v_date,
        left('Descuento planilla ' || v_label || ' — ' || v_plan.description, 200),
        v_plan.creditor, v_plan.id, v_entry.id, auth.uid()
      );
      v_left := v_left - v_part;
    end loop;

    if v_left > 0 then
      insert into public.employee_account_movements (
        employee_id, kind, currency, amount, movement_date, description, payroll_entry_id, created_by
      ) values (
        v_entry.employee_id, 'payroll_discount', 'ARS', v_left, v_date,
        'Descuento planilla ' || v_label, v_entry.id, auth.uid()
      );
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.payroll_period_sync_account_discounts() from public, anon, authenticated;

create trigger payroll_periods_sync_account_discounts
  after update of status on public.payroll_periods
  for each row
  when (old.status is distinct from new.status)
  execute function public.payroll_period_sync_account_discounts();

-- 5. Purchases charged to an employee --------------------------------------------------

alter table public.purchase_invoices
  -- squawk-ignore adding-foreign-key-constraint
  add column charged_employee_id uuid references public.employees (id) on delete restrict;

comment on column public.purchase_invoices.charged_employee_id is
  'A cargo de empleado: el total va a su cuenta corriente y el neto se asienta en anticipos al personal (fuera del costo de Gestión). Sigue en el Libro IVA.';

-- squawk-ignore require-concurrent-index-creation
create index purchase_invoices_charged_employee_idx
  on public.purchase_invoices (charged_employee_id) where charged_employee_id is not null;

create function public.guard_purchase_employee_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.charged_employee_id is null then
    return new;
  end if;
  if new.kind not in ('factura', 'nd') then
    raise exception 'Solo una factura o nota de débito de compra se carga a un empleado'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if coalesce(new.moneda, 'PES') not in ('PES', 'DOL') then
    raise exception 'Una compra a cargo de empleado tiene que ser en pesos o dólares'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_purchase_employee_charge() from public, anon, authenticated;

create trigger purchase_invoices_guard_employee_charge
  before insert or update of charged_employee_id, kind, moneda on public.purchase_invoices
  for each row execute function public.guard_purchase_employee_charge();

create function public.purchase_invoice_sync_employee_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.charged_employee_id is null or new.status <> 'received' then
    delete from public.employee_account_movements where purchase_invoice_id = new.id;
    return null;
  end if;

  insert into public.employee_account_movements (
    employee_id, kind, currency, amount, movement_date, description, purchase_invoice_id, created_by
  ) values (
    new.charged_employee_id, 'charge',
    case when new.moneda = 'DOL' then 'USD' else 'ARS' end,
    new.imp_total, new.fecha,
    'Compra ' || coalesce(new.letter::text, '') || lpad(new.punto_venta::text, 4, '0')
      || '-' || lpad(new.numero::text, 8, '0') || ' a cargo del empleado',
    new.id, auth.uid()
  )
  on conflict (purchase_invoice_id) where purchase_invoice_id is not null do update
     set employee_id   = excluded.employee_id,
         currency      = excluded.currency,
         amount        = excluded.amount,
         movement_date = excluded.movement_date,
         description   = excluded.description;
  return null;
end;
$$;

revoke all on function public.purchase_invoice_sync_employee_charge() from public, anon, authenticated;

create trigger purchase_invoices_sync_employee_charge
  after insert or update of charged_employee_id, status, imp_total, moneda, fecha, punto_venta, numero
  on public.purchase_invoices
  for each row execute function public.purchase_invoice_sync_employee_charge();

-- Same as 20261031180534 except the neto of a purchase charged to an employee:
-- it debits anticipos_personal (while an active account holds the role).
create or replace function public.build_purchase_invoice_journal_lines(
  p_invoice     public.purchase_invoices,
  p_description text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lines  jsonb := '[]'::jsonb;
  v_debit_detail boolean := p_invoice.kind <> 'nc';
  v_rate   numeric := case
    when p_invoice.moneda is null or p_invoice.moneda = 'PES' then 1
    else coalesce(
      nullif(p_invoice.cotizacion, 0),
      public.get_exchange_rate('USD', p_invoice.fecha),
      1
    )
  end;
  v_neto   numeric := round(p_invoice.imp_neto * v_rate, 2);
  v_iva    numeric := round(p_invoice.imp_iva * v_rate, 2);
  v_trib   numeric := round(p_invoice.imp_trib * v_rate, 2);
  v_prov   numeric;
  v_to_employee boolean := p_invoice.charged_employee_id is not null and exists (
    select 1 from public.chart_of_accounts
     where system_role = 'anticipos_personal' and is_active
  );
begin
  -- Counterparty = sum of the posted detail lines → exact balance.
  v_prov := (case when p_invoice.imp_neto > 0 then v_neto else 0 end)
    + (case when p_invoice.imp_iva > 0 then v_iva else 0 end)
    + (case when p_invoice.imp_trib > 0 then v_trib else 0 end);

  v_lines := v_lines || jsonb_build_object(
    'system_role', 'proveedores',
    case when v_debit_detail then 'credit' else 'debit' end, v_prov,
    'description', p_description || ' — proveedor'
  );
  if p_invoice.imp_neto > 0 then
    v_lines := v_lines || case
      when v_to_employee then jsonb_build_object(
        'system_role', 'anticipos_personal',
        case when v_debit_detail then 'debit' else 'credit' end, v_neto,
        'description', p_description || ' — a cargo de empleado')
      when p_invoice.account_id is not null then jsonb_build_object(
        'account_id', p_invoice.account_id,
        case when v_debit_detail then 'debit' else 'credit' end, v_neto,
        'description', p_description || ' — neto')
      else jsonb_build_object(
        'system_role', 'compras',
        case when v_debit_detail then 'debit' else 'credit' end, v_neto,
        'description', p_description || ' — neto')
    end;
  end if;
  if p_invoice.imp_iva > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'iva_credito',
      case when v_debit_detail then 'debit' else 'credit' end, v_iva,
      'description', p_description || ' — IVA crédito'
    );
  end if;
  if p_invoice.imp_trib > 0 then
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'percepciones_iibb_pagadas',
      case when v_debit_detail then 'debit' else 'credit' end, v_trib,
      'description', p_description || ' — percepciones'
    );
  end if;
  return v_lines;
end;
$$;

revoke all on function public.build_purchase_invoice_journal_lines(public.purchase_invoices, text) from public, anon, authenticated;

-- Same columns as 20261031180534 plus charged_employee_id.
drop trigger purchase_invoices_repost_journal on public.purchase_invoices;
create constraint trigger purchase_invoices_repost_journal
  after update of imp_neto, imp_iva, imp_trib, imp_total, fecha, moneda, cotizacion,
                  account_id, cost_center_id, kind, channel_id, charged_employee_id
  on public.purchase_invoices
  deferrable initially deferred
  for each row execute function public.repost_journal_trigger();

-- 6. Treasury movements of the account -----------------------------------------------------

-- An advance (cash out to the employee) or a payment by the employee (cash
-- in), with the treasury movement that carries it. p_installment_amount on an
-- advance without p_plan_id opens a plan for it (total = the advance) from
-- the advance's month.
create function public.record_employee_account_cash(
  p_employee_id        uuid,
  p_kind               text,
  p_account_id         uuid,
  p_channel_id         text,
  p_date               date,
  p_amount             numeric,
  p_description        text default null,
  p_plan_id            uuid default null,
  p_installment_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name         text;
  v_account      public.accounts;
  v_plan         public.employee_debt_plans;
  v_plan_id      uuid := p_plan_id;
  v_description  text;
  v_tx_id        uuid;
  v_movement_id  uuid;
begin
  -- Role guard (hr:write holders in lib/auth/permissions.ts).
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para registrar movimientos de la cuenta corriente de empleados'
      using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('advance', 'payment') then
    raise exception 'El movimiento de caja es un adelanto o un pago del empleado'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El importe tiene que ser mayor a cero'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  if p_date is null then
    raise exception 'Indicá la fecha'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select legal_name into v_name from public.employees where id = p_employee_id;
  if v_name is null then
    raise exception 'El empleado no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;

  select * into v_account from public.accounts where id = p_account_id;
  if v_account.id is null then
    raise exception 'La cuenta no existe'
      using errcode = '23503', hint = 'jouve_guard';
  end if;
  if v_account.type in ('checks', 'echeq') then
    raise exception 'Los movimientos en cuentas de cheques se manejan desde Cheques (cargar, depositar, endosar)'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if v_plan_id is not null then
    select * into v_plan from public.employee_debt_plans where id = v_plan_id for update;
    if v_plan.id is null
       or v_plan.employee_id <> p_employee_id
       or v_plan.currency <> v_account.currency then
      raise exception 'El plan no existe o es de otro empleado o de otra moneda que la cuenta'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;

  v_description := coalesce(
    nullif(btrim(p_description), ''),
    case when p_kind = 'advance' then 'Adelanto a ' || v_name
         else 'Pago de ' || v_name || ' (cuenta corriente)' end
  );

  if p_kind = 'advance' and v_plan_id is null and p_installment_amount is not null then
    if p_installment_amount <= 0 or p_installment_amount > p_amount then
      raise exception 'La cuota del plan tiene que ser mayor a cero y no superar el adelanto'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    insert into public.employee_debt_plans (
      employee_id, description, currency, total, installment_amount, start_month, created_by
    ) values (
      p_employee_id, left(v_description, 200), v_account.currency, p_amount, p_installment_amount,
      date_trunc('month', p_date)::date, auth.uid()
    )
    returning id into v_plan_id;
  end if;

  insert into public.transactions (
    account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, created_by
  ) values (
    p_account_id, p_channel_id,
    case when p_kind = 'advance' then 'expense' else 'income' end,
    p_amount, v_account.currency, p_date,
    date_trunc('month', p_date)::date, left(v_description, 500), auth.uid()
  )
  returning id into v_tx_id;

  insert into public.employee_account_movements (
    employee_id, kind, currency, amount, movement_date, description, plan_id, transaction_id, created_by
  ) values (
    p_employee_id, p_kind, v_account.currency, p_amount, p_date, left(v_description, 200),
    v_plan_id, v_tx_id, auth.uid()
  )
  returning id into v_movement_id;

  -- Posted at insert as a loose movement; now the builder sees the account.
  perform public.repost_journal('transactions', v_tx_id);
  return v_movement_id;
end;
$$;

comment on function public.record_employee_account_cash(uuid, text, uuid, text, date, numeric, text, uuid, numeric) is
  'Adelanto a empleado (egreso) o pago del empleado (ingreso) en una cuenta de caja o banco, con su movimiento de cuenta corriente. Se asienta contra anticipos al personal.';

revoke all on function public.record_employee_account_cash(uuid, text, uuid, text, date, numeric, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.record_employee_account_cash(uuid, text, uuid, text, date, numeric, text, uuid, numeric) to authenticated, service_role;

-- Deletes a manual movement, or an advance or cash payment with its treasury
-- movement. The planilla, purchase and forgiveness movements are deleted by
-- their owners.
create function public.delete_employee_account_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.employee_account_movements;
begin
  -- Role guard (hr:write holders in lib/auth/permissions.ts).
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para borrar movimientos de la cuenta corriente de empleados'
      using errcode = '42501';
  end if;

  select * into v_movement from public.employee_account_movements where id = p_movement_id for update;
  if v_movement.id is null then
    raise exception 'El movimiento no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_movement.payroll_entry_id is not null then
    raise exception 'El descuento de planilla lo escribe el cierre del período: reabrilo para cambiarlo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_movement.purchase_invoice_id is not null then
    raise exception 'El cargo de una compra se maneja desde la compra (a cargo de empleado)'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_movement.kind = 'forgiveness' then
    raise exception 'La condonación de un plan no se borra'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  delete from public.employee_account_movements where id = v_movement.id;
  if v_movement.transaction_id is not null then
    delete from public.transactions where id = v_movement.transaction_id;
  end if;
end;
$$;

comment on function public.delete_employee_account_movement(uuid) is
  'Borra un movimiento manual de la cuenta corriente, o un adelanto / pago en caja junto con su movimiento de caja.';

revoke all on function public.delete_employee_account_movement(uuid) from public, anon, authenticated;
grant execute on function public.delete_employee_account_movement(uuid) to authenticated, service_role;

-- Same as 20261103040100 plus the employee account: an advance debits
-- anticipos_personal and an employee's payment credits it (while an active
-- account holds the role).
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

  if p_transaction.kind = 'income' then
    -- A check a client handed over without a receipt pays on account: it
    -- credits clientes, like a receipt with no allocation. A loan
    -- disbursement is a liability; an employee's payment settles what they owe.
    return jsonb_build_array(
      jsonb_build_object('system_role', v_role::text, 'debit', v_amount, 'description', p_description),
      jsonb_build_object(
        'system_role',
        case
          when p_transaction.manual_check_id is not null
               and p_transaction.counterparty_client_id is not null then 'clientes'
          when exists (select 1 from public.loans l where l.disbursement_transaction_id = p_transaction.id)
            then 'prestamos'
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

-- Same as 20261103040100 plus the employee account.
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

-- Same as 20261103010000 plus the employee account.
create or replace function public.guard_transaction_expense_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
     or exists (select 1 from public.employee_account_movements where transaction_id = new.id) then
    raise exception 'Solo un egreso manual lleva cuenta de gasto: el de un documento se imputa desde el documento'
      using errcode = '23514', hint = 'jouve_guard';
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

-- Same as 20261103040100 plus the employee account.
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
        or exists (select 1 from public.account_opening_balances where adjustment_transaction_id = old.id)
        or exists (select 1 from public.employee_account_movements where transaction_id = old.id))
       and (new.amount           is distinct from old.amount
         or new.transaction_date is distinct from old.transaction_date
         or new.accrual_month    is distinct from old.accrual_month
         or new.account_id       is distinct from old.account_id
         or new.kind             is distinct from old.kind
         or new.channel_id       is distinct from old.channel_id) then
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

-- Same as 20261103040100 plus 'employee_account'.
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
      when exists (select 1 from public.employee_account_movements eam where eam.transaction_id = t.id)
        then 'employee_account'
    end as source_document,
    t.cost_center_id,
    t.expense_account_id
  from public.transactions t
  join public.invoicing_channels c on c.id = t.channel_id
  join public.accounts a on a.id = t.account_id;

-- 7. Management P&L -------------------------------------------------------------------------

-- Same as 20261103040100 plus the employee account (see the header).
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
      union all
      -- Employee account: what the planilla discounted (the advance it repays
      -- was an asset) and a forgiven company debt are internal salaries.
      select to_char(m.movement_date, 'YYYY-MM'), 'internal', 'employee_account_movements', m.id,
             null::uuid, public.find_account_by_role('sueldos'),
             -round(m.amount * case when m.currency = 'USD'
                                    then public.get_exchange_rate('USD', m.movement_date) else 1 end, 2)
        from public.employee_account_movements m
       where m.movement_date between v_from and v_to
         and (m.kind = 'payroll_discount' or (m.kind = 'forgiveness' and m.creditor = 'empresa'))
         and (m.currency = 'ARS' or public.get_exchange_rate('USD', m.movement_date) is not null)
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
         and not exists (select 1 from public.employee_account_movements m where m.transaction_id = t.id)
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
             when t.is_payroll or emp.owned
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
             when t.is_payroll or emp.owned
                  or exists (select 1 from public.payroll_payments pp where pp.transaction_id = t.id)
               then case when c.is_fiscal then 'sueldos' else 'sueldos_internos' end
             else mb.subbucket
           end as subbucket,
           case when t.receipt_id is null and t.invoice_id is null and t.manual_check_id is null
                     and t.payment_order_id is null and t.issued_check_id is null and not t.is_payroll
                     and not emp.owned
                then cp.id end as account_id
      from public.transactions t
      join public.invoicing_channels c on c.id = t.channel_id
      cross join lateral (
        select exists (select 1 from public.employee_account_movements m where m.transaction_id = t.id) as owned
      ) emp
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
