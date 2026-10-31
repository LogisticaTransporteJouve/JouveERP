SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría 2026-10-31, "integridad en la base y permisos": document-owned
-- movements can no longer be deleted or rewritten from treasury, deletes of
-- clients/suppliers/vehicles/drivers/cost centers no longer wipe or orphan
-- history, and RLS/grants follow lib/auth/permissions.ts.

-- Compras F1 ----------------------------------------------------------------
-- The cancellation triggers ran as the caller: for finance the owner-only
-- DELETE policy on transactions filtered the delete to zero rows, leaving a
-- cancelled OP (or receipt) with live cash movements. As DEFINER they delete
-- what the document owns whoever cancels it.

create or replace function public.handle_payment_order_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check_id uuid;
begin
  if old.status = 'issued' and new.status = 'canceled' then
    -- Endorsed checks go back to en_cartera and lose their endorsement.
    for v_check_id in
      select endorsed_check_id
      from public.payment_order_payment_lines
      where payment_order_id = new.id
        and endorsed_check_id is not null
    loop
      update public.checks set status = 'en_cartera' where id = v_check_id;
      delete from public.check_movements
       where check_id = v_check_id and event = 'endorsed';
    end loop;

    -- Own checks still 'emitted' are cancelled; cashed or rejected ones stay.
    update public.issued_checks
       set status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = auth.uid()
     where payment_order_id = new.id
       and status = 'emitted';

    delete from public.transactions where payment_order_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.handle_payment_order_cancellation() from public, anon, authenticated;

create or replace function public.handle_receipt_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'issued' and new.status = 'canceled' then
    delete from public.transactions where receipt_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.handle_receipt_cancellation() from public, anon, authenticated;

-- FKs S1 + Módulos S2 -------------------------------------------------------
-- A movement a document owns is changed only by that document's code: another
-- trigger (cancellations, the payroll sync, FK cascades) or one of the RPCs
-- that rebuild a document's movements, found in the PL/pgSQL call stack. A
-- direct DELETE (PostgREST, SQL, any other function) is refused. A new writer
-- that rebuilds movements outside a trigger joins the list below. The UPDATE
-- half covers payroll payments; receipts, OPs, transfers and invoices already
-- have guard_transaction_immutable_when_linked.

create or replace function public.guard_transaction_owned_by_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
  v_owner text;
begin
  get diagnostics v_stack = pg_context;
  if pg_trigger_depth() > 1
     or v_stack ~ 'function (public\.)?(update_receipt|update_payment_order|apply_account_opening_balance|clear_account_opening_balance)\(' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    if exists (select 1 from public.payroll_payments where transaction_id = old.id)
       and (new.amount           is distinct from old.amount
         or new.transaction_date is distinct from old.transaction_date
         or new.accrual_month    is distinct from old.accrual_month
         or new.account_id       is distinct from old.account_id
         or new.kind             is distinct from old.kind
         or new.channel_id       is distinct from old.channel_id) then
      raise exception
        'No se puede editar monto, fecha, cuenta, tipo o canal de un movimiento generado por un pago de sueldo: editá el pago desde Sueldos'
        using errcode = '55006', hint = 'jouve_guard';
    end if;
    return new;
  end if;

  v_owner := case
    when old.receipt_id is not null then 'un recibo'
    when old.payment_order_id is not null then 'una orden de pago'
    when old.invoice_id is not null then 'un comprobante'
    when exists (select 1 from public.loan_installments where transaction_id = old.id)
      then 'una cuota de préstamo'
    when exists (select 1 from public.payroll_payments where transaction_id = old.id)
      then 'un pago de sueldo'
    when exists (select 1 from public.check_movements where transaction_id = old.id)
      then 'un movimiento de cheque'
    when exists (select 1 from public.account_opening_balances where adjustment_transaction_id = old.id)
      then 'un saldo inicial de cuenta'
  end;
  if v_owner is not null then
    raise exception
      'No se puede borrar un movimiento generado por %: anulá o editá el documento de origen', v_owner
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_transaction_owned_by_document() from public, anon, authenticated;

