SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W11 · S3 F2: changing a factura's account or center in
-- «Modificar» left its NC/ND behind, while «Recategorizar» moves them
-- (20261104092300). A factura of 1000 with an NC of 200 moved from truck A to
-- truck B showed -1000 in B and +200 in A, and a later «Recategorizar» did not
-- repair it, because the NC no longer held the factura's value.
--
-- A trigger after an update of a factura's account_id or cost_center_id
-- applies recategorize_expense's rule to its NC/ND, so every writer (the edit
-- form, a direct PATCH) has the same effect:
--   - only live NC/ND (status received) of the factura that still hold the
--     value being replaced follow it, field by field; one with its own value
--     keeps it, and an employee-charged one keeps its account;
--   - a closed period of any of them (its date or a live entry) refuses the
--     whole edit, with the message recategorize_expense gives.
-- recategorize_expense propagates on its own (and returns and audits the
-- NC/ND it moved), so an update made by it (seen in the call stack,
-- pg_context, as purchase_nc_nd_inherit_account does) is left alone.
--
-- SECURITY DEFINER so the closed-period read sees every entry whatever the
-- caller may read; it only runs after the caller's own update of the factura
-- passed RLS, and it changes only that factura's NC/ND (the same table and
-- policy). Existing rows are not backfilled. Rollback: older code writes the
-- same columns; the NC/ND follow, which is what «Recategorizar» already did.

create function public.purchase_nc_nd_follow_factura()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack      text;
  v_set_account boolean := new.account_id is distinct from old.account_id;
  v_set_cc     boolean := new.cost_center_id is distinct from old.cost_center_id;
  v_linked     uuid[];
  v_closed     text;
begin
  get diagnostics v_stack = pg_context;
  if v_stack ~ 'function (public\.)?recategorize_expense\(' then
    return null;
  end if;

  select coalesce(array_agg(n.id order by n.id), '{}') into v_linked
    from public.purchase_invoices n
   where n.invoice_origin_id = new.id
     and n.kind in ('nc', 'nd')
     and n.status = 'received'
     and ((v_set_account
           and n.account_id is not distinct from old.account_id
           and n.charged_employee_id is null)
       or (v_set_cc
           and n.cost_center_id is not distinct from old.cost_center_id));
  if cardinality(v_linked) = 0 then
    return null;
  end if;

  perform 1 from public.purchase_invoices where id = any (v_linked) for update;

  select cp.period into v_closed
    from public.accounting_closed_periods cp
   where cp.period in (select to_char(n.fecha, 'YYYY-MM')
                         from public.purchase_invoices n where n.id = any (v_linked))
      or cp.period in (select je.accrual_period from public.journal_entries je
                        where je.source_table = 'purchase_invoices'
                          and je.source_id = any (v_linked))
   order by cp.period
   limit 1;
  if v_closed is not null then
    raise exception 'El período contable % está cerrado y una NC/ND de esta factura es de ese período: su cuenta de gasto y su centro de costo siguen a la factura. Pedí que lo reabran en Contabilidad para cambiarlos', v_closed
      using errcode = '55006', hint = 'jouve_guard';
  end if;

  update public.purchase_invoices n
     set account_id = case
           when v_set_account
                and n.account_id is not distinct from old.account_id
                and n.charged_employee_id is null
             then new.account_id else n.account_id end,
         cost_center_id = case
           when v_set_cc and n.cost_center_id is not distinct from old.cost_center_id
             then new.cost_center_id else n.cost_center_id end
   where n.id = any (v_linked);

  return null;
end;
$$;

comment on function public.purchase_nc_nd_follow_factura() is
  'Al cambiar la cuenta de gasto o el centro de costo de una factura de compra vigente, sus NC/ND vigentes que tenían el valor anterior lo siguen (una a cargo de un empleado conserva su cuenta), como en recategorize_expense; un período cerrado de alguna de ellas rechaza el cambio. Lo que hace recategorize_expense lo propaga ella misma.';

revoke all on function public.purchase_nc_nd_follow_factura() from public, anon, authenticated;

create trigger purchase_invoices_nc_nd_follow_factura
  after update of account_id, cost_center_id on public.purchase_invoices
  for each row
  when (new.kind = 'factura'
        and new.status = 'received'
        and (old.account_id is distinct from new.account_id
             or old.cost_center_id is distinct from new.cost_center_id))
  execute function public.purchase_nc_nd_follow_factura();
