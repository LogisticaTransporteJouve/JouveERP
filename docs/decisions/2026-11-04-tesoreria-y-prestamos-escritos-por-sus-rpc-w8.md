# 2026-11-04 — Tesorería y préstamos: las altas y los pagos los escriben sus RPC (w8)

**Decisión.** Auditoría w8 (S4 F1–F2, S2 F1–F3, S5 F1, S6 F2). Sigue la
[decisión w7](2026-11-04-tesoreria-documentos-escritos-por-sus-rpc.md): lo
que mueve plata en Tesorería lo escribe su RPC, también en un POST directo.

- **Alta de un recibo o de una OP.** La cabecera se inserta solo dentro de
  `create_receipt` / `create_payment_order` (`guard_document_insert`,
  `20261104150000`). Antes, un POST de una cabecera emitida sin líneas
  bajaba la cuenta corriente del cliente o la deuda con el proveedor sin
  ningún movimiento en Caja, con un asiento vacío. Las rendiciones, la
  acreditación de un remito, la imputación de remitos de compra y el seed
  llegan por esas RPC.
- **Una cartera de cheques se mueve solo con un cheque**
  (`20261104150002`):
  - Una línea de OP en una cuenta `checks`/`echeq` tiene que ser un cheque
    endosado. Lo controla un trigger en la línea, que cubre crear y editar
    la OP. Antes, una línea «cuenta» o el banco de un cheque propio en una
    cartera sacaban plata de la cartera sin sacar ningún cheque.
  - Una línea de cobro en una cartera necesita su cheque. Lo controlan
    `create_receipt` / `update_receipt` antes de escribir la línea. Antes, el
    ingreso quedaba en la cartera sin ningún cheque que lo explicara.
  - El esquema Zod de las líneas no conoce el tipo de la cuenta: el mensaje
    de la base llega al formulario por `mapDbGuardError`, también desde el
    escaneo IA, que pasa por las mismas acciones.
- **Movimientos de Caja de un documento** (`guard_transaction_origin`,
  `20261104150003`). Un movimiento en una cartera, o con `receipt_id`,
  `payment_order_id`, `issued_check_id`, `rejected_check_id`,
  `manual_check_id` o `check_sale_id`, lo escribe solo su documento. Son
  las RPC de recibos, OP, depósito, venta y rechazo de cheques, el ajuste de
  saldo inicial (solo owner, cualquier cuenta) y los triggers de cheques y
  sueldos. Vale para el INSERT y para un UPDATE que lleve el movimiento a
  una cartera o le ponga uno de esos vínculos. `invoice_id` sigue libre:
  lo pone «Nuevo movimiento».
- **Pago de una cuota** (`guard_loan_installment_payment`,
  `20261104150001`). El estado, la fecha y el importe pagados y el
  movimiento de una cuota cambian solo dentro de `pay_loan_installment` /
  `adopt_loan_installment_payment`. Una cuota se inserta pendiente. Antes,
  un PATCH podía marcarla pagada sin egreso, volverla a pendiente para
  pagarla dos veces o ligarla a cualquier movimiento.
- **Desembolso de un préstamo.** El vínculo se pone solo dentro de
  `record_loan_disbursement`, y no se inserta (`guard_loan`).
- **Alta de un préstamo.** `create_loan` inserta el préstamo y sus cuotas
  en una transacción. «Nuevo préstamo» la usa: ya no queda un préstamo sin
  cronograma si falla la segunda escritura.
- **«Nuevo cheque propio»** muestra el motivo de una guarda de la base (por
  ejemplo, un canal inactivo) en vez de «No se pudo cargar el cheque.».

**Por qué un trigger en la línea de OP y un control en las RPC de recibo.**
La línea de OP sabe si endosa un cheque, así que un trigger la valida para
las dos RPC y para cualquier otro camino. El cheque de un recibo se crea
después de su línea, así que solo la RPC sabe si la línea lo trae.

**Fixtures de pgTAP.** Los tests que insertan cabeceras o movimientos de
documento a mano apagan la guarda nueva al principio del archivo, antes de
cualquier escritura (no hay eventos de trigger pendientes). Así no usan
`session_replication_role = replica`, que también apagaría los asientos
diferidos y las claves foráneas que esos tests miden.

**Rollback.** El código anterior escribe estas filas solo por estas RPC y
triggers, inserta cuotas pendientes y préstamos sin desembolso, así que
convive con las guardas. Su «Nuevo préstamo» inserta directo, y eso sigue
permitido.
