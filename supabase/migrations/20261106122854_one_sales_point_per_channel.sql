SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- One point of sale per channel: 1 for the internal channel, 3 (AFIP) for the
-- fiscal one (owner decision, 2026-11-06). Every comprobante, receipt and
-- payment order of a channel numbers in its enabled POS.
--
--   1. POS 9001 («Remitos internos», 20261101190000) goes away. Nothing was
--      ever numbered in it in production; if a row still references it the
--      POS is only disabled (and the index below still holds).
--   2. A partial unique index enforces what configurePosAction already
--      checked: at most one enabled POS per channel. If a channel has more
--      than one enabled, the migration fails so they are fixed by hand.
--
-- Rollback: older code only reads the enabled POS of a channel; it does not
-- need 9001 nor a second enabled POS.

do $$
begin
  if exists (select 1 from public.invoices where punto_venta = 9001)
     or exists (select 1 from public.receipts where punto_venta = 9001)
     or exists (select 1 from public.payment_orders where punto_venta = 9001) then
    update public.sales_points set is_enabled = false where numero = 9001;
  else
    delete from public.sales_points where numero = 9001;
  end if;
end;
$$;

do $$
declare
  v_channel text;
begin
  select channel_id into v_channel
    from public.sales_points
   where is_enabled and channel_id is not null
   group by channel_id
  having count(*) > 1
   limit 1;
  if v_channel is not null then
    raise exception 'El canal % tiene más de un punto de venta habilitado: dejá uno solo antes de aplicar esta migración.', v_channel;
  end if;
end;
$$;

create unique index sales_points_one_enabled_per_channel
  on public.sales_points (channel_id)
  where is_enabled;
