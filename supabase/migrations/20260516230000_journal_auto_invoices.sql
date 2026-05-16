-- L.2c — Asientos automáticos desde invoices (comprobantes emitidos).
--
-- Una venta emitida genera UN asiento contable. NC y ND también, con la
-- semántica contable correspondiente (NC = reversa parcial, ND = como
-- factura). Internal (channel.is_fiscal=false) no tiene IVA ni
-- percepciones.
--
-- Triggers:
--   - AFTER INSERT con status=emitted (import AFIP histórico): generar.
--   - AFTER UPDATE de status:
--       draft/emitting/failed → emitted  → generar.
--       emitted → cancelled              → generar asiento de REVERSAL.
--   - AFTER DELETE: borrar el/los asientos asociados (cascade lines).
--
-- Estructura del asiento (factura fiscal):
--   Debe:  Clientes              imp_total
--   Haber: Ventas                imp_neto + imp_op_ex + imp_tot_conc
--   Haber: IVA Débito Fiscal     imp_iva
--   Haber: Percepciones IIBB     imp_trib   (cuando > 0)
--
-- Estructura del asiento (factura interna, sin IVA ni perc):
--   Debe:  Clientes              imp_total
--   Haber: Ventas                imp_total
--
-- NC: mismo asiento con Debe/Haber invertidos (compensa la factura
-- origen). ND: idéntico a factura.

set row_security = off;

------------------------------------------------------------------------------
-- 1. build_invoice_journal_lines — helper que arma el jsonb de líneas
------------------------------------------------------------------------------
create or replace function public.build_invoice_journal_lines(
  p_invoice public.invoices,
  p_is_fiscal boolean,
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
  v_revenue_amt numeric;
  v_desc_prefix text;
begin
  v_desc_prefix := case
    when p_reverse then 'Anulación '
    else ''
  end || case p_invoice.kind
    when 'factura' then 'Factura '
    when 'nc'      then 'Nota de crédito '
    when 'nd'      then 'Nota de débito '
  end || coalesce(p_invoice.letter::text, 'X');

  if v_dir > 0 then
    -- Asiento "directo" (factura emitida / ND emitida / anulación de NC)
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'clientes',
      'debit', p_invoice.imp_total,
      'description', v_desc_prefix || ' — cliente'
    );
    if p_is_fiscal then
      v_revenue_amt := p_invoice.imp_neto + p_invoice.imp_op_ex + p_invoice.imp_tot_conc;
      if v_revenue_amt > 0 then
        v_lines := v_lines || jsonb_build_object(
          'system_role', 'ventas',
          'credit', v_revenue_amt,
          'description', v_desc_prefix || ' — neto'
        );
      end if;
      if p_invoice.imp_iva > 0 then
        v_lines := v_lines || jsonb_build_object(
          'system_role', 'iva_debito',
          'credit', p_invoice.imp_iva,
          'description', v_desc_prefix || ' — IVA débito'
        );
      end if;
      if p_invoice.imp_trib > 0 then
        v_lines := v_lines || jsonb_build_object(
          'system_role', 'percepciones_iibb_cobradas',
          'credit', p_invoice.imp_trib,
          'description', v_desc_prefix || ' — percepciones'
        );
      end if;
    else
      -- Internal: no hay IVA, todo a ventas
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'ventas',
        'credit', p_invoice.imp_total,
        'description', v_desc_prefix || ' — ingreso interno'
      );
    end if;
  else
    -- Asiento "invertido" (NC emitida / anulación de factura)
    v_lines := v_lines || jsonb_build_object(
      'system_role', 'clientes',
      'credit', p_invoice.imp_total,
      'description', v_desc_prefix || ' — cliente'
    );
    if p_is_fiscal then
      v_revenue_amt := p_invoice.imp_neto + p_invoice.imp_op_ex + p_invoice.imp_tot_conc;
      if v_revenue_amt > 0 then
        v_lines := v_lines || jsonb_build_object(
          'system_role', 'ventas',
          'debit', v_revenue_amt,
          'description', v_desc_prefix || ' — neto'
        );
      end if;
      if p_invoice.imp_iva > 0 then
        v_lines := v_lines || jsonb_build_object(
          'system_role', 'iva_debito',
          'debit', p_invoice.imp_iva,
          'description', v_desc_prefix || ' — IVA débito'
        );
      end if;
      if p_invoice.imp_trib > 0 then
        v_lines := v_lines || jsonb_build_object(
          'system_role', 'percepciones_iibb_cobradas',
          'debit', p_invoice.imp_trib,
          'description', v_desc_prefix || ' — percepciones'
        );
      end if;
    else
      v_lines := v_lines || jsonb_build_object(
        'system_role', 'ventas',
        'debit', p_invoice.imp_total,
        'description', v_desc_prefix || ' — ingreso interno'
      );
    end if;
  end if;

  return v_lines;
