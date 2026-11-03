SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- AI CFO follow-up: recategorize an expense. One write that changes the
-- expense account (rubro) and/or the cost center of a cost already loaded:
-- a manual expense (transactions.expense_account_id / cost_center_id) or a
-- purchase (purchase_invoices.account_id / cost_center_id). The UI's
-- "Recategorizar" and the assistant's proposeRecategorizeExpense both call it
-- through lib/commands/recategorize-expense.ts.
--
--   recategorize_expense(p_source, p_id, p_set_account, p_set_cost_center,
--                        p_expense_account_id, p_cost_center_id)
--
-- p_set_* say which of the two changes (the other one keeps its value); a
-- null account means the default (gastos / compras), a null center none.
-- Refused (hint jouve_guard): an unknown source or record; nothing to change;
-- a movement that is not an expense or that a document owns
-- (transaction_is_loose: payment order, payroll, loan, check, tax document,
-- employee account…), which is recategorized from that document; an annulled
-- purchase; a new account on a purchase charged to an employee (its neto
-- posts to the employee, not to an expense account); an account that is not
-- a postable expense leaf; an inactive cost center; and a record dated,
-- accrued or posted in a closed accounting period, on either channel. The
-- reconciliation lock (guard_transaction_reconciled) does not cover these
-- columns, so a reconciled expense can be recategorized. The row is locked
-- FOR UPDATE; the existing repost triggers (transactions_repost_journal,
-- purchase_invoices_repost_journal) re-post the entry at commit. Returns the
-- values before and after, and whether anything changed (the same values
-- again change nothing).
--
-- Rollback: older code never calls the function; dropping it is safe.

create function public.recategorize_expense(
  p_source             text,
  p_id                 uuid,
  p_set_account        boolean,
  p_set_cost_center    boolean,
  p_expense_account_id uuid default null,
  p_cost_center_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx             public.transactions;
  v_pi             public.purchase_invoices;
  v_account_before uuid;
  v_cc_before      uuid;
  v_account        uuid;
  v_cc             uuid;
  v_periods        text[];
  v_closed         text;
begin
  -- Role guard (transactions:write and purchase_invoices:write holders in
  -- lib/auth/permissions.ts); the app calls it with the service role.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and not public.user_has_role(array['owner', 'admin', 'finance']) then
    raise exception 'No autorizado para recategorizar gastos'
      using errcode = '42501';
  end if;

  if p_source is null or p_source not in ('transactions', 'purchase_invoices') then
    raise exception 'Origen inválido: %', p_source
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if not coalesce(p_set_account, false) and not coalesce(p_set_cost_center, false) then
    raise exception 'Indicá la cuenta de gasto o el centro de costo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  if p_source = 'transactions' then
    select * into v_tx from public.transactions where id = p_id for update;
    if v_tx.id is null then
      raise exception 'No se encontró el movimiento'
        using errcode = 'P0002', hint = 'jouve_guard';
    end if;
    if v_tx.kind <> 'expense' then
      raise exception 'Solo se recategoriza un egreso'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if not public.transaction_is_loose(v_tx) then
      raise exception 'El egreso lo generó un documento (orden de pago, sueldo, préstamo, cheque, impuesto…): recategorizá el documento de origen'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    v_account_before := v_tx.expense_account_id;
    v_cc_before := v_tx.cost_center_id;
    v_periods := array[to_char(v_tx.transaction_date, 'YYYY-MM'),
                       to_char(v_tx.accrual_month, 'YYYY-MM')];
  else
    select * into v_pi from public.purchase_invoices where id = p_id for update;
    if v_pi.id is null then
      raise exception 'No se encontró la compra'
        using errcode = 'P0002', hint = 'jouve_guard';
    end if;
    if v_pi.status <> 'received' then
      raise exception 'La compra está anulada: no se recategoriza'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    v_account_before := v_pi.account_id;
    v_cc_before := v_pi.cost_center_id;
    v_periods := array[to_char(v_pi.fecha, 'YYYY-MM')];
  end if;

  v_account := case when p_set_account then p_expense_account_id else v_account_before end;
  v_cc := case when p_set_cost_center then p_cost_center_id else v_cc_before end;

  if v_account is not distinct from v_account_before and v_cc is not distinct from v_cc_before then
    return jsonb_build_object(
      'source', p_source, 'id', p_id, 'changed', false,
      'expense_account_id_before', v_account_before, 'expense_account_id', v_account,
      'cost_center_id_before', v_cc_before, 'cost_center_id', v_cc);
  end if;

  if v_account is distinct from v_account_before then
    if p_source = 'purchase_invoices' and v_pi.charged_employee_id is not null then
      raise exception 'La compra está a cargo de un empleado: su neto va a la cuenta del empleado, no a una cuenta de gasto'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
    if v_account is not null and not public.is_postable_expense_account(v_account) then
      raise exception 'La cuenta de gasto debe ser una cuenta hoja de resultado (sin subcuentas) y activa'
        using errcode = '23514', hint = 'jouve_guard';
    end if;
  end if;
  if v_cc is distinct from v_cc_before
     and v_cc is not null
     and not exists (select 1 from public.cost_centers where id = v_cc and is_active) then
    raise exception 'El centro de costo no existe o está inactivo'
      using errcode = '23514', hint = 'jouve_guard';
  end if;

  -- The record's own periods and those of its live entries: the re-post
  -- deletes the entry and emits it again.
  select cp.period into v_closed
    from public.accounting_closed_periods cp
   where cp.period = any (v_periods)
      or cp.period in (select je.accrual_period from public.journal_entries je
                        where je.source_table = p_source and je.source_id = p_id)
   order by cp.period
   limit 1;
  if v_closed is not null then
    raise exception 'El período contable % está cerrado: pedí que lo reabran en Contabilidad para recategorizar', v_closed
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  if p_source = 'transactions' then
    update public.transactions
       set expense_account_id = v_account,
           cost_center_id = v_cc
     where id = p_id;
  else
    update public.purchase_invoices
       set account_id = v_account,
           cost_center_id = v_cc
     where id = p_id;
  end if;

  return jsonb_build_object(
    'source', p_source, 'id', p_id, 'changed', true,
    'expense_account_id_before', v_account_before, 'expense_account_id', v_account,
    'cost_center_id_before', v_cc_before, 'cost_center_id', v_cc);
end;
$$;

comment on function public.recategorize_expense(text, uuid, boolean, boolean, uuid, uuid) is
  'Cambia la cuenta de gasto y/o el centro de costo de un egreso manual o de una compra (no anulada, no de un documento, fuera de un período cerrado) y re-asienta. Devuelve antes y después.';

revoke all on function public.recategorize_expense(text, uuid, boolean, boolean, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.recategorize_expense(text, uuid, boolean, boolean, uuid, uuid)
  to service_role;
