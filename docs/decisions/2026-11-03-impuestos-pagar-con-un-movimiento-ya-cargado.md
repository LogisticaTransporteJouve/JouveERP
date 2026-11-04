# 2026-11-03 — Impuestos: pagar con un movimiento ya cargado

**Decisión.** Un impuesto se suele pagar por transferencia, que ya está en
Caja (cargada a mano o desde el extracto). Dos entradas, sin duplicar el
egreso: (1) "Vincular movimiento existente" en el impuesto:
`link_tax_document_payment` adopta un egreso suelto (`transaction_is_loose`,
pesos, cuenta de caja o banco activa, canal fiscal) como el pago, igual que
`adopt_loan_installment_payment` y `record_loan_disbursement` en préstamos:
le borra la cuenta de gasto, marca el documento pagado con la fecha y el
importe del movimiento y llama a `repost_journal`, que reemplaza el asiento
(Debe la cuenta del gasto → Debe la cuenta del impuesto; Haber caja o banco
igual). (2) En Conciliación › Crear movimiento, un débito en pesos puede ser
"Pago de impuesto": `create_bank_statement_line_tax_payment` llama a
`pay_tax_document` con la fecha, la cuenta y el importe de la línea y la
concilia en la misma transacción; `create_bank_statement_line_transaction`
no cambió. Un importe distinto al del documento se rechaza salvo que el
usuario lo confirme (`p_allow_difference`); el pago queda por el importe
real y la diferencia en las notas. Vincular el mismo par dos veces devuelve
el mismo movimiento. Se rechaza: un movimiento con dueño, en otra moneda, de
un canal no fiscal o con fecha o devengamiento en un período cerrado; un
documento pagado con otro movimiento o anulado. Vincular exige
`taxes:write` y además `transactions:write` (cambia un movimiento de Caja);
el pago desde el extracto, `transactions:write` y `taxes:write`.

**Por qué.** Sin esto el usuario cargaba el pago dos veces (la transferencia
y el "Pagar") o dejaba el impuesto pendiente. El bloqueo de un movimiento
conciliado cubre monto, fecha, devengamiento, cuenta, tipo, moneda, canal y
par, no la cuenta de gasto, así que adoptar uno conciliado no toca nada
bloqueado; re-asentar reemplaza solo el asiento.

**Descartado.** Cambiar el canal del movimiento al fiscal al vincularlo
(rompe la conciliación y cambia un dato que el usuario eligió); aceptar
cualquier importe en silencio (un error de selección pagaría mal el
impuesto sin rastro); una opción nueva en
`create_bank_statement_line_transaction` (mezclaba dos contratos en una
firma); deshacer en este cambio (queda pendiente, igual que para "Pagar").
