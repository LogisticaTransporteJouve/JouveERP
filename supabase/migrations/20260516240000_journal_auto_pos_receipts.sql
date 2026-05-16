-- L.2d — Asientos automáticos desde payment_orders y receipts.
--
-- Receipts (cobranzas):
--   Debe  cada account_id de receipt_payment_lines (caja/banco/cheques_cartera)
--   Haber Clientes total_amount
--
-- Payment orders (pagos a proveedores):
--   Debe  Proveedores total_amount
--   Para cada payment_order_payment_lines:
--     * Si issued_check_id is not null  → Haber Cheques diferidos emitidos
--     * Si endorsed_check_id is not null → Haber Cheques en cartera (sale)
--     * En otro caso → Haber [role de account] (caja/banco)
--
-- Status: solo `issued` genera asiento. `canceled` genera reversal.
-- Receipts y POs son inmutables post-issue salvo cancelar, así que no
-- manejamos update de líneas — solo el de status.
--
-- Importante: el trigger AFTER INSERT del header no ve las líneas
-- (todavía no insertadas). Solucionamos enganchando el trigger en
-- AFTER INSERT del header + AFTER INSERT/DELETE de cada línea (que
-- regenera el asiento si ya existe header issued). Más simple:
-- trigger en INSERT de cada línea que, si el header está en estado
-- issued y no tiene asiento todavía, espera; si el último insert de
-- línea completa el balance, dispara.
--
-- Estrategia alternativa más simple y limpia: trigger AFTER UPDATE
-- en el header (cuando status pasa a issued o cuando se "toca"). Pero
-- las cobranzas/pagos se crean issued de una. Hace falta un punto donde
-- todas las líneas ya estén in.
--
-- Solución pragmática: las RPCs (create_receipt, create_payment_order)
-- ya insertan header + líneas en una transacción. Hacemos AFTER INSERT
-- en el header → DEFERRED (constraint trigger) que dispara al COMMIT.
-- Sin embargo nuestras funciones de asientos hacen SET CONSTRAINTS
-- IMMEDIATE, complicando el flujo.
--
-- Más simple aún: trigger AFTER INSERT en el header marca pending,
-- y un job nightly o un trigger AFTER INSERT en las líneas hace el
-- check. Pero eso es complejidad innecesaria.
--
-- La solución correcta: hacer el trigger AFTER INSERT del HEADER
-- *DEFERRED* (constraint trigger). Cuando dispara al final del
-- statement INSERT del header, las líneas todavía no están. ¿Pero al
-- COMMIT sí? Sí. Constraint trigger DEFERRED INITIALLY DEFERRED
-- dispara al COMMIT de la transacción.
--
-- Hacemos eso: constraint trigger DEFERRABLE INITIALLY DEFERRED en
-- receipts y payment_orders. Para que el INSERT del header pueda
-- chequear líneas que se insertan después en la misma transacción.

set row_security = off;

