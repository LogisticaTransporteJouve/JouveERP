# 2026-11-04 — Saldos de apertura, NC sin origen y diferencia de cambio

**Saldos de apertura.** Cliente y proveedor saldan lo mismo: saldo real al
corte (facturas y ND − NC − cobros/pagos, en pesos) menos el objetivo, imputado
FIFO sobre lo que cada comprobante tiene abierto. El saldo de apertura es en
pesos; los comprobantes USD quedan afuera.

**NC sin origen.** Se netean dentro de `v_aging_documents` (no solo en el
resumen por cliente, como hace `v_supplier_aging`): así todo lo que lee la
vista (aging, ámbito, fotos, mora, tareas, IA, flujo de caja) ve un solo saldo.
Se reparten del más vencido al más nuevo, por canal y moneda. El tope de una NC
con origen pasa a `invoice_open_amount`, la cifra de la guarda diferida.

**Diferencia de cambio.** La asienta el documento que cancela (recibo, OP o
NC), no un asiento aparte: así se re-asienta al editar, se revierte al anular y
respeta el período cerrado sin lógica nueva. Imputar después un recibo u OP USD
re-asienta al COMMIT (trigger diferido); en un período cerrado se rechaza si el
asiento cambia. Ventas e IVA de una NC siguen a su propia cotización (lo que
informa a ARCA); solo clientes va a la del origen. No se toca
`build_transaction_journal_lines`.

**Descartado.** Revaluar saldos USD a fin de mes (asiento de ajuste por
cotización): pide un cierre mensual que hoy no existe.
