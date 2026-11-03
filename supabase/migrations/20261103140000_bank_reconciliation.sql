SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Extractos bancarios y conciliación (roadmap 5.4). Expand-only: two new
-- tables, one trigger on transactions and four RPCs.
--
-- 1. bank_statement_lines: one line of a bank statement of one treasury
--    account, loaded by the importer (kind bank_statement, next migration):
--    date, description, signed amount (+ credit, - debit), the bank's balance
--    and reference when the file has them. source_hash (the line's content
--    and its repetition in the file, features/imports/lib/rows.ts) is unique
--    per account, so importing an overlapping statement adds nothing twice.
--    status: open (pending), matched (reconciled) or ignored ("no
--    corresponde", with its reason). The line itself never changes; only the
--    importer's undo deletes it, and only while it is open.
-- 2. bank_statement_matches: a line reconciled against one or more
--    transactions of the same account whose signed amounts add up to the
--    line's (one line to many movements). A transaction is reconciled with
--    one line at most.
-- 3. guard_transaction_reconciled: a reconciled transaction cannot be
--    deleted, nor its amount, date, accrual month, account, kind, currency,
--    channel or transfer pair changed, until its line is unmatched. No stack
--    bypass: a receipt or payment order edit that would move a reconciled
--    movement is refused as well.
-- 4. match_bank_statement_line, unmatch_bank_statement_line,
--    set_bank_statement_line_ignored and
--    create_bank_statement_line_transaction (service role; the actions gate
--    on transactions:write). The last one inserts a manual income or expense
--    for a line the books lack (a bank fee, interest) the same way the manual
--    form does, so the journal posts it, and reconciles it in the same
--    transaction.
--
-- Rollback: older code never reads the new tables. The trigger keeps
-- refusing edits of reconciled movements from older code, with its message.
--
-- RLS: like transactions (owner/admin/finance read); writes only through the
-- RPCs.

------------------------------------------------------------------------------
-- 1. bank_statement_lines
------------------------------------------------------------------------------

create table public.bank_statement_lines (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id) on delete restrict,
  import_run_id     uuid not null references public.import_runs (id) on delete restrict,
  line_date         date not null,
  description       text not null check (char_length(description) between 1 and 500),
  amount            numeric(18, 2) not null check (amount <> 0),
  balance           numeric(18, 2),
  reference         text check (reference is null or char_length(reference) <= 120),
  source_hash       text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  -- The line's row in the file (a statement has up to 5000 lines): orders
  -- the lines of one day as the bank listed them.
  -- squawk-ignore prefer-bigint-over-int
  line_no           integer not null check (line_no > 0),
  status            text not null default 'open'
                      check (status in ('open', 'matched', 'ignored')),
  ignore_reason     text check (ignore_reason is null or char_length(ignore_reason) between 1 and 500),
  status_changed_by uuid references auth.users (id) on delete set null,
  status_changed_at timestamptz,
  created_at        timestamptz not null default now(),
  constraint bank_statement_lines_account_hash_key unique (account_id, source_hash),
  constraint bank_statement_lines_ignore_reason
    check ((status = 'ignored') = (ignore_reason is not null))
);

comment on table public.bank_statement_lines is
  'Línea de un extracto bancario de una cuenta de tesorería, importada: fecha, descripción, importe con signo (+ crédito, - débito), saldo y referencia del banco. Estado: pendiente, conciliada (bank_statement_matches) o no corresponde (con motivo). No se edita; deshacer la importación la borra mientras esté pendiente.';
comment on column public.bank_statement_lines.amount is
  'Importe con signo: positivo = crédito (entra a la cuenta), negativo = débito (sale).';
comment on column public.bank_statement_lines.source_hash is
  'SHA-256 del contenido de la línea y su repetición en el archivo: reimportar un extracto superpuesto no la duplica.';

create index bank_statement_lines_account_date_idx
  on public.bank_statement_lines (account_id, line_date);
create index bank_statement_lines_run_idx
  on public.bank_statement_lines (import_run_id);
create index bank_statement_lines_status_changed_by_idx
  on public.bank_statement_lines (status_changed_by)
  where status_changed_by is not null;

------------------------------------------------------------------------------
-- 2. bank_statement_matches
------------------------------------------------------------------------------