end;
$$;

comment on function public.build_invoice_journal_lines is
  'Arma el array jsonb de líneas para el asiento de una invoice. p_reverse=true invierte signos (para reversals).';

------------------------------------------------------------------------------
-- 2. emit_journal_for_invoice
------------------------------------------------------------------------------
create or replace function public.emit_journal_for_invoice(
  p_invoice public.invoices,
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
  v_entry     uuid;
begin
  select is_fiscal into v_is_fiscal from public.invoicing_channels where id = p_invoice.channel_id;
  if v_is_fiscal is null then
    raise warning 'emit_journal_for_invoice: channel % no encontrado', p_invoice.channel_id;
    return null;
  end if;

  v_lines := public.build_invoice_journal_lines(p_invoice, v_is_fiscal, p_reverse);

  v_number := coalesce(p_invoice.letter::text, '') ||
              lpad(p_invoice.punto_venta::text, 4, '0') || '-' ||
              lpad(p_invoice.numero::text, 8, '0');

  v_desc := case
    when p_reverse then 'Anulación '
    else ''
  end || case p_invoice.kind
    when 'factura' then 'Factura '
    when 'nc'      then 'Nota de crédito '
    when 'nd'      then 'Nota de débito '
  end || v_number;

  begin
    v_entry := public.create_journal_entry(
      p_entry_date      := p_invoice.fecha,
      p_accrual_period  := to_char(p_invoice.fecha, 'YYYY-MM'),
      p_description     := v_desc,
      p_lines           := v_lines,
      p_source_table    := 'invoices',
      p_source_id       := p_invoice.id,
      p_channel_id      := p_invoice.channel_id,
      p_is_reversal     := p_reverse,
      p_reversed_entry_id := p_reversed_entry_id
    );
    return v_entry;
  exception when sqlstate 'P0002' then
    raise warning 'emit_journal_for_invoice: % (invoice=%)', sqlerrm, p_invoice.id;
    return null;
  end;
end;
$$;

comment on function public.emit_journal_for_invoice is
  'Genera el asiento para una invoice (status emitted). p_reverse=true genera el contra-asiento (anulación).';

------------------------------------------------------------------------------
-- 3. Trigger AFTER INSERT
------------------------------------------------------------------------------
create or replace function public.invoices_after_insert_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'emitted' then
    perform public.emit_journal_for_invoice(new, false);
  end if;
  return new;
end;
$$;

create trigger invoices_after_insert_journal_trg
  after insert on public.invoices
  for each row execute function public.invoices_after_insert_journal();

------------------------------------------------------------------------------
-- 4. Trigger AFTER UPDATE de status
------------------------------------------------------------------------------
create or replace function public.invoices_after_update_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_entry uuid;
begin
  -- Transiciones que importan: → emitted (generar) y emitted → cancelled (reversal).
  if old.status <> 'emitted' and new.status = 'emitted' then
    perform public.emit_journal_for_invoice(new, false);
  elsif old.status = 'emitted' and new.status = 'cancelled' then
    -- Buscar el asiento original (no-reversal) de esta invoice
    select id into v_original_entry
      from public.journal_entries
     where source_table = 'invoices'
       and source_id = new.id
       and is_reversal = false
     order by created_at asc
     limit 1;
    perform public.emit_journal_for_invoice(new, true, v_original_entry);
  end if;
  return new;
end;
$$;

create trigger invoices_after_update_journal_trg
  after update of status on public.invoices
  for each row
  when (old.status is distinct from new.status)
  execute function public.invoices_after_update_journal();

------------------------------------------------------------------------------
-- 5. Trigger AFTER DELETE
------------------------------------------------------------------------------
create or replace function public.invoices_after_delete_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.journal_entries
   where source_table = 'invoices'
     and source_id    = old.id;
  return old;
end;
$$;

create trigger invoices_after_delete_journal_trg
  after delete on public.invoices
  for each row execute function public.invoices_after_delete_journal();

------------------------------------------------------------------------------
-- 6. Backfill — invoices emitted sin asiento
------------------------------------------------------------------------------
do $$
declare
  v_inv public.invoices;
begin
  for v_inv in
    select i.*
      from public.invoices i
      left join public.journal_entries j
        on j.source_table = 'invoices' and j.source_id = i.id
     where j.id is null
       and i.status = 'emitted'
     order by i.fecha, i.created_at
  loop
    perform public.emit_journal_for_invoice(v_inv, false);
  end loop;
end;
$$;

set row_security = on;
