SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The channel of a payroll payment is the database's: the payslip
-- («recibo») net minus the embargo goes to the books (fiscal channel), the
-- rest (otros, extras, viáticos…) to management (internal channel), whatever
-- the payment method.
--
-- 1. payroll_channel(fiscal), payroll_fiscal_share(recibo, embargo) and
--    payroll_fiscal_cap(share, total_a_pagar): the only place the payroll
--    channels and the books' share are written. The cap is the most the
--    payments of an entry put on the fiscal channel; an overpayment beyond
--    total_a_pagar goes internal.
-- 2. payroll_periods.posts_receipt_gap: periods already closed are false and
--    keep the channels their users chose (no rebalance, no recibo gap entry
--    in 20261111185300). The database's alone, pinned like
--    posts_employee_accounts by enforce_payroll_period_immutability.
-- 3. payroll_payments.split_parent_id: the internal piece of a payment whose
--    amount crosses the fiscal cap. Composite FK (entry_id, split_parent_id)
--    → (entry_id, id), one child per parent, a child is never a parent; only
--    the rebalance writes it (guard_payroll_payment_split_parent).
--    channel_id defaults to the internal channel.
-- 4. payroll_entry_rebalance_channels(entry): payment groups (parent + child)
--    ordered by paid_at, created_at, id fill the fiscal cap first; the group
--    that crosses it is a fiscal parent plus one internal child; later
--    groups are internal. A reconciled movement is rewritten only through
--    split_matched_movement / merge_matched_movement (20261111185100), and
--    every bank line keeps its matched total. A change of a fiscal piece in a
--    closed accounting month is refused with a payroll message. A movement
--    moved onto the fiscal channel is posted here: repost_journal
--    (20261031180534) leaves a movement with no live entry alone.
-- 5. Triggers: statement-level on payroll_payments and payroll_entry_extras
--    (insert, update, delete) and a row trigger on payroll_entries when an
--    input of the share or of total_a_pagar changes (also when the
--    garnishment trigger rewrites embargo). The transaction-local flag
--    jouve.payroll_rebalancing keeps them quiet while payroll code writes
--    payroll rows; it grants nothing on treasury.
-- 6. v_payroll_entries_with_payments: payments_count counts parents; appends
--    fiscal_share, paid_fiscal and paid_internal.
-- 7. update_payroll_payment: edits a payment as one group (parent + child).
--    A matched group keeps its amount. Empty notes are stored as null.
--
-- No backfill: the owner rebalances the open planillas after promoting (a
-- no-op update of each entry's payments reaches the statement trigger).
--
-- RLS unchanged (payroll_payments keeps its owner/admin/finance policies).
-- Rollback: older code sends channel_id and the statement trigger overrides
-- it; it lists a child as a payment, editing it is rebalanced and setting
-- split_parent_id is refused; the appended view columns are ignored.

-- 1. Resolver --------------------------------------------------------------------------

create function public.payroll_channel(p_fiscal boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_fiscal then 'jouve_fiscal' else 'jouve_internal' end;
$$;

comment on function public.payroll_channel(boolean) is
  'Canal de los pagos de sueldo: el fiscal (libros) o el interno (gestión). Único lugar que los nombra.';

revoke all on function public.payroll_channel(boolean) from public, anon;
grant execute on function public.payroll_channel(boolean) to authenticated, service_role;

create function public.payroll_fiscal_share(p_recibo_neto numeric, p_embargo numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(coalesce(p_recibo_neto, 0) - coalesce(p_embargo, 0), 0);
$$;

comment on function public.payroll_fiscal_share(numeric, numeric) is
  'Lo que va a libros de un sueldo: el neto del recibo menos el embargo (nunca negativo).';

revoke all on function public.payroll_fiscal_share(numeric, numeric) from public, anon;
grant execute on function public.payroll_fiscal_share(numeric, numeric) to authenticated, service_role;

create function public.payroll_fiscal_cap(p_share numeric, p_total_a_pagar numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select least(coalesce(p_share, 0), greatest(coalesce(p_total_a_pagar, 0), 0));
$$;

comment on function public.payroll_fiscal_cap(numeric, numeric) is
  'Lo más que los pagos de un sueldo ponen en el canal fiscal: la parte de libros, hasta el total a pagar.';

revoke all on function public.payroll_fiscal_cap(numeric, numeric) from public, anon;
grant execute on function public.payroll_fiscal_cap(numeric, numeric) to authenticated, service_role;

-- 2. Periods ---------------------------------------------------------------------------

alter table public.payroll_periods
  add column posts_receipt_gap boolean not null default true;

comment on column public.payroll_periods.posts_receipt_gap is
  'false = cerrado antes del reparto automático por recibo: sus pagos conservan el canal elegido y cerrarlo de nuevo no asienta la parte del recibo que salda deuda.';

update public.payroll_periods
   set posts_receipt_gap = false
 where status = 'closed';

-- Same as 20261104194100 plus posts_receipt_gap, pinned like
-- posts_employee_accounts.
create or replace function public.enforce_payroll_period_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_table_name = 'payroll_periods' then
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
       and ((tg_op = 'INSERT' and new.posts_employee_accounts is distinct from true)
            or (tg_op = 'UPDATE'
                and new.posts_employee_accounts is distinct from old.posts_employee_accounts)) then
      raise exception
        'Si una liquidación escribe las deudas en la cuenta del empleado lo define el sistema.'
        using errcode = '42501', hint = 'jouve_guard';
    end if;
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
       and ((tg_op = 'INSERT' and new.posts_receipt_gap is distinct from true)
            or (tg_op = 'UPDATE'
                and new.posts_receipt_gap is distinct from old.posts_receipt_gap)) then
      raise exception
        'Si una liquidación reparte los pagos por recibo lo define el sistema.'
        using errcode = '42501', hint = 'jouve_guard';
    end if;
    if tg_op = 'INSERT' then
      return new;
    end if;
    if old.status = 'closed' and new.status is distinct from 'closed'
       and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
       and not public.user_has_role(array['owner', 'admin']) then
      raise exception
        'Solo un owner o un admin pueden reabrir una liquidación cerrada.'
        using errcode = '42501', hint = 'jouve_guard';
    end if;
    if old.status = 'closed' and new.status = 'closed' then
      if new.year is distinct from old.year
         or new.month is distinct from old.month then
        raise exception
          'Período cerrado (id=%): año/mes son inmutables', old.id
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'payroll_entries' then
    select status into v_status
    from public.payroll_periods
    where id = coalesce(new.period_id, old.period_id);
    if v_status = 'closed' then
      raise exception
        'Período cerrado: no se pueden modificar entries (period_id=%)',
        coalesce(new.period_id, old.period_id)
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if tg_op = 'UPDATE' and new.period_id is distinct from old.period_id then
      select status into v_status
      from public.payroll_periods
      where id = old.period_id;
      if v_status = 'closed' then
        raise exception
          'Período cerrado: sus entries no se pasan a otro período (period_id=%)',
          old.period_id
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_table_name = 'payroll_entry_extras' then
    select pp.status into v_status
    from public.payroll_entries pe
    join public.payroll_periods pp on pp.id = pe.period_id
    where pe.id = coalesce(new.entry_id, old.entry_id);
    if v_status = 'closed' then
      raise exception
        'Período cerrado: no se pueden modificar extras (entry_id=%)',
        coalesce(new.entry_id, old.entry_id)
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if tg_op = 'UPDATE' and new.entry_id is distinct from old.entry_id then
      select pp.status into v_status
      from public.payroll_entries pe
      join public.payroll_periods pp on pp.id = pe.period_id
      where pe.id = old.entry_id;
      if v_status = 'closed' then
        raise exception
          'Período cerrado: sus extras no se pasan a otra entry (entry_id=%)',
          old.entry_id
          using errcode = '23514', hint = 'jouve_guard';
      end if;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_payroll_period_immutability() from public, anon, authenticated;

-- 3. Split pieces ----------------------------------------------------------------------

-- A few rows per employee and month: building the index under the lock is
-- short.
-- squawk-ignore require-concurrent-index-creation
create unique index payroll_payments_entry_id_id_key
  on public.payroll_payments (entry_id, id);

alter table public.payroll_payments
  add constraint payroll_payments_entry_id_id_key
  unique using index payroll_payments_entry_id_id_key;

alter table public.payroll_payments
  add column split_parent_id uuid;

comment on column public.payroll_payments.split_parent_id is
  'Parte interna (gestión) del pago que cruza la parte de libros del sueldo: apunta al pago fiscal del que salió. La escribe solo el reparto automático.';

-- The column was just added (null on every row): both constraints are
-- validated at once, on a small table.
alter table public.payroll_payments
  -- squawk-ignore constraint-missing-not-valid
  add constraint payroll_payments_split_parent_not_self
  check (split_parent_id is distinct from id);

alter table public.payroll_payments
  -- squawk-ignore constraint-missing-not-valid,adding-foreign-key-constraint
  add constraint payroll_payments_split_parent_fkey
  foreign key (entry_id, split_parent_id)
  references public.payroll_payments (entry_id, id)
  on delete cascade;

-- squawk-ignore require-concurrent-index-creation
create unique index payroll_payments_split_parent_key
  on public.payroll_payments (split_parent_id)
  where split_parent_id is not null;

alter table public.payroll_payments
  alter column channel_id set default public.payroll_channel(false);

create function public.guard_payroll_payment_split_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.split_parent_id is null)
     or (tg_op = 'UPDATE' and new.split_parent_id is not distinct from old.split_parent_id) then
    return new;
  end if;

  if coalesce(current_setting('jouve.payroll_rebalancing', true), '') <> 'on'
     or pg_trigger_depth() <= 1 then
    raise exception 'La parte interna de un pago la arma el sistema'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.split_parent_id is not null and exists (
    select 1 from public.payroll_payments p
     where p.id = new.split_parent_id and p.split_parent_id is not null
  ) then
    raise exception 'La parte interna de un pago no puede tener otra parte interna'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_payroll_payment_split_parent() from public, anon, authenticated;

create trigger payroll_payments_guard_split_parent
  before insert or update of split_parent_id on public.payroll_payments
  for each row execute function public.guard_payroll_payment_split_parent();

-- 4. Rebalance -------------------------------------------------------------------------

create function public.payroll_entry_rebalance_channels(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  select public.payroll_fiscal_cap(public.payroll_fiscal_share(r.recibo_neto, r.embargo), r.total_a_pagar)
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

comment on function public.payroll_entry_rebalance_channels(uuid) is
  'Reparte los pagos de un sueldo entre el canal fiscal (hasta recibo − embargo, sin pasar el total a pagar) y el interno: por fecha de pago, el pago que cruza el tope queda fiscal con una parte interna. Mantiene el total conciliado de cada línea del extracto. Solo desde triggers.';

revoke all on function public.payroll_entry_rebalance_channels(uuid) from public, anon, authenticated;

-- 5. Triggers --------------------------------------------------------------------------

-- Statement triggers: transition tables forbid column lists and several
-- events, so one function per event. The rebalance is idempotent and writes
-- only what differs, so every entry of the statement is rebalanced.
create function public.payroll_payments_rebalance_ins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
begin
  if coalesce(current_setting('jouve.payroll_rebalancing', true), '') = 'on' then
    return null;
  end if;
  for v_entry in select distinct n.entry_id from new_rows n order by 1 loop
    perform public.payroll_entry_rebalance_channels(v_entry);
  end loop;
  return null;
end;
$$;

revoke all on function public.payroll_payments_rebalance_ins() from public, anon, authenticated;

create function public.payroll_payments_rebalance_upd()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
begin
  if coalesce(current_setting('jouve.payroll_rebalancing', true), '') = 'on' then
    return null;
  end if;
  for v_entry in
    select entry_id from new_rows union select entry_id from old_rows order by 1
  loop
    perform public.payroll_entry_rebalance_channels(v_entry);
  end loop;
  return null;
end;
$$;

revoke all on function public.payroll_payments_rebalance_upd() from public, anon, authenticated;

create function public.payroll_payments_rebalance_del()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
begin
  if coalesce(current_setting('jouve.payroll_rebalancing', true), '') = 'on' then
    return null;
  end if;
  for v_entry in select distinct o.entry_id from old_rows o order by 1 loop
    perform public.payroll_entry_rebalance_channels(v_entry);
  end loop;
  return null;
end;
$$;

revoke all on function public.payroll_payments_rebalance_del() from public, anon, authenticated;

create trigger payroll_payments_rebalance_ins
  after insert on public.payroll_payments
  referencing new table as new_rows
  for each statement execute function public.payroll_payments_rebalance_ins();

create trigger payroll_payments_rebalance_upd
  after update on public.payroll_payments
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.payroll_payments_rebalance_upd();

create trigger payroll_payments_rebalance_del
  after delete on public.payroll_payments
  referencing old table as old_rows
  for each statement execute function public.payroll_payments_rebalance_del();

-- Extras feed total_a_pagar (v_payroll_entries_resolved sums them).
create function public.payroll_entry_extras_rebalance_ins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
begin
  if coalesce(current_setting('jouve.payroll_rebalancing', true), '') = 'on' then
    return null;
  end if;
  for v_entry in select distinct n.entry_id from new_rows n order by 1 loop
    perform public.payroll_entry_rebalance_channels(v_entry);
  end loop;
  return null;
end;
$$;

revoke all on function public.payroll_entry_extras_rebalance_ins() from public, anon, authenticated;

create function public.payroll_entry_extras_rebalance_upd()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
begin
  if coalesce(current_setting('jouve.payroll_rebalancing', true), '') = 'on' then
    return null;
  end if;
  for v_entry in
    select entry_id from new_rows union select entry_id from old_rows order by 1
  loop
    perform public.payroll_entry_rebalance_channels(v_entry);
  end loop;
  return null;
end;
$$;

revoke all on function public.payroll_entry_extras_rebalance_upd() from public, anon, authenticated;

create function public.payroll_entry_extras_rebalance_del()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
begin
  if coalesce(current_setting('jouve.payroll_rebalancing', true), '') = 'on' then
    return null;
  end if;
  for v_entry in select distinct o.entry_id from old_rows o order by 1 loop
    perform public.payroll_entry_rebalance_channels(v_entry);
  end loop;
  return null;
end;
$$;

revoke all on function public.payroll_entry_extras_rebalance_del() from public, anon, authenticated;

create trigger payroll_entry_extras_rebalance_ins
  after insert on public.payroll_entry_extras
  referencing new table as new_rows
  for each statement execute function public.payroll_entry_extras_rebalance_ins();

create trigger payroll_entry_extras_rebalance_upd
  after update on public.payroll_entry_extras
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.payroll_entry_extras_rebalance_upd();

create trigger payroll_entry_extras_rebalance_del
  after delete on public.payroll_entry_extras
  referencing old table as old_rows
  for each statement execute function public.payroll_entry_extras_rebalance_del();

create function public.payroll_entries_rebalance_channels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.payroll_entry_rebalance_channels(new.id);
  return null;
end;
$$;

revoke all on function public.payroll_entries_rebalance_channels() from public, anon, authenticated;

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
        or old.telefono is distinct from new.telefono)
  execute function public.payroll_entries_rebalance_channels();

-- 6. View ------------------------------------------------------------------------------

-- Same as 20261103050000 except payments_count counts payments (parents), not
-- their internal pieces; appends fiscal_share, paid_fiscal and paid_internal.
create or replace view public.v_payroll_entries_with_payments
with (security_invoker = on) as
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
  r.updated_at,
  r.recibo_neto,
  r.embargo,
  coalesce(p.paid_transferencia, 0)          as paid_transferencia,
  coalesce(p.paid_efectivo, 0)               as paid_efectivo,
  public.payroll_fiscal_share(r.recibo_neto, r.embargo) as fiscal_share,
  coalesce(p.paid_fiscal, 0)                 as paid_fiscal,
  coalesce(p.paid_internal, 0)               as paid_internal
from public.v_payroll_entries_resolved r
left join lateral (
  select sum(pp.amount) as paid_total,
         (count(*) filter (where pp.split_parent_id is null))::int as payments_count,
         sum(pp.amount) filter (where pp.method = 'transferencia') as paid_transferencia,
         sum(pp.amount) filter (where pp.method = 'efectivo') as paid_efectivo,
         sum(pp.amount) filter (where ch.is_fiscal) as paid_fiscal,
         sum(pp.amount) filter (where not ch.is_fiscal) as paid_internal
  from public.payroll_payments pp
  join public.invoicing_channels ch on ch.id = pp.channel_id
  where pp.entry_id = r.id
) p on true;

comment on view public.v_payroll_entries_with_payments is
  'Entry resolved + paid_total y saldo (total_a_pagar − paid_total), lo pagado por método, la parte de libros (recibo − embargo) y lo pagado por canal (libros / gestión).';

-- 7. Group edit ------------------------------------------------------------------------

create function public.update_payroll_payment(
  p_id         uuid,
  p_account_id uuid,
  p_amount     numeric,
  p_method     public.payroll_payment_method,
  p_paid_at    date,
  p_notes      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent  public.payroll_payments;
  v_child   public.payroll_payments;
  v_lines   uuid[];
  v_before  jsonb;
  v_total   numeric;
  v_matched boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para editar pagos de sueldo'
      using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto tiene que ser mayor a 0'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  select * into v_parent from public.payroll_payments where id = p_id for update;
  if v_parent.id is null then
    raise exception 'El pago ya no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_parent.split_parent_id is not null then
    raise exception 'Editá el pago completo, no su parte interna'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  select * into v_child from public.payroll_payments where split_parent_id = v_parent.id for update;

  -- Snapshot before any write.
  select array_agg(distinct m.line_id) into v_lines
    from public.payroll_payments p
    join public.bank_statement_matches m on m.transaction_id = p.transaction_id
   where p.entry_id = v_parent.entry_id;
  v_before := public.matched_line_totals(v_lines);

  v_total := v_parent.amount + coalesce(v_child.amount, 0);
  v_matched := exists (
    select 1 from public.bank_statement_matches m
     where m.transaction_id in (v_parent.transaction_id, v_child.transaction_id)
  );
  if v_matched and p_amount <> v_total then
    raise exception 'El pago está conciliado: desconciliá su línea en la pestaña «Extracto» de su cuenta para cambiar el monto'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if v_child.id is not null then
    perform set_config('jouve.payroll_rebalancing', 'on', true);
    if p_amount <> v_total then
      -- The rebalance below splits the new amount again.
      delete from public.payroll_payments where id = v_child.id;
    else
      update public.payroll_payments
         set account_id = p_account_id, method = p_method, paid_at = p_paid_at,
             notes = nullif(p_notes, '')
       where id = v_child.id;
    end if;
    perform set_config('jouve.payroll_rebalancing', 'off', true);
  end if;

  -- An ordinary update: the statement trigger rebalances the entry, and the
  -- reconciled guard still refuses a date or account change of a matched
  -- movement.
  update public.payroll_payments
     set account_id = p_account_id,
         amount     = case when p_amount <> v_total then p_amount else amount end,
         method     = p_method,
         paid_at    = p_paid_at,
         notes      = nullif(p_notes, '')
   where id = v_parent.id;

  if public.matched_line_totals(v_lines) is distinct from v_before then
    raise exception 'El pago de sueldo está conciliado de una forma que el reparto automático no puede mantener: desconciliá su línea en la pestaña «Extracto» de su cuenta, cargá el cambio y volvé a conciliar'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
end;
$$;

comment on function public.update_payroll_payment(uuid, uuid, numeric, public.payroll_payment_method, date, text) is
  'Edita un pago de sueldo completo (el pago y su parte interna): cuenta, monto, método, fecha y notas. El canal lo reparte la base. Un pago conciliado no cambia de monto.';

revoke all on function public.update_payroll_payment(uuid, uuid, numeric, public.payroll_payment_method, date, text) from public, anon, authenticated;
grant execute on function public.update_payroll_payment(uuid, uuid, numeric, public.payroll_payment_method, date, text) to authenticated, service_role;
