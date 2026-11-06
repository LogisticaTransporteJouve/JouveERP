SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Bulk pallet entry numbers its codes in the database, one load at a time per
-- prefix.
--
-- createPalletsBulkAction read the highest <prefix>-NNNN code and then
-- inserted the next ones: two loads with the same prefix at once both read
-- the same highest code and inserted the same codes (pallets.code has no
-- unique constraint, so both went in, with repeated codes).
--
-- create_pallets_bulk takes a transaction advisory lock on the prefix, reads
-- the highest number and inserts the rows in the same transaction, so a
-- second load with that prefix waits for the first and continues after it.
-- The numbering is the action's: <prefix>-<n> padded to at least 4 digits.
--
-- Security invoker: the caller's RLS on pallets decides (owner, admin,
-- warehouse), as the direct insert did; the action keeps its permission gate.
--
-- No table changes. Existing rows are not touched.
--
-- Rollback: older code inserts directly, as before (still racy among
-- older-code loads only).

create function public.create_pallets_bulk(
  p_code_prefix  text,
  p_count        integer,
  p_warehouse_id uuid,
  p_client_id    uuid,
  p_entry_date   date,
  p_product_id   uuid    default null,
  p_quantity     numeric default null,
  p_notes        text    default null,
  p_area_id      uuid    default null,
  p_lot_number   text    default null,
  p_lot_expiry   date    default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_start   numeric;
  v_pad     integer;
  v_created integer;
begin
  if p_code_prefix is null or p_code_prefix !~ '^[A-Za-z0-9-]{1,40}$' then
    raise exception 'El prefijo lleva solo letras, números o guion (hasta 40).'
      using errcode = '22023', hint = 'jouve_guard';
  end if;
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'Se cargan de 1 a 500 pallets por vez.'
      using errcode = '22023', hint = 'jouve_guard';
  end if;

  -- One load per prefix at a time: the next one reads the codes this one adds.
  perform pg_advisory_xact_lock(hashtextextended('pallets_bulk_code:' || p_code_prefix, 0));

  select coalesce(max(substr(p.code, length(p_code_prefix) + 2)::numeric), 0) + 1
    into v_start
    from public.pallets p
   where left(p.code, length(p_code_prefix) + 1) = p_code_prefix || '-'
     and substr(p.code, length(p_code_prefix) + 2) ~ '^[0-9]+$';

  v_pad := greatest(4, length((v_start + p_count - 1)::text));

  insert into public.pallets (
    warehouse_id, client_id, product_id, code, quantity, status, entry_date,
    notes, area_id, lot_number, lot_expiry, created_by
  )
  select p_warehouse_id, p_client_id, p_product_id,
         p_code_prefix || '-' || lpad((v_start + g.i)::text, v_pad, '0'),
         p_quantity, 'en_deposito', p_entry_date, p_notes, p_area_id,
         p_lot_number, p_lot_expiry, auth.uid()
    from generate_series(0, p_count - 1) as g(i);
  get diagnostics v_created = row_count;

  return v_created;
end;
$$;

comment on function public.create_pallets_bulk(text, integer, uuid, uuid, date, uuid, numeric, text, uuid, text, date) is
  'Ingreso masivo de pallets: numera los códigos <prefijo>-NNNN después del más alto del prefijo, de a una carga por prefijo (lock), y los inserta con la RLS de quien llama.';

revoke all on function public.create_pallets_bulk(text, integer, uuid, uuid, date, uuid, numeric, text, uuid, text, date)
  from public, anon;
grant execute on function public.create_pallets_bulk(text, integer, uuid, uuid, date, uuid, numeric, text, uuid, text, date)
  to authenticated, service_role;
