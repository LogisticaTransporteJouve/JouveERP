-- Post-audit money safety bundle:
--
-- A1: Trigger asientos issued_checks (cheques propios cobrados/rechazados/anulados).
--     Sin este trigger, el pasivo cheques_diferidos_emitidos crece sin tope y
--     la cuenta bancaria nunca refleja el egreso real cuando el proveedor
--     deposita el cheque.
--
-- A2: Trigger asientos purchase_invoices (espejo de L.2c invoices).
--     Sin este, la cuenta proveedores queda en débito eterno (solo se
--     debita al pagar via OP, nunca acredita al recibir factura).
--
-- B1: UNIQUE parcial en payment_order_payment_lines.endorsed_check_id —
--     impide doble endoso (race condition + double pay).
--
-- B2: Sequence atómica por (channel_id, punto_venta, kind) para numerar
--     comprobantes internos. Reemplaza el patrón MAX(numero)+1 que tiene
--     race condition bajo emisión concurrente.

set row_security = off;

------------------------------------------------------------------------------
-- A1 — Asientos automáticos para issued_checks
------------------------------------------------------------------------------
-- Lifecycle:
--   emitted (al crear via OP) → asiento ya existe (L.2d generó "Haber
--     cheques_diferidos_emitidos" desde la OP). NO tocamos.
--   emitted → cashed: el proveedor depositó. Egreso real de banco.
--     → Debe cheques_diferidos_emitidos (revierte pasivo)
--     → Haber bank_account (egreso de caja)
--   emitted → rejected: el proveedor presentó y rebotó. La obligación
--     vuelve a aparecer (asiento original del pago se "revierte" en parte).
--     → Debe cheques_diferidos_emitidos (revierte pasivo)
--     → Haber proveedores (la deuda vuelve a estar)
--   emitted → cancelled: anulación local (cheque nunca entregado).
--     → Debe cheques_diferidos_emitidos (revierte pasivo)
--     → Haber proveedores (la deuda vuelve a estar)
--
-- Para no duplicar asientos, identificamos cada transición con source_id =
-- issued_check_id y source_table = 'issued_checks'. Si el row ya tiene
-- asiento, no se vuelve a generar.

create or replace function public.emit_journal_for_issued_check_transition()
returns trigger
language plpgsql
security definer
set search_path = public
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
      p_source_id      := new.id
    );
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_issued_check: % (issued_check=%)', sqlerrm, new.id;
  end;

  return new;
end;
$$;

comment on function public.emit_journal_for_issued_check_transition() is
  'A1 — Genera asientos cuando un cheque propio pasa de emitted a cashed/rejected/cancelled. Cashed revierte pasivo + egresa banco. Rejected/cancelled revierte pasivo + restaura deuda con proveedor.';

create trigger issued_checks_after_transition_journal
  after update of status on public.issued_checks
  for each row
  when (old.status is distinct from new.status)
  execute function public.emit_journal_for_issued_check_transition();

------------------------------------------------------------------------------
-- A2 — Asientos automáticos para purchase_invoices
------------------------------------------------------------------------------
-- Espejo de L.2c invoices pero del lado compras. Factura fiscal:
--   Debe compras  imp_neto + imp_op_ex + imp_tot_conc
--   Debe iva_credito  imp_iva (cuando > 0)
--   Debe percepciones_iibb_pagadas  imp_trib (cuando > 0)
--   Haber proveedores  imp_total
--
-- Factura interna (canal interno): SKIP (mismo criterio L.2c).
-- NC compra: invierte signos (Debe proveedores / Haber compras + IVA).
-- Status emitted → received (insert), received → cancelled (reversal).

