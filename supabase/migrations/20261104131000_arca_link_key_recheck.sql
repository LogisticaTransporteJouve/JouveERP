SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A received voucher stays «cargada» only while its purchase is still the
-- same document: editing a linked purchase's supplier, kind, letter, punto
-- de venta, número or channel (not only its amounts, 20261104122000) so the
-- voucher no longer matches sends it back to pending. And a purchase takes
-- at most one voucher: a second voucher that matches the edited key does not
-- link to a purchase another voucher already holds.
-- Same signatures as 20261104122000.

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
                 and not exists (select 1 from public.arca_received_vouchers o
                                  where o.purchase_invoice_id = p.id
                                    and o.status = 'confirmed' and o.id <> v.id)
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
                 and not exists (select 1 from public.arca_received_vouchers o
                                  where o.purchase_invoice_id = p.id
                                    and o.status = 'confirmed' and o.id <> v.id)
               limit 1)
           ) as purchase_id
      from public.arca_received_vouchers v
     where v.id = any (p_ids)
       and v.status in ('pending_review', 'discarded')
  )
  -- Several vouchers of one call can match the same purchase (an old one
  -- without letter): the first voucher (by id) takes it, the rest stay pending.
  , chosen as (
    select voucher_id, purchase_id,
           row_number() over (partition by purchase_id order by voucher_id) as rn
      from matches
     where purchase_id is not null
  )
  update public.arca_received_vouchers v
     set status = 'confirmed',
         purchase_invoice_id = c.purchase_id,
         reviewed_at = now(),
         claimed_at = null
    from chosen c
   where v.id = c.voucher_id
     and c.rn = 1;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.link_received_vouchers(uuid[]) from public, anon, authenticated;
grant execute on function public.link_received_vouchers(uuid[]) to service_role;

-- On every change of a purchase: a voucher linked to it that is no longer
-- the same document (key, fiscal channel, amounts) goes back to pending,
-- then the pending ones with its key are linked.
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
     and not (
           exists (select 1 from public.suppliers s
                    where s.id = new.supplier_id and s.cuit = v.issuer_cuit)
       and exists (select 1 from public.invoicing_channels c
                    where c.id = new.channel_id and c.is_fiscal)
       and new.kind = v.kind
       and new.punto_venta = v.punto_venta
       and new.numero = v.numero
       and (new.letter is null or new.letter = v.letter)
       and public.purchase_matches_received(new.imp_total, new.imp_iva, new.moneda,
                                            v.imp_total, v.imp_iva, v.moneda, v.letter)
     );

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