create table public.bank_statement_matches (
  id             uuid primary key default gen_random_uuid(),
  line_id        uuid not null references public.bank_statement_lines (id) on delete restrict,
  transaction_id uuid not null references public.transactions (id) on delete restrict,
  matched_by     uuid references auth.users (id) on delete set null,
  matched_at     timestamptz not null default now(),
  constraint bank_statement_matches_transaction_key unique (transaction_id)
);

comment on table public.bank_statement_matches is
  'Conciliación: la línea del extracto y los movimientos de su cuenta que la explican (uno o varios, sumando su importe). Un movimiento se concilia con una sola línea; mientras esté conciliado no se edita ni se borra.';

create index bank_statement_matches_line_idx on public.bank_statement_matches (line_id);
create index bank_statement_matches_matched_by_idx
  on public.bank_statement_matches (matched_by) where matched_by is not null;

-- A line is what the bank said: its data never changes, its status only moves
-- between open and matched or ignored, and it is deleted only by the undo of
-- its import while still open.
create function public.guard_bank_statement_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'DELETE' then
    get diagnostics v_stack = pg_context;
    if v_stack ~ 'function (public\.)?undo_import_run\(' and old.status = 'open' then
      return old;
    end if;
    raise exception 'Una línea de extracto no se borra: deshacé su importación mientras esté pendiente'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.account_id is distinct from old.account_id
     or new.import_run_id is distinct from old.import_run_id
     or new.line_date is distinct from old.line_date
     or new.description is distinct from old.description
     or new.amount is distinct from old.amount
     or new.balance is distinct from old.balance
     or new.reference is distinct from old.reference
     or new.source_hash is distinct from old.source_hash
     or new.line_no is distinct from old.line_no
     or new.created_at is distinct from old.created_at then
    raise exception 'Los datos de una línea de extracto no se cambian: deshacé la importación y volvé a importar el extracto'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'open' or new.status = 'open') then
    raise exception 'La línea tiene que volver a pendiente antes de cambiar de estado'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_bank_statement_line() from public, anon, authenticated;

create trigger bank_statement_lines_guard
  before update or delete on public.bank_statement_lines
  for each row execute function public.guard_bank_statement_line();

alter table public.bank_statement_lines enable row level security;

create policy "Treasury roles view bank statement lines" on public.bank_statement_lines
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'finance'])) );

revoke all on table public.bank_statement_lines from public, anon;

alter table public.bank_statement_matches enable row level security;

create policy "Treasury roles view bank statement matches" on public.bank_statement_matches
  for select to authenticated
  using ( (select public.user_has_role(array['owner', 'admin', 'finance'])) );

revoke all on table public.bank_statement_matches from public, anon;

------------------------------------------------------------------------------
-- 3. A reconciled transaction is locked
------------------------------------------------------------------------------

create function public.guard_transaction_reconciled()
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
    raise exception 'El movimiento está conciliado con el extracto bancario: desconciliá la línea antes de borrarlo'
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
    raise exception 'El movimiento está conciliado con el extracto bancario: desconciliá la línea antes de cambiar monto, fecha, cuenta, tipo, moneda o canal'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_transaction_reconciled() from public, anon, authenticated;

create trigger transactions_guard_reconciled
  before update or delete on public.transactions
  for each row execute function public.guard_transaction_reconciled();

------------------------------------------------------------------------------
-- 4. RPCs
------------------------------------------------------------------------------

