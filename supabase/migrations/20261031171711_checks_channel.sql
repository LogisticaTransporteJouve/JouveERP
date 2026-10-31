SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A check carries the invoicing channel of the document it came from, so an
-- internal check never moves a fiscal journal (C3):
--   * checks: the channel of its receipt; a manual check gets one when it is
--     created, deposited, rejected or endorsed (historical manual checks stay
--     NULL until then).
--   * issued_checks: the channel of its payment order.
-- Once set, a check's channel never changes. Deposits, rejections,
-- endorsements and the check journals all use it.

-- 1. Columns ------------------------------------------------------------------

-- The new column is all NULL, so the FK validation scan finds nothing to check;
-- the lock on invoicing_channels (4 rows) and on both tables lasts the scan.
alter table public.checks
  -- squawk-ignore adding-foreign-key-constraint
  add column channel_id text references public.invoicing_channels (id) on delete restrict;

alter table public.issued_checks
  -- squawk-ignore adding-foreign-key-constraint
  add column channel_id text references public.invoicing_channels (id) on delete restrict;

-- Built before the backfill, while no row matches the predicate: nothing to
-- index, so the write lock is momentary. CONCURRENTLY cannot run in this
-- migration's transaction.
-- squawk-ignore require-concurrent-index-creation
create index checks_channel_idx on public.checks (channel_id) where channel_id is not null;

-- squawk-ignore require-concurrent-index-creation
create index issued_checks_channel_idx on public.issued_checks (channel_id) where channel_id is not null;

-- 2. Backfill, from documents only --------------------------------------------
-- Never from a deposit: the deposit channel was picked by hand and is what C3
-- got wrong. Only fills NULLs, so a re-run changes nothing.

create or replace function public.backfill_check_channels()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.checks c
     set channel_id = r.channel_id
    from public.receipts r
   where r.id = c.source_receipt_id
     and c.channel_id is null;

  update public.checks c
     set channel_id = e.channel_id
    from (
      select distinct on (pl.endorsed_check_id) pl.endorsed_check_id, po.channel_id
        from public.payment_order_payment_lines pl
        join public.payment_orders po on po.id = pl.payment_order_id
       where pl.endorsed_check_id is not null
         and po.status <> 'canceled'
       order by pl.endorsed_check_id, po.created_at desc, po.id desc
    ) e
   where e.endorsed_check_id = c.id
     and c.source_receipt_id is null
     and c.channel_id is null;

  update public.issued_checks ic
     set channel_id = po.channel_id
    from public.payment_orders po
   where po.id = ic.payment_order_id
     and ic.channel_id is null;
end;
$$;

revoke all on function public.backfill_check_channels() from public, anon, authenticated;
grant execute on function public.backfill_check_channels() to service_role;

select public.backfill_check_channels();

-- 3. Inheritance and immutability ---------------------------------------------

create or replace function public.guard_check_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc_channel text;
  v_doc_label   text;
begin
  if tg_op = 'UPDATE' and old.channel_id is not null
     and new.channel_id is distinct from old.channel_id then
    raise exception 'El canal de un cheque no se puede cambiar una vez asignado'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  if tg_table_name = 'checks' then
    if new.source_receipt_id is null then
      return new;
    end if;
    select channel_id into v_doc_channel
      from public.receipts where id = new.source_receipt_id;
    v_doc_label := 'recibo';
  else
    if new.payment_order_id is null then
      return new;
    end if;
    select channel_id into v_doc_channel
      from public.payment_orders where id = new.payment_order_id;
    v_doc_label := 'orden de pago';
  end if;

  if new.channel_id is null then
    new.channel_id := v_doc_channel;
  elsif new.channel_id is distinct from v_doc_channel then
    raise exception 'El cheque es de otro canal que su %: un cheque va en el canal de su documento', v_doc_label
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_check_channel() from public, anon, authenticated;

create trigger checks_channel_inherit
  before insert or update of channel_id, source_receipt_id on public.checks
  for each row execute function public.guard_check_channel();

create trigger issued_checks_channel_inherit
  before insert or update of channel_id, payment_order_id on public.issued_checks
  for each row execute function public.guard_check_channel();

-- An endorsed check leaves in a payment order of its own channel; a check
-- without one takes the payment order's.
create or replace function public.guard_endorsed_check_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_channel    text;
  v_check_channel text;