create trigger guard_transaction_owned_by_document_del
  before delete on public.transactions
  for each row execute function public.guard_transaction_owned_by_document();

create trigger guard_transaction_owned_by_document_upd
  before update on public.transactions
  for each row execute function public.guard_transaction_owned_by_document();

-- The payroll sync deleted its movement BEFORE the payment row went away, which
-- a RESTRICT FK from payroll_payments.transaction_id would refuse. AFTER DELETE
-- the payment is gone; the function's DELETE branch is unchanged.
drop trigger payroll_payments_delete_transaction on public.payroll_payments;
create trigger payroll_payments_delete_transaction
  after delete on public.payroll_payments
  for each row execute function public.payroll_payment_sync_transaction();

-- FKs to RESTRICT -----------------------------------------------------------
-- S1: documents that own a movement. S2: client/supplier history (the
-- delete actions turn the 23503 into "desactivalo"). M1: movements and own
-- checks of a receipt/OP. M2: cost centers (deactivate instead; SET NULL hit
-- closed periods and re-posted entries). Módulos S6: vehicle/driver costs and
-- trips. Every constraint is added NOT VALID and validated in the same
-- transaction: the referenced rows exist (0 orphans in the audit) and the
-- tables are small. Each FK is dropped only to be re-added right after with
-- the new ON DELETE (squawk ban-drop-constraint).

