SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Roadmap 1.0 prerequisites (Resultado de gestión):
--
--   1. journal_document_entry(src, id, p_fiscal_only default false): the entry
--      a document would have, built by the same build_*_journal_lines, for any
--      channel. journal_expected_entry keeps its signature and result: it is
--      journal_document_entry(src, id, true), so the fiscal journal (emit,
--      repost, status, missing) reads exactly what it read before, and older
--      code keeps calling it after a rollback. The management P&L reads the
--      internal documents through it; nothing here writes an entry.
--   2. invoice_items.revenue_kind: 'service' (default) or 'asset_sale' (a
--      truck or other fixed asset sold). A management marker only: no entry,
--      Libro IVA or AFIP request reads it, so it stays editable on an emitted
--      or cancelled comprobante (guard_invoice_items_immutable lets that one
--      column change). Older code ignores the column and gets the default.

-- 1. The entry of a document without the fiscal gate -----------------------------

-- The entry a document would have, from its current row: NULL when the
-- document is not live (missing, cancelled, not yet emitted); otherwise its
-- header and `lines`, which is JSON null when it posts nothing (zero total,
-- skipped movement, or an internal channel when p_fiscal_only).
create or replace function public.journal_document_entry(
  p_source      text,
  p_id          uuid,
  p_fiscal_only boolean default false
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_inv     public.invoices;
  v_pi      public.purchase_invoices;
  v_r       public.receipts;
  v_po      public.payment_orders;
  v_tx      public.transactions;
  v_date    date;
  v_period  text;
  v_desc    text;
  v_channel text;
  v_cc      uuid;
  v_lines   jsonb;
begin
  if p_source = 'invoices' then
    select * into v_inv from public.invoices where id = p_id;
    if not found or v_inv.status <> 'emitted' then return null; end if;
    v_date := v_inv.fecha;
    v_channel := v_inv.channel_id;
    v_cc := v_inv.cost_center_id;
    v_desc := case v_inv.kind
        when 'factura' then 'Factura '
        when 'nc'      then 'Nota de crédito '
        when 'nd'      then 'Nota de débito '
      end || coalesce(v_inv.letter::text, '')
      || lpad(v_inv.punto_venta::text, 4, '0') || '-' || lpad(v_inv.numero::text, 8, '0');
    if (not p_fiscal_only or public.is_channel_fiscal(v_channel)) and coalesce(v_inv.imp_total, 0) > 0 then
      v_lines := public.build_invoice_journal_lines(v_inv, v_desc);
    end if;

  elsif p_source = 'purchase_invoices' then
    select * into v_pi from public.purchase_invoices where id = p_id;
    if not found or v_pi.status <> 'received' then return null; end if;
    v_date := v_pi.fecha;
    v_channel := v_pi.channel_id;
    v_cc := v_pi.cost_center_id;
    v_desc := case v_pi.kind
        when 'factura' then 'Factura compra '
        when 'nc'      then 'NC compra '
        when 'nd'      then 'ND compra '
      end || coalesce(v_pi.letter::text, '')
      || lpad(v_pi.punto_venta::text, 4, '0') || '-' || lpad(v_pi.numero::text, 8, '0');
    if (not p_fiscal_only or public.is_channel_fiscal(v_channel)) and coalesce(v_pi.imp_total, 0) > 0 then
      v_lines := public.build_purchase_invoice_journal_lines(v_pi, v_desc);
    end if;

  elsif p_source = 'receipts' then
    select * into v_r from public.receipts where id = p_id;
    if not found or v_r.status <> 'issued' then return null; end if;
    v_date := v_r.receipt_date;
    v_channel := v_r.channel_id;
    v_cc := v_r.cost_center_id;
    v_desc := 'Recibo R' || lpad(v_r.punto_venta::text, 4, '0') || '-' || lpad(v_r.numero::text, 8, '0');
    if (not p_fiscal_only or public.is_channel_fiscal(v_channel)) then
      v_lines := public.build_receipt_journal_lines(v_r, v_desc);
    end if;

  elsif p_source = 'payment_orders' then
    select * into v_po from public.payment_orders where id = p_id;
    if not found or v_po.status <> 'issued' then return null; end if;
    v_date := v_po.payment_date;
    v_channel := v_po.channel_id;
    v_cc := v_po.cost_center_id;
    v_desc := 'Orden de pago OP' || lpad(v_po.punto_venta::text, 4, '0') || '-' || lpad(v_po.numero::text, 8, '0');
    if (not p_fiscal_only or public.is_channel_fiscal(v_channel)) then
      v_lines := public.build_payment_order_journal_lines(v_po, v_desc);
    end if;

  elsif p_source = 'transactions' then
    select * into v_tx from public.transactions where id = p_id;
    if not found then return null; end if;
    v_date := v_tx.transaction_date;
    v_period := to_char(v_tx.accrual_month, 'YYYY-MM');
    v_channel := v_tx.channel_id;
    v_cc := v_tx.cost_center_id;
    v_desc := coalesce(v_tx.description, case v_tx.kind
      when 'income'  then 'Ingreso de caja'
      when 'expense' then 'Egreso de caja'
      else 'Transferencia interna'
    end);
    if (not p_fiscal_only or public.is_channel_fiscal(v_channel)) then
      v_lines := public.build_transaction_journal_lines(v_tx, v_desc);
    end if;

  else
    raise exception 'journal_document_entry: origen % desconocido', p_source
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'entry_date',     v_date,
    'accrual_period', coalesce(v_period, to_char(v_date, 'YYYY-MM')),
    'description',    v_desc,
    'channel_id',     v_channel,
    'cost_center_id', v_cc,
    'lines',          v_lines
  );
end;
$$;

revoke all on function public.journal_document_entry(text, uuid, boolean) from public, anon, authenticated;

-- What the fiscal journal posts: internal channels post nothing.
create or replace function public.journal_expected_entry(p_source text, p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.journal_document_entry(p_source, p_id, true);
$$;

revoke all on function public.journal_expected_entry(text, uuid) from public, anon, authenticated;

-- 2. Revenue kind of a sold item ---------------------------------------------------

alter table public.invoice_items
  add column revenue_kind text not null default 'service'
    constraint invoice_items_revenue_kind_check check (revenue_kind in ('service', 'asset_sale'));

comment on column public.invoice_items.revenue_kind is
  'Gestión: service (servicio) o asset_sale (venta de un bien de uso, p. ej. un camión). No cambia asiento, Libro IVA ni AFIP.';

create or replace function public.guard_invoice_items_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  -- revenue_kind is a management marker, not part of the fiscal document.
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'revenue_kind') = (to_jsonb(old) - 'revenue_kind') then
    return new;
  end if;
  select status into v_status from public.invoices where id = v_invoice_id;
  if v_status in ('emitted', 'cancelled') then
    raise exception
      'No se pueden modificar los items de un comprobante emitido o anulado (estado %)', v_status
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.guard_invoice_items_immutable() from public, anon, authenticated;
