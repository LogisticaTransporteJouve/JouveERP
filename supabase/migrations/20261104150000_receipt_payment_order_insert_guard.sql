SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Auditoría W8 · S4 F1 / S2 F1: a receipt or payment-order header is
-- inserted only by its RPC. guard_document_header (20261104140001) runs on
-- UPDATE only, and RLS lets owner, admin and finance insert headers: a direct
-- POST of an issued header with no lines credited the client
-- (v_client_account_movements) or cleared supplier debt
-- (v_supplier_account_movements) with nothing in Caja, and its journal entry
-- came out empty, because the builders sum the lines. guard_document_line
-- then refused every line for it, so nothing could ever balance it.
--
-- The writers, latest definitions: create_receipt (20261103210000) and
-- create_payment_order (20261031203102) are the only statements that insert
-- a header. settle_billed_remito, confirm_driver_settlement,
-- post_driver_settlement_difference and impute_purchase_remitos reach them;
-- the seed (scripts/seed-everything.mjs) calls them through the API; the
-- importer and the AI scan insert no header; no app code inserts one. They
-- are recognised in the call stack (pg_context), as guard_document_line does.
--
-- The RLS policies are not changed. Existing rows are not touched.
--
-- Rollback: older code inserts headers only through those RPCs, so it is
-- unaffected.

create function public.guard_document_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack text;
begin
  get diagnostics v_stack = pg_context;
  if tg_table_name = 'receipts' then
    if v_stack ~ 'function (public\.)?create_receipt\(' then
      return new;
    end if;
    raise exception 'Un recibo se carga solo desde Recibos, con sus líneas de cobro: no se puede insertar por fuera'
      using errcode = '55006', hint = 'jouve_guard';
  end if;
  if v_stack ~ 'function (public\.)?create_payment_order\(' then
    return new;
  end if;
  raise exception 'Una orden de pago se carga solo desde Órdenes de pago, con sus líneas de pago: no se puede insertar por fuera'
    using errcode = '55006', hint = 'jouve_guard';
end;
$$;

revoke all on function public.guard_document_insert() from public, anon, authenticated;

create trigger receipts_guard_insert_rpc
  before insert on public.receipts
  for each row execute function public.guard_document_insert();

create trigger payment_orders_guard_insert_rpc
  before insert on public.payment_orders
  for each row execute function public.guard_document_insert();
