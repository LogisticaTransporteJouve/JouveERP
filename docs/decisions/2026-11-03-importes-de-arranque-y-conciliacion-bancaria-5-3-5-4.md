# 2026-11-03 — Importes de arranque y conciliación bancaria (5.3 + 5.4)

**Decisión (5.3).** Cada ítem de arranque entra por el mismo camino que su
alta a mano, dentro de `commit_import_run`, y lleva `import_run_id`:
**tarifas** como el tarifario del cliente (todas las áreas; el guard de
superposición aplica; mismo cliente, concepto e inicio = la misma tarifa);
**préstamos** como el alta de préstamo, con las cuotas **pendientes** al
arranque (capital pendiente en cuotas iguales o la cuota del archivo), sin
desembolso (la deuda entra con el ajuste inicial); **cheques en cartera**
como un cheque cargado a mano (`source_kind = manual`), así
`checks_manual_inflow` asienta el ingreso a cartera (Dr cartera / Cr ajustes
de caja, sin cliente); **cobranzas** como **saldo inicial por cliente**
(`client_opening_balances`, el camino de ajuste inicial documentado: sin
recibo, movimiento ni asiento, imputado FIFO a facturas anteriores al corte
por `apply_client_opening_balance_core`, el cuerpo del RPC del owner). Un
saldo, tarifa, préstamo o cheque repetido en el archivo es error en las dos
filas (saltear una perdería un importe); uno ya cargado se saltea. Deshacer
rechaza en cuanto hubo efectos: tarifa editada, usada en una liquidación o
en una facturación de almacenaje posterior; préstamo o cuota editados,
pagados o con desembolso; cheque editado o fuera de cartera (o su ingreso
conciliado o en período cerrado); recibo del cliente posterior al saldo.
Permisos: `imports:write` más el del módulo (`storage_billing:issue`,
`accounting:write`, `cheques:write`, `opening_balances:write` —solo owner—,
`transactions:write`).

**Decisión (5.4).** El extracto se importa con el importador (tipo
"Extracto bancario", cuenta elegida) a `bank_statement_lines`; cada línea se
deduplica por SHA-256 de su contenido y su repetición en el archivo, y
guarda su fila para ordenar el día. La conciliación es por cuenta y mes con
`transactions:read` / `transactions:write` (sin permiso nuevo): una línea se
concilia con uno o varios movimientos de su cuenta que suman exacto su
importe (`bank_statement_matches`, un movimiento con una sola línea); las
sugerencias son 1 a 1, mismo importe al centavo, ±5 días, primero las que
coinciden en referencia. "No corresponde" lleva motivo. El movimiento que
falta se crea como el manual (ingreso, o egreso con cuenta de gasto) y queda
conciliado en la misma transacción. `guard_transaction_reconciled` impide
borrar o cambiar monto, fecha, devengado, cuenta, tipo, moneda, canal o par
de un movimiento conciliado, sin excepción por stack (descripción y
etiquetas sí se editan). Diferencia = último saldo del extracto en el mes −
saldo según libros al fin del mes.

**Por qué.** El arranque necesita cargar lo vivo (tarifas, deudas, cartera,
saldos) sin saltear los asientos ni los guards de movimientos con dueño, y
conciliar el banco exige un vínculo línea ↔ movimiento que proteja lo ya
conciliado.

**Descartado.** Recibos históricos por `create_receipt` (moverían caja y
asientos de períodos viejos que el ajuste inicial ya resuelve); facturas
abiertas una por una (una fiscal necesita CAE); cheques con cliente (bajaría
un saldo inicial que ya los descuenta); marcar la conciliación en
`transactions` (columna nueva en una tabla que leen todos los reportes y el
código anterior); muchas líneas contra un movimiento (por ahora una línea,
uno o varios movimientos).
