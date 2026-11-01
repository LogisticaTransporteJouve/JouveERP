SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Otras ventas numbers its remitos and recibos internos on a point of sale of
-- its own. AFIP's points of sale can only go to a fiscal channel
-- (guard_sales_point_channel), so the internal one is a local row that never
-- syncs (last_synced_at null). 9001 stays clear of AFIP's numbering.
insert into public.sales_points (numero, channel_id, nickname, is_enabled)
select 9001, c.id, 'Remitos internos', true
from public.invoicing_channels c
where c.id = 'jouve_internal'
on conflict (numero) do nothing;
