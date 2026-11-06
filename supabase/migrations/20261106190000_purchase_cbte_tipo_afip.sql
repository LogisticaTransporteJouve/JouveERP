SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Recibos and liquidaciones in the ARCA received tray. A bank's monthly
-- Liquidación A (tipo 63: commissions, charges and their IVA) and a Recibo A
-- (tipo 4) are purchases with IVA, but the tray left them unsupported. They
-- now load as a factura of their letter; the voucher's own AFIP code is kept
-- on the purchase so the Libro IVA Digital TXT reports it as ARCA has it.
--
--   1. purchase_invoices.cbte_tipo_afip: the AFIP code when it is not the one
--      kind and letter imply (4 Recibo A, 9 Recibo B, 15 Recibo C,
--      63 Liquidación A, 64 Liquidación B); null for every other purchase.
--      Only on a factura of the matching letter.
--   2. purchase_invoice_editable_fields: lists it, so create_purchase_invoice
--      takes it (the tray's accept sets it; the form never sends it).
--   3. The tray's unsupported vouchers of those types become pending, with
--      their kind and letter, and are linked to a purchase already loaded
--      with their number and amounts.
--
-- Rollback: older code never writes the column and reads purchases by
-- naming its columns; its TXT reports these purchases as facturas (as a
-- purchase loaded by hand did before).

alter table public.purchase_invoices
  add column cbte_tipo_afip bigint;

alter table public.purchase_invoices
  add constraint purchase_invoices_cbte_tipo_afip_check check (
    cbte_tipo_afip is null
    or (kind = 'factura' and (
         (cbte_tipo_afip in (4, 63) and letter = 'A')
      or (cbte_tipo_afip in (9, 64) and letter = 'B')
      or (cbte_tipo_afip = 15 and letter = 'C')))
  ) not valid;

-- squawk-ignore constraint-missing-not-valid
alter table public.purchase_invoices validate constraint purchase_invoices_cbte_tipo_afip_check;

comment on column public.purchase_invoices.cbte_tipo_afip is
  'Código AFIP del comprobante cuando no es el de su clase y letra (4/9/15 recibos, 63/64 liquidaciones A/B); null en el resto. Lo usa el TXT del Libro IVA Digital.';

create or replace function public.purchase_invoice_editable_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'channel_id', 'account_id', 'cost_center_id', 'charged_employee_id',
    'supplier_id', 'kind', 'letter', 'punto_venta', 'numero', 'fecha',
    'fch_vto_pago', 'imp_neto', 'imp_iva', 'imp_trib', 'imp_no_gravado',
    'imp_op_exentas', 'imp_perc_iva', 'imp_perc_nacionales', 'imp_perc_iibb',
    'imp_perc_municipales', 'imp_impuestos_internos', 'imp_total', 'moneda',
    'cotizacion', 'cae_proveedor', 'cae_vto_proveedor', 'invoice_origin_id',
    'motivo_nc_nd', 'notes', 'cbte_tipo_afip'
  ]::text[];
$$;

revoke all on function public.purchase_invoice_editable_fields() from public, anon, authenticated;
grant execute on function public.purchase_invoice_editable_fields() to authenticated, service_role;

-- 3. The tray's vouchers of these types, unsupported until now; linked in a
-- second statement, which sees them pending.
do $$
declare
  v_ids uuid[];
begin
  with moved as (
    update public.arca_received_vouchers v
       set kind = 'factura',
           letter = case
             when v.cbte_tipo in (4, 63) then 'A'
             when v.cbte_tipo in (9, 64) then 'B'
             else 'C'
           end,
           status = 'pending_review'
     where v.status = 'unsupported'
       and v.cbte_tipo in (4, 9, 15, 63, 64)
    returning v.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from moved;
  if cardinality(v_ids) > 0 then
    perform public.link_received_vouchers(v_ids);
  end if;
end;
$$;