-- Reconciles an open line with movements of its account whose signed amounts
-- (income and transfer in add, expense and transfer out subtract) add up to
-- the line's amount exactly.
create function public.match_bank_statement_line(
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
  'Concilia una línea pendiente del extracto con movimientos de su cuenta que suman su importe. Solo service role (la acción exige transactions:write).';

revoke all on function public.match_bank_statement_line(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.match_bank_statement_line(uuid, uuid[], uuid) to service_role;

-- Back to pending: the line's movements are free to edit again. Idempotent.
create function public.unmatch_bank_statement_line(p_line_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.bank_statement_lines%rowtype;
begin
  select * into v_line from public.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'La línea del extracto no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_line.status = 'open' then
    return;
  end if;
  if v_line.status <> 'matched' then
    raise exception 'La línea no está conciliada'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  delete from public.bank_statement_matches where line_id = p_line_id;

  update public.bank_statement_lines
     set status = 'open', status_changed_by = p_user_id, status_changed_at = now()
   where id = p_line_id;
end;
$$;

comment on function public.unmatch_bank_statement_line(uuid, uuid) is
  'Desconcilia una línea del extracto: vuelve a pendiente y sus movimientos se pueden editar. Idempotente. Solo service role.';

revoke all on function public.unmatch_bank_statement_line(uuid, uuid) from public, anon, authenticated;
grant execute on function public.unmatch_bank_statement_line(uuid, uuid) to service_role;

-- A reason marks an open line "no corresponde"; null puts an ignored line
-- back to pending.
create function public.set_bank_statement_line_ignored(
  p_line_id uuid,
  p_reason  text,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line   public.bank_statement_lines%rowtype;
  v_reason text := nullif(trim(p_reason), '');
begin
  select * into v_line from public.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'La línea del extracto no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;

  if v_reason is null then
    if v_line.status = 'open' then
      return;
    end if;
    if v_line.status <> 'ignored' then
      raise exception 'La línea está conciliada: desconciliala primero'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    update public.bank_statement_lines
       set status = 'open', ignore_reason = null,
           status_changed_by = p_user_id, status_changed_at = now()
     where id = p_line_id;
    return;
  end if;

  if char_length(v_reason) > 500 then
    raise exception 'El motivo lleva hasta 500 caracteres'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if v_line.status <> 'open' then
    raise exception 'Solo una línea pendiente se marca como que no corresponde'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  update public.bank_statement_lines
     set status = 'ignored', ignore_reason = v_reason,
         status_changed_by = p_user_id, status_changed_at = now()
   where id = p_line_id;
end;
$$;

comment on function public.set_bank_statement_line_ignored(uuid, text, uuid) is
  'Marca una línea pendiente como que no corresponde (con motivo) o, con motivo vacío, la vuelve a pendiente. Solo service role.';

revoke all on function public.set_bank_statement_line_ignored(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.set_bank_statement_line_ignored(uuid, text, uuid) to service_role;

-- The movement the books lack, as the manual form inserts it (income for a
-- credit; expense for a debit, which takes its expense account), dated on the
-- line, then reconciled with it. The journal posts it on insert; the period,
-- channel, currency and expense-account guards apply as for any movement.
create function public.create_bank_statement_line_transaction(
  p_line_id            uuid,
  p_channel_id         text,
  p_user_id            uuid,
  p_expense_account_id uuid default null,
  p_cost_center_id     uuid default null,
  p_description        text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line     public.bank_statement_lines%rowtype;
  v_type     text;
  v_currency text;
  v_tx       uuid;
begin
  select * into v_line from public.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'La línea del extracto no existe'
      using errcode = 'P0002', hint = 'jouve_guard';
  end if;
  if v_line.status <> 'open' then
    raise exception 'La línea ya está conciliada o marcada como que no corresponde'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  select a.type, a.currency into v_type, v_currency
    from public.accounts a where a.id = v_line.account_id;
  if v_type in ('checks', 'echeq') then
    raise exception 'Los movimientos de una cuenta de cheques se cargan desde Cheques'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if v_line.amount < 0 and p_expense_account_id is null then
    raise exception 'Elegí la cuenta de gasto del débito'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if v_line.amount > 0 and (p_expense_account_id is not null or p_cost_center_id is not null) then
    raise exception 'La cuenta de gasto y el centro de costo son solo para débitos'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  insert into public.transactions (
    account_id, channel_id, kind, amount, currency, transaction_date, accrual_month,
    description, expense_account_id, cost_center_id, created_by
  ) values (
    v_line.account_id, p_channel_id,
    case when v_line.amount > 0 then 'income' else 'expense' end,
    abs(v_line.amount), v_currency, v_line.line_date,
    date_trunc('month', v_line.line_date)::date,
    coalesce(nullif(trim(p_description), ''), v_line.description),
    p_expense_account_id, p_cost_center_id, p_user_id
  )
  returning id into v_tx;

  insert into public.bank_statement_matches (line_id, transaction_id, matched_by)
  values (p_line_id, v_tx, p_user_id);

  update public.bank_statement_lines
     set status = 'matched', status_changed_by = p_user_id, status_changed_at = now()
   where id = p_line_id;

  return v_tx;
end;
$$;

comment on function public.create_bank_statement_line_transaction(uuid, text, uuid, uuid, uuid, text) is
  'Crea el movimiento que falta en los libros para una línea pendiente del extracto (ingreso o egreso manual con su cuenta de gasto) y lo concilia. Solo service role (la acción exige transactions:write).';

revoke all on function public.create_bank_statement_line_transaction(uuid, text, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_bank_statement_line_transaction(uuid, text, uuid, uuid, uuid, text)
  to service_role;