begin
  select channel_id into v_po_channel
    from public.payment_orders where id = new.payment_order_id;
  select channel_id into v_check_channel
    from public.checks where id = new.endorsed_check_id for update;

  if v_check_channel is null then
    update public.checks set channel_id = v_po_channel where id = new.endorsed_check_id;
  elsif v_check_channel is distinct from v_po_channel then
    raise exception 'El cheque es de otro canal que la orden de pago: solo se endosa en una OP de su mismo canal'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_endorsed_check_channel() from public, anon, authenticated;

create trigger payment_order_payment_lines_check_channel
  before insert or update of endorsed_check_id, payment_order_id on public.payment_order_payment_lines
  for each row when (new.endorsed_check_id is not null)
  execute function public.guard_endorsed_check_channel();

-- 4. Inactive-channel guard ---------------------------------------------------
-- guard_channel_active() ships in 20261031162740_channel_active_guard.sql
-- (PR #250). Where it already exists, checks and issued_checks join its tables.

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'guard_channel_active'
  ) then
    create trigger checks_channel_active_ins
      before insert on public.checks
      for each row when (new.channel_id is not null)
      execute function public.guard_channel_active('channel_id');
    create trigger checks_channel_active_upd
      before update of channel_id on public.checks
      for each row when (new.channel_id is distinct from old.channel_id)
      execute function public.guard_channel_active('channel_id');
    create trigger issued_checks_channel_active_ins
      before insert on public.issued_checks
      for each row when (new.channel_id is not null)
      execute function public.guard_channel_active('channel_id');
    create trigger issued_checks_channel_active_upd
      before update of channel_id on public.issued_checks
      for each row when (new.channel_id is distinct from old.channel_id)
      execute function public.guard_channel_active('channel_id');
  end if;
end;
$$;

-- 5. Deposit and rejection ----------------------------------------------------
-- Bodies of 20260706090100_money_rpc_role_guards.sql plus the channel: the
-- check's own, or p_channel_id (then written to the check) when it has none.

