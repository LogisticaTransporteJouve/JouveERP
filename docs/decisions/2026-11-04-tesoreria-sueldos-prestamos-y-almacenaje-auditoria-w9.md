# 2026-11-04 — Sueldos, préstamos y almacenaje: cada vínculo lo pone su camino (w9)

**Decisión.** Auditoría w9 (S4 F1–F2, S2 F1, S5 F1). Sigue la
[decisión w8](2026-11-04-tesoreria-y-prestamos-escritos-por-sus-rpc-w8.md):
un vínculo con un movimiento o una factura lo pone solo el camino que lo
valida, también frente a un PATCH directo.

- **Pago de sueldo** (`guard_payroll_payment_transaction`,
  `20261104160000`). El movimiento de un pago es el que creó su alta, y
  `transaction_id` no cambia después. Antes, un PATCH lo apuntaba a otro
  movimiento (una cuota, un cheque, un recibo), y el trigger de
  sincronización le reescribía cuenta, canal, importe y fecha, o lo borraba
  al borrar el pago. Esa escritura corre anidada, donde las guardas de
  movimientos de documento no miran. El egreso propio del pago quedaba sin
  dueño y se podía borrar desde Caja con la planilla todavía paga.
- **Cuota pagada** (`guard_loan_installment_payment`, `20261104160001`). No
  se borra. Solo se va con su préstamo, y `guard_loan` ya deja borrar un
  préstamo solo si no tiene nada pagado. Antes, borrarla liberaba su egreso
  y la cuota se volvía a cargar pendiente y se pagaba dos veces.
- **Condiciones del préstamo** (`guard_loan`, `20261104160001`). El capital,
  la moneda y el canal no cambian una vez registrado el desembolso,
  importado el préstamo o pagada una cuota. Con eso se calcula el capital de
  cada cuota y se validó el desembolso. El estado pasa solo de activo a
  anulado («Anular», con su guarda de siempre) o a pagado dentro de
  `pay_loan_installment` / `adopt_loan_installment_payment`. Nada vuelve un
  préstamo a activo.
- **Facturación de almacenaje** (`20261104160002`). Es el par de la
  liquidación de fletes y del flete de una carga (w1 F5):
  - La factura se emite con el id de la reserva del período como clave de
    idempotencia. Los totales del período se graban antes de emitir.
  - Al reservar, una reserva vencida (más de 15 minutos sin vincular) con
    una factura viva bajo su id la vincula, en vez de borrarse. Si el
    período pedido se superpone con ella, la reserva no se hace y la acción
    avisa que ya está facturado. Antes, la reserva se borraba y «Facturar»
    emitía un segundo CAE por los mismos días.
  - Un período se vincula solo a una factura de su cliente que no falló ni
    se anuló (`guard_storage_billing_run_invoice`, con la factura bloqueada).
    Si la factura falló antes del vínculo, la acción libera el período.
    Antes, el período quedaba facturado con una factura rechazada.
  - Si el vínculo se pierde con la factura viva, el mensaje ya no invita a
    facturar otra vez: avisa que pasados 15 minutos «Facturar» registra la
    misma factura.

**Por qué la reserva devuelve null en vez de un error.** Un error deshace la
transacción y con ella el vínculo recién hecho. La firma no cambia, y el
código anterior lee el null como «No se pudo validar el período.».

**Por qué una factura sin ítems no cuenta como viva.** Un borrador sin ítems
es el resto de un alta que falló a mitad de camino. Nunca se emite
(`issue-invoice-reconcile` lo saltea), así que vincularlo dejaría el período
facturado sin factura.

**Rollback.** El código anterior no escribe `transaction_id` de un pago, no
borra cuotas sueltas, no edita las condiciones de un préstamo, y emite el
almacenaje con una clave al azar, así que sus reservas vencidas se borran
como antes.
