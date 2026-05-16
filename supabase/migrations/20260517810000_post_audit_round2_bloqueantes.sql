-- Post-audit round 2 — bloqueantes restantes identificados en auditoría:
--
-- 1. Bloquear DELETE de invoices emitted (compliance fiscal: 10 años).
-- 2. Bloquear DELETE de purchase_invoices received (idem).
-- 3. Tighten notifications UPDATE policy (solo read_at).
-- 4. Fix unique constraint purchase_invoices con coalesce(letter).
-- 5. FTS refresh async vía pg_notify (deja de bloquear writes).
-- 6. Cheque endosado rechazado → reversal contable.
-- 7. Cancel invoice → trigger des-alloca receipts (warning, no auto).
-- 8. Bloquear DELETE de payroll_periods closed.
-- 9. Trigger en purchase_invoice_items que regenera asiento.

set row_security = off;

------------------------------------------------------------------------------
-- 1+2 — Bloquear DELETE de comprobantes con CAE / facturas recibidas
------------------------------------------------------------------------------
-- AFIP RG 1361 y AFIP RG 4290 exigen conservar comprobantes y registros
-- por 10 años. Un DELETE accidental por SQL admin destruye trazabilidad.
-- El cancel es la vía correcta (status=cancelled mantiene el row + asiento).

create or replace function public.guard_delete_emitted_invoice()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'emitted' then
    raise exception 'No se puede borrar invoice % (status=emitted, CAE existe). Usá cancel/NC.', old.id
      using errcode = '22023';
  end if;
  return old;
end;
$$;

create trigger invoices_guard_delete
  before delete on public.invoices
  for each row execute function public.guard_delete_emitted_invoice();

create or replace function public.guard_delete_received_purchase_invoice()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'received' then
    raise exception 'No se puede borrar purchase_invoice % (status=received). Usá cancel.', old.id
      using errcode = '22023';
  end if;
  return old;
end;
$$;

create trigger purchase_invoices_guard_delete
  before delete on public.purchase_invoices
  for each row execute function public.guard_delete_received_purchase_invoice();

------------------------------------------------------------------------------
-- 3 — Tighten notifications UPDATE policy
------------------------------------------------------------------------------
-- Antes: recipient podía actualizar TODO el row (sender_id, type, metadata).
-- Vector: tampering de notif propia para falsificar origen / contenido.
-- Después: solo permitir cambio de read_at. Los otros campos quedan inmutables.

drop policy if exists "Recipient can mark own notifications as read" on public.notifications;
drop policy if exists "Recipient can update own notifications" on public.notifications;

create policy "Recipient can mark own notifications as read"
  on public.notifications for update
  to authenticated
  using (recipient_id = (select auth.uid()))
  with check (
    recipient_id = (select auth.uid())
    and recipient_id is not distinct from recipient_id  -- placeholder
  );

-- Trigger BEFORE UPDATE que rechaza cambios a campos sensibles.
-- Más robusto que policy with check (la policy WITH CHECK no compara
-- old vs new — solo valida el row resultante).

create or replace function public.notifications_lock_immutable_fields()
returns trigger
language plpgsql
as $$
begin
  if new.recipient_id    is distinct from old.recipient_id
   or new.sender_id      is distinct from old.sender_id
   or new.type           is distinct from old.type
   or new.title          is distinct from old.title
   or new.body           is distinct from old.body
   or new.metadata       is distinct from old.metadata
   or new.created_at     is distinct from old.created_at
  then
    raise exception 'notifications: solo se puede modificar read_at desde el cliente'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger notifications_immutable_guard
  before update on public.notifications
  for each row execute function public.notifications_lock_immutable_fields();

------------------------------------------------------------------------------
-- 4 — Fix unique constraint purchase_invoices con coalesce(letter)
------------------------------------------------------------------------------
-- Antes: unique(supplier_id, kind, letter, punto_venta, numero) trataba
-- NULL como distinct, así que dos NCs internas con letter NULL podían
-- duplicarse. Convertimos a unique index con coalesce.

alter table public.purchase_invoices
  drop constraint purchase_invoices_unique_supplier_numero;

create unique index purchase_invoices_unique_supplier_numero_idx
  on public.purchase_invoices (
    supplier_id, kind, coalesce(letter::text, ''), punto_venta, numero
  );

