# 2026-11-03 — Letras de documentos no fiscales: R remito fiscal, X interno

**Decisión.** La **R** queda reservada al **remito fiscal**. La **X**
("documento no válido como factura") es la del **remito interno** y la del
**recibo de cobranza**: un recibo se numera `X0001-00000012` (antes
`R0001-00000012`). Cambia solo la letra; punto de venta y número siguen
iguales y no se reescribe ningún número guardado. En TS hay un solo
formateador, `formatReceiptNumber` (`features/receipts/schema.ts`, letra
`RECEIPT_LETTER`), que usan tabla, diálogos, PDF (recuadro "X" con la leyenda
"Documento no válido como factura"), email, exportaciones, cuenta corriente,
imputaciones y rendiciones. En SQL (`20261103210000_receipts_letter_x`) usan
X la descripción del asiento (`journal_document_entry`), la de los
movimientos de caja del recibo (`create_receipt` / `update_receipt`), la nota
del recibo que reemplaza a uno interno al facturar el remito
(`settle_billed_remito`) y el título del recibo en la búsqueda global.

**Lo ya guardado.** La descripción de un asiento se guarda al asentarlo: los
asientos ya contabilizados siguen diciendo "Recibo R…" (no se tocan), los
nuevos y los re-asentados dicen "Recibo X…". `journal_entry_status` no compara
descripciones, así que el cambio no re-asienta nada. Los movimientos de caja
de un recibo pasan a X cuando se edita el recibo. La búsqueda global indexa
las dos formas, X y R, para que un recibo impreso antes del cambio se siga
encontrando por su número R.

**Descartado.** Reescribir las descripciones de asientos contabilizados
(serían cambios masivos sobre períodos posiblemente cerrados, sin efecto en
saldos).
