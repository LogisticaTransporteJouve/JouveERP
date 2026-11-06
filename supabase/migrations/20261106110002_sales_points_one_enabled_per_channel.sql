SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- At most one enabled point of sale per invoicing channel, in the database.
--
-- configurePosAction checked it in TypeScript (read the channel's enabled POS,
-- then update), so two concurrent «Habilitar» on the same channel both
-- passed. Receipts and payment orders number with the channel's lowest
-- enabled POS (loadChannelPos), so a second one would move that numbering.
--
-- Existing rows: if a channel already has more than one enabled POS (only
-- possible from before the TypeScript check, or from that race), the lowest
-- one stays enabled, the one receipts and payment orders already number
-- with, and the others are disabled (their channel, nickname and history are
-- kept, so an admin can swap them back in Administración AFIP). Each one is
-- reported with a NOTICE. The query in
-- docs/pendientes/2026-11-06-escrituras-cheques-archivos.md lists them before
-- promoting.
--
-- Rollback: older code enforces the same rule before writing, so it never
-- trips the index; it shows a refused update as the raw database error.

do $$
declare
  v_row record;
begin
  for v_row in
    select sp.numero, sp.channel_id
      from public.sales_points sp
     where sp.is_enabled
       and sp.channel_id is not null
       and exists (
         select 1 from public.sales_points lower_sp
          where lower_sp.channel_id = sp.channel_id
            and lower_sp.is_enabled
            and lower_sp.numero < sp.numero
       )
  loop
    raise notice 'sales_points: POS % of channel % disabled (the channel already had a lower enabled POS)',
      v_row.numero, v_row.channel_id;
    update public.sales_points
       set is_enabled = false
     where numero = v_row.numero;
  end loop;
end;
$$;

-- A handful of rows: the build is immediate. CONCURRENTLY cannot run in this
-- migration's transaction.
-- squawk-ignore require-concurrent-index-creation
create unique index sales_points_one_enabled_per_channel
  on public.sales_points (channel_id)
  where is_enabled;
