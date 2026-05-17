-- Fix: emit_journal_for_*_invoice rompe cuando imp_total == 0.
--
-- Causa:
--   `build_*_journal_lines` siempre agrega la línea "proveedores"/"clientes"
--   con `credit/debit := p_invoice.imp_total`, sin guard. Si imp_total == 0
--   se inserta una journal_entry_line con credit=0 y debit=0, violando el
--   check `jel_debit_or_credit_exclusive` que exige XOR > 0.
--
-- Síntoma:
--   Bulk import AFIP de compras (1313 filas históricas) — si una sola fila
--   trae imp_total=0 (factura nula / void), el batch entero de 500 falla.
--   El except handler de emit_journal_* solo atrapa P0002 (no_data_found),
--   no 23514 (check_violation), así que el error propaga y mata el seed.
--
-- Fix:
--   Early-return en emit_journal_* si imp_total <= 0. Un comprobante con
--   total 0 no genera asiento (no hay nada que registrar). Defensivo a
--   nivel trigger → cubre tanto bulk import como user-created invoices.

------------------------------------------------------------------------------
-- emit_journal_for_purchase_invoice
------------------------------------------------------------------------------
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
  -- Skip imp_total == 0: no hay nada que asentar, y todas las líneas
  -- generadas tendrían debit=0/credit=0 (viola jel_debit_or_credit_exclusive).
  if coalesce(p_invoice.imp_total, 0) <= 0 then
    return null;
  end if;

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

------------------------------------------------------------------------------
-- emit_journal_for_invoice (mismo bug en sales)
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
  -- Skip imp_total == 0: idem purchase_invoice.
  if coalesce(p_invoice.imp_total, 0) <= 0 then
    return null;
  end if;

  select is_fiscal into v_is_fiscal from public.invoicing_channels where id = p_invoice.channel_id;
  if v_is_fiscal is null then
    raise warning 'emit_journal_for_invoice: channel % no encontrado', p_invoice.channel_id;
    return null;
  end if;

  -- FIX internos: no generar asiento si el canal no es fiscal.
  if not v_is_fiscal then
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
