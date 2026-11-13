SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- «Adelanto a empleado» on the planilla: a payment on account, not a debt.
--
-- An adelanto is a debt plan whose cuota covers its total (debtPlanKind in
-- features/hr/account-schema.ts): it is discounted whole in one month. Until
-- now the planilla put it in Deudas, which lowered total_a_pagar. It is
-- salary already paid from a cash or bank account, so it now shows as paid:
-- Deudas keeps the préstamos (cuotas) and hand-typed amounts, and the
-- adelanto is counted in paid_total. Saldo is the same number as before.
--
-- 1. debt_plan_is_advance(installment, total): the one predicate.
-- 2. payroll_plan_installments (20261103060100) leaves adelantos out;
--    payroll_plan_advances sums the adelantos of the month (ARS, activo,
--    started by the period's month, what remains).
-- 3. payroll_entries.adelantos: written only by the database, like deudas.
--    payroll_entry_apply_plans fills it on insert and on every update of
--    deudas / deudas_override / adelantos (a write by hand is recomputed);
--    employee_plans_refresh_entries (fired by a
--    plan or a movement) rewrites it on draft entries. A hand-typed Deudas
--    (deudas_override) covers only the préstamos: adelantos stay apart.
-- 4. Closing a period (payroll_period_sync_account_discounts) still writes
--    the adelanto to the employee's account as a payroll_discount (so the
--    plan is settled and the management P&L books the salary), now from
--    adelantos; Deudas is spread over the préstamos only.
-- 5. Views: v_payroll_entries_resolved appends paid_advance (= adelantos);
--    v_payroll_entries_with_payments counts it in paid_total (saldo
--    unchanged) and appends it; paid_fiscal / paid_internal stay the
--    planilla's own payments.
-- 6. What is still to pay in cash ignores it: the fiscal cap of
--    payroll_entry_rebalance_channels and the recibo gap of
--    payroll_period_post_receipt_gaps use total_a_pagar − paid_in_kind −
--    paid_advance (same figure as before: the adelanto used to be in
--    deudas). get_management_payroll_control counts it as paid for its
--    period.
-- 7. The entries rebalance trigger also fires on adelantos.
-- 8. Backfill: draft monthly entries move their adelantos out of Deudas.
--    Closed periods are left as they were (their adelantos stay in Deudas).
--
-- Rollback: older code ignores the new column and view columns; its
-- planilla shows a lower Pagado and a higher total, with the same saldo.

-- 1. The predicate ------------------------------------------------------------------