create or replace function public.build_purchase_invoice_journal_lines(
  p_invoice public.purchase_invoices,
  p_reverse boolean default false
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_lines       jsonb := '[]'::jsonb;
  v_kind_factor numeric := case when p_invoice.kind = 'nc' then -1 else 1 end;
  v_sign        numeric := case when p_reverse then -1 else 1 end;
  v_dir         numeric := v_kind_factor * v_sign;
  v_desc_prefix text;
begin
  v_desc_prefix := case when p_reverse then 'Anulación ' else '' end || case p_invoice.kind
    when 'factura' then 'Factura compra '
    when 'nc'      then 'NC compra '
    when 'nd'      then 'ND compra '
  end || coalesce(p_invoice.letter::text, 'X');

  if v_dir > 0 then
    -- Asiento directo: factura/ND emitida normal
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'proveedores',
      'credit', p_invoice.imp_total,
      'description', v_desc_prefix || ' — proveedor'
    );
    if p_invoice.imp_neto > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'compras',
        'debit', p_invoice.imp_neto,
        'description', v_desc_prefix || ' — neto'
      );
    end if;
    if p_invoice.imp_iva > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'iva_credito',
        'debit', p_invoice.imp_iva,
        'description', v_desc_prefix || ' — IVA crédito'
      );
    end if;
    if p_invoice.imp_trib > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'percepciones_iibb_pagadas',
        'debit', p_invoice.imp_trib,
        'description', v_desc_prefix || ' — percepciones'
      );
    end if;
  else
    -- Invertido: NC compra (compensa factura) o anulación
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'proveedores',
      'debit', p_invoice.imp_total,
      'description', v_desc_prefix || ' — proveedor'
    );
    if p_invoice.imp_neto > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'compras',
        'credit', p_invoice.imp_neto,
        'description', v_desc_prefix || ' — neto'
      );
    end if;
    if p_invoice.imp_iva > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'iva_credito',
        'credit', p_invoice.imp_iva,
        'description', v_desc_prefix || ' — IVA crédito'
      );
    end if;
    if p_invoice.imp_trib > 0 then
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'percepciones_iibb_pagadas',
        'credit', p_invoice.imp_trib,
        'description', v_desc_prefix || ' — percepciones'
      );
    end if;
  end if;

  return v_lines;
end;
$$;

