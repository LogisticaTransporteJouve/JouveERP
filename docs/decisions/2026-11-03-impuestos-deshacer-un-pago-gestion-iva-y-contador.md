# 2026-11-03 — Impuestos: deshacer un pago, gestión, IVA y contador

**Decisión.** (1) Un pago se deshace con `undo_tax_document_payment` según
cómo llegó (`tax_documents.payment_origin`, que ahora escriben
`pay_tax_document` y `link_tax_document_payment`): el egreso que creó
"Pagar" se borra (deja de tener dueño y el guard de movimientos lo suelta);
el vinculado vuelve a ser un egreso suelto con la cuenta de gasto que tenía
(guardada al vincular en `payment_previous_expense_account_id`) y
`repost_journal`. El impuesto vuelve a liquidado si su importe no es
estimado, si no a pendiente (no se guarda el estado previo al pago). Se
rechaza con `jouve_guard` un período cerrado (fecha o devengamiento) y un
egreso de "Pagar" conciliado; uno vinculado y conciliado se suelta porque
`expense_account_id` no es un campo bloqueado. Idempotente (sin pago,
ninguna fila) y auditado (`tax_document.payment_undone`). (2) En gestión
percibido el pago de un impuesto va al rubro de la cuenta del impuesto si
está mapeada, si no a `operating_cost` / `impuestos`, que el código viejo ya
conoce. (3) El estimado de IVA resta el saldo a favor técnico que el IVA del
mes anterior trae en `credit_balance` (cargado desde la DDJJ); si el mes no
tuvo nada que pagar, el impuesto se anula con su saldo y se lee igual. (4)
Quien tiene `taxes:read` lee los adjuntos de un impuesto por dos policies
SELECT nuevas (y `is_tax_document_file`), sin `files:read`. (5)
`getTaxDocuments` es la herramienta de lectura de impuestos del CFO IA.

**Por qué.** Sin deshacer, un pago mal cargado no tenía arreglo. Guardar el
origen evita adivinar si el movimiento era del usuario: borrar uno que el
usuario cargó perdería datos, así que ante la duda el backfill lo trata como
vinculado (se suelta, no se borra). El saldo a favor viene de la DDJJ, no de
encadenar estimados.

**Descartado.** Rearmar la cuenta de gasto desde el asiento revertido:
`repost_journal` borra el asiento reemplazado, no lo revierte; el backfill usa
el log de auditoría. Separar las percepciones de IVA de las de IIBB en
compras: `purchase_invoices` tiene un solo `imp_trib` y el asiento lo manda a
percepciones IIBB; queda como pendiente. Dar `files:read` al contador: abriría
todo el hub de archivos. Un estado nuevo para un IVA sin nada que pagar.
