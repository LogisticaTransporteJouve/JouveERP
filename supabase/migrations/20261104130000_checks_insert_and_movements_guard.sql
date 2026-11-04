SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W6 · S4 F3 / S2 F1-F3: a third-party check and its history are
-- written only by the paths that also book their money.
--
-- 1. INSERT on public.checks. RLS lets owner, admin and finance insert checks
--    with any status and source. A row inserted as source_kind 'receipt', or
--    already depositado or vendido, booked no cartera inflow
--    (checks_manual_inflow books only manual checks), so deposit_check then
--    moved money that never came in, and a bounce reopened a debt on a receipt
--    that never collected the check. A direct insert now has to be a manual
--    check en_cartera with no receipt: the shape «Nuevo cheque», the AI scan
--    and commit_import_run write, and the one checks_manual_inflow books.
--    Receipt checks come only from create_receipt / update_receipt,
--    recognised in the call stack (pg_context) as guard_issued_check_edit
--    does for own checks.
-- 2. UPDATE on public.checks also pins source_kind, source_client_id and
--    source_payment_line_id. v_client_account_movements credits (and on a
--    bounce debits) the client by those columns, while the cartera inflow
--    keeps the client of insert time, so a PATCH moved a manual check's
--    payment to another client, or counted a receipt's check twice. No RPC
--    updates them: receipts and the importer only insert.
-- 3. public.check_movements. RLS lets owner, admin and finance insert and the
--    owner delete. reject_check takes a deposited check's outflow account from
--    its latest 'deposited' movement, and cancel_check_sale reads the latest
--    movement, so a forged or deleted row sent a bounce out of another account
--    or blocked a legitimate cancel. Only the check RPCs, the receipt and
--    import RPCs and the cascades of a document (pg_trigger_depth() > 1: an
--    order's or a sale's cancellation, a check's delete) write it now. The one
--    direct write left is the 'received' anchor «Nuevo cheque» inserts right
--    after the check, accepted only as the check's first movement and with no
--    account or transaction.
--
-- The RLS policies are not changed. Existing rows are not touched.
--
-- Rollback: older code inserts checks only in the shapes above, never PATCHes
-- their source columns and writes check_movements only through these RPCs and
-- the 'received' anchor, so it is unaffected.

-- Same as 20261104123001 plus the INSERT branch and the source columns.
create or replace function public.guard_check_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'en_cartera'
       and new.source_kind = 'manual'
       and new.source_receipt_id is null
       and new.source_payment_line_id is null then
      return new;
    end if;
    get diagnostics v_stack = pg_context;
    if v_stack ~ 'function (public\.)?(create_receipt|update_receipt)\(' then
      return new;
    end if;
    raise exception 'Un cheque de terceros entra a la cartera solo desde su recibo o cargándolo a mano: no se puede insertar con otro estado ni ligado a un recibo'
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if new.amount                 is not distinct from old.amount
     and new.currency               is not distinct from old.currency
     and new.cartera_account_id     is not distinct from old.cartera_account_id
     and new.source_kind            is not distinct from old.source_kind
     and new.source_receipt_id      is not distinct from old.source_receipt_id
     and new.source_payment_line_id is not distinct from old.source_payment_line_id
     and new.source_client_id       is not distinct from old.source_client_id
     and new.status                 is not distinct from old.status then
    return new;
  end if;

  get diagnostics v_stack = pg_context;
  if pg_trigger_depth() > 1
     or v_stack ~ 'function (public\.)?(deposit_check|credit_check|reject_check|sell_checks|reject_sold_check_as_debt|create_payment_order|update_payment_order)\(' then
    return new;
  end if;

  raise exception 'El monto, la moneda, la cartera, el origen (recibo o cliente) y el estado de un cheque se cambian solo desde sus acciones (depositar, acreditar, rechazar, vender) o desde la orden de pago que lo endosa'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_check_edit() from public, anon, authenticated;

-- Same name, so it still runs after the channel triggers (checks_channel_*).
drop trigger checks_guard_edit on public.checks;

create trigger checks_guard_edit
  before insert or update on public.checks
  for each row execute function public.guard_check_edit();

create or replace function public.guard_check_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  get diagnostics v_stack = pg_context;
  if v_stack ~ 'function (public\.)?(deposit_check|credit_check|reject_check|sell_checks|reject_sold_check_as_debt|create_payment_order|update_payment_order|create_receipt|update_receipt|commit_import_run|undo_import_run)\(' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT'
     and new.event = 'received'
     and new.destination_account_id is null
     and new.transaction_id is null
     and new.endorsed_to_name is null
     and new.endorsed_to_cuit is null
     and not exists (
       select 1 from public.check_movements m where m.check_id = new.check_id
     ) then
    return new;
  end if;

  raise exception 'El historial de un cheque lo escriben solo sus acciones (depositar, acreditar, rechazar, vender), su recibo o la orden de pago que lo endosa'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_check_movement() from public, anon, authenticated;

create trigger check_movements_guard
  before insert or update or delete on public.check_movements
  for each row execute function public.guard_check_movement();