------------------------------------------------------------------------------
-- 1. emit_journal_for_receipt
------------------------------------------------------------------------------
create or replace function public.emit_journal_for_receipt(
  p_receipt_id uuid,
  p_reverse boolean default false,
  p_reversed_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r       public.receipts;
  v_line    record;
  v_lines   jsonb := '[]'::jsonb;
  v_role    public.coa_system_role;
  v_dir     numeric;
  v_desc    text;
  v_number  text;
  v_entry   uuid;
begin
  select * into v_r from public.receipts where id = p_receipt_id;
  if v_r.id is null then return null; end if;

  v_dir := case when p_reverse then -1 else 1 end;
  v_number := 'R' || lpad(v_r.punto_venta::text, 4, '0') || '-' || lpad(v_r.numero::text, 8, '0');
  v_desc := case when p_reverse then 'Anulación ' else '' end || 'Recibo ' || v_number;

  -- Líneas Debe (los medios de pago entrantes)
  for v_line in
    select rpl.account_id, rpl.amount, a.name as account_name
      from public.receipt_payment_lines rpl
      join public.accounts a on a.id = rpl.account_id
     where rpl.receipt_id = p_receipt_id
  loop
    v_role := public.coa_role_for_account(v_line.account_id);
    if v_role is null then
      raise warning 'emit_journal_for_receipt: account % sin mapping COA', v_line.account_id;
      continue;
    end if;
    v_lines := v_lines || jsonb_build_object(
      'system_role', v_role::text,
      case when v_dir > 0 then 'debit' else 'credit' end, v_line.amount,
      'description', v_desc || ' — ' || v_line.account_name
    );
  end loop;

  -- Línea Haber a Clientes por el total
  v_lines := v_lines || jsonb_build_object(
    'system_role', 'clientes',
    case when v_dir > 0 then 'credit' else 'debit' end, v_r.total_amount,
    'description', v_desc || ' — cliente'
  );

  begin
    v_entry := public.create_journal_entry(
      p_entry_date := v_r.receipt_date,
      p_accrual_period := to_char(v_r.receipt_date, 'YYYY-MM'),
      p_description := v_desc,
      p_lines := v_lines,
      p_source_table := 'receipts',
      p_source_id := v_r.id,
      p_channel_id := v_r.channel_id,
      p_is_reversal := p_reverse,
      p_reversed_entry_id := p_reversed_entry_id
    );
    return v_entry;
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_receipt: % (receipt=%)', sqlerrm, v_r.id;
    return null;
  end;
end;
$$;

------------------------------------------------------------------------------
-- 2. emit_journal_for_payment_order
------------------------------------------------------------------------------
create or replace function public.emit_journal_for_payment_order(
  p_payment_order_id uuid,
  p_reverse boolean default false,
  p_reversed_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po      public.payment_orders;
  v_line    record;
  v_lines   jsonb := '[]'::jsonb;
  v_role    public.coa_system_role;
  v_dir     numeric;
  v_desc    text;
  v_number  text;
  v_entry   uuid;
begin
  select * into v_po from public.payment_orders where id = p_payment_order_id;
  if v_po.id is null then return null; end if;

  v_dir := case when p_reverse then -1 else 1 end;
  v_number := 'OP' || lpad(v_po.punto_venta::text, 4, '0') || '-' || lpad(v_po.numero::text, 8, '0');
  v_desc := case when p_reverse then 'Anulación ' else '' end || 'Orden de pago ' || v_number;

  -- Línea Debe a Proveedores por el total
  v_lines := v_lines || jsonb_build_object(
    'system_role', 'proveedores',
    case when v_dir > 0 then 'debit' else 'credit' end, v_po.total_amount,
    'description', v_desc || ' — proveedor'
  );

  -- Líneas Haber por cada medio de pago (cuenta / endoso / cheque emitido)
  for v_line in
    select pl.account_id, pl.amount, pl.endorsed_check_id, pl.issued_check_id,
           a.name as account_name
      from public.payment_order_payment_lines pl
      join public.accounts a on a.id = pl.account_id
     where pl.payment_order_id = p_payment_order_id
  loop
    if v_line.issued_check_id is not null then
      v_role := 'cheques_diferidos_emitidos';
    elsif v_line.endorsed_check_id is not null then
      v_role := 'cheques_cartera';
    else
      v_role := public.coa_role_for_account(v_line.account_id);
    end if;

    if v_role is null then
      raise warning 'emit_journal_for_payment_order: account % sin mapping COA', v_line.account_id;
      continue;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'system_role', v_role::text,
      case when v_dir > 0 then 'credit' else 'debit' end, v_line.amount,
      'description', v_desc || ' — ' || v_line.account_name
    );
  end loop;

  begin
    v_entry := public.create_journal_entry(
      p_entry_date := v_po.payment_date,
      p_accrual_period := to_char(v_po.payment_date, 'YYYY-MM'),
      p_description := v_desc,
      p_lines := v_lines,
      p_source_table := 'payment_orders',
      p_source_id := v_po.id,
      p_channel_id := v_po.channel_id,
      p_is_reversal := p_reverse,
      p_reversed_entry_id := p_reversed_entry_id
    );
    return v_entry;
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_payment_order: % (po=%)', sqlerrm, v_po.id;
    return null;
  end;
end;
$$;

------------------------------------------------------------------------------
-- 3. Triggers AFTER INSERT (DEFERRED constraint triggers)
------------------------------------------------------------------------------
-- Constraint trigger DEFERRABLE INITIALLY DEFERRED dispara al COMMIT,
-- así ya están todas las payment_lines insertadas en la misma transacción.

create or replace function public.receipts_after_insert_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'issued' then
    perform public.emit_journal_for_receipt(new.id, false);
  end if;
  return null;
end;
$$;

create constraint trigger receipts_after_insert_journal_trg
  after insert on public.receipts
  deferrable initially deferred
  for each row execute function public.receipts_after_insert_journal();

create or replace function public.payment_orders_after_insert_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'issued' then
    perform public.emit_journal_for_payment_order(new.id, false);
  end if;
  return null;
end;
$$;

create constraint trigger payment_orders_after_insert_journal_trg
  after insert on public.payment_orders
  deferrable initially deferred
  for each row execute function public.payment_orders_after_insert_journal();

------------------------------------------------------------------------------
-- 4. Triggers AFTER UPDATE status (reversal de cancelación)
------------------------------------------------------------------------------
create or replace function public.receipts_after_update_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original uuid;
begin
  if old.status = 'issued' and new.status = 'canceled' then
    select id into v_original from public.journal_entries
     where source_table = 'receipts' and source_id = new.id and is_reversal = false
     order by created_at asc limit 1;
    perform public.emit_journal_for_receipt(new.id, true, v_original);
  end if;
  return new;
end;
$$;

create trigger receipts_after_update_journal_trg
  after update of status on public.receipts
  for each row
  when (old.status is distinct from new.status)
  execute function public.receipts_after_update_journal();

create or replace function public.payment_orders_after_update_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original uuid;
begin
  if old.status = 'issued' and new.status = 'canceled' then
    select id into v_original from public.journal_entries
     where source_table = 'payment_orders' and source_id = new.id and is_reversal = false
     order by created_at asc limit 1;
    perform public.emit_journal_for_payment_order(new.id, true, v_original);
  end if;
  return new;
end;
$$;

create trigger payment_orders_after_update_journal_trg
  after update of status on public.payment_orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.payment_orders_after_update_journal();

------------------------------------------------------------------------------
-- 5. Triggers AFTER DELETE
------------------------------------------------------------------------------
create or replace function public.receipts_after_delete_journal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.journal_entries where source_table = 'receipts' and source_id = old.id;
  return old;
end;
$$;
create trigger receipts_after_delete_journal_trg
  after delete on public.receipts for each row execute function public.receipts_after_delete_journal();

create or replace function public.payment_orders_after_delete_journal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.journal_entries where source_table = 'payment_orders' and source_id = old.id;
  return old;
end;
$$;
create trigger payment_orders_after_delete_journal_trg
  after delete on public.payment_orders for each row execute function public.payment_orders_after_delete_journal();

------------------------------------------------------------------------------
-- 6. Backfill
------------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  for v_id in
    select r.id from public.receipts r
    left join public.journal_entries j on j.source_table='receipts' and j.source_id=r.id
    where j.id is null and r.status='issued'
    order by r.receipt_date, r.created_at
  loop
    perform public.emit_journal_for_receipt(v_id, false);
  end loop;
end;
$$;

do $$
declare v_id uuid;
begin
  for v_id in
    select po.id from public.payment_orders po
    left join public.journal_entries j on j.source_table='payment_orders' and j.source_id=po.id
    where j.id is null and po.status='issued'
    order by po.payment_date, po.created_at
  loop
    perform public.emit_journal_for_payment_order(v_id, false);
  end loop;
end;
$$;

set row_security = on;
