SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Treasury primitives that rewrite a reconciled movement while keeping the
-- total of its bank statement line, and the reconciled-movement messages
-- pointing to the account's «Extracto» tab (the standalone Conciliación page
-- is gone).
--
-- 1. matched_line_totals(lines): each line's matched total (the signed sum of
--    its movements). The primitives compare it before and after writing.
-- 2. guard_transaction_reconciled: same as 20261104070100 except
--    * the messages name the account's «Extracto» tab;
--    * one exemption: while the transaction-local GUC
--      jouve.rewriting_reconciled is 'on', inside a trigger chain
--      (pg_trigger_depth() > 1), an UPDATE that changes only amount and/or
--      channel_id passes. Only the primitives below set the GUC; a DELETE is
--      never exempt.
-- 3. split_matched_movement(movement, sibling, amount, channel): a movement
--    matched to one line gives part of its amount to a sibling of the same
--    account, kind, currency and dates, which joins the same line; the line
--    total is unchanged.
-- 4. merge_matched_movement(movement, sibling, channel): the reverse (the
--    sibling's amount back on the movement and its match removed), or, with
--    no sibling, only the movement's channel changes. The caller deletes the
--    sibling's owner afterwards.
--
-- The primitives are domain-neutral (payroll is their first caller, from its
-- triggers) and revoked from every API role. RLS unchanged.
--
-- Rollback: older code never sets the GUC nor calls the primitives; the guard
-- keeps refusing every other change of a reconciled movement.

-- 1. Line totals --------------------------------------------------------------------

create function public.matched_line_totals(p_line_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.line_id, x.total), '{}'::jsonb)
    from (
      select m.line_id,
             sum(case when t.kind in ('income', 'transfer_in') then t.amount else -t.amount end) as total
        from public.bank_statement_matches m
        join public.transactions t on t.id = m.transaction_id
       where m.line_id = any (coalesce(p_line_ids, '{}'::uuid[]))
       group by m.line_id
    ) x;
$$;

comment on function public.matched_line_totals(uuid[]) is
  'Total conciliado de cada línea del extracto (suma con signo de sus movimientos), como jsonb {línea: total}.';

revoke all on function public.matched_line_totals(uuid[]) from public, anon, authenticated;

-- 2. Guard ---------------------------------------------------------------------------

create or replace function public.guard_transaction_reconciled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.bank_statement_matches m where m.transaction_id = old.id
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'El movimiento está conciliado con el extracto bancario: desconciliá su línea en la pestaña «Extracto» de su cuenta antes de borrarlo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- Only split_matched_movement / merge_matched_movement set this GUC; they
  -- assert the line total after writing.
  if current_setting('jouve.rewriting_reconciled', true) = 'on'
     and pg_trigger_depth() > 1
     and new.transaction_date is not distinct from old.transaction_date
     and new.accrual_month    is not distinct from old.accrual_month
     and new.account_id       is not distinct from old.account_id
     and new.kind             is not distinct from old.kind
     and new.currency         is not distinct from old.currency
     and new.transfer_pair_id is not distinct from old.transfer_pair_id then
    return new;
  end if;

  if new.amount           is distinct from old.amount
     or new.transaction_date is distinct from old.transaction_date
     or new.accrual_month    is distinct from old.accrual_month
     or new.account_id       is distinct from old.account_id
     or new.kind             is distinct from old.kind
     or new.currency         is distinct from old.currency
     or new.channel_id       is distinct from old.channel_id
     or new.transfer_pair_id is distinct from old.transfer_pair_id then
    raise exception 'El movimiento está conciliado con el extracto bancario: desconciliá su línea en la pestaña «Extracto» de su cuenta antes de cambiar monto, fecha, cuenta, tipo, moneda o canal'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_transaction_reconciled() from public, anon, authenticated;

-- 3. Split ---------------------------------------------------------------------------