------------------------------------------------------------------------------
-- 5 — FTS refresh: cambiar triggers a debounced via pg_notify
------------------------------------------------------------------------------
-- Antes: cada DML en 7 source tables disparaba REFRESH MATERIALIZED VIEW
-- CONCURRENTLY synchronously → +200-500ms por write bajo carga (ej:
-- import AFIP de 1313 facturas = 1313 refreshes).
--
-- Después: trigger emite pg_notify('search_index_dirty'). Un worker
-- Inngest escucha cada N seg y refresca si hay flag.
--
-- Mientras tanto, dropear los triggers actuales y reemplazar por uno
-- statement-level que solo marca dirty via pg_notify (no espera refresh).

create or replace function public.search_index_mark_dirty()
returns trigger
language plpgsql
as $$
begin
  -- Notify listener (Inngest worker) — no esperamos refresh.
  perform pg_notify('search_index_dirty', tg_table_name);
  return null;
end;
$$;

comment on function public.search_index_mark_dirty is
  'Mark FTS index as dirty via pg_notify. Un worker async refresca cada N seg. Reemplaza el refresh sincronico que agregaba 200-500ms por write.';

-- Reemplazar los triggers existentes
drop trigger if exists clients_search_refresh           on public.clients;
drop trigger if exists suppliers_search_refresh         on public.suppliers;
drop trigger if exists invoices_search_refresh          on public.invoices;
drop trigger if exists purchase_invoices_search_refresh on public.purchase_invoices;
drop trigger if exists receipts_search_refresh          on public.receipts;
drop trigger if exists payment_orders_search_refresh    on public.payment_orders;
drop trigger if exists transactions_search_refresh      on public.transactions;

create trigger clients_search_dirty
  after insert or update or delete on public.clients
  for each statement execute function public.search_index_mark_dirty();

create trigger suppliers_search_dirty
  after insert or update or delete on public.suppliers
  for each statement execute function public.search_index_mark_dirty();

create trigger invoices_search_dirty
  after insert or update or delete on public.invoices
  for each statement execute function public.search_index_mark_dirty();

create trigger purchase_invoices_search_dirty
  after insert or update or delete on public.purchase_invoices
  for each statement execute function public.search_index_mark_dirty();

create trigger receipts_search_dirty
  after insert or update or delete on public.receipts
  for each statement execute function public.search_index_mark_dirty();

create trigger payment_orders_search_dirty
  after insert or update or delete on public.payment_orders
  for each statement execute function public.search_index_mark_dirty();

create trigger transactions_search_dirty
  after insert or update or delete on public.transactions
  for each statement execute function public.search_index_mark_dirty();

-- Tabla simple de control para que el worker async sepa si hay refresh
-- pendiente. Solo 1 row con dirty boolean. pg_notify alerta inmediato,
-- esta tabla es el state para que el cron lo detecte si perdió el notify.

create table public.search_index_state (
  id              int  primary key default 1,
  dirty           boolean not null default false,
  last_refreshed  timestamptz not null default now(),
  constraint search_index_state_singleton check (id = 1)
);
insert into public.search_index_state (id, dirty) values (1, true) on conflict do nothing;

-- Update del trigger para también marcar dirty en la tabla
create or replace function public.search_index_mark_dirty()
returns trigger
language plpgsql
as $$
begin
  update public.search_index_state set dirty = true where id = 1;
  perform pg_notify('search_index_dirty', tg_table_name);
  return null;
end;
$$;

-- Helper que el cron worker llama
create or replace function public.refresh_search_index_if_dirty()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_dirty boolean;
begin
  update public.search_index_state
     set dirty = false, last_refreshed = now()
   where id = 1 and dirty = true
  returning true into v_was_dirty;

  if v_was_dirty then
    refresh materialized view concurrently public.search_index;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.refresh_search_index_if_dirty from public;
grant execute on function public.refresh_search_index_if_dirty to service_role;

------------------------------------------------------------------------------
-- 6 — Cheque endosado rechazado: trigger de reversal
------------------------------------------------------------------------------
-- Cuando un cheque endosado a un proveedor rebota (proveedor lo presenta
-- y no se cobra), hoy:
--   - status del cheque cambia a rechazado (manual o vía RPC)
--   - el asiento original de la OP que lo endosó queda con "Haber
--     cheques_cartera" pero el cheque ya no existe en cartera
--   - el proveedor sigue creyendo que le pagamos
--
-- Trigger: cuando endosado → rechazado, genera reversal:
--   Debe cheques_cartera (revierte salida)
--   Haber proveedores  (la deuda vuelve)
--
-- Linkea al supplier vía la payment_order_payment_lines que lo endosó.

