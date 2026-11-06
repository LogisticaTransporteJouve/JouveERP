SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- A voucher ARCA lists but whose amounts cannot be read (they do not add up,
-- a detail contradicts its subtotal, a cell is not a number) stays in the
-- tray as «No se pudieron leer» instead of only being counted in the sync's
-- notice. Only rows whose identity reads (CUIT, tipo, punto de venta, número
-- and fecha) are kept: without it there is nothing to dedupe on.
--
--   status 'unreadable': amounts stay 0 (nothing read is trusted); what ARCA
--     listed is kept as text in raw_amounts, and the parser's reason in
--     unreadable_reason. A later read of the same voucher moves it to
--     pending_review with its amounts (lib/afip/received-vouchers.ts).
--   A person loads it by hand (the purchase they type is checked against
--     its identity only) or discards it; restoring a discarded one sends it
--     back to unreadable while unreadable_reason is set.
--   kind and letter: still required to review or confirm, and still null for
--     an unsupported type; an unreadable or discarded one may have neither
--     (a type the tray does not load whose amounts did not read either).
--
-- No data change. Rollback: older code never writes these columns; its tab
-- list has no unreadable tab, so those rows are only hidden.

alter table public.arca_received_vouchers
  add column unreadable_reason text,
  add column raw_amounts jsonb;

-- The old checks are replaced by wider ones: every row they allowed still
-- passes the new ones.
alter table public.arca_received_vouchers
  -- squawk-ignore ban-drop-constraint
  drop constraint arca_received_vouchers_status_check,
  -- squawk-ignore ban-drop-constraint
  drop constraint arca_received_vouchers_unsupported,
  add constraint arca_received_vouchers_status_check
    check (status in ('pending_review', 'confirmed', 'discarded', 'unsupported', 'unreadable')) not valid,
  add constraint arca_received_vouchers_unsupported check (
    case
      when status = 'unsupported' then kind is null
      when status in ('pending_review', 'confirmed') then kind is not null
      else true
    end
  ) not valid,
  add constraint arca_received_vouchers_unreadable_reason_check
    check (unreadable_reason is null
           or unreadable_reason in ('bad_amount', 'amount_over_total', 'breakdown_mismatch')) not valid,
  add constraint arca_received_vouchers_raw_amounts_check
    check (raw_amounts is null or jsonb_typeof(raw_amounts) = 'object') not valid,
  add constraint arca_received_vouchers_unreadable check (
    (status <> 'unreadable' or unreadable_reason is not null)
    and (unreadable_reason is null or status in ('unreadable', 'discarded', 'confirmed'))
  ) not valid;

-- squawk-ignore constraint-missing-not-valid
alter table public.arca_received_vouchers validate constraint arca_received_vouchers_status_check;
-- squawk-ignore constraint-missing-not-valid
alter table public.arca_received_vouchers validate constraint arca_received_vouchers_unsupported;
-- squawk-ignore constraint-missing-not-valid
alter table public.arca_received_vouchers validate constraint arca_received_vouchers_unreadable_reason_check;
-- squawk-ignore constraint-missing-not-valid
alter table public.arca_received_vouchers validate constraint arca_received_vouchers_raw_amounts_check;
-- squawk-ignore constraint-missing-not-valid
alter table public.arca_received_vouchers validate constraint arca_received_vouchers_unreadable;

comment on column public.arca_received_vouchers.unreadable_reason is
  'Por qué no se pudieron leer los importes (bad_amount, amount_over_total, breakdown_mismatch); null cuando se leyeron.';
comment on column public.arca_received_vouchers.raw_amounts is
  'Importes de un comprobante que no se pudo leer, como texto, tal como los lista ARCA (neto, no_gravado, exentas, iva, otros_tributos, total).';