create or replace function public.emit_journal_for_purchase_invoice(
  p_invoice public.purchase_invoices,
  p_reverse boolean default false,
  p_reversed_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_fiscal boolean;
  v_lines     jsonb;
  v_desc      text;
  v_number    text;
begin
  select is_fiscal into v_is_fiscal
    from public.invoicing_channels
   where id = p_invoice.channel_id;

  -- Skip canales internos: gasto sin factura formal, no va al libro contable.
  if v_is_fiscal is null or not v_is_fiscal then
    return null;
  end if;

  v_lines := public.build_purchase_invoice_journal_lines(p_invoice, p_reverse);

  v_number := coalesce(p_invoice.letter::text, '') ||
              lpad(p_invoice.punto_venta::text, 4, '0') || '-' ||
              lpad(p_invoice.numero::text, 8, '0');

  v_desc := case when p_reverse then 'Anulación ' else '' end || case p_invoice.kind
    when 'factura' then 'Factura compra '
    when 'nc'      then 'NC compra '
    when 'nd'      then 'ND compra '
  end || v_number;

  begin
    return public.create_journal_entry(
      p_entry_date      := p_invoice.fecha,
      p_accrual_period  := to_char(p_invoice.fecha, 'YYYY-MM'),
      p_description     := v_desc,
      p_lines           := v_lines,
      p_source_table    := 'purchase_invoices',
      p_source_id       := p_invoice.id,
      p_channel_id      := p_invoice.channel_id,
      p_is_reversal     := p_reverse,
      p_reversed_entry_id := p_reversed_entry_id
    );
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_purchase_invoice: % (id=%)', sqlerrm, p_invoice.id;
    return null;
  end;
end;
$$;

create or replace function public.purchase_invoices_after_insert_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'received' then
    perform public.emit_journal_for_purchase_invoice(new, false);
  end if;
  return new;
end;
$$;

create trigger purchase_invoices_after_insert_journal_trg
  after insert on public.purchase_invoices
  for each row execute function public.purchase_invoices_after_insert_journal();

create or replace function public.purchase_invoices_after_update_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original uuid;
begin
  if old.status = 'received' and new.status = 'cancelled' then
    select id into v_original
      from public.journal_entries
     where source_table = 'purchase_invoices'
       and source_id    = new.id
       and is_reversal  = false
     order by created_at asc limit 1;
    perform public.emit_journal_for_purchase_invoice(new, true, v_original);
  end if;
  return new;
end;
$$;

create trigger purchase_invoices_after_update_journal_trg
  after update of status on public.purchase_invoices
  for each row
  when (old.status is distinct from new.status)
  execute function public.purchase_invoices_after_update_journal();

create or replace function public.purchase_invoices_after_delete_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.journal_entries
   where source_table = 'purchase_invoices'
     and source_id    = old.id;
  return old;
end;
$$;

create trigger purchase_invoices_after_delete_journal_trg
  after delete on public.purchase_invoices
  for each row execute function public.purchase_invoices_after_delete_journal();

-- Backfill — purchase_invoices recibidas sin asiento
do $$
declare
  v_pi public.purchase_invoices;
begin
  for v_pi in
    select pi.*
      from public.purchase_invoices pi
      left join public.journal_entries je
        on je.source_table = 'purchase_invoices' and je.source_id = pi.id
     where je.id is null
       and pi.status = 'received'
     order by pi.fecha, pi.created_at
  loop
    perform public.emit_journal_for_purchase_invoice(v_pi, false);
  end loop;
end;
$$;

------------------------------------------------------------------------------
-- B1 — UNIQUE parcial en endorsed_check_id (anti doble endoso)
------------------------------------------------------------------------------
-- Sin esto, race condition entre dos OPs concurrentes que endosan el mismo
-- cheque "en_cartera": ambas leen status OK, ambas actualizan, ambas
-- insertan payment_line con endorsed_check_id duplicado. Resultado: el
-- cheque queda "endosado" en dos OPs → doble pago contable.
--
-- El UNIQUE bloquea el segundo INSERT. La RPC create_payment_order debería
-- agregar FOR UPDATE pero esto es la última defensa.

create unique index payment_order_payment_lines_endorsed_check_unique
  on public.payment_order_payment_lines (endorsed_check_id)
  where endorsed_check_id is not null;

comment on index public.payment_order_payment_lines_endorsed_check_unique is
  'B1 — Anti doble endoso del mismo cheque. Bloquea concurrent INSERT del segundo endoso.';

------------------------------------------------------------------------------
-- B2 — Numeración atómica para comprobantes internos
------------------------------------------------------------------------------
-- Hoy lib/inngest/functions/issue-invoice.ts hace MAX(numero)+1 sin lock.
-- Bajo emisión concurrente del mismo (channel, pos, kind), dos workers
-- pueden reservar el mismo numero → INSERT viola unique_numbering → retry
-- → en el peor caso quedan facturas en estado emitting indefinido.
--
-- next_internal_invoice_numero usa advisory transactional lock por
-- (channel, pos, kind) para serializar la reserva sin tocar el RPC
-- existente. Retorna el siguiente numero + lo persiste atomically en una
-- transacción separada via SQL function (caller pasa el draft id).

create or replace function public.next_internal_invoice_numero_atomic(
  p_invoice_id uuid,
  p_channel_id text,
  p_punto_venta int,
  p_kind text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
  v_lock_key bigint;
begin
  -- Hash determinístico de (channel, pos, kind) para advisory lock.
  -- hashtext devuelve int4; lo combinamos con bitshift para int8.
  v_lock_key := hashtextextended(p_channel_id || '|' || p_punto_venta::text || '|' || p_kind, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  select coalesce(max(numero), 0) + 1
    into v_next
    from public.invoices
   where channel_id = p_channel_id
     and punto_venta = p_punto_venta
     and kind = p_kind;

  update public.invoices
     set numero = v_next
   where id = p_invoice_id;

  return v_next;
end;
$$;

comment on function public.next_internal_invoice_numero_atomic is
  'B2 — Reserva atómica del próximo numero interno con advisory lock por (channel, pos, kind). Elimina race condition de MAX+1.';

revoke all on function public.next_internal_invoice_numero_atomic(uuid, text, int, text) from public;
grant execute on function public.next_internal_invoice_numero_atomic(uuid, text, int, text) to service_role;

set row_security = on;
