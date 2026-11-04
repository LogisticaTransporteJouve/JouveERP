# 2026-11-03 — Depósito por área, lote y bloqueo; mora → ND; venta de cheques (4.4 + 4.6)

**Decisión (4.4).** Las **áreas** son una tabla propia (`storage_areas`, por
depósito); el pallet tiene `area_id` opcional con FK compuesta
`(area_id, warehouse_id)`, así el área siempre es de su depósito. La tarifa
por área es una dimensión opcional de `client_tariffs` (`area_id`, null =
todas las áreas): para un pallet de un área, la tarifa de esa área pisa a la
de todas las áreas en los días (y la carga/descarga) que cubre, y lo que
ninguna cubre sigue cayendo a `storage_tariffs`. El guard de superposición
pasa a ser por cliente, concepto **y área**; `client_tariff_at` devuelve solo
la de todas las áreas (el flete no tiene área). Las filas existentes (sin
área) facturan exactamente igual. **Lote** y vencimiento son columnas del
pallet. El **bloqueo** son columnas del pallet (`blocked_at`, `blocked_by`,
`block_reason`), no un estado nuevo, para que el código anterior siga leyendo
`status`: `guard_pallet_blocked` impide que un pallet bloqueado salga
(despachado o fecha de salida) o se borre, y que se bloquee uno que ya salió.
El despacho masivo saltea los bloqueados y lo avisa. Permisos existentes:
`warehouses:write` (áreas), `pallets:write` (lote, bloqueo),
`storage_billing:issue` (tarifas por área).

**Decisión (4.6 — mora).** Interés simple sobre el saldo abierto, tasa
**mensual** prorrateada /30 por día, desde el día siguiente al vencimiento (o
al último día ya cobrado) hasta la fecha elegida, ambos inclusive. Tasa del
cliente (`clients.late_interest_monthly_rate`) o la general
(`finance_settings`). Nunca automático: en `/aging/mora` el usuario genera
**una ND por comprobante vencido** por `issueFiscalInvoiceAction` (origen = el
comprobante, IVA 21% en Ventas, misma moneda y cotización del día si es en
dólares). `late_interest_charges` guarda el período cobrado y la base; el
guard rechaza un período superpuesto a otro vivo del mismo comprobante,
intereses sobre una ND de intereses y cualquier edición. La ND lleva el id
del cargo como `idempotency_key`: un reintento devuelve la misma ND y, si se
pierde el vínculo, el período sigue tomado mientras la ND exista. Una ND
fallida o anulada libera su período. Permisos: emitir con `invoices:issue` +
`credit_debit_notes:issue`; tasa general con `credit_debit_notes:issue`;
tasa del cliente con `clients:write`.

**Decisión (4.6 — venta de cheques).** `check_sales` registra la venta
(comprador, cuenta, canal, nominal, intereses, comisiones, neto) y los
cheques pasan a `vendido` (estado nuevo, el texto del check se amplió). Por
cheque, una transferencia de su nominal de la cartera a la cuenta (como un
depósito: Dr banco / Cr cheques en cartera); por venta, un egreso de
intereses y otro de comisiones en esa cuenta imputados a **Intereses
pagados** (Dr intereses / Cr banco). La cuenta queda con el neto. Todos los
movimientos llevan `check_sale_id` y son "con dueño" (no se editan ni borran
desde Caja). `sell_checks` es idempotente por clave del diálogo, bloquea los
cheques en orden y rechaza uno fuera de cartera, otra moneda u otro canal, o
un costo que iguale el nominal. **Rechazo de un vendido:** `reject_check`
acepta `vendido`; el comprador lo devuelve desde la cuenta de la venta (o la
que elija el usuario) y se asienta como Deudores por cheques rechazados,
igual que uno depositado. Permiso: `cheques:write`.

**Descartado.** Área como estado o como tarifa general sin cliente
(`storage_tariffs` sigue sin área); estado `bloqueado` (rompería el parseo
estricto de `status` del código anterior); interés compuesto o con días
corridos sobre el saldo de cada día (se usa el saldo abierto al generar);
una ND por cliente con varios comprobantes (la ND tiene un solo origen);
generación automática por cron; contabilizar la venta como préstamo
(pasivo) hasta el vencimiento; la deuda con la financiera que no debita la
cuenta como pasivo pendiente (queda como follow-up).
