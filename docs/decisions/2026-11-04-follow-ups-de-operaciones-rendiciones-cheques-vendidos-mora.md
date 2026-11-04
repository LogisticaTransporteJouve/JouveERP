# 2026-11-04 — Follow-ups de operaciones (rendiciones, cheques vendidos, mora, depósito, tarifas)

**Diferencia de la rendición al chofer.** (Reemplazado por "Diferencia de la
rendición: a cargo del chofer o del cliente", arriba.) Se asienta a pedido ("Asentar
diferencia al chofer"), no al confirmar: un faltante puede ser deuda del
cliente (su factura queda con saldo) o del chofer, y solo la persona lo sabe.
Neto por rendición: faltante = `charge`, sobrante = `payment` en
`employee_account_movements` (`driver_settlement_id`, uno por rendición), en
ARS, sin movimiento de caja ni asiento (como un movimiento manual). Lo maneja
la rendición: no se edita ni se borra desde la cuenta corriente, se va al
cancelar la rendición, y no se asienta si un recibo se anuló o editó.
Requiere `receipts:write` y `hr:write`.

**Recibos de una rendición cambiados en Recibos.** Se muestra la
inconsistencia en vez de cambiar el estado de la rendición: anular un recibo
no debe cancelar sola una rendición que tiene otros recibos vigentes.

**Cheque vendido rechazado sin débito.** Queda `rechazado` sin movimiento y
con una deuda en `check_sale_debts`; al pagarla se escribe el mismo egreso que
el rechazo con débito inmediato. El libro mayor lo asienta al pagar (no hay
cuenta de deuda en el plan y no se toca `build_transaction_journal_lines`,
que otros PRs reescriben). **Anular una venta** borra sus movimientos desde el
trigger de la propia venta (el dueño), solo si todos sus cheques siguen
vendidos y el período está abierto; la venta queda `cancelled` con motivo.

**Mora prorrateada.** `late_interest_candidates.balance_days` = suma del saldo
diario (pagos y NC desde su fecha); interés = `balance_days × tasa / 100 / 30`.
Sin pagos en el período da lo mismo que antes. La base guardada en el cargo es
el saldo promedio.

**Tarifas.** Precedencia de almacenaje: tarifa del cliente para el área →
tarifa del cliente → tarifa de almacenaje del cliente → general del área →
general. Una fila de `storage_tariffs` con cliente pasa al tarifario solo si
la facturación queda igual (única fila activa del cliente, sin fin, desde
antes de este mes y sin tarifario previo); queda como respaldo congelado y el
aumento masivo la saltea. Las demás quedan como están.

**Descartado.** Asentar la diferencia al confirmar; desactivar las filas
migradas (cambia el respaldo en períodos que cruzan la vigencia); crear la
carga desde el escaneo del remito (queda la búsqueda).
