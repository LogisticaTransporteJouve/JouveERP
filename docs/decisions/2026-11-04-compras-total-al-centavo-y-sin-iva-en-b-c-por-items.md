# 2026-11-04 — Compras: total al centavo y sin IVA en B/C por ítems

**Decisión.** El total de una compra tiene que ser exactamente neto + IVA +
otros tributos + no gravado + exento: se quitó la tolerancia de un centavo
(formulario, Zod, acción y `guard_purchase_invoice_total`,
`20261104120500`). El mismo guard rechaza una B o C fiscal con IVA, exento o
no gravado, sea del encabezado o de lo que `replace_purchase_invoice_items`
reescribe desde las líneas; la acción mira el IVA de los ítems antes de
guardar. Las dos reglas corren al insertar y cuando una edición cambia lo que
leen.

**Por qué.** El asiento acredita a proveedores las partes y la cuenta
corriente, el aging y la OP usan el total: el centavo quedaba en proveedores
por cada compra. Pedir el cierre exacto deja proveedores en cero sin tocar el
asiento. En una B con ítems de alícuota, la acción validaba el encabezado y la
RPC guardaba el IVA de las líneas como crédito fiscal.

**Descartado.** Acreditar a proveedores el total y mandar el centavo a una
cuenta de redondeo: no hay cuenta de redondeo en el plan y el asiento de
compras en moneda extranjera ya redondea cada parte por separado; cambiar
`build_purchase_invoice_journal_lines` era más riesgo que pedir el cierre.
