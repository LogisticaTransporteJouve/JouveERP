# Tesorería: auditoría w2 (2026-11-04)

- [x] **Cheques en USD entregados a un proveedor** (`20261104101000`): el
      cobro, el rechazo y la anulación de un cheque propio de una OP, y el
      rechazo de un cheque endosado, asientan a la cotización de la OP (la
      misma con la que la OP los acreditó); `cheques_diferidos_emitidos` y
      proveedores se revierten exactos. Antes asentaban los dólares como
      pesos.
- [x] El rechazo de un cheque endosado asienta en la fecha del rechazo y el de
      un cheque propio en `rejected_at` (antes, el día de la carga).
      `reject_check` corre con `search_path = ''`.
- [ ] Diferencia de cambio del lado del banco al cobrar un cheque propio USD
      de una OP: el banco se acredita a la cotización de la OP, no a la del
      día del cobro.
- [ ] Asientos ya hechos de cheques USD de OP (cobro, rechazo, anulación) y
      de rechazos de endosados quedan con el importe viejo; re-asentarlos
      cambia períodos pasados: lo decide el owner.
- [x] **Cheque entregado que rebota** (`20261104101400`): la deuda vuelve a
      la cuenta corriente del proveedor (fila "Cheque rechazado" con el
      número de la OP), al aging, al flujo de caja y a las herramientas de
      IA de proveedores. Se paga con una OP nueva a cuenta e "Imputar" →
      "Cheques rechazados" (del más viejo). Los mensajes de anular y editar
      la OP dicen ese camino.
- [ ] Saldo de apertura de proveedor: el saldo real al corte no cuenta los
      cheques entregados rechazados.
- [ ] Un cheque rechazado USD pagado por una OP a otra cotización deja la
      diferencia en proveedores (sin `diferencia_cambio`).
- [ ] La OP nueva no imputa el cheque rechazado al crearla (solo a cuenta y
      después "Imputar"); las tareas automáticas no crean "Pagar" para un
      cheque rechazado.
- [x] **NC de compra sin origen** (`20261104101400`): el aging por documento
      reparte su crédito (mismo canal y moneda, del más vencido al más
      nuevo), así el flujo de caja y la IA ven lo mismo que los totales del
      aging. Ahora el crédito queda en su canal: una NC sin origen de un
      canal ya no baja la deuda de otro.
- [x] **Cuentas con movimientos** (`20261104101100`): moneda, tipo y saldo
      inicial quedan fijos (guarda en la base y campos deshabilitados en el
      formulario); el saldo se corrige con "Ajustar saldo".
- [x] **Préstamo en USD** (`20261104101300`): el capital de cada cuota baja
      `prestamos` a la cotización del desembolso y la diferencia va a
      `diferencia_cambio`. Un préstamo importado (sin movimiento de
      desembolso) asienta como antes; las cuotas ya pagadas conservan su
      asiento.
- [x] "Pagar" un impuesto pide también `transactions:write` (mueve Caja),
      como vincular y deshacer.
- [x] Transferir desde o hacia una cartera de cheques se rechaza en la base
      (`20261104101200`).
- [ ] `create_transfer` no tiene clave de idempotencia: un reintento crea
      otra transferencia.
- [x] Conciliación: la diferencia compara el saldo del extracto con el de
      libros a la fecha de ese saldo.
- [x] Tesorería muestra las carteras de cheques en USD aparte.
- [x] Deudas por cheques vendidos: todas las pendientes (sin tope de 200) y
      las últimas 100 pagadas (llegó con #348).
- [ ] Aprobar las migraciones `20261104101000`–`20261104101400` con el
      deploy.
- [ ] No verificado contra una base real: migraciones y pgTAP
      (`check_journal_op_rate`, `account_frozen_after_movements`,
      `transfer_check_cartera`, `loan_usd_capital_fx`,
      `supplier_rejected_checks`).