-- squawk-ignore ban-drop-constraint
alter table public.loan_installments drop constraint loan_installments_transaction_id_fkey;
alter table public.loan_installments add constraint loan_installments_transaction_id_fkey
  foreign key (transaction_id) references public.transactions (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.loan_installments validate constraint loan_installments_transaction_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.payroll_payments drop constraint payroll_payments_transaction_id_fkey;
alter table public.payroll_payments add constraint payroll_payments_transaction_id_fkey
  foreign key (transaction_id) references public.transactions (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.payroll_payments validate constraint payroll_payments_transaction_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.check_movements drop constraint check_movements_transaction_id_fkey;
alter table public.check_movements add constraint check_movements_transaction_id_fkey
  foreign key (transaction_id) references public.transactions (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.check_movements validate constraint check_movements_transaction_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.account_opening_balances drop constraint account_opening_balances_adjustment_transaction_id_fkey;
alter table public.account_opening_balances add constraint account_opening_balances_adjustment_transaction_id_fkey
  foreign key (adjustment_transaction_id) references public.transactions (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.account_opening_balances validate constraint account_opening_balances_adjustment_transaction_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.client_opening_balances drop constraint client_opening_balances_client_id_fkey;
alter table public.client_opening_balances add constraint client_opening_balances_client_id_fkey
  foreign key (client_id) references public.clients (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.client_opening_balances validate constraint client_opening_balances_client_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.supplier_opening_balances drop constraint supplier_opening_balances_supplier_id_fkey;
alter table public.supplier_opening_balances add constraint supplier_opening_balances_supplier_id_fkey
  foreign key (supplier_id) references public.suppliers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.supplier_opening_balances validate constraint supplier_opening_balances_supplier_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.transactions drop constraint transactions_counterparty_client_id_fkey;
alter table public.transactions add constraint transactions_counterparty_client_id_fkey
  foreign key (counterparty_client_id) references public.clients (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.transactions validate constraint transactions_counterparty_client_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.transactions drop constraint transactions_counterparty_supplier_id_fkey;
alter table public.transactions add constraint transactions_counterparty_supplier_id_fkey
  foreign key (counterparty_supplier_id) references public.suppliers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.transactions validate constraint transactions_counterparty_supplier_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.checks drop constraint checks_source_client_id_fkey;
alter table public.checks add constraint checks_source_client_id_fkey
  foreign key (source_client_id) references public.clients (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.checks validate constraint checks_source_client_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.issued_checks drop constraint issued_checks_supplier_id_fkey;
alter table public.issued_checks add constraint issued_checks_supplier_id_fkey
  foreign key (supplier_id) references public.suppliers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.issued_checks validate constraint issued_checks_supplier_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.transactions drop constraint transactions_receipt_id_fkey;
alter table public.transactions add constraint transactions_receipt_id_fkey
  foreign key (receipt_id) references public.receipts (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.transactions validate constraint transactions_receipt_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.transactions drop constraint transactions_payment_order_id_fkey;
alter table public.transactions add constraint transactions_payment_order_id_fkey
  foreign key (payment_order_id) references public.payment_orders (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.transactions validate constraint transactions_payment_order_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.issued_checks drop constraint issued_checks_payment_order_id_fkey;
alter table public.issued_checks add constraint issued_checks_payment_order_id_fkey
  foreign key (payment_order_id) references public.payment_orders (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.issued_checks validate constraint issued_checks_payment_order_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.invoices drop constraint invoices_cost_center_id_fkey;
alter table public.invoices add constraint invoices_cost_center_id_fkey
  foreign key (cost_center_id) references public.cost_centers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.invoices validate constraint invoices_cost_center_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.receipts drop constraint receipts_cost_center_id_fkey;
alter table public.receipts add constraint receipts_cost_center_id_fkey
  foreign key (cost_center_id) references public.cost_centers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.receipts validate constraint receipts_cost_center_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.transactions drop constraint transactions_cost_center_id_fkey;
alter table public.transactions add constraint transactions_cost_center_id_fkey
  foreign key (cost_center_id) references public.cost_centers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.transactions validate constraint transactions_cost_center_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.purchase_invoices drop constraint purchase_invoices_cost_center_id_fkey;
alter table public.purchase_invoices add constraint purchase_invoices_cost_center_id_fkey
  foreign key (cost_center_id) references public.cost_centers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.purchase_invoices validate constraint purchase_invoices_cost_center_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.payment_orders drop constraint payment_orders_cost_center_id_fkey;
alter table public.payment_orders add constraint payment_orders_cost_center_id_fkey
  foreign key (cost_center_id) references public.cost_centers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.payment_orders validate constraint payment_orders_cost_center_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.journal_entries drop constraint journal_entries_cost_center_id_fkey;
alter table public.journal_entries add constraint journal_entries_cost_center_id_fkey
  foreign key (cost_center_id) references public.cost_centers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.journal_entries validate constraint journal_entries_cost_center_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.recurring_payments drop constraint recurring_payments_cost_center_id_fkey;
alter table public.recurring_payments add constraint recurring_payments_cost_center_id_fkey
  foreign key (cost_center_id) references public.cost_centers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.recurring_payments validate constraint recurring_payments_cost_center_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.fuel_loads drop constraint fuel_loads_vehicle_id_fkey;
alter table public.fuel_loads add constraint fuel_loads_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.fuel_loads validate constraint fuel_loads_vehicle_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.maintenance_records drop constraint maintenance_records_vehicle_id_fkey;
alter table public.maintenance_records add constraint maintenance_records_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.maintenance_records validate constraint maintenance_records_vehicle_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.fleet_documents drop constraint fleet_documents_vehicle_id_fkey;
alter table public.fleet_documents add constraint fleet_documents_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.fleet_documents validate constraint fleet_documents_vehicle_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.fleet_documents drop constraint fleet_documents_driver_id_fkey;
alter table public.fleet_documents add constraint fleet_documents_driver_id_fkey
  foreign key (driver_id) references public.drivers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.fleet_documents validate constraint fleet_documents_driver_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.trips drop constraint trips_vehicle_id_fkey;
alter table public.trips add constraint trips_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.trips validate constraint trips_vehicle_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.trips drop constraint trips_driver_id_fkey;
alter table public.trips add constraint trips_driver_id_fkey
  foreign key (driver_id) references public.drivers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.trips validate constraint trips_driver_id_fkey;

-- M4: the allocation rows already reference their header, which references the
-- client/supplier; the direct FK duplicated it.
alter table public.client_opening_balance_allocations
  -- squawk-ignore ban-drop-constraint
  drop constraint client_opening_balance_allocations_client_id_fkey;
alter table public.supplier_opening_balance_allocations
  -- squawk-ignore ban-drop-constraint
  drop constraint supplier_opening_balance_allocations_supplier_id_fkey;

-- M5: unindexed FKs. Plain CREATE INDEX: a CONCURRENTLY statement must sit
-- alone in its file with no timeout header, and these tables are small in
-- production (the DB is close to empty), so the lock is brief.
-- squawk-ignore require-concurrent-index-creation
create index invoices_created_by_idx on public.invoices (created_by) where created_by is not null;
-- squawk-ignore require-concurrent-index-creation
create index journal_entries_created_by_idx on public.journal_entries (created_by) where created_by is not null;
-- squawk-ignore require-concurrent-index-creation
create index check_movements_transaction_id_idx on public.check_movements (transaction_id) where transaction_id is not null;

-- M6: journal_entries.source_table is a soft polymorphic link written only by
-- the emitters; pin its domain and pair it with source_id.
alter table public.journal_entries add constraint journal_entries_source_table_domain
  check (source_table in (
    'invoices', 'purchase_invoices', 'receipts', 'payment_orders',
    'transactions', 'checks', 'issued_checks'
  )) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.journal_entries validate constraint journal_entries_source_table_domain;

alter table public.journal_entries add constraint journal_entries_source_pair
  check ((source_table is null) = (source_id is null)) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.journal_entries validate constraint journal_entries_source_pair;

-- RLS S1: admin holds every :write the matrix grants, so the write policies
-- that admitted owner/finance only now admit admin too. The renames keep the
-- names true; nothing in the app or the tests reads a policy by name
-- (squawk renaming-object).

alter policy "Owners and finance can insert accounts" on public.accounts
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert accounts";
alter policy "Owners, admins and finance can insert accounts" on public.accounts
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can update accounts" on public.accounts
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can update accounts";
alter policy "Owners, admins and finance can update accounts" on public.accounts
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

alter policy "Owners and finance can insert transactions" on public.transactions
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert transactions";
alter policy "Owners, admins and finance can insert transactions" on public.transactions
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can update transactions" on public.transactions
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can update transactions";
alter policy "Owners, admins and finance can update transactions" on public.transactions
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

alter policy "Owners and finance can insert receipts" on public.receipts
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert receipts";
alter policy "Owners, admins and finance can insert receipts" on public.receipts
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can update receipts" on public.receipts
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can update receipts";
alter policy "Owners, admins and finance can update receipts" on public.receipts
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

alter policy "Owners and finance can insert receipt allocations" on public.receipt_allocations
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert receipt allocations";
alter policy "Owners, admins and finance can insert receipt allocations" on public.receipt_allocations
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can update receipt allocations" on public.receipt_allocations
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can update receipt allocations";
alter policy "Owners, admins and finance can update receipt allocations" on public.receipt_allocations
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can delete receipt allocations" on public.receipt_allocations
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can delete receipt allocations";
alter policy "Owners, admins and finance can delete receipt allocations" on public.receipt_allocations
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

alter policy "Owners and finance can insert receipt payment lines" on public.receipt_payment_lines
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert receipt payment lines";
alter policy "Owners, admins and finance can insert receipt payment lines" on public.receipt_payment_lines
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can update receipt payment lines" on public.receipt_payment_lines
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can update receipt payment lines";
alter policy "Owners, admins and finance can update receipt payment lines" on public.receipt_payment_lines
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can delete receipt payment lines" on public.receipt_payment_lines
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can delete receipt payment lines";
alter policy "Owners, admins and finance can delete receipt payment lines" on public.receipt_payment_lines
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

alter policy "Owners and finance can insert receipt retentions" on public.receipt_retentions
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert receipt retentions";
alter policy "Owners, admins and finance can insert receipt retentions" on public.receipt_retentions
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can update receipt retentions" on public.receipt_retentions
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can update receipt retentions";
alter policy "Owners, admins and finance can update receipt retentions" on public.receipt_retentions
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can delete receipt retentions" on public.receipt_retentions
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can delete receipt retentions";
alter policy "Owners, admins and finance can delete receipt retentions" on public.receipt_retentions
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

alter policy "Owners and finance can insert payment_orders" on public.payment_orders
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert payment_orders";
alter policy "Owners, admins and finance can insert payment_orders" on public.payment_orders
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can update payment_orders" on public.payment_orders
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can update payment_orders";
alter policy "Owners, admins and finance can update payment_orders" on public.payment_orders
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

alter policy "Owners and finance can insert po allocations" on public.payment_order_allocations
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert po allocations";
alter policy "Owners, admins and finance can insert po allocations" on public.payment_order_allocations
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can update po allocations" on public.payment_order_allocations
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can update po allocations";
alter policy "Owners, admins and finance can update po allocations" on public.payment_order_allocations
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can delete po allocations" on public.payment_order_allocations
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can delete po allocations";
alter policy "Owners, admins and finance can delete po allocations" on public.payment_order_allocations
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

alter policy "Owners and finance can insert po payment lines" on public.payment_order_payment_lines
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert po payment lines";
alter policy "Owners, admins and finance can insert po payment lines" on public.payment_order_payment_lines
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can update po payment lines" on public.payment_order_payment_lines
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can update po payment lines";
alter policy "Owners, admins and finance can update po payment lines" on public.payment_order_payment_lines
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can delete po payment lines" on public.payment_order_payment_lines
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can delete po payment lines";
alter policy "Owners, admins and finance can delete po payment lines" on public.payment_order_payment_lines
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

alter policy "Owners and finance can insert checks" on public.checks
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert checks";
alter policy "Owners, admins and finance can insert checks" on public.checks
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can update checks" on public.checks
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can update checks";
alter policy "Owners, admins and finance can update checks" on public.checks
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

alter policy "Owners and finance can insert check movements" on public.check_movements
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert check movements";
alter policy "Owners, admins and finance can insert check movements" on public.check_movements
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

alter policy "Owners and finance can insert issued checks" on public.issued_checks
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can insert issued checks";
alter policy "Owners, admins and finance can insert issued checks" on public.issued_checks
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));
alter policy "Owners and finance can update issued checks" on public.issued_checks
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can update issued checks";
alter policy "Owners, admins and finance can update issued checks" on public.issued_checks
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])))
  with check ((select public.user_has_role(array['owner', 'admin', 'finance'])));

-- RLS S5: suppliers:write (owner/admin/finance) gates the category delete.
alter policy "Owners and admins can delete supplier categories" on public.supplier_categories
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can delete supplier categories";
alter policy "Owners, admins and finance can delete supplier categories" on public.supplier_categories
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

-- RLS M7: accounting:write (owner/admin/finance) gates the chart delete.
alter policy "Owners and admins can delete chart_of_accounts" on public.chart_of_accounts
  -- squawk-ignore renaming-object
  rename to "Owners, admins and finance can delete chart_of_accounts";
alter policy "Owners, admins and finance can delete chart_of_accounts" on public.chart_of_accounts
  using ((select public.user_has_role(array['owner', 'admin', 'finance'])));

-- RLS M7: an avatar moved by UPDATE must stay in the user's own folder.
alter policy avatars_update_self on storage.objects
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1]::uuid = (select auth.uid())
  );

-- RLS M4: auth.uid() evaluated once per statement, not per row.
alter policy ai_sessions_select on public.ai_chat_sessions
  using (user_id = (select auth.uid()) or (select public.user_has_role(array['owner', 'admin'])));
alter policy ai_sessions_insert on public.ai_chat_sessions
  with check (user_id = (select auth.uid()));
alter policy ai_sessions_update on public.ai_chat_sessions
  using (user_id = (select auth.uid()) or (select public.user_has_role(array['owner', 'admin'])))
  with check (user_id = (select auth.uid()) or (select public.user_has_role(array['owner', 'admin'])));
alter policy ai_sessions_delete on public.ai_chat_sessions
  using (user_id = (select auth.uid()) or (select public.user_has_role(array['owner', 'admin'])));

alter policy ai_messages_select on public.ai_chat_messages
  using (exists (
    select 1 from public.ai_chat_sessions s
     where s.id = ai_chat_messages.session_id
       and (s.user_id = (select auth.uid()) or (select public.user_has_role(array['owner', 'admin'])))
  ));
alter policy ai_messages_insert on public.ai_chat_messages
  with check (exists (
    select 1 from public.ai_chat_sessions s
     where s.id = ai_chat_messages.session_id
       and s.user_id = (select auth.uid())
  ));
alter policy ai_messages_delete on public.ai_chat_messages
  using (exists (
    select 1 from public.ai_chat_sessions s
     where s.id = ai_chat_messages.session_id
       and (s.user_id = (select auth.uid()) or (select public.user_has_role(array['owner', 'admin'])))
  ));

alter policy ai_extractions_select on public.ai_document_extractions
  using (created_by = (select auth.uid()) or (select public.user_has_role(array['owner', 'admin'])));
alter policy ai_extractions_insert on public.ai_document_extractions
  with check (created_by = (select auth.uid()));
alter policy ai_extractions_update on public.ai_document_extractions
  using (created_by = (select auth.uid()) or (select public.user_has_role(array['owner', 'admin'])))
  with check (created_by = (select auth.uid()) or (select public.user_has_role(array['owner', 'admin'])));
alter policy ai_extractions_delete on public.ai_document_extractions
  using (created_by = (select auth.uid()) or (select public.user_has_role(array['owner', 'admin'])));

-- RLS S2: the app adjusts a client's opening balance as owner only; the RPC
-- admitted admin/finance and was executable by anon.

create or replace function public.apply_client_opening_balance(
  p_client_id      uuid,
  p_opening_date   date,
  p_target_balance numeric,
  p_notes          text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id        uuid := auth.uid();
  v_sum_invoices   numeric(14, 2);
  v_sum_ncs        numeric(14, 2);
  v_sum_receipts   numeric(14, 2);
  v_real_open      numeric(14, 2);
  v_to_settle      numeric(14, 2);
  v_remaining      numeric(14, 2);
  v_inv            record;
  v_capacity       numeric(14, 2);
  v_apply          numeric(14, 2);
begin
  if not public.user_has_role(array['owner']) then
    raise exception 'Solo el owner puede ajustar saldos de cliente' using errcode = '42501';
  end if;

  if p_target_balance < 0 then
    raise exception 'El saldo de apertura no puede ser negativo'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  delete from public.client_opening_balance_allocations where client_id = p_client_id;
  delete from public.client_opening_balances where client_id = p_client_id;

  -- 1) Facturas + ND emitidas hasta el corte.
  select coalesce(sum(c.imp_total), 0) into v_sum_invoices
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind in ('factura', 'nd')
    and c.fecha <= p_opening_date;

  -- 2) NC emitidas hasta el corte.
  select coalesce(sum(c.imp_total), 0) into v_sum_ncs
  from public.invoices c
  where c.client_id = p_client_id
    and c.status = 'emitted'
    and c.kind = 'nc'
    and c.fecha <= p_opening_date;

  -- 3) Imputaciones de recibos emitidos hasta el corte.
  select coalesce(sum(ra.amount_applied), 0) into v_sum_receipts
  from public.receipt_allocations ra
  join public.receipts r on r.id = ra.receipt_id
  join public.invoices  c on c.id = ra.invoice_id
  where r.status = 'issued'
    and r.receipt_date <= p_opening_date
    and c.client_id = p_client_id
    and c.fecha <= p_opening_date;

  v_real_open := v_sum_invoices - v_sum_ncs - v_sum_receipts;
  v_to_settle := v_real_open - p_target_balance;

  if v_to_settle <= 0 then
    insert into public.client_opening_balances (
      client_id, opening_date, target_balance, total_settled, notes, created_by
    ) values (
      p_client_id, p_opening_date, p_target_balance, 0, p_notes, v_user_id
    );
    return;
  end if;

  insert into public.client_opening_balances (
    client_id, opening_date, target_balance, total_settled, notes, created_by
  ) values (
    p_client_id, p_opening_date, p_target_balance, v_to_settle, p_notes, v_user_id
  );

  -- 4) FIFO con la capacidad que dejan los recibos.
  v_remaining := v_to_settle;
  for v_inv in
    select
      c.id,
      c.imp_total,
      c.imp_total - coalesce((
        select sum(ra.amount_applied)
        from public.receipt_allocations ra
        join public.receipts r on r.id = ra.receipt_id
        where ra.invoice_id = c.id
          and r.status = 'issued'
      ), 0) as capacity
    from public.invoices c
    where c.client_id = p_client_id
      and c.status = 'emitted'
      and c.kind in ('factura', 'nd')
      and c.fecha <= p_opening_date
    order by c.fecha asc, c.numero asc, c.created_at asc
  loop
    exit when v_remaining <= 0;
    v_capacity := greatest(v_inv.capacity, 0);
    if v_capacity = 0 then
      continue;
    end if;
    v_apply := least(v_capacity, v_remaining);
    insert into public.client_opening_balance_allocations (
      client_id, invoice_id, amount_applied
    ) values (
      p_client_id, v_inv.id, v_apply
    );
    v_remaining := v_remaining - v_apply;
  end loop;
