SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Recategorizar un gasto: the NC/ND of a purchase follow it. Same signature;
-- the rest is the definition of 20261104060000.
--
-- An NC/ND takes its purchase's account and center only when it is loaded
-- (purchase_nc_nd_inherit_account). Recategorizing the factura alone left
-- its NC in the old rubro or center: a factura of 1000 with an NC of 200
-- moved to "mantenimiento" showed -1000 there and +200 in the old rubro
-- (the total right, the split wrong, the truck margin too).
--
-- Decision: propagate, not warn. An NC/ND adjusts the same cost, so it
-- belongs where its purchase is. recategorize_expense now applies the same
-- change to the purchase's live NC/ND (status received) that still carry the
-- value being replaced, field by field: one with its own account or center
-- keeps it, and an employee-charged one keeps its account. The NC/ND are
-- locked, and a closed period of any of them (its date or a live entry)
-- refuses the whole change, as for the purchase. The answer lists them
-- under "adjustments"; the command audits them.
--
-- Rollback: older code ignores the new key; the function keeps its
-- signature.

-- Same as 20261104060000 plus the NC/ND that follow their purchase.
create or replace function public.recategorize_expense(
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
  v_linked         uuid[] := '{}';
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

  -- A purchase's live NC/ND that still carry the value being replaced
  -- follow it: they adjust the same cost, so they belong to the same rubro
  -- and center. One with its own value keeps it, and an employee-charged
  -- one keeps its account (its neto posts to the employee).
  if p_source = 'purchase_invoices' then
    select coalesce(array_agg(n.id order by n.id), '{}') into v_linked
      from public.purchase_invoices n
     where n.invoice_origin_id = p_id
       and n.kind in ('nc', 'nd')
       and n.status = 'received'
       and ((v_account is distinct from v_account_before
             and n.account_id is not distinct from v_account_before
             and n.charged_employee_id is null)
         or (v_cc is distinct from v_cc_before
             and n.cost_center_id is not distinct from v_cc_before));
    perform 1 from public.purchase_invoices where id = any (v_linked) for update;
    v_periods := v_periods || array(
      select to_char(n.fecha, 'YYYY-MM') from public.purchase_invoices n where n.id = any (v_linked));
  end if;

  -- The records' own periods and those of their live entries: the re-post
  -- deletes the entry and emits it again.
  select cp.period into v_closed
    from public.accounting_closed_periods cp
   where cp.period = any (v_periods)
      or cp.period in (select je.accrual_period from public.journal_entries je
                        where je.source_table = p_source
                          and (je.source_id = p_id or je.source_id = any (v_linked)))
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
    update public.purchase_invoices n
       set account_id = case
             when n.account_id is not distinct from v_account_before and n.charged_employee_id is null
               then v_account else n.account_id end,
           cost_center_id = case
             when n.cost_center_id is not distinct from v_cc_before then v_cc else n.cost_center_id end
     where n.id = any (v_linked);
  end if;

  return jsonb_build_object(
    'source', p_source, 'id', p_id, 'changed', true,
    'expense_account_id_before', v_account_before, 'expense_account_id', v_account,
    'cost_center_id_before', v_cc_before, 'cost_center_id', v_cc,
    'adjustments', to_jsonb(v_linked));
end;
$$;

comment on function public.recategorize_expense(text, uuid, boolean, boolean, uuid, uuid) is
  'Cambia la cuenta de gasto y/o el centro de costo de un egreso manual o de una compra (no anulada, no de un documento, fuera de un período cerrado) y re-asienta. En una compra, sus NC/ND vigentes que tenían el valor anterior lo siguen. Devuelve antes y después y las NC/ND que cambiaron.';

revoke all on function public.recategorize_expense(text, uuid, boolean, boolean, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.recategorize_expense(text, uuid, boolean, boolean, uuid, uuid)
  to service_role;
