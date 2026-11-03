SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A fiscal sales voucher in dollars needs the day's rate (audit w1-s1 F8).
--
-- build_invoice_journal_lines and libro_iva_ventas convert with
-- coalesce(nullif(cotizacion, 0), get_exchange_rate(..), 1): a stored 1 is not
-- null, so a dollar voucher with cotizacion 1 is booked 1:1 and the BCRA rate
-- is never read. The app path refuses it (lib/afip/rules.ts
-- fiscalVoucherIssue); this guard covers every other writer, like
-- guard_purchase_invoice_cotizacion does for purchases.
--
-- Fiscal channels only: internal vouchers post no entry and enter no libro.
-- It fires on insert and when moneda or cotizacion change, so existing rows
-- and unrelated updates (status, PDF hash) are untouched. AFIP always returns
-- MonCotiz for a dollar voucher, so the ARCA import (sync-issued) is not
-- refused; a voucher it could not import is reported per row.

create or replace function public.guard_invoice_cotizacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.moneda, 'PES') <> 'PES'
     and coalesce(new.cotizacion, 0) <= 1
     and (tg_op = 'INSERT'
          or new.moneda is distinct from old.moneda
          or new.cotizacion is distinct from old.cotizacion)
     and exists (
       select 1 from public.invoicing_channels ch
        where ch.id = new.channel_id and ch.is_fiscal
     ) then
    raise exception 'Cargá la cotización del dólar del día para el comprobante en dólares (tiene que ser mayor a 1)'
      using errcode = '23514', hint = 'jouve_guard';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_invoice_cotizacion() from public, anon, authenticated;

create trigger invoices_cotizacion
  before insert or update of moneda, cotizacion on public.invoices
  for each row execute function public.guard_invoice_cotizacion();
