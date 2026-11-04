# 2026-11-04 — IA: recategorizar gastos, fotos del aging y conciliación desde el insight

**Decisión (recategorizar).** Cambiar la cuenta de gasto y/o el centro de
costo de un gasto ya cargado es una escritura propia, no "editar el
movimiento entero": `recategorize_expense` (SECURITY DEFINER, solo
service_role) toma un egreso suelto (`transaction_is_loose`) o una compra
recibida, bloquea la fila, cambia solo esas dos columnas y deja que los
triggers de re-asiento rehagan el asiento al commit. Rechaza (hint
`jouve_guard`) un movimiento con dueño, un ingreso, una compra anulada, una
cuenta nueva en una compra a cargo de un empleado, una cuenta que no es hoja
imputable, un centro inactivo y cualquier registro con fecha, devengamiento o
asiento en un período cerrado, en los dos canales. La misma imputación otra
vez no cambia nada. `lib/commands/recategorize-expense.ts` es el único
camino (lo usan el Dialog "Recategorizar" de Caja y Compras y la propuesta
`proposeRecategorizeExpense`) y audita `expense.recategorized` con antes y
después. El gate es el permiso de escritura de cada origen
(`transactions:write` o `purchase_invoices:write`); la propuesta del
asistente pide los dos.

**Por qué.** El bloqueo de un movimiento conciliado cubre monto, fechas,
cuenta, tipo, moneda, canal y par, no la cuenta de gasto ni el centro de
costo: recategorizar uno conciliado no rompe la conciliación. Una sola
función con su guard deja el período cerrado y el dueño del movimiento en la
base, igual para la UI y para el asistente.

**Descartado.** Reusar `updateTransactionAction` y `updatePurchaseInvoiceAction`
(reenvían monto y fechas, y en compras cualquier campo: una propuesta no
debería poder tocarlos); propagar la cuenta a las NC/ND de una factura
(heredan la cuenta solo al cargarse; queda pendiente); permitir el período
cerrado en el canal interno (no hay asiento, pero gestión lee ese mes:
cerrado es cerrado).

**Decisión (mora).** `aging_snapshots` guarda una foto diaria del aging de
clientes de todos los canales (tramos, total abierto y total vencido, pesos y
dólares aparte), escrita por `capture_aging_snapshot` desde el cron
`aging-snapshot` (05:37 AR). La tarjeta `receivables_overdue_growth` compara
la última foto con la de 30 días antes (hasta 7 días de tolerancia) y sale
con +15 % y al menos $500.000 o US$1.000 más; crítica desde +50 %. Sin deuda
vencida hace 30 días no hay porcentaje y no hay tarjeta. Se ve con los
permisos del Aging (`clients:read` + `invoices:read` + `receipts:read`); no
existe un `aging:read`.

**Decisión (conciliación).** La tarjeta de extracto sin conciliar corre
`suggestMatches` (la función de la página de Conciliación) sobre las líneas
atrasadas de la cuenta con más líneas y los movimientos de esa cuenta a ±5
días; si hay sugerencias propone `proposeBankMatches` para el período de esas
líneas en lugar de la tarea. Una falla de esa lectura solo le quita la
propuesta a la tarjeta.

**Decisión (chat).** Lo que informa una escritura confirmada ("12
conciliadas; 1 salteada…") se guarda en `ai_chat_confirmations.result_note`
y se muestra en la tarjeta del chat y en el toast, como ya hacía el Dialog de
propuestas de insights.

**Decisión (routing).** "Días de pago", "cuánto tardan en pagar" y "quién
paga peor" van a `getClientPaymentBehavior`; la descripción de
`getClientSalesSummary` ya no ofrece días promedio de cobro y deriva esas
preguntas. Los evals en vivo no se corrieron (sin `ANTHROPIC_API_KEY` en el
entorno donde se hizo el cambio).