create or replace function public.deposit_check(
  p_check_id    uuid,
  p_account_id  uuid,
  p_event_date  date,
  p_channel_id  text,
  p_description text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_channel      text;
  v_out_id       uuid;
  v_in_id        uuid;
  v_movement_id  uuid;
  v_accrual      date;
begin
  -- Role guard (cheques:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para depositar cheques'
      using errcode = '42501';
  end if;

  select * into v_check from public.checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status <> 'en_cartera' then
    raise exception 'check % está en estado % — solo se puede depositar desde en_cartera',
      p_check_id, v_check.status;
  end if;

  if v_check.channel_id is not null then
    if p_channel_id is not null and p_channel_id <> v_check.channel_id then
      raise exception 'El cheque ya tiene canal: se deposita en el canal del cheque'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_channel := v_check.channel_id;
  elsif p_channel_id is null then
    raise exception 'El cheque no tiene canal: elegí el canal del depósito'
      using errcode = '23514', hint = 'jouve_guard';
  else
    v_channel := p_channel_id;
  end if;

  v_accrual := date_trunc('month', p_event_date)::date;
  v_out_id := gen_random_uuid();
  v_in_id  := gen_random_uuid();

  insert into public.transactions (
    id, account_id, channel_id, kind, amount, currency, transaction_date,
    accrual_month, description, transfer_pair_id, created_by
  ) values
    (v_out_id, v_check.cartera_account_id, v_channel, 'transfer_out',
     v_check.amount, v_check.currency, p_event_date, v_accrual,
     coalesce(nullif(trim(p_description), ''),
              'Depósito check ' || v_check.check_number),
     v_in_id, auth.uid()),
    (v_in_id, p_account_id, v_channel, 'transfer_in',
     v_check.amount, v_check.currency, p_event_date, v_accrual,
     coalesce(nullif(trim(p_description), ''),
              'Depósito check ' || v_check.check_number),
     v_out_id, auth.uid());

  update public.checks
     set status = 'depositado',
         channel_id = v_channel
   where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, destination_account_id, transaction_id,
    notes, created_by
  ) values (
    p_check_id, 'deposited', p_event_date, p_account_id, v_out_id,
    nullif(trim(p_description), ''), auth.uid()
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

revoke all on function public.deposit_check(uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.deposit_check(uuid, uuid, date, text, text) to authenticated, service_role;

create or replace function public.reject_check(
  p_check_id   uuid,
  p_account_id uuid,
  p_event_date date,
  p_channel_id text,
  p_notes      text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_check       public.checks%rowtype;
  v_channel      text;
  v_movement_id  uuid;
  v_accrual      date;
begin
  -- Role guard (cheques:write holders in lib/auth/permissions.ts). The service
  -- role (crons, seed) passes; any other caller must hold a writer role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para rechazar cheques'
      using errcode = '42501';
  end if;

  select * into v_check from public.checks where id = p_check_id for update;
  if v_check.id is null then
    raise exception 'check % not found', p_check_id;
  end if;
  if v_check.status not in ('depositado', 'en_cartera') then
    raise exception 'check % está en estado % — solo se puede rechazar desde depositado o en_cartera',
      p_check_id, v_check.status;
  end if;

  if v_check.channel_id is not null then
    if p_channel_id is not null and p_channel_id <> v_check.channel_id then
      raise exception 'El cheque ya tiene canal: el rechazo va en el canal del cheque'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    v_channel := v_check.channel_id;
  elsif p_channel_id is null then
    raise exception 'El cheque no tiene canal: elegí el canal del rechazo'
      using errcode = '23514', hint = 'jouve_guard';
  else
    v_channel := p_channel_id;
  end if;

  v_accrual := date_trunc('month', p_event_date)::date;

  if v_check.status = 'depositado' then
    insert into public.transactions (
      account_id, channel_id, kind, amount, currency, transaction_date,
      accrual_month, description, created_by
    ) values (
      p_account_id, v_channel, 'expense',
      v_check.amount, v_check.currency, p_event_date, v_accrual,
      'Cheque rechazado ' || v_check.check_number, auth.uid()
    );
  end if;

  update public.checks
     set status = 'rechazado',
         channel_id = v_channel
   where id = p_check_id;

  insert into public.check_movements (
    check_id, event, event_date, destination_account_id, notes, created_by
  ) values (
    p_check_id, 'rejected', p_event_date, p_account_id,
    nullif(trim(p_notes), ''), auth.uid()
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

revoke all on function public.reject_check(uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.reject_check(uuid, uuid, date, text, text) to authenticated, service_role;

-- 6. Check journals -----------------------------------------------------------

-- Body of 20260517700000_post_audit_money_safety.sql plus: no entry on an internal
-- channel, nor for a check cancelled by its payment order's cancellation (the
-- payment order's reversal already reverses it); the entry carries the channel.
create or replace function public.emit_journal_for_issued_check_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_role public.coa_system_role;
  v_lines     jsonb;
  v_desc      text;
  v_amount    numeric;
  v_period    text;
begin
  -- Solo procesamos transiciones desde emitted.
  if old.status <> 'emitted' then
    return new;
  end if;
  if new.status not in ('cashed', 'rejected', 'cancelled') then
    return new;
  end if;

  if new.channel_id is not null and not public.is_channel_fiscal(new.channel_id) then
    return new;
  end if;

  if new.status = 'cancelled' and exists (
    select 1 from public.payment_orders po
     where po.id = new.payment_order_id and po.status = 'canceled'
  ) then
    return new;
  end if;

  -- Cuenta bancaria mapeada
  v_bank_role := public.coa_role_for_account(new.bank_account_id);
  if v_bank_role is null then
    raise warning 'emit_journal_for_issued_check: bank_account % sin COA role', new.bank_account_id;
    return new;
  end if;

  v_amount := new.amount;
  v_period := to_char(coalesce(new.cashed_at, now())::date, 'YYYY-MM');

  if new.status = 'cashed' then
    v_desc := 'Cobro cheque propio #' || new.check_number || ' ' || new.bank_name;
    v_lines := jsonb_build_array(
      jsonb_build_object('system_role', 'cheques_diferidos_emitidos', 'debit', v_amount, 'description', v_desc || ' — revierte pasivo'),
      jsonb_build_object('system_role', v_bank_role::text,            'credit', v_amount, 'description', v_desc || ' — egreso banco')
    );
  else
    -- rejected / cancelled: la obligación con el proveedor vuelve a aparecer.
    v_desc := case new.status
      when 'rejected'  then 'Rechazo cheque propio #'
      when 'cancelled' then 'Anulación cheque propio #'
    end || new.check_number || ' ' || new.bank_name;
    v_lines := jsonb_build_array(
      jsonb_build_object('system_role', 'cheques_diferidos_emitidos', 'debit',  v_amount, 'description', v_desc || ' — revierte pasivo'),
      jsonb_build_object('system_role', 'proveedores',                'credit', v_amount, 'description', v_desc || ' — deuda vuelve a aparecer')
    );
  end if;

  begin
    perform public.create_journal_entry(
      p_entry_date     := coalesce(new.cashed_at, now())::date,
      p_accrual_period := v_period,
      p_description    := v_desc,
      p_lines          := v_lines,
      p_source_table   := 'issued_checks',
      p_source_id      := new.id,
      p_channel_id     := new.channel_id
    );
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_issued_check: % (issued_check=%)', sqlerrm, new.id;
  end;

  return new;
end;
$$;

revoke all on function public.emit_journal_for_issued_check_transition() from public, anon, authenticated;
grant execute on function public.emit_journal_for_issued_check_transition() to service_role;

-- Body of 20260517810000_post_audit_round2_bloqueantes.sql plus: the payment order is
-- the latest one not cancelled, no entry when it is internal, and the entry
-- carries its channel.
create or replace function public.emit_journal_for_endorsed_check_rejected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_id      uuid;
  v_po_channel text;
  v_amount     numeric;
  v_desc       text;
begin
  if old.status <> 'endosado' or new.status <> 'rechazado' then
    return new;
  end if;

  select pl.payment_order_id, po.channel_id, pl.amount
    into v_po_id, v_po_channel, v_amount
    from public.payment_order_payment_lines pl
    join public.payment_orders po on po.id = pl.payment_order_id
   where pl.endorsed_check_id = new.id
     and po.status <> 'canceled'
   order by po.created_at desc, po.id desc
   limit 1;

  if v_po_id is null then
    raise warning 'Cheque endosado % rechazado sin OP asociada — no se emite reversal', new.id;
    return new;
  end if;

  if not public.is_channel_fiscal(v_po_channel) then
    return new;
  end if;

  v_desc := 'Rechazo cheque endosado #' || new.check_number || ' ' || new.bank_name;

  begin
    perform public.create_journal_entry(
      p_entry_date     := current_date,
      p_accrual_period := to_char(current_date, 'YYYY-MM'),
      p_description    := v_desc,
      p_lines          := jsonb_build_array(
        jsonb_build_object('system_role', 'cheques_cartera', 'debit',  v_amount, 'description', v_desc || ' — revierte salida'),
        jsonb_build_object('system_role', 'proveedores',     'credit', v_amount, 'description', v_desc || ' — deuda vuelve')
      ),
      p_source_table   := 'checks',
      p_source_id      := new.id,
      p_channel_id     := v_po_channel
    );
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_endorsed_check_rejected: % (check=%)', sqlerrm, new.id;
  end;

  return new;
end;
$$;

revoke all on function public.emit_journal_for_endorsed_check_rejected() from public, anon, authenticated;
grant execute on function public.emit_journal_for_endorsed_check_rejected() to service_role;

-- 7. Diagnostic of the C3 entries ---------------------------------------------
-- Receipt checks deposited, or endorsed in a live payment order, on a channel
-- other than their receipt's, with the journal entry that movement posted.
-- Read-only; the owner runs it from the SQL editor:
--   select * from public.checks_channel_mismatches();

create or replace function public.checks_channel_mismatches()
returns table (
  check_id            uuid,
  check_number        text,
  movement            text,
  receipt_channel_id  text,
  movement_channel_id text,
  document_id         uuid,
  journal_entry_id    uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.check_number, 'deposit', r.channel_id, t.channel_id, t.id, je.id
    from public.checks c
    join public.receipts r on r.id = c.source_receipt_id
    join public.check_movements m on m.check_id = c.id and m.event = 'deposited'
    join public.transactions t on t.id = m.transaction_id
    left join public.journal_entries je
      on je.source_table = 'transactions' and je.source_id = t.transfer_pair_id
   where t.channel_id is distinct from r.channel_id
  union all
  select c.id, c.check_number, 'endorsement', r.channel_id, po.channel_id, po.id, je.id
    from public.checks c
    join public.receipts r on r.id = c.source_receipt_id
    join public.payment_order_payment_lines pl on pl.endorsed_check_id = c.id
    join public.payment_orders po on po.id = pl.payment_order_id and po.status <> 'canceled'
    left join public.journal_entries je
      on je.source_table = 'payment_orders' and je.source_id = po.id and not je.is_reversal
   where po.channel_id is distinct from r.channel_id
$$;

revoke all on function public.checks_channel_mismatches() from public, anon, authenticated;
grant execute on function public.checks_channel_mismatches() to service_role;
