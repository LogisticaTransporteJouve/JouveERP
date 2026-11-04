# 2026-11-04 — Tesorería: los documentos y sus líneas los escriben sus RPC

**Decisión.** Auditoría w7 (S2 F1–F3, S4 F1 y N1). Cierra en la base lo que
la app ya hacía. Un PATCH directo por PostgREST ya no puede reescribir la
plata de Tesorería, ni un POST directo de líneas, retenciones o cheques. El
POST directo de una cabecera de recibo o de OP siguió abierto hasta la
auditoría w8, que lo cerró
([decisión w8](2026-11-04-tesoreria-y-prestamos-escritos-por-sus-rpc-w8.md)).

- **Cheque propio.** Sale de «emitido» una sola vez: a cobrado, rechazado o
  anulado (`guard_issued_check_edit`, `20261104140000`). Se inserta
  emitido. Antes, un cheque cobrado de una OP podía volver a «emitido». Un
  segundo «Cobrado» duplicaba el asiento del cobro. Un «Rechazado» registraba
  un ingreso al banco y la reversión de la deuda por un cheque que el banco
  pagó. Pasarlo de cobrado a rechazado dejaba al proveedor debiéndolo.
- **Cabecera de recibo y de OP.** El estado pasa solo de emitido a anulado.
  El monto, la moneda, la cotización, el cliente o proveedor, el canal, la
  fecha y el número cambian solo dentro de `update_receipt` /
  `update_payment_order` (`guard_document_header`, `20261104140001`).
  Siguen libres las notas, el centro de costo, `notified_at`, `created_by` y
  los datos de la anulación. Anular sigue funcionando desde cualquier camino:
  la app, la acreditación de un remito, la imputación de remitos de compra y
  las rendiciones.
- **Líneas de pago y retenciones.** Las de una OP y las de un recibo las
  escriben solo `create_*` / `update_*` del documento
  (`guard_document_line`, `20261104140002`). También pasan las acciones de
  clave foránea, que corren a `pg_trigger_depth() > 1`: el borrado en cascada
  de la cabecera y el `issued_check_id` que queda en null cuando se borra un
  cheque propio. Un INSERT nunca entra por ese camino.
- **Depósito de un cheque.** Va solo a un banco activo de la moneda del
  cheque, la misma regla que el diálogo «Depositar» (`deposit_check`,
  `20261104140003`). Es más estricto que la venta de cheques, que también
  acepta caja o billetera: un depósito es en un banco.
- **Cartera de un cheque.** Un cheque se inserta solo en una cuenta de tipo
  `checks` o `echeq` (`guard_check_edit` en INSERT, y `createCheckAction`
  antes de insertar). El escaneo IA y el importador ya lo validaban.
- **Movimiento «recibido» inicial.** La base escribe su fecha de alta
  (`now()`), su autor (`auth.uid()`) y su fecha de evento (la emisión del
  cheque). No rechaza los valores que manda el cliente, los reemplaza: es lo
  que «Nuevo cheque» y el seed ya mandan.

**Por qué `pg_context` y no solo RLS.** Las RPC son `SECURITY DEFINER` y las
llama `authenticated`. Una política de RLS no distingue la RPC de un PATCH
del mismo usuario. El patrón es el de `guard_check_movement` y
`guard_driver_settlement_difference_receipt`.

**Rollback.** El código anterior escribe estas filas solo de estas formas,
así que convive con las guardas.
