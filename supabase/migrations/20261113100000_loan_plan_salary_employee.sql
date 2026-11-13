SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A savings plan imputed to an employee: the company pays it (the asset stays
-- the company's «Rodados en plan de ahorro», the journal is unchanged) and
-- each paid cuota shows on that employee's monthly planilla as a line that is
-- already paid. Management view only: the line posts nothing and moves no
-- cash; the cuota's own bank debit is the only movement.
--
-- 1. loans.salary_employee_id (only on a plan_ahorro). create_loan_core
--    (20261112140100) stores it. It changes only while no cuota of the plan
--    is on a planilla (guard_loan_salary_employee).
-- 2. payroll_entry_extras.loan_installment_id: the planilla line of a paid
--    cuota («Plan de ahorro: <descripción> · cuota N»), one per cuota, in
--    pesos (a USD cuota at the movement's pesos, or at the official rate of
--    its date when paid from a dollar account). Only the database writes,
--    moves or removes it (guard_payroll_entry_extra_loan); a planilla row
--    holding one is not removed (guard_payroll_entry_loan_extra).
-- 3. loan_installment_sync_payroll_extra (after update on loan_installments):
--    a cuota that turns paid (pay_loan_installment 4/5-arg, adopt, the bank
--    line «Pagar cuota») adds the line to the planilla of its due month; a
--    cuota that stops being paid, or loses its movement, removes it; deleting
--    the cuota cascades. relink (a cuota paid before the plan was loaded)
--    adds nothing. Missing planilla: create_payroll_period (the normal «Nueva
--    liquidación», every active employee); missing row: fill_payroll_period
--    for that employee («Agregar faltantes» for one). A closed planilla
--    refuses the payment (or its removal).
-- 4. fill_payroll_period(period, employee default null) and
--    create_payroll_period (20260517110000 / 20261102170000 line): the
--    service role passes their role check, like the other payroll RPCs; with
--    an employee, fill adds only that employee (active or not).
-- 5. Views: v_payroll_entries_resolved appends paid_in_kind (the plan lines);
--    total_a_pagar keeps them. v_payroll_entries_with_payments counts them in
--    paid_total (so saldo does not change) and appends paid_in_kind;
--    paid_fiscal / paid_internal stay the cash payments.
-- 6. What is paid in cash ignores the plan lines: the fiscal cap of
--    payroll_entry_rebalance_channels and the recibo gap of
--    payroll_period_post_receipt_gaps (20261111185300) use
--    total_a_pagar − paid_in_kind; payroll_sac_suggestion (20261104095000)
--    leaves them out of the SAC base; get_management_payroll_control
--    (20261103070000) counts them as paid for their period, not as paid in
--    the month (no salary cash left).
--
-- No row exists yet: nothing is backfilled. Rollback: older code ignores the
-- new columns; an older fill_payroll_period call (p_period_id only) still
-- resolves; older code lists the plan line as a regular extra, and removing
-- it is refused.

-- 1. The employee a plan is imputed to ---------------------------------------------

alter table public.loans
  -- squawk-ignore adding-foreign-key-constraint
  add column salary_employee_id uuid references public.employees (id) on delete restrict;

-- Every row holds the null just added: validated at once.
alter table public.loans
  -- squawk-ignore constraint-missing-not-valid
  add constraint loans_salary_employee_kind_check
    check (salary_employee_id is null or kind = 'plan_ahorro');

-- loans has a few dozen rows: the lock is instant.
-- squawk-ignore require-concurrent-index-creation
create index loans_salary_employee_idx on public.loans (salary_employee_id)
  where salary_employee_id is not null;

comment on column public.loans.salary_employee_id is
  'Plan de ahorro que se le imputa a un empleado: cada cuota pagada figura en su planilla del mes de vencimiento como pago recibido. Contablemente sigue siendo un plan de ahorro de la empresa.';

-- 2. The planilla line of a paid cuota ---------------------------------------------

alter table public.payroll_entry_extras
  -- squawk-ignore adding-foreign-key-constraint
  add column loan_installment_id uuid references public.loan_installments (id) on delete cascade;

-- The column was just added (all null): nothing to scan.
-- squawk-ignore require-concurrent-index-creation
create unique index payroll_entry_extras_loan_installment_key
  on public.payroll_entry_extras (loan_installment_id)
  where loan_installment_id is not null;

comment on column public.payroll_entry_extras.loan_installment_id is
  'Cuota pagada de un plan de ahorro imputado al empleado: la línea ya está pagada (la cuota es el pago) y no asienta nada. Solo la escribe la base.';

create function public.guard_payroll_entry_extra_loan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The sync below runs inside the loan_installments trigger, and a cuota's
  -- delete cascades: both at depth > 1. A direct write is depth 1.
  if ((tg_op <> 'INSERT' and old.loan_installment_id is not null)
      or (tg_op <> 'DELETE' and new.loan_installment_id is not null))
     and pg_trigger_depth() <= 1 then
    raise exception 'La línea del plan de ahorro sale del pago de su cuota: no se carga, edita ni quita desde la planilla'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_payroll_entry_extra_loan() from public, anon, authenticated;

create trigger payroll_entry_extras_guard_loan
  before insert or update or delete on public.payroll_entry_extras
  for each row execute function public.guard_payroll_entry_extra_loan();

create function public.guard_payroll_entry_loan_extra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.payroll_entry_extras x
              where x.entry_id = old.id and x.loan_installment_id is not null) then
    raise exception 'La fila tiene la cuota pagada de un plan de ahorro que se le imputa al empleado: no se puede quitar de la planilla'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_payroll_entry_loan_extra() from public, anon, authenticated;

