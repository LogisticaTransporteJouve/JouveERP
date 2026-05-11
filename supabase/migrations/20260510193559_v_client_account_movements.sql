-- F.7 (parcial) — Cuenta corriente per cliente.
--
-- Vista de solo lectura que unifica invoices y recibos del cliente en
-- un único feed cronológico. Incluye fiscales e internos (todos los
-- channels) — la cuenta corriente es del cliente, no de un canal.
--
-- Convenciones de signo:
--   * signed_amount > 0  → el cliente DEBE (factura, ND).
--   * signed_amount < 0  → el cliente PAGA / le acreditamos (NC, recibo).
--
-- Filtros de estado:
--   * invoices: solo `emitted` (no draft, emitting, failed, cancelled).
--   * receipts:     solo `issued`  (no canceled).
--
-- El saldo running se calcula en la action (lib/cuenta-corriente) con un
-- window function sobre el resultado, no en la vista — porque sumar
-- signed_amount en SQL fuerza un orden global y nos limita los filtros
-- futuros (por canal, por mes, etc.). Mantenemos la vista "tonta" y
-- delegamos el running balance al server action.

set row_security = off;

create or replace view public.v_client_account_movements with (security_invoker = on) as
  -- Comprobantes emitidos. NC suma negativo (acreditamos al cliente),
  -- factura y ND suman positivo (cliente nos debe).
  select
    'invoice'::text                      as source_type,
    c.id                                     as source_id,
    c.client_id                              as client_id,
    c.fecha                                  as movement_date,
    c.created_at                             as created_at,
    c.kind                                   as kind,
    c.letter                                 as letter,
    c.punto_venta                            as punto_venta,
    c.numero                                 as numero,
    case
      when c.kind = 'nc' then -1 * c.imp_total
      else c.imp_total
    end                                      as signed_amount,
    c.imp_total                              as gross_amount,
    c.channel_id                             as channel_id,
    ch.division                              as channel_division,
    ch.is_fiscal                             as channel_is_fiscal,
    ch.name                                  as channel_name,
    c.status                                 as status
  from public.invoices c
  join public.invoicing_channels ch on ch.id = c.channel_id
  where c.status = 'emitted'

  union all

  -- Recibos emitidos. Siempre acreditan al cliente (negativo).
  select
    'recibo'::text                           as source_type,
    r.id                                     as source_id,
    r.client_id                              as client_id,
    r.receipt_date                            as movement_date,
    r.created_at                             as created_at,
    'recibo'::text                           as kind,
    null::text                               as letter,
    r.punto_venta                            as punto_venta,
    r.numero                                 as numero,
    -1 * r.total_amount                      as signed_amount,
    r.total_amount                           as gross_amount,
    r.channel_id                             as channel_id,
    ch.division                              as channel_division,
    ch.is_fiscal                             as channel_is_fiscal,
    ch.name                                  as channel_name,
    r.status                                 as status
  from public.receipts r
  join public.invoicing_channels ch on ch.id = r.channel_id
  where r.status = 'issued';

comment on view public.v_client_account_movements is
  'Feed cronológico unificado de invoices y recibos por cliente. signed_amount > 0 = el cliente debe; < 0 = pago / NC. Solo emitidos / issued.';

set row_security = on;
