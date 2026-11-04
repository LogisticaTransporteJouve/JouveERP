# 2026-11-03 — Desembolsos de préstamos en base caja → línea Financiamiento recibido

**Decisión.** En el Resultado de gestión percibido, el desembolso de un
préstamo (bancario o de financiera, `loans.disbursement_transaction_id`)
suma en una caja propia, `loan_disbursements`, con la línea **"Financiamiento
recibido"** debajo de "Generación de caja", y cierra **"Variación de caja"** =
generación de caja + financiamiento recibido, que concilia con lo que se movió
en las cuentas. El margen operativo, la generación de caja y su indicador no
cambian. Devengado: sin cambios (el desembolso no es resultado). Migración
`20261103130000`.

**Por qué.** Percibido restaba el capital de cada cuota pero ignoraba el
desembolso: era asimétrico, y la generación de caja de un mes con un préstamo
no explicaba el saldo del banco.

**Descartado.** Sumarlo en "Capital de préstamos" (mezclaría el repago con el
financiamiento y movería la generación de caja: un préstamo la haría ver
buena); incluirlo dentro de la generación de caja; mostrarlo en devengado.