create trigger payroll_entries_guard_loan_extra
  before delete on public.payroll_entries
  for each row execute function public.guard_payroll_entry_loan_extra();

create function public.guard_loan_salary_employee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.salary_employee_id is distinct from old.salary_employee_id
     and exists (select 1 from public.payroll_entry_extras x
                   join public.loan_installments i on i.id = x.loan_installment_id
                  where i.loan_id = old.id) then
    raise exception 'Una cuota del plan ya figura en la planilla del empleado: no se puede cambiar a quién se le imputa'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_loan_salary_employee() from public, anon, authenticated;

create trigger loans_guard_salary_employee
  before update of salary_employee_id on public.loans
  for each row execute function public.guard_loan_salary_employee();


-- 3. A paid cuota on the employee's planilla ---------------------------------------

create function public.sync_loan_installment_payroll_extra(p_installment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst      public.loan_installments;
  v_loan      public.loans;
  v_tx        public.transactions;
  v_extra     public.payroll_entry_extras;
  v_status    text;
  v_period_id uuid;
  v_entry_id  uuid;
  v_year      int;
  v_month     int;
  v_rate      numeric;
  v_amount    numeric;
  v_desc      text;
begin
  select * into v_inst from public.loan_installments where id = p_installment_id;
  select * into v_extra from public.payroll_entry_extras where loan_installment_id = p_installment_id;
  if v_inst.id is not null then
    select * into v_loan from public.loans where id = v_inst.loan_id;
  end if;

  if v_inst.status = 'pagada' and v_inst.transaction_id is not null
     and v_loan.salary_employee_id is not null then
    v_year := extract(year from v_inst.due_date)::int;
    v_month := extract(month from v_inst.due_date)::int;
    select p.id, p.status into v_period_id, v_status
      from public.payroll_periods p
     where p.year = v_year and p.month = v_month and p.kind = 'monthly';
    if v_status = 'closed' then
      raise exception 'La planilla de % está cerrada: reabrila para pagar la cuota % del plan, que figura en la planilla del empleado',
        to_char(v_inst.due_date, 'MM/YYYY'), v_inst.number
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if v_period_id is null then
      select c.period_id into v_period_id from public.create_payroll_period(v_year, v_month) c;
    end if;
    select e.id into v_entry_id from public.payroll_entries e
     where e.period_id = v_period_id and e.employee_id = v_loan.salary_employee_id;
    if v_entry_id is null then
      perform public.fill_payroll_period(v_period_id, v_loan.salary_employee_id);
      select e.id into v_entry_id from public.payroll_entries e
       where e.period_id = v_period_id and e.employee_id = v_loan.salary_employee_id;
    end if;

    -- The planilla is in pesos: what left the account, or a dollar movement
    -- at the official rate of its date.
    select * into v_tx from public.transactions where id = v_inst.transaction_id;
    if v_tx.currency = 'ARS' then
      v_amount := v_tx.amount;
    else
      v_rate := public.get_exchange_rate('USD', v_tx.transaction_date);
      if v_rate is null then
        raise exception 'No hay cotización del dólar al %: cargala para pasar la cuota a la planilla del empleado',
          to_char(v_tx.transaction_date, 'DD/MM/YYYY')
          using errcode = '23514', hint = 'jouve_guard';
      end if;
      v_amount := round(v_tx.amount * v_rate, 2);
    end if;
    v_desc := left('Plan de ahorro: ' || v_loan.description || ' · cuota ' || v_inst.number, 200);

    if v_extra.id is null then
      insert into public.payroll_entry_extras (entry_id, amount, description, sort_order, created_by, loan_installment_id)
      values (v_entry_id, v_amount, v_desc, 950, auth.uid(), v_inst.id);
    elsif v_extra.entry_id is distinct from v_entry_id
          or v_extra.amount is distinct from v_amount
          or v_extra.description is distinct from v_desc then
      update public.payroll_entry_extras
         set entry_id = v_entry_id, amount = v_amount, description = v_desc
       where id = v_extra.id;
    end if;
    return;
  end if;

  if v_extra.id is not null then
    select pp.status, to_char(make_date(pp.year, pp.month, 1), 'MM/YYYY')
      into v_status, v_desc
      from public.payroll_entries pe
      join public.payroll_periods pp on pp.id = pe.period_id
     where pe.id = v_extra.entry_id;
    if v_status = 'closed' then
      raise exception 'La planilla de % está cerrada y tiene esta cuota del plan como pagada: reabrila primero', v_desc
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    delete from public.payroll_entry_extras where id = v_extra.id;
  end if;
end;
$$;

comment on function public.sync_loan_installment_payroll_extra(uuid) is
  'Interna: pone (o quita) en la planilla del mes de vencimiento la línea ya pagada de una cuota de un plan de ahorro imputado a un empleado. No asienta ni mueve caja. Sin grant.';

revoke all on function public.sync_loan_installment_payroll_extra(uuid) from public, anon, authenticated;

create function public.loan_installment_sync_payroll_extra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Paid now (not a relink of a cuota paid before the plan was loaded), or
  -- no longer paid / without its movement.
  if (new.status = 'pagada' and old.status <> 'pagada' and new.transaction_id is not null)
     or (old.status = 'pagada' and (new.status <> 'pagada' or new.transaction_id is null)) then
    perform public.sync_loan_installment_payroll_extra(new.id);
  end if;
  return null;
end;
$$;

revoke all on function public.loan_installment_sync_payroll_extra() from public, anon, authenticated;

create trigger loan_installments_sync_payroll_extra
  after update of status, transaction_id on public.loan_installments
  for each row execute function public.loan_installment_sync_payroll_extra();


-- 4. Creating the planilla and a row: same as before, the service role passes and
--    fill takes one employee. ---------------------------------------------------------

-- The old signature is dropped so the one-argument callers
-- (create_payroll_period, fillPayrollPeriodAction, older code) resolve to this
-- one with the default.
-- squawk-ignore ban-drop-function
drop function public.fill_payroll_period(uuid);

CREATE FUNCTION public.fill_payroll_period(p_period_id uuid, p_employee_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $$
declare
  v_status text;
  v_kind   text;
  v_year   int;
  v_month  int;
  v_added  integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'Sin permisos para modificar liquidaciones.'
      using errcode = '42501';
  end if;

  select status, kind, year, month into v_status, v_kind, v_year, v_month
  from public.payroll_periods
  where id = p_period_id;

  if v_status is null then
    raise exception 'El período no existe.'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_status = 'closed' then
    raise exception 'El período está cerrado: reabrilo para agregar empleados.'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  insert into public.payroll_entries (
    period_id, employee_id, sueldo_neto, viaticos, created_by
  )
  select
    p_period_id,
    e.id,
    case
      when v_kind = 'sac' then
        coalesce(public.payroll_sac_suggestion(e.id, v_year, case when v_month = 6 then 1 else 2 end), 0)
      when e.pay_frequency in ('mensual', 'mixto') then
        coalesce(public.employee_salary_for_month(e.id, make_date(v_year, v_month, 1)), 0)
      else 0
    end,
    case when v_kind = 'sac' then 0 else coalesce(e.viatico_monthly, 0) end,
    auth.uid()
  from public.employees e
  where (e.id = p_employee_id or (p_employee_id is null and e.is_active))
    and (v_kind <> 'sac' or e.hire_date <= make_date(v_year, v_month, 1) + interval '1 month' - interval '1 day')
  on conflict (period_id, employee_id) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

comment on function public.fill_payroll_period(uuid, uuid) is
  'Adds a draft entry for each active employee missing from an open payroll period (or only p_employee_id, active or not). Monthly: viático and the salary for the month (employee_salary_for_month) for mensual/mixto. SAC: the suggested SAC, no viático.';

revoke all on function public.fill_payroll_period(uuid, uuid) from public, anon;
grant execute on function public.fill_payroll_period(uuid, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_payroll_period(p_year integer, p_month integer)
 RETURNS TABLE(period_id uuid, created boolean)
 LANGUAGE plpgsql
 SET search_path = ''
AS $$
declare
  v_period_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'Sin permisos para crear períodos de liquidación.'
      using errcode = '42501';
  end if;

  insert into public.payroll_periods (year, month, kind, created_by)
  values (p_year, p_month, 'monthly', auth.uid())
  on conflict (year, month, kind) do nothing
  returning id into v_period_id;

  if v_period_id is not null then
    perform public.fill_payroll_period(v_period_id);
    return query select v_period_id, true;
    return;
  end if;

  return query
    select p.id, false
      from public.payroll_periods p
     where p.year = p_year and p.month = p_month and p.kind = 'monthly';
end;
$$;

revoke all on function public.create_payroll_period(integer, integer) from public, anon;
grant execute on function public.create_payroll_period(integer, integer) to authenticated, service_role;


-- 5. Views: the plan lines are in the total and already paid. -----------------------

create or replace view public.v_payroll_entries_resolved
with (security_invoker = on) as
 SELECT e.id,
    e.period_id,
    e.employee_id,
    e.sueldo_neto,
    COALESCE(x.extras_total, 0::numeric) AS extras_total,
    e.vacaciones_monto,
    e.viaticos,
    e.deudas,
    e.telefono,
    e.sueldo_neto + COALESCE(x.extras_total, 0::numeric) + e.vacaciones_monto + e.viaticos - e.deudas - e.telefono - e.embargo AS total_a_pagar,
    e.notes,
    e.created_at,
    e.updated_at,
    e.recibo_neto,
    e.embargo,
    COALESCE(x.paid_in_kind, 0::numeric) AS paid_in_kind
   FROM public.payroll_entries e
     LEFT JOIN LATERAL ( SELECT sum(payroll_entry_extras.amount) AS extras_total,
            sum(payroll_entry_extras.amount) FILTER (WHERE payroll_entry_extras.loan_installment_id IS NOT NULL) AS paid_in_kind
           FROM public.payroll_entry_extras
          WHERE payroll_entry_extras.entry_id = e.id) x ON true;

comment on view public.v_payroll_entries_resolved is
  'Entry + extras_total + total_a_pagar (sueldo + extras + vacaciones + viáticos − deudas − teléfono − embargo) + paid_in_kind (las líneas de cuotas pagadas de un plan de ahorro imputado: ya pagadas, sin caja).';

create or replace view public.v_payroll_entries_with_payments
with (security_invoker = on) as
 SELECT r.id,
    r.period_id,
    r.employee_id,
    r.sueldo_neto,
    r.extras_total,
    r.vacaciones_monto,
    r.viaticos,
    r.deudas,
    r.telefono,
    r.total_a_pagar,
    COALESCE(p.paid_total, 0::numeric) + r.paid_in_kind AS paid_total,
    r.total_a_pagar - COALESCE(p.paid_total, 0::numeric) - r.paid_in_kind AS saldo,
    COALESCE(p.payments_count, 0) AS payments_count,
    r.notes,
    r.created_at,
    r.updated_at,
    r.recibo_neto,
    r.embargo,
    COALESCE(p.paid_transferencia, 0::numeric) AS paid_transferencia,
    COALESCE(p.paid_efectivo, 0::numeric) AS paid_efectivo,
    public.payroll_fiscal_share(r.recibo_neto, r.embargo) AS fiscal_share,
    COALESCE(p.paid_fiscal, 0::numeric) AS paid_fiscal,
    COALESCE(p.paid_internal, 0::numeric) AS paid_internal,
    r.paid_in_kind
   FROM public.v_payroll_entries_resolved r
     LEFT JOIN LATERAL ( SELECT sum(pp.amount) AS paid_total,
            count(*) FILTER (WHERE pp.split_parent_id IS NULL)::integer AS payments_count,
            sum(pp.amount) FILTER (WHERE pp.method = 'transferencia'::public.payroll_payment_method) AS paid_transferencia,
            sum(pp.amount) FILTER (WHERE pp.method = 'efectivo'::public.payroll_payment_method) AS paid_efectivo,
            sum(pp.amount) FILTER (WHERE ch.is_fiscal) AS paid_fiscal,
            sum(pp.amount) FILTER (WHERE NOT ch.is_fiscal) AS paid_internal
           FROM public.payroll_payments pp
             JOIN public.invoicing_channels ch ON ch.id = pp.channel_id
          WHERE pp.entry_id = r.id) p ON true;

comment on view public.v_payroll_entries_with_payments is
  'Entry resolved + paid_total (pagos + paid_in_kind) y saldo (total_a_pagar − paid_total), lo pagado por método, la parte de libros (recibo − embargo), lo pagado por canal (libros / gestión, solo pagos) y paid_in_kind (cuotas de plan de ahorro ya pagadas).';

revoke all on public.v_payroll_entries_resolved, public.v_payroll_entries_with_payments from anon;
grant select, insert, update, delete on public.v_payroll_entries_resolved, public.v_payroll_entries_with_payments to authenticated;
grant all on public.v_payroll_entries_resolved, public.v_payroll_entries_with_payments to service_role;


-- 6. What is paid in cash leaves the plan lines out. --------------------------------

CREATE OR REPLACE FUNCTION public.payroll_entry_rebalance_channels(p_entry_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
declare
  c_unmatchable constant text :=
    'El pago de sueldo está conciliado de una forma que el reparto automático no puede mantener: desconciliá su línea en la pestaña «Extracto» de su cuenta, cargá el cambio y volvé a conciliar';
  v_fiscal_ch   text := public.payroll_channel(true);
  v_internal_ch text := public.payroll_channel(false);
  v_posts       boolean;
  v_month       text;
  v_closed      boolean;
  v_lines       uuid[];
  v_before      jsonb;
  v_left        numeric;
  v_parent      public.payroll_payments;
  v_child       public.payroll_payments;
  v_total       numeric;
  v_f           numeric;
  v_crossing    boolean;
  v_target      text;
  v_fis_before  numeric;
  v_p_lines     uuid[];
  v_c_lines     uuid[];
  v_matched     boolean;
  v_child_tx    uuid;
begin
  select pp.posts_receipt_gap, to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM')
    into v_posts, v_month
    from public.payroll_entries pe
    join public.payroll_periods pp on pp.id = pe.period_id
   where pe.id = p_entry_id;
  if not found or not v_posts then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('payroll_rebalance'), hashtext(p_entry_id::text));
  perform set_config('jouve.payroll_rebalancing', 'on', true);

  -- Snapshot before any write.
  select array_agg(distinct m.line_id) into v_lines
    from public.payroll_payments p
    join public.bank_statement_matches m on m.transaction_id = p.transaction_id
   where p.entry_id = p_entry_id;
  v_before := public.matched_line_totals(v_lines);

  select public.payroll_fiscal_cap(public.payroll_fiscal_share(r.recibo_neto, r.embargo), r.total_a_pagar - r.paid_in_kind)
    into v_left
    from public.v_payroll_entries_resolved r
   where r.id = p_entry_id;
  v_closed := exists (select 1 from public.accounting_closed_periods c where c.period = v_month);

  for v_parent in
    select p.*
      from public.payroll_payments p
     where p.entry_id = p_entry_id and p.split_parent_id is null
     order by p.paid_at, p.created_at, p.id
       for update
  loop
    v_child := null;
    select c.* into v_child
      from public.payroll_payments c
     where c.split_parent_id = v_parent.id
       for update;

    v_total := v_parent.amount + coalesce(v_child.amount, 0);
    v_f := least(v_total, greatest(v_left, 0));
    v_left := v_left - v_f;
    v_crossing := v_f > 0 and v_f < v_total;
    v_target := case when v_f > 0 then v_fiscal_ch else v_internal_ch end;

    -- Already in place.
    if (v_crossing and v_child.id is not null
        and v_parent.amount = v_f and v_parent.channel_id = v_fiscal_ch
        and v_child.amount = v_total - v_f and v_child.channel_id = v_internal_ch)
       or (not v_crossing and v_child.id is null and v_parent.channel_id = v_target) then
      continue;
    end if;

    -- A8: a fiscal piece changes only in an open accounting month.
    select coalesce(sum(x.amount) filter (where ch.is_fiscal), 0)
      into v_fis_before
      from (values (v_parent.channel_id, v_parent.amount),
                   (v_child.channel_id, v_child.amount)) as x (channel_id, amount)
      left join public.invoicing_channels ch on ch.id = x.channel_id;
    if v_closed and v_fis_before is distinct from v_f then
      raise exception 'El período contable de este sueldo está cerrado: reabrilo para cargar el recibo'
        using errcode = '55006', hint = 'jouve_guard';
    end if;

    select array_agg(distinct m.line_id) into v_p_lines
      from public.bank_statement_matches m where m.transaction_id = v_parent.transaction_id;
    select array_agg(distinct m.line_id) into v_c_lines
      from public.bank_statement_matches m
     where v_child.transaction_id is not null and m.transaction_id = v_child.transaction_id;
    v_matched := coalesce(cardinality(v_p_lines), 0) > 0 or coalesce(cardinality(v_c_lines), 0) > 0;

    if v_crossing and v_child.id is null
       and not exists (select 1 from public.accounts a where a.id = v_parent.account_id and a.is_active) then
      raise exception 'La cuenta del pago está inactiva: activala para que el sistema reparta el pago entre libros y gestión'
        using errcode = '55006', hint = 'jouve_guard';
    end if;

    if not v_matched then
      if v_crossing then
        update public.payroll_payments
           set amount = v_f, channel_id = v_fiscal_ch
         where id = v_parent.id
           and (amount is distinct from v_f or channel_id is distinct from v_fiscal_ch);
        if v_child.id is null then
          insert into public.payroll_payments (
            entry_id, account_id, channel_id, amount, method, paid_at, notes, created_by, split_parent_id
          ) values (
            v_parent.entry_id, v_parent.account_id, v_internal_ch, v_total - v_f, v_parent.method,
            v_parent.paid_at, v_parent.notes, v_parent.created_by, v_parent.id
          );
        else
          update public.payroll_payments
             set amount = v_total - v_f, channel_id = v_internal_ch,
                 account_id = v_parent.account_id, method = v_parent.method,
                 paid_at = v_parent.paid_at, notes = v_parent.notes
           where id = v_child.id;
        end if;
      else
        if v_child.id is not null then
          delete from public.payroll_payments where id = v_child.id;
        end if;
        update public.payroll_payments
           set amount = v_total, channel_id = v_target
         where id = v_parent.id
           and (amount is distinct from v_total or channel_id is distinct from v_target);
      end if;
      continue;
    end if;

    -- Matched: the group's movements sit on one line together, or (single
    -- channel without a child) the parent's star stays as it is.
    if (v_crossing or v_child.id is not null)
       and (coalesce(cardinality(v_p_lines), 0) <> 1
            or (v_child.id is not null and v_c_lines is distinct from v_p_lines)) then
      raise exception '%', c_unmatchable using errcode = '55006', hint = 'jouve_guard';
    end if;

    if v_crossing then
      if v_child.id is null then
        insert into public.payroll_payments (
          entry_id, account_id, channel_id, amount, method, paid_at, notes, created_by, split_parent_id
        ) values (
          v_parent.entry_id, v_parent.account_id, v_internal_ch, v_total - v_f, v_parent.method,
          v_parent.paid_at, v_parent.notes, v_parent.created_by, v_parent.id
        )
        returning transaction_id into v_child_tx;
      else
        v_child_tx := v_child.transaction_id;
      end if;
      perform public.split_matched_movement(v_parent.transaction_id, v_child_tx, v_f, v_fiscal_ch);
      update public.payroll_payments
         set amount = v_f, channel_id = v_fiscal_ch
       where id = v_parent.id;
      update public.payroll_payments
         set amount = v_total - v_f
       where split_parent_id = v_parent.id;
    elsif v_child.id is not null then
      perform public.merge_matched_movement(v_parent.transaction_id, v_child.transaction_id, v_target);
      delete from public.payroll_payments where id = v_child.id;
      update public.payroll_payments
         set amount = v_total, channel_id = v_target
       where id = v_parent.id;
    else
      perform public.merge_matched_movement(v_parent.transaction_id, null, v_target);
      update public.payroll_payments
         set channel_id = v_target
       where id = v_parent.id;
    end if;
  end loop;

  -- repost_journal leaves alone a movement with no live entry ('missing'),
  -- which is what a move from the internal to the fiscal channel leaves:
  -- post it here.
  perform public.emit_journal('transactions', p.transaction_id)
     from public.payroll_payments p
    where p.entry_id = p_entry_id
      and p.transaction_id is not null
      and public.journal_entry_status('transactions', p.transaction_id) = 'missing';

  if public.matched_line_totals(v_lines) is distinct from v_before then
    raise exception '%', c_unmatchable using errcode = '55006', hint = 'jouve_guard';
  end if;

  perform set_config('jouve.payroll_rebalancing', 'off', true);
end;
$$;

revoke all on function public.payroll_entry_rebalance_channels(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.payroll_period_post_receipt_gaps()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
declare
  v_month_date date := make_date(new.year, new.month, 1);
  v_month      text := to_char(make_date(new.year, new.month, 1), 'YYYY-MM');
  v_label      text := to_char(make_date(new.year, new.month, 1), 'MM/YYYY');
  v_closed     boolean;
  v_row        record;
  v_entry      uuid;
begin
  if not new.posts_receipt_gap then
    return null;
  end if;
  v_closed := exists (select 1 from public.accounting_closed_periods c where c.period = v_month);

  if old.status = 'draft' and new.status = 'closed' then
    for v_row in
      select r.id,
             e.legal_name,
             public.payroll_fiscal_share(r.recibo_neto, r.embargo)
               - public.payroll_fiscal_cap(public.payroll_fiscal_share(r.recibo_neto, r.embargo), r.total_a_pagar - r.paid_in_kind)
               as gap
        from public.v_payroll_entries_resolved r
        join public.employees e on e.id = r.employee_id
       where r.period_id = new.id
       order by r.id
    loop
      if v_row.gap <= 0
         or exists (select 1 from public.current_journal_entries('payroll_entries', v_row.id)) then
        continue;
      end if;
      if v_closed then
        raise exception 'El período contable de % está cerrado: reabrilo para cerrar la planilla', v_label
          using errcode = '55006', hint = 'jouve_guard';
      end if;
      perform public.create_journal_entry(
        p_entry_date     := (v_month_date + interval '1 month - 1 day')::date,
        p_accrual_period := v_month,
        p_description    := case when new.kind = 'sac' then 'SAC ' else 'Sueldo ' end
                            || v_row.legal_name || ' ' || v_label
                            || ' — parte del recibo que salda deuda',
        p_lines          := jsonb_build_array(
          jsonb_build_object('system_role', 'sueldos', 'debit', v_row.gap,
                             'description', 'Sueldo según recibo'),
          jsonb_build_object('system_role', 'anticipos_personal', 'credit', v_row.gap,
                             'description', 'Deuda del empleado saldada con el recibo')
        ),
        p_source_table   := 'payroll_entries',
        p_source_id      := v_row.id,
        p_channel_id     := public.payroll_channel(true)
      );
    end loop;
  elsif old.status = 'closed' and new.status = 'draft' then
    for v_entry in
      select c.id
        from public.payroll_entries pe
        cross join lateral public.current_journal_entries('payroll_entries', pe.id) as c (id)
       where pe.period_id = new.id
       order by c.id
    loop
      if v_closed then
        raise exception 'El período contable de % está cerrado: reabrilo para reabrir la planilla', v_label
          using errcode = '55006', hint = 'jouve_guard';
      end if;
      perform public.reverse_journal_entry(v_entry);
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function public.payroll_period_post_receipt_gaps() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.payroll_sac_suggestion(p_employee_id uuid, p_year integer, p_half integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path = ''
AS $$
  with sem as (
    select make_date(p_year, case when p_half = 1 then 1 else 7 end, 1) as d_from,
           case when p_half = 1 then make_date(p_year, 6, 30) else make_date(p_year, 12, 31) end as d_to
  ),
  best as (
    select max(
             r.sueldo_neto + r.extras_total
             - coalesce((
                 select sum(x.amount)
                   from public.payroll_entry_extras x
                  where x.entry_id = r.id
                    and (x.description like 'Liquidación final:%'
                         or x.loan_installment_id is not null)
               ), 0)
           ) as amount
    from public.payroll_periods pp
    join public.v_payroll_entries_resolved r on r.period_id = pp.id
    where pp.kind = 'monthly'
      and pp.year = p_year
      and pp.month between (case when p_half = 1 then 1 else 7 end)
                       and (case when p_half = 1 then 6 else 12 end)
      and r.employee_id = p_employee_id
  ),
  span as (
    select greatest(e.hire_date, sem.d_from) as d_start,
           least(coalesce(e.termination_date, sem.d_to), sem.d_to) as d_end,
           sem.d_to - sem.d_from + 1 as days_total
    from public.employees e
    cross join sem
    where e.id = p_employee_id
  )
  select case
           when best.amount is null or span.d_end < span.d_start then 0
           else round(best.amount / 2 * (span.d_end - span.d_start + 1) / span.days_total, 2)
         end
  from best
  cross join span;
$$;

revoke all on function public.payroll_sac_suggestion(uuid, integer, integer) from public, anon;
grant execute on function public.payroll_sac_suggestion(uuid, integer, integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_management_payroll_control(p_from date, p_to date)
 RETURNS TABLE(month text, liquidated numeric, paid_for_period numeric, paid_in_month numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para ver el resultado de gestión'
      using errcode = '42501';
  end if;

  return query
  with months as (
    select to_char(m, 'YYYY-MM') as month
      from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
  ),
  liq as (
    select to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') as month,
           sum(r.total_a_pagar) as amount
      from public.payroll_periods pp
      join public.v_payroll_entries_resolved r on r.period_id = pp.id
     group by 1
  ),
  paid_for as (
    select to_char(make_date(pp.year, pp.month, 1), 'YYYY-MM') as month,
           sum(x.amount) as amount
      from (select pay.entry_id, pay.amount from public.payroll_payments pay
            union all
            select k.entry_id, k.amount from public.payroll_entry_extras k
             where k.loan_installment_id is not null) x
      join public.payroll_entries e on e.id = x.entry_id
      join public.payroll_periods pp on pp.id = e.period_id
     group by 1
  ),
  paid_in as (
    select to_char(pay.paid_at, 'YYYY-MM') as month, sum(pay.amount) as amount
      from public.payroll_payments pay
     group by 1
  )
  select m.month,
         coalesce(l.amount, 0),
         coalesce(f.amount, 0),
         coalesce(i.amount, 0)
    from months m
    left join liq l on l.month = m.month
    left join paid_for f on f.month = m.month
    left join paid_in i on i.month = m.month
   order by m.month;
end;
$$;

revoke all on function public.get_management_payroll_control(date, date) from public, anon, authenticated;
grant execute on function public.get_management_payroll_control(date, date) to service_role;


-- 1b. create_loan_core (20261112140100) stores the employee. ------------------------

CREATE OR REPLACE FUNCTION public.create_loan_core(p_loan jsonb, p_installments jsonb, p_created_by uuid, p_import_run_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
declare
  v_loan_id uuid;
  v_count   int := (p_loan ->> 'installments_count')::int;
  v_open    boolean := coalesce((p_loan ->> 'is_open_ended')::boolean, false);
begin
  -- An open-ended loan has no schedule: its interest cuotas are generated.
  if v_open then
    if coalesce((p_loan ->> 'monthly_rate')::numeric, 0) <= 0
       or (p_loan ->> 'kind') is distinct from 'prestamo' then
      raise exception 'Un préstamo sin vencimiento es un préstamo (no leasing ni plan) con interés mensual mayor a 0'
        using errcode = '22023', hint = 'jouve_guard';
    end if;
    insert into public.loans (
      kind, description, lender, principal, currency, channel_id,
      installments_count, first_due_date, notes, created_by, import_run_id,
      loan_number, account_id, start_date, original_amount, tna, tea, cft,
      is_open_ended, monthly_rate
    ) values (
      'prestamo',
      p_loan ->> 'description',
      p_loan ->> 'lender',
      (p_loan ->> 'principal')::numeric,
      p_loan ->> 'currency',
      p_loan ->> 'channel_id',
      1,
      (p_loan ->> 'first_due_date')::date,
      p_loan ->> 'notes',
      p_created_by,
      p_import_run_id,
      p_loan ->> 'loan_number',
      (p_loan ->> 'account_id')::uuid,
      (p_loan ->> 'start_date')::date,
      (p_loan ->> 'original_amount')::numeric,
      (p_loan ->> 'tna')::numeric,
      (p_loan ->> 'tea')::numeric,
      (p_loan ->> 'cft')::numeric,
      true,
      (p_loan ->> 'monthly_rate')::numeric
    )
    returning id into v_loan_id;
    perform public.extend_open_ended_loan(v_loan_id);
    return v_loan_id;
  end if;

  if p_installments is null
     or jsonb_typeof(p_installments) <> 'array'
     or jsonb_array_length(p_installments) is distinct from v_count then
    raise exception 'El cronograma no coincide con la cantidad de cuotas del préstamo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_installments) as i(perception numeric, iva_perception numeric)
     where i.iva_perception < 0 or i.iva_perception > coalesce(i.perception, 0)
  ) then
    raise exception 'La percepción de IVA de una cuota no puede ser negativa ni mayor que el total de percepciones'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  insert into public.loans (
    kind, description, lender, principal, currency, channel_id,
    installments_count, first_due_date, notes, created_by, import_run_id,
    loan_number, account_id, start_date, original_amount, tna, tea, cft,
    salary_employee_id
  ) values (
    (p_loan ->> 'kind')::public.loan_kind,
    p_loan ->> 'description',
    p_loan ->> 'lender',
    (p_loan ->> 'principal')::numeric,
    p_loan ->> 'currency',
    p_loan ->> 'channel_id',
    v_count,
    (p_loan ->> 'first_due_date')::date,
    p_loan ->> 'notes',
    p_created_by,
    p_import_run_id,
    p_loan ->> 'loan_number',
    (p_loan ->> 'account_id')::uuid,
    (p_loan ->> 'start_date')::date,
    (p_loan ->> 'original_amount')::numeric,
    (p_loan ->> 'tna')::numeric,
    (p_loan ->> 'tea')::numeric,
    (p_loan ->> 'cft')::numeric,
    (p_loan ->> 'salary_employee_id')::uuid
  )
  returning id into v_loan_id;

  insert into public.loan_installments (
    loan_id, number, due_date, amount,
    capital_amount, interest_amount, iva_amount, perception_amount,
    iva_perception_amount, other_charges_amount,
    status, paid_date, paid_amount, paid_outside
  )
  select v_loan_id, i.number, i.due_date, i.amount,
         i.capital, i.interest, i.iva, i.perception,
         nullif(i.iva_perception, 0), i.other,
         case when coalesce(i.paid_outside, false)
              then 'pagada'::public.loan_installment_status
              else 'pendiente'::public.loan_installment_status end,
         case when coalesce(i.paid_outside, false) then i.due_date end,
         case when coalesce(i.paid_outside, false) then i.amount end,
         coalesce(i.paid_outside, false)
    from jsonb_to_recordset(p_installments) as i(
           number integer, due_date date, amount numeric,
           capital numeric, interest numeric, iva numeric,
           perception numeric, iva_perception numeric, other numeric,
           paid_outside boolean
         );

  return v_loan_id;
end;
$$;

revoke all on function public.create_loan_core(jsonb, jsonb, uuid, uuid) from public, anon, authenticated;