end;
$$;

revoke all on function public.apply_client_opening_balance(uuid, date, numeric, text) from public, anon, authenticated;
grant execute on function public.apply_client_opening_balance(uuid, date, numeric, text) to authenticated;

create or replace function public.clear_client_opening_balance(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.user_has_role(array['owner']) then
    raise exception 'Solo el owner puede borrar el ajuste de saldo' using errcode = '42501';
  end if;
  delete from public.client_opening_balances where client_id = p_client_id;
end;
$$;

revoke all on function public.clear_client_opening_balance(uuid) from public, anon, authenticated;
grant execute on function public.clear_client_opening_balance(uuid) to authenticated;

-- RLS S4: only the server (service role) reads the day's AI usage.
revoke all on function public.ai_usage_today() from public, anon, authenticated;
grant execute on function public.ai_usage_today() to service_role;

-- RLS M2: DEFINER functions anon could run. notification_type_enabled reads
-- anyone's preferences and is called only by the chat notification triggers;
-- list_chat_assignable_users stays for authenticated (chat UI). Trigger
-- functions are not checked for EXECUTE when they fire.
revoke all on function public.notification_type_enabled(uuid, text) from public, anon, authenticated;
revoke execute on function public.list_chat_assignable_users() from anon;

revoke all on function public.delete_journal_for_transaction() from public, anon, authenticated;
revoke all on function public.ensure_group_has_admin() from public, anon, authenticated;
revoke all on function public.guard_invoice_items_immutable() from public, anon, authenticated;
revoke all on function public.guard_payment_order_cancel_cashed_check() from public, anon, authenticated;
revoke all on function public.guard_receipt_cancel_phantom_checks() from public, anon, authenticated;
revoke all on function public.handle_new_user_profile() from public, anon, authenticated;
revoke all on function public.invoices_after_delete_journal() from public, anon, authenticated;
revoke all on function public.notify_on_chat_mention() from public, anon, authenticated;
revoke all on function public.notify_on_chat_message() from public, anon, authenticated;
revoke all on function public.payment_orders_after_delete_journal() from public, anon, authenticated;
revoke all on function public.payroll_payment_sync_transaction() from public, anon, authenticated;
revoke all on function public.purchase_invoices_after_delete_journal() from public, anon, authenticated;
revoke all on function public.receipts_after_delete_journal() from public, anon, authenticated;
revoke all on function public.search_index_mark_dirty() from public, anon, authenticated;
revoke all on function public.search_index_refresh_trigger() from public, anon, authenticated;
revoke all on function public.sync_attendance_from_leave() from public, anon, authenticated;
revoke all on function public.sync_vacation_balance_used() from public, anon, authenticated;

-- RLS M1: no API role truncates, adds triggers to, references or maintains a
-- table; data access stays with RLS. Default privileges cover later tables.
revoke truncate, trigger, references, maintain on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;