create or replace function public.emit_journal_for_endorsed_check_rejected()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id uuid;
  v_amount numeric;
  v_desc text;
begin
  if old.status <> 'endosado' or new.status <> 'rechazado' then
    return new;
  end if;

  -- Buscar la OP que lo endosó (vía payment_order_payment_lines)
  select pl.payment_order_id, pl.amount
    into v_po_id, v_amount
    from public.payment_order_payment_lines pl
   where pl.endorsed_check_id = new.id
   limit 1;

  if v_po_id is null then
    raise warning 'Cheque endosado % rechazado sin OP asociada — no se emite reversal', new.id;
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
      p_source_id      := new.id
    );
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_endorsed_check_rejected: % (check=%)', sqlerrm, new.id;
  end;

  return new;
end;
$$;

create trigger checks_endorsed_rejected_journal
  after update of status on public.checks
  for each row
  when (old.status = 'endosado' and new.status = 'rechazado')
  execute function public.emit_journal_for_endorsed_check_rejected();

------------------------------------------------------------------------------
-- 7 — Cancel invoice: WARNING si hay receipts con allocations
------------------------------------------------------------------------------
-- Cancelar una invoice que ya fue cobrada por recibos deja la cuenta
-- corriente del cliente inconsistente. No auto-eliminamos las allocations
-- porque el recibo cobró plata real que no se devolvió. La política es:
-- BLOQUEAR cancelación si hay allocations activas; el usuario debe
-- emitir NC o reversar el recibo primero.

create or replace function public.guard_cancel_invoice_with_allocations()
returns trigger
language plpgsql
as $$
declare
  v_alloc_count int;
begin
  if old.status = 'emitted' and new.status = 'cancelled' then
    select count(*) into v_alloc_count
      from public.receipt_allocations ra
      join public.receipts r on r.id = ra.receipt_id
     where ra.invoice_id = old.id
       and r.status = 'issued';
    if v_alloc_count > 0 then
      raise exception 'No se puede cancelar invoice % — tiene % allocations en recibos activos. Anulá los recibos o emití NC.', old.id, v_alloc_count
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger invoices_cancel_blocked_if_allocated
  before update of status on public.invoices
  for each row
  when (old.status = 'emitted' and new.status = 'cancelled')
  execute function public.guard_cancel_invoice_with_allocations();

------------------------------------------------------------------------------
-- 8 — Bloquear DELETE de payroll_periods closed
------------------------------------------------------------------------------
create or replace function public.guard_delete_closed_payroll_period()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'closed' then
    raise exception 'No se puede borrar payroll_period % (status=closed). Reabrí primero si querés modificarlo.', old.id
      using errcode = '22023';
  end if;
  return old;
end;
$$;

create trigger payroll_periods_guard_delete
  before delete on public.payroll_periods
  for each row execute function public.guard_delete_closed_payroll_period();

------------------------------------------------------------------------------
-- 9 — Trigger en purchase_invoice_items: regen asiento al editar items
------------------------------------------------------------------------------
-- replace_purchase_invoice_items recalcula header pero NO el asiento.
-- Trigger: borra asiento existente y emite nuevo. El status check
-- ensure que solo regeneramos si la invoice está received (fiscal).

create or replace function public.regen_purchase_invoice_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pi public.purchase_invoices;
begin
  select * into v_pi from public.purchase_invoices
   where id = coalesce(new.purchase_invoice_id, old.purchase_invoice_id);
  if v_pi.id is null or v_pi.status <> 'received' then
    return null;
  end if;

  -- Borrar asientos no-reversal previos y emitir uno nuevo con los
  -- nuevos totales (que replace_purchase_invoice_items ya persistió
  -- en el header).
  delete from public.journal_entries
   where source_table = 'purchase_invoices'
     and source_id    = v_pi.id
     and is_reversal  = false;

  perform public.emit_journal_for_purchase_invoice(v_pi, false);
  return null;
end;
$$;

create trigger purchase_invoice_items_regen_journal
  after insert or update or delete on public.purchase_invoice_items
  for each statement execute function public.regen_purchase_invoice_journal();

set row_security = on;
