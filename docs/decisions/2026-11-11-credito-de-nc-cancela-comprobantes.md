# 2026-11-11 — El sobrante de una NC cancela los otros comprobantes

**Decisión.** Cuando una nota de crédito (o varias) vinculada a un comprobante
lo acredita por más de lo que ese comprobante debe, el sobrante cancela los
otros comprobantes abiertos (facturas y ND) **del mismo cliente o proveedor,
del mismo canal y de la misma moneda**, del más viejo al más nuevo (fecha,
punto de venta, número). Lo que sobra después de cancelar todo queda como
crédito a favor (se ve en la cuenta corriente; el aging no baja de 0).

Caso que lo motivó: FLORES tenía 5 NC de 200.000 vinculadas a la factura 227
(que quedaba en −800.000) mientras 226, 7619, ND 2 y ND 40 seguían abiertas en
200.000 cada una; UNGARO CARLOS, la NC 1005 sobre la 21987 dejaba la 22005
abierta. En producción, 38 clientes y 4 proveedores que netean 0 seguían
apareciendo en el aging.

- **Se calcula, no se guarda.** Las NC emitidas no cambian (CAE y comprobante de
  origen quedan como están). La regla vive en un solo lugar por lado:
  `v_invoice_open` (ventas, nueva) y `v_purchase_invoice_open` (compras).
- **Dos cifras por comprobante.**
  - `own_open_amount`: lo que debe **por sí solo** (total − cobros o pagos −
    saldo inicial − sus propias NC). La leen las guardas (recibos, órdenes de
    pago, edición de compras, NC nueva) y la cancelación de remitos facturados
    o imputados. Un cobro, un pago o una NC nunca se rechaza por crédito que le
    "prestó" otra NC.
  - `open_amount`: lo que **realmente** debe, después del sobrante. La leen el
    aging, la cuenta corriente, los selectores de comprobantes a cobrar o
    pagar, el saldo inicial, el asistente y las exportaciones.
- **Primero la plata.** Recibos, órdenes de pago y saldo inicial bajan lo que
  debe cada comprobante antes de repartir el sobrante.
- **Tope de una NC nueva:** sigue siendo lo que el origen debe por sí solo
  (`invoice_own_open_amount`), NC en curso incluidas. El crédito que le pasan
  otras NC no cuenta para el tope.
- **Saldo inicial.** El saldo inicial de un cliente o proveedor ya descuenta las
  NC hasta su fecha de corte. Por eso el sobrante de las NC hasta el corte solo
  baja comprobantes hasta el corte y el resto queda absorbido por el saldo
  inicial; el sobrante de las NC posteriores al corte baja cualquier
  comprobante. Aplica en pesos si hay saldo inicial y en dólares si tiene
  objetivo en dólares.
- **Fuera de alcance.** El sobrante no cancela cheques rechazados. Una NC en
  otra moneda que su origen no se reparte (verificación previa al promote).
  Las NC sin origen siguen repartiéndose como antes (por vencimiento), sobre lo
  que queda después del sobrante.

**Opciones descartadas.**

- **Guardar el sobrante** (imputaciones de NC a otros comprobantes): exigía
  mantener una tabla al día con cada cobro, NC, anulación y saldo inicial; un
  cálculo en la vista no se desincroniza.
- **Orden por vencimiento** (como las NC sin origen): el dueño pidió cancelar
  las facturas anteriores primero, por fecha del comprobante.
- **Cruzar canales o monedas:** el crédito de un canal no paga deuda de otro
  (igual que un recibo o una OP).
