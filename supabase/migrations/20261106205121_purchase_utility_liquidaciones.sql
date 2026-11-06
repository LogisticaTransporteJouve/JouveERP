SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Public-service liquidaciones and the Recibo M in the ARCA received tray. A
-- utility's bill (Liquidación de servicios públicos clase A, tipo 17, or
-- clase B, tipo 18: electricity, gas) and a Recibo M (tipo 54) are purchases,
-- but the tray left them unsupported. They now load as a factura of their
-- letter (the M as an A, which discriminates IVA the same way) that keeps its
-- own AFIP code (purchase_invoices.cbte_tipo_afip), so the Libro IVA Digital
-- TXT reports them as ARCA has them.
--
--   1. purchase_invoices_cbte_tipo_afip_check also admits 17 and 54 on a
--      factura A and 18 on a factura B.
--   2. The tray's unsupported vouchers of those types become pending, with
--      their kind and letter (a clase B listed with only its total, all net,
--      as the reader takes a B), and are linked to a purchase already loaded
--      with their number and amounts.
--
-- Rollback: older code never writes 17, 18 or 54 and reads the column only
-- for the TXT. A pending one accepted by older code loads as a factura of its
-- letter without its own code, as one loaded by hand does.

-- Replaced by a wider check right below: every row the old one admitted, the
-- new one admits too.
alter table public.purchase_invoices
  -- squawk-ignore ban-drop-constraint
  drop constraint purchase_invoices_cbte_tipo_afip_check;

alter table public.purchase_invoices
  add constraint purchase_invoices_cbte_tipo_afip_check check (
    cbte_tipo_afip is null
    or (kind = 'factura' and (
         (cbte_tipo_afip in (4, 17, 51, 54, 63) and letter = 'A')
      or (cbte_tipo_afip in (9, 18, 64) and letter = 'B')
      or (cbte_tipo_afip = 15 and letter = 'C')))
    or (kind = 'nd' and cbte_tipo_afip = 52 and letter = 'A')
    or (kind = 'nc' and cbte_tipo_afip = 53 and letter = 'A')
  ) not valid;

-- squawk-ignore constraint-missing-not-valid
alter table public.purchase_invoices validate constraint purchase_invoices_cbte_tipo_afip_check;

comment on column public.purchase_invoices.cbte_tipo_afip is
  'Código AFIP del comprobante cuando no es el de su clase y letra (4/9/15 recibos, 63/64 liquidaciones A/B, 17/18 liquidaciones de servicios públicos A/B, 51/52/53/54 factura, ND, NC y recibo M cargados como A); null en el resto. Lo usa el TXT del Libro IVA Digital.';

-- 2. The tray's vouchers of these types, unsupported until now; linked in a
-- second statement, which sees them pending.
do $$
declare
  v_ids uuid[];
begin
  with moved as (
    update public.arca_received_vouchers v
       set kind = 'factura',
           letter = case when v.cbte_tipo = 18 then 'B' else 'A' end,
           -- A B listed with only its total is all net, as the reader takes
           -- it (lib/afip/mis-comprobantes/parse.ts).
           imp_neto_gravado = case
             when v.cbte_tipo = 18
              and v.imp_neto_gravado + v.imp_no_gravado + v.imp_op_exentas
                  + v.imp_iva + v.imp_trib = 0
             then v.imp_total
             else v.imp_neto_gravado
           end,
           status = 'pending_review'
     where v.status = 'unsupported'
       and v.cbte_tipo in (17, 18, 54)
    returning v.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from moved;
  if cardinality(v_ids) > 0 then
    perform public.link_received_vouchers(v_ids);
  end if;
end;
$$;
