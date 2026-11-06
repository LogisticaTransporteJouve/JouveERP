SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- M vouchers in the ARCA received tray. A Factura M (tipo 51), ND M (52) or
-- NC M (53) discriminates IVA for the buyer as an A does, but the tray left
-- them unsupported. They now load as a factura, ND or NC A that keeps its own
-- AFIP code (purchase_invoices.cbte_tipo_afip, 20261106190000), so the Libro
-- IVA Digital TXT reports them as ARCA has them.
--
--   1. purchase_invoices_cbte_tipo_afip_check also admits 51 on a factura A,
--      52 on an ND A and 53 on an NC A.
--   2. The tray's unsupported M vouchers become pending, with their kind and
--      letter, and are linked to a purchase already loaded with their number
--      and amounts.
--
-- Rollback: older code never writes 51-53 and reads the column only for the
-- TXT, where these purchases keep reporting their own code.

-- Replaced by a wider check right below: every row the old one admitted, the
-- new one admits too.
alter table public.purchase_invoices
  -- squawk-ignore ban-drop-constraint
  drop constraint purchase_invoices_cbte_tipo_afip_check;

alter table public.purchase_invoices
  add constraint purchase_invoices_cbte_tipo_afip_check check (
    cbte_tipo_afip is null
    or (kind = 'factura' and (
         (cbte_tipo_afip in (4, 51, 63) and letter = 'A')
      or (cbte_tipo_afip in (9, 64) and letter = 'B')
      or (cbte_tipo_afip = 15 and letter = 'C')))
    or (kind = 'nd' and cbte_tipo_afip = 52 and letter = 'A')
    or (kind = 'nc' and cbte_tipo_afip = 53 and letter = 'A')
  ) not valid;

-- squawk-ignore constraint-missing-not-valid
alter table public.purchase_invoices validate constraint purchase_invoices_cbte_tipo_afip_check;

comment on column public.purchase_invoices.cbte_tipo_afip is
  'Código AFIP del comprobante cuando no es el de su clase y letra (4/9/15 recibos, 63/64 liquidaciones A/B, 51/52/53 factura, ND y NC M cargadas como A); null en el resto. Lo usa el TXT del Libro IVA Digital.';

-- 2. The tray's M vouchers, unsupported until now; linked in a second
-- statement, which sees them pending.
do $$
declare
  v_ids uuid[];
begin
  with moved as (
    update public.arca_received_vouchers v
       set kind = case v.cbte_tipo
                    when 51 then 'factura'
                    when 52 then 'nd'
                    else 'nc'
                  end,
           letter = 'A',
           status = 'pending_review'
     where v.status = 'unsupported'
       and v.cbte_tipo in (51, 52, 53)
    returning v.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from moved;
  if cardinality(v_ids) > 0 then
    perform public.link_received_vouchers(v_ids);
  end if;
end;
$$;
