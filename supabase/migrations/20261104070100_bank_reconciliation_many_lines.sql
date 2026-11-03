SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Conciliación: several statement lines against one movement (the bank splits
-- a deposit or a transfer in two). Until now a line matched one or more
-- movements and a movement one line at most.
--
-- 1. bank_statement_matches: a movement may now be matched with several
--    lines, each one matched with that movement alone. The unique key is the
--    pair (line, movement) instead of the movement; an index keeps the guards'
--    lookup by movement. guard_bank_statement_match keeps every reconciliation
--    a star: one line with its movements, or one movement with its lines,
--    never several of each (whose sums could not be told apart).
-- 2. match_bank_statement_lines(lines, movement): several open lines of one
--    account against a free movement of it, when the lines' amounts add up
--    to the movement's signed amount. Repeating a match already in place is a
--    no-op, as match_bank_statement_line now does too.
-- 3. unmatch_bank_statement_line unmatches the whole reconciliation the line
--    belongs to: the line's movements and every line matched with them back
--    to pending, so no line is left reconciled against part of a movement.
-- 4. guard_transaction_reconciled names Tesorería › Conciliación in its
--    messages, so Caja (and any document editing a reconciled movement)
--    tells the user where to unmatch it.
--
-- Rollback: older code calls the same RPCs (match and unmatch keep their
-- signatures) and lists a movement's line by one of its lines; the guard
-- and the sums stay in the database.
--
-- RLS: unchanged (bank_statement_matches is read by owner/admin/finance and
-- written only through the RPCs).

------------------------------------------------------------------------------
-- 1. Matches: (line, movement) unique
------------------------------------------------------------------------------

-- The table is written only by the reconciliation RPCs and holds a handful of
-- rows per statement: building the index under the lock is short.
-- squawk-ignore require-concurrent-index-creation
create unique index bank_statement_matches_line_transaction_key
  on public.bank_statement_matches (line_id, transaction_id);

-- squawk-ignore require-concurrent-index-creation
create index bank_statement_matches_transaction_idx
  on public.bank_statement_matches (transaction_id);

-- On purpose: a movement now takes several lines. The guarantee older code
-- relied on (a movement is matched once) is kept per movement by
-- guard_bank_statement_match and the RPCs, which refuse a second
-- reconciliation of a matched movement.
alter table public.bank_statement_matches
  -- squawk-ignore ban-drop-constraint
  drop constraint bank_statement_matches_transaction_key;

comment on table public.bank_statement_matches is
  'Conciliación: la línea del extracto y los movimientos de su cuenta que la explican (uno o varios, sumando su importe), o varias líneas contra un movimiento (sumando el suyo). Nunca varias de cada lado. Mientras esté conciliado, el movimiento no se edita ni se borra.';

-- A reconciliation is a star: inserting (line, movement) is refused when the
-- line already has another movement and the movement another line, or when
-- the movement's other lines (or the line's other movements) are part of
-- another reconciliation. Rows of one INSERT are checked one by one, each
-- seeing the earlier ones.
create function public.guard_bank_statement_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line_has_other boolean;
  v_tx_has_other   boolean;
begin
  v_line_has_other := exists (
    select 1 from public.bank_statement_matches m
     where m.line_id = new.line_id and m.transaction_id <> new.transaction_id
  );
  v_tx_has_other := exists (
    select 1 from public.bank_statement_matches m
     where m.transaction_id = new.transaction_id and m.line_id <> new.line_id
  );

  if (v_line_has_other and v_tx_has_other)
     or (v_tx_has_other and exists (
           select 1
             from public.bank_statement_matches m
             join public.bank_statement_matches o
               on o.line_id = m.line_id and o.transaction_id <> m.transaction_id
            where m.transaction_id = new.transaction_id))
     or (v_line_has_other and exists (
           select 1
             from public.bank_statement_matches m
             join public.bank_statement_matches o
               on o.transaction_id = m.transaction_id and o.line_id <> m.line_id
            where m.line_id = new.line_id)) then
    raise exception 'Una conciliación es una línea con sus movimientos o un movimiento con sus líneas, no varias de cada lado'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_bank_statement_match() from public, anon, authenticated;

create trigger bank_statement_matches_guard
  before insert on public.bank_statement_matches
  for each row execute function public.guard_bank_statement_match();

------------------------------------------------------------------------------
-- 2. One line, several movements (same as 20261103140000, idempotent)
------------------------------------------------------------------------------

