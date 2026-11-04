SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A received voucher stays «cargada» only while its purchase still says what
-- ARCA says. The link compares the currency and, on a letter A, the IVA too
-- (a B or C keeps its IVA inside the net), besides the total
-- (20261104120000). And it is checked again whenever the purchase changes:
-- editing a linked purchase so its total, IVA or currency no longer match
-- sends the voucher back to pending for a person to look at.
-- Same signatures as 20261104104001 / 20261104120000.

create or replace function public.link_received_vouchers(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with matches as (
    select v.id as voucher_id,
           coalesce(
             (select p.id
                from public.purchase_invoices p
                join public.suppliers s on s.id = p.supplier_id
                join public.invoicing_channels c on c.id = p.channel_id and c.is_fiscal
               where s.cuit = v.issuer_cuit and p.kind = v.kind
                 and p.punto_venta = v.punto_venta and p.numero = v.numero
                 and p.status = 'received' and p.letter = v.letter
                 and public.purchase_matches_received(p.imp_total, p.imp_iva, p.moneda,
                                                      v.imp_total, v.imp_iva, v.moneda, v.letter)
               limit 1),
             (select p.id
                from public.purchase_invoices p
                join public.suppliers s on s.id = p.supplier_id
                join public.invoicing_channels c on c.id = p.channel_id and c.is_fiscal
               where s.cuit = v.issuer_cuit and p.kind = v.kind
                 and p.punto_venta = v.punto_venta and p.numero = v.numero
                 and p.status = 'received' and p.letter is null
                 and public.purchase_matches_received(p.imp_total, p.imp_iva, p.moneda,
                                                      v.imp_total, v.imp_iva, v.moneda, v.letter)
               limit 1)
           ) as purchase_id
      from public.arca_received_vouchers v
     where v.id = any (p_ids)
       and v.status in ('pending_review', 'discarded')
  )
  update public.arca_received_vouchers v
     set status = 'confirmed',
         purchase_invoice_id = m.purchase_id,
         reviewed_at = now(),
         claimed_at = null
    from matches m
   where v.id = m.voucher_id
     and m.purchase_id is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.link_received_vouchers(uuid[]) from public, anon, authenticated;
grant execute on function public.link_received_vouchers(uuid[]) to service_role;

-- Whether a purchase says what the received voucher says: the total within
-- ARCA's rounding cent, the currency, and on a letter A the IVA.
create or replace function public.purchase_matches_received(
  p_total  numeric, p_iva  numeric, p_moneda text,
  v_total  numeric, v_iva  numeric, v_moneda text, v_letter text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select abs(p_total - v_total) <= 0.01
     and coalesce(p_moneda, 'PES') = v_moneda
     and (v_letter is distinct from 'A' or abs(p_iva - v_iva) <= 0.01);
$$;

revoke all on function public.purchase_matches_received(numeric, numeric, text, numeric, numeric, text, text) from public, anon, authenticated;
grant execute on function public.purchase_matches_received(numeric, numeric, text, numeric, numeric, text, text) to service_role;

-- On every change of a purchase: first a voucher linked to it that no longer
-- matches goes back to pending, then the pending ones with its key are linked
-- (the same purchase, or another one with that number).
create or replace function public.purchase_invoices_link_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  update public.arca_received_vouchers v
     set status = 'pending_review',
         purchase_invoice_id = null,
         reviewed_at = null
   where v.purchase_invoice_id = new.id
     and v.status = 'confirmed'
     and not public.purchase_matches_received(new.imp_total, new.imp_iva, new.moneda,
                                              v.imp_total, v.imp_iva, v.moneda, v.letter);

  select array_agg(v.id) into v_ids
    from public.arca_received_vouchers v
    join public.suppliers s on s.cuit = v.issuer_cuit
   where s.id = new.supplier_id
     and v.kind = new.kind
     and v.punto_venta = new.punto_venta
     and v.numero = new.numero
     and v.status in ('pending_review', 'discarded');
  if v_ids is not null then
    perform public.link_received_vouchers(v_ids);
  end if;
  return null;
end;
$$;

revoke all on function public.purchase_invoices_link_received() from public, anon, authenticated;

-- The amounts join the columns that fire it. A purchase that stops being
-- 'received' (anulada) keeps its voucher, shown as such in the tray.
drop trigger purchase_invoices_link_received on public.purchase_invoices;
create trigger purchase_invoices_link_received
  after insert or update of supplier_id, kind, letter, punto_venta, numero, status, channel_id,
                            imp_total, imp_iva, moneda
  on public.purchase_invoices
  for each row
  when (new.status = 'received')
  execute function public.purchase_invoices_link_received();