create function public.debt_plan_is_advance(p_installment numeric, p_total numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_installment >= p_total;
$$;

comment on function public.debt_plan_is_advance(numeric, numeric) is
  'Un plan es un adelanto (se descuenta entero en un mes) cuando la cuota cubre el total; si no, es un préstamo en cuotas.';

revoke all on function public.debt_plan_is_advance(numeric, numeric) from public, anon;
grant execute on function public.debt_plan_is_advance(numeric, numeric) to authenticated, service_role;

-- 2. What the planilla discounts and what it counts as paid ------------------------

create or replace function public.payroll_plan_installments(p_employee_id uuid, p_period_id uuid)
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
    and p.remaining > 0
    and not public.debt_plan_is_advance(p.installment_amount, p.total);
$$;

comment on function public.payroll_plan_installments(uuid, uuid) is
  'Cuotas de los préstamos activos en ARS del empleado para el mes del período (topeadas a lo que resta); NULL si no aplica ninguno. Los adelantos van aparte (payroll_plan_advances). Security invoker.';

create function public.payroll_plan_advances(p_employee_id uuid, p_period_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(p.remaining), 0)
  from public.v_employee_debt_plans p
  join public.payroll_periods pp on pp.id = p_period_id
  where p.employee_id = p_employee_id
    and p.status = 'activo'
    and p.currency = 'ARS'
    and pp.kind = 'monthly'
    and p.start_month <= make_date(pp.year, pp.month, 1)
    and p.remaining > 0
    and public.debt_plan_is_advance(p.installment_amount, p.total);
$$;

comment on function public.payroll_plan_advances(uuid, uuid) is
  'Lo que resta de los adelantos activos en ARS del empleado que se descuentan en el mes del período (0 si no hay): la planilla lo cuenta como pagado. Security invoker.';

revoke all on function public.payroll_plan_advances(uuid, uuid) from public, anon;
grant execute on function public.payroll_plan_advances(uuid, uuid) to authenticated, service_role;

-- 3. payroll_entries.adelantos ------------------------------------------------------

alter table public.payroll_entries
  add column adelantos numeric(18, 2) not null default 0;

comment on column public.payroll_entries.adelantos is
  'Adelantos del mes (payroll_plan_advances), ya pagados desde su cuenta: la planilla los cuenta en lo pagado. Lo escribe solo la base.';

create or replace function public.payroll_entry_apply_plans()
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
    new.adelantos := public.payroll_plan_advances(new.employee_id, new.period_id);
    return new;
  end if;

  -- Typed by a user (not by a refresh fired from a plan or a movement, nor
  -- by this migration's backfill).
  if pg_trigger_depth() = 1
     and coalesce(current_setting('jouve.payroll_plans_backfill', true), '') <> 'on'
     and new.deudas is distinct from old.deudas
     and new.deudas_override is not distinct from old.deudas_override then
    new.deudas_override := true;
  elsif old.deudas_override and not new.deudas_override then
    new.deudas := coalesce(public.payroll_plan_installments(new.employee_id, new.period_id), 0);
  end if;
  new.adelantos := public.payroll_plan_advances(new.employee_id, new.period_id);
  return new;
end;
$$;

-- Same column list (deudas, deudas_override): adelantos rides along with them.
create or replace function public.employee_plans_refresh_entries(p_employee_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.payroll_entries pe
     set deudas = case when pe.deudas_override then pe.deudas
                       else coalesce(public.payroll_plan_installments(pe.employee_id, pe.period_id), 0) end
    from public.payroll_periods pp
   where pp.id = pe.period_id
     and pp.status = 'draft'
     and pp.kind = 'monthly'
     and pe.employee_id = p_employee_id
     and ((not pe.deudas_override
           and pe.deudas is distinct from coalesce(public.payroll_plan_installments(pe.employee_id, pe.period_id), 0))
          or pe.adelantos is distinct from public.payroll_plan_advances(pe.employee_id, pe.period_id));
$$;

drop trigger payroll_entries_apply_plans on public.payroll_entries;

-- adelantos joins the column list: a write to it by hand is recomputed.
create trigger payroll_entries_apply_plans
  before insert or update of deudas, deudas_override, adelantos on public.payroll_entries
  for each row execute function public.payroll_entry_apply_plans();

-- 4. Closing a period writes the préstamos and the adelantos to the account --------

create or replace function public.payroll_period_sync_account_discounts()
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
  if not (old.status = 'draft' and new.status = 'closed') or not new.posts_employee_accounts then
    return null;
  end if;

  for v_entry in
    select pe.id, pe.employee_id, pe.deudas, pe.deudas_override, pe.adelantos
      from public.payroll_entries pe
     where pe.period_id = new.id
       and (pe.deudas > 0 or pe.adelantos > 0)
  loop
    -- Deudas: the préstamos' cuotas (a hand-typed amount pays them in order).
    v_left := v_entry.deudas;
    for v_plan in
      select p.id, p.description, p.installment_amount, p.remaining, p.creditor
        from public.v_employee_debt_plans p
       where p.employee_id = v_entry.employee_id
         and p.status = 'activo'
         and p.currency = 'ARS'
         and p.start_month <= make_date(new.year, new.month, 1)
         and p.remaining > 0
         and not public.debt_plan_is_advance(p.installment_amount, p.total)
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

    -- Adelantos: counted as paid on the planilla, settled here.
    v_left := v_entry.adelantos;
    for v_plan in
      select p.id, p.description, p.remaining, p.creditor
        from public.v_employee_debt_plans p
       where p.employee_id = v_entry.employee_id
         and p.status = 'activo'
         and p.currency = 'ARS'
         and p.start_month <= make_date(new.year, new.month, 1)
         and p.remaining > 0
         and public.debt_plan_is_advance(p.installment_amount, p.total)
       order by p.start_month, p.created_at, p.id
    loop
      exit when v_left <= 0;
      v_part := least(v_left, v_plan.remaining);
      insert into public.employee_account_movements (
        employee_id, kind, currency, amount, movement_date, description, creditor,
        plan_id, payroll_entry_id, created_by
      ) values (
        v_entry.employee_id, 'payroll_discount', 'ARS', v_part, v_date,
        left('Adelanto en sueldo ' || v_label || ' — ' || v_plan.description, 200),
        v_plan.creditor, v_plan.id, v_entry.id, auth.uid()
      );
      v_left := v_left - v_part;
    end loop;
  end loop;
  return null;
end;
$$;

revoke all on function public.payroll_period_sync_account_discounts() from public, anon, authenticated;

-- 5. Views ----------------------------------------------------------------------------

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
    COALESCE(x.paid_in_kind, 0::numeric) AS paid_in_kind,
    e.adelantos AS paid_advance
   FROM public.payroll_entries e
     LEFT JOIN LATERAL ( SELECT sum(payroll_entry_extras.amount) AS extras_total,
            sum(payroll_entry_extras.amount) FILTER (WHERE payroll_entry_extras.loan_installment_id IS NOT NULL) AS paid_in_kind
           FROM public.payroll_entry_extras
          WHERE payroll_entry_extras.entry_id = e.id) x ON true;

comment on view public.v_payroll_entries_resolved is
  'Entry + extras_total + total_a_pagar (sueldo + extras + vacaciones + viáticos − deudas − teléfono − embargo) + paid_in_kind (las líneas de cuotas pagadas de un plan de ahorro imputado: ya pagadas, sin caja) + paid_advance (los adelantos del mes: ya pagados desde su cuenta).';

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
    COALESCE(p.paid_total, 0::numeric) + r.paid_in_kind + r.paid_advance AS paid_total,
    r.total_a_pagar - COALESCE(p.paid_total, 0::numeric) - r.paid_in_kind - r.paid_advance AS saldo,
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
    r.paid_in_kind,
    r.paid_advance
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
  'Entry resolved + paid_total (pagos + paid_in_kind + paid_advance) y saldo (total_a_pagar − paid_total), lo pagado por método, la parte de libros (recibo − embargo), lo pagado por canal (libros / gestión, solo pagos), paid_in_kind (cuotas de plan de ahorro ya pagadas) y paid_advance (adelantos del mes).';

revoke all on public.v_payroll_entries_resolved, public.v_payroll_entries_with_payments from anon;
grant select, insert, update, delete on public.v_payroll_entries_resolved, public.v_payroll_entries_with_payments to authenticated;
grant all on public.v_payroll_entries_resolved, public.v_payroll_entries_with_payments to service_role;



-- 6. Cash still to pay ignores the adelantos ------------------------------------------

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

  select public.payroll_fiscal_cap(public.payroll_fiscal_share(r.recibo_neto, r.embargo), r.total_a_pagar - r.paid_in_kind - r.paid_advance)
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
               - public.payroll_fiscal_cap(public.payroll_fiscal_share(r.recibo_neto, r.embargo), r.total_a_pagar - r.paid_in_kind - r.paid_advance)
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
             where k.loan_installment_id is not null
            union all
            select a.id, a.adelantos from public.payroll_entries a
             where a.adelantos > 0) x
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


-- 7. Rebalance when the adelantos change too ------------------------------------------

drop trigger payroll_entries_rebalance_channels on public.payroll_entries;

-- No column list: the garnishment BEFORE trigger rewrites embargo when only
-- embargo_override is in the SET list.
create trigger payroll_entries_rebalance_channels
  after update on public.payroll_entries
  for each row
  when (old.recibo_neto is distinct from new.recibo_neto
        or old.embargo is distinct from new.embargo
        or old.sueldo_neto is distinct from new.sueldo_neto
        or old.vacaciones_monto is distinct from new.vacaciones_monto
        or old.viaticos is distinct from new.viaticos
        or old.deudas is distinct from new.deudas
        or old.telefono is distinct from new.telefono
        or old.adelantos is distinct from new.adelantos)
  execute function public.payroll_entries_rebalance_channels();

-- 8. Backfill: draft entries move their adelantos out of Deudas ------------------------
-- One statement per entry row: deudas drops by what adelantos gains, so the
-- cash still to pay (and the channel split) is unchanged. A hand-typed Deudas
-- is kept as typed.

select set_config('jouve.payroll_plans_backfill', 'on', true);

update public.payroll_entries pe
   set deudas = case when pe.deudas_override then pe.deudas
                     else coalesce(public.payroll_plan_installments(pe.employee_id, pe.period_id), 0) end
  from public.payroll_periods pp
 where pp.id = pe.period_id
   and pp.status = 'draft'
   and pp.kind = 'monthly'
   and public.payroll_plan_advances(pe.employee_id, pe.period_id) > 0;

select set_config('jouve.payroll_plans_backfill', 'off', true);