-- Same as 20261103140000, plus: a line already matched with exactly these
-- movements (a retry) returns without changing anything.
create or replace function public.match_bank_statement_line(
  p_line_id         uuid,
  p_transaction_ids uuid[],
  p_user_id         uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line  public.bank_statement_lines%rowtype;
  v_ids   uuid[];
  v_found integer;
  v_sum   numeric(18, 2);
begin
  v_ids := array(select distinct x from unnest(coalesce(p_transaction_ids, '{}')) as x where x is not null);
  if cardinality(v_ids) = 0 then
    raise exception 'Elegí al menos un movimiento para conciliar'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'Una línea se concilia con hasta 100 movimientos'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  select * into v_line from public.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'La línea del extracto no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_line.status = 'matched'
     and not exists (
       select 1 from public.bank_statement_matches m
        where m.line_id = p_line_id and m.transaction_id <> all (v_ids))
     and (select count(*) from public.bank_statement_matches m
           where m.line_id = p_line_id) = cardinality(v_ids) then
    return;
  end if;
  if v_line.status <> 'open' then
    raise exception 'La línea ya está conciliada o marcada como que no corresponde'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  perform 1 from public.transactions t where t.id = any (v_ids) order by t.id for update;

  select count(*),
         coalesce(sum(case when t.kind in ('income', 'transfer_in') then t.amount else -t.amount end), 0)
    into v_found, v_sum
    from public.transactions t
   where t.id = any (v_ids)
     and t.account_id = v_line.account_id;

  if v_found <> cardinality(v_ids) then
    raise exception 'Algún movimiento no existe o no es de la cuenta del extracto'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  if exists (select 1 from public.bank_statement_matches m where m.transaction_id = any (v_ids)) then
    raise exception 'Algún movimiento ya está conciliado con otra línea del extracto'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if v_sum <> v_line.amount then
    raise exception 'Los movimientos suman % y la línea %: tienen que coincidir',
        to_char(v_sum, 'FM999G999G999G990D00'), to_char(v_line.amount, 'FM999G999G999G990D00')
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  insert into public.bank_statement_matches (line_id, transaction_id, matched_by)
  select p_line_id, x, p_user_id from unnest(v_ids) as x;

  update public.bank_statement_lines
     set status = 'matched', status_changed_by = p_user_id, status_changed_at = now()
   where id = p_line_id;
end;
$$;

comment on function public.match_bank_statement_line(uuid, uuid[], uuid) is
  'Concilia una línea pendiente del extracto con movimientos de su cuenta que suman su importe. Repetir la misma conciliación no cambia nada. Solo service role (la acción exige transactions:write).';

revoke all on function public.match_bank_statement_line(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.match_bank_statement_line(uuid, uuid[], uuid) to service_role;

------------------------------------------------------------------------------
-- 3. Several lines, one movement
------------------------------------------------------------------------------

-- Reconciles open lines of one account with a free movement of it whose
-- signed amount (income and transfer in add, expense and transfer out
-- subtract) equals the lines' sum. The same lines already matched with that
-- movement alone (a retry) return without changing anything.
create function public.match_bank_statement_lines(
  p_line_ids       uuid[],
  p_transaction_id uuid,
  p_user_id        uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids      uuid[];
  v_found    integer;
  v_accounts integer;
  v_account  uuid;
  v_open     integer;
  v_sum      numeric(18, 2);
  v_tx       public.transactions%rowtype;
  v_signed   numeric(18, 2);
begin
  v_ids := array(select distinct x from unnest(coalesce(p_line_ids, '{}')) as x where x is not null);
  if cardinality(v_ids) = 0 then
    raise exception 'Elegí al menos una línea para conciliar'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'Un movimiento se concilia con hasta 100 líneas'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  perform 1 from public.bank_statement_lines l where l.id = any (v_ids) order by l.id for update;

  select count(*), count(distinct l.account_id), min(l.account_id::text)::uuid,
         count(*) filter (where l.status = 'open'), coalesce(sum(l.amount), 0)
    into v_found, v_accounts, v_account, v_open, v_sum
    from public.bank_statement_lines l
   where l.id = any (v_ids);

  if v_found <> cardinality(v_ids) then
    raise exception 'Alguna línea del extracto no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_accounts <> 1 then
    raise exception 'Las líneas tienen que ser del extracto de una misma cuenta'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  select * into v_tx from public.transactions where id = p_transaction_id for update;
  if not found or v_tx.account_id <> v_account then
    raise exception 'El movimiento no existe o no es de la cuenta del extracto'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- A retry: exactly these lines, each matched with this movement alone.
  if v_open = 0
     and not exists (
       select 1 from public.bank_statement_matches m
        where m.transaction_id = p_transaction_id and m.line_id <> all (v_ids))
     and (select count(*) from public.bank_statement_matches m
           where m.line_id = any (v_ids) and m.transaction_id = p_transaction_id) = cardinality(v_ids)
     and not exists (
       select 1 from public.bank_statement_matches m
        where m.line_id = any (v_ids) and m.transaction_id <> p_transaction_id) then
    return;
  end if;

  if v_open <> cardinality(v_ids) then
    raise exception 'Alguna línea ya está conciliada o marcada como que no corresponde'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if exists (select 1 from public.bank_statement_matches m where m.transaction_id = p_transaction_id) then
    raise exception 'El movimiento ya está conciliado con otra línea del extracto'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  v_signed := case when v_tx.kind in ('income', 'transfer_in') then v_tx.amount else -v_tx.amount end;
  if v_sum <> v_signed then
    raise exception 'Las líneas suman % y el movimiento %: tienen que coincidir',
        to_char(v_sum, 'FM999G999G999G990D00'), to_char(v_signed, 'FM999G999G999G990D00')
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  insert into public.bank_statement_matches (line_id, transaction_id, matched_by)
  select x, p_transaction_id, p_user_id from unnest(v_ids) as x;

  update public.bank_statement_lines
     set status = 'matched', status_changed_by = p_user_id, status_changed_at = now()
   where id = any (v_ids);
end;
$$;

comment on function public.match_bank_statement_lines(uuid[], uuid, uuid) is
  'Concilia varias líneas pendientes del extracto de una cuenta con un movimiento libre de esa cuenta cuando las líneas suman su importe. Repetir la misma conciliación no cambia nada. Solo service role (la acción exige transactions:write).';

revoke all on function public.match_bank_statement_lines(uuid[], uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_bank_statement_lines(uuid[], uuid, uuid) to service_role;

------------------------------------------------------------------------------
-- 4. Unmatch the whole reconciliation
------------------------------------------------------------------------------

-- Same as 20261103140000, but the line's whole reconciliation goes back to
-- pending: its movements and, for a movement matched with several lines,
-- each of those lines. Idempotent.
create or replace function public.unmatch_bank_statement_line(p_line_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_lines  uuid[];
begin
  if not exists (select 1 from public.bank_statement_lines where id = p_line_id) then
    raise exception 'La línea del extracto no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  -- Every line of the reconciliation, locked in one order so two unmatches
  -- of the same reconciliation queue instead of deadlocking.
  v_lines := array(
    select distinct o.line_id
      from public.bank_statement_matches m
      join public.bank_statement_matches o on o.transaction_id = m.transaction_id
     where m.line_id = p_line_id
  ) || p_line_id;
  perform 1 from public.bank_statement_lines l where l.id = any (v_lines) order by l.id for update;

  select status into v_status from public.bank_statement_lines where id = p_line_id;
  if v_status = 'open' then
    return;
  end if;
  if v_status <> 'matched' then
    raise exception 'La línea no está conciliada'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  -- Read again under the locks: a match made since the first read is the
  -- one this unmatch undoes.
  v_lines := array(
    select distinct o.line_id
      from public.bank_statement_matches m
      join public.bank_statement_matches o on o.transaction_id = m.transaction_id
     where m.line_id = p_line_id
  ) || p_line_id;

  delete from public.bank_statement_matches where line_id = any (v_lines);

  update public.bank_statement_lines
     set status = 'open', status_changed_by = p_user_id, status_changed_at = now()
   where id = any (v_lines) and status = 'matched';
end;
$$;

comment on function public.unmatch_bank_statement_line(uuid, uuid) is
  'Desconcilia una línea del extracto y el resto de su conciliación (las otras líneas de su movimiento): vuelven a pendiente y sus movimientos se pueden editar. Idempotente. Solo service role.';

revoke all on function public.unmatch_bank_statement_line(uuid, uuid) from public, anon, authenticated;
grant execute on function public.unmatch_bank_statement_line(uuid, uuid) to service_role;

------------------------------------------------------------------------------
-- 5. A reconciled movement says where to unmatch it
------------------------------------------------------------------------------

-- Same as 20261103140000; only the messages change: they name the screen
-- where the line is unmatched (Caja and every document that edits a movement
-- show them through mapDbGuardError).
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
    raise exception 'El movimiento está conciliado con el extracto bancario: desconciliá su línea en Tesorería › Conciliación antes de borrarlo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.amount           is distinct from old.amount
     or new.transaction_date is distinct from old.transaction_date
     or new.accrual_month    is distinct from old.accrual_month
     or new.account_id       is distinct from old.account_id
     or new.kind             is distinct from old.kind
     or new.currency         is distinct from old.currency
     or new.channel_id       is distinct from old.channel_id
     or new.transfer_pair_id is distinct from old.transfer_pair_id then
    raise exception 'El movimiento está conciliado con el extracto bancario: desconciliá su línea en Tesorería › Conciliación antes de cambiar monto, fecha, cuenta, tipo, moneda o canal'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_transaction_reconciled() from public, anon, authenticated;
