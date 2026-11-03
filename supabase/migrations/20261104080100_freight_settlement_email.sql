SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Envío de la liquidación de fletes (documento R) por email: email_send_log
-- also logs entity_type 'freight_settlement' (the R's PDF, sent from
-- /liquidaciones). Nothing else changes: the log keeps its RLS and only the
-- server actions write it.
--
-- Rollback: older code never writes the new type and reads the log by
-- entity_type, so it ignores these rows.

-- The check is replaced by a wider one in the next statement.
-- squawk-ignore ban-drop-constraint
alter table public.email_send_log drop constraint email_send_log_entity_type_check;
alter table public.email_send_log
  add constraint email_send_log_entity_type_check
    check (entity_type in ('invoice', 'receipt', 'freight_settlement')) not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.email_send_log validate constraint email_send_log_entity_type_check;

comment on table public.email_send_log is
  'Historial de envíos por email de comprobantes (facturas, recibos y liquidaciones de fletes R). El polimorfismo soft (entity_type/entity_id) es aceptable acá porque solo las server actions escriben (no usuarios) y el set de tipos es chico y estable.';