create function public.split_matched_movement(
  p_transaction_id uuid,
  p_sibling_id     uuid,
  p_amount         numeric,
  p_channel_id     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx         public.transactions;
  v_sib        public.transactions;
  v_lines      uuid[];
  v_line       uuid;
  v_sib_lines  uuid[];
  v_total      numeric;
  v_before     jsonb;
begin
  -- Both rows locked in id order.
  perform 1 from public.transactions t
   where t.id in (p_transaction_id, p_sibling_id)
   order by t.id
     for update;
  select * into v_tx from public.transactions where id = p_transaction_id;
  select * into v_sib from public.transactions where id = p_sibling_id;
  if v_tx.id is null or v_sib.id is null or v_tx.id = v_sib.id then
    raise exception 'Movimiento inexistente para partir'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  select array_agg(distinct m.line_id) into v_lines
    from public.bank_statement_matches m where m.transaction_id = v_tx.id;
  if coalesce(cardinality(v_lines), 0) <> 1 then
    raise exception 'El movimiento está conciliado con varias líneas o con ninguna: desconciliá para partirlo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  v_line := v_lines[1];

  select array_agg(distinct m.line_id) into v_sib_lines
    from public.bank_statement_matches m where m.transaction_id = v_sib.id;
  if coalesce(cardinality(v_sib_lines), 0) > 0 and v_sib_lines <> array[v_line] then
    raise exception 'El otro movimiento está conciliado con otra línea: desconciliá para partirlo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if v_sib.account_id is distinct from v_tx.account_id
     or v_sib.kind is distinct from v_tx.kind
     or v_sib.currency is distinct from v_tx.currency
     or v_sib.transaction_date is distinct from v_tx.transaction_date
     or v_sib.accrual_month is distinct from v_tx.accrual_month then
    raise exception 'Los dos movimientos tienen que ser de la misma cuenta, tipo, moneda y fechas para partir uno conciliado'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  v_total := v_tx.amount + case when cardinality(v_sib_lines) > 0 then v_sib.amount else 0 end;
  if p_amount is null or p_amount <= 0 or p_amount >= v_total then
    raise exception 'El importe que queda en el movimiento tiene que ser mayor a 0 y menor a %', v_total
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  v_before := public.matched_line_totals(array[v_line]);

  perform set_config('jouve.rewriting_reconciled', 'on', true);
  update public.transactions
     set amount = p_amount, channel_id = p_channel_id
   where id = v_tx.id
     and (amount is distinct from p_amount or channel_id is distinct from p_channel_id);
  update public.transactions
     set amount = v_total - p_amount
   where id = v_sib.id
     and amount is distinct from v_total - p_amount;
  if coalesce(cardinality(v_sib_lines), 0) = 0 then
    insert into public.bank_statement_matches (line_id, transaction_id, matched_by)
    values (v_line, v_sib.id, auth.uid());
  end if;
  perform set_config('jouve.rewriting_reconciled', 'off', true);

  if public.matched_line_totals(array[v_line]) is distinct from v_before then
    raise exception 'Partir el movimiento cambiaría el total conciliado de su línea del extracto'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
end;
$$;

comment on function public.split_matched_movement(uuid, uuid, numeric, text) is
  'Tesorería: un movimiento conciliado con una sola línea queda con p_amount (y p_channel_id) y el resto pasa al movimiento hermano, que se concilia con la misma línea. El total conciliado de la línea no cambia. Solo desde triggers.';

revoke all on function public.split_matched_movement(uuid, uuid, numeric, text) from public, anon, authenticated;

-- 4. Merge ---------------------------------------------------------------------------

create function public.merge_matched_movement(
  p_transaction_id uuid,
  p_sibling_id     uuid,
  p_channel_id     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx         public.transactions;
  v_sib        public.transactions;
  v_lines      uuid[];
  v_sib_lines  uuid[];
  v_before     jsonb;
begin
  perform 1 from public.transactions t
   where t.id in (p_transaction_id, p_sibling_id)
   order by t.id
     for update;
  select * into v_tx from public.transactions where id = p_transaction_id;
  if v_tx.id is null then
    raise exception 'Movimiento inexistente para unir'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  select array_agg(distinct m.line_id) into v_lines
    from public.bank_statement_matches m where m.transaction_id = v_tx.id;
  v_before := public.matched_line_totals(v_lines);

  if p_sibling_id is null then
    perform set_config('jouve.rewriting_reconciled', 'on', true);
    update public.transactions
       set channel_id = p_channel_id
     where id = v_tx.id and channel_id is distinct from p_channel_id;
    perform set_config('jouve.rewriting_reconciled', 'off', true);
  else
    select * into v_sib from public.transactions where id = p_sibling_id;
    if v_sib.id is null or v_sib.id = v_tx.id then
      raise exception 'Movimiento inexistente para unir'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    select array_agg(distinct m.line_id) into v_sib_lines
      from public.bank_statement_matches m where m.transaction_id = v_sib.id;
    -- An unmatched sibling would add its amount to the line.
    if coalesce(cardinality(v_lines), 0) <> 1
       or coalesce(cardinality(v_sib_lines), 0) <> 1
       or v_sib_lines <> v_lines then
      raise exception 'Los dos movimientos tienen que estar conciliados con la misma línea del extracto para unirlos'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    if v_sib.account_id is distinct from v_tx.account_id
       or v_sib.kind is distinct from v_tx.kind
       or v_sib.currency is distinct from v_tx.currency
       or v_sib.transaction_date is distinct from v_tx.transaction_date
       or v_sib.accrual_month is distinct from v_tx.accrual_month then
      raise exception 'Los dos movimientos tienen que ser de la misma cuenta, tipo, moneda y fechas para unirlos'
        using errcode = '55006', hint = 'jouve_guard';
    end if;

    delete from public.bank_statement_matches where transaction_id = v_sib.id;
    perform set_config('jouve.rewriting_reconciled', 'on', true);
    update public.transactions
       set amount = v_tx.amount + v_sib.amount, channel_id = p_channel_id
     where id = v_tx.id;
    perform set_config('jouve.rewriting_reconciled', 'off', true);
  end if;

  if public.matched_line_totals(v_lines) is distinct from v_before then
    raise exception 'Unir los movimientos cambiaría el total conciliado de su línea del extracto'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
end;
$$;

comment on function public.merge_matched_movement(uuid, uuid, text) is
  'Tesorería: el movimiento hermano (conciliado con la misma única línea) vuelve al movimiento y se desconcilia; sin hermano, solo cambia el canal del movimiento. El total conciliado de la línea no cambia. Quien llama borra después el dueño del hermano. Solo desde triggers.';

revoke all on function public.merge_matched_movement(uuid, uuid, text) from public, anon, authenticated;
