SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- First step of retiring the DZ division (docs/plan-separacion-fiscal-interno.md, PR 0):
--   * guard_channel_active: no row may be created on, or moved to, an inactive
--     invoicing channel. Rows already there keep working (corrections,
--     cancellations), and a NULL channel passes.
--   * dz_open_items(): what DZ still has pending, run by the owner from the SQL
--     editor before the channels are retired.
-- Nothing is deactivated here.

create or replace function public.guard_channel_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel text := to_jsonb(new) ->> tg_argv[0];
  v_name    text;
  v_active  boolean;
begin
  if v_channel is null then
    return new;
  end if;

  select name, is_active into v_name, v_active
    from public.invoicing_channels where id = v_channel;
  if found and not v_active then
    raise exception 'El canal % está inactivo: no se pueden crear ni mover registros a ese canal', v_name
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_channel_active() from public, anon, authenticated;

-- Two triggers per table: TG_ARGV is only readable inside the function, so each
-- WHEN names its column literally.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('invoices', 'channel_id'),
      ('purchase_invoices', 'channel_id'),
      ('receipts', 'channel_id'),
      ('payment_orders', 'channel_id'),
      ('transactions', 'channel_id'),
      ('loans', 'channel_id'),
      ('payroll_payments', 'channel_id'),
      ('recurring_payments', 'channel_id'),
      ('shipments', 'channel_id'),
      ('trips', 'channel_id'),
      ('suppliers', 'default_channel_id')
    ) as v(tbl, col)
  loop
    execute format(
      'create trigger %I before insert on public.%I for each row when (new.%I is not null) execute function public.guard_channel_active(%L)',
      t.tbl || '_channel_active_ins', t.tbl, t.col, t.col);
    execute format(
      'create trigger %I before update of %I on public.%I for each row when (new.%I is distinct from old.%I) execute function public.guard_channel_active(%L)',
      t.tbl || '_channel_active_upd', t.col, t.tbl, t.col, t.col, t.col);
  end loop;
end;
$$;

-- One row per pending DZ item. Amounts per currency (PES/ARS -> ARS, DOL/USD -> USD).
create or replace function public.dz_open_items()
returns table (item_kind text, item_id uuid, item_date date, currency text, amount numeric, detail text)
language sql
stable
security definer
set search_path = ''
as $$
  with cur(raw, iso) as (values ('PES', 'ARS'), ('ARS', 'ARS'), ('DOL', 'USD'), ('USD', 'USD')),
  dz as (select id from public.invoicing_channels where division = 'dz')
  select 'comprobante_pendiente', d.invoice_id, d.fecha,
         coalesce((select iso from cur where raw = d.moneda), d.moneda), d.open_amount,
         d.kind || ' ' || d.punto_venta || '-' || coalesce(d.numero::text, '?')
    from public.v_aging_documents d
   where d.channel_id in (select id from dz) and d.open_amount > 0.01
  union all
  select 'compra_pendiente', d.purchase_invoice_id, d.fecha,
         coalesce((select iso from cur where raw = d.moneda), d.moneda), d.open_amount,
         d.kind || ' ' || d.punto_venta || '-' || d.numero
    from public.v_supplier_aging_documents d
   where d.channel_id in (select id from dz) and d.open_amount > 0.01
  union all
  select 'recibo_sin_imputar', r.id, r.receipt_date, r.currency,
         r.total_amount - coalesce(sum(ra.amount_applied), 0),
         'recibo ' || r.punto_venta || '-' || r.numero
    from public.receipts r
    left join public.receipt_allocations ra on ra.receipt_id = r.id
   where r.channel_id in (select id from dz) and r.status = 'issued'
   group by r.id
  having r.total_amount - coalesce(sum(ra.amount_applied), 0) > 0.01
  union all
  select 'op_sin_imputar', p.id, p.payment_date, p.currency,
         p.total_amount - coalesce(sum(pa.amount_applied), 0),
         'OP ' || p.punto_venta || '-' || p.numero
    from public.payment_orders p
    left join public.payment_order_allocations pa on pa.payment_order_id = p.id
   where p.channel_id in (select id from dz) and p.status = 'issued'
   group by p.id
  having p.total_amount - coalesce(sum(pa.amount_applied), 0) > 0.01
  union all
  select 'nc_sin_origen', i.id, i.fecha,
         coalesce((select iso from cur where raw = i.moneda), i.moneda), i.imp_total,
         'NC ' || i.punto_venta || '-' || coalesce(i.numero::text, '?')
    from public.invoices i
   where i.channel_id in (select id from dz) and i.kind = 'nc'
     and i.status = 'emitted' and i.invoice_origin_id is null
  union all
  select 'cheque_en_curso', c.id, c.due_date, c.currency, c.amount,
         'cheque ' || c.check_number || ' (' || c.status || ')'
    from public.checks c
    join public.receipts r on r.id = c.source_receipt_id
   where r.channel_id in (select id from dz)
     and c.status in ('en_cartera', 'depositado', 'endosado')
  union all
  select 'cheque_emitido', ic.id, ic.due_date, ic.currency, ic.amount,
         'cheque ' || ic.check_number
    from public.issued_checks ic
    join public.payment_orders p on p.id = ic.payment_order_id
   where p.channel_id in (select id from dz) and ic.status = 'emitted'
  union all
  select 'cuota_prestamo', li.id, li.due_date, l.currency, li.amount,
         l.description || ' cuota ' || li.number
    from public.loan_installments li
    join public.loans l on l.id = li.loan_id
   where l.channel_id in (select id from dz) and li.status = 'pendiente'
     and l.status = 'active'
  union all
  select 'pago_recurrente', rp.id, rp.next_due_date, rp.currency, rp.amount, rp.description
    from public.recurring_payments rp
   where rp.channel_id in (select id from dz) and rp.is_active
  union all
  select 'comprobante_sin_emitir', i.id, i.fecha,
         coalesce((select iso from cur where raw = i.moneda), i.moneda), i.imp_total,
         i.kind || ' (' || i.status || ')'
    from public.invoices i
   where i.channel_id in (select id from dz)
     and i.status in ('draft', 'emitting', 'failed');
$$;

revoke all on function public.dz_open_items() from public, anon, authenticated;
grant execute on function public.dz_open_items() to service_role;
